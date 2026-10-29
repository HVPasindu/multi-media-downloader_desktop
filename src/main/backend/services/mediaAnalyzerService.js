import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { detectPlatform } from '../providers/providerManager.js'
import { resolveYtDlpPath, resolveJavaScriptRuntimeOption } from './executablePathService.js'

const execFileAsync = promisify(execFile)

export async function analyzeMedia(sourceUrl) {
  const platform = detectPlatform(sourceUrl)

  if (!platform) {
    throw new Error('Unsupported or invalid media URL')
  }

  const cleanUrl = sourceUrl.trim()

  // Step 04.43 - Resolve executable and runtime for packaged/dev environment
  const ytDlpExecutable = await resolveYtDlpPath()
  const jsRuntimeOption = await resolveJavaScriptRuntimeOption()

  const { stdout } = await execFileAsync(
    ytDlpExecutable,
    [
      '--js-runtimes',
      jsRuntimeOption,
      '--no-playlist',
      '--dump-single-json',
      '--skip-download',
      cleanUrl
    ],
    {
      windowsHide: true,
      timeout: 60000,
      maxBuffer: 20 * 1024 * 1024
    }
  )

  // Parse yt-dlp metadata safely
  let metadata

  try {
    metadata = JSON.parse(stdout)
  } catch {
    throw new Error('Media Analyzer returned invalid JSON metadata')
  }

  return parseMediaMetadata(metadata, platform, cleanUrl)
}

/**
 * Parses and validates raw yt-dlp metadata JSON object into structured media metadata.
 *
 * @param {object} metadata - Raw yt-dlp metadata object
 * @param {string} platform - Platform identifier (e.g. 'youtube', 'facebook')
 * @param {string} sourceUrl - Cleaned source URL
 * @returns {object} Structured media analysis result
 */
export function parseMediaMetadata(metadata, platform, sourceUrl) {
  // Validate required metadata fields
  if (
    !metadata ||
    typeof metadata !== 'object' ||
    Array.isArray(metadata) ||
    typeof metadata.id !== 'string' ||
    !metadata.id.trim() ||
    typeof metadata.title !== 'string' ||
    !metadata.title.trim()
  ) {
    throw new Error('Media metadata is missing required details')
  }

  // Validate the formats collection
  if (metadata.formats != null && !Array.isArray(metadata.formats)) {
    throw new Error('Media metadata contains an invalid formats list')
  }

  const formats = Array.isArray(metadata.formats) ? metadata.formats : []

  //quality_video
  const qualityHeights = new Set()

  for (const format of formats) {
    const isTwitterHttp =
      platform === 'twitter' &&
      format &&
      typeof format === 'object' &&
      typeof format.format_id === 'string' &&
      format.format_id.startsWith('http-')

    if (
      format &&
      typeof format === 'object' &&
      ((typeof format.vcodec === 'string' && format.vcodec !== 'none') || isTwitterHttp) &&
      Number.isInteger(format.height) &&
      format.height > 0
    ) {
      qualityHeights.add(format.height)
    }
  }

  const videoQualities = [...qualityHeights].sort((a, b) => b - a).map((height) => `${height}p`)

  const isTwitterAudioFormat = (format) =>
    platform === 'twitter' &&
    format &&
    typeof format === 'object' &&
    format.vcodec === 'none' &&
    (format.resolution === 'audio only' ||
      (typeof format.format_id === 'string' && format.format_id.startsWith('hls-audio-')) ||
      format.audio_ext === 'mp4' ||
      (typeof format.format_note === 'string' && format.format_note.toLowerCase().includes('audio')) ||
      (Number.isFinite(format.abr) && format.abr > 0))

  //MP3 option
  const hasAudioStream = formats.some(
    (format) =>
      format &&
      typeof format === 'object' &&
      ((typeof format.acodec === 'string' && format.acodec !== 'none') || isTwitterAudioFormat(format))
  )

  const audioOptions = hasAudioStream ? ['mp3'] : []

  // Identify actual downloadable source formats
  const validFormats = formats.filter(
    (format) => format && typeof format === 'object' && !Array.isArray(format)
  )

  // Audio-only source formats
  const audioFormats = validFormats
    .filter(
      (format) =>
        (format.vcodec === 'none' && typeof format.acodec === 'string' && format.acodec !== 'none') ||
        isTwitterAudioFormat(format)
    )
    .map((format) => ({
      formatId: format.format_id ?? null,
      extension: format.ext ?? null,
      audioCodec:
        typeof format.acodec === 'string' && format.acodec !== 'none'
          ? format.acodec
          : platform === 'twitter'
            ? 'aac'
            : null,
      fileSize: format.filesize ?? format.filesize_approx ?? null
    }))

  // Our current MP4 download selector uses M4A audio
  const hasM4aAudio = audioFormats.some((format) => format.extension === 'm4a')
  const hasTwitterAudio = platform === 'twitter' && audioFormats.length > 0

  // Find MP4 video sources compatible with our selector
  const mp4Formats = validFormats
    .filter((format) => {
      const isTwitterHttp =
        platform === 'twitter' &&
        typeof format.format_id === 'string' &&
        format.format_id.startsWith('http-')

      const hasVideo =
        (typeof format.vcodec === 'string' && format.vcodec !== 'none') || isTwitterHttp

      const hasAudio =
        (typeof format.acodec === 'string' && format.acodec !== 'none') ||
        (isTwitterHttp && hasAudioStream)

      return (
        format.ext === 'mp4' &&
        hasVideo &&
        Number.isInteger(format.height) &&
        format.height > 0 &&
        (hasAudio || hasM4aAudio || hasTwitterAudio)
      )
    })
    .map((format) => {
      const isTwitterHttp =
        platform === 'twitter' &&
        typeof format.format_id === 'string' &&
        format.format_id.startsWith('http-')

      return {
        formatId: format.format_id ?? null,
        quality: `${format.height}p`,
        height: format.height,
        videoCodec: format.vcodec ?? (isTwitterHttp ? 'h264' : null),
        audioIncluded:
          (typeof format.acodec === 'string' && format.acodec !== 'none') ||
          (isTwitterHttp && hasAudioStream),
        fileSize: format.filesize ?? format.filesize_approx ?? null
      }
    })

  // Build unique MP4 quality options
  const mp4Qualities = [...new Set(mp4Formats.map((format) => format.height))]
    .sort((a, b) => b - a)
    .map((height) => `${height}p`)

  const availableFormats = {
    mp4Qualities,
    mp4Formats,
    audioFormats
  }

  return {
    id: metadata.id.trim(),
    platform,
    sourceUrl: typeof sourceUrl === 'string' ? sourceUrl.trim() : '',
    title: metadata.title.trim(),
    thumbnailUrl: typeof metadata.thumbnail === 'string' ? metadata.thumbnail : null,
    durationSeconds:
      Number.isFinite(metadata.duration) && metadata.duration >= 0
        ? Math.floor(metadata.duration)
        : null,
    videoQualities,
    audioOptions,
    availableFormats
  }
}
