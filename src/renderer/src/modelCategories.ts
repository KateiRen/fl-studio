// Model category helpers, shared across views that filter loaded models by
// what they're actually capable of (a model's free-form `task` string comes
// from the Foundry Local catalog, e.g. "embeddings", "chat-completion",
// "automatic-speech-recognition"). Dropdowns should only offer models that
// are compatible with what they're being used for - e.g. an ASR model has no
// business showing up in an "embedding model" picker.
import type { ModelSummary } from '@shared/types'

function taskIncludes(model: ModelSummary, ...needles: string[]): boolean {
  const task = (model.task ?? '').toLowerCase()
  return needles.some((needle) => task.includes(needle))
}

/** True if the model generates vector embeddings from text. */
export function isEmbeddingModel(model: ModelSummary): boolean {
  return taskIncludes(model, 'embed')
}

/** True if the model transcribes audio to text (ASR / speech-to-text). */
export function isTranscriptionModel(model: ModelSummary): boolean {
  return taskIncludes(model, 'speech', 'transcri', 'audio', 'whisper')
}

/** True if the model can be used for chat/completion (text or vision-language). */
export function isChatModel(model: ModelSummary): boolean {
  return !isEmbeddingModel(model) && !isTranscriptionModel(model)
}

export function filterEmbeddingModels(models: ModelSummary[]): ModelSummary[] {
  return models.filter(isEmbeddingModel)
}

export function filterTranscriptionModels(models: ModelSummary[]): ModelSummary[] {
  return models.filter(isTranscriptionModel)
}

export function filterChatModels(models: ModelSummary[]): ModelSummary[] {
  return models.filter(isChatModel)
}

export type ModelCategory = 'chat' | 'embedding' | 'transcription'

export const MODEL_CATEGORY_LABELS: Record<ModelCategory, string> = {
  chat: 'Chat / Completion',
  embedding: 'Embedding',
  transcription: 'Transcription'
}

/** Classifies a model into the single category its dropdowns are filtered by. */
export function getModelCategory(model: ModelSummary): ModelCategory {
  if (isEmbeddingModel(model)) return 'embedding'
  if (isTranscriptionModel(model)) return 'transcription'
  return 'chat'
}
