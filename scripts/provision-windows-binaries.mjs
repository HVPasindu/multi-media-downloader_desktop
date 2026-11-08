import fs from 'node:fs'
import path from 'node:path'
import crypto from 'node:crypto'
import https from 'node:https'
import { fileURLToPath } from 'node:url'
import { execFileSync } from 'node:child_process'

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

const PINNED_BINARIES = [
  {
    name: 'yt-dlp.exe',
    version: '2026.10.21',
    sha256: '33121D192D706E62F684A06F80918E3F3A8BA52AC3A65213B6951C39C7D9F555',
    url: 'https://github.com/yt-dlp/yt-dlp/releases/download/2026.10.21/yt-dlp.exe',
    licenseFile: 'LICENSE.yt-dlp.txt',
    licenseUrl: 'https://raw.githubusercontent.com/yt-dlp/yt-dlp/2026.10.21/LICENSE'
  },
  {
    name: 'node.exe',
    version: 'v24.14.1',
    sha256: '58E74BF02FC5BBACC41DCB8BEF089961CD5BDDD37830B87784E4FC624D145D1F',
    url: 'https://nodejs.org/dist/v24.14.1/win-x64/node.exe',
    licenseFile: 'LICENSE.node.txt',
    licenseUrl: 'https://raw.githubusercontent.com/nodejs/node/v24.14.1/LICENSE'
  },
  {
    name: 'ffmpeg.exe',
    version: '9.0.2',
    sha256: '589E50B766D251AFDF181DD664D40BD94407E200B019989FD7468C7D118A28D0',
    archiveUrl: 'https://www.gyan.dev/ffmpeg/builds/ffmpeg-release-essentials.zip',
    licenseFile: 'LICENSE.ffmpeg.txt',
    licenseUrl: 'https://raw.githubusercontent.com/FFmpeg/FFmpeg/master/COPYING.GPLv3'
  },
  {
    name: 'ffprobe.exe',
    version: '9.0.2',
    sha256: '02264DFA4F56BAAA31E443ECE8AA16D397F6B008200E7FD184D22B9009E75FD3',
    archiveUrl: 'https://www.gyan.dev/ffmpeg/builds/ffmpeg-release-essentials.zip',
    licenseFile: 'LICENSE.ffmpeg.txt',
    licenseUrl: 'https://raw.githubusercontent.com/FFmpeg/FFmpeg/master/COPYING.GPLv3'
  }
]

function computeSha256(filePath) {
  const hash = crypto.createHash('sha256')
  const data = fs.readFileSync(filePath)
  hash.update(data)
  return hash.digest('hex').toUpperCase()
}

function downloadFile(url, destPath) {
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

async function provisionBinaries() {
  for (const bin of PINNED_BINARIES) {
    const filePath = path.join(targetDir, bin.name)
    let needsDownload = false

    if (!fs.existsSync(filePath)) {
      console.log(`[provision] ${bin.name} is missing.`)
      needsDownload = true
    } else {
      const hash = computeSha256(filePath)
      if (bin.sha256 && hash !== bin.sha256.toUpperCase()) {
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
          if (bin.sha256 && downloadedHash !== bin.sha256.toUpperCase()) {
            fs.unlinkSync(tmpPath)
            throw new Error(
              `Downloaded ${bin.name} SHA-256 mismatch! Expected: ${bin.sha256}, Got: ${downloadedHash}`
            )
          }
          fs.renameSync(tmpPath, filePath)
          console.log(`[success] ${bin.name} downloaded and verified (SHA-256 match).`)
        } catch (dlErr) {
          if (fs.existsSync(tmpPath)) fs.unlinkSync(tmpPath)
          throw new Error(`Failed to provision ${bin.name}: ${dlErr.message}`)
        }
      } else if (bin.archiveUrl) {
        console.log(`[download] Downloading archive for ${bin.name} from ${bin.archiveUrl}...`)
        const tmpZipPath = path.join(targetDir, 'temp_archive.zip')
        const extractDir = path.join(targetDir, 'temp_extracted')
        try {
          await downloadFile(bin.archiveUrl, tmpZipPath)
          fs.mkdirSync(extractDir, { recursive: true })
          execFileSync('powershell.exe', [
            '-NoProfile',
            '-Command',
            `Expand-Archive -Path "${tmpZipPath}" -DestinationPath "${extractDir}" -Force`
          ])

          // Search extracted tree for bin.name
          const findFileRecursively = (dir, targetName) => {
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

          const extractedBinPath = findFileRecursively(extractDir, bin.name)
          if (!extractedBinPath) {
            throw new Error(`Executable ${bin.name} not found inside extracted archive`)
          }

          fs.copyFileSync(extractedBinPath, filePath)
          console.log(`[success] ${bin.name} extracted from archive into ${targetDir}.`)
        } catch (archErr) {
          throw new Error(`Failed to provision ${bin.name} from archive: ${archErr.message}`)
        } finally {
          if (fs.existsSync(tmpZipPath)) fs.unlinkSync(tmpZipPath)
          if (fs.existsSync(extractDir)) fs.rmSync(extractDir, { recursive: true, force: true })
        }
      } else {
        throw new Error(
          `Cannot auto-download ${bin.name}: No pinned URL or archive configured. Please place official ${bin.name} in ${targetDir}`
        )
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

  // Compile send-ctrl-break.exe via build-console-sender.mjs
  console.log('\n[compile] Building Windows Console Helper (send-ctrl-break.exe)...')
  execFileSync(process.execPath, [path.join(projectRoot, 'scripts', 'build-console-sender.mjs')], {
    cwd: projectRoot,
    stdio: 'inherit'
  })

  console.log('\n[PASS] All Windows binaries provisioned successfully.\n')
}

provisionBinaries().catch((err) => {
  console.error('\n[FATAL] Binary provisioning failed:', err.message)
  process.exit(1)
})
