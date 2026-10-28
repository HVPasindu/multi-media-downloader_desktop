import { getDatabase } from '../config/database.js'
import { withCompletionWriteLock } from './downloadService.js'
import { lstat, stat } from 'node:fs/promises'
import path from 'node:path'
import { Op, Transaction } from 'sequelize'

// Allowed terminal statuses for deletion operations
export const TERMINAL_JOB_STATUSES = Object.freeze(['completed', 'failed', 'cancelled'])

// All valid job statuses recognized by the system
export const VALID_JOB_STATUSES = Object.freeze([
  'queued',
  'downloading',
  'completed',
  'failed',
  'cancelled'
])

// Allowed output formats
export const VALID_OUTPUT_FORMATS = Object.freeze(['mp4', 'mp3'])

// Allowed source types
export const VALID_SOURCE_TYPES = Object.freeze(['link'])

/**
 * Lightweight helper to run mapped async tasks with a bounded concurrency pool.
 *
 * @param {Array<T>} items
 * @param {(item: T, index: number) => Promise<R>} fn
 * @param {number} [concurrency=10]
 * @returns {Promise<Array<R>>}
 */
async function pMap(items, fn, concurrency = 10) {
  if (!Array.isArray(items) || items.length === 0) {
    return []
  }

  const results = new Array(items.length)
  let currentIndex = 0

  const worker = async () => {
    while (currentIndex < items.length) {
      const idx = currentIndex++
      results[idx] = await fn(items[idx], idx)
    }
  }

  const poolSize = Math.min(concurrency, items.length)
  const workers = Array.from({ length: poolSize }, () => worker())
  await Promise.all(workers)

  return results
}

/**
 * Performs a lightweight, safe filesystem check to determine whether the downloaded
 * media file is currently available, missing, or inaccessible.
 *
 * @param {string|null} filePath - Recorded final output file path
 * @param {string} jobStatus - DownloadJob status
 * @returns {Promise<'available'|'missing'|'unavailable'|'not_recorded'|'not_applicable'>}
 */
export async function checkFileAvailability(filePath, jobStatus) {
  // If the job did not finish successfully, file availability verification is not applicable
  if (jobStatus !== 'completed') {
    return 'not_applicable'
  }

  // If a completed job has no recorded output file path in SQLite
  if (typeof filePath !== 'string' || !filePath.trim()) {
    return 'not_recorded'
  }

  const trimmed = filePath.trim()

  // Output paths must be absolute
  if (!path.isAbsolute(trimmed)) {
    return 'unavailable'
  }

  const cleanPath = path.resolve(trimmed)

  // Symlink/junction safety: check lstat to avoid following arbitrary or broken symlinks
  try {
    const lstatInfo = await lstat(cleanPath)
    if (lstatInfo.isSymbolicLink()) {
      return 'unavailable'
    }
  } catch (lstatErr) {
    if (lstatErr.code === 'ENOENT' || lstatErr.code === 'ENOTDIR') {
      return 'missing'
    }
    if (['EACCES', 'EPERM'].includes(lstatErr.code)) {
      return 'unavailable'
    }
    return 'unavailable'
  }

  // Check regular file existence, non-emptiness, and read accessibility
  try {
    const fileStats = await stat(cleanPath)
    if (!fileStats.isFile() || fileStats.size <= 0) {
      return 'unavailable'
    }
    return 'available'
  } catch (statErr) {
    if (statErr.code === 'ENOENT' || statErr.code === 'ENOTDIR') {
      return 'missing'
    }
    if (['EACCES', 'EPERM'].includes(statErr.code)) {
      return 'unavailable'
    }
    return 'unavailable'
  }
}

/**
 * Strictly parses and validates an input date string against real calendar dates,
 * enforcing valid year, month, days-in-month, and leap years, while supporting
 * both date-only (YYYY-MM-DD) and full ISO-8601 date-time formats.
 *
 * @param {string} input - Raw date string
 * @param {boolean} [isEndOfDay=false] - If true and date-only, set time to 23:59:59.999Z
 * @returns {Date|null} Parsed Date or null if invalid
 */
