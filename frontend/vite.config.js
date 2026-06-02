import { defineConfig, loadEnv } from 'vite'
import react from '@vitejs/plugin-react'

const normalizeApiTarget = (value) => {
  const cleaned = String(value || '').trim().replace(/\/+$/, '')
  if (!cleaned) {
    throw new Error('VITE_API_URL is required in frontend/.env (example: http://localhost:8000)')
  }
  return cleaned.toLowerCase().endsWith('/api') ? cleaned.slice(0, -4) : cleaned
}

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '')
  const apiTarget = normalizeApiTarget(env.VITE_API_URL)

  return {
    plugins: [react()],
    server: {
      host: true,
      port: 5173,
      proxy: {
        '/api': {
          target: apiTarget,
          changeOrigin: true,
          secure: false,
        },
      },
    },
  }
})
