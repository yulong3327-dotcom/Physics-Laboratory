import { useCircuitStore } from '../store/circuitStore'

export function StatusBar({ saveStatus }: { saveStatus: string }) {
  const { graph, toolMode } = useCircuitStore()
  return <footer className="status-bar">
    <span className="mode-status"><span className="status-dot" />{{ select: '选择', wire: '连线', pan: '平移' }[toolMode]}</span>
    <span data-testid="component-count">{graph.components.length} 个元件</span><span data-testid="connection-count">{graph.connections.length} 条连线</span>
    <span className="save-status">{saveStatus}</span>
  </footer>
}
