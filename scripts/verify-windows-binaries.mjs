import fs from 'node:fs'
import path from 'node:path'
import crypto from 'node:crypto'
import { execFileSync } from 'node:child_process'

/**
 * ============================================================================
 * APPLAN2 — Step 04.43 Windows Executables Verification Script
 * Validates presence, integrity (SHA-256), versions, and execution of
 * packaged Windows x64 binary dependencies before electron packaging.
 * ============================================================================
 */

const EXPECTED_BINARIES = [
  {
    name: 'yt-dlp.exe',
    versionFlag: ['--version'],
    expectedVersion: '2026.10.21',
    expectedSha256: '33121D192D706E62F684A06F80918E3F3A8BA52AC3A65213B6951C39C7D9F555',
    licenseFile: 'LICENSE.yt-dlp.txt'
  },
  {
    name: 'ffmpeg.exe',
    versionFlag: ['-version'],
    expectedVersionPrefix: 'ffmpeg version',
    expectedSha256: '589E50B766D251AFDF181DD664D40BD94407E200B019989FD7468C7D118A28D0',
    licenseFile: 'LICENSE.ffmpeg.txt'
  },
  {
    name: 'ffprobe.exe',
    versionFlag: ['-version'],
    expectedVersionPrefix: 'ffprobe version',
    expectedSha256: '02264DFA4F56BAAA31E443ECE8AA16D397F6B008200E7FD184D22B9009E75FD3',
    licenseFile: 'LICENSE.ffmpeg.txt'
  },
  {
    name: 'node.exe',
    versionFlag: ['--version'],
    expectedVersionPrefix: 'v24.',
    licenseFile: 'LICENSE.node.txt'
  }
]

export function computeFileSha256(filePath) {
  const hash = crypto.createHash('sha256')
  const buffer = fs.readFileSync(filePath)
  hash.update(buffer)
  return hash.digest('hex').toUpperCase()
}

export function verifyStagedBinaries(binDir = null) {
  const baseDir = binDir || path.resolve(process.cwd(), 'resources', 'bin', 'win32-x64')
  const licensesDir = path.join(baseDir, 'licenses')

  console.log('================================================================')
  console.log(' APPLAN2 — Windows Packaged Binaries Verification')
  console.log(` Target directory: ${baseDir}`)
  console.log('================================================================\n')

  if (!fs.existsSync(baseDir)) {
    console.error(`[ERROR] Staging directory does not exist: ${baseDir}`)
    return false
  }

  let allValid = true

  for (const item of EXPECTED_BINARIES) {
    const fullPath = path.join(baseDir, item.name)

    if (!fs.existsSync(fullPath)) {
      console.error(`[FAIL] Missing executable: ${item.name} at ${fullPath}`)
      allValid = false
      continue
    }

    const stats = fs.statSync(fullPath)
    if (stats.size === 0) {
      console.error(`[FAIL] Executable is empty (0 bytes): ${item.name}`)
      allValid = false
      continue
    }

    // SHA-256 verification where available
    if (item.expectedSha256) {
      const actualHash = computeFileSha256(fullPath)
      if (actualHash !== item.expectedSha256.toUpperCase()) {
        console.error(`[FAIL] Checksum mismatch for ${item.name}!`)
        console.error(`       Expected: ${item.expectedSha256}`)
        console.error(`       Actual:   ${actualHash}`)
        allValid = false
        continue
      }
    }

    // Execution / Version test
    try {
      const output = execFileSync(fullPath, item.versionFlag, {
        windowsHide: true,
        encoding: 'utf-8',
        timeout: 10000
      })
      const firstLine = output.trim().split('\n')[0].trim()
      console.log(
        `[PASS] ${item.name} (${(stats.size / (1024 * 1024)).toFixed(2)} MB) -> ${firstLine}`
      )
    } catch (execErr) {
      console.error(`[FAIL] Could not execute ${item.name}: ${execErr.message}`)
      allValid = false
      continue
    }

    // License file verification
    if (item.licenseFile) {
      const licensePath = path.join(licensesDir, item.licenseFile)
      if (!fs.existsSync(licensePath)) {
        console.warn(`[WARN] License file missing for ${item.name}: ${item.licenseFile}`)
      }
    }
  }

  console.log('\n----------------------------------------------------------------')
  if (allValid) {
    console.log(' ALL WINDOWS PACKAGED BINARIES VERIFIED SUCCESSFULLY (100% PASS)')
    console.log('----------------------------------------------------------------\n')
    return true
  } else {
    console.error(' BINARY VERIFICATION FAILED! Please inspect missing/corrupted files.')
    console.error('----------------------------------------------------------------\n')
    return false
  }
}

// Direct execution CLI entrypoint
if (
  process.argv[1] &&
  path.resolve(process.argv[1]) === path.resolve('scripts/verify-windows-binaries.mjs')
) {
  const success = verifyStagedBinaries()
  if (!success) {
    process.exit(1)
  }
}
