import { access, readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { parseEnv } from 'node:util'
import { fileURLToPath } from 'node:url'
import { createProductionServer } from './app.js'
import { log } from './logging.js'

try { process.loadEnvFile('.env') }
catch (error) {
  if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
}

if (process.env.APP_CONFIG_DIR) {
  try {
    const configuration = parseEnv(await readFile(join(process.env.APP_CONFIG_DIR, 'app.env'), 'utf8'))
    for (const [name, value] of Object.entries(configuration)) {
      if (process.env[name] === undefined) process.env[name] = value
    }
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw new Error('Unable to load runtime configuration')
  }
}

const port = Number(process.env.PORT || 8888)
if (!Number.isInteger(port) || port < 1 || port > 65535) {
  throw new Error('PORT must be an integer between 1 and 65535')
}
const distDirectory = fileURLToPath(new URL('../dist/', import.meta.url))
await access(new URL('../dist/index.html', import.meta.url))
const server = createProductionServer({ distDirectory })
server.on('error', () => {
  log('ERROR', 'server/index.ts:startup', 'Unable to start server')
  process.exitCode = 1
})
server.listen(port, '0.0.0.0', () => log('INFO', 'server/index.ts:startup', 'Circuit converter listening', { port }))

let shuttingDown = false
function shutdown() {
  if (shuttingDown) return
  shuttingDown = true
  const closed = new Promise<void>(resolve => server.close(() => resolve()))
  void closed.then(() => process.exit(0), () => process.exit(1))
  setTimeout(() => process.exit(1), 15000).unref()
}
process.once('SIGTERM', shutdown)
process.once('SIGINT', shutdown)
