/**
 * IPC handler registration for opening downloaded media files and enclosing folders securely.
 * Replaces raw filesystem paths with validated Job IDs and queries SQLite via getDownloadHistoryDetails.
 */

export function registerDownloadFileHandlers({
  ipcMain,
  BrowserWindow,
  shell,
  getDownloadHistoryDetails
}) {
  async function getVerifiedDownloadFilePath(jobId) {
    if (typeof jobId !== 'number' || !Number.isSafeInteger(jobId) || jobId <= 0) {
      return {
        success: false,
        error: 'Invalid download record.'
      }
    }

    let details
    try {
      details = await getDownloadHistoryDetails(jobId)
    } catch {
      return {
        success: false,
        error: 'Invalid download record.'
      }
    }

    if (!details || details.job?.status !== 'completed') {
      return {
        success: false,
        error: 'Completed download record not found.'
      }
    }

    if (details.file_status !== 'available' || !details.file?.file_path) {
      return {
        success: false,
        error: 'Downloaded file is not available.'
      }
    }

    return {
      success: true,
      filePath: details.file.file_path
    }
  }

  ipcMain.handle('shell:open-file', async (event, jobId) => {
    const ownerWindow = BrowserWindow.fromWebContents(event?.sender)
    if (!ownerWindow || ownerWindow.isDestroyed()) {
      throw new Error('Unauthorized IPC sender')
    }

    try {
      const verified = await getVerifiedDownloadFilePath(jobId)
      if (!verified.success) {
        return verified
      }

      const errorMsg = await shell.openPath(verified.filePath)
      if (errorMsg) {
        return {
          success: false,
          error: 'The downloaded file could not be opened.'
        }
      }

      return { success: true }
    } catch {
      return {
        success: false,
        error: 'The downloaded file could not be opened.'
      }
    }
  })

  ipcMain.handle('shell:open-folder', async (event, jobId) => {
    const ownerWindow = BrowserWindow.fromWebContents(event?.sender)
    if (!ownerWindow || ownerWindow.isDestroyed()) {
      throw new Error('Unauthorized IPC sender')
    }

    try {
      const verified = await getVerifiedDownloadFilePath(jobId)
      if (!verified.success) {
        return verified
      }

      shell.showItemInFolder(verified.filePath)
      return { success: true }
    } catch {
      return {
        success: false,
        error: 'The enclosing folder could not be opened.'
      }
    }
  })
}
