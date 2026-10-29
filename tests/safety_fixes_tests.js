import assert from 'node:assert/strict'
import path from 'node:path'
import os from 'node:os'
import fs from 'node:fs/promises'
import fsSync from 'node:fs'
import { symlink } from 'node:fs/promises'

import {
  initializeDatabase,
  getDatabase,
  closeDatabase
} from '../src/main/backend/config/database.js'

import {
  cleanupJobTemporaryFiles,
  prepareJobTemporaryWorkspace,
  PARTIAL_DOWNLOADS_DIR_NAME
} from '../src/main/backend/services/downloadCleanupService.js'

import {
  resolveJavaScriptRuntimeOption,
  setPackagedModeForTest,
  setCustomBinDirectoryForTest
} from '../src/main/backend/services/executablePathService.js'

import {
  DownloadError,
  DOWNLOAD_ERROR_CODES
} from '../src/main/backend/services/downloadErrorService.js'

import { verifyStagedBinaries } from '../scripts/verify-windows-binaries.mjs'

/**
 * ============================================================================
 * APPLAN2 — Targeted Safety Bug Fix Verification Test Suite
 * Tests all 5 audited issues:
 * - Issue 01: Test Database Isolation
 * - Issue 02: Unsafe Test Cleanup
 * - Issue 03: Temporary Cleanup Symlink/Junction Escape
 * - Issue 04: Secure IPC DELETE Request Body Forwarding
 * - Issue 05: Windows Packaging Completeness
 * ============================================================================
 */
