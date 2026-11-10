import { useSyncExternalStore } from 'react'

/**
 * Appearance Theme System for APPLAN2 Desktop Application
 *
 * Implements a dynamic global 3-color Cyberpunk accent theme:
 * 1. Primary: Main neon color
 * 2. Secondary: Supporting gradient color
 * 3. Tertiary: Highlight and glow color
 */

export const APPEARANCE_STORAGE_KEY = 'applan2.appearance.theme'

// Approved 6 Three-Colour Theme Presets
export const THEME_PRESETS = Object.freeze([
  {
    id: 'ocean-blue',
    name: 'Ocean Blue',
    primary: '#18C9F5',
    secondary: '#3388FF',
    tertiary: '#514BFF',
    isDefault: true
  },
  {
    id: 'purple-neon',
    name: 'Purple Neon',
    primary: '#A855F7',
    secondary: '#7C3AED',
    tertiary: '#EC4899'
  },
  {
    id: 'emerald',
    name: 'Emerald',
    primary: '#10B981',
    secondary: '#059669',
    tertiary: '#22D3EE'
  },
  {
    id: 'sunset',
    name: 'Sunset',
    primary: '#F97316',
    secondary: '#EF4444',
    tertiary: '#FBBF24'
  },
  {
    id: 'rose',
    name: 'Rose',
    primary: '#EC4899',
    secondary: '#DB2777',
    tertiary: '#A855F7'
  },
  {
    id: 'golden',
    name: 'Golden',
    primary: '#EAB308',
    secondary: '#F59E0B',
    tertiary: '#F97316'
  }
])

export const DEFAULT_THEME_ID = 'ocean-blue'
export const DEFAULT_THEME = THEME_PRESETS[0]

/**
 * Validates a 6-character hex color string with leading hash (e.g. #18C9F5).
 */
export function isValidHex(hex) {
  if (typeof hex !== 'string') return false
  return /^#[0-9A-Fa-f]{6}$/.test(hex.trim())
}

/**
 * Converts a hex color string to an { r, g, b } object.
 */
export function hexToRgb(hex) {
  if (!isValidHex(hex)) return null
  const clean = hex.trim().slice(1)
  const num = Number.parseInt(clean, 16)
  return {
    r: (num >> 16) & 255,
    g: (num >> 8) & 255,
    b: num & 255
  }
}

/**
 * Converts numeric R, G, B components to a formatted uppercase hex string.
 */
export function rgbToHex(r, g, b) {
  const clamp = (v) => Math.max(0, Math.min(255, Math.round(v)))
  const toHex = (v) => clamp(v).toString(16).padStart(2, '0')
  return `#${toHex(r)}${toHex(g)}${toHex(b)}`.toUpperCase()
}

/**
 * Converts RGB components to HSL.
 */
export function rgbToHsl(r, g, b) {
  r /= 255
  g /= 255
  b /= 255
  const max = Math.max(r, g, b)
  const min = Math.min(r, g, b)
  let h = 0
  let s = 0
  const l = (max + min) / 2

  if (max !== min) {
    const d = max - min
    s = l > 0.5 ? d / (2 - max - min) : d / (max + min)
    switch (max) {
      case r:
        h = (g - b) / d + (g < b ? 6 : 0)
        break
      case g:
        h = (b - r) / d + 2
        break
      case b:
        h = (r - g) / d + 4
        break
    }
    h *= 60
  }
  return { h, s: s * 100, l: l * 100 }
}

/**
 * Converts HSL components to RGB.
 */
export function hslToRgb(h, s, l) {
  h = ((h % 360) + 360) % 360
  s = Math.max(0, Math.min(100, s)) / 100
  l = Math.max(0, Math.min(100, l)) / 100

  const c = (1 - Math.abs(2 * l - 1)) * s
  const x = c * (1 - Math.abs(((h / 60) % 2) - 1))
  const m = l - c / 2
  let r = 0
  let g = 0
  let b = 0

  if (h < 60) {
    r = c
    g = x
    b = 0
  } else if (h < 120) {
    r = x
    g = c
    b = 0
  } else if (h < 180) {
    r = 0
    g = c
    b = x
  } else if (h < 240) {
    r = 0
    g = x
    b = c
  } else if (h < 300) {
    r = x
    g = 0
    b = c
  } else {
    r = c
    g = 0
    b = x
  }

  return {
    r: (r + m) * 255,
    g: (g + m) * 255,
    b: (b + m) * 255
  }
}

