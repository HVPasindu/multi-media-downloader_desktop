import fs from 'node:fs'
import path from 'node:path'
import crypto from 'node:crypto'
import https from 'node:https'
import { fileURLToPath } from 'node:url'
import { execFileSync } from 'node:child_process'
import { WINDOWS_BINARIES_MANIFEST } from './windows-binaries-manifest.mjs'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)
const projectRoot = path.resolve(__dirname, '..')

console.log('================================================================')
console.log(' APPLAN2 — Windows Packaged Binaries Provisioning')
console.log('================================================================\n')

const targetDir = path.join(projectRoot, 'resources', 'bin', 'win32-x64')
const licensesDir = path.join(targetDir, 'licenses')

fs.mkdirSync(targetDir, { recursive: true })
fs.mkdirSync(licensesDir, { recursive: true })

export function computeSha256(filePath) {
  const hash = crypto.createHash('sha256')
  const data = fs.readFileSync(filePath)
  hash.update(data)
  return hash.digest('hex').toUpperCase()
}

export function downloadFile(url, destPath) {
  return new Promise((resolve, reject) => {
    const file = fs.createWriteStream(destPath)
    const request = (requestUrl) => {
      https
        .get(requestUrl, (response) => {
          if (
            response.statusCode >= 300 &&
            response.statusCode < 400 &&
            response.headers.location
          ) {
            return request(response.headers.location)
          }
          if (response.statusCode !== 200) {
            file.close()
            fs.unlink(destPath, () => {})
            return reject(
              new Error(`HTTP ${response.statusCode} while downloading from ${requestUrl}`)
            )
          }
          response.pipe(file)
          file.on('finish', () => {
            file.close(resolve)
          })
        })
        .on('error', (err) => {
          file.close()
          fs.unlink(destPath, () => {})
          reject(err)
        })
    }
    request(url)
  })
}

export function findFileRecursively(dir, targetName) {
  const entries = fs.readdirSync(dir, { withFileTypes: true })
  for (const entry of entries) {
    const full = path.join(dir, entry.name)
    if (entry.isDirectory()) {
      const found = findFileRecursively(full, targetName)
      if (found) return found
    } else if (entry.name.toLowerCase() === targetName.toLowerCase()) {
      return full
    }
  }
  return null
}

export async function extractAndVerifyArchive({
  archivePath,
  expectedArchiveSha256,
  extractDir,
  targetDir: destDir,
  requiredBinaries = []
}) {
  const actualArchiveHash = computeSha256(archivePath)
  if (expectedArchiveSha256 && actualArchiveHash !== expectedArchiveSha256.toUpperCase()) {
    throw new Error(
      `FFmpeg archive SHA-256 verification failed! Expected: ${expectedArchiveSha256}, Got: ${actualArchiveHash}`
    )
  }

  fs.mkdirSync(extractDir, { recursive: true })
  execFileSync('powershell.exe', [
    '-NoProfile',
    '-Command',
    `Expand-Archive -Path "${archivePath}" -DestinationPath "${extractDir}" -Force`
  ])

  const verifiedFiles = []
  for (const item of requiredBinaries) {
    const extractedPath = findFileRecursively(extractDir, item.name)
    if (!extractedPath) {
      throw new Error(`Required executable ${item.name} not found inside extracted archive`)
    }
    const exeHash = computeSha256(extractedPath)
    if (item.expectedSha256 && exeHash !== item.expectedSha256.toUpperCase()) {
      throw new Error(
        `Executable ${item.name} checksum mismatch! Expected: ${item.expectedSha256}, Got: ${exeHash}`
      )
    }
    verifiedFiles.push({ name: item.name, source: extractedPath })
  }

  for (const vf of verifiedFiles) {
    const finalDest = path.join(destDir, vf.name)
    fs.copyFileSync(vf.source, finalDest)
    console.log(`[success] ${vf.name} verified and copied to ${finalDest}`)
  }
  return true
}

