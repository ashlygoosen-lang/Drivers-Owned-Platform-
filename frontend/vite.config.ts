import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import path from 'node:path'

// In development the API runs on :4000 and Vite proxies /api to it.
export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: { alias: { '@': path.resolve(import.meta.dirname, './src') } },
  server: {
    host: '0.0.0.0',
    port: Number(process.env.PORT || 5173),
    proxy: { '/api': process.env.VITE_DEV_API || 'http://localhost:4000' },
  },
  preview: { host: '0.0.0.0', port: Number(process.env.PORT || 4173) },
})
