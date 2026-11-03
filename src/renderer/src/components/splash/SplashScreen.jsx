import { lazy, Suspense } from 'react'
import { motion } from 'framer-motion'
import { AlertCircle, RotateCcw, RefreshCw, Sparkles } from 'lucide-react'
import officialLogo from '../../assets/branding/official-cloud-logo-transparent.png'
import LoadingIndicator from '../common/LoadingIndicator'

// Lazy-load the isolated Three.js 3D decoration
const SplashDecoration3D = lazy(() => import('../../features/three/SplashDecoration3D'))

/**
 * Maps main-process startup state keys to friendly user messages.
 */
function getStatusDisplay(status) {
  if (!status) return 'Starting application...'

  switch (status.state) {
    case 'launching':
      return 'Preparing desktop environment...'
    case 'initializing_database':
      return 'Initializing SQLite database & migrations...'
    case 'recovering_downloads':
      return 'Checking previous download sessions...'
    case 'starting_backend':
      return 'Starting local Express API services...'
    case 'verifying_health':
      return 'Verifying API health & IPC connection...'
    case 'ready':
      return 'Ready! Launching Downloader...'
    case 'error':
      return status.message || 'Application startup error'
    default:
      return status.message || 'Starting application...'
  }
}

/**
 * Startup Splash Screen Component
 * Displays our official Neon Cloud branding, real startup progress,
 * and isolated Three.js ambient decoration.
 */
export default function SplashScreen({
  status,
  isHealthError = false,
  onRetry = null,
  onRestart = null,
  isPreview = false,
  onClosePreview = null
}) {
  const isError = status?.state === 'error' || isHealthError
  const statusText = getStatusDisplay(status)

  return (
    <div className="relative w-full h-full flex flex-col items-center justify-center bg-[#040B1C] text-text overflow-hidden select-none">
      {/* Background radial glow accents */}
      <div className="absolute -top-40 -left-40 w-96 h-96 rounded-full bg-primary/10 blur-[120px] pointer-events-none" />
      <div className="absolute -bottom-40 -right-40 w-96 h-96 rounded-full bg-accent/15 blur-[120px] pointer-events-none" />
      <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[550px] h-[550px] rounded-full bg-surface/50 blur-[100px] pointer-events-none" />

      {/* Dev Preview indicator if in manual preview mode */}
      {isPreview && (
        <div className="absolute top-4 right-4 z-50 flex items-center gap-2 bg-surface-elevated/90 border border-primary/40 px-3 py-1.5 rounded-full text-xs text-primary shadow-lg backdrop-blur-md">
          <Sparkles className="w-3.5 h-3.5 text-primary animate-pulse" />
          <span>Splash Screen Preview</span>
          {onClosePreview && (
            <button
              onClick={onClosePreview}
              className="ml-2 hover:text-white px-1.5 py-0.5 rounded bg-surface border border-primary/20 hover:border-primary/50 transition-colors"
            >
              Exit
            </button>
          )}
        </div>
      )}

      {/* Main branded card container */}
      <motion.div
        initial={{ opacity: 0, y: 16 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.6, ease: 'easeOut' }}
        className="relative z-10 flex flex-col items-center max-w-md w-full px-8 text-center"
      >
        {/* Logo and 3D Decoration Stack */}
        <div className="relative flex items-center justify-center w-56 h-56 mb-2">
          {/* 3D Torus ambient decoration lazy-loaded in background */}
          <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
            <Suspense
              fallback={
                <div className="w-40 h-40 rounded-full border border-primary/20 animate-pulse" />
              }
            >
              <SplashDecoration3D className="w-56 h-56" />
            </Suspense>
          </div>

          {/* Official Neon Cloud Logo */}
          <motion.img
            src={officialLogo}
            alt="Multi Media Downloader Logo"
            className="relative z-10 w-36 h-36 object-contain pointer-events-none drop-shadow-[0_0_24px_rgba(25,216,255,0.7)]"
            initial={{ scale: 0.85, opacity: 0 }}
            animate={{ scale: 1, opacity: 1 }}
            transition={{ duration: 0.7, ease: 'easeOut' }}
          />
        </div>

        {/* Official Application Branding Title */}
        <motion.h1
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.2, duration: 0.5 }}
          className="text-2xl font-extrabold tracking-wider text-white uppercase drop-shadow-[0_2px_12px_rgba(25,216,255,0.35)]"
        >
          Multi Media Downloader
        </motion.h1>

        <motion.p
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ delay: 0.3, duration: 0.5 }}
          className="text-xs text-text-muted mt-1 font-medium tracking-wide"
        >
          Fast, High Quality & Multi-Platform Desktop Engine
        </motion.p>

        {/* Loading / Status Section */}
        <div className="w-full mt-8">
          {!isError ? (
            <div className="flex flex-col items-center gap-3">
              <LoadingIndicator type="bar" className="w-64" />
              <p className="text-xs text-text-muted animate-pulse font-medium tracking-wide">
                {statusText}
              </p>
            </div>
          ) : (
            <motion.div
              initial={{ opacity: 0, scale: 0.95 }}
              animate={{ opacity: 1, scale: 1 }}
              className="flex flex-col items-center gap-4 bg-danger/10 border border-danger/30 p-4 rounded-xl shadow-lg w-full"
            >
              <div className="flex items-center gap-2 text-danger">
                <AlertCircle className="w-5 h-5 flex-shrink-0" />
                <span className="text-sm font-semibold">Startup Interrupted</span>
              </div>
              <p className="text-xs text-text-muted text-center break-words max-h-24 overflow-y-auto px-2">
                {status?.error ||
                  status?.message ||
                  'Connection to local services could not be established.'}
              </p>

              {/* Action Buttons for Safe Recovery */}
              <div className="flex items-center gap-3 mt-1">
                {isHealthError && onRetry && (
                  <button
                    onClick={onRetry}
                    className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold bg-primary text-secondary hover:brightness-110 active:scale-95 transition-all shadow-[0_0_12px_rgba(25,216,255,0.4)]"
                  >
                    <RefreshCw className="w-3.5 h-3.5" />
                    <span>Retry Connection</span>
                  </button>
                )}

                {onRestart && (
                  <button
                    onClick={onRestart}
                    className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold bg-surface-elevated text-text hover:bg-surface border border-text-muted/30 active:scale-95 transition-all"
                  >
                    <RotateCcw className="w-3.5 h-3.5" />
                    <span>Restart Application</span>
                  </button>
                )}
              </div>
            </motion.div>
          )}
        </div>
      </motion.div>

      {/* Footer System Version Note */}
      <div className="absolute bottom-4 text-[11px] text-text-muted/60 tracking-wider">
        APPLAN2 • Phase 05 Frontend Desktop
      </div>
    </div>
  )
}
