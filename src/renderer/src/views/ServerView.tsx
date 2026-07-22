import { useEffect, useState } from 'react'
import type { ServerStatus } from '@shared/types'

function ServerView(): React.JSX.Element {
  const [status, setStatus] = useState<ServerStatus>({ running: false, urls: [] })
  const [busy, setBusy] = useState(false)
  const [copied, setCopied] = useState(false)

  useEffect(() => {
    window.api.foundry.serverStatus().then(setStatus)
  }, [])

  async function handleToggle(): Promise<void> {
    setBusy(true)
    try {
      const next = status.running
        ? await window.api.foundry.stopServer()
        : await window.api.foundry.startServer()
      setStatus(next)
    } finally {
      setBusy(false)
    }
  }

  const baseUrl = status.urls[0] ?? ''

  async function handleCopy(): Promise<void> {
    await navigator.clipboard.writeText(baseUrl)
    setCopied(true)
    setTimeout(() => setCopied(false), 1500)
  }

  return (
    <div className="view server-view">
      <h2>Local Server</h2>
      <p className="muted">
        Foundry Local runs its own OpenAI-compatible HTTP server on your machine. Start it here to
        let other apps (Open WebUI, the OpenAI SDK, LangChain, curl…) talk to your loaded models.
      </p>

      <div className="server-status-card">
        <div className="server-status-row">
          <span className={`status-dot ${status.running ? 'on' : 'off'}`} />
          <span>{status.running ? 'Running' : 'Stopped'}</span>
          <button onClick={handleToggle} disabled={busy}>
            {status.running ? 'Stop server' : 'Start server'}
          </button>
        </div>

        {status.running && baseUrl && (
          <div className="server-endpoint">
            <code>{baseUrl}</code>
            <button onClick={handleCopy}>{copied ? 'Copied!' : 'Copy'}</button>
          </div>
        )}
      </div>

      {status.running && baseUrl && (
        <div className="server-snippet">
          <h4>Try it</h4>
          <pre>{`curl ${baseUrl}/v1/chat/completions \\
  -H "Content-Type: application/json" \\
  -d '{"model":"<model-id-from-Catalog>","messages":[{"role":"user","content":"Hello"}]}'`}</pre>
          <p className="muted">
            The server binds to localhost only. Use the model id shown on its card in the Catalog
            tab (the model must be loaded first).
          </p>
        </div>
      )}
    </div>
  )
}

export default ServerView
