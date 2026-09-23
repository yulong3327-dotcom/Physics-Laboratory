import type { CircuitComponent, CircuitConnection } from '../types/circuit';
import { componentLibrary } from '../data/componentLibrary';
import { getTerminalAbsolutePosition, getTerminalDirection } from './circuitRenderer';

export interface RoutePoint {
  x: number;
  y: number;
}

export interface RoutedConnection {
  connectionId: string;
  points: RoutePoint[];
}

function getTermPos(
  comp: CircuitComponent,
  termId: string
): RoutePoint {
  const def = componentLibrary[comp.type];
  const term = def.terminals.find((t) => t.id === termId);
  if (!term) return { x: comp.position.x, y: comp.position.y };
  return getTerminalAbsolutePosition(
    comp.position.x,
    comp.position.y,
    term.dx,
    term.dy,
    comp.orientation
  );
}

function parseEndpoint(
  endpoint: string,
  components: CircuitComponent[]
): { comp: CircuitComponent; termId: string } | null {
  const [compId, termId] = endpoint.split('.');
  const comp = components.find((c) => c.id === compId);
  if (!comp) return null;
  return { comp, termId };
}

function routeOrthogonal(
  start: RoutePoint,
  end: RoutePoint,
  startDir: string,
  endDir: string
): RoutePoint[] {
  const points: RoutePoint[] = [start];
  const midX = (start.x + end.x) / 2;
  const midY = (start.y + end.y) / 2;

  if (startDir === 'right' || startDir === 'left') {
    const exitX = startDir === 'right' ? start.x + 20 : start.x - 20;
    if (endDir === 'left' || endDir === 'right') {
      const enterX = endDir === 'left' ? end.x - 20 : end.x + 20;
      points.push({ x: exitX, y: start.y });
      points.push({ x: exitX, y: midY });
      points.push({ x: enterX, y: midY });
      points.push({ x: enterX, y: end.y });
    } else {
      const exitY = endDir === 'top' ? end.y - 20 : end.y + 20;
      points.push({ x: exitX, y: start.y });
      points.push({ x: exitX, y: midY });
      points.push({ x: end.x, y: midY });
      points.push({ x: end.x, y: exitY });
    }
  } else {
    const exitY = startDir === 'bottom' ? start.y + 20 : start.y - 20;
    if (endDir === 'left' || endDir === 'right') {
      const enterX = endDir === 'left' ? end.x - 20 : end.x + 20;
      points.push({ x: start.x, y: exitY });
      points.push({ x: midX, y: exitY });
      points.push({ x: midX, y: end.y });
      points.push({ x: enterX, y: end.y });
    } else {
      const enterY = endDir === 'top' ? end.y - 20 : end.y + 20;
      points.push({ x: start.x, y: exitY });
      points.push({ x: midX, y: exitY });
      points.push({ x: midX, y: enterY });
      points.push({ x: end.x, y: enterY });
    }
  }

  points.push(end);
  return points;
}

export function routeConnections(
  components: CircuitComponent[],
  connections: CircuitConnection[]
): Map<string, RoutePoint[]> {
  const result = new Map<string, RoutePoint[]>();

  for (const conn of connections) {
    const fromParsed = parseEndpoint(conn.from, components);
    const toParsed = parseEndpoint(conn.to, components);
    if (!fromParsed || !toParsed) continue;

    const start = getTermPos(fromParsed.comp, fromParsed.termId);
    const end = getTermPos(toParsed.comp, toParsed.termId);

    const fromDef = componentLibrary[fromParsed.comp.type];
    const toDef = componentLibrary[toParsed.comp.type];
    const fromTerm = fromDef.terminals.find((t) => t.id === fromParsed.termId);
    const toTerm = toDef.terminals.find((t) => t.id === toParsed.termId);

    const startDir = getTerminalDirection(fromTerm?.dir || 'right', fromParsed.comp.orientation);
    const endDir = getTerminalDirection(toTerm?.dir || 'left', toParsed.comp.orientation);

    const points = routeOrthogonal(start, end, startDir, endDir);
    result.set(conn.id, points);
  }

  return result;
}

export function pointsToPath(points: RoutePoint[]): string {
  if (points.length === 0) return '';
  let path = `M ${points[0].x} ${points[0].y}`;
  for (let i = 1; i < points.length; i++) {
    path += ` L ${points[i].x} ${points[i].y}`;
  }
  return path;
}

export function routeSingleConnection(
  components: CircuitComponent[],
  conn: CircuitConnection
): RoutePoint[] {
  const fromParsed = parseEndpoint(conn.from, components);
  const toParsed = parseEndpoint(conn.to, components);
  if (!fromParsed || !toParsed) return [];

  const start = getTermPos(fromParsed.comp, fromParsed.termId);
  const end = getTermPos(toParsed.comp, toParsed.termId);

  const fromDef = componentLibrary[fromParsed.comp.type];
  const toDef = componentLibrary[toParsed.comp.type];
  const fromTerm = fromDef.terminals.find((t) => t.id === fromParsed.termId);
  const toTerm = toDef.terminals.find((t) => t.id === toParsed.termId);

  const startDir = getTerminalDirection(fromTerm?.dir || 'right', fromParsed.comp.orientation);
  const endDir = getTerminalDirection(toTerm?.dir || 'left', toParsed.comp.orientation);

  return routeOrthogonal(start, end, startDir, endDir);
}
