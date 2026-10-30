import { useState, useEffect, useCallback } from 'react'
import { Routes, Route, Navigate } from 'react-router-dom'
import SplashScreen from './components/splash/SplashScreen'
import MainLayout from './components/layout/MainLayout'
import DownloaderPage from './pages/DownloaderPage'
import DownloadsPage from './pages/DownloadsPage'
import HistoryPage from './pages/HistoryPage'
import SettingsPage from './pages/SettingsPage'
import {
  getInitialStartupStatus,
  subscribeStartupStatus,
  verifyBackendHealth,
  restartApplication
} from './services/startupService'

/**
 * Main Application Component
 * Coordinates the startup lifecycle:
 *  1. Mounts the branded Splash Screen immediately.
 *  2. Synchronizes with real Electron startup events (database, recovery, backend).
 *  3. Verifies API health over secure IPC.
 *  4. Transitions smoothly to the Downloader Page when ready.
 */
export default function App() {
  const [startupStatus, setStartupStatus] = useState({
    state: 'launching',
    message: 'Starting application...',
    error: null
  })
  const [isReady, setIsReady] = useState(false)
  const [isHealthError, setIsHealthError] = useState(false)
  const [isPreview, setIsPreview] = useState(() => {
    if (typeof window === 'undefined') return false
    return (
      window.location.hash.includes('preview=splash') ||
      window.location.search.includes('preview=splash')
    )
  })

  // Verify backend health check via IPC
  const checkHealth = useCallback(async () => {
    setIsHealthError(false)
    setStartupStatus((prev) => ({
      ...prev,
      state: 'verifying_health',
      message: 'Verifying API health & IPC connection...'
    }))

    const health = await verifyBackendHealth()

    if (health.ok) {
      setStartupStatus((prev) => ({
        ...prev,
        state: 'ready',
        message: 'Backend verified. Launching Downloader...'
      }))

      // Gentle transition delay for polished user experience
      setTimeout(() => {
        setIsReady(true)
      }, 550)
    } else {
      setIsHealthError(true)
      setStartupStatus((prev) => ({
        ...prev,
        state: 'error',
        message: `API Health Check Failed: ${health.message}`,
        error: health.message
      }))
    }
  }, [])

  // Listen to Electron main-process startup lifecycle
  useEffect(() => {
    let isMounted = true

    async function init() {
      const initial = await getInitialStartupStatus()
      if (!isMounted) return

      setStartupStatus(initial)

      if (initial.state === 'ready') {
        await checkHealth()
      }
    }

    init()

    const unsubscribe = subscribeStartupStatus((newStatus) => {
      if (!isMounted) return
      setStartupStatus(newStatus)

      if (newStatus.state === 'ready') {
        checkHealth()
      }
    })

    return () => {
      isMounted = false
      unsubscribe()
    }
  }, [checkHealth])

  const handleRestart = () => {
    restartApplication()
  }

  const handleRetry = () => {
    checkHealth()
  }

  // Display the branded Splash Screen during startup or when previewing
  if (!isReady || isPreview) {
    return (
      <SplashScreen
        status={startupStatus}
        isHealthError={isHealthError}
        onRetry={handleRetry}
        onRestart={handleRestart}
        isPreview={isPreview}
        onClosePreview={() => setIsPreview(false)}
      />
    )
  }

  return (
    <Routes>
      <Route element={<MainLayout onOpenSplashPreview={() => setIsPreview(true)} />}>
        <Route path="/" element={<DownloaderPage />} />
        <Route path="/downloads" element={<DownloadsPage />} />
        <Route path="/history" element={<HistoryPage />} />
        <Route path="/settings" element={<SettingsPage />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Route>
    </Routes>
  )
}
