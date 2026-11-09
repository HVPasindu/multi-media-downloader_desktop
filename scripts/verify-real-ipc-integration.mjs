import { app, BrowserWindow, ipcMain, dialog } from 'electron'
import assert from 'node:assert/strict'
import path from 'node:path'
import fs from 'node:fs'
import { statfs } from 'node:fs/promises'
import { getDatabase, initializeDatabase } from '../src/main/backend/config/database.js'
import { getSavedDownloadPath } from '../src/main/backend/services/downloadSettingsService.js'
import { getDefaultDownloadPath } from '../src/main/backend/services/downloadPathService.js'
import {
  validateDownloadFolder,
  verifyDownloadFolderWritable
} from '../src/main/backend/services/downloadFileSafetyService.js'
import { updateDownloadPreferences } from '../src/main/backend/services/settingsService.js'
import { setStartupWindow, getStartupWindow } from '../src/main/ui/startupManager.js'
import { getWindowsLoginItemOptions } from '../src/main/loginItemHelper.js'

let mainWindow = null
let initialStartupSetting = false

async function run() {
  console.log('================================================================')
  console.log(' APPLAN2 — Real Windows Startup & Storage IPC Integration Tests ')
  console.log(' Scope: Renderer -> Preload (window.api) -> IPC -> Main -> Win32')
  console.log('================================================================\n')

  assert.equal(process.platform, 'win32', 'Tests must execute on Windows platform')

  // 1. Initialize SQLite Database
  await initializeDatabase()
  console.log('[Setup] Database initialized successfully.')

  // 2. Register real IPC handlers (identical to src/main/index.js)
  const isTrustedIpcSender = (event) => {
    const sender = event?.sender
    if (!sender) return false
    const ownerWindow = BrowserWindow.fromWebContents(sender)
    const trustedWindow = getStartupWindow()
    if (
      !ownerWindow ||
      (typeof ownerWindow.isDestroyed === 'function' && ownerWindow.isDestroyed())
    ) {
      return false
    }
    if (trustedWindow && ownerWindow !== trustedWindow) {
      return false
    }
    return true
  }

  ipcMain.handle('downloads:choose-folder', async (event) => {
    const ownerWindow = BrowserWindow.fromWebContents(event.sender)
    if (!ownerWindow) throw new Error('Application window not found')

    const result = await dialog.showOpenDialog(ownerWindow, {
      title: 'Choose Download Folder',
      properties: ['openDirectory']
    })
    if (result.canceled || result.filePaths.length === 0) return null

    const selectedPath = result.filePaths[0]
    const validPath = await validateDownloadFolder(selectedPath)
    await verifyDownloadFolderWritable(validPath)
    const updatedPreferences = await updateDownloadPreferences({ downloadPath: validPath })
    return updatedPreferences.downloadPath
  })

  ipcMain.handle('downloads:get-folder', async () => {
    const AppSetting = getDatabase().models.AppSetting
    const savedPath = await getSavedDownloadPath(AppSetting)
    if (savedPath) return savedPath
    return await getDefaultDownloadPath()
  })

  ipcMain.handle('app-settings:get-start-with-windows', (event) => {
    if (!isTrustedIpcSender(event)) {
      throw new Error('Unauthorized IPC sender')
    }
    if (process.platform !== 'win32') {
      return { supported: false, enabled: false }
    }
    try {
      const settings = app.getLoginItemSettings(getWindowsLoginItemOptions(app, true))
      if (typeof settings?.openAtLogin !== 'boolean') {
        throw new Error('Invalid login item settings returned by Windows')
      }
      return { supported: true, enabled: settings.openAtLogin }
    } catch (err) {
      console.error('Failed to get login item settings:', err)
      return { supported: true, error: err?.message || String(err) }
    }
  })

  ipcMain.handle('app-settings:set-start-with-windows', (event, enabled) => {
    if (!isTrustedIpcSender(event)) {
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
        ...getWindowsLoginItemOptions(app, true)
      }
      app.setLoginItemSettings(options)
      const verifySettings = app.getLoginItemSettings(getWindowsLoginItemOptions(app, true))
      if (
        typeof verifySettings?.openAtLogin !== 'boolean' ||
        verifySettings.openAtLogin !== enabled
      ) {
        return { supported: true, error: 'Windows did not confirm the startup setting.' }
      }
      return { supported: true, enabled: verifySettings.openAtLogin }
    } catch (err) {
      console.error('Failed to set login item settings:', err)
      return { supported: true, error: err?.message || String(err) }
    }
  })

  ipcMain.handle('downloads:get-storage-info', async (event) => {
    if (!isTrustedIpcSender(event)) {
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

  // 3. Create real BrowserWindow with the real preload script
  const preloadPath = fs.existsSync(path.resolve('out/preload/index.js'))
    ? path.resolve('out/preload/index.js')
    : path.resolve('src/preload/index.js')
  assert.ok(fs.existsSync(preloadPath), `Preload script must exist at ${preloadPath}`)

  mainWindow = new BrowserWindow({
    width: 800,
    height: 600,
    show: false,
    webPreferences: {
      preload: preloadPath,
      sandbox: false,
      contextIsolation: true
    }
  })

  mainWindow.webContents.on('console-message', (_, level, message) => {
    console.log(`[Renderer Console] ${message}`)
  })

  setStartupWindow(mainWindow)

  await mainWindow.loadURL(
    'data:text/html,<!DOCTYPE html><html><body><h1>APPLAN2 IPC</h1></body></html>'
  )
  console.log('[Setup] Real BrowserWindow with preload bridge created and loaded.\n')

  try {
    // ------------------------------------------------------------------------
    // PHASE 05 — REAL WINDOWS STARTUP IPC INTEGRATION TESTS
    // ------------------------------------------------------------------------
    console.log('--- PHASE 05: Real Windows Startup IPC Integration ---')

    // Test A: Read current startup setting through window.api
    console.log('Test A: Reading initial startup setting via window.api.getStartWithWindows()...')
    const initialRes = await mainWindow.webContents.executeJavaScript(
      'window.api.getStartWithWindows()'
    )
    console.log('  Initial Response:', initialRes)
    assert.equal(typeof initialRes, 'object', 'Response must be an object')
    assert.equal(initialRes.supported, true, 'Supported must be true on Windows')
    assert.equal(typeof initialRes.enabled, 'boolean', 'Enabled must be a strict boolean')
    assert.equal(initialRes.error, undefined, 'Error must be undefined on success')
    initialStartupSetting = initialRes.enabled
    console.log(
      `✓ Test A Passed: Startup read successful via IPC. Initial enabled = ${initialStartupSetting}\n`
    )

    // Test B: Startup ON through IPC
    console.log('Test B: Toggling Startup -> ON via window.api.setStartWithWindows(true)...')
    const setOnRes = await mainWindow.webContents.executeJavaScript(
      'window.api.setStartWithWindows(true)'
    )
    console.log('  Set ON Response:', setOnRes)
    assert.equal(setOnRes.supported, true, 'Supported must be true')
    assert.equal(setOnRes.enabled, true, 'Enabled must be confirmed true')

    const verifyOnRes = await mainWindow.webContents.executeJavaScript(
      'window.api.getStartWithWindows()'
    )
    console.log('  Read-back ON Response:', verifyOnRes)
    assert.equal(verifyOnRes.enabled, true, 'Read-back must confirm enabled === true')
    console.log('✓ Test B Passed: Startup ON successfully applied and read back via IPC.\n')

    // Test C: Startup OFF through IPC
    console.log('Test C: Toggling Startup -> OFF via window.api.setStartWithWindows(false)...')
    const setOffRes = await mainWindow.webContents.executeJavaScript(
      'window.api.setStartWithWindows(false)'
    )
    console.log('  Set OFF Response:', setOffRes)
    assert.equal(setOffRes.supported, true, 'Supported must be true')
    assert.equal(setOffRes.enabled, false, 'Enabled must be confirmed false')

    const verifyOffRes = await mainWindow.webContents.executeJavaScript(
      'window.api.getStartWithWindows()'
    )
    console.log('  Read-back OFF Response:', verifyOffRes)
    assert.equal(verifyOffRes.enabled, false, 'Read-back must confirm enabled === false')
    console.log('✓ Test C Passed: Startup OFF successfully applied and read back via IPC.\n')

    // Test D: Original preference restoration
    console.log(`Test D: Restoring original preference (was: ${initialStartupSetting}) via IPC...`)
    const restoreRes = await mainWindow.webContents.executeJavaScript(
      `window.api.setStartWithWindows(${initialStartupSetting})`
    )
    console.log('  Restore Response:', restoreRes)
    assert.equal(
      restoreRes.enabled,
      initialStartupSetting,
      'Restored enabled state must match initial'
    )

    const verifyRestored = await mainWindow.webContents.executeJavaScript(
      'window.api.getStartWithWindows()'
    )
    assert.equal(
      verifyRestored.enabled,
      initialStartupSetting,
      'Final read-back must match original preference exactly'
    )
    console.log(
      `✓ Test D Passed: Original Windows startup preference (${initialStartupSetting}) restored.\n`
    )

    // ------------------------------------------------------------------------
    // PHASE 06 — REAL STORAGE INFORMATION & DOWNLOAD FOLDER IPC TESTS
    // ------------------------------------------------------------------------
    console.log('--- PHASE 06: Real Storage Information & Download Folder IPC ---')

    // Retrieve saved download folder via IPC
    console.log('Test 1: Retrieving saved download folder via window.api.getDownloadFolder()...')
    const folderPath = await mainWindow.webContents.executeJavaScript(
      'window.api.getDownloadFolder()'
    )
    console.log('  Saved Download Folder:', folderPath)
    assert.equal(typeof folderPath, 'string', 'Download folder must be a string')
    assert.ok(folderPath.length > 0, 'Download folder must not be empty')
    console.log('✓ Test 1 Passed: Download folder retrieved successfully via IPC.\n')

    // Retrieve real storage information via IPC
    console.log('Test 2: Retrieving real storage info via window.api.getStorageInfo()...')
    const storageInfo = await mainWindow.webContents.executeJavaScript(
      'window.api.getStorageInfo()'
    )
    console.log('  Storage Info Response:', storageInfo)

    assert.equal(typeof storageInfo, 'object', 'Storage response must be an object')
    assert.equal(typeof storageInfo.available, 'boolean', 'available must be boolean')
    assert.equal(storageInfo.available, true, 'Drive containing download folder must be accessible')
    assert.equal(storageInfo.folderPath, folderPath, 'folderPath must match saved download folder')
    assert.equal(typeof storageInfo.resolvedPath, 'string', 'resolvedPath must be string')
    assert.ok(fs.existsSync(storageInfo.resolvedPath), 'resolvedPath must physically exist')

    assert.ok(storageInfo.totalBytes > 0, 'totalBytes must be > 0')
    assert.ok(storageInfo.usedBytes >= 0, 'usedBytes must be >= 0')
    assert.ok(storageInfo.freeBytes >= 0, 'freeBytes must be >= 0')
    assert.equal(
      storageInfo.totalBytes,
      storageInfo.usedBytes + storageInfo.freeBytes,
      'Byte arithmetic: totalBytes === usedBytes + freeBytes'
    )

    const percentUsed = Math.round((storageInfo.usedBytes / storageInfo.totalBytes) * 100)
    assert.ok(percentUsed >= 0 && percentUsed <= 100, 'Percent used must be 0-100')
    console.log(
      `  Calculation: total=${storageInfo.totalBytes}, used=${storageInfo.usedBytes}, free=${storageInfo.freeBytes} (${percentUsed}% used)`
    )
    console.log('✓ Test 2 Passed: Real filesystem storage info verified via IPC.\n')

    console.log('================================================================')
    console.log(' ALL REAL IPC INTEGRATION TESTS PASSED SUCCESSFULLY (100% PASS)  ')
    console.log('================================================================\n')
  } catch (err) {
    // Ensure restoration of startup setting even if test fails
    try {
      const options = {
        openAtLogin: initialStartupSetting,
        ...getWindowsLoginItemOptions(app, true)
      }
      app.setLoginItemSettings(options)
    } catch (cleanupErr) {
      console.error('Failed to restore startup setting in cleanup:', cleanupErr)
    }
    throw err
  } finally {
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.destroy()
    }
    app.quit()
  }
}

app.whenReady().then(run)
