/**
 * Media URL Input Validation and Drop Parsing Utility
 *
 * Provides client-side syntactic verification, security checks, platform detection,
 * and drag-and-drop link extraction for the Multi-Media Downloader application.
 *
 * NOTE: Frontend validation serves as immediate UX feedback only.
 * The backend mediaUrlSecurityService performs the definitive authoritative validation.
 */

export const MAX_URL_LENGTH = 2048

export const ALLOWED_PROTOCOLS = new Set(['http:', 'https:'])

export const SUPPORTED_PLATFORMS = {
  youtube: {
    id: 'youtube',
    name: 'YouTube',
    domains: ['youtube.com', 'youtu.be']
  },
  facebook: {
    id: 'facebook',
    name: 'Facebook',
    domains: ['facebook.com', 'fb.watch']
  },
  instagram: {
    id: 'instagram',
    name: 'Instagram',
    domains: ['instagram.com']
  },
  tiktok: {
    id: 'tiktok',
    name: 'TikTok',
    domains: ['tiktok.com']
  },
  twitter: {
    id: 'twitter',
    name: 'X (Twitter)',
    domains: ['twitter.com', 'x.com']
  }
}

/**
 * Checks whether a string contains ASCII control characters (0x00 to 0x1F, or 0x7F).
 * Avoids control regex lint restrictions by inspecting character codes.
 *
 * @param {string} str
 * @returns {boolean}
 */
export function hasControlCharacters(str) {
  if (typeof str !== 'string') return false
  for (let i = 0; i < str.length; i++) {
    const code = str.charCodeAt(i)
    if (code < 32 || code === 127) {
      return true
    }
  }
  return false
}

/**
 * Checks whether a hostname is a raw IPv4 or IPv6 address or localhost.
 *
 * @param {string} hostname
 * @returns {boolean}
 */
export function isIpOrLocalhost(hostname) {
  if (!hostname || typeof hostname !== 'string') return false

  const cleanHost = hostname.toLowerCase().trim()

  // Localhost check
  if (cleanHost === 'localhost' || cleanHost.endsWith('.localhost')) {
    return true
  }

  // IPv6 bracketed or colon-separated check
  if (cleanHost.includes(':') || cleanHost.startsWith('[')) {
    return true
  }

  // IPv4 dotted-decimal check
  const ipv4Parts = cleanHost.split('.')
  if (ipv4Parts.length === 4) {
    const isAllDigits = ipv4Parts.every((part) => /^\d{1,3}$/.test(part))
    if (isAllDigits) {
      const octets = ipv4Parts.map(Number)
      if (octets.every((o) => o >= 0 && o <= 255)) {
        return true
      }
    }
  }

  return false
}

/**
 * Detects supported media platform based on hostname.
 * Ensures strict domain matching (exact host or subdomain with dot boundary).
 *
 * @param {string} hostname
 * @returns {{ id: string, name: string } | null}
 */
export function detectPlatformFromHostname(hostname) {
  if (!hostname || typeof hostname !== 'string') return null

  let cleanHost = hostname.toLowerCase().trim()
  if (cleanHost.endsWith('.')) {
    cleanHost = cleanHost.slice(0, -1)
  }

  for (const platform of Object.values(SUPPORTED_PLATFORMS)) {
    const matched = platform.domains.some(
      (domain) => cleanHost === domain || cleanHost.endsWith(`.${domain}`)
    )
    if (matched) {
      return { id: platform.id, name: platform.name }
    }
  }

  return null
}

/**
 * Validates a candidate media URL input string.
 *
 * Returns an object with:
 * - valid: boolean
 * - url: trimmed string
 * - platform: { id: string, name: string } | null
 * - error: string | null (error message if invalid)
 * - message: string | null (success message if valid)
 *
 * @param {string} input - Raw user input from typing, clipboard, or drag-and-drop
 * @returns {{ valid: boolean, url: string, platform: { id: string, name: string } | null, error: string | null, message: string | null }}
 */
