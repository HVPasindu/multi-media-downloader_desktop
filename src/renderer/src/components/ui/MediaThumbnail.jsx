import { useState } from 'react'
import { Play, AlertCircle, Video } from 'lucide-react'

/**
 * Reusable Media Thumbnail Component.
 * Supports:
 * - Rounded preview with subtle glowing border
 * - Duration badge at bottom right (e.g. 12:35, 3:42)
 * - Play icon hover/overlay
 * - Error overlay (for missing or corrupted files)
 * - Safe image load error handling with graceful fallback placeholder
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
  const [failedSrc, setFailedSrc] = useState(null)

  const isImageAvailable = Boolean(src) && failedSrc !== src && !hasError

  return (
    <div
      className={`relative overflow-hidden rounded-lg bg-[#07152E] border border-primary/20 flex-shrink-0 group ${aspectRatio} ${className}`}
    >
      {/* Base Thumbnail Image or Fallback */}
      {isImageAvailable ? (
        <img
          src={src}
          alt={alt}
          onError={() => setFailedSrc(src)}
          className="w-full h-full object-cover transition-transform duration-300 group-hover:scale-105"
          loading="lazy"
        />
      ) : (
        <div className="w-full h-full flex flex-col items-center justify-center bg-[#040B1C]/80 text-text-muted/50 p-2 select-none">
          <Video className="w-6 h-6 text-[#19D8FF]/60 mb-1" />
          <span className="text-[9px] font-mono tracking-wider text-text-muted/70 uppercase">
            {hasError ? 'Unavailable' : 'No Preview'}
          </span>
        </div>
      )}

      {/* Play Icon Overlay */}
      {showPlayOverlay && isImageAvailable && (
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
