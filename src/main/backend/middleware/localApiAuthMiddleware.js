import {
  isAllowedHost,
  isAllowedOrigin,
  validateSessionToken
} from '../services/localApiSecurityService.js'

/**
 * Middleware to validate the HTTP Host header against expected local loopback addresses.
 * Defends against Host confusion and DNS rebinding attacks targeting the local Express API.
 *
 * @param {import('express').Request} req
 * @param {import('express').Response} res
 * @param {import('express').NextFunction} next
 */
export function hostValidationMiddleware(req, res, next) {
  const hostHeader = req.headers.host

  if (!isAllowedHost(hostHeader)) {
    return res.status(403).json({
      success: false,
      message: 'Forbidden: Invalid Host header'
    })
  }

  next()
}

/**
 * Middleware to restrict browser Origin and enforce CORS policies on the local Express API.
 * Only permits approved local development origins and safely responds to preflight OPTIONS requests.
 *
 * @param {import('express').Request} req
 * @param {import('express').Response} res
 * @param {import('express').NextFunction} next
 */
export function corsValidationMiddleware(req, res, next) {
  const originHeader = req.headers.origin

  // If a browser Origin header is present, enforce strict origin matching
  if (typeof originHeader === 'string' && originHeader.trim()) {
    if (!isAllowedOrigin(originHeader)) {
      return res.status(403).json({
        success: false,
        message: 'Forbidden: Disallowed CORS origin'
      })
    }

    // Set CORS headers for approved origin
    res.setHeader('Access-Control-Allow-Origin', originHeader.trim())
    res.setHeader('Vary', 'Origin')
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PATCH, DELETE, OPTIONS')
    res.setHeader('Access-Control-Allow-Headers', 'Authorization, Content-Type')

    // Handle preflight OPTIONS request without side-effects
    if (req.method === 'OPTIONS') {
      return res.status(204).end()
    }
  } else if (req.method === 'OPTIONS') {
    // Respond safely to preflight requests that omit Origin
    return res.status(204).end()
  }

  next()
}

/**
 * Middleware to authenticate requests to sensitive local Express endpoints.
 * Requires a valid high-entropy session token presented as a Bearer token.
 *
 * @param {import('express').Request} req
 * @param {import('express').Response} res
 * @param {import('express').NextFunction} next
 */
export function authValidationMiddleware(req, res, next) {
  const authHeader = req.headers.authorization

  // 1. Missing Authorization header
  if (typeof authHeader !== 'string' || !authHeader.trim()) {
    return res.status(401).json({
      success: false,
      message: 'Unauthorized API request'
    })
  }

  // 2. Format validation: Bearer <token>
  const parts = authHeader.trim().split(/\s+/)

  if (parts.length !== 2 || parts[0].toLowerCase() !== 'bearer' || !parts[1]) {
    return res.status(401).json({
      success: false,
      message: 'Unauthorized API request'
    })
  }

  const candidateToken = parts[1]

  // 3. Cryptographic constant-time token validation
  if (!validateSessionToken(candidateToken)) {
    return res.status(401).json({
      success: false,
      message: 'Unauthorized API request'
    })
  }

  next()
}
