import { useCallback, useEffect, useRef, useState } from 'react'
import type { ModelSummary } from '@shared/types'
import { filterTranscriptionModels } from '../modelCategories'

function TranscribeView(): React.JSX.Element {
  const [loadedModels, setLoadedModels] = useState<ModelSummary[]>([])
  const [selectedModelId, setSelectedModelId] = useState<string>('')
  const [filePath, setFilePath] = useState<string | null>(null)
  const [fileName, setFileName] = useState<string | null>(null)
  const [transcript, setTranscript] = useState('')
  const [isTranscribing, setIsTranscribing] = useState(false)
  const [isDragOver, setIsDragOver] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const requestIdRef = useRef<string | null>(null)

  const refreshLoadedModels = useCallback(async () => {
    const all = await window.api.foundry.listModels()
    const loaded = filterTranscriptionModels(all.filter((m) => m.loaded))
    setLoadedModels(loaded)
    if (!selectedModelId && loaded.length > 0) setSelectedModelId(loaded[0].id)
  }, [selectedModelId])

  useEffect(() => {
    refreshLoadedModels()
  }, [refreshLoadedModels])

  useEffect(() => {
    const unsubscribe = window.api.audio.onChunk(({ requestId, delta, done, error: err }) => {
      if (requestId !== requestIdRef.current) return
      if (delta) setTranscript((prev) => prev + delta)
      if (done) {
        setIsTranscribing(false)
        if (err) setError(err)
      }
    })
    return unsubscribe
  }, [])

  function pickFile(file: File): void {
    setFilePath(window.api.getPathForFile(file))
    setFileName(file.name)
    setTranscript('')
    setError(null)
  }

  function handleDrop(e: React.DragEvent<HTMLDivElement>): void {
    e.preventDefault()
    setIsDragOver(false)
    const file = e.dataTransfer.files[0]
    if (file) pickFile(file)
  }

  function handleFileInput(e: React.ChangeEvent<HTMLInputElement>): void {
    const file = e.target.files?.[0]
    if (file) pickFile(file)
    e.target.value = ''
  }

  async function handleTranscribe(): Promise<void> {
    if (!filePath || !selectedModelId || isTranscribing) return
    setError(null)
    setTranscript('')

    const requestId = crypto.randomUUID()
    requestIdRef.current = requestId
    setIsTranscribing(true)

    try {
      await window.api.audio.transcribe({ requestId, modelId: selectedModelId, filePath })
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setIsTranscribing(false)
    }
  }

  function handleStop(): void {
    if (requestIdRef.current) window.api.audio.stop(requestIdRef.current)
  }

  return (
    <div className="view transcribe-view">
      <h2>Transcribe</h2>
      <p className="muted">
        Load a speech-to-text model (e.g. a Whisper variant) in the Catalog tab, then drop or pick
        an audio file below to test its transcription quality.
      </p>

      <div className="transcribe-toolbar">
        <select value={selectedModelId} onChange={(e) => setSelectedModelId(e.target.value)}>
          {loadedModels.length === 0 && <option value="">No transcription models loaded</option>}
          {loadedModels.map((m) => (
            <option key={m.id} value={m.id}>
              {m.displayName}
            </option>
          ))}
        </select>
        <label className="file-picker-btn">
          Choose audio file…
          <input type="file" accept="audio/*" onChange={handleFileInput} hidden />
        </label>
        {isTranscribing ? (
          <button className="stop-btn" onClick={handleStop}>
            Stop
          </button>
        ) : (
          <button onClick={handleTranscribe} disabled={!filePath || !selectedModelId}>
            Transcribe
          </button>
        )}
      </div>

      {error && <div className="error-banner">{error}</div>}

      <div
        className={`transcribe-dropzone ${isDragOver ? 'drag-over' : ''}`}
        onDragOver={(e) => {
          e.preventDefault()
          setIsDragOver(true)
        }}
        onDragLeave={() => setIsDragOver(false)}
        onDrop={handleDrop}
      >
        {fileName ? (
          <span>🎵 {fileName}</span>
        ) : (
          <span className="muted">Drag an audio file here, or choose one above</span>
        )}
      </div>

      <textarea
        className="transcribe-output"
        value={transcript}
        readOnly
        placeholder={isTranscribing ? 'Transcribing…' : 'Transcript will appear here…'}
      />
    </div>
  )
}

export default TranscribeView
