export type ViewId = 'catalog' | 'manage' | 'chat' | 'server'

interface Props {
  active: ViewId
  onChange: (view: ViewId) => void
}

const NAV_ITEMS: { id: ViewId; label: string; icon: string }[] = [
  { id: 'catalog', label: 'Catalog', icon: '📦' },
  { id: 'manage', label: 'Manage Models', icon: '🗂️' },
  { id: 'chat', label: 'Chat', icon: '💬' },
  { id: 'server', label: 'Local Server', icon: '🌐' }
]

function Sidebar({ active, onChange }: Props): React.JSX.Element {
  return (
    <nav className="sidebar">
      <div className="sidebar-title">FL Studio</div>
      {NAV_ITEMS.map((item) => (
        <button
          key={item.id}
          className={`sidebar-item ${active === item.id ? 'active' : ''}`}
          onClick={() => onChange(item.id)}
        >
          <span className="sidebar-icon">{item.icon}</span>
          {item.label}
        </button>
      ))}
    </nav>
  )
}

export default Sidebar
