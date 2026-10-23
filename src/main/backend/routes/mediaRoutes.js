
import express from 'express'
import { analyzeMediaController } from '../controllers/mediaAnalyzerController.js'

const router = express.Router()

router.post('/analyze', analyzeMediaController)

export default router
