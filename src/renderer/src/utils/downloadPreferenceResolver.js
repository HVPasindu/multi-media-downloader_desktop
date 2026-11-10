/**
 * Download Preference Resolver Utility
 *
 * Resolves the effective video quality to select based on user preferences and
 * dynamically extracted stream qualities from media metadata.
 *
 * Rules:
 * 1. Returns null if availableQualities is invalid or empty.
 * 2. Returns 'best' if preference is 'best' or not specified.
 * 3. Returns the exact matching quality if it exists in availableQualities.
 * 4. Returns the highest available quality at or below the preferred resolution.
 * 5. If no available quality is at or below the preference, falls back to the lowest available quality.
 *
 * @param {string} preference - Preferred video quality (e.g., 'best', '1080p', '720p')
 * @param {string[]} availableQualities - List of available resolution strings (e.g., ['1080p', '720p', '480p'])
 * @returns {string|null} Resolved quality string or null
 */
export function resolvePreferredVideoQuality(preference, availableQualities) {
  if (!Array.isArray(availableQualities) || availableQualities.length === 0) {
    return null
  }

  const sorted = [...availableQualities].sort((a, b) => {
    const aHeight = Number.parseInt(a, 10) || 0
    const bHeight = Number.parseInt(b, 10) || 0
    return bHeight - aHeight
  })

  if (!preference || preference === 'best') {
    return 'best'
  }

  const normalizedPref = String(preference).trim().toLowerCase()

  if (normalizedPref === 'best') {
    return 'best'
  }

  if (sorted.includes(normalizedPref)) {
    return normalizedPref
  }

  const preferredHeight = Number.parseInt(normalizedPref, 10)
  if (!Number.isFinite(preferredHeight)) {
    return 'best'
  }

  const availableBelowPreference = sorted.filter((quality) => {
    const height = Number.parseInt(quality, 10)
    return Number.isFinite(height) && height <= preferredHeight
  })

  return availableBelowPreference[0] || sorted[sorted.length - 1]
}

export default resolvePreferredVideoQuality
