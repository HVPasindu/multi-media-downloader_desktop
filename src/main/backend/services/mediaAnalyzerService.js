
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { detectPlatform } from '../providers/providerManager.js'

const execFileAsync = promisify(execFile)

export async function analyzeMedia(sourceUrl) {
  const platform = detectPlatform(sourceUrl)

  if (!platform) {
    throw new Error('Unsupported or invalid media URL')
  }

  const cleanUrl = sourceUrl.trim()

  const { stdout } = await execFileAsync(
    'yt-dlp',
    [
      '--js-runtimes',
      'node',
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

  const metadata = JSON.parse(stdout)

  return {
    id: metadata.id ?? null,
    platform,
    sourceUrl: cleanUrl,
    title: metadata.title ?? null,
    thumbnailUrl: metadata.thumbnail ?? null,
    durationSeconds: metadata.duration ?? null
  }
}