export async function provisionBinaries() {
  const archivesDownloaded = new Map()

  for (const bin of WINDOWS_BINARIES_MANIFEST.binaries) {
    if (bin.isCompiled) {
      continue
    }

    const filePath = path.join(targetDir, bin.name)
    let needsDownload = false

    if (!fs.existsSync(filePath)) {
      console.log(`[provision] ${bin.name} is missing.`)
      needsDownload = true
    } else {
      const hash = computeSha256(filePath)
      if (bin.expectedSha256 && hash !== bin.expectedSha256.toUpperCase()) {
        console.warn(`[provision] Checksum mismatch for existing ${bin.name}. Re-provisioning...`)
        needsDownload = true
      } else {
        console.log(`[verified] ${bin.name} already present and checksum matches.`)
      }
    }

    if (needsDownload) {
      if (bin.url) {
        console.log(`[download] Downloading ${bin.name} from ${bin.url}...`)
        const tmpPath = filePath + '.tmp'
        try {
          await downloadFile(bin.url, tmpPath)
          const downloadedHash = computeSha256(tmpPath)
          if (bin.expectedSha256 && downloadedHash !== bin.expectedSha256.toUpperCase()) {
            fs.unlinkSync(tmpPath)
            throw new Error(
              `Downloaded ${bin.name} SHA-256 mismatch! Expected: ${bin.expectedSha256}, Got: ${downloadedHash}`
            )
          }
          fs.renameSync(tmpPath, filePath)
          console.log(`[success] ${bin.name} downloaded and verified (SHA-256 match).`)
        } catch (dlErr) {
          if (fs.existsSync(tmpPath)) fs.unlinkSync(tmpPath)
          throw new Error(`Failed to provision ${bin.name}: ${dlErr.message}`)
        }
      } else if (bin.archiveId && WINDOWS_BINARIES_MANIFEST.archives[bin.archiveId]) {
        const archConfig = WINDOWS_BINARIES_MANIFEST.archives[bin.archiveId]
        let zipPath = archivesDownloaded.get(bin.archiveId)
        const tmpExtractDir = path.join(targetDir, `temp_extracted_${bin.archiveId}`)

        try {
          if (!zipPath || !fs.existsSync(zipPath)) {
            zipPath = path.join(targetDir, `temp_${bin.archiveId}.zip`)
            console.log(
              `[download] Downloading archive ${bin.archiveId} from ${archConfig.archiveUrl}...`
            )
            await downloadFile(archConfig.archiveUrl, zipPath)
            archivesDownloaded.set(bin.archiveId, zipPath)
          }

          const containedItems = WINDOWS_BINARIES_MANIFEST.binaries.filter(
            (b) => b.archiveId === bin.archiveId
          )

          await extractAndVerifyArchive({
            archivePath: zipPath,
            expectedArchiveSha256: archConfig.archiveSha256,
            extractDir: tmpExtractDir,
            targetDir,
            requiredBinaries: containedItems
          })
        } catch (archErr) {
          throw new Error(`Failed to provision ${bin.name} from archive: ${archErr.message}`)
        } finally {
          if (fs.existsSync(tmpExtractDir)) {
            fs.rmSync(tmpExtractDir, { recursive: true, force: true })
          }
        }
      } else {
        throw new Error(`Cannot auto-download ${bin.name}: No pinned URL or archive configured.`)
      }
    }

    // Provision license if missing
    if (bin.licenseFile) {
      const licensePath = path.join(licensesDir, bin.licenseFile)
      if (!fs.existsSync(licensePath)) {
        if (bin.licenseUrl) {
          try {
            await downloadFile(bin.licenseUrl, licensePath)
            console.log(`[license] Downloaded ${bin.licenseFile}`)
          } catch {
            fs.writeFileSync(
              licensePath,
              `Binary license for ${bin.name} version ${bin.version}.\nSee official vendor distribution.`
            )
          }
        } else {
          fs.writeFileSync(
            licensePath,
            `Binary license for ${bin.name} version ${bin.version}.\nSee official vendor distribution.`
          )
        }
      }
    }
  }

  // Cleanup temporary archive files
  for (const [, zPath] of archivesDownloaded) {
    if (fs.existsSync(zPath)) {
      try {
        fs.unlinkSync(zPath)
      } catch {
        // Ignore unlink failure
      }
    }
  }

  // Compile send-ctrl-break.exe via build-console-sender.mjs
  console.log('\n[compile] Building Windows Console Helper (send-ctrl-break.exe)...')
  execFileSync(process.execPath, [path.join(projectRoot, 'scripts', 'build-console-sender.mjs')], {
    cwd: projectRoot,
    stdio: 'inherit'
  })

  console.log('\n[PASS] All Windows binaries provisioned successfully.\n')
}

// Auto-run if executed directly
if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  provisionBinaries().catch((err) => {
    console.error('\n[FATAL] Binary provisioning failed:', err.message)
    process.exit(1)
  })
}
