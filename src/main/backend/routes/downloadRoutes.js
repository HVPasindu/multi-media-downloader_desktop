
import express from 'express'

import { createDownloadJobController } from '../controllers/downloadController.js'

const router = express.Router()

router.post('/', createDownloadJobController)

export default router