/**
 * Generates two harmonious supporting neon cyberpunk colors (Secondary & Tertiary)
 * from a single user-chosen primary hex with good contrast against dark navy backgrounds.
 */
export function generateCustomPalette(primaryHex) {
  if (!isValidHex(primaryHex)) return null

  const rgb = hexToRgb(primaryHex)
  if (!rgb) return null

  const hsl = rgbToHsl(rgb.r, rgb.g, rgb.b)

  // Ensure vibrant cyberpunk saturation and visible contrast against dark navy (#040B1C)
  const vibrantSaturation = Math.max(70, Math.min(100, hsl.s))
  const balancedLightness = Math.max(48, Math.min(65, hsl.l))

  // Secondary: Analogous shift (+30 deg) for smooth gradient transition
  const secH = (hsl.h + 30) % 360
  const secS = Math.max(65, vibrantSaturation * 0.95)
  const secL = Math.max(42, balancedLightness - 4)
  const secRgb = hslToRgb(secH, secS, secL)
  const secondaryHex = rgbToHex(secRgb.r, secRgb.g, secRgb.b)

  // Tertiary: Complementary accent shift (+65 deg) for neon edge glow and sparkles
  const tertH = (hsl.h + 65) % 360
  const tertS = Math.min(100, vibrantSaturation + 5)
  const tertL = Math.min(70, balancedLightness + 6)
  const tertRgb = hslToRgb(tertH, tertS, tertL)
  const tertiaryHex = rgbToHex(tertRgb.r, tertRgb.g, tertRgb.b)

  return {
    id: 'custom',
    name: 'Custom Theme',
    primary: primaryHex.toUpperCase(),
    secondary: secondaryHex,
    tertiary: tertiaryHex,
    isCustom: true
  }
}

/**
 * Applies dynamic CSS variables to the document root element.
 * Does NOT overwrite --color-secondary (which is reserved for dark navy surfaces).
 */
export function applyThemeVariables(theme) {
  if (typeof document === 'undefined') return
  if (!theme || !theme.primary || !theme.secondary || !theme.tertiary) return

  const root = document.documentElement

  // Theme variable definitions
  root.style.setProperty('--theme-primary', theme.primary)
  root.style.setProperty('--theme-secondary-accent', theme.secondary)
  root.style.setProperty('--theme-tertiary', theme.tertiary)

  // Aliases for standard Tailwind / UI components
  root.style.setProperty('--color-primary', theme.primary)
  root.style.setProperty('--color-accent', theme.tertiary)

  // RGB components for rgba(...) shadows, glows, and transparent borders
  const primRgb = hexToRgb(theme.primary)
  const secRgb = hexToRgb(theme.secondary)
  const tertRgb = hexToRgb(theme.tertiary)

  if (primRgb) {
    root.style.setProperty('--theme-primary-rgb', `${primRgb.r}, ${primRgb.g}, ${primRgb.b}`)
    root.style.setProperty(
      '--glow-cyan',
      `0 0 25px rgba(${primRgb.r}, ${primRgb.g}, ${primRgb.b}, 0.45)`
    )
  }

  if (secRgb) {
    root.style.setProperty('--theme-secondary-rgb', `${secRgb.r}, ${secRgb.g}, ${secRgb.b}`)
  }

  if (tertRgb) {
    root.style.setProperty('--theme-tertiary-rgb', `${tertRgb.r}, ${tertRgb.g}, ${tertRgb.b}`)
    root.style.setProperty(
      '--glow-violet',
      `0 0 25px rgba(${tertRgb.r}, ${tertRgb.g}, ${tertRgb.b}, 0.45)`
    )
  }
}

/**
 * Loads the saved theme from localStorage, safely falling back to Ocean Blue.
 */
