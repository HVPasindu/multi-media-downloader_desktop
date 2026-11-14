import {
  Info,
  Code2,
  Layers,
  Cpu,
  Monitor,
  Terminal,
  Server,
  Database,
  Download,
  Film,
  ShieldCheck,
  Package
} from 'lucide-react'
import { version as packageVersion } from '../../../../../package.json'
import officialLogo from '../../assets/branding/official-cloud-logo-transparent.png'

const APP_DESCRIPTION =
  'A desktop application designed to analyze and download supported online media, offering flexible video and audio format selection and centralized download management.'

const TECHNOLOGY_STACK = [
  { name: 'Electron', role: 'Desktop Application Shell', icon: Monitor },
  { name: 'React', role: 'Renderer User Interface', icon: Code2 },
  { name: 'Node.js', role: 'Main & Service Runtime', icon: Terminal },
  { name: 'Express.js', role: 'Local API Server', icon: Server },
  { name: 'SQLite', role: 'Local Database Storage', icon: Database },
  { name: 'yt-dlp', role: 'Media Extraction Engine', icon: Download },
  { name: 'FFmpeg', role: 'Media & Audio Processing', icon: Film }
]

/**
 * Formats an OS platform string into a readable label without inventing hardware details.
 */
function formatPlatformLabel(platform) {
  if (platform === 'win32') return 'Windows (win32)'
  if (platform === 'darwin') return 'macOS (darwin)'
  if (platform === 'linux') return 'Linux (linux)'
  return platform
}

/**
 * Reads runtime versions and platform safely from the existing preload-exposed Electron API.
 */
function getSafeRuntimeInfo() {
  if (typeof window === 'undefined') return null
  const electronProcess = window.electron?.process
  if (!electronProcess || typeof electronProcess !== 'object') return null

  const versions = electronProcess.versions || {}
  const electron =
    typeof versions.electron === 'string' && versions.electron.trim()
      ? versions.electron.trim()
      : null
  const chrome =
    typeof versions.chrome === 'string' && versions.chrome.trim() ? versions.chrome.trim() : null
  const node =
    typeof versions.node === 'string' && versions.node.trim() ? versions.node.trim() : null
  const platform =
    typeof electronProcess.platform === 'string' && electronProcess.platform.trim()
      ? formatPlatformLabel(electronProcess.platform.trim())
      : null

  if (!electron && !chrome && !node && !platform) return null

  return { electron, chrome, node, platform }
}

/**
 * Settings -> About Component
 *
 * Displays:
 * 1. Application Overview (Identity, dynamic version, description)
 * 2. Developer Information (Author & role)
 * 3. Technology Stack (Verified core stack used by the app)
 * 4. Application Version Information (Dynamic metadata & safe Electron runtime info)
 */
