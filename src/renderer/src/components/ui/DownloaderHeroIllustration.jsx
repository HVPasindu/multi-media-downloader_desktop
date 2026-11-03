import officialLogo from '../../assets/branding/official-cloud-logo-transparent.png'
import { Play, Music, Film, Link2 } from 'lucide-react'

/**
 * 3D Pedestal & Floating Badges Hero Illustration for Downloader Page
 * Recreates the right-side visual centerpiece from Reference Image 1:
 * - Concentric glowing cyber pedestal rings with perspective slant
 * - Official illuminated cloud logo mounted in center
 * - Floating glassmorphic media badges (Play, Music, Film, Link) with gentle levitation
 */
export default function DownloaderHeroIllustration({ className = '' }) {
  return (
    <div
      className={`relative flex items-center justify-center select-none pointer-events-none ${className}`}
    >
      {/* Background radial glow */}
      <div className="absolute w-64 h-64 rounded-full bg-[#19D8FF]/10 blur-3xl -z-10 animate-pulse" />

      <div className="relative w-72 h-48 flex items-center justify-center">
        {/* Floating Glass Tile 1: Video Play (Top Left) */}
        <div className="absolute -top-1 left-4 z-20 flex items-center justify-center w-11 h-11 rounded-2xl bg-[#0B1C38]/80 border border-primary/30 shadow-[0_0_18px_rgba(25,216,255,0.3)] backdrop-blur-md animate-bounce [animation-duration:4s]">
          <Play className="w-5 h-5 text-primary fill-primary/30 ml-0.5" />
        </div>

        {/* Floating Glass Tile 2: Music Note (Middle Left) */}
        <div className="absolute bottom-6 left-0 z-20 flex items-center justify-center w-10 h-10 rounded-2xl bg-[#0B1C38]/80 border border-primary/30 shadow-[0_0_18px_rgba(25,216,255,0.3)] backdrop-blur-md animate-bounce [animation-duration:5s] [animation-delay:1s]">
          <Music className="w-4 h-4 text-primary" />
        </div>

        {/* Floating Glass Tile 3: Film Clapper (Top Right) */}
        <div className="absolute top-2 right-4 z-20 flex items-center justify-center w-11 h-11 rounded-2xl bg-[#0B1C38]/80 border border-primary/30 shadow-[0_0_18px_rgba(25,216,255,0.3)] backdrop-blur-md animate-bounce [animation-duration:4.5s] [animation-delay:0.5s]">
          <Film className="w-5 h-5 text-primary" />
        </div>

        {/* Floating Glass Tile 4: Link (Bottom Right) */}
        <div className="absolute bottom-4 right-2 z-20 flex items-center justify-center w-10 h-10 rounded-2xl bg-[#0B1C38]/80 border border-primary/30 shadow-[0_0_18px_rgba(25,216,255,0.3)] backdrop-blur-md animate-bounce [animation-duration:5.5s] [animation-delay:1.5s]">
          <Link2 className="w-4 h-4 text-primary" />
        </div>

        {/* Official Glowing Cloud Logo */}
        <div className="relative z-10 flex items-center justify-center -translate-y-3">
          <img
            src={officialLogo}
            alt="Multi Media Downloader Official Cloud"
            className="w-36 h-36 object-contain drop-shadow-[0_0_24px_rgba(25,216,255,0.85)] filter"
          />
        </div>

        {/* 3D Circular Pedestal (Base Platform) */}
        <div className="absolute bottom-0 w-64 h-16 pointer-events-none -z-0">
          <svg viewBox="0 0 240 60" className="w-full h-full overflow-visible">
            <defs>
              <linearGradient id="pedestalGrad" x1="0%" y1="0%" x2="100%" y2="0%">
                <stop offset="0%" stopColor="#07152E" stopOpacity="0.9" />
                <stop offset="50%" stopColor="#102449" stopOpacity="0.95" />
                <stop offset="100%" stopColor="#07152E" stopOpacity="0.9" />
              </linearGradient>
              <linearGradient id="ringGrad" x1="0%" y1="0%" x2="100%" y2="0%">
                <stop offset="0%" stopColor="#19D8FF" stopOpacity="0.1" />
                <stop offset="50%" stopColor="#19D8FF" stopOpacity="0.9" />
                <stop offset="100%" stopColor="#514BFF" stopOpacity="0.2" />
              </linearGradient>
            </defs>

            {/* Pedestal Base Extrusion */}
            <path
              d="M 20 28 C 20 42 70 52 120 52 C 170 52 220 42 220 28 L 220 38 C 220 50 170 58 120 58 C 70 58 20 50 20 38 Z"
              fill="#061228"
              stroke="#19D8FF"
              strokeWidth="0.8"
              strokeOpacity="0.3"
            />

            {/* Pedestal Top Disc */}
            <ellipse
              cx="120"
              cy="28"
              rx="100"
              ry="22"
              fill="url(#pedestalGrad)"
              stroke="url(#ringGrad)"
              strokeWidth="2.5"
            />

            {/* Inner Concentric Glow Ring */}
            <ellipse
              cx="120"
              cy="28"
              rx="82"
              ry="16"
              fill="none"
              stroke="#19D8FF"
              strokeWidth="1.5"
              strokeOpacity="0.6"
              strokeDasharray="6 3"
            />
          </svg>
        </div>
      </div>
    </div>
  )
}