export function parseStrictHistoryDate(input, isEndOfDay = false) {
  if (typeof input !== 'string') return null
  const str = input.trim()
  if (!str) return null

  // 1. Strict date-only format: YYYY-MM-DD
  const dateOnlyMatch = /^(\d{4})-(\d{2})-(\d{2})$/.exec(str)
  if (dateOnlyMatch) {
    const year = Number(dateOnlyMatch[1])
    const month = Number(dateOnlyMatch[2])
    const day = Number(dateOnlyMatch[3])

    if (month < 1 || month > 12) return null
    const maxDays = new Date(Date.UTC(year, month, 0)).getUTCDate()
    if (day < 1 || day > maxDays) return null

    if (isEndOfDay) {
      return new Date(Date.UTC(year, month - 1, day, 23, 59, 59, 999))
    }
    return new Date(Date.UTC(year, month - 1, day, 0, 0, 0, 0))
  }

  // 2. Strict full ISO-8601 timestamp: YYYY-MM-DDTHH:mm:ss(.sss)?(Z|[+-]HH:mm)?
  const isoMatch =
    /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.\d+)?(?:Z|[+-]\d{2}:?\d{2})?$/i.exec(str)
  if (isoMatch) {
    const year = Number(isoMatch[1])
    const month = Number(isoMatch[2])
    const day = Number(isoMatch[3])
    const hour = Number(isoMatch[4])
    const minute = Number(isoMatch[5])
    const second = Number(isoMatch[6])

    if (month < 1 || month > 12) return null
    const maxDays = new Date(Date.UTC(year, month, 0)).getUTCDate()
    if (day < 1 || day > maxDays) return null
    if (hour > 23 || minute > 59 || second > 59) return null

    const parsed = new Date(str)
    if (Number.isNaN(parsed.getTime())) return null
    return parsed
  }

  return null
}

/**
 * Validates and normalizes history query parameters.
 *
 * @param {object} query - Express req.query
 * @returns {{
 *   isValid: boolean,
 *   errors: Record<string, string>,
 *   normalized: {
 *     status: string|null,
 *     outputFormat: string|null,
 *     sourceType: string|null,
 *     fromDate: Date|null,
 *     toDate: Date|null,
 *     limit: number,
 *     offset: number
 *   }
 * }}
 */
export function validateHistoryFilters(query = {}) {
  const errors = {}

  let status = null
  let outputFormat = null
  let sourceType = null
  let fromDate = null
  let toDate = null
  let limit = 50
  let offset = 0

  // 1. Status filter
  if ('status' in query && query.status !== undefined && query.status !== null) {
    const val = String(query.status).trim().toLowerCase()
    if (!VALID_JOB_STATUSES.includes(val)) {
      errors.status = `Invalid status filter "${val}". Allowed values: ${VALID_JOB_STATUSES.join(', ')}`
    } else {
      status = val
    }
  }

  // 2. Output format filter
  if ('outputFormat' in query && query.outputFormat !== undefined && query.outputFormat !== null) {
    const val = String(query.outputFormat).trim().toLowerCase()
    if (!VALID_OUTPUT_FORMATS.includes(val)) {
      errors.outputFormat = `Invalid outputFormat filter "${val}". Allowed values: ${VALID_OUTPUT_FORMATS.join(', ')}`
    } else {
      outputFormat = val
    }
  }

  // 3. Source type filter
  if ('sourceType' in query && query.sourceType !== undefined && query.sourceType !== null) {
    const val = String(query.sourceType).trim().toLowerCase()
    if (!VALID_SOURCE_TYPES.includes(val)) {
      errors.sourceType = `Invalid sourceType filter "${val}". Allowed values: ${VALID_SOURCE_TYPES.join(', ')}`
    } else {
      sourceType = val
    }
  }

  // 4. Date range filters ("from" and "to")
  if ('from' in query && query.from !== undefined && query.from !== null) {
    const rawFrom = String(query.from).trim()
    if (!rawFrom) {
      errors.from = 'The "from" date parameter cannot be empty'
    } else {
      const parsed = parseStrictHistoryDate(rawFrom, false)

      if (!parsed || Number.isNaN(parsed.getTime())) {
        errors.from = 'Invalid "from" date format. Use ISO format (e.g. YYYY-MM-DD)'
      } else {
        fromDate = parsed
      }
    }
  }

  if ('to' in query && query.to !== undefined && query.to !== null) {
    const rawTo = String(query.to).trim()
    if (!rawTo) {
      errors.to = 'The "to" date parameter cannot be empty'
    } else {
      const parsed = parseStrictHistoryDate(rawTo, true)

      if (!parsed || Number.isNaN(parsed.getTime())) {
        errors.to = 'Invalid "to" date format. Use ISO format (e.g. YYYY-MM-DD)'
      } else {
        toDate = parsed
      }
    }
  }

  if (fromDate && toDate && fromDate.getTime() > toDate.getTime()) {
    errors.dateRange = 'The "from" date cannot be later than the "to" date'
  }

  // 5. Pagination limit (positive integer, max 100, default 50)
  if ('limit' in query && query.limit !== undefined && query.limit !== null) {
    const rawLimit = String(query.limit).trim()
    const parsedLimit = Number(rawLimit)
    if (!/^\d+$/.test(rawLimit) || !Number.isSafeInteger(parsedLimit) || parsedLimit <= 0) {
      errors.limit = 'Invalid limit parameter: must be a positive integer'
    } else if (parsedLimit > 100) {
      errors.limit = 'Limit parameter cannot exceed 100'
    } else {
      limit = parsedLimit
    }
  }

  // 6. Pagination offset (non-negative integer, default 0)
  if ('offset' in query && query.offset !== undefined && query.offset !== null) {
    const rawOffset = String(query.offset).trim()
    const parsedOffset = Number(rawOffset)
    if (!/^\d+$/.test(rawOffset) || !Number.isSafeInteger(parsedOffset) || parsedOffset < 0) {
      errors.offset = 'Invalid offset parameter: must be a non-negative integer'
    } else {
      offset = parsedOffset
    }
  }

  return {
    isValid: Object.keys(errors).length === 0,
    errors,
    normalized: {
      status,
      outputFormat,
      sourceType,
      fromDate,
      toDate,
      limit,
      offset
    }
  }
}

