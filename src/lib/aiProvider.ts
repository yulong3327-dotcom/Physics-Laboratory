import { renderPrompt } from './promptCatalog'
import { checkExpiredSession } from './apiSession'
import { nanoid } from 'nanoid';
import { componentLibrary } from '../data/componentLibrary';
import { isComponentType, parseCircuitGraph } from './graphSchema';
import { layoutCircuitGraph } from './autoLayout';
import { physicalAssetList } from '../data/physicalAssets';
import type { CircuitGraph, CircuitWarning, CircuitAIProvider, InputType } from '../types/circuit';

const terminalReference = Object.values(componentLibrary)
  .map((component) => `${component.type} (${component.name}): ${component.terminals.map((terminal) => `${terminal.id}${terminal.label ? `=${terminal.label}` : ''}`).join(', ')}`)
  .join('\n');

const GRAPH_PROMPT = renderPrompt('circuit/recognize-system', { componentTypeCount: Object.keys(componentLibrary).length, terminalReference, physicalAssetReference: physicalAssetList.map(asset => `${asset.id} (${asset.type}, ${asset.name})`).join('; ') });

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function parseModelJson(content: string): unknown {
  let json = content.trim();
  const lines = json.split(/\r?\n/);
  const firstLine = lines[0].trim().toLowerCase();
  if (firstLine === '```' || firstLine === '```json') {
    if (lines.length < 3 || lines[lines.length - 1].trim() !== '```') {
      throw new Error('AI 返回了不完整的 JSON，请重试。');
    }
    json = lines.slice(1, -1).join('\n').trim();
  }
  try {
    return JSON.parse(json);
  } catch {
    throw new Error('AI 返回内容不是有效的电路 JSON，请重试。');
  }
}

function normalizeGraph(content: string, inputType: InputType): CircuitGraph {
  const parsed = parseModelJson(content);
  if (!isRecord(parsed) || !Array.isArray(parsed.components) || !Array.isArray(parsed.connections)) {
    throw new Error('AI 结果缺少元件或连线数组，请重试。');
  }
  if (parsed.components.length === 0) {
    throw new Error('未识别到电路元件，请检查输入内容或更换清晰图片后重试。');
  }
  const components = parsed.components.map((component, index) => {
    if (!isRecord(component) || !isComponentType(component.type)) {
      throw new Error('AI 返回了不支持的元件类型，请重试。');
    }
    const definition = componentLibrary[component.type];
    return {
      ...component,
      id: component.id ?? `${component.type}_${index + 1}`,
      label: component.label ?? (definition.defaultLabel || undefined),
      terminals: structuredClone(definition.terminals),
      position: { x: 0, y: 0 },
      orientation: component.orientation ?? 'horizontal',
      source: 'ai',
    };
  });
  const connections = parsed.connections.map((connection, index) => {
    if (!isRecord(connection)) throw new Error('AI 返回了无效的连线数据，请重试。');
    return { ...connection, id: connection.id ?? `ai_wire_${index + 1}`, source: 'ai' };
  });
  const graph = parseCircuitGraph({
    id: parsed.id ?? `circuit_${nanoid(10)}`,
    components,
    connections,
    warnings: parsed.warnings ?? [],
    meta: { inputType, createdAt: new Date().toISOString() },
  });
  if (!graph) throw new Error('AI 结果包含无效坐标、重复编号或错误连接端点，请重试。');
  return graph;
}

export class MultimodalAIProvider implements CircuitAIProvider {
  constructor(private onProgress?: (message: string) => void, private options: { signal?: AbortSignal } = {}) {}

  async recognizeImage(image: string, mode: 'real' | 'schematic'): Promise<CircuitGraph> {
    if (!image.trim()) throw new Error('请先选择电路图片。');
    const prompt = mode === 'real'
      ? renderPrompt('circuit/recognize-real-user')
      : renderPrompt('circuit/recognize-schematic-user');
    this.onProgress?.('识别元件和接线');
    const inputType = mode === 'real' ? 'image_real' : 'image_schematic';
    const content = await this.callApi(GRAPH_PROMPT, prompt, image, true);
    let graph = normalizeGraph(content, inputType);
    this.onProgress?.('核对端口与支路');
    try {
      const verified = await this.callApi(GRAPH_PROMPT,
        renderPrompt('circuit/verify-user', { candidateGraph: JSON.stringify(graph) }), image, true);
      graph = normalizeGraph(verified, inputType);
    } catch {
      this.options.signal?.throwIfAborted();
      graph.warnings.push({ type: 'low_confidence', severity: 'warning', message: '端口复核未完成，当前为首轮识别结果，请核对导线和接线柱。' });
    }
    this.onProgress?.('整理布局');
    const firstView = await layoutCircuitGraph(graph, mode);
    this.options.signal?.throwIfAborted();
    const arranged = await layoutCircuitGraph(firstView, mode === 'real' ? 'schematic' : 'real');
    this.options.signal?.throwIfAborted();
    return arranged;
  }

