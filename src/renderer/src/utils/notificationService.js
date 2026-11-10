import Swal from 'sweetalert2'

/**
 * Common dark-themed SweetAlert2 defaults matching APPLAN2 UI design system.
 */
const darkThemeSwal = Swal.mixin({
  background: 'var(--app-surface-elevated, #0B1C38)',
  color: 'var(--app-text, #F4F8FF)',
  confirmButtonColor: '#514BFF',
  cancelButtonColor: 'var(--app-surface, #102449)',
  customClass: {
    popup: 'border border-primary/20 rounded-2xl shadow-2xl backdrop-blur-md',
    title: 'text-text font-extrabold text-lg',
    htmlContainer: 'text-text-muted text-xs leading-relaxed',
    confirmButton:
      'px-4 py-2.5 rounded-xl font-bold text-xs uppercase tracking-wider text-white shadow-lg cursor-pointer transition-all',
    cancelButton:
      'px-4 py-2.5 rounded-xl font-bold text-xs uppercase tracking-wider text-text-muted hover:text-text border border-primary/20 cursor-pointer transition-all'
  },
  buttonsStyling: true
})

/**
 * Set tracking job IDs that have already emitted an alert to avoid repeated popups during background polling.
 */
const notifiedFailureJobIds = new Set()

/**
 * Pre-seeds known failed/cancelled job IDs on initial load so they never trigger popups when viewing pages.
 *
 * @param {Array<number|string>} jobIds
 */
export function seedKnownFailures(jobIds = []) {
  if (Array.isArray(jobIds)) {
    for (const id of jobIds) {
      if (id !== null && id !== undefined) {
        notifiedFailureJobIds.add(Number(id))
      }
    }
  }
}

/**
 * Displays a success alert dialog.
 *
 * @param {string} title
 * @param {string} [message]
 * @param {object} [options={}]
 * @returns {Promise<import('sweetalert2').SweetAlertResult>}
 */
export function showSuccess(title, message = '', options = {}) {
  return darkThemeSwal.fire({
    icon: 'success',
    iconColor: '#00DEA5',
    title,
    text: message,
    confirmButtonText: options.confirmButtonText || 'OK',
    ...options
  })
}

/**
 * Displays an error alert dialog.
 *
 * @param {string} title
 * @param {string} [message]
 * @param {object} [options={}]
 * @returns {Promise<import('sweetalert2').SweetAlertResult>}
 */
export function showError(title, message = '', options = {}) {
  return darkThemeSwal.fire({
    icon: 'error',
    iconColor: '#FF4568',
    title,
    text: message,
    confirmButtonText: options.confirmButtonText || 'OK',
    ...options
  })
}

/**
 * Displays a warning alert dialog.
 *
 * @param {string} title
 * @param {string} [message]
 * @param {object} [options={}]
 * @returns {Promise<import('sweetalert2').SweetAlertResult>}
 */
export function showWarning(title, message = '', options = {}) {
  return darkThemeSwal.fire({
    icon: 'warning',
    iconColor: '#FFB547',
    title,
    text: message,
    confirmButtonText: options.confirmButtonText || 'OK',
    ...options
  })
}

/**
 * Displays a reusable confirmation dialog for destructive or state-changing operations.
 *
 * @param {string} title
 * @param {string} [message]
 * @param {object} [options={}]
 * @returns {Promise<boolean>} Resolves to true if confirmed, false otherwise
 */
export async function showConfirm(title, message = '', options = {}) {
  const result = await darkThemeSwal.fire({
    icon: options.icon || 'warning',
    iconColor: options.iconColor || '#FFB547',
    title,
    text: message,
    showCancelButton: true,
    confirmButtonText: options.confirmButtonText || 'Confirm',
    cancelButtonText: options.cancelButtonText || 'Cancel',
    confirmButtonColor: options.isDanger ? '#FF4568' : '#514BFF',
    reverseButtons: true,
    focusCancel: true,
    ...options
  })

  return Boolean(result.isConfirmed)
}

/**
 * Displays a non-intrusive toast notification.
 *
 * @param {string} title
 * @param {'success'|'error'|'warning'|'info'} [icon='success']
 * @param {number} [timer=3000]
 */
export function showToast(title, icon = 'success', timer = 3000) {
  const iconColors = {
    success: '#00DEA5',
    error: '#FF4568',
    warning: '#FFB547',
    info: '#19D8FF'
  }

  return darkThemeSwal.fire({
    toast: true,
    position: 'top-end',
    icon,
    iconColor: iconColors[icon] || '#19D8FF',
    title,
    showConfirmButton: false,
    timer,
    timerProgressBar: true
  })
}

/**
 * Shows an alert for a freshly failed live job exactly once.
 * Never alerts for the same job ID multiple times during continuous polling.
 *
 * @param {number|string} jobId
 * @param {{ title: string, message: string, guidance?: string }} errorInfo
 */
export function notifyLiveJobFailure(jobId, errorInfo) {
  const numericId = Number(jobId)
  if (!numericId || notifiedFailureJobIds.has(numericId)) {
    return
  }

  notifiedFailureJobIds.add(numericId)

  const textBody = errorInfo.guidance
    ? `${errorInfo.message}\n\nGuidance: ${errorInfo.guidance}`
    : errorInfo.message

  return showError(errorInfo.title || 'Download Failed', textBody)
}
