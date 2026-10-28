
import { Router } from 'express'

import {
  createDownloadJobController,
  getDownloadJobController,
  listDownloadJobsController,
  cancelDownloadJobController
} from '../controllers/downloadController.js'

const router = Router()

// Create and start a download
router.post('/', createDownloadJobController)

// Get recent download history
router.get('/', listDownloadJobsController)

// Cancel a queued or running download job
router.post('/:id/cancel', cancelDownloadJobController)

// Get details of a specific download job
router.get('/:id', getDownloadJobController)

export default router
