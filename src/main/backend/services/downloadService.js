
import { getDatabase } from '../config/database.js'

export async function createDownloadJob({
  mediaItemId,
  outputFormat,
  quality = null,
  audioBitrateKbps = null
}) {
  if (!Number.isInteger(mediaItemId) || mediaItemId <= 0) {
    throw new Error('A valid Media Item ID is required')
  }

  if (!['mp4', 'mp3'].includes(outputFormat)) {
    throw new Error('Output format must be mp4 or mp3')
  }

  if (
    outputFormat === 'mp4' &&
    (typeof quality !== 'string' || !/^\d+p$/.test(quality))
  ) {
    throw new Error('A valid video quality is required')
  }

  if (
    outputFormat === 'mp3' &&
    (!Number.isInteger(audioBitrateKbps) || audioBitrateKbps <= 0)
  ) {
    throw new Error('A valid audio bitrate is required')
  }

  const { MediaItem, DownloadJob } = getDatabase().models

  const media = await MediaItem.findByPk(mediaItemId)

  if (!media) {
    throw new Error('Media Item not found')
  }

  const job = await DownloadJob.create({
    media_id: mediaItemId,
    source_type: 'link',
    output_format: outputFormat,
    quality: outputFormat === 'mp4' ? quality : null,
    audio_bitrate_kbps: outputFormat === 'mp3' ? audioBitrateKbps : null,
    status: 'queued',
    progress: 0,
    downloaded_bytes: 0
  })

  return job
}