/**
 * Retrieves filtered, paginated download history with related file/media metadata
 * and lightweight missing-file detection.
 *
 * @param {object} [filters={}] - Normalized filter criteria
 * @returns {Promise<{
 *   jobs: Array<object>,
 *   pagination: { limit: number, offset: number, total: number }
 * }>}
 */
export async function listDownloadHistory(filters = {}) {
  const { DownloadJob, DownloadFile, MediaItem } = getDatabase().models

  // Construct Sequelize where clause
  const where = {}

  if (filters.status) {
    where.status = filters.status
  }

  if (filters.outputFormat) {
    where.output_format = filters.outputFormat
  }

  if (filters.sourceType) {
    where.source_type = filters.sourceType
  }

  if (filters.fromDate && filters.toDate) {
    where.createdAt = {
      [Op.between]: [filters.fromDate, filters.toDate]
    }
  } else if (filters.fromDate) {
    where.createdAt = {
      [Op.gte]: filters.fromDate
    }
  } else if (filters.toDate) {
    where.createdAt = {
      [Op.lte]: filters.toDate
    }
  }

  const limit = Number.isSafeInteger(filters.limit) && filters.limit > 0 ? filters.limit : 50
  const offset = Number.isSafeInteger(filters.offset) && filters.offset >= 0 ? filters.offset : 0

  // 1. Calculate total matching jobs before pagination
  const total = await DownloadJob.count({ where })

  // 2. Fetch paginated slice with stable deterministic order
  const jobs = await DownloadJob.findAll({
    where,
    order: [
      ['createdAt', 'DESC'],
      ['id', 'DESC']
    ],
    limit,
    offset
  })

  if (jobs.length === 0) {
    return {
      jobs: [],
      pagination: {
        limit,
        offset,
        total
      }
    }
  }

  // 3. Batch load related DownloadFile and MediaItem records
  const jobIds = jobs.map((job) => job.id)
  const mediaIds = [...new Set(jobs.map((job) => job.media_id))]

  const files = await DownloadFile.findAll({
    where: {
      download_job_id: jobIds
    }
  })

  const mediaItems = await MediaItem.findAll({
    where: {
      id: mediaIds
    }
  })

  const fileByJobId = new Map(files.map((file) => [file.download_job_id, file.toJSON()]))
  const mediaById = new Map(mediaItems.map((media) => [media.id, media.toJSON()]))

  // 4. Perform bounded concurrent missing-file availability checks
  const enrichedJobs = await pMap(
    jobs,
    async (job) => {
      const jobJson = job.toJSON()
      const file = fileByJobId.get(job.id) ?? null
      const media = mediaById.get(job.media_id) ?? null

      const fileStatus = await checkFileAvailability(file?.file_path ?? null, job.status)

      return {
        ...jobJson,
        file,
        media,
        file_status: fileStatus
      }
    },
    10
  )

  return {
    jobs: enrichedJobs,
    pagination: {
      limit,
      offset,
      total
    }
  }
}

/**
 * Retrieves details of a specific download job with file availability information.
 *
 * @param {number} jobId - Download job ID
 * @returns {Promise<{ job: object, file: object|null, file_status: string }|null>}
 */
export async function getDownloadHistoryDetails(jobId) {
  if (!Number.isInteger(jobId) || jobId <= 0) {
    throw new Error('A valid Download Job ID is required')
  }

  const { DownloadJob, DownloadFile } = getDatabase().models

  const job = await DownloadJob.findByPk(jobId)

  if (!job) {
    return null
  }

  const file = await DownloadFile.findOne({
    where: {
      download_job_id: jobId
    }
  })

  const fileStatus = await checkFileAvailability(file?.file_path ?? null, job.status)

  return {
    job: {
      ...job.toJSON(),
      file_status: fileStatus
    },
    file: file ? file.toJSON() : null,
    file_status: fileStatus
  }
}

