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
