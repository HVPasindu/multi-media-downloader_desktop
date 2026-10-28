import path from 'node:path'
import { mkdir, rm, lstat, unlink, readdir, rmdir } from 'node:fs/promises'

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

  await mkdir(jobTempPath, { recursive: true })

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

  try {
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

    // Symbolic link safety: if the directory is a symlink or junction, remove the link without traversing
    if (statInfo.isSymbolicLink()) {
      console.warn(`[cleanup] Workspace for job ${jobId} is a symbolic link. Removing link only.`)
      await unlink(jobTempPath)
      return {
        success: true,
        cleaned: true,
        isSymlink: true
      }
    }

    // Recursively delete the job-owned temporary workspace
    await rm(jobTempPath, {
      recursive: true,
      force: true,
      maxRetries: 3,
      retryDelay: 200
    })

    // Optionally prune the parent partial directory if completely empty
    const normalizedDownloadPath = path.resolve(downloadPath.trim())
    const basePartialDir = path.resolve(normalizedDownloadPath, PARTIAL_DOWNLOADS_DIR_NAME)

    try {
      const remainingItems = await readdir(basePartialDir)
      if (remainingItems.length === 0) {
        await rmdir(basePartialDir)
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
