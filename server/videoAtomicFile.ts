import { rename } from 'node:fs/promises'
import { setTimeout as delay } from 'node:timers/promises'

/** Keep the old file intact while Windows readers briefly prevent replacement. */
export async function replaceVideoFile(temporary: string, target: string): Promise<void> {
  for (let attempt = 0; ; attempt++) {
    try { await rename(temporary, target); return }
    catch (error) {
      const code = (error as NodeJS.ErrnoException).code
      if (attempt >= 7 || !['EPERM', 'EACCES', 'EBUSY'].includes(code || '')) throw error
      // Retrying the same atomic rename never exposes an absent or partial target.
      await delay(Math.min(25 * 2 ** attempt, 250))
    }
  }
}
