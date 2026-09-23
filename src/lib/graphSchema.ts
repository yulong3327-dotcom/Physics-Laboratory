import { componentLibrary } from '../data/componentLibrary';
import { getPhysicalAsset } from '../data/physicalAssets';
import type { CircuitGraph, ComponentType } from '../types/circuit';

const inputTypes = new Set(['image_real', 'image_schematic', 'text', 'manual']);
const sources = new Set(['ai', 'opencv', 'manual', 'text', 'rule']);
const directions = new Set(['left', 'right', 'top', 'bottom']);
const warningTypes = new Set([
  'short_circuit', 'open_circuit', 'low_confidence', 'meter_misuse',
  'polarity_error', 'isolated_component', 'overload', 'simulation_limit',
]);
const severities = new Set(['error', 'warning', 'info']);

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

function isPoint(value: unknown): boolean {
  return isRecord(value) && isFiniteNumber(value.x) && isFiniteNumber(value.y);
}

export function isWireRoutePoints(value: unknown): boolean {
  return Array.isArray(value) && value.length >= 2 && value.length <= 128 && value.every(isPoint);
}

function validRoutes(value: unknown): boolean {
  if (value === undefined) return true;
  if (!isRecord(value)) return false;
  return Object.entries(value).every(([mode, route]) => (mode === 'real' || mode === 'schematic') && isRecord(route) && isWireRoutePoints(route.points));
}

function isIdentifier(value: unknown): value is string {
  return typeof value === 'string' && /^[^.\s]+$/.test(value);
}

function optionalString(value: unknown): boolean {
  return value === undefined || typeof value === 'string';
}

function validProvenance(value: Record<string, unknown>): boolean {
  return (
    (value.source === undefined || (typeof value.source === 'string' && sources.has(value.source))) &&
    (value.confidence === undefined || (isFiniteNumber(value.confidence) && value.confidence >= 0 && value.confidence <= 1)) &&
    (value.selected === undefined || typeof value.selected === 'boolean')
  );
}

function validParameters(value: unknown): boolean {
  if (value === undefined) return true;
  if (!isRecord(value)) return false;
  const nonnegative = new Set(['voltage', 'internalResistance', 'resistance', 'maxResistance']);
  const positive = new Set(['ratedVoltage', 'ratedPower', 'meterRange']);
  for (const [key, item] of Object.entries(value)) {
    if (nonnegative.has(key) && isFiniteNumber(item) && item >= 0 && item <= 1e9) continue;
    if (positive.has(key) && isFiniteNumber(item) && item > 0 && item <= 1e9) continue;
    if (key === 'sliderPosition' && isFiniteNumber(item) && item >= 0 && item <= 1) continue;
    if (key === 'manualReading' && isFiniteNumber(item) && Math.abs(item) <= 1e9) continue;
    if (key === 'switchClosed' && typeof item === 'boolean') continue;
    if (key === 'switchPosition' && ['left', 'right', 'open'].includes(item as string)) continue;
    if (key === 'meterMode' && ['auto', 'manual'].includes(item as string)) continue;
    return false;
  }
  return true;
}

export function isComponentType(value: unknown): value is ComponentType {
  return typeof value === 'string' && Object.prototype.hasOwnProperty.call(componentLibrary, value);
}

