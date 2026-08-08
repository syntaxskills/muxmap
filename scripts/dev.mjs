import { spawn } from 'node:child_process'

const children = [
  spawn(process.execPath, ['--experimental-strip-types', 'server/index.ts'], { stdio: 'inherit' }),
  spawn(process.execPath, ['node_modules/vite/bin/vite.js'], { stdio: 'inherit' }),
]

let stopping = false
function stop(code = 0) {
  if (stopping) return
  stopping = true
  for (const child of children) child.kill()
  process.exitCode = code
}

for (const child of children) {
  child.once('error', () => stop(1))
  child.once('exit', (code) => stop(code ?? 1))
}
process.once('SIGINT', () => stop())
process.once('SIGTERM', () => stop())
