import path from 'node:path'
import { mkdir, rm, lstat, readdir, rmdir, realpath, unlink } from 'node:fs/promises'

// Dedicated hidden subfolder for job-isolated partial and intermediate files
export const PARTIAL_DOWNLOADS_DIR_NAME = '.applan2-partial-downloads'

// Validate that a Download Job ID is a positive safe integer
function validateJobId(jobId) {
  if (!Number.isSafeInteger(jobId) || jobId <= 0) {
    throw new Error('A valid Download Job ID is required')
  }
}

// Validate that a download path is a valid non-empty absolute string
function validateDownloadPath(downloadPath) {
  if (typeof downloadPath !== 'string' || !downloadPath.trim()) {
    throw new Error('A valid download folder path is required')
  }
  if (!path.isAbsolute(downloadPath.trim())) {
    throw new Error('Download path must be an absolute filesystem path')
  }
}

// Resolve and safely validate the job-owned temporary workspace path
export function getJobTemporaryWorkspacePath(jobId, downloadPath) {
  validateJobId(jobId)
  validateDownloadPath(downloadPath)

  const normalizedDownloadPath = path.resolve(downloadPath.trim())
  const basePartialDir = path.resolve(normalizedDownloadPath, PARTIAL_DOWNLOADS_DIR_NAME)
  const jobTempDirName = `job-${jobId}`
  const jobTempDirPath = path.resolve(basePartialDir, jobTempDirName)

  // Guard against path traversal: ensure the job folder is strictly inside basePartialDir
  const relativeToBase = path.relative(basePartialDir, jobTempDirPath)

  if (
    !relativeToBase ||
    relativeToBase === '..' ||
    relativeToBase.startsWith(`..${path.sep}`) ||
    path.isAbsolute(relativeToBase)
  ) {
    throw new Error('Invalid temporary workspace path: path traversal detected')
  }

  // Also verify that basePartialDir is strictly inside normalizedDownloadPath
  const relativeToDownload = path.relative(normalizedDownloadPath, jobTempDirPath)

  if (
    !relativeToDownload ||
    relativeToDownload === '..' ||
    relativeToDownload.startsWith(`..${path.sep}`) ||
    path.isAbsolute(relativeToDownload)
  ) {
    throw new Error('Invalid temporary workspace path: workspace escapes download folder')
  }

  return jobTempDirPath
}

