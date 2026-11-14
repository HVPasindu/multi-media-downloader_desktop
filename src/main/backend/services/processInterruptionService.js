import path from 'node:path'
import fs from 'node:fs'
import { execFile, execSync } from 'node:child_process'
import { promisify } from 'node:util'
import { fileURLToPath } from 'node:url'
import { getPackagedBinaryDirectory } from './executablePathService.js'

const execFileAsync = promisify(execFile)

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)

let hasLoggedHelperPath = false

/**
 * Resolves the absolute path to the Windows send-ctrl-break helper binary.
 * Dev location: <projectRoot>/resources/bin/win32-x64/send-ctrl-break.exe
 * Packaged location: <process.resourcesPath>/bin/win32-x64/send-ctrl-break.exe
 *
 * @returns {string|null}
 */
export function resolveCtrlBreakHelperPath() {
  if (process.platform !== 'win32') {
    return null
  }

  // 1. Packaged or staged resources bin directory
  try {
    const packagedBinDir = getPackagedBinaryDirectory()
    const stagedHelper = path.join(packagedBinDir, 'send-ctrl-break.exe')
    if (fs.existsSync(stagedHelper)) {
      if (!hasLoggedHelperPath) {
        hasLoggedHelperPath = true
        console.info('[APPLAN2] Windows Pause Helper:', stagedHelper)
      }
      return stagedHelper
    }
  } catch {
    // Fall back to relative path resolution
  }

  // 2. Direct check in resources/bin/win32-x64/send-ctrl-break.exe
  const projectRoot = path.resolve(__dirname, '..', '..', '..', '..')
  const resourcesBinPath = path.resolve(
    projectRoot,
    'resources',
    'bin',
    'win32-x64',
    'send-ctrl-break.exe'
  )
  if (fs.existsSync(resourcesBinPath)) {
    if (!hasLoggedHelperPath) {
      hasLoggedHelperPath = true
      console.info('[APPLAN2] Windows Pause Helper:', resourcesBinPath)
    }
    return resourcesBinPath
  }

  // 3. Check src/main/backend/bin/send-ctrl-break.exe
  const localBinPath = path.resolve(__dirname, '..', 'bin', 'send-ctrl-break.exe')
  if (fs.existsSync(localBinPath)) {
    if (!hasLoggedHelperPath) {
      hasLoggedHelperPath = true
      console.info('[APPLAN2] Windows Pause Helper:', localBinPath)
    }
    return localBinPath
  }

  // 4. Auto-compile from ConsoleSender.cs using csc.exe if missing
  const csSourcePath = path.resolve(__dirname, '..', 'utils', 'ConsoleSender.cs')
  const candidateCscPaths = [
    'C:\\Windows\\Microsoft.NET\\Framework64\\v4.0.30319\\csc.exe',
    'C:\\Windows\\Microsoft.NET\\Framework\\v4.0.30319\\csc.exe'
  ]
  const cscPath = candidateCscPaths.find((p) => fs.existsSync(p))

  if (fs.existsSync(csSourcePath) && cscPath) {
    try {
      const targetDir = path.dirname(resourcesBinPath)
      if (!fs.existsSync(targetDir)) {
        fs.mkdirSync(targetDir, { recursive: true })
      }
      execSync(
        `"${cscPath}" /nologo /optimize /platform:x64 /out:"${resourcesBinPath}" "${csSourcePath}"`,
        {
          windowsHide: true,
          timeout: 10000
        }
      )
      if (fs.existsSync(resourcesBinPath)) {
        try {
          fs.mkdirSync(path.dirname(localBinPath), { recursive: true })
          fs.copyFileSync(resourcesBinPath, localBinPath)
        } catch {
          // ignore copy
        }
        if (!hasLoggedHelperPath) {
          hasLoggedHelperPath = true
          console.info('[APPLAN2] Windows Pause Helper:', resourcesBinPath)
        }
        return resourcesBinPath
      }
    } catch (compileErr) {
      console.warn('[APPLAN2] Failed to auto-compile send-ctrl-break.exe:', compileErr.message)
    }
  }

  if (!hasLoggedHelperPath) {
    hasLoggedHelperPath = true
    console.info('[APPLAN2] Windows Pause Helper: NOT FOUND')
  }

  return null
}

/**
 * Checks whether an OS process with the given PID is currently active.
 *
 * @param {number} pid
 * @returns {boolean}
 */
