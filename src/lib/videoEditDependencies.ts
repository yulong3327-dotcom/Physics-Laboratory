import type { AnimationCue, CircuitAsset, Shot, VideoProject } from '../../server/videoTypes'

function textTarget(shot: Shot, type: 'board' | 'formula', id: string) {
  return type === 'board' ? shot.boardTexts?.find(item => item.id === id)?.text : shot.formulas.find(item => item.id === id)?.latex
}

function circuitTargets(asset?: CircuitAsset) {
  const targets = new Set<string>()
  if (!asset) return targets
  targets.add('circuit')
  // The edited graph is authoritative even while the old preview geometry exists.
  const graph = asset.graph as { components?: { id: string; terminals?: { id: string }[] }[]; connections?: { id: string }[] } | undefined
  if (Array.isArray(graph?.components)) {
    for (const component of graph.components) {
      targets.add(component.id)
      for (const port of component.terminals || []) targets.add(component.id + ':' + port.id)
    }
    for (const wire of graph.connections || []) targets.add(wire.id)
  } else if (asset.geometry) {
    for (const component of asset.geometry.components) {
      targets.add(component.id)
      for (const port of Object.keys(component.terminals)) targets.add(component.id + ':' + port)
    }
    for (const wire of asset.geometry.wires) targets.add(wire.id)
  }
  return targets
}

