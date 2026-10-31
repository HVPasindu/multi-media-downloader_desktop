import { useState } from 'react'
import { Play, AlertCircle, Video } from 'lucide-react'

/**
 * Checks if an IPv4 address is in private, loopback, or link-local ranges.
 *
 * @param {string} ip
 * @returns {boolean}
 */
function isPrivateIpv4(ip) {
  const parts = ip.split('.').map(Number)
  if (parts.length !== 4 || parts.some((p) => isNaN(p) || p < 0 || p > 255)) {
    return true
  }

  const [a, b] = parts
  // 127.0.0.0/8 (Loopback)
  if (a === 127) return true
  // 10.0.0.0/8 (Private RFC 1918)
  if (a === 10) return true
  // 172.16.0.0/12 (Private RFC 1918)
  if (a === 172 && b >= 16 && b <= 31) return true
  // 192.168.0.0/16 (Private RFC 1918)
  if (a === 192 && b === 168) return true
  // 169.254.0.0/16 (Link-local)
  if (a === 169 && b === 254) return true
  // 0.0.0.0/8 (Current network)
  if (a === 0) return true
  // 100.64.0.0/10 (Carrier-grade NAT)
  if (a === 100 && b >= 64 && b <= 127) return true
  // 198.18.0.0/15 (Benchmarking)
  if (a === 198 && (b === 18 || b === 19)) return true
  // 224.0.0.0/4 (Multicast) & 240.0.0.0/4 (Reserved)
  if (a >= 224) return true

  return false
}

/**
 * Checks if a hostname is localhost, local domain, or private/local IP.
 * Handles both IPv4 and bracketed/raw IPv6 addresses.
 *
 * @param {string} hostname
 * @returns {boolean}
 */
function isPrivateOrLocalHost(hostname) {
  const clean = hostname.toLowerCase().trim()

  // Local and internal domain patterns
  if (
    clean === 'localhost' ||
    clean.endsWith('.localhost') ||
    clean.endsWith('.local') ||
    clean.endsWith('.internal') ||
    clean.endsWith('.lan') ||
    clean.endsWith('.localdomain') ||
    clean.endsWith('.home.arpa')
  ) {
    return true
  }

  // IPv6 bracket format: [::1], [fe80::...], [fc00::...]
  const isIpv6 = clean.startsWith('[') && clean.endsWith(']')
  const unbracketed = isIpv6 ? clean.slice(1, -1) : clean

  if (isIpv6 || unbracketed.includes(':')) {
    const v6 = unbracketed.toLowerCase()
    // Loopback & unspecified
    if (v6 === '::1' || v6 === '::' || v6 === '0:0:0:0:0:0:0:1' || v6 === '0:0:0:0:0:0:0:0') {
      return true
    }
    // Link-local: fe80::/10 (fe8, fe9, fea, feb)
    if (
      v6.startsWith('fe8') ||
      v6.startsWith('fe9') ||
      v6.startsWith('fea') ||
      v6.startsWith('feb')
    ) {
      return true
    }
    // Unique local address: fc00::/7 (fc, fd)
    if (v6.startsWith('fc') || v6.startsWith('fd')) {
      return true
    }
    // IPv4-mapped IPv6: ::ffff:192.168.1.1
    if (v6.startsWith('::ffff:')) {
      const mappedV4 = v6.replace('::ffff:', '')
      return isPrivateIpv4(mappedV4)
    }
    return false
  }

  // IPv4 check: 4 numerical octets
  if (/^\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(clean)) {
    return isPrivateIpv4(clean)
  }

  return false
}

/**
 * Validates whether a thumbnail URL is a safe, valid absolute HTTP/HTTPS URL.
 * Strictly rejects javascript:, file:, data:, blob:, credentials (user:pass),
 * localhost, loopback, and private IPv4/IPv6 addresses.
 *
 * @param {string|null|undefined} urlString
 * @returns {boolean}
 */
function isSafeThumbnailUrl(urlString) {
  if (typeof urlString !== 'string') return false
  const trimmed = urlString.trim()
  if (!trimmed) return false

  try {
    const parsed = new URL(trimmed)
    // Only allow http: and https: protocols
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
      return false
    }

    // Reject embedded user/password credentials
    if (parsed.username || parsed.password) {
      return false
    }

    // Reject localhost, loopback, and private IP addresses
    if (isPrivateOrLocalHost(parsed.hostname)) {
      return false
    }

    return true
  } catch {
    return false
  }
}

/**
 * Reusable Media Thumbnail Component.
 * Supports:
 * - Rounded preview with subtle glowing border
 * - Duration badge at bottom right (e.g. 12:35, 3:42)
 * - Play icon hover/overlay
 * - Error overlay (for missing or corrupted files)
 * - Safe image load error handling with graceful fallback placeholder
 * - Dynamic failure reset when src changes
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
  const [prevSrc, setPrevSrc] = useState(src)
  const [failedSrc, setFailedSrc] = useState(null)

  // Reset failure state directly during render when thumbnail source changes
  if (prevSrc !== src) {
    setPrevSrc(src)
    setFailedSrc(null)
  }

  const isSafe = isSafeThumbnailUrl(src)
  const isImageAvailable = isSafe && failedSrc !== src && !hasError

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
