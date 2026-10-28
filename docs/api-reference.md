# Multi-Platform Media Downloader — API Reference

## 1. Overview & Architecture

The **Multi-Platform Media Downloader** runs a dedicated desktop-local Express API server bound strictly to the IPv4 loopback interface:

```
http://127.0.0.1:3001
```

### Architecture Summary

```
+-------------------------------------------------------------------+
|                     Electron Desktop Application                  |
|                                                                   |
|   +-------------------+                     +-----------------+   |
|   |   React UI        |  window.api.request |  Electron Main  |   |
|   |  (Renderer/Views) | ------------------> |  (IPC Bridge)   |   |
|   +-------------------+                     +-----------------+   |
|                                                      |            |
|                                                      | Local HTTP |
|                                                      | + Bearer   |
|                                                      v            |
|                                             +-----------------+   |
|                                             |   Express API   |   |
|                                             | 127.0.0.1:3001  |   |
|                                             +-----------------+   |
|                                               |      |      |     |
|                                               v      v      v     |
|                                            SQLite  yt-dlp FFmpeg  |
+-------------------------------------------------------------------+
```

- **Loopback Binding:** Listening strictly on `127.0.0.1:3001` (never `0.0.0.0`).
- **Host Header Validation:** Strict host allowlist (`127.0.0.1:3001`, `localhost:3001`, `127.0.0.1`, `localhost`) to defeat DNS rebinding and host confusion attacks.
- **CORS Protection:** Rejects unauthorized browser origins; only permits approved local development origins (`http://localhost:5173`, `http://127.0.0.1:5173`).
- **Authentication:** All sensitive application endpoints require a high-entropy 256-bit session token transmitted via HTTP `Authorization: Bearer <token>`.
- **Preload & Main Process Bridge:** Electron's preload exposes a safe IPC channel (`api:request`) that automatically injects the session token in the Main process, preventing token exposure to renderer DOM globals.

---

## 2. Authentication Contract

### Header Specification

For all endpoints marked as **Protected**, clients must include:

```http
Authorization: Bearer <session-token>
```

- **Token Lifecycle:** Cryptographically generated via `crypto.randomBytes(32)` at application startup and stored exclusively in RAM.
- **Token Format:** 64-character hexadecimal string.
- **Constant-Time Verification:** Verified using `crypto.timingSafeEqual` to prevent side-channel timing attacks.
- **Missing or Invalid Token Response:** Returns `401 Unauthorized`:
  ```json
  {
    "success": false,
    "message": "Unauthorized API request"
  }
  ```

### Development & Postman Configuration

In local development environments only (`process.env.NODE_ENV !== 'production'`), developers can optionally supply a custom strong session token via an environment variable before starting Electron:

```powershell
$env:APPLAN2_DEV_API_TOKEN="my_custom_dev_session_token_32_characters_minimum"
npm run dev
```

> **Security Note:** In packaged production builds, `APPLAN2_DEV_API_TOKEN` is strictly ignored and high-entropy random tokens are unconditionally generated.

---

## 3. Endpoints Inventory

| HTTP Method | Route Path                  |  Auth Required  | Purpose                                                              |
| :---------- | :-------------------------- | :-------------: | :------------------------------------------------------------------- |
| `GET`       | `/api/health`               | **No** (Public) | Minimal loopback server health status                                |
| `POST`      | `/api/media/analyze`        |     **Yes**     | Validate media URL and extract format metadata                       |
| `POST`      | `/api/downloads`            |     **Yes**     | Create and enqueue a new download job (or retrieve active duplicate) |
| `GET`       | `/api/downloads`            |     **Yes**     | List download history with filtering and pagination                  |
| `GET`       | `/api/downloads/:id`        |     **Yes**     | Retrieve detailed status and file record for a single download job   |
| `POST`      | `/api/downloads/:id/cancel` |     **Yes**     | Cancel a queued or currently executing download job                  |
| `POST`      | `/api/downloads/:id/retry`  |     **Yes**     | Retry a failed or cancelled download job                             |
| `DELETE`    | `/api/downloads/:id`        |     **Yes**     | Delete a terminal download history record from SQLite                |
| `DELETE`    | `/api/downloads/history`    |     **Yes**     | Bulk clear terminal download history records                         |
| `GET`       | `/api/settings/downloads`   |     **Yes**     | Get current download settings and preferences                        |
| `PATCH`     | `/api/settings/downloads`   |     **Yes**     | Update download folder, default format, or quality preferences       |

---

## 4. Endpoint Specifications

### 4.1 Health Check

