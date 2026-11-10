/**
 * Unit Test Suite for APPLAN2 Appearance Theme System
 *
 * Verifies:
 * 1. Six approved Cyberpunk theme presets definitions and values.
 * 2. HEX color format validation (isValidHex).
 * 3. Color conversion helpers (hexToRgb, rgbToHex, rgbToHsl, hslToRgb).
 * 4. Automatic contrast-safe harmonious custom palette generation.
 * 5. Dynamic CSS variable injection and protection of --color-secondary (#07152E).
 * 6. LocalStorage persistence, parsing, and safe fallback handling.
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
  isValidHex,
  hexToRgb,
  rgbToHex,
  rgbToHsl,
  hslToRgb,
  generateCustomPalette,
  applyThemeVariables,
  loadSavedTheme,
  saveTheme,
  setPresetTheme,
  setCustomTheme,
  resetAppearanceTheme
} = await import('../src/renderer/src/utils/appearanceTheme.js')

console.log('--- APPLAN2 APPEARANCE THEME UNIT TESTS ---')

// 1. Verify 6 Approved Presets
console.log('\n[Test 1] Verifying 6 approved presets...')
assert.strictEqual(THEME_PRESETS.length, 6, 'Should have exactly 6 presets')

const expectedPresets = {
  'ocean-blue': {
    name: 'Ocean Blue',
    primary: '#18C9F5',
    secondary: '#3388FF',
    tertiary: '#514BFF'
  },
  'purple-neon': {
    name: 'Purple Neon',
    primary: '#A855F7',
    secondary: '#7C3AED',
    tertiary: '#EC4899'
  },
  emerald: { name: 'Emerald', primary: '#10B981', secondary: '#059669', tertiary: '#22D3EE' },
  sunset: { name: 'Sunset', primary: '#F97316', secondary: '#EF4444', tertiary: '#FBBF24' },
  rose: { name: 'Rose', primary: '#EC4899', secondary: '#DB2777', tertiary: '#A855F7' },
  golden: { name: 'Golden', primary: '#EAB308', secondary: '#F59E0B', tertiary: '#F97316' }
}

for (const [id, expected] of Object.entries(expectedPresets)) {
  const found = THEME_PRESETS.find((p) => p.id === id)
  assert.ok(found, `Preset ${id} must exist`)
  assert.strictEqual(found.name, expected.name, `Preset ${id} name mismatch`)
  assert.strictEqual(found.primary, expected.primary, `Preset ${id} primary mismatch`)
  assert.strictEqual(found.secondary, expected.secondary, `Preset ${id} secondary mismatch`)
  assert.strictEqual(found.tertiary, expected.tertiary, `Preset ${id} tertiary mismatch`)
}

assert.strictEqual(DEFAULT_THEME_ID, 'ocean-blue', 'Default preset ID must be ocean-blue')
assert.strictEqual(DEFAULT_THEME.id, 'ocean-blue', 'Default theme must be ocean-blue')
console.log('✓ All 6 presets defined with exact 3-color specifications.')

// 2. Test HEX Validation
console.log('\n[Test 2] Testing isValidHex...')
assert.strictEqual(isValidHex('#18C9F5'), true, 'Valid 6-digit uppercase')
assert.strictEqual(isValidHex('#18c9f5'), true, 'Valid 6-digit lowercase')
assert.strictEqual(isValidHex('#000000'), true, 'Valid black')
assert.strictEqual(isValidHex('#FFFFFF'), true, 'Valid white')
assert.strictEqual(isValidHex('18C9F5'), false, 'Missing hash')
assert.strictEqual(isValidHex('#FFF'), false, '3-digit shorthand invalid')
assert.strictEqual(isValidHex('#18C9F5AA'), false, '8-digit alpha invalid')
assert.strictEqual(isValidHex('not-a-color'), false, 'String name invalid')
assert.strictEqual(isValidHex(null), false, 'Null invalid')
assert.strictEqual(isValidHex(undefined), false, 'Undefined invalid')
console.log('✓ isValidHex correctly validates 6-character hex strings.')

// 3. Test Color Conversion Helpers
console.log('\n[Test 3] Testing color conversion helpers (RGB / HEX / HSL)...')
const rgb = hexToRgb('#18C9F5')
assert.deepStrictEqual(rgb, { r: 24, g: 201, b: 245 })
const hex = rgbToHex(24, 201, 245)
assert.strictEqual(hex, '#18C9F5')

const hsl = rgbToHsl(24, 201, 245)
assert.ok(Math.abs(hsl.h - 192) < 2, 'Hue should be approx 192')
assert.ok(hsl.s > 80, 'Saturation should be high')

const reconvertedRgb = hslToRgb(hsl.h, hsl.s, hsl.l)
assert.ok(Math.abs(reconvertedRgb.r - 24) <= 2, 'R component should round-trip')
assert.ok(Math.abs(reconvertedRgb.g - 201) <= 2, 'G component should round-trip')
assert.ok(Math.abs(reconvertedRgb.b - 245) <= 2, 'B component should round-trip')
console.log('✓ Color conversion helpers round-trip accurately.')

// 4. Test generateCustomPalette
console.log('\n[Test 4] Testing custom palette generation...')
const customPalette = generateCustomPalette('#FF0055')
assert.ok(customPalette, 'Custom palette must be generated')
assert.strictEqual(customPalette.primary, '#FF0055')
assert.ok(isValidHex(customPalette.secondary), 'Generated secondary must be valid HEX')
assert.ok(isValidHex(customPalette.tertiary), 'Generated tertiary must be valid HEX')
assert.notStrictEqual(
  customPalette.secondary,
  customPalette.primary,
  'Secondary must differ from primary'
)
assert.notStrictEqual(
  customPalette.tertiary,
  customPalette.primary,
  'Tertiary must differ from primary'
)
console.log(
  `✓ Custom palette generated: Primary=${customPalette.primary}, Secondary=${customPalette.secondary}, Tertiary=${customPalette.tertiary}`
)

// 5. Test CSS Variable Application & Protection of --color-secondary
console.log('\n[Test 5] Testing CSS variable application and surface color protection...')
mockCssVariables.clear()
mockCssVariables.set('--color-secondary', '#07152e') // Protected dark navy surface

applyThemeVariables(customPalette)

assert.strictEqual(mockCssVariables.get('--theme-primary'), '#FF0055')
assert.strictEqual(mockCssVariables.get('--theme-secondary-accent'), customPalette.secondary)
assert.strictEqual(mockCssVariables.get('--theme-tertiary'), customPalette.tertiary)
assert.strictEqual(mockCssVariables.get('--color-primary'), '#FF0055')
assert.strictEqual(mockCssVariables.get('--color-accent'), customPalette.tertiary)
// CRITICAL CHECK: --color-secondary must remain untouched!
assert.strictEqual(
  mockCssVariables.get('--color-secondary'),
  '#07152e',
  '--color-secondary must NOT be overwritten!'
)
console.log(
  '✓ CSS variables applied correctly; dark navy surface --color-secondary remains intact.'
)

// 6. Test LocalStorage Persistence and Fallback
console.log('\n[Test 6] Testing localStorage persistence and fallbacks...')
mockStorage.clear()

// Test direct saveTheme
saveTheme({ mode: 'preset', presetId: 'emerald' })
assert.strictEqual(
  mockStorage.get('applan2.appearance.theme'),
  JSON.stringify({ mode: 'preset', presetId: 'emerald' })
)
mockStorage.clear()

// Missing storage -> fallback to default Ocean Blue
const initialLoad = loadSavedTheme()
assert.strictEqual(initialLoad.id, 'ocean-blue')
assert.strictEqual(initialLoad.primary, '#18C9F5')

// Switch to preset 'sunset'
setPresetTheme('sunset')
const savedPreset = loadSavedTheme()
assert.strictEqual(savedPreset.id, 'sunset')
assert.strictEqual(savedPreset.primary, '#F97316')

// Switch to custom color
setCustomTheme('#00FFCC')
const savedCustom = loadSavedTheme()
assert.strictEqual(savedCustom.mode, 'custom')
assert.strictEqual(savedCustom.primary, '#00FFCC')
assert.ok(isValidHex(savedCustom.secondary))

// Reset to default
resetAppearanceTheme()
const resetTheme = loadSavedTheme()
assert.strictEqual(resetTheme.id, 'ocean-blue')
assert.strictEqual(resetTheme.primary, '#18C9F5')

// Corrupted JSON in storage -> gracefully falls back to default
mockStorage.set('applan2.appearance.theme', 'CORRUPT_JSON{{{')
const fallbackTheme = loadSavedTheme()
assert.strictEqual(fallbackTheme.id, 'ocean-blue')
console.log(
  '✓ LocalStorage persistence, mode switching, reset, and corrupted-data fallback verified.'
)

console.log('\n>>> ALL APPEARANCE THEME UNIT TESTS PASSED (6/6) <<<')
