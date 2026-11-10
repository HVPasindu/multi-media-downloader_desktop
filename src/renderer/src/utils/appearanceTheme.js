import { useSyncExternalStore } from 'react'

/**
 * Appearance Theme System for APPLAN2 Desktop Application
 *
 * Implements:
 * 1. Dynamic global 3-color Cyberpunk accent theme (Primary, Secondary, Tertiary)
 * 2. Complete Global Background Theme System:
 *    - Three main modes: Dark, Light, Custom
 *    - Eight Cyberpunk Background Presets
 *    - Automatic Background and Accent Matching with Manual Override preservation
 * 3. Bidirectional HSV/RGB/HEX conversions and contrast calculations
 * 4. Backward-compatible LocalStorage persistence and anti-flicker bootstrap
 */

export const APPEARANCE_STORAGE_KEY = 'applan2.appearance.theme'

// ============================================================================
// 1. APPROVED ACCENT THEME PRESETS (6 Presets)
// ============================================================================
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

// ============================================================================
// 2. APPROVED BACKGROUND CYBERPUNK PRESETS (8 Presets)
// ============================================================================
export const BACKGROUND_PRESETS = Object.freeze([
  {
    id: 'midnight-navy',
    name: 'Midnight Navy',
    hex: '#040B1C',
    isDark: true,
    matchedAccentId: 'ocean-blue'
  },
  {
    id: 'carbon-black',
    name: 'Carbon Black',
    hex: '#101318',
    isDark: true,
    matchedAccentId: 'golden'
  },
  {
    id: 'deep-space',
    name: 'Deep Space',
    hex: '#17102B',
    isDark: true,
    matchedAccentId: 'purple-neon'
  },
  {
    id: 'cyber-teal',
    name: 'Cyber Teal',
    hex: '#082B2B',
    isDark: true,
    matchedAccentId: 'emerald'
  },
  {
    id: 'arctic-white',
    name: 'Arctic White',
    hex: '#F7FAFC',
    isDark: false,
    matchedAccentId: 'ocean-blue'
  },
  {
    id: 'pearl-mist',
    name: 'Pearl Mist',
    hex: '#EEF2F7',
    isDark: false,
    matchedAccentId: 'emerald'
  },
  {
    id: 'rose-dusk',
    name: 'Rose Dusk',
    hex: '#2A1427',
    isDark: true,
    matchedAccentId: 'rose'
  },
  {
    id: 'aurora-slate',
    name: 'Aurora Slate',
    hex: '#142536',
    isDark: true,
    matchedAccentId: 'ocean-blue'
  }
])

export const DEFAULT_BACKGROUND_ID = 'midnight-navy'
export const DEFAULT_BACKGROUND_PRESET = BACKGROUND_PRESETS[0]

// ============================================================================
// 3. COLOR CONVERSION & VALIDATION HELPERS
// ============================================================================

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
  return { h: Math.round(h), s: Math.round(s * 100), l: Math.round(l * 100) }
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
    r: Math.round((r + m) * 255),
    g: Math.round((g + m) * 255),
    b: Math.round((b + m) * 255)
  }
}

/**
 * Converts RGB components to HSV.
 */
export function rgbToHsv(r, g, b) {
  r = Math.max(0, Math.min(255, r)) / 255
  g = Math.max(0, Math.min(255, g)) / 255
  b = Math.max(0, Math.min(255, b)) / 255

  const max = Math.max(r, g, b)
  const min = Math.min(r, g, b)
  const d = max - min
  let h = 0
  const s = max === 0 ? 0 : (d / max) * 100
  const v = max * 100

  if (max !== min) {
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

  return {
    h: Math.round(h),
    s: Math.round(s),
    v: Math.round(v)
  }
}

/**
 * Converts HSV components to RGB.
 */
export function hsvToRgb(h, s, v) {
  h = ((h % 360) + 360) % 360
  s = Math.max(0, Math.min(100, s)) / 100
  v = Math.max(0, Math.min(100, v)) / 100

  const c = v * s
  const x = c * (1 - Math.abs(((h / 60) % 2) - 1))
  const m = v - c

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
    r: Math.round((r + m) * 255),
    g: Math.round((g + m) * 255),
    b: Math.round((b + m) * 255)
  }
}

