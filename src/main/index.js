import { app, shell, BrowserWindow, ipcMain, dialog, session } from 'electron'

import { startServer, stopServer } from './backend/server.js'
import { stopQueueForShutdown } from './backend/services/downloadQueueService.js'
import { shutdownActiveDownloads } from './backend/services/downloadService.js'
import {
  startNetworkMonitoring,
  stopNetworkMonitoring
} from './backend/services/networkRecoveryService.js'

import { initializeDatabase } from './backend/config/database.js'
import { recoverInterruptedDownloadJobs } from './backend/services/downloadRecoveryService.js'
import { getDownloadHistoryDetails } from './backend/services/downloadHistoryService.js'
import { registerDownloadFileHandlers } from './ipc/downloadFileHandlers.js'
import { registerSettingsIpcHandlers } from './ipc/settingsHandlers.js'

import { getSessionToken } from './backend/services/localApiSecurityService.js'
import {
  setStartupWindow,
  getStartupWindow,
  getStartupStatus,
  updateStartupStatus,
  restartApplication
} from './ui/startupManager.js'

import { join } from 'path'
import { electronApp, optimizer, is } from '@electron-toolkit/utils'
import icon from '../../resources/icon.png?asset'

let databaseConnection = null
let shutdownStarted = false

function createWindow() {
  // Create the browser window.
  const mainWindow = new BrowserWindow({
    width: 1200,
    height: 780,
    minWidth: 960,
    minHeight: 640,
    show: false,
    autoHideMenuBar: true,
    backgroundColor: '#040B1C',
    title: 'Multi Media Downloader',
    ...(process.platform === 'linux' ? { icon } : {}),
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      sandbox: false
    }
  })

  setStartupWindow(mainWindow)

  mainWindow.on('ready-to-show', () => {
    mainWindow.show()
  })

  mainWindow.webContents.setWindowOpenHandler((details) => {
    shell.openExternal(details.url)
    return { action: 'deny' }
  })

  // HMR for renderer base on electron-vite cli.
  // Load the remote URL for development or the local html file for production.
  if (is.dev && process.env['ELECTRON_RENDERER_URL']) {
    mainWindow.loadURL(process.env['ELECTRON_RENDERER_URL'])
  } else {
    mainWindow.loadFile(join(__dirname, '../renderer/index.html'))
  }
}

