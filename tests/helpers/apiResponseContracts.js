import assert from 'node:assert/strict'

/**
 * ============================================================================
 * APPLAN2 — Step 04.42 Response Contract Validators & Schemas
 * Lightweight, zero-dependency contract validation module verifying actual
 * Express API HTTP status codes and JSON response shapes.
 * ============================================================================
 */

/**
 * Validates Health API response contract (GET /api/health).
 * Expected: 200 OK, { status: 'ok', message: string }
 */
export function assertHealthResponse(status, body) {
  assert.equal(status, 200, 'Health endpoint must return HTTP 200')
  assert.equal(typeof body, 'object', 'Response body must be an object')
  assert.notEqual(body, null, 'Response body cannot be null')
  assert.equal(body.status, 'ok', 'status must be "ok"')
  assert.equal(typeof body.message, 'string', 'message must be a string')
  assert.ok(body.message.length > 0, 'message must not be empty')
  // Ensure no secrets or tokens leaked
  assert.equal(body.token, undefined, 'Health must not leak token')
  assert.equal(body.path, undefined, 'Health must not leak system paths')
}

/**
 * Validates Media Analyzer success response contract (POST /api/media/analyze).
 */
export function assertMediaAnalyzeResponse(status, body) {
  assert.equal(status, 200, 'Media analyze success must return HTTP 200')
  assert.equal(body.success, true, 'success field must be true')
  assert.equal(typeof body.data, 'object', 'data must be an object')
  assert.notEqual(body.data, null, 'data cannot be null')

  const { data } = body
  assert.ok(
    Number.isInteger(data.mediaItemId) && data.mediaItemId > 0,
    'mediaItemId must be positive integer'
  )
  assert.equal(typeof data.id, 'string', 'id must be a string')
  assert.equal(typeof data.platform, 'string', 'platform must be a string')
  assert.ok(
    ['youtube', 'facebook', 'instagram', 'tiktok', 'twitter'].includes(data.platform),
    'platform must be one of 5 supported platforms'
  )
  assert.equal(typeof data.sourceUrl, 'string', 'sourceUrl must be string')
  assert.equal(typeof data.title, 'string', 'title must be string')
  assert.ok(
    data.thumbnailUrl === null || typeof data.thumbnailUrl === 'string',
    'thumbnailUrl must be string or null'
  )
  assert.ok(
    data.durationSeconds === null || Number.isInteger(data.durationSeconds),
    'durationSeconds must be integer or null'
  )

  assert.ok(Array.isArray(data.videoQualities), 'videoQualities must be an array')
  assert.ok(Array.isArray(data.audioOptions), 'audioOptions must be an array')
  assert.equal(typeof data.availableFormats, 'object', 'availableFormats must be an object')
  assert.ok(
    Array.isArray(data.availableFormats.mp4Qualities),
    'availableFormats.mp4Qualities must be an array'
  )
  assert.ok(
    Array.isArray(data.availableFormats.mp4Formats),
    'availableFormats.mp4Formats must be an array'
  )
  assert.ok(
    Array.isArray(data.availableFormats.audioFormats),
    'availableFormats.audioFormats must be an array'
  )
}

/**
 * Validates Download Job Creation response contract (POST /api/downloads).
 */
export function assertDownloadCreateResponse(status, body, expectDuplicate = false) {
  if (expectDuplicate) {
    assert.equal(status, 200, 'Duplicate active download creation must return HTTP 200')
    assert.equal(body.success, true, 'success must be true')
    assert.ok(body.duplicate === true || body.isDuplicate === true, 'duplicate flag must be true')
    assert.equal(typeof body.message, 'string', 'message must explain active duplicate')
  } else {
    assert.equal(status, 201, 'New download job creation must return HTTP 201')
    assert.equal(body.success, true, 'success must be true')
  }

  assert.equal(typeof body.data, 'object', 'data must be an object')
  const { data } = body
  const id = data.id ?? data.jobId
  assert.ok(Number.isInteger(id) && id > 0, 'job id must be a positive integer')
  assert.ok(['queued', 'downloading'].includes(data.status), 'status must be queued or downloading')

  const format = data.output_format ?? data.outputFormat
  assert.ok(['mp4', 'mp3'].includes(format), 'outputFormat must be mp4 or mp3')

  if (format === 'mp4') {
    assert.equal(typeof data.quality, 'string', 'MP4 quality must be a string')
    assert.ok(/^\d+p$/.test(data.quality), 'quality must match resolution pattern e.g. 720p')
  } else {
    const bitrate = data.audio_bitrate_kbps ?? data.audioBitrateKbps
    assert.ok([128, 192, 320].includes(bitrate), 'MP3 bitrate must be 128, 192, or 320')
  }
}

/**
 * Validates Download History listing response contract (GET /api/downloads).
 */
