import { app, BrowserWindow, ipcMain, dialog } from 'electron'
import assert from 'node:assert/strict'
import path from 'node:path'
import fs from 'node:fs'
import { initializeDatabase } from '../src/main/backend/config/database.js'
import { setStartupWindow, getStartupWindow } from '../src/main/ui/startupManager.js'
import {
  registerSettingsIpcHandlers,
  isTrustedSettingsIpcSender
} from '../src/main/ipc/settingsHandlers.js'

let mainWindow = null
let originalStartupSetting = null
let hasCapturedOriginalStartupSetting = false

async function run() {
  console.log('================================================================')
  console.log(' APPLAN2 — Real Windows Startup & Storage IPC Integration Tests ')
  console.log(' Scope: Renderer -> Preload (window.api) -> Production IPC -> Win32')
  console.log('================================================================\n')

  assert.equal(process.platform, 'win32', 'Tests must execute on Windows platform')

  // 1. Initialize SQLite Database
  await initializeDatabase()
  console.log('[Setup] Database initialized successfully.')

  // 2. Register production IPC handlers using shared production module
  registerSettingsIpcHandlers({
    ipcMain,
    app,
    BrowserWindow,
    dialog,
    getStartupWindow
  })
  console.log('[Setup] Registered production IPC handlers via registerSettingsIpcHandlers.')

  // 3. Verify sender trust verification logic
  assert.equal(
    isTrustedSettingsIpcSender({}, { BrowserWindow, getStartupWindow }),
    false,
    'Untrusted empty sender must be rejected'
  )
  assert.equal(
    isTrustedSettingsIpcSender({ sender: null }, { BrowserWindow, getStartupWindow }),
    false,
    'Null sender must be rejected'
  )
  console.log('[Security] Verified isTrustedSettingsIpcSender rejects unauthorized senders.')

  // 4. Create real BrowserWindow with the real compiled preload script
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

    // Capture original preference safely BEFORE any mutation
    originalStartupSetting = initialRes.enabled
    hasCapturedOriginalStartupSetting = true
    console.log(
      `✓ Test A Passed: Startup read successful via IPC. Original enabled = ${originalStartupSetting}\n`
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
  } finally {
    try {
      if (hasCapturedOriginalStartupSetting) {
        console.log(
          `[Cleanup] Restoring original preference (was: ${originalStartupSetting}) via IPC...`
        )
        const restoreRes = await mainWindow.webContents.executeJavaScript(
          `window.api.setStartWithWindows(${originalStartupSetting})`
        )
        console.log('  Restore Response:', restoreRes)
        assert.equal(
          restoreRes.enabled,
          originalStartupSetting,
          'Restored enabled state must match original'
        )

        const verifyRestored = await mainWindow.webContents.executeJavaScript(
          'window.api.getStartWithWindows()'
        )
        assert.equal(
          verifyRestored.enabled,
          originalStartupSetting,
          'Final read-back must match original preference exactly'
        )
        console.log(
          `✓ [Cleanup] Original Windows startup preference successfully restored to ${originalStartupSetting}.\n`
        )
      }
    } catch (restoreErr) {
      console.error(
        'CRITICAL: Failed to restore Windows startup preference in cleanup:',
        restoreErr
      )
      process.exitCode = 1
    } finally {
      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.destroy()
      }
      app.quit()
    }
  }
}

app.whenReady().then(run)
