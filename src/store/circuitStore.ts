import { create } from 'zustand';
import { nanoid } from 'nanoid';
import type {
  CircuitComponent,
  ComponentParameters,
  CircuitConnection,
  CircuitGraph,
  CircuitPoint,
  ComponentType,
  ToolMode,
  ViewMode,
} from '../types/circuit';
import { componentLibrary } from '../data/componentLibrary';
import { getPhysicalAsset } from '../data/physicalAssets';
import { validateCircuit } from '../lib/circuitValidator';
import { isComponentType, isWireRoutePoints, parseCircuitGraph } from '../lib/graphSchema';
import { getComponentPosition, withComponentPosition } from '../lib/viewGeometry';

interface CircuitState {
  graph: CircuitGraph;
  toolMode: ToolMode;
  viewMode: ViewMode;
  selectedComponentId: string | null;
  selectedConnectionId: string | null;
  wireStart: { compId: string; termId: string } | null;
  pan: { x: number; y: number };
  zoom: number;
  canUndo: boolean;
  canRedo: boolean;
  simulationEnabled: boolean;
  setSimulationEnabled: (enabled: boolean) => void;
  updateComponentParameters: (id: string, patch: Partial<ComponentParameters>) => void;

  addComponent: (type: ComponentType, x: number, y: number, assetId?: string) => void;
  setComponentAsset: (id: string, assetId: string) => void;
  removeComponent: (id: string) => void;
  moveComponent: (id: string, x: number, y: number) => void;
  rotateComponent: (id: string) => void;
  selectComponent: (id: string | null) => void;
  updateComponentLabel: (id: string, label: string) => void;

  startWire: (compId: string, termId: string) => void;
  finishWire: (compId: string, termId: string) => void;
  cancelWire: () => void;
  removeConnection: (id: string) => void;
  selectConnection: (id: string | null) => void;
  updateConnectionRoute: (id: string, mode: ViewMode, points: CircuitPoint[] | null) => void;

  setToolMode: (mode: ToolMode) => void;
  setViewMode: (mode: ViewMode) => void;
  setPan: (x: number, y: number) => void;
  setZoom: (z: number) => void;

  beginHistoryTransaction: () => void;
  endHistoryTransaction: () => void;
  cancelHistoryTransaction: () => void;
  resetHistory: () => void;
  undo: () => void;
  redo: () => void;

  loadGraph: (graph: unknown) => boolean;
  clearGraph: () => void;
  exportGraph: () => CircuitGraph;
  runValidation: () => void;

  importFromJson: (json: string) => boolean;
  exportToJson: () => string;
}

function createComponent(type: ComponentType, x: number, y: number, assetId?: string): CircuitComponent {
  const def = componentLibrary[type];
  return {
    id: `${type}_${nanoid(6)}`,
    type,
    ...(assetId ? { assetId } : {}),
    label: def.defaultLabel || undefined,
    terminals: structuredClone(def.terminals),
    position: { x, y },
    orientation: 'horizontal',
    source: 'manual',
  };
}

function createEmptyGraph(): CircuitGraph {
  return {
    id: nanoid(10),
    components: [],
    connections: [],
    warnings: [],
    meta: { inputType: 'manual', createdAt: new Date().toISOString() },
  };
}

function hasTerminal(graph: CircuitGraph, compId: string, termId: string): boolean {
  return graph.components.some((component) => component.id === compId && component.terminals.some((terminal) => terminal.id === termId));
}

function clearStaleInteraction(state: CircuitState, graph: CircuitGraph): Partial<CircuitState> {
  return {
    selectedComponentId: graph.components.some((component) => component.id === state.selectedComponentId) ? state.selectedComponentId : null,
    selectedConnectionId: graph.connections.some((connection) => connection.id === state.selectedConnectionId) ? state.selectedConnectionId : null,
    wireStart: state.wireStart && hasTerminal(graph, state.wireStart.compId, state.wireStart.termId) ? state.wireStart : null,
  };
}

const HISTORY_LIMIT = 100;

