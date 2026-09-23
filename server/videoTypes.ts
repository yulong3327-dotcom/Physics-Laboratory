/** Portable video project contract. Circuit snapshots are validated at the editor boundary. */
export interface VideoPoint { x: number; y: number }
export interface CircuitGeometry {
  viewMode?: 'schematic' | 'real'; currentFlow?: boolean;
  bounds: { x: number; y: number; width: number; height: number };
  components: { id: string; svg: string; image?: { dataUrl: string; width: number; height: number; rotation: number }; label: string; x: number; y: number; width: number; height: number; terminals: Record<string, VideoPoint> }[];
  wires: { id: string; path: string; from: string; to: string; current?: number }[];
}
export interface TeachingQuantity {
  id: string; symbol: string; unit: string; componentId?: string; value?: number; expression?: string;
  provenance: 'given' | 'derived' | 'symbolic'; revealStepId?: string;
}
export interface CircuitAsset {
  id: string; name: string; revision: number; graph: unknown; geometry?: CircuitGeometry;
  layoutPrepared?: boolean; mode: 'numeric' | 'symbolic'; viewMode?: 'schematic' | 'real'; currentFlow?: boolean; quantities: TeachingQuantity[];
}
export interface VideoSpeaker { id: string; name: string; voice: string; color: string }
export interface Utterance { id: string; speakerId: string; text: string }
export interface VideoScriptNote {
  id: string; kind: 'chapter' | 'summary' | 'problem' | 'visual' | 'review';
  text: string; sourceLine: number; utteranceId?: string; placement?: 'before' | 'after';
  chapter?: number; symbolicValues?: string[];
}
export interface AnimationCue { utteranceId: string; phrase?: string; offset?: number; occurrence?: number }
export interface FormulaStep {
  id: string; latex: string; caption?: string;
  action: 'write' | 'substitute' | 'transform' | 'cancel' | 'reciprocal' | 'ratio' | 'result';
  cue: AnimationCue; parts?: { id: string; latex: string }[];
  role?: 'normal' | 'misconception'; correctionStepId?: string;
  quantityIds?: string[];
  /** Append retains earlier lines; replace changes only the latest line. */
  display?: 'replace' | 'append'; durationSeconds?: number;
  /** Formulas in each card have their own append/replace track. */
  cardId?: string;
}
export interface VideoComponentParameters {
  voltage?: number; internalResistance?: number; resistance?: number; maxResistance?: number;
  sliderPosition?: number; switchClosed?: boolean; switchPosition?: 'left' | 'right' | 'open';
  ratedVoltage?: number; ratedPower?: number; meterRange?: number; meterMode?: 'auto' | 'manual'; manualReading?: number;
}
export interface CircuitAction {
  id: string; type: 'draw' | 'highlight' | 'label' | 'show' | 'hide' | 'annotation' | 'state';
  targetIds: string[]; cue: AnimationCue; text?: string;
  durationSeconds?: number;
  annotation?: { kind: 'voltage' | 'current'; label: string; color?: string; side?: 'above' | 'below'; offset?: number; direction?: 'forward' | 'reverse' };
  state?: { componentId: string; parameters: VideoComponentParameters };
  /** Derived by the geometry preparer after applying all preceding state events. */
  geometry?: CircuitGeometry;
}
export interface BoardText {
  id: string; text: string; kind: 'keyword' | 'law' | 'problem' | 'given' | 'derivation'; cue?: AnimationCue;
  entrance?: 'appear' | 'fade' | 'write' | 'slide' | 'settle'; durationSeconds?: number;
  card?: { title: string };
}
export interface KeywordHighlight {
  id: string; targetType: 'board' | 'formula'; targetId: string; phrase: string; occurrence?: number;
  color?: string; effect: 'marker' | 'underline' | 'box' | 'pointer' | 'pulse' | 'check' | 'cross'; cue: AnimationCue; durationSeconds?: number;
}
export interface VideoProblem { text: string; imageDataUrl?: string; analysis?: string; answer?: string; reviewed?: boolean; storyboardReady?: boolean }
export interface VideoElementPlacement { x: number; y: number; scale: number }
export interface VideoSceneBounds { x: number; y: number; width: number; height: number }
export interface VideoShotLayout {
  template: 'auto' | 'question' | 'explain' | 'summary';
  elements: Record<string, VideoElementPlacement>;
  hideProblemImage?: boolean;
  contentLayout?: 'auto' | 'circuit-left' | 'cards-grid';
}
export interface VideoPreviewElement {
  id: string; label: string; kind: string; svg: string;
  box: { x: number; y: number; width: number; height: number };
  placement: VideoElementPlacement; visible: boolean;
  constraintBounds?: VideoSceneBounds;
  parentId?: string; text?: string; textKind?: 'plain' | 'latex'; selectionWarning?: string;
  source?: { type: 'title' | 'cardTitle' | 'board' | 'formula' | 'action' | 'componentLabel' | 'subtitle'; id: string };
  characters?: { start: number; end: number; box: { x: number; y: number; width: number; height: number } }[];
}
export interface VideoScenePreview {
  width: 1920; height: 1080; template: string;
  stages: { id: string; label: string }[]; stage: string;
  elements: VideoPreviewElement[]; background: string; backgroundImage?: string;
  contentBounds?: VideoSceneBounds;
  warnings: string[];
}
export interface Shot {
  id: string; title: string; sectionTitle?: string; chapter: number; summary: string; utteranceIds: string[];
  circuitAssetId?: string; formulas: FormulaStep[]; actions: CircuitAction[];
  reviewNotes: string[]; holdSeconds: number; layout?: VideoShotLayout; boardTexts?: BoardText[]; highlights?: KeywordHighlight[];
  locked?: boolean; lockedElementIds?: string[];
  story?: VideoStoryFrame;
}
export interface VideoStoryFrame {
  description: string; motion: 'still' | 'zoom-in' | 'pan-left' | 'pan-right' | 'fade-in';
  imageDataUrl?: string; imageApproved?: boolean; imageReviewedAt?: string; sceneRevision?: number; promptVersion?: string;
}
export interface VideoStorySceneSpec {
  schemaVersion: 1; mode: 'single_background'; summary: string; location: string; timeOfDay: string;
  environment: string[]; fixedAssets: string[]; allowedTransientAssets: string[];
  physicsConstraints: string[]; forbiddenAdditions: string[]; styleConstraints: string[]; basePrompt: string;
}
export interface VideoStoryScene {
  id: string; version: number; status: 'draft' | 'confirmed'; confirmedAt: string;
  contentHash: string; spec: VideoStorySceneSpec; backgroundImage?: string;
}
export interface VideoProject {
  schemaVersion: 1; id: string; title: string; revision: number;
  createdAt: string; updatedAt: string; sourceScript: string; cleanedScript: string;
  speakers: VideoSpeaker[]; utterances: Utterance[]; shots: Shot[]; circuits: CircuitAsset[];
  scriptNotes?: VideoScriptNote[];
  contentKinds?: Record<string, 'story' | 'knowledge'>;
  storyScene?: VideoStoryScene;
  physicsModel: 'ideal_textbook'; approvedRevision?: number; problem?: VideoProblem;
  workflow?: VideoWorkflow;
  pronunciations?: { text: string; spoken: string }[];
  speech?: { provider: 'azure' | 'fish' | 'edge'; model: string; chunkLength: number; pauseSeconds: number };
  settings: { width: number; height: number; fps: number; font: string; background: string; backgroundImage?: string; titlePinImage?: string; defaultCircuitView?: 'schematic' | 'real'; switchPolicy?: 'contextual' | 'preserve' | 'include'; showFormulaCaptions?: boolean };
}
export interface SpeechBoundary { text: string; offset: number; duration: number; textOffset: number; wordLength: number }
export interface RenderJob {
  id: string; projectId: string; projectRevision: number; kind: 'preview' | 'final' | 'shot';
  shotIds: string[]; status: 'queued' | 'running' | 'completed' | 'failed' | 'cancelled';
  progress: number; stage: string; createdAt: string; updatedAt: string;
  error?: string; videoUrl?: string; subtitleUrl?: string; archiveUrl?: string;
  cachedShots?: number; duration?: number;
  phase?: string; shotId?: string; retryable?: boolean; errorCode?: string;
  validationReportUrl?: string; keyframeUrls?: string[];
}

