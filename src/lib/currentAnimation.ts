export function currentParticleDistances(length: number, current: number, time: number) {
  if (![current, length, time].every(Number.isFinite) || Math.abs(current) < 1e-5 || length <= 0) return []
  const count = Math.min(256, Math.max(1, Math.ceil(length / 48)))
  const spacing = length / count
  const speed = Math.min(140, 40 + 30 * Math.log10(1 + Math.abs(current) * 100))
  const offset = ((time * speed * Math.sign(current)) % length + length) % length
  return Array.from({ length: count }, (_, i) => (i * spacing + offset) % length)
}

export function renderCurrentParticles(path: SVGPathElement, current: number, time: number) {
  const distances = currentParticleDistances(path.getTotalLength(), current, time)
  return distances.map(distance => {
    const { x, y } = path.getPointAtLength(distance)
    return `<g transform="translate(${x} ${y})"><circle r="5.4" fill="#ffd53a" opacity="0.22"/><circle r="2.7" fill="#ffe45c" stroke="#b9911b" stroke-width="0.55"/></g>`
  }).join('')
}
