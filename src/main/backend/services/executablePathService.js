import fs from 'node:fs'
import path from 'node:path'
import { app } from 'electron'
import { DownloadError, DOWNLOAD_ERROR_CODES } from './downloadErrorService.js'

/**
 * ============================================================================
 * APPLAN2 — Step 04.43 Centralized Executable Path Resolver Service
 *
 * Responsibilities:
 * - Dynamically resolves absolute executable paths for yt-dlp, FFmpeg, FFprobe,
 *   and JavaScript runtime (node.exe) in packaged Windows Electron application.
 * - In Development Mode: Uses project-staged resources or falls back safely to
 *   standard environment PATH commands.
 * - In Packaged Mode: Strictly locates bundled executables under process.resourcesPath.
 * - Enforces zero silent fallback to untrusted global executables in production.
 * ============================================================================
 */

// Test override state for unit & packaging test isolation
let testPackagedMode = null
let testCustomBinDir = null

/**
 * Sets explicit packaged mode flag for automated test suites.
 * Pass null to restore default Electron app.isPackaged detection.
 *
 * @param {boolean|null} mode
 */
export function setPackagedModeForTest(mode) {
  testPackagedMode = mode
}

/**
 * Sets custom binary staging directory for automated test suites.
 * Pass null to restore standard lookup paths.
 *
 * @param {string|null} dir
 */
export function setCustomBinDirectoryForTest(dir) {
  testCustomBinDir = dir
}

/**
 * Determines whether the current process is running as a packaged Electron application.
 * Uses Electron app.isPackaged as the authoritative indicator.
 *
 * @returns {boolean}
 */
export function isPackagedApp() {
  if (testPackagedMode !== null) {
    return Boolean(testPackagedMode)
  }

  try {
    if (typeof app?.isPackaged === 'boolean') {
      return app.isPackaged
    }
  } catch {
    // Non-electron environment fallback (e.g. CLI tests)
  }

  return false
}

/**
 * Resolves the root workspace directory for development staging lookups.
 *
 * @returns {string}
 */
function getProjectRoot() {
  try {
    if (typeof app?.getAppPath === 'function') {
      return app.getAppPath()
    }
  } catch {
    // Non-electron environment fallback
  }

  return process.cwd()
}

/**
 * Resolves the directory containing Windows packaged executables.
 *
 * Packaged Mode layout:
 *   process.resourcesPath/bin/win32-x64/
 *   (or process.resourcesPath/bin/ as fallback)
 *
 * Development Mode layout:
 *   <projectRoot>/resources/bin/win32-x64/
 *
 * @returns {string}
 */
export function getPackagedBinaryDirectory() {
  if (testCustomBinDir) {
    return testCustomBinDir
  }

  if (isPackagedApp()) {
    const resourcesDir = process.resourcesPath || path.join(getProjectRoot(), 'resources')
    const win64Dir = path.join(resourcesDir, 'bin', 'win32-x64')

    if (fs.existsSync(win64Dir)) {
      return win64Dir
    }

    const flatBinDir = path.join(resourcesDir, 'bin')
    if (fs.existsSync(flatBinDir)) {
      return flatBinDir
    }

    return win64Dir
  }

  // Development mode: check project resources folder
  return path.join(getProjectRoot(), 'resources', 'bin', 'win32-x64')
}

/**
 * Resolves the absolute path to the yt-dlp executable.
 *
 * @returns {Promise<string>}
 */
export async function resolveYtDlpPath() {
  const binDir = getPackagedBinaryDirectory()
  const candidatePath = path.join(binDir, 'yt-dlp.exe')

  if (fs.existsSync(candidatePath)) {
    return candidatePath
  }

  if (isPackagedApp()) {
    throw new DownloadError(
      DOWNLOAD_ERROR_CODES.YT_DLP_NOT_FOUND,
      'Packaged yt-dlp executable was not found. Please reinstall the application.',
      { details: { expectedPath: candidatePath } }
    )
  }

  // Development mode fallback to PATH command
  return 'yt-dlp'
}

/**
 * Resolves the absolute path to the ffmpeg executable.
 *
 * @returns {Promise<string>}
 */
export async function resolveFFmpegPath() {
  const binDir = getPackagedBinaryDirectory()
  const candidatePath = path.join(binDir, 'ffmpeg.exe')

  if (fs.existsSync(candidatePath)) {
    return candidatePath
  }

  if (isPackagedApp()) {
    throw new DownloadError(
      DOWNLOAD_ERROR_CODES.FFMPEG_NOT_FOUND,
      'Packaged FFmpeg executable was not found. Please reinstall the application.',
      { details: { expectedPath: candidatePath } }
    )
  }

  // Development mode fallback to PATH command
  return 'ffmpeg'
}

/**
 * Resolves the absolute path to the ffprobe executable.
 *
 * @returns {Promise<string>}
 */
export async function resolveFFprobePath() {
  const binDir = getPackagedBinaryDirectory()
  const candidatePath = path.join(binDir, 'ffprobe.exe')

  if (fs.existsSync(candidatePath)) {
    return candidatePath
  }

  if (isPackagedApp()) {
    throw new DownloadError(
      DOWNLOAD_ERROR_CODES.FFPROBE_NOT_FOUND,
      'Packaged FFprobe executable was not found. Please reinstall the application.',
      { details: { expectedPath: candidatePath } }
    )
  }

  // Development mode fallback to PATH command
  return 'ffprobe'
}

/**
 * Resolves the directory path passed to yt-dlp via `--ffmpeg-location`.
 * yt-dlp searches this directory for both ffmpeg.exe and ffprobe.exe.
 *
 * @returns {Promise<string|null>}
 */
export async function resolveFFmpegLocationDirectory() {
  const binDir = getPackagedBinaryDirectory()
  const ffmpegPath = path.join(binDir, 'ffmpeg.exe')

  if (fs.existsSync(ffmpegPath)) {
    return binDir
  }

  if (isPackagedApp()) {
    throw new DownloadError(
      DOWNLOAD_ERROR_CODES.FFMPEG_NOT_FOUND,
      'Packaged FFmpeg directory was not found. Please reinstall the application.',
      { details: { expectedDirectory: binDir } }
    )
  }

  // In development, return null to let yt-dlp search system PATH
  return null
}

/**
 * Resolves the bundled JavaScript runtime executable (node.exe) when packaged.
 *
 * @returns {Promise<string|null>}
 */
export async function resolveJavaScriptRuntimePath() {
  const binDir = getPackagedBinaryDirectory()
  const candidatePath = path.join(binDir, 'node.exe')

  if (fs.existsSync(candidatePath)) {
    return candidatePath
  }

  if (isPackagedApp()) {
    // Packaged mode requires verified bundled runtime
    return null
  }

  // Development mode returns system node
  return 'node'
}

/**
 * Resolves the formatted `--js-runtimes` option value for yt-dlp.
 * Syntax:
 * - With explicit runtime path: `node:<absolute-path>`
 * - With default system PATH: `node`
 *
 * @returns {Promise<string>}
 */
export async function resolveJavaScriptRuntimeOption() {
  const runtimePath = await resolveJavaScriptRuntimePath()

  if (runtimePath && runtimePath !== 'node' && path.isAbsolute(runtimePath)) {
    return `node:${runtimePath}`
  }

  return 'node'
}