```http
GET /api/health
```

- **Authentication:** Unauthenticated (Public on loopback).
- **Request Headers:** None.
- **Response (200 OK):**
  ```json
  {
    "status": "ok",
    "message": "Multi Media Downloader API is running"
  }
  ```
- **Security Guarantees:** Returns zero secrets, no tokens, no database data, and no local paths.

---

### 4.2 Analyze Media

```http
POST /api/media/analyze
```

- **Authentication:** Required (`Bearer <token>`).
- **Request Headers:** `Content-Type: application/json`
- **Request Body:**
  ```json
  {
    "url": "https://www.youtube.com/watch?v=dQw4w9WgXcQ"
  }
  ```
  - `url` (_string_, required): Valid media URL belonging to one of the 5 supported platforms (`youtube`, `facebook`, `instagram`, `tiktok`, `twitter`). Must be $\le 2048$ characters.
- **Success Response (200 OK):**
  ```json
  {
    "success": true,
    "data": {
      "id": "dQw4w9WgXcQ",
      "platform": "youtube",
      "sourceUrl": "https://www.youtube.com/watch?v=dQw4w9WgXcQ",
      "title": "Rick Astley - Never Gonna Give You Up (Official Music Video)",
      "thumbnailUrl": "https://i.ytimg.com/vi/dQw4w9WgXcQ/maxresdefault.jpg",
      "durationSeconds": 212,
      "videoQualities": ["1080p", "720p", "480p", "360p"],
      "audioOptions": ["mp3"],
      "availableFormats": {
        "mp4Qualities": ["1080p", "720p", "480p", "360p"],
        "mp4Formats": [
          {
            "formatId": "137",
            "quality": "1080p",
            "height": 1080,
            "videoCodec": "avc1.640028",
            "audioIncluded": false,
            "fileSize": 50000000
          }
        ],
        "audioFormats": [
          {
            "formatId": "140",
            "extension": "m4a",
            "audioCodec": "mp4a.40.2",
            "fileSize": 3500000
          }
        ]
      },
      "mediaItemId": 1
    }
  }
  ```
- **Error Responses:**
  - `400 Bad Request`: Invalid URL, unsupported scheme (`file://`, `ftp://`), loopback/private destination (`127.0.0.1`, `localhost`), credentials in URL, or nonstandard port.
  - `401 Unauthorized`: Missing or invalid Bearer token.
  - `403 Forbidden`: Disallowed Host header or CORS origin.
  - `500 Internal Server Error`: yt-dlp metadata extraction process failure.

---

### 4.3 Create Download Job

```http
POST /api/downloads
```

- **Authentication:** Required (`Bearer <token>`).
- **Request Headers:** `Content-Type: application/json`
- **Request Body (MP4):**
  ```json
  {
    "mediaItemId": 1,
    "outputFormat": "mp4",
    "quality": "1080p"
  }
  ```
- **Request Body (MP3):**
  ```json
  {
    "mediaItemId": 1,
    "outputFormat": "mp3",
    "audioBitrateKbps": 320
  }
  ```
  - `mediaItemId` (_integer_, required): Positive integer referring to an existing `MediaItem`.
  - `outputFormat` (_string_, required): `"mp4"` or `"mp3"`.
  - `quality` (_string_, required if `outputFormat === "mp4"`): Video resolution matching `^\d+p$` (e.g. `"1080p"`, `"720p"`).
  - `audioBitrateKbps` (_integer_, required if `outputFormat === "mp3"`): Allowed bitrates: `128`, `192`, or `320`.
- **Success Response — New Job Created (201 Created):**
  ```json
  {
    "success": true,
    "data": {
      "id": 12,
      "media_id": 1,
      "output_format": "mp4",
      "quality": "1080p",
      "audio_bitrate_kbps": null,
      "status": "queued",
      "progress": 0,
      "downloaded_bytes": 0,
      "error_message": null,
      "created_at": "2026-10-29T04:00:00.000Z",
      "updated_at": "2026-10-29T04:00:00.000Z"
    }
  }
  ```
- **Success Response — Active Duplicate Reused (200 OK):**
  ```json
  {
    "success": true,
    "duplicate": true,
    "message": "An equivalent download is already queued or running",
    "data": {
      "id": 12,
      "media_id": 1,
      "output_format": "mp4",
      "quality": "1080p",
      "audio_bitrate_kbps": null,
      "status": "downloading",
      "progress": 25.5,
      "downloaded_bytes": 10485760,
      "error_message": null,
      "created_at": "2026-10-29T04:00:00.000Z",
      "updated_at": "2026-10-29T04:00:15.000Z"
    }
  }
  ```
