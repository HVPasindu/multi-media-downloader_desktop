import * as realCp from 'node:child_process'
import { promisify } from 'node:util'

export const { exec, fork, spawnSync, execFileSync, execSync, ChildProcess } = realCp

export function spawn(...args) {
  if (globalThis.__mockChildProcess?.spawn) {
    const mockRes = globalThis.__mockChildProcess.spawn(...args)
    if (mockRes !== undefined) return mockRes
  }
  return realCp.spawn(...args)
}

export function execFile(...args) {
  if (globalThis.__mockChildProcess?.execFile) {
    const mockRes = globalThis.__mockChildProcess.execFile(...args)
    if (mockRes !== undefined) return mockRes
  }
  return realCp.execFile(...args)
}

if (realCp.execFile?.[promisify.custom]) {
  execFile[promisify.custom] = (...args) => {
    if (globalThis.__mockChildProcess?.execFileAsync) {
      const mockRes = globalThis.__mockChildProcess.execFileAsync(...args)
      if (mockRes !== undefined) return mockRes
    }
    if (globalThis.__mockChildProcess?.execFile) {
      return new Promise((resolve, reject) => {
        execFile(...args, (err, stdout, stderr) => {
          if (err) {
            if (stdout && typeof stdout === 'object') {
              Object.assign(err, stdout)
            } else {
              err.stdout = stdout
              err.stderr = stderr
            }
            return reject(err)
          }
          if (stdout && typeof stdout === 'object' && ('stdout' in stdout || 'stderr' in stdout)) {
            return resolve(stdout)
          }
          return resolve({ stdout, stderr })
        })
      })
    }
    return realCp.execFile[promisify.custom](...args)
  }
}

export default {
  ...realCp,
  spawn,
  execFile
}