export default function AboutSettings() {
  const appVersion =
    typeof packageVersion === 'string' && packageVersion.trim() ? packageVersion.trim() : null
  const formattedVersion = appVersion ? `v${appVersion}` : 'Unavailable'
  const runtimeInfo = getSafeRuntimeInfo()

  const runtimeItems = [
    { label: 'Application Version', value: formattedVersion },
    ...(runtimeInfo?.electron ? [{ label: 'Electron', value: `v${runtimeInfo.electron}` }] : []),
    ...(runtimeInfo?.chrome ? [{ label: 'Chromium', value: `v${runtimeInfo.chrome}` }] : []),
    ...(runtimeInfo?.node ? [{ label: 'Node.js', value: `v${runtimeInfo.node}` }] : []),
    ...(runtimeInfo?.platform ? [{ label: 'Platform', value: runtimeInfo.platform }] : [])
  ]

  return (
    <div className="flex flex-col gap-6 min-w-0">
      {/* ================= CARD 1: APPLICATION OVERVIEW ================= */}
      <div className="p-5 lg:p-6 rounded-2xl bg-surface/90 border border-primary/20 shadow-[0_4px_24px_rgba(0,0,0,0.35)] backdrop-blur-md flex flex-col gap-5">
        <div className="flex items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <div
              className="w-9 h-9 rounded-xl flex items-center justify-center flex-shrink-0"
              style={{
                backgroundColor: 'rgba(var(--theme-primary-rgb), 0.15)',
                color: 'var(--theme-primary)'
              }}
            >
              <Info className="w-5 h-5" />
            </div>
            <div>
              <h2 className="text-sm font-extrabold text-text">Application Overview</h2>
              <p className="text-[11px] text-text-muted">Product identity and overview</p>
            </div>
          </div>

          <span className="theme-accent-gradient-2 theme-accent-glow-sm text-on-gradient text-[11px] font-mono font-bold px-2.5 py-1 rounded-full flex-shrink-0">
            {formattedVersion}
          </span>
        </div>

        <div className="p-4 rounded-xl bg-background/90 border border-primary/15 flex flex-col sm:flex-row items-start sm:items-center gap-4">
          <div className="w-16 h-16 rounded-2xl bg-surface/90 border border-primary/30 shadow-[0_0_20px_rgba(var(--theme-primary-rgb),0.25)] flex items-center justify-center flex-shrink-0">
            <img
              src={officialLogo}
              alt="Multi Media Downloader"
              className="w-12 h-12 object-contain drop-shadow-[0_0_12px_rgba(var(--theme-primary-rgb),0.75)]"
            />
          </div>

          <div className="flex-1 min-w-0 flex flex-col gap-1">
            <div className="flex flex-wrap items-center gap-2">
              <h3 className="text-base font-extrabold text-text tracking-tight">
                Multi Media Downloader
              </h3>
              <span className="text-[11px] font-mono font-semibold text-text-muted">
                {formattedVersion}
              </span>
            </div>
            <p className="text-xs text-text-muted leading-relaxed">{APP_DESCRIPTION}</p>
          </div>
        </div>
      </div>

      {/* ================= CARD 2: DEVELOPER INFORMATION ================= */}
      <div className="p-5 lg:p-6 rounded-2xl bg-surface/90 border border-primary/20 shadow-[0_4px_24px_rgba(0,0,0,0.35)] backdrop-blur-md flex flex-col gap-5">
        <div className="flex items-center gap-3">
          <div
            className="w-9 h-9 rounded-xl flex items-center justify-center flex-shrink-0"
            style={{
              backgroundColor: 'rgba(var(--theme-primary-rgb), 0.15)',
              color: 'var(--theme-primary)'
            }}
          >
            <Code2 className="w-5 h-5" />
          </div>
          <div>
            <h2 className="text-sm font-extrabold text-text">Developer Information</h2>
            <p className="text-[11px] text-text-muted">Application author and development credit</p>
          </div>
        </div>

        <div className="p-4 rounded-xl bg-background/90 border border-primary/15 flex items-center gap-4">
          <div className="w-12 h-12 rounded-xl theme-accent-gradient theme-accent-glow text-on-gradient flex items-center justify-center flex-shrink-0">
            <Code2 className="w-6 h-6" />
          </div>

          <div className="min-w-0 flex flex-col gap-0.5">
            <span className="text-[10px] font-bold tracking-widest uppercase text-text-muted">
              DEVELOPED BY
            </span>
            <p className="text-base font-extrabold text-text tracking-tight break-words">
              H.V.P.M. Jayarathna
            </p>
            <span className="text-xs font-semibold text-text-muted">Role: Software Developer</span>
          </div>
        </div>
      </div>

      {/* ================= CARD 3: TECHNOLOGY STACK ================= */}
      <div className="p-5 lg:p-6 rounded-2xl bg-surface/90 border border-primary/20 shadow-[0_4px_24px_rgba(0,0,0,0.35)] backdrop-blur-md flex flex-col gap-5">
        <div className="flex items-center gap-3">
          <div
            className="w-9 h-9 rounded-xl flex items-center justify-center flex-shrink-0"
            style={{
              backgroundColor: 'rgba(var(--theme-primary-rgb), 0.15)',
              color: 'var(--theme-primary)'
            }}
          >
            <Layers className="w-5 h-5" />
          </div>
          <div>
            <h2 className="text-sm font-extrabold text-text">Technology Stack</h2>
            <p className="text-[11px] text-text-muted">
              Core frameworks and tools powering the app
            </p>
          </div>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
          {TECHNOLOGY_STACK.map((tech) => {
            const TechIcon = tech.icon
            return (
              <div
                key={tech.name}
                className="p-3.5 rounded-xl bg-background/90 border border-primary/15 hover:border-primary/35 transition-all flex items-center gap-3 min-w-0"
              >
                <div
                  className="w-8 h-8 rounded-lg flex items-center justify-center flex-shrink-0"
                  style={{
                    backgroundColor: 'rgba(var(--theme-primary-rgb), 0.12)',
                    color: 'var(--theme-primary)'
                  }}
                >
                  <TechIcon className="w-4 h-4" />
                </div>
                <div className="min-w-0 flex flex-col">
                  <span className="text-xs font-extrabold text-text truncate">{tech.name}</span>
                  <span className="text-[11px] text-text-muted truncate">{tech.role}</span>
                </div>
              </div>
            )
          })}
        </div>
      </div>

      {/* ================= CARD 4: APPLICATION VERSION INFORMATION ================= */}
      <div className="p-5 lg:p-6 rounded-2xl bg-surface/90 border border-primary/20 shadow-[0_4px_24px_rgba(0,0,0,0.35)] backdrop-blur-md flex flex-col gap-5">
        <div className="flex items-center gap-3">
          <div
            className="w-9 h-9 rounded-xl flex items-center justify-center flex-shrink-0"
            style={{
              backgroundColor: 'rgba(var(--theme-primary-rgb), 0.15)',
              color: 'var(--theme-primary)'
            }}
          >
            <Package className="w-5 h-5" />
          </div>
          <div>
            <h2 className="text-sm font-extrabold text-text">Application Version Information</h2>
            <p className="text-[11px] text-text-muted">
              Package release metadata and runtime environment
            </p>
          </div>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          {runtimeItems.map((item) => (
            <div
              key={item.label}
              className="p-3.5 rounded-xl bg-background/90 border border-primary/15 flex items-center justify-between gap-3 min-w-0"
            >
              <span className="text-xs font-semibold text-text-muted truncate">{item.label}</span>
              <span className="text-xs font-mono font-bold text-text flex-shrink-0">
                {item.value}
              </span>
            </div>
          ))}

          {!runtimeInfo && (
            <div className="p-3.5 rounded-xl bg-background/90 border border-primary/15 flex items-center justify-between gap-3 min-w-0">
              <span className="text-xs font-semibold text-text-muted truncate">
                Runtime Environment
              </span>
              <span className="text-xs font-mono font-bold text-text flex items-center gap-1.5 flex-shrink-0">
                <Cpu className="w-3.5 h-3.5 text-primary" />
                <span>Web Context</span>
              </span>
            </div>
          )}
        </div>

        <div className="p-3.5 rounded-xl bg-background/90 border border-primary/15 flex items-start gap-3">
          <ShieldCheck className="w-4 h-4 text-primary flex-shrink-0 mt-0.5" />
          <p className="text-xs text-text-muted leading-relaxed">
            Multi Media Downloader runs media URL analysis, download queue scheduling, and download
            history management locally through its integrated Electron and Express desktop
            architecture.
          </p>
        </div>
      </div>
    </div>
  )
}
