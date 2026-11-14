/**
 * Shared retry button state and duplicate-action protection utility.
 */

export function getRetryButtonState(retryingJobId, jobId) {
  return {
    disabled: retryingJobId !== null,
    isSpinning: retryingJobId === jobId
  }
}

export function createRetryGuard() {
  let locked = false

  return {
    tryStart() {
      if (locked) return false

      locked = true
      return true
    },

    finish() {
      locked = false
    }
  }
}
