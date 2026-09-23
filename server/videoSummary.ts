import type { Shot, VideoProject } from './videoTypes.js'

/** Only production headings are inspected; spoken dialogue and review prose are not headings. */
export function isVideoSummaryHeading(text: string | undefined): boolean {
  return typeof text === 'string' && /总结|小结|回顾|复盘|\b(?:summary|recap)\b/i.test(text)
}

type SummaryProject = Pick<VideoProject, 'shots' | 'utterances' | 'scriptNotes'>

/** Resolve the full ordered project before selecting a single page for preview or rendering. */
export function summaryShotIds(project: SummaryProject): Set<string> {
  const indices = new Map(project.utterances.map((line, index) => [line.id, index]))
  const boundaries = (project.scriptNotes || []).flatMap((note, order) => {
    if (note.kind !== 'chapter' && note.kind !== 'summary') return []
    const anchor = note.utteranceId ? indices.get(note.utteranceId) : undefined
    if (anchor === undefined) return []
    const index = anchor + (note.placement === 'after' ? 1 : 0)
    return [{ index, order, sourceLine: note.sourceLine, summary: note.kind === 'summary' || isVideoSummaryHeading(note.text) }]
  }).sort((a, b) => a.index - b.index || a.sourceLine - b.sourceLine || a.order - b.order)
  const result = new Set<string>()
  let boundary = 0, structuralSummary = false
  let headingSection: Pick<Shot, 'chapter' | 'sectionTitle'> | undefined
  for (const shot of project.shots) {
    const first = shot.utteranceIds.map(id => indices.get(id)).find(index => index !== undefined)
    // A structural heading starts a fresh section even when an AI reused its chapter number.
    while (first !== undefined && boundary < boundaries.length && boundaries[boundary].index <= first) {
      structuralSummary = boundaries[boundary++].summary
      headingSection = undefined
    }
    if (shot.story) { headingSection = undefined; continue }
    if (headingSection && (shot.chapter !== headingSection.chapter ||
      shot.sectionTitle?.trim() && headingSection.sectionTitle?.trim() && shot.sectionTitle.trim() !== headingSection.sectionTitle.trim())) headingSection = undefined
    if (isVideoSummaryHeading(shot.title) || isVideoSummaryHeading(shot.sectionTitle)) {
      headingSection = { chapter: shot.chapter, sectionTitle: shot.sectionTitle }
    }
    if (shot.layout?.template === 'summary' || structuralSummary || headingSection) result.add(shot.id)
  }
  return result
}

/** Structural summary intent takes precedence over an older automatically chosen page template. */
export function normalizeVideoSummaryLayouts<T extends SummaryProject>(project: T): T {
  const ids = summaryShotIds(project)
  let changed = false
  const shots = project.shots.map(shot => {
    if (!ids.has(shot.id) || shot.layout?.template === 'summary') return shot
    changed = true
    return { ...shot, layout: { ...shot.layout, template: 'summary' as const, elements: shot.layout?.elements || {} } }
  })
  return changed ? { ...project, shots } : project
}
