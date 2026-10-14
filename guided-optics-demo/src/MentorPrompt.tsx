import { Pause, Play, RotateCcw, Volume2, VolumeX, X } from 'lucide-react'
import type { VoiceGuide } from './useVoiceGuide'

export function MentorPrompt({ guide, detail, tone }: { guide: VoiceGuide; detail: string; tone: 'tip' | 'warn' | 'good' }) {
  const avatar = new URL('guide-avatar.png', document.baseURI).href
  if (!guide.open) return <button className="mentor-reopen" onClick={guide.reopen} title="打开语音引导" aria-label="打开语音引导"><img src={avatar} alt=""/>打开引导</button>

  return <div className={`mentor-prompt ${tone}`} role="status" data-cue={guide.cue.id}>
    <img className="mentor-avatar" src={avatar} alt="实验引导角色"/>
    <div className="mentor-copy"><strong>{guide.cue.text}</strong><span>{guide.error ? '语音暂时无法加载，文字提示仍可使用。' : detail}</span></div>
    <div className="mentor-controls">
      <button onClick={guide.togglePlay} title={guide.playing ? '暂停语音' : '播放语音'} aria-label={guide.playing ? '暂停语音' : '播放语音'}>{guide.playing ? <Pause size={15}/> : <Play size={15}/>}</button>
      <button onClick={guide.replay} title="重播引导" aria-label="重播引导"><RotateCcw size={15}/></button>
      <button onClick={guide.toggleMute} title={guide.muted ? '取消静音' : '静音'} aria-label={guide.muted ? '取消静音' : '静音'}>{guide.muted ? <VolumeX size={15}/> : <Volume2 size={15}/>}</button>
      <button onClick={guide.close} title="关闭引导" aria-label="关闭引导"><X size={15}/></button>
    </div>
  </div>
}
