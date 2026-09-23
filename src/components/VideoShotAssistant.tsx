import { useEffect, useState } from 'react'
import type { Shot, VideoProject } from '../../server/videoTypes'

export function VideoShotAssistant({ project, shot, disabled, onGenerate, onEdit, onUndo, canUndo }: {
  project: VideoProject; shot: Shot; disabled: boolean; onGenerate: (scope: string[], instruction: string) => void;
  onEdit: (patch: Partial<Shot>) => void; onUndo: () => void; canUndo: boolean;
}) {
  const [instruction, setInstruction] = useState(''), [scope, setScope] = useState([shot.id])
  useEffect(() => { setScope([shot.id]); setInstruction('') }, [shot.id])
  const objects = [...(shot.boardTexts || []).map(item => ({ id: 'board:' + item.id, name: '板书：' + item.text })),
    ...shot.formulas.map(item => ({ id: 'formula:' + item.id, name: '公式：' + item.latex })),
    ...shot.highlights?.map(item => ({ id: 'highlight:' + item.id, name: '强调：' + item.phrase })) || [],
    ...(shot.circuitAssetId ? [{ id: 'circuit', name: '本镜头电路与布局' }] : [])]
  return <details className="video-shot-assistant"><summary>用一句话调整分镜</summary>
    <p>例如“这页拆成两步，答案说到结果时再出现”。先查看建议画面，再应用修改。</p>
    <label className="video-check-label"><input type="checkbox" checked={!!shot.locked} disabled={disabled} onChange={e => onEdit({ locked: e.target.checked })} />锁定此镜头，AI 保留全部内容</label>
    <label className="video-field">调整范围<select multiple size={Math.min(4, project.shots.length)} value={scope} disabled={disabled} onChange={e => setScope([...e.target.selectedOptions].map(option => option.value))}>{project.shots.map(item => <option value={item.id} key={item.id}>{item.title}{item.locked ? '（已锁定）' : ''}</option>)}</select></label>
    <label className="video-field">修改要求<textarea aria-label="局部分镜修改要求" value={instruction} rows={3} disabled={disabled} onChange={event => setInstruction(event.target.value)} placeholder="这页拆成两步，最后才显示答案…" /></label>
    <details><summary>保留这些对象</summary><div className="video-object-locks">{objects.map(item => <label key={item.id}><input type="checkbox" disabled={disabled} checked={shot.lockedElementIds?.includes(item.id) || false} onChange={e => onEdit({ lockedElementIds: e.target.checked ? [...(shot.lockedElementIds || []), item.id] : shot.lockedElementIds?.filter(id => id !== item.id) })} />{item.name.slice(0, 65)}</label>)}</div></details>
    <div className="video-dialog-actions"><button className="video-button" disabled={disabled || !canUndo} onClick={onUndo}>撤销上次采用</button><button className="video-button primary" disabled={disabled || !instruction.trim() || !scope.length || scope.some(id => project.shots.find(s => s.id === id)?.locked)} onClick={() => onGenerate(scope, instruction)}>生成修改建议</button></div>
  </details>
}
