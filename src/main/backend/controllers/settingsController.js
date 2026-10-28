import { getDownloadPreferences, updateDownloadPreferences } from '../services/settingsService.js'

// Handle GET /api/settings/downloads
export async function getDownloadSettingsController(req, res, next) {
  try {
    const data = await getDownloadPreferences()

    return res.status(200).json({
      success: true,
      data
    })
  } catch (error) {
    next(error)
  }
}

// Handle PATCH /api/settings/downloads
export async function updateDownloadSettingsController(req, res, next) {
  try {
    const data = await updateDownloadPreferences(req.body)

    return res.status(200).json({
      success: true,
      data
    })
  } catch (error) {
    if (error.statusCode === 400 && error.errors) {
      return res.status(400).json({
        success: false,
        message: error.message || 'Invalid download settings',
        errors: error.errors
      })
    }

    if (error.statusCode === 409) {
      return res.status(409).json({
        success: false,
        message: error.message
      })
    }

    next(error)
  }
}
