/**
 * APPLAN2 — Genuine React DOM Mounting, StrictMode & Color Picker Isolation Test Suite
 *
 * Verifies:
 * 1. Genuine React 19 DOM mounting using JSDOM, React.StrictMode, react-dom/client createRoot, and act()
 * 2. Background and Accent Color Picker dual-instance simultaneous mounting with unique field IDs
 * 3. Real DOM event interactions (input/change) and strict Background vs. Accent state/callback isolation
 * 4. Real window event listener registration (mousemove, mouseup) on mouse down on SV area
 * 5. Event listener cleanup on normal mouseup AND during unmount while dragging is active
 * 6. Sequential RGB inputs to pure black (#000000) and Hue Recovery to 240° (#2424F2 / 36,36,242)
 */

import assert from 'node:assert/strict'
import { fileURLToPath } from 'node:url'
import { JSDOM } from 'jsdom'

// Auto-respawn with electron loader if run directly with plain node
if (!process.execArgv.some((arg) => arg.includes('electron_loader'))) {
  const { execFileSync } = await import('node:child_process')
  try {
    execFileSync(
      process.execPath,
      ['--loader', './tests/loaders/electron_loader.mjs', fileURLToPath(import.meta.url)],
      { stdio: 'inherit' }
    )
    process.exit(0)
  } catch (err) {
    process.exit(err.status || 1)
  }
}

// ----------------------------------------------------------------------------
// 1. Initialize Real JSDOM Environment Before React & Component Imports
// ----------------------------------------------------------------------------
const dom = new JSDOM(
  '<!DOCTYPE html><html><head></head><body><div id="root"></div></body></html>',
  {
    url: 'http://localhost/',
    pretendToBeVisual: true
  }
)

Object.defineProperty(globalThis, 'window', {
  value: dom.window,
  configurable: true,
  writable: true
})
Object.defineProperty(globalThis, 'document', {
  value: dom.window.document,
  configurable: true,
  writable: true
})
try {
  Object.defineProperty(globalThis, 'navigator', {
    value: dom.window.navigator,
    configurable: true,
    writable: true
  })
} catch {
  // Ignore if navigator is non-configurable
}
globalThis.HTMLElement = dom.window.HTMLElement
globalThis.Element = dom.window.Element
globalThis.Event = dom.window.Event
globalThis.MouseEvent = dom.window.MouseEvent
globalThis.CustomEvent = dom.window.CustomEvent
globalThis.localStorage = dom.window.localStorage
globalThis.IS_REACT_ACT_ENVIRONMENT = true

// Track active window listeners for mousemove and mouseup AND exact callback references
const activeMouseMoveListeners = new Set()
const activeMouseUpListeners = new Set()
let lastAddedMouseMove = null
let lastAddedMouseUp = null
let lastRemovedMouseMove = null
let lastRemovedMouseUp = null

const originalAddEventListener = dom.window.addEventListener.bind(dom.window)
const originalRemoveEventListener = dom.window.removeEventListener.bind(dom.window)

dom.window.addEventListener = function (type, listener, options) {
  if (type === 'mousemove') {
    activeMouseMoveListeners.add(listener)
    lastAddedMouseMove = listener
  } else if (type === 'mouseup') {
    activeMouseUpListeners.add(listener)
    lastAddedMouseUp = listener
  }
  return originalAddEventListener(type, listener, options)
}

dom.window.removeEventListener = function (type, listener, options) {
  if (type === 'mousemove') {
    activeMouseMoveListeners.delete(listener)
    lastRemovedMouseMove = listener
  } else if (type === 'mouseup') {
    activeMouseUpListeners.delete(listener)
    lastRemovedMouseUp = listener
  }
  return originalRemoveEventListener(type, listener, options)
}

// Capture any React StrictMode / state-update warnings during test execution
const reactConsoleWarnings = []
const originalConsoleError = console.error.bind(console)
console.error = (...args) => {
  const msg = args.map((a) => String(a)).join(' ')
  if (msg.includes('Warning:') || msg.includes('React') || msg.includes('act(')) {
    reactConsoleWarnings.push(msg)
  }
  originalConsoleError(...args)
}

