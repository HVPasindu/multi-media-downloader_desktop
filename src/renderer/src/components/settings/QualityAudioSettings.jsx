import { useState, useEffect, useRef } from 'react'
import { Video, Music, Check, AlertCircle, Loader2 } from 'lucide-react'
import { getDownloadSettings, updateDownloadSettings } from '../../services/downloadSettingsApi'

const VIDEO_QUALITY_OPTIONS = [
  { label: 'Best Available', value: 'best' },
  { label: '2160p (4K)', value: '2160p' },
  { label: '1440p (2K)', value: '1440p' },
  { label: '1080p (FHD)', value: '1080p' },
  { label: '720p (HD)', value: '720p' },
  { label: '480p (SD)', value: '480p' }
]

const AUDIO_BITRATE_OPTIONS = [
  { label: '128 kbps', value: 128 },
  { label: '192 kbps', value: 192 },
  { label: '320 kbps', value: 320 }
]

/**
 * Quality & Audio Settings Component
 *
 * Provides two primary configuration cards:
 * 1. Default Video Quality (MP4 preferred resolution)
 * 2. Default Audio Bitrate (MP3 preferred bitrate)
 *
 * Persisted atomically to SQLite via /api/settings/downloads.
 */
export default function QualityAudioSettings() {
  const [preferredVideoQuality, setPreferredVideoQuality] = useState('best')
  const [preferredAudioBitrate, setPreferredAudioBitrate] = useState(192)
  const [isLoading, setIsLoading] = useState(true)

  // Saving states
  const [isSavingVideo, setIsSavingVideo] = useState(false)
  const [isSavingAudio, setIsSavingAudio] = useState(false)

  // Feedback states
  const [videoSavedFeedback, setVideoSavedFeedback] = useState(false)
  const [audioSavedFeedback, setAudioSavedFeedback] = useState(false)
  const [videoError, setVideoError] = useState(null)
  const [audioError, setAudioError] = useState(null)

  const videoTimerRef = useRef(null)
  const audioTimerRef = useRef(null)

  useEffect(() => {
    let isMounted = true

    async function loadSettings() {
      try {
        const response = await getDownloadSettings()
        if (!isMounted) return

        if (response.ok && response.data?.success && response.data?.data) {
          const prefs = response.data.data
          if (prefs.preferredMp4Quality) {
            setPreferredVideoQuality(prefs.preferredMp4Quality)
          }
          if (Number.isInteger(prefs.preferredMp3BitrateKbps)) {
            setPreferredAudioBitrate(prefs.preferredMp3BitrateKbps)
          }
        } else {
          setVideoError('Unable to load saved preferences from local storage.')
        }
      } catch (err) {
        if (isMounted) {
          setVideoError(err?.message || 'Failed to connect to local settings service.')
        }
      } finally {
        if (isMounted) {
          setIsLoading(false)
        }
      }
    }

    loadSettings()

    return () => {
      isMounted = false
      if (videoTimerRef.current) clearTimeout(videoTimerRef.current)
      if (audioTimerRef.current) clearTimeout(audioTimerRef.current)
    }
  }, [])

  const handleSelectVideoQuality = async (value) => {
    if (isSavingVideo || isSavingAudio || value === preferredVideoQuality) return

    setVideoError(null)
    setIsSavingVideo(true)
    const previous = preferredVideoQuality

    try {
      const response = await updateDownloadSettings({ preferredMp4Quality: value })
      if (response.ok && response.data?.success) {
        setPreferredVideoQuality(value)
        setVideoSavedFeedback(true)
        if (videoTimerRef.current) clearTimeout(videoTimerRef.current)
        videoTimerRef.current = setTimeout(() => {
          setVideoSavedFeedback(false)
        }, 2500)
      } else {
        const errorMsg =
          response.data?.errors?.preferredMp4Quality ||
          response.data?.message ||
          'Failed to save video quality preference.'
        setVideoError(errorMsg)
        setPreferredVideoQuality(previous)
      }
    } catch (err) {
      setVideoError(err?.message || 'Error communicating with settings service.')
      setPreferredVideoQuality(previous)
    } finally {
      setIsSavingVideo(false)
    }
  }

  const handleSelectAudioBitrate = async (value) => {
    if (isSavingAudio || isSavingVideo || value === preferredAudioBitrate) return

    setAudioError(null)
    setIsSavingAudio(true)
    const previous = preferredAudioBitrate

    try {
      const response = await updateDownloadSettings({ preferredMp3BitrateKbps: value })
      if (response.ok && response.data?.success) {
        setPreferredAudioBitrate(value)
        setAudioSavedFeedback(true)
        if (audioTimerRef.current) clearTimeout(audioTimerRef.current)
        audioTimerRef.current = setTimeout(() => {
          setAudioSavedFeedback(false)
        }, 2500)
      } else {
        const errorMsg =
          response.data?.errors?.preferredMp3BitrateKbps ||
          response.data?.message ||
          'Failed to save audio bitrate preference.'
        setAudioError(errorMsg)
        setPreferredAudioBitrate(previous)
      }
    } catch (err) {
      setAudioError(err?.message || 'Error communicating with settings service.')
      setPreferredAudioBitrate(previous)
    } finally {
      setIsSavingAudio(false)
    }
  }

  if (isLoading) {
    return (
      <div className="p-8 rounded-2xl bg-[#07152E]/80 border border-primary/15 flex flex-col items-center justify-center gap-3 text-text-muted">
        <Loader2 className="w-6 h-6 animate-spin text-primary" />
        <span className="text-xs font-semibold">Loading quality & audio preferences...</span>
      </div>
    )
  }

  return (
    <div className="flex flex-col gap-6">
      {/* ================= CARD 1: DEFAULT VIDEO QUALITY ================= */}
      <div className="p-5 lg:p-6 rounded-2xl bg-[#07152E]/90 border border-primary/20 shadow-[0_4px_24px_rgba(0,0,0,0.35)] backdrop-blur-md flex flex-col gap-5">
        {/* Card Header */}
        <div className="flex items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-xl bg-primary/15 text-primary flex items-center justify-center">
              <Video className="w-5 h-5" />
            </div>
            <div>
              <h2 className="text-sm font-extrabold text-white">Default Video Quality</h2>
              <p className="text-[11px] text-text-muted">MP4 video resolution preference</p>
            </div>
          </div>

          {/* Status feedback badge */}
          <div className="flex items-center gap-2">
            {isSavingVideo && (
              <span className="flex items-center gap-1.5 text-[11px] font-semibold text-primary">
                <Loader2 className="w-3.5 h-3.5 animate-spin" />
                <span>Saving...</span>
              </span>
            )}
            {videoSavedFeedback && !isSavingVideo && (
              <span className="flex items-center gap-1 text-[11px] font-semibold text-emerald-400 bg-emerald-500/10 px-2 py-0.5 rounded-md border border-emerald-500/20 animate-fadeIn">
                <Check className="w-3 h-3" />
                <span>Saved</span>
              </span>
            )}
          </div>
        </div>

        {/* Description */}
        <p className="text-xs text-text-muted leading-relaxed">
          Choose your preferred default video resolution for MP4 downloads. When a video is
          analyzed, this quality will be selected automatically if available.
        </p>

        {/* Error notification */}
        {videoError && (
          <div className="flex items-center gap-2 p-2.5 rounded-xl bg-rose-500/10 border border-rose-500/20 text-rose-300 text-xs">
            <AlertCircle className="w-4 h-4 flex-shrink-0" />
            <span>{videoError}</span>
          </div>
        )}

        {/* Quality Options Grid */}
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-2.5 pt-1">
          {VIDEO_QUALITY_OPTIONS.map((opt) => {
            const isSelected = preferredVideoQuality === opt.value

            return (
              <button
                key={opt.value}
                type="button"
                disabled={isSavingVideo}
                onClick={() => handleSelectVideoQuality(opt.value)}
                className={`flex flex-col items-center justify-center p-3 rounded-xl border text-xs font-bold transition-all duration-200 cursor-pointer disabled:opacity-60 disabled:cursor-not-allowed ${
                  isSelected
                    ? 'bg-[#0B1C38] border-primary text-white shadow-[0_0_14px_rgba(var(--theme-primary-rgb),0.3)]'
                    : 'bg-[#07152E]/80 border-primary/15 text-text-muted hover:border-primary/30 hover:text-white'
                }`}
              >
                <span>{opt.label}</span>
                {isSelected && (
                  <span className="mt-1 flex items-center gap-0.5 text-[10px] text-primary font-semibold">
                    <Check className="w-3 h-3" /> Selected
                  </span>
                )}
              </button>
            )
          })}
        </div>
      </div>

      {/* ================= CARD 2: DEFAULT AUDIO BITRATE ================= */}
      <div className="p-5 lg:p-6 rounded-2xl bg-[#07152E]/90 border border-primary/20 shadow-[0_4px_24px_rgba(0,0,0,0.35)] backdrop-blur-md flex flex-col gap-5">
        {/* Card Header */}
        <div className="flex items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-xl bg-primary/15 text-primary flex items-center justify-center">
              <Music className="w-5 h-5" />
            </div>
            <div>
              <h2 className="text-sm font-extrabold text-white">Default Audio Bitrate</h2>
              <p className="text-[11px] text-text-muted">MP3 audio quality preference</p>
            </div>
          </div>

          {/* Status feedback badge */}
          <div className="flex items-center gap-2">
            {isSavingAudio && (
              <span className="flex items-center gap-1.5 text-[11px] font-semibold text-primary">
                <Loader2 className="w-3.5 h-3.5 animate-spin" />
                <span>Saving...</span>
              </span>
            )}
            {audioSavedFeedback && !isSavingAudio && (
              <span className="flex items-center gap-1 text-[11px] font-semibold text-emerald-400 bg-emerald-500/10 px-2 py-0.5 rounded-md border border-emerald-500/20 animate-fadeIn">
                <Check className="w-3 h-3" />
                <span>Saved</span>
              </span>
            )}
          </div>
        </div>

        {/* Description */}
        <p className="text-xs text-text-muted leading-relaxed">
          Choose your preferred default audio quality for MP3 downloads.
        </p>

        {/* Error notification */}
        {audioError && (
          <div className="flex items-center gap-2 p-2.5 rounded-xl bg-rose-500/10 border border-rose-500/20 text-rose-300 text-xs">
            <AlertCircle className="w-4 h-4 flex-shrink-0" />
            <span>{audioError}</span>
          </div>
        )}

        {/* Bitrate Options Grid */}
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 pt-1">
          {AUDIO_BITRATE_OPTIONS.map((opt) => {
            const isSelected = preferredAudioBitrate === opt.value

            return (
              <button
                key={opt.value}
                type="button"
                disabled={isSavingAudio}
                onClick={() => handleSelectAudioBitrate(opt.value)}
                className={`flex flex-col items-center justify-center p-3.5 rounded-xl border text-xs font-bold transition-all duration-200 cursor-pointer disabled:opacity-60 disabled:cursor-not-allowed ${
                  isSelected
                    ? 'bg-[#0B1C38] border-primary text-white shadow-[0_0_14px_rgba(var(--theme-primary-rgb),0.3)]'
                    : 'bg-[#07152E]/80 border-primary/15 text-text-muted hover:border-primary/30 hover:text-white'
                }`}
              >
                <span>{opt.label}</span>
                {isSelected && (
                  <span className="mt-1 flex items-center gap-0.5 text-[10px] text-primary font-semibold">
                    <Check className="w-3 h-3" /> Selected
                  </span>
                )}
              </button>
            )
          })}
        </div>
      </div>
    </div>
  )
}
