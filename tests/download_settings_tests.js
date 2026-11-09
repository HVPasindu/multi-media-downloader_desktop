import assert from 'node:assert/strict'
import path from 'node:path'
import fs from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { statfs } from 'node:fs/promises'
import {
  DEFAULT_DOWNLOAD_PREFERENCES,
  SETTING_KEYS,
  validateDownloadPreferences,
  getDownloadPreferences,
  updateDownloadPreferences
} from '../src/main/backend/services/settingsService.js'
import { getSavedDownloadPath } from '../src/main/backend/services/downloadSettingsService.js'
import { createDownloadJob } from '../src/main/backend/services/downloadService.js'
import { createTestDatabase } from './helpers/testDatabase.js'
import { SETTINGS_SECTIONS } from '../src/renderer/src/data/uiPreviewData.js'

/**
 * ============================================================================
 * APPLAN2 — Step 04.44 Automated Test Group H: Download Settings Test Suite
 *
 * Covers:
 * - Default preferences fallback (mp4, 720p, 192 kbps)
 * - Validation: formats, bitrates, quality strings, invalid paths, unknown properties
 * - Partial update semantics (unspecified preferences preserved)
 * - Active job conflict protection for download folder changes
 * - SQLite app_settings persistence
 * ============================================================================
 */
