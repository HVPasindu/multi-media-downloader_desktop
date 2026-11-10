/**
 * Unit Test Suite for APPLAN2 Appearance Theme System
 *
 * Validates the actual production API:
 * 1. Six approved Accent Presets (THEME_PRESETS, DEFAULT_THEME, DEFAULT_THEME_ID)
 * 2. Eight approved Background Presets (BACKGROUND_PRESETS, DEFAULT_BACKGROUND_PRESET, DEFAULT_BACKGROUND_ID)
 * 3. Dark Background palette derivation (deriveBackgroundPalette)
 * 4. Light Background palette derivation (deriveBackgroundPalette)
 * 5. Custom Background palette derivation (deriveBackgroundPalette)
 * 6. HEX color format validation (isValidHex)
 * 7. Color conversion helpers (hexToRgb, rgbToHex, rgbToHsl, hslToRgb, rgbToHsv, hsvToRgb, hexToHsv, hsvToHex)
 * 8. Black Colour Hue Recovery helper (adjustHueWithBlackRecovery: Example 3 fix)
 * 9. Custom Accent Palette generation (generateCustomPalette)
 * 10. Automatic Accent matching for all 8 Background Presets (matchedAccentId & setBackgroundPreset)
 * 11. Manual Accent selection after Background selection (override preservation)
 * 12. Legacy localStorage compatibility (loading old config without background property)
 * 13. Background persistence (setBackgroundPreset & loadSavedTheme)
 * 14. Custom Background persistence (setCustomBackgroundHex & loadSavedTheme)
 * 15. Corrupted storage fallback (graceful recovery from invalid JSON / malformed objects)
 * 16. Dynamic CSS variable application (applyThemeVariables: --theme-* and --app-*)
 * 17. Surface variable protection (--color-secondary matches --app-surface)
 */

import assert from 'node:assert'

// Setup mock browser globals before loading appearanceTheme module
const mockStorage = new Map()

globalThis.window = {
  localStorage: {
    getItem: (key) => mockStorage.get(key) || null,
    setItem: (key, val) => mockStorage.set(key, String(val)),
    removeItem: (key) => mockStorage.delete(key),
    clear: () => mockStorage.clear()
  }
}

globalThis.localStorage = globalThis.window.localStorage

const mockCssVariables = new Map()
globalThis.document = {
  documentElement: {
    style: {
      setProperty: (prop, val) => mockCssVariables.set(prop, val),
      getPropertyValue: (prop) => mockCssVariables.get(prop) || ''
    }
  }
}

// Dynamically import appearanceTheme
const {
  THEME_PRESETS,
  DEFAULT_THEME,
  DEFAULT_THEME_ID,
  BACKGROUND_PRESETS,
  DEFAULT_BACKGROUND_PRESET,
  DEFAULT_BACKGROUND_ID,
  isValidHex,
  hexToRgb,
  rgbToHex,
  rgbToHsl,
  hslToRgb,
  rgbToHsv,
  hsvToRgb,
  hsvToHex,
  hexToHsv,
  getLuminance,
  isLightColor,
  adjustHueWithBlackRecovery,
  deriveBackgroundPalette,
  generateContrastingAccent,
  generateCustomPalette,
  applyThemeVariables,
  loadSavedTheme,
  saveTheme,
  setPresetTheme,
  setCustomTheme,
  setBackgroundMode,
  setBackgroundPreset,
  setCustomBackgroundHex,
  resetAppearanceTheme,
  resetBackgroundTheme,
  initAppearanceTheme
} = await import('../src/renderer/src/utils/appearanceTheme.js')

console.log('--- APPLAN2 COMPLETE APPEARANCE THEME UNIT TESTS ---')

// --------------------------------------------------------------------------
// 1. All 6 approved Accent Presets
// --------------------------------------------------------------------------
console.log('\n[Test 1] Verifying all 6 approved Accent Presets...')
assert.strictEqual(THEME_PRESETS.length, 6, 'Should have exactly 6 accent presets')

