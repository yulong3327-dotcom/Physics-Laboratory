import { ArrowRight, CircuitBoard, FlaskConical, Waves } from 'lucide-react'
import '../styles/toolHome.css'

type ToolHomeProps = {
  onCircuit: () => void
  onOptics: () => void
}

const tools = [
  {
    id: 'circuit',
    title: '电学实验室',
    description: '搭建电路图与实物图，观察通路、读数和实验状态。',
    meta: '电学实验',
    action: '进入电学实验室',
    icon: CircuitBoard,
    tone: 'mint',
  },
  {
    id: 'optics',
    title: '光学实验室',
    description: '组合透镜、光源和光屏，实时查看光路与成像结果。',
    meta: '几何光学',
    action: '进入光学实验室',
    icon: Waves,
    tone: 'blue',
  },
] as const

export function ToolHome({ onCircuit, onOptics }: ToolHomeProps) {
  const open = { circuit: onCircuit, optics: onOptics }
  return <main className="tool-home">
    <header className="tool-home-header">
      <div className="tool-home-brand"><span className="tool-home-mark"><FlaskConical size={22} /></span><span>物理仿真 AI 实验室</span></div>
      <span className="tool-home-status"><i />2 个实验室</span>
    </header>
    <section className="tool-home-intro">
      <div>
        <p className="tool-home-eyebrow">PHYSICS TOOLKIT</p>
        <h1>物理实验室</h1>
      </div>
    </section>
    <section className="tool-grid" aria-label="实验工具">
      {tools.map(tool => {
        const Icon = tool.icon
        return <article key={tool.id} className={`tool-card tool-card-${tool.tone}`}>
          <div className="tool-card-visual"><span className="tool-card-icon"><Icon size={42} strokeWidth={1.45} /></span><span className="tool-card-orbit tool-card-orbit-one" /><span className="tool-card-orbit tool-card-orbit-two" /></div>
          <div className="tool-card-body">
            <p>{tool.meta}</p>
            <h2>{tool.title}</h2>
            <span>{tool.description}</span>
          </div>
          <button onClick={open[tool.id]}>{tool.action}<ArrowRight size={16} /></button>
        </article>
      })}
    </section>
    <footer className="tool-home-footer"><span>实验工具台</span><span>草稿仅保存在当前浏览器</span></footer>
  </main>
}
