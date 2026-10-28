import { getDatabase } from '../config/database.js'
import { getSavedDownloadPath } from './downloadSettingsService.js'
import { getDefaultDownloadPath } from './downloadPathService.js'
import { cleanupStaleJobTemporaryFiles } from './downloadCleanupService.js'

export async function recoverInterruptedDownloadJobs() {
  const sequelize = getDatabase()
  const DownloadJob = sequelize.models.DownloadJob
  const AppSetting = sequelize.models.AppSetting

  const result = await sequelize.transaction(async (transaction) => {
    // 1. Identify stale downloading jobs to clean up their temporary files
    const staleDownloadingJobs = await DownloadJob.findAll({
      where: {
        status: 'downloading'
      },
      attributes: ['id'],
      transaction
    })

    // 2. Recover stale downloading jobs
    const [interruptedDownloads] = await DownloadJob.update(
      {
        status: 'failed',
        error_message: 'Download was interrupted by application shutdown or restart. Please retry.'
      },
      {
        where: {
          status: 'downloading'
        },
        transaction
      }
    )

    // 3. Recover stale queued jobs
    const [interruptedQueuedJobs] = await DownloadJob.update(
      {
        status: 'failed',
        error_message: 'Queued download was interrupted before execution. Please retry.'
      },
      {
        where: {
          status: 'queued'
        },
        transaction
      }
    )

    return {
      interruptedDownloads,
      interruptedQueuedJobs,
      staleDownloadingJobIds: staleDownloadingJobs.map((j) => j.id)
    }
  })

  // 4. Safely clean up job-owned temporary artifacts left behind by stale interrupted downloads
  if (result.staleDownloadingJobIds && result.staleDownloadingJobIds.length > 0) {
    try {
      const savedPath = await getSavedDownloadPath(AppSetting)
      const downloadPath = savedPath || (await getDefaultDownloadPath())

      for (const staleJobId of result.staleDownloadingJobIds) {
        try {
          await cleanupStaleJobTemporaryFiles(staleJobId, downloadPath)
        } catch (cleanupError) {
          console.warn(
            `[recovery] Failed to clean temporary files for stale job ${staleJobId}:`,
            cleanupError
          )
        }
      }
    } catch (pathError) {
      console.warn('[recovery] Failed to resolve download path for stale cleanup:', pathError)
    }
  }

  return {
    interruptedDownloads: result.interruptedDownloads,
    interruptedQueuedJobs: result.interruptedQueuedJobs
  }

  // 4. Safely clean up job-owned temporary artifacts left behind by stale interrupted downloads
  if (result.staleDownloadingJobIds && result.staleDownloadingJobIds.length > 0) {
    try {
      const savedPath = await getSavedDownloadPath(AppSetting)
      const downloadPath = savedPath || (await getDefaultDownloadPath())

      for (const staleJobId of result.staleDownloadingJobIds) {
        try {
          await cleanupStaleJobTemporaryFiles(staleJobId, downloadPath)
        } catch (cleanupError) {
          console.warn(
            `[recovery] Failed to clean temporary files for stale job ${staleJobId}:`,
            cleanupError
          )
        }
      }
    } catch (pathError) {
      console.warn(
        '[recovery] Failed to resolve download path for stale cleanup:',
        pathError
      )
    }
  }

  return {
    interruptedDownloads: result.interruptedDownloads,
    interruptedQueuedJobs: result.interruptedQueuedJobs
  }
}