export function assertDownloadHistoryResponse(status, body) {
  assert.equal(status, 200, 'Download history list must return HTTP 200')
  assert.equal(body.success, true, 'success must be true')
  assert.ok(Array.isArray(body.data), 'data must be an array')

  for (const item of body.data) {
    assert.ok(Number.isInteger(item.id) && item.id > 0, 'history item id must be positive integer')
    assert.ok(
      ['queued', 'downloading', 'completed', 'failed', 'cancelled'].includes(item.status),
      `invalid status: ${item.status}`
    )
    assert.ok(['mp4', 'mp3'].includes(item.output_format), 'output_format must be mp4 or mp3')
    assert.ok(typeof item.progress === 'number', 'progress must be number')
    assert.ok(typeof item.downloaded_bytes === 'number', 'downloaded_bytes must be number')
    assert.ok(
      item.total_bytes === undefined ||
        item.total_bytes === null ||
        typeof item.total_bytes === 'number',
      'total_bytes must be number, null, or undefined'
    )
    assert.ok(
      item.error_message === null || typeof item.error_message === 'string',
      'error_message must be string or null'
    )
    const createdAt = item.created_at ?? item.createdAt
    assert.ok(typeof createdAt === 'string', 'created_at or createdAt must be string timestamp')
    const updatedAt = item.updated_at ?? item.updatedAt
    assert.ok(typeof updatedAt === 'string', 'updated_at or updatedAt must be string timestamp')

    if (item.media) {
      assert.equal(typeof item.media, 'object', 'media must be object if present')
      assert.equal(typeof item.media.title, 'string', 'media.title must be string')
      assert.equal(typeof item.media.source_url, 'string', 'media.source_url must be string')
    }

    if (item.file) {
      assert.equal(typeof item.file, 'object', 'file must be object if present')
      assert.equal(typeof item.file.file_name, 'string', 'file.file_name must be string')
      assert.ok(
        ['mp4', 'mp3'].includes(item.file.file_format),
        'file.file_format must be mp4 or mp3'
      )
    }
  }
}

/**
 * Validates Job Details response contract (GET /api/downloads/:id).
 */
export function assertJobDetailsResponse(status, body) {
  assert.equal(status, 200, 'Job details must return HTTP 200')
  assert.equal(body.success, true, 'success must be true')
  assert.equal(typeof body.data, 'object', 'data must be object')
  assert.notEqual(body.data, null, 'data cannot be null')

  const { job, file } = body.data
  assert.equal(typeof job, 'object', 'job must be object')
  assert.ok(Number.isInteger(job.id) && job.id > 0, 'job.id must be positive integer')
  assert.ok(
    ['queued', 'downloading', 'completed', 'failed', 'cancelled'].includes(job.status),
    'job.status must be valid status'
  )
  assert.ok(['mp4', 'mp3'].includes(job.output_format), 'job.output_format must be mp4 or mp3')
  assert.ok(file === null || typeof file === 'object', 'file must be object or null')

  if (file) {
    assert.ok(Number.isInteger(file.id) && file.id > 0, 'file.id must be positive integer')
    assert.equal(typeof file.file_name, 'string', 'file.file_name must be string')
  }
}

/**
 * Validates Cancel Job response contract (POST /api/downloads/:id/cancel).
 */
export function assertCancelResponse(status, body) {
  assert.ok([200, 202].includes(status), 'Cancel response status must be HTTP 200 or 202')
  assert.equal(body.success, true, 'success must be true')
  if (body.data) {
    assert.ok(
      ['cancelled', 'cancellation_requested'].includes(body.data.status),
      'data.status must be cancelled or cancellation_requested'
    )
    assert.equal(typeof body.data.message, 'string', 'data.message must be string')
  } else {
    assert.ok(
      ['cancelled', 'downloading'].includes(body.status),
      'status must be cancelled or downloading'
    )
    assert.equal(typeof body.message, 'string', 'message must be string')
  }
}

/**
 * Validates Retry Job response contract (POST /api/downloads/:id/retry).
 */
export function assertRetryResponse(status, body) {
  assert.equal(status, 201, 'Successful retry must return HTTP 201')
  assert.equal(body.success, true, 'success must be true')
  assert.equal(typeof body.data, 'object', 'data must be object')
  const { data } = body
  assert.ok(
    Number.isInteger(data.originalJobId) && data.originalJobId > 0,
    'originalJobId must be positive integer'
  )
  assert.ok(
    Number.isInteger(data.retryJobId) && data.retryJobId > 0,
    'retryJobId must be positive integer'
  )
  assert.ok(['queued', 'downloading'].includes(data.status), 'status must be queued or downloading')
  assert.equal(typeof data.message, 'string', 'message must be string')
}

/**
 * Validates Settings GET response contract (GET /api/settings/downloads).
 */
