import fs from 'node:fs'
import path from 'node:path'
import { execSync, execFileSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)
const projectRoot = path.resolve(__dirname, '..')

console.log('================================================================')
console.log(' APPLAN2 — Windows ConsoleSender C# Helper Compilation')
console.log('================================================================\n')

if (process.platform !== 'win32') {
  console.log('[SKIP] Skipping Windows helper compilation on non-Windows platform.')
  process.exit(0)
}

const csSource = path.join(projectRoot, 'src', 'main', 'backend', 'utils', 'ConsoleSender.cs')
if (!fs.existsSync(csSource)) {
  console.error(`[ERROR] ConsoleSender.cs source not found: ${csSource}`)
  process.exit(1)
}

// Find csc.exe
const candidateCscPaths = [
  'C:\\Windows\\Microsoft.NET\\Framework64\\v4.0.30319\\csc.exe',
  'C:\\Windows\\Microsoft.NET\\Framework\\v4.0.30319\\csc.exe'
]

let cscPath = null
for (const cand of candidateCscPaths) {
  if (fs.existsSync(cand)) {
    cscPath = cand
    break
  }
}

if (!cscPath) {
  try {
    cscPath = execSync('where.exe csc.exe', { encoding: 'utf8' }).trim().split('\r\n')[0]
  } catch {
    cscPath = null
  }
}

if (!cscPath || !fs.existsSync(cscPath)) {
  console.error('[ERROR] C# compiler csc.exe not found on system.')
  process.exit(1)
}

console.log(`[csc] Using C# compiler: ${cscPath}`)
console.log(`[source] ${csSource}`)

// Target outputs
const resourcesDest = path.join(projectRoot, 'resources', 'bin', 'win32-x64', 'send-ctrl-break.exe')
const backendDest = path.join(projectRoot, 'src', 'main', 'backend', 'bin', 'send-ctrl-break.exe')

fs.mkdirSync(path.dirname(resourcesDest), { recursive: true })
fs.mkdirSync(path.dirname(backendDest), { recursive: true })

const compileCmd = `"${cscPath}" /nologo /optimize /platform:x64 /out:"${resourcesDest}" "${csSource}"`
console.log(`[compile] ${compileCmd}`)

try {
  execSync(compileCmd, { windowsHide: true })
} catch (compileErr) {
  console.error('[ERROR] Compilation failed:', compileErr.message)
  process.exit(1)
}

if (!fs.existsSync(resourcesDest)) {
  console.error(`[ERROR] Target binary was not created: ${resourcesDest}`)
  process.exit(1)
}

// Copy to backend bin
fs.copyFileSync(resourcesDest, backendDest)
console.log(`[output] Copied to ${resourcesDest}`)
console.log(`[output] Copied to ${backendDest}`)

// Verify execution with --version
try {
  const versionOutput = execFileSync(resourcesDest, ['--version'], {
    encoding: 'utf8',
    windowsHide: true,
    timeout: 5000
  }).trim()
  console.log(`[verify] Binary execution verified: "${versionOutput}"`)
} catch (testErr) {
  console.error('[ERROR] Execution verification failed:', testErr.message)
  process.exit(1)
}

console.log('\n[PASS] send-ctrl-break.exe compiled and verified successfully.\n')
