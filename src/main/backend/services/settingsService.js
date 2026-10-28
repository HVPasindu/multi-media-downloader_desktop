import { getDatabase } from '../config/database.js'
import { getDefaultDownloadPath } from './downloadPathService.js'
import { SUPPORTED_MP3_BITRATES } from './downloadService.js'
import { Transaction } from 'sequelize'
import path from 'node:path'
import { stat, access, constants } from 'node:fs/promises'

// Default download preferences when none have been saved in SQLite
export const DEFAULT_DOWNLOAD_PREFERENCES = Object.freeze({
  defaultFormat: 'mp4',
  preferredMp4Quality: '720p',
  preferredMp3BitrateKbps: 192
})

// SQLite app_settings key constants
export const SETTING_KEYS = Object.freeze({
  DOWNLOAD_PATH: 'download_path',
  DEFAULT_FORMAT: 'default_output_format',
  PREFERRED_MP4_QUALITY: 'preferred_mp4_quality',
  PREFERRED_MP3_BITRATE: 'preferred_mp3_bitrate_kbps'
})

// Validate incoming download preference changes
export async function validateDownloadPreferences(changes) {
  if (
    !changes ||
    typeof changes !== 'object' ||
    Array.isArray(changes) ||
    Object.keys(changes).length === 0
  ) {
    return {
      isValid: false,
      errors: { body: 'Request body must be a non-empty object' }
    }
  }

  const errors = {}
  const allowedFields = new Set([
    'downloadPath',
    'defaultFormat',
    'preferredMp4Quality',
    'preferredMp3BitrateKbps'
  ])

  // Reject unknown request properties
  for (const key of Object.keys(changes)) {
    if (!allowedFields.has(key)) {
      errors[key] = `Unknown setting property "${key}"`
    }
  }

  // 1. Validate default output format
  if ('defaultFormat' in changes) {
    const val = changes.defaultFormat
    if (typeof val !== 'string' || !['mp4', 'mp3'].includes(val.trim().toLowerCase())) {
      errors.defaultFormat = 'Supported output formats are "mp4" or "mp3"'
    }
  }

  // 2. Validate preferred MP3 bitrate
  if ('preferredMp3BitrateKbps' in changes) {
    const val = changes.preferredMp3BitrateKbps
    if (
      typeof val !== 'number' ||
      !Number.isInteger(val) ||
      !SUPPORTED_MP3_BITRATES.includes(val)
    ) {
      errors.preferredMp3BitrateKbps = `Supported MP3 bitrates are ${SUPPORTED_MP3_BITRATES.join(', ')} kbps (must be numeric)`
    }
  }

  // 3. Validate preferred MP4 quality
  if ('preferredMp4Quality' in changes) {
    const val = changes.preferredMp4Quality
    if (typeof val !== 'string' || !/^\d+p$/.test(val.trim()) || val.trim().length > 10) {
      errors.preferredMp4Quality =
        'Preferred MP4 quality must be a resolution string like "720p" or "1080p"'
    } else {
      const height = Number.parseInt(val.trim(), 10)
      if (height <= 0 || height > 4320) {
        errors.preferredMp4Quality = 'Invalid MP4 video resolution'
      }
    }
  }

  // 4. Validate download folder path
  if ('downloadPath' in changes) {
    const val = changes.downloadPath
    if (typeof val !== 'string' || !val.trim() || val.includes('\0')) {
      errors.downloadPath = 'A valid download folder path is required'
    } else {
      const cleanPath = path.resolve(val.trim())

      if (!path.isAbsolute(cleanPath)) {
        errors.downloadPath = 'Download path must be an absolute filesystem path'
      } else {
        const parsed = path.parse(cleanPath)
        const isDriveRoot =
          cleanPath.toLowerCase() === parsed.root.toLowerCase() ||
          cleanPath.replace(/[\\/]+$/, '') === parsed.root.replace(/[\\/]+$/, '')

        if (isDriveRoot) {
          errors.downloadPath = 'Root drive directories cannot be used as the download folder'
        } else {
          try {
            const stats = await stat(cleanPath)
            if (!stats.isDirectory()) {
              errors.downloadPath = 'Download path must be an existing directory, not a file'
            } else {
              await access(cleanPath, constants.R_OK | constants.W_OK)
            }
          } catch (fsError) {
            if (fsError.code === 'ENOENT') {
              errors.downloadPath = 'The specified download directory does not exist'
            } else if (['EACCES', 'EPERM'].includes(fsError.code)) {
              errors.downloadPath =
                'The application does not have permission to access or write to this folder'
            } else {
              errors.downloadPath = 'The specified download path is invalid or inaccessible'
            }
          }
        }
      }
    }
  }

  return {
    isValid: Object.keys(errors).length === 0,
    errors
  }
}

