
import { app } from 'electron'
import path from 'node:path'
import { mkdir } from 'node:fs/promises'

export async function getDefaultDownloadPath() {
  const downloadsPath = app.getPath('downloads')

  const folderPath = path.join(
    downloadsPath,
    'Multi Media Downloader'
  )

  await mkdir(folderPath, { recursive: true })

  return folderPath
}