/**
 * Converts HSV components to HEX.
 */
export function hsvToHex(h, s, v) {
  const { r, g, b } = hsvToRgb(h, s, v)
  return rgbToHex(r, g, b)
}

/**
 * Converts HEX to HSV.
 */
export function hexToHsv(hex) {
  const rgb = hexToRgb(hex)
  if (!rgb) return { h: 0, s: 0, v: 0 }
  return rgbToHsv(rgb.r, rgb.g, rgb.b)
}

/**
 * Adjusts hue while recovering from pure black or near-black (V < 15 or S < 10)
 * by restoring vibrant defaults (S = 85, V = 95).
 */
export function adjustHueWithBlackRecovery(newHue, currentS, currentV) {
  let s = currentS
  let v = currentV
  if (v < 15 || s < 10) {
    s = 85
    v = 95
  }
  return { h: newHue, s, v }
}

/**
 * Computes standard WCAG relative luminance from RGB components.
 */
export function getLuminance(r, g, b) {
  const a = [r, g, b].map((v) => {
    v /= 255
    return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4)
  })
  return a[0] * 0.2126 + a[1] * 0.7152 + a[2] * 0.0722
}

/**
 * Calculates WCAG 2.1 contrast ratio between two colors (hex string or { r, g, b } object).
 * Formula: (L1 + 0.05) / (L2 + 0.05) where L1 >= L2.
 */
export function getContrastRatio(colorA, colorB) {
  const rgbA = typeof colorA === 'string' ? hexToRgb(colorA) : colorA
  const rgbB = typeof colorB === 'string' ? hexToRgb(colorB) : colorB
  if (!rgbA || !rgbB) return 1

  const lumA = getLuminance(rgbA.r, rgbA.g, rgbA.b)
  const lumB = getLuminance(rgbB.r, rgbB.g, rgbB.b)

  const lighter = Math.max(lumA, lumB)
  const darker = Math.min(lumA, lumB)

  return (lighter + 0.05) / (darker + 0.05)
}

/**
 * Returns the higher-contrast text color ('#000000' or '#FFFFFF') for a given background hex.
 * Target WCAG AA: 4.5:1 for normal text, 3:1 for large text.
 */
export function getReadableTextColor(backgroundHex, darkColor = '#000000', lightColor = '#FFFFFF') {
  if (!isValidHex(backgroundHex)) return lightColor

  const blackContrast = getContrastRatio(backgroundHex, darkColor)
  const whiteContrast = getContrastRatio(backgroundHex, lightColor)

  return blackContrast >= whiteContrast ? darkColor : lightColor
}

/**
 * Returns the text color ('#000000' or '#FFFFFF') that provides the highest worst-case (minimum)
 * contrast ratio across an array of gradient stop colors.
 */
export function getGradientReadableTextColor(colors = [], darkColor = '#000000', lightColor = '#FFFFFF') {
  if (!Array.isArray(colors) || colors.length === 0) return lightColor

  let minDarkContrast = Infinity
  let minLightContrast = Infinity

  for (const color of colors) {
    if (!isValidHex(color)) continue
    const dc = getContrastRatio(color, darkColor)
    const lc = getContrastRatio(color, lightColor)
    if (dc < minDarkContrast) minDarkContrast = dc
    if (lc < minLightContrast) minLightContrast = lc
  }

  return minDarkContrast >= minLightContrast ? darkColor : lightColor
}

/**
 * Determines whether a color is perceptually light based on WCAG contrast ratio.
 */
export function isLightColor(hex) {
  if (!isValidHex(hex)) return false
  return getReadableTextColor(hex) === '#000000'
}

// ============================================================================
// 4. PALETTE GENERATION: ACCENT & BACKGROUND
// ============================================================================

/**
 * Generates two harmonious supporting neon cyberpunk colors (Secondary & Tertiary)
 * from a single user-chosen primary hex with good contrast against dark navy backgrounds.
 */
