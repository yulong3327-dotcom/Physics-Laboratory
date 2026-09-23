import { zipSync } from 'fflate'

self.onmessage = (event: MessageEvent<Record<string, Uint8Array>>) => {
  const packed = zipSync(event.data, { level: 1 })
  self.postMessage(packed, { transfer: [packed.buffer] })
}