// Prepare the job-owned temporary directory before execution starts
export async function prepareJobTemporaryWorkspace(jobId, downloadPath) {
  const jobTempPath = getJobTemporaryWorkspacePath(jobId, downloadPath)
  const normalizedDownloadPath = path.resolve(downloadPath.trim())
  const basePartialDir = path.resolve(normalizedDownloadPath, PARTIAL_DOWNLOADS_DIR_NAME)
  const jobTempDirName = `job-${jobId}`

  // 1. Verify filesystem identity and reachability of download root
  let realDownload
  try {
    realDownload = await realpath(normalizedDownloadPath)
  } catch (downloadErr) {
    throw new Error(`Download folder does not exist or cannot be accessed: ${downloadErr.message}`)
  }

  // 2. Validate that basePartialDir (if already exists) is not an unsafe symlink or junction
  let realBase
  try {
    const baseStat = await lstat(basePartialDir)
    if (baseStat.isSymbolicLink()) {
      throw new Error('Unsafe temporary workspace parent: directory is a symbolic link or junction')
    }
    realBase = await realpath(basePartialDir)
    const relBase = path.relative(realDownload, realBase)
    if (
      !relBase ||
      relBase === '..' ||
      relBase.startsWith(`..${path.sep}`) ||
      path.isAbsolute(relBase)
    ) {
      throw new Error('Unsafe temporary workspace parent: escapes download folder')
    }
  } catch (err) {
    if (err.code === 'ENOENT') {
      // Base partial directory does not exist yet; create it safely
      await mkdir(basePartialDir, { recursive: true })
      const createdBaseStat = await lstat(basePartialDir)
      if (createdBaseStat.isSymbolicLink()) {
        throw new Error(
          'Unsafe temporary workspace parent: directory is a symbolic link or junction'
        )
      }
      realBase = await realpath(basePartialDir)
    } else {
      throw err
    }
  }

  // 3. Pre-creation check: inspect if job directory already exists before reuse
  let existingJobStat = null
  try {
    existingJobStat = await lstat(jobTempPath)
  } catch (statErr) {
    if (statErr.code !== 'ENOENT') {
      throw statErr
    }
  }

  if (existingJobStat) {
    // Reject symbolic links and Windows directory junctions immediately
    if (existingJobStat.isSymbolicLink()) {
      throw new Error('Unsafe temporary workspace: directory is a symbolic link or junction')
    }
    // Reject non-directory regular files with the job folder name
    if (!existingJobStat.isDirectory()) {
      throw new Error('Invalid temporary workspace: existing path is not a directory')
    }
    // Verify real canonical path of existing directory
    const realExistingJob = await realpath(jobTempPath)
    if (path.basename(realExistingJob) !== jobTempDirName) {
      throw new Error('Unsafe temporary workspace: directory name does not match job ID')
    }
    const relExisting = path.relative(realBase, realExistingJob)
    if (
      !relExisting ||
      relExisting === '..' ||
      relExisting.startsWith(`..${path.sep}`) ||
      path.isAbsolute(relExisting)
    ) {
      throw new Error('Unsafe temporary workspace: workspace escapes partial-downloads directory')
    }
  } else {
    // 4. Create directory non-recursively (or handle EEXIST race) to avoid following external symlinks
    try {
      await mkdir(jobTempPath)
    } catch (mkdirErr) {
      if (mkdirErr.code !== 'EEXIST') {
        throw mkdirErr
      }
    }
  }

  // 5. Post-creation verification: re-validate the resulting directory before returning
  const postStat = await lstat(jobTempPath)
  if (postStat.isSymbolicLink()) {
    throw new Error('Unsafe temporary workspace: directory is a symbolic link or junction')
  }
  if (!postStat.isDirectory()) {
    throw new Error('Invalid temporary workspace: resulting path is not a directory')
  }

  const finalRealJob = await realpath(jobTempPath)
  if (path.basename(finalRealJob) !== jobTempDirName) {
    throw new Error('Unsafe temporary workspace: directory name does not match job ID')
  }
  const finalRel = path.relative(realBase, finalRealJob)
  if (
    !finalRel ||
    finalRel === '..' ||
    finalRel.startsWith(`..${path.sep}`) ||
    path.isAbsolute(finalRel)
  ) {
    throw new Error('Unsafe temporary workspace: workspace escapes partial-downloads directory')
  }

  return jobTempPath
}