// Read saved download preferences from SQLite and apply safe defaults
export async function getDownloadPreferences() {
  const { AppSetting } = getDatabase().models

  const settings = await AppSetting.findAll({
    where: {
      key: Object.values(SETTING_KEYS)
    }
  })

  const settingsMap = new Map(settings.map((s) => [s.key, s.value]))

  // 1. Download Path: from DB or default download folder
  let downloadPath = settingsMap.get(SETTING_KEYS.DOWNLOAD_PATH)
  if (!downloadPath || typeof downloadPath !== 'string' || !downloadPath.trim()) {
    downloadPath = await getDefaultDownloadPath()
  }

  // 2. Default Format: from DB or default 'mp4'
  let defaultFormat = settingsMap.get(SETTING_KEYS.DEFAULT_FORMAT)
  if (!defaultFormat || !['mp4', 'mp3'].includes(defaultFormat)) {
    defaultFormat = DEFAULT_DOWNLOAD_PREFERENCES.defaultFormat
  }

  // 3. Preferred MP4 Quality: from DB or default '720p'
  let preferredMp4Quality = settingsMap.get(SETTING_KEYS.PREFERRED_MP4_QUALITY)
  if (
    !preferredMp4Quality ||
    typeof preferredMp4Quality !== 'string' ||
    !/^\d+p$/.test(preferredMp4Quality)
  ) {
    preferredMp4Quality = DEFAULT_DOWNLOAD_PREFERENCES.preferredMp4Quality
  }

  // 4. Preferred MP3 Bitrate (Kbps): from DB (converted to number) or default 192
  let preferredMp3BitrateKbps = null
  const rawBitrate = settingsMap.get(SETTING_KEYS.PREFERRED_MP3_BITRATE)
  if (rawBitrate) {
    const parsed = Number(rawBitrate)
    if (SUPPORTED_MP3_BITRATES.includes(parsed)) {
      preferredMp3BitrateKbps = parsed
    }
  }

  if (preferredMp3BitrateKbps === null) {
    preferredMp3BitrateKbps = DEFAULT_DOWNLOAD_PREFERENCES.preferredMp3BitrateKbps
  }

  return {
    downloadPath,
    defaultFormat,
    preferredMp4Quality,
    preferredMp3BitrateKbps
  }
}

// Validate, conflict-check, and atomically update download preferences
export async function updateDownloadPreferences(changes) {
  // 1. Validate all incoming fields
  const validation = await validateDownloadPreferences(changes)
  if (!validation.isValid) {
    const error = new Error('Invalid download settings')
    error.statusCode = 400
    error.errors = validation.errors
    throw error
  }

  const { AppSetting, DownloadJob } = getDatabase().models

  // 2. Active downloads safety guard:
  // If downloadPath is being changed, check if any download job is currently queued or downloading
  if ('downloadPath' in changes) {
    const activeJob = await DownloadJob.findOne({
      where: {
        status: ['queued', 'downloading']
      }
    })

    if (activeJob) {
      const conflictError = new Error(
        'Cannot change download folder while downloads are active or queued. Please wait for downloads to finish or cancel them first.'
      )
      conflictError.statusCode = 409
      throw conflictError
    }
  }

  // 3. Atomically update SQLite in a short IMMEDIATE transaction
  await getDatabase().transaction({ type: Transaction.TYPES.IMMEDIATE }, async (transaction) => {
    if ('downloadPath' in changes) {
      const cleanPath = path.resolve(changes.downloadPath.trim())
      await AppSetting.upsert(
        {
          key: SETTING_KEYS.DOWNLOAD_PATH,
          value: cleanPath
        },
        { transaction }
      )
    }

    if ('defaultFormat' in changes) {
      await AppSetting.upsert(
        {
          key: SETTING_KEYS.DEFAULT_FORMAT,
          value: changes.defaultFormat.trim().toLowerCase()
        },
        { transaction }
      )
    }

    if ('preferredMp4Quality' in changes) {
      await AppSetting.upsert(
        {
          key: SETTING_KEYS.PREFERRED_MP4_QUALITY,
          value: changes.preferredMp4Quality.trim()
        },
        { transaction }
      )
    }

    if ('preferredMp3BitrateKbps' in changes) {
      await AppSetting.upsert(
        {
          key: SETTING_KEYS.PREFERRED_MP3_BITRATE,
          value: String(changes.preferredMp3BitrateKbps)
        },
        { transaction }
      )
    }
  })

  // 4. Return the full effective preferences after commit
  return await getDownloadPreferences()
}