- **Error Responses:**
  - `400 Bad Request`: Invalid request fields, unsupported video quality, or unsafe stored source URL.
  - `404 Not Found`: `mediaItemId` does not exist in SQLite database.

---

### 4.4 List Download History

```http
GET /api/downloads
```

- **Authentication:** Required (`Bearer <token>`).
- **Query Parameters:**
  - `status` (_string_, optional): Filter by job status (`queued`, `downloading`, `completed`, `failed`, `cancelled`).
  - `outputFormat` (_string_, optional): Filter by format (`mp4`, `mp3`).
  - `sourceType` (_string_, optional): Filter by source type (`link`).
  - `from` (_string_, optional): ISO-8601 date boundary (`YYYY-MM-DD` or full ISO timestamp).
  - `to` (_string_, optional): ISO-8601 date boundary (`YYYY-MM-DD` or full ISO timestamp).
  - `limit` (_integer_, optional, default: 20, max: 100): Maximum records to return.
  - `offset` (_integer_, optional, default: 0): Number of records to skip.
- **Success Response (200 OK):**
  ```json
  {
    "success": true,
    "data": [
      {
        "id": 12,
        "status": "completed",
        "output_format": "mp4",
        "quality": "1080p",
        "audio_bitrate_kbps": null,
        "progress": 100,
        "downloaded_bytes": 52428800,
        "total_bytes": 52428800,
        "error_message": null,
        "created_at": "2026-10-29T04:00:00.000Z",
        "updated_at": "2026-10-29T04:01:30.000Z",
        "media": {
          "id": 1,
          "title": "Rick Astley - Never Gonna Give You Up",
          "source_url": "https://www.youtube.com/watch?v=dQw4w9WgXcQ",
          "platform": "youtube",
          "thumbnail_url": "https://i.ytimg.com/vi/dQw4w9WgXcQ/maxresdefault.jpg",
          "duration_seconds": 212
        },
        "file": {
          "id": 5,
          "file_name": "Rick Astley [dQw4w9WgXcQ] [1080p] [job-12].mp4",
          "file_format": "mp4",
          "file_size": 52428800,
          "storage_path": "C:\\Users\\user\\Downloads\\Rick Astley [dQw4w9WgXcQ] [1080p] [job-12].mp4",
          "file_status": "present"
        }
      }
    ]
  }
  ```

---

### 4.5 Get Job Details

```http
GET /api/downloads/:id
```

- **Authentication:** Required (`Bearer <token>`).
- **Path Parameters:** `id` (_integer_, required): Download Job ID.
- **Success Response (200 OK):**
  ```json
  {
    "success": true,
    "data": {
      "job": {
        "id": 12,
        "status": "completed",
        "progress": 100,
        "downloaded_bytes": 52428800,
        "total_bytes": 52428800,
        "output_format": "mp4",
        "quality": "1080p",
        "audio_bitrate_kbps": null,
        "error_message": null,
        "created_at": "2026-10-29T04:00:00.000Z",
        "updated_at": "2026-10-29T04:01:30.000Z"
      },
      "file": {
        "id": 5,
        "file_name": "Rick Astley [dQw4w9WgXcQ] [1080p] [job-12].mp4",
        "file_format": "mp4",
        "file_size": 52428800,
        "storage_path": "C:\\Users\\user\\Downloads\\Rick Astley [dQw4w9WgXcQ] [1080p] [job-12].mp4",
        "created_at": "2026-10-29T04:01:30.000Z"
      }
    }
  }
  ```
- **Error Responses:**
  - `400 Bad Request`: Invalid Job ID format.
  - `404 Not Found`: Job does not exist.

---

### 4.6 Cancel Download Job

```http
POST /api/downloads/:id/cancel
```

- **Authentication:** Required (`Bearer <token>`).
- **Path Parameters:** `id` (_integer_, required): Download Job ID.
- **Success Response — Queued Cancellation (200 OK):**
  ```json
  {
    "success": true,
    "data": {
      "id": 12,
      "status": "cancelled",
      "message": "Download cancelled successfully"
    }
  }
  ```
- **Success Response — Running Cancellation Requested (202 Accepted):**
  ```json
  {
    "success": true,
    "data": {
      "id": 12,
      "status": "cancellation_requested",
      "message": "Download cancellation is in progress"
    }
  }
  ```
- **Error Responses:**
  - `404 Not Found`: Job not found.
  - `409 Conflict`: Job is already terminal (`completed` or `failed`) and cannot be cancelled.

