import { randomUUID } from 'node:crypto'
import { link, open, unlink } from 'node:fs/promises'

/** Publish a complete owner record without ever replacing another owner. */
export async function createVideoFileLock(path: string, owner: unknown) {
  const temporary = path + '.' + randomUUID() + '.tmp'
  try {
    const file = await open(temporary, 'wx')
    try { await file.writeFile(JSON.stringify(owner), 'utf8'); await file.sync() } finally { await file.close() }
    // A hard link is atomic and fails with EEXIST. Unlike rename it cannot
    // overwrite a live owner; a crash cannot leave an empty lock record.
    await link(temporary, path)
  } finally { await unlink(temporary).catch(() => {}) }
}
