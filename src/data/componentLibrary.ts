import type { ComponentType, Terminal } from '../types/circuit';

export interface ComponentDef {
  type: ComponentType;
  name: string;
  nameEn: string;
  width: number;
  height: number;
  terminals: Terminal[];
  defaultLabel: string;
  hasPolarity: boolean;
  isMeter: boolean;
  category: 'source' | 'load' | 'control' | 'measure';
}

export const componentLibrary: Record<ComponentType, ComponentDef> = {
  battery: {
    type: 'battery',
    name: '电池',
    nameEn: 'Battery',
    width: 80,
    height: 40,
    terminals: [
      { id: 'positive', label: '+', dx: -40, dy: 0, dir: 'left' },
      { id: 'negative', label: '-', dx: 40, dy: 0, dir: 'right' },
    ],
    defaultLabel: '',
    hasPolarity: true,
    isMeter: false,
    category: 'source',
  },
  switch: {
    type: 'switch',
    name: '开关',
    nameEn: 'Switch',
    width: 80,
    height: 40,
    terminals: [
      { id: 'left', dx: -40, dy: 0, dir: 'left' },
      { id: 'right', dx: 40, dy: 0, dir: 'right' },
    ],
    defaultLabel: 'S',
    hasPolarity: false,
    isMeter: false,
    category: 'control',
  },
  lamp: {
    type: 'lamp',
    name: '小灯泡',
    nameEn: 'Lamp',
    width: 80,
    height: 50,
    terminals: [
      { id: 'left', dx: -40, dy: 0, dir: 'left' },
      { id: 'right', dx: 40, dy: 0, dir: 'right' },
    ],
    defaultLabel: 'L',
    hasPolarity: false,
    isMeter: false,
    category: 'load',
  },
  resistor: {
    type: 'resistor',
    name: '电阻',
    nameEn: 'Resistor',
    width: 80,
    height: 30,
    terminals: [
      { id: 'left', dx: -40, dy: 0, dir: 'left' },
      { id: 'right', dx: 40, dy: 0, dir: 'right' },
    ],
    defaultLabel: 'R',
    hasPolarity: false,
    isMeter: false,
    category: 'load',
  },
  rheostat: {
    type: 'rheostat',
    name: '滑动变阻器',
    nameEn: 'Rheostat',
    width: 100,
    height: 50,
    terminals: [
      { id: 'a', label: 'A', dx: -50, dy: 10, dir: 'left' },
      { id: 'b', label: 'B', dx: 50, dy: 10, dir: 'right' },
      { id: 'c', label: 'C', dx: -20, dy: -25, dir: 'top' },
      { id: 'd', label: 'D', dx: 20, dy: -25, dir: 'top' },
    ],
    defaultLabel: 'R',
    hasPolarity: false,
    isMeter: false,
    category: 'load',
  },
  potentiometer: {
    type: 'potentiometer', name: '旋钮电位器', nameEn: 'Potentiometer',
    width: 100, height: 60,
    terminals: [
      { id: 'a', label: 'A 固定端（示意）', dx: -50, dy: 10, dir: 'left' },
      { id: 'b', label: 'B 固定端（示意）', dx: 50, dy: 10, dir: 'right' },
      { id: 'w', label: 'W 滑动端（示意）', dx: 0, dy: -30, dir: 'top' },
    ],
    defaultLabel: 'RP', hasPolarity: false, isMeter: false, category: 'control',
  },
  buzzer: {
    type: 'buzzer', name: '蜂鸣器', nameEn: 'Buzzer',
    width: 80, height: 50,
    terminals: [
      { id: 'left', label: '接脚 1', dx: -40, dy: 0, dir: 'left' },
      { id: 'right', label: '接脚 2', dx: 40, dy: 0, dir: 'right' },
    ],
    defaultLabel: 'BZ', hasPolarity: false, isMeter: false, category: 'load',
  },
  ammeter: {
    type: 'ammeter',
    name: '电流表',
    nameEn: 'Ammeter',
    width: 60,
    height: 60,
    terminals: [
      { id: 'left', label: '-', dx: -30, dy: 0, dir: 'left' },
      { id: 'right', label: '+ 0.6 A', dx: 30, dy: 0, dir: 'right' },
      { id: 'high', label: '+ 3 A', dx: 0, dy: 30, dir: 'bottom' },
    ],
    defaultLabel: 'A',
    hasPolarity: true,
    isMeter: true,
    category: 'measure',
  },
  voltmeter: {
    type: 'voltmeter',
    name: '电压表',
    nameEn: 'Voltmeter',
    width: 60,
    height: 60,
    terminals: [
      { id: 'left', label: '+ 3 V', dx: -30, dy: 0, dir: 'left' },
      { id: 'right', label: '-', dx: 30, dy: 0, dir: 'right' },
      { id: 'high', label: '+ 15 V', dx: 0, dy: 30, dir: 'bottom' },
    ],
    defaultLabel: 'V',
    hasPolarity: true,
    isMeter: true,
    category: 'measure',
  },
  motor: {
    type: 'motor',
    name: '电动机',
    nameEn: 'Motor',
    width: 80,
    height: 50,
    terminals: [
      { id: 'left', dx: -40, dy: 0, dir: 'left' },
      { id: 'right', dx: 40, dy: 0, dir: 'right' },
    ],
    defaultLabel: 'M',
    hasPolarity: false,
    isMeter: false,
    category: 'load',
  },
  galvanometer: {
    type: 'galvanometer', name: '灵敏电流计', nameEn: 'Galvanometer',
    width: 80, height: 60,
    terminals: [
      { id: 'left', label: '-', dx: -40, dy: 0, dir: 'left' },
      { id: 'right', label: '+', dx: 40, dy: 0, dir: 'right' },
    ],
    defaultLabel: 'G', hasPolarity: true, isMeter: true, category: 'measure',
  },
  switch_spdt: {
    type: 'switch_spdt', name: '单刀双掷开关', nameEn: 'SPDT Switch',
    width: 100, height: 60,
    terminals: [
      { id: 'common', label: '公共端', dx: -50, dy: 0, dir: 'left' },
      { id: 'left', label: '左支路', dx: 50, dy: -20, dir: 'right' },
      { id: 'right', label: '右支路', dx: 50, dy: 20, dir: 'right' },
    ],
    defaultLabel: 'S', hasPolarity: false, isMeter: false, category: 'control',
  },
  bell: {
    type: 'bell',
    name: '电铃',
    nameEn: 'Bell',
    width: 80,
    height: 50,
    terminals: [
      { id: 'left', dx: -40, dy: 0, dir: 'left' },
      { id: 'right', dx: 40, dy: 0, dir: 'right' },
    ],
    defaultLabel: '',
    hasPolarity: false,
    isMeter: false,
    category: 'load',
  },
};

export const componentOrder: ComponentType[] = [
  'battery',
  'switch',
  'switch_spdt',
  'lamp',
  'resistor',
  'rheostat',
  'potentiometer',
  'ammeter',
  'voltmeter',
  'galvanometer',
  'motor',
  'bell',
  'buzzer',
];

export const categoryNames: Record<string, string> = {
  source: '电源',
  load: '用电器',
  control: '控制',
  measure: '测量',
};
