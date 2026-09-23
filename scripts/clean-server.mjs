import { rm } from 'node:fs/promises'
const output = new URL('../server-dist/', import.meta.url)
await rm(output, { recursive: true, force: true })