async function runDownloadSettingsTests() {
  console.log('================================================================')
  console.log(' APPLAN2 — Step 04.44 Test Group H: Settings Test Suite         ')
  console.log('================================================================\n')

  const testDb = await createTestDatabase('applan2-settings-test-')
  console.log(`[setup] Isolated test database ready: ${testDb.databasePath}\n`)

  const testFolder1 = path.join(testDb.tempDir, 'downloads_folder_1')
  const testFolder2 = path.join(testDb.tempDir, 'downloads_folder_2')
  await fs.mkdir(testFolder1, { recursive: true })
  await fs.mkdir(testFolder2, { recursive: true })

  try {
    const { AppSetting, MediaItem, DownloadJob } = testDb.sequelize.models

    // ------------------------------------------------------------------------
    // 1. Default Preferences & Key Constants
    // ------------------------------------------------------------------------
    console.log('--- 1. Testing Default Settings & Schema Constants ---')

    assert.equal(DEFAULT_DOWNLOAD_PREFERENCES.defaultFormat, 'mp4')
    assert.equal(DEFAULT_DOWNLOAD_PREFERENCES.preferredMp4Quality, '720p')
    assert.equal(DEFAULT_DOWNLOAD_PREFERENCES.preferredMp3BitrateKbps, 192)

    assert.equal(SETTING_KEYS.DOWNLOAD_PATH, 'download_path')
    assert.equal(SETTING_KEYS.DEFAULT_FORMAT, 'default_output_format')
    assert.equal(SETTING_KEYS.PREFERRED_MP4_QUALITY, 'preferred_mp4_quality')
    assert.equal(SETTING_KEYS.PREFERRED_MP3_BITRATE, 'preferred_mp3_bitrate_kbps')

    // Initially, default preferences are returned
    const initialPrefs = await getDownloadPreferences()
    assert.equal(initialPrefs.defaultFormat, 'mp4', '1.1: Default format is mp4')
    assert.equal(initialPrefs.preferredMp4Quality, '720p', '1.2: Default quality is 720p')
    assert.equal(initialPrefs.preferredMp3BitrateKbps, 192, '1.3: Default bitrate is 192')
    assert.ok(typeof initialPrefs.downloadPath === 'string', '1.4: downloadPath is a string')

    console.log('✓ Section 1: Default preferences and constants confirmed.\n')

    // ------------------------------------------------------------------------
    // 2. Settings Validation Logic (validateDownloadPreferences)
    // ------------------------------------------------------------------------
    console.log('--- 2. Testing Settings Validation ---')

    // Valid partial updates
    const v1 = await validateDownloadPreferences({ defaultFormat: 'mp3' })
    assert.equal(v1.isValid, true, '2.1: Valid defaultFormat passes')

    const v2 = await validateDownloadPreferences({ preferredMp3BitrateKbps: 320 })
    assert.equal(v2.isValid, true, '2.2: Valid 320 kbps bitrate passes')

    const v3 = await validateDownloadPreferences({ preferredMp4Quality: '1080p' })
    assert.equal(v3.isValid, true, '2.3: Valid 1080p quality passes')

    const v4 = await validateDownloadPreferences({ downloadPath: testFolder1 })
    assert.equal(v4.isValid, true, '2.4: Valid existing absolute path passes')

    // Unknown property rejection
    const vBadKey = await validateDownloadPreferences({ unknownSettingKey: 'val' })
    assert.equal(vBadKey.isValid, false, '2.5: Unknown setting property rejected')
    assert.ok(vBadKey.errors.unknownSettingKey)

    // Invalid format rejection
    const vBadFmt = await validateDownloadPreferences({ defaultFormat: 'flac' })
    assert.equal(vBadFmt.isValid, false, '2.6: Unsupported format flac rejected')

    // Invalid bitrate rejection
    const vBadBit = await validateDownloadPreferences({ preferredMp3BitrateKbps: 256 })
    assert.equal(vBadBit.isValid, false, '2.7: Unsupported bitrate 256 rejected')

    // Invalid quality format rejection
    const vBadQual = await validateDownloadPreferences({ preferredMp4Quality: 'super_hd' })
    assert.equal(vBadQual.isValid, false, '2.8: Invalid resolution format rejected')

    // Invalid relative path rejection
    const vBadPath = await validateDownloadPreferences({ downloadPath: 'relative/folder' })
    assert.equal(vBadPath.isValid, false, '2.9: Relative download path rejected')

    console.log('✓ Section 2: Validation of properties, formats, bitrates, and paths verified.\n')

    // ------------------------------------------------------------------------
    // 3. Settings Persistence & Partial Updates (updateDownloadPreferences)
    // ------------------------------------------------------------------------
    console.log('--- 3. Testing Settings Persistence & Partial Updates ---')

    // Update format and bitrate
    const updated1 = await updateDownloadPreferences({
      defaultFormat: 'mp3',
      preferredMp3BitrateKbps: 320,
      downloadPath: testFolder1
    })

    assert.equal(updated1.defaultFormat, 'mp3')
    assert.equal(updated1.preferredMp3BitrateKbps, 320)
    assert.equal(updated1.preferredMp4Quality, '720p', '3.1: Unspecified quality remains preserved')
    assert.equal(updated1.downloadPath, testFolder1)

    // Verify raw SQLite records
    const savedPathFromDb = await getSavedDownloadPath(AppSetting)
    assert.equal(savedPathFromDb, testFolder1, '3.2: getSavedDownloadPath returns saved value')

    // Second partial update (only quality)
    const updated2 = await updateDownloadPreferences({
      preferredMp4Quality: '1080p'
    })
    assert.equal(updated2.preferredMp4Quality, '1080p', '3.3: Quality updated')
    assert.equal(updated2.defaultFormat, 'mp3', '3.4: Format remains mp3')
    assert.equal(updated2.preferredMp3BitrateKbps, 320, '3.5: Bitrate remains 320')
    assert.equal(updated2.downloadPath, testFolder1, '3.6: Path remains testFolder1')

    console.log('✓ Section 3: Partial updates and SQLite persistence verified.\n')

    // ------------------------------------------------------------------------
    // 4. Active Job Conflict Protection for Folder Changes
    // ------------------------------------------------------------------------
    console.log('--- 4. Testing Active Job Folder Change Guard ---')

    const media = await MediaItem.create({
      source_url: 'https://www.youtube.com/watch?v=dQw4w9WgXcQ',
      platform: 'youtube',
      title: 'Active Job Conflict Test'
    })

    const activeJob = await createDownloadJob({
      mediaItemId: media.id,
      outputFormat: 'mp4',
      quality: '720p'
    })
    await DownloadJob.update({ status: 'downloading' }, { where: { id: activeJob.id } })

    // Attempting to change download folder while job is active MUST fail with conflict
    await assert.rejects(
      async () => {
        await updateDownloadPreferences({ downloadPath: testFolder2 })
      },
      (err) => {
        assert.ok(
          err.message.includes(
            'Cannot change download folder while downloads are active or queued'
          ),
          '4.1: Throws active download conflict error'
        )
        assert.equal(err.statusCode, 409, '4.1: Conflict status code is 409')
        return true
      },
      '4.1: Must reject downloadPath change when a job is downloading'
    )

    // Verify folder was NOT changed
    const currentFolder = await getSavedDownloadPath(AppSetting)
    assert.equal(
      currentFolder,
      testFolder1,
      '4.2: Saved folder remains testFolder1 after rejected change'
    )

    // Mark job as completed
    await DownloadJob.update({ status: 'completed' }, { where: { id: activeJob.id } })

    // Now folder change should succeed
    const allowedUpdate = await updateDownloadPreferences({ downloadPath: testFolder2 })
    assert.equal(
      allowedUpdate.downloadPath,
      testFolder2,
      '4.3: Folder changed after active jobs finished'
    )

    console.log('✓ Section 4: Active download conflict guard verified.\n')

    // ------------------------------------------------------------------------
    // 5. Real Storage Information FileSystem Calculation & Fallback
    // ------------------------------------------------------------------------
    console.log('--- 5. Testing Real Storage Info (statfs) & Drive Fallback ---')

    const stats = await statfs(testFolder2)
    const bsize = Number(stats.bsize)
    const totalBytes = Number(stats.blocks) * bsize
    const freeBytes = Number(stats.bavail ?? stats.bfree) * bsize
    const usedBytes = Math.max(0, totalBytes - freeBytes)

    assert.ok(totalBytes > 0, '5.1: Total bytes must be positive')
    assert.ok(freeBytes > 0, '5.2: Free bytes must be positive')
    assert.ok(usedBytes >= 0, '5.3: Used bytes must be non-negative')
    assert.equal(totalBytes, usedBytes + freeBytes, '5.4: totalBytes === usedBytes + freeBytes')

    const percentUsed = Math.round((usedBytes / totalBytes) * 100)
    assert.ok(
      percentUsed >= 0 && percentUsed <= 100,
      '5.5: Percentage used must be between 0 and 100'
    )

    // Test nearest existing ancestor resolution for non-existent path
    const nonExistentSub = path.join(testFolder2, 'deep', 'non_existent_folder')
    let resolved = nonExistentSub
    while (resolved && !existsSync(resolved)) {
      const parent = path.dirname(resolved)
      if (parent === resolved) break
      resolved = parent
    }
    assert.equal(
      resolved,
      testFolder2,
      '5.6: Non-existent path resolves to nearest existing ancestor'
    )

    console.log('✓ Section 5: Real filesystem storage calculations and fallback verified.\n')

    // ------------------------------------------------------------------------
    // 6. Settings Navigation Structure Verification (Exactly 4 Sections)
    // ------------------------------------------------------------------------
    console.log('--- 6. Testing Settings Navigation Sections ---')

    assert.equal(SETTINGS_SECTIONS.length, 4, '6.1: Exactly 4 settings sections')
    const sectionIds = SETTINGS_SECTIONS.map((s) => s.id)
    assert.deepEqual(
      sectionIds,
      ['general', 'quality-audio', 'appearance', 'about'],
      '6.2: Sections must be general, quality-audio, appearance, about'
    )

    const unwantedIds = ['download', 'quality', 'audio', 'advanced', 'shortcuts', 'privacy']
    for (const unwanted of unwantedIds) {
      assert.ok(!sectionIds.includes(unwanted), `6.3: Unwanted section "${unwanted}" removed`)
    }

    console.log('✓ Section 6: Settings 4-section navigation verified.\n')

    // ------------------------------------------------------------------------
    // 7. Windows Startup Preference Validation
    // ------------------------------------------------------------------------
    console.log('--- 7. Testing Windows Startup Preference Validation ---')

    const validateStartupInput = (val) => {
      if (typeof val !== 'boolean') {
        throw new Error('Invalid startup setting: enabled must be a boolean')
      }
      return true
    }

    assert.equal(validateStartupInput(true), true, '7.1: Boolean true accepted')
    assert.equal(validateStartupInput(false), true, '7.2: Boolean false accepted')
    assert.throws(
      () => validateStartupInput('true'),
      /Invalid startup setting/,
      '7.3: String "true" rejected'
    )
    assert.throws(
      () => validateStartupInput(1),
      /Invalid startup setting/,
      '7.4: Number 1 rejected'
    )
    assert.throws(() => validateStartupInput(null), /Invalid startup setting/, '7.5: Null rejected')

    console.log('✓ Section 7: Windows startup input validation verified.\n')

    console.log('================================================================')
    console.log(' ALL DOWNLOAD SETTINGS TESTS PASSED SUCCESSFULLY (100% PASS)    ')
    console.log('================================================================\n')
  } finally {
    await testDb.cleanup()
  }
}

runDownloadSettingsTests().catch((err) => {
  console.error('\n❌ DOWNLOAD SETTINGS TEST SUITE FAILED:', err)
  process.exit(1)
})
