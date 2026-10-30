import { useLocation } from 'react-router-dom'
import { Play, Music, Film } from 'lucide-react'

/**
 * Dynamic Decorative Artwork at the bottom of the Sidebar.
 * - Route '/' (Downloader): Neon blue mountainous landscape matching Reference Image 1.
 * - Routes '/downloads', '/history', '/settings': Floating 3D media tiles with cosmic neon swirl matching Reference Images 2, 3 & 4.
 */
export default function SidebarDecoration() {
  const location = useLocation()
  const isDownloader = location.pathname === '/'

  if (isDownloader) {
    return (
      <div className="w-full h-36 relative overflow-hidden pointer-events-none select-none rounded-xl mt-2">
        {/* Sky Ambient Glow */}
        <div className="absolute inset-0 bg-gradient-to-t from-[#091D42] via-[#040B1C]/80 to-transparent" />
        <div className="absolute top-2 left-1/2 -translate-x-1/2 w-32 h-16 bg-[#19D8FF]/15 blur-2xl rounded-full" />

        {/* Mountain Range Illustration SVG */}
        <svg
          viewBox="0 0 240 140"
          className="w-full h-full object-cover absolute bottom-0 left-0"
          preserveAspectRatio="none"
        >
          <defs>
            <linearGradient id="mntGlow1" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="#19D8FF" stopOpacity="0.85" />
              <stop offset="60%" stopColor="#0B2352" stopOpacity="0.95" />
              <stop offset="100%" stopColor="#040B1C" stopOpacity="1" />
            </linearGradient>
            <linearGradient id="mntGlow2" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="#3388FF" stopOpacity="0.6" />
              <stop offset="100%" stopColor="#06132D" stopOpacity="0.9" />
            </linearGradient>
            <linearGradient id="ridgeLine" x1="0" y1="0" x2="1" y2="0">
              <stop offset="0%" stopColor="#19D8FF" stopOpacity="0.3" />
              <stop offset="50%" stopColor="#19D8FF" stopOpacity="1" />
              <stop offset="100%" stopColor="#514BFF" stopOpacity="0.4" />
            </linearGradient>
          </defs>

          {/* Background Mountain Peaks */}
          <polygon
            points="10,140 60,65 110,105 160,50 200,90 240,140"
            fill="url(#mntGlow2)"
            opacity="0.6"
          />

          {/* Foreground Mountain Ridges */}
          <polygon
            points="-10,140 40,75 90,110 140,55 190,100 240,65 260,140"
            fill="url(#mntGlow1)"
          />

          {/* Electric Neon Ridge Highlights */}
          <polyline
            points="40,75 90,110 140,55 190,100 240,65"
            fill="none"
            stroke="url(#ridgeLine)"
            strokeWidth="2"
            strokeLinecap="round"
          />
          <polyline
            points="40,75 55,140"
            fill="none"
            stroke="#19D8FF"
            strokeWidth="0.8"
            strokeOpacity="0.4"
          />
          <polyline
            points="140,55 155,140"
            fill="none"
            stroke="#19D8FF"
            strokeWidth="0.8"
            strokeOpacity="0.4"
          />

          {/* Distant Star specks */}
          <circle cx="45" cy="25" r="0.9" fill="#F4F8FF" opacity="0.8" />
          <circle cx="110" cy="18" r="1.1" fill="#19D8FF" opacity="0.9" />
          <circle cx="175" cy="28" r="0.8" fill="#F4F8FF" opacity="0.7" />
          <circle cx="215" cy="15" r="1" fill="#19D8FF" opacity="0.8" />
        </svg>
      </div>
    )
  }

  // Routes: /downloads, /history, /settings (Cosmic Swirl + Floating Media Badges)
  return (
    <div className="w-full h-36 relative overflow-visible pointer-events-none select-none flex items-center justify-center mt-2">
      {/* Background Cosmic Glow */}
      <div className="absolute w-28 h-28 bg-[#514BFF]/25 blur-2xl rounded-full" />
      <div className="absolute w-20 h-20 bg-[#19D8FF]/20 blur-xl rounded-full" />

      {/* Radiant Neon Energy Swirl Ring SVG */}
      <svg viewBox="0 0 160 120" className="w-36 h-28 overflow-visible absolute">
        <defs>
          <linearGradient id="swirlGrad" x1="0%" y1="0%" x2="100%" y2="100%">
            <stop offset="0%" stopColor="#19D8FF" stopOpacity="0.9" />
            <stop offset="50%" stopColor="#514BFF" stopOpacity="0.7" />
            <stop offset="100%" stopColor="#19D8FF" stopOpacity="0.1" />
          </linearGradient>
        </defs>
        {/* Orbital Ring 1 */}
        <ellipse
          cx="80"
          cy="60"
          rx="68"
          ry="32"
          fill="none"
          stroke="url(#swirlGrad)"
          strokeWidth="2.5"
          transform="rotate(-20 80 60)"
          strokeDasharray="140 20"
        />
        {/* Orbital Ring 2 */}
        <ellipse
          cx="80"
          cy="60"
          rx="52"
          ry="22"
          fill="none"
          stroke="#19D8FF"
          strokeWidth="1.2"
          strokeOpacity="0.5"
          transform="rotate(-15 80 60)"
        />
      </svg>

      {/* Floating 3D Frosted Media Tiles */}
      {/* Tile 1: Video Play */}
      <div className="absolute top-2 left-6 z-10 w-11 h-11 rounded-2xl bg-[#0F2654]/85 border border-cyan-400/40 shadow-[0_0_16px_rgba(25,216,255,0.4)] backdrop-blur-md flex items-center justify-center transform -rotate-12">
        <Play className="w-5 h-5 text-cyan-300 fill-cyan-400/30 ml-0.5" />
      </div>

      {/* Tile 2: Music Note */}
      <div className="absolute top-6 right-5 z-20 w-10 h-10 rounded-2xl bg-[#122B60]/90 border border-blue-400/40 shadow-[0_0_14px_rgba(51,136,255,0.4)] backdrop-blur-md flex items-center justify-center transform rotate-12">
        <Music className="w-4 h-4 text-cyan-200" />
      </div>

      {/* Tile 3: Film Clapper */}
      <div className="absolute bottom-2 left-10 z-20 w-10 h-10 rounded-2xl bg-[#15234D]/90 border border-indigo-400/40 shadow-[0_0_14px_rgba(81,75,255,0.4)] backdrop-blur-md flex items-center justify-center transform -rotate-6">
        <Film className="w-4 h-4 text-indigo-300" />
      </div>
    </div>
  )
}

