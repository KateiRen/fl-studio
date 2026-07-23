import { ipcMain, BrowserWindow } from 'electron'
import * as foundry from './foundry'
import * as db from './db'
import * as rag from './rag'
import type {
  ChatSendRequest,
  DownloadProgressEvent,
  ChatChunkEvent,
  EpRegisterProgressEvent,
  TranscribeSendRequest,
  TranscribeChunkEvent
} from '@shared/types'

const activeDownloads = new Map<string, AbortController>()
const activeChats = new Map<string, AbortController>()
const activeEpRegistrations = new Map<string, AbortController>()
const activeTranscriptions = new Map<string, AbortController>()

/** Flattens a chat message's content (plain text, or multimodal text+image parts) to plain text. */
function contentToText(content: ChatSendRequest['messages'][number]['content']): string {
  if (typeof content === 'string') return content
  return content
    .filter((part) => part.type === 'text')
    .map((part) => part.text)
    .join('\n')
}

/** True if a message's content includes an image part. */
function hasImageContent(content: ChatSendRequest['messages'][number]['content']): boolean {
  return Array.isArray(content) && content.some((part) => part.type === 'image_url')
}

export function registerIpcHandlers(getWindow: () => BrowserWindow | null): void {
  const send = (channel: string, payload: unknown): void => {
    getWindow()?.webContents.send(channel, payload)
  }

  // --- Catalog / hardware ---
  ipcMain.handle('foundry:listModels', () => foundry.listModels())
  ipcMain.handle('foundry:discoverEps', () => foundry.discoverEps())

  ipcMain.handle('foundry:registerEps', async (_event, names?: string[]) => {
    const key = names?.join(',') ?? '__all__'
    const controller = new AbortController()
    activeEpRegistrations.set(key, controller)
    try {
      return await foundry.registerEps(
        names,
        (epName, percent) => {
          const payload: EpRegisterProgressEvent = { epName, percent }
          send('foundry:epRegisterProgress', payload)
        },
        controller.signal
      )
    } finally {
      activeEpRegistrations.delete(key)
    }
  })

  ipcMain.handle('foundry:cancelRegisterEps', (_event, names?: string[]) => {
    const key = names?.join(',') ?? '__all__'
    activeEpRegistrations.get(key)?.abort()
    return { ok: true }
  })

  // --- Model lifecycle ---
  ipcMain.handle('foundry:downloadModel', async (_event, modelId: string) => {
    const controller = new AbortController()
    activeDownloads.set(modelId, controller)
    try {
      await foundry.downloadModel(
        modelId,
        (progress) => {
          const payload: DownloadProgressEvent = { modelId, progress }
          send('foundry:downloadProgress', payload)
        },
        controller.signal
      )
      return { ok: true }
    } catch (error) {
      const payload: DownloadProgressEvent = {
        modelId,
        progress: 0,
        error: error instanceof Error ? error.message : String(error)
      }
      send('foundry:downloadProgress', payload)
      throw error
    } finally {
      activeDownloads.delete(modelId)
    }
  })

  ipcMain.handle('foundry:cancelDownload', (_event, modelId: string) => {
    activeDownloads.get(modelId)?.abort()
    return { ok: true }
  })

  ipcMain.handle('foundry:loadModel', (_event, modelId: string) => foundry.loadModel(modelId))
  ipcMain.handle('foundry:unloadModel', (_event, modelId: string) => foundry.unloadModel(modelId))
  ipcMain.handle('foundry:deleteModel', (_event, modelId: string) => foundry.deleteModel(modelId))

  // --- Local server ---
  ipcMain.handle('foundry:startServer', () => foundry.startServer())
  ipcMain.handle('foundry:stopServer', () => foundry.stopServer())
  ipcMain.handle('foundry:serverStatus', () => foundry.getServerStatus())

  // --- Chat ---
  ipcMain.handle('chat:send', async (_event, request: ChatSendRequest) => {
    const { requestId, conversationId, modelId, messages, settings, embedModelId } = request

    // The installed foundry-local-sdk has no vision/image support in any client
    // (ChatClient and ResponsesClient both require plain string content) - fail
    // fast with a clear message instead of letting the SDK's own generic
    // validation error surface as a confusing IPC failure.
    if (messages.some((m) => hasImageContent(m.content))) {
      throw new Error(
        'Image attachments are not supported by the local model runtime (the installed Foundry Local SDK only accepts plain text message content). Remove the attached image and ask a text-only question.'
      )
    }

    const lastUserMessage = messages[messages.length - 1]
    if (lastUserMessage?.role === 'user') {
      db.appendMessage(conversationId, 'user', contentToText(lastUserMessage.content))
    }

    let promptMessages = messages
    let ragWarning: string | undefined
    if (embedModelId && lastUserMessage?.role === 'user') {
      try {
        const chunks = await rag.retrieve(
          conversationId,
          contentToText(lastUserMessage.content),
          embedModelId
        )
        if (chunks.length > 0) {
          const context = chunks
            .map((c) => `From "${c.documentName}":\n${c.text}`)
            .join('\n\n---\n\n')
          const contextMessage = {
            role: 'system' as const,
            content: `Use the following document excerpts to answer the user's next message. Rely only on this content when it's relevant; if it doesn't contain the answer, say so.\n\n${context}`
          }
          // Put the context message first, not just before the latest user turn:
          // many local SLMs apply a fixed system/user/assistant prompt template
          // that only recognizes a system message in the leading position, so a
          // system message injected mid-history can be silently dropped from the
          // rendered prompt.
          promptMessages = [contextMessage, ...messages]
        }
      } catch (error) {
        // Retrieval failures shouldn't block the chat; continue without context,
        // but surface it so it doesn't look like the model silently ignored the
        // document.
        ragWarning = error instanceof Error ? error.message : String(error)
        console.error('RAG retrieval failed:', error)
      }
    }

    const controller = new AbortController()
    activeChats.set(requestId, controller)
    try {
      // Defense in depth: the SDK's native chat client hard-requires every
      // message's content to be a plain non-empty string, so normalize here
      // even though `hasImageContent` already rejected image parts above.
      const flatMessages = promptMessages.map((m) => ({
        role: m.role,
        content: contentToText(m.content)
      }))
      const full = await foundry.streamChat(
        modelId,
        flatMessages,
        settings,
        (delta) => {
          const payload: ChatChunkEvent = { requestId, delta, done: false }
          send('chat:chunk', payload)
        },
        controller.signal
      )
      db.appendMessage(conversationId, 'assistant', full)
      send('chat:chunk', {
        requestId,
        done: true,
        stopped: controller.signal.aborted
      } satisfies ChatChunkEvent)
      return { ok: true, content: full, ragWarning }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      send('chat:chunk', { requestId, done: true, error: message } satisfies ChatChunkEvent)
      throw error
    } finally {
      activeChats.delete(requestId)
    }
  })

  ipcMain.handle('chat:stop', (_event, requestId: string) => {
    activeChats.get(requestId)?.abort()
    return { ok: true }
  })

  // --- Embeddings ---
  ipcMain.handle('embed:generate', (_event, modelId: string, texts: string[]) =>
    foundry.embedTexts(modelId, texts)
  )

  // --- Audio transcription ---
  ipcMain.handle('audio:transcribe', async (_event, request: TranscribeSendRequest) => {
    const { requestId, modelId, filePath } = request
    const controller = new AbortController()
    activeTranscriptions.set(requestId, controller)
    try {
      const full = await foundry.transcribeAudio(
        modelId,
        filePath,
        (delta) => {
          const payload: TranscribeChunkEvent = { requestId, delta, done: false }
          send('audio:chunk', payload)
        },
        controller.signal
      )
      send('audio:chunk', {
        requestId,
        done: true,
        stopped: controller.signal.aborted
      } satisfies TranscribeChunkEvent)
      return { ok: true, text: full }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      send('audio:chunk', { requestId, done: true, error: message } satisfies TranscribeChunkEvent)
      throw error
    } finally {
      activeTranscriptions.delete(requestId)
    }
  })

  ipcMain.handle('audio:stop', (_event, requestId: string) => {
    activeTranscriptions.get(requestId)?.abort()
    return { ok: true }
  })

  // --- Conversation history ---
  ipcMain.handle('history:listConversations', () => db.listConversations())
  ipcMain.handle('history:createConversation', (_event, modelId: string, title: string) =>
    db.createConversation(modelId, title)
  )
  ipcMain.handle('history:getMessages', (_event, conversationId: string) =>
    db.getMessages(conversationId)
  )
  ipcMain.handle('history:renameConversation', (_event, conversationId: string, title: string) =>
    db.renameConversation(conversationId, title)
  )
  ipcMain.handle('history:deleteConversation', (_event, conversationId: string) =>
    db.deleteConversation(conversationId)
  )

  // --- RAG documents ---
  ipcMain.handle(
    'rag:ingestFile',
    (_event, conversationId: string, filePath: string, embedModelId: string) =>
      rag.ingestFile(conversationId, filePath, embedModelId)
  )
  ipcMain.handle('rag:listDocuments', (_event, conversationId: string) =>
    rag.listDocuments(conversationId)
  )
  ipcMain.handle('rag:removeDocument', (_event, conversationId: string, documentId: string) =>
    rag.removeDocument(conversationId, documentId)
  )
}
