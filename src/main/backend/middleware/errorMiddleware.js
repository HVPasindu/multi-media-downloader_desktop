export function errorMiddleware(error, req, res, next) {
  console.error('Express API Error:', error)

  if (res.headersSent) {
    return next(error)
  }

  const code = error.status ?? error.statusCode

  const statusCode =
    Number.isInteger(code) &&
    code >= 400 &&
    code <= 599
      ? code
      : 500

  return res.status(statusCode).json({
    status: 'error',
    message:
      statusCode >= 500
        ? 'Internal server error'
        : 'Invalid request'
  })
}
