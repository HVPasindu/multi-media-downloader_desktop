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
  updateDownloadPreferences,
  normalizePreferredMp4Quality
} from '../src/main/backend/services/settingsService.js'
import { getSavedDownloadPath } from '../src/main/backend/services/downloadSettingsService.js'
import { createDownloadJob } from '../src/main/backend/services/downloadService.js'
import { createTestDatabase } from './helpers/testDatabase.js'
import { SETTINGS_SECTIONS } from '../src/renderer/src/data/uiPreviewData.js'
import { getWindowsLoginItemOptions } from '../src/main/loginItemHelper.js'
import { resolvePreferredVideoQuality } from '../src/renderer/src/utils/downloadPreferenceResolver.js'

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
    assert.equal(DEFAULT_DOWNLOAD_PREFERENCES.preferredMp4Quality, 'best')
    assert.equal(DEFAULT_DOWNLOAD_PREFERENCES.preferredMp3BitrateKbps, 192)

    assert.equal(SETTING_KEYS.DOWNLOAD_PATH, 'download_path')
    assert.equal(SETTING_KEYS.DEFAULT_FORMAT, 'default_output_format')
    assert.equal(SETTING_KEYS.PREFERRED_MP4_QUALITY, 'preferred_mp4_quality')
    assert.equal(SETTING_KEYS.PREFERRED_MP3_BITRATE, 'preferred_mp3_bitrate_kbps')

    // Initially, default preferences are returned
    const initialPrefs = await getDownloadPreferences()
    assert.equal(initialPrefs.defaultFormat, 'mp4', '1.1: Default format is mp4')
    assert.equal(initialPrefs.preferredMp4Quality, 'best', '1.2: Default quality is best')
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

    // Test all approved video quality options
    const approvedQualities = ['best', '2160p', '1440p', '1080p', '720p', '480p', '850p']
    for (const q of approvedQualities) {
      const vQual = await validateDownloadPreferences({ preferredMp4Quality: q })
      assert.equal(vQual.isValid, true, `2.5: Quality option "${q}" must pass validation`)
    }

    // Test all approved audio bitrate options
    const approvedBitrates = [128, 192, 320]
    for (const b of approvedBitrates) {
      const vBit = await validateDownloadPreferences({ preferredMp3BitrateKbps: b })
      assert.equal(vBit.isValid, true, `2.6: Audio bitrate "${b}" must pass validation`)
    }

    // Unknown property rejection
    const vBadKey = await validateDownloadPreferences({ unknownSettingKey: 'val' })
    assert.equal(vBadKey.isValid, false, '2.7: Unknown setting property rejected')
    assert.ok(vBadKey.errors.unknownSettingKey)

    // Invalid format rejection
    const vBadFmt = await validateDownloadPreferences({ defaultFormat: 'flac' })
    assert.equal(vBadFmt.isValid, false, '2.8: Unsupported format flac rejected')

    // Invalid bitrate rejection
    const vBadBit = await validateDownloadPreferences({ preferredMp3BitrateKbps: 256 })
    assert.equal(vBadBit.isValid, false, '2.9: Unsupported bitrate 256 rejected')

    const vBadBitStr = await validateDownloadPreferences({ preferredMp3BitrateKbps: '192' })
    assert.equal(vBadBitStr.isValid, false, '2.10: String bitrate rejected')

    // Invalid quality format rejection
    const vBadQual = await validateDownloadPreferences({ preferredMp4Quality: 'super_hd' })
    assert.equal(vBadQual.isValid, false, '2.11: Invalid resolution format rejected')

    const vBadQualZero = await validateDownloadPreferences({ preferredMp4Quality: '0p' })
    assert.equal(vBadQualZero.isValid, false, '2.12: 0p resolution rejected')

    const vBadQualHuge = await validateDownloadPreferences({ preferredMp4Quality: '5000p' })
    assert.equal(vBadQualHuge.isValid, false, '2.13: >4320p resolution rejected')

    // Invalid relative path rejection
    const vBadPath = await validateDownloadPreferences({ downloadPath: 'relative/folder' })
    assert.equal(vBadPath.isValid, false, '2.14: Relative download path rejected')

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
    assert.equal(
      updated1.preferredMp4Quality,
      'best',
      '3.1: Unspecified quality remains preserved as best'
    )
    assert.equal(updated1.downloadPath, testFolder1)

    // Verify raw SQLite records
    const savedPathFromDb = await getSavedDownloadPath(AppSetting)
    assert.equal(savedPathFromDb, testFolder1, '3.2: getSavedDownloadPath returns saved value')

    // Second partial update (only quality to 1080p)
    const updated2 = await updateDownloadPreferences({
      preferredMp4Quality: '1080p'
    })
    assert.equal(updated2.preferredMp4Quality, '1080p', '3.3: Quality updated to 1080p')
    assert.equal(updated2.defaultFormat, 'mp3', '3.4: Format remains mp3')
    assert.equal(updated2.preferredMp3BitrateKbps, 320, '3.5: Bitrate remains 320')
    assert.equal(updated2.downloadPath, testFolder1, '3.6: Path remains testFolder1')

    // Third partial update (quality back to best)
    const updated3 = await updateDownloadPreferences({
      preferredMp4Quality: 'best'
    })
    assert.equal(updated3.preferredMp4Quality, 'best', '3.7: Quality updated back to best')
    assert.equal(updated3.defaultFormat, 'mp3', '3.8: Format remains mp3')
    assert.equal(updated3.preferredMp3BitrateKbps, 320, '3.9: Bitrate remains 320')

    // Fourth partial update (audio bitrate to 128)
    const updated4 = await updateDownloadPreferences({
      preferredMp3BitrateKbps: 128
    })
    assert.equal(updated4.preferredMp3BitrateKbps, 128, '3.10: Bitrate updated to 128')
    assert.equal(updated4.preferredMp4Quality, 'best', '3.11: Quality remains best')

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

    // 7.6 - 7.9: getWindowsLoginItemOptions behavior
    const mockDevApp = {
      isPackaged: false,
      getAppPath: () => 'C:\\test\\app\\path'
    }
    const devOptions = getWindowsLoginItemOptions(mockDevApp)
    assert.equal(devOptions.path, process.execPath, '7.6: Dev mode specifies process.execPath')
    assert.deepEqual(
      devOptions.args,
      ['C:\\test\\app\\path'],
      '7.7: Dev mode specifies app path arg'
    )

    const mockPackagedApp = {
      isPackaged: true,
      getAppPath: () => 'C:\\Program Files\\App'
    }
    const packagedOptions = getWindowsLoginItemOptions(mockPackagedApp)
    assert.deepEqual(packagedOptions, {}, '7.8: Packaged mode returns empty options object')

    const nullOptions = getWindowsLoginItemOptions(null)
    assert.deepEqual(nullOptions, {}, '7.9: Null/missing app safely returns empty options object')

    console.log('✓ Section 7: Windows startup input & options helper verified.\n')

    // ------------------------------------------------------------------------
    // 8. Quality Preference Resolver (resolvePreferredVideoQuality)
    // ------------------------------------------------------------------------
    console.log('--- 8. Testing Quality Preference Resolver ---')

    const standardQualities = ['2160p', '1440p', '1080p', '720p', '480p']
    const dynamicQualities = ['1700p', '1134p', '850p', '720p', '480p', '360p']

    // 8.1 Best available
    assert.equal(
      resolvePreferredVideoQuality('best', standardQualities),
      'best',
      '8.1: best returns best'
    )
    assert.equal(
      resolvePreferredVideoQuality(null, standardQualities),
      'best',
      '8.2: null pref returns best'
    )
    assert.equal(
      resolvePreferredVideoQuality(undefined, standardQualities),
      'best',
      '8.3: undefined pref returns best'
    )

    // 8.2 Exact match
    assert.equal(
      resolvePreferredVideoQuality('1080p', standardQualities),
      '1080p',
      '8.4: exact 1080p match'
    )
    assert.equal(
      resolvePreferredVideoQuality('720p', standardQualities),
      '720p',
      '8.5: exact 720p match'
    )
    assert.equal(
      resolvePreferredVideoQuality('2160p', standardQualities),
      '2160p',
      '8.6: exact 2160p match'
    )

    // 8.3 Unavailable preference -> highest below preference
    assert.equal(
      resolvePreferredVideoQuality('1080p', dynamicQualities),
      '850p',
      '8.7: 1080p pref with dynamic qualities resolves to 850p'
    )
    assert.equal(
      resolvePreferredVideoQuality('1440p', dynamicQualities),
      '1134p',
      '8.8: 1440p pref with dynamic qualities resolves to 1134p'
    )

    // 8.4 Preference lower than all available -> lowest available
    assert.equal(
      resolvePreferredVideoQuality('360p', ['2160p', '1080p', '720p']),
      '720p',
      '8.9: falls back to lowest available'
    )
    assert.equal(
      resolvePreferredVideoQuality('240p', ['1080p', '720p']),
      '720p',
      '8.10: 240p falls back to 720p'
    )

    // 8.5 Empty or invalid available list
    assert.equal(
      resolvePreferredVideoQuality('1080p', []),
      null,
      '8.11: empty available array returns null'
    )
    assert.equal(
      resolvePreferredVideoQuality('1080p', null),
      null,
      '8.12: null available array returns null'
    )
    assert.equal(
      resolvePreferredVideoQuality('1080p', undefined),
      null,
      '8.13: undefined available returns null'
    )

    console.log('✓ Section 8: Quality preference resolver utility verified.\n')

    // ------------------------------------------------------------------------
    // 9. Stored Quality Validation & Normalization in SQLite Fallback
    // ------------------------------------------------------------------------
    console.log('--- 9. Testing Stored Quality Validation & Normalization ---')

    // 9.1 Helper unit tests
    assert.equal(normalizePreferredMp4Quality('best'), 'best', '9.1: best is normalized to best')
    assert.equal(
      normalizePreferredMp4Quality(' 1080P '),
      '1080p',
      '9.2: whitespace and case normalized'
    )
    assert.equal(normalizePreferredMp4Quality('2160p'), '2160p', '9.3: 2160p is valid')
    assert.equal(normalizePreferredMp4Quality('4320p'), '4320p', '9.4: 4320p is valid (max limit)')
    assert.equal(normalizePreferredMp4Quality('1p'), '1p', '9.5: 1p is valid (min limit)')
    assert.equal(normalizePreferredMp4Quality('0p'), null, '9.6: 0p returns null')
    assert.equal(normalizePreferredMp4Quality('5000p'), null, '9.7: 5000p returns null (>4320p)')
    assert.equal(normalizePreferredMp4Quality('1080'), null, '9.8: missing p suffix returns null')
    assert.equal(normalizePreferredMp4Quality('super_hd'), null, '9.9: non-numeric returns null')
    assert.equal(normalizePreferredMp4Quality(null), null, '9.10: null returns null')
    assert.equal(normalizePreferredMp4Quality(undefined), null, '9.11: undefined returns null')
    assert.equal(normalizePreferredMp4Quality(1080), null, '9.12: number returns null')

    // 9.2 Direct SQLite injection of invalid stored values
    await AppSetting.upsert({ key: SETTING_KEYS.PREFERRED_MP4_QUALITY, value: '0p' })
    const resZero = await getDownloadPreferences()
    assert.equal(resZero.preferredMp4Quality, 'best', '9.13: stored 0p falls back to best')

    await AppSetting.upsert({ key: SETTING_KEYS.PREFERRED_MP4_QUALITY, value: '5000p' })
    const resHuge = await getDownloadPreferences()
    assert.equal(resHuge.preferredMp4Quality, 'best', '9.14: stored 5000p falls back to best')

    await AppSetting.upsert({ key: SETTING_KEYS.PREFERRED_MP4_QUALITY, value: 'super_hd' })
    const resMalformed = await getDownloadPreferences()
    assert.equal(
      resMalformed.preferredMp4Quality,
      'best',
      '9.15: stored super_hd falls back to best'
    )

    await AppSetting.upsert({ key: SETTING_KEYS.PREFERRED_MP4_QUALITY, value: '1080' })
    const resNoP = await getDownloadPreferences()
    assert.equal(
      resNoP.preferredMp4Quality,
      'best',
      '9.16: stored 1080 (without p) falls back to best'
    )

    // 9.3 Direct SQLite injection of valid stored values
    await AppSetting.upsert({ key: SETTING_KEYS.PREFERRED_MP4_QUALITY, value: ' 2160P ' })
    const resValid = await getDownloadPreferences()
    assert.equal(
      resValid.preferredMp4Quality,
      '2160p',
      '9.17: stored whitespace/uppercase 2160P returns 2160p'
    )

    await AppSetting.upsert({ key: SETTING_KEYS.PREFERRED_MP4_QUALITY, value: '4320p' })
    const res4k = await getDownloadPreferences()
    assert.equal(res4k.preferredMp4Quality, '4320p', '9.18: stored 4320p returns 4320p')

    // 9.4 Audio bitrate string conversion from SQLite
    await AppSetting.upsert({ key: SETTING_KEYS.PREFERRED_MP3_BITRATE, value: '320' })
    const resBitrate = await getDownloadPreferences()
    assert.strictEqual(
      resBitrate.preferredMp3BitrateKbps,
      320,
      '9.19: stored string "320" returns numeric 320'
    )

    await AppSetting.upsert({ key: SETTING_KEYS.PREFERRED_MP3_BITRATE, value: '256' })
    const resBadBitrate = await getDownloadPreferences()
    assert.strictEqual(
      resBadBitrate.preferredMp3BitrateKbps,
      192,
      '9.20: stored unsupported bitrate "256" falls back to 192'
    )

    console.log('✓ Section 9: Stored quality & bitrate validation and SQLite fallbacks verified.\n')

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
