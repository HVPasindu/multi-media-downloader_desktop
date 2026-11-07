import path from 'node:path'
import { fileURLToPath } from 'node:url'

/**
 * Validates whether an incoming IPC event originates from the authentic,
 * trusted Main Window's top-level frame matching development or production origin.
 *
 * @param {import('electron').IpcMainInvokeEvent} event
 * @param {object} options
 * @returns {boolean}
 */
export function isTrustedDownloadIpcSender(event, options = {}) {
  const { BrowserWindow, getTrustedWindow, isDev, rendererUrl, rendererFilePath } = options

  const trustedWindow = getTrustedWindow?.()
  const sender = event?.sender

  if (
    !trustedWindow ||
    (typeof trustedWindow.isDestroyed === 'function' && trustedWindow.isDestroyed())
  ) {
    return false
  }

  if (!sender) {
    return false
  }

  const ownerWindow = BrowserWindow?.fromWebContents?.(sender)

  if (ownerWindow !== trustedWindow || sender !== trustedWindow.webContents) {
    return false
  }

  if (!event.senderFrame || event.senderFrame !== sender.mainFrame) {
    return false
  }

  try {
    const actualUrl = new URL(event.senderFrame.url)

    if (isDev) {
      if (!rendererUrl) return false
      const expectedUrl = new URL(rendererUrl)
      return actualUrl.origin === expectedUrl.origin
    }

    if (actualUrl.protocol !== 'file:' || !rendererFilePath) {
      return false
    }

    return path.resolve(fileURLToPath(actualUrl)) === path.resolve(rendererFilePath)
  } catch {
    return false
  }
}

/**
 * IPC handler registration for opening downloaded media files and enclosing folders securely.
 * Replaces raw filesystem paths with validated Job IDs and queries SQLite via getDownloadHistoryDetails.
 */
export function registerDownloadFileHandlers(options) {
  const { ipcMain, shell, getDownloadHistoryDetails } = options

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
    if (!isTrustedDownloadIpcSender(event, options)) {
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
    if (!isTrustedDownloadIpcSender(event, options)) {
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
