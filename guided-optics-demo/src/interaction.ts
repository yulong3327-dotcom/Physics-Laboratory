import { focalLength, physicsFor, stages, type LabState } from './curriculum'

export type Adjustment = 'u' | 'screen' | 'height' | 'cover'

export function snapAdjustment(s: LabState, kind: Adjustment, value: number, tolerance: number) {
  if (tolerance <= 0 || kind === 'cover') return value
  const stage = stages[s.step]
  let target: number | undefined
  if (kind === 'height') target = 0
  if (kind === 'screen') target = stage.parallel ? focalLength(s) : physicsFor(s).v
  if (kind === 'u') {
    if (stage.targetU) target = stage.targetU
    else if (stage.id === 'graph' || stage.screenDirection) {
      const f = focalLength(s)
      target = f * s.screen / (s.screen - f)
    }
  }
  if (target === undefined || !Number.isFinite(target)) return value
  const [min, max] = kind === 'height' ? [-6, 6] : kind === 'screen' ? [5, 38] : [stage.id === 'graph' ? 14 : 5, 35]
  if (target < min || target > max) return value
  const rounded = Math.round(target * 10) / 10
  const capture = kind === 'height' ? Math.min(.7, tolerance) : tolerance
  const release = Math.abs(s[kind] - rounded) < .05 ? capture * 1.5 : capture
  return Math.abs(value - target) <= release ? rounded : value
}