const expectedAccents = {
  'ocean-blue': { name: 'Ocean Blue', primary: '#18C9F5', secondary: '#3388FF', tertiary: '#514BFF' },
  'purple-neon': { name: 'Purple Neon', primary: '#A855F7', secondary: '#7C3AED', tertiary: '#EC4899' },
  'emerald': { name: 'Emerald', primary: '#10B981', secondary: '#059669', tertiary: '#22D3EE' },
  'sunset': { name: 'Sunset', primary: '#F97316', secondary: '#EF4444', tertiary: '#FBBF24' },
  'rose': { name: 'Rose', primary: '#EC4899', secondary: '#DB2777', tertiary: '#A855F7' },
  'golden': { name: 'Golden', primary: '#EAB308', secondary: '#F59E0B', tertiary: '#F97316' }
}

for (const [id, expected] of Object.entries(expectedAccents)) {
  const found = THEME_PRESETS.find((p) => p.id === id)
  assert.ok(found, `Accent preset ${id} must exist`)
  assert.strictEqual(found.name, expected.name, `Accent ${id} name mismatch`)
  assert.strictEqual(found.primary, expected.primary, `Accent ${id} primary mismatch`)
  assert.strictEqual(found.secondary, expected.secondary, `Accent ${id} secondary mismatch`)
  assert.strictEqual(found.tertiary, expected.tertiary, `Accent ${id} tertiary mismatch`)
}

assert.strictEqual(DEFAULT_THEME_ID, 'ocean-blue', 'Default preset ID must be ocean-blue')
assert.strictEqual(DEFAULT_THEME.id, 'ocean-blue', 'Default theme must be ocean-blue')
console.log('✓ Test 1 Passed: All 6 accent presets verified.')

// --------------------------------------------------------------------------
// 2. All 8 approved Background Presets
// --------------------------------------------------------------------------
console.log('\n[Test 2] Verifying all 8 Background Presets...')
assert.strictEqual(BACKGROUND_PRESETS.length, 8, 'Should have exactly 8 background presets')

const expectedBackgrounds = {
  'midnight-navy': { name: 'Midnight Navy', hex: '#040B1C', isDark: true, matchedAccentId: 'ocean-blue' },
  'carbon-black': { name: 'Carbon Black', hex: '#101318', isDark: true, matchedAccentId: 'golden' },
  'deep-space': { name: 'Deep Space', hex: '#17102B', isDark: true, matchedAccentId: 'purple-neon' },
  'cyber-teal': { name: 'Cyber Teal', hex: '#082B2B', isDark: true, matchedAccentId: 'emerald' },
  'arctic-white': { name: 'Arctic White', hex: '#F7FAFC', isDark: false, matchedAccentId: 'ocean-blue' },
  'pearl-mist': { name: 'Pearl Mist', hex: '#EEF2F7', isDark: false, matchedAccentId: 'emerald' },
  'rose-dusk': { name: 'Rose Dusk', hex: '#2A1427', isDark: true, matchedAccentId: 'rose' },
  'aurora-slate': { name: 'Aurora Slate', hex: '#142536', isDark: true, matchedAccentId: 'ocean-blue' }
}

for (const [id, expected] of Object.entries(expectedBackgrounds)) {
  const found = BACKGROUND_PRESETS.find((p) => p.id === id)
  assert.ok(found, `Background preset ${id} must exist`)
  assert.strictEqual(found.name, expected.name, `Background ${id} name mismatch`)
  assert.strictEqual(found.hex.toUpperCase(), expected.hex.toUpperCase(), `Background ${id} hex mismatch`)
  assert.strictEqual(found.isDark, expected.isDark, `Background ${id} isDark mismatch`)
  assert.strictEqual(found.matchedAccentId, expected.matchedAccentId, `Background ${id} matchedAccentId mismatch`)
}

assert.strictEqual(DEFAULT_BACKGROUND_ID, 'midnight-navy', 'Default background ID must be midnight-navy')
assert.strictEqual(DEFAULT_BACKGROUND_PRESET.id, 'midnight-navy', 'Default background preset must match')
console.log('✓ Test 2 Passed: All 8 background presets verified.')