/**
 * Safely deletes a single terminal download history record from SQLite.
 * Protects actual media files on disk and related MediaItem records.
 *
 * @param {number} jobId - Download job ID to delete
 * @returns {Promise<{
 *   outcome: 'success'|'not_found'|'conflict',
 *   jobId: number,
 *   status?: string,
 *   message?: string
 * }>}
 */
export async function deleteDownloadHistoryRecord(jobId) {
  if (!Number.isSafeInteger(jobId) || jobId <= 0) {
    throw new Error('A valid Download Job ID is required')
  }

  const { DownloadJob, DownloadFile } = getDatabase().models

  // Coordinate write lock with concurrent completion transactions
  return await withCompletionWriteLock(async () => {
    return await getDatabase().transaction(
      { type: Transaction.TYPES.IMMEDIATE },
      async (transaction) => {
        // Re-query the job inside transaction to guard against race conditions
        const job = await DownloadJob.findByPk(jobId, { transaction })

        if (!job) {
          return {
            outcome: 'not_found',
            jobId
          }
        }

        // Active jobs cannot be deleted from history
        if (job.status === 'queued' || job.status === 'downloading') {
          return {
            outcome: 'conflict',
            jobId,
            status: job.status,
            message: 'Cancel this active download before deleting its history'
          }
        }

        // Only terminal statuses can be deleted
        if (!TERMINAL_JOB_STATUSES.includes(job.status)) {
          return {
            outcome: 'conflict',
            jobId,
            status: job.status,
            message: 'Only completed, failed, or cancelled download history can be deleted'
          }
        }

        // 1. Delete associated DownloadFile DB record first (due to foreign key RESTRICT)
        await DownloadFile.destroy({
          where: {
            download_job_id: jobId
          },
          transaction
        })

        // 2. Delete DownloadJob record
        await DownloadJob.destroy({
          where: {
            id: jobId
          },
          transaction
        })

        return {
          outcome: 'success',
          jobId,
          status: job.status
        }
      }
    )
  })
}

/**
 * Clears explicitly confirmed terminal download history records from SQLite.
 *
 * @param {object} params
 * @param {boolean} params.confirm - Explicit confirmation flag (must be true)
 * @param {Array<string>} params.statuses - Array of terminal statuses to clear
 * @returns {Promise<{ deletedJobs: number, physicalFilesDeleted: number }>}
 */
export async function clearDownloadHistory({ confirm, statuses }) {
  if (confirm !== true) {
    const error = new Error(
      'Explicit confirmation (confirm: true) is required to clear download history'
    )
    error.statusCode = 400
    throw error
  }

  if (!Array.isArray(statuses) || statuses.length === 0) {
    const error = new Error('A non-empty array of statuses is required')
    error.statusCode = 400
    throw error
  }

  // Validate that every requested status is an allowed terminal status
  for (const st of statuses) {
    if (typeof st !== 'string' || !TERMINAL_JOB_STATUSES.includes(st.trim().toLowerCase())) {
      const error = new Error(
        `Invalid status "${st}". Allowed terminal statuses to clear: ${TERMINAL_JOB_STATUSES.join(', ')}`
      )
      error.statusCode = 400
      throw error
    }
  }

  const cleanStatuses = [...new Set(statuses.map((s) => s.trim().toLowerCase()))]

  const { DownloadJob, DownloadFile } = getDatabase().models

  // Coordinate write lock with concurrent completion transactions
  return await withCompletionWriteLock(async () => {
    return await getDatabase().transaction(
      { type: Transaction.TYPES.IMMEDIATE },
      async (transaction) => {
        // Find all matching job IDs in the requested terminal statuses
        const matchingJobs = await DownloadJob.findAll({
          where: {
            status: {
              [Op.in]: cleanStatuses
            }
          },
          attributes: ['id'],
          transaction
        })

        if (matchingJobs.length === 0) {
          return {
            deletedJobs: 0,
            physicalFilesDeleted: 0
          }
        }

        const jobIds = matchingJobs.map((j) => j.id)

        // 1. Delete associated DownloadFile records first
        await DownloadFile.destroy({
          where: {
            download_job_id: {
              [Op.in]: jobIds
            }
          },
          transaction
        })

        // 2. Delete DownloadJob records
        const deletedJobs = await DownloadJob.destroy({
          where: {
            id: {
              [Op.in]: jobIds
            },
            status: {
              [Op.in]: cleanStatuses
            }
          },
          transaction
        })

        return {
          deletedJobs,
          physicalFilesDeleted: 0
        }
      }
    )
  })
}
