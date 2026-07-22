import { useState } from 'react'
import Sidebar, { type ViewId } from './components/Sidebar'
import CatalogView from './views/CatalogView'
import ManageModelsView from './views/ManageModelsView'
import ChatView from './views/ChatView'
import ServerView from './views/ServerView'

function App(): React.JSX.Element {
  const [view, setView] = useState<ViewId>('catalog')

  return (
    <div className="app-shell">
      <Sidebar active={view} onChange={setView} />
      <main className="app-content">
        {view === 'catalog' && <CatalogView />}
        {view === 'manage' && <ManageModelsView />}
        {view === 'chat' && <ChatView />}
        {view === 'server' && <ServerView />}
      </main>
    </div>
  )
}

export default App
