import type { VideoElementPlacement, VideoPreviewElement } from '../../server/videoTypes'

type Placements = Record<string, VideoElementPlacement>
type LivePlacement = { id: string; placement: VideoElementPlacement } | null | undefined
const round = (value: number) => Math.round(value * 100) / 100

/** Keep the full artwork, including its stroke padding, inside the page's allowed region. */
export function constrainScenePlacement(element: VideoPreviewElement, placement: VideoElementPlacement): VideoElementPlacement {
  const bounds = element.constraintBounds || { x: 0, y: 0, width: 1920, height: 1080 }
  const base = element.placement.scale
  const naturalWidth = element.box.width / base, naturalHeight = element.box.height / base
  const naturalLeft = (element.box.x - element.placement.x) / base, naturalTop = (element.box.y - element.placement.y) / base
  const naturalRight = naturalLeft + naturalWidth, naturalBottom = naturalTop + naturalHeight
  const fitWidth = Math.max(naturalWidth, naturalRight), fitHeight = Math.max(naturalHeight, naturalBottom)
  const maxScale = Math.min(4, fitWidth ? bounds.width / fitWidth : 4, fitHeight ? bounds.height / fitHeight : 4)
  const scale = Math.max(Number.EPSILON, Math.floor(Math.min(maxScale, Math.max(Math.min(.2, maxScale), Number.isFinite(placement.scale) ? placement.scale : 1)) * 100) / 100 || maxScale)
  const minX = bounds.x + Math.max(0, -naturalLeft * scale), minY = bounds.y + Math.max(0, -naturalTop * scale)
  const maxX = bounds.x + Math.min(bounds.width, bounds.width - naturalRight * scale), maxY = bounds.y + Math.min(bounds.height, bounds.height - naturalBottom * scale)
  return { x: round(Math.min(maxX, Math.max(minX, placement.x))), y: round(Math.min(maxY, Math.max(minY, placement.y))), scale }
}
function bounded(element: VideoPreviewElement, placement: VideoElementPlacement): VideoElementPlacement {
  return element.constraintBounds ? constrainScenePlacement(element, placement) : placement
}
function relativePlacement(value: VideoElementPlacement, from: VideoElementPlacement, to: VideoElementPlacement): VideoElementPlacement {
  const scale = to.scale / from.scale
  return { x: to.x + (value.x - from.x) * scale, y: to.y + (value.y - from.y) * scale, scale: value.scale * scale }
}
/** Explicit child placements are absolute, but still follow a card while it is dragged. */
export function resolveScenePlacement(elements: VideoPreviewElement[], placements: Placements, element: VideoPreviewElement, live?: LivePlacement, depth = 0): VideoElementPlacement {
  if (live?.id === element.id) return bounded(element, live.placement)
  const own = placements[element.id]
  const parent = depth < 8 && element.parentId ? elements.find(item => item.id === element.parentId) : undefined
  if (!parent) return bounded(element, own || element.placement)
  const parentNow = resolveScenePlacement(elements, placements, parent, live, depth + 1)
  if (own) {
    const parentBefore = resolveScenePlacement(elements, placements, parent, undefined, depth + 1)
    return bounded(element, relativePlacement(own, parentBefore, parentNow))
  }
  return bounded(element, relativePlacement(element.placement, parent.placement, parentNow))
}
export function moveSceneElement(elements: VideoPreviewElement[], placements: Placements, element: VideoPreviewElement, placement: VideoElementPlacement): Placements {
  placement = bounded(element, placement)
  const previous = resolveScenePlacement(elements, placements, element)
  const updated = { ...placements, [element.id]: placement }
  for (const child of elements) {
    if (!placements[child.id] || child.id === element.id) continue
    let parentId = child.parentId, count = 0
    while (parentId && count++ < 8) {
      if (parentId === element.id) { updated[child.id] = bounded(child, relativePlacement(placements[child.id], previous, placement)); break }
      parentId = elements.find(item => item.id === parentId)?.parentId
    }
  }
  return updated
}