export function validateMediaUrlInput(input) {
  // 1. Input type verification
  if (typeof input !== 'string') {
    return {
      valid: false,
      url: '',
      platform: null,
      error: 'Please enter a media link.',
      message: null
    }
  }

  const trimmed = input.trim()

  // 2. Empty check
  if (!trimmed) {
    return {
      valid: false,
      url: '',
      platform: null,
      error: 'Please enter a media link.',
      message: null
    }
  }

  // 3. Length boundary check (matches backend MAX_URL_LENGTH = 2048)
  if (trimmed.length > MAX_URL_LENGTH) {
    return {
      valid: false,
      url: trimmed,
      platform: null,
      error: `URL exceeds maximum permitted length of ${MAX_URL_LENGTH} characters.`,
      message: null
    }
  }

  // 4. Control character and null byte check
  if (trimmed.includes('\0') || hasControlCharacters(trimmed)) {
    return {
      valid: false,
      url: trimmed,
      platform: null,
      error: 'URL contains invalid control characters.',
      message: null
    }
  }

  // 5. Native URL parsing
  let parsedUrl
  try {
    parsedUrl = new URL(trimmed)
  } catch {
    return {
      valid: false,
      url: trimmed,
      platform: null,
      error: 'Please enter a valid HTTP or HTTPS URL.',
      message: null
    }
  }

  // 6. Allowed protocols (only http: and https:)
  if (!ALLOWED_PROTOCOLS.has(parsedUrl.protocol)) {
    return {
      valid: false,
      url: trimmed,
      platform: null,
      error: `URL scheme '${parsedUrl.protocol}' is not supported. Only HTTP and HTTPS links are allowed.`,
      message: null
    }
  }

  // 7. Disallow embedded credentials
  if (parsedUrl.username || parsedUrl.password) {
    return {
      valid: false,
      url: trimmed,
      platform: null,
      error: 'URLs containing user credentials are not supported.',
      message: null
    }
  }

  // 8. Hostname normalization
  let hostname = parsedUrl.hostname.toLowerCase()
  if (hostname.endsWith('.')) {
    hostname = hostname.slice(0, -1)
  }

  if (!hostname) {
    return {
      valid: false,
      url: trimmed,
      platform: null,
      error: 'URL hostname is missing or invalid.',
      message: null
    }
  }

  // 9. Localhost and Direct IP rejection
  if (isIpOrLocalhost(hostname)) {
    return {
      valid: false,
      url: trimmed,
      platform: null,
      error: 'Localhost and direct IP addresses are not supported.',
      message: null
    }
  }

  // 10. Non-standard port rejection
  if (parsedUrl.port) {
    const isStandardHttp = parsedUrl.protocol === 'http:' && parsedUrl.port === '80'
    const isStandardHttps = parsedUrl.protocol === 'https:' && parsedUrl.port === '443'
    if (!isStandardHttp && !isStandardHttps) {
      return {
        valid: false,
        url: trimmed,
        platform: null,
        error: `Non-standard port ':${parsedUrl.port}' is not permitted.`,
        message: null
      }
    }
  }

  // 11. Supported platform matching
  const platform = detectPlatformFromHostname(hostname)
  if (!platform) {
    return {
      valid: false,
      url: trimmed,
      platform: null,
      error:
        'This platform is not supported. Supported: YouTube, TikTok, Instagram, Facebook, and X (Twitter).',
      message: null
    }
  }

  return {
    valid: true,
    url: trimmed,
    platform,
    error: null,
    message: `Supported ${platform.name} link ready.`
  }
}

/**
 * Extracts a candidate media URL from a browser drag-and-drop DataTransfer object.
 *
 * - Rejects dragged local files with a friendly message.
 * - Parses text/uri-list (filtering out # comments) or text/plain.
 * - Rejects multiple dropped links to avoid ambiguity.
 *
 * @param {DataTransfer} dataTransfer - DragEvent.dataTransfer
 * @returns {{ url: string | null, error: string | null }}
 */
export function extractUrlFromDataTransfer(dataTransfer) {
  if (!dataTransfer) {
    return { url: null, error: 'No drop data received.' }
  }

  // 1. Explicitly reject local files, folders, or file drops
  if (dataTransfer.files && dataTransfer.files.length > 0) {
    return {
      url: null,
      error: 'Local files are not supported. Please drop or enter a media link.'
    }
  }

  // Also check types for file-only drops
  if (
    dataTransfer.types &&
    dataTransfer.types.includes('Files') &&
    !dataTransfer.types.includes('text/plain') &&
    !dataTransfer.types.includes('text/uri-list')
  ) {
    return {
      url: null,
      error: 'Local files are not supported. Please drop or enter a media link.'
    }
  }

  // 2. Try text/uri-list
  const uriList = dataTransfer.getData('text/uri-list')
  if (uriList && typeof uriList === 'string') {
    const validLines = uriList
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter((line) => line.length > 0 && !line.startsWith('#'))

    if (validLines.length > 1) {
      return {
        url: null,
        error: 'Multiple links detected. Please drop a single media link at a time.'
      }
    }

    if (validLines.length === 1) {
      return {
        url: validLines[0],
        error: null
      }
    }
  }

  // 3. Fallback to text/plain
  const plainText = dataTransfer.getData('text/plain')
  if (plainText && typeof plainText === 'string') {
    const trimmed = plainText.trim()
    if (trimmed) {
      const lines = trimmed
        .split(/\r?\n/)
        .map((l) => l.trim())
        .filter(Boolean)

      if (lines.length > 1) {
        return {
          url: null,
          error: 'Multiple links detected. Please drop a single media link at a time.'
        }
      }

      return {
        url: trimmed,
        error: null
      }
    }
  }

  return {
    url: null,
    error: 'No media link found in dropped item.'
  }
}

/**
 * Checks if an IPv4 address is in private, loopback, or link-local ranges.
 *
 * @param {string} ip
 * @returns {boolean}
 */
export function isPrivateIpv4(ip) {
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
 * Handles trailing DNS dots, IPv4, and bracketed/raw IPv6 addresses.
 *
 * @param {string} hostname
 * @returns {boolean}
 */
export function isPrivateOrLocalHost(hostname) {
  if (typeof hostname !== 'string') return true
  let clean = hostname.toLowerCase().trim()

  // Remove trailing DNS dots (e.g. 'localhost.' -> 'localhost', 'example.com.' -> 'example.com')
  while (clean.endsWith('.')) {
    clean = clean.slice(0, -1)
  }

  if (!clean) return true

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
 * localhost (including trailing dot variations), loopback, and private IPv4/IPv6 addresses.
 *
 * @param {string|null|undefined} urlString
 * @returns {boolean}
 */
export function isSafeThumbnailUrl(urlString) {
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
