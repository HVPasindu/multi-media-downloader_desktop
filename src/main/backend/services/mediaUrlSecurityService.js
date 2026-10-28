import net from 'node:net'
import dns from 'node:dns'
import { PLATFORM_DOMAINS } from '../providers/providerManager.js'

/**
 * Maximum permitted URL length to prevent memory exhaustion and abusive inputs
 * while safely accommodating signed media URLs and long query parameter strings.
 */
export const MAX_URL_LENGTH = 2048

/**
 * Supported protocols for media extraction.
 */
const ALLOWED_PROTOCOLS = new Set(['http:', 'https:'])

/**
 * Custom error class for URL security and validation failures.
 * Encapsulates machine-readable error codes and safe user-facing messages.
 */
export class UrlSecurityError extends Error {
  constructor(code, message, options = {}) {
    super(message, { cause: options.cause })
    this.name = 'UrlSecurityError'
    this.code = code
    this.statusCode = options.statusCode ?? 400
    this.userMessage = message
    this.details = options.details ?? null
  }
}

/**
 * Helper to expand an IPv6 address string into 8 four-character hex hextets.
 * Correctly parses standard IPv6, compressed IPv6 (::), and IPv4-mapped IPv6 (::ffff:192.168.1.1).
 *
 * @param {string} ip
 * @returns {string[]} Array of 8 four-digit hex strings
 */
function expandIPv6(ip) {
  let clean = ip.toLowerCase()

  // Handle embedded IPv4 notation e.g. ::ffff:192.168.1.1
  if (clean.includes('.')) {
    const lastColon = clean.lastIndexOf(':')
    const ipv4Part = clean.slice(lastColon + 1)
    const octets = ipv4Part.split('.').map(Number)
    const hex1 = ((octets[0] << 8) | octets[1]).toString(16).padStart(4, '0')
    const hex2 = ((octets[2] << 8) | octets[3]).toString(16).padStart(4, '0')
    clean = clean.slice(0, lastColon) + ':' + hex1 + ':' + hex2
  }

  const parts = clean.split('::')
  const left = parts[0] ? parts[0].split(':') : []
  const right = parts[1] ? parts[1].split(':') : []
  const missingCount = 8 - (left.length + right.length)
  const middle = Array(missingCount >= 0 ? missingCount : 0).fill('0000')

  return [...left, ...middle, ...right].map((h) => h.padStart(4, '0'))
}

/**
 * Checks whether an IP address belongs to a private, loopback, link-local,
 * multicast, unspecified, or reserved non-public address range.
 * Supports IPv4, IPv6, and IPv4-mapped IPv6.
 *
 * @param {string} ipAddress - The IP address string to check
 * @returns {boolean} True if the address is private, local, or non-public
 */
export function isPrivateOrLocalIp(ipAddress) {
  if (typeof ipAddress !== 'string' || !ipAddress.trim()) {
    return false
  }

  const cleanIp = ipAddress.trim()
  const family = net.isIP(cleanIp)

  if (family === 4) {
    const octets = cleanIp.split('.').map(Number)
    if (octets.length !== 4 || octets.some((o) => Number.isNaN(o) || o < 0 || o > 255)) {
      return false
    }

    const [a, b, c] = octets

    // Loopback: 127.0.0.0/8
    if (a === 127) return true

    // Current network ("this host"): 0.0.0.0/8
    if (a === 0) return true

    // Private IPv4 Class A: 10.0.0.0/8
    if (a === 10) return true

    // Private IPv4 Class B: 172.16.0.0/12 (172.16.0.0 - 172.31.255.255)
    if (a === 172 && b >= 16 && b <= 31) return true

    // Private IPv4 Class C: 192.168.0.0/16
    if (a === 192 && b === 168) return true

    // Link-Local / APIPA / Cloud Metadata: 169.254.0.0/16
    if (a === 169 && b === 254) return true

    // Carrier-Grade NAT (CGNAT): 100.64.0.0/10 (100.64.0.0 - 100.127.255.255)
    if (a === 100 && b >= 64 && b <= 127) return true

    // IETF Protocol Assignments: 192.0.0.0/24
    if (a === 192 && b === 0 && c === 0) return true

    // TEST-NET-1: 192.0.2.0/24
    if (a === 192 && b === 0 && c === 2) return true

    // Benchmarking: 198.18.0.0/15 (198.18.0.0 - 198.19.255.255)
    if (a === 198 && (b === 18 || b === 19)) return true

    // TEST-NET-2: 198.51.100.0/24
    if (a === 198 && b === 51 && c === 100) return true

    // TEST-NET-3: 203.0.113.0/24
    if (a === 203 && b === 0 && c === 113) return true

    // Multicast: 224.0.0.0/4 (224.0.0.0 - 239.255.255.255)
    if (a >= 224 && a <= 239) return true

    // Reserved / Broadcast: 240.0.0.0/4 (includes 255.255.255.255)
    if (a >= 240) return true

    return false
  }

  if (family === 6) {
    const hextets = expandIPv6(cleanIp)
    if (hextets.length !== 8) {
      return false
    }

    // IPv6 Loopback: ::1
    if (hextets.slice(0, 7).every((h) => h === '0000') && hextets[7] === '0001') {
      return true
    }

    // IPv6 Unspecified: ::
    if (hextets.every((h) => h === '0000')) {
      return true
    }

    // IPv6 Unique Local Address (ULA): fc00::/7 (fc.. or fd..)
    if (hextets[0].startsWith('fc') || hextets[0].startsWith('fd')) {
      return true
    }

    // IPv6 Link-Local Unicast: fe80::/10 (fe80 - febf)
    const firstVal = Number.parseInt(hextets[0], 16)
    if ((firstVal & 0xffc0) === 0xfe80) {
      return true
    }

    // IPv6 Multicast: ff00::/8 (ff..)
    if (hextets[0].startsWith('ff')) {
      return true
    }

    // IPv4-mapped IPv6 address: ::ffff:0:0/96
    if (hextets.slice(0, 5).every((h) => h === '0000') && hextets[5] === 'ffff') {
      const high = Number.parseInt(hextets[6], 16)
      const low = Number.parseInt(hextets[7], 16)
      const mappedIpv4 = [(high >> 8) & 0xff, high & 0xff, (low >> 8) & 0xff, low & 0xff].join('.')

      return isPrivateOrLocalIp(mappedIpv4)
    }

    return false
  }

  return false
}

