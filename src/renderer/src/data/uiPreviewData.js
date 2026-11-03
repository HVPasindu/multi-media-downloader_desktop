/**
 * UI Preview & Demonstration Data
 * Isolated sample content for the frontend visual refinement (Step 01).
 * All thumbnails use local inline SVG illustrations compliant with Electron CSP.
 */

// Helper to encode SVG into clean Data URL
const svgDataUrl = (svgContent) =>
  `data:image/svg+xml;utf8,${encodeURIComponent(svgContent.trim())}`

export const PREVIEW_THUMBNAILS = {
  mountains: svgDataUrl(`
    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 320 180" width="320" height="180">
      <defs>
        <linearGradient id="sky" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stop-color="#1A2B56"/>
          <stop offset="50%" stop-color="#3A2A6B"/>
          <stop offset="100%" stop-color="#FF7A59"/>
        </linearGradient>
        <linearGradient id="m1" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stop-color="#4E3B7D"/>
          <stop offset="100%" stop-color="#1B1C3B"/>
        </linearGradient>
        <linearGradient id="m2" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stop-color="#2D5B88"/>
          <stop offset="100%" stop-color="#0E1E38"/>
        </linearGradient>
        <linearGradient id="water" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stop-color="#1C2E56"/>
          <stop offset="100%" stop-color="#0A1224"/>
        </linearGradient>
      </defs>
      <rect width="320" height="180" fill="url(#sky)"/>
      <circle cx="160" cy="95" r="28" fill="#FFE8B5" opacity="0.9"/>
      <polygon points="20,135 110,45 190,135" fill="url(#m1)"/>
      <polygon points="110,45 125,70 100,75" fill="#FFE8DF" opacity="0.4"/>
      <polygon points="120,140 215,30 310,140" fill="url(#m2)"/>
      <polygon points="215,30 230,55 205,62" fill="#E6F4FF" opacity="0.5"/>
      <polygon points="-20,145 60,75 140,145" fill="#13213F"/>
      <rect y="130" width="320" height="50" fill="url(#water)"/>
      <line x1="120" y1="140" x2="200" y2="140" stroke="#FFE8B5" stroke-width="2" opacity="0.3"/>
      <line x1="90" y1="150" x2="230" y2="150" stroke="#FFE8B5" stroke-width="1.5" opacity="0.2"/>
    </svg>
  `),

  lofi: svgDataUrl(`
    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 320 180" width="320" height="180">
      <defs>
        <linearGradient id="lofi-bg" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0%" stop-color="#2B1055"/>
          <stop offset="50%" stop-color="#75225B"/>
          <stop offset="100%" stop-color="#D05A3F"/>
        </linearGradient>
      </defs>
      <rect width="320" height="180" fill="url(#lofi-bg)"/>
      <circle cx="240" cy="70" r="45" fill="#FFB07C" opacity="0.75"/>
      <!-- Window frame -->
      <line x1="240" y1="20" x2="240" y2="130" stroke="#1D0838" stroke-width="4"/>
      <line x1="180" y1="70" x2="300" y2="70" stroke="#1D0838" stroke-width="4"/>
      <!-- Desk and room shadow -->
      <rect y="125" width="320" height="55" fill="#130726"/>
      <!-- Person with headphones silhouette -->
      <ellipse cx="110" cy="110" rx="22" ry="24" fill="#0C0418"/>
      <path d="M 90 105 Q 110 80 130 105" stroke="#19D8FF" stroke-width="4" fill="none"/>
      <circle cx="88" cy="110" r="7" fill="#19D8FF"/>
      <circle cx="132" cy="110" r="7" fill="#19D8FF"/>
      <rect x="135" y="105" width="35" height="24" rx="3" fill="#3D1A6D"/>
      <rect x="140" y="109" width="25" height="16" fill="#19D8FF" opacity="0.8"/>
    </svg>
  `),

  ocean: svgDataUrl(`
    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 320 180" width="320" height="180">
      <defs>
        <linearGradient id="ocean-sky" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stop-color="#081A38"/>
          <stop offset="100%" stop-color="#144C7E"/>
        </linearGradient>
        <linearGradient id="wave1" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stop-color="#19D8FF"/>
          <stop offset="100%" stop-color="#0C3460"/>
        </linearGradient>
      </defs>
      <rect width="320" height="180" fill="url(#ocean-sky)"/>
      <path d="M 0 110 Q 80 80 160 110 T 320 110 L 320 180 L 0 180 Z" fill="#0B2B50"/>
      <path d="M 0 125 Q 70 95 150 120 T 320 120 L 320 180 L 0 180 Z" fill="url(#wave1)"/>
      <path d="M 0 145 Q 90 120 180 145 T 320 140 L 320 180 L 0 180 Z" fill="#061A34"/>
      <!-- Foam details -->
      <path d="M 80 100 Q 110 96 140 108" stroke="#FFFFFF" stroke-width="3" fill="none" opacity="0.85"/>
      <path d="M 210 115 Q 240 110 280 120" stroke="#FFFFFF" stroke-width="2.5" fill="none" opacity="0.8"/>
    </svg>
  `),

  nightCity: svgDataUrl(`
    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 320 180" width="320" height="180">
      <defs>
        <linearGradient id="city-sky" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stop-color="#07031A"/>
          <stop offset="60%" stop-color="#210A42"/>
          <stop offset="100%" stop-color="#4F1054"/>
        </linearGradient>
      </defs>
      <rect width="320" height="180" fill="url(#city-sky)"/>
      <!-- Buildings silhouettes -->
      <rect x="25" y="45" width="30" height="135" fill="#0D0622"/>
      <rect x="65" y="65" width="22" height="115" fill="#150A36"/>
      <rect x="95" y="30" width="38" height="150" fill="#0B051D"/>
      <rect x="140" y="55" width="28" height="125" fill="#170C3B"/>
      <rect x="175" y="40" width="45" height="140" fill="#0D0622"/>
      <rect x="230" y="60" width="35" height="120" fill="#150A36"/>
      <rect x="275" y="35" width="30" height="145" fill="#0B051D"/>
      <!-- Neon window highlights -->
      <rect x="105" y="45" width="4" height="6" fill="#19D8FF"/>
      <rect x="115" y="60" width="4" height="6" fill="#FF4568"/>
      <rect x="185" y="55" width="5" height="5" fill="#19D8FF"/>
      <rect x="195" y="75" width="5" height="5" fill="#514BFF"/>
      <!-- Highway road and light streaks -->
      <polygon points="0,180 130,135 190,135 320,180" fill="#0A0618"/>
      <line x1="150" y1="135" x2="110" y2="180" stroke="#FF4568" stroke-width="3" opacity="0.9"/>
      <line x1="170" y1="135" x2="210" y2="180" stroke="#19D8FF" stroke-width="3" opacity="0.9"/>
    </svg>
  `),

  forest: svgDataUrl(`
    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 320 180" width="320" height="180">
      <defs>
        <linearGradient id="forest-sky" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stop-color="#0D2818"/>
          <stop offset="50%" stop-color="#1E472A"/>
          <stop offset="100%" stop-color="#4C7838"/>
        </linearGradient>
      </defs>
      <rect width="320" height="180" fill="url(#forest-sky)"/>
      <polygon points="160,20 200,90 120,90" fill="#0B2014"/>
      <polygon points="90,40 130,110 50,110" fill="#07170E"/>
      <polygon points="230,35 270,110 190,110" fill="#07170E"/>
      <polygon points="160,60 215,140 105,140" fill="#06170D"/>
      <!-- Path with sun shafts -->
      <polygon points="120,180 155,120 165,120 200,180" fill="#2E4A1E"/>
      <polygon points="140,0 170,180 185,180 155,0" fill="#E8F8C8" opacity="0.12"/>
    </svg>
  `),

  musicAlbum: svgDataUrl(`
    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 320 180" width="320" height="180">
      <defs>
        <linearGradient id="music-bg" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0%" stop-color="#3A0D4E"/>
          <stop offset="50%" stop-color="#170A3D"/>
          <stop offset="100%" stop-color="#061230"/>
        </linearGradient>
      </defs>
      <rect width="320" height="180" fill="url(#music-bg)"/>
      <circle cx="160" cy="90" r="55" fill="#10072B" stroke="#514BFF" stroke-width="2"/>
      <circle cx="160" cy="90" r="22" fill="#514BFF" opacity="0.3"/>
      <circle cx="160" cy="90" r="8" fill="#19D8FF"/>
      <!-- Soundwave bars -->
      <rect x="70" y="80" width="6" height="20" rx="3" fill="#19D8FF"/>
      <rect x="85" y="65" width="6" height="50" rx="3" fill="#514BFF"/>
      <rect x="230" y="70" width="6" height="40" rx="3" fill="#19D8FF"/>
      <rect x="245" y="82" width="6" height="16" rx="3" fill="#514BFF"/>
    </svg>
  `),

  food: svgDataUrl(`
    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 320 180" width="320" height="180">
      <defs>
        <radialGradient id="bowl" cx="50%" cy="50%" r="50%">
          <stop offset="0%" stop-color="#FF9D42"/>
          <stop offset="70%" stop-color="#B84918"/>
          <stop offset="100%" stop-color="#381008"/>
        </radialGradient>
      </defs>
      <rect width="320" height="180" fill="#1A110D"/>
      <circle cx="160" cy="90" r="65" fill="#3D2015" stroke="#7A452E" stroke-width="4"/>
      <circle cx="160" cy="90" r="55" fill="url(#bowl)"/>
      <circle cx="150" cy="80" r="12" fill="#FFEAA7"/>
      <circle cx="175" cy="95" r="10" fill="#55EFC4"/>
      <circle cx="145" cy="105" r="14" fill="#D63031"/>
      <!-- Chopsticks -->
      <line x1="120" y1="20" x2="220" y2="160" stroke="#DFE6E9" stroke-width="4" stroke-linecap="round"/>
    </svg>
  `),

  wildlife: svgDataUrl(`
    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 320 180" width="320" height="180">
      <defs>
        <linearGradient id="savanna" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stop-color="#8E2E0A"/>
          <stop offset="50%" stop-color="#D96916"/>
          <stop offset="100%" stop-color="#F9A436"/>
        </linearGradient>
      </defs>
      <rect width="320" height="180" fill="url(#savanna)"/>
      <circle cx="90" cy="70" r="35" fill="#FFF2C6" opacity="0.9"/>
      <!-- Tree silhouette -->
      <path d="M 240 145 L 243 90 Q 220 80 200 65 Q 240 60 270 70 Q 290 85 245 95 Z" fill="#1A0702"/>
      <rect y="140" width="320" height="40" fill="#150501"/>
      <!-- Lion head silhouette -->
      <circle cx="150" cy="120" r="18" fill="#150501"/>
      <ellipse cx="150" cy="125" rx="26" ry="24" fill="#150501" opacity="0.8"/>
    </svg>
  `),

  beach: svgDataUrl(`
    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 320 180" width="320" height="180">
      <defs>
        <linearGradient id="sea" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0%" stop-color="#00C9FF"/>
          <stop offset="50%" stop-color="#0093E9"/>
          <stop offset="100%" stop-color="#80D0C7"/>
        </linearGradient>
      </defs>
      <rect width="320" height="180" fill="url(#sea)"/>
      <!-- Sand coastline -->
      <path d="M 0 0 Q 140 90 200 180 L 320 180 L 320 0 Z" fill="#FFEAA7"/>
      <!-- Palm tree leaves -->
      <path d="M 280 50 Q 250 20 220 40 Q 250 60 280 50 Z" fill="#27AE60"/>
      <path d="M 280 50 Q 290 10 310 25 Q 300 50 280 50 Z" fill="#2ECC71"/>
      <line x1="280" y1="50" x2="310" y2="120" stroke="#795548" stroke-width="4"/>
    </svg>
  `)
}

