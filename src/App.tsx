import { CameraPreview } from './camera/CameraPreview'
import './App.css'

function App() {
  return (
    <main className="app-shell">
      <header className="app-header">
        <h1>KEEPUPS</h1>
      </header>

      <CameraPreview />
    </main>
  )
}

export default App
