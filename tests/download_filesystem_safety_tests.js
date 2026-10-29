import assert from 'node:assert/strict'
import os from 'node:os'
import path from 'node:path'
import fs from 'node:fs/promises'
import fsSync from 'node:fs'
import {
  validateDownloadFolder,
  verifyDownloadFolderWritable,
  checkDownloadDiskSpace,
  assertPathInsideDirectory,
  assertRealPathInsideDirectory,
  sanitizeWindowsFilename,
  isWindowsReservedFilename
} from '../src/main/backend/services/downloadFileSafetyService.js'
import {
  prepareJobTemporaryWorkspace,
  cleanupJobTemporaryFiles,
  cleanupStaleJobTemporaryFiles,
  PARTIAL_DOWNLOADS_DIR_NAME
} from '../src/main/backend/services/downloadCleanupService.js'

console.log('====================================================================')
console.log(' APPLAN2 — Step 04.44 Test Group I: Filesystem Safety Test Suite    ')
console.log('====================================================================\n')

async function runFilesystemSafetyTests() {
  const tempTestDir = await fs.mkdtemp(path.join(os.tmpdir(), 'applan2-fssafety-test-'))
  console.log(`[setup] Isolated temporary directory created: ${tempTestDir}`)

  try {
    // ------------------------------------------------------------------------
    // 1. validateDownloadFolder
    // ------------------------------------------------------------------------
    console.log('--- 1. Testing validateDownloadFolder ---')

    // Valid absolute existing folder
    const validResult = await validateDownloadFolder(tempTestDir)
    assert.equal(
      path.resolve(validResult),
      path.resolve(tempTestDir),
      '1.1: Returns canonical path for valid directory'
    )

    // Empty or non-string input rejection
    await assert.rejects(
      async () => validateDownloadFolder(''),
      /A valid download folder path is required/,
      '1.2: Empty path rejected'
    )
    await assert.rejects(
      async () => validateDownloadFolder(null),
      /A valid download folder path is required/,
      '1.3: null path rejected'
    )
    await assert.rejects(
      async () => validateDownloadFolder('path\0with\0null'),
      /A valid download folder path is required/,
      '1.4: Null-byte path rejected'
    )

    // Relative path rejection
    await assert.rejects(
      async () => validateDownloadFolder('relative/path/downloads'),
      /Download path must be an absolute filesystem path/,
      '1.5: Relative path rejected'
    )
    await assert.rejects(
      async () => validateDownloadFolder('./downloads'),
      /Download path must be an absolute filesystem path/,
      '1.6: Dot-relative path rejected'
    )

    // Illegal characters rejection (e.g. < > " | ? *)
    const illegalChars = ['<', '>', '"', '|', '?', '*']
    for (const char of illegalChars) {
      await assert.rejects(
        async () => validateDownloadFolder(`C:\\Downloads\\bad${char}name`),
        /The specified download path contains invalid characters/,
        `1.7: Path with illegal character '${char}' rejected`
      )
    }

    // Drive root rejection (C:\, D:\)
    const rootDrive = path.parse(tempTestDir).root
    await assert.rejects(
      async () => validateDownloadFolder(rootDrive),
      /Root drive directories cannot be used as the download folder/,
      '1.8: Drive root path rejected'
    )

    // Non-existent folder rejection
    const nonExistentPath = path.join(tempTestDir, 'folder_that_does_not_exist_987654')
    await assert.rejects(
      async () => validateDownloadFolder(nonExistentPath),
      /The specified download directory does not exist/,
      '1.9: Non-existent directory rejected'
    )

    // File path rejection (must be directory, not a regular file)
    const testFile = path.join(tempTestDir, 'regular_file.txt')
    await fs.writeFile(testFile, 'sample content', 'utf8')
    await assert.rejects(
      async () => validateDownloadFolder(testFile),
      /Download path must be an existing directory, not a file/,
      '1.10: Regular file path rejected'
    )

    console.log('✓ Section 1: validateDownloadFolder validation rules verified.\n')

    // ------------------------------------------------------------------------
    // 2. verifyDownloadFolderWritable
    // ------------------------------------------------------------------------
    console.log('--- 2. Testing verifyDownloadFolderWritable ---')

    // Writable temporary directory should pass write probe check
    const isWritable = await verifyDownloadFolderWritable(tempTestDir)
    assert.equal(isWritable, true, '2.1: Temporary directory passes write probe check')

    // Non-existent directory fails
    await assert.rejects(
      async () => verifyDownloadFolderWritable(nonExistentPath),
      /The specified download directory does not exist/,
      '2.2: Non-existent directory rejected by write check'
    )

    console.log('✓ Section 2: verifyDownloadFolderWritable probe verified.\n')

    // ------------------------------------------------------------------------
    // 3. checkDownloadDiskSpace
    // ------------------------------------------------------------------------
    console.log('--- 3. Testing checkDownloadDiskSpace ---')

    // Valid check on temporary folder without estimate
    const diskInfoNoEstimate = await checkDownloadDiskSpace({ downloadPath: tempTestDir })
    assert.equal(typeof diskInfoNoEstimate.sufficient, 'boolean', '3.1: sufficient is boolean')
    assert.equal(diskInfoNoEstimate.sufficient, true, '3.2: sufficient is true when unconstrained')

    // Small estimate (1 KB) should easily be sufficient
    const diskInfoSmall = await checkDownloadDiskSpace({
      downloadPath: tempTestDir,
      estimatedRequiredBytes: 1024
    })
    assert.equal(diskInfoSmall.sufficient, true, '3.3: Small estimate (1 KB) is sufficient')
    assert.equal(diskInfoSmall.estimatedRequiredBytes, 1024)

    // Giant estimate (1000 Petabytes: 10^18 bytes) should report insufficient if statfs is supported
    const hugeBytes = 1000 * 1024 * 1024 * 1024 * 1024 * 1024
    const diskInfoHuge = await checkDownloadDiskSpace({
      downloadPath: tempTestDir,
      estimatedRequiredBytes: hugeBytes
    })
    if (diskInfoHuge.supported) {
      assert.equal(
        diskInfoHuge.sufficient,
        false,
        '3.4: 1000 Petabytes requirement is insufficient'
      )
      assert.equal(diskInfoHuge.verified, true)
    } else {
      console.log('  (statfs not supported on this platform/filesystem; fallback graceful)')
    }

    // Invalid parameters throw
    await assert.rejects(
      async () => checkDownloadDiskSpace({ downloadPath: '' }),
      /A valid download folder path is required/,
      '3.5: Empty path rejected'
    )

    console.log('✓ Section 3: checkDownloadDiskSpace verified.\n')

    // ------------------------------------------------------------------------
    // 4. Path Traversal & Lexical Containment Protection
    // ------------------------------------------------------------------------
    console.log('--- 4. Testing Path Traversal Assertions ---')

    const safeChild = path.join(tempTestDir, 'safe_file.mp4')
    const outsideChild = path.join(tempTestDir, '..', 'escaped_file.mp4')

    // Safe child passes
    assert.doesNotThrow(() => {
      assertPathInsideDirectory(safeChild, tempTestDir)
    }, '4.1: Subpath inside parent directory passes')

    // Traversal child fails
    assert.throws(
      () => {
        assertPathInsideDirectory(outsideChild, tempTestDir)
      },
      /Path traversal detected/,
      '4.2: Directory traversal parent escape throws'
    )

    // Real path assertion (handles symlinks and canonical resolution)
    await assert.doesNotReject(async () => {
      await assertRealPathInsideDirectory(safeChild, tempTestDir)
    }, '4.3: Real path subpath passes')

    await assert.rejects(
      async () => {
        await assertRealPathInsideDirectory(outsideChild, tempTestDir)
      },
      /Path traversal detected/,
      '4.4: Real path traversal parent escape throws'
    )

    console.log('✓ Section 4: Path traversal checks verified.\n')

    // ------------------------------------------------------------------------
    // 5. sanitizeWindowsFilename & Reserved Filenames
    // ------------------------------------------------------------------------
    console.log('--- 5. Testing Windows Filename Sanitization ---')

    // Illegal characters replaced by underscores
    const dirtyName = 'video:title<with>?quotes*"and"|pipes.mp4'
    const sanitized = sanitizeWindowsFilename(dirtyName)
    assert.ok(!/[<>:"/\\|?*]/.test(sanitized), '5.1: No Windows illegal characters remain')
    assert.equal(sanitized, 'video_title_with__quotes__and__pipes.mp4')

    // Trailing dots and spaces stripped
    const trailingDotsSpaces = 'video title ...   '
    assert.equal(
      sanitizeWindowsFilename(trailingDotsSpaces),
      'video title',
      '5.2: Trailing spaces/dots stripped'
    )

    // Windows device reserved names prefixed with underscore
    assert.equal(isWindowsReservedFilename('CON'), true, '5.3: CON is reserved')
    assert.equal(isWindowsReservedFilename('nul.txt'), true, '5.4: NUL is reserved')
    assert.equal(isWindowsReservedFilename('aux.mp4'), true, '5.5: AUX is reserved')
    assert.equal(isWindowsReservedFilename('com1.mp3'), true, '5.6: COM1 is reserved')
    assert.equal(
      isWindowsReservedFilename('normal_video.mp4'),
      false,
      '5.7: Normal filename is not reserved'
    )

    assert.equal(sanitizeWindowsFilename('CON'), '_CON', '5.8: Reserved name CON sanitized to _CON')
    assert.equal(sanitizeWindowsFilename('nul'), '_nul', '5.9: Reserved name nul sanitized to _nul')

    // Unicode titles preserved
    const sinhalaTitle = 'ලස්සන සිංදු එකතුව - 2026.mp4'
    assert.equal(
      sanitizeWindowsFilename(sinhalaTitle),
      sinhalaTitle,
      '5.10: Sinhala / Unicode characters preserved without mangling'
    )

    console.log('✓ Section 5: Filename sanitization & reserved names verified.\n')

    // ------------------------------------------------------------------------
    // 6. cleanupJobTemporaryFiles & Workspace Lifecycle
    // ------------------------------------------------------------------------
    console.log('--- 6. Testing Temporary Workspace & Cleanup ---')

    const jobId = 1001
    // Prepare workspace
    const workspace = await prepareJobTemporaryWorkspace(jobId, tempTestDir)
    assert.ok(fsSync.existsSync(workspace), '6.1: Workspace folder created')
    assert.ok(workspace.endsWith(`job-${jobId}`), '6.2: Workspace folder contains job id')

    // Create temporary artifacts and fragments in the job workspace
    const partFile = path.join(workspace, 'temp_video.mp4.part')
    const ytdlFile = path.join(workspace, 'temp_video.mp4.ytdl')
    await fs.writeFile(partFile, 'partial binary chunk 1')
    await fs.writeFile(ytdlFile, 'metadata fragment')
    assert.ok(fsSync.existsSync(partFile), '6.3: Partial file created in workspace')

    // Also create a final completed media file in the main download directory
    const finalMediaFile = path.join(tempTestDir, `final_download_[job-${jobId}].mp4`)
    await fs.writeFile(finalMediaFile, 'FINAL COMPLETE MEDIA CONTENT')
    assert.ok(fsSync.existsSync(finalMediaFile), '6.4: Final media file created in output dir')

    // Execute cleanup for job 1001
    const cleanupResult = await cleanupJobTemporaryFiles(jobId, tempTestDir)
    assert.equal(cleanupResult.success, true, '6.5: Cleanup succeeds')
    assert.equal(cleanupResult.cleaned, true, '6.6: Workspace cleaned flag is true')

    // The job workspace directory and fragments must be DELETED
    assert.equal(fsSync.existsSync(workspace), false, '6.7: Job temporary workspace folder deleted')
    assert.equal(fsSync.existsSync(partFile), false, '6.8: Partial file deleted')

    // CRITICAL SAFETY: Final completed media file must REMAIN INTACT!
    assert.equal(
      fsSync.existsSync(finalMediaFile),
      true,
      '6.9: Completed media file in output directory is 100% PRESERVED'
    )
    const content = await fs.readFile(finalMediaFile, 'utf8')
    assert.equal(content, 'FINAL COMPLETE MEDIA CONTENT', '6.10: Content intact')

    // Idempotent cleanup of non-existent job workspace
    const secondCleanup = await cleanupJobTemporaryFiles(jobId, tempTestDir)
    assert.equal(secondCleanup.success, true, '6.11: Second cleanup returns success')
    assert.equal(secondCleanup.cleaned, false, '6.12: Second cleanup cleaned: false')
    assert.equal(
      secondCleanup.reason,
      'directory_not_found',
      '6.13: Second cleanup reason directory_not_found'
    )

    console.log('✓ Section 6: Workspace lifecycle and cleanup safety verified.\n')

    // ------------------------------------------------------------------------
    // 7. Issue 01: Job Temporary Workspace Symlink and Junction Safety (Tests 1 - 10)
    // ------------------------------------------------------------------------
    console.log('--- 7. Testing Issue 01 Job Workspace Symlink & Junction Guards (Tests 1-10) ---')

    const basePartialDir = path.join(tempTestDir, PARTIAL_DOWNLOADS_DIR_NAME)
    await fs.mkdir(basePartialDir, { recursive: true })

    // TEST 1: Normal new job workspace created successfully
    const ws101 = await prepareJobTemporaryWorkspace(101, tempTestDir)
    assert.ok(fsSync.existsSync(ws101), 'TEST 1: Normal job workspace created successfully')

    // TEST 2: Normal existing job directory remains compatible
    const ws101Reused = await prepareJobTemporaryWorkspace(101, tempTestDir)
    assert.equal(ws101Reused, ws101, 'TEST 2: Normal existing job directory accepted and reused')

    // TEST 3 & 4: Job-specific directory is a symlink/junction to an external directory with outside sentinel
    const externalSafeDir = await fs.mkdtemp(path.join(os.tmpdir(), 'applan2-outside-'))
    const outsideSentinel = path.join(externalSafeDir, 'sentinel.txt')
    await fs.writeFile(outsideSentinel, 'OUTSIDE_SENTINEL_CONTENT')
    const outsideStatBefore = await fs.stat(outsideSentinel)

    const maliciousJobPath = path.join(basePartialDir, 'job-77')
    // Create directory junction pointing outside
    await fs.symlink(externalSafeDir, maliciousJobPath, 'junction')

    // TEST 3: Preparation rejects unsafe symlink/junction job directory
    await assert.rejects(
      async () => prepareJobTemporaryWorkspace(77, tempTestDir),
      /Unsafe temporary workspace/,
      'TEST 3: Job preparation must reject symlink or junction pointing outside'
    )

    // TEST 4: Outside sentinel file remains completely unaltered
    const outsideStatAfter = await fs.stat(outsideSentinel)
    assert.equal(
      outsideStatAfter.mtimeMs,
      outsideStatBefore.mtimeMs,
      'TEST 4: Outside sentinel mtime intact'
    )
    assert.equal(
      await fs.readFile(outsideSentinel, 'utf8'),
      'OUTSIDE_SENTINEL_CONTENT',
      'TEST 4: Outside sentinel content intact'
    )

    // Remove the junction link safely (without touching externalSafeDir target)
    await fs.unlink(maliciousJobPath)
    await fs.rm(externalSafeDir, { recursive: true, force: true })

    // TEST 5: Parent partial-downloads directory is a symlink/junction -> preparation rejects
    const testDirWithParentLink = await fs.mkdtemp(path.join(os.tmpdir(), 'applan2-parent-link-'))
    const outsideParentTarget = await fs.mkdtemp(path.join(os.tmpdir(), 'applan2-outside-parent-'))
    const symlinkParentDir = path.join(testDirWithParentLink, PARTIAL_DOWNLOADS_DIR_NAME)
    await fs.symlink(outsideParentTarget, symlinkParentDir, 'junction')

    await assert.rejects(
      async () => prepareJobTemporaryWorkspace(105, testDirWithParentLink),
      /Unsafe temporary workspace parent/,
      'TEST 5: Job preparation must reject a symlinked base partial-downloads parent'
    )
    await fs.unlink(symlinkParentDir)
    await fs.rm(outsideParentTarget, { recursive: true, force: true })
    await fs.rm(testDirWithParentLink, { recursive: true, force: true })

    // TEST 6: Windows junction pointing outside trusted folder rejected (tested in TEST 3 above)
    assert.ok(true, 'TEST 6: Windows junction to outside directory verified')

    // TEST 7: Existing job path is a regular file (not a directory) -> rejected
    const fileJobPath = path.join(basePartialDir, 'job-107')
    await fs.writeFile(fileJobPath, 'NOT_A_DIRECTORY')
    await assert.rejects(
      async () => prepareJobTemporaryWorkspace(107, tempTestDir),
      /existing path is not a directory/,
      'TEST 7: Job preparation must reject an existing regular file with the job folder name'
    )
    await fs.rm(fileJobPath)

    // TEST 8: Normal cancellation cleanup still works
    const ws108 = await prepareJobTemporaryWorkspace(108, tempTestDir)
    await fs.writeFile(path.join(ws108, 'chunk.part'), 'PARTIAL_DATA')
    const cancelCleanupResult = await cleanupJobTemporaryFiles(108, tempTestDir)
    assert.equal(cancelCleanupResult.success, true, 'TEST 8: Cancellation cleanup succeeds')
    assert.equal(fsSync.existsSync(ws108), false, 'TEST 8: Workspace removed upon cancellation')

    // TEST 9: Normal restart-recovery cleanup still works
    const ws109 = await prepareJobTemporaryWorkspace(109, tempTestDir)
    await fs.writeFile(path.join(ws109, 'stale.part'), 'STALE_DATA')
    const staleCleanup = await cleanupStaleJobTemporaryFiles(109, tempTestDir)
    assert.equal(staleCleanup.success, true, 'TEST 9: Stale job cleanup succeeds')
    assert.equal(fsSync.existsSync(ws109), false, 'TEST 9: Stale workspace 109 removed')

    // TEST 10: Cleaning job-101 does not affect job-102
    const ws101b = await prepareJobTemporaryWorkspace(101, tempTestDir)
    const ws102b = await prepareJobTemporaryWorkspace(102, tempTestDir)
    const file101 = path.join(ws101b, 'file101.part')
    const file102 = path.join(ws102b, 'file102.part')
    await fs.writeFile(file101, 'DATA_101')
    await fs.writeFile(file102, 'DATA_102')

    await cleanupJobTemporaryFiles(101, tempTestDir)
    assert.equal(fsSync.existsSync(ws101b), false, 'TEST 10: Workspace 101 deleted')
    assert.equal(fsSync.existsSync(ws102b), true, 'TEST 10: Workspace 102 remains intact')
    assert.equal(await fs.readFile(file102, 'utf8'), 'DATA_102', 'TEST 10: File 102 remains intact')
    await cleanupJobTemporaryFiles(102, tempTestDir)

    console.log('✓ Section 7: Issue 01 symlink & junction preparation tests (1-10) passed.\n')

    console.log('====================================================================')
    console.log(' ALL FILESYSTEM SAFETY TESTS PASSED SUCCESSFULLY (100% PASS)        ')
    console.log('====================================================================\n')
  } finally {
    // Teardown temporary directory
    try {
      await fs.rm(tempTestDir, { recursive: true, force: true })
      console.log(`[teardown] Removed temporary directory: ${tempTestDir}`)
    } catch (cleanupErr) {
      console.warn(`[teardown] Warning removing temporary directory: ${cleanupErr.message}`)
    }
  }
}

runFilesystemSafetyTests().catch((err) => {
  console.error('\n❌ FILESYSTEM SAFETY TEST SUITE FAILED:', err)
  process.exit(1)
})