// ----------------------------------------------------------------------
// 1. DOWNLOADER PAGE DATA
// ----------------------------------------------------------------------

export const DOWNLOADER_MEDIA_PREVIEW = {
  url: 'https://www.youtube.com/watch?v=dQw4w9WgXcQ',
  title: 'A Beautiful Day in the Mountains',
  platform: 'YouTube',
  platformId: 'youtube',
  duration: '3:42',
  thumbnail: PREVIEW_THUMBNAILS.mountains,
  description:
    'Stunning 4K views of mountains, lakes and nature. A peaceful journey through some of the world’s most breathtaking natural landscapes.'
}

export const RECENT_DOWNLOADS_LIST = [
  {
    id: 'rec-1',
    title: 'A Beautiful Day in the Mountains',
    format: 'MP4',
    quality: '1080p',
    fileSize: '245 MB',
    status: 'downloading',
    progress: 68,
    statusText: 'Downloading... 12.4 MB / 18.3 MB • 18s left',
    thumbnail: PREVIEW_THUMBNAILS.mountains
  },
  {
    id: 'rec-2',
    title: 'Chill Vibes - Lofi Mix',
    format: 'MP3',
    quality: '320 kbps',
    fileSize: '128 MB',
    status: 'completed',
    statusText: 'Completed • 2 minutes ago',
    thumbnail: PREVIEW_THUMBNAILS.lofi
  },
  {
    id: 'rec-3',
    title: 'Ocean Waves 4K',
    format: 'MP4',
    quality: '1080p',
    fileSize: '312 MB',
    status: 'completed',
    statusText: 'Completed • 12 minutes ago',
    thumbnail: PREVIEW_THUMBNAILS.ocean
  },
  {
    id: 'rec-4',
    title: 'Night City Drive',
    format: 'MP4',
    quality: '1080p',
    fileSize: '521 MB',
    status: 'paused',
    statusText: 'Paused • 28 minutes ago',
    thumbnail: PREVIEW_THUMBNAILS.nightCity
  },
  {
    id: 'rec-5',
    title: 'Forest Ambience',
    format: 'MP3',
    quality: '320 kbps',
    fileSize: '89 MB',
    status: 'completed',
    statusText: 'Completed • 1 hour ago',
    thumbnail: PREVIEW_THUMBNAILS.forest
  }
]

