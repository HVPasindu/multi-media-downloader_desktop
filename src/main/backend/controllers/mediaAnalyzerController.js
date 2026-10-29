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

    // Step 1: Extract metadata using yt-dlp
    const media = await analyzeMedia(validatedUrl.sourceUrl)

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