// This method will be called when Electron has finished
// initialization and is ready to create browser windows.
// Some APIs can only be used after this event occurs.
app.whenReady().then(async () => {
  // Set app user model id for windows
  electronApp.setAppUserModelId('com.electron')

  // Default open or close DevTools by F12 in development
  // and ignore CommandOrControl + R in production.
  // see https://github.com/alex8088/electron-toolkit/tree/master/packages/utils
  app.on('browser-window-created', (_, window) => {
    optimizer.watchWindowShortcuts(window)
  })

  // IPC test
  ipcMain.on('ping', () => console.log('pong'))

  // Step 05.14 / Dev Reliability: In development, clear session cache to prevent stale module caching
  if (is.dev && session.defaultSession) {
    try {
      await session.defaultSession.clearCache()
    } catch {
      // Non-fatal if clearing cache fails
    }
  }

  // Create application window early so the branded Splash Screen displays during startup
  createWindow()

  // Register startup IPC handlers
  ipcMain.handle('startup:get-status', () => {
    return getStartupStatus()
  })

  ipcMain.handle('startup:restart-app', () => {
    return restartApplication(app)
  })

  try {
    // 1. Initialize SQLite Database
    updateStartupStatus('initializing_database', 'Initializing SQLite database & migrations...')
    const { sequelize, databasePath } = await initializeDatabase()

    // 2. Store Sequelize connection for shutdown
    databaseConnection = sequelize

    console.log('Database path:', databasePath)

    // 3. Recover incomplete jobs from the previous application session
    updateStartupStatus('recovering_downloads', 'Checking previous download sessions...')
    const recoveryResult = await recoverInterruptedDownloadJobs()

    console.log('Download restart recovery completed:', recoveryResult)

    // 4. Start Express Backend
    updateStartupStatus('starting_backend', 'Starting local Express API server...')
    const { baseUrl } = await startServer()

    console.log('Backend URL:', baseUrl)

    // Step 09 Section B - Start background network connectivity monitoring for auto-recovery
    startNetworkMonitoring()

    // Register General Settings IPC handlers (choose folder, get folder, start with windows, storage info)
    registerSettingsIpcHandlers({
      ipcMain,
      app,
      BrowserWindow,
      dialog,
      getStartupWindow,
      isDev: is.dev,
      rendererUrl: process.env['ELECTRON_RENDERER_URL'],
      rendererFilePath: join(__dirname, '../renderer/index.html')
    })

    // Step 05.12 & Task 04 - Secure IPC handlers to open downloaded media file or its folder (FIX 02 & Task 04)
    registerDownloadFileHandlers({
      ipcMain,
      BrowserWindow,
      shell,
      getDownloadHistoryDetails,
      getTrustedWindow: getStartupWindow,
      isDev: is.dev,
      rendererUrl: process.env['ELECTRON_RENDERER_URL'],
      rendererFilePath: join(__dirname, '../renderer/index.html')
    })

    // Step 04.41 - Provide a secure, authenticated IPC bridge for renderer API requests
    ipcMain.handle('api:request', async (event, requestOptions) => {
      // 1. Validate IPC sender - must originate from the trusted application window
      const ownerWindow = BrowserWindow.fromWebContents(event.sender)
      if (!ownerWindow || ownerWindow.isDestroyed()) {
        throw new Error('Unauthorized IPC sender')
      }

      // 2. Validate request options
      if (!requestOptions || typeof requestOptions !== 'object') {
        throw new Error('Invalid API request options')
      }

      const { path: apiPath, method = 'GET', body = null } = requestOptions

      if (typeof apiPath !== 'string' || !apiPath.startsWith('/api/')) {
        throw new Error('API path must start with /api/')
      }

      // Reject path traversal
      if (apiPath.includes('..') || apiPath.includes('//')) {
        throw new Error('Invalid API path structure')
      }

      const upperMethod = typeof method === 'string' ? method.toUpperCase() : 'GET'
      const allowedMethods = ['GET', 'POST', 'PATCH', 'DELETE']
      if (!allowedMethods.includes(upperMethod)) {
        throw new Error(`Method ${upperMethod} is not permitted`)
      }

      // 3. Issue local HTTP request to 127.0.0.1:3001 with active session token
      const token = getSessionToken()
      const url = `http://127.0.0.1:3001${apiPath}`

      const fetchOptions = {
        method: upperMethod,
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json'
        }
      }

      if (body && ['POST', 'PATCH', 'DELETE'].includes(upperMethod)) {
        fetchOptions.body = JSON.stringify(body)
      }

      const response = await fetch(url, fetchOptions)
      const data = await response.json().catch(() => null)

      return {
        status: response.status,
        ok: response.ok,
        data
      }
    })

    // 5. Signal backend initialization complete
    updateStartupStatus('ready', 'Application backend is ready')
  } catch (error) {
    console.error('Application startup failed:', error)
    const safeStartupError =
      'Application startup failed. Please restart the application or check the application logs.'
    updateStartupStatus('error', 'Application startup failed', safeStartupError)
    dialog.showErrorBox('Startup Error', safeStartupError)
  }

  app.on('activate', function () {
    // On macOS it's common to re-create a window in the app when the
    // dock icon is clicked and there are no other windows open.
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

// Cleanup when application quits
app.on('before-quit', (event) => {
  if (shutdownStarted) {
    return
  }

  event.preventDefault()
  shutdownStarted = true

  async function shutdown() {
    try {
      // 1. Step 09.G - Stop queue scheduler and network monitoring
      stopNetworkMonitoring()
      stopQueueForShutdown()

      // 2. Step 09.G - Gracefully interrupt running yt-dlp child processes & flush DB writes
      await shutdownActiveDownloads({ timeoutMs: 5000 })

      // 3. Stop Express Server
      await stopServer()

      // 4. Close SQLite connection only after active processes and writes have settled
      if (databaseConnection) {
        await databaseConnection.close()
      }

      console.log('Application resources closed safely')
    } catch (error) {
      console.error('Shutdown error:', error)
    } finally {
      app.quit()
    }
  }

  void shutdown()
})

// Quit when all windows are closed, except on macOS. There, it's common
// for applications and their menu bar to stay active until the user quits
// explicitly with Cmd + Q.
app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit()
  }
})

// In this file you can include the rest of your app's specific main process
// code. You can also put them in separate files and require them here.