export function createCircuitStore() {
  return create<CircuitState>((set, get) => {
    let past: CircuitGraph[] = [];
    let future: CircuitGraph[] = [];
    let transaction: CircuitGraph | null = null;

    function transactionChanged(): boolean {
      return transaction !== null && JSON.stringify(transaction) !== JSON.stringify(get().graph);
    }

    function commitGraph(graph: CircuitGraph, validate = true) {
      const state = get();
      if (graph === state.graph) return;
      if (!transaction) {
        past = [...past, state.graph].slice(-HISTORY_LIMIT);
        future = [];
      }
      const nextGraph = validate ? { ...graph, warnings: validateCircuit(graph) } : graph;
      set({
        graph: nextGraph,
        ...clearStaleInteraction(state, nextGraph),
        canUndo: past.length > 0 || transaction !== null,
        canRedo: false,
      });
    }

    function restoreGraph(graph: CircuitGraph) {
      set({
        graph,
        selectedComponentId: null,
        selectedConnectionId: null,
        wireStart: null,
        canUndo: past.length > 0,
        canRedo: future.length > 0,
      });
    }

    return {
      graph: createEmptyGraph(),
      toolMode: 'select',
      viewMode: 'schematic',
      selectedComponentId: null,
      selectedConnectionId: null,
      wireStart: null,
      pan: { x: 0, y: 0 },
      zoom: 1,
      canUndo: false,
      canRedo: false,
      simulationEnabled: false,
      setSimulationEnabled: (simulationEnabled) => set({ simulationEnabled }),
      updateComponentParameters: (id, patch) => {
        const graph = get().graph;
        if (!graph.components.some(component => component.id === id)) return;
        const candidate = { ...graph, components: graph.components.map(component => component.id === id
          ? { ...component, parameters: { ...component.parameters, ...patch } } : component) };
        const validated = parseCircuitGraph(candidate);
        if (validated) commitGraph(validated, false);
      },

      addComponent: (type, x, y, assetId) => {
        if (!isComponentType(type) || !Number.isFinite(x) || !Number.isFinite(y)) return;
        if (assetId !== undefined && (typeof assetId !== 'string' || !getPhysicalAsset(type, assetId))) return;
        const component = createComponent(type, x, y, assetId);
        const graph = get().graph;
        commitGraph({ ...graph, components: [...graph.components, component] });
        set({ selectedComponentId: component.id, selectedConnectionId: null });
      },

      setComponentAsset: (id, assetId) => {
        const graph = get().graph;
        const component = graph.components.find((item) => item.id === id);
        if (!component || typeof assetId !== 'string' || !getPhysicalAsset(component.type, assetId) || component.assetId === assetId) return;
        commitGraph({ ...graph, components: graph.components.map((item) => item.id === id ? { ...item, assetId } : item) }, false);
      },

      removeComponent: (id) => {
        const graph = get().graph;
        if (!graph.components.some((component) => component.id === id)) return;
        commitGraph({
          ...graph,
          components: graph.components.filter((component) => component.id !== id),
          connections: graph.connections.filter((connection) => connection.from.split('.')[0] !== id && connection.to.split('.')[0] !== id),
        });
      },

      moveComponent: (id, x, y) => {
        if (!Number.isFinite(x) || !Number.isFinite(y)) return;
        const graph = get().graph;
        const component = graph.components.find((item) => item.id === id);
        const mode = get().viewMode;
        if (!component || (getComponentPosition(component, mode).x === x && getComponentPosition(component, mode).y === y)) return;
        commitGraph({
          ...graph,
          components: graph.components.map((item) => item.id === id ? withComponentPosition(item, mode, { x, y }) : item),
        }, false);
      },

      rotateComponent: (id) => {
        const graph = get().graph;
        const key = get().viewMode === 'real' ? 'realOrientation' : 'orientation';
        if (!graph.components.some((component) => component.id === id)) return;
        commitGraph({
          ...graph,
          components: graph.components.map((component) => component.id === id ? {
            ...component,
            [key]: (component[key] || 'horizontal') === 'horizontal' ? 'vertical' : 'horizontal',
          } : component),
        }, false);
      },

      selectComponent: (id) => {
        set({ selectedComponentId: get().graph.components.some((component) => component.id === id) ? id : null, selectedConnectionId: null });
      },

      updateComponentLabel: (id, label) => {
        if (typeof label !== 'string') return;
        const graph = get().graph;
        const component = graph.components.find((item) => item.id === id);
        if (!component || component.label === label) return;
        commitGraph({
          ...graph,
          components: graph.components.map((item) => item.id === id ? { ...item, label } : item),
        }, false);
      },

      startWire: (compId, termId) => {
        set({ wireStart: hasTerminal(get().graph, compId, termId) ? { compId, termId } : null });
      },

      finishWire: (compId, termId) => {
        const { graph, wireStart } = get();
        if (!wireStart) return;
        set({ wireStart: null });
        if (!hasTerminal(graph, wireStart.compId, wireStart.termId) || !hasTerminal(graph, compId, termId)) return;
        const from = `${wireStart.compId}.${wireStart.termId}`;
        const to = `${compId}.${termId}`;
        if (from === to || graph.connections.some((connection) =>
          (connection.from === from && connection.to === to) || (connection.from === to && connection.to === from)
        )) return;
        const connection: CircuitConnection = { id: `conn_${nanoid(6)}`, from, to, source: 'manual' };
        commitGraph({ ...graph, connections: [...graph.connections, connection] });
        set({ selectedComponentId: null, selectedConnectionId: connection.id });
      },

      cancelWire: () => set({ wireStart: null }),

      removeConnection: (id) => {
        const graph = get().graph;
        if (!graph.connections.some((connection) => connection.id === id)) return;
        commitGraph({ ...graph, connections: graph.connections.filter((connection) => connection.id !== id) });
      },

      selectConnection: (id) => {
        set({ selectedConnectionId: get().graph.connections.some((connection) => connection.id === id) ? id : null, selectedComponentId: null });
      },

      updateConnectionRoute: (id, mode, points) => {
        if (mode !== 'schematic' && mode !== 'real') return;
        if (points !== null && !isWireRoutePoints(points)) return;
        const graph = get().graph;
        const connection = graph.connections.find(item => item.id === id);
        if (!connection) return;
        const routes = { ...connection.routes };
        if (points) routes[mode] = { points: structuredClone(points) };
        else delete routes[mode];
        if (JSON.stringify(routes[mode]) === JSON.stringify(connection.routes?.[mode])) return;
        const { routes: _previous, ...rest } = connection;
        const next = { ...rest, ...(Object.keys(routes).length ? { routes } : {}) };
        commitGraph({ ...graph, connections: graph.connections.map(item => item.id === id ? next : item) }, false);
      },

      setToolMode: (mode) => {
        if (mode !== 'select' && mode !== 'wire' && mode !== 'pan') return;
        set({ toolMode: mode, wireStart: null });
      },
      setViewMode: (mode) => {
        if (mode !== 'schematic' && mode !== 'real') return;
        set({ viewMode: mode, wireStart: null });
      },
      setPan: (x, y) => {
        if (Number.isFinite(x) && Number.isFinite(y)) set({ pan: { x, y } });
      },
      setZoom: (zoom) => {
        if (Number.isFinite(zoom)) set({ zoom: Math.max(0.3, Math.min(3, zoom)) });
      },

      beginHistoryTransaction: () => {
        if (!transaction) transaction = get().graph;
      },
      endHistoryTransaction: () => {
        if (!transaction) return;
        if (transactionChanged()) {
          past = [...past, transaction].slice(-HISTORY_LIMIT);
          future = [];
        }
        transaction = null;
        set({ canUndo: past.length > 0, canRedo: future.length > 0 });
      },
      cancelHistoryTransaction: () => {
        if (!transaction) return;
        const graph = transaction;
        transaction = null;
        set({ graph, ...clearStaleInteraction(get(), graph), canUndo: past.length > 0, canRedo: future.length > 0 });
      },
      resetHistory: () => {
        past = [];
        future = [];
        transaction = null;
        set({ canUndo: false, canRedo: false });
      },
      undo: () => {
        get().endHistoryTransaction();
        const previous = past[past.length - 1];
        if (!previous) return;
        past = past.slice(0, -1);
        future = [...future, get().graph];
        restoreGraph(previous);
      },
      redo: () => {
        get().endHistoryTransaction();
        const next = future[future.length - 1];
        if (!next) return;
        future = future.slice(0, -1);
        past = [...past, get().graph].slice(-HISTORY_LIMIT);
        restoreGraph(next);
      },

      loadGraph: (input) => {
        const graph = parseCircuitGraph(input);
        if (!graph) return false;
        get().endHistoryTransaction();
        const warnings = [...graph.warnings, ...validateCircuit(graph)];
        const unique = warnings.filter((warning, index) => warnings.findIndex(other => JSON.stringify(other) === JSON.stringify(warning)) === index);
        commitGraph({ ...graph, warnings: unique }, false);
        set({ selectedComponentId: null, selectedConnectionId: null, wireStart: null });
        return true;
      },

      clearGraph: () => {
        get().endHistoryTransaction();
        commitGraph(createEmptyGraph());
        set({ selectedComponentId: null, selectedConnectionId: null, wireStart: null });
      },

      exportGraph: () => structuredClone(get().graph),

      runValidation: () => {
        const graph = get().graph;
        set({ graph: { ...graph, warnings: validateCircuit(graph) } });
      },

      importFromJson: (json) => {
        try {
          const input = JSON.parse(json);
          if (input.schemaVersion !== undefined && input.schemaVersion !== 2) return false;
          if (!get().loadGraph(input)) return false;
          if (input.viewMode === 'real' || input.viewMode === 'schematic') get().setViewMode(input.viewMode);
          return true;
        } catch {
          return false;
        }
      },

      exportToJson: () => JSON.stringify({ ...get().graph, schemaVersion: 2, viewMode: get().viewMode }, null, 2),
    };
  });
}

export const useCircuitStore = createCircuitStore();
