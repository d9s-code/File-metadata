import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import '@fontsource-variable/inter'
import '@fontsource-variable/jetbrains-mono'
import './index.css'
import './styles/workbench.css'
import './styles/instrument.css'
import App from './App.tsx'
import { installColumnResize } from './utils/columnResize'

installColumnResize()

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
