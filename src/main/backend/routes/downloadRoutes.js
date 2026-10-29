import { Router } from 'express'

import {
  createDownloadJobController,
  getDownloadJobController,
  listDownloadJobsController,
  cancelDownloadJobController,
  retryDownloadJobController,
  deleteDownloadHistoryController,
  clearDownloadHistoryController
} from '../controllers/downloadController.js'

const router = Router()

// Create and start a download
router.post('/', createDownloadJobController)

// Get recent download history
router.get('/', listDownloadJobsController)

// Clear explicitly selected terminal download history
router.delete('/history', clearDownloadHistoryController)

// Cancel a queued or running download job
router.post('/:id/cancel', cancelDownloadJobController)

// Retry a failed or cancelled download job
router.post('/:id/retry', retryDownloadJobController)

// Get details of a specific download job
router.get('/:id', getDownloadJobController)

// Delete one terminal download history record
router.delete('/:id', deleteDownloadHistoryController)

export default router
