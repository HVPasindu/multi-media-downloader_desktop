import { useState, useEffect } from 'react'
import {
  Settings as SettingsIcon,
  Sliders,
  Palette,
  Info,
  Folder,
  HardDrive,
  AlertCircle
} from 'lucide-react'
import ToggleSwitch from '../components/ui/ToggleSwitch'
import { SETTINGS_SECTIONS } from '../data/uiPreviewData'
import {
  chooseDownloadFolder,
  getDownloadFolder,
  getStorageInfo,
  getStartWithWindows,
  setStartWithWindows as updateStartWithWindows
} from '../services/api'

/**
 * Format raw disk bytes into readable human-friendly values (GB/TB).
 */
function formatDiskBytes(bytes) {
  if (!Number.isFinite(bytes) || bytes <= 0) return '0 GB'
  const gb = bytes / 1024 ** 3
  if (gb >= 1000) {
    const tb = gb / 1024
    return `${Number(tb.toFixed(1))} TB`
  }
  if (gb < 10) {
    return `${Number(gb.toFixed(1))} GB`
  }
  return `${Math.round(gb)} GB`
}

/**
 * Settings Page
 * Features:
 * - Four approved sections in secondary navigation: General, Quality & Audio, Appearance, About.
 * - General Section with ONLY three approved cards:
 *   1. Start with Windows (Real Windows openAtLogin via Electron app.get/setLoginItemSettings)
 *   2. Default Download Folder (Existing SQLite-persisted folder selection with 409 conflict guard)
 *   3. Storage Information (Real dynamic filesystem statistics via node:fs/promises statfs)
 */