/**
 * Helper to check whether a string contains ASCII control characters (0x00 to 0x1F, or 0x7F).
 * Uses character codes to avoid no-control-regex linter restrictions.
 *
 * @param {string} str
 * @returns {boolean}
 */
function hasControlCharacters(str) {
  for (let i = 0; i < str.length; i++) {
    const code = str.charCodeAt(i)
    if (code < 32 || code === 127) {
      return true
    }
  }
  return false
}

/**
 * Performs synchronous syntactic and structure validation of a candidate media URL.
 * Checks string type, length, control characters, URL scheme, credentials, ports,
 * and supported domain matching.
 *
 * @param {string} sourceUrl - Candidate media URL
 * @returns {{ sourceUrl: string, platform: string, hostname: string }}
 * @throws {UrlSecurityError}
 */
export function validateMediaUrlSyntax(sourceUrl) {
  // 1. Input type verification
  if (typeof sourceUrl !== 'string') {
    throw new UrlSecurityError('INVALID_URL', 'URL must be a valid string')
  }

  const cleanUrl = sourceUrl.trim()

  // 2. Non-empty check
  if (!cleanUrl) {
    throw new UrlSecurityError('INVALID_URL', 'URL must not be empty')
  }

  // 3. Length boundary check
  if (cleanUrl.length > MAX_URL_LENGTH) {
    throw new UrlSecurityError('INVALID_URL', 'URL exceeds maximum permitted length')
  }

  // 4. Null byte check
  if (cleanUrl.includes('\0')) {
    throw new UrlSecurityError('INVALID_URL', 'URL contains invalid null bytes')
  }

  // 5. Unsafe ASCII control characters check (0x00 - 0x1F and 0x7F)
  if (hasControlCharacters(cleanUrl)) {
    throw new UrlSecurityError('INVALID_URL', 'URL contains invalid control characters')
  }

  // 6. Native URL parsing
  let parsedUrl
  try {
    parsedUrl = new URL(cleanUrl)
  } catch (parseError) {
    throw new UrlSecurityError('INVALID_URL', 'URL is malformed or invalid', {
      cause: parseError
    })
  }

  // 7. Allowed protocol verification (only http: and https:)
  if (!ALLOWED_PROTOCOLS.has(parsedUrl.protocol)) {
    throw new UrlSecurityError(
      'UNSUPPORTED_SCHEME',
      `URL scheme '${parsedUrl.protocol}' is not supported. Only HTTP and HTTPS URLs are allowed.`
    )
  }

  // 8. Rejection of embedded userinfo credentials (username / password)
  if (parsedUrl.username || parsedUrl.password) {
    throw new UrlSecurityError(
      'DISALLOWED_USERINFO',
      'URLs containing username or password credentials are not permitted'
    )
  }

  // 9. Hostname normalization
  let hostname = parsedUrl.hostname.toLowerCase()
  if (hostname.endsWith('.')) {
    hostname = hostname.slice(0, -1)
  }

  // Strip IPv6 bracket delimiters if present for IP classification
  let normalizedHost = hostname
  if (normalizedHost.startsWith('[') && normalizedHost.endsWith(']')) {
    normalizedHost = normalizedHost.slice(1, -1)
  }

  if (!hostname) {
    throw new UrlSecurityError('INVALID_HOSTNAME', 'URL hostname cannot be empty')
  }

  // 10. Localhost destination rejection
  if (hostname === 'localhost' || hostname.endsWith('.localhost')) {
    throw new UrlSecurityError(
      'PRIVATE_DESTINATION',
      'Access to localhost destinations is not permitted'
    )
  }

  // 11. Direct IP address rejection (both private/local and arbitrary direct IPs)
  if (net.isIP(normalizedHost)) {
    if (isPrivateOrLocalIp(normalizedHost)) {
      throw new UrlSecurityError(
        'PRIVATE_DESTINATION',
        'Direct connection to private or local network addresses is not permitted'
      )
    }

    throw new UrlSecurityError(
      'UNSUPPORTED_PLATFORM',
      'Direct IP address URLs are not supported as media sources'
    )
  }

  // 12. Unexpected port validation (allow default or standard 80/443 only)
  if (parsedUrl.port) {
    const isStandardHttp = parsedUrl.protocol === 'http:' && parsedUrl.port === '80'
    const isStandardHttps = parsedUrl.protocol === 'https:' && parsedUrl.port === '443'

    if (!isStandardHttp && !isStandardHttps) {
      throw new UrlSecurityError(
        'DISALLOWED_PORT',
        `Nonstandard URL port ':${parsedUrl.port}' is not permitted`
      )
    }
  }

  // 13. Supported platform domain matching
  let matchedPlatform = null

  for (const [platform, domains] of Object.entries(PLATFORM_DOMAINS)) {
    const matched = domains.some((domain) => hostname === domain || hostname.endsWith(`.${domain}`))

    if (matched) {
      matchedPlatform = platform
      break
    }
  }

  if (!matchedPlatform) {
    throw new UrlSecurityError(
      'UNSUPPORTED_PLATFORM',
      'The provided URL is not from a supported media platform (YouTube, Facebook, Instagram, TikTok, X/Twitter)'
    )
  }

  return {
    sourceUrl: cleanUrl,
    platform: matchedPlatform,
    hostname
  }
}

