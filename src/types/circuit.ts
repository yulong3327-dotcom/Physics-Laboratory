export type ComponentType =
  | 'battery'
  | 'switch'
  | 'lamp'
  | 'resistor'
  | 'rheostat'
  | 'ammeter'
  | 'voltmeter'
  | 'motor'
  | 'galvanometer'
  | 'switch_spdt'
  | 'bell'
  | 'potentiometer'
  | 'buzzer';

export type InputType = 'image_real' | 'image_schematic' | 'text' | 'manual';

export type DataSource = 'ai' | 'opencv' | 'manual' | 'text' | 'rule';

export type Orientation = 'horizontal' | 'vertical';
export interface CircuitPoint { x: number; y: number }
export interface WireRoute { points: CircuitPoint[] }

export interface ComponentParameters {
  voltage?: number;
  internalResistance?: number;
  resistance?: number;
  maxResistance?: number;
  sliderPosition?: number;
  switchClosed?: boolean;
  switchPosition?: 'left' | 'right' | 'open';
  ratedVoltage?: number;
  ratedPower?: number;
  meterRange?: number;
  meterMode?: 'auto' | 'manual';
  manualReading?: number;
}

export interface Terminal {
  id: string;
  label?: string;
  dx: number;
  dy: number;
  dir: 'left' | 'right' | 'top' | 'bottom';
}

export interface CircuitComponent {
  id: string;
  type: ComponentType;
  assetId?: string;
  label?: string;
  terminals: Terminal[];
  position: { x: number; y: number };
  realPosition?: CircuitPoint;
  orientation: Orientation;
  realOrientation?: Orientation;
  parameters?: ComponentParameters;
  confidence?: number;
  source?: DataSource;
  rheostatConfig?: {
    activeTerminals: [string, string];
    sliderPosition?: number;
  };
  selected?: boolean;
}

export interface CircuitConnection {
  id: string;
  from: string;
  to: string;
  routes?: Partial<Record<ViewMode, WireRoute>>;
  confidence?: number;
  source?: DataSource;
  selected?: boolean;
}

export type WarningType =
  | 'short_circuit'
  | 'open_circuit'
  | 'low_confidence'
  | 'meter_misuse'
  | 'polarity_error'
  | 'isolated_component'
  | 'overload'
  | 'simulation_limit';

export type WarningSeverity = 'error' | 'warning' | 'info';

export interface CircuitWarning {
  type: WarningType;
  message: string;
  componentId?: string;
  severity: WarningSeverity;
}

export interface CircuitGraph {
  id: string;
  components: CircuitComponent[];
  connections: CircuitConnection[];
  warnings: CircuitWarning[];
  meta: {
    inputType: InputType;
    createdAt: string;
    sourceImage?: string;
  };
}

export interface CircuitAIProvider {
  recognizeImage(
    image: string,
    mode: 'real' | 'schematic'
  ): Promise<CircuitGraph>;

  parseTextDescription(text: string): Promise<CircuitGraph>;

  describeCircuit(graph: CircuitGraph): Promise<string>;

  diagnoseCircuit(graph: CircuitGraph): Promise<CircuitWarning[]>;
}

export type ViewMode = 'schematic' | 'real';

export type ToolMode = 'select' | 'wire' | 'pan';