// --------------------------------------------------------------------------
// 3. Dark Background Palette Derivation
// --------------------------------------------------------------------------
console.log('\n[Test 3] Testing dark background palette derivation...')
const darkPalette = deriveBackgroundPalette('dark', 'midnight-navy', null)
assert.strictEqual(darkPalette.isDark, true, 'Palette must be dark')
assert.strictEqual(darkPalette.colorScheme, 'dark', 'Color scheme must be dark')
assert.strictEqual(darkPalette.background.toUpperCase(), '#040B1C')
assert.ok(isValidHex(darkPalette.header), 'Header must be valid HEX')
assert.ok(isValidHex(darkPalette.sidebar), 'Sidebar must be valid HEX')
assert.ok(isValidHex(darkPalette.surface), 'Surface must be valid HEX')
assert.ok(isValidHex(darkPalette.surfaceElevated), 'Surface elevated must be valid HEX')
assert.ok(isValidHex(darkPalette.surfaceDeep), 'Surface deep must be valid HEX')
assert.strictEqual(darkPalette.text.toUpperCase(), '#F4F8FF', 'Dark mode text should be light text')
assert.ok(isValidHex(darkPalette.textMuted), 'Dark mode text muted must be valid HEX')
console.log('✓ Test 3 Passed: Dark background palette derived with proper contrast.')

// --------------------------------------------------------------------------
// 4. Light Background Palette Derivation
// --------------------------------------------------------------------------
console.log('\n[Test 4] Testing light background palette derivation...')
const lightPalette = deriveBackgroundPalette('light', 'arctic-white', null)
assert.strictEqual(lightPalette.isDark, false, 'Palette must not be dark')
assert.strictEqual(lightPalette.colorScheme, 'light', 'Color scheme must be light')
assert.strictEqual(lightPalette.background.toUpperCase(), '#F7FAFC')
assert.strictEqual(lightPalette.text.toUpperCase(), '#172033', 'Light mode text must be dark text')
assert.strictEqual(lightPalette.textMuted.toUpperCase(), '#526179', 'Light mode text muted must be slate')
assert.ok(isValidHex(lightPalette.surface), 'Light surface must be valid HEX')
assert.ok(isValidHex(lightPalette.surfaceElevated), 'Light surface elevated must be valid HEX')
console.log('✓ Test 4 Passed: Light background palette derived with readable dark text.')

// --------------------------------------------------------------------------
// 5. Custom Background Palette Derivation
// --------------------------------------------------------------------------
console.log('\n[Test 5] Testing custom background palette derivation...')
const customDark = deriveBackgroundPalette('custom', null, '#101010')
assert.strictEqual(customDark.mode, 'custom')
assert.strictEqual(customDark.isDark, true, '#101010 must derive dark mode')
assert.strictEqual(customDark.background.toUpperCase(), '#101010')

const customLight = deriveBackgroundPalette('custom', null, '#F0F0F0')
assert.strictEqual(customLight.mode, 'custom')
assert.strictEqual(customLight.isDark, false, '#F0F0F0 must derive light mode')
assert.strictEqual(customLight.background.toUpperCase(), '#F0F0F0')

const invalidFallback = deriveBackgroundPalette('custom', null, 'INVALID')
assert.strictEqual(invalidFallback.mode, 'custom')
assert.strictEqual(invalidFallback.background.toUpperCase(), '#182536')
console.log('✓ Test 5 Passed: Custom background palette derivation verified.')

// --------------------------------------------------------------------------
// 6. HEX Color Validation (isValidHex)
// --------------------------------------------------------------------------
console.log('\n[Test 6] Testing isValidHex...')
assert.strictEqual(isValidHex('#18C9F5'), true, 'Valid uppercase 6-char hex')
assert.strictEqual(isValidHex('#18c9f5'), true, 'Valid lowercase 6-char hex')
assert.strictEqual(isValidHex('#000000'), true, 'Valid black hex')
assert.strictEqual(isValidHex('#FFFFFF'), true, 'Valid white hex')
assert.strictEqual(isValidHex('18C9F5'), false, 'Missing hash prefix')
assert.strictEqual(isValidHex('#FFF'), false, '3-char shorthand not accepted')
assert.strictEqual(isValidHex('#18C9F5AA'), false, '8-char alpha hex not accepted')
assert.strictEqual(isValidHex('rgb(0,0,0)'), false, 'RGB string not accepted')
assert.strictEqual(isValidHex(null), false, 'Null rejected')
assert.strictEqual(isValidHex(undefined), false, 'Undefined rejected')
console.log('✓ Test 6 Passed: isValidHex correctly enforces exact 6-character hex format.')