---

### 4.7 Retry Download Job

```http
POST /api/downloads/:id/retry
```

- **Authentication:** Required (`Bearer <token>`).
- **Path Parameters:** `id` (_integer_, required): Original failed or cancelled Job ID.
- **Success Response (201 Created):**
  ```json
  {
    "success": true,
    "data": {
      "originalJobId": 12,
      "retryJobId": 15,
      "status": "queued",
      "message": "Download retry job created successfully"
    }
  }
  ```
- **Error Responses:**
  - `400 Bad Request`: Stored source URL failed security validation.
  - `404 Not Found`: Original job or related media not found.
  - `409 Conflict`: Job is not in a retryable state (e.g. already `queued`, `downloading`, or `completed`), or a retry is already in progress.

---

### 4.8 Delete Single History Record

```http
DELETE /api/downloads/:id
```

- **Authentication:** Required (`Bearer <token>`).
- **Path Parameters:** `id` (_integer_, required): Terminal Job ID.
- **Success Response (200 OK):**
  ```json
  {
    "success": true,
    "data": {
      "id": 12,
      "deleted": true,
      "physicalFileDeleted": false
    },
    "message": "Download history record deleted"
  }
  ```
- **Important Note:** Deleting a history record deletes the SQLite database entry only; **it never deletes physical downloaded files from disk**.
- **Error Responses:**
  - `404 Not Found`: Record not found.
  - `409 Conflict`: Cannot delete an active (`queued` or `downloading`) download.

---

### 4.9 Clear Download History (Bulk)

```http
DELETE /api/downloads/history
```

- **Authentication:** Required (`Bearer <token>`).
- **Request Headers:** `Content-Type: application/json`
- **Request Body:**
  ```json
  {
    "confirm": true,
    "statuses": ["completed", "failed", "cancelled"]
  }
  ```
  - `confirm` (_boolean_, required): Must be strictly `true`.
  - `statuses` (_array_, required): Array of terminal statuses to clear (`completed`, `failed`, `cancelled`).
- **Success Response (200 OK):**
  ```json
  {
    "success": true,
    "data": {
      "deletedJobs": 4,
      "physicalFilesDeleted": 0
    },
    "message": "Selected download history records cleared"
  }
  ```
- **Error Responses:**
  - `400 Bad Request`: Missing `confirm: true` or invalid status filters specified.

---

### 4.10 Get Download Settings

```http
GET /api/settings/downloads
```

- **Authentication:** Required (`Bearer <token>`).
- **Success Response (200 OK):**
  ```json
  {
    "success": true,
    "data": {
      "downloadPath": "C:\\Users\\user\\Downloads",
      "defaultFormat": "mp4",
      "preferredMp4Quality": "1080p",
      "preferredMp3BitrateKbps": 320
    }
  }
  ```

---

### 4.11 Update Download Settings

```http
PATCH /api/settings/downloads
```

- **Authentication:** Required (`Bearer <token>`).
- **Request Headers:** `Content-Type: application/json`
- **Request Body (Partial updates permitted):**
  ```json
  {
    "downloadPath": "D:\\Media\\Downloads",
    "defaultFormat": "mp3",
    "preferredMp3BitrateKbps": 320
  }
  ```
- **Success Response (200 OK):**
  ```json
  {
    "success": true,
    "data": {
      "downloadPath": "D:\\Media\\Downloads",
      "defaultFormat": "mp3",
      "preferredMp4Quality": "1080p",
      "preferredMp3BitrateKbps": 320
    }
  }
  ```
- **Error Responses:**
  - `400 Bad Request`: Invalid path, non-existent folder, read-only directory, or invalid format/quality enum.
  - `409 Conflict`: Cannot change `downloadPath` while active downloads (`queued` or `downloading`) exist.

---

## 5. Standard Error Envelopes

### Client & Business Logic Errors (4xx)

```json
{
  "success": false,
  "message": "Human-readable descriptive error explanation"
}
```

### Security & Authentication Errors (401 / 403)

```json
{
  "success": false,
  "message": "Unauthorized API request"
}
```

### Server-Level & Unhandled Errors (500)

```json
{
  "status": "error",
  "message": "Internal server error"
}
```

---

## 6. How to Run Automated Contract Tests

Execute the automated contract test suite with the isolated Electron mock loader:

```bash
node --loader file:///C:/Users/hvpmj/.gemini/antigravity/brain/9a69517e-1cad-4889-9340-cb25557cd165/scratch/electron_mock_loader.mjs tests/api_contract_tests.js
```
