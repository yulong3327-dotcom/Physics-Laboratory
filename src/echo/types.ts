export type EchoModelId = 'stationary' | 'approaching' | 'receding' | 'descending' | 'ascending' | 'depth' | 'moving-target' | 'decelerating' | 'two-receivers' | 'parking'
export type EchoParameter = 'soundSpeed' | 'sourceSpeed' | 'targetSpeed' | 'echoTime' | 'initialDistance' | 'finalSpeed' | 'trainLength' | 'tunnelLength' | 'passTime' | 'sourceTravel' | 'carriageLength'
export interface EchoSample { id: string; title: string; text: string; modelId: EchoModelId; keywords: string[] }
export interface EchoTemplate { id: EchoModelId; name: string; description: string; keywords: string[]; fields: EchoParameter[]; supported: boolean; formula: string }
export interface EchoQuantity { value: number; source: string }
export interface EchoMatch { modelId: EchoModelId; score: number; evidence: string[] }
export interface EchoAnalysis { cleanedText: string; modelId: EchoModelId | null; candidates: EchoMatch[]; quantities: Partial<Record<EchoParameter, EchoQuantity>>; warnings: string[]; extensions: string[]; keywords: string[] }
export interface EchoResult { initialDistance: number; finalDistance: number; echoTime: number; reflectionTime: number; sourceTravel: number; soundTravel: number; sourceSpeed: number; targetSpeed: number; acceleration: number; soundSpeed: number; extras: { label: string; value: number; unit: string; formula: string }[]; steps: string[] }
export interface EchoSolution { result: EchoResult | null; missing: EchoParameter[]; errors: string[] }
export interface EchoProject { schemaVersion: 1; kind: 'echo-lab'; text: string; modelId: EchoModelId | null; overrides: Partial<Record<EchoParameter, number>>; samples: EchoSample[]; assistance?: import('./ai').EchoAssistance; sceneIndex?: number }