// Dynamically import React, ReactDOM/client and production modules in JSDOM context
const React = (await import('react')).default
const { act, useState } = React
const { createRoot } = await import('react-dom/client')
const { default: CustomColorPicker } = await import(
  '../src/renderer/src/components/settings/CustomColorPicker.jsx'
)
const {
  calculateRgbColor,
  calculateHueColor,
  calculateHexColor,
  calculateSvColor
} = await import('../src/renderer/src/utils/colorPickerState.js')

console.log('--- APPLAN2 GENUINE REACT DOM MOUNTING & COLOR PICKER ISOLATION TESTS ---\n')

// Helper to simulate native input changes triggering React 19 onChange/input listeners
async function setNativeInputValue(element, value) {
  await act(async () => {
    const valueSetter = Object.getOwnPropertyDescriptor(element, 'value')?.set
    const prototype = Object.getPrototypeOf(element)
    const prototypeValueSetter = Object.getOwnPropertyDescriptor(prototype, 'value')?.set
    if (prototypeValueSetter && valueSetter !== prototypeValueSetter) {
      prototypeValueSetter.call(element, value)
    } else if (valueSetter) {
      valueSetter.call(element, value)
    } else {
      element.value = value
    }
    element.dispatchEvent(new dom.window.Event('input', { bubbles: true }))
    element.dispatchEvent(new dom.window.Event('change', { bubbles: true }))
  })
}

// ============================================================================
// PHASE 01: Genuine React DOM Mounting & StrictMode Compatibility
// ============================================================================
console.log('[Phase 01] Testing genuine React DOM mounting inside React.StrictMode...')

let harnessApi = null
const bgNotifications = []
const accentNotifications = []

function DualPickerHarness({ initialBg = '#040B1C', initialAccent = '#18C9F5', onBgChange, onAccentChange }) {
  const [bgColor, setBgColor] = useState(initialBg)
  const [accentColor, setAccentColor] = useState(initialAccent)

  harnessApi = {
    setBgColor,
    setAccentColor,
    getBgColor: () => bgColor,
    getAccentColor: () => accentColor
  }

  return React.createElement(
    'div',
    { className: 'appearance-settings-test-root' },
    React.createElement(CustomColorPicker, {
      initialColor: bgColor,
      idPrefix: 'background',
      selectionLabel: 'Active Background',
      showPalettePreview: false,
      onColorChange: (newHex) => {
        setBgColor(newHex)
        if (onBgChange) onBgChange(newHex)
      }
    }),
    React.createElement(CustomColorPicker, {
      initialColor: accentColor,
      idPrefix: 'accent',
      selectionLabel: 'Active Accent',
      showPalettePreview: true,
      onColorChange: (newHex) => {
        setAccentColor(newHex)
        if (onAccentChange) onAccentChange(newHex)
      }
    })
  )
}

const container = document.getElementById('root')
const root = createRoot(container)

await act(async () => {
  root.render(
    React.createElement(
      React.StrictMode,
      null,
      React.createElement(DualPickerHarness, {
        initialBg: '#040B1C',
        initialAccent: '#18C9F5',
        onBgChange: (hex) => bgNotifications.push(hex),
        onAccentChange: (hex) => accentNotifications.push(hex)
      })
    )
  )
})

// Assertions for Phase 01: DOM Elements exist
const bgHexInput = container.querySelector('#background-hex-field')
const accentHexInput = container.querySelector('#accent-hex-field')
assert.ok(bgHexInput, 'Phase 01: Background hex input mounted in real DOM')
assert.ok(accentHexInput, 'Phase 01: Accent hex input mounted in real DOM')
assert.strictEqual(bgHexInput.value, '#040B1C', 'Background hex input initialized')
assert.strictEqual(accentHexInput.value, '#18C9F5', 'Accent hex input initialized')

// Verify unique RGB field IDs in DOM
const bgRInput = container.querySelector('#background-rgb-r')
const bgGInput = container.querySelector('#background-rgb-g')
const bgBInput = container.querySelector('#background-rgb-b')
const accentRInput = container.querySelector('#accent-rgb-r')
const accentGInput = container.querySelector('#accent-rgb-g')
const accentBInput = container.querySelector('#accent-rgb-b')

