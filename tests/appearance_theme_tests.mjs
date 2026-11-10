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
const mockHead = {
  appendChild: () => {}
}
globalThis.document = {
  documentElement: {
    style: {
      setProperty: (prop, val) => mockCssVariables.set(prop, val),
      getPropertyValue: (prop) => mockCssVariables.get(prop) || ''
    }
  },
  head: mockHead,
  createElement: (tag) => ({
    tagName: tag.toUpperCase(),
    style: {},
    appendChild: () => {},
    setAttribute: () => {},
    classList: { add: () => {}, remove: () => {} }
  }),
  getElementsByTagName: (tag) => {
    if (tag.toLowerCase() === 'head') return [mockHead]
    return []
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
  getContrastRatio,
  getReadableTextColor,
  getGradientReadableTextColor,
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

// --------------------------------------------------------------------------
// 18. WCAG Contrast Ratio & Readable Text Selection
// --------------------------------------------------------------------------
console.log('\n[Test 18] Testing WCAG Contrast Ratio and Readable Text Selection...')
const bwContrast = getContrastRatio('#000000', '#FFFFFF')
assert.ok(Math.abs(bwContrast - 21) < 0.1, 'Black/White contrast ratio is approx 21:1')

// Ocean Blue (#18C9F5): Bright cyan requires dark text (#000000)
assert.strictEqual(getReadableTextColor('#18C9F5'), '#000000', 'Ocean blue primary requires dark text')
// Golden (#EAB308): Bright yellow requires dark text (#000000)
assert.strictEqual(getReadableTextColor('#EAB308'), '#000000', 'Golden primary requires dark text')
// Emerald (#10B981): Bright green requires dark text (#000000)
assert.strictEqual(getReadableTextColor('#10B981'), '#000000', 'Emerald primary requires dark text')
// Midnight Navy (#040B1C): Dark navy requires light text (#FFFFFF)
assert.strictEqual(getReadableTextColor('#040B1C'), '#FFFFFF', 'Midnight navy requires white text')
// Arctic White (#F7FAFC): Light background requires dark text (#000000)
assert.strictEqual(getReadableTextColor('#F7FAFC'), '#000000', 'Arctic white requires dark text')

// Gradient readable text:
// For Ocean Blue gradient stops [#18C9F5, #3388FF, #514BFF], dark text provides higher minimum contrast
const oceanGradText = getGradientReadableTextColor(['#18C9F5', '#3388FF', '#514BFF'])
assert.strictEqual(oceanGradText, '#000000', 'Ocean blue gradient stops favor dark text')

// Danger red (#FF4568): luminance ~0.26, contrast with black is ~6.3:1 (exceeds WCAG AA 4.5:1)
const dangerText = getReadableTextColor('#FF4568')
assert.strictEqual(dangerText, '#000000', 'Danger red achieves WCAG AA 4.5:1 with dark text')
console.log('✓ Test 18 Passed: WCAG contrast ratio and readable foreground selection verified.')

// --------------------------------------------------------------------------
// 19. Strict Background Validation & Safe Fallbacks (Phase 02)
// --------------------------------------------------------------------------
console.log('\n[Test 19] Testing strict background validation & invalid data recovery...')
mockStorage.clear()

// Case A: Dark mode with light preset -> falls back to midnight-navy
mockStorage.set('applan2.appearance.theme', JSON.stringify({
  mode: 'preset',
  presetId: 'emerald',
  background: { mode: 'dark', presetId: 'arctic-white' }
}))
const darkWithLightPreset = loadSavedTheme()
assert.strictEqual(darkWithLightPreset.presetId, 'emerald', 'Valid accent preserved')
assert.strictEqual(darkWithLightPreset.background.mode, 'dark')
assert.strictEqual(darkWithLightPreset.background.presetId, 'midnight-navy', 'Light preset rejected in dark mode')

// Case B: Light mode with dark preset -> falls back to arctic-white
mockStorage.set('applan2.appearance.theme', JSON.stringify({
  mode: 'preset',
  presetId: 'sunset',
  background: { mode: 'light', presetId: 'carbon-black' }
}))
const lightWithDarkPreset = loadSavedTheme()
assert.strictEqual(lightWithDarkPreset.presetId, 'sunset', 'Valid accent preserved')
assert.strictEqual(lightWithDarkPreset.background.mode, 'light')
assert.strictEqual(lightWithDarkPreset.background.presetId, 'arctic-white', 'Dark preset rejected in light mode')

// Case C: Invalid mode string -> falls back to default dark midnight-navy
mockStorage.set('applan2.appearance.theme', JSON.stringify({
  mode: 'preset',
  presetId: 'golden',
  background: { mode: 'neon_hacker', presetId: 'cyber-teal' }
}))
const invalidModeRes = loadSavedTheme()
assert.strictEqual(invalidModeRes.presetId, 'golden', 'Valid accent preserved')
assert.strictEqual(invalidModeRes.background.mode, 'dark')
assert.strictEqual(invalidModeRes.background.presetId, 'midnight-navy')

// Case D: Custom mode with invalid hex -> falls back to default background
mockStorage.set('applan2.appearance.theme', JSON.stringify({
  mode: 'custom',
  customHex: '#FF5500',
  background: { mode: 'custom', customHex: 'not-a-hex' }
}))
const invalidCustomBgRes = loadSavedTheme()
assert.strictEqual(invalidCustomBgRes.customHex, '#FF5500', 'Valid custom accent preserved')
assert.strictEqual(invalidCustomBgRes.background.mode, 'dark', 'Invalid custom hex falls back to dark')
assert.strictEqual(invalidCustomBgRes.background.presetId, 'midnight-navy')

// Case E: Unknown preset ID in dark mode -> falls back to midnight-navy
mockStorage.set('applan2.appearance.theme', JSON.stringify({
  mode: 'preset',
  presetId: 'purple-neon',
  background: { mode: 'dark', presetId: 'non-existent-preset' }
}))
const unknownPresetRes = loadSavedTheme()
assert.strictEqual(unknownPresetRes.presetId, 'purple-neon', 'Valid accent preserved')
assert.strictEqual(unknownPresetRes.background.presetId, 'midnight-navy')
console.log('✓ Test 19 Passed: Strict background validation and safe fallbacks verified.')

// --------------------------------------------------------------------------
// 20. Contrast-Aware CSS Variables in applyThemeVariables (Phase 03)
// --------------------------------------------------------------------------
console.log('\n[Test 20] Testing contrast-aware CSS variables in applyThemeVariables...')
mockCssVariables.clear()
// Apply Ocean Blue
applyThemeVariables({
  primary: '#18C9F5',
  secondary: '#3388FF',
  tertiary: '#514BFF',
  background: { mode: 'dark', presetId: 'midnight-navy' },
  bgPalette: deriveBackgroundPalette('dark', 'midnight-navy')
})

assert.strictEqual(mockCssVariables.get('--theme-on-primary'), '#000000', '--theme-on-primary must be #000000 for #18C9F5')
assert.strictEqual(mockCssVariables.get('--theme-on-gradient'), '#000000', '--theme-on-gradient must be #000000 for Ocean Blue')
assert.strictEqual(mockCssVariables.get('--app-on-danger'), '#000000', '--app-on-danger must be #000000 for WCAG AA compliance')

// Apply Purple Neon (primary #A855F7 has luminance 0.214; contrast with black is 5.28:1 vs white 3.97:1)
applyThemeVariables({
  primary: '#A855F7',
  secondary: '#7C3AED',
  tertiary: '#EC4899',
  background: { mode: 'dark', presetId: 'midnight-navy' },
  bgPalette: deriveBackgroundPalette('dark', 'midnight-navy')
})
assert.strictEqual(mockCssVariables.get('--theme-on-primary'), '#000000', '--theme-on-primary achieves WCAG AA 4.5:1 with dark text')

// Apply a very dark primary (e.g. #17102B) which requires white text
applyThemeVariables({
  primary: '#17102B',
  secondary: '#07152E',
  tertiary: '#102449',
  background: { mode: 'dark', presetId: 'midnight-navy' },
  bgPalette: deriveBackgroundPalette('dark', 'midnight-navy')
})
assert.strictEqual(mockCssVariables.get('--theme-on-primary'), '#FFFFFF', '--theme-on-primary is white on dark primary')
assert.strictEqual(mockCssVariables.get('--app-on-danger'), '#000000')
console.log('✓ Test 20 Passed: Contrast-aware CSS variables set dynamically on root.')

// --------------------------------------------------------------------------
// 21. Notification Service Options Safety (Phase 03 / Phase 04)
// --------------------------------------------------------------------------
console.log('\n[Test 21] Testing Notification Service options safety and class merging...')
const {
  showSuccess,
  showError,
  showWarning,
  showInfo,
  showConfirm,
  showToast,
  buildAlertOptions,
  buildConfirmOptions,
  buildToastOptions,
  mergeSwalClasses
} = await import('../src/renderer/src/utils/notificationService.js')

assert.strictEqual(typeof showSuccess, 'function', 'showSuccess exported')
assert.strictEqual(typeof showError, 'function', 'showError exported')
assert.strictEqual(typeof showWarning, 'function', 'showWarning exported')
assert.strictEqual(typeof showInfo, 'function', 'showInfo exported')
assert.strictEqual(typeof showConfirm, 'function', 'showConfirm exported')
assert.strictEqual(typeof showToast, 'function', 'showToast exported')
assert.strictEqual(typeof buildAlertOptions, 'function', 'buildAlertOptions exported')
assert.strictEqual(typeof buildConfirmOptions, 'function', 'buildConfirmOptions exported')
assert.strictEqual(typeof buildToastOptions, 'function', 'buildToastOptions exported')
assert.strictEqual(typeof mergeSwalClasses, 'function', 'mergeSwalClasses exported')

// 1. mergeSwalClasses verifies non-destructive extension of theme classes
const baseClasses = { popup: 'app-swal-popup', title: 'app-swal-title' }
const mergedClasses = mergeSwalClasses(baseClasses, { popup: 'custom-popup-extra', customSlot: 'my-slot' })
assert.strictEqual(mergedClasses.popup, 'app-swal-popup custom-popup-extra')
assert.strictEqual(mergedClasses.title, 'app-swal-title')
assert.strictEqual(mergedClasses.customSlot, 'my-slot')

// 2. buildAlertOptions protects theme defaults from malicious caller overrides
const alertOverrideAttempt = {
  background: '#FFFFFF',
  color: '#000000',
  buttonsStyling: true,
  customClass: { popup: 'injected-popup-class' }
}
const builtAlert = buildAlertOptions(alertOverrideAttempt, 'error', 'Error Title', 'Error Message')
assert.strictEqual(builtAlert.background, 'var(--app-surface-elevated, #0B1C38)', 'Caller cannot override theme background')
assert.strictEqual(builtAlert.color, 'var(--app-text, #F4F8FF)', 'Caller cannot override theme text color')
assert.strictEqual(builtAlert.buttonsStyling, false, 'Caller cannot re-enable default buttonsStyling')
assert.ok(builtAlert.customClass.popup.includes('app-swal-popup'), 'Mandatory app-swal-popup class preserved')
assert.ok(builtAlert.customClass.popup.includes('injected-popup-class'), 'Caller customClass merged cleanly')
assert.strictEqual(builtAlert.icon, 'error')
assert.strictEqual(builtAlert.iconColor, '#FF4568', 'Semantic error icon color #FF4568 applied')

// 3. buildConfirmOptions protects theme defaults and applies correct danger/normal styles
const builtConfirmDanger = buildConfirmOptions({ isDanger: true }, 'Confirm Action', 'Are you sure?')
assert.strictEqual(builtConfirmDanger.showCancelButton, true)
assert.strictEqual(builtConfirmDanger.confirmButtonColor, '#FF4568', 'Danger confirmation uses #FF4568')
assert.strictEqual(builtConfirmDanger.buttonsStyling, false)
assert.ok(builtConfirmDanger.customClass.confirmButton.includes('app-swal-confirm-btn-danger'))

const builtConfirmNormal = buildConfirmOptions({ isDanger: false }, 'Proceed', 'Continue?')
assert.strictEqual(builtConfirmNormal.confirmButtonColor, 'var(--theme-primary, #18C9F5)')
assert.ok(builtConfirmNormal.customClass.confirmButton.includes('app-swal-confirm-btn'))
assert.ok(!builtConfirmNormal.customClass.confirmButton.includes('app-swal-confirm-btn-danger'))

// 4. buildToastOptions protects theme and configures non-intrusive toast
const builtToast = buildToastOptions({ background: '#FF0000', buttonsStyling: true }, 'info', 'Saved', 2500)
assert.strictEqual(builtToast.toast, true)
assert.strictEqual(builtToast.timer, 2500)
assert.strictEqual(builtToast.buttonsStyling, false, 'Toast buttonsStyling protected')
assert.strictEqual(builtToast.background, 'var(--app-surface-elevated, #0B1C38)', 'Toast background protected')
console.log('✓ Test 21 Passed: Notification Service options safety, builders and class merging verified.')

// --------------------------------------------------------------------------
// 22. StatCard Non-Semantic Accent Mapping Verification (Phase 04)
// --------------------------------------------------------------------------
console.log('\n[Test 22] Testing StatCard dynamic accent and semantic isolation...')
const { getStatCardColorStyles, STAT_CARD_COLOR_MAP } = await import('../src/renderer/src/utils/statCardTheme.js')

assert.strictEqual(typeof getStatCardColorStyles, 'function', 'getStatCardColorStyles exported')
assert.ok(STAT_CARD_COLOR_MAP, 'STAT_CARD_COLOR_MAP exported')

// Cyan must map to primary theme token
const cyanStyles = getStatCardColorStyles('cyan')
assert.ok(cyanStyles.border.includes('primary'), 'Cyan maps to primary border')
assert.ok(cyanStyles.iconBg.includes('text-primary'), 'Cyan text is text-primary')
assert.ok(cyanStyles.activeBorder.includes('var(--theme-primary-rgb)'), 'Cyan activeBorder uses primary rgb variable')

// Blue must map to secondary-accent theme token
const blueStyles = getStatCardColorStyles('blue')
assert.ok(blueStyles.border.includes('secondary-accent'), 'Blue maps to secondary-accent border')
assert.ok(blueStyles.iconBg.includes('text-secondary-accent'), 'Blue text is text-secondary-accent')
assert.ok(blueStyles.activeBorder.includes('var(--theme-secondary-rgb)'), 'Blue activeBorder uses secondary rgb variable')

// Purple must map to accent (tertiary) theme token
const purpleStyles = getStatCardColorStyles('purple')
assert.ok(purpleStyles.border.includes('border-accent'), 'Purple maps to border-accent')
assert.ok(purpleStyles.iconBg.includes('text-accent'), 'Purple text is text-accent')
assert.ok(purpleStyles.activeBorder.includes('var(--theme-tertiary-rgb)'), 'Purple activeBorder uses tertiary rgb variable')

// Green must remain semantic emerald / #00DEA5 (never overwritten by accent theme)
const greenStyles = getStatCardColorStyles('green')
assert.ok(greenStyles.border.includes('emerald'), 'Green remains emerald')
assert.ok(greenStyles.iconBg.includes('#00DEA5'), 'Green retains semantic hex #00DEA5')

// Red must remain semantic rose / #FF4568 (never overwritten by accent theme)
const redStyles = getStatCardColorStyles('red')
assert.ok(redStyles.border.includes('rose'), 'Red remains rose')
assert.ok(redStyles.iconBg.includes('#FF4568'), 'Red retains semantic hex #FF4568')

// Fallback safety for unknown accents
const fallbackStyles = getStatCardColorStyles('unknown-accent')
assert.strictEqual(fallbackStyles, STAT_CARD_COLOR_MAP.cyan, 'Unknown accent safely falls back to cyan')
console.log('✓ Test 22 Passed: StatCard accent mapping and semantic isolation verified.')

// --------------------------------------------------------------------------
// 23. Color Picker Input Synchronization & Pure State Updates (Phase 04)
// --------------------------------------------------------------------------
console.log('\n[Test 23] Testing Color Picker pure state update logic...')
// From pure black #000000:
const blackRgb = hexToRgb('#000000')
const blackHsv = rgbToHsv(blackRgb.r, blackRgb.g, blackRgb.b)
assert.strictEqual(blackHsv.s, 0)
assert.strictEqual(blackHsv.v, 0)

// Moving hue slider on black triggers automatic recovery (Example 3):
const hueShiftRecovered = adjustHueWithBlackRecovery(240, blackHsv.s, blackHsv.v)
assert.strictEqual(hueShiftRecovered.h, 240)
assert.strictEqual(hueShiftRecovered.s, 85, 'Restores vibrant saturation 85')
assert.strictEqual(hueShiftRecovered.v, 95, 'Restores vibrant value 95')

// Recomputed hex from recovered:
const recoveredHex = hsvToHex(hueShiftRecovered.h, hueShiftRecovered.s, hueShiftRecovered.v)
assert.notStrictEqual(recoveredHex, '#000000', 'Recovered color is no longer stuck on black')
assert.ok(isValidHex(recoveredHex), 'Recovered color is valid hex')

// 2D Saturation / Value coordinate conversion calculation:
// Given rect width 200, height 200:
const computeSvFromCoords = (x, y, width = 200, height = 200) => {
  const clampedX = Math.max(0, Math.min(width, x))
  const clampedY = Math.max(0, Math.min(height, y))
  return {
    s: Math.round((clampedX / width) * 100),
    v: Math.round((1 - clampedY / height) * 100)
  }
}
const svTopLeft = computeSvFromCoords(0, 0)
assert.strictEqual(svTopLeft.s, 0, 'Top-left saturation is 0 (white)')
assert.strictEqual(svTopLeft.v, 100, 'Top-left value is 100 (white)')

const svBottomLeft = computeSvFromCoords(0, 200)
assert.strictEqual(svBottomLeft.s, 0, 'Bottom-left saturation is 0')
assert.strictEqual(svBottomLeft.v, 0, 'Bottom-left value is 0 (black)')

const svTopRight = computeSvFromCoords(200, 0)
assert.strictEqual(svTopRight.s, 100, 'Top-right saturation is 100 (pure hue)')
assert.strictEqual(svTopRight.v, 100, 'Top-right value is 100 (pure hue)')

// Typing RGB 0, 0, 0 gives pure black:
const typedBlackHex = rgbToHex(0, 0, 0)
assert.strictEqual(typedBlackHex, '#000000')
const typedBlackHsv = rgbToHsv(0, 0, 0)
const recoveredAgain = adjustHueWithBlackRecovery(60, typedBlackHsv.s, typedBlackHsv.v)
assert.strictEqual(recoveredAgain.s, 85)
assert.strictEqual(recoveredAgain.v, 95)

// Bidirectional RGB <-> HEX consistency across spectrum
const testHexes = ['#18C9F5', '#00DEA5', '#FF4568', '#A855F7', '#FFFFFF', '#000000']
for (const hex of testHexes) {
  const rgb = hexToRgb(hex)
  assert.ok(rgb, `RGB extracted for ${hex}`)
  const roundtripHex = rgbToHex(rgb.r, rgb.g, rgb.b)
  assert.strictEqual(roundtripHex.toUpperCase(), hex.toUpperCase(), `Roundtrip matches for ${hex}`)
}
console.log('✓ Test 23 Passed: Color picker input synchronization and recovery verified.')

console.log('\n======================================================')
console.log('>>> ALL 23 APPEARANCE & BACKGROUND THEME TESTS PASSED (23/23) <<<')
console.log('======================================================')
