import { analyzeMedia } from '../services/mediaAnalyzerService.js'
import { saveMediaItem } from '../services/mediaItemService.js'
import { validateMediaUrl } from '../services/mediaUrlSecurityService.js'

export async function analyzeMediaController(req, res, next) {
  try {
    const sourceUrl = req.body?.url

    let validatedUrl
    try {
      validatedUrl = await validateMediaUrl(sourceUrl)
    } catch (validationError) {
      return res.status(400).json({
        success: false,
        message: validationError.userMessage || 'Please provide a valid supported media URL'
      })
    }

    // Step 1: Extract metadata using yt-dlp (with caching, deduplication & cooldown)
    let media
    try {
      media = await analyzeMedia(validatedUrl.sourceUrl)
    } catch (analysisError) {
      const code = analysisError.code || 'ANALYSIS_FAILED'
      const message =
        analysisError.userMessage || analysisError.message || 'Failed to analyze media link'
      const retryAfterSeconds = analysisError.retryAfterSeconds || null

      if (code === 'YOUTUBE_RATE_LIMITED' || code === 'RATE_LIMITED') {
        return res.status(429).json({
          success: false,
          code,
          message,
          retryAfterSeconds: retryAfterSeconds || 60
        })
      }

      return res.status(400).json({
        success: false,
        code,
        message,
        retryAfterSeconds
      })
    }

    // Step 2: Save or update media in SQLite
    const savedMedia = await saveMediaItem(media)

    // Step 3: Return metadata with database ID
    return res.status(200).json({
      success: true,
      data: {
        ...media,
        mediaItemId: savedMedia.id
      }
    })
  } catch (error) {
    next(error)
  }
}
