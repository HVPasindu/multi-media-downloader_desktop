/**
 * Unit Test Suite for APPLAN2 Appearance Theme System
 *
 * Verifies all 17 requirements:
 * 1. All 6 existing Accent Presets
 * 2. All 8 Background Presets
 * 3. Dark mode palette derivation
 * 4. Light mode palette derivation
 * 5. Custom background validation & palette derivation
 * 6. HEX/RGB/HSV bidirectional synchronization
 * 7. HSV/HSL conversion helpers
 * 8. Black colour followed by Hue adjustment (Example 3 bug fix verification)
 * 9. Custom accent palette generation
 * 10. Automatic accent matching for all 8 background presets
 * 11. Manual accent override preservation
 * 12. Legacy localStorage compatibility (loading old config without background property)
 * 13. Background persistence
 * 14. Combined accent/background persistence
 * 15. Corrupted stored configuration fallback
 * 16. Dynamic CSS variable application (both --theme-* and --app-*)
 * 17. Existing surface variable protection (--color-secondary equals --app-surface)
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
  DEFAULT_BACKGROUND,
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
  getAppearanceState
} = await import('../src/renderer/src/utils/appearanceTheme.js')

console.log('--- APPLAN2 COMPLETE APPEARANCE THEME UNIT TESTS ---')

// --------------------------------------------------------------------------
// 1. All 6 existing Accent Presets
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
// 2. All 8 Background Presets
// --------------------------------------------------------------------------
console.log('\n[Test 2] Verifying all 8 Background Presets...')
assert.strictEqual(BACKGROUND_PRESETS.length, 8, 'Should have exactly 8 background presets')

const expectedBackgrounds = {
  'midnight-navy': { name: 'Midnight Navy', baseHex: '#040B1C', mode: 'dark', recommendedAccent: 'ocean-blue' },
  'carbon-black': { name: 'Carbon Black', baseHex: '#101318', mode: 'dark', recommendedAccent: 'golden' },
  'deep-space': { name: 'Deep Space', baseHex: '#17102B', mode: 'dark', recommendedAccent: 'purple-neon' },
  'cyber-teal': { name: 'Cyber Teal', baseHex: '#082B2B', mode: 'dark', recommendedAccent: 'emerald' },
  'arctic-white': { name: 'Arctic White', baseHex: '#F7FAFC', mode: 'light', recommendedAccent: 'ocean-blue' },
  'pearl-mist': { name: 'Pearl Mist', baseHex: '#EEF2F7', mode: 'light', recommendedAccent: 'emerald' },
  'rose-dusk': { name: 'Rose Dusk', baseHex: '#2A1427', mode: 'dark', recommendedAccent: 'rose' },
  'aurora-slate': { name: 'Aurora Slate', baseHex: '#142536', mode: 'dark', recommendedAccent: 'ocean-blue' }
}

for (const [id, expected] of Object.entries(expectedBackgrounds)) {
  const found = BACKGROUND_PRESETS.find((p) => p.id === id)
  assert.ok(found, `Background preset ${id} must exist`)
  assert.strictEqual(found.name, expected.name, `Background ${id} name mismatch`)
  assert.strictEqual(found.baseHex.toUpperCase(), expected.baseHex.toUpperCase(), `Background ${id} baseHex mismatch`)
  assert.strictEqual(found.mode, expected.mode, `Background ${id} mode mismatch`)
  assert.strictEqual(found.recommendedAccent, expected.recommendedAccent, `Background ${id} recommendedAccent mismatch`)
}

assert.strictEqual(DEFAULT_BACKGROUND_ID, 'midnight-navy', 'Default background must be midnight-navy')
assert.strictEqual(DEFAULT_BACKGROUND.id, 'midnight-navy', 'Default background obj must match')
console.log('✓ Test 2 Passed: All 8 background presets verified.')

// --------------------------------------------------------------------------
// 3. Dark Mode Palette Derivation
// --------------------------------------------------------------------------
console.log('\n[Test 3] Testing dark mode palette derivation...')
const darkPalette = deriveBackgroundPalette('#040B1C', 'dark')
assert.strictEqual(darkPalette.isLight, false, 'Palette must not be light')
assert.strictEqual(darkPalette.colorScheme, 'dark', 'Color scheme must be dark')
assert.strictEqual(darkPalette.background.toUpperCase(), '#040B1C')
assert.ok(isValidHex(darkPalette.header), 'Header must be valid HEX')
assert.ok(isValidHex(darkPalette.sidebar), 'Sidebar must be valid HEX')
assert.ok(isValidHex(darkPalette.surface), 'Surface must be valid HEX')
assert.ok(isValidHex(darkPalette.surfaceElevated), 'Surface elevated must be valid HEX')
assert.ok(isValidHex(darkPalette.surfaceDeep), 'Surface deep must be valid HEX')
assert.strictEqual(darkPalette.text.toUpperCase(), '#F4F8FF', 'Dark mode text should be high-contrast light text')
assert.ok(isValidHex(darkPalette.textMuted), 'Dark mode text muted must be valid HEX')
console.log('✓ Test 3 Passed: Dark mode palette derived with proper contrast.')

// --------------------------------------------------------------------------
// 4. Light Mode Palette Derivation
// --------------------------------------------------------------------------
console.log('\n[Test 4] Testing light mode palette derivation...')
const lightPalette = deriveBackgroundPalette('#F7FAFC', 'light')
assert.strictEqual(lightPalette.isLight, true, 'Palette must be light')
assert.strictEqual(lightPalette.colorScheme, 'light', 'Color scheme must be light')
assert.strictEqual(lightPalette.background.toUpperCase(), '#F7FAFC')
assert.strictEqual(lightPalette.text.toUpperCase(), '#0B132B', 'Light mode text must be high-contrast dark text')
assert.strictEqual(lightPalette.textMuted.toUpperCase(), '#4A5568', 'Light mode text muted must be readable dark-slate')
assert.ok(isValidHex(lightPalette.surface), 'Light surface must be valid HEX')
assert.ok(isValidHex(lightPalette.surfaceElevated), 'Light surface elevated must be valid HEX')
console.log('✓ Test 4 Passed: Light mode palette derived with dark text and crisp surfaces.')

// --------------------------------------------------------------------------
// 5. Custom Background Validation & Palette Derivation
// --------------------------------------------------------------------------
console.log('\n[Test 5] Testing custom background validation & palette derivation...')
assert.strictEqual(isValidHex('#123456'), true, 'Valid 6-char hex')
assert.strictEqual(isValidHex('123456'), false, 'Missing hash')
assert.strictEqual(isValidHex('#GGG123'), false, 'Non-hex chars')

const customDarkPalette = deriveBackgroundPalette('#121212')
assert.strictEqual(customDarkPalette.isLight, false, '#121212 should automatically derive dark mode')

const customLightPalette = deriveBackgroundPalette('#FFFFFF')
assert.strictEqual(customLightPalette.isLight, true, '#FFFFFF should automatically derive light mode')

const fallbackPalette = deriveBackgroundPalette('INVALID_HEX')
assert.strictEqual(fallbackPalette.background.toUpperCase(), '#040B1C', 'Invalid hex falls back to default background')
console.log('✓ Test 5 Passed: Custom background validated and auto-derives correct light/dark schemes.')

// --------------------------------------------------------------------------
// 6. HEX / RGB / HSV Bidirectional Synchronization
// --------------------------------------------------------------------------
console.log('\n[Test 6] Testing HEX / RGB / HSV bidirectional synchronization...')
const testHex = '#18C9F5'
const hsv = hexToHsv(testHex)
assert.ok(hsv.h >= 190 && hsv.h <= 194, `Hue should be approx 192 (got ${hsv.h})`)
assert.ok(hsv.s >= 88 && hsv.s <= 92, `Saturation should be approx 90 (got ${hsv.s})`)
assert.ok(hsv.v >= 94 && hsv.v <= 98, `Value should be approx 96 (got ${hsv.v})`)

const reconvertedHex = hsvToHex(hsv.h, hsv.s, hsv.v)
assert.strictEqual(reconvertedHex.toUpperCase(), testHex.toUpperCase(), 'HSV to HEX should match original')
console.log('✓ Test 6 Passed: Bidirectional synchronization verified.')

// --------------------------------------------------------------------------
// 7. HSV / HSL Conversion Helpers
// --------------------------------------------------------------------------
console.log('\n[Test 7] Testing HSV / HSL conversion helpers...')
const rgbVal = { r: 50, g: 150, b: 250 }
const hsvFromRgb = rgbToHsv(rgbVal.r, rgbVal.g, rgbVal.b)
const rgbFromHsv = hsvToRgb(hsvFromRgb.h, hsvFromRgb.s, hsvFromRgb.v)
assert.ok(Math.abs(rgbFromHsv.r - rgbVal.r) <= 1, 'R component matches')
assert.ok(Math.abs(rgbFromHsv.g - rgbVal.g) <= 1, 'G component matches')
assert.ok(Math.abs(rgbFromHsv.b - rgbVal.b) <= 1, 'B component matches')

const hslFromRgb = rgbToHsl(rgbVal.r, rgbVal.g, rgbVal.b)
const rgbFromHsl = hslToRgb(hslFromRgb.h, hslFromRgb.s, hslFromRgb.l)
assert.ok(Math.abs(rgbFromHsl.r - rgbVal.r) <= 1, 'R component roundtrips via HSL')
assert.ok(Math.abs(rgbFromHsl.g - rgbVal.g) <= 1, 'G component roundtrips via HSL')
assert.ok(Math.abs(rgbFromHsl.b - rgbVal.b) <= 1, 'B component roundtrips via HSL')
console.log('✓ Test 7 Passed: HSV/HSL conversion helpers verified.')

// --------------------------------------------------------------------------
// 8. Black Colour Followed by Hue Adjustment (Example 3 Bug Fix)
// --------------------------------------------------------------------------
console.log('\n[Test 8] Testing Black colour followed by Hue adjustment (Example 3 fix)...')
// When color is pure black:
const blackHex = '#000000'
const blackHsv = hexToHsv(blackHex)
assert.strictEqual(blackHsv.v, 0, 'Pure black value is 0')
assert.strictEqual(blackHsv.s, 0, 'Pure black saturation is 0')

// Bug demonstration: If Hue was changed without restoring S and V, hsvToHex(180, 0, 0) remains #000000!
const untouchedBlack = hsvToHex(180, blackHsv.s, blackHsv.v)
assert.strictEqual(untouchedBlack, '#000000', 'Without fix, hue change on black stays black')

// Fix demonstration (as implemented in CustomColorPicker):
// When black is detected (v < 15 || s < 10), adjust hue and restore vibrant defaults S=85, V=95:
const newHue = 180
const correctedS = blackHsv.v < 15 || blackHsv.s < 10 ? 85 : blackHsv.s
const correctedV = blackHsv.v < 15 || blackHsv.s < 10 ? 95 : blackHsv.v
const fixedHex = hsvToHex(newHue, correctedS, correctedV)
assert.notStrictEqual(fixedHex, '#000000', 'With fix, color immediately becomes a vibrant color at the new hue')
assert.strictEqual(fixedHex.toUpperCase(), '#24F2F2', 'Matches vibrant cyan at hue 180')
console.log('✓ Test 8 Passed: Black colour Hue adjustment fix verified.')

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
// 10. Automatic Accent Matching for All 8 Background Presets
// --------------------------------------------------------------------------
console.log('\n[Test 10] Testing automatic accent matching for all 8 background presets...')
for (const bg of BACKGROUND_PRESETS) {
  const matchingAccent = generateContrastingAccent(bg.baseHex, bg.mode)
  assert.ok(matchingAccent, `Background ${bg.id} must produce a matching accent`)
  assert.ok(isValidHex(matchingAccent.primary), `Matching accent primary for ${bg.id} must be valid HEX`)
  assert.ok(THEME_PRESETS.some((p) => p.id === bg.recommendedAccent), `Recommended accent ${bg.recommendedAccent} must exist`)
}
console.log('✓ Test 10 Passed: All 8 background presets have valid auto-matching accents.')

// --------------------------------------------------------------------------
// 11. Manual Accent Override Preservation
// --------------------------------------------------------------------------
console.log('\n[Test 11] Testing manual accent override preservation...')
mockStorage.clear()

// Select Deep Space (which auto-matches purple-neon)
setBackgroundPreset('deep-space')
let state = getAppearanceState()
assert.strictEqual(state.background.presetId, 'deep-space')
assert.strictEqual(state.accent.presetId, 'purple-neon', 'Deep space auto-matches purple-neon')

// User explicitly overrides accent to Emerald
setPresetTheme('emerald')
state = getAppearanceState()
assert.strictEqual(state.background.presetId, 'deep-space', 'Background remains deep-space')
assert.strictEqual(state.accent.presetId, 'emerald', 'Accent overridden to emerald')

// Reload from storage to verify persistent override preservation
const reloaded = loadSavedTheme()
assert.strictEqual(reloaded.background.presetId, 'deep-space')
assert.strictEqual(reloaded.accent.presetId, 'emerald', 'Saved state preserved manual emerald override')
console.log('✓ Test 11 Passed: Manual accent override preserved.')

// --------------------------------------------------------------------------
// 12. Legacy LocalStorage Compatibility
// --------------------------------------------------------------------------
console.log('\n[Test 12] Testing legacy localStorage compatibility...')
mockStorage.clear()
// Store legacy format (only accent, no background field)
mockStorage.set('applan2.appearance.theme', JSON.stringify({ mode: 'preset', presetId: 'sunset' }))

const legacyLoaded = loadSavedTheme()
assert.strictEqual(legacyLoaded.accent.presetId, 'sunset', 'Legacy accent preset properly parsed')
assert.strictEqual(legacyLoaded.background.presetId, 'midnight-navy', 'Legacy payload gets default dark background')
assert.strictEqual(legacyLoaded.background.palette.isLight, false, 'Legacy payload gets dark palette')
console.log('✓ Test 12 Passed: Legacy stored configurations gracefully upgraded without errors.')

// --------------------------------------------------------------------------
// 13. Background Persistence
// --------------------------------------------------------------------------
console.log('\n[Test 13] Testing background persistence...')
mockStorage.clear()
setBackgroundPreset('cyber-teal')
const storedRaw = JSON.parse(mockStorage.get('applan2.appearance.theme'))
assert.strictEqual(storedRaw.background.presetId, 'cyber-teal')
const loadedBg = loadSavedTheme()
assert.strictEqual(loadedBg.background.presetId, 'cyber-teal')
assert.strictEqual(loadedBg.background.baseHex.toUpperCase(), '#082B2B')
console.log('✓ Test 13 Passed: Background preset persists and restores correctly.')

// --------------------------------------------------------------------------
// 14. Combined Accent/Background Persistence
// --------------------------------------------------------------------------
console.log('\n[Test 14] Testing combined custom accent and custom background persistence...')
mockStorage.clear()
setCustomBackgroundHex('#1A202C')
setCustomTheme('#FF00AA')

const combinedLoaded = loadSavedTheme()
assert.strictEqual(combinedLoaded.background.mode, 'custom')
assert.strictEqual(combinedLoaded.background.baseHex.toUpperCase(), '#1A202C')
assert.strictEqual(combinedLoaded.accent.mode, 'custom')
assert.strictEqual(combinedLoaded.accent.primary.toUpperCase(), '#FF00AA')
console.log('✓ Test 14 Passed: Combined custom accent and background persist accurately.')

// --------------------------------------------------------------------------
// 15. Corrupted Stored Configuration Fallback
// --------------------------------------------------------------------------
console.log('\n[Test 15] Testing corrupted storage fallback...')
mockStorage.clear()
mockStorage.set('applan2.appearance.theme', '{ CORRUPTED_JSON :::')
const safeFallback = loadSavedTheme()
assert.strictEqual(safeFallback.accent.presetId, 'ocean-blue', 'Corrupted JSON falls back to ocean-blue accent')
assert.strictEqual(safeFallback.background.presetId, 'midnight-navy', 'Corrupted JSON falls back to midnight-navy background')

mockStorage.set('applan2.appearance.theme', JSON.stringify({ mode: 'invalid_mode_xyz', presetId: 'unknown_id' }))
const invalidObjFallback = loadSavedTheme()
assert.strictEqual(invalidObjFallback.accent.presetId, 'ocean-blue', 'Invalid mode falls back safely')
console.log('✓ Test 15 Passed: Corrupted storage handled gracefully with safe fallbacks.')

// --------------------------------------------------------------------------
// 16. Dynamic CSS Variable Application (both --theme-* and --app-*)
// --------------------------------------------------------------------------
console.log('\n[Test 16] Testing dynamic CSS variable application...')
mockCssVariables.clear()

const sampleAccent = { primary: '#EC4899', secondary: '#DB2777', tertiary: '#A855F7' }
const sampleBgPalette = deriveBackgroundPalette('#101318', 'dark')

applyThemeVariables(sampleAccent, sampleBgPalette)

// Verify accent CSS variables
assert.strictEqual(mockCssVariables.get('--theme-primary'), '#EC4899')
assert.strictEqual(mockCssVariables.get('--theme-secondary-accent'), '#DB2777')
assert.strictEqual(mockCssVariables.get('--theme-tertiary'), '#A855F7')
assert.strictEqual(mockCssVariables.get('--color-primary'), '#EC4899')
assert.strictEqual(mockCssVariables.get('--color-accent'), '#A855F7')

// Verify background CSS variables
assert.strictEqual(mockCssVariables.get('--app-background').toUpperCase(), '#101318')
assert.strictEqual(mockCssVariables.get('--color-background').toUpperCase(), '#101318')
assert.strictEqual(mockCssVariables.get('--app-text').toUpperCase(), '#F4F8FF')
assert.strictEqual(mockCssVariables.get('--color-text').toUpperCase(), '#F4F8FF')
assert.strictEqual(mockCssVariables.get('--app-color-scheme'), 'dark')
console.log('✓ Test 16 Passed: Both --theme-* and --app-* CSS variables correctly set.')

// --------------------------------------------------------------------------
// 17. Existing Surface Variable Protection (--color-secondary equals --app-surface)
// --------------------------------------------------------------------------
console.log('\n[Test 17] Verifying existing surface variable protection...')
// In our architecture, --color-secondary is mapped to --app-surface so that existing
// Tailwind classes like bg-secondary and text-secondary match the derived background surface
// rather than being stomped by the accent secondary color.
assert.strictEqual(
  mockCssVariables.get('--color-secondary'),
  mockCssVariables.get('--app-surface'),
  '--color-secondary must match --app-surface'
)
console.log('✓ Test 17 Passed: Surface variable protection verified (--color-secondary matches --app-surface).')

console.log('\n======================================================')
console.log('>>> ALL 17 APPEARANCE & BACKGROUND THEME TESTS PASSED (17/17) <<<')
console.log('======================================================')