/** Validate persisted data before any renderer or electrical analysis can see it. */
export function parseCircuitGraph(value: unknown): CircuitGraph | null {
  if (!isRecord(value) || !isIdentifier(value.id)) return null;
  if (!Array.isArray(value.components) || !Array.isArray(value.connections) || !Array.isArray(value.warnings)) return null;
  if (!isRecord(value.meta)) return null;
  if (typeof value.meta.inputType !== 'string' || !inputTypes.has(value.meta.inputType)) return null;
  if (typeof value.meta.createdAt !== 'string' || !Number.isFinite(Date.parse(value.meta.createdAt))) return null;
  if (!optionalString(value.meta.sourceImage)) return null;

  const ids = new Set<string>();
  const componentIds = new Set<string>();
  const endpoints = new Set<string>();
  let components: unknown[];
  try { components = structuredClone(value.components); } catch { return null; }
  for (const component of components) {
    if (!isRecord(component) || !isIdentifier(component.id) || ids.has(component.id)) return null;
    if (!isComponentType(component.type) || !optionalString(component.label) || !validProvenance(component)) return null;
    if (component.assetId !== undefined && (typeof component.assetId !== 'string' || !getPhysicalAsset(component.type, component.assetId))) return null;
    if (component.orientation !== 'horizontal' && component.orientation !== 'vertical') return null;
    if (component.realOrientation !== undefined && component.realOrientation !== 'horizontal' && component.realOrientation !== 'vertical') return null;
    if (!validParameters(component.parameters)) return null;
    if (!isRecord(component.position) || !isFiniteNumber(component.position.x) || !isFiniteNumber(component.position.y)) return null;
    if (component.realPosition !== undefined && !isPoint(component.realPosition)) return null;
    if (!Array.isArray(component.terminals)) return null;

    const definition = componentLibrary[component.type];
    const expectedTerminals = new Set(definition.terminals.map((terminal) => terminal.id));
    const terminalIds = new Set<string>();
    // Old files used two meter terminals and one slider rail terminal.
    const legacyIds = component.type === 'ammeter' || component.type === 'voltmeter'
      ? ['left', 'right'] : component.type === 'rheostat' ? ['a', 'b', 'c'] : [];
    const suppliedIds = component.terminals.map(terminal => isRecord(terminal) ? terminal.id : undefined);
    if (component.assetId === undefined && legacyIds.length && suppliedIds.length === legacyIds.length &&
      new Set(suppliedIds).size === legacyIds.length && suppliedIds.every(id => typeof id === 'string' && legacyIds.includes(id))) {
      component.terminals.push(...structuredClone(definition.terminals.filter(terminal => !legacyIds.includes(terminal.id))));
    }
    if (component.terminals.length !== expectedTerminals.size) return null;
    for (const terminal of component.terminals) {
      if (!isRecord(terminal) || !isIdentifier(terminal.id) || terminalIds.has(terminal.id)) return null;
      if (!expectedTerminals.has(terminal.id) || !optionalString(terminal.label)) return null;
      if (!isFiniteNumber(terminal.dx) || !isFiniteNumber(terminal.dy)) return null;
      if (typeof terminal.dir !== 'string' || !directions.has(terminal.dir)) return null;
      terminalIds.add(terminal.id);
      endpoints.add(`${component.id}.${terminal.id}`);
    }

    if (component.rheostatConfig !== undefined) {
      const config = component.rheostatConfig;
      if (component.type !== 'rheostat' || !isRecord(config) || !Array.isArray(config.activeTerminals)) return null;
      if (config.activeTerminals.length !== 2 || config.activeTerminals[0] === config.activeTerminals[1]) return null;
      if (!config.activeTerminals.every((id) => typeof id === 'string' && terminalIds.has(id))) return null;
      if (config.sliderPosition !== undefined && (!isFiniteNumber(config.sliderPosition) || config.sliderPosition < 0 || config.sliderPosition > 1)) return null;
    }
    ids.add(component.id);
    componentIds.add(component.id);
  }

  const pairs = new Set<string>();
  for (const connection of value.connections) {
    if (!isRecord(connection) || !isIdentifier(connection.id) || ids.has(connection.id) || !validProvenance(connection)) return null;
    if (typeof connection.from !== 'string' || typeof connection.to !== 'string') return null;
    if (!validRoutes(connection.routes)) return null;
    if (!endpoints.has(connection.from) || !endpoints.has(connection.to) || connection.from === connection.to) return null;
    const pair = JSON.stringify([connection.from, connection.to].sort());
    if (pairs.has(pair)) return null;
    pairs.add(pair);
    ids.add(connection.id);
  }

  for (const warning of value.warnings) {
    if (!isRecord(warning) || typeof warning.message !== 'string') return null;
    if (typeof warning.type !== 'string' || !warningTypes.has(warning.type)) return null;
    if (typeof warning.severity !== 'string' || !severities.has(warning.severity)) return null;
    if (warning.componentId !== undefined && (typeof warning.componentId !== 'string' || !componentIds.has(warning.componentId))) return null;
  }

  try {
    return structuredClone({ ...value, components }) as unknown as CircuitGraph;
  } catch {
    return null;
  }
}