export function generateCustomPalette(primaryHex) {
  if (!isValidHex(primaryHex)) return null

  const rgb = hexToRgb(primaryHex)
  if (!rgb) return null

  const hsl = rgbToHsl(rgb.r, rgb.g, rgb.b)

  // Ensure vibrant cyberpunk saturation and visible contrast against dark backgrounds
  const vibrantSaturation = Math.max(70, Math.min(100, hsl.s))
  const balancedLightness = Math.max(48, Math.min(65, hsl.l))

  // Secondary: Analogous shift (+30 deg) for smooth gradient transition
  const secH = (hsl.h + 30) % 360
  const secS = Math.max(65, Math.round(vibrantSaturation * 0.95))
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
 * Generates a contrasting, harmonious 3-color accent palette matched to a custom background hex.
 */
export function generateContrastingAccent(bgHex) {
  if (!isValidHex(bgHex)) return DEFAULT_THEME

  const isLight = isLightColor(bgHex)
  const rgb = hexToRgb(bgHex)
  const hsl = rgb ? rgbToHsl(rgb.r, rgb.g, rgb.b) : { h: 210, s: 50, l: 10 }

  // Pick complementary or triadic hue with high saturation
  const accentH = (hsl.h + 160) % 360
  const accentS = Math.max(80, Math.min(100, hsl.s + 30))
  // If light background, ensure accent is sufficiently dark; if dark background, ensure bright
  const accentL = isLight ? 45 : 58

  const accentRgb = hslToRgb(accentH, accentS, accentL)
  const primaryHex = rgbToHex(accentRgb.r, accentRgb.g, accentRgb.b)

  return generateCustomPalette(primaryHex) || DEFAULT_THEME
}

/**
 * Derives the complete semantic background palette (background, header, sidebar, surface, text, border).
 */
export function deriveBackgroundPalette(bgMode, bgPresetId, customBgHex) {
  // Mode: 'dark'
  if (bgMode === 'dark') {
    const preset = BACKGROUND_PRESETS.find((p) => p.id === bgPresetId && p.isDark) || DEFAULT_BACKGROUND_PRESET

    if (preset.id === 'midnight-navy') {
      return {
        mode: 'dark',
        presetId: 'midnight-navy',
        isDark: true,
        background: '#040B1C',
        header: '#061226',
        sidebar: '#07152E',
        surface: '#07152E',
        surfaceElevated: '#0B1C38',
        surfaceDeep: '#102449',
        inputBackground: '#040B1C',
        text: '#F4F8FF',
        textMuted: '#9DB4D8',
        border: 'rgba(var(--theme-primary-rgb), 0.18)',
        hover: 'rgba(var(--theme-primary-rgb), 0.08)',
        colorScheme: 'dark'
      }
    }

    // Other dark presets (Carbon Black, Deep Space, Cyber Teal, Rose Dusk, Aurora Slate)
    const rgb = hexToRgb(preset.hex) || { r: 16, g: 19, b: 24 }
    const hsl = rgbToHsl(rgb.r, rgb.g, rgb.b)

    const bgHex = preset.hex
    const headerHex = rgbToHex(
      ...Object.values(hslToRgb(hsl.h, hsl.s, Math.max(4, hsl.l - 2)))
    )
    const surfaceHex = rgbToHex(
      ...Object.values(hslToRgb(hsl.h, hsl.s, Math.min(22, hsl.l + 4)))
    )
    const elevatedHex = rgbToHex(
      ...Object.values(hslToRgb(hsl.h, hsl.s, Math.min(28, hsl.l + 9)))
    )
    const deepHex = rgbToHex(
      ...Object.values(hslToRgb(hsl.h, hsl.s, Math.min(35, hsl.l + 15)))
    )

    return {
      mode: 'dark',
      presetId: preset.id,
      isDark: true,
      background: bgHex,
      header: headerHex,
      sidebar: surfaceHex,
      surface: surfaceHex,
      surfaceElevated: elevatedHex,
      surfaceDeep: deepHex,
      inputBackground: bgHex,
      text: '#F4F8FF',
      textMuted: '#9DB4D8',
      border: 'rgba(var(--theme-primary-rgb), 0.18)',
      hover: 'rgba(var(--theme-primary-rgb), 0.08)',
      colorScheme: 'dark'
    }
  }

  // Mode: 'light'
  if (bgMode === 'light') {
    const preset = BACKGROUND_PRESETS.find((p) => p.id === bgPresetId && !p.isDark) || BACKGROUND_PRESETS.find((p) => p.id === 'arctic-white')
    const bgHex = preset ? preset.hex : '#F7FAFC'

    return {
      mode: 'light',
      presetId: preset ? preset.id : 'arctic-white',
      isDark: false,
      background: bgHex,
      header: '#FFFFFF',
      sidebar: '#FFFFFF',
      surface: '#FFFFFF',
      surfaceElevated: '#F1F5F9',
      surfaceDeep: '#E2E8F0',
      inputBackground: '#F8FAFC',
      text: '#172033',
      textMuted: '#526179',
      border: '#D9E2EF',
      hover: 'rgba(var(--theme-primary-rgb), 0.08)',
      colorScheme: 'light'
    }
  }

  // Mode: 'custom'
  const customHex = isValidHex(customBgHex) ? customBgHex.toUpperCase() : '#182536'
  const isLight = isLightColor(customHex)
  const rgb = hexToRgb(customHex) || { r: 24, g: 37, b: 54 }
  const hsl = rgbToHsl(rgb.r, rgb.g, rgb.b)

  if (isLight) {
    const elevatedHex = rgbToHex(
      ...Object.values(hslToRgb(hsl.h, hsl.s, Math.max(88, hsl.l - 4)))
    )
    const deepHex = rgbToHex(
      ...Object.values(hslToRgb(hsl.h, hsl.s, Math.max(80, hsl.l - 9)))
    )

    return {
      mode: 'custom',
      customHex,
      isDark: false,
      background: customHex,
      header: '#FFFFFF',
      sidebar: '#FFFFFF',
      surface: '#FFFFFF',
      surfaceElevated: elevatedHex,
      surfaceDeep: deepHex,
      inputBackground: '#F8FAFC',
      text: '#172033',
      textMuted: '#526179',
      border: '#D9E2EF',
      hover: 'rgba(var(--theme-primary-rgb), 0.08)',
      colorScheme: 'light'
    }
  }

  // Custom Dark
  const headerHex = rgbToHex(
    ...Object.values(hslToRgb(hsl.h, hsl.s, Math.max(3, hsl.l - 2)))
  )
  const surfaceHex = rgbToHex(
    ...Object.values(hslToRgb(hsl.h, hsl.s, Math.min(25, hsl.l + 4)))
  )
  const elevatedHex = rgbToHex(
    ...Object.values(hslToRgb(hsl.h, hsl.s, Math.min(32, hsl.l + 9)))
  )
  const deepHex = rgbToHex(
    ...Object.values(hslToRgb(hsl.h, hsl.s, Math.min(40, hsl.l + 15)))
  )

  return {
    mode: 'custom',
    customHex,
    isDark: true,
    background: customHex,
    header: headerHex,
    sidebar: surfaceHex,
    surface: surfaceHex,
    surfaceElevated: elevatedHex,
    surfaceDeep: deepHex,
    inputBackground: customHex,
    text: '#F4F8FF',
    textMuted: '#9DB4D8',
    border: 'rgba(var(--theme-primary-rgb), 0.2)',
    hover: 'rgba(var(--theme-primary-rgb), 0.08)',
    colorScheme: 'dark'
  }
}

// ============================================================================
// 5. DOM CSS VARIABLE APPLICATION
// ============================================================================

/**
 * Applies dynamic CSS variables for both Accent and Background systems to document.documentElement.
 */
export function applyThemeVariables(themeState) {
  if (typeof document === 'undefined') return
  if (!themeState) return

  const root = document.documentElement

  // 1. Accent Theme Variables
  const primary = themeState.primary || DEFAULT_THEME.primary
  const secondary = themeState.secondary || DEFAULT_THEME.secondary
  const tertiary = themeState.tertiary || DEFAULT_THEME.tertiary

  root.style.setProperty('--theme-primary', primary)
  root.style.setProperty('--theme-secondary-accent', secondary)
  root.style.setProperty('--theme-tertiary', tertiary)

  // Aliases for standard Tailwind tokens
  root.style.setProperty('--color-primary', primary)
  root.style.setProperty('--color-accent', tertiary)

  const primRgb = hexToRgb(primary)
  const secRgb = hexToRgb(secondary)
  const tertRgb = hexToRgb(tertiary)

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

  // Contrast-calculated readable foreground colors (WCAG AA)
  const onPrimary = getReadableTextColor(primary)
  const onGradient = getGradientReadableTextColor([primary, secondary, tertiary])
  const onDanger = getReadableTextColor('#FF4568')

  root.style.setProperty('--theme-on-primary', onPrimary)
  root.style.setProperty('--theme-on-gradient', onGradient)
  root.style.setProperty('--app-on-danger', onDanger)

  // 2. Background Theme Semantic Variables
  const bg = themeState.background || { mode: 'dark', presetId: 'midnight-navy' }
  const bgPalette =
    themeState.bgPalette ||
    deriveBackgroundPalette(bg.mode, bg.presetId, bg.customHex)

  root.style.setProperty('--app-background', bgPalette.background)
  root.style.setProperty('--app-header', bgPalette.header)
  root.style.setProperty('--app-sidebar', bgPalette.sidebar)
  root.style.setProperty('--app-surface', bgPalette.surface)
  root.style.setProperty('--app-surface-elevated', bgPalette.surfaceElevated)
  root.style.setProperty('--app-surface-deep', bgPalette.surfaceDeep)
  root.style.setProperty('--app-input-background', bgPalette.inputBackground)
  root.style.setProperty('--app-text', bgPalette.text)
  root.style.setProperty('--app-text-muted', bgPalette.textMuted)
  root.style.setProperty('--app-border', bgPalette.border)
  root.style.setProperty('--app-hover', bgPalette.hover)
  root.style.setProperty('--app-color-scheme', bgPalette.colorScheme)

  // Map to Tailwind tokens
  root.style.setProperty('--color-background', bgPalette.background)
  root.style.setProperty('--color-surface', bgPalette.surface)
  root.style.setProperty('--color-surface-elevated', bgPalette.surfaceElevated)
  root.style.setProperty('--color-secondary', bgPalette.surface) // Preserves legacy card surface compatibility
  root.style.setProperty('--color-text', bgPalette.text)
  root.style.setProperty('--color-text-muted', bgPalette.textMuted)

  // Background RGB components for alpha blending
  const bgRgb = hexToRgb(bgPalette.background)
  if (bgRgb) {
    root.style.setProperty('--app-background-rgb', `${bgRgb.r}, ${bgRgb.g}, ${bgRgb.b}`)
  }
  const surfRgb = hexToRgb(bgPalette.surface)
  if (surfRgb) {
    root.style.setProperty('--app-surface-rgb', `${surfRgb.r}, ${surfRgb.g}, ${surfRgb.b}`)
  }
}

// ============================================================================
// 6. PERSISTENCE & THEME INITIALIZATION
// ============================================================================

/**
 * Loads the saved theme from localStorage, safely migrating legacy formats and falling back to default.
 */
export function loadSavedTheme() {
  const fallbackBackground = {
    mode: 'dark',
    presetId: 'midnight-navy',
    customHex: null
  }

  const fallbackAccent = {
    ...DEFAULT_THEME,
    mode: 'preset',
    presetId: DEFAULT_THEME_ID,
    customHex: null
  }

  if (typeof window === 'undefined' || !window.localStorage) {
    const bgPalette = deriveBackgroundPalette('dark', 'midnight-navy')
    return {
      ...fallbackAccent,
      background: fallbackBackground,
      bgPalette
    }
  }

  try {
    const raw = localStorage.getItem(APPEARANCE_STORAGE_KEY)
    if (!raw) {
      const bgPalette = deriveBackgroundPalette('dark', 'midnight-navy')
      return {
        ...fallbackAccent,
        background: fallbackBackground,
        bgPalette
      }
    }

    const parsed = JSON.parse(raw)

    // 1. Resolve Accent Theme
    let accent = { ...fallbackAccent }
    if (parsed.mode === 'preset') {
      const found = THEME_PRESETS.find((p) => p.id === parsed.presetId)
      if (found) {
        accent = { ...found, mode: 'preset', presetId: found.id, customHex: null }
      }
    } else if (parsed.mode === 'custom' && isValidHex(parsed.customHex)) {
      const palette = generateCustomPalette(parsed.customHex)
      if (palette) {
        accent = {
          ...palette,
          mode: 'custom',
          customHex: parsed.customHex.toUpperCase(),
          presetId: null
        }
      }
    }

    // 2. Resolve Background Theme (Strict Validation & Backward-Compatible Migration)
    let background = { ...fallbackBackground }
    if (parsed && typeof parsed.background === 'object' && parsed.background !== null) {
      const rawMode = parsed.background.mode
      const rawPresetId = parsed.background.presetId
      const rawCustomHex = parsed.background.customHex

      if (rawMode === 'dark') {
        const found = BACKGROUND_PRESETS.find((p) => p.id === rawPresetId && p.isDark)
        background = {
          mode: 'dark',
          presetId: found ? found.id : 'midnight-navy',
          customHex: null
        }
      } else if (rawMode === 'light') {
        const found = BACKGROUND_PRESETS.find((p) => p.id === rawPresetId && !p.isDark)
        background = {
          mode: 'light',
          presetId: found ? found.id : 'arctic-white',
          customHex: null
        }
      } else if (rawMode === 'custom') {
        if (isValidHex(rawCustomHex)) {
          background = {
            mode: 'custom',
            presetId: null,
            customHex: rawCustomHex.toUpperCase()
          }
        } else {
          // Custom mode requires a valid 6-digit hex; fallback safely to default background
          background = { ...fallbackBackground }
        }
      } else {
        // Unknown or invalid mode fallback to default dark background
        background = { ...fallbackBackground }
      }
    }

    const bgPalette = deriveBackgroundPalette(
      background.mode,
      background.presetId,
      background.customHex
    )

    return {
      ...accent,
      background,
      bgPalette
    }
  } catch (err) {
    console.warn('Failed to parse appearance theme from localStorage:', err)
  }

  const bgPalette = deriveBackgroundPalette('dark', 'midnight-navy')
  return {
    ...fallbackAccent,
    background: fallbackBackground,
    bgPalette
  }
}

/**
 * Persists the combined theme configuration to localStorage.
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

// ============================================================================
// 7. MUTATION METHODS (ACCENT & BACKGROUND)
// ============================================================================

/**
 * Switches the active accent theme to an approved preset (manual accent override).
 */
export function setPresetTheme(presetId) {
  const preset = THEME_PRESETS.find((p) => p.id === presetId) || DEFAULT_THEME
  currentThemeState = {
    ...currentThemeState,
    ...preset,
    mode: 'preset',
    presetId: preset.id,
    customHex: null
  }
  applyThemeVariables(currentThemeState)
  saveTheme({
    mode: 'preset',
    presetId: preset.id,
    customHex: null,
    background: currentThemeState.background
  })
  notifyListeners()
  return currentThemeState
}

/**
 * Switches the active accent theme to a validated custom HEX color (manual accent override).
 */
export function setCustomTheme(customHex) {
  if (!isValidHex(customHex)) return null

  const palette = generateCustomPalette(customHex)
  if (!palette) return null

  currentThemeState = {
    ...currentThemeState,
    ...palette,
    mode: 'custom',
    presetId: null,
    customHex: customHex.toUpperCase()
  }
  applyThemeVariables(currentThemeState)
  saveTheme({
    mode: 'custom',
    customHex: customHex.toUpperCase(),
    primary: palette.primary,
    secondary: palette.secondary,
    tertiary: palette.tertiary,
    background: currentThemeState.background
  })
  notifyListeners()
  return currentThemeState
}

/**
 * Resets the accent theme to default Ocean Blue (keeps current background).
 */
export function resetAppearanceTheme() {
  return setPresetTheme(DEFAULT_THEME_ID)
}

/**
 * Sets the background mode ('dark' | 'light' | 'custom') with automatic accent matching.
 */
export function setBackgroundMode(mode) {
  if (mode !== 'dark' && mode !== 'light' && mode !== 'custom') return currentThemeState

  let defaultPresetId = null
  let matchedAccent = DEFAULT_THEME

  if (mode === 'dark') {
    defaultPresetId = 'midnight-navy'
    matchedAccent = THEME_PRESETS.find((p) => p.id === 'ocean-blue') || DEFAULT_THEME
  } else if (mode === 'light') {
    defaultPresetId = 'arctic-white'
    matchedAccent = THEME_PRESETS.find((p) => p.id === 'ocean-blue') || DEFAULT_THEME
  } else if (mode === 'custom') {
    const customHex = currentThemeState.background?.customHex || '#182536'
    matchedAccent = generateContrastingAccent(customHex)
  }

  const bgPalette = deriveBackgroundPalette(
    mode,
    defaultPresetId,
    currentThemeState.background?.customHex
  )

  const newBackground = {
    mode,
    presetId: defaultPresetId,
    customHex: mode === 'custom' ? currentThemeState.background?.customHex || '#182536' : null
  }

  currentThemeState = {
    ...currentThemeState,
    ...matchedAccent,
    mode: matchedAccent.isCustom ? 'custom' : 'preset',
    presetId: matchedAccent.isCustom ? null : matchedAccent.id,
    customHex: matchedAccent.isCustom ? matchedAccent.primary : null,
    background: newBackground,
    bgPalette
  }

  applyThemeVariables(currentThemeState)
  saveTheme({
    mode: currentThemeState.mode,
    presetId: currentThemeState.presetId,
    customHex: currentThemeState.customHex,
    background: newBackground
  })
  notifyListeners()
  return currentThemeState
}

/**
 * Selects one of the eight Background Cyberpunk Presets with automatic accent matching.
 */
export function setBackgroundPreset(presetId) {
  const preset = BACKGROUND_PRESETS.find((p) => p.id === presetId) || DEFAULT_BACKGROUND_PRESET
  const bgMode = preset.isDark ? 'dark' : 'light'

  // Automatic matched accent
  const matchedAccent = THEME_PRESETS.find((p) => p.id === preset.matchedAccentId) || DEFAULT_THEME

  const bgPalette = deriveBackgroundPalette(bgMode, preset.id, null)

  const newBackground = {
    mode: bgMode,
    presetId: preset.id,
    customHex: null
  }

  currentThemeState = {
    ...currentThemeState,
    ...matchedAccent,
    mode: 'preset',
    presetId: matchedAccent.id,
    customHex: null,
    background: newBackground,
    bgPalette
  }

  applyThemeVariables(currentThemeState)
  saveTheme({
    mode: 'preset',
    presetId: matchedAccent.id,
    customHex: null,
    background: newBackground
  })
  notifyListeners()
  return currentThemeState
}

/**
 * Sets a custom background HEX with contrast-safe palette and automatic harmonious accent matching.
 */
export function setCustomBackgroundHex(customHex) {
  if (!isValidHex(customHex)) return null

  const formatted = customHex.toUpperCase()
  const bgPalette = deriveBackgroundPalette('custom', null, formatted)
  const matchedAccent = generateContrastingAccent(formatted)

  const newBackground = {
    mode: 'custom',
    presetId: null,
    customHex: formatted
  }

  currentThemeState = {
    ...currentThemeState,
    ...matchedAccent,
    mode: matchedAccent.isCustom ? 'custom' : 'preset',
    presetId: matchedAccent.isCustom ? null : matchedAccent.id,
    customHex: matchedAccent.isCustom ? matchedAccent.primary : null,
    background: newBackground,
    bgPalette
  }

  applyThemeVariables(currentThemeState)
  saveTheme({
    mode: currentThemeState.mode,
    presetId: currentThemeState.presetId,
    customHex: currentThemeState.customHex,
    background: newBackground
  })
  notifyListeners()
  return currentThemeState
}

/**
 * Resets the background theme to Dark / Midnight Navy.
 */
export function resetBackgroundTheme() {
  return setBackgroundPreset('midnight-navy')
}

// ============================================================================
// 8. REACT HOOK
// ============================================================================

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
 * React Hook providing the active theme state, background state, and mutation methods.
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

    // Background system
    background: themeState.background || { mode: 'dark', presetId: 'midnight-navy', customHex: null },
    bgPalette: themeState.bgPalette || deriveBackgroundPalette('dark', 'midnight-navy'),
    isDarkBackground: themeState.bgPalette?.isDark ?? true,

    // Mutation actions
    setPreset: setPresetTheme,
    setCustomHex: setCustomTheme,
    resetToDefault: resetAppearanceTheme,

    setBackgroundMode,
    setBackgroundPreset,
    setCustomBackgroundHex,
    resetBackground: resetBackgroundTheme
  }
}

export default useAppearanceTheme
