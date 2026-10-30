import { NavLink, Outlet } from 'react-router-dom'
import { Download, ListCollapse, History, Settings, Sparkles, CheckCircle2 } from 'lucide-react'
import officialLogo from '../../assets/branding/official-cloud-logo-transparent.png'

/**
 * Main application layout matching the attached dark navy & electric cyan UI design.
 * Houses the persistent branded sidebar, live backend health badge, and main route view.
 */
export default function MainLayout({ onOpenSplashPreview = null }) {
  const navItems = [
    { to: '/', label: 'Downloader', icon: Download },
    { to: '/downloads', label: 'Downloads', icon: ListCollapse },
    { to: '/history', label: 'History', icon: History },
    { to: '/settings', label: 'Settings', icon: Settings }
  ]

  return (
    <div className="flex h-screen w-screen overflow-hidden bg-[#040B1C] text-text font-sans">
      {/* ----------------- LEFT SIDEBAR ----------------- */}
      <aside className="w-64 flex flex-col justify-between border-r border-primary/10 bg-[#07152E]/90 backdrop-blur-xl p-5 select-none relative z-20">
        <div>
          {/* Official Branding Header */}
          <div className="flex flex-col items-center text-center pb-6 border-b border-primary/10">
            <div className="relative flex items-center justify-center w-20 h-20 mb-2 rounded-2xl bg-surface/60 border border-primary/20 shadow-[0_0_20px_rgba(25,216,255,0.2)]">
              <img
                src={officialLogo}
                alt="Logo"
                className="w-16 h-16 object-contain drop-shadow-[0_0_12px_rgba(25,216,255,0.7)]"
              />
            </div>
            <h1 className="text-sm font-extrabold tracking-wider text-white uppercase mt-1 leading-tight">
              Multi Media
            </h1>
            <span className="text-[11px] font-bold tracking-widest text-primary uppercase">
              Downloader
            </span>
          </div>

          {/* Navigation Links */}
          <nav className="mt-6 flex flex-col gap-2">
            {navItems.map((item) => {
              const Icon = item.icon
              return (
                <NavLink
                  key={item.to}
                  to={item.to}
                  className={({ isActive }) =>
                    `flex items-center gap-3.5 px-4 py-3 rounded-xl text-sm font-semibold transition-all duration-200 ${
                      isActive
                        ? 'bg-gradient-to-r from-primary to-accent text-secondary shadow-[0_0_18px_rgba(25,216,255,0.4)]'
                        : 'text-text-muted hover:text-white hover:bg-surface-elevated/50'
                    }`
                  }
                >
                  <Icon className="w-5 h-5 flex-shrink-0" />
                  <span>{item.label}</span>
                </NavLink>
              )
            })}
          </nav>
        </div>

        {/* Sidebar Footer: Media Badges & Dev Tools */}
        <div className="pt-4 border-t border-primary/10 flex flex-col gap-3">
          {/* Backend Connection Indicator */}
          <div className="flex items-center justify-between px-3 py-2 rounded-lg bg-surface/40 border border-primary/10 text-xs text-text-muted">
            <div className="flex items-center gap-2">
              <span className="relative flex h-2 w-2">
                <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-success opacity-75"></span>
                <span className="relative inline-flex rounded-full h-2 w-2 bg-success"></span>
              </span>
              <span className="text-[11px] font-medium text-text-muted">API Connected</span>
            </div>
            <CheckCircle2 className="w-3.5 h-3.5 text-success" />
          </div>

          {/* Development Splash Screen Preview Button */}
          {onOpenSplashPreview && (
            <button
              onClick={onOpenSplashPreview}
              className="w-full flex items-center justify-center gap-1.5 py-1.5 px-3 rounded-lg text-xs font-semibold text-primary/80 hover:text-primary bg-primary/5 hover:bg-primary/10 border border-primary/20 transition-all"
              title="Preview the startup Splash Screen"
            >
              <Sparkles className="w-3.5 h-3.5" />
              <span>Preview Splash</span>
            </button>
          )}

          <div className="text-[10px] text-text-muted/50 text-center tracking-wider">
            APPLAN2 Desktop v1.0.0
          </div>
        </div>
      </aside>

      {/* ----------------- MAIN CONTENT AREA ----------------- */}
      <main className="flex-1 flex flex-col h-full overflow-y-auto bg-[#040B1C] relative z-10">
        <Outlet />
      </main>
    </div>
  )
}

