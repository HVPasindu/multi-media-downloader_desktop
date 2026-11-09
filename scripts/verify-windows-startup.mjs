import { app } from 'electron'
import assert from 'node:assert/strict'
import { getWindowsLoginItemOptions } from '../src/main/loginItemHelper.js'

async function run() {
  console.log('================================================================')
  console.log(' APPLAN2 — Windows Startup Real Integration Test               ')
  console.log('================================================================\n')

  assert.equal(process.platform, 'win32', 'Test must run on Windows')

  const options = getWindowsLoginItemOptions(app)
  console.log('App packaged status:', app.isPackaged)
  console.log('Login item options:', options)

  let originalStartupSetting = null
  let hasCapturedOriginalStartupSetting = false

  try {
    // 1. Read initial settings
    const initial = app.getLoginItemSettings(options)
    console.log('1. Initial login item settings:', {
      openAtLogin: initial?.openAtLogin,
      openAsHidden: initial?.openAsHidden,
      executableWillLaunchAtLogin: initial?.executableWillLaunchAtLogin
    })

    assert.equal(
      typeof initial?.openAtLogin,
      'boolean',
      'initial openAtLogin must be a strict boolean from Windows'
    )
    originalStartupSetting = initial.openAtLogin
    hasCapturedOriginalStartupSetting = true
    console.log(`✓ Initial startup setting captured safely: ${originalStartupSetting}\n`)

    // 2. Toggle ON
    console.log('2. Toggling Start With Windows -> ON...')
    app.setLoginItemSettings({
      openAtLogin: true,
      ...options
    })

    const onState = app.getLoginItemSettings(options)
    console.log('   Read-back state:', {
      openAtLogin: onState.openAtLogin,
      executableWillLaunchAtLogin: onState.executableWillLaunchAtLogin
    })
    assert.equal(onState.openAtLogin, true, 'openAtLogin must be true after setting true')
    console.log('✓ Start With Windows -> ON verified.\n')

    // 3. Toggle OFF
    console.log('3. Toggling Start With Windows -> OFF...')
    app.setLoginItemSettings({
      openAtLogin: false,
      ...options
    })

    const offState = app.getLoginItemSettings(options)
    console.log('   Read-back state:', {
      openAtLogin: offState.openAtLogin,
      executableWillLaunchAtLogin: offState.executableWillLaunchAtLogin
    })
    assert.equal(offState.openAtLogin, false, 'openAtLogin must be false after setting false')
    console.log('✓ Start With Windows -> OFF verified.\n')

    console.log('================================================================')
    console.log(' ALL WINDOWS STARTUP MUTATION CHECKS COMPLETED                  ')
    console.log('================================================================')
  } finally {
    try {
      if (hasCapturedOriginalStartupSetting) {
        console.log(`\n[Cleanup] Restoring original preference (was: ${originalStartupSetting})...`)
        app.setLoginItemSettings({
          openAtLogin: originalStartupSetting,
          ...options
        })

        const restoredState = app.getLoginItemSettings(options)
        console.log('   Restored state:', {
          openAtLogin: restoredState.openAtLogin
        })
        assert.equal(
          restoredState.openAtLogin,
          originalStartupSetting,
          'Restored setting must match initial preference exactly'
        )
        console.log(
          `✓ Original Windows startup preference successfully restored to ${originalStartupSetting}.\n`
        )
      }
    } catch (restoreErr) {
      console.error('CRITICAL: Failed to restore Windows startup preference:', restoreErr)
      process.exitCode = 1
    } finally {
      app.quit()
    }
  }
}

app.whenReady().then(run)
