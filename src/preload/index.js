import { contextBridge, ipcRenderer } from 'electron'
import { electronAPI } from '@electron-toolkit/preload'

// Custom APIs for renderer

const api = {
  chooseDownloadFolder: () => {
    return ipcRenderer.invoke('downloads:choose-folder')
  },

  getDownloadFolder: () => {
    return ipcRenderer.invoke('downloads:get-folder')
  },

  request: (options) => {
    return ipcRenderer.invoke('api:request', options)
  }
}

// Startup status API for splash screen synchronization
const startup = {
  getStatus: () => {
    return ipcRenderer.invoke('startup:get-status')
  },

  restartApplication: () => {
    return ipcRenderer.invoke('startup:restart-app')
  },

  onStatusChange: (callback) => {
    if (typeof callback !== 'function') {
      return () => {}
    }
    const listener = (_event, status) => callback(status)
    ipcRenderer.on('startup:status-changed', listener)
    return () => {
      ipcRenderer.removeListener('startup:status-changed', listener)
    }
  }
}

// Use `contextBridge` APIs to expose Electron APIs to
// renderer only if context isolation is enabled, otherwise
// just add to the DOM global.
if (process.contextIsolated) {
  try {
    contextBridge.exposeInMainWorld('electron', electronAPI)
    contextBridge.exposeInMainWorld('api', api)
    contextBridge.exposeInMainWorld('startup', startup)
  } catch (error) {
    console.error(error)
  }
} else {
  window.electron = electronAPI
  window.api = api
  window.startup = startup
}
