import { getDatabase } from '../config/database.js'
import { validateMediaUrlSyntax } from './mediaUrlSecurityService.js'

export async function saveMediaItem(metadata) {
  // Validate the source URL
  if (!metadata || typeof metadata.sourceUrl !== 'string' || !metadata.sourceUrl.trim()) {
    throw new Error('A valid media source URL is required')
  }

  const sourceUrl = metadata.sourceUrl.trim()

  // Validate URL syntax, scheme, and supported platform safety before persistence
  validateMediaUrlSyntax(sourceUrl)

  // Get the existing Sequelize model
  const MediaItem = getDatabase().models.MediaItem

  // Convert analyzer fields to database fields
  const mediaData = {
    source_url: sourceUrl,
    platform: metadata.platform ?? null,
    title: metadata.title ?? null,
    thumbnail_url: metadata.thumbnailUrl ?? null,
    duration_seconds: metadata.durationSeconds ?? null
  }

  // Look for the same source URL
  const existingMedia = await MediaItem.findOne({
    where: {
      source_url: sourceUrl
    }
  })

  // Update metadata if already saved
  if (existingMedia) {
    await existingMedia.update(mediaData)
    return existingMedia
  }

  // Otherwise create a new media item
  return await MediaItem.create(mediaData)
}
