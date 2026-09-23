import { createContext, useContext } from 'react'
import { Settings2 } from 'lucide-react'

export const ConnectionSettingsContext = createContext<(() => void) | null>(null)
export const AIConnectionContext = createContext<(ready: () => void) => void>(ready => ready())

export function ConnectionSettingsButton() {
  const open = useContext(ConnectionSettingsContext)
  if (!open) return null
  return <button className="video-connection-button" onClick={open} aria-haspopup="dialog" aria-label="连接设置" title="连接设置"><Settings2 size={16} /><span>连接设置</span></button>
}