export function isProcessAlive(pid) {
  if (!Number.isSafeInteger(pid) || pid <= 0) {
    return false
  }

  try {
    process.kill(pid, 0)
    return true
  } catch (error) {
    return error.code === 'EPERM'
  }
}

/**
 * Sends a genuine Windows Console Break event (CTRL_BREAK_EVENT) to the target process group.
 * Strictly bars PID / PGID 0 to prevent broadcasting to the caller console.
 *
 * @param {number} pgid
 * @returns {Promise<{ success: boolean, method: string, error?: string }>}
 */
export async function sendWindowsCtrlBreak(pgid) {
  if (!Number.isSafeInteger(pgid) || pgid <= 0) {
    return {
      success: false,
      method: 'invalid_pid',
      error: 'Invalid or prohibited process group ID (PID/PGID 0 is forbidden)'
    }
  }

  const helperPath = resolveCtrlBreakHelperPath()

  if (helperPath) {
    try {
      await execFileAsync(helperPath, [String(pgid)], {
        windowsHide: true,
        timeout: 5000
      })
      return { success: true, method: 'send_ctrl_break_exe' }
    } catch (err) {
      // 0xC000013A (3221225786) is STATUS_CONTROL_C_EXIT which indicates successful signal reception
      if (err?.code === 3221225786 || err?.code === 0) {
        return { success: true, method: 'send_ctrl_break_exe' }
      }
      console.warn(
        `[processInterruption] send-ctrl-break.exe exited with ${err.code}, attempting fallback:`,
        err.message
      )
    }
  }

  // Fallback: PowerShell inline GenerateConsoleCtrlEvent
  try {
    const psCommand = `powershell -NoProfile -Command "& { Add-Type -TypeDefinition 'using System; using System.Runtime.InteropServices; public class CtrlBreak { [DllImport(\\"kernel32.dll\\", SetLastError=true)] public static extern bool GenerateConsoleCtrlEvent(uint e, uint g); [DllImport(\\"kernel32.dll\\", SetLastError=true)] public static extern bool AttachConsole(uint p); [DllImport(\\"kernel32.dll\\", SetLastError=true)] public static extern bool FreeConsole(); [DllImport(\\"kernel32.dll\\", SetLastError=true)] public static extern bool SetConsoleCtrlHandler(IntPtr h, bool a); public static bool Send(uint p) { if (p == 0) return false; FreeConsole(); if(!AttachConsole(p)) return false; SetConsoleCtrlHandler(IntPtr.Zero, true); bool ok = GenerateConsoleCtrlEvent(1, p); FreeConsole(); return ok; } }'; if (![CtrlBreak]::Send(${pgid})) { exit 1 } }"`
    execSync(psCommand, { windowsHide: true, timeout: 5000 })
    return { success: true, method: 'powershell_ctrl_break' }
  } catch (psErr) {
    return {
      success: false,
      method: 'failed',
      error: `Failed to send console control event to PGID ${pgid}: ${psErr.message}`
    }
  }
}

/**
 * Gracefully interrupts a download process (e.g. for pause), giving yt-dlp
 * the opportunity to flush its partial file and exit cleanly.
 *
 * Does NOT invoke forceful taskkill. If graceful interruption fails or times out,
 * reports an error so the application never falsely claims a paused state.
 *
 * @param {object} processEntry
 * @param {number} [timeoutMs=4000]
 * @returns {Promise<{ success: boolean, graceful: boolean, error?: string }>}
 */