export function assertSettingsGetResponse(status, body) {
  assert.equal(status, 200, 'Settings GET must return HTTP 200')
  assert.equal(body.success, true, 'success must be true')
  assert.equal(typeof body.data, 'object', 'data must be object')

  const { data } = body
  assert.equal(typeof data.downloadPath, 'string', 'downloadPath must be string')
  assert.ok(data.downloadPath.length > 0, 'downloadPath must not be empty')
  assert.ok(['mp4', 'mp3'].includes(data.defaultFormat), 'defaultFormat must be mp4 or mp3')
  assert.ok(typeof data.preferredMp4Quality === 'string', 'preferredMp4Quality must be string')
  assert.ok(
    [128, 192, 320].includes(data.preferredMp3BitrateKbps),
    'preferredMp3BitrateKbps must be 128, 192, or 320'
  )
}

/**
 * Validates Settings PATCH response contract (PATCH /api/settings/downloads).
 */
export function assertSettingsPatchResponse(status, body) {
  assert.equal(status, 200, 'Settings PATCH must return HTTP 200')
  assert.equal(body.success, true, 'success must be true')
  assert.equal(typeof body.data, 'object', 'data must be object')
  assertSettingsGetResponse(200, { success: true, data: body.data })
}

/**
 * Validates History Delete response contract (DELETE /api/downloads/:id).
 */
export function assertHistoryDeleteResponse(status, body) {
  assert.equal(status, 200, 'History single delete must return HTTP 200')
  assert.equal(body.success, true, 'success must be true')
  assert.equal(typeof body.message, 'string', 'message must be string')
  if (body.data) {
    assert.equal(typeof body.data, 'object', 'data must be an object')
    assert.equal(body.data.deleted, true, 'data.deleted must be true')
  }
}

/**
 * Validates History Clear response contract (DELETE /api/downloads/history).
 */
export function assertHistoryClearResponse(status, body) {
  assert.equal(status, 200, 'History clear must return HTTP 200')
  assert.equal(body.success, true, 'success must be true')
  assert.equal(typeof body.message, 'string', 'message must be string')
  if (body.data) {
    assert.equal(typeof body.data.deletedJobs, 'number', 'deletedJobs must be number')
    assert.ok(body.data.deletedJobs >= 0, 'deletedJobs cannot be negative')
  } else if ('deletedCount' in body) {
    assert.ok(typeof body.deletedCount === 'number', 'deletedCount must be number')
    assert.ok(body.deletedCount >= 0, 'deletedCount cannot be negative')
  }
}

/**
 * Validates 401 Unauthorized error response contract.
 */
export function assertUnauthorizedResponse(status, body) {
  assert.equal(status, 401, 'Unauthorized request must return HTTP 401')
  assert.equal(body.success, false, 'success must be false')
  assert.equal(
    body.message,
    'Unauthorized API request',
    'message must match standard auth error message'
  )
}

/**
 * Validates 403 Forbidden error response contract (Disallowed Host or Origin).
 */
export function assertForbiddenResponse(status, body) {
  assert.equal(status, 403, 'Forbidden request must return HTTP 403')
  assert.equal(body.success, false, 'success must be false')
  assert.equal(typeof body.message, 'string', 'message must be string')
  assert.ok(
    body.message.includes('Host') ||
      body.message.includes('CORS') ||
      body.message.includes('Forbidden'),
    'message must indicate Host or CORS violation'
  )
}

/**
 * Validates 400 Bad Request validation error response contract.
 */
export function assertValidationErrorResponse(status, body) {
  assert.equal(status, 400, 'Bad Request must return HTTP 400')
  assert.equal(body.success, false, 'success must be false')
  assert.equal(typeof body.message, 'string', 'message must be descriptive string')
  assert.ok(body.message.length > 0, 'message must not be empty')
}

/**
 * Validates 404 Not Found error response contract.
 */
export function assertNotFoundResponse(status, body) {
  assert.equal(status, 404, 'Not Found must return HTTP 404')
  // Controller responses use { success: false, message: ... }
  // Unknown route handler uses { status: 'error', message: ... }
  if ('success' in body) {
    assert.equal(body.success, false)
  } else if ('status' in body) {
    assert.equal(body.status, 'error')
  }
  assert.equal(typeof body.message, 'string', 'message must be string')
}

/**
 * Validates 409 Conflict error response contract (Active job / duplicate guard).
 */
export function assertConflictResponse(status, body) {
  assert.equal(status, 409, 'Conflict must return HTTP 409')
  assert.equal(body.success, false, 'success must be false')
  assert.equal(typeof body.message, 'string', 'message must be string')
}

/**
 * Validates 500 Internal Server Error response contract.
 */
export function assertInternalErrorResponse(status, body) {
  assert.equal(status, 500, 'Internal Server Error must return HTTP 500')
  assert.equal(body.status, 'error', 'status must be "error"')
  assert.equal(body.message, 'Internal server error', 'message must be generic safe message')
  // Ensure no stack trace or SQL leaked to client
  assert.equal(body.stack, undefined, 'Stack trace must not be exposed')
  assert.equal(body.sql, undefined, 'SQL statement must not be exposed')
}
