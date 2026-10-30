# Frontend Architecture — Multi-Platform Media Downloader

## 1. Overview & Directory Tree

The desktop application frontend is built with **React 19**, **Electron 39**, **Tailwind CSS v4**, and **React Router**, communicating with an isolated loopback Express backend through a secure Electron IPC bridge.

```text
src/renderer/
│
├── FRONTEND_ARCHITECTURE.md              <-- This documentation
│
└── src/
    ├── assets/
    │   ├── base.css
    │   ├── main.css
    │   └── branding/                     <-- Official transparent cloud logo
    │
    ├── components/
    │   ├── common/
    │   │   └── LoadingIndicator.jsx      <-- Animated loading spinner
    │   ├── layout/
    │   │   ├── MainLayout.jsx            <-- Persistent branded sidebar & titlebar
    │   │   └── SidebarDecoration.jsx     <-- Dynamic bottom artwork (mountains / cosmic swirl)
    │   ├── splash/
    │   │   └── SplashScreen.jsx          <-- Startup branding & health progression screen
    │   └── ui/
    │       ├── DownloaderHeroIllustration.jsx <-- 3D pedestal & levitating frosted media tiles
    │       ├── FilterTabs.jsx            <-- Horizontal category filter tab pills
    │       ├── MediaThumbnail.jsx        <-- Video/audio thumbnail with duration badge
    │       ├── PlatformBadge.jsx         <-- SVG badges for YouTube, FB, IG, TikTok, X
    │       ├── StatCard.jsx              <-- Summary metric card with glowing borders
    │       ├── StatusBadge.jsx           <-- Contextual status icons and subtitles
    │       └── ToggleSwitch.jsx          <-- iOS-style glowing neon settings toggle
    │
    ├── data/
    │   └── uiPreviewData.js              <-- Visual preview content and SVG vector thumbnails
    │
    ├── features/
    │   └── three/
    │       └── SplashDecoration3D.jsx    <-- Three.js R3F starfield & cyber cube effect
    │
    ├── pages/
    │   ├── DownloaderPage.jsx            <-- Link paste, format/quality options & recent list
    │   ├── DownloadsPage.jsx             <-- Active queue, live progress, and pause/cancel
    │   ├── HistoryPage.jsx               <-- Download history, records filtering & file opening
    │   └── SettingsPage.jsx              <-- Preferences, download destination & storage stats
    │
    ├── services/
    │   ├── api.js                        <-- Core IPC bridge client & native folder chooser
    │   ├── startupService.js             <-- Startup lifecycle listener & health verification
    │   ├── mediaApi.js                   <-- POST /api/media/analyze wrapper
    │   ├── downloadsApi.js               <-- Job creation, listing, cancel, retry, clear history
    │   └── downloadSettingsApi.js        <-- Persisted download preferences (GET/PATCH)
    │
    ├── styles/
    │   └── theme.css                     <-- Color tokens, dark navy backgrounds & glow utilities
    │
    ├── App.jsx                           <-- Startup coordinator, splash gate & route definition
    └── main.jsx                          <-- React DOM entrypoint & HashRouter mounting
```

---

## 2. Responsibilities of the Four Main Pages

| Page Component | Route Path | Core Responsibilities |
|:---|:---:|:---|
| **`DownloaderPage.jsx`** | `/` | User inputs media URLs, views the analyzed preview thumbnail and metadata, selects MP4/MP3 format, picks quality/bitrate options, sets destination folder, clicks **Download**, and inspects recent downloads. |
| **`DownloadsPage.jsx`** | `/downloads` | Displays the active download queue with real-time percentage progress bars, download speeds, remaining time (ETA), and provides user controls for cancellation and retry. |
| **`HistoryPage.jsx`** | `/history` | Displays past completed or failed downloads with search, format filtering, file size reporting, saved file paths, status indicators, and actions (Play, Open Folder, Retry). |
| **`SettingsPage.jsx`** | `/settings` | Allows customization of the default download destination folder, format preferences, subfolder organization rules, and displays disk storage capacity statistics. |

---

## 3. Shared UI Components

- **`StatCard.jsx`**: Renders metric counters with frosted glass styling, neon borders, and glowing icon containers.
- **`StatusBadge.jsx`**: Displays animated spinners (`downloading`), gears (`finalizing`), hourglasses (`queued`), green checks (`completed`), and red crosses (`failed`) with contextual subtitles.
- **`FilterTabs.jsx`**: Renders horizontal filter pill buttons with active gradient fills and dynamic count badges.
- **`MediaThumbnail.jsx`**: Renders media preview thumbnails with duration overlays, play button hovers, and missing-file error indicators.
- **`PlatformBadge.jsx`**: Pure inline SVG icons representing YouTube, TikTok, Instagram, Facebook, and X/Twitter.
- **`ToggleSwitch.jsx`**: Accessible, animated toggle switch with electric cyan glow for settings preferences.
- **`DownloaderHeroIllustration.jsx`**: 3D cyber-pedestal graphic with the official cloud logo and floating frosted media tiles.
- **`SidebarDecoration.jsx`**: Dynamic artwork in the sidebar footer (mountain range on `/`; cosmic swirl and floating media tiles on other routes).

---

## 4. Routing Architecture

Routing is configured in `src/renderer/src/main.jsx` and `src/renderer/src/App.jsx` using `HashRouter` (required for desktop Electron applications loading via `file://`):

```text
main.jsx
   ↓
<StrictMode>
  <HashRouter>
    <App />
  </HashRouter>
</StrictMode>
   ↓
App.jsx (Startup Health Check Gate)
   ↓
<Routes>
  <Route element={<MainLayout />}>
    <Route path="/" element={<DownloaderPage />} />
    <Route path="/downloads" element={<DownloadsPage />} />
    <Route path="/history" element={<HistoryPage />} />
    <Route path="/settings" element={<SettingsPage />} />
    <Route path="*" element={<Navigate to="/" replace />} />
  </Route>
</Routes>
```

