import { spawn } from 'node:child_process'
import { createRequire } from 'node:module'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const require = createRequire(import.meta.url)
const electronBinaryPath = require('electron')

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const projectRoot = path.resolve(__dirname, '..')
const testSuitePath = path.join(projectRoot, 'tests', 'windows_packaging_tests.js')

const childEnv = {
  ...process.env,
  NODE_ENV: 'test'
}
// Clear ELECTRON_RUN_AS_NODE so Electron launches with real main-process APIs (e.g. from VS Code terminals).
delete childEnv.ELECTRON_RUN_AS_NODE

const child = spawn(electronBinaryPath, [testSuitePath], {
  cwd: projectRoot,
  stdio: 'inherit',
  env: childEnv
})

child.on('error', (err) => {
  console.error('[test:packaging] Failed to launch Electron runtime:', err.message)
  process.exit(1)
})

child.on('close', (code, signal) => {
  if (signal) {
    console.error(`[test:packaging] Electron process terminated by signal: ${signal}`)
    process.exit(1)
  }
  process.exit(code ?? 1)
})