export default function SettingsPage() {
  const [activeSection, setActiveSection] = useState('general')

  // 1. Start with Windows real state
  const [startWithWindows, setStartWithWindows] = useState(false)
  const [isLoadingStartup, setIsLoadingStartup] = useState(true)
  const [isUpdatingStartup, setIsUpdatingStartup] = useState(false)
  const [startupError, setStartupError] = useState(null)
  const [isStartupSupported, setIsStartupSupported] = useState(true)

  // 2. Default Download Folder state
  const [downloadFolder, setDownloadFolder] = useState('')
  const [isLoadingFolder, setIsLoadingFolder] = useState(true)
  const [folderError, setFolderError] = useState(null)

  // 3. Storage Information real filesystem state
  const [storageInfo, setStorageInfo] = useState(null)
  const [isLoadingStorage, setIsLoadingStorage] = useState(true)

  useEffect(() => {
    let isMounted = true

    async function loadInitialSettings() {
      // 1. Load Windows startup preference
      try {
        const startupRes = await getStartWithWindows()
        if (isMounted && startupRes) {
          setIsStartupSupported(startupRes.supported !== false)
          setStartWithWindows(Boolean(startupRes.enabled))
          setStartupError(null)
        }
      } catch (err) {
        if (isMounted) {
          setStartupError(err?.message || 'Unable to retrieve Windows startup setting.')
        }
      } finally {
        if (isMounted) {
          setIsLoadingStartup(false)
        }
      }

      // 2. Load saved download folder
      try {
        const folder = await getDownloadFolder()
        if (isMounted && folder) {
          setDownloadFolder(folder)
          setFolderError(null)
        }
      } catch (err) {
        if (isMounted) {
          setFolderError(err?.message || 'Unable to retrieve saved download folder.')
        }
      } finally {
        if (isMounted) {
          setIsLoadingFolder(false)
        }
      }

      // 3. Load real storage information
      try {
        const info = await getStorageInfo()
        if (isMounted) {
          setStorageInfo(info)
        }
      } catch {
        if (isMounted) {
          setStorageInfo({ available: false })
        }
      } finally {
        if (isMounted) {
          setIsLoadingStorage(false)
        }
      }
    }

    loadInitialSettings()

    return () => {
      isMounted = false
    }
  }, [])

  const handleToggleStartWithWindows = async (enabled) => {
    if (isUpdatingStartup || !isStartupSupported) return
    setIsUpdatingStartup(true)
    setStartupError(null)
    try {
      const res = await updateStartWithWindows(enabled)
      if (res && typeof res.enabled === 'boolean') {
        setStartWithWindows(res.enabled)
      } else {
        setStartWithWindows(enabled)
      }
    } catch (err) {
      setStartupError(err?.message || 'Failed to update Windows startup setting.')
    } finally {
      setIsUpdatingStartup(false)
    }
  }

  const handleChooseFolder = async () => {
    setFolderError(null)
    try {
      const selected = await chooseDownloadFolder()
      if (selected) {
        setDownloadFolder(selected)
        // Refresh real storage info after changing the download folder
        setIsLoadingStorage(true)
        try {
          const info = await getStorageInfo()
          setStorageInfo(info)
        } catch {
          setStorageInfo({ available: false })
        } finally {
          setIsLoadingStorage(false)
        }
      }
    } catch (err) {
      setFolderError(err?.message || 'Failed to update download folder.')
    }
  }

  // Icon mapping for the four approved sections
  const sectionIcons = {
    general: SettingsIcon,
    'quality-audio': Sliders,
    appearance: Palette,
    about: Info
  }

  const currentSectionMeta = SETTINGS_SECTIONS.find((s) => s.id === activeSection)
  const currentSectionLabel = currentSectionMeta?.label || activeSection

  const totalBytes = Number(storageInfo?.totalBytes) || 0
  const usedBytes = Number(storageInfo?.usedBytes) || 0
  const freeBytes = Number(storageInfo?.freeBytes) || 0
  const percentUsed =
    totalBytes > 0 ? Math.min(100, Math.max(0, Math.round((usedBytes / totalBytes) * 100))) : 0

  return (
    <div className="p-6 lg:p-8 max-w-[1400px] w-full mx-auto flex flex-col gap-6 select-none animate-fadeIn">
      {/* ----------------- TOP HEADER ----------------- */}
      <div>
        <div className="flex items-center gap-3">
          <h1 className="text-3xl lg:text-4xl font-extrabold text-white tracking-tight">
            Settings
          </h1>
          <span className="text-[10px] font-bold tracking-wider px-2 py-0.5 rounded-full bg-primary/10 text-primary border border-primary/20 uppercase">
            General
          </span>
        </div>
        <p className="text-sm text-text-muted mt-1 font-medium">
          Customize your download preferences and application settings
        </p>
      </div>

      {/* ----------------- SETTINGS SPLIT VIEW (LEFT MENU + RIGHT CONTENT) ----------------- */}
      <div className="grid grid-cols-1 md:grid-cols-12 gap-6 items-start">
        {/* ================= LEFT SUB-NAV MENU (3 COLS) ================= */}
        <div className="md:col-span-3 flex flex-col gap-1.5 p-3 rounded-2xl bg-[#07152E]/90 border border-primary/15 shadow-[0_4px_24px_rgba(0,0,0,0.3)] backdrop-blur-md">
          {SETTINGS_SECTIONS.map((sec) => {
            const Icon = sectionIcons[sec.id] || SettingsIcon
            const isActive = activeSection === sec.id

            return (
              <button
                key={sec.id}
                type="button"
                onClick={() => setActiveSection(sec.id)}
                className={`flex items-center gap-3 px-3.5 py-2.5 rounded-xl text-xs font-bold transition-all duration-200 text-left cursor-pointer ${
                  isActive
                    ? 'bg-gradient-to-r from-[#19D8FF] to-[#3388FF] text-white shadow-[0_0_16px_rgba(25,216,255,0.35)]'
                    : 'text-text-muted hover:text-white hover:bg-[#0B1C38]'
                }`}
              >
                <Icon className="w-4 h-4 flex-shrink-0" />
                <span>{sec.label}</span>
              </button>
            )
          })}
        </div>

        {/* ================= RIGHT CONTENT AREA (9 COLS) ================= */}
        <div className="md:col-span-9 flex flex-col gap-6">
          {activeSection !== 'general' ? (
            /* Sub-category Standby Notice */
            <div className="p-8 rounded-2xl bg-[#07152E]/80 border border-primary/15 text-center flex flex-col items-center justify-center gap-2">
              <span className="text-sm font-bold text-white capitalize">
                {currentSectionLabel} Standby
              </span>
              <p className="text-xs text-text-muted max-w-md">
                Detailed configuration options for {currentSectionLabel} will be integrated in later
                roadmap steps.
              </p>
              <button
                type="button"
                onClick={() => setActiveSection('general')}
                className="mt-3 px-4 py-1.5 rounded-xl text-xs font-bold bg-primary/10 hover:bg-primary/20 text-primary border border-primary/25 cursor-pointer transition-all"
              >
                Return to General Settings
              </button>
            </div>
          ) : (
            <>
              {/* Card 1: Start with Windows */}
              <div className="p-5 lg:p-6 rounded-2xl bg-[#07152E]/90 border border-primary/20 shadow-[0_4px_24px_rgba(0,0,0,0.35)] backdrop-blur-md flex flex-col gap-5">
                {/* Card Header */}
                <div className="flex items-center gap-3">
                  <div className="w-9 h-9 rounded-xl bg-cyan-500/15 text-[#19D8FF] flex items-center justify-center">
                    <SettingsIcon className="w-5 h-5" />
                  </div>
                  <div>
                    <h2 className="text-sm font-extrabold text-white">Start with Windows</h2>
                    <p className="text-[11px] text-text-muted">System startup preference</p>
                  </div>
                </div>

                {/* Setting Item */}
                <div className="flex flex-col gap-2 pt-1">
                  <div className="flex items-center justify-between gap-4">
                    <div>
                      <span className="text-xs font-bold text-white block">Start with Windows</span>
                      <span className="text-[11px] text-text-muted">
                        {isStartupSupported
                          ? 'Launch app automatically when Windows starts'
                          : 'Automatic startup is only supported on Windows'}
                      </span>
                    </div>
                    <ToggleSwitch
                      id="toggle-start-windows"
                      checked={startWithWindows}
                      disabled={isLoadingStartup || isUpdatingStartup || !isStartupSupported}
                      onChange={handleToggleStartWithWindows}
                    />
                  </div>

                  {startupError && (
                    <div
                      role="alert"
                      className="flex items-center gap-2 text-xs text-rose-400 bg-rose-500/10 border border-rose-500/20 px-3 py-1.5 rounded-xl animate-fadeIn"
                    >
                      <AlertCircle className="w-3.5 h-3.5 flex-shrink-0" />
                      <span>{startupError}</span>
                    </div>
                  )}
                </div>
              </div>

              {/* Card 2: Default Download Folder */}
              <div className="p-5 lg:p-6 rounded-2xl bg-[#07152E]/90 border border-primary/20 shadow-[0_4px_24px_rgba(0,0,0,0.35)] backdrop-blur-md flex flex-col gap-5">
                {/* Card Header */}
                <div className="flex items-center gap-3">
                  <div className="w-9 h-9 rounded-xl bg-blue-500/15 text-blue-400 flex items-center justify-center">
                    <Folder className="w-5 h-5" />
                  </div>
                  <div>
                    <h2 className="text-sm font-extrabold text-white">Default Download Folder</h2>
                    <p className="text-[11px] text-text-muted">
                      Choose where to save your downloaded files
                    </p>
                  </div>
                </div>

                {/* Folder Path Input & Change Button */}
                <div className="flex flex-col gap-2">
                  <div className="flex items-center gap-2">
                    <input
                      type="text"
                      readOnly
                      value={isLoadingFolder ? 'Loading saved folder...' : downloadFolder}
                      placeholder="Choose download folder..."
                      className="flex-1 bg-[#040B1C] border border-primary/20 rounded-xl py-2 px-3 text-xs text-text-muted font-mono focus:outline-none focus:border-primary select-text"
                    />
                    <button
                      type="button"
                      onClick={handleChooseFolder}
                      title="Choose destination directory"
                      className="px-4 py-2 rounded-xl text-xs font-bold bg-gradient-to-r from-[#19D8FF] to-[#3388FF] text-white shadow-[0_0_12px_rgba(25,216,255,0.3)] hover:shadow-[0_0_18px_rgba(25,216,255,0.45)] transition-all cursor-pointer flex-shrink-0"
                    >
                      Change
                    </button>
                  </div>

                  {folderError && (
                    <div
                      role="alert"
                      className="flex items-center gap-2 text-xs text-rose-400 bg-rose-500/10 border border-rose-500/20 px-3 py-2 rounded-xl animate-fadeIn"
                    >
                      <AlertCircle className="w-4 h-4 flex-shrink-0" />
                      <span>{folderError}</span>
                    </div>
                  )}
                </div>
              </div>

              {/* Card 3: Storage Information */}
              <div className="p-5 lg:p-6 rounded-2xl bg-[#07152E]/90 border border-primary/20 shadow-[0_4px_24px_rgba(0,0,0,0.35)] backdrop-blur-md flex flex-col gap-4">
                {/* Header */}
                <div className="flex items-center gap-3">
                  <div className="w-9 h-9 rounded-xl bg-cyan-500/15 text-[#19D8FF] flex items-center justify-center">
                    <HardDrive className="w-5 h-5" />
                  </div>
                  <div>
                    <h2 className="text-sm font-extrabold text-white">Storage Information</h2>
                    <p className="text-[11px] text-text-muted">Disk space on your download drive</p>
                  </div>
                </div>

                {/* Storage Content */}
                {isLoadingStorage ? (
                  <div className="flex items-center gap-2 text-xs text-text-muted py-2">
                    <div className="w-3.5 h-3.5 border-2 border-primary/40 border-t-primary rounded-full animate-spin" />
                    <span>Loading drive storage information...</span>
                  </div>
                ) : storageInfo?.available === false ? (
                  <div
                    role="alert"
                    className="flex items-center gap-2 text-xs text-amber-400 bg-amber-500/10 border border-amber-500/20 px-3 py-2 rounded-xl"
                  >
                    <AlertCircle className="w-4 h-4 flex-shrink-0" />
                    <span>
                      {storageInfo?.error ||
                        'Disk space information is unavailable for the selected drive.'}
                    </span>
                  </div>
                ) : (
                  <div className="flex flex-col gap-2 pt-1">
                    <div className="w-full h-3 rounded-full bg-[#040B1C] overflow-hidden border border-primary/20">
                      <div
                        className="h-full bg-gradient-to-r from-[#19D8FF] to-[#3388FF] rounded-full shadow-[0_0_12px_rgba(25,216,255,0.5)] transition-all duration-500"
                        style={{ width: `${percentUsed}%` }}
                      />
                    </div>

                    <div className="flex items-center justify-between text-xs text-text-muted font-medium">
                      <span>
                        <strong className="text-white">{formatDiskBytes(usedBytes)}</strong> used of{' '}
                        {formatDiskBytes(totalBytes)} ({percentUsed}%)
                      </span>
                      <span className="text-[#00DEA5] font-semibold">
                        {formatDiskBytes(freeBytes)} free
                      </span>
                    </div>
                  </div>
                )}
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  )
}
