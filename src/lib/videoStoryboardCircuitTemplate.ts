/** Expand an explicitly selected topology; never infer connections or numeric values from narration. */
const record = (value: unknown): value is Record<string, unknown> => !!value && typeof value === 'object' && !Array.isArray(value)
const id = (value: unknown): value is string => typeof value === 'string' && /^[A-Za-z0-9][A-Za-z0-9_-]{0,95}$/.test(value)
const positive = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value) && value > 0
const invalid = () => Object.assign(new Error('AI 电路模板无效：仅支持明确的纯电阻串联或并联；数值电路必须提供完整电阻和电压参数'), { code: 'storyboard_content_invalid', retryable: false })

export function expandStoryboardCircuitTemplate(value: unknown): unknown {
  if (!record(value) || value.template === undefined) return value
  if (!id(value.id) || typeof value.name !== 'string' || !value.name.trim()
    || !['numeric', 'symbolic'].includes(String(value.mode)) || !['series', 'parallel'].includes(String(value.template))
    || value.graph !== undefined || !Array.isArray(value.resistors) || value.resistors.length < 1 || value.resistors.length > 6
    || value.switch !== undefined && typeof value.switch !== 'boolean'
    || value.quantities !== undefined && !Array.isArray(value.quantities)
    || value.source !== undefined && !record(value.source)) throw invalid()
  const source = value.source as Record<string, unknown> | undefined
  if (source && Object.keys(source).some(key => key !== 'voltage') || source?.voltage !== undefined && !positive(source.voltage)) throw invalid()
  if (value.mode === 'numeric' && !positive(source?.voltage)) throw invalid()
  const resistorIds = new Set<string>(['source', 'switch'])
  const resistors = value.resistors.map((resistor, index) => {
    if (!record(resistor) || !id(resistor.id) || resistorIds.has(resistor.id) || typeof resistor.label !== 'string' || !resistor.label.trim()
      || Object.keys(resistor).some(key => !['id', 'label', 'resistance'].includes(key))
      || resistor.resistance !== undefined && !positive(resistor.resistance)
      || value.mode === 'numeric' && !positive(resistor.resistance)) throw invalid()
    resistorIds.add(resistor.id)
    return { id: resistor.id, type: 'resistor', label: resistor.label,
      parameters: resistor.resistance === undefined ? {} : { resistance: resistor.resistance },
      position: { x: 200 + index * 140, y: 100 }, orientation: 'horizontal' }
  })
  const components: Record<string, unknown>[] = [{ id: 'source', type: 'battery', label: '电源',
    parameters: source?.voltage === undefined ? {} : { voltage: source.voltage },
    position: { x: 100, y: 250 }, orientation: 'vertical' }]
  const connections: { id: string; from: string; to: string }[] = []
  const wire = (from: string, to: string) => connections.push({ id: 'w' + (connections.length + 1), from, to })
  let supply = 'source.positive'
  if (value.switch) {
    components.push({ id: 'switch', type: 'switch', label: 'S', parameters: { switchClosed: true }, position: { x: 100, y: 100 }, orientation: 'horizontal' })
    wire(supply, 'switch.left'); supply = 'switch.right'
  }
  components.push(...resistors)
  if (value.template === 'series') {
    wire(supply, resistors[0].id + '.left')
    for (let index = 1; index < resistors.length; index++) wire(resistors[index - 1].id + '.right', resistors[index].id + '.left')
    wire(resistors[resistors.length - 1].id + '.right', 'source.negative')
  } else for (const resistor of resistors) { wire(supply, resistor.id + '.left'); wire(resistor.id + '.right', 'source.negative') }
  return { id: value.id, name: value.name, mode: value.mode, graph: { components, connections }, quantities: structuredClone(value.quantities || []) }
}
