import defineMediaItem from './MediaItem.js'
import defineDownloadJob from './DownloadJob.js'
import defineDownloadFile from './DownloadFile.js'
import defineAppSetting from './AppSetting.js'

export function initializeModels(sequelize) {
  const MediaItem = defineMediaItem(sequelize)
  const DownloadJob = defineDownloadJob(sequelize)
  const DownloadFile = defineDownloadFile(sequelize)
  const AppSetting = defineAppSetting(sequelize)

  // ONE MEDIA -> MANY DOWNLOAD JOBS
  MediaItem.hasMany(DownloadJob, {
    foreignKey: 'media_id',
    as: 'downloads',
    onDelete: 'RESTRICT'
  })

  DownloadJob.belongsTo(MediaItem, {
    foreignKey: 'media_id',
    as: 'media'
  })

  // ONE DOWNLOAD JOB -> ZERO OR ONE FILE
  DownloadJob.hasOne(DownloadFile, {
    foreignKey: 'download_job_id',
    as: 'file',
    onDelete: 'RESTRICT'
  })

  DownloadFile.belongsTo(DownloadJob, {
    foreignKey: 'download_job_id',
    as: 'downloadJob'
  })

  return {
    MediaItem,
    DownloadJob,
    DownloadFile,
    AppSetting
  }
}
