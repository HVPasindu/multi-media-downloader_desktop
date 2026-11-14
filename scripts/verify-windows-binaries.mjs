import fs from 'node:fs'
import path from 'node:path'
import crypto from 'node:crypto'
import { execFileSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { WINDOWS_BINARIES_MANIFEST } from './windows-binaries-manifest.mjs'

/**
 * ============================================================================
 * APPLAN2 — Step 04.43 Windows Executables Verification Script
 * Validates presence, integrity (SHA-256), versions, and execution of
 * packaged Windows x64 binary dependencies before electron packaging.
 * Uses authoritative manifest from windows-binaries-manifest.mjs.
 * ============================================================================
 */

export const EXPECTED_BINARIES = WINDOWS_BINARIES_MANIFEST.binaries

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

    // Execution verification
    try {
      const out = execFileSync(fullPath, item.versionFlag, {
        encoding: 'utf8',
        windowsHide: true,
        timeout: 5000
      })

      const trimmedOut = out.trim()
      let versionMatches = false

      if (item.expectedVersion && trimmedOut.includes(item.expectedVersion)) {
        versionMatches = true
      } else if (item.expectedVersionPrefix && trimmedOut.startsWith(item.expectedVersionPrefix)) {
        versionMatches = true
      } else if (!item.expectedVersion && !item.expectedVersionPrefix) {
        versionMatches = true
      }

      if (!versionMatches) {
        console.error(
          `[FAIL] Version check mismatch for ${item.name}!\n` +
            `       Expected: ${item.expectedVersion || item.expectedVersionPrefix}\n` +
            `       Output:   ${trimmedOut.split('\n')[0]}`
        )
        allValid = false
        continue
      }

      console.log(
        `[PASS] ${item.name} (${stats.size.toLocaleString()} bytes) — ` +
          `Version: ${trimmedOut.split('\n')[0]}` +
          (item.expectedSha256 ? ` — SHA-256: ${item.expectedSha256.slice(0, 12)}... [MATCH]` : '')
      )
    } catch (execErr) {
      console.error(`[FAIL] Failed to execute ${item.name}: ${execErr.message}`)
      allValid = false
      continue
    }

    // Verify corresponding license file if required
    if (item.licenseFile) {
      const licensePath = path.join(licensesDir, item.licenseFile)
      if (!fs.existsSync(licensePath)) {
        console.warn(`[WARN] License file missing for ${item.name}: ${item.licenseFile}`)
      }
    }
  }

  // Cross-check ConsoleSender identity between resources and backend bin
  const resourcesHelper = path.join(baseDir, 'send-ctrl-break.exe')
  const backendHelper = path.resolve(
    process.cwd(),
    'src',
    'main',
    'backend',
    'bin',
    'send-ctrl-break.exe'
  )
  if (fs.existsSync(resourcesHelper) && fs.existsSync(backendHelper)) {
    const hash1 = computeFileSha256(resourcesHelper)
    const hash2 = computeFileSha256(backendHelper)
    if (hash1 !== hash2) {
      console.error('[FAIL] send-ctrl-break.exe in resources and backend bin are NOT identical!')
      allValid = false
    } else {
      console.log(
        `[PASS] send-ctrl-break.exe copies are identical (SHA-256: ${hash1.slice(0, 12)}...).`
      )
    }
  }

  console.log('\n================================================================')
  if (allValid) {
    console.log(' ALL WINDOWS PACKAGED BINARIES VERIFIED SUCCESSFULLY')
    console.log(' Ready for electron-builder packaging.')
  } else {
    console.error(' BINARY VERIFICATION FAILED: Fix above errors before packaging.')
  }
  console.log('================================================================\n')

  return allValid
}

// Auto-run when invoked directly from CLI
if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  const success = verifyStagedBinaries()
  process.exit(success ? 0 : 1)
}
