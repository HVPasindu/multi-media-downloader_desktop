import { app } from 'electron'
import { Sequelize } from 'sequelize'
import fs from 'node:fs'
import path from 'node:path'

import { runMigrations } from '../migrations/index.js'
import { initializeModels } from '../models/index.js'

let sequelize = null

export async function initializeDatabase(options = {}) {
  // Close any existing active connection to prevent connection leaks across test suites
  if (sequelize) {
    await sequelize.close()
    sequelize = null
  }

  let databasePath

  // Test Mode: use explicitly provided isolated database storage path
  if (options && typeof options.storage === 'string' && options.storage.trim()) {
    databasePath = path.resolve(options.storage.trim())

    // Ensure the isolated test storage directory exists
    fs.mkdirSync(path.dirname(databasePath), {
      recursive: true
    })
  } else {
    // Normal Production Mode: Electron user data folder
    const dataDirectory = path.join(app.getPath('userData'), 'data')

    // Create folder if it does not exist
    fs.mkdirSync(dataDirectory, {
      recursive: true
    })

    // SQLite database file path
    databasePath = path.join(dataDirectory, 'downloader.db')
  }

  // Create Sequelize connection
  sequelize = new Sequelize({
    dialect: 'sqlite',
    storage: databasePath,
    logging: false,
    dialectOptions: {
      // Set SQLite busy timeout so driver waits for table locks instead of failing immediately
      busyTimeout: 30000
    },
    pool: {
      max: 1,
      min: 0,
      idle: 10000
    }
  })

  try {
    await sequelize.authenticate()

    // Configure SQLite PRAGMAs for high-concurrency desktop operations
    await sequelize.query('PRAGMA journal_mode = WAL;')
    await sequelize.query('PRAGMA busy_timeout = 30000;')
    await sequelize.query('PRAGMA synchronous = NORMAL;')

    console.log('SQLite connected:', databasePath)

    // Run pending migrations first
    await runMigrations(sequelize)

    // Initialize ORM models and relationships
    initializeModels(sequelize)

    console.log('Database initialized successfully')

    return {
      sequelize,
      databasePath
    }
  } catch (error) {
    await sequelize.close()
    sequelize = null
    throw error
  }
}

export function getDatabase() {
  if (!sequelize) {
    throw new Error('Database is not initialized')
  }

  return sequelize
}

export async function closeDatabase() {
  if (sequelize) {
    await sequelize.close()
    sequelize = null
  }
}
