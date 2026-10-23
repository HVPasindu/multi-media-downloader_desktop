
export function getHealth(req, res) {
  return res.status(200).json({
    status: 'ok',
    message: 'Multi Media Downloader API is running'
  })
}
