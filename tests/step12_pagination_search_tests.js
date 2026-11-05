import assert from 'node:assert/strict'
import path from 'node:path'
import {
  validateHistoryFilters,
  listDownloadHistory
} from '../src/main/backend/services/downloadHistoryService.js'
import { createDownloadJob } from '../src/main/backend/services/downloadService.js'
import { createTestDatabase } from './helpers/testDatabase.js'

async function runStep12Tests() {
  console.log('================================================================')
  console.log(' APPLAN2 — Step 12: Downloads Manager Pagination & Search Test ')
  console.log('================================================================\n')

  // 1. Validation tests
  console.log('--- 1. Testing validateHistoryFilters with search & statuses ---')
  const v1 = validateHistoryFilters({ limit: '20', offset: '0', search: '  rock concert  ' })
  assert.ok(v1.isValid)
  assert.equal(v1.normalized.limit, 20)
  assert.equal(v1.normalized.offset, 0)
  assert.equal(v1.normalized.search, 'rock concert')

  const v2 = validateHistoryFilters({ statuses: 'failed,cancelled' })
  assert.ok(v2.isValid)
  assert.deepEqual(v2.normalized.statuses, ['failed', 'cancelled'])

  const v3 = validateHistoryFilters({ statuses: 'invalid_status_xyz' })
  assert.equal(v3.isValid, false)
  assert.ok(v3.errors.statuses)

  const v4 = validateHistoryFilters({ search: 'a'.repeat(250) })
  assert.equal(v4.isValid, false)
  assert.ok(v4.errors.search)

  console.log('✓ Test 1: validateHistoryFilters passes for pagination, search, and multi-status')

  // 2. Database tests with an isolated test database
  const testDb = await createTestDatabase('applan2-step12-test-')
  console.log(`\n[setup] Isolated test database: ${testDb.databasePath}\n`)

  try {
    const { MediaItem, DownloadJob, DownloadFile } = testDb.sequelize.models

    // Seed 3 MediaItems
    const mediaA = await MediaItem.create({
      source_url: 'https://youtube.com/watch?v=apollo11',
      platform: 'youtube',
      title: 'Apollo Moon Landing Documentary'
    })
    const mediaB = await MediaItem.create({
      source_url: 'https://vimeo.com/jazzblues',
      platform: 'vimeo',
      title: 'Jazz Blues Festival Live'
    })
    const mediaC = await MediaItem.create({
      source_url: 'https://soundcloud.com/classicalpiano',
      platform: 'soundcloud',
      title: 'Classical Piano Sonata'
    })

    // Seed 25 jobs across these media items
    // Jobs 1-10 on mediaA (completed)
    for (let i = 1; i <= 10; i++) {
      const job = await createDownloadJob({
        mediaItemId: mediaA.id,
        outputFormat: 'mp4',
        quality: '1080p'
      })
      await DownloadJob.update(
        { status: 'completed', progress: 100, createdAt: new Date(Date.now() - (30 - i) * 60000) },
        { where: { id: job.id } }
      )
      await DownloadFile.create({
        download_job_id: job.id,
        file_name: `apollo_part_${i}.mp4`,
        file_path: path.join(testDb.tempDir, `apollo_part_${i}.mp4`),
        file_format: 'mp4',
        file_size: 1024 * i
      })
    }

    // Jobs 11-18 on mediaB (failed & cancelled)
    for (let i = 11; i <= 18; i++) {
      const isFailed = i % 2 === 0
      const job = await createDownloadJob({
        mediaItemId: mediaB.id,
        outputFormat: 'mp4',
        quality: '720p'
      })
      await DownloadJob.update(
        {
          status: isFailed ? 'failed' : 'cancelled',
          error_message: isFailed ? '[NETWORK_ERROR] Network dropped' : null,
          createdAt: new Date(Date.now() - (30 - i) * 60000)
        },
        { where: { id: job.id } }
      )
      await DownloadFile.create({
        download_job_id: job.id,
        file_name: `jazz_clip_${i}.mp4`,
        file_path: path.join(testDb.tempDir, `jazz_clip_${i}.mp4`),
        file_format: 'mp4',
        file_size: 2048
      })
    }

    // Jobs 19-25 on mediaC (queued & downloading)
    for (let i = 19; i <= 25; i++) {
      const isDl = i <= 21
      const job = await createDownloadJob({
        mediaItemId: mediaC.id,
        outputFormat: 'mp3',
        audioBitrateKbps: 320
      })
      await DownloadJob.update(
        {
          status: isDl ? 'downloading' : 'queued',
          progress: isDl ? 30 : 0,
          createdAt: new Date(Date.now() - (30 - i) * 60000)
        },
        { where: { id: job.id } }
      )
    }

    console.log('--- 2. Testing Pagination Slicing (10, 20, 50 options) ---')
    // Page 1 with limit 10
    const page1 = await listDownloadHistory({ limit: 10, offset: 0 })
    assert.equal(page1.pagination.total, 25, 'Total matching jobs should be 25')
    assert.equal(page1.pagination.limit, 10)
    assert.equal(page1.pagination.offset, 0)
    assert.equal(page1.jobs.length, 10, 'Page 1 should have 10 records')

    // Page 2 with limit 10
    const page2 = await listDownloadHistory({ limit: 10, offset: 10 })
    assert.equal(page2.pagination.total, 25)
    assert.equal(page2.pagination.limit, 10)
    assert.equal(page2.pagination.offset, 10)
    assert.equal(page2.jobs.length, 10, 'Page 2 should have 10 records')

    // Page 3 with limit 10 (last page with remainder)
    const page3 = await listDownloadHistory({ limit: 10, offset: 20 })
    assert.equal(page3.pagination.total, 25)
    assert.equal(page3.jobs.length, 5, 'Page 3 should have remaining 5 records')

    // Page 1 with limit 20 (Default page size)
    const defaultPage = await listDownloadHistory({ limit: 20, offset: 0 })
    assert.equal(defaultPage.jobs.length, 20, 'Default page size 20 returns 20 records')
    assert.equal(defaultPage.pagination.total, 25)

    // Page 1 with limit 50 (Returns all 25 records on 1 page)
    const largePage = await listDownloadHistory({ limit: 50, offset: 0 })
    assert.equal(largePage.jobs.length, 25, 'Page size 50 returns all 25 records')

    // Ordering check: newest records first (DESC)
    const firstJobId = page1.jobs[0].id
    const secondJobId = page1.jobs[1].id
    assert.ok(firstJobId > secondJobId, 'Records must be ordered DESC by id/createdAt')

    console.log('✓ Test 2: Pagination slicing (10, 20, 50) and stable DESC ordering pass')

    console.log('--- 3. Testing Server-Side Search Across All Records Before Pagination ---')
    // Search for "Apollo" (media title match)
    const searchApollo = await listDownloadHistory({ search: 'Apollo', limit: 5, offset: 0 })
    assert.equal(searchApollo.pagination.total, 10, 'Apollo matches exactly 10 jobs in database')
    assert.equal(searchApollo.jobs.length, 5, 'Paginated to 5 for page 1')
    assert.ok(searchApollo.jobs.every((j) => j.media.title.includes('Apollo')))

    // Search for "vimeo" (platform match)
    const searchVimeo = await listDownloadHistory({ search: 'vimeo', limit: 20, offset: 0 })
    assert.equal(searchVimeo.pagination.total, 8, 'Vimeo matches 8 jobs')
    assert.equal(searchVimeo.jobs.length, 8)

    // Search for "apollo_part_5" (filename match)
    const searchFilename = await listDownloadHistory({
      search: 'apollo_part_5',
      limit: 10,
      offset: 0
    })
    assert.equal(searchFilename.pagination.total, 1)
    assert.equal(searchFilename.jobs[0].file.file_name, 'apollo_part_5.mp4')

    // Search for non-existent keyword
    const searchNone = await listDownloadHistory({
      search: 'nonexistentkeyword_12345',
      limit: 10,
      offset: 0
    })
    assert.equal(searchNone.pagination.total, 0)
    assert.equal(searchNone.jobs.length, 0)

    console.log('✓ Test 3: Server-side search across title, platform, filename passes')

    console.log('--- 4. Testing Multi-Status Filtering (Failed tab: failed,cancelled) ---')
    const multiStatusRes = await listDownloadHistory({
      statuses: ['failed', 'cancelled'],
      limit: 20,
      offset: 0
    })
    assert.equal(multiStatusRes.pagination.total, 8, '8 total jobs are either failed or cancelled')
    assert.equal(multiStatusRes.jobs.length, 8)
    assert.ok(multiStatusRes.jobs.every((j) => j.status === 'failed' || j.status === 'cancelled'))

    console.log('✓ Test 4: Multi-status filtering passes')

    console.log('\n================================================================')
    console.log(' APPLAN2 — Step 12 Tests 100% PASSED')
    console.log('================================================================\n')
  } finally {
    await testDb.cleanup()
  }
}

runStep12Tests().catch((err) => {
  console.error('Test execution failed:', err)
  process.exit(1)
})
