import type { OpticalComponent } from './types'

type Bounds = { x: number; y: number; width: number; height: number }
const STROKE = '#242a27'
const BLUE = '#0073bb'
const RED = '#ef3e32'
const GLASS = '#d9e9ff'

/** Textbook-style vector symbols. Optical coordinates stay anchored at (0, 0). */
export function opticalSymbolBounds(c: OpticalComponent): Bounds {
  if (c.kind === 'object') return { x: -3.4, y: -c.height - 1.4, width: 6.8, height: c.height + 3 }
  if (c.kind === 'point-source') return { x: -3.4, y: -3.4, width: 6.8, height: 6.8 }
  if (c.kind === 'laser') return { x: -13.5, y: -3, width: 14.5, height: 6 }
  const width = c.kind === 'glass-slab' || c.kind === 'prism' ? c.width + 2 : 7
  return { x: -width / 2, y: -c.height / 2 - 1, width, height: c.height + 3 }
}

function lineProps(thumbnail: boolean, color = STROKE) {
  return { stroke: color, strokeWidth: thumbnail ? 1.35 : 1.65, vectorEffect: 'non-scaling-stroke' as const, strokeLinecap: 'round' as const, strokeLinejoin: 'round' as const }
}

function Lens({ concave, height, thumbnail }: { concave: boolean; height: number; thumbnail: boolean }) {
  const h = height / 2
  const d = concave
    ? `M-2.2 ${-h} Q1.9 0 -2.2 ${h} M2.2 ${-h} Q-1.9 0 2.2 ${h}`
    : `M0 ${-h} Q-5.2 0 0 ${h} Q5.2 0 0 ${-h}Z`
  return <path d={d} fill={concave ? 'none' : GLASS} {...lineProps(thumbnail)} />
}

function arrowPath(height: number) {
  const shaft = Math.min(.8, height * .09), head = Math.min(2.4, height * .28)
  const shoulder = -height + Math.min(4, height * .4)
  return `M${-shaft} 0H${shaft}V${shoulder}H${head}L0 ${-height}L${-head} ${shoulder}H${-shaft}Z`
}

export function OpticalSymbol({ component: c, thumbnail = false }: { component: OpticalComponent; thumbnail?: boolean }) {
  const h = c.height / 2
  const p = lineProps(thumbnail)
  let shape: React.ReactNode
  switch (c.kind) {
    case 'convex-lens': shape = <Lens height={c.height} thumbnail={thumbnail} concave={false} />; break
    case 'concave-lens': shape = <Lens height={c.height} thumbnail={thumbnail} concave />; break
    case 'plane-mirror': shape = <g><line x1="0" y1={-h} x2="0" y2={h} {...p} /><g {...p} opacity=".75">{Array.from({ length: Math.max(2, Math.ceil(c.height / 2.4)) }, (_, i) => <path key={i} d={`M0 ${-h + i * 2.4}l1.8 1.3`} />)}</g></g>; break
    case 'screen': shape = <g><line x1="0" y1={-h} x2="0" y2={h} {...p} /><line x1="3" y1={-h} x2="3" y2={h} stroke="#aab3ad" strokeDasharray="1.5 1.5" vectorEffect="non-scaling-stroke" /><path d={`M-2 ${h + 1.2}H3`} {...p} /></g>; break
    case 'aperture': { const opening = Math.min(c.height, c.opening) / 2; shape = <g><line x1="0" y1={-h} x2="0" y2={-opening} {...p} /><line x1="0" y1={opening} x2="0" y2={h} {...p} /><path d={`M-2 ${-opening}H2M-2 ${opening}H2`} stroke="#9aa59e" strokeDasharray="1 1" vectorEffect="non-scaling-stroke" /></g>; break }
    case 'glass-slab': shape = <rect x={-c.width / 2} y={-h} width={c.width} height={c.height} fill={GLASS} {...p} />; break
    case 'prism': shape = <path d={`M${-c.width / 2} ${h}L${c.width / 2} ${h}L0 ${-h}Z`} fill={GLASS} {...p} />; break
    case 'object': shape = <path d={arrowPath(c.height)} fill={BLUE} />; break
    case 'point-source': shape = <g><circle r="1.45" fill="#fff" {...p} /><g stroke={RED} strokeWidth={thumbnail ? 1 : 1.3} vectorEffect="non-scaling-stroke">{Array.from({ length: 8 }, (_, i) => <path key={i} d="M2 0H3" transform={`rotate(${i * 45})`} />)}</g></g>; break
    case 'parallel-source': shape = <g><rect x="-3" y={-h} width="2" height={c.height} rx=".5" fill="#eef2f5" {...p} /><g {...p}>{[-.55, 0, .55].map(offset => <path key={offset} d={`M-0.4 ${offset * h}H3m-1.2 -1.2L3 ${offset * h}l-1.2 1.2`} />)}</g></g>; break
    case 'laser': shape = <g><path d="M-12 -2.1H-2.2L0 -1.1V1.1L-2.2 2.1H-12Z" fill="#e5eaf0" {...p} /><path d="M-10 -2.1V2.1M-8 -2.1V2.1" stroke="#9aa6b3" vectorEffect="non-scaling-stroke" /><path d="M-2.2 -1.1L0 0L-2.2 1.1Z" fill="#f04a3e" stroke={RED} strokeWidth={thumbnail ? 1 : 1.3} vectorEffect="non-scaling-stroke" /><circle cx="-.2" cy="0" r=".7" fill={RED} stroke="#fff" strokeWidth=".35" vectorEffect="non-scaling-stroke" /></g>; break
  }
  return <g className="optics-symbol" opacity={c.enabled ? 1 : .4}>{shape}</g>
}

export function OpticalImageArrow({ height, virtual = false }: { height: number; virtual?: boolean }) {
  return <g className="optics-image-arrow"><path d={arrowPath(height)} fill={BLUE} fillOpacity={virtual ? .12 : .9} stroke={virtual ? BLUE : 'none'} strokeWidth="1.3" strokeDasharray={virtual ? '4 3' : undefined} vectorEffect="non-scaling-stroke" /></g>
}
