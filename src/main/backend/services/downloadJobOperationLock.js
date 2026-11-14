/**
 * Shared per-job operation lock to serialize concurrent Pause, Resume,
 * Cancel, Retry, and Network Recovery operations on the same Download Job.
 *
 * Ensures asynchronous filesystem inspections, cleanup, signaling, and database
 * updates for a specific Job ID are executed sequentially without interleaving races.
 */

const jobLocks = new Map()

/**
 * Executes an async task while holding an exclusive lock for the specified jobId.
 * Subsequent operations for the same jobId queue up and execute in FIFO order.
 *
 * @template T
 * @param {number|string} jobId - Download Job ID to lock
 * @param {() => Promise<T>} task - Async function to execute under lock
 * @returns {Promise<T>}
 */
export async function withJobOperationLock(jobId, task) {
  if (!jobId) {
    return await task()
  }

  const idKey = String(jobId)
  const prevPromise = jobLocks.get(idKey) || Promise.resolve()

  let releaseLock
  const lockPromise = new Promise((resolve) => {
    releaseLock = resolve
  })

  // Synchronously chain as the tail of the job lock queue
  jobLocks.set(idKey, lockPromise)

  try {
    // Wait for previous operation on this job to complete
    await prevPromise
  } catch {
    // Ignore previous operation failure so this operation can proceed
  }

  try {
    return await task()
  } finally {
    if (jobLocks.get(idKey) === lockPromise) {
      jobLocks.delete(idKey)
    }
    releaseLock()
  }
}

/**
 * Checks whether an operation is currently in progress for the specified jobId.
 *
 * @param {number|string} jobId
 * @returns {boolean}
 */
export function isJobOperationLocked(jobId) {
  if (!jobId) return false
  return jobLocks.has(String(jobId))
}

/**
 * Resets all active job operation locks (for test isolation).
 */
export function resetJobOperationLocksForTesting() {
  jobLocks.clear()
}
