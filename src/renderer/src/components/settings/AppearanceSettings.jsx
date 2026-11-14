import { useState, useCallback } from 'react'
import {
  Palette,
  Check,
  RotateCcw,
  Eye,
  Sliders,
  Download,
  Moon,
  Sun,
  Sparkles,
  Layers
} from 'lucide-react'
import { THEME_PRESETS, BACKGROUND_PRESETS, useAppearanceTheme } from '../../utils/appearanceTheme'
import CustomColorPicker from './CustomColorPicker'

/**
 * Complete Appearance Settings Component
 *
 * Implements:
 * 1. Live Theme Preview (Active accent + active background showcase)
 * 2. Background Appearance (Dark, Light, Custom + 8 Cyberpunk Presets + Reset Background)
 * 3. Cyberpunk Accent Presets (6 curated 3-color presets + Reset to Default)
 * 4. Application-Controlled Custom Accent Colour Picker
 */
export default function AppearanceSettings() {
  const {
    theme,
    presetId,
    customHex: activeCustomHex,
    isCustom,
    background,
    bgPalette,
    setPreset,
    setCustomHex,
    resetToDefault,
    setBackgroundMode,
    setBackgroundPreset,
    setCustomBackgroundHex,
    resetBackground
  } = useAppearanceTheme()

  const [saveFeedback, setSaveFeedback] = useState(null)
  const [resetAccentFeedback, setResetAccentFeedback] = useState(false)
  const [resetBgFeedback, setResetBgFeedback] = useState(false)

  const showSaveNotification = useCallback((label) => {
    setSaveFeedback(label)
    const timer = setTimeout(() => {
      setSaveFeedback(null)
    }, 2200)
    return () => clearTimeout(timer)
  }, [])

  // Accent handlers
  const handleSelectAccentPreset = (id) => {
    const updated = setPreset(id)
    if (updated) {
      showSaveNotification(`Accent: ${updated.name}`)
    }
  }

  const handleCustomAccentChange = (hex) => {
    setCustomHex(hex)
    showSaveNotification(`Custom Accent: ${hex}`)
  }

  const handleResetAccent = () => {
    resetToDefault()
    setResetAccentFeedback(true)
    showSaveNotification('Accent Reset: Ocean Blue')
    setTimeout(() => setResetAccentFeedback(false), 2000)
  }

  // Background handlers
  const handleSelectBgMode = (mode) => {
    setBackgroundMode(mode)
    showSaveNotification(`Background Mode: ${mode.toUpperCase()}`)
  }

  const handleSelectBgPreset = (id) => {
    const preset = BACKGROUND_PRESETS.find((p) => p.id === id)
    setBackgroundPreset(id)
    if (preset) {
      showSaveNotification(`Background: ${preset.name} (Matched: ${preset.matchedAccentId})`)
    }
  }

  const handleResetBg = () => {
    resetBackground()
    setResetBgFeedback(true)
    showSaveNotification('Background Reset: Midnight Navy')
    setTimeout(() => setResetBgFeedback(false), 2000)
  }

  return (
    <div className="flex flex-col gap-6">
      {/* =====================================================================
          CARD 1: LIVE THEME PREVIEW
      ===================================================================== */}
      <div className="p-5 lg:p-6 rounded-2xl bg-surface/90 border border-primary/20 shadow-[0_4px_24px_rgba(0,0,0,0.35)] backdrop-blur-md flex flex-col gap-5">
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
              <h2 className="text-sm font-extrabold text-text">Live Theme Preview</h2>
              <p className="text-[11px] text-text-muted">
                Accent:{' '}
                <span className="font-bold text-text uppercase tracking-wider">{theme.name}</span>{' '}
                {isCustom && <span className="text-primary font-mono">({theme.primary})</span>} •
                Background:{' '}
                <span className="font-bold text-text capitalize">
                  {background.mode === 'preset'
                    ? BACKGROUND_PRESETS.find((p) => p.id === background.presetId)?.name ||
                      'Default'
                    : background.mode}
                </span>{' '}
                <span className="text-text-muted font-mono">({bgPalette.background})</span>
              </p>
            </div>
          </div>

          {/* Feedback badge */}
          {saveFeedback && (
            <span className="flex items-center gap-1 text-[11px] font-semibold text-emerald-400 bg-emerald-500/10 px-2.5 py-1 rounded-md border border-emerald-500/20 animate-fadeIn">
              <Check className="w-3 h-3" />
              <span>{saveFeedback}</span>
            </span>
          )}
        </div>

        {/* Live Preview Showcase Box */}
        <div className="p-4 rounded-xl bg-background/90 border border-primary/20 flex flex-col gap-4 transition-colors duration-300">
          {/* Top Row: Coordinated Swatches */}
          <div className="flex flex-wrap items-center justify-between gap-3 pb-3 border-b border-primary/10">
            <span className="text-xs font-semibold text-text-muted">Active Palette:</span>
            <div className="flex flex-wrap items-center gap-4">
              {/* Background swatch */}
              <div className="flex items-center gap-1.5">
                <span
                  className="w-3.5 h-3.5 rounded-full border border-white/20"
                  style={{ backgroundColor: bgPalette.background }}
                />
                <span className="text-[11px] font-mono text-text font-semibold">
                  {bgPalette.background}
                </span>
                <span className="text-[10px] text-text-muted">(Background)</span>
              </div>

              {/* Accent Primary */}
              <div className="flex items-center gap-1.5">
                <span
                  className="w-3.5 h-3.5 rounded-full shadow-[0_0_8px_rgba(var(--theme-primary-rgb),0.5)]"
                  style={{ backgroundColor: theme.primary }}
                />
                <span className="text-[11px] font-mono text-text font-semibold">
                  {theme.primary}
                </span>
                <span className="text-[10px] text-text-muted">(Accent)</span>
              </div>

              {/* Accent Secondary */}
              <div className="flex items-center gap-1.5">
                <span
                  className="w-3.5 h-3.5 rounded-full"
                  style={{ backgroundColor: theme.secondary }}
                />
                <span className="text-[11px] font-mono text-text font-semibold">
                  {theme.secondary}
                </span>
                <span className="text-[10px] text-text-muted">(Gradient)</span>
              </div>

              {/* Accent Tertiary */}
              <div className="flex items-center gap-1.5">
                <span
                  className="w-3.5 h-3.5 rounded-full shadow-[0_0_8px_rgba(var(--theme-tertiary-rgb),0.5)]"
                  style={{ backgroundColor: theme.tertiary }}
                />
                <span className="text-[11px] font-mono text-text font-semibold">
                  {theme.tertiary}
                </span>
                <span className="text-[10px] text-text-muted">(Glow)</span>
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
                className="theme-accent-gradient theme-accent-glow text-on-gradient px-4 py-2.5 rounded-xl text-xs font-bold flex items-center justify-center gap-2 cursor-pointer transition-all hover:brightness-110 active:scale-95"
              >
                <Download className="w-3.5 h-3.5" />
                <span>Start Download</span>
              </button>
            </div>

            {/* 2. Active Sidebar Item Preview */}
            <div className="flex flex-col gap-1.5">
              <span className="text-[11px] font-medium text-text-muted">Active Nav Item</span>
              <div className="theme-accent-gradient theme-accent-glow text-on-gradient px-3.5 py-2.5 rounded-xl text-xs font-bold flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <Sliders className="w-4 h-4" />
                  <span>Quality & Audio</span>
                </div>
                <span className="text-[10px] px-1.5 py-0.2 rounded-full bg-black/15 text-on-gradient">
                  Active
                </span>
              </div>
            </div>

            {/* 3. Progress Bar Preview */}
            <div className="flex flex-col gap-1.5">
              <div className="flex items-center justify-between text-[11px] text-text-muted">
                <span>Progress Bar</span>
                <span className="font-bold text-text">78%</span>
              </div>
              <div className="w-full h-3 rounded-full bg-surface-elevated overflow-hidden border border-primary/20">
                <div
                  className="h-full theme-accent-gradient theme-accent-glow rounded-full transition-all duration-500"
                  style={{ width: '78%' }}
                />
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* =====================================================================
          CARD 2: BACKGROUND APPEARANCE (MODES + 8 PRESETS + CUSTOM)
      ===================================================================== */}
      <div className="p-5 lg:p-6 rounded-2xl bg-surface/90 border border-primary/20 shadow-[0_4px_24px_rgba(0,0,0,0.35)] backdrop-blur-md flex flex-col gap-5">
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
              <Layers className="w-5 h-5" />
            </div>
            <div>
              <h2 className="text-sm font-extrabold text-text">Background Appearance</h2>
              <p className="text-[11px] text-text-muted">
                Select Dark, Light or Custom background with 8 Cyberpunk presets
              </p>
            </div>
          </div>

          {/* Reset Background Button */}
          <button
            type="button"
            onClick={handleResetBg}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-bold bg-background hover:bg-surface-elevated text-text-muted hover:text-text border border-primary/20 hover:border-primary/40 transition-all cursor-pointer shadow-sm active:scale-95"
            title="Reset background to Midnight Navy"
          >
            <RotateCcw className={`w-3.5 h-3.5 ${resetBgFeedback ? 'animate-spin' : ''}`} />
            <span>{resetBgFeedback ? 'Resetting...' : 'Reset Background'}</span>
          </button>
        </div>

        {/* Mode Selector Tabs (Dark / Light / Custom) */}
        <div className="flex items-center gap-2 p-1 rounded-xl bg-background border border-primary/20 w-fit">
          {/* Dark Mode Tab */}
          <button
            type="button"
            onClick={() => handleSelectBgMode('dark')}
            className={`flex items-center gap-2 px-3.5 py-1.5 rounded-lg text-xs font-bold transition-all cursor-pointer ${
              background.mode === 'dark'
                ? 'theme-accent-gradient text-on-gradient shadow-sm'
                : 'text-text-muted hover:text-text hover:bg-surface'
            }`}
          >
            <Moon className="w-3.5 h-3.5" />
            <span>Dark</span>
          </button>

          {/* Light Mode Tab */}
          <button
            type="button"
            onClick={() => handleSelectBgMode('light')}
            className={`flex items-center gap-2 px-3.5 py-1.5 rounded-lg text-xs font-bold transition-all cursor-pointer ${
              background.mode === 'light'
                ? 'theme-accent-gradient text-on-gradient shadow-sm'
                : 'text-text-muted hover:text-text hover:bg-surface'
            }`}
          >
            <Sun className="w-3.5 h-3.5" />
            <span>Light</span>
          </button>

          {/* Custom Mode Tab */}
          <button
            type="button"
            onClick={() => handleSelectBgMode('custom')}
            className={`flex items-center gap-2 px-3.5 py-1.5 rounded-lg text-xs font-bold transition-all cursor-pointer ${
              background.mode === 'custom'
                ? 'theme-accent-gradient text-on-gradient shadow-sm'
                : 'text-text-muted hover:text-text hover:bg-surface'
            }`}
          >
            <Sparkles className="w-3.5 h-3.5" />
            <span>Custom</span>
          </button>
        </div>

        {/* 8 Background Presets Grid */}
        <div className="flex flex-col gap-2">
          <span className="text-xs font-semibold text-text-muted">
            Cyberpunk Background Presets:
          </span>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            {BACKGROUND_PRESETS.map((p) => {
              const isSelected = background.mode !== 'custom' && background.presetId === p.id

              return (
                <button
                  key={p.id}
                  type="button"
                  onClick={() => handleSelectBgPreset(p.id)}
                  className={`flex flex-col gap-2 p-3 rounded-xl border text-left transition-all duration-200 cursor-pointer ${
                    isSelected
                      ? 'bg-surface-elevated border-primary shadow-[0_0_14px_rgba(var(--theme-primary-rgb),0.3)] ring-1 ring-primary/40'
                      : 'bg-surface/80 border-primary/15 hover:border-primary/35 hover:bg-surface-elevated/70'
                  }`}
                >
                  <div className="flex items-center justify-between">
                    {/* Swatch */}
                    <div
                      className="w-5 h-5 rounded-md border border-white/20 shadow-sm"
                      style={{ backgroundColor: p.hex }}
                    />
                    {isSelected && (
                      <span className="w-4 h-4 rounded-full bg-primary flex items-center justify-center">
                        <Check className="w-2.5 h-2.5 text-black stroke-[3]" />
                      </span>
                    )}
                  </div>

                  <div>
                    <span className="text-xs font-bold text-text block leading-tight">
                      {p.name}
                    </span>
                    <span className="text-[10px] font-mono text-text-muted">{p.hex}</span>
                  </div>

                  <span className="text-[9px] px-1.5 py-0.5 rounded bg-primary/10 text-primary border border-primary/20 w-fit">
                    Auto: {p.matchedAccentId.replace('-', ' ')}
                  </span>
                </button>
              )
            })}
          </div>
        </div>

        {/* Custom Background Colour Picker (Shown in Custom Mode) */}
        {background.mode === 'custom' && (
          <div className="p-4 rounded-xl bg-background border border-primary/25 flex flex-col gap-3 animate-fadeIn">
            <div className="flex items-center gap-3">
              <div
                className="w-10 h-10 rounded-xl border-2 border-primary/40 shadow-sm flex items-center justify-center flex-shrink-0"
                style={{ backgroundColor: bgPalette.background }}
              >
                <Layers className="w-5 h-5 text-primary" />
              </div>
              <div>
                <span className="text-xs font-bold text-text block">Custom Background Colour</span>
                <span className="text-[11px] text-text-muted">
                  Interactive 2D picker • Automatically derives surfaces & matches accent
                </span>
              </div>
            </div>

            <CustomColorPicker
              initialColor={background.customHex || bgPalette.background}
              onColorChange={(hex) => {
                setCustomBackgroundHex(hex)
                showSaveNotification(`Custom Background: ${hex}`)
              }}
              idPrefix="background"
              selectionLabel="Active Background"
              showPalettePreview={false}
            />
          </div>
        )}
      </div>

      {/* =====================================================================
          CARD 3: CYBERPUNK ACCENT PRESETS (6 CURATED PRESETS)
      ===================================================================== */}
      <div className="p-5 lg:p-6 rounded-2xl bg-surface/90 border border-primary/20 shadow-[0_4px_24px_rgba(0,0,0,0.35)] backdrop-blur-md flex flex-col gap-5">
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
              <h2 className="text-sm font-extrabold text-text">Cyberpunk Accent Presets</h2>
              <p className="text-[11px] text-text-muted">
                Choose from six curated 3-colour neon cyberpunk themes
              </p>
            </div>
          </div>

          {/* Reset Accent Button */}
          <button
            type="button"
            onClick={handleResetAccent}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-bold bg-background hover:bg-surface-elevated text-text-muted hover:text-text border border-primary/20 hover:border-primary/40 transition-all cursor-pointer shadow-sm active:scale-95"
            title="Reset theme to Default Ocean Blue"
          >
            <RotateCcw className={`w-3.5 h-3.5 ${resetAccentFeedback ? 'animate-spin' : ''}`} />
            <span>{resetAccentFeedback ? 'Resetting...' : 'Reset to Default'}</span>
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
                onClick={() => handleSelectAccentPreset(preset.id)}
                className={`flex flex-col gap-3 p-4 rounded-xl border text-left transition-all duration-200 cursor-pointer ${
                  isSelected
                    ? 'bg-surface-elevated border-primary shadow-[0_0_18px_rgba(var(--theme-primary-rgb),0.35)] ring-1 ring-primary/50'
                    : 'bg-surface/80 border-primary/15 hover:border-primary/35 hover:bg-surface-elevated/70 hover:shadow-[0_4px_16px_rgba(0,0,0,0.3)]'
                }`}
              >
                {/* Preset Title & Active Indicator */}
                <div className="flex items-center justify-between">
                  <div>
                    <span className="text-xs font-bold text-text block">{preset.name}</span>
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

      {/* =====================================================================
          CARD 4: CUSTOM ACCENT COLOUR PICKER
      ===================================================================== */}
      <div className="p-5 lg:p-6 rounded-2xl bg-surface/90 border border-primary/20 shadow-[0_4px_24px_rgba(0,0,0,0.35)] backdrop-blur-md flex flex-col gap-5">
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
              <h2 className="text-sm font-extrabold text-text">Custom Accent Colour</h2>
              <p className="text-[11px] text-text-muted">
                Synchronized 2D selection, Hue slider, HEX, and RGB numeric controls
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

        {/* Custom Colour Picker Component */}
        <CustomColorPicker
          initialColor={isCustom ? activeCustomHex : theme.primary}
          onColorChange={handleCustomAccentChange}
          idPrefix="accent"
          selectionLabel="Active Accent"
          showPalettePreview={true}
        />
      </div>
    </div>
  )
}
