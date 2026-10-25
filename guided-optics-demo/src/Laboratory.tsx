import { useEffect, useState } from 'react'
import { ArrowRight, BookOpen, CheckCircle2, Download, FlaskConical } from 'lucide-react'
import { Capacitor } from '@capacitor/core'
import { App as NativeApp } from '@capacitor/app'
import { ScreenOrientation } from '@capacitor/screen-orientation'
import OpticsLesson from './App'
import { load, stages } from './curriculum'
import './laboratory.css'

const native = Capacitor.isNativePlatform()
const inLesson = () => location.hash === '#/optics'

export default function Laboratory() {
  const [lesson, setLesson] = useState(inLesson)
  const navigate = (open: boolean) => { location.hash = open ? '/optics' : '/' }
  useEffect(() => {
    const changed = () => setLesson(inLesson())
    window.addEventListener('hashchange', changed)
    const back = native ? NativeApp.addListener('backButton', () => {
      if (inLesson()) navigate(false)
      else void NativeApp.exitApp()
    }) : null
    return () => { window.removeEventListener('hashchange', changed); void back?.then(listener => listener.remove()) }
  }, [])
  useEffect(() => {
    document.title = lesson ? '凸透镜成像规律 · 精准学AI实验室' : '精准学AI实验室'
    if (native) void ScreenOrientation.lock({ orientation: lesson ? 'landscape' : 'portrait' }).catch(() => {})
  }, [lesson])
  if (lesson) return <OpticsLesson onHome={() => navigate(false)}/>
  const saved = load(), completed = saved.completedSteps.length, started = saved.equipment > 0 || saved.step > 0
  return <div className="laboratory-home">
    <header className="library-header"><div className="library-brand"><img src="app-icon.png" alt=""/><strong>精准学AI实验室</strong></div><span className="library-edition">初中科学探究</span></header>
    <main className="library-main">
      <div className="library-heading"><div><span className="library-eyebrow"><FlaskConical size={17}/>初中 · 科学实验</span><h1>同步探究</h1></div><img className="library-mascot" src="guide-avatar.png" alt="实验引导伙伴"/></div>
      <div className="library-section-heading"><h2>物理实验</h2><span>1 个实验</span></div>
      <button className="experiment-entry" aria-label="进入凸透镜实验" onClick={() => navigate(true)}>
        <div className="experiment-image"><img src="optics-preview.png" alt="蜡烛、凸透镜和光屏组成的光学实验装置"/><span>光学实验</span></div>
        <div className="experiment-info"><div className="experiment-tags"><span>初中物理</span><span>14 个题型</span></div><h3>凸透镜成像规律</h3><p>探究物距、像距与成像特点</p><div className="experiment-progress"><BookOpen size={15}/><span>{started ? `已完成 ${completed} / ${stages.length} 小节` : '从摆放实验器材开始'}</span></div>{started && <progress max={stages.length} value={completed} aria-label="实验完成进度"/>}<div className="experiment-enter"><span>{started ? '继续实验' : '开始实验'}</span><ArrowRight size={20}/></div></div>
      </button>
      <div className="library-note"><CheckCircle2 size={16}/><span>{native ? '实验、字体与语音已内置' : '实验进度自动保存在当前设备'}</span></div>
    </main>
    <footer className="library-footer"><span>精准学AI实验室 · 1.0</span>{!native && <a href="https://github.com/yulong3327-dotcom/Physics-Laboratory/releases/latest/download/jingzhun-ai-lab.apk"><Download size={15}/>安卓安装包</a>}</footer>
  </div>
}