  async parseTextDescription(text: string): Promise<CircuitGraph> {
    if (!text.trim()) throw new Error('请输入电路描述。');
    this.onProgress?.('解析电路连接');
    const content = await this.callApi(GRAPH_PROMPT, renderPrompt('circuit/from-description-user', { description: text }), undefined, true);
    this.onProgress?.('整理布局');
    const schematic = await layoutCircuitGraph(normalizeGraph(content, 'text'));
    this.options.signal?.throwIfAborted();
    const arranged = await layoutCircuitGraph(schematic, 'real');
    this.options.signal?.throwIfAborted();
    return arranged;
  }

  async describeCircuit(graph: CircuitGraph): Promise<string> {
    const validated = parseCircuitGraph(graph);
    if (!validated) throw new Error('当前电路数据无效，无法生成描述。');
    return this.callApi(renderPrompt('circuit/describe-system'), JSON.stringify(validated));
  }

  async diagnoseCircuit(graph: CircuitGraph): Promise<CircuitWarning[]> {
    const validated = parseCircuitGraph(graph);
    if (!validated) throw new Error('当前电路数据无效，无法诊断。');
    const content = await this.callApi(
      renderPrompt('circuit/diagnose-system'),
      JSON.stringify(validated),
    );
    const warnings = parseModelJson(content);
    const result = parseCircuitGraph({ ...validated, warnings });
    if (!result) throw new Error('AI 返回的诊断格式无效，请重试。');
    return result.warnings;
  }

  private async callApi(systemPrompt: string, prompt: string, image?: string, json = false): Promise<string> {
    this.options.signal?.throwIfAborted();
    // Some compatible gateways validate JSON mode against the user message only.
    if (json) prompt += renderPrompt('common/json-object-suffix');
    const messages = [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: image ? [
        { type: 'text', text: prompt },
        { type: 'image_url', image_url: { url: image, detail: 'high' } },
      ] : prompt },
    ];
    let response: Response;
    try {
      response = await fetch('/api/ai/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ messages, json }),
        signal: this.options.signal
          ? AbortSignal.any([this.options.signal, AbortSignal.timeout(165_000)])
          : AbortSignal.timeout(165_000),
      });
    } catch (reason) {
      this.options.signal?.throwIfAborted();
      if (reason instanceof Error && (reason.name === 'TimeoutError' || reason.name === 'AbortError')) {
        throw new Error('AI 请求超时，请稍后重试。');
      }
      throw new Error('无法连接 AI 服务，请检查本地服务是否运行。');
    }
    const data: unknown = await response.json().catch(() => null);
    this.options.signal?.throwIfAborted();
    checkExpiredSession(response)
    if (!response.ok) {
      const detail = isRecord(data) && typeof data.error === 'string'
        ? data.error
        : isRecord(data) && isRecord(data.error) && typeof data.error.message === 'string'
          ? data.error.message : `AI 请求失败（${response.status}），请稍后重试。`;
      throw new Error(detail);
    }
    const choice = isRecord(data) && Array.isArray(data.choices) ? data.choices[0] : undefined;
    const content = isRecord(choice) && isRecord(choice.message) ? choice.message.content : undefined;
    if (typeof content !== 'string' || !content.trim()) throw new Error('AI 服务未返回有效内容，请重试。');
    return content;
  }
}

export const aiProviderPlaceholder: CircuitAIProvider = {
  recognizeImage: async () => { throw new Error('AI 服务尚未配置。'); },
  parseTextDescription: async () => { throw new Error('AI 服务尚未配置。'); },
  describeCircuit: async (graph) => `电路包含 ${graph.components.length} 个元件，${graph.connections.length} 条连接`,
  diagnoseCircuit: async () => [],
};
