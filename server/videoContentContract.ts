import type { BoardText, CircuitAction, CircuitAsset, FormulaStep, KeywordHighlight, Shot, Utterance, VideoProject, VideoShotLayout, VideoSpeaker } from './videoTypes.js'

/** Parallel v1 protocol. No runtime, persistence, or renderer selects this contract yet. */
export const VIDEO_CONTENT_SCHEMA_VERSION = 1 as const
export const LEGACY_VIDEO_RENDERING_ADAPTER = 'legacy-manim-v1' as const
export type VideoRenderingAdapter = typeof LEGACY_VIDEO_RENDERING_ADAPTER | 'knowledge-scene-v1' | 'story-compositor-v1'

interface CoursePage {
  schemaVersion: 1;
  id: string;
  title: string;
  /** References preserve authored order; the document owns the verbatim speech. */
  utteranceIds: string[];
  circuitAssetIds: string[];
  continueFromPageId?: string;
  nextPageGoal?: string;
}

/** Story content must be authored explicitly; legacy migration never infers it. */
export interface StoryShot extends CoursePage {
  type: 'story';
  renderingAdapter: 'story-compositor-v1';
  sceneSpecId: string;
  sceneGoal: string;
  teachingTask: string;
  /** A self-contained single frame, separate from the sequence of actions. */
  frameDescription: string;
  characterActions: { id: string; characterId: string; description: string; utteranceId?: string }[];
  visualEffects: { id: string; description: string; utteranceId?: string }[];
  conflict?: string;
  misconception?: string;
  memoryAnchor?: string;
}

export interface KnowledgePage extends CoursePage {
  type: 'knowledge';
  /** legacy means a compatibility page, not an inferred editorial classification. */
  pageRole: 'definition' | 'example' | 'analysis' | 'transition' | 'warning' | 'summary' | 'legacy';
  renderingAdapter: typeof LEGACY_VIDEO_RENDERING_ADAPTER | 'knowledge-scene-v1';
  boardTexts?: BoardText[];
  formulas: FormulaStep[];
  actions: CircuitAction[];
  highlights?: KeywordHighlight[];
  layout?: VideoShotLayout;
  /** Complete snapshot, including optional and future fields, for the old renderer. */
  legacyShot?: Shot;
}

export type CourseContent = StoryShot | KnowledgePage

export interface CourseDocument {
  schemaVersion: 1;
  id: string;
  revision: number;
  title: string;
  sourceScript: string;
  cleanedScript: string;
  speakers: VideoSpeaker[];
  utterances: Utterance[];
  circuits: CircuitAsset[];
  /** Array order is the authoritative page order. */
  pages: CourseContent[];
  /** Preserves settings, workflow, source notes, metadata, and unknown old fields. */
  legacy?: { adapter: typeof LEGACY_VIDEO_RENDERING_ADAPTER; project: VideoProject };
}

/** A declarative render request; absence of a timeline means timing is unresolved. */
export interface SceneRecipe {
  schemaVersion: 1;
  id: string;
  documentId: string;
  documentRevision: number;
  pageId: string;
  adapter: VideoRenderingAdapter;
  utteranceIds: string[];
  circuitAssetIds: string[];
  requiredArtifactIds: string[];
  output: { width: number; height: number; fps: number };
  layers?: { id: string; artifactId: string; zIndex: number }[];
  timeline?: {
    durationFrames: number;
    events: { id: string; targetId: string; startFrame: number; durationFrames: number; operation: 'show' | 'hide' | 'fade' | 'move' | 'scale' | 'highlight' }[];
  };
  /** Resolves against CourseDocument.legacy.project, never against a live draft. */
  legacyShotId?: string;
}

/** Published only after artifact validation; task progress belongs to the task model. */
export interface ArtifactManifest {
  schemaVersion: 1;
  id: string;
  documentId: string;
  documentRevision: number;
  recipeId: string;
  adapter: VideoRenderingAdapter;
  rendererVersion: string;
  inputSha256: string;
  createdAt: string;
  dependencies: { artifactId: string; sha256: string }[];
  artifacts: {
    id: string;
    kind: 'image' | 'audio' | 'video' | 'subtitle' | 'timeline' | 'validation';
    /** Storage key, not a user-supplied filesystem path. */
    storageKey: string;
    mediaType: string;
    sha256: string;
    byteLength: number;
    width?: number;
    height?: number;
    durationSeconds?: number;
  }[];
}

export interface VideoContentContractIssue {
  code: 'missing_speaker' | 'missing_utterance' | 'missing_circuit' | 'empty_shots' | 'empty_shot_utterances' | 'utterance_coverage_mismatch';
  severity: 'error' | 'warning';
  message: string;
  pageId?: string;
  referenceId?: string;
}

export interface LegacyVideoProjectConversion {
  document: CourseDocument;
  sceneRecipes: SceneRecipe[];
  issues: VideoContentContractIssue[];
}

