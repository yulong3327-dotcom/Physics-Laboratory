import { createReadStream } from 'node:fs'
import { stat } from 'node:fs/promises'
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http'
import { extname, isAbsolute, relative, resolve, sep } from 'node:path'
import { createAISessionMiddleware } from './aiSession.js'
import { createAIProxyMiddleware, type AIEnvironment } from './aiProxy.js'
import { withRequestLogging } from './logging.js'

const contentTypes: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.gif': 'image/gif',
  '.ico': 'image/x-icon',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.mp4': 'video/mp4',
  '.webm': 'video/webm',
  '.mp3': 'audio/mpeg',
  '.wav': 'audio/wav',
  '.wasm': 'application/wasm',
}

function reply(res: ServerResponse, status: number, data: unknown) {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' })
  res.end(JSON.stringify(data))
}

async function serveStatic(req: IncomingMessage, res: ServerResponse, distDirectory: string) {
  if (req.method !== 'GET' && req.method !== 'HEAD') {
    res.setHeader('Allow', 'GET, HEAD')
    reply(res, 405, { error: 'Method not allowed' })
    return
  }
  let pathname: string
  try { pathname = decodeURIComponent((req.url || '/').split('?')[0]) }
  catch { reply(res, 400, { error: 'Invalid path' }); return }
  if (!pathname.startsWith('/') || pathname.includes('\\') || pathname.includes('\0') || pathname.split('/').some(part => part.startsWith('.'))) {
    reply(res, 404, { error: 'Not found' }); return
  }
  const root = resolve(distDirectory)
  let filename = resolve(root, `.${pathname === '/' ? '/index.html' : pathname}`)
  const relativePath = relative(root, filename)
  if (isAbsolute(relativePath) || relativePath === '..' || relativePath.startsWith(`..${sep}`)) {
    reply(res, 404, { error: 'Not found' }); return
  }
  let info = await stat(filename).catch(() => null)
  if (!info?.isFile()) {
    // Browser routes fall back to the app; missing assets must remain 404s.
    if (extname(pathname) || !req.headers.accept?.includes('text/html')) {
      reply(res, 404, { error: 'Not found' }); return
    }
    filename = resolve(root, 'index.html')
    info = await stat(filename).catch(() => null)
  }
  if (!info?.isFile()) { reply(res, 404, { error: 'Not found' }); return }
  const extension = extname(filename).toLowerCase()
  res.setHeader('Content-Type', contentTypes[extension] || 'application/octet-stream')
  res.setHeader('Content-Length', info.size)
  const isHashedAsset = pathname.startsWith('/assets/') && /-[A-Za-z0-9_-]{8,}\.[^.]+$/.test(filename)
  res.setHeader('Cache-Control', isHashedAsset ? 'public, max-age=31536000, immutable' : 'no-cache')
  if (req.method === 'HEAD') { res.end(); return }
  const file = createReadStream(filename)
  file.on('error', () => {
    if (res.headersSent) res.destroy()
    else {
      res.removeHeader('Content-Length')
      reply(res, 500, { error: 'Unable to read asset' })
    }
  })
  res.on('close', () => file.destroy())
  file.pipe(res)
}

export function createProductionServer(options: { distDirectory: string; env?: AIEnvironment }) {
  const session = createAISessionMiddleware(options.env || process.env)
  const ai = createAIProxyMiddleware(options.env || process.env)
  const server = createServer((req, res) => withRequestLogging(req, res, () => {
    res.setHeader('X-Content-Type-Options', 'nosniff')
    res.setHeader('Referrer-Policy', 'same-origin')
    const handle = async () => {
      const pathname = (req.url || '').split('?')[0]
      if (pathname === '/api/health') {
        if (req.method !== 'GET' && req.method !== 'HEAD') {
          res.setHeader('Allow', 'GET, HEAD')
          reply(res, 405, { error: 'Method not allowed' })
          return
        }
        reply(res, 200, { status: 'ok' })
        return
      }
      let handled = true
      await ai(req, res, () => { handled = false })
      if (handled) return
      if (pathname === '/api' || pathname.startsWith('/api/')) {
        reply(res, 404, { error: 'API not found' }); return
      }
      await serveStatic(req, res, options.distDirectory)
    }
    void session(req, res, handle).catch(() => {
      if (res.headersSent) res.destroy()
      else reply(res, 500, { error: 'Internal server error' })
    })
  }))
  server.requestTimeout = 30000
  server.headersTimeout = 15000
  server.keepAliveTimeout = 5000
  return server
}
