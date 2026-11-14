import {
  isValidHex,
  hexToRgb,
  rgbToHex,
  rgbToHsv,
  hsvToRgb,
  hsvToHex,
  adjustHueWithBlackRecovery
} from './appearanceTheme.js'

/**
 * Pure state calculation helpers for CustomColorPicker.
 * Separates pure color math from React component lifecycle and state setters.
 */

/**
 * Computes updated HSV, HEX, and RGB given mouse coordinates and bounding rectangle.
 *
 * @param {{ h: number, s: number, v: number }} currentHsv
 * @param {number} clientX
 * @param {number} clientY
 * @param {{ left?: number, top?: number, width?: number, height?: number }} rect
 * @returns {{ hsv: { h: number, s: number, v: number }, hex: string, rgb: { r: number, g: number, b: number } }}
 */
export function calculateSvColor(currentHsv, clientX, clientY, rect = {}) {
  const width = rect && rect.width ? rect.width : 200
  const height = rect && rect.height ? rect.height : 200
  const left = rect && typeof rect.left === 'number' ? rect.left : 0
  const top = rect && typeof rect.top === 'number' ? rect.top : 0

  const x = Math.max(0, Math.min(width, clientX - left))
  const y = Math.max(0, Math.min(height, clientY - top))

  const s = Math.round((x / width) * 100)
  const v = Math.round((1 - y / height) * 100)

  const h = currentHsv && typeof currentHsv.h === 'number' ? currentHsv.h : 0
  const nextHsv = { h, s, v }
  const nextHex = hsvToHex(nextHsv.h, nextHsv.s, nextHsv.v)
  const nextRgb = hsvToRgb(nextHsv.h, nextHsv.s, nextHsv.v)

  return {
    hsv: nextHsv,
    hex: nextHex,
    rgb: nextRgb
  }
}

/**
 * Computes updated HSV, HEX, and RGB given a new hue value (0-360°),
 * applying Black-Colour-Bug automatic restoration if saturation/value are 0.
 *
 * @param {{ h: number, s: number, v: number }} currentHsv
 * @param {number|string} newHue
 * @returns {{ hsv: { h: number, s: number, v: number }, hex: string, rgb: { r: number, g: number, b: number } }}
 */
export function calculateHueColor(currentHsv, newHue) {
  const rawH = Number.parseInt(newHue, 10)
  const h = Number.isNaN(rawH) ? 0 : Math.max(0, Math.min(360, rawH))
  const s = currentHsv && typeof currentHsv.s === 'number' ? currentHsv.s : 0
  const v = currentHsv && typeof currentHsv.v === 'number' ? currentHsv.v : 0

  const recovered = adjustHueWithBlackRecovery(h, s, v)
  const nextHsv = { h: recovered.h, s: recovered.s, v: recovered.v }
  const nextHex = hsvToHex(nextHsv.h, nextHsv.s, nextHsv.v)
  const nextRgb = hsvToRgb(nextHsv.h, nextHsv.s, nextHsv.v)

  return {
    hsv: nextHsv,
    hex: nextHex,
    rgb: nextRgb
  }
}

/**
 * Validates and synchronizes HEX input string with RGB and HSV states.
 * If invalid, returns error and preserves last valid state without crashing.
 *
 * @param {string} rawVal
 * @param {{ hex?: string, rgb?: { r: number, g: number, b: number }, hsv?: { h: number, s: number, v: number } }} [lastValidState={}]
 * @returns {{ isValid: boolean, error: string|null, hex: string, rgb: { r: number, g: number, b: number }, hsv: { h: number, s: number, v: number } }}
 */
export function calculateHexColor(rawVal, lastValidState = {}) {
  const fallbackHex = lastValidState.hex || '#18C9F5'
  const fallbackRgb = lastValidState.rgb || { r: 24, g: 201, b: 245 }
  const fallbackHsv = lastValidState.hsv || { h: 192, s: 90, v: 96 }

  const trimmed = typeof rawVal === 'string' ? rawVal.trim() : ''
  if (!trimmed) {
    return {
      isValid: false,
      error: 'HEX code cannot be empty',
      hex: fallbackHex,
      rgb: fallbackRgb,
      hsv: fallbackHsv
    }
  }

  const formatted = trimmed.startsWith('#') ? trimmed.toUpperCase() : `#${trimmed.toUpperCase()}`

  if (isValidHex(formatted)) {
    const rgb = hexToRgb(formatted)
    const hsv = rgbToHsv(rgb.r, rgb.g, rgb.b)
    return {
      isValid: true,
      error: null,
      hex: formatted,
      rgb,
      hsv
    }
  }

  return {
    isValid: false,
    error: 'Enter a valid 6-digit HEX (e.g. #18C9F5)',
    hex: fallbackHex,
    rgb: fallbackRgb,
    hsv: fallbackHsv
  }
}

/**
 * Synchronizes numeric RGB component changes (0-255) to RGB, HEX, and HSV states.
 *
 * @param {{ r: number, g: number, b: number }} currentRgb
 * @param {{ h: number, s: number, v: number }} currentHsv
 * @param {'r'|'g'|'b'} component
 * @param {number|string} valueStr
 * @returns {{ rgb: { r: number, g: number, b: number }, hex: string, hsv: { h: number, s: number, v: number } }}
 */
export function calculateRgbColor(currentRgb, currentHsv, component, valueStr) {
  const raw = Number.parseInt(valueStr, 10)
  const clamped = Number.isNaN(raw) ? 0 : Math.max(0, Math.min(255, raw))

  const safeRgb = currentRgb || { r: 0, g: 0, b: 0 }
  const nextRgb = {
    ...safeRgb,
    [component]: clamped
  }

  const hex = rgbToHex(nextRgb.r, nextRgb.g, nextRgb.b)
  const nextHsv = rgbToHsv(nextRgb.r, nextRgb.g, nextRgb.b)

  // When saturation is 0 (pure grayscale), keep current hue so slider doesn't snap to 0
  if (nextHsv.s === 0 && currentHsv && typeof currentHsv.h === 'number') {
    nextHsv.h = currentHsv.h
  }

  return {
    rgb: nextRgb,
    hex,
    hsv: nextHsv
  }
}
