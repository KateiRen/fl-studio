import { FoundryLocalManager } from 'foundry-local-sdk'
import type { IModel } from 'foundry-local-sdk'
import type {
  ChatMessage,
  ChatSettings,
  EpRegisterResult,
  EpStatus,
  ModelSummary,
  ServerStatus
} from '@shared/types'

/**
 * Thin wrapper around the `foundry-local-sdk` FoundryLocalManager singleton.
 * All Foundry Local access from the app should go through this module so the
 * renderer never touches the native SDK directly (it only talks IPC).
 */

let managerPromise: Promise<FoundryLocalManager> | null = null

// Cache of IModel handles keyed by model id, populated whenever we list the
// catalog. Needed because download/load/unload/chat operate on IModel
// instances, not the plain serializable summaries sent to the renderer.
const modelCache = new Map<string, IModel>()

// One ChatClient per loaded model id, reused across messages in a session.
const chatClientCache = new Map<string, ReturnType<IModel['createChatClient']>>()
const embeddingClientCache = new Map<string, ReturnType<IModel['createEmbeddingClient']>>()

async function getManager(): Promise<FoundryLocalManager> {
  if (!managerPromise) {
    managerPromise = FoundryLocalManager.createAsync({
      appName: 'FL Studio',
      logLevel: 'warn'
    })
  }
  return managerPromise
}

function toSummary(model: IModel, loadedIds: Set<string>): ModelSummary {
  const info = model.info
  return {
    id: model.id,
    alias: model.alias,
    displayName: info.displayName ?? info.name,
    publisher: info.publisher ?? null,
    task: info.task ?? null,
    deviceType: (info.runtime?.deviceType as ModelSummary['deviceType']) ?? null,
    executionProvider: info.runtime?.executionProvider ?? null,
    fileSizeMb: info.fileSizeMb ?? null,
    license: info.license ?? null,
    cached: model.isCached,
    loaded: loadedIds.has(model.id),
    supportsToolCalling: info.supportsToolCalling ?? null,
    contextLength: info.contextLength ?? null
  }
}

/**
 * Lists every model in the catalog, annotated with cached/loaded status.
 *
 * `catalog.getModels()` returns one wrapper per model alias, which only exposes
 * the metadata (deviceType/executionProvider/etc.) of its currently *selected*
 * variant (defaults to the first variant, or a cached one if any is cached) -
 * so e.g. a model's NPU/GPU variants would never surface in the UI even though
 * they exist. We flatten `model.variants` so every device-specific variant
 * (CPU/GPU/NPU) gets its own catalog entry with its own real id, letting the
 * device filter and per-variant download/load actually work.
 */
export async function listModels(): Promise<ModelSummary[]> {
  const manager = await getManager()
  const [models, loaded] = await Promise.all([
    manager.catalog.getModels(),
    manager.catalog.getLoadedModels()
  ])
  const loadedIds = new Set(loaded.map((m) => m.id))
  const summaries: ModelSummary[] = []
  for (const model of models) {
    for (const variant of model.variants) {
      modelCache.set(variant.id, variant)
      summaries.push(toSummary(variant, loadedIds))
    }
  }
  // TEMP DIAGNOSTIC: log a breakdown by deviceType every time the catalog is
  // listed, to track down why the GPU/NPU filter counts fluctuate. Remove once
  // the root cause is found.
  const tally: Record<string, number> = {}
  for (const s of summaries) {
    const key = s.deviceType ?? 'null'
    tally[key] = (tally[key] ?? 0) + 1
  }
  console.log(`[listModels] ${new Date().toISOString()} total=${summaries.length}`, tally)
  const nonCpu = summaries.filter((s) => s.deviceType !== 'CPU')
  console.log(
    `[listModels] non-CPU variants (${nonCpu.length}):`,
    nonCpu.map((s) => `${s.alias} [${s.deviceType}/${s.executionProvider}] cached=${s.cached}`)
  )
  return summaries
}

/** Reports which execution providers are available and whether they're registered. */
export async function discoverEps(): Promise<EpStatus[]> {
  const manager = await getManager()
  return manager.discoverEps()
}

/**
 * Downloads and registers execution providers (e.g. QNN, CUDA) into this process's
 * in-process onnxruntime instance. Note: `discoverEps()` only reports whether an EP's
 * redistributable is available on the system - a system-wide install (e.g. via the
 * `foundry` CLI/service) does NOT register it for this app, since the app embeds its
 * own copy of the Foundry Local Core native library with independent EP state. This
 * must be called explicitly (once per EP, results persist in the local cache after that).
 */
