import type { AnimationCue, Shot, VideoProject } from '../../server/videoTypes'

function phrasePosition(cue: AnimationCue, project: VideoProject) {
  if (!cue.phrase) return 0
  const text = project.utterances.find(line => line.id === cue.utteranceId)?.text || ''
  let index = -cue.phrase.length
  for (let occurrence = 0; occurrence < (cue.occurrence ?? 1); occurrence++) {
    index = text.indexOf(cue.phrase, index + cue.phrase.length)
    if (index < 0) return undefined
  }
  return index
}
/** Compare only orders provable from text; mixed character/second offsets need real audio. */
export function compareStoryboardCues(a: AnimationCue, b: AnimationCue, project: VideoProject): number | undefined {
  const lineA = project.utterances.findIndex(line => line.id === a.utteranceId), lineB = project.utterances.findIndex(line => line.id === b.utteranceId)
  if (lineA < 0 || lineB < 0) return undefined
  if (lineA !== lineB) return Math.sign(lineA - lineB)
  const atA = phrasePosition(a, project), atB = phrasePosition(b, project)
  if (atA === undefined || atB === undefined) return undefined
  const characters = Math.sign(atA - atB), seconds = Math.sign((a.offset ?? 0) - (b.offset ?? 0))
  return !characters ? seconds : !seconds || characters === seconds ? characters : undefined
}
/** Only the next formula event can replace a row. Appending freezes the previous row. */
export function formulaReplacementCue(project: VideoProject, shot: Shot, targetId: string): AnimationCue | undefined {
  const targetIndex = shot.formulas.findIndex(formula => formula.id === targetId)
  if (targetIndex < 0) return undefined
  const sameTrack = (index: number) => (shot.formulas[index].cardId || '') === (shot.formulas[targetIndex].cardId || '')
  const order = (a: number, b: number) => {
    const result = compareStoryboardCues(shot.formulas[a].cue, shot.formulas[b].cue, project)
    return result === 0 ? Math.sign(a - b) : result
  }
  for (let index = 0; index < shot.formulas.length; index++) {
    if (!sameTrack(index) || order(index, targetIndex) !== 1) continue
    // Unknown audio offsets could put another formula between these events.
    // Leave that case to the audio timeline rather than rejecting a valid edit.
    if (!shot.formulas.every((_, other) => !sameTrack(other) || other === index || other === targetIndex
      || order(other, targetIndex) === -1 || order(other, index) === 1)) continue
    return shot.formulas[index].display === 'append' ? undefined : shot.formulas[index].cue
  }
  return undefined
}
export function highlightTimingIssue(project: VideoProject, shot: Shot, targetType: 'formula' | 'board', targetId: string, cue: AnimationCue): 'before' | 'replaced' | undefined {
  const target = targetType === 'formula' ? shot.formulas.find(formula => formula.id === targetId) : shot.boardTexts?.find(board => board.id === targetId)
  if (target?.cue && compareStoryboardCues(cue, target.cue, project) === -1) return 'before'
  const card = targetType === 'formula' && target && 'cardId' in target && shot.boardTexts?.find(board => board.id === target.cardId && board.card)
  if (card && card.cue && compareStoryboardCues(cue, card.cue, project) === -1) return 'before'
  const replacement = targetType === 'formula' && formulaReplacementCue(project, shot, targetId)
  if (replacement && [0, 1].includes(compareStoryboardCues(cue, replacement, project) ?? -1)) return 'replaced'
  return undefined
}
export function storyboardTimingIssues(project: VideoProject, shot: Shot): string[] {
  const issues: string[] = []
  for (const formula of shot.formulas) {
    const card = formula.cardId && shot.boardTexts?.find(board => board.id === formula.cardId && board.card)
    if (card && card.cue && compareStoryboardCues(formula.cue, card.cue, project) === -1) issues.push(`${shot.title}：公式不能早于所属知识卡出现（${formula.id} → ${card.id}）`)
  }
  for (const item of shot.highlights || []) {
    const issue = highlightTimingIssue(project, shot, item.targetType, item.targetId, item.cue)
    if (issue === 'before') issues.push(`${shot.title}：高亮不能早于目标出现（${item.targetId}）`)
    if (issue === 'replaced') issues.push(`${shot.title}：高亮目标公式已被后续公式替换（${item.targetId}）`)
  }
  return issues
}
/** An AI phrase like “得到P=24W” starts before “P=24W”; align that same reveal. */
export function alignGeneratedHighlightCues(project: VideoProject, shot: Shot) {
  for (const item of shot.highlights || []) {
    const target = item.targetType === 'formula' ? shot.formulas.find(formula => formula.id === item.targetId) : shot.boardTexts?.find(board => board.id === item.targetId)
    if (!target?.cue?.phrase || !item.cue.phrase || target.cue.utteranceId !== item.cue.utteranceId
      || (target.cue.offset ?? 0) !== (item.cue.offset ?? 0) || (target.cue.occurrence ?? 1) !== (item.cue.occurrence ?? 1)
      || !item.cue.phrase.includes(target.cue.phrase) || compareStoryboardCues(item.cue, target.cue, project) !== -1) continue
    item.cue = { ...target.cue }
    shot.reviewNotes.push(`高亮 ${item.id} 已对齐目标 ${target.id} 的出现同步点，请确认强调时机。`)
  }
}

/** Delay an AI formula to its card reveal; never reveal the card or an answer earlier. */
export function alignGeneratedCardFormulaCues(project: VideoProject, shot: Shot) {
  const validCue = (cue: AnimationCue) => shot.utteranceIds.includes(cue.utteranceId) && phrasePosition(cue, project) !== undefined
  const changes = shot.formulas.flatMap((formula, index) => {
    const card = formula.cardId && shot.boardTexts?.find(board => board.id === formula.cardId && board.card)
    if (!card || !card.cue || !validCue(formula.cue) || !validCue(card.cue)
      || compareStoryboardCues(formula.cue, card.cue, project) !== -1) return []
    // Do not reorder a derivation or hide a step behind a replacement. The only
    // safe collision is a following append at the card's unchanged reveal cue.
    const collision = shot.formulas.some((other, otherIndex) => {
      if (other === formula || other.cardId !== formula.cardId) return false
      const fromFormula = compareStoryboardCues(other.cue, formula.cue, project)
      const toCard = compareStoryboardCues(other.cue, card.cue!, project)
      if (fromFormula === -1 || toCard === 1) return false
      return !(fromFormula === 1 && toCard === 0 && otherIndex > index && other.display === 'append')
    })
    if (collision) return []
    const highlights = (shot.highlights || []).filter(item => item.targetType === 'formula' && item.targetId === formula.id
      && validCue(item.cue) && compareStoryboardCues(item.cue, formula.cue, project) === 0)
    return [{ formula, card, highlights }]
  })
  for (const { formula, card, highlights } of changes) {
    formula.cue = { ...card.cue! }
    for (const item of highlights) item.cue = { ...formula.cue }
    shot.reviewNotes.push(`公式 ${formula.id} 已延后至所属知识卡 ${card.id} 的出现同步点${highlights.length ? '，同步高亮已一并延后' : ''}，请确认讲解时机。`)
  }
}
