import { app } from 'electron'
import { Sequelize } from 'sequelize'
import fs from 'node:fs'
import path from 'node:path'

import { runMigrations } from '../migrations/index.js'
import { initializeModels } from '../models/index.js'

let sequelize = null

export async function initializeDatabase() {
  // Electron user data folder
  const dataDirectory = path.join(
    app.getPath('userData'),
    'data'
  )

  // Create folder if it does not exist
  fs.mkdirSync(dataDirectory, {
    recursive: true
  })

  // SQLite database file path
  const databasePath = path.join(
    dataDirectory,
    'downloader.db'
  )

  // Create Sequelize connection
  sequelize = new Sequelize({
    dialect: 'sqlite',
    storage: databasePath,
    logging: false,
    pool: {
      max: 1,
      min: 0,
      idle: 10000
    }
  })

  try {
    await sequelize.authenticate()

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
