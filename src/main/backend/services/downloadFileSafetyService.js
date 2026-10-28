import path from 'node:path'
import { stat, lstat, realpath, access, open, unlink, readdir, constants } from 'node:fs/promises'
import { statfs } from 'node:fs/promises'
import { DownloadError, DOWNLOAD_ERROR_CODES } from './downloadErrorService.js'

// Windows reserved device names
const WINDOWS_RESERVED_NAMES = new Set([
  'CON',
  'PRN',
  'AUX',
  'NUL',
  'COM1',
  'COM2',
  'COM3',
  'COM4',
  'COM5',
  'COM6',
  'COM7',
  'COM8',
  'COM9',
  'LPT1',
  'LPT2',
  'LPT3',
  'LPT4',
  'LPT5',
  'LPT6',
  'LPT7',
  'LPT8',
  'LPT9'
])

/**
 * Validates that a download folder path is well-formed, absolute, not a drive root,
 * exists on disk, is a directory, and does not pose unsafe symlink/traversal risks.
 *
 * @param {string} folderPath - Path to validate
 * @returns {Promise<string>} Normalized absolute folder path
 */
export async function validateDownloadFolder(folderPath) {
  if (typeof folderPath !== 'string' || !folderPath.trim() || folderPath.includes('\0')) {
    throw new Error('A valid download folder path is required')
  }

  const trimmed = folderPath.trim()

  if (!path.isAbsolute(trimmed)) {
    throw new Error('Download path must be an absolute filesystem path')
  }

  const cleanPath = path.resolve(trimmed)

  // Windows illegal path characters in directory paths (excluding drive colon like C:)
  const pathWithoutDrive = cleanPath.replace(/^[a-zA-Z]:/, '')
  if (/[<>"|?*]/.test(pathWithoutDrive)) {
    throw new Error('The specified download path contains invalid characters')
  }

  // Check if target is a drive root (e.g., C:\, D:\, /)
  const parsed = path.parse(cleanPath)
  const isDriveRoot =
    cleanPath.toLowerCase() === parsed.root.toLowerCase() ||
    cleanPath.replace(/[\\/]+$/, '').toLowerCase() ===
      parsed.root.replace(/[\\/]+$/, '').toLowerCase()

  if (isDriveRoot) {
    throw new Error('Root drive directories cannot be used as the download folder')
  }

  // Check existence and filesystem properties
  let statInfo
  try {
    statInfo = await stat(cleanPath)
  } catch (fsError) {
    if (fsError.code === 'ENOENT') {
      throw new Error('The specified download directory does not exist')
    } else if (['EACCES', 'EPERM'].includes(fsError.code)) {
      throw new Error('The application does not have permission to access or write to this folder')
    } else {
      throw new Error('The specified download path is invalid or inaccessible')
    }
  }

  if (!statInfo.isDirectory()) {
    throw new Error('Download path must be an existing directory, not a file')
  }

  // Symlink safety: check lstat to see if it's a symlink or junction
  try {
    const lstatInfo = await lstat(cleanPath)
    if (lstatInfo.isSymbolicLink()) {
      // Resolve real path and verify that the target is also not a drive root and is a directory
      const realDir = await realpath(cleanPath)
      const realParsed = path.parse(realDir)
      const realIsDriveRoot =
        realDir.toLowerCase() === realParsed.root.toLowerCase() ||
        realDir.replace(/[\\/]+$/, '').toLowerCase() ===
          realParsed.root.replace(/[\\/]+$/, '').toLowerCase()

      if (realIsDriveRoot) {
        throw new Error(
          'Symbolic link targets a root drive directory, which cannot be used as the download folder'
        )
      }

      const realStat = await stat(realDir)
      if (!realStat.isDirectory()) {
        throw new Error('Symbolic link target is not a directory')
      }
    }
  } catch (symlinkError) {
    if (symlinkError.code === 'ENOENT') {
      throw new Error('The specified download directory does not exist')
    }
    throw symlinkError
  }

  return cleanPath
}

/**
 * Verifies that the download directory is readable and writable by performing
 * both access permission checks and an exclusive temporary write probe.
 *
 * @param {string} folderPath - Path to verify
 * @returns {Promise<boolean>} True if writable, throws otherwise
 */
export async function verifyDownloadFolderWritable(folderPath) {
  const cleanPath = await validateDownloadFolder(folderPath)

  // 1. Preliminary access check for read/write capability
  try {
    await access(cleanPath, constants.R_OK | constants.W_OK)
  } catch (accessErr) {
    if (['EACCES', 'EPERM', 'EROFS'].includes(accessErr.code)) {
      throw new DownloadError(
        DOWNLOAD_ERROR_CODES.PERMISSION_DENIED,
        'The application does not have permission to access or write to this folder',
        { cause: accessErr }
      )
    }
    throw accessErr
  }

  // 2. Perform safe, temporary write probe with exclusive creation flag ('wx')
  const randomSuffix = Math.random().toString(36).slice(2, 10)
  const probeName = `.applan2-probe-${Date.now()}-${randomSuffix}.tmp`
  const probePath = path.join(cleanPath, probeName)

  let fileHandle = null
  try {
    fileHandle = await open(probePath, 'wx')
  } catch (probeError) {
    if (['EACCES', 'EPERM', 'EROFS'].includes(probeError.code)) {
      throw new DownloadError(
        DOWNLOAD_ERROR_CODES.PERMISSION_DENIED,
        'The application cannot write to the selected download folder.',
        { cause: probeError }
      )
    }
    throw new DownloadError(
      DOWNLOAD_ERROR_CODES.PERMISSION_DENIED,
      `Cannot write to folder: ${probeError.message}`,
      { cause: probeError }
    )
  } finally {
    if (fileHandle) {
      try {
        await fileHandle.close()
      } catch (closeErr) {
        console.warn('[safety] Warning closing probe file handle:', closeErr.message)
      }
    }
    try {
      await unlink(probePath)
    } catch {
      // Ignore cleanup error if probe file was not created or already unlinked
    }
  }

  return true
}

/**
 * Checks available disk space for the download destination using statfs.
 * Compares against estimated required bytes if available.
 *
 * @param {object} params
 * @param {string} params.downloadPath - Target directory path
 * @param {number|null} [params.estimatedRequiredBytes=null] - Estimated space needed in bytes
 * @returns {Promise<{
 *   sufficient: boolean,
 *   availableBytes: number|null,
 *   estimatedRequiredBytes: number|null,
 *   supported: boolean,
 *   verified: boolean
 * }>}
 */
export async function checkDownloadDiskSpace({ downloadPath, estimatedRequiredBytes = null }) {
  if (typeof downloadPath !== 'string' || !downloadPath.trim()) {
    throw new Error('A valid download folder path is required')
  }

  const cleanPath = path.resolve(downloadPath.trim())

  let availableBytes = null
  let isStatfsSupported = false

  try {
    if (typeof statfs === 'function') {
      const stats = await statfs(cleanPath)
      if (stats && typeof stats.bavail === 'number' && typeof stats.bsize === 'number') {
        availableBytes = stats.bavail * stats.bsize
        isStatfsSupported = true
      } else if (stats && typeof stats.bfree === 'number' && typeof stats.bsize === 'number') {
        availableBytes = stats.bfree * stats.bsize
        isStatfsSupported = true
      }
    }
  } catch {
    // statfs failed (e.g. unsupported filesystem or virtual share)
    isStatfsSupported = false
    availableBytes = null
  }

  const hasReliableEstimate =
    typeof estimatedRequiredBytes === 'number' &&
    Number.isFinite(estimatedRequiredBytes) &&
    estimatedRequiredBytes > 0

  // When disk space detection is unsupported or unavailable
  if (!isStatfsSupported || availableBytes === null) {
    return {
      sufficient: true,
      availableBytes: null,
      estimatedRequiredBytes: hasReliableEstimate ? estimatedRequiredBytes : null,
      supported: false,
      verified: false
    }
  }

  // When download file size cannot be reliably estimated prior to download
  if (!hasReliableEstimate) {
    return {
      sufficient: true,
      availableBytes,
      estimatedRequiredBytes: null,
      supported: true,
      verified: false
    }
  }

  // Reliable estimate and available disk space are both known
  const isSufficient = availableBytes >= estimatedRequiredBytes

  return {
    sufficient: isSufficient,
    availableBytes,
    estimatedRequiredBytes,
    supported: true,
    verified: true
  }
}

/**
 * Ensures childPath is strictly contained inside parentDir and does not traverse outside.
 *
 * @param {string} childPath
 * @param {string} parentDir
 * @throws {DownloadError} if traversal detected
 */
export function assertPathInsideDirectory(childPath, parentDir) {
  if (typeof childPath !== 'string' || typeof parentDir !== 'string') {
    throw new DownloadError(
      DOWNLOAD_ERROR_CODES.OUTPUT_VERIFICATION_FAILED,
      'Invalid path verification arguments'
    )
  }

  const normalizedParent = path.resolve(parentDir.trim())
  const normalizedChild = path.resolve(childPath.trim())

  const relative = path.relative(normalizedParent, normalizedChild)

  if (
    !relative ||
    relative === '..' ||
    relative.startsWith(`..${path.sep}`) ||
    path.isAbsolute(relative)
  ) {
    throw new DownloadError(
      DOWNLOAD_ERROR_CODES.OUTPUT_VERIFICATION_FAILED,
      'Path traversal detected: output file is outside download directory'
    )
  }
}

/**
 * Checks if a pre-existing output file matching the job ID already exists in the download folder.
 *
 * @param {string} downloadPath - Target directory
 * @param {number} jobId - Download job ID
 * @throws {DownloadError} if a conflicting file already exists
 */
export async function assertNoJobOutputFileConflict(downloadPath, jobId) {
  if (!Number.isSafeInteger(jobId) || jobId <= 0) {
    throw new Error('A valid Download Job ID is required')
  }

  const cleanPath = path.resolve(downloadPath.trim())
  let entries
  try {
    entries = await readdir(cleanPath)
  } catch {
    // If directory cannot be read, directory validation will catch it
    return
  }

  const jobMarker = `[job-${jobId}]`
  const conflict = entries.find((name) => name.includes(jobMarker))

  if (conflict) {
    throw new DownloadError(
      DOWNLOAD_ERROR_CODES.OUTPUT_VERIFICATION_FAILED,
      `Destination file conflict: An existing file for job ${jobId} already exists in the download folder.`
    )
  }
}

/**
 * Checks if a filename (without extension or path) is a Windows reserved device name.
 *
 * @param {string} filename
 * @returns {boolean}
 */
export function isWindowsReservedFilename(filename) {
  if (typeof filename !== 'string') return false
  const base = path.parse(filename).name.toUpperCase()
  return WINDOWS_RESERVED_NAMES.has(base)
}

/**
 * Validates and sanitizes a filename for Windows filesystem safety while preserving Unicode.
 *
 * @param {string} filename
 * @returns {string} Sanitized filename
 */
export function sanitizeWindowsFilename(filename) {
  if (typeof filename !== 'string') return ''
  // Replace invalid Windows characters: < > : " / \ | ? *
  let clean = filename.replace(/[<>:"/\\|?*]/g, '_')
  // Strip ASCII control characters 0-31 safely without regex control characters
  clean = Array.from(clean)
    .map((ch) => (ch.charCodeAt(0) < 32 ? '_' : ch))
    .join('')
  // Trim trailing spaces and dots (invalid on Windows filesystems)
  clean = clean.replace(/[. ]+$/, '')
  // If reserved name, prepend underscore
  if (isWindowsReservedFilename(clean)) {
    clean = `_${clean}`
  }
  return clean
}