// --------------------------------------------------------------------------
// 7. Color Conversion Helpers
// --------------------------------------------------------------------------
console.log('\n[Test 7] Testing color conversion helpers (RGB, HEX, HSL, HSV)...')
const rgb = hexToRgb('#18C9F5')
assert.deepStrictEqual(rgb, { r: 24, g: 201, b: 245 })
const hex = rgbToHex(24, 201, 245)
assert.strictEqual(hex, '#18C9F5')

const hsv = hexToHsv('#18C9F5')
assert.ok(hsv.h >= 190 && hsv.h <= 194, `Hue approx 192 (got ${hsv.h})`)
const reconvertedHex = hsvToHex(hsv.h, hsv.s, hsv.v)
assert.strictEqual(reconvertedHex.toUpperCase(), '#18C9F5')

const hsl = rgbToHsl(24, 201, 245)
const rgbFromHsl = hslToRgb(hsl.h, hsl.s, hsl.l)
assert.ok(Math.abs(rgbFromHsl.r - 24) <= 2, 'R component roundtrips via HSL')
assert.ok(Math.abs(rgbFromHsl.g - 201) <= 2, 'G component roundtrips via HSL')
assert.ok(Math.abs(rgbFromHsl.b - 245) <= 2, 'B component roundtrips via HSL')
console.log('✓ Test 7 Passed: Color conversion helpers roundtrip accurately.')

// --------------------------------------------------------------------------
// 8. Black Colour Hue Recovery (adjustHueWithBlackRecovery)
// --------------------------------------------------------------------------
console.log('\n[Test 8] Testing Black Colour Hue Recovery (adjustHueWithBlackRecovery)...')
// Pure black: S = 0, V = 0
const recoveredFromBlack = adjustHueWithBlackRecovery(180, 0, 0)
assert.strictEqual(recoveredFromBlack.h, 180, 'Hue correctly updated')
assert.strictEqual(recoveredFromBlack.s, 85, 'Saturation recovered to 85')
assert.strictEqual(recoveredFromBlack.v, 95, 'Value recovered to 95')

// Converted to HEX: produces vibrant cyan #24F2F2, not stuck on black #000000!
const vibrantHex = hsvToHex(recoveredFromBlack.h, recoveredFromBlack.s, recoveredFromBlack.v)
assert.strictEqual(vibrantHex.toUpperCase(), '#24F2F2')
assert.notStrictEqual(vibrantHex, '#000000')

// Normal non-black color: preserves current S and V
const normalColor = adjustHueWithBlackRecovery(120, 70, 80)
assert.strictEqual(normalColor.h, 120)
assert.strictEqual(normalColor.s, 70, 'Normal saturation untouched')
assert.strictEqual(normalColor.v, 80, 'Normal value untouched')
console.log('✓ Test 8 Passed: Black colour recovery helper restores vibrant defaults on hue adjustment.')

// --------------------------------------------------------------------------
// 9. Custom Accent Palette Generation
// --------------------------------------------------------------------------
console.log('\n[Test 9] Testing custom accent palette generation...')
const generated = generateCustomPalette('#FF0055')
assert.strictEqual(generated.primary, '#FF0055')
assert.ok(isValidHex(generated.secondary), 'Generated secondary is valid HEX')
assert.ok(isValidHex(generated.tertiary), 'Generated tertiary is valid HEX')
assert.notStrictEqual(generated.secondary, generated.primary, 'Secondary differs from primary')
assert.notStrictEqual(generated.tertiary, generated.primary, 'Tertiary differs from primary')
console.log(`✓ Test 9 Passed: Custom palette generated (${generated.primary}, ${generated.secondary}, ${generated.tertiary}).`)

