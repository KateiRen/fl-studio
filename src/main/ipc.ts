import { ipcMain, BrowserWindow } from 'electron'
import * as foundry from './foundry'
import * as db from './db'
import * as rag from './rag'
import type {
  ChatSendRequest,
  DownloadProgressEvent,
  ChatChunkEvent,
  EpRegisterProgressEvent
} from '@shared/types'

const activeDownloads = new Map<string, AbortController>()
const activeChats = new Map<string, AbortController>()
const activeEpRegistrations = new Map<string, AbortController>()

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

    const lastUserMessage = messages[messages.length - 1]
    if (lastUserMessage?.role === 'user') {
      db.appendMessage(conversationId, 'user', lastUserMessage.content)
    }

    let promptMessages = messages
    if (embedModelId && lastUserMessage?.role === 'user') {
      try {
        const chunks = await rag.retrieve(conversationId, lastUserMessage.content, embedModelId)
        if (chunks.length > 0) {
          const context = chunks
            .map((c) => `From "${c.documentName}":\n${c.text}`)
            .join('\n\n---\n\n')
          const contextMessage = {
            role: 'system' as const,
            content: `Use the following document excerpts to help answer the user's next message if relevant:\n\n${context}`
          }
          promptMessages = [...messages.slice(0, -1), contextMessage, lastUserMessage]
        }
      } catch (error) {
        // Retrieval failures shouldn't block the chat; continue without context.
        console.error('RAG retrieval failed:', error)
      }
    }

    const controller = new AbortController()
    activeChats.set(requestId, controller)
    try {
      const full = await foundry.streamChat(
        modelId,
        promptMessages,
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
      return { ok: true, content: full }
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