export async function gracefullyInterruptProcess(processEntry, timeoutMs = 4000) {
  if (!processEntry) {
    return { success: false, graceful: false, error: 'No process entry provided' }
  }

  if (processEntry.closed) {
    return { success: true, graceful: true }
  }

  const child = processEntry.childProcess
  if (!child || typeof child.pid !== 'number') {
    return { success: false, graceful: false, error: 'Process has no valid PID' }
  }

  const targetPgid = processEntry.pgid || processEntry.actualPid || child.pid
  if (!targetPgid || targetPgid <= 0) {
    return { success: false, graceful: false, error: 'Process has no valid target PID/PGID' }
  }

  // 1. Send graceful interruption event
  if (process.platform === 'win32') {
    const ctrlResult = await sendWindowsCtrlBreak(targetPgid)
    if (!ctrlResult.success) {
      console.warn(
        `[processInterruption] Windows Ctrl-Break generation failed for PGID ${targetPgid}:`,
        ctrlResult.error
      )
      return {
        success: false,
        graceful: false,
        error:
          ctrlResult.error || `Failed to deliver Ctrl+Break signal to process group ${targetPgid}`
      }
    }
  } else {
    try {
      child.kill('SIGINT')
    } catch {
      try {
        child.kill('SIGTERM')
      } catch {
        // Process might already be dead
      }
    }
  }

  // 2. Wait up to timeoutMs for actual process and stdio closure
  let exitWaitPromise
  if (processEntry.closePromise) {
    exitWaitPromise = processEntry.closePromise
  } else {
    exitWaitPromise = new Promise((resolve) => {
      child.once('close', () => resolve(true))
      child.once('exit', () => resolve(true))
    })
  }

  const hasClosed = await Promise.race([
    exitWaitPromise.then(() => true),
    new Promise((resolve) => setTimeout(() => resolve(false), timeoutMs))
  ])

  if (hasClosed || processEntry.closed) {
    return { success: true, graceful: true }
  }

  // Check if process has actually exited in OS even if event lagged
  if (!isProcessAlive(targetPgid)) {
    if (typeof processEntry.markClosed === 'function') {
      processEntry.markClosed(0, null)
    }
    return { success: true, graceful: true }
  }

  // Graceful pause did not close the process within timeoutMs.
  // We strictly do NOT forcefully kill with taskkill /F during pause.
  return {
    success: false,
    graceful: false,
    error: `Process ${targetPgid} did not exit gracefully within ${timeoutMs}ms`
  }
}

/**
 * Forcefully terminates a download process and its entire process tree (e.g. for Cancel).
 * Validates both wrapper PID and actual child yt-dlp PID, executes taskkill,
 * awaits closure, and independently verifies OS process termination.
 *
 * @param {object|ChildProcess} processEntryOrChild
 * @param {number} [timeoutMs=3000]
 * @returns {Promise<{ success: boolean, error?: string }>}
 */
export async function terminateProcessTree(processEntryOrChild, timeoutMs = 3000) {
  const child = processEntryOrChild?.childProcess || processEntryOrChild
  const processEntry = processEntryOrChild?.childProcess ? processEntryOrChild : null

  if (!child || typeof child.pid !== 'number') {
    return { success: true }
  }

  if (processEntry && processEntry.closed) {
    return { success: true }
  }

  const pid = child.pid
  const actualPid = processEntry?.actualPid

  const targets = [actualPid, pid].filter((value) => Number.isSafeInteger(value) && value > 0)

  if (process.platform === 'win32') {
    for (const p of targets) {
      try {
        await execFileAsync('taskkill.exe', ['/PID', String(p), '/T', '/F'], {
          windowsHide: true,
          timeout: 5000
        })
      } catch (error) {
        const message = String(error?.message || '')
        if (
          message.includes('not found') ||
          message.includes('No process') ||
          error?.code === 128
        ) {
          // Process already terminated
        } else {
          console.warn(`[terminateProcessTree] taskkill warning for PID ${p}:`, error.message)
        }
      }
    }
  } else {
    for (const p of targets) {
      try {
        process.kill(-p, 'SIGKILL')
      } catch {
        try {
          process.kill(p, 'SIGKILL')
        } catch {
          // Ignore
        }
      }
    }
  }

  // Wait for close confirmation
  let exitWaitPromise
  if (processEntry?.closePromise) {
    exitWaitPromise = processEntry.closePromise
  } else {
    exitWaitPromise = new Promise((resolve) => {
      child.once('close', () => resolve(true))
      child.once('exit', () => resolve(true))
    })
  }

  await Promise.race([exitWaitPromise, new Promise((resolve) => setTimeout(resolve, timeoutMs))])

  // Independently verify all target processes have terminated in the OS
  const remainingProcesses = targets.filter(isProcessAlive)
  if (remainingProcesses.length > 0) {
    return {
      success: false,
      error: `Download process termination could not be verified (PID(s) ${remainingProcesses.join(', ')} still alive)`
    }
  }

  if (processEntry && typeof processEntry.markClosed === 'function') {
    processEntry.markClosed(1, 'SIGKILL')
  }

  return { success: true }
}
