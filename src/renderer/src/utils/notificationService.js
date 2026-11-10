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
function mergeSwalClasses(defaultClasses, callerClasses = {}) {
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
  const {
    confirmButtonText = 'OK',
    customClass: callerClass = {},
    ...safeOptions
  } = options

  return darkThemeSwal.fire({
    icon: 'success',
    iconColor: '#00DEA5',
    title,
    text: message,
    confirmButtonText,
    ...safeOptions,
    customClass: mergeSwalClasses(
      {
        popup: 'app-swal-popup',
        title: 'app-swal-title',
        htmlContainer: 'app-swal-html',
        confirmButton: 'app-swal-confirm-btn'
      },
      callerClass
    ),
    buttonsStyling: false
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
  const {
    confirmButtonText = 'OK',
    customClass: callerClass = {},
    ...safeOptions
  } = options

  return darkThemeSwal.fire({
    icon: 'error',
    iconColor: '#FF4568',
    title,
    text: message,
    confirmButtonText,
    ...safeOptions,
    customClass: mergeSwalClasses(
      {
        popup: 'app-swal-popup',
        title: 'app-swal-title',
        htmlContainer: 'app-swal-html',
        confirmButton: 'app-swal-confirm-btn'
      },
      callerClass
    ),
    buttonsStyling: false
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
  const {
    confirmButtonText = 'OK',
    customClass: callerClass = {},
    ...safeOptions
  } = options

  return darkThemeSwal.fire({
    icon: 'warning',
    iconColor: '#FFB547',
    title,
    text: message,
    confirmButtonText,
    ...safeOptions,
    customClass: mergeSwalClasses(
      {
        popup: 'app-swal-popup',
        title: 'app-swal-title',
        htmlContainer: 'app-swal-html',
        confirmButton: 'app-swal-confirm-btn'
      },
      callerClass
    ),
    buttonsStyling: false
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
  const {
    isDanger = false,
    icon,
    iconColor,
    confirmButtonText = 'Confirm',
    cancelButtonText = 'Cancel',
    customClass: callerClass = {},
    ...safeOptions
  } = options

  const defaultClasses = {
    popup: 'app-swal-popup',
    title: 'app-swal-title',
    htmlContainer: 'app-swal-html',
    confirmButton: isDanger
      ? 'app-swal-confirm-btn app-swal-confirm-btn-danger'
      : 'app-swal-confirm-btn',
    cancelButton: 'app-swal-cancel-btn'
  }

  const result = await darkThemeSwal.fire({
    icon: icon || (isDanger ? 'warning' : 'question'),
    iconColor: iconColor || (isDanger ? '#FF4568' : '#FFB547'),
    title,
    text: message,
    showCancelButton: true,
    confirmButtonText,
    cancelButtonText,
    confirmButtonColor: isDanger ? '#FF4568' : 'var(--theme-primary, #18C9F5)',
    cancelButtonColor: 'var(--app-surface, #07152E)',
    reverseButtons: true,
    focusCancel: true,
    ...safeOptions,
    customClass: mergeSwalClasses(defaultClasses, callerClass),
    buttonsStyling: false
  })

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
  const iconColors = {
    success: '#00DEA5',
    error: '#FF4568',
    warning: '#FFB547',
    info: 'var(--theme-primary, #18C9F5)'
  }

  const {
    customClass: callerClass = {},
    ...safeOptions
  } = options

  const defaultClasses = {
    popup: 'app-swal-popup',
    title: 'app-swal-title'
  }

  return darkThemeSwal.fire({
    toast: true,
    position: 'top-end',
    icon,
    iconColor: iconColors[icon] || 'var(--theme-primary, #18C9F5)',
    title,
    showConfirmButton: false,
    timer,
    timerProgressBar: true,
    ...safeOptions,
    customClass: mergeSwalClasses(defaultClasses, callerClass)
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