// ----------------------------------------------------------------------
// 2. DOWNLOADS MANAGER PAGE DATA
// ----------------------------------------------------------------------

export const DOWNLOADS_MANAGER_STATS = {
  downloading: 3,
  queued: 2,
  completed: 12,
  failed: 1
}

export const DOWNLOADS_MANAGER_LIST = [
  {
    id: 1,
    title: 'Beautiful Nature in 4K',
    duration: '12:35',
    platform: 'YouTube',
    platformId: 'youtube',
    format: 'MP4',
    quality: '1080p',
    progress: 68,
    progressText: '452 MB / 668 MB • 12.5 MB/s',
    status: 'downloading',
    statusText: 'Downloading (2m 45s left)',
    thumbnail: PREVIEW_THUMBNAILS.mountains
  },
  {
    id: 2,
    title: 'Top 50 English Songs 2024',
    duration: '4:20',
    platform: 'YouTube',
    platformId: 'youtube',
    format: 'MP3',
    quality: '320 kbps',
    progress: 42,
    progressText: '28 MB / 68 MB • 6.2 MB/s',
    status: 'downloading',
    statusText: 'Downloading (1m 12s left)',
    thumbnail: PREVIEW_THUMBNAILS.musicAlbum
  },
  {
    id: 3,
    title: 'Delicious Food Recipe',
    duration: '01:15',
    platform: 'TikTok',
    platformId: 'tiktok',
    format: 'MP4',
    quality: '720p',
    progress: 95,
    progressText: '120 MB / 126 MB • 8.1 MB/s',
    status: 'finalizing',
    statusText: 'Finalizing (Merging video...)',
    thumbnail: PREVIEW_THUMBNAILS.food
  },
  {
    id: 4,
    title: 'Wild Animals Documentary',
    duration: '28:10',
    platform: 'Facebook',
    platformId: 'facebook',
    format: 'MP4',
    quality: '1080p',
    progress: 0,
    progressText: '0 B / 1.2 GB',
    status: 'queued',
    statusText: 'Queued (Waiting...)',
    thumbnail: PREVIEW_THUMBNAILS.wildlife
  },
  {
    id: 5,
    title: 'Amazing Beach View',
    duration: '00:45',
    platform: 'Instagram',
    platformId: 'instagram',
    format: 'MP4',
    quality: '720p',
    progress: 0,
    progressText: '0 B / 85 MB',
    status: 'queued',
    statusText: 'Queued (Waiting...)',
    thumbnail: PREVIEW_THUMBNAILS.beach
  },
  {
    id: 6,
    title: 'Study Music - Focus',
    duration: '2:15:30',
    platform: 'YouTube',
    platformId: 'youtube',
    format: 'MP3',
    quality: '192 kbps',
    progress: 0,
    progressText: '0 B / 298 MB',
    status: 'queued',
    statusText: 'Queued (Waiting...)',
    thumbnail: PREVIEW_THUMBNAILS.lofi
  }
]

