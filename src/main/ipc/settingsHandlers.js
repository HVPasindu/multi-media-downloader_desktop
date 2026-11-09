import path from 'node:path'
import fs from 'node:fs'
import { statfs } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { getDatabase } from '../backend/config/database.js'
import { getSavedDownloadPath } from '../backend/services/downloadSettingsService.js'
import { getDefaultDownloadPath } from '../backend/services/downloadPathService.js'
import {
  validateDownloadFolder,
  verifyDownloadFolderWritable
} from '../backend/services/downloadFileSafetyService.js'
import { updateDownloadPreferences } from '../backend/services/settingsService.js'
import { getWindowsLoginItemOptions } from '../loginItemHelper.js'

/**
 * Validates whether an incoming IPC event originates from the authentic,
 * trusted Main Window's top-level frame matching development or production origin.
 * Fails closed if trusted window is missing, destroyed, or sender is unauthorized.
 *
 * @param {import('electron').IpcMainInvokeEvent} event
 * @param {object} options
 * @returns {boolean}
 */
export function isTrustedSettingsIpcSender(event, options = {}) {
  const {
    BrowserWindow,
    getStartupWindow,
    getTrustedWindow,
    isDev,
    rendererUrl,
    rendererFilePath
  } = options

  const trustedWindowGetter = getStartupWindow || getTrustedWindow
  const trustedWindow = typeof trustedWindowGetter === 'function' ? trustedWindowGetter() : null
  const sender = event?.sender

  // Check 1 — Trusted window existence and vitality
  if (
    !trustedWindow ||
    (typeof trustedWindow.isDestroyed === 'function' && trustedWindow.isDestroyed())
  ) {
    return false
  }

  // Check 2 — Sender existence
  if (!sender) {
    return false
  }

  // Check 3 — Exact BrowserWindow and WebContents validation
  const ownerWindow = BrowserWindow?.fromWebContents?.(sender)
  if (ownerWindow !== trustedWindow || sender !== trustedWindow.webContents) {
    return false
  }

  // Check 4 — Top-level main frame validation (reject iframes / subframes)
  if (!event.senderFrame || event.senderFrame !== sender.mainFrame) {
    return false
  }

  // Check 5 & 6 — Origin / file path validation
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
 * Registers production IPC handlers for General Settings:
 * - downloads:choose-folder
 * - downloads:get-folder
 * - app-settings:get-start-with-windows
 * - app-settings:set-start-with-windows
 * - downloads:get-storage-info
 *
 * Every handler strictly validates its sender before performing any operation.
 *
 * @param {object} options
 * @param {import('electron').IpcMain} options.ipcMain
 * @param {import('electron').App} options.app
 * @param {typeof import('electron').BrowserWindow} options.BrowserWindow
 * @param {import('electron').Dialog} options.dialog
 * @param {() => import('electron').BrowserWindow | null} [options.getStartupWindow]
 * @param {boolean} [options.isDev]
 * @param {string} [options.rendererUrl]
 * @param {string} [options.rendererFilePath]
 */
export function registerSettingsIpcHandlers({
  ipcMain,
  app,
  BrowserWindow,
  dialog,
  getStartupWindow,
  isDev,
  rendererUrl,
  rendererFilePath
}) {
  const checkSender = (event) =>
    isTrustedSettingsIpcSender(event, {
      BrowserWindow,
      getStartupWindow,
      isDev,
      rendererUrl,
      rendererFilePath
    })

  // 1. Choose download folder via native directory picker
  ipcMain.handle('downloads:choose-folder', async (event) => {
    if (!checkSender(event)) {
      throw new Error('Unauthorized IPC sender')
    }

    const ownerWindow = BrowserWindow?.fromWebContents?.(event.sender)
    if (!ownerWindow) {
      throw new Error('Application window not found')
    }

    const result = await dialog.showOpenDialog(ownerWindow, {
      title: 'Choose Download Folder',
      properties: ['openDirectory']
    })

    if (result.canceled || result.filePaths.length === 0) {
      return null
    }

    const selectedPath = result.filePaths[0]

    // Validate folder safety and write permissions before persisting
    const validPath = await validateDownloadFolder(selectedPath)
    await verifyDownloadFolderWritable(validPath)

    // Reuse Settings API service to enforce active-job safety guard and persistence
    const updatedPreferences = await updateDownloadPreferences({
      downloadPath: validPath
    })

    return updatedPreferences.downloadPath
  })

  // 2. Retrieve currently persisted download folder
  ipcMain.handle('downloads:get-folder', async (event) => {
    if (!checkSender(event)) {
      throw new Error('Unauthorized IPC sender')
    }

    const AppSetting = getDatabase()?.models?.AppSetting
    const savedPath = await getSavedDownloadPath(AppSetting)

    if (savedPath) {
      return savedPath
    }

    return await getDefaultDownloadPath()
  })

  // 3. Retrieve Windows startup preference (openAtLogin)
  ipcMain.handle('app-settings:get-start-with-windows', (event) => {
    if (!checkSender(event)) {
      throw new Error('Unauthorized IPC sender')
    }

    if (process.platform !== 'win32') {
      return {
        supported: false,
        enabled: false
      }
    }

    try {
      const settings = app.getLoginItemSettings(getWindowsLoginItemOptions(app))
      if (typeof settings?.openAtLogin !== 'boolean') {
        throw new Error('Invalid login item settings returned by Windows')
      }
      return {
        supported: true,
        enabled: settings.openAtLogin
      }
    } catch (err) {
      console.error('Failed to get login item settings:', err)
      return {
        supported: true,
        error: err?.message || String(err)
      }
    }
  })

  // 4. Update Windows startup preference (openAtLogin)
  ipcMain.handle('app-settings:set-start-with-windows', (event, enabled) => {
    if (!checkSender(event)) {
      throw new Error('Unauthorized IPC sender')
    }

    if (typeof enabled !== 'boolean') {
      throw new Error('Invalid startup setting: enabled must be a boolean')
    }

    if (process.platform !== 'win32') {
      throw new Error('Windows startup setting is not supported on this platform')
    }

    try {
      const options = {
        openAtLogin: enabled,
        ...getWindowsLoginItemOptions(app)
      }

      app.setLoginItemSettings(options)

      const verifySettings = app.getLoginItemSettings(getWindowsLoginItemOptions(app))

      if (
        typeof verifySettings?.openAtLogin !== 'boolean' ||
        verifySettings.openAtLogin !== enabled
      ) {
        return {
          supported: true,
          error: 'Windows did not confirm the startup setting.'
        }
      }

      return {
        supported: true,
        enabled: verifySettings.openAtLogin
      }
    } catch (err) {
      console.error('Failed to set login item settings:', err)
      return {
        supported: true,
        error: err?.message || String(err)
      }
    }
  })

  // 5. Retrieve real filesystem storage information for configured download drive
  ipcMain.handle('downloads:get-storage-info', async (event) => {
    if (!checkSender(event)) {
      throw new Error('Unauthorized IPC sender')
    }

    try {
      const AppSetting = getDatabase()?.models?.AppSetting
      let downloadPath = null
      if (AppSetting) {
        try {
          downloadPath = await getSavedDownloadPath(AppSetting)
        } catch {
          // Fall back to default path
        }
      }
      if (!downloadPath || typeof downloadPath !== 'string' || !downloadPath.trim()) {
        downloadPath = await getDefaultDownloadPath()
      }

      // Find nearest existing ancestor directory or drive root for statfs
      let targetPath = path.resolve(downloadPath.trim())
      while (targetPath && !fs.existsSync(targetPath)) {
        const parent = path.dirname(targetPath)
        if (parent === targetPath) break
        targetPath = parent
      }

      if (!targetPath || !fs.existsSync(targetPath)) {
        return {
          available: false,
          folderPath: downloadPath,
          totalBytes: 0,
          usedBytes: 0,
          freeBytes: 0,
          error: 'Target disk drive is not accessible'
        }
      }

      const stats = await statfs(targetPath)
      const bsize = Number(stats.bsize)
      const totalBytes = Number(stats.blocks) * bsize
      const freeBytes = Number(stats.bavail ?? stats.bfree) * bsize
      const usedBytes = Math.max(0, totalBytes - freeBytes)

      return {
        available: true,
        folderPath: downloadPath,
        resolvedPath: targetPath,
        totalBytes,
        usedBytes,
        freeBytes
      }
    } catch (err) {
      console.error('Failed to retrieve disk storage info:', err?.message || err)
      return {
        available: false,
        totalBytes: 0,
        usedBytes: 0,
        freeBytes: 0,
        error: err?.message || 'Storage information unavailable'
      }
    }
  })
}
