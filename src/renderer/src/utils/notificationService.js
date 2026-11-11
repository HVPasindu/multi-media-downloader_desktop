import Swal from 'sweetalert2'

/**
 * Common dynamic theme-aware SweetAlert2 defaults matching APPLAN2 UI design system.
 * Supports Dark, Light, and Custom background modes, and dynamically updates with active accent.
 */
const darkThemeSwal = Swal.mixin({
  background: 'var(--app-surface-elevated, #0B1C38)',
  color: 'var(--app-text, #F4F8FF)',
  confirmButtonColor: 'var(--theme-primary, #18C9F5)',
  cancelButtonColor: 'var(--app-surface, #07152E)',
  customClass: {
    popup: 'app-swal-popup',
    title: 'app-swal-title',
    htmlContainer: 'app-swal-html',
    confirmButton: 'app-swal-confirm-btn',
    cancelButton: 'app-swal-cancel-btn'
  },
  buttonsStyling: false
})

/**
 * Set tracking job IDs that have already emitted an alert to avoid repeated popups during background polling.
 */
const notifiedFailureJobIds = new Set()

/**
 * Merges mandatory internal theme classes with optional caller-provided classes.
 */
export function mergeSwalClasses(defaultClasses, callerClasses = {}) {
  const merged = { ...defaultClasses }
  for (const [key, val] of Object.entries(callerClasses)) {
    if (merged[key]) {
      merged[key] = `${merged[key]} ${val}`.trim()
    } else {
      merged[key] = val
    }
  }
  return merged
}

/**
 * Pure builder for standard alert options (success, error, warning, info).
 * Ensures mandatory theme variables, buttonsStyling: false, and merged classes cannot be overridden by caller.
 *
 * @param {object} [options={}]
 * @param {'success'|'error'|'warning'|'info'} [type='info']
 * @param {string} [title='']
 * @param {string} [message='']
 * @returns {object} SweetAlert2 options object
 */
export function buildAlertOptions(options = {}, type = 'info', title = '', message = '') {
  const opts = typeof options === 'object' && options !== null ? options : {}
  const {
    confirmButtonText = 'OK',
    customClass: callerClass = {},
    iconColor: callerIconColor,
    ...safeOptions
  } = opts

  const iconColors = {
    success: '#00DEA5',
    error: '#FF4568',
    warning: '#FFB547',
    info: 'var(--theme-primary, #18C9F5)'
  }

  const defaultClasses = {
    popup: 'app-swal-popup',
    title: 'app-swal-title',
    htmlContainer: 'app-swal-html',
    confirmButton: 'app-swal-confirm-btn'
  }

  return {
    ...safeOptions,
    icon: type,
    iconColor: callerIconColor || iconColors[type] || 'var(--theme-primary, #18C9F5)',
    title: title || opts.title || '',
    text: message || opts.text || '',
    confirmButtonText,
    background: 'var(--app-surface-elevated, #0B1C38)',
    color: 'var(--app-text, #F4F8FF)',
    buttonsStyling: false,
    customClass: mergeSwalClasses(defaultClasses, callerClass)
  }
}

/**
 * Pure builder for confirmation dialog options.
 * Ensures mandatory theme variables, buttonsStyling: false, and merged classes cannot be overridden by caller.
 *
 * @param {object} [options={}]
 * @param {string} [title='']
 * @param {string} [message='']
 * @returns {object} SweetAlert2 options object
 */
export function buildConfirmOptions(options = {}, title = '', message = '') {
  const opts = typeof options === 'object' && options !== null ? options : {}
  const {
    isDanger = false,
    icon,
    iconColor,
    confirmButtonText = 'Confirm',
    cancelButtonText = 'Cancel',
    customClass: callerClass = {},
    ...safeOptions
  } = opts

  const defaultClasses = {
    popup: 'app-swal-popup',
    title: 'app-swal-title',
    htmlContainer: 'app-swal-html',
    confirmButton: isDanger
      ? 'app-swal-confirm-btn app-swal-confirm-btn-danger'
      : 'app-swal-confirm-btn',
    cancelButton: 'app-swal-cancel-btn'
  }

  return {
    icon: icon || (isDanger ? 'warning' : 'question'),
    iconColor: iconColor || (isDanger ? '#FF4568' : '#FFB547'),
    showCancelButton: true,
    confirmButtonText,
    cancelButtonText,
    confirmButtonColor: isDanger ? '#FF4568' : 'var(--theme-primary, #18C9F5)',
    cancelButtonColor: 'var(--app-surface, #07152E)',
    reverseButtons: true,
    focusCancel: true,
    ...safeOptions,
    title: title || opts.title || '',
    text: message || opts.text || '',
    background: 'var(--app-surface-elevated, #0B1C38)',
    color: 'var(--app-text, #F4F8FF)',
    buttonsStyling: false,
    customClass: mergeSwalClasses(defaultClasses, callerClass)
  }
}

/**
 * Pure builder for toast notification options.
 * Ensures mandatory theme variables, buttonsStyling: false, and merged classes cannot be overridden by caller.
 *
 * @param {object} [options={}]
 * @param {'success'|'error'|'warning'|'info'} [icon='success']
 * @param {string} [title='']
 * @param {number} [timer=3000]
 * @returns {object} SweetAlert2 options object
 */
export function buildToastOptions(options = {}, icon = 'success', title = '', timer = 3000) {
  const opts = typeof options === 'object' && options !== null ? options : {}
  const iconColors = {
    success: '#00DEA5',
    error: '#FF4568',
    warning: '#FFB547',
    info: 'var(--theme-primary, #18C9F5)'
  }

  const { customClass: callerClass = {}, iconColor: callerIconColor, ...safeOptions } = opts

  const defaultClasses = {
    popup: 'app-swal-popup',
    title: 'app-swal-title'
  }

  return {
    toast: true,
    position: 'top-end',
    icon,
    iconColor: callerIconColor || iconColors[icon] || 'var(--theme-primary, #18C9F5)',
    showConfirmButton: false,
    timer,
    timerProgressBar: true,
    ...safeOptions,
    title: title || opts.title || '',
    background: 'var(--app-surface-elevated, #0B1C38)',
    color: 'var(--app-text, #F4F8FF)',
    buttonsStyling: false,
    customClass: mergeSwalClasses(defaultClasses, callerClass)
  }
}

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
  return darkThemeSwal.fire(buildAlertOptions(options, 'success', title, message))
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
  return darkThemeSwal.fire(buildAlertOptions(options, 'error', title, message))
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
  return darkThemeSwal.fire(buildAlertOptions(options, 'warning', title, message))
}

/**
 * Displays an info alert dialog.
 *
 * @param {string} title
 * @param {string} [message]
 * @param {object} [options={}]
 * @returns {Promise<import('sweetalert2').SweetAlertResult>}
 */
export function showInfo(title, message = '', options = {}) {
  return darkThemeSwal.fire(buildAlertOptions(options, 'info', title, message))
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
  const result = await darkThemeSwal.fire(buildConfirmOptions(options, title, message))
  return Boolean(result.isConfirmed)
}

/**
 * Displays a non-intrusive toast notification.
 *
 * @param {string} title
 * @param {'success'|'error'|'warning'|'info'} [icon='success']
 * @param {number} [timer=3000]
 * @param {object} [options={}]
 */
export function showToast(title, icon = 'success', timer = 3000, options = {}) {
  return darkThemeSwal.fire(buildToastOptions(options, icon, title, timer))
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
