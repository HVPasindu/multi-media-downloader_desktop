# APPLAN2 — Windows Packaging Guide

## Step 04.43: yt-dlp & FFmpeg Windows Packaging Reference

---

## 1. Overview

This document describes the Windows packaging architecture for the **Multi-Platform Media Downloader** desktop application.

In development mode, download operations can utilize globally installed developer CLI tools or project-staged binaries. However, a packaged Electron desktop application distributed to end users must be completely self-contained and **never require the user to install Python, yt-dlp, FFmpeg, FFprobe, or Node.js globally**.

### Key Architectural Principles

- **No Global Dependencies:** Bundled standalone Windows x64 executables are included directly in the application distribution.
- **Outside ASAR Execution:** Windows `.exe` files cannot be spawned or executed directly from inside an Electron `.asar` archive. Binaries are staged in `resources/bin/win32-x64/` and configured via `extraResources` in `electron-builder.yml` to reside in `<install_dir>/resources/bin/win32-x64/`.
- **Zero Silent Fallback in Production:** In packaged mode (`app.isPackaged === true`), if a bundled executable is missing or corrupted, the application throws a classified `DownloadError` (`YT_DLP_NOT_FOUND`, `FFMPEG_NOT_FOUND`, `FFPROBE_NOT_FOUND`) rather than silently invoking an untrusted global system binary.
- **Strict Cryptographic Integrity:** All staged executables originate from official upstream releases and are verified against official SHA-256 checksums.

---

## 2. Bundled Binaries & Licenses

