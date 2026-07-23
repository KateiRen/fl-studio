import { useEffect, useMemo, useState, useCallback } from 'react'
import type { DeviceType, EpStatus, ModelSummary } from '@shared/types'
import ModelCard from '../components/ModelCard'
import HardwarePanel from '../components/HardwarePanel'

function CatalogView(): React.JSX.Element {
  const [models, setModels] = useState<ModelSummary[]>([])
  const [eps, setEps] = useState<EpStatus[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [progress, setProgress] = useState<Record<string, number>>({})

  const [deviceFilter, setDeviceFilter] = useState<DeviceType | 'ALL'>('ALL')
  const [taskFilter, setTaskFilter] = useState<string>('ALL')
  const [search, setSearch] = useState('')
  const [epRegisterProgress, setEpRegisterProgress] = useState<Record<string, number>>({})
  const [loadingModelId, setLoadingModelId] = useState<string | null>(null)

  const refreshModels = useCallback(async () => {
    const list = await window.api.foundry.listModels()
    setModels(list)
  }, [])

  const refreshEps = useCallback(async () => {
    const epList = await window.api.foundry.discoverEps()
    setEps(epList)
  }, [])

  useEffect(() => {
    let mounted = true
    setLoading(true)
    Promise.all([window.api.foundry.listModels(), window.api.foundry.discoverEps()])
      .then(([modelList, epList]) => {
        if (!mounted) return
        setModels(modelList)
        setEps(epList)
        // The catalog only exposes device-specific model variants for EPs that
        // have been registered in this process (CPU is the only exception, since
        // it needs no registration). Auto-register every discovered EP on startup
        // so the full catalog is visible right away, instead of requiring the
        // user to manually click "Register" before those variants show up.
        // Registration is a fast no-op for EPs already registered in a prior
        // session (their redistributables are cached locally).
        const unregistered = epList.filter((ep) => !ep.isRegistered).map((ep) => ep.name)
        if (unregistered.length > 0) {
          registerEpsAndRefresh(unregistered).catch(() => {})
        }
      })
      .catch((err) => setError(err instanceof Error ? err.message : String(err)))
      .finally(() => setLoading(false))

    const unsubscribe = window.api.foundry.onDownloadProgress(({ modelId, progress: p, error: err }) => {
      if (err) {
        setError(err)
        setProgress((prev) => {
          const next = { ...prev }
          delete next[modelId]
          return next
        })
        return
      }
      setProgress((prev) => ({ ...prev, [modelId]: p }))
      if (p >= 100) {
        setTimeout(() => {
          setProgress((prev) => {
            const next = { ...prev }
            delete next[modelId]
            return next
          })
          refreshModels()
        }, 400)
      }
    })

    return () => {
      mounted = false
      unsubscribe()
    }
  }, [refreshModels])

  async function handleRegisterEp(name: string): Promise<void> {
    return registerEpsAndRefresh([name])
  }

  async function registerEpsAndRefresh(names: string[]): Promise<void> {
    setEpRegisterProgress((prev) => {
      const next = { ...prev }
      for (const name of names) next[name] = 0
      return next
    })
    const unsubscribe = window.api.foundry.onEpRegisterProgress(({ epName, percent }) => {
      setEpRegisterProgress((prev) => ({ ...prev, [epName]: percent }))
    })
    try {
      const result = await window.api.foundry.registerEps(names)
      if (result.failedEps.length > 0) {
        setError(`Failed to register ${result.failedEps.join(', ')}: ${result.status}`)
      }
      // Registering an EP changes which device-specific model variants the catalog
      // exposes (the SDK invalidates its own catalog cache on success), so the model
      // list must be re-fetched too, not just the EP list.
      await Promise.all([refreshEps(), refreshModels()])
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      unsubscribe()
      setEpRegisterProgress((prev) => {
        const next = { ...prev }
        for (const name of names) delete next[name]
        return next
      })
    }
  }

  const registeredEps = useMemo(
    () => new Set(eps.filter((e) => e.isRegistered).map((e) => e.name)),
    [eps]
  )

  const tasks = useMemo(() => {
    const set = new Set<string>()
    for (const m of models) if (m.task) set.add(m.task)
    return [...set]
  }, [models])

  const filteredModels = useMemo(() => {
    return models.filter((m) => {
      if (deviceFilter !== 'ALL' && m.deviceType !== deviceFilter) return false
      if (taskFilter !== 'ALL' && m.task !== taskFilter) return false
      if (search && !m.alias.toLowerCase().includes(search.toLowerCase())) return false
      return true
    })
  }, [models, deviceFilter, taskFilter, search])

  // "Recommended for your hardware" badge: true only for variants that actually
  // exploit a registered accelerator (GPU/NPU) EP. CPU is the universal fallback
  // that works everywhere, so it's never a "hardware match" worth highlighting.
  function matchesHardware(m: ModelSummary): boolean {
    if (m.deviceType === 'CPU') return false
    if (!m.executionProvider) return false
    return registeredEps.has(m.executionProvider)
  }

  // Whether a variant can actually be loaded right now: CPU always works with no
  // registration step, while GPU/NPU variants require their EP to be registered
  // in-process first (otherwise loading would fail).
  function isLoadable(m: ModelSummary): boolean {
    if (m.deviceType === 'CPU') return true
    if (!m.executionProvider) return false
    return registeredEps.has(m.executionProvider)
  }

  async function handleDownload(modelId: string): Promise<void> {
    setProgress((prev) => ({ ...prev, [modelId]: 0 }))
    try {
      await window.api.foundry.downloadModel(modelId)
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    }
  }

  async function handleLoad(modelId: string): Promise<void> {
    setLoadingModelId(modelId)
    try {
      await window.api.foundry.loadModel(modelId)
      await refreshModels()
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setLoadingModelId(null)
    }
  }

  async function handleUnload(modelId: string): Promise<void> {
    try {
      await window.api.foundry.unloadModel(modelId)
      await refreshModels()
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    }
  }

  async function handleDelete(modelId: string): Promise<void> {
    try {
      await window.api.foundry.deleteModel(modelId)
      await refreshModels()
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    }
  }

  return (
    <div className="view catalog-view">
      <div className="catalog-main">
        <div className="catalog-toolbar">
          <input
            placeholder="Search by alias…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
          <select
            value={deviceFilter}
            onChange={(e) => setDeviceFilter(e.target.value as DeviceType | 'ALL')}
          >
            <option value="ALL">All devices</option>
            <option value="CPU">CPU</option>
            <option value="GPU">GPU</option>
            <option value="NPU">NPU</option>
          </select>
          <select value={taskFilter} onChange={(e) => setTaskFilter(e.target.value)}>
            <option value="ALL">All tasks</option>
            {tasks.map((t) => (
              <option key={t} value={t}>
                {t}
              </option>
            ))}
          </select>
        </div>

        <p className="muted">
          Showing {filteredModels.length} of {models.length} models
        </p>

        {error && <div className="error-banner">{error}</div>}
        {loading && <p className="muted">Loading catalog…</p>}

        <div className="model-grid">
          {filteredModels.map((m) => (
            <ModelCard
              key={m.id}
              model={m}
              matchesHardware={matchesHardware(m)}
              loadable={isLoadable(m)}
              isLoading={loadingModelId === m.id}
              downloadProgress={progress[m.id]}
              onDownload={handleDownload}
              onLoad={handleLoad}
              onUnload={handleUnload}
              onDelete={handleDelete}
            />
          ))}
          {!loading && filteredModels.length === 0 && (
            <p className="muted">No models match the current filters.</p>
          )}
        </div>
      </div>
      <HardwarePanel
        eps={eps}
        loading={loading}
        registering={epRegisterProgress}
        onRegister={handleRegisterEp}
      />
    </div>
  )
}

export default CatalogView
