import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  // Which build this is: the data a browser keeps from an older one isn't used.
  define: { __BUILD_ID__: JSON.stringify(Date.now().toString(36)) },
})