// Safely remove all job-owned temporary partial download artifacts:
// 1. Root-level job partial files in downloadPath matching [job-ID] and partial extensions (.part, .ytdl, .temp, .f<id>.part)
// 2. Job-owned temporary workspace directory in downloadPath/.applan2-partial-downloads/job-ID
// Strictly preserves completed media files (.mp4, .mp3, etc.) and files of other active/unrelated jobs.
export async function cleanupJobTemporaryFiles(jobId, downloadPath) {
  validateJobId(jobId)
  validateDownloadPath(downloadPath)

  let jobTempPath
  try {
    jobTempPath = getJobTemporaryWorkspacePath(jobId, downloadPath)
  } catch (validationError) {
    console.warn(`[cleanup] Path validation failed for job ${jobId}:`, validationError.message)
    return {
      success: false,
      cleaned: false,
      cleanedFiles: [],
      workspaceCleaned: false,
      error: validationError.message
    }
  }

  const normalizedDownloadPath = path.resolve(downloadPath.trim())
  const basePartialDir = path.resolve(normalizedDownloadPath, PARTIAL_DOWNLOADS_DIR_NAME)
  const expectedJobDirName = `job-${jobId}`
  const cleanedFiles = []
  let workspaceCleaned = false

  try {
    // 1. Verify filesystem identity of the download folder root
    let realDownloadPath
    try {
      realDownloadPath = await realpath(normalizedDownloadPath)
    } catch (pathErr) {
      return {
        success: false,
        cleaned: false,
        cleanedFiles: [],
        workspaceCleaned: false,
        error: `Download folder does not exist or cannot be accessed: ${pathErr.message}`
      }
    }

    // Fail-closed safety: ensure root download directory itself is not a symlink or junction
    let rootStat
    try {
      rootStat = await lstat(normalizedDownloadPath)
      if (rootStat.isSymbolicLink()) {
        console.warn(
          `[cleanup] Download directory is a symbolic link or junction. Rejecting cleanup for job ${jobId}.`
        )
        return {
          success: false,
          cleaned: false,
          cleanedFiles: [],
          workspaceCleaned: false,
          error: 'Unsafe download folder: root directory is a symbolic link or junction'
        }
      }
    } catch (statErr) {
      return {
        success: false,
        cleaned: false,
        cleanedFiles: [],
        workspaceCleaned: false,
        error: `Failed to inspect download folder: ${statErr.message}`
      }
    }

    // 2. Scan and clean root-level partial files belonging strictly to this job
    const jobMarker = `[job-${jobId}]`
    try {
      const entries = await readdir(realDownloadPath)
      for (const entry of entries) {
        // Must contain exact job marker
        if (!entry.includes(jobMarker)) {
          continue
        }

        // Must have a recognized partial download extension (never delete completed media files)
        const isPart =
          entry.endsWith('.part') ||
          entry.endsWith('.ytdl') ||
          /\.f\d+\.part$/i.test(entry) ||
          entry.endsWith('.temp')

        if (!isPart) {
          continue
        }

        const fullPath = path.join(realDownloadPath, entry)

        // Path traversal guard
        const relPath = path.relative(realDownloadPath, fullPath)
        if (
          !relPath ||
          relPath === '..' ||
          relPath.startsWith(`..${path.sep}`) ||
          path.isAbsolute(relPath)
        ) {
          console.warn(`[cleanup] Root partial file escapes download folder: ${fullPath}`)
          return {
            success: false,
            cleaned: cleanedFiles.length > 0,
            cleanedFiles,
            workspaceCleaned: false,
            error: 'Unsafe partial file: path escapes download folder boundary'
          }
        }

        let fileStat
        try {
          fileStat = await lstat(fullPath)
        } catch (statErr) {
          if (statErr.code === 'ENOENT') {
            continue // Already removed
          }
          return {
            success: false,
            cleaned: cleanedFiles.length > 0,
            cleanedFiles,
            workspaceCleaned: false,
            error: `Failed to inspect root partial file: ${statErr.message}`
          }
        }

        // Symlink / junction safety: FAIL CLOSED immediately
        if (fileStat.isSymbolicLink()) {
          console.warn(
            `[cleanup] Root partial file for job ${jobId} is a symbolic link or junction. Rejecting cleanup.`
          )
          return {
            success: false,
            cleaned: cleanedFiles.length > 0,
            cleanedFiles,
            workspaceCleaned: false,
            error: 'Unsafe partial file: symbolic link or junction detected'
          }
        }

        if (!fileStat.isFile()) {
          continue
        }

        // Canonical realpath containment check
        let realFilePath
        try {
          realFilePath = await realpath(fullPath)
        } catch (realErr) {
          return {
            success: false,
            cleaned: cleanedFiles.length > 0,
            cleanedFiles,
            workspaceCleaned: false,
            error: `Failed to resolve realpath for partial file: ${realErr.message}`
          }
        }

        if (!realFilePath.toLowerCase().startsWith(realDownloadPath.toLowerCase())) {
          console.warn(
            `[cleanup] Root partial file realpath escapes download folder: ${realFilePath}`
          )
          return {
            success: false,
            cleaned: cleanedFiles.length > 0,
            cleanedFiles,
            workspaceCleaned: false,
            error: 'Unsafe partial file: canonical path escapes download folder boundary'
          }
        }

        try {
          await unlink(fullPath)
          cleanedFiles.push(fullPath)
        } catch (delErr) {
          console.warn(`[cleanup] Failed to delete root partial file ${fullPath}:`, delErr.message)
          return {
            success: false,
            cleaned: cleanedFiles.length > 0,
            cleanedFiles,
            workspaceCleaned: false,
            error: `Failed to delete partial file: ${delErr.message}`
          }
        }
      }
    } catch (readErr) {
      if (readErr.code !== 'ENOENT') {
        return {
          success: false,
          cleaned: cleanedFiles.length > 0,
          cleanedFiles,
          workspaceCleaned: false,
          error: `Failed to read download directory: ${readErr.message}`
        }
      }
    }

    // 3. Verify and clean job-owned temporary workspace in .applan2-partial-downloads
    let baseStat
    try {
      baseStat = await lstat(basePartialDir)
    } catch (baseStatErr) {
      if (baseStatErr.code === 'ENOENT') {
        const cleaned = cleanedFiles.length > 0
        return {
          success: true,
          cleaned,
          cleanedFiles,
          workspaceCleaned: false,
          reason: cleaned ? undefined : 'directory_not_found',
          path: jobTempPath
        }
      }
      throw baseStatErr
    }

    if (baseStat.isSymbolicLink()) {
      console.warn(
        `[cleanup] Base partial directory is a symbolic link or junction. Rejecting cleanup for job ${jobId}.`
      )
      return {
        success: false,
        cleaned: cleanedFiles.length > 0,
        cleanedFiles,
        workspaceCleaned: false,
        error: 'Unsafe temporary parent: base partial directory is a symbolic link or junction'
      }
    }

    let realBasePartialDir
    try {
      realBasePartialDir = await realpath(basePartialDir)
    } catch (baseRealErr) {
      return {
        success: false,
        cleaned: cleanedFiles.length > 0,
        cleanedFiles,
        workspaceCleaned: false,
        error: `Failed to resolve realpath for base partial directory: ${baseRealErr.message}`
      }
    }

    const relBase = path.relative(realDownloadPath, realBasePartialDir)
    if (
      !relBase ||
      relBase === '..' ||
      relBase.startsWith(`..${path.sep}`) ||
      path.isAbsolute(relBase)
    ) {
      console.warn(
        `[cleanup] Base partial directory escapes download folder: ${realBasePartialDir}`
      )
      return {
        success: false,
        cleaned: cleanedFiles.length > 0,
        cleanedFiles,
        workspaceCleaned: false,
        error: 'Unsafe temporary parent: base directory escapes download folder boundary'
      }
    }

    let statInfo
    try {
      statInfo = await lstat(jobTempPath)
    } catch (statError) {
      if (statError.code === 'ENOENT') {
        const cleaned = cleanedFiles.length > 0
        return {
          success: true,
          cleaned,
          cleanedFiles,
          workspaceCleaned: false,
          reason: cleaned ? undefined : 'directory_not_found',
          path: jobTempPath
        }
      }
      throw statError
    }

    if (statInfo.isSymbolicLink()) {
      console.warn(
        `[cleanup] Workspace for job ${jobId} is a symbolic link or junction. Rejecting recursive deletion.`
      )
      return {
        success: false,
        cleaned: cleanedFiles.length > 0,
        cleanedFiles,
        workspaceCleaned: false,
        error: 'Unsafe workspace: symbolic link or junction detected'
      }
    }

    if (!statInfo.isDirectory()) {
      console.warn(`[cleanup] Workspace for job ${jobId} is not a directory.`)
      return {
        success: false,
        cleaned: cleanedFiles.length > 0,
        cleanedFiles,
        workspaceCleaned: false,
        error: 'Unsafe workspace: target is not a directory'
      }
    }

    let realJobTempPath
    try {
      realJobTempPath = await realpath(jobTempPath)
    } catch (jobRealErr) {
      return {
        success: false,
        cleaned: cleanedFiles.length > 0,
        cleanedFiles,
        workspaceCleaned: false,
        error: `Failed to resolve realpath for job workspace: ${jobRealErr.message}`
      }
    }

    const relJob = path.relative(realBasePartialDir, realJobTempPath)
    if (
      !relJob ||
      relJob === '..' ||
      relJob.startsWith(`..${path.sep}`) ||
      path.isAbsolute(relJob)
    ) {
      console.warn(`[cleanup] Job workspace escapes base partial directory: ${realJobTempPath}`)
      return {
        success: false,
        cleaned: cleanedFiles.length > 0,
        cleanedFiles,
        workspaceCleaned: false,
        error: 'Unsafe workspace: workspace escapes base partial directory'
      }
    }

    if (path.basename(realJobTempPath) !== expectedJobDirName) {
      console.warn(
        `[cleanup] Real workspace name ${path.basename(realJobTempPath)} does not match ${expectedJobDirName}`
      )
      return {
        success: false,
        cleaned: cleanedFiles.length > 0,
        cleanedFiles,
        workspaceCleaned: false,
        error: 'Unsafe workspace: directory name does not match job ID'
      }
    }

    if (realJobTempPath === realDownloadPath || realJobTempPath === realBasePartialDir) {
      return {
        success: false,
        cleaned: cleanedFiles.length > 0,
        cleanedFiles,
        workspaceCleaned: false,
        error: 'Unsafe workspace: target matches download root or partial directory root'
      }
    }

    const preDeleteStat = await lstat(jobTempPath)
    if (preDeleteStat.isSymbolicLink()) {
      console.warn(
        `[cleanup] Race condition detected: workspace became a symbolic link prior to deletion`
      )
      return {
        success: false,
        cleaned: cleanedFiles.length > 0,
        cleanedFiles,
        workspaceCleaned: false,
        error: 'Unsafe workspace: symlink detected immediately prior to deletion'
      }
    }

    await rm(jobTempPath, {
      recursive: true,
      force: true,
      maxRetries: 3,
      retryDelay: 200
    })
    workspaceCleaned = true

    // Prune base partial directory if empty
    try {
      const baseStatCheck = await lstat(basePartialDir)
      if (!baseStatCheck.isSymbolicLink()) {
        const remainingItems = await readdir(basePartialDir)
        if (remainingItems.length === 0) {
          await rmdir(basePartialDir)
        }
      }
    } catch {
      // Ignore
    }

    const cleaned = cleanedFiles.length > 0 || workspaceCleaned
    return {
      success: true,
      cleaned,
      cleanedFiles,
      workspaceCleaned,
      reason: cleaned ? undefined : 'directory_not_found',
      path: jobTempPath
    }
  } catch (cleanupError) {
    console.warn(
      `[cleanup] Failed to clean temporary files for job ${jobId}:`,
      cleanupError.message
    )
    return {
      success: false,
      cleaned: cleanedFiles.length > 0 || workspaceCleaned,
      cleanedFiles,
      workspaceCleaned,
      error: cleanupError.message
    }
  }
}

