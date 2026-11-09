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

  // 1. Read initial settings
  const initial = app.getLoginItemSettings(options)
  console.log('1. Initial login item settings:', {
    openAtLogin: initial.openAtLogin,
    openAsHidden: initial.openAsHidden,
    executableWillLaunchAtLogin: initial.executableWillLaunchAtLogin
  })
  const initialOpenAtLogin = initial.openAtLogin

  try {
    // 2. Toggle ON
    console.log('\n2. Toggling Start With Windows -> ON...')
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

    // 3. Toggle OFF
    console.log('\n3. Toggling Start With Windows -> OFF...')
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

    // 4. Restore original user setting
    console.log(`\n4. Restoring original preference (was: ${initialOpenAtLogin})...`)
    app.setLoginItemSettings({
      openAtLogin: initialOpenAtLogin,
      ...options
    })

    const restoredState = app.getLoginItemSettings(options)
    console.log('   Restored state:', {
      openAtLogin: restoredState.openAtLogin
    })
    assert.equal(
      restoredState.openAtLogin,
      initialOpenAtLogin,
      'Restored setting must match initial preference'
    )

    console.log('\n================================================================')
    console.log(' ALL WINDOWS STARTUP INTEGRATION CHECKS PASSED (100% PASS)       ')
    console.log('================================================================')
  } catch (err) {
    // Ensure restoration even if assertion fails
    try {
      app.setLoginItemSettings({
        openAtLogin: initialOpenAtLogin,
        ...options
      })
    } catch (cleanupErr) {
      console.error('Failed to restore login item settings in error handler:', cleanupErr)
    }
    throw err
  } finally {
    app.quit()
  }
}

app.whenReady().then(run)