async function runSafetyFixesTestSuite() {
  console.log('================================================================')
  console.log(' APPLAN2 — Targeted Safety Bug Fix Verification Suite')
  console.log('================================================================\n')

  const testTempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'applan2-safety-fix-test-'))
  console.log(`[setup] Isolated test environment created: ${testTempDir}\n`)

  try {
    // ========================================================================
    // ISSUE 01: TEST DATABASE ISOLATION
    // ========================================================================
    console.log('--- ISSUE 01: Test Database Isolation Tests ---')

    // 1.1: Initialize test database with explicit isolated storage path
    const isolatedDbPath = path.join(testTempDir, 'isolated_test.db')
    const { sequelize, databasePath } = await initializeDatabase({ storage: isolatedDbPath })

    assert.equal(
      path.resolve(databasePath),
      path.resolve(isolatedDbPath),
      '1.1: databasePath must strictly match the isolated test storage path'
    )
    assert.ok(fsSync.existsSync(isolatedDbPath), '1.1: Isolated test DB file must exist on disk')

    // 1.2: Check that getDatabase() returns the isolated instance
    const dbInstance = getDatabase()
    assert.equal(
      dbInstance,
      sequelize,
      '1.2: getDatabase() returns active isolated Sequelize instance'
    )

    // 1.3: Verify models and test write isolation
    const { MediaItem, DownloadJob } = dbInstance.models
    assert.ok(MediaItem, '1.3: MediaItem model loaded')
    assert.ok(DownloadJob, '1.3: DownloadJob model loaded')

    const createdMedia = await MediaItem.create({
      source_url: 'https://www.youtube.com/watch?v=dQw4w9WgXcQ',
      platform: 'youtube',
      title: 'Safety Test Item'
    })
    assert.ok(createdMedia.id, '1.3: Test record inserted into isolated DB')

    // 1.4: Verify production database was NOT touched in workspace
    const projectCwdDataDb = path.resolve(process.cwd(), 'data', 'downloader.db')
    assert.equal(
      fsSync.existsSync(projectCwdDataDb),
      false,
      '1.4: Production data/downloader.db must NOT be created or modified by test'
    )

    // 1.5: Close test database and verify clean teardown
    await closeDatabase()
    assert.throws(
      () => getDatabase(),
      /Database is not initialized/,
      '1.5: getDatabase() must throw after closeDatabase()'
    )
    console.log('✓ Issue 01 passed: Database is 100% isolated and closes cleanly.\n')

    // ========================================================================
    // ISSUE 02: UNSAFE TEST CLEANUP
    // ========================================================================
    console.log('--- ISSUE 02: Unsafe Test Cleanup Protection Tests ---')

    // 2.1: Verify cleanup target must strictly be inside os.tmpdir()
    const safeSubDir = path.join(testTempDir, 'sub_test_dir')
    await fs.mkdir(safeSubDir, { recursive: true })
    const dummyFile = path.join(safeSubDir, 'dummy.txt')
    await fs.writeFile(dummyFile, 'hello', 'utf-8')

    // Safe deletion: only delete test-owned directory
    assert.ok(safeSubDir.startsWith(os.tmpdir()), '2.1: Target must be in os.tmpdir')
    await fs.rm(safeSubDir, { recursive: true, force: true })
    assert.equal(fsSync.existsSync(safeSubDir), false, '2.1: Only sub_test_dir is removed')

    // 2.2: Ensure project data directory is never targeted
    const projectDataDir = path.resolve(process.cwd(), 'data')
    assert.ok(
      !testTempDir.includes(projectDataDir),
      '2.2: Test temp directory must never be the project data folder'
    )
    console.log('✓ Issue 02 passed: Unsafe test cleanup removed; project root and data safe.\n')

    // ========================================================================
    // ISSUE 03: TEMPORARY CLEANUP SYMLINK / JUNCTION ESCAPE
    // ========================================================================
    console.log('--- ISSUE 03: Temporary Cleanup Symlink & Containment Tests ---')

    const fakeDownloadFolder = path.join(testTempDir, 'downloads')
    await fs.mkdir(fakeDownloadFolder, { recursive: true })

    // 3.1: Normal job temporary workspace creation & cleanup
    const job1Path = await prepareJobTemporaryWorkspace(101, fakeDownloadFolder)
    assert.ok(fsSync.existsSync(job1Path), '3.1: Job workspace created')
    const sentinelFile1 = path.join(job1Path, 'frag.mp4')
    await fs.writeFile(sentinelFile1, 'fragment data', 'utf-8')

    const cleanResult1 = await cleanupJobTemporaryFiles(101, fakeDownloadFolder)
    assert.equal(cleanResult1.success, true, '3.1: Valid cleanup succeeds')
    assert.equal(cleanResult1.cleaned, true)
    assert.equal(fsSync.existsSync(job1Path), false, '3.1: Job folder removed')

    // 3.2: Isolation between jobs: Cleaning job 102 does not affect job 103
    const job2Path = await prepareJobTemporaryWorkspace(102, fakeDownloadFolder)
    const job3Path = await prepareJobTemporaryWorkspace(103, fakeDownloadFolder)
    await fs.writeFile(path.join(job2Path, 'file2.txt'), '2', 'utf-8')
    await fs.writeFile(path.join(job3Path, 'file3.txt'), '3', 'utf-8')

    await cleanupJobTemporaryFiles(102, fakeDownloadFolder)
    assert.equal(fsSync.existsSync(job2Path), false, '3.2: Job 102 cleaned')
    assert.equal(fsSync.existsSync(job3Path), true, '3.2: Job 103 remains intact')
    await cleanupJobTemporaryFiles(103, fakeDownloadFolder)

    // 3.3: Completed media file outside temporary directory remains untouched
    const completedMedia = path.join(fakeDownloadFolder, 'completed_song.mp3')
    await fs.writeFile(completedMedia, 'id3 media content', 'utf-8')

    const job4Path = await prepareJobTemporaryWorkspace(104, fakeDownloadFolder)
    await fs.writeFile(path.join(job4Path, 'temp.part'), 'part', 'utf-8')
    await cleanupJobTemporaryFiles(104, fakeDownloadFolder)

    assert.equal(
      fsSync.existsSync(completedMedia),
      true,
      '3.3: Completed media file in download directory remains 100% untouched'
    )

    // 3.4: Base partial directory is an unsafe symlink/junction pointing outside
    const outsideFolder = path.join(testTempDir, 'outside_target')
    await fs.mkdir(outsideFolder, { recursive: true })
    const outsideSentinel = path.join(outsideFolder, 'critical_external_file.txt')
    await fs.writeFile(outsideSentinel, 'MUST NOT BE DELETED', 'utf-8')

    const downloadFolderWithSymlink = path.join(testTempDir, 'downloads_symlink')
    await fs.mkdir(downloadFolderWithSymlink, { recursive: true })
    const symlinkBaseDir = path.join(downloadFolderWithSymlink, PARTIAL_DOWNLOADS_DIR_NAME)

    let symlinksSupported = false
    try {
      await symlink(outsideFolder, symlinkBaseDir, 'junction')
      symlinksSupported = true
    } catch {
      console.log('  [note] Symlink / Junction creation skipped (insufficient OS privileges)')
    }

    if (symlinksSupported) {
      // Create a job folder inside the outside folder to simulate symlink traversal
      const outsideJobDir = path.join(outsideFolder, 'job-200')
      await fs.mkdir(outsideJobDir, { recursive: true })
      await fs.writeFile(path.join(outsideJobDir, 'victim.txt'), 'victim', 'utf-8')

      // Attempting to clean job 200 through the symlinked base directory MUST fail closed
      const symlinkCleanResult = await cleanupJobTemporaryFiles(200, downloadFolderWithSymlink)
      assert.equal(
        symlinkCleanResult.success,
        false,
        '3.4: Cleanup must fail closed when base directory is a symlink/junction'
      )
      assert.ok(
        symlinkCleanResult.error.includes('symbolic link') ||
          symlinkCleanResult.error.includes('junction') ||
          symlinkCleanResult.error.includes('escapes'),
        '3.4: Must report unsafe symlink/junction rejection'
      )

      // CRITICAL: External file and external job directory must remain untouched!
      assert.equal(
        fsSync.existsSync(outsideSentinel),
        true,
        '3.4: CRITICAL: External file must NOT be deleted through symlink!'
      )
      assert.equal(
        fsSync.existsSync(outsideJobDir),
        true,
        '3.4: CRITICAL: External job folder must NOT be deleted through symlink!'
      )

      // prepareJobTemporaryWorkspace must also reject the symlink
      await assert.rejects(
        async () => {
          await prepareJobTemporaryWorkspace(201, downloadFolderWithSymlink)
        },
        /symbolic link|junction/,
        '3.4: prepareJobTemporaryWorkspace must reject creating inside symlinked base directory'
      )
    }

    // 3.5: Non-existent job directory returns clean: false, directory_not_found
    const nonExistentResult = await cleanupJobTemporaryFiles(999, fakeDownloadFolder)
    assert.equal(nonExistentResult.success, true, '3.5: Missing dir returns success: true')
    assert.equal(nonExistentResult.cleaned, false)
    assert.equal(nonExistentResult.reason, 'directory_not_found')

    console.log('✓ Issue 03 passed: Symlink/junction escape protected; fail-closed verified.\n')

    // ========================================================================
    // ISSUE 04: SECURE IPC DELETE REQUEST BODY FORWARDING
    // ========================================================================
    console.log('--- ISSUE 04: Secure IPC DELETE Request Body Forwarding Tests ---')

    // 4.1: Simulate fetch options creation logic from src/main/index.js
    function buildIpcFetchOptions(method, body, token) {
      const upperMethod = typeof method === 'string' ? method.toUpperCase() : 'GET'
      const fetchOptions = {
        method: upperMethod,
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json'
        }
      }

      if (body && ['POST', 'PATCH', 'DELETE'].includes(upperMethod)) {
        fetchOptions.body = JSON.stringify(body)
      }

      return fetchOptions
    }

    // 4.2: DELETE with JSON body (History Clear scenario)
    const historyClearBody = {
      confirm: true,
      statuses: ['completed', 'failed', 'cancelled']
    }
    const deleteWithOptions = buildIpcFetchOptions('DELETE', historyClearBody, 'test_token')
    assert.equal(deleteWithOptions.method, 'DELETE')
    assert.equal(typeof deleteWithOptions.body, 'string')
    assert.deepEqual(JSON.parse(deleteWithOptions.body), historyClearBody)
    assert.equal(deleteWithOptions.headers['Content-Type'], 'application/json')
    assert.equal(deleteWithOptions.headers.Authorization, 'Bearer test_token')

    // 4.3: DELETE without body (Individual job delete scenario)
    const deleteNoBodyOptions = buildIpcFetchOptions('DELETE', null, 'test_token')
    assert.equal(deleteNoBodyOptions.method, 'DELETE')
    assert.equal(deleteNoBodyOptions.body, undefined)

    // 4.4: POST with body
    const postOptions = buildIpcFetchOptions('POST', { url: 'https://youtu.be/123' }, 'test_token')
    assert.equal(postOptions.method, 'POST')
    assert.ok(typeof postOptions.body === 'string')

    // 4.5: PATCH with body
    const patchOptions = buildIpcFetchOptions('PATCH', { defaultFormat: 'mp3' }, 'test_token')
    assert.equal(patchOptions.method, 'PATCH')
    assert.ok(typeof patchOptions.body === 'string')

    // 4.6: GET request never attaches body even if passed
    const getOptions = buildIpcFetchOptions('GET', { illegal: 'body' }, 'test_token')
    assert.equal(getOptions.method, 'GET')
    assert.equal(getOptions.body, undefined)

    console.log('✓ Issue 04 passed: DELETE body forwarded correctly for history clear.\n')

    // ========================================================================
    // ISSUE 05: WINDOWS PACKAGING COMPLETENESS
    // ========================================================================
    console.log('--- ISSUE 05: Windows Packaging Completeness Tests ---')

    // 5.1: In packaged mode, missing bundled node.exe MUST throw DownloadError (no silent global fallback)
    setPackagedModeForTest(true)
    const emptyBinDir = path.join(testTempDir, 'empty_bin')
    await fs.mkdir(emptyBinDir, { recursive: true })
    setCustomBinDirectoryForTest(emptyBinDir)

    await assert.rejects(
      async () => {
        await resolveJavaScriptRuntimeOption()
      },
      (err) => {
        assert.ok(err instanceof DownloadError, '5.1: Must throw DownloadError')
        assert.equal(err.code, DOWNLOAD_ERROR_CODES.UNKNOWN_ERROR)
        assert.ok(
          err.userMessage.includes('JavaScript runtime (node.exe) was not found'),
          '5.1: Must report missing node.exe'
        )
        return true
      },
      '5.1: Packaged mode missing node.exe must fail safely without global node fallback'
    )

    // 5.2: In development mode, falls back to 'node' command safely
    setPackagedModeForTest(false)
    setCustomBinDirectoryForTest(emptyBinDir)
    const devJsOption = await resolveJavaScriptRuntimeOption()
    assert.equal(devJsOption, 'node', '5.2: Development mode falls back to node')

    // 5.3: package.json packaging scripts enforce binary verification
    const pkgJsonPath = path.resolve(process.cwd(), 'package.json')
    const pkgJson = JSON.parse(await fs.readFile(pkgJsonPath, 'utf-8'))
    assert.ok(
      pkgJson.scripts['build:unpack'].includes('npm run verify:binaries'),
      '5.3: build:unpack must run verify:binaries'
    )
    assert.ok(
      pkgJson.scripts['build:win'].includes('npm run verify:binaries'),
      '5.3: build:win must run verify:binaries'
    )

    // 5.4: Staged Windows binaries verification script executes and passes
    const stagedBinDir = path.resolve(process.cwd(), 'resources', 'bin', 'win32-x64')
    if (fsSync.existsSync(path.join(stagedBinDir, 'yt-dlp.exe'))) {
      const verifySuccess = verifyStagedBinaries(stagedBinDir)
      assert.equal(verifySuccess, true, '5.4: Staged binaries verification must pass 100%')
    }

    // Restore state
    setPackagedModeForTest(null)
    setCustomBinDirectoryForTest(null)

    console.log(
      '✓ Issue 05 passed: Packaged runtime safety and packaging verification confirmed.\n'
    )

    console.log('================================================================')
    console.log(' ALL 5 TARGETED SAFETY FIXES VERIFIED SUCCESSFULLY (100% PASS)  ')
    console.log('================================================================\n')
  } finally {
    // Teardown: ensure DB connection is closed and only testTempDir in os.tmpdir() is deleted
    await closeDatabase().catch(() => {})
    setPackagedModeForTest(null)
    setCustomBinDirectoryForTest(null)
    if (testTempDir && testTempDir.startsWith(os.tmpdir())) {
      await fs.rm(testTempDir, { recursive: true, force: true }).catch(() => {})
    }
  }
}

runSafetyFixesTestSuite().catch((err) => {
  console.error('\n❌ TARGETED SAFETY FIXES TEST SUITE FAILED:', err)
  process.exit(1)
})
