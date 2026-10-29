import path from 'node:path'
import { mkdir, rm, lstat, readdir, rmdir, realpath } from 'node:fs/promises'

// Dedicated hidden subfolder for job-isolated partial and intermediate files
export const PARTIAL_DOWNLOADS_DIR_NAME = '.applan2-partial-downloads'

// Validate that a Download Job ID is a positive safe integer
function validateJobId(jobId) {
  if (!Number.isSafeInteger(jobId) || jobId <= 0) {
    throw new Error('A valid Download Job ID is required')
  }
}

// Validate that a download path is a valid non-empty string
function validateDownloadPath(downloadPath) {
  if (typeof downloadPath !== 'string' || !downloadPath.trim()) {
    throw new Error('A valid download folder path is required')
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

// Safely remove only the job-owned temporary workspace directory and its fragments
export async function cleanupJobTemporaryFiles(jobId, downloadPath) {
  let jobTempPath

  try {
    jobTempPath = getJobTemporaryWorkspacePath(jobId, downloadPath)
  } catch (validationError) {
    console.warn(`[cleanup] Path validation failed for job ${jobId}:`, validationError.message)
    return {
      success: false,
      cleaned: false,
      error: validationError.message
    }
  }

  const normalizedDownloadPath = path.resolve(downloadPath.trim())
  const basePartialDir = path.resolve(normalizedDownloadPath, PARTIAL_DOWNLOADS_DIR_NAME)
  const expectedJobDirName = `job-${jobId}`

  try {
    // 1. Verify filesystem identity of the download folder root
    let realDownloadPath
    try {
      realDownloadPath = await realpath(normalizedDownloadPath)
    } catch (pathErr) {
      return {
        success: false,
        cleaned: false,
        error: `Download folder does not exist or cannot be accessed: ${pathErr.message}`
      }
    }

    // 2. Verify filesystem identity of the base partial downloads directory
    let baseStat
    try {
      baseStat = await lstat(basePartialDir)
    } catch (baseStatErr) {
      if (baseStatErr.code === 'ENOENT') {
        return {
          success: true,
          cleaned: false,
          reason: 'directory_not_found'
        }
      }
      throw baseStatErr
    }

    // Symbolic link safety: If base partial directory is a symlink or junction, FAIL CLOSED immediately
    if (baseStat.isSymbolicLink()) {
      console.warn(
        `[cleanup] Base partial directory is a symbolic link or junction. Rejecting cleanup for job ${jobId}.`
      )
      return {
        success: false,
        cleaned: false,
        error: 'Unsafe temporary parent: base partial directory is a symbolic link or junction'
      }
    }

    // Canonical realpath containment check for base partial directory
    let realBasePartialDir
    try {
      realBasePartialDir = await realpath(basePartialDir)
    } catch (baseRealErr) {
      return {
        success: false,
        cleaned: false,
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
        cleaned: false,
        error: 'Unsafe temporary parent: base directory escapes download folder boundary'
      }
    }

    // 3. Verify filesystem identity of the job temporary workspace
    let statInfo
    try {
      statInfo = await lstat(jobTempPath)
    } catch (statError) {
      if (statError.code === 'ENOENT') {
        return {
          success: true,
          cleaned: false,
          reason: 'directory_not_found'
        }
      }
      throw statError
    }

    // Symbolic link safety: If the job workspace is a symlink or junction, do NOT recursively delete
    if (statInfo.isSymbolicLink()) {
      console.warn(
        `[cleanup] Workspace for job ${jobId} is a symbolic link or junction. Rejecting recursive deletion.`
      )
      return {
        success: false,
        cleaned: false,
        error: 'Unsafe workspace: symbolic link or junction detected'
      }
    }

    // Must be a directory
    if (!statInfo.isDirectory()) {
      console.warn(`[cleanup] Workspace for job ${jobId} is not a directory.`)
      return {
        success: false,
        cleaned: false,
        error: 'Unsafe workspace: target is not a directory'
      }
    }

    // Canonical realpath containment check for job workspace
    let realJobTempPath
    try {
      realJobTempPath = await realpath(jobTempPath)
    } catch (jobRealErr) {
      return {
        success: false,
        cleaned: false,
        error: `Failed to resolve realpath for job workspace: ${jobRealErr.message}`
      }
    }

    // Ensure realJobTempPath is strictly inside realBasePartialDir
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
        cleaned: false,
        error: 'Unsafe workspace: workspace escapes base partial directory'
      }
    }

    // Verify directory basename matches expected job dir name
    if (path.basename(realJobTempPath) !== expectedJobDirName) {
      console.warn(
        `[cleanup] Real workspace name ${path.basename(realJobTempPath)} does not match ${expectedJobDirName}`
      )
      return {
        success: false,
        cleaned: false,
        error: 'Unsafe workspace: directory name does not match job ID'
      }
    }

    // Guard: Never delete download root or base partial directory
    if (realJobTempPath === realDownloadPath || realJobTempPath === realBasePartialDir) {
      return {
        success: false,
        cleaned: false,
        error: 'Unsafe workspace: target matches download root or partial directory root'
      }
    }

    // Re-verify filesystem state immediately prior to recursive deletion
    const preDeleteStat = await lstat(jobTempPath)
    if (preDeleteStat.isSymbolicLink()) {
      console.warn(
        `[cleanup] Race condition detected: workspace became a symbolic link prior to deletion`
      )
      return {
        success: false,
        cleaned: false,
        error: 'Unsafe workspace: symlink detected immediately prior to deletion'
      }
    }

    // Recursively delete the job-owned temporary workspace
    await rm(jobTempPath, {
      recursive: true,
      force: true,
      maxRetries: 3,
      retryDelay: 200
    })

    // Optionally prune the parent partial directory if completely empty and not a symlink
    try {
      const baseStatCheck = await lstat(basePartialDir)
      if (!baseStatCheck.isSymbolicLink()) {
        const remainingItems = await readdir(basePartialDir)
        if (remainingItems.length === 0) {
          await rmdir(basePartialDir)
        }
      }
    } catch {
      // Ignore if base directory is locked or contains other active jobs
    }

    return {
      success: true,
      cleaned: true,
      path: jobTempPath
    }
  } catch (cleanupError) {
    console.warn(
      `[cleanup] Failed to clean temporary workspace for job ${jobId}:`,
      cleanupError.message
    )
    return {
      success: false,
      cleaned: false,
      error: cleanupError.message
    }
  }
}

// Startup recovery helper to safely clean up leftover temporary directories for stale jobs
export async function cleanupStaleJobTemporaryFiles(jobId, downloadPath) {
  return await cleanupJobTemporaryFiles(jobId, downloadPath)
}
