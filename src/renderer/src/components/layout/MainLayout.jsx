import { useRef, useEffect } from 'react'
import { NavLink, Outlet, useLocation } from 'react-router-dom'
import { Download, ListCollapse, History, Settings, Sparkles } from 'lucide-react'
import officialLogo from '../../assets/branding/official-cloud-logo-transparent.png'
import SidebarDecoration from './SidebarDecoration'
import { DOWNLOADS_MANAGER_LIST } from '../../data/uiPreviewData'

/**
 * Main application layout matching the attached dark navy & electric cyan UI design.
 * Houses the persistent branded sidebar with dynamic decorative artwork,
 * slim window title bar, and the main page router outlet with scroll restoration.
 */
export default function MainLayout({ onOpenSplashPreview = null }) {
  const location = useLocation()
  const mainContentRef = useRef(null)

  // Step 05.02: Reset main scroll container to top whenever the route changes
  useEffect(() => {
    if (mainContentRef.current) {
      mainContentRef.current.scrollTop = 0
    }
  }, [location.pathname])

  // Derive active downloads badge count dynamically from preview dataset
  // Counts items currently in downloading or finalizing state
  const activePreviewCount = DOWNLOADS_MANAGER_LIST.filter(
    (item) => item.status === 'downloading' || item.status === 'finalizing'
  ).length

  const navItems = [
    { to: '/', label: 'Downloader', icon: Download },
    {
      to: '/downloads',
      label: 'Downloads',
      icon: ListCollapse,
      badge: activePreviewCount > 0 ? String(activePreviewCount) : null
    },
    { to: '/history', label: 'History', icon: History },
    { to: '/settings', label: 'Settings', icon: Settings }
  ]

  return (
    <div className="flex flex-col h-screen w-screen overflow-hidden bg-[#040B1C] text-text font-sans select-none">
      {/* ----------------- TOP SLIM TITLE BAR ----------------- */}
      <header className="h-9 w-full bg-[#061226]/90 border-b border-primary/10 flex items-center justify-between px-3 select-none z-30 flex-shrink-0">
        <div className="flex items-center gap-2">
          <img
            src={officialLogo}
            alt="Logo"
            className="w-4 h-4 object-contain drop-shadow-[0_0_6px_rgba(25,216,255,0.7)]"
          />
          <span className="text-xs font-semibold text-text-muted tracking-wide">
            Multi Media Downloader
          </span>
        </div>

        {/* Development-only Splash Preview Button */}
        {/* Native OS window controls are used exclusively */}
        <div className="flex items-center gap-2">
          {import.meta.env.DEV && onOpenSplashPreview && (
            <button
              onClick={onOpenSplashPreview}
              className="flex items-center gap-1 px-2 py-0.5 rounded text-[10px] font-semibold text-primary/80 hover:text-primary bg-primary/10 hover:bg-primary/20 border border-primary/20 transition-all cursor-pointer"
              title="Preview Startup Splash Screen (Development Only)"
            >
              <Sparkles className="w-3 h-3" />
              <span>Splash Preview</span>
            </button>
          )}
        </div>
      </header>

      {/* ----------------- BODY: SIDEBAR + MAIN VIEW ----------------- */}
      <div className="flex flex-1 overflow-hidden">
        {/* ----------------- LEFT SIDEBAR ----------------- */}
        <aside className="w-64 flex flex-col justify-between border-r border-primary/10 bg-[#07152E]/95 backdrop-blur-xl p-4 select-none relative z-20 flex-shrink-0">
          <div>
            {/* Official Branding Header */}
            <div className="flex flex-col items-center text-center pb-5 pt-1">
              <div className="relative flex items-center justify-center w-20 h-20 mb-2 rounded-2xl bg-surface/80 border border-primary/30 shadow-[0_0_24px_rgba(25,216,255,0.25)]">
                <img
                  src={officialLogo}
                  alt="Multi Media Downloader"
                  className="w-16 h-16 object-contain drop-shadow-[0_0_14px_rgba(25,216,255,0.8)]"
                />
              </div>
              <h1 className="text-sm font-extrabold tracking-wider text-white uppercase mt-1 leading-tight">
                Multi Media
              </h1>
              <span className="text-[11px] font-bold tracking-widest text-[#19D8FF] uppercase">
                Downloader
              </span>
            </div>

            {/* Navigation Links */}
            <nav className="mt-4 flex flex-col gap-2">
              {navItems.map((item) => {
                const Icon = item.icon
                const isActive =
                  item.to === '/'
                    ? location.pathname === '/'
                    : location.pathname.startsWith(item.to)

                return (
                  <NavLink
                    key={item.to}
                    to={item.to}
                    className={`flex items-center justify-between px-4 py-3 rounded-xl text-sm font-bold transition-all duration-200 ${
                      isActive
                        ? 'bg-gradient-to-r from-[#19D8FF] via-[#3388FF] to-[#514BFF] text-white shadow-[0_0_20px_rgba(25,216,255,0.4)]'
                        : 'text-text-muted hover:text-white hover:bg-[#102449]/60'
                    }`}
                  >
                    <div className="flex items-center gap-3">
                      <Icon className="w-5 h-5 flex-shrink-0" />
                      <span>{item.label}</span>
                    </div>

                    {/* Dynamic Badge count */}
                    {item.badge && (
                      <span
                        className={`text-xs px-2 py-0.5 rounded-full font-bold ${
                          isActive
                            ? 'bg-white/20 text-white'
                            : 'bg-primary/20 text-[#19D8FF] border border-primary/30'
                        }`}
                      >
                        {item.badge}
                      </span>
                    )}
                  </NavLink>
                )
              })}
            </nav>
          </div>

          {/* Sidebar Bottom Decorative Artwork */}
          <div className="flex flex-col items-center justify-end">
            <SidebarDecoration />
          </div>
        </aside>

        {/* ----------------- MAIN CONTENT AREA ----------------- */}
        {/* Step 05.02: min-w-0 prevents flex overflow; ref enables scroll restoration */}
        <main
          ref={mainContentRef}
          className="flex-1 min-w-0 flex flex-col h-full overflow-y-auto bg-[#040B1C] relative z-10"
        >
          <Outlet />
        </main>
      </div>
    </div>
  )
}
