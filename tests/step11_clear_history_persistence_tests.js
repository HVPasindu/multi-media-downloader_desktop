import assert from 'node:assert/strict'
import path from 'node:path'
import fs from 'node:fs/promises'
import fsSync from 'node:fs'
import {
  deleteDownloadHistoryRecord,
  clearDownloadHistory,
  TERMINAL_JOB_STATUSES
} from '../src/main/backend/services/downloadHistoryService.js'
import { createDownloadJob } from '../src/main/backend/services/downloadService.js'
import { createTestDatabase } from './helpers/testDatabase.js'

async function runStep11Tests() {
  console.log('================================================================')
  console.log(' APPLAN2 — Step 11: Clear All / Clear Completed Persistence Test')
  console.log('================================================================\n')

  const testDb = await createTestDatabase('applan2-step11-test-')
  console.log(`[setup] Isolated test database: ${testDb.databasePath}\n`)

  try {
    const { MediaItem, DownloadJob, DownloadFile } = testDb.sequelize.models

    assert.ok(Array.isArray(TERMINAL_JOB_STATUSES))

    // 1. Seed MediaItem
    const media = await MediaItem.create({
      source_url: 'https://www.youtube.com/watch?v=step11test01',
      platform: 'youtube',
      title: 'Step 11 Test Media'
    })

    // Create a real physical file on disk
    const physicalFilePath = path.join(testDb.tempDir, 'step11_completed.mp4')
    await fs.writeFile(physicalFilePath, 'genuine video binary content', 'utf-8')

    // 2. Seed 6 jobs covering: completed, failed, cancelled, queued, downloading, interrupted
    // Job 1: Completed MP4 with physical file
    const job1 = await createDownloadJob({
      mediaItemId: media.id,
      outputFormat: 'mp4',
      quality: '1080p'
    })
    await DownloadJob.update({ status: 'completed', progress: 100 }, { where: { id: job1.id } })
    await DownloadFile.create({
      download_job_id: job1.id,
      file_name: 'step11_completed.mp4',
      file_path: physicalFilePath,
      file_format: 'mp4',
      file_size: 2048
    })

    // Job 2: Failed MP4
    const job2 = await createDownloadJob({
      mediaItemId: media.id,
      outputFormat: 'mp4',
      quality: '720p'
    })
    await DownloadJob.update(
      { status: 'failed', error_message: '[NETWORK_ERROR] Timeout' },
      { where: { id: job2.id } }
    )

    // Job 3: Cancelled MP3
    const job3 = await createDownloadJob({
      mediaItemId: media.id,
      outputFormat: 'mp3',
      audioBitrateKbps: 320
    })
    await DownloadJob.update({ status: 'cancelled' }, { where: { id: job3.id } })

    // Job 4: Queued MP4 (Active)
    const job4 = await createDownloadJob({
      mediaItemId: media.id,
      outputFormat: 'mp4',
      quality: '480p'
    })
    await DownloadJob.update({ status: 'queued' }, { where: { id: job4.id } })

    // Job 5: Downloading MP4 (Active)
    const job5 = await createDownloadJob({
      mediaItemId: media.id,
      outputFormat: 'mp4',
      quality: '1080p'
    })
    await DownloadJob.update({ status: 'downloading', progress: 45 }, { where: { id: job5.id } })

    // Job 6: Interrupted MP4 (Active Recovery)
    const job6 = await createDownloadJob({
      mediaItemId: media.id,
      outputFormat: 'mp4',
      quality: '720p'
    })
    await DownloadJob.update({ status: 'interrupted', progress: 60 }, { where: { id: job6.id } })

    console.log('--- 1. Testing Single Record Deletion Guard for Active Jobs ---')
    // Attempt to delete queued job -> must return conflict
    const activeDelResult1 = await deleteDownloadHistoryRecord(job4.id)
    assert.equal(activeDelResult1.outcome, 'conflict')
    assert.equal(activeDelResult1.status, 'queued')

    // Attempt to delete downloading job -> must return conflict
    const activeDelResult2 = await deleteDownloadHistoryRecord(job5.id)
    assert.equal(activeDelResult2.outcome, 'conflict')
    assert.equal(activeDelResult2.status, 'downloading')

    // Attempt to delete interrupted job -> must return conflict
    const activeDelResult3 = await deleteDownloadHistoryRecord(job6.id)
    assert.equal(activeDelResult3.outcome, 'conflict')
    console.log(
      '✓ Test 1: Active jobs (queued, downloading, interrupted) are protected from deletion'
    )

    console.log('--- 2. Testing Clear Completed Persistence ---')
    // Clear only completed jobs
    const clearCompletedResult = await clearDownloadHistory({
      confirm: true,
      statuses: ['completed']
    })
    assert.equal(clearCompletedResult.deletedJobs, 1)
    assert.equal(clearCompletedResult.physicalFilesDeleted, 0)

    // Verify job 1 is deleted from SQLite
    const checkJob1 = await DownloadJob.findByPk(job1.id)
    assert.equal(checkJob1, null, 'Job 1 must be deleted from SQLite')

    // Verify physical file is untouched
    assert.ok(fsSync.existsSync(physicalFilePath), 'Physical file on disk must NOT be deleted')

    // Verify all other 5 jobs still exist in SQLite
    const remainingAfterClearCompleted = await DownloadJob.findAll({ attributes: ['id', 'status'] })
    assert.equal(remainingAfterClearCompleted.length, 5)
    console.log('✓ Test 2: Clear Completed deletes only completed job and preserves file on disk')

    console.log('--- 3. Testing Clear All Terminal History Persistence ---')
    // Clear all terminal statuses (completed, failed, cancelled)
    const clearTerminalResult = await clearDownloadHistory({
      confirm: true,
      statuses: ['completed', 'failed', 'cancelled']
    })
    assert.equal(clearTerminalResult.deletedJobs, 2, 'Should delete failed job2 and cancelled job3')

    // Verify only the 3 active jobs remain in SQLite: queued, downloading, interrupted
    const activeRemaining = await DownloadJob.findAll({ attributes: ['id', 'status'] })
    assert.equal(activeRemaining.length, 3)
    const remainingStatuses = activeRemaining.map((j) => j.status).sort()
    assert.deepEqual(remainingStatuses, ['downloading', 'interrupted', 'queued'])
    console.log('✓ Test 3: Clear All removes terminal history while keeping active jobs untouched')

    console.log('--- 4. Testing Safety Restrictions & Validation ---')
    // Cannot clear without confirm: true
    await assert.rejects(
      async () => clearDownloadHistory({ confirm: false, statuses: ['completed'] }),
      (err) => err.statusCode === 400
    )

    // Cannot include non-terminal status like 'downloading'
    await assert.rejects(
      async () => clearDownloadHistory({ confirm: true, statuses: ['downloading'] }),
      (err) => err.statusCode === 400
    )
    console.log('✓ Test 4: Validation correctly rejects unconfirmed or non-terminal clear requests')

    console.log('\n================================================================')
    console.log(' APPLAN2 — Step 11 Tests 100% PASSED')
    console.log('================================================================\n')
  } finally {
    await testDb.cleanup()
  }
}

runStep11Tests().catch((err) => {
  console.error('Test execution failed:', err)
  process.exit(1)
})