/** Reconcile dependencies of a user edit, without treating unfinished field input as an import error. */
export function reconcileVideoProjectEdit(previous: VideoProject, next: VideoProject): VideoProject {
  if (previous.id !== next.id) return next
  const oldLines = new Map(previous.utterances.map(item => [item.id, item.text]))
  const newLines = new Map(next.utterances.map(item => [item.id, item.text]))
  const oldShots = new Map(previous.shots.map(item => [item.id, item]))
  const removedQuantities = new Map<string, Set<string>>()
  const retainedCircuits = next.circuits.map(asset => {
    const before = previous.circuits.find(item => item.id === asset.id)
    const oldTargets = circuitTargets(before), newTargets = circuitTargets(asset)
    const quantities = asset.quantities.filter(quantity => {
      const removed = !!quantity.componentId && oldTargets.has(quantity.componentId) && !newTargets.has(quantity.componentId)
      if (removed) {
        if (!removedQuantities.has(asset.id)) removedQuantities.set(asset.id, new Set())
        removedQuantities.get(asset.id)!.add(quantity.id)
      }
      return !removed
    })
    return quantities.length === asset.quantities.length ? asset : { ...asset, quantities }
  })
  const shots = next.shots.map(shot => {
    const before = oldShots.get(shot.id)
    if (!before) return shot
    const repairCue = (cue: AnimationCue): AnimationCue => {
      const text = newLines.get(cue.utteranceId)
      if (text === oldLines.get(cue.utteranceId) || text !== undefined && (!cue.phrase || text.includes(cue.phrase))) return cue
      // The spoken anchor was edited away. Keep the visual and use this line's
      // beginning, rather than leaving an impossible timing reference.
      if (text !== undefined) return { utteranceId: cue.utteranceId }
      const fallback = shot.utteranceIds.find(id => newLines.has(id))
      return fallback ? { utteranceId: fallback } : cue
    }
    const formulas = shot.formulas.map(formula => {
      const old = before.formulas.find(item => item.id === formula.id)
      const parts = old && old.latex !== formula.latex ? formula.parts?.filter(part => formula.latex.includes(part.latex)) : formula.parts
      const cue = repairCue(formula.cue)
      const quantityIds = formula.quantityIds?.filter(id => !removedQuantities.get(shot.circuitAssetId || '')?.has(id))
      const cardId = formula.cardId && before.boardTexts?.some(board => board.id === formula.cardId && board.card)
        && !shot.boardTexts?.some(board => board.id === formula.cardId && board.card) ? undefined : formula.cardId
      return parts !== formula.parts || cue !== formula.cue || cardId !== formula.cardId || quantityIds?.length !== formula.quantityIds?.length ? { ...formula, parts, cue, cardId, quantityIds } : formula
    })
    const boardTexts = shot.boardTexts?.map(board => {
      const cue = board.cue && repairCue(board.cue)
      return cue !== board.cue ? { ...board, cue } : board
    })
    const highlights = shot.highlights?.flatMap(highlight => {
      const oldText = textTarget(before, highlight.targetType, highlight.targetId)
      const text = textTarget(shot, highlight.targetType, highlight.targetId)
      let updated = highlight
      if (oldText !== text) {
        if (!text?.trim()) return []
        // Emphasis covering a whole element follows that element's text.
        if (oldText && highlight.phrase === oldText && (highlight.occurrence ?? 1) === 1) updated = { ...highlight, phrase: text }
        else if (!highlight.phrase || text.split(highlight.phrase).length - 1 < (highlight.occurrence ?? 1)) return []
      }
      let cue = repairCue(updated.cue)
      const target = updated.targetType === 'board' ? boardTexts?.find(item => item.id === updated.targetId) : formulas.find(item => item.id === updated.targetId)
      const oldTarget = updated.targetType === 'board' ? before.boardTexts?.find(item => item.id === updated.targetId) : before.formulas.find(item => item.id === updated.targetId)
      const timingTextChanged = [cue.utteranceId, target?.cue?.utteranceId].some(id => id && oldLines.get(id) !== newLines.get(id))
      if (target?.cue && (cue !== updated.cue || timingTextChanged || JSON.stringify(target.cue) !== JSON.stringify(oldTarget?.cue))) {
        const order = (point: AnimationCue) => [shot.utteranceIds.indexOf(point.utteranceId), point.phrase ? newLines.get(point.utteranceId)?.indexOf(point.phrase) ?? -1 : 0, point.offset ?? 0]
        const a = order(cue), b = order(target.cue)
        const difference = a.findIndex((value, index) => value !== b[index])
        if (difference >= 0 && a[difference] < b[difference]) cue = { ...target.cue }
      }
      return [cue === updated.cue ? updated : { ...updated, cue }]
    })
    const oldAsset = previous.circuits.find(item => item.id === before.circuitAssetId)
    const newAsset = next.circuits.find(item => item.id === shot.circuitAssetId)
    const oldTargets = circuitTargets(oldAsset), newTargets = circuitTargets(newAsset)
    const switchedCircuit = before.circuitAssetId !== shot.circuitAssetId
    let actions = shot.actions.flatMap(action => {
      // Switching a circuit must not bind old actions to coincidentally equal IDs.
      const targetIds = switchedCircuit ? [] : action.targetIds.filter(id => !oldTargets.has(id) || newTargets.has(id))
      if (action.targetIds.length && !targetIds.length) return []
      if (action.type === 'state' && action.state && (switchedCircuit || oldTargets.has(action.state.componentId) && !newTargets.has(action.state.componentId))) return []
      // A voltage bracket over two components must not silently change meaning
      // to a voltage over only one of them after deletion.
      if (action.type === 'annotation' && targetIds.length !== action.targetIds.length) return []
      const cue = repairCue(action.cue)
      return [cue !== action.cue || targetIds.length !== action.targetIds.length ? { ...action, targetIds, cue } : action]
    })
    const statePlan = (items: Shot['actions']) => items.filter(action => action.type === 'state').map(action => ({ id: action.id, targetIds: action.targetIds, state: action.state, cue: action.cue }))
    const circuitVisual = (asset?: CircuitAsset) => asset && ({ graph: asset.graph, geometry: asset.geometry, viewMode: asset.viewMode, currentFlow: asset.currentFlow, mode: asset.mode })
    const narrationChanged = shot.utteranceIds.some(id => oldLines.get(id) !== newLines.get(id))
      || JSON.stringify(before.utteranceIds) !== JSON.stringify(shot.utteranceIds)
    if (narrationChanged || JSON.stringify(statePlan(before.actions)) !== JSON.stringify(statePlan(actions))
      || JSON.stringify(circuitVisual(oldAsset)) !== JSON.stringify(circuitVisual(newAsset))) {
      // State snapshots are cumulative; changing an earlier state can affect
      // every subsequent snapshot in this shot. Preparation rebuilds them.
      actions = actions.map(action => action.type === 'state' && action.geometry ? { ...action, geometry: undefined } : action)
    }
    let layout = shot.layout
    if (layout) {
      const removed = new Set<string>()
      for (const board of before.boardTexts || []) {
        const current = boardTexts?.find(item => item.id === board.id)
        if (!current) removed.add('board:' + board.id)
        if (board.card && !current?.card) {
          for (const prefix of ['board-body:', 'card-title:', 'card:']) removed.add(prefix + board.id)
        }
      }
      for (const formula of before.formulas) if (!formulas.some(item => item.id === formula.id)) {
        for (const prefix of ['formula:', 'formula-caption:', 'formula-badge:']) removed.add(prefix + formula.id)
      }
      for (const formula of formulas) if (formula.cardId !== before.formulas.find(item => item.id === formula.id)?.cardId) {
        for (const prefix of ['formula:', 'formula-caption:', 'formula-badge:']) removed.add(prefix + formula.id)
      }
      for (const action of before.actions) {
        if (!actions.some(item => item.id === action.id && item.type === 'label')) removed.add('circuit-label:' + action.id)
        if (!actions.some(item => item.id === action.id && item.type === 'annotation')) removed.add('circuit-annotation:' + action.id)
      }
      if (switchedCircuit || oldAsset && !newAsset) removed.add('circuit')
      if (Object.keys(layout.elements).some(key => removed.has(key))) layout = { ...layout, elements: Object.fromEntries(Object.entries(layout.elements).filter(([key]) => !removed.has(key))) }
    }
    return { ...shot, circuitAssetId: oldAsset && !newAsset ? undefined : shot.circuitAssetId, formulas, boardTexts, highlights, actions, layout }
  })
  const oldSteps = new Set(previous.shots.flatMap(shot => shot.formulas.map(formula => formula.id)))
  const newSteps = new Set(shots.flatMap(shot => shot.formulas.map(formula => formula.id)))
  const circuits = retainedCircuits.map(asset => {
    const quantities = asset.quantities.map(quantity => quantity.revealStepId && oldSteps.has(quantity.revealStepId) && !newSteps.has(quantity.revealStepId)
      ? { ...quantity, revealStepId: undefined } : quantity)
    return quantities.some((quantity, i) => quantity !== asset.quantities[i]) ? { ...asset, quantities } : asset
  })
  return { ...next, shots, circuits }
}

export function videoEditDependencyNotice(previous: VideoProject, next: VideoProject): string {
  let removed = 0, followed = 0, reset = 0
  for (const shot of next.shots) {
    const before = previous.shots.find(item => item.id === shot.id)
    if (!before) continue
    removed += (before.highlights || []).filter(item => !shot.highlights?.some(candidate => candidate.id === item.id)).length
    removed += before.actions.filter(item => !shot.actions.some(candidate => candidate.id === item.id)).length
    followed += (shot.highlights || []).filter(item => before.highlights?.some(old => old.id === item.id && old.phrase !== item.phrase)).length
    const oldEvents = [...before.formulas, ...before.actions, ...(before.boardTexts || []), ...(before.highlights || [])]
    for (const event of [...shot.formulas, ...shot.actions, ...(shot.boardTexts || []), ...(shot.highlights || [])]) {
      const old = oldEvents.find(item => item.id === event.id)
      if (old?.cue?.phrase && event.cue && !event.cue.phrase) reset++
    }
  }
  return [removed && `已同步移除 ${removed} 个关联动画`, followed && `已更新 ${followed} 处高亮文字`, reset && `已将 ${reset} 处失效同步词改为旁白句首`].filter(Boolean).join('；')
}
