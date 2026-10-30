import { Play, AlertCircle } from 'lucide-react'

/**
 * Reusable Media Thumbnail Component.
 * Supports:
 * - Rounded preview with subtle glowing border
 * - Duration badge at bottom right (e.g. 12:35, 3:42)
 * - Play icon hover/overlay
 * - Error overlay (for missing or corrupted files)
 */
export default function MediaThumbnail({
  src,
  alt = 'Media preview',
  duration = null,
  showPlayOverlay = false,
  hasError = false,
  className = '',
  aspectRatio = 'aspect-video'
}) {
  return (
    <div
      className={`relative overflow-hidden rounded-lg bg-[#07152E] border border-primary/20 flex-shrink-0 group ${aspectRatio} ${className}`}
    >
      {/* Base Thumbnail Image */}
      <img
        src={src}
        alt={alt}
        className={`w-full h-full object-cover transition-transform duration-300 group-hover:scale-105 ${
          hasError ? 'opacity-40 grayscale' : ''
        }`}
        loading="lazy"
      />

      {/* Play Icon Overlay */}
      {showPlayOverlay && !hasError && (
        <div className="absolute inset-0 flex items-center justify-center bg-black/30 group-hover:bg-black/20 transition-colors">
          <div className="w-8 h-8 rounded-full bg-black/60 border border-white/30 flex items-center justify-center text-white shadow-lg backdrop-blur-sm group-hover:scale-110 transition-transform">
            <Play className="w-4 h-4 fill-white ml-0.5" />
          </div>
        </div>
      )}

      {/* Error / Missing File Overlay */}
      {hasError && (
        <div className="absolute inset-0 flex items-center justify-center bg-red-950/40">
          <div className="w-7 h-7 rounded-full bg-red-600/80 border border-red-400 flex items-center justify-center text-white shadow-md">
            <AlertCircle className="w-4 h-4" />
          </div>
        </div>
      )}

      {/* Duration Badge */}
      {duration && !hasError && (
        <span className="absolute bottom-1 right-1 px-1.5 py-0.5 rounded text-[10px] font-bold text-white bg-black/80 backdrop-blur-sm border border-white/10 tracking-tight">
          {duration}
        </span>
      )}
    </div>
  )
}
