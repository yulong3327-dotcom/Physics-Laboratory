import { defineConfig, loadEnv } from 'vite'
import react from '@vitejs/plugin-react'
import { cp } from 'node:fs/promises'
import { createAISessionPlugin } from './server/aiSession'
import { createAIProxyPlugin } from './server/aiProxy'

export default defineConfig(({ mode }) => {
  const env = { ...loadEnv(mode, process.cwd(), ''), ...process.env }
  return {
    plugins: [react(), createAISessionPlugin(env), createAIProxyPlugin(env), {
      name: 'laboratory-assets',
      closeBundle: () => cp('public/assets', 'dist/assets', { recursive: true }),
    }],
    build: { copyPublicDir: false },
    optimizeDeps: { entries: ['index.html'] },
    server: {
      host: '127.0.0.1',
      port: 5173,
      open: false,
      watch: { ignored: ['**/artifacts/**', '**/test-results/**', '**/playwright-report/**', '**/e2e/**', '**/tests/**', '**/.video-runtime/**', '**/.video-tools/**', '**/.video-data/**', '**/.video-data-dev/**'] },
    },
    preview: { host: '127.0.0.1' },
  }
})
