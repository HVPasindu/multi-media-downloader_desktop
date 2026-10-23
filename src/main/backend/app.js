
import express from 'express'

import healthRoutes from './routes/healthRoutes.js'
import mediaRoutes from './routes/mediaRoutes.js'
import { errorMiddleware } from './middleware/errorMiddleware.js'

export function createApiApp() {
  // Create Express application
  const app = express()

  // Do not expose Express in the response headers
  app.disable('x-powered-by')

  // Parse JSON requests
  app.use(express.json({ limit: '50kb' }))

  // Register health API route
  app.use('/api/health', healthRoutes)

  // Media routes
  app.use('/api/media', mediaRoutes)

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