// --------------------------------------------------------------------------
// 10. Automatic Accent Matching for all 8 Background Presets
// --------------------------------------------------------------------------
console.log('\n[Test 10] Testing automatic accent matching for all 8 background presets...')
mockStorage.clear()
for (const bg of BACKGROUND_PRESETS) {
  assert.ok(
    THEME_PRESETS.some((p) => p.id === bg.matchedAccentId),
    `Background ${bg.id} matchedAccentId ${bg.matchedAccentId} must exist in THEME_PRESETS`
  )

  const updatedState = setBackgroundPreset(bg.id)
  assert.strictEqual(updatedState.background.presetId, bg.id, `Background set to ${bg.id}`)
  assert.strictEqual(updatedState.presetId, bg.matchedAccentId, `Accent auto-matched to ${bg.matchedAccentId}`)
}
console.log('✓ Test 10 Passed: All 8 background presets automatically match approved accent presets.')

// --------------------------------------------------------------------------
// 11. Manual Accent Selection after Background Selection (Override Rule)
// --------------------------------------------------------------------------
console.log('\n[Test 11] Testing manual accent override preservation...')
mockStorage.clear()

// Select Deep Space (which auto-matches purple-neon)
setBackgroundPreset('deep-space')
let activeState = loadSavedTheme()
assert.strictEqual(activeState.background.presetId, 'deep-space')
assert.strictEqual(activeState.presetId, 'purple-neon')

// User explicitly selects Emerald accent
setPresetTheme('emerald')
activeState = loadSavedTheme()
assert.strictEqual(activeState.background.presetId, 'deep-space', 'Background must remain deep-space')
assert.strictEqual(activeState.presetId, 'emerald', 'Accent must be updated to emerald')

// Verify that re-initializing or loading from storage preserves both selections
const reloaded = loadSavedTheme()
assert.strictEqual(reloaded.background.presetId, 'deep-space')
assert.strictEqual(reloaded.presetId, 'emerald', 'Manual emerald override faithfully preserved')
console.log('✓ Test 11 Passed: Manual accent override is preserved in state and persistence.')

// --------------------------------------------------------------------------
// 12. Legacy LocalStorage Compatibility
// --------------------------------------------------------------------------
console.log('\n[Test 12] Testing legacy localStorage compatibility...')
mockStorage.clear()
// Store old format without background property
mockStorage.set('applan2.appearance.theme', JSON.stringify({ mode: 'preset', presetId: 'sunset' }))

const legacyLoaded = loadSavedTheme()
assert.strictEqual(legacyLoaded.presetId, 'sunset', 'Legacy presetId parsed correctly')
assert.strictEqual(legacyLoaded.primary, '#F97316', 'Sunset primary loaded')
assert.ok(legacyLoaded.background, 'Background object injected')
assert.strictEqual(legacyLoaded.background.mode, 'dark', 'Default background mode dark')
assert.strictEqual(legacyLoaded.background.presetId, 'midnight-navy', 'Default background preset midnight-navy')
assert.strictEqual(legacyLoaded.bgPalette.isDark, true, 'Default dark palette active')
console.log('✓ Test 12 Passed: Legacy stored configurations gracefully upgraded without errors.')

// --------------------------------------------------------------------------
// 13. Background Persistence
// --------------------------------------------------------------------------
console.log('\n[Test 13] Testing background persistence...')
mockStorage.clear()
setBackgroundPreset('cyber-teal')

const rawStored = JSON.parse(mockStorage.get('applan2.appearance.theme'))
assert.strictEqual(rawStored.background.presetId, 'cyber-teal')

const restored = loadSavedTheme()
assert.strictEqual(restored.background.presetId, 'cyber-teal')
assert.strictEqual(restored.bgPalette.background.toUpperCase(), '#082B2B')
console.log('✓ Test 13 Passed: Background preset persists and restores correctly.')

