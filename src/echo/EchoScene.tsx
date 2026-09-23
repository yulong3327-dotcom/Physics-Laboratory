import type { EchoModelId, EchoResult } from './types'

export const numberText = (value: number) => Number(value.toFixed(4)).toLocaleString('zh-CN', { maximumFractionDigits: 4 })

export function EchoScene({ result: r, time, modelId, train = false }: { result: EchoResult | null; time: number; modelId: EchoModelId | null; train?: boolean }) {
  if (!r) return <div className="echo-scene-empty"><svg viewBox="0 0 300 120" aria-hidden="true"><path d="M55 60 H245 M95 35L120 60 95 85 M165 35L190 60 165 85" fill="none" stroke="currentColor" strokeWidth="2" strokeDasharray="5 5" /><path d="M240 20V100" stroke="currentColor" strokeWidth="6" /></svg><h3>题目将变成一个可观察的过程</h3><p>生成模型并补齐条件后，观察声波与运动物体在何处相遇。</p></div>
  const vertical = modelId === 'descending' || modelId === 'ascending' || modelId === 'depth'
  const water = modelId === 'depth'
  const t = Math.min(r.echoTime, time)
  const source = r.sourceSpeed * t + .5 * r.acceleration * t * t
  const target = r.initialDistance + r.targetSpeed * t
  const reflection = r.initialDistance + r.targetSpeed * r.reflectionTime
  const wave = t <= r.reflectionTime ? r.soundSpeed * t : 2 * reflection - r.soundSpeed * t
  const min = Math.min(0, r.sourceSpeed * r.echoTime, r.finalDistance < 0 ? r.finalDistance : 0)
  const max = Math.max(r.initialDistance, r.initialDistance + r.targetSpeed * r.echoTime, r.sourceSpeed * r.echoTime)
  const scale = (vertical ? 238 : 660) / Math.max(1, max - min)
  const p = (x: number) => (vertical ? 83 : 95) + (x - min) * scale
  const a = p(source), b = p(target), w = p(wave), origin = p(0)
  const done = Math.abs(t - r.echoTime) < 1e-7
  const phase = done ? '接收到回声' : t === 0 ? '即将发声' : t < r.reflectionTime ? '声音正在传向反射面' : '声音反射后返回'
  return <svg data-testid="echo-scene" className="echo-scene" viewBox="0 0 850 400" role="img" aria-label="回声测距仿真：声源、声波与反射面的位置">
    <defs><pattern id="echo-grid" width="24" height="24" patternUnits="userSpaceOnUse"><circle cx="1" cy="1" r=".8" fill="#d3e2e2" /></pattern><marker id="echo-arrow" markerWidth="8" markerHeight="8" refX="6" refY="4" orient="auto-start-reverse"><path d="M0 0L8 4L0 8" fill="none" stroke="#8a9fa6" strokeWidth="1" /></marker></defs>
    <rect width="850" height="400" fill={water ? '#eff8ff' : '#f6fafb'} /><rect width="850" height="400" fill="url(#echo-grid)" />
    <rect x="22" y="20" width="205" height="33" rx="16" fill="white" stroke="#dce7e8" /><circle cx="39" cy="36" r="4" fill={done ? '#139d79' : '#087e98'} /><text x="52" y="41" fontSize="12" fill="#41616b">{phase}</text>
    <text x="823" y="40" textAnchor="end" fontSize="12" fill="#76909a">一维传播 · 长度单位 m</text>
    {vertical ? <>
      <path d={`M260 ${b}H570`} stroke="#899b98" strokeWidth="5" /><path d={`M260 ${b + 8}H570`} stroke="#b5c3bb" strokeWidth="10" strokeDasharray="3 9" /><text x="583" y={b + 4} fontSize="12" fill="#5d7779">{water ? '海底' : '地面'}</text>
      <path d={`M410 ${origin}V${b}`} stroke="#aec1c7" strokeWidth="1.5" strokeDasharray="5 5" />
      <path d={`M405 ${origin}V${w}`} stroke={t <= r.reflectionTime ? '#e7ac36' : '#20a3b6'} strokeWidth="3" />
      {!water ? <g transform={`translate(410 ${a})`}><path d="M-24 -4H24M-13 -4L-19 -12M13 -4L19 -12" stroke="#216b86" strokeWidth="3" /><ellipse cx="0" cy="0" rx="13" ry="6" fill="#2d7d98" /><path d="M-30 -13H-10M10 -13H30" stroke="#8db8c8" strokeWidth="3" /><path d="M-8 3L-12 11M8 3L12 11" stroke="#216b86" strokeWidth="2" /></g> : <g transform={`translate(410 ${a})`}><path d="M-35 0H35L22 18H-22Z" fill="#2677a0" /><path d="M-18 -3V-16H12L18 -3" fill="#d6e9f2" stroke="#2677a0" /></g>}
      <circle cx="410" cy={w} r="7" fill={done ? '#159b79' : '#e5b343'} stroke="white" strokeWidth="2" />
      <path d={`M535 ${a}V${b}`} stroke="#8a9fa6" markerStart="url(#echo-arrow)" markerEnd="url(#echo-arrow)" /><text x="550" y={(a + b) / 2} fontSize="13" fill="#43616c">{numberText(target - source)} m</text>
      <text x="285" y={a - 20} fontSize="12" fill="#31627a">{water ? '声呐发射 / 接收' : '无人机'}</text>
    </> : <>
      <path d="M40 279H810" stroke="#c0cecf" strokeWidth="2" /><path d="M40 287H810" stroke="#dfe7e7" strokeWidth="2" strokeDasharray={train ? '4 9' : '15 10'} />
      {modelId === 'moving-target' ? <g transform={`translate(${b} 222)`}><path d="M-30 0H30M-17 0L-23 -12M17 0L23 -12" stroke="#73927b" strokeWidth="3" /><rect x="-14" y="-5" width="28" height="12" rx="5" fill="#8ba794" /><path d="M-35 -12H-12M12 -12H35" stroke="#73927b" strokeWidth="3" /></g> : <><path d={`M${b} 112L${b + 15} 99 ${b + 29} 158 ${b + 18} 187 ${b + 40} 221 ${b + 35} 276H${b}Z`} fill="#bdcdc5" stroke="#9dafaa" /><path d={`M${b} 112V278`} stroke="#6a8781" strokeWidth="3" /></>}
      <text x={Math.min(b, 770)} y="98" textAnchor="middle" fontSize="12" fill="#5f7874">{modelId === 'moving-target' ? '移动反射目标' : '反射面'}</text>
      <line x1={origin} x2={origin} y1="186" y2="279" stroke="#9db5bf" strokeDasharray="4 4" /><text x={origin} y="307" textAnchor="middle" fontSize="11" fill="#7b9299">发声位置</text>
      <path d={`M${origin} 170H${p(reflection)}`} stroke="#dabf7f" strokeWidth="1.5" strokeDasharray="5 5" /><path d={`M${p(reflection)} 195H${p(r.sourceSpeed * r.echoTime + .5 * r.acceleration * r.echoTime ** 2)}`} stroke="#9ec6d2" strokeWidth="1.5" strokeDasharray="5 5" />
      <circle cx={w} cy={t <= r.reflectionTime ? 170 : 195} r="7" fill={done ? '#159b79' : '#e5b343'} stroke="white" strokeWidth="2" /><text x={Math.max(100, Math.min(735, w))} y={t <= r.reflectionTime ? 150 : 219} textAnchor="middle" fontSize="11" fill="#8a763e">{done ? '声波与接收者相遇' : t <= r.reflectionTime ? '去程声波' : '返回声波'}</text>
      <g transform={`translate(${a} 260)`}><path d={train ? 'M-43 4V-25H22L37 -12V4Z' : 'M-36 4V-11L-21 -15 -10 -29H13L25 -15 38 -10V4Z'} fill="#31869e" stroke="#216d85" strokeWidth="1.5" /><path d={train ? 'M-30 -19H12V-7H-30Z' : 'M-16 -15L-7 -25H10L20 -15Z'} fill="#d3edf1" /><circle cx="-22" cy="7" r="8" fill="#344e59" /><circle cx="23" cy="7" r="8" fill="#344e59" /><circle cx="-22" cy="7" r="3" fill="#ccdde1" /><circle cx="23" cy="7" r="3" fill="#ccdde1" /></g>
      <path d={`M${a} 337H${b}`} stroke="#8a9fa6" markerStart="url(#echo-arrow)" markerEnd="url(#echo-arrow)" /><rect x={(a + b) / 2 - 63} y="324" width="126" height="26" rx="13" fill="#f6fafb" /><text x={(a + b) / 2} y="341" textAnchor="middle" fontSize="13" fill="#43616c">当前 {numberText(target - source)} m</text>
    </>}
    <text x="22" y="378" fontSize="11" fill="#7c929a">物体外观为示意；位置与声波事件按物理方程计算</text><text x="823" y="378" textAnchor="end" fontSize="12" fill="#436570">t = {numberText(t)} s</text>
  </svg>
}
