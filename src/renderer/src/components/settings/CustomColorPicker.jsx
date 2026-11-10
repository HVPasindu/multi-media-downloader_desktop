import { useState, useRef, useEffect, useCallback } from 'react'
import { AlertCircle, Pipette, Sparkles } from 'lucide-react'
import {
  isValidHex,
  hexToRgb,
  rgbToHex,
  rgbToHsv,
  hsvToRgb,
  hsvToHex,
  generateCustomPalette,
  isLightColor,
  adjustHueWithBlackRecovery
} from '../../utils/appearanceTheme'

/**
 * Application-Controlled Custom Cyberpunk Colour Picker
 *
 * Implements:
 * 1. 2D Saturation / Value selection surface with draggable thumb
 * 2. 0-360° Hue slider with Black-Colour-Bug automatic restoration (Example 3)
 * 3. Live synchronized HEX input with inline validation (Example 4)
 * 4. Numeric RGB inputs (0-255) synchronized bidirectionally (Example 2)
 * 5. Reusable across Accent and Background custom selections with isolated IDs & states
 * 6. Optional live colour swatch & 3-color harmonious cyberpunk palette preview
 */
export default function CustomColorPicker({
  initialColor = '#18C9F5',
  onColorChange,
  idPrefix = 'color',
  selectionLabel = 'Active Selection',
  showPalettePreview = true,
  className = ''
}) {
  // Normalize initial color
  const safeInitial = isValidHex(initialColor) ? initialColor.toUpperCase() : '#18C9F5'
  const initialHsv = rgbToHsv(...Object.values(hexToRgb(safeInitial) || { r: 24, g: 201, b: 245 }))

  // Synchronized color state
  const [hsv, setHsv] = useState(initialHsv)
  const [hexInput, setHexInput] = useState(safeInitial)
  const [hexError, setHexError] = useState(null)
  const [rgbState, setRgbState] = useState(() => hexToRgb(safeInitial) || { r: 24, g: 201, b: 245 })

  const hsvRef = useRef(initialHsv)
  const svAreaRef = useRef(null)
  const isDraggingSv = useRef(false)

  // Keep internal state updated if initialColor prop changes from outside (e.g. preset chosen)
  useEffect(() => {
    if (isValidHex(initialColor)) {
      const formatted = initialColor.toUpperCase()
      const rgb = hexToRgb(formatted)
      if (rgb) {
        const nextHsv = rgbToHsv(rgb.r, rgb.g, rgb.b)
        hsvRef.current = nextHsv
        setHexInput(formatted)
        setHexError(null)
        setRgbState(rgb)
        setHsv(nextHsv)
      }
    }
  }, [initialColor])

  // Current active color hex string
  const currentHex = hsvToHex(hsv.h, hsv.s, hsv.v)
  const currentPalette = showPalettePreview ? generateCustomPalette(currentHex) : null
  const isLight = isLightColor(currentHex)

  // Notify parent of valid color changes
  const emitColorChange = useCallback(
    (newHex) => {
      if (onColorChange && isValidHex(newHex)) {
        onColorChange(newHex)
      }
    },
    [onColorChange]
  )

  // --------------------------------------------------------------------------
  // 1. 2D Saturation / Value Dragging & Interaction
  // --------------------------------------------------------------------------
  const updateSvFromCoords = useCallback(
    (clientX, clientY) => {
      if (!svAreaRef.current) return
      const rect = svAreaRef.current.getBoundingClientRect()
      const x = Math.max(0, Math.min(rect.width, clientX - rect.left))
      const y = Math.max(0, Math.min(rect.height, clientY - rect.top))

      const s = Math.round((x / rect.width) * 100)
      const v = Math.round((1 - y / rect.height) * 100)

      const currentHsv = hsvRef.current
      const nextHsv = { ...currentHsv, s, v }
      const nextHex = hsvToHex(nextHsv.h, nextHsv.s, nextHsv.v)
      const nextRgb = hsvToRgb(nextHsv.h, nextHsv.s, nextHsv.v)

      hsvRef.current = nextHsv
      setHsv(nextHsv)
      setHexInput(nextHex)
      setHexError(null)
      setRgbState(nextRgb)
      emitColorChange(nextHex)
    },
    [emitColorChange]
  )

  const handleSvMouseDown = (e) => {
    isDraggingSv.current = true
    updateSvFromCoords(e.clientX, e.clientY)

    const handleMouseMove = (moveEvent) => {
      if (isDraggingSv.current) {
        updateSvFromCoords(moveEvent.clientX, moveEvent.clientY)
      }
    }

    const handleMouseUp = () => {
      isDraggingSv.current = false
      window.removeEventListener('mousemove', handleMouseMove)
      window.removeEventListener('mouseup', handleMouseUp)
    }

    window.addEventListener('mousemove', handleMouseMove)
    window.addEventListener('mouseup', handleMouseUp)
  }

  // --------------------------------------------------------------------------
  // 2. Hue Slider (with Black-Colour-Bug Fix: Example 3)
  // --------------------------------------------------------------------------
  const handleHueChange = (e) => {
    const newHue = Number.parseInt(e.target.value, 10)
    const currentHsv = hsvRef.current
    const recovered = adjustHueWithBlackRecovery(newHue, currentHsv.s, currentHsv.v)
    const nextHsv = { h: recovered.h, s: recovered.s, v: recovered.v }
    const nextHex = hsvToHex(nextHsv.h, nextHsv.s, nextHsv.v)
    const nextRgb = hsvToRgb(nextHsv.h, nextHsv.s, nextHsv.v)

    hsvRef.current = nextHsv
    setHsv(nextHsv)
    setHexInput(nextHex)
    setHexError(null)
    setRgbState(nextRgb)
    emitColorChange(nextHex)
  }

  // --------------------------------------------------------------------------
  // 3. Direct HEX Input (Example 1 & Example 4)
  // --------------------------------------------------------------------------
  const handleHexInputChange = (e) => {
    const rawVal = e.target.value.trim()
    setHexInput(rawVal)

    if (!rawVal) {
      setHexError('HEX code cannot be empty')
      return
    }

    const formatted = rawVal.startsWith('#') ? rawVal.toUpperCase() : `#${rawVal.toUpperCase()}`

    if (isValidHex(formatted)) {
      setHexError(null)
      const rgb = hexToRgb(formatted)
      if (rgb) {
        setRgbState(rgb)
        const nextHsv = rgbToHsv(rgb.r, rgb.g, rgb.b)
        hsvRef.current = nextHsv
        setHsv(nextHsv)
        emitColorChange(formatted)
      }
    } else {
      // Example 4: Show inline validation without breaking state or overwriting valid color
      setHexError('Enter a valid 6-digit HEX (e.g. #18C9F5)')
    }
  }

  // --------------------------------------------------------------------------
  // 4. Numeric RGB Inputs (Example 2)
  // --------------------------------------------------------------------------
  const handleRgbInputChange = (component, valueStr) => {
    const raw = Number.parseInt(valueStr, 10)
    const clamped = Number.isNaN(raw) ? 0 : Math.max(0, Math.min(255, raw))

    const nextRgb = {
      ...rgbState,
      [component]: clamped
    }
    setRgbState(nextRgb)

    const hex = rgbToHex(nextRgb.r, nextRgb.g, nextRgb.b)
    const nextHsv = rgbToHsv(nextRgb.r, nextRgb.g, nextRgb.b)

    hsvRef.current = nextHsv
    setHexInput(hex)
    setHexError(null)
    setHsv(nextHsv)
    emitColorChange(hex)
  }

  return (
    <div className={`flex flex-col gap-4 ${className}`}>
      {/* Upper Grid: 2D Saturation/Value Area + Hue Slider + Swatch */}
      <div className="grid grid-cols-1 md:grid-cols-12 gap-4 items-stretch">
        {/* Left Column (8 cols): 2D SV Pad + Hue Bar */}
        <div className="md:col-span-8 flex flex-col gap-3">
          {/* 2D Saturation / Value Surface */}
          <div
            ref={svAreaRef}
            onMouseDown={handleSvMouseDown}
            className="relative w-full h-36 rounded-xl cursor-crosshair select-none overflow-hidden border border-white/10 shadow-inner"
            style={{
              backgroundColor: `hsl(${hsv.h}, 100%, 50%)`
            }}
          >
            {/* Horizontal gradient: White to transparent */}
            <div
              className="absolute inset-0"
              style={{
                background: 'linear-gradient(to right, #FFFFFF 0%, transparent 100%)'
              }}
            />
            {/* Vertical gradient: Transparent to Black */}
            <div
              className="absolute inset-0"
              style={{
                background: 'linear-gradient(to bottom, transparent 0%, #000000 100%)'
              }}
            />

            {/* Draggable Selector Thumb */}
            <div
              className="absolute w-4 h-4 rounded-full border-2 border-white shadow-[0_0_6px_rgba(0,0,0,0.8)] pointer-events-none -translate-x-1/2 -translate-y-1/2 transition-transform duration-75"
              style={{
                left: `${hsv.s}%`,
                top: `${100 - hsv.v}%`,
                backgroundColor: currentHex
              }}
            />
          </div>

          {/* Hue Rainbow Range Slider */}
          <div className="flex flex-col gap-1">
            <div className="flex items-center justify-between text-[11px] text-text-muted font-medium">
              <span>Hue Slider (0° - 360°)</span>
              <span className="font-mono text-text font-bold">{hsv.h}°</span>
            </div>
            <div className="relative flex items-center h-5">
              <input
                type="range"
                min="0"
                max="360"
                value={hsv.h}
                onChange={handleHueChange}
                className="w-full h-3 rounded-full appearance-none cursor-pointer focus:outline-none"
                style={{
                  background:
                    'linear-gradient(to right, #ff0000 0%, #ffff00 17%, #00ff00 33%, #00ffff 50%, #0000ff 67%, #ff00ff 83%, #ff0000 100%)'
                }}
                aria-label={`${selectionLabel} Hue Slider`}
              />
            </div>
          </div>
        </div>

        {/* Right Column (4 cols): Live Colour Preview & Info */}
        <div className="md:col-span-4 flex flex-col justify-between gap-3 p-3.5 rounded-xl bg-background/80 border border-primary/20">
          <div>
            <span className="text-[11px] font-semibold text-text-muted block mb-1.5">
              {selectionLabel}
            </span>
            {/* Live Colour Swatch */}
            <div
              className="w-full h-20 rounded-xl border border-white/20 shadow-md flex flex-col items-center justify-center transition-all"
              style={{ backgroundColor: currentHex }}
            >
              <Pipette
                className={`w-5 h-5 ${isLight ? 'text-black/80' : 'text-white/90'} drop-shadow-sm`}
              />
              <span
                className={`text-xs font-mono font-bold mt-1 ${isLight ? 'text-black' : 'text-white'}`}
              >
                {currentHex}
              </span>
            </div>
          </div>

          <div className="text-[11px] text-text-muted flex items-center justify-between font-mono">
            <span>HSV: {hsv.h}°, {hsv.s}%, {hsv.v}%</span>
          </div>
        </div>
      </div>

      {/* Lower Row: Direct HEX Input + RGB Numeric Inputs */}
      <div className="grid grid-cols-1 sm:grid-cols-12 gap-3 items-end pt-1">
        {/* HEX Input (5 cols) */}
        <div className="sm:col-span-5 flex flex-col gap-1">
          <label htmlFor={`${idPrefix}-hex-field`} className="text-xs font-semibold text-text flex items-center gap-1.5">
            <span>HEX Code</span>
            <span className="text-[10px] text-text-muted font-normal">(e.g. #18C9F5)</span>
          </label>
          <div className="relative">
            <input
              id={`${idPrefix}-hex-field`}
              type="text"
              value={hexInput}
              onChange={handleHexInputChange}
              maxLength={7}
              placeholder="#18C9F5"
              className={`w-full bg-background border rounded-xl py-2 px-3 text-xs font-mono font-bold text-text uppercase placeholder:text-text-muted/40 focus:outline-none transition-all ${
                hexError
                  ? 'border-rose-500/80 focus:border-rose-500 focus:ring-1 focus:ring-rose-500'
                  : 'border-primary/25 focus:border-primary focus:ring-1 focus:ring-primary/40'
              }`}
            />
          </div>
          {hexError && (
            <span className="text-[11px] text-rose-400 flex items-center gap-1 animate-fadeIn">
              <AlertCircle className="w-3.5 h-3.5 flex-shrink-0" />
              <span>{hexError}</span>
            </span>
          )}
        </div>

        {/* RGB Numeric Inputs (7 cols: R, G, B) */}
        <div className="sm:col-span-7 grid grid-cols-3 gap-2">
          {/* R */}
          <div className="flex flex-col gap-1">
            <label htmlFor={`${idPrefix}-rgb-r`} className="text-xs font-semibold text-text">
              R <span className="text-[10px] text-text-muted">(Red)</span>
            </label>
            <input
              id={`${idPrefix}-rgb-r`}
              type="number"
              min="0"
              max="255"
              value={rgbState.r}
              onChange={(e) => handleRgbInputChange('r', e.target.value)}
              className="w-full bg-background border border-primary/25 rounded-xl py-2 px-2.5 text-xs font-mono font-bold text-text text-center focus:outline-none focus:border-primary"
            />
          </div>

          {/* G */}
          <div className="flex flex-col gap-1">
            <label htmlFor={`${idPrefix}-rgb-g`} className="text-xs font-semibold text-text">
              G <span className="text-[10px] text-text-muted">(Green)</span>
            </label>
            <input
              id={`${idPrefix}-rgb-g`}
              type="number"
              min="0"
              max="255"
              value={rgbState.g}
              onChange={(e) => handleRgbInputChange('g', e.target.value)}
              className="w-full bg-background border border-primary/25 rounded-xl py-2 px-2.5 text-xs font-mono font-bold text-text text-center focus:outline-none focus:border-primary"
            />
          </div>

          {/* B */}
          <div className="flex flex-col gap-1">
            <label htmlFor={`${idPrefix}-rgb-b`} className="text-xs font-semibold text-text">
              B <span className="text-[10px] text-text-muted">(Blue)</span>
            </label>
            <input
              id={`${idPrefix}-rgb-b`}
              type="number"
              min="0"
              max="255"
              value={rgbState.b}
              onChange={(e) => handleRgbInputChange('b', e.target.value)}
              className="w-full bg-background border border-primary/25 rounded-xl py-2 px-2.5 text-xs font-mono font-bold text-text text-center focus:outline-none focus:border-primary"
            />
          </div>
        </div>
      </div>

      {/* Harmonious 3-Colour Palette Preview (Only shown when showPalettePreview is true) */}
      {showPalettePreview && currentPalette && (
        <div className="p-3 rounded-xl bg-background/80 border border-primary/20 flex flex-col sm:flex-row sm:items-center justify-between gap-3 mt-1">
          <div className="flex items-center gap-2">
            <Sparkles className="w-4 h-4 text-primary flex-shrink-0" />
            <span className="text-xs font-semibold text-text">
              Generated Harmonious Accent Palette:
            </span>
          </div>

          <div className="flex items-center gap-2.5">
            {/* Primary */}
            <div className="flex items-center gap-1.5">
              <span
                className="w-4 h-4 rounded-full shadow-sm"
                style={{ backgroundColor: currentPalette.primary }}
              />
              <span className="text-[11px] font-mono font-bold text-text">
                {currentPalette.primary}
              </span>
              <span className="text-[10px] text-text-muted">(Primary)</span>
            </div>

            {/* Secondary */}
            <div className="flex items-center gap-1.5">
              <span
                className="w-4 h-4 rounded-full shadow-sm"
                style={{ backgroundColor: currentPalette.secondary }}
              />
              <span className="text-[11px] font-mono font-bold text-text">
                {currentPalette.secondary}
              </span>
              <span className="text-[10px] text-text-muted">(Supporting)</span>
            </div>

            {/* Tertiary */}
            <div className="flex items-center gap-1.5">
              <span
                className="w-4 h-4 rounded-full shadow-sm"
                style={{ backgroundColor: currentPalette.tertiary }}
              />
              <span className="text-[11px] font-mono font-bold text-text">
                {currentPalette.tertiary}
              </span>
              <span className="text-[10px] text-text-muted">(Glow)</span>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
