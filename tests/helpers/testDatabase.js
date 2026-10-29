import path from 'node:path'
import os from 'node:os'
import fs from 'node:fs/promises'
import fsSync from 'node:fs'
import { initializeDatabase, closeDatabase } from '../../src/main/backend/config/database.js'

/**
 * ============================================================================
 * Shared Isolated Test Database Helper
 * Guarantees that automated tests execute against dedicated temporary SQLite
 * databases and never touch the real application database in Electron userData.
 * ============================================================================
 */

/**
 * Creates and initializes an isolated SQLite database within a unique OS temporary folder.
 *
 * @param {string} prefix - Temporary directory prefix
 * @returns {Promise<{
 *   sequelize: import('sequelize').Sequelize,
 *   databasePath: string,
 *   tempDir: string,
 *   cleanup: () => Promise<void>
 * }>}
 */
export async function createTestDatabase(prefix = 'applan2-test-db-') {
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), prefix))
  const dbPath = path.join(tempDir, 'isolated_test.db')

  const { sequelize, databasePath } = await initializeDatabase({ storage: dbPath })

  // Verify that the active database instance is indeed pointing to our isolated path
  if (path.resolve(databasePath) !== path.resolve(dbPath)) {
    await closeDatabase()
    await fs.rm(tempDir, { recursive: true, force: true }).catch(() => {})
    throw new Error(`Test Database Isolation Failure: expected ${dbPath} but got ${databasePath}`)
  }

  // Teardown function to cleanly close connection and remove temporary folder
  const cleanup = async () => {
    try {
      await closeDatabase().catch(() => {})
    } finally {
      if (tempDir && tempDir.startsWith(os.tmpdir()) && fsSync.existsSync(tempDir)) {
        await fs.rm(tempDir, { recursive: true, force: true }).catch(() => {})
      }
    }
  }

  return {
    sequelize,
    databasePath,
    tempDir,
    cleanup
  }
}
