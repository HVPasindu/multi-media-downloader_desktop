
import { analyzeMedia } from '../services/mediaAnalyzerService.js'
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

    const media = await analyzeMedia(sourceUrl)

    return res.status(200).json({
      success: true,
      data: media
    })
  } catch (error) {
    next(error)
  }
}
