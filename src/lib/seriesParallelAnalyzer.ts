import type { CircuitGraph } from '../types/circuit';
import { componentLibrary } from '../data/componentLibrary';

export interface TopologyResult {
  type: 'series' | 'parallel' | 'mixed' | 'empty' | 'incomplete';
  description: string;
  mainPath: string[];
  branches: string[][];
  loadComponents: string[];
}

export function analyzeTopology(graph: CircuitGraph): TopologyResult {
  const components = graph.components;
  if (components.length === 0) {
    return {
      type: 'empty',
      description: '电路为空',
      mainPath: [],
      branches: [],
      loadComponents: [],
    };
  }

  const battery = components.find((c) => c.type === 'battery');
  if (!battery) {
    return {
      type: 'incomplete',
      description: '缺少电源',
      mainPath: [],
      branches: [],
      loadComponents: components.map((c) => c.id),
    };
  }

  const adj = buildAdjacency(graph);
  const loads = components.filter(
    (c) =>
      c.type !== 'battery' &&
      c.type !== 'ammeter' &&
      c.type !== 'voltmeter'
  );
  const loadIds = loads.map((c) => c.id);

  const pathToBattery = (compId: string): boolean => {
    return canReach(battery.id, compId, adj, new Set());
  };

  const connectedLoads = loadIds.filter(pathToBattery);
  if (connectedLoads.length === 0) {
    return {
      type: 'incomplete',
      description: '没有用电器接入回路',
      mainPath: [],
      branches: [],
      loadComponents: loadIds,
    };
  }

  const allPaths = findAllPaths(battery.id, battery.id, adj, new Set([battery.id]), []);

  if (allPaths.length === 0) {
    return {
      type: 'incomplete',
      description: '电路未形成闭合回路',
      mainPath: [],
      branches: [],
      loadComponents: loadIds,
    };
  }

  const loadOnlyPaths = allPaths.filter((path) =>
    path.some((id) => loadIds.includes(id))
  );

  if (loadOnlyPaths.length === 1) {
    const path = loadOnlyPaths[0].filter((id) => loadIds.includes(id));
    return {
      type: 'series',
      description: describeSeries(path, graph),
      mainPath: loadOnlyPaths[0],
      branches: [path],
      loadComponents: loadIds,
    };
  }

  const junctions = findJunctions(adj, components);
  if (junctions.length >= 2) {
    return {
      type: 'parallel',
      description: describeParallel(loadOnlyPaths, graph),
      mainPath: [],
      branches: loadOnlyPaths.map((p) => p.filter((id) => loadIds.includes(id))),
      loadComponents: loadIds,
    };
  }

  return {
    type: 'mixed',
    description: '混合电路',
    mainPath: [],
    branches: loadOnlyPaths.map((p) => p.filter((id) => loadIds.includes(id))),
    loadComponents: loadIds,
  };
}

interface AdjList {
  [key: string]: Set<string>;
}

function buildAdjacency(graph: CircuitGraph): AdjList {
  const adj: AdjList = {};
  for (const comp of graph.components) {
    adj[comp.id] = new Set();
  }
  for (const conn of graph.connections) {
    const [fromComp] = conn.from.split('.');
    const [toComp] = conn.to.split('.');
    if (adj[fromComp]) adj[fromComp].add(toComp);
    if (adj[toComp]) adj[toComp].add(fromComp);
  }
  return adj;
}

function canReach(
  start: string,
  target: string,
  adj: AdjList,
  visited: Set<string>
): boolean {
  if (start === target) return true;
  visited.add(start);
  const neighbors = adj[start];
  if (!neighbors) return false;
  for (const next of neighbors) {
    if (visited.has(next)) continue;
    if (canReach(next, target, adj, visited)) return true;
  }
  return false;
}

function findAllPaths(
  start: string,
  end: string,
  adj: AdjList,
  visited: Set<string>,
  path: string[]
): string[][] {
  const results: string[][] = [];
  const neighbors = adj[start];
  if (!neighbors) return results;

  for (const next of neighbors) {
    if (next === end && path.length >= 2) {
      results.push([...path, next]);
      continue;
    }
    if (visited.has(next)) continue;
    visited.add(next);
    path.push(next);
    const subResults = findAllPaths(next, end, adj, visited, path);
    results.push(...subResults);
    path.pop();
    visited.delete(next);
  }

  return results;
}

function findJunctions(
  adj: AdjList,
  components: { id: string; type: string }[]
): string[] {
  const junctions: string[] = [];
  for (const comp of components) {
    const neighbors = adj[comp.id];
    if (neighbors && neighbors.size >= 3) {
      junctions.push(comp.id);
    }
  }
  return junctions;
}

function describeSeries(path: string[], graph: CircuitGraph): string {
  const names = path.map((id) => {
    const comp = graph.components.find((c) => c.id === id);
    if (!comp) return '?';
    const def = componentLibrary[comp.type];
    return def.name;
  });
  return `串联电路：${names.join(' → ')}`;
}

function describeParallel(paths: string[][], graph: CircuitGraph): string {
  const branchCount = paths.length;
  const loadNames = paths.map((path) =>
    path
      .filter((id) => {
        const comp = graph.components.find((c) => c.id === id);
        return comp && comp.type !== 'battery';
      })
      .map((id) => {
        const comp = graph.components.find((c) => c.id === id);
        return comp ? componentLibrary[comp.type].name : '?';
      })
      .join('→')
  );
  return `并联电路（${branchCount}条支路）：${loadNames.join('， ')}`;
}
