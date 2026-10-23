
import { createServer } from 'node:http'
import { createApiApp } from './app.js'

const HOST = '127.0.0.1'
const PORT = 3001

let httpServer = null

export async function startServer() {
  // Prevent duplicate server startup
  if (httpServer) {
    return {
      baseUrl: `http://${HOST}:${PORT}`
    }
  }

  // Create Express application
  const expressApp = createApiApp()

  // Create HTTP server
  const server = createServer(expressApp)

  // Start server and wait until listening
  await new Promise((resolve, reject) => {
    const onError = (error) => {
      server.off('listening', onListening)
      reject(error)
    }

    const onListening = () => {
      server.off('error', onError)
      resolve()
    }

    server.once('error', onError)
    server.once('listening', onListening)

    server.listen(PORT, HOST)
  })

  // Keep server reference for shutdown
  httpServer = server

  // Log unexpected errors after startup
  httpServer.on('error', (error) => {
    console.error('HTTP Server Error:', error)
  })

  console.log(
    `Express API running at http://${HOST}:${PORT}`
  )

  return {
    baseUrl: `http://${HOST}:${PORT}`
  }
}

export async function stopServer() {
  if (!httpServer) {
    return
  }

  const server = httpServer
  httpServer = null

  await new Promise((resolve, reject) => {
    server.close((error) => {
      if (error) {
        reject(error)
      } else {
        resolve()
      }
    })
  })

  console.log('Express API server stopped')
}