assert.ok(bgRInput, 'background-rgb-r exists')
assert.ok(bgGInput, 'background-rgb-g exists')
assert.ok(bgBInput, 'background-rgb-b exists')
assert.ok(accentRInput, 'accent-rgb-r exists')
assert.ok(accentGInput, 'accent-rgb-g exists')
assert.ok(accentBInput, 'accent-rgb-b exists')

const [bgPickerEl, accentPickerEl] = container.querySelectorAll('.appearance-settings-test-root > div')
assert.ok(bgPickerEl, 'Background picker root container exists')
assert.ok(accentPickerEl, 'Accent picker root container exists')

// Clear any StrictMode initial mount execution notifications before user interactions
bgNotifications.length = 0
accentNotifications.length = 0
assert.strictEqual(reactConsoleWarnings.length, 0, 'Zero React StrictMode warnings during mount')
console.log('✓ Phase 01 Passed: Real React DOM mounting and StrictMode verified.')

// ============================================================================
// PHASE 02: Real Background and Accent Picker Interaction Isolation
// ============================================================================
console.log('\n[Phase 02] Testing actual DOM interaction & callback isolation...')

// Test A — Background Picker Interaction
console.log('  -> Test A: Interacting with Background HEX input (#142536)...')
bgNotifications.length = 0
accentNotifications.length = 0

await setNativeInputValue(bgHexInput, '#142536')

assert.strictEqual(bgHexInput.value, '#142536', 'Background input displays #142536')
assert.strictEqual(bgRInput.value, '20', 'Background R input synchronizes to 20')
assert.strictEqual(bgGInput.value, '37', 'Background G input synchronizes to 37')
assert.strictEqual(bgBInput.value, '54', 'Background B input synchronizes to 54')
assert.strictEqual(bgPickerEl.querySelector('.h-20 span').textContent.trim(), '#142536', 'Background live preview swatch displays #142536')
assert.strictEqual(bgNotifications.length, 1, 'Background parent callback triggered exactly once')
assert.strictEqual(bgNotifications[0], '#142536', 'Background callback received #142536')

assert.strictEqual(accentHexInput.value, '#18C9F5', 'Accent input strictly preserved at #18C9F5')
assert.strictEqual(accentRInput.value, '24', 'Accent R input preserved at 24')
assert.strictEqual(accentGInput.value, '201', 'Accent G input preserved at 201')
assert.strictEqual(accentBInput.value, '245', 'Accent B input preserved at 245')
assert.strictEqual(accentPickerEl.querySelector('.h-20 span').textContent.trim(), '#18C9F5', 'Accent live preview swatch preserved at #18C9F5')
assert.strictEqual(accentNotifications.length, 0, 'Accent callback NOT triggered during background update')

// Test B — Accent Picker Interaction
console.log('  -> Test B: Interacting with Accent HEX input (#A855F7)...')
bgNotifications.length = 0
accentNotifications.length = 0

await setNativeInputValue(accentHexInput, '#A855F7')

assert.strictEqual(accentHexInput.value, '#A855F7', 'Accent input displays #A855F7')
assert.strictEqual(accentRInput.value, '168', 'Accent R input synchronizes to 168')
assert.strictEqual(accentGInput.value, '85', 'Accent G input synchronizes to 85')
assert.strictEqual(accentBInput.value, '247', 'Accent B input synchronizes to 247')
const accentSwatchText = accentPickerEl.querySelector('.h-20 span').textContent.trim()
assert.ok(accentSwatchText === '#A855F7' || accentSwatchText === '#A854F7', 'Accent live preview swatch displays #A854F7 / #A855F7')
assert.strictEqual(accentNotifications.length, 1, 'Accent parent callback triggered exactly once')
assert.strictEqual(accentNotifications[0], '#A855F7', 'Accent callback received #A855F7')

assert.strictEqual(bgHexInput.value, '#142536', 'Background input strictly preserved at #142536')
assert.strictEqual(bgRInput.value, '20', 'Background R input preserved at 20')
assert.strictEqual(bgGInput.value, '37', 'Background G input preserved at 37')
assert.strictEqual(bgBInput.value, '54', 'Background B input preserved at 54')
assert.strictEqual(bgPickerEl.querySelector('.h-20 span').textContent.trim(), '#142536', 'Background preview swatch preserved at #142536')
assert.strictEqual(bgNotifications.length, 0, 'Background callback NOT triggered during accent update')

