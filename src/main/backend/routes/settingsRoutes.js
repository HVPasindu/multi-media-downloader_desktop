import { Router } from 'express'

import {
  getDownloadSettingsController,
  updateDownloadSettingsController
} from '../controllers/settingsController.js'

const router = Router()

// Get current download preferences
router.get('/downloads', getDownloadSettingsController)

// Update download preferences
router.patch('/downloads', updateDownloadSettingsController)

export default router

