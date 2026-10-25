
import { analyzeMedia } from '../services/mediaAnalyzerService.js'
import { saveMediaItem } from '../services/mediaItemService.js'
import { detectPlatform } from '../providers/providerManager.js'

export async function analyzeMediaController(req, res, next) {
  try {
    const sourceUrl = req.body?.url

    if (typeof sourceUrl !== 'string' || !detectPlatform(sourceUrl)) {
      return res.status(400).json({
        success: false,
        message: 'Please provide a valid supported media URL'
      })
    }

    // Step 1: Extract metadata using yt-dlp
    const media = await analyzeMedia(sourceUrl)

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