export async function cleanupStaleJobTemporaryFiles(jobId, downloadPath) {
  return await cleanupJobTemporaryFiles(jobId, downloadPath)
}

/**
 * Step 09 Section E / Corrective Validation - Centralized decision helper for partial download recovery.
 * Validates that the partial download verification result satisfies all recovery criteria:
 * - isValid === true (valid readable partial file(s) present)
 * - isConsistent === true (checkpoint byte count within documented tolerance)
 * - isUnsafe !== true (no symlinks, junctions, or traversal outside download workspace)
 * - reconciledBytes > 0 (verified non-zero actual byte count on disk)
 *
 * @param {object} partialResult
 * @returns {boolean}
 */
export function isPartialDownloadResumable(partialResult) {
  if (!partialResult || typeof partialResult !== 'object') {
    return false
  }
  return Boolean(
    partialResult.isValid === true &&
    partialResult.isConsistent === true &&
    partialResult.isUnsafe !== true &&
    typeof partialResult.reconciledBytes === 'number' &&
    partialResult.reconciledBytes > 0
  )
}

/**
 * Step 09.E / Step 09.A - Inspects and verifies partial download artifacts for an interrupted job.
 * Checks both the target download directory (for .part files) and the job-owned
 * temporary workspace for readable, non-empty, non-symlink partial file streams.
 *
 * Verifies consistency with SQLite byte checkpoints within a documented tolerance
 * (5 MB) to account for periodic checkpointing vs actual file growth.
 *
 * @param {number} jobId - Download job ID
 * @param {string} downloadPath - Base download folder
 * @param {object} [options={}]
 * @param {number} [options.savedDownloadedBytes] - Last saved byte count in SQLite
 * @param {number} [options.savedProgress] - Last saved progress percentage in SQLite
 * @returns {Promise<{ isValid: boolean, partialBytes: number, reconciledBytes: number, isConsistent: boolean, files: Array<{ path: string, size: number }> }>}
 */
