import { Router } from 'express'

import {
  createDownloadJobController,
  checkDownloadDuplicateController,
  getDownloadJobController,
  listDownloadJobsController,
  cancelDownloadJobController,
  pauseDownloadJobController,
  resumeDownloadJobController,
  retryDownloadJobController,
  deleteDownloadHistoryController,
  clearDownloadHistoryController,
  getDownloadSummaryController
} from '../controllers/downloadController.js'

const router = Router()

// Create and start a download
router.post('/', createDownloadJobController)

// Check whether selected download configuration is already active (read-only)
router.post('/check-duplicate', checkDownloadDuplicateController)

// Get aggregate download and history summary metrics
router.get('/summary', getDownloadSummaryController)

// Get recent download history
router.get('/', listDownloadJobsController)

// Clear explicitly selected terminal download history
router.delete('/history', clearDownloadHistoryController)

// Pause a running, queued, or interrupted download job
router.post('/:id/pause', pauseDownloadJobController)

// Resume a paused download job
router.post('/:id/resume', resumeDownloadJobController)

// Cancel a queued, running, paused, or interrupted download job
router.post('/:id/cancel', cancelDownloadJobController)

// Retry a failed or cancelled download job
router.post('/:id/retry', retryDownloadJobController)

// Get details of a specific download job
router.get('/:id', getDownloadJobController)

// Delete one terminal download history record
router.delete('/:id', deleteDownloadHistoryController)

export default router
