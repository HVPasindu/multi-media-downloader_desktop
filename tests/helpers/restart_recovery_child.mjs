import path from 'node:path'
import {
  initializeDatabase,
  closeDatabase,
  getDatabase
} from '../../src/main/backend/config/database.js'
import { recoverInterruptedDownloadJobs } from '../../src/main/backend/services/downloadRecoveryService.js'
import {
  getQueueStatus,
  stopQueueForShutdown,
  resetQueueForTesting
} from '../../src/main/backend/services/downloadQueueService.js'

async function runChildRestartRecovery() {
  const dbPath = process.argv[2]
  if (!dbPath) {
    console.error('Error: Database path CLI argument is required.')
    process.exit(1)
  }

  const resolvedDbPath = path.resolve(dbPath)
  await initializeDatabase({ storage: resolvedDbPath })

  const recoveryResult = await recoverInterruptedDownloadJobs({
    autoEnqueue: true,
    isOnline: true
  })

  const sequelize = getDatabase()
  const DownloadJob = sequelize.models.DownloadJob
  const allJobs = await DownloadJob.findAll({ raw: true })
  const qStatus = getQueueStatus()

  const resultPayload = {
    recoveryResult,
    jobs: allJobs.map((j) => ({
      id: j.id,
      status: j.status,
      progress: j.progress,
      downloaded_bytes: j.downloaded_bytes
    })),
    queueStatus: {
      activeCount: qStatus.activeCount,
      waitingCount: qStatus.waitingCount,
      maxConcurrency: qStatus.maxConcurrency,
      scheduledJobIds: qStatus.scheduledJobIds
    }
  }

  console.log('APPLAN2_CHILD_RESTART_RESULT:' + JSON.stringify(resultPayload))

  stopQueueForShutdown()
  resetQueueForTesting()
  await closeDatabase()
}

runChildRestartRecovery().catch((err) => {
  console.error('Child restart recovery error:', err)
  process.exit(1)
})
