import { app } from 'electron'
import { join, extname } from 'path'
import { readFile, writeFile, mkdir, stat } from 'fs/promises'
import { randomUUID } from 'crypto'
import type { DocumentSummary, IngestResult, RagChunkResult } from '@shared/types'
import { embedTexts } from './foundry'

const ALLOWED_EXTENSIONS = new Set(['.txt', '.md', '.pdf', '.docx'])
const MAX_FILE_BYTES = 25 * 1024 * 1024 // 25 MB
const CHUNK_SIZE_CHARS = 1200
const CHUNK_OVERLAP_CHARS = 200

interface StoredChunk {
  chunkIndex: number
  text: string
  embedding: number[]
}

interface DocRecord {
  documentId: string
  documentName: string
  chunks: StoredChunk[]
}

// conversationId -> documents attached to that conversation
const store = new Map<string, DocRecord[]>()
let loaded = false

function storePath(): string {
  return join(app.getPath('userData'), 'rag-store.json')
}

async function ensureLoaded(): Promise<void> {
  if (loaded) return
  loaded = true
  try {
    const raw = await readFile(storePath(), 'utf-8')
    const parsed = JSON.parse(raw) as Record<string, DocRecord[]>
    for (const [conversationId, docs] of Object.entries(parsed)) {
      store.set(conversationId, docs)
    }
  } catch {
    // No store yet, or unreadable — start fresh.
  }
}

async function persist(): Promise<void> {
  const obj: Record<string, DocRecord[]> = {}
  for (const [conversationId, docs] of store.entries()) obj[conversationId] = docs
  await mkdir(app.getPath('userData'), { recursive: true })
  await writeFile(storePath(), JSON.stringify(obj), 'utf-8')
}

async function extractText(filePath: string): Promise<string> {
  const ext = extname(filePath).toLowerCase()
  if (!ALLOWED_EXTENSIONS.has(ext)) {
    throw new Error(`Unsupported file type "${ext}". Supported: ${[...ALLOWED_EXTENSIONS].join(', ')}`)
  }

  const fileStat = await stat(filePath)
  if (fileStat.size > MAX_FILE_BYTES) {
    throw new Error(`File is too large (${Math.round(fileStat.size / 1024 / 1024)} MB). Limit is 25 MB.`)
  }

  if (ext === '.txt' || ext === '.md') {
    return readFile(filePath, 'utf-8')
  }

  if (ext === '.pdf') {
    const { PDFParse } = await import('pdf-parse')
    const buffer = await readFile(filePath)
    const parser = new PDFParse({ data: buffer })
    try {
      const result = await parser.getText()
      return result.text
    } finally {
      await parser.destroy()
    }
  }

  // .docx
  const mammoth = await import('mammoth')
  const buffer = await readFile(filePath)
  const result = await mammoth.extractRawText({ buffer })
  return result.value
}

function chunkText(text: string): string[] {
  const normalized = text.replace(/\r\n/g, '\n').trim()
  if (!normalized) return []
  const chunks: string[] = []
  let start = 0
  while (start < normalized.length) {
    const end = Math.min(start + CHUNK_SIZE_CHARS, normalized.length)
    chunks.push(normalized.slice(start, end))
    if (end === normalized.length) break
    start = end - CHUNK_OVERLAP_CHARS
  }
  return chunks
}

function cosineSimilarity(a: number[], b: number[]): number {
  let dot = 0
  let normA = 0
  let normB = 0
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i]
    normA += a[i] * a[i]
    normB += b[i] * b[i]
  }
  if (normA === 0 || normB === 0) return 0
  return dot / (Math.sqrt(normA) * Math.sqrt(normB))
}

/** Extracts, chunks, embeds, and stores a dropped document for a given conversation. */
export async function ingestFile(
  conversationId: string,
  filePath: string,
  embedModelId: string
): Promise<IngestResult> {
  await ensureLoaded()
  const text = await extractText(filePath)
  const chunks = chunkText(text)
  if (chunks.length === 0) {
    throw new Error('No extractable text was found in this file.')
  }

  const embeddings = await embedTexts(embedModelId, chunks)
  const documentId = randomUUID()
  const documentName = filePath.split(/[\\/]/).pop() ?? filePath

  const record: DocRecord = {
    documentId,
    documentName,
    chunks: chunks.map((chunkTextValue, i) => ({
      chunkIndex: i,
      text: chunkTextValue,
      embedding: embeddings[i]
    }))
  }

  const docs = store.get(conversationId) ?? []
  docs.push(record)
  store.set(conversationId, docs)
  await persist()

  return { documentId, documentName, chunkCount: chunks.length }
}

export async function listDocuments(conversationId: string): Promise<DocumentSummary[]> {
  await ensureLoaded()
  const docs = store.get(conversationId) ?? []
  return docs.map((d) => ({
    documentId: d.documentId,
    documentName: d.documentName,
    chunkCount: d.chunks.length
  }))
}

export async function removeDocument(conversationId: string, documentId: string): Promise<void> {
  await ensureLoaded()
  const docs = store.get(conversationId) ?? []
  store.set(conversationId, docs.filter((d) => d.documentId !== documentId))
  await persist()
}

/** Embeds the query and returns the top-k most similar chunks across all documents in the conversation. */
export async function retrieve(
  conversationId: string,
  query: string,
  embedModelId: string,
  topK = 4
): Promise<RagChunkResult[]> {
  await ensureLoaded()
  const docs = store.get(conversationId) ?? []
  if (docs.length === 0) return []

  const [queryEmbedding] = await embedTexts(embedModelId, [query])

  const scored: RagChunkResult[] = []
  for (const doc of docs) {
    for (const chunk of doc.chunks) {
      scored.push({
        documentName: doc.documentName,
        chunkIndex: chunk.chunkIndex,
        text: chunk.text,
        score: cosineSimilarity(queryEmbedding, chunk.embedding)
      })
    }
  }

  scored.sort((a, b) => b.score - a.score)
  return scored.slice(0, topK)
}
