import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { execFileSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

const root = fileURLToPath(new URL('.', import.meta.url))
const { version } = JSON.parse(readFileSync(new URL('./package.json', import.meta.url), 'utf8'))
let commit: string | null = null
let dirty = false
try {
  commit = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim()
  dirty = Boolean(execFileSync('git', ['status', '--porcelain'], { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim())
} catch {
  // Source archives do not include Git metadata.
}

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  define: { __MUXMAP_BUILD__: JSON.stringify({ version, commit, dirty }) },
  server: {
    proxy: {
      '/api': {
        target: 'http://127.0.0.1:4782',
        ws: true,
      },
    },
  },
})