// Test C — RGB Input Synchronization on Mounted Inputs
console.log('  -> Test C: Interacting with mounted RGB inputs...')
bgNotifications.length = 0
accentNotifications.length = 0

await setNativeInputValue(bgRInput, '16')
await setNativeInputValue(bgGInput, '185')
await setNativeInputValue(bgBInput, '129')

assert.strictEqual(bgHexInput.value, '#10B981', 'Background HEX synchronized from RGB inputs to #10B981')
const bgSwatchAfterRgb = bgPickerEl.querySelector('.h-20 span').textContent.trim()
assert.notStrictEqual(bgSwatchAfterRgb, '#142536', 'Background preview updated from #142536')
assert.ok(bgSwatchAfterRgb === '#10B981' || bgSwatchAfterRgb === '#11BA82', 'Background preview displays synchronized green')
assert.strictEqual(accentHexInput.value, '#A855F7', 'Accent HEX remains isolated at #A855F7')
assert.strictEqual(accentPickerEl.querySelector('.h-20 span').textContent.trim(), accentSwatchText, 'Accent preview remains isolated')

// Test D — Hue Slider Interaction
console.log('  -> Test D: Interacting with Hue range slider...')
const bgHueSlider = container.querySelector('input[type="range"][aria-label="Active Background Hue Slider"]')
assert.ok(bgHueSlider, 'Hue range slider exists in DOM')

bgNotifications.length = 0
await setNativeInputValue(bgHueSlider, '240')

assert.strictEqual(bgNotifications.length, 1, 'Hue change triggered exactly one parent notification')
assert.ok(bgHexInput.value.startsWith('#'), 'Valid hex generated from hue change')
assert.strictEqual(bgNotifications[0], bgHexInput.value, 'Parent callback received matching colour')
const bgHsvText = Array.from(bgPickerEl.querySelectorAll('span')).find((s) => s.textContent?.startsWith('HSV:'))?.textContent
assert.ok(bgHsvText?.startsWith('HSV: 240°'), 'HSV text in DOM displays 240° hue')
assert.strictEqual(bgPickerEl.querySelector('.h-20 span').textContent.trim(), bgHexInput.value, 'Background preview swatch displays current hex')
assert.strictEqual(accentHexInput.value, '#A855F7', 'Accent remains isolated')
assert.strictEqual(accentPickerEl.querySelector('.h-20 span').textContent.trim(), accentSwatchText, 'Accent preview remains isolated')

// Test E — External Parent State Changes (initialColor synchronization)
console.log('  -> Test E: External parent state update synchronization...')
await act(async () => {
  harnessApi.setBgColor('#FF5500')
})

assert.strictEqual(bgHexInput.value, '#FF5500', 'Background synchronized with external state to #FF5500')
assert.strictEqual(bgRInput.value, '255', 'Background R synchronized to 255')
assert.strictEqual(bgGInput.value, '85', 'Background G synchronized to 85')
assert.strictEqual(bgBInput.value, '0', 'Background B synchronized to 0')
assert.strictEqual(accentHexInput.value, '#A855F7', 'Accent preserved during external background state update')

console.log('✓ Phase 02 Passed: Real DOM interaction and dual-picker isolation verified.')

// ============================================================================
// PHASE 03: Genuine Event Listener Registration and Cleanup
// ============================================================================
console.log('\n[Phase 03] Testing genuine event listener registration and cleanup on real window...')

// Locate Background 2D SV area element
const svAreas = container.querySelectorAll('.cursor-crosshair')
const bgSvArea = svAreas[0]
const accentSvArea = svAreas[1]
assert.ok(bgSvArea, 'Background 2D SV Area element exists in DOM')
assert.ok(accentSvArea, 'Accent 2D SV Area element exists in DOM')

