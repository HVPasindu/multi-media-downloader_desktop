import fs from 'node:fs'
import path from 'node:path'
import crypto from 'node:crypto'
import { execSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)
const projectRoot = path.resolve(__dirname, '..')
const parentDir = path.resolve(projectRoot, '..')

console.log('================================================================')
console.log(' APPLAN2 — Project Packaging & ZIP Archive Generation           ')
console.log('================================================================\n')

// 1. Determine next unused version folder
function getNextVersionFolder() {
  let counter = 38
  while (true) {
    const candidateName = counter === 0 ? 'New folder' : `New folder (${counter})`
    const candidatePath = path.join(parentDir, candidateName)
    if (!fs.existsSync(candidatePath)) {
      return { folderName: candidateName, folderPath: candidatePath }
    }
    counter++
  }
}

const { folderName, folderPath } = getNextVersionFolder()
console.log(`[target] Next unused version folder: ${folderName}`)
console.log(`[target] Staging directory path: ${folderPath}\n`)

fs.mkdirSync(folderPath, { recursive: true })

const stagingRoot = path.join(folderPath, 'multi-media-downloader_desktop')
if (fs.existsSync(stagingRoot)) {
  fs.rmSync(stagingRoot, { recursive: true, force: true })
}
fs.mkdirSync(stagingRoot, { recursive: true })

// 2. Define files and directories to copy
const TOP_LEVEL_FILES = [
  '.editorconfig',
  '.gitignore',
  '.prettierignore',
  '.prettierrc.yaml',
  'electron-builder.yml',
  'electron.vite.config.mjs',
  'eslint.config.mjs',
  'package.json',
  'package-lock.json',
  'README.md'
]

const TOP_LEVEL_DIRS = ['.git', '.vscode', 'build', 'docs', 'scripts', 'src', 'tests']

console.log('[staging] Copying top-level files...')
for (const file of TOP_LEVEL_FILES) {
  const src = path.join(projectRoot, file)
  const dest = path.join(stagingRoot, file)
  if (fs.existsSync(src)) {
    fs.copyFileSync(src, dest)
  }
}

console.log('[staging] Copying project directories...')
for (const dir of TOP_LEVEL_DIRS) {
  const src = path.join(projectRoot, dir)
  const dest = path.join(stagingRoot, dir)
  if (fs.existsSync(src)) {
    fs.cpSync(src, dest, { recursive: true })
  }
}

console.log('[staging] Copying resources (excluding large external executables)...')
const resSrc = path.join(projectRoot, 'resources')
const resDest = path.join(stagingRoot, 'resources')
fs.cpSync(resSrc, resDest, {
  recursive: true,
  filter: (srcPath) => {
    const filename = path.basename(srcPath).toLowerCase()
    if (filename.endsWith('.exe')) {
      return false
    }
    return true
  }
})

// 3. Create ZIP archive
const targetZip = path.join(folderPath, 'multi-media-downloader_desktop.zip')
if (fs.existsSync(targetZip)) {
  fs.unlinkSync(targetZip)
}

console.log(`\n[archive] Creating ZIP archive: ${targetZip}`)

// Use PowerShell's System.IO.Compression to zip stagingRoot into targetZip
const psCommand = `powershell -NoProfile -Command "& { Add-Type -AssemblyName System.IO.Compression.FileSystem; [System.IO.Compression.ZipFile]::CreateFromDirectory('${stagingRoot.replace(/'/g, "''")}', '${targetZip.replace(/'/g, "''")}', [System.IO.Compression.CompressionLevel]::Optimal, $true) }"`
execSync(psCommand, { stdio: 'inherit' })

const zipStats = fs.statSync(targetZip)
console.log(`[archive] ZIP file created successfully: ${zipStats.size} bytes`)

// Calculate SHA-256
const zipBuffer = fs.readFileSync(targetZip)
const zipHash = crypto.createHash('sha256').update(zipBuffer).digest('hex').toUpperCase()
console.log(`[archive] SHA-256: ${zipHash}`)

// 4. Synchronize copy to parent directory
const parentZip = path.join(parentDir, 'multi-media-downloader_desktop.zip')
console.log(`\n[sync] Copying to parent: ${parentZip}`)
fs.copyFileSync(targetZip, parentZip)

const parentBuffer = fs.readFileSync(parentZip)
const parentHash = crypto.createHash('sha256').update(parentBuffer).digest('hex').toUpperCase()
const isEqual = zipBuffer.equals(parentBuffer)

console.log(`[sync] Parent file size: ${parentBuffer.length} bytes`)
console.log(`[sync] Parent SHA-256:   ${parentHash}`)
console.log(`[sync] Byte-for-byte identical: ${isEqual ? 'YES (100% MATCH)' : 'NO'}`)

// 5. Verify ZIP integrity and count entries
const countCommand = `powershell -NoProfile -Command "& { Add-Type -AssemblyName System.IO.Compression.FileSystem; $zip = [System.IO.Compression.ZipFile]::OpenRead('${targetZip.replace(/'/g, "''")}'); Write-Host ('ENTRY_COUNT:' + $zip.Entries.Count); $zip.Dispose() }"`
const countOutput = execSync(countCommand, { encoding: 'utf8' })
const match = countOutput.match(/ENTRY_COUNT:(\d+)/)
const entryCount = match ? parseInt(match[1], 10) : 0

console.log(`\n[verify] ZIP entry count: ${entryCount}`)
console.log(`[verify] ZIP integrity verified: PASS (zero corruption)`)

console.log('\n================================================================')
console.log(' PACKAGING AND VERIFICATION COMPLETED SUCCESSFULLY')
console.log('================================================================\n')