export function loadSavedTheme() {
  if (typeof window === 'undefined' || !window.localStorage) {
    return { ...DEFAULT_THEME, mode: 'preset', presetId: DEFAULT_THEME_ID }
  }

  try {
    const raw = localStorage.getItem(APPEARANCE_STORAGE_KEY)
    if (!raw) {
      return { ...DEFAULT_THEME, mode: 'preset', presetId: DEFAULT_THEME_ID }
    }

    const parsed = JSON.parse(raw)

    if (parsed.mode === 'preset') {
      const found = THEME_PRESETS.find((p) => p.id === parsed.presetId)
      if (found) {
        return { ...found, mode: 'preset', presetId: found.id }
      }
    } else if (parsed.mode === 'custom' && isValidHex(parsed.customHex)) {
      const palette = generateCustomPalette(parsed.customHex)
      if (palette) {
        return { ...palette, mode: 'custom', customHex: parsed.customHex.toUpperCase() }
      }
    }
  } catch (err) {
    console.warn('Failed to parse appearance theme from localStorage:', err)
  }

  return { ...DEFAULT_THEME, mode: 'preset', presetId: DEFAULT_THEME_ID }
}

/**
 * Persists the theme configuration to localStorage and applies CSS variables.
 */
export function saveTheme(config) {
  if (typeof window === 'undefined' || !window.localStorage) return

  try {
    localStorage.setItem(APPEARANCE_STORAGE_KEY, JSON.stringify(config))
  } catch (err) {
    console.warn('Failed to save appearance theme to localStorage:', err)
  }
}

// In-memory active theme state and subscriber notification
let currentThemeState = loadSavedTheme()
const themeListeners = new Set()

function notifyListeners() {
  themeListeners.forEach((listener) => {
    try {
      listener(currentThemeState)
    } catch (e) {
      console.warn('Theme listener error:', e)
    }
  })
}

/**
 * Initializes the global appearance theme on application bootstrap.
 * Must be executed synchronously in main.jsx before React mounts.
 */
export function initAppearanceTheme() {
  currentThemeState = loadSavedTheme()
  applyThemeVariables(currentThemeState)
  return currentThemeState
}

/**
 * Switches the active theme to an approved preset.
 */
export function setPresetTheme(presetId) {
  const preset = THEME_PRESETS.find((p) => p.id === presetId) || DEFAULT_THEME
  currentThemeState = {
    ...preset,
    mode: 'preset',
    presetId: preset.id
  }
  applyThemeVariables(currentThemeState)
  saveTheme({ mode: 'preset', presetId: preset.id })
  notifyListeners()
  return currentThemeState
}

/**
 * Switches the active theme to a validated custom HEX color.
 */
export function setCustomTheme(customHex) {
  if (!isValidHex(customHex)) return null

  const palette = generateCustomPalette(customHex)
  if (!palette) return null

  currentThemeState = {
    ...palette,
    mode: 'custom',
    customHex: customHex.toUpperCase()
  }
  applyThemeVariables(currentThemeState)
  saveTheme({
    mode: 'custom',
    customHex: customHex.toUpperCase(),
    primary: palette.primary,
    secondary: palette.secondary,
    tertiary: palette.tertiary
  })
  notifyListeners()
  return currentThemeState
}

/**
 * Resets the theme to the default Ocean Blue preset.
 */
export function resetAppearanceTheme() {
  return setPresetTheme(DEFAULT_THEME_ID)
}

function subscribeTheme(callback) {
  themeListeners.add(callback)
  return () => {
    themeListeners.delete(callback)
  }
}

function getThemeSnapshot() {
  return currentThemeState
}

/**
 * React Hook providing the active theme state and mutation methods.
 * Subscribes to dynamic theme changes across all components.
 */
export function useAppearanceTheme() {
  const themeState = useSyncExternalStore(subscribeTheme, getThemeSnapshot, getThemeSnapshot)

  return {
    theme: themeState,
    mode: themeState.mode || 'preset',
    presetId: themeState.presetId || (themeState.mode === 'preset' ? themeState.id : null),
    customHex:
      themeState.customHex || (themeState.mode === 'custom' ? themeState.primary : '#18C9F5'),
    isCustom: themeState.mode === 'custom',
    setPreset: setPresetTheme,
    setCustomHex: setCustomTheme,
    resetToDefault: resetAppearanceTheme
  }
}

export default useAppearanceTheme