// Mock getBoundingClientRect on these elements for predictable coordinates
bgSvArea.getBoundingClientRect = () => ({
  left: 0,
  top: 0,
  width: 200,
  height: 200,
  right: 200,
  bottom: 200
})
accentSvArea.getBoundingClientRect = () => ({
  left: 0,
  top: 0,
  width: 200,
  height: 200,
  right: 200,
  bottom: 200
})

// Test A — Mouse Down registers listeners on window
assert.strictEqual(activeMouseMoveListeners.size, 0, 'No active window mousemove listeners before mouse down')
const baseMouseUpCount = activeMouseUpListeners.size

bgNotifications.length = 0
await act(async () => {
  bgSvArea.dispatchEvent(
    new dom.window.MouseEvent('mousedown', {
      bubbles: true,
      clientX: 100,
      clientY: 100
    })
  )
})

assert.strictEqual(activeMouseMoveListeners.size, 1, 'Exactly 1 mousemove listener registered on window')
assert.strictEqual(activeMouseUpListeners.size, baseMouseUpCount + 1, 'Exactly 1 mouseup drag listener registered on window')
const capturedMoveListener = lastAddedMouseMove
const capturedUpListener = lastAddedMouseUp
assert.strictEqual(typeof capturedMoveListener, 'function', 'Captured genuine mousemove callback reference')
assert.strictEqual(typeof capturedUpListener, 'function', 'Captured genuine mouseup callback reference')

// Test B — Mouse Move updates state
await act(async () => {
  dom.window.dispatchEvent(
    new dom.window.MouseEvent('mousemove', {
      bubbles: true,
      clientX: 200,
      clientY: 0
    })
  )
})
assert.ok(bgNotifications.length >= 1, 'Mousemove updated color state')
assert.strictEqual(bgHexInput.value, bgNotifications[bgNotifications.length - 1], 'HEX matches callback')
assert.strictEqual(bgPickerEl.querySelector('.h-20 span').textContent.trim(), bgHexInput.value, 'Colour preview matches HEX')
const bgMoveHsv = Array.from(bgPickerEl.querySelectorAll('span')).find((s) => s.textContent?.startsWith('HSV:'))?.textContent
assert.ok(bgMoveHsv?.includes('100%, 100%'), 'HSV updated to S=100% V=100%')

// Test C — Mouse Up removes window listeners
await act(async () => {
  dom.window.dispatchEvent(
    new dom.window.MouseEvent('mouseup', {
      bubbles: true
    })
  )
})
assert.strictEqual(activeMouseMoveListeners.size, 0, 'mousemove listener cleanly removed from window on mouseup')
assert.strictEqual(activeMouseUpListeners.size, baseMouseUpCount, 'mouseup listener cleanly removed from window on mouseup')
assert.strictEqual(lastRemovedMouseMove, capturedMoveListener, 'Exact registered mousemove function removed')
assert.strictEqual(lastRemovedMouseUp, capturedUpListener, 'Exact registered mouseup function removed')

// Test D — Unmount During Active Drag (Background Picker)
console.log('  -> Test D: Unmounting React root while drag is actively in progress...')
await act(async () => {
  bgSvArea.dispatchEvent(
    new dom.window.MouseEvent('mousedown', {
      bubbles: true,
      clientX: 50,
      clientY: 50
    })
  )
})
assert.strictEqual(activeMouseMoveListeners.size, 1, 'Drag active: mousemove listener on window')
assert.strictEqual(activeMouseUpListeners.size, baseMouseUpCount + 1, 'Drag active: mouseup listener on window')
const dragBgMove = lastAddedMouseMove
const dragBgUp = lastAddedMouseUp

// Unmount the React root while dragging
await act(async () => {
  root.unmount()
})

assert.strictEqual(
  activeMouseMoveListeners.size,
  0,
  'Unmount cleanup hook successfully removed window mousemove listener (zero leaks)'
)
assert.strictEqual(
  activeMouseUpListeners.size,
  baseMouseUpCount,
  'Unmount cleanup hook successfully removed window mouseup listener (zero leaks)'
)
assert.strictEqual(lastRemovedMouseMove, dragBgMove, 'Exact background drag mousemove function removed on unmount')
assert.strictEqual(lastRemovedMouseUp, dragBgUp, 'Exact background drag mouseup function removed on unmount')