export async function verifyJobPartialDownload(jobId, downloadPath, options = {}) {
  validateJobId(jobId)
  validateDownloadPath(downloadPath)

  const normalizedDownloadPath = path.resolve(downloadPath.trim())
  const validFiles = []
  let totalBytes = 0

  // 1. Check target downloadPath for yt-dlp .part files belonging to this job
  try {
    const entries = await readdir(normalizedDownloadPath)
    const jobMarker = `[job-${jobId}]`

    for (const entry of entries) {
      if (!entry.includes(jobMarker)) continue
      const isPart =
        entry.endsWith('.part') ||
        entry.endsWith('.ytdl') ||
        /\.f\d+\.part$/i.test(entry) ||
        entry.endsWith('.temp')

      if (isPart) {
        const fullPath = path.join(normalizedDownloadPath, entry)
        try {
          const fileStat = await lstat(fullPath)
          if (fileStat.isSymbolicLink()) {
            return {
              isValid: false,
              partialBytes: 0,
              reconciledBytes: 0,
              isConsistent: false,
              files: [],
              isUnsafe: true,
              isResumable: false
            }
          }
          // Ensure realpath stays inside download directory
          const realTarget = await realpath(fullPath)
          if (!realTarget.toLowerCase().startsWith(normalizedDownloadPath.toLowerCase())) {
            return {
              isValid: false,
              partialBytes: 0,
              reconciledBytes: 0,
              isConsistent: false,
              files: [],
              isUnsafe: true,
              isResumable: false
            }
          }
          if (fileStat.isFile() && fileStat.size > 0) {
            validFiles.push({ path: fullPath, size: fileStat.size })
            totalBytes += fileStat.size
          }
        } catch {
          // File may have been removed or locked
        }
      }
    }
  } catch {
    // Cannot read downloadPath
  }

  // 2. Check job-owned temporary workspace (.applan2-partial-downloads/job-ID)
  try {
    const jobTempPath = getJobTemporaryWorkspacePath(jobId, normalizedDownloadPath)
    const tempDirStat = await lstat(jobTempPath)

    if (tempDirStat.isSymbolicLink()) {
      return {
        isValid: false,
        partialBytes: 0,
        reconciledBytes: 0,
        isConsistent: false,
        files: [],
        isUnsafe: true,
        isResumable: false
      }
    }

    if (tempDirStat.isDirectory()) {
      const realTempDir = await realpath(jobTempPath)
      if (!realTempDir.toLowerCase().startsWith(normalizedDownloadPath.toLowerCase())) {
        return {
          isValid: false,
          partialBytes: 0,
          reconciledBytes: 0,
          isConsistent: false,
          files: [],
          isUnsafe: true,
          isResumable: false
        }
      }

      const tempEntries = await readdir(jobTempPath)
      for (const tempEntry of tempEntries) {
        const fullTempPath = path.join(jobTempPath, tempEntry)
        try {
          const fileStat = await lstat(fullTempPath)
          if (fileStat.isSymbolicLink()) {
            return {
              isValid: false,
              partialBytes: 0,
              reconciledBytes: 0,
              isConsistent: false,
              files: [],
              isUnsafe: true,
              isResumable: false
            }
          }
          const realFile = await realpath(fullTempPath)
          if (!realFile.toLowerCase().startsWith(normalizedDownloadPath.toLowerCase())) {
            return {
              isValid: false,
              partialBytes: 0,
              reconciledBytes: 0,
              isConsistent: false,
              files: [],
              isUnsafe: true,
              isResumable: false
            }
          }
          if (fileStat.isFile() && fileStat.size > 0) {
            validFiles.push({ path: fullTempPath, size: fileStat.size })
            totalBytes += fileStat.size
          }
        } catch {
          // Ignore
        }
      }
    }
  } catch {
    // Workspace does not exist or inaccessible
  }

  // 3. Documented tolerance for SQLite periodic byte checkpointing
  // SQLite updates byte records every 1MB or 1s, so disk file may be slightly ahead of DB.
  // We allow up to 5MB discrepancy if the disk file is smaller than saved DB value.
  const CHECKPOINT_TOLERANCE_BYTES = 5 * 1024 * 1024
  const savedBytes = Number(options?.savedDownloadedBytes) || 0
  const savedProgress = Number(options?.savedProgress) || 0
  let isConsistent = true

  if (savedBytes > 0) {
    if (totalBytes === 0 || totalBytes < savedBytes - CHECKPOINT_TOLERANCE_BYTES) {
      // Disk file is missing or severely smaller than saved checkpoint (e.g. truncated/corrupted)
      isConsistent = false
    }
  } else if (
    savedBytes === 0 &&
    savedProgress === 0 &&
    options?.savedDownloadedBytes !== undefined
  ) {
    // When SQLite explicitly records 0 saved bytes and 0 progress (e.g. fresh job or post-rejection reset),
    // any existing partial file on disk is an uncheckpointed stale artifact and cannot be safely resumed.
    if (totalBytes > 0) {
      isConsistent = false
    }
  }

  const isValid = validFiles.length > 0 && totalBytes > 0
  const isResumable = Boolean(isValid && isConsistent && totalBytes > 0)
  // Progress reconciliation: Reconcile persisted progress to verified actual file size on disk,
  // never fabricating bytes or reporting unverified checkpoint values.
  const reconciledBytes = isResumable ? totalBytes : 0

  return {
    isValid,
    partialBytes: totalBytes,
    reconciledBytes,
    isConsistent,
    isUnsafe: false,
    isResumable,
    files: validFiles
  }
}
