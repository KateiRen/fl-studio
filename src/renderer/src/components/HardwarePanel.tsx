import type { EpStatus } from '@shared/types'

interface Props {
  eps: EpStatus[]
  loading: boolean
  registering?: Record<string, number>
  onRegister?: (name: string) => void
}

const DEVICE_HINTS: Record<string, string> = {
  CUDAExecutionProvider: 'NVIDIA GPU',
  NvTensorRTRTXExecutionProvider: 'NVIDIA GPU (TensorRT)',
  WebGpuExecutionProvider: 'GPU (WebGPU)',
  QNNExecutionProvider: 'Qualcomm NPU',
  OpenVINOExecutionProvider: 'Intel CPU/GPU/NPU',
  VitisAIExecutionProvider: 'AMD NPU',
  CPUExecutionProvider: 'CPU'
}

function HardwarePanel({ eps, loading, registering, onRegister }: Props): React.JSX.Element {
  return (
    <div className="hardware-panel">
      <h3>Hardware acceleration</h3>
      {loading && <p className="muted">Detecting execution providers…</p>}
      {!loading && eps.length === 0 && <p className="muted">No execution providers detected.</p>}
      <ul className="ep-list">
        {eps.map((ep) => {
          const progress = registering?.[ep.name]
          const isRegistering = progress !== undefined
          return (
            <li key={ep.name} className={ep.isRegistered ? 'ep-registered' : 'ep-available'}>
              <div className="ep-row">
                <span className={`status-dot ${ep.isRegistered ? 'on' : 'off'}`} />
                <span className="ep-name">{ep.name}</span>
              </div>
              <div className="ep-row">
                <span className="ep-hint">{DEVICE_HINTS[ep.name] ?? ''}</span>
                {!ep.isRegistered && onRegister && (
                  <button
                    className="ep-register-btn"
                    disabled={isRegistering}
                    onClick={() => onRegister(ep.name)}
                  >
                    {isRegistering ? `Registering… ${Math.round(progress)}%` : 'Register'}
                  </button>
                )}
                {ep.isRegistered && <span className="ep-state">Registered</span>}
              </div>
            </li>
          )
        })}
      </ul>
    </div>
  )
}

export default HardwarePanel
