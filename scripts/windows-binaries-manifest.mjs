/**
 * ============================================================================
 * APPLAN2 — Windows Packaged Binaries Authoritative Manifest
 * Defines the immutable URLs, versions, and pinned SHA-256 checksums
 * for all external Windows x64 binaries.
 * ============================================================================
 */

export const WINDOWS_BINARIES_MANIFEST = {
  binaries: [
    {
      name: 'yt-dlp.exe',
      version: '2026.10.21',
      versionFlag: ['--version'],
      expectedVersion: '2026.10.21',
      expectedSha256: '33121D192D706E62F684A06F80918E3F3A8BA52AC3A65213B6951C39C7D9F555',
      url: 'https://github.com/yt-dlp/yt-dlp/releases/download/2026.10.21/yt-dlp.exe',
      licenseFile: 'LICENSE.yt-dlp.txt',
      licenseUrl: 'https://raw.githubusercontent.com/yt-dlp/yt-dlp/2026.10.21/LICENSE'
    },
    {
      name: 'node.exe',
      version: 'v24.14.1',
      versionFlag: ['--version'],
      expectedVersionPrefix: 'v24.',
      expectedSha256: '58E74BF02FC5BBACC41DCB8BEF089961CD5BDDD37830B87784E4FC624D145D1F',
      url: 'https://nodejs.org/dist/v24.14.1/win-x64/node.exe',
      licenseFile: 'LICENSE.node.txt',
      licenseUrl: 'https://raw.githubusercontent.com/nodejs/node/v24.14.1/LICENSE'
    },
    {
      name: 'ffmpeg.exe',
      version: '9.0.2',
      versionFlag: ['-version'],
      expectedVersionPrefix: 'ffmpeg version',
      expectedSha256: '589E50B766D251AFDF181DD664D40BD94407E200B019989FD7468C7D118A28D0',
      archiveId: 'ffmpeg-9.0.2',
      licenseFile: 'LICENSE.ffmpeg.txt',
      licenseUrl: 'https://raw.githubusercontent.com/FFmpeg/FFmpeg/master/COPYING.GPLv3'
    },
    {
      name: 'ffprobe.exe',
      version: '9.0.2',
      versionFlag: ['-version'],
      expectedVersionPrefix: 'ffprobe version',
      expectedSha256: '02264DFA4F56BAAA31E443ECE8AA16D397F6B008200E7FD184D22B9009E75FD3',
      archiveId: 'ffmpeg-9.0.2',
      licenseFile: 'LICENSE.ffmpeg.txt',
      licenseUrl: 'https://raw.githubusercontent.com/FFmpeg/FFmpeg/master/COPYING.GPLv3'
    },
    {
      name: 'send-ctrl-break.exe',
      version: '1.0.0',
      versionFlag: ['--version'],
      expectedVersionPrefix: 'send-ctrl-break version 1.0.0',
      isCompiled: true,
      sourceFile: 'src/main/backend/utils/ConsoleSender.cs'
    }
  ],
  archives: {
    'ffmpeg-9.0.2': {
      archiveUrl:
        'https://github.com/GyanD/codexffmpeg/releases/download/9.0.2/ffmpeg-9.0.2-full_build.zip',
      archiveSha256: '759D0A9831C436A0EB331AD36F236C06CB04AAA0005DA46571F0E9D3D9206F6B',
      containedBinaries: ['ffmpeg.exe', 'ffprobe.exe']
    }
  }
}
