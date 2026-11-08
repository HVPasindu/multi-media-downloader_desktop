import path from 'node:path'
import fs from 'node:fs'
import { execFile, execSync } from 'node:child_process'
import { promisify } from 'node:util'
import { fileURLToPath } from 'node:url'

const execFileAsync = promisify(execFile)

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)

/**
 * Resolves the absolute path to the Windows send-ctrl-break helper binary.
 * If the binary is missing and running on Windows, attempts to compile it
 * from ConsoleSender.cs using csc.exe.
 *
 * @returns {string|null}
 */
export function resolveCtrlBreakHelperPath() {
  if (process.platform !== 'win32') {
    return null
  }

  // 1. Check src/main/backend/bin/send-ctrl-break.exe
  const localBinPath = path.resolve(__dirname, '..', 'bin', 'send-ctrl-break.exe')
  if (fs.existsSync(localBinPath)) {
    return localBinPath
  }

  // 2. Check resources/bin/win32-x64/send-ctrl-break.exe
  const projectRoot = path.resolve(__dirname, '..', '..', '..', '..')
  const resourcesBinPath = path.resolve(
    projectRoot,
    'resources',
    'bin',
    'win32-x64',
    'send-ctrl-break.exe'
  )
  if (fs.existsSync(resourcesBinPath)) {
    return resourcesBinPath
  }

  // 3. Auto-compile from ConsoleSender.cs if csc.exe is available
  const csSourcePath = path.resolve(__dirname, '..', 'utils', 'ConsoleSender.cs')
  const cscPath = 'C:\\Windows\\Microsoft.NET\\Framework64\\v4.0.30319\\csc.exe'

  if (fs.existsSync(csSourcePath) && fs.existsSync(cscPath)) {
    try {
      const targetDir = path.dirname(localBinPath)
      if (!fs.existsSync(targetDir)) {
        fs.mkdirSync(targetDir, { recursive: true })
      }
      execSync(`"${cscPath}" /nologo /optimize /out:"${localBinPath}" "${csSourcePath}"`, {
        windowsHide: true,
        timeout: 10000
      })
      if (fs.existsSync(localBinPath)) {
        return localBinPath
      }
    } catch (compileErr) {
      console.warn(
        '[processInterruption] Failed to auto-compile send-ctrl-break.exe:',
        compileErr.message
      )
    }
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
 *
 * @param {number} pid
 * @returns {Promise<{ success: boolean, method: string, error?: string }>}
 */
export async function sendWindowsCtrlBreak(pid) {
  if (!Number.isSafeInteger(pid) || pid <= 0) {
    return { success: false, method: 'invalid_pid', error: 'Invalid process PID' }
  }

  const helperPath = resolveCtrlBreakHelperPath()

  if (helperPath) {
    try {
      await execFileAsync(helperPath, [String(pid)], {
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
    const psCommand = `powershell -NoProfile -Command "& { Add-Type -TypeDefinition 'using System; using System.Runtime.InteropServices; public class CtrlBreak { [DllImport(\\"kernel32.dll\\", SetLastError=true)] public static extern bool GenerateConsoleCtrlEvent(uint e, uint g); [DllImport(\\"kernel32.dll\\", SetLastError=true)] public static extern bool AttachConsole(uint p); [DllImport(\\"kernel32.dll\\", SetLastError=true)] public static extern bool FreeConsole(); [DllImport(\\"kernel32.dll\\", SetLastError=true)] public static extern bool SetConsoleCtrlHandler(IntPtr h, bool a); public static bool Send(uint p) { if (p == 0) return false; FreeConsole(); if(!AttachConsole(p)) return false; SetConsoleCtrlHandler(IntPtr.Zero, true); bool ok = GenerateConsoleCtrlEvent(1, p); FreeConsole(); return ok; } }'; if (![CtrlBreak]::Send(${pid})) { exit 1 } }"`
    execSync(psCommand, { windowsHide: true, timeout: 5000 })
    return { success: true, method: 'powershell_ctrl_break' }
  } catch (psErr) {
    return {
      success: false,
      method: 'failed',
      error: `Failed to send console control event to PID ${pid}: ${psErr.message}`
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

  const targetPid = processEntry.actualPid || child.pid

  // 1. Send graceful interruption event
  if (process.platform === 'win32') {
    const ctrlResult = await sendWindowsCtrlBreak(targetPid)
    if (!ctrlResult.success) {
      console.warn(
        `[processInterruption] Windows Ctrl-Break generation failed for PID ${targetPid}:`,
        ctrlResult.error
      )
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
  if (!isProcessAlive(targetPid)) {
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
    error: `Process ${targetPid} did not exit gracefully within ${timeoutMs}ms`
  }
}

/**
 * Forcefully terminates a download process and its entire process tree (e.g. for Cancel).
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

  if (process.platform === 'win32') {
    const pidsToKill = actualPid && actualPid !== pid ? [actualPid, pid] : [pid]
    for (const p of pidsToKill) {
      try {
        await execFileAsync('taskkill.exe', ['/PID', String(p), '/T', '/F'], {
          windowsHide: true
        })
      } catch (error) {
        const message = String(error?.message || '')
        if (
          message.includes('not found') ||
          message.includes('No process') ||
          error?.code === 128
        ) {
          // Process already terminated
        }
      }
    }
  } else {
    try {
      process.kill(-pid, 'SIGKILL')
    } catch {
      try {
        child.kill('SIGKILL')
      } catch {
        // Ignore
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

  if (!isProcessAlive(pid)) {
    if (processEntry && typeof processEntry.markClosed === 'function') {
      processEntry.markClosed(1, 'SIGKILL')
    }
  }

  return { success: true }
}
