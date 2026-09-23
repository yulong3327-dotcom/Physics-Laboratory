import { useEffect, useId, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { flushSync } from 'react-dom'
import { MathfieldElement } from 'mathlive'
import katex from 'katex'
import 'mathlive/fonts.css'
import 'katex/dist/katex.min.css'
import './FormulaEditor.css'

// Vite emits the imported font files as local application assets. Never let the
// custom element derive a CDN URL from its bundled JavaScript location.
MathfieldElement.fontsDirectory = null
MathfieldElement.soundsDirectory = null
MathfieldElement.keypressSound = null
MathfieldElement.plonkSound = null
MathfieldElement.locale = 'zh-CN'

export interface FormulaEditorProps {
  value: string
  onChange: (latex: string) => void
  label: string
}
const templates = [
  { title: '分式', display: 'a/b', latex: '\\frac{#0}{#?}' },
  { title: '平方', display: 'x²', latex: '#0^{2}' },
  { title: '上标', display: 'xⁿ', latex: '#0^{#?}' },
  { title: '下标', display: 'x₁', latex: '#0_{#?}' },
  { title: '根号', display: '√x', latex: '\\sqrt{#0}' },
  { title: '括号', display: '( )', latex: '\\left(#0\\right)' },
  { title: '比例', display: 'a:b', latex: '#0:#?' },
  { title: '乘号', display: '×', latex: '\\times' },
  { title: '欧姆', display: 'Ω', latex: '\\Omega' },
]

/** Controlled semantic math editor. LaTeX remains the project's storage format. */
export function FormulaEditor({ value, onChange, label }: FormulaEditorProps) {
  const host = useRef<HTMLDivElement>(null)
  const field = useRef<MathfieldElement | null>(null)
  const onChangeRef = useRef(onChange)
  const valueRef = useRef(value)
  const id = useId()
  const [advanced, setAdvanced] = useState(false)
  onChangeRef.current = onChange
  valueRef.current = value
  useEffect(() => {
    const element = new MathfieldElement({ defaultMode: 'math', mathVirtualKeyboardPolicy: 'manual', smartMode: false })
    field.current = element
    element.setAttribute('aria-label', label)
    element.setAttribute('aria-describedby', id + '-hint')
    element.setAttribute('tabindex', '0')
    element.setAttribute('placeholder', 'P=UI')
    element.setValue(valueRef.current, { silenceNotifications: true })
    // MathLive is an imperative editor: commit each change before the next
    // template command can move its cursor, so an older React render cannot
    // reinsert text and erase the new fraction/subscript placeholder.
    const changed = () => flushSync(() => onChangeRef.current(element.getValue('latex-without-placeholders')))
    element.addEventListener('input', changed)
    host.current?.append(element)
    return () => { element.removeEventListener('input', changed); element.remove(); if (field.current === element) field.current = null }
  }, [id, label])
  useLayoutEffect(() => {
    const element = field.current
    // Do not reinsert the controlled value after each keystroke: reinsertion
    // destroys the current fraction/subscript cursor and undo history.
    if (element && element.getValue('latex-without-placeholders') !== value) element.setValue(value, { silenceNotifications: true })
  }, [value])
  const preview = useMemo(() => {
    try { return { html: katex.renderToString(value || '\\phantom{x}', { displayMode: true, throwOnError: true, strict: 'ignore', trust: false }), error: '' } }
    catch { return { html: '', error: '公式还未完整，请继续填写分子、分母或括号内容。' } }
  }, [value])
  const insert = (latex: string) => {
    const element = field.current
    if (!element) return
    element.focus()
    // A collapsed caret already has a base to its left. Do not insert a
    // second empty base before an exponent or subscript.
    const template = element.selectionIsCollapsed && latex.startsWith('#0^') || element.selectionIsCollapsed && latex.startsWith('#0_') ? latex.slice(2) : latex
    element.insert(template, { format: 'latex', insertionMode: 'replaceSelection', selectionMode: 'placeholder', focus: true, feedback: false, silenceNotifications: true })
    flushSync(() => onChangeRef.current(element.getValue('latex-without-placeholders')))
  }
  return <div className="formula-editor" role="group" aria-label={label + '编辑器'}>
    <div className="formula-editor-heading"><span>{label}</span><span>直接编辑公式</span></div>
    <div className="formula-editor-tools" role="toolbar" aria-label={label + '模板'}>
      {templates.map(template => <button type="button" key={template.title} aria-label={'插入' + template.title} title={template.title}
        onPointerDown={event => event.preventDefault()} onClick={() => insert(template.latex)}><span aria-hidden="true">{template.display}</span><small>{template.title}</small></button>)}
    </div>
    <div ref={host} className="formula-editor-field" />
    <p id={id + '-hint'} className="formula-editor-hint">点击公式即可输入；用方向键移动，Tab 跳到下一空位。先选中一项，再点分式或上下标可套用结构。</p>
    <div className="formula-editor-preview" aria-label={label + '排版预览'}>{preview.error ? <span role="status">{preview.error}</span> : <div dangerouslySetInnerHTML={{ __html: preview.html }} />}</div>
    <button className="formula-editor-advanced-toggle" type="button" aria-expanded={advanced} onClick={() => setAdvanced(open => !open)}>{advanced ? '收起 LaTeX' : 'LaTeX 高级编辑'}</button>
    {advanced && <label className="formula-editor-source">公式源码<textarea aria-label={label + ' LaTeX'} value={value} rows={3} spellCheck={false} onChange={event => onChange(event.target.value)} /></label>}
  </div>
}