export interface VideoReview { fingerprint: string; reviewedAt: string }
export interface VideoWorkflow {
  scriptDraft?: string;
  scriptReview?: VideoReview;
  storyboardReview?: VideoReview;
  storyboardSourceHash?: string;
  lastTaskId?: string;
  lastAppliedTaskId?: string;
  previousStoryboardRevision?: number;
}
export interface ValidationIssue {
  code: string; stage: string; message: string; severity: 'error' | 'warning';
  shotId?: string; objectId?: string; retryable: boolean;
}
export type GenerationTaskKind = 'problem_script' | 'storyboard' | 'storyboard_patch' | 'preflight';
/** A durable, read-only view of prepared frames; it never changes the saved project. */
export interface GenerationPartialResult {
  project: VideoProject | null; version: number; readOnly: true;
  completedShotIds: string[]; completedUtterances: number; totalUtterances: number;
}
export interface GenerationTask {
  id: string; projectId: string; expectedRevision: number; inputHash: string;
  kind: GenerationTaskKind; scope?: string[]; instruction?: string;
  status: 'queued' | 'running' | 'waiting_retry' | 'failed' | 'cancelled' | 'completed';
  progress: number; stage: string; createdAt: string; updatedAt: string;
  attempt: number; lastHeartbeat?: string; issues?: ValidationIssue[];
  error?: string; retryable?: boolean; resultAvailable?: boolean;
  partialResultVersion?: number; completedShots?: number; completedUtterances?: number; totalUtterances?: number;
  appliedRevision?: number; appliedAt?: string;
  /** Non-secret lookup only; credentials are held in the login service memory. */
  credentialProfileId?: string;
}
export interface StoryboardPatch {
  expectedRevision: number; shotIds: string[]; instruction: string;
  shots: Shot[]; circuits: CircuitAsset[];
  changes: { shotId: string; description: string }[];
}
export interface VideoTimelinePreview {
  taskId: string; projectId: string; projectRevision: number; shotId: string;
  duration: number; audioUrl: string;
  events: { time: number; type: string; data?: { id: string }; text?: string; id?: string; speakerId?: string }[];
  utterances: { id: string; start: number; duration: number }[];
}
export interface VideoSystemStatus {
  azureConfigured: boolean; missingConfiguration: string[];
  runtime: { python: boolean; manim: boolean; ffmpeg: boolean; latex: boolean };
  messages: string[];
  fishConfigured?: boolean;
  speechProviders?: { azure: { configured: boolean; missingConfiguration: string[] }; fish: { configured: boolean; missingConfiguration: string[] }; edge: { configured: boolean; missingConfiguration: string[] } };
}



