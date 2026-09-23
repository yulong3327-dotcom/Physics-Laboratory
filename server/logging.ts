import { AsyncLocalStorage } from 'node:async_hooks'
import { randomUUID } from 'node:crypto'
import type { IncomingMessage, ServerResponse } from 'node:http'

const requests = new AsyncLocalStorage<{ requestId: string; headers: Record<string, string> }>()

export function log(level: 'INFO' | 'ERROR', file: string, msg: string, details: Record<string, string | number> = {}) {
  process.stdout.write('tt=-notice.new tp=server.log ' + JSON.stringify({
    ...details, level, time: new Date().toISOString(), file, msg,
    requestId: requests.getStore()?.requestId || '', logId: randomUUID(),
  }) + '\n')
}

export function traceHeaders() { return requests.getStore()?.headers || {} }

export function withRequestLogging(req: IncomingMessage, res: ServerResponse, handle: () => void) {
  const headers: Record<string, string> = {}
  for (const name of ['zyb-trace-id', 'uber-trace-id']) {
    const value = req.headers[name]
    if (typeof value === 'string' && /^[A-Za-z0-9:._-]{1,256}$/.test(value)) headers[name] = value
  }
  const context = { requestId: headers['zyb-trace-id'] || headers['uber-trace-id'] || '', headers }
  requests.run(context, () => {
    const started = performance.now()
    res.once('finish', () => requests.run(context, () => log(
      res.statusCode >= 500 ? 'ERROR' : 'INFO', 'server/app.ts:request', 'request complete',
      { method: req.method || '', status: res.statusCode, cost: Math.round(performance.now() - started) },
    )))
    handle()
  })
}