export async function registerEps(
  names: string[] | undefined,
  onProgress: (epName: string, percent: number) => void,
  signal?: AbortSignal
): Promise<EpRegisterResult> {
  const manager = await getManager()
  const effectiveSignal = signal ?? new AbortController().signal
  if (names) return manager.downloadAndRegisterEps(names, onProgress, effectiveSignal)
  return manager.downloadAndRegisterEps(undefined, onProgress, effectiveSignal)
}

async function getModelById(id: string): Promise<IModel> {
  const cached = modelCache.get(id)
  if (cached) return cached
  const manager = await getManager()
  const model = await manager.catalog.getModelVariant(id)
  modelCache.set(id, model)
  return model
}

/** Downloads a model to the local cache, reporting progress 0-100 via the callback. */
export async function downloadModel(
  id: string,
  onProgress: (progress: number) => void,
  signal?: AbortSignal
): Promise<void> {
  const model = await getModelById(id)
  await model.download(onProgress, signal)
}

export async function loadModel(id: string): Promise<void> {
  const model = await getModelById(id)
  await model.load()
}

export async function unloadModel(id: string): Promise<void> {
  const model = await getModelById(id)
  await model.unload()
  chatClientCache.delete(id)
  embeddingClientCache.delete(id)
}

/** Removes a model from the local cache, unloading it first if it's currently loaded. */
export async function deleteModel(id: string): Promise<void> {
  const model = await getModelById(id)
  if (await model.isLoaded()) {
    await model.unload()
    chatClientCache.delete(id)
    embeddingClientCache.delete(id)
  }
  model.removeFromCache()
}

function getChatClient(model: IModel): ReturnType<IModel['createChatClient']> {
  let client = chatClientCache.get(model.id)
  if (!client) {
    client = model.createChatClient()
    chatClientCache.set(model.id, client)
  }
  return client
}

/** Streams a chat completion, invoking onDelta for every text fragment. Returns the full text.
 *  If `signal` is aborted mid-stream, stops consuming further chunks and returns whatever
 *  text was generated so far. */
export async function streamChat(
  modelId: string,
  messages: ChatMessage[],
  settings: ChatSettings | undefined,
  onDelta: (delta: string) => void,
  signal?: AbortSignal
): Promise<string> {
  const model = await getModelById(modelId)
  const client = getChatClient(model)
  if (settings) {
    if (settings.temperature !== undefined) client.settings.temperature = settings.temperature
    if (settings.maxTokens !== undefined) client.settings.maxTokens = settings.maxTokens
    if (settings.topP !== undefined) client.settings.topP = settings.topP
    if (settings.topK !== undefined) client.settings.topK = settings.topK
  }

  let full = ''
  for await (const chunk of client.completeStreamingChat(messages)) {
    if (signal?.aborted) break
    const delta = chunk?.choices?.[0]?.delta?.content
    if (delta) {
      full += delta
      onDelta(delta)
    }
  }
  return full
}

function getEmbeddingClient(model: IModel): ReturnType<IModel['createEmbeddingClient']> {
  let client = embeddingClientCache.get(model.id)
  if (!client) {
    client = model.createEmbeddingClient()
    embeddingClientCache.set(model.id, client)
  }
  return client
}

/** Generates embedding vectors for the given texts using the specified (loaded) model. */
export async function embedTexts(modelId: string, texts: string[]): Promise<number[][]> {
  const model = await getModelById(modelId)
  const client = getEmbeddingClient(model)
  const response = await client.generateEmbeddings(texts)
  return response.data.map((entry: { embedding: number[] }) => entry.embedding)
}

export async function startServer(): Promise<ServerStatus> {
  const manager = await getManager()
  if (!manager.isWebServiceRunning) manager.startWebService()
  return { running: manager.isWebServiceRunning, urls: manager.urls }
}

export async function stopServer(): Promise<ServerStatus> {
  const manager = await getManager()
  if (manager.isWebServiceRunning) manager.stopWebService()
  return { running: manager.isWebServiceRunning, urls: manager.urls }
}

export async function getServerStatus(): Promise<ServerStatus> {
  const manager = await getManager()
  return { running: manager.isWebServiceRunning, urls: manager.urls }
}
