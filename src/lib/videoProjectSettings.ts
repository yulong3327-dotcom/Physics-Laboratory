import type { CircuitAsset, VideoProject } from '../../server/videoTypes'
import type { CircuitGraph, ViewMode } from '../types/circuit'
import { componentLibrary } from '../data/componentLibrary'
import { parseCircuitGraph } from './graphSchema'
import { layoutCircuitGraph } from './autoLayout'
import { prepareVideoProject } from './videoProject'

/** A master selection updates every shared circuit asset and persists the default for future assets. */
export async function setProjectCircuitView(project: VideoProject, view: ViewMode): Promise<VideoProject> {
  return prepareVideoProject({ ...project, approvedRevision: undefined, settings: { ...project.settings, defaultCircuitView: view }, circuits: project.circuits.map(asset => ({ ...asset, viewMode: view, currentFlow: view === 'real' && asset.mode === 'numeric', revision: asset.revision + 1, geometry: undefined })) })
}

/** Insert a closed ideal switch into the unique source lead; no guessed rewiring for branched leads. */
export async function includeMainSwitch(asset: CircuitAsset): Promise<CircuitAsset> {
  const graph = parseCircuitGraph(asset.graph)
  if (!graph) throw new Error(asset.name + '：电路工程无效')
  if (graph.components.some(c => c.type === 'switch' || c.type === 'switch_spdt')) return asset
  const sources = graph.components.filter(c => c.type === 'battery')
  if (sources.length !== 1) throw new Error(asset.name + '：需在实验室选择主干开关位置（电源数量不是1）')
  const endpoint = sources[0].id + '.positive'
  const leads = graph.connections.filter(w => w.from === endpoint || w.to === endpoint)
  if (leads.length !== 1) throw new Error(asset.name + '：电源端有多条导线，请在实验室指定主干开关位置')
  const lead = leads[0], used = new Set([...graph.components, ...graph.connections].map(x => x.id))
  const unique = (base: string) => { let id = base, n = 1; while (used.has(id)) id = base + '-' + n++; used.add(id); return id }
  const id = unique('main-switch'), wireId = unique('switch-lead')
  const terminals = structuredClone(componentLibrary.switch.terminals)
  const sourceSide = lead.from === endpoint
  const oldTo = lead.to, oldFrom = lead.from
  graph.components.push({ id, type: 'switch', label: 'S', orientation: 'horizontal', position: { x: sources[0].position.x + 150, y: sources[0].position.y }, terminals, parameters: { switchClosed: true }, source: 'rule' })
  if (sourceSide) { lead.to = id + '.left'; graph.connections.push({ id: wireId, from: id + '.right', to: oldTo }) }
  else { lead.from = id + '.right'; graph.connections.push({ id: wireId, from: oldFrom, to: id + '.left' }) }
  delete lead.routes
  let arranged: CircuitGraph = await layoutCircuitGraph(graph, 'schematic')
  if (asset.viewMode === 'real') arranged = await layoutCircuitGraph(arranged, 'real')
  return { ...asset, graph: arranged, geometry: undefined, revision: asset.revision + 1 }
}

export async function setProjectSwitchPolicy(project: VideoProject, policy: 'contextual' | 'preserve' | 'include'): Promise<VideoProject> {
  const next = structuredClone(project)
  next.settings.switchPolicy = policy; next.approvedRevision = undefined
  if (policy === 'include') {
    if (next.problem) throw new Error('题目讲解应保留原题接法；需要补开关时请在实验室修改并重新审核题目。')
    next.circuits = await Promise.all(next.circuits.map(includeMainSwitch))
    for (const shot of next.shots) if (shot.circuitAssetId) shot.reviewNotes = [...new Set([...shot.reviewNotes, '已补主干闭合开关S；理想闭合开关不改变原有数值，请核对是否符合教学场景。'])]
  }
  return prepareVideoProject(next)
}
