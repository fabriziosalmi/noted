import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
// Self-hosted fonts — bundled by Vite and served under app://, so they render
// offline and satisfy the CSP (font-src 'self') without any remote request.
import '@fontsource/inter/300.css'
import '@fontsource/inter/400.css'
import '@fontsource/inter/500.css'
import '@fontsource/inter/600.css'
import '@fontsource/inter/700.css'
import '@fontsource/merriweather/300.css'
import '@fontsource/merriweather/400.css'
import '@fontsource/merriweather/700.css'
import '@fontsource/merriweather/300-italic.css'
import '@fontsource/playfair-display/600.css'
import '@fontsource/playfair-display/700.css'
import '@fontsource/playfair-display/600-italic.css'
import './index.css'
import App from './App.tsx'
import { ConfirmProvider } from './components/ConfirmProvider'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <ConfirmProvider>
      <App />
    </ConfirmProvider>
  </StrictMode>,
)
