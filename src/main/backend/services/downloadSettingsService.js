
const DOWNLOAD_PATH_KEY = 'download_path'

export async function getSavedDownloadPath(AppSetting) {
  const setting = await AppSetting.findOne({
    where: {
      key: DOWNLOAD_PATH_KEY
    }
  })

  return setting?.value ?? null
}

export async function saveDownloadPath(AppSetting, folderPath) {
  if (typeof folderPath !== 'string' || !folderPath.trim()) {
    throw new Error('A valid download folder path is required')
  }

  const cleanPath = folderPath.trim()

  await AppSetting.upsert({
    key: DOWNLOAD_PATH_KEY,
    value: cleanPath
  })

  return cleanPath
}
