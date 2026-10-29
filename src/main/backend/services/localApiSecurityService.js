import crypto from 'node:crypto'
import { isPackagedApp } from './executablePathService.js'

/**
 * Expected local API server port and host.
 */
export const LOCAL_API_PORT = 3001
export const LOCAL_API_HOST = '127.0.0.1'

/**
 * Minimum required entropy bytes for securely generated session tokens.
 * 32 bytes = 256 bits of cryptographically secure entropy.
 */
const MIN_TOKEN_BYTES = 32

/**
 * Trivial or predictable token values that are strictly prohibited even in development mode.
 */
const PROHIBITED_DEV_TOKENS = new Set([
  'test',
  'admin',
  '123456',
  'secret',
  'password',
  'dev',
  'development',
  'applan2'
])

/**
 * Active in-memory session token for this application instance.
 * Generated once per application session and never persisted to database or disk.
 */
let sessionToken = null

/**
 * Checks whether the application is running in an explicit development environment.
 * Development mode is strictly enabled only when NODE_ENV === 'development' AND
 * the application is not running in packaged Electron mode.
 *
 * @returns {boolean}
 */
export function isDevEnvironment() {
  return process.env.NODE_ENV === 'development' && !isPackagedApp()
}

/**
 * Generates or initializes the high-entropy session token.
 * In development mode, optionally accepts APPLAN2_DEV_API_TOKEN if it meets security requirements.
 * In production mode, always generates a cryptographically secure random token.
 *
 * @param {string|null} [explicitToken=null] - Optional token for testing
 * @returns {string} The active session token
 */
export function initSessionToken(explicitToken = null) {
  if (typeof explicitToken === 'string' && explicitToken.trim()) {
    sessionToken = explicitToken.trim()
    return sessionToken
  }

  // Check for developer-supplied development token (only in development mode)
  if (isDevEnvironment() && process.env.APPLAN2_DEV_API_TOKEN) {
    const candidateDevToken = process.env.APPLAN2_DEV_API_TOKEN.trim()

    const isTooShort = candidateDevToken.length < 32
    const isProhibited = PROHIBITED_DEV_TOKENS.has(candidateDevToken.toLowerCase())

    if (isTooShort || isProhibited) {
      console.warn(
        '[Security] APPLAN2_DEV_API_TOKEN was provided but does not meet security requirements (min 32 chars, non-trivial). Generating secure random token instead.'
      )
    } else {
      sessionToken = candidateDevToken
      return sessionToken
    }
  }

  // Generate cryptographically secure high-entropy random token
  sessionToken = crypto.randomBytes(MIN_TOKEN_BYTES).toString('hex')
  return sessionToken
}

/**
 * Returns the active session token, lazily generating one if not yet initialized.
 *
 * @returns {string}
 */
export function getSessionToken() {
  if (!sessionToken) {
    initSessionToken()
  }
  return sessionToken
}

/**
 * Resets the session token (used primarily for automated testing).
 *
 * @param {string|null} [newToken=null]
 */
export function resetSessionTokenForTest(newToken = null) {
  sessionToken = newToken
}

/**
 * Constant-time comparison between candidate token and active session token.
 * Prevents timing attacks and safely handles unequal string lengths.
 *
 * @param {string} candidateToken
 * @returns {boolean} True if candidate matches the active session token
 */
export function validateSessionToken(candidateToken) {
  if (typeof candidateToken !== 'string' || !candidateToken.trim()) {
    return false
  }

  const active = getSessionToken()
  const expectedBuffer = Buffer.from(active, 'utf8')
  const candidateBuffer = Buffer.from(candidateToken.trim(), 'utf8')

  // Prevent timing attacks by comparing equal-length buffers or safely returning false
  if (expectedBuffer.length !== candidateBuffer.length) {
    return false
  }

  return crypto.timingSafeEqual(expectedBuffer, candidateBuffer)
}

/**
 * Set of allowed loopback Host header values.
 */
export function getAllowedHosts() {
  return new Set([
    `127.0.0.1:${LOCAL_API_PORT}`,
    `localhost:${LOCAL_API_PORT}`,
    '127.0.0.1',
    'localhost'
  ])
}

/**
 * Validates the incoming HTTP Host header against allowed loopback hosts.
 *
 * @param {string} hostHeader
 * @returns {boolean}
 */
export function isAllowedHost(hostHeader) {
  if (typeof hostHeader !== 'string' || !hostHeader.trim()) {
    return false
  }

  const cleanHost = hostHeader.trim().toLowerCase()
  const allowed = getAllowedHosts()

  return allowed.has(cleanHost)
}

/**
 * Set of allowed browser Origins for local development.
 */
export function getAllowedOrigins() {
  const allowed = new Set(['http://localhost:5173', 'http://127.0.0.1:5173'])

  // Include Electron renderer dev server URL if present
  if (process.env.ELECTRON_RENDERER_URL) {
    try {
      const parsed = new URL(process.env.ELECTRON_RENDERER_URL)
      allowed.add(parsed.origin.toLowerCase())
    } catch {
      // Ignore invalid URL format in environment
    }
  }

  return allowed
}

/**
 * Validates the incoming browser Origin header.
 *
 * @param {string} originHeader
 * @returns {boolean}
 */
export function isAllowedOrigin(originHeader) {
  if (typeof originHeader !== 'string' || !originHeader.trim()) {
    return false
  }

  const cleanOrigin = originHeader.trim().toLowerCase()
  const allowed = getAllowedOrigins()

  return allowed.has(cleanOrigin)
}
