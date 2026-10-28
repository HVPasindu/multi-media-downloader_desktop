import { app, shell, BrowserWindow, ipcMain, dialog } from 'electron'

import { startServer, stopServer } from './backend/server.js'

import { initializeDatabase } from './backend/config/database.js'
import { recoverInterruptedDownloadJobs } from './backend/services/downloadRecoveryService.js'

import { getDatabase } from './backend/config/database.js'
import { getSavedDownloadPath } from './backend/services/downloadSettingsService.js'
import { updateDownloadPreferences } from './backend/services/settingsService.js'
import { getDefaultDownloadPath } from './backend/services/downloadPathService.js'
import {
  validateDownloadFolder,
  verifyDownloadFolderWritable
} from './backend/services/downloadFileSafetyService.js'

import { join } from 'path'
import { electronApp, optimizer, is } from '@electron-toolkit/utils'
import icon from '../../resources/icon.png?asset'

let databaseConnection = null
let shutdownStarted = false

function createWindow() {
  // Create the browser window.
  const mainWindow = new BrowserWindow({
    width: 900,
    height: 670,
    show: false,
    autoHideMenuBar: true,
    ...(process.platform === 'linux' ? { icon } : {}),
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      sandbox: false
    }
  })

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

  try {
    // 1. Initialize SQLite Database
    const { sequelize, databasePath } = await initializeDatabase()

    // 2. Store Sequelize connection for shutdown
    databaseConnection = sequelize

    console.log('Database path:', databasePath)

    // 3. Recover incomplete jobs from the previous application session
    const recoveryResult = await recoverInterruptedDownloadJobs()

    console.log('Download restart recovery completed:', recoveryResult)

    // 4. Start Express Backend
    const { baseUrl } = await startServer()

    console.log('Backend URL:', baseUrl)

    // Allow the frontend to choose a download folder
    ipcMain.handle('downloads:choose-folder', async (event) => {
      const ownerWindow = BrowserWindow.fromWebContents(event.sender)

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

    ipcMain.handle('downloads:get-folder', async () => {
      const AppSetting = getDatabase().models.AppSetting

      const savedPath = await getSavedDownloadPath(AppSetting)

      if (savedPath) {
        return savedPath
      }

      return await getDefaultDownloadPath()
    })
  } catch (error) {
    console.error('Application startup failed:', error)

    dialog.showErrorBox('Startup Error', error instanceof Error ? error.message : String(error))

    app.quit()
    return
  }

  createWindow()

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
      // Stop Express Server
      await stopServer()

      // Close SQLite connection
      if (databaseConnection) {
        await databaseConnection.close()
      }

      console.log('Application resources closed')
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
