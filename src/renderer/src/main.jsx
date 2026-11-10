import './assets/main.css'

import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { HashRouter } from 'react-router-dom'
import App from './App'
import { initAppearanceTheme } from './utils/appearanceTheme'

// Apply the saved appearance theme before initial React render to prevent theme flashing
initAppearanceTheme()

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <HashRouter>
      <App />
    </HashRouter>
  </StrictMode>
)