function uniqueIds(items: { id: string }[], name: string): Set<string> {
  if (!Array.isArray(items)) throw new TypeError(`${name} must be an array`)
  const ids = new Set<string>()
  for (const item of items) {
    if (!item || typeof item.id !== 'string' || !item.id.trim()) throw new TypeError(`${name} contains an invalid id`)
    if (ids.has(item.id)) throw new TypeError(`${name} contains duplicate id: ${item.id}`)
    ids.add(item.id)
  }
  return ids
}

/**
 * Pure compatibility conversion, not a validator or an upgrade to a new renderer.
 * IDs and references are opaque and are never used as filesystem paths. Missing
 * references remain visible in the result and are reported instead of repaired.
 */
export function convertLegacyVideoProject(project: VideoProject): LegacyVideoProjectConversion {
  if (!project || project.schemaVersion !== VIDEO_CONTENT_SCHEMA_VERSION) throw new TypeError('Unsupported legacy VideoProject schemaVersion; expected 1')
  if (typeof project.id !== 'string' || !project.id.trim()) throw new TypeError('VideoProject id must be non-empty')
  if (!Number.isSafeInteger(project.revision) || project.revision < 1) throw new TypeError('VideoProject revision must be a positive safe integer')
  const speakerIds = uniqueIds(project.speakers, 'speakers')
  const utteranceIds = uniqueIds(project.utterances, 'utterances')
  const circuitIds = uniqueIds(project.circuits, 'circuits')
  uniqueIds(project.shots, 'shots')
  const issues: VideoContentContractIssue[] = []
  for (const utterance of project.utterances) {
    if (!speakerIds.has(utterance.speakerId)) issues.push({ code: 'missing_speaker', severity: 'error', referenceId: utterance.speakerId,
      message: `Utterance ${utterance.id} references missing speaker ${utterance.speakerId}` })
  }
  if (!project.shots.length) issues.push({ code: 'empty_shots', severity: 'warning', message: 'The legacy project has no shots; no pages or recipes were invented' })
  const pages: KnowledgePage[] = project.shots.map(shot => {
    if (!Array.isArray(shot.utteranceIds) || shot.utteranceIds.some(id => typeof id !== 'string')) throw new TypeError(`Shot ${shot.id} utteranceIds must be a string array`)
    if (!shot.utteranceIds.length) issues.push({ code: 'empty_shot_utterances', severity: 'error', pageId: shot.id, message: `Shot ${shot.id} has no utterance references` })
    for (const id of shot.utteranceIds) {
      if (!utteranceIds.has(id)) issues.push({ code: 'missing_utterance', severity: 'error', pageId: shot.id, referenceId: id,
        message: `Shot ${shot.id} references missing utterance ${id}` })
    }
    if (shot.circuitAssetId !== undefined && !circuitIds.has(shot.circuitAssetId)) issues.push({ code: 'missing_circuit', severity: 'error', pageId: shot.id,
      referenceId: shot.circuitAssetId, message: `Shot ${shot.id} references missing circuit ${shot.circuitAssetId}` })
    return {
      schemaVersion: 1, id: shot.id, type: 'knowledge', title: shot.title, pageRole: 'legacy', renderingAdapter: LEGACY_VIDEO_RENDERING_ADAPTER,
      utteranceIds: [...shot.utteranceIds], circuitAssetIds: shot.circuitAssetId === undefined ? [] : [shot.circuitAssetId],
      formulas: structuredClone(shot.formulas), actions: structuredClone(shot.actions),
      ...(shot.boardTexts === undefined ? {} : { boardTexts: structuredClone(shot.boardTexts) }),
      ...(shot.highlights === undefined ? {} : { highlights: structuredClone(shot.highlights) }),
      ...(shot.layout === undefined ? {} : { layout: structuredClone(shot.layout) }),
      legacyShot: structuredClone(shot),
    }
  })
  const referenced = pages.flatMap(page => page.utteranceIds)
  if (referenced.length !== project.utterances.length || referenced.some((id, index) => id !== project.utterances[index]?.id)) {
    issues.push({ code: 'utterance_coverage_mismatch', severity: 'error', message: 'Shot references do not cover the document utterances exactly once in source order; original order was retained' })
  }
  const document: CourseDocument = {
    schemaVersion: 1, id: project.id, revision: project.revision, title: project.title,
    sourceScript: project.sourceScript, cleanedScript: project.cleanedScript,
    speakers: structuredClone(project.speakers), utterances: structuredClone(project.utterances), circuits: structuredClone(project.circuits), pages,
    legacy: { adapter: LEGACY_VIDEO_RENDERING_ADAPTER, project: structuredClone(project) },
  }
  const sceneRecipes: SceneRecipe[] = pages.map(page => ({
    schemaVersion: 1, id: `legacy-recipe:${encodeURIComponent(project.id)}:${encodeURIComponent(page.id)}`,
    documentId: document.id, documentRevision: document.revision, pageId: page.id, adapter: LEGACY_VIDEO_RENDERING_ADAPTER,
    utteranceIds: [...page.utteranceIds], circuitAssetIds: [...page.circuitAssetIds], requiredArtifactIds: [],
    output: { width: project.settings.width, height: project.settings.height, fps: project.settings.fps }, legacyShotId: page.id,
  }))
  return { document, sceneRecipes, issues }
}
