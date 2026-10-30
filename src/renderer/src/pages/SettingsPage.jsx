import { useState } from 'react'
import {
  Settings as SettingsIcon,
  Download,
  Sliders,
  Music,
  Cpu,
  Palette,
  Keyboard,
  Shield,
  Info,
  Folder,
  HardDrive,
  Check
} from 'lucide-react'
import ToggleSwitch from '../components/ui/ToggleSwitch'
import { SETTINGS_SECTIONS, SETTINGS_STORAGE_INFO } from '../data/uiPreviewData'

/**
 * Settings Page
 * Features:
 * - Left secondary settings sidebar navigation (General, Download, Quality, Audio, Advanced, Appearance, Shortcuts, Privacy, About)
 * - General Settings card: Language dropdown and 4 interactive preview-only toggle switches (Problem 08)
 * - Default Download Folder card: Path display and 4 folder organization checkboxes
 * - Storage Information card: Correctly bound disk space bar showing 125 GB used of 500 GB (375 GB free) (Problem 03)
 */
export default function SettingsPage() {
  const [activeSection, setActiveSection] = useState('general')

  // General Settings preview-only demonstration state (Problem 08: not persisted to SQLite or backend)
  const [language, setLanguage] = useState('English')
  const [startWithWindows, setStartWithWindows] = useState(true)
  const [minimizeToTray, setMinimizeToTray] = useState(true)
  const [showNotifications, setShowNotifications] = useState(true)
  const [checkForUpdates, setCheckForUpdates] = useState(true)

  // Download Folder & Options demonstration state
  const [downloadFolder, setDownloadFolder] = useState('C:\\Users\\YourName\\Downloads\\MultiMedia')
  const [folderOptions, setFolderOptions] = useState({
    subfolderPerPlatform: true,
    subfolderPerVideo: true,
    useOriginalTitle: true,
    askLocationBeforeDownload: false
  })

  const toggleFolderOption = (key) => {
    setFolderOptions((prev) => ({ ...prev, [key]: !prev[key] }))
  }

  // Icon mapping for left sub-navigation menu
  const sectionIcons = {
    general: SettingsIcon,
    download: Download,
    quality: Sliders,
    audio: Music,
    advanced: Cpu,
    appearance: Palette,
    shortcuts: Keyboard,
    privacy: Shield,
    about: Info
  }

  return (
    <div className="p-6 lg:p-8 max-w-[1400px] w-full mx-auto flex flex-col gap-6 select-none animate-fadeIn">
      {/* ----------------- TOP HEADER ----------------- */}
      <div>
        <div className="flex items-center gap-3">
          <h1 className="text-3xl lg:text-4xl font-extrabold text-white tracking-tight">
            Settings
          </h1>
          <span className="text-[10px] font-bold tracking-wider px-2 py-0.5 rounded-full bg-primary/10 text-primary border border-primary/20 uppercase">
            Preview
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
                {activeSection} Preferences Standby
              </span>
              <p className="text-xs text-text-muted max-w-md">
                Detailed configuration options for {activeSection} will be integrated in later
                roadmap steps.
              </p>
              <button
                onClick={() => setActiveSection('general')}
                className="mt-3 px-4 py-1.5 rounded-xl text-xs font-bold bg-primary/10 hover:bg-primary/20 text-primary border border-primary/25 cursor-pointer transition-all"
              >
                Return to General Settings
              </button>
            </div>
          ) : (
            <>
              {/* Top Row: General Settings Card + Default Folder Card */}
              <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                {/* Card 1: General Settings (Problem 08: preview demonstration controls) */}
                <div className="p-5 lg:p-6 rounded-2xl bg-[#07152E]/90 border border-primary/20 shadow-[0_4px_24px_rgba(0,0,0,0.35)] backdrop-blur-md flex flex-col gap-5">
                  {/* Card Header */}
                  <div className="flex items-center gap-3">
                    <div className="w-9 h-9 rounded-xl bg-cyan-500/15 text-[#19D8FF] flex items-center justify-center">
                      <SettingsIcon className="w-5 h-5" />
                    </div>
                    <div>
                      <h2 className="text-sm font-extrabold text-white">General Settings</h2>
                      <p className="text-[11px] text-text-muted">Basic application preferences</p>
                    </div>
                  </div>

                  {/* Setting Item: Application Language */}
                  <div className="flex items-center justify-between gap-4 pt-1">
                    <div>
                      <span className="text-xs font-bold text-white block">
                        Application Language
                      </span>
                      <span className="text-[11px] text-text-muted">
                        Choose your preferred language
                      </span>
                    </div>
                    <select
                      value={language}
                      onChange={(e) => setLanguage(e.target.value)}
                      className="bg-[#040B1C] border border-primary/20 rounded-xl px-3 py-1.5 text-xs font-semibold text-white focus:outline-none focus:border-primary cursor-pointer"
                    >
                      <option value="English">English</option>
                      <option value="Spanish">Spanish</option>
                      <option value="French">French</option>
                      <option value="German">German</option>
                      <option value="Sinhala">Sinhala (සිංහල)</option>
                    </select>
                  </div>

                  {/* Setting Item: Start with Windows */}
                  <div className="flex items-center justify-between gap-4 pt-1 border-t border-primary/10">
                    <div>
                      <span className="text-xs font-bold text-white block">Start with Windows</span>
                      <span className="text-[11px] text-text-muted">
                        Launch app automatically when Windows starts
                      </span>
                    </div>
                    <ToggleSwitch
                      id="toggle-start-windows"
                      checked={startWithWindows}
                      onChange={setStartWithWindows}
                    />
                  </div>

                  {/* Setting Item: Minimize to System Tray */}
                  <div className="flex items-center justify-between gap-4 pt-1 border-t border-primary/10">
                    <div>
                      <span className="text-xs font-bold text-white block">
                        Minimize to System Tray
                      </span>
                      <span className="text-[11px] text-text-muted">
                        Keep app running in background
                      </span>
                    </div>
                    <ToggleSwitch
                      id="toggle-minimize-tray"
                      checked={minimizeToTray}
                      onChange={setMinimizeToTray}
                    />
                  </div>

                  {/* Setting Item: Show Notifications */}
                  <div className="flex items-center justify-between gap-4 pt-1 border-t border-primary/10">
                    <div>
                      <span className="text-xs font-bold text-white block">Show Notifications</span>
                      <span className="text-[11px] text-text-muted">
                        Show download completion notifications
                      </span>
                    </div>
                    <ToggleSwitch
                      id="toggle-show-notifs"
                      checked={showNotifications}
                      onChange={setShowNotifications}
                    />
                  </div>

                  {/* Setting Item: Check for Updates */}
                  <div className="flex items-center justify-between gap-4 pt-1 border-t border-primary/10">
                    <div>
                      <span className="text-xs font-bold text-white block">Check for Updates</span>
                      <span className="text-[11px] text-text-muted">
                        Automatically check for new version
                      </span>
                    </div>
                    <ToggleSwitch
                      id="toggle-check-updates"
                      checked={checkForUpdates}
                      onChange={setCheckForUpdates}
                    />
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
                  <div className="flex items-center gap-2">
                    <input
                      type="text"
                      value={downloadFolder}
                      onChange={(e) => setDownloadFolder(e.target.value)}
                      className="flex-1 bg-[#040B1C] border border-primary/20 rounded-xl py-2 px-3 text-xs text-text-muted font-mono focus:outline-none focus:border-primary"
                    />
                    <button
                      type="button"
                      title="Folder chooser will be connected in Step 05.12"
                      className="px-4 py-2 rounded-xl text-xs font-bold bg-gradient-to-r from-[#19D8FF] to-[#3388FF] text-white shadow-[0_0_12px_rgba(25,216,255,0.3)] hover:shadow-[0_0_18px_rgba(25,216,255,0.45)] transition-all cursor-pointer flex-shrink-0"
                    >
                      Change
                    </button>
                  </div>

                  {/* Folder Options Checkboxes */}
                  <div className="flex flex-col gap-3 pt-2">
                    <span className="text-xs font-bold text-white uppercase tracking-wider text-[10px] text-text-muted">
                      Folder Options
                    </span>

                    {/* Option 1 */}
                    <label className="flex items-center gap-2.5 text-xs text-text-muted hover:text-white cursor-pointer select-none">
                      <div
                        onClick={() => toggleFolderOption('subfolderPerPlatform')}
                        className={`w-4 h-4 rounded border flex items-center justify-center transition-all ${
                          folderOptions.subfolderPerPlatform
                            ? 'bg-[#19D8FF] border-[#19D8FF] text-[#040B1C]'
                            : 'border-primary/30 bg-[#040B1C]'
                        }`}
                      >
                        {folderOptions.subfolderPerPlatform && (
                          <Check className="w-3 h-3 stroke-[3]" />
                        )}
                      </div>
                      <span>Create subfolder for each platform</span>
                    </label>

                    {/* Option 2 */}
                    <label className="flex items-center gap-2.5 text-xs text-text-muted hover:text-white cursor-pointer select-none">
                      <div
                        onClick={() => toggleFolderOption('subfolderPerVideo')}
                        className={`w-4 h-4 rounded border flex items-center justify-center transition-all ${
                          folderOptions.subfolderPerVideo
                            ? 'bg-[#19D8FF] border-[#19D8FF] text-[#040B1C]'
                            : 'border-primary/30 bg-[#040B1C]'
                        }`}
                      >
                        {folderOptions.subfolderPerVideo && (
                          <Check className="w-3 h-3 stroke-[3]" />
                        )}
                      </div>
                      <span>Create subfolder for each video</span>
                    </label>

                    {/* Option 3 */}
                    <label className="flex items-center gap-2.5 text-xs text-text-muted hover:text-white cursor-pointer select-none">
                      <div
                        onClick={() => toggleFolderOption('useOriginalTitle')}
                        className={`w-4 h-4 rounded border flex items-center justify-center transition-all ${
                          folderOptions.useOriginalTitle
                            ? 'bg-[#19D8FF] border-[#19D8FF] text-[#040B1C]'
                            : 'border-primary/30 bg-[#040B1C]'
                        }`}
                      >
                        {folderOptions.useOriginalTitle && <Check className="w-3 h-3 stroke-[3]" />}
                      </div>
                      <span>Use original video title as filename</span>
                    </label>

                    {/* Option 4 */}
                    <label className="flex items-center gap-2.5 text-xs text-text-muted hover:text-white cursor-pointer select-none">
                      <div
                        onClick={() => toggleFolderOption('askLocationBeforeDownload')}
                        className={`w-4 h-4 rounded border flex items-center justify-center transition-all ${
                          folderOptions.askLocationBeforeDownload
                            ? 'bg-[#19D8FF] border-[#19D8FF] text-[#040B1C]'
                            : 'border-primary/30 bg-[#040B1C]'
                        }`}
                      >
                        {folderOptions.askLocationBeforeDownload && (
                          <Check className="w-3 h-3 stroke-[3]" />
                        )}
                      </div>
                      <span>Ask for folder location before downloading</span>
                    </label>
                  </div>
                </div>
              </div>

              {/* Card 3: Storage Information (Problem 03: Fixed Properties from SETTINGS_STORAGE_INFO) */}
              <div className="p-5 lg:p-6 rounded-2xl bg-[#07152E]/90 border border-primary/20 shadow-[0_4px_24px_rgba(0,0,0,0.35)] backdrop-blur-md flex flex-col gap-4">
                {/* Header */}
                <div className="flex items-center gap-3">
                  <div className="w-9 h-9 rounded-xl bg-cyan-500/15 text-[#19D8FF] flex items-center justify-center">
                    <HardDrive className="w-5 h-5" />
                  </div>
                  <div>
                    <h2 className="text-sm font-extrabold text-white">Storage Information</h2>
                    <p className="text-[11px] text-text-muted">
                      Disk space usage for downloaded files
                    </p>
                  </div>
                </div>

                {/* Glowing Progress Bar */}
                <div className="flex flex-col gap-2 pt-1">
                  <div className="w-full h-3 rounded-full bg-[#040B1C] overflow-hidden border border-primary/20">
                    <div
                      className="h-full bg-gradient-to-r from-[#19D8FF] to-[#3388FF] rounded-full shadow-[0_0_12px_rgba(25,216,255,0.5)]"
                      style={{ width: `${SETTINGS_STORAGE_INFO.percentUsed}%` }}
                    />
                  </div>

                  {/* Captions with actual GB values */}
                  <div className="flex items-center justify-between text-xs text-text-muted font-medium">
                    <span>
                      <strong className="text-white">{SETTINGS_STORAGE_INFO.usedGB} GB</strong> used
                      of {SETTINGS_STORAGE_INFO.totalGB} GB ({SETTINGS_STORAGE_INFO.percentUsed}%)
                    </span>
                    <span className="text-[#00DEA5] font-semibold">
                      {SETTINGS_STORAGE_INFO.freeGB} GB free
                    </span>
                  </div>
                </div>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  )
}