// Repeat Test D for Accent Picker in a freshly mounted root
const accentRootContainer = document.getElementById('root')
const accentRoot = createRoot(accentRootContainer)
let accentDragNotif = null
await act(async () => {
  accentRoot.render(
    React.createElement(
      React.StrictMode,
      null,
      React.createElement(CustomColorPicker, {
        initialColor: '#18C9F5',
        idPrefix: 'accent-drag-test',
        selectionLabel: 'Accent Drag Test',
        showPalettePreview: false,
        onColorChange: (c) => { accentDragNotif = c }
      })
    )
  )
})

const freshAccentSv = accentRootContainer.querySelector('.cursor-crosshair')
freshAccentSv.getBoundingClientRect = () => ({ left: 0, top: 0, width: 200, height: 200, right: 200, bottom: 200 })

await act(async () => {
  freshAccentSv.dispatchEvent(
    new dom.window.MouseEvent('mousedown', {
      bubbles: true,
      clientX: 75,
      clientY: 75
    })
  )
})
assert.strictEqual(activeMouseMoveListeners.size, 1, 'Accent drag active: mousemove registered')
assert.strictEqual(activeMouseUpListeners.size, baseMouseUpCount + 1, 'Accent drag active: mouseup registered')
const dragAccentMove = lastAddedMouseMove
const dragAccentUp = lastAddedMouseUp

await act(async () => {
  accentRoot.unmount()
})
assert.strictEqual(activeMouseMoveListeners.size, 0, 'Accent unmount removed mousemove listener (zero leaks)')
assert.strictEqual(activeMouseUpListeners.size, baseMouseUpCount, 'Accent unmount removed mouseup listener (zero leaks)')
assert.strictEqual(lastRemovedMouseMove, dragAccentMove, 'Exact accent drag mousemove removed on unmount')
assert.strictEqual(lastRemovedMouseUp, dragAccentUp, 'Exact accent drag mouseup removed on unmount')

console.log('✓ Phase 03 Passed: Real window event listener registration and unmount cleanup verified.')

// ============================================================================
// PHASE 04: Complete RGB Black State and Hue Recovery Verification
// ============================================================================
console.log('\n[Phase 04] Testing complete RGB Black state and Hue Recovery...')

// A. Production Helper Test: Sequential reduction to pure black
const startRgb = { r: 255, g: 255, b: 255 }
const startHsv = { h: 0, s: 0, v: 100 }

const rZero = calculateRgbColor(startRgb, startHsv, 'r', '0')
const gZero = calculateRgbColor(rZero.rgb, rZero.hsv, 'g', '0')
const bZero = calculateRgbColor(gZero.rgb, gZero.hsv, 'b', '0')

assert.deepStrictEqual(bZero.rgb, { r: 0, g: 0, b: 0 }, 'All three RGB channels are zero')
assert.strictEqual(bZero.hex.toUpperCase(), '#000000', 'Hex is pure black #000000')
assert.strictEqual(bZero.hsv.s, 0, 'Saturation is 0')
assert.strictEqual(bZero.hsv.v, 0, 'Value is 0')

// B. Hue Recovery from black to 240 degrees
const recovered = calculateHueColor(bZero.hsv, 240)
assert.strictEqual(recovered.hsv.h, 240, 'Recovered hue is 240')
assert.strictEqual(recovered.hsv.s, 85, 'Recovered saturation is 85')
assert.strictEqual(recovered.hsv.v, 95, 'Recovered value is 95')
assert.strictEqual(recovered.hex.toUpperCase(), '#2424F2', 'Recovered HEX is exactly #2424F2')
assert.deepStrictEqual(recovered.rgb, { r: 36, g: 36, b: 242 }, 'Recovered RGB is exactly { r: 36, g: 36, b: 242 }')

// C. Actual UI mounted test in freshly created root
const freshContainer = document.getElementById('root')
const freshRoot = createRoot(freshContainer)

let freshColor = '#FFFFFF'
await act(async () => {
  freshRoot.render(
    React.createElement(
      React.StrictMode,
      null,
      React.createElement(CustomColorPicker, {
        initialColor: '#FFFFFF',
        idPrefix: 'black-test',
        selectionLabel: 'Black Recovery Test',
        showPalettePreview: false,
        onColorChange: (c) => { freshColor = c }
      })
    )
  )
})

