import express from 'express'

import healthRoutes from './routes/healthRoutes.js'
import mediaRoutes from './routes/mediaRoutes.js'
import downloadRoutes from './routes/downloadRoutes.js'
import settingsRoutes from './routes/settingsRoutes.js'
import { errorMiddleware } from './middleware/errorMiddleware.js'
import {
  hostValidationMiddleware,
  corsValidationMiddleware,
  authValidationMiddleware
} from './middleware/localApiAuthMiddleware.js'

export function createApiApp() {
  // Create Express application
  const app = express()

  // Do not expose Express in the response headers
  app.disable('x-powered-by')

  // Step 04.41 - Validate Host header to protect against DNS rebinding and host confusion
  app.use(hostValidationMiddleware)

  // Step 04.41 - Restrict browser origins and handle CORS preflight requests safely
  app.use(corsValidationMiddleware)

  // Parse JSON requests
  app.use(express.json({ limit: '50kb' }))

  // Register health API route (unauthenticated, safe minimal status only)
  app.use('/api/health', healthRoutes)

  // Step 04.41 - Require authentication for all sensitive API endpoints
  app.use('/api', authValidationMiddleware)

  // Media routes
  app.use('/api/media', mediaRoutes)
  //Download routes
  app.use('/api/downloads', downloadRoutes)
  // Download settings API
  app.use('/api/settings', settingsRoutes)

  // Handle unknown endpoints
  app.use((req, res) => {
    res.status(404).json({
      status: 'error',
      message: 'API route not found'
    })
  })

  // Central error handler (keep this last)
  app.use(errorMiddleware)

  return app
}
