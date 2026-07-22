import { contextBridge, ipcRenderer, webUtils } from 'electron'
import type {
  ChatChunkEvent,
  ChatSendRequest,
  DownloadProgressEvent,
  EpRegisterProgressEvent
} from '@shared/types'

// Custom APIs for renderer
const api = {
  foundry: {
    listModels: () => ipcRenderer.invoke('foundry:listModels'),
    discoverEps: () => ipcRenderer.invoke('foundry:discoverEps'),
    registerEps: (names?: string[]) => ipcRenderer.invoke('foundry:registerEps', names),
    cancelRegisterEps: (names?: string[]) =>
      ipcRenderer.invoke('foundry:cancelRegisterEps', names),
    downloadModel: (modelId: string) => ipcRenderer.invoke('foundry:downloadModel', modelId),
    cancelDownload: (modelId: string) => ipcRenderer.invoke('foundry:cancelDownload', modelId),
    loadModel: (modelId: string) => ipcRenderer.invoke('foundry:loadModel', modelId),
    unloadModel: (modelId: string) => ipcRenderer.invoke('foundry:unloadModel', modelId),
    deleteModel: (modelId: string) => ipcRenderer.invoke('foundry:deleteModel', modelId),
    startServer: () => ipcRenderer.invoke('foundry:startServer'),
    stopServer: () => ipcRenderer.invoke('foundry:stopServer'),
    serverStatus: () => ipcRenderer.invoke('foundry:serverStatus'),
    onDownloadProgress: (callback: (event: DownloadProgressEvent) => void) => {
      const listener = (_e: unknown, data: DownloadProgressEvent): void => callback(data)
      ipcRenderer.on('foundry:downloadProgress', listener)
      return () => ipcRenderer.removeListener('foundry:downloadProgress', listener)
    },
    onEpRegisterProgress: (callback: (event: EpRegisterProgressEvent) => void) => {
      const listener = (_e: unknown, data: EpRegisterProgressEvent): void => callback(data)
      ipcRenderer.on('foundry:epRegisterProgress', listener)
      return () => ipcRenderer.removeListener('foundry:epRegisterProgress', listener)
    }
  },
  chat: {
    send: (request: ChatSendRequest) => ipcRenderer.invoke('chat:send', request),
    stop: (requestId: string) => ipcRenderer.invoke('chat:stop', requestId),
    onChunk: (callback: (event: ChatChunkEvent) => void) => {
      const listener = (_e: unknown, data: ChatChunkEvent): void => callback(data)
      ipcRenderer.on('chat:chunk', listener)
      return () => ipcRenderer.removeListener('chat:chunk', listener)
    }
  },
  history: {
    listConversations: () => ipcRenderer.invoke('history:listConversations'),
    createConversation: (modelId: string, title: string) =>
      ipcRenderer.invoke('history:createConversation', modelId, title),
    getMessages: (conversationId: string) =>
      ipcRenderer.invoke('history:getMessages', conversationId),
    renameConversation: (conversationId: string, title: string) =>
      ipcRenderer.invoke('history:renameConversation', conversationId, title),
    deleteConversation: (conversationId: string) =>
      ipcRenderer.invoke('history:deleteConversation', conversationId)
  },
  rag: {
    ingestFile: (conversationId: string, filePath: string, embedModelId: string) =>
      ipcRenderer.invoke('rag:ingestFile', conversationId, filePath, embedModelId),
    listDocuments: (conversationId: string) =>
      ipcRenderer.invoke('rag:listDocuments', conversationId),
    removeDocument: (conversationId: string, documentId: string) =>
      ipcRenderer.invoke('rag:removeDocument', conversationId, documentId)
  },
  getPathForFile: (file: File) => webUtils.getPathForFile(file)
}

// Use `contextBridge` APIs to expose Electron APIs to
// renderer only if context isolation is enabled, otherwise
// just add to the DOM global.
if (process.contextIsolated) {
  try {
    contextBridge.exposeInMainWorld('api', api)
  } catch (error) {
    console.error(error)
  }
} else {
  // @ts-ignore (define in dts)
  window.api = api
}