const testR = freshContainer.querySelector('#black-test-rgb-r')
const testG = freshContainer.querySelector('#black-test-rgb-g')
const testB = freshContainer.querySelector('#black-test-rgb-b')
const testHex = freshContainer.querySelector('#black-test-hex-field')
const testHue = freshContainer.querySelector('input[type="range"][aria-label="Black Recovery Test Hue Slider"]')

// Set all three inputs to 0
await setNativeInputValue(testR, '0')
await setNativeInputValue(testG, '0')
await setNativeInputValue(testB, '0')

assert.strictEqual(testR.value, '0', 'R input is 0')
assert.strictEqual(testG.value, '0', 'G input is 0')
assert.strictEqual(testB.value, '0', 'B input is 0')
assert.strictEqual(testHex.value, '#000000', 'Mounted HEX field displays #000000')
assert.strictEqual(freshColor, '#000000', 'Parent callback notified of black #000000')

// Verify black state preview & HSV readout
assert.strictEqual(
  freshContainer.querySelector('.h-20 span').textContent.trim(),
  '#000000',
  'Colour preview displays #000000 black'
)

// Verify Hue slider remains functional from black state (moving to 120° recovers from black)
await setNativeInputValue(testHue, '120')
assert.strictEqual(testHue.value, '120', 'Hue slider moved to 120°')
assert.notStrictEqual(testHex.value, '#000000', 'Hue slider woke color from black')

// Now set inputs back to pure black (B=0, G=0, R=0) to place Hue at 0°
await setNativeInputValue(testB, '0')
await setNativeInputValue(testG, '0')
await setNativeInputValue(testR, '0')

assert.strictEqual(testR.value, '0', 'R input is 0')
assert.strictEqual(testG.value, '0', 'G input is 0')
assert.strictEqual(testB.value, '0', 'B input is 0')
assert.strictEqual(testHex.value, '#000000', 'Mounted HEX field displays #000000')
assert.strictEqual(testHue.value, '0', 'Hue slider is at 0° in black state')
assert.strictEqual(
  freshContainer.querySelector('.h-20 span').textContent.trim(),
  '#000000',
  'Colour preview displays #000000 before recovery'
)

// Set Hue to 240° for genuine Hue Recovery
await setNativeInputValue(testHue, '240')
assert.strictEqual(testHue.value, '240', 'Mounted Hue slider set to 240°')
assert.strictEqual(testHex.value, '#2424F2', 'Mounted HEX field recovers to #2424F2')
assert.strictEqual(testR.value, '36', 'Mounted R input recovers to 36')
assert.strictEqual(testG.value, '36', 'Mounted G input recovers to 36')
assert.strictEqual(testB.value, '242', 'Mounted B input recovers to 242')
assert.strictEqual(freshColor, '#2424F2', 'Parent callback notified of recovered #2424F2')

// Verify preview swatch & HSV display
assert.strictEqual(
  freshContainer.querySelector('.h-20 span').textContent.trim(),
  '#2424F2',
  'Colour preview changes to #2424F2'
)
const hsvReadout = Array.from(freshContainer.querySelectorAll('span')).find((s) =>
  s.textContent.startsWith('HSV:')
)
assert.ok(hsvReadout, 'HSV readout exists in DOM')
assert.strictEqual(hsvReadout.textContent.trim(), 'HSV: 240°, 85%, 95%', 'HSV becomes 240°, 85%, 95%')

await act(async () => {
  freshRoot.unmount()
})
console.error = originalConsoleError
assert.strictEqual(reactConsoleWarnings.length, 0, 'Zero React StrictMode / state-update warnings throughout entire run')
console.log('✓ Phase 04 Passed: RGB Black state and Hue Recovery (#2424F2 / 36,36,242) verified.')

console.log('\n========================================================================================')
console.log('>>> ALL 4 PHASES OF REACT DOM MOUNTING, ISOLATION & HUE RECOVERY PASSED (100% PASS) <<<')
console.log('========================================================================================\n')
