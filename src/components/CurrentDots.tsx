import { useEffect, useRef } from 'react'
import { renderCurrentParticles } from '../lib/currentAnimation'

export function CurrentDots({ path, current }: { path: string; current: number }) {
  const layer = useRef<SVGGElement>(null)
  useEffect(() => {
    if (!layer.current || Math.abs(current) < 1e-5) return
    const measure = document.createElementNS('http://www.w3.org/2000/svg', 'path'); measure.setAttribute('d', path)
    let frame = 0
    const draw = (time: number) => { if (layer.current) layer.current.innerHTML = renderCurrentParticles(measure, current, time / 1000); frame = requestAnimationFrame(draw) }
    frame = requestAnimationFrame(draw)
    return () => { cancelAnimationFrame(frame); if (layer.current) layer.current.innerHTML = '' }
  }, [path, current])
  return <g ref={layer} className="current-particles" data-current={current} data-direction={current >= 0 ? 'forward' : 'reverse'} pointerEvents="none" aria-hidden="true" />
}
