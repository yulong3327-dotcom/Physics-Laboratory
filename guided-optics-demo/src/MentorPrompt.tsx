import { useEffect, useRef } from 'react'
import { MoreHorizontal, RotateCcw, Volume2, VolumeX, X } from 'lucide-react'
import type { VoiceGuide } from './useVoiceGuide'

export function MentorPrompt({ guide, detail, tone }: { guide: VoiceGuide; detail: string; tone: 'tip' | 'warn' | 'good' }) {
  const menuRef = useRef<HTMLDetailsElement>(null)
  useEffect(() => { if (menuRef.current) menuRef.current.open = false }, [guide.cue.id])
  useEffect(() => {
    const dismiss = (event: PointerEvent) => { if (menuRef.current && !menuRef.current.contains(event.target as Node)) menuRef.current.open = false }
    const escape = (event: KeyboardEvent) => { if (event.key === 'Escape' && menuRef.current?.open) { menuRef.current.open = false; menuRef.current.querySelector('summary')?.focus() } }
    document.addEventListener('pointerdown', dismiss)
    document.addEventListener('keydown', escape)
    return () => { document.removeEventListener('pointerdown', dismiss); document.removeEventListener('keydown', escape) }
  }, [])
  function action(run: () => void) { run(); if (menuRef.current) menuRef.current.open = false }
  const avatar = new URL('guide-avatar.png', document.baseURI).href
  if (!guide.open) return <button className="mentor-reopen" onClick={guide.reopen} title="打开语音引导" aria-label="打开语音引导"><img src={avatar} alt=""/>打开引导</button>

  return <div className={`mentor-prompt ${tone}`} role="status" data-cue={guide.cue.id}>
    <img className="mentor-avatar" src={avatar} alt="实验引导角色"/>
    <div className="mentor-bubble"><div className="mentor-heading"><strong>{guide.cue.text}</strong>
      {guide.playing && <span className="mentor-speaking" aria-label="正在讲解"><i/><i/><i/></span>}
      <details className="mentor-controls" ref={menuRef}><summary title="更多引导选项" aria-label="更多引导选项"><MoreHorizontal size={18}/></summary><div className="mentor-menu">
        <button onClick={() => action(guide.replay)}><RotateCcw size={16}/>重播引导</button>
        <button onClick={() => action(guide.toggleMute)}>{guide.muted ? <VolumeX size={16}/> : <Volume2 size={16}/>}<span>{guide.muted ? '取消静音' : '静音'}</span></button>
        <button onClick={() => action(guide.close)}><X size={16}/>关闭引导</button>
      </div></details>
    </div><p className="mentor-message">{guide.error ? '语音暂时无法加载，文字提示仍可使用。' : detail}</p></div>
  </div>
}
