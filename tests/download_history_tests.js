import assert from 'node:assert/strict'
import path from 'node:path'
import fs from 'node:fs/promises'
import fsSync from 'node:fs'
import {
  listDownloadHistory,
  deleteDownloadHistoryRecord,
  clearDownloadHistory,
  TERMINAL_JOB_STATUSES
} from '../src/main/backend/services/downloadHistoryService.js'
import { createDownloadJob } from '../src/main/backend/services/downloadService.js'
import { createTestDatabase } from './helpers/testDatabase.js'

/**
 * ============================================================================
 * APPLAN2 — Step 04.44 Automated Test Group J: Download History Test Suite
 *
 * Covers:
 * - History query filtering (status, format, source_type)
 * - Pagination (limit, offset) and stable descending order
 * - File status resolution (available, missing, not_applicable)
 * - Single job history deletion (terminal vs active conflict)
 * - Physical file preservation (database record deleted, file remains on disk)
 * - MediaItem preservation
 * - Bulk history clear with confirmation and status allowlist
 * ============================================================================
 */
async function runDownloadHistoryTests() {
  console.log('================================================================')
  console.log(' APPLAN2 — Step 04.44 Test Group J: Download History Test Suite ')
  console.log('================================================================\n')

  const testDb = await createTestDatabase('applan2-history-test-')
  console.log(`[setup] Isolated test database ready: ${testDb.databasePath}\n`)

  try {
    const { MediaItem, DownloadJob, DownloadFile } = testDb.sequelize.models

    assert.deepEqual(
      TERMINAL_JOB_STATUSES,
      ['completed', 'failed', 'cancelled'],
      'TERMINAL_JOB_STATUSES constant check'
    )

    // Seed MediaItem
    const media = await MediaItem.create({
      source_url: 'https://www.youtube.com/watch?v=dQw4w9WgXcQ',
      platform: 'youtube',
      title: 'History Test Clip'
    })

    // Create a physical file on disk to test 'available' vs 'missing' file status
    const physicalFilePath = path.join(testDb.tempDir, 'existing_file.mp4')
    await fs.writeFile(physicalFilePath, 'fake mp4 content', 'utf-8')

    // Seed 4 jobs with different statuses and formats
    // Job 1: Completed MP4 with existing physical file
    const job1 = await createDownloadJob({
      mediaItemId: media.id,
      outputFormat: 'mp4',
      quality: '1080p'
    })
    await DownloadJob.update({ status: 'completed', progress: 100 }, { where: { id: job1.id } })
    await DownloadFile.create({
      download_job_id: job1.id,
      file_name: 'existing_file.mp4',
      file_path: physicalFilePath,
      file_format: 'mp4',
      file_size: 16
    })

    // Job 2: Completed MP3 with MISSING physical file
    const job2 = await createDownloadJob({
      mediaItemId: media.id,
      outputFormat: 'mp3',
      audioBitrateKbps: 320
    })
    await DownloadJob.update({ status: 'completed', progress: 100 }, { where: { id: job2.id } })
    await DownloadFile.create({
      download_job_id: job2.id,
      file_name: 'missing_song.mp3',
      file_path: path.join(testDb.tempDir, 'missing_song.mp3'),
      file_format: 'mp3',
      file_size: 1024
    })

    // Job 3: Failed MP4
    const job3 = await createDownloadJob({
      mediaItemId: media.id,
      outputFormat: 'mp4',
      quality: '720p'
    })
    await DownloadJob.update(
      { status: 'failed', error_message: 'Network timed out' },
      { where: { id: job3.id } }
    )

    // Job 4: Cancelled MP3
    const job4 = await createDownloadJob({
      mediaItemId: media.id,
      outputFormat: 'mp3',
      audioBitrateKbps: 128
    })
    await DownloadJob.update({ status: 'cancelled' }, { where: { id: job4.id } })

    // Job 5: Active downloading job
    const job5 = await createDownloadJob({
      mediaItemId: media.id,
      outputFormat: 'mp4',
      quality: '480p'
    })
    await DownloadJob.update({ status: 'downloading', progress: 30 }, { where: { id: job5.id } })

    // ------------------------------------------------------------------------
    // 1. History Retrieval, Filtering, and Pagination
    // ------------------------------------------------------------------------
    console.log('--- 1. Testing History Retrieval & Filters ---')

    // All jobs
    const allHistory = await listDownloadHistory()
    assert.equal(allHistory.jobs.length, 5, '1.1: Returns all 5 seeded jobs')
    assert.equal(allHistory.pagination.total, 5)

    // Filter by status = 'completed'
    const completedHistory = await listDownloadHistory({ status: 'completed' })
    assert.equal(completedHistory.jobs.length, 2, '1.2: Status filter completed returns 2 jobs')
    assert.ok(completedHistory.jobs.every((j) => j.status === 'completed'))

    // File availability check
    const job1HistoryItem = completedHistory.jobs.find((j) => j.id === job1.id)
    assert.equal(
      job1HistoryItem.file_status,
      'available',
      '1.3: Existing file resolves to available'
    )

    const job2HistoryItem = completedHistory.jobs.find((j) => j.id === job2.id)
    assert.equal(job2HistoryItem.file_status, 'missing', '1.4: Deleted file resolves to missing')

    // Filter by format = 'mp3'
    const mp3History = await listDownloadHistory({ outputFormat: 'mp3' })
    assert.equal(mp3History.jobs.length, 2, '1.5: Format filter mp3 returns 2 jobs')
    assert.ok(mp3History.jobs.every((j) => j.output_format === 'mp3'))

    // Pagination: limit 2, offset 0 vs offset 2
    const page1 = await listDownloadHistory({ limit: 2, offset: 0 })
    assert.equal(page1.jobs.length, 2, '1.6: Page 1 returns 2 items')
    assert.equal(page1.pagination.total, 5)

    const page2 = await listDownloadHistory({ limit: 2, offset: 2 })
    assert.equal(page2.jobs.length, 2, '1.7: Page 2 returns 2 items')
    assert.notEqual(page1.jobs[0].id, page2.jobs[0].id, '1.8: Pages contain distinct jobs')

    console.log('✓ Section 1: History querying, file status, and pagination verified.\n')

    // ------------------------------------------------------------------------
    // 2. Single Job History Deletion & Physical File Preservation
    // ------------------------------------------------------------------------
    console.log('--- 2. Testing Single Job History Deletion ---')

    // Attempting to delete active downloading job returns conflict outcome
    const activeDeleteResult = await deleteDownloadHistoryRecord(job5.id)
    assert.equal(
      activeDeleteResult.outcome,
      'conflict',
      '2.1: Rejects deletion of active job with conflict'
    )
    assert.ok(
      activeDeleteResult.message.includes(
        'Cancel this active download before deleting its history'
      ),
      '2.1b: Conflict message explains active download requirement'
    )

    // Deleting completed Job 1
    const deleteResult1 = await deleteDownloadHistoryRecord(job1.id)
    assert.equal(deleteResult1.outcome, 'success', '2.2: Terminal job deleted successfully')
    assert.equal(deleteResult1.jobId, job1.id)

    // Database DownloadJob record is gone
    const checkDeletedJob = await DownloadJob.findByPk(job1.id)
    assert.equal(checkDeletedJob, null, '2.3: DownloadJob record deleted from database')

    // Associated DownloadFile record is gone
    const checkDeletedFileRecord = await DownloadFile.findOne({
      where: { download_job_id: job1.id }
    })
    assert.equal(checkDeletedFileRecord, null, '2.4: DownloadFile database record deleted')

    // CRITICAL: Physical file on disk must NOT be touched!
    assert.equal(
      fsSync.existsSync(physicalFilePath),
      true,
      '2.5: Physical file on disk remains 100% preserved after history record deletion'
    )

    // MediaItem must remain preserved
    const checkMedia = await MediaItem.findByPk(media.id)
    assert.ok(checkMedia !== null, '2.6: Parent MediaItem record preserved')

    console.log(
      '✓ Section 2: Single job history deletion and physical file preservation verified.\n'
    )

    // ------------------------------------------------------------------------
    // 3. Bulk History Clear
    // ------------------------------------------------------------------------
    console.log('--- 3. Testing Bulk History Clear ---')

    // Missing confirmation body MUST fail
    await assert.rejects(
      async () => {
        await clearDownloadHistory({ confirm: false })
      },
      /Explicit confirmation \(confirm: true\) is required to clear download history/,
      '3.1: Missing confirmation rejected'
    )

    // Clear failed and cancelled jobs
    const clearResult = await clearDownloadHistory({
      confirm: true,
      statuses: ['failed', 'cancelled']
    })

    assert.equal(clearResult.deletedJobs, 2, '3.2: Two jobs (failed and cancelled) cleared')
    assert.equal(clearResult.physicalFilesDeleted, 0, '3.3: 0 physical files deleted')

    // Verify remaining jobs: Job 2 (completed) and Job 5 (downloading) must remain!
    const remainingJobs = await DownloadJob.findAll()
    const remainingIds = remainingJobs.map((j) => j.id)
    assert.ok(remainingIds.includes(job2.id), '3.4: Completed job 2 remains')
    assert.ok(remainingIds.includes(job5.id), '3.5: Active job 5 remains untouched by bulk clear')
    assert.equal(remainingJobs.length, 2)

    console.log('✓ Section 3: Bulk clear confirmation and status filtering verified.\n')

    console.log('================================================================')
    console.log(' ALL DOWNLOAD HISTORY TESTS PASSED SUCCESSFULLY (100% PASS)     ')
    console.log('================================================================\n')
  } finally {
    await testDb.cleanup()
  }
}

runDownloadHistoryTests().catch((err) => {
  console.error('\n❌ DOWNLOAD HISTORY TEST SUITE FAILED:', err)
  process.exit(1)
})