// --------------------------------------------------------------------------
// 14. Custom Background Persistence
// --------------------------------------------------------------------------
console.log('\n[Test 14] Testing custom background persistence...')
mockStorage.clear()
setCustomBackgroundHex('#1A202C')
setCustomTheme('#FF00AA')

const customRestored = loadSavedTheme()
assert.strictEqual(customRestored.background.mode, 'custom')
assert.strictEqual(customRestored.background.customHex, '#1A202C')
assert.strictEqual(customRestored.mode, 'custom')
assert.strictEqual(customRestored.customHex, '#FF00AA')
console.log('✓ Test 14 Passed: Custom background and custom accent persist accurately.')

// --------------------------------------------------------------------------
// 15. Corrupted Storage Fallback
// --------------------------------------------------------------------------
console.log('\n[Test 15] Testing corrupted storage fallback...')
mockStorage.clear()
mockStorage.set('applan2.appearance.theme', 'CORRUPT_JSON{{{')

const safeFallback = loadSavedTheme()
assert.strictEqual(safeFallback.presetId, 'ocean-blue', 'Falls back to default ocean-blue accent')
assert.strictEqual(safeFallback.background.presetId, 'midnight-navy', 'Falls back to midnight-navy background')

mockStorage.set('applan2.appearance.theme', JSON.stringify({ mode: 'invalid_mode', presetId: 'fake' }))
const invalidFallbackTest = loadSavedTheme()
assert.strictEqual(invalidFallbackTest.presetId, 'ocean-blue', 'Invalid preset falls back safely')
console.log('✓ Test 15 Passed: Corrupted storage handled gracefully with safe default fallback.')

// --------------------------------------------------------------------------
// 16. Dynamic CSS Variable Application
// --------------------------------------------------------------------------
console.log('\n[Test 16] Testing dynamic CSS variable application...')
mockCssVariables.clear()

const themeToApply = {
  primary: '#EC4899',
  secondary: '#DB2777',
  tertiary: '#A855F7',
  background: { mode: 'dark', presetId: 'carbon-black', customHex: null },
  bgPalette: deriveBackgroundPalette('dark', 'carbon-black', null)
}

applyThemeVariables(themeToApply)

// Accent CSS variables
assert.strictEqual(mockCssVariables.get('--theme-primary'), '#EC4899')
assert.strictEqual(mockCssVariables.get('--theme-secondary-accent'), '#DB2777')
assert.strictEqual(mockCssVariables.get('--theme-tertiary'), '#A855F7')
assert.strictEqual(mockCssVariables.get('--color-primary'), '#EC4899')
assert.strictEqual(mockCssVariables.get('--color-accent'), '#A855F7')

// Background CSS variables
assert.strictEqual(mockCssVariables.get('--app-background').toUpperCase(), '#101318')
assert.strictEqual(mockCssVariables.get('--color-background').toUpperCase(), '#101318')
assert.strictEqual(mockCssVariables.get('--app-text').toUpperCase(), '#F4F8FF')
assert.strictEqual(mockCssVariables.get('--color-text').toUpperCase(), '#F4F8FF')
assert.strictEqual(mockCssVariables.get('--app-color-scheme'), 'dark')
console.log('✓ Test 16 Passed: Both --theme-* and --app-* CSS variables correctly set.')

// --------------------------------------------------------------------------
// 17. Surface Variable Protection (--color-secondary equals --app-surface)
// --------------------------------------------------------------------------
console.log('\n[Test 17] Verifying surface variable protection...')
// In our architecture, --color-secondary is mapped to --app-surface so that existing
// Tailwind classes like bg-secondary match the derived background surface.
assert.strictEqual(
  mockCssVariables.get('--color-secondary'),
  mockCssVariables.get('--app-surface'),
  '--color-secondary must match --app-surface'
)
console.log('✓ Test 17 Passed: Surface variable protection verified (--color-secondary matches --app-surface).')

console.log('\n======================================================')
console.log('>>> ALL 17 APPEARANCE & BACKGROUND THEME TESTS PASSED (17/17) <<<')
console.log('======================================================')
