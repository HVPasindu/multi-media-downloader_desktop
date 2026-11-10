import { useState } from 'react'
import {
  Palette,
  Pipette,
  Check,
  RotateCcw,
  Sparkles,
  AlertCircle,
  Eye,
  Sliders,
  Download
} from 'lucide-react'
import {
  THEME_PRESETS,
  DEFAULT_THEME,
  useAppearanceTheme,
  isValidHex,
  generateCustomPalette
} from '../../utils/appearanceTheme'

/**
 * Appearance Settings Component
 *
 * Implements a dynamic global 3-colour Cyberpunk accent theme system:
 * 1. Six approved 3-colour preset themes
 * 2. Custom colour picker with live HEX input and contrast-safe palette generation
 * 3. Live interactive preview panel demonstrating real-time theme application
 * 4. Reset to Default (Ocean Blue)
 */
export default function AppearanceSettings() {
  const {
    theme,
    presetId,
    customHex: activeCustomHex,
    isCustom,
    setPreset,
    setCustomHex,
    resetToDefault
  } = useAppearanceTheme()

  const [hexInput, setHexInput] = useState(isCustom ? activeCustomHex : theme.primary)
  const [hexError, setHexError] = useState(null)
  const [resetFeedback, setResetFeedback] = useState(false)
  const [saveFeedback, setSaveFeedback] = useState(null)

  const handleSelectPreset = (id) => {
    setHexError(null)
    const newTheme = setPreset(id)
    if (newTheme) {
      setHexInput(newTheme.primary)
      showSaveNotification(newTheme.name)
    }
  }

  const handleColorPickerChange = (e) => {
    const raw = e.target.value
    setHexInput(raw.toUpperCase())
    setHexError(null)
    setCustomHex(raw)
    showSaveNotification('Custom Colour')
  }

  const handleHexInputChange = (e) => {
    const val = e.target.value.trim()
    setHexInput(val)

    if (!val) {
      setHexError('HEX code cannot be empty')
      return
    }

    const formatted = val.startsWith('#') ? val : `#${val}`

    if (isValidHex(formatted)) {
      setHexError(null)
      setCustomHex(formatted)
      showSaveNotification('Custom Colour')
    } else {
      setHexError('Enter a valid 6-digit HEX (e.g. #18C9F5)')
    }
  }

  const handleReset = () => {
    resetToDefault()
    setHexInput(DEFAULT_THEME.primary)
    setHexError(null)
    setResetFeedback(true)
    showSaveNotification('Default Ocean Blue')
    setTimeout(() => {
      setResetFeedback(false)
    }, 2500)
  }

  const showSaveNotification = (label) => {
    setSaveFeedback(label)
    setTimeout(() => {
      setSaveFeedback(null)
    }, 2000)
  }

  // Active custom palette preview if custom mode is enabled or being typed
  const customPreviewPalette = isCustom
    ? theme
    : isValidHex(hexInput.startsWith('#') ? hexInput : `#${hexInput}`)
      ? generateCustomPalette(hexInput.startsWith('#') ? hexInput : `#${hexInput}`)
      : null

  return (
    <div className="flex flex-col gap-6">
      {/* ================= CARD 1: LIVE THEME PREVIEW ================= */}
      <div className="p-5 lg:p-6 rounded-2xl bg-[#07152E]/90 border border-primary/20 shadow-[0_4px_24px_rgba(0,0,0,0.35)] backdrop-blur-md flex flex-col gap-5">
        {/* Card Header */}
        <div className="flex items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <div
              className="w-9 h-9 rounded-xl flex items-center justify-center transition-colors"
              style={{
                backgroundColor: 'rgba(var(--theme-primary-rgb), 0.15)',
                color: 'var(--theme-primary)'
              }}
            >
              <Eye className="w-5 h-5" />
            </div>
            <div>
              <h2 className="text-sm font-extrabold text-white">Live Theme Preview</h2>
              <p className="text-[11px] text-text-muted">
                Active Theme:{' '}
                <span className="font-bold text-white uppercase tracking-wider">{theme.name}</span>{' '}
                {isCustom && <span className="text-primary font-mono">({theme.primary})</span>}
              </p>
            </div>
          </div>

          {/* Feedback badge */}
          {saveFeedback && (
            <span className="flex items-center gap-1 text-[11px] font-semibold text-emerald-400 bg-emerald-500/10 px-2.5 py-1 rounded-md border border-emerald-500/20 animate-fadeIn">
              <Check className="w-3 h-3" />
              <span>Applied: {saveFeedback}</span>
            </span>
          )}
        </div>

        {/* Live Preview Showcase Box */}
        <div className="p-4 rounded-xl bg-[#040B1C]/90 border border-primary/20 flex flex-col gap-4">
          {/* Top Row: Coordinated 3-Color Swatches */}
          <div className="flex flex-wrap items-center justify-between gap-3 pb-3 border-b border-primary/10">
            <span className="text-xs font-semibold text-text-muted">3-Colour System:</span>
            <div className="flex items-center gap-3">
              <div className="flex items-center gap-1.5">
                <span
                  className="w-3.5 h-3.5 rounded-full shadow-[0_0_8px_rgba(var(--theme-primary-rgb),0.5)]"
                  style={{ backgroundColor: theme.primary }}
                />
                <span className="text-[11px] font-mono text-white font-semibold">
                  {theme.primary}
                </span>
                <span className="text-[10px] text-text-muted">(Primary)</span>
              </div>

              <div className="flex items-center gap-1.5">
                <span
                  className="w-3.5 h-3.5 rounded-full"
                  style={{ backgroundColor: theme.secondary }}
                />
                <span className="text-[11px] font-mono text-white font-semibold">
                  {theme.secondary}
                </span>
                <span className="text-[10px] text-text-muted">(Secondary)</span>
              </div>

              <div className="flex items-center gap-1.5">
                <span
                  className="w-3.5 h-3.5 rounded-full shadow-[0_0_8px_rgba(var(--theme-tertiary-rgb),0.5)]"
                  style={{ backgroundColor: theme.tertiary }}
                />
                <span className="text-[11px] font-mono text-white font-semibold">
                  {theme.tertiary}
                </span>
                <span className="text-[10px] text-text-muted">(Tertiary)</span>
              </div>
            </div>
          </div>

          {/* Bottom Row: Sample Interactive Controls */}
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 items-center">
            {/* 1. Primary Button Preview */}
            <div className="flex flex-col gap-1.5">
              <span className="text-[11px] font-medium text-text-muted">Primary Button</span>
              <button
                type="button"
                className="theme-accent-gradient theme-accent-glow text-white px-4 py-2.5 rounded-xl text-xs font-bold flex items-center justify-center gap-2 cursor-pointer transition-all hover:brightness-110 active:scale-95"
              >
                <Download className="w-3.5 h-3.5" />
                <span>Start Download</span>
              </button>
            </div>

            {/* 2. Active Sidebar Item Preview */}
            <div className="flex flex-col gap-1.5">
              <span className="text-[11px] font-medium text-text-muted">Active Nav Tab</span>
              <div className="theme-accent-gradient theme-accent-glow text-white px-3.5 py-2.5 rounded-xl text-xs font-bold flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <Sliders className="w-4 h-4" />
                  <span>Quality & Audio</span>
                </div>
                <span className="text-[10px] px-1.5 py-0.2 rounded-full bg-white/20">Active</span>
              </div>
            </div>

            {/* 3. Progress Bar Preview */}
            <div className="flex flex-col gap-1.5">
              <div className="flex items-center justify-between text-[11px] text-text-muted">
                <span>Progress Bar</span>
                <span className="font-bold text-white">78%</span>
              </div>
              <div className="w-full h-3 rounded-full bg-[#040B1C] overflow-hidden border border-primary/20">
                <div
                  className="h-full theme-accent-gradient theme-accent-glow rounded-full transition-all duration-500"
                  style={{ width: '78%' }}
                />
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* ================= CARD 2: ACCENT COLOUR PRESETS ================= */}
      <div className="p-5 lg:p-6 rounded-2xl bg-[#07152E]/90 border border-primary/20 shadow-[0_4px_24px_rgba(0,0,0,0.35)] backdrop-blur-md flex flex-col gap-5">
        {/* Card Header */}
        <div className="flex items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <div
              className="w-9 h-9 rounded-xl flex items-center justify-center transition-colors"
              style={{
                backgroundColor: 'rgba(var(--theme-primary-rgb), 0.15)',
                color: 'var(--theme-primary)'
              }}
            >
              <Palette className="w-5 h-5" />
            </div>
            <div>
              <h2 className="text-sm font-extrabold text-white">Cyberpunk Colour Presets</h2>
              <p className="text-[11px] text-text-muted">
                Choose from six curated 3-colour neon cyberpunk themes
              </p>
            </div>
          </div>

          {/* Reset Button */}
          <button
            type="button"
            onClick={handleReset}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-bold bg-[#040B1C] hover:bg-[#0B1C38] text-text-muted hover:text-white border border-primary/20 hover:border-primary/40 transition-all cursor-pointer shadow-sm active:scale-95"
            title="Reset theme to Default Ocean Blue"
          >
            <RotateCcw className={`w-3.5 h-3.5 ${resetFeedback ? 'animate-spin' : ''}`} />
            <span>{resetFeedback ? 'Resetting...' : 'Reset to Default'}</span>
          </button>
        </div>

        {/* 6 Presets Grid */}
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3.5 pt-1">
          {THEME_PRESETS.map((preset) => {
            const isSelected = !isCustom && presetId === preset.id

            return (
              <button
                key={preset.id}
                type="button"
                onClick={() => handleSelectPreset(preset.id)}
                className={`flex flex-col gap-3 p-4 rounded-xl border text-left transition-all duration-200 cursor-pointer ${
                  isSelected
                    ? 'bg-[#0B1C38] border-primary shadow-[0_0_18px_rgba(var(--theme-primary-rgb),0.35)] ring-1 ring-primary/50'
                    : 'bg-[#07152E]/80 border-primary/15 hover:border-primary/35 hover:bg-[#0B1C38]/70 hover:shadow-[0_4px_16px_rgba(0,0,0,0.3)]'
                }`}
              >
                {/* Preset Title & Active Indicator */}
                <div className="flex items-center justify-between">
                  <div>
                    <span className="text-xs font-bold text-white block">{preset.name}</span>
                    <span className="text-[11px] font-mono text-text-muted font-medium">
                      {preset.primary}
                    </span>
                  </div>

                  {isSelected ? (
                    <span
                      className="w-5 h-5 rounded-full flex items-center justify-center text-white"
                      style={{ backgroundColor: preset.primary }}
                    >
                      <Check className="w-3 h-3 text-black stroke-[3]" />
                    </span>
                  ) : (
                    preset.isDefault && (
                      <span className="text-[10px] uppercase font-bold tracking-wider px-1.5 py-0.5 rounded bg-primary/10 text-primary border border-primary/20">
                        Default
                      </span>
                    )
                  )}
                </div>

                {/* Coordinated 3-Color Swatch Preview Bar */}
                <div className="flex items-center gap-1.5 pt-1">
                  <div
                    className="flex-1 h-3 rounded-l-md shadow-sm"
                    style={{ backgroundColor: preset.primary }}
                    title={`Primary: ${preset.primary}`}
                  />
                  <div
                    className="flex-1 h-3 shadow-sm"
                    style={{ backgroundColor: preset.secondary }}
                    title={`Secondary: ${preset.secondary}`}
                  />
                  <div
                    className="flex-1 h-3 rounded-r-md shadow-sm"
                    style={{ backgroundColor: preset.tertiary }}
                    title={`Tertiary: ${preset.tertiary}`}
                  />
                </div>
              </button>
            )
          })}
        </div>
      </div>

      {/* ================= CARD 3: CUSTOM COLOUR PICKER ================= */}
      <div className="p-5 lg:p-6 rounded-2xl bg-[#07152E]/90 border border-primary/20 shadow-[0_4px_24px_rgba(0,0,0,0.35)] backdrop-blur-md flex flex-col gap-5">
        {/* Card Header */}
        <div className="flex items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <div
              className="w-9 h-9 rounded-xl flex items-center justify-center transition-colors"
              style={{
                backgroundColor: 'rgba(var(--theme-primary-rgb), 0.15)',
                color: 'var(--theme-primary)'
              }}
            >
              <Pipette className="w-5 h-5" />
            </div>
            <div>
              <h2 className="text-sm font-extrabold text-white">Custom Accent Colour</h2>
              <p className="text-[11px] text-text-muted">
                Choose any custom neon hue — 2 supporting gradient colors are generated
                automatically
              </p>
            </div>
          </div>

          {isCustom && (
            <span className="flex items-center gap-1 text-[11px] font-semibold text-primary bg-primary/10 px-2.5 py-1 rounded-md border border-primary/20 animate-fadeIn">
              <Sparkles className="w-3 h-3 text-primary" />
              <span>Custom Active</span>
            </span>
          )}
        </div>

        {/* Custom Colour Controls */}
        <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-4 pt-1">
          {/* Native HTML Colour Picker Input */}
          <div className="flex items-center gap-3">
            <label className="relative cursor-pointer flex-shrink-0 group">
              <input
                type="color"
                value={
                  isValidHex(hexInput.startsWith('#') ? hexInput : `#${hexInput}`)
                    ? hexInput.startsWith('#')
                      ? hexInput
                      : `#${hexInput}`
                    : '#18C9F5'
                }
                onChange={handleColorPickerChange}
                className="sr-only"
                id="custom-theme-color-picker"
              />
              <div
                className="w-12 h-12 rounded-xl border-2 border-primary/40 group-hover:border-primary shadow-[0_0_14px_rgba(var(--theme-primary-rgb),0.3)] flex items-center justify-center transition-all group-hover:scale-105"
                style={{
                  backgroundColor: isValidHex(hexInput.startsWith('#') ? hexInput : `#${hexInput}`)
                    ? hexInput.startsWith('#')
                      ? hexInput
                      : `#${hexInput}`
                    : '#18C9F5'
                }}
              >
                <Pipette className="w-5 h-5 text-black drop-shadow-[0_1px_2px_rgba(255,255,255,0.8)]" />
              </div>
            </label>
            <div className="flex flex-col">
              <span className="text-xs font-bold text-white">Palette Picker</span>
              <span className="text-[11px] text-text-muted">Click to open system colour wheel</span>
            </div>
          </div>

          <div className="hidden sm:block w-px h-10 bg-primary/15" />

          {/* Manual HEX Text Input */}
          <div className="flex-1 flex flex-col gap-1">
            <label htmlFor="custom-hex-input" className="text-xs font-semibold text-white">
              HEX Code Input
            </label>
            <div className="relative">
              <input
                id="custom-hex-input"
                type="text"
                value={hexInput}
                onChange={handleHexInputChange}
                placeholder="#18C9F5"
                maxLength={7}
                className={`w-full bg-[#040B1C] border rounded-xl py-2.5 px-3.5 text-xs font-mono font-bold text-white placeholder:text-text-muted/40 focus:outline-none transition-all ${
                  hexError
                    ? 'border-rose-500/60 focus:border-rose-500 focus:ring-1 focus:ring-rose-500/40'
                    : 'border-primary/20 focus:border-primary focus:ring-1 focus:ring-primary/40'
                }`}
              />
            </div>
            {hexError && (
              <span className="text-[11px] text-rose-400 flex items-center gap-1 mt-0.5 animate-fadeIn">
                <AlertCircle className="w-3 h-3 flex-shrink-0" />
                <span>{hexError}</span>
              </span>
            )}
          </div>

          {/* Generated Supporting Swatches Preview */}
          {customPreviewPalette && (
            <div className="flex flex-col gap-1 sm:pl-2">
              <span className="text-[11px] font-semibold text-text-muted">Harmonious Palette</span>
              <div className="flex items-center gap-2 p-2 rounded-xl bg-[#040B1C] border border-primary/20">
                <div
                  className="w-6 h-6 rounded-lg shadow-sm"
                  style={{ backgroundColor: customPreviewPalette.primary }}
                  title={`Primary: ${customPreviewPalette.primary}`}
                />
                <div
                  className="w-6 h-6 rounded-lg shadow-sm"
                  style={{ backgroundColor: customPreviewPalette.secondary }}
                  title={`Secondary (Supporting): ${customPreviewPalette.secondary}`}
                />
                <div
                  className="w-6 h-6 rounded-lg shadow-sm"
                  style={{ backgroundColor: customPreviewPalette.tertiary }}
                  title={`Tertiary (Accent Glow): ${customPreviewPalette.tertiary}`}
                />
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
