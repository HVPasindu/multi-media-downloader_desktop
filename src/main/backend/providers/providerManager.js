export const PLATFORM_DOMAINS = {
  youtube: ['youtube.com', 'youtu.be'],
  facebook: ['facebook.com', 'fb.watch'],
  instagram: ['instagram.com'],
  tiktok: ['tiktok.com'],
  twitter: ['twitter.com', 'x.com']
}

export function detectPlatform(sourceUrl) {
  // Check whether URL is a valid string
  if (typeof sourceUrl !== 'string' || !sourceUrl.trim()) {
    return null
  }

  let parsedUrl

  try {
    parsedUrl = new URL(sourceUrl.trim())
  } catch {
    return null
  }

  // Only allow HTTP and HTTPS links
  if (!['http:', 'https:'].includes(parsedUrl.protocol)) {
    return null
  }

  const hostname = parsedUrl.hostname.toLowerCase()

  // Find matching platform
  for (const [platform, domains] of Object.entries(PLATFORM_DOMAINS)) {
    const matched = domains.some((domain) => hostname === domain || hostname.endsWith(`.${domain}`))

    if (matched) {
      return platform
    }
  }

  return null
}
