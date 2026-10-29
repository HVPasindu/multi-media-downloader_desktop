import * as realCp from 'node:child_process'

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

export default {
  ...realCp,
  spawn,
  execFile
}
