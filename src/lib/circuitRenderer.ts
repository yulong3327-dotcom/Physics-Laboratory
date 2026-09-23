import type { ComponentType, Orientation, Terminal } from '../types/circuit';

export interface RenderProps {
  type: ComponentType;
  orientation: Orientation;
  selected: boolean;
  label?: string;
  showTerminals: boolean;
}

export const STROKE = '#3e4344';
export const STROKE_SELECTED = STROKE;
export const FILL_NONE = 'none';
export const FILL_WHITE = '#ffffff';
export const TERM_COLOR = STROKE;
export const TERM_RADIUS = 4;
export const SW = 1.75;

export interface SymbolRenderOptions {
  switchClosed?: boolean;
  switchPosition?: 'left' | 'right' | 'open';
  sliderPosition?: number;
  brightness?: number;
  textRotation?: number;
  meterThirdTerminal?: boolean;
}

function getStroke(selected: boolean): string {
  return selected ? STROKE_SELECTED : STROKE;
}

function escapeXml(text: string): string {
  return text.replace(/[&<>"']/g, (character) => {
    switch (character) {
      case '&': return '&amp;';
      case '<': return '&lt;';
      case '>': return '&gt;';
      case '"': return '&quot;';
      default: return '&apos;';
    }
  });
}

export function renderSymbol(
  type: ComponentType,
  selected: boolean,
  label?: string,
  options: SymbolRenderOptions = {}
): string {
  const stroke = getStroke(selected);
  const sw = SW;
  label = label ? escapeXml(label) : undefined;
  const sliderPosition = Number.isFinite(options.sliderPosition) ? Math.min(1, Math.max(0, options.sliderPosition!)) : 0.5;
  const sliderX = -20 + 40 * sliderPosition;

  switch (type) {
    case 'battery':
      return [
        `<line x1="-40" y1="0" x2="-8" y2="0" stroke="${stroke}" stroke-width="${sw}"/>`,
        `<line x1="-8" y1="-16" x2="-8" y2="16" stroke="${stroke}" stroke-width="${sw}"/>`,
        `<line x1="8" y1="-10" x2="8" y2="10" stroke="${stroke}" stroke-width="${sw}"/>`,
        `<line x1="8" y1="0" x2="40" y2="0" stroke="${stroke}" stroke-width="${sw}"/>`,
        label ? `<text x="0" y="-24" text-anchor="middle" font-size="12" fill="${stroke}" font-weight="600">${label}</text>` : '',
      ].join('');

    case 'switch':
      return [
        `<line x1="-40" y1="0" x2="-10" y2="0" stroke="${stroke}" stroke-width="${sw}"/>`,
        `<circle cx="-10" cy="0" r="3" fill="${stroke}"/>`,
        `<line x1="-10" y1="0" x2="${options.switchClosed ? 10 : 12}" y2="${options.switchClosed ? 0 : -16}" stroke="${stroke}" stroke-width="${sw}" stroke-linecap="round"/>`,
        `<circle cx="10" cy="0" r="3" fill="${stroke}"/>`,
        `<line x1="10" y1="0" x2="40" y2="0" stroke="${stroke}" stroke-width="${sw}"/>`,
        label ? `<text x="0" y="-24" text-anchor="middle" font-size="12" fill="${stroke}" font-weight="600">${label}</text>` : '',
      ].join('');

    case 'switch_spdt':
      return [
        `<line x1="-50" y1="0" x2="-14" y2="0" stroke="${stroke}" stroke-width="${sw}"/>`,
        `<circle cx="-14" cy="0" r="3" fill="${stroke}"/>`,
        `<line x1="-14" y1="0" x2="${options.switchPosition && options.switchPosition !== 'open' ? 14 : 12}" y2="${options.switchPosition === 'left' ? -20 : options.switchPosition === 'right' ? 20 : -7}" stroke="${stroke}" stroke-width="${sw}" stroke-linecap="round"/>`,
        `<circle cx="14" cy="-20" r="3" fill="${stroke}"/><circle cx="14" cy="20" r="3" fill="${stroke}"/>`,
        `<line x1="14" y1="-20" x2="50" y2="-20" stroke="${stroke}" stroke-width="${sw}"/>`,
        `<line x1="14" y1="20" x2="50" y2="20" stroke="${stroke}" stroke-width="${sw}"/>`,
        label ? `<text x="0" y="-30" text-anchor="middle" font-size="12" fill="${stroke}">${label}</text>` : '',
      ].join('');

    case 'lamp':
      return [
        `<line x1="-40" y1="0" x2="-15" y2="0" stroke="${stroke}" stroke-width="${sw}"/>`,
        `<circle cx="0" cy="0" r="15" stroke="${stroke}" stroke-width="${sw}" fill="${(options.brightness || 0) > 0.01 ? '#ffe395' : FILL_NONE}"/>`,
        `<line x1="-11" y1="-11" x2="11" y2="11" stroke="${stroke}" stroke-width="${sw}"/>`,
        `<line x1="11" y1="-11" x2="-11" y2="11" stroke="${stroke}" stroke-width="${sw}"/>`,
        `<line x1="15" y1="0" x2="40" y2="0" stroke="${stroke}" stroke-width="${sw}"/>`,
        label ? `<text x="0" y="34" text-anchor="middle" font-size="12" fill="${stroke}" font-weight="600">${label}</text>` : '',
      ].join('');

    case 'resistor':
      return [
        `<line x1="-40" y1="0" x2="-18" y2="0" stroke="${stroke}" stroke-width="${sw}"/>`,
        `<rect x="-18" y="-8" width="36" height="16" stroke="${stroke}" stroke-width="${sw}" fill="${FILL_WHITE}"/>`,
        `<line x1="18" y1="0" x2="40" y2="0" stroke="${stroke}" stroke-width="${sw}"/>`,
        label ? `<text x="0" y="-20" text-anchor="middle" font-size="12" fill="${stroke}" font-weight="600">${label}</text>` : '',
      ].join('');

    case 'rheostat':
      return [
        `<line x1="-50" y1="10" x2="-22" y2="10" stroke="${stroke}" stroke-width="${sw}"/>`,
        `<rect x="-22" y="2" width="44" height="16" stroke="${stroke}" stroke-width="${sw}" fill="${FILL_NONE}"/>`,
        `<line x1="22" y1="10" x2="50" y2="10" stroke="${stroke}" stroke-width="${sw}"/>`,
        `<line x1="-20" y1="-25" x2="20" y2="-25" stroke="${stroke}" stroke-width="${sw}"/>`,
        `<line x1="${sliderX}" y1="-25" x2="${sliderX}" y2="2" stroke="${stroke}" stroke-width="${sw}"/>`,
        `<polyline points="${sliderX - 4},-5 ${sliderX},2 ${sliderX + 4},-5" stroke="${stroke}" stroke-width="${sw}" fill="${FILL_NONE}"/>`,
        label ? `<text x="0" y="-32" text-anchor="middle" font-size="12" fill="${stroke}" font-weight="600">${label}</text>` : '',
      ].join('');

    case 'potentiometer':
      return [
        `<line x1="-50" y1="10" x2="-22" y2="10" stroke="${stroke}" stroke-width="${sw}"/>`,
        `<rect x="-22" y="2" width="44" height="16" stroke="${stroke}" stroke-width="${sw}" fill="${FILL_WHITE}"/>`,
        `<line x1="22" y1="10" x2="50" y2="10" stroke="${stroke}" stroke-width="${sw}"/>`,
        `<path d="M0 -30 V-14 H${sliderX} V2" stroke="${stroke}" stroke-width="${sw}" fill="none"/>`,
        `<polyline points="${sliderX - 4},-5 ${sliderX},2 ${sliderX + 4},-5" stroke="${stroke}" stroke-width="${sw}" fill="none"/>`,
        label ? `<text x="0" y="-38" text-anchor="middle" font-size="12" fill="${stroke}" font-weight="600">${label}</text>` : '',
      ].join('');

    case 'buzzer':
      return [
        `<line x1="-40" y1="0" x2="-16" y2="0" stroke="${stroke}" stroke-width="${sw}"/>`,
        `<circle cx="0" cy="0" r="16" stroke="${stroke}" stroke-width="${sw}" fill="none"/>`,
        `<path d="M-7 -8 H-3 L5 -12 V12 L-3 8 H-7 Z M9 -7 Q15 0 9 7" stroke="${stroke}" stroke-width="${sw}" fill="none"/>`,
        `<line x1="16" y1="0" x2="40" y2="0" stroke="${stroke}" stroke-width="${sw}"/>`,
        label ? `<text x="0" y="-25" text-anchor="middle" font-size="12" fill="${stroke}" font-weight="600">${label}</text>` : '',
      ].join('');

    case 'ammeter':
      return [
        `<line x1="-30" y1="0" x2="-15" y2="0" stroke="${stroke}" stroke-width="${sw}"/>`,
        `<circle cx="0" cy="0" r="15" stroke="${stroke}" stroke-width="${sw}" fill="${FILL_WHITE}"/>`,
        `<g transform="rotate(${options.textRotation || 0})"><text x="0" y="5" text-anchor="middle" font-size="14" fill="${stroke}" font-weight="700">A</text></g>`,
        options.meterThirdTerminal ? `<line x1="0" y1="15" x2="0" y2="30" stroke="${stroke}" stroke-width="${sw}"/>` : '',
        `<line x1="15" y1="0" x2="30" y2="0" stroke="${stroke}" stroke-width="${sw}"/>`,
        label ? `<text x="0" y="-24" text-anchor="middle" font-size="12" fill="${stroke}" font-weight="600">${label}</text>` : '',
      ].join('');

    case 'voltmeter':
      return [
        `<line x1="-30" y1="0" x2="-15" y2="0" stroke="${stroke}" stroke-width="${sw}"/>`,
        `<circle cx="0" cy="0" r="15" stroke="${stroke}" stroke-width="${sw}" fill="${FILL_WHITE}"/>`,
        `<g transform="rotate(${options.textRotation || 0})"><text x="0" y="5" text-anchor="middle" font-size="14" fill="${stroke}" font-weight="700">V</text></g>`,
        options.meterThirdTerminal ? `<line x1="0" y1="15" x2="0" y2="30" stroke="${stroke}" stroke-width="${sw}"/>` : '',
        `<line x1="15" y1="0" x2="30" y2="0" stroke="${stroke}" stroke-width="${sw}"/>`,
        label ? `<text x="0" y="-24" text-anchor="middle" font-size="12" fill="${stroke}" font-weight="600">${label}</text>` : '',
      ].join('');

    case 'motor':
    case 'galvanometer':
      return [
        `<line x1="-40" y1="0" x2="-15" y2="0" stroke="${stroke}" stroke-width="${sw}"/>`,
        `<circle cx="0" cy="0" r="15" stroke="${stroke}" stroke-width="${sw}" fill="${FILL_NONE}"/>`,
        `<g transform="rotate(${options.textRotation || 0})"><text x="0" y="5" text-anchor="middle" font-size="13" fill="${stroke}" font-weight="700">${type === 'galvanometer' ? 'G' : 'M'}</text></g>`,
        `<line x1="15" y1="0" x2="40" y2="0" stroke="${stroke}" stroke-width="${sw}"/>`,
        label ? `<text x="0" y="-24" text-anchor="middle" font-size="12" fill="${stroke}" font-weight="600">${label}</text>` : '',
      ].join('');

    case 'bell':
      return [
        `<line x1="-40" y1="0" x2="-15" y2="0" stroke="${stroke}" stroke-width="${sw}"/>`,
        `<path d="M-15 5 L-15 -5 L0 -10 L0 10 L-15 5 Z" stroke="${stroke}" stroke-width="${sw}" fill="${FILL_NONE}"/>`,
        `<line x1="0" y1="10" x2="0" y2="15" stroke="${stroke}" stroke-width="${sw}"/>`,
        `<line x1="-3" y1="15" x2="3" y2="15" stroke="${stroke}" stroke-width="${sw}"/>`,
        `<line x1="0" y1="-10" x2="15" y2="0" stroke="${stroke}" stroke-width="${sw}"/>`,
        `<line x1="15" y1="0" x2="40" y2="0" stroke="${stroke}" stroke-width="${sw}"/>`,
        label ? `<text x="0" y="-24" text-anchor="middle" font-size="12" fill="${stroke}" font-weight="600">${label}</text>` : '',
      ].join('');

    default:
      return '';
  }
}

export function getTerminalAbsolutePosition(
  compX: number,
  compY: number,
  terminalDx: number,
  terminalDy: number,
  orientation: Orientation
): { x: number; y: number } {
  if (orientation === 'vertical') {
    return {
      x: compX - terminalDy,
      y: compY + terminalDx,
    };
  }
  return {
    x: compX + terminalDx,
    y: compY + terminalDy,
  };
}

export function getTerminalDirection(
  direction: Terminal['dir'],
  orientation: Orientation
): Terminal['dir'] {
  if (orientation === 'horizontal') return direction;
  const clockwise: Record<Terminal['dir'], Terminal['dir']> = {
    left: 'top',
    top: 'right',
    right: 'bottom',
    bottom: 'left',
  };
  return clockwise[direction];
}

export function getTerminalScreenPos(
  compX: number,
  compY: number,
  termId: string,
  def: { terminals: { id: string; dx: number; dy: number }[] },
  orientation: Orientation
): { x: number; y: number } {
  const term = def.terminals.find((t) => t.id === termId);
  if (!term) return { x: compX, y: compY };
  return getTerminalAbsolutePosition(
    compX,
    compY,
    term.dx,
    term.dy,
    orientation
  );
}