/**
 * Performs asynchronous DNS resolution preflight check on a hostname.
 * Checks all returned IPv4 and IPv6 addresses to ensure none resolve to private or local ranges.
 *
 * NOTE ON SECURITY LIMITATIONS:
 * Preflight DNS validation verifies the hostname at validation time inside Node.js.
 * However, yt-dlp runs as a separate external child process that resolves destinations independently.
 * This preflight check provides defense-in-depth against obvious private hostnames, but cannot
 * completely prevent DNS rebinding (TOCTOU) or external yt-dlp redirect chains without forward proxying.
 *
 * @param {string} hostname - Target hostname
 * @param {Function} [dnsLookupFn] - Injectable DNS lookup function for deterministic testing
 * @returns {Promise<void>}
 * @throws {UrlSecurityError}
 */
export async function validateHostDns(hostname, dnsLookupFn = dns.promises.lookup) {
  let records = []

  try {
    records = await dnsLookupFn(hostname, { all: true })
  } catch (dnsError) {
    const code = dnsError?.code || 'DNS_ERROR'
    if (code === 'ENOTFOUND' || code === 'EAI_AGAIN') {
      throw new UrlSecurityError(
        'DNS_LOOKUP_FAILED',
        `Could not resolve domain name for '${hostname}'. Please check network connection.`,
        { cause: dnsError }
      )
    }

    throw new UrlSecurityError(
      'DNS_LOOKUP_FAILED',
      `DNS lookup failure for domain '${hostname}': ${dnsError.message}`,
      { cause: dnsError }
    )
  }

  // Standardize result into an array of address objects
  const addressList = Array.isArray(records)
    ? records
    : typeof records === 'string'
      ? [{ address: records }]
      : records?.address
        ? [records]
        : []

  for (const record of addressList) {
    const address = typeof record === 'string' ? record : record?.address

    if (address && isPrivateOrLocalIp(address)) {
      throw new UrlSecurityError(
        'PRIVATE_DESTINATION',
        `Destination address for '${hostname}' resolves to a restricted or private network`
      )
    }
  }
}

/**
 * Central URL validation function for incoming and stored media URLs.
 * Combines strict syntax parsing, scheme and credential checking, domain allowlisting,
 * and asynchronous DNS preflight destination safety.
 *
 * @param {string} sourceUrl - Candidate media URL
 * @param {object} [options={}] - Optional configuration
 * @param {boolean} [options.checkDns=true] - Whether to perform DNS resolution preflight
 * @param {Function} [options.dnsLookup] - Custom DNS lookup function (for deterministic testing)
 * @returns {Promise<{ sourceUrl: string, platform: string, hostname: string }>}
 * @throws {UrlSecurityError}
 */
export async function validateMediaUrl(sourceUrl, options = {}) {
  // 1. Perform strict syntax and structure validation
  const validated = validateMediaUrlSyntax(sourceUrl)

  // 2. Perform DNS resolution preflight check unless explicitly skipped
  if (options.checkDns !== false) {
    await validateHostDns(validated.hostname, options.dnsLookup)
  }

  return validated
}