| Executable    | Upstream Release Source                                                            | Version    | Architecture | SHA-256 Checksum                                                   | License                       |
| :------------ | :--------------------------------------------------------------------------------- | :--------- | :----------- | :----------------------------------------------------------------- | :---------------------------- |
| `yt-dlp.exe`  | [yt-dlp/yt-dlp Releases](https://github.com/yt-dlp/yt-dlp/releases/tag/2026.10.21) | 2026.10.21 | Windows x64  | `33121D192D706E62F684A06F80918E3F3A8BA52AC3A65213B6951C39C7D9F555` | The Unlicense (Public Domain) |
| `ffmpeg.exe`  | [Gyan.dev FFmpeg Builds](https://www.gyan.dev/ffmpeg/builds/)                      | 9.0.2 full | Windows x64  | `589E50B766D251AFDF181DD664D40BD94407E200B019989FD7468C7D118A28D0` | GNU GPL v3                    |
| `ffprobe.exe` | [Gyan.dev FFmpeg Builds](https://www.gyan.dev/ffmpeg/builds/)                      | 9.0.2 full | Windows x64  | `02264DFA4F56BAAA31E443ECE8AA16D397F6B008200E7FD184D22B9009E75FD3` | GNU GPL v3                    |
| `node.exe`    | [Node.js Official](https://nodejs.org/)                                            | v24.14.1   | Windows x64  | Verified official binary                                           | MIT License                   |

---

## 3. Directory Structure

```
multi-media-downloader/
├── electron-builder.yml          # extraResources configuration mapping resources/bin to bin
├── scripts/
│   └── verify-windows-binaries.mjs # Pre-packaging validation & checksum verification script
├── src/
│   └── main/
│       └── backend/
│           └── services/
│               ├── executablePathService.js  # Dynamic runtime/packaged executable path resolver
│               ├── mediaAnalyzerService.js    # Uses resolved yt-dlp path
│               └── downloadService.js         # Uses resolved yt-dlp, ffmpeg, ffprobe, and js runtime
└── resources/
    └── bin/
        └── win32-x64/
            ├── yt-dlp.exe        # Official standalone Windows x64 binary
            ├── ffmpeg.exe        # Official Gyan FFmpeg binary
            ├── ffprobe.exe       # Official Gyan FFprobe binary
            ├── node.exe          # Bundled Node.js runtime for yt-dlp --js-runtimes
            └── licenses/
                ├── LICENSE.yt-dlp.txt
                ├── LICENSE.ffmpeg.txt
                └── LICENSE.node.txt
```

---

## 4. Electron Builder Configuration

In `electron-builder.yml`:

```yaml
extraResources:
  - from: resources/bin
    to: bin
    filter:
      - '**/*'
```

During packaging with `electron-builder --dir` or `electron-builder --win`:

1. `resources/bin/` is copied directly into `dist/win-unpacked/resources/bin/`.
2. `app.asar` contains application source code and assets.
3. At runtime, `process.resourcesPath` resolves to `dist/win-unpacked/resources/`.
4. Executables are located at `path.join(process.resourcesPath, 'bin', 'win32-x64', '<name>.exe')`.

---

## 5. Centralized Path Resolver (`executablePathService.js`)

The `executablePathService.js` provides unified executable resolution:

```javascript
import {
  resolveYtDlpPath,
  resolveFFmpegPath,
  resolveFFprobePath,
  resolveJavaScriptRuntimeOption,
  resolveFFmpegLocationDirectory
} from './executablePathService.js'

// In Media Analyzer:
const ytDlpExecutable = await resolveYtDlpPath()
const jsRuntimeOption = await resolveJavaScriptRuntimeOption()
// Passes: ['--js-runtimes', jsRuntimeOption, ...] to yt-dlp

// In Download Engine:
const ffmpegLocation = await resolveFFmpegLocationDirectory()
// Passes: ['--ffmpeg-location', ffmpegLocation, ...] to yt-dlp
```

### Resolution Strategy:

- **Packaged Mode (`app.isPackaged === true`):**
  - Resolves to `<resourcesPath>/bin/win32-x64/<name>.exe`.
  - Checks if file exists on disk.
  - Throws classified `DownloadError` (`YT_DLP_NOT_FOUND`, `FFMPEG_NOT_FOUND`, `FFPROBE_NOT_FOUND`) if missing.
  - **Zero silent fallback** to global system binaries.
- **Development Mode (`app.isPackaged === false`):**
  - First checks if staged binary exists in `<projectRoot>/resources/bin/win32-x64/<name>.exe`.
  - If staged binary exists, uses its absolute path.
  - If not staged, falls back to `'yt-dlp'`, `'ffmpeg'`, `'ffprobe'` via system PATH for seamless developer workflow.

---

## 6. Packaging & Verification Commands

```bash
# 1. Verify staged Windows binaries, checksums, and versions
npm run verify:binaries

# 2. Build renderer and main process code via electron-vite
npm run build

# 3. Create unpacked Windows distribution in dist/win-unpacked/ (automatically runs verify:binaries first)
npm run build:unpack

# 4. Create Windows NSIS installer setup in dist/ (automatically runs verify:binaries first)
npm run build:win

# 5. Run automated Windows packaging tests (TESTS A - Z)
node --loader ./tests/loaders/electron_loader.mjs tests/windows_packaging_tests.js
```

---

## 7. Packaging Test Suite Summary (Tests A - Z)

The automated test suite `tests/windows_packaging_tests.js` verifies all 26 required scenarios:

- **TEST A:** Development mode detection (`isPackaged === false`).
- **TEST B & C:** Development `yt-dlp` and `ffprobe` resolution.
- **TEST D, E, F:** Packaged `yt-dlp.exe`, `ffmpeg.exe`, `ffprobe.exe` absolute path resolution under resources directory.
- **TEST G:** Execution in paths containing spaces (e.g. `Program Files (x86)`).
- **TEST H, I, J:** Missing packaged binary detection and classified `DownloadError` rejection without global fallback.
- **TEST K:** Packaged binary version execution (`yt-dlp --version`, `ffmpeg -version`, `ffprobe -version`).
- **TEST L:** Bundled JavaScript runtime resolution (`node.exe`) formatted as `node:<path>`.
- **TEST M:** yt-dlp `--ffmpeg-location` discovery integration.
- **TEST N & O:** MP3 and MP4 download argument preservation.
- **TEST P:** Structured progress output line parsing preservation.
- **TEST Q:** Process tree PID tracking and cancellation safety.
- **TEST R, S, T:** SQLite database initialization in writable `userData`, migrations, and native N-API module query execution.
- **TEST U & V:** Local API security middleware and preload IPC bridge preservation.
- **TEST W, X, Y:** `electron-builder.yml` `extraResources` and NSIS installer configuration integrity.
- **TEST Z:** Complete independence from global system tools in packaged mode.
