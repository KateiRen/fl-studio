// Types shared between the Electron main process and the renderer (via preload).
// Keep this file free of Node/Electron/foundry-local-sdk imports so it can be
// included from both the "node" and "web" TypeScript project references.

export type DeviceType = 'Invalid' | 'CPU' | 'GPU' | 'NPU'

export interface ModelSummary {
  id: string
  alias: string
  displayName: string
  publisher?: string | null
  task?: string | null
  deviceType?: DeviceType | null
  executionProvider?: string | null
  fileSizeMb?: number | null
  license?: string | null
  cached: boolean
  loaded: boolean
  supportsToolCalling?: boolean | null
  contextLength?: number | null
  inputModalities?: string | null
  outputModalities?: string | null
}

export interface EpStatus {
  name: string
  isRegistered: boolean
}

export interface EpRegisterResult {
  success: boolean
  status: string
  registeredEps: string[]
  failedEps: string[]
}

export interface EpRegisterProgressEvent {
  epName: string
  percent: number
}

export type ChatRole = 'system' | 'user' | 'assistant'

export interface ChatTextPart {
  type: 'text'
  text: string
}

export interface ChatImagePart {
  type: 'image_url'
  image_url: { url: string }
}

/** A single part of a multimodal (vision-language) chat message. */
export type ChatContentPart = ChatTextPart | ChatImagePart

export interface ChatMessage {
  role: ChatRole
  /** Plain text for text-only models, or a list of parts (text + image_url) for vision-language models. */
  content: string | ChatContentPart[]
}

export interface ChatSettings {
  temperature?: number
  maxTokens?: number
  topP?: number
  topK?: number
}

export interface DownloadProgressEvent {
  modelId: string
  progress: number
  error?: string
}

export interface ChatChunkEvent {
  requestId: string
  delta?: string
  done: boolean
  error?: string
  stopped?: boolean
}

export interface ChatSendRequest {
  requestId: string
  conversationId: string
  modelId: string
  messages: ChatMessage[]
  settings?: ChatSettings
  embedModelId?: string
}

export interface ServerStatus {
  running: boolean
  urls: string[]
}

export interface ConversationSummary {
  id: string
  title: string
  modelId: string
  createdAt: number
  updatedAt: number
}

export interface StoredMessage {
  id: number
  conversationId: string
  role: ChatRole
  content: string
  createdAt: number
}

export interface RagChunkResult {
  documentName: string
  chunkIndex: number
  text: string
  score: number
}

export interface DocumentSummary {
  documentId: string
  documentName: string
  chunkCount: number
}

export interface IngestResult {
  documentId: string
  documentName: string
  chunkCount: number
}

export interface TranscribeSendRequest {
  requestId: string
  modelId: string
  filePath: string
}

export interface TranscribeChunkEvent {
  requestId: string
  delta?: string
  done: boolean
  error?: string
  stopped?: boolean
}