// ----------------------------------------------------------------------
// 3. DOWNLOAD HISTORY PAGE DATA
// ----------------------------------------------------------------------

export const HISTORY_SUMMARY_STATS = {
  totalFiles: 28,
  videos: 17,
  audio: 11,
  storageUsed: '8.4 GB'
}

export const HISTORY_LIST = [
  {
    id: 1,
    title: 'Beautiful Nature in 4K',
    platform: 'YouTube',
    platformId: 'youtube',
    format: 'MP4',
    quality: '1080p',
    fileSize: '668 MB',
    savedTo: 'C:\\Users\\Alex\\Downloads\\Media\\',
    date: 'Mar 16, 2024 10:24 AM',
    status: 'completed',
    statusText: 'Completed',
    thumbnail: PREVIEW_THUMBNAILS.mountains
  },
  {
    id: 2,
    title: 'Chill Beats for Study',
    platform: 'YouTube',
    platformId: 'youtube',
    format: 'MP3',
    quality: '320 kbps',
    fileSize: '86 MB',
    savedTo: 'D:\\Music\\Saved\\',
    date: 'Mar 15, 2024 08:12 PM',
    status: 'completed',
    statusText: 'Completed',
    thumbnail: PREVIEW_THUMBNAILS.lofi
  },
  {
    id: 3,
    title: 'Amazing Beach View',
    platform: 'Instagram',
    platformId: 'instagram',
    format: 'MP4',
    quality: '720p',
    fileSize: '85 MB',
    savedTo: 'E:\\Videos\\Travel\\',
    date: 'Mar 14, 2024 04:36 PM',
    status: 'completed',
    statusText: 'Completed',
    thumbnail: PREVIEW_THUMBNAILS.beach
  },
  {
    id: 4,
    title: 'Wild Animals Documentary',
    platform: 'Facebook',
    platformId: 'facebook',
    format: 'MP4',
    quality: '1080p',
    fileSize: '1.2 GB',
    savedTo: 'C:\\Users\\Alex\\Videos\\',
    date: 'Mar 14, 2024 11:20 AM',
    status: 'completed',
    statusText: 'Completed',
    thumbnail: PREVIEW_THUMBNAILS.wildlife
  },
  {
    id: 5,
    title: 'Delicious Food Recipe',
    platform: 'TikTok',
    platformId: 'tiktok',
    format: 'MP4',
    quality: '720p',
    fileSize: '126 MB',
    savedTo: 'C:\\Users\\Alex\\Downloads\\Media\\',
    date: 'Mar 13, 2024 09:15 PM',
    status: 'completed',
    statusText: 'Completed',
    thumbnail: PREVIEW_THUMBNAILS.food
  },
  {
    id: 6,
    title: 'Night City Drive',
    platform: 'YouTube',
    platformId: 'youtube',
    format: 'MP4',
    quality: '4K',
    fileSize: '512 MB',
    savedTo: 'E:\\Videos\\City\\',
    date: 'Mar 12, 2024 07:42 PM',
    status: 'completed',
    statusText: 'Completed',
    thumbnail: PREVIEW_THUMBNAILS.nightCity
  },
  {
    id: 7,
    title: 'Top 50 English Songs 2024',
    platform: 'YouTube',
    platformId: 'youtube',
    format: 'MP3',
    quality: '320 kbps',
    fileSize: '—',
    savedTo: 'D:\\Music\\Saved\\',
    date: 'Mar 11, 2024 03:18 PM',
    status: 'failed',
    statusText: 'Failed (File Missing)',
    thumbnail: PREVIEW_THUMBNAILS.musicAlbum
  }
]

// ----------------------------------------------------------------------
// 4. SETTINGS PAGE DATA
// ----------------------------------------------------------------------

export const SETTINGS_SECTIONS = [
  { id: 'general', label: 'General', icon: 'Settings' },
  { id: 'download', label: 'Download', icon: 'Download' },
  { id: 'quality', label: 'Quality', icon: 'Tv' },
  { id: 'audio', label: 'Audio', icon: 'Music' },
  { id: 'advanced', label: 'Advanced', icon: 'Zap' },
  { id: 'appearance', label: 'Appearance', icon: 'Palette' },
  { id: 'shortcuts', label: 'Shortcuts', icon: 'Keyboard' },
  { id: 'privacy', label: 'Privacy', icon: 'Shield' },
  { id: 'about', label: 'About', icon: 'Info' }
]

export const SETTINGS_STORAGE_INFO = {
  usedGB: 125,
  totalGB: 500,
  freeGB: 375,
  percentUsed: 25
}
