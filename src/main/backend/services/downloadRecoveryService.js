
import { getDatabase } from '../config/database.js'

export async function recoverInterruptedDownloadJobs() {
  const sequelize = getDatabase()
  const DownloadJob = sequelize.models.DownloadJob

  return sequelize.transaction(async (transaction) => {
    // 1. Recover stale downloading jobs
    const [interruptedDownloads] = await DownloadJob.update(
      {
        status: 'failed',
        error_message:
          'Download was interrupted by application shutdown or restart. Please retry.'
      },
      {
        where: {
          status: 'downloading'
        },
        transaction
      }
    )

    // 2. Recover stale queued jobs
    const [interruptedQueuedJobs] = await DownloadJob.update(
      {
        status: 'failed',
        error_message:
          'Queued download was interrupted before execution. Please retry.'
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
      interruptedQueuedJobs
    }
  })
}

