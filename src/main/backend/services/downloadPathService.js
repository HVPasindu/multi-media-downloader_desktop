import { app } from 'electron'
import path from 'node:path'
import { mkdir } from 'node:fs/promises'
import { getSavedDownloadPath } from './downloadSettingsService.js'
import { validateDownloadFolder } from './downloadFileSafetyService.js'

let testPathResolver = null

export function setPathResolverForTesting(resolver) {
  testPathResolver = resolver
}

export function resetPathResolverForTesting() {
  testPathResolver = null
}

export async function getDefaultDownloadPath() {
  const downloadsPath = app.getPath('downloads')

  const folderPath = path.join(downloadsPath, 'Multi Media Downloader')

  await mkdir(folderPath, { recursive: true })

  return folderPath
}

/**
 * Resolves and validates the download path.
 * Checks the database setting first, falls back to default download path,
 * and validates that the folder exists, is absolute, is not a root drive,
 * and poses no traversal or symlink risks.
 *
 * @param {object} [AppSetting] - Sequelize AppSetting model
 * @returns {Promise<string|null>} Normalized validated folder path, or null if invalid/unresolvable
 */
export async function resolveValidatedDownloadPath(AppSetting) {
  let rawPath = null
  if (testPathResolver) {
    try {
      rawPath = await testPathResolver(AppSetting)
    } catch {
      return null
    }
  } else {
    try {
      if (AppSetting) {
        rawPath = await getSavedDownloadPath(AppSetting)
      }
    } catch {
      rawPath = null
    }

    if (!rawPath || typeof rawPath !== 'string' || !rawPath.trim()) {
      try {
        rawPath = await getDefaultDownloadPath()
      } catch {
        rawPath = null
      }
    }
  }

  if (!rawPath || typeof rawPath !== 'string' || !rawPath.trim()) {
    return null
  }

  try {
    const validatedPath = await validateDownloadFolder(rawPath)
    return validatedPath
  } catch {
    return null
  }
}
