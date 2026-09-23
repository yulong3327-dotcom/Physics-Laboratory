export interface EchoQuestion { title: string; text: string }
export function questionOnly(text: string): string {
  return text.split(/【(?:解析|答案|分析|知识点|难度|省份|来源|年份)】/)[0].replace(/\(?tid\s*[:：]\s*\d+\)?/gi, '').trim()
}
export function splitEchoQuestions(raw: string): EchoQuestion[] {
  const chunks = raw.split(/【(?:主观题|单选题|多选题|填空题)】/).filter(s => s.trim())
  return chunks.map((chunk, index) => {
    const text = questionOnly(chunk).replace(/^\s*\d+[.、．]\s*/, '')
    return { title: `第 ${index + 1} 题 · ${text.slice(0, 24)}`, text }
  }).filter(item => item.text)
}

/** Only split explicitly independent receiver/motion cases; train passage is a shared constraint. */
export function splitEchoScenes(raw: string): EchoQuestion[] {
  const text = questionOnly(raw).normalize('NFKC')
  const parts = text.split(/\([12]\)/)
  if (parts.length !== 3) return []
  const commonSound = text.match(/[^。；\n]*(?:声速|传播的?速度)[^。；\n]*?(?:m\s*\/\s*s|米每秒)[^。；\n]*/)?.[0] || ''
  if (/潜艇.*静止/.test(parts[0]) && /海底/.test(parts[0]) && /水平.*航行/.test(parts[2]) && /暗礁|岛礁/.test(parts[2])) {
    return [{ title: '静止测深', text: parts[0] + parts[1] }, { title: '水平航行测距', text: '潜艇。' + parts[2] + '。' + commonSound }]
  }
  if (/汽车/.test(parts[0]) && /回声/.test(parts[1]) && /与此同时|另一辆/.test(parts[2]) && /护路工人/.test(parts[2])) {
    return [{ title: '汽车接收回声', text: parts[0] + parts[1] }, { title: '工人接收列车鸣笛', text: parts[2] + '。' + commonSound }]
  }
  return []
}