- Navigation tabs use standard React Router `NavLink`.
- The active tab receives a gradient highlight (`bg-gradient-to-r from-[#19D8FF] via-[#3388FF] to-[#514BFF]`).
- Unknown routes redirect gracefully to `/`.

---

## 5. Startup Lifecycle & Splash Screen

Before displaying the application interface, Electron and React execute an orchestrated sequence:

```text
Electron Startup
       ↓
Initialize Database (Sequelize & SQLite)
       ↓
Recover Interrupted Downloads (Crash Recovery)
       ↓
Start Express Backend (127.0.0.1:3001)
       ↓
Register Existing IPC Handlers
       ↓
Verify API Health (window.api.request)
       ↓
Transition Smoothly (550ms delay)
       ↓
Mount MainLayout & Active Route
```

- While `isReady === false`, `SplashScreen.jsx` remains mounted, showing Three.js background animations and step-by-step progress.
- Once the backend health check passes, `setIsReady(true)` transitions the user into the main workspace.

---

## 6. Secure API Communication Flow

The renderer never makes direct network requests (`fetch` or `axios`) to `http://127.0.0.1:3001`. All communication travels across the secure Electron IPC bridge:

```text
React Page / Component
          │
          ▼
Domain API Service (mediaApi.js / downloadsApi.js / downloadSettingsApi.js)
          │
          ▼
Core Bridge Client (api.js -> apiRequest)
          │
          ▼
window.api.request({ path, method, body })  [Preload Bridge]
          │
          ▼
ipcRenderer.invoke('api:request')          [Electron Main Process]
          │  (Main process automatically injects the secure Bearer session token)
          ▼
Local Express Backend (http://127.0.0.1:3001)
          │
          ▼
Controllers -> Services -> SQLite / yt-dlp / FFmpeg
```

---

## 7. API Service Modules Summary

| File | Purpose | Documented Endpoints |
|:---|:---|:---|
| **`services/api.js`** | Core IPC request transport, health check, and native Electron folder dialogs. | `GET /api/health`, native folder chooser |
| **`services/mediaApi.js`** | Validates media URLs and extracts platform metadata and formats. | `POST /api/media/analyze` |
| **`services/downloadsApi.js`** | Enqueues downloads, lists active jobs/history, handles cancellation, retry, and history deletion. | `POST /api/downloads`<br/>`GET /api/downloads`<br/>`GET /api/downloads/:id`<br/>`POST /api/downloads/:id/cancel`<br/>`POST /api/downloads/:id/retry`<br/>`DELETE /api/downloads/:id`<br/>`DELETE /api/downloads/history` |
| **`services/downloadSettingsApi.js`** | Reads and partially updates download settings in SQLite. | `GET /api/settings/downloads`<br/>`PATCH /api/settings/downloads` |

### Service Usage Example:

```javascript
import { analyzeMedia } from './services/mediaApi'
import { createDownload } from './services/downloadsApi'

// 1. Analyze media link
const analyzeRes = await analyzeMedia('https://www.youtube.com/watch?v=dQw4w9WgXcQ')
if (analyzeRes.ok && analyzeRes.data.success) {
  const metadata = analyzeRes.data.data

  // 2. Queue an MP4 download job
  const downloadRes = await createDownload({
    mediaItemId: metadata.mediaItemId,
    outputFormat: 'mp4',
    quality: '1080p'
  })
}
```

---

## 8. State Management Strategy

To maintain beginner-friendly, clean, and maintainable React code without third-party libraries (no Redux, Zustand, or MobX):

1. **Page-Level State Ownership**:
   - **`DownloaderPage`**: Owns URL input, active format toggle (`mp4`/`mp3`), selected resolution or audio bitrate, and the active media preview object.
   - **`DownloadsPage`**: Owns search query, active tab filter, and the list of active/queued downloads.
   - **`HistoryPage`**: Owns history search query, selected history row IDs, and active history tab filter.
   - **`SettingsPage`**: Owns local form fields and toggle states.
2. **Global Application State**:
   - **`App.jsx`**: Coordinates startup health and Splash Screen transitions.
   - **`MainLayout.jsx`**: Derives active job count for the sidebar badge.
3. **No Unnecessary State Lifting**:
   - State stays as close as possible to the component that renders it.

---

## 9. React Hooks Guidelines

- **`useState`**: Used for local UI state (inputs, selected format, open modals, active tabs).
- **`useEffect`**: Used exclusively for external side-effects (IPC subscriptions, event listeners, startup triggers). Never use for basic calculations that can be derived in render.
- **`useRef`**: Used for in-flight request guards (e.g. `isCheckingHealthRef`), DOM element references, and timer cleanup (`transitionTimerRef`).
- **`useMemo`**: Used for filtering lists when searching or switching category tabs.
- **`useCallback`**: Used when passing stable function references to children or effect dependency arrays.
- **Custom Hooks**: Only introduce a custom Hook (e.g. `useDownloadProgress`) when a specific stateful pattern is genuinely duplicated across multiple pages.

---

## 10. Preview Data vs. Real Backend Data Separation

During development, visual preview data resides in `src/renderer/src/data/uiPreviewData.js`.
- **UI Preview Data**: Purely for design review, offline testing, and initial visual rendering.
- **Real Backend Data**: Flows through `services/*Api.js` -> `api.js` -> `window.api.request()`.
- Future roadmap steps (05.03–05.13) will progressively replace in-memory preview objects with real backend API responses without disrupting the approved UI layout.

