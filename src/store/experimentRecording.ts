import { create } from 'zustand'
import type { CircuitGraph, ViewMode } from '../types/circuit'
import { useCircuitStore } from './circuitStore'

export interface ExperimentMoment { time: number; graph: CircuitGraph; enabled: boolean }
export interface ExperimentRecording { version: 1; mode: ViewMode; duration: number; moments: ExperimentMoment[] }
interface RecordingState {
  recording: boolean; elapsed: number; take: ExperimentRecording | null
  start: () => void; stop: () => void
}
let unsubscribe: (() => void) | undefined
let timer: ReturnType<typeof setInterval> | undefined
let started = 0
let moments: ExperimentMoment[] = []

function snapshot(graph: CircuitGraph): CircuitGraph {
  // Recognition references do not affect replay; avoid copying a large image into every event.
  return structuredClone({ ...graph, meta: { inputType: graph.meta.inputType, createdAt: graph.meta.createdAt } })
}

export function recordingFrame(take: ExperimentRecording, time: number) {
  const second = Math.max(0, Math.min(take.duration, time))
  let index = 0
  while (index + 1 < take.moments.length && take.moments[index + 1].time <= second) index++
  return take.moments[index]
}

export const useExperimentRecording = create<RecordingState>((set, get) => ({
  recording: false, elapsed: 0, take: null,
  start: () => {
    if (get().recording || !useCircuitStore.getState().graph.components.length) return
    useCircuitStore.getState().setSimulationEnabled(true)
    const state = useCircuitStore.getState()
    started = performance.now()
    moments = [{ time: 0, graph: snapshot(state.graph), enabled: true }]
    set({ recording: true, elapsed: 0, take: { version: 1, mode: state.viewMode, duration: 0, moments: [] } })
    unsubscribe = useCircuitStore.subscribe((state, previous) => {
      if (state.graph === previous.graph && state.simulationEnabled === previous.simulationEnabled) return
      if (state.graph.id !== moments[0].graph.id) { get().stop(); return }
      const time = (performance.now() - started) / 1000
      moments.push({ time, graph: snapshot(state.graph), enabled: state.simulationEnabled })
      if (moments.length >= 1500) get().stop()
    })
    timer = setInterval(() => { const elapsed = (performance.now() - started) / 1000; set({ elapsed }); if (elapsed >= 60) get().stop() }, 100)
  },
  stop: () => {
    if (!get().recording) return
    unsubscribe?.(); unsubscribe = undefined; clearInterval(timer)
    const duration = Math.min(60, Math.max(0.25, (performance.now() - started) / 1000))
    set({ recording: false, elapsed: duration, take: { version: 1, mode: get().take!.mode, duration, moments: moments.filter(moment => moment.time <= duration) } })
  },
}))
