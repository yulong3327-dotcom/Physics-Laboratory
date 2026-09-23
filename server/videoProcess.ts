import { spawn, type ChildProcess } from 'node:child_process'

export function stopVideoProcess(child: ChildProcess) {
  if (!child.pid) return
  if (process.platform === 'win32') {
    const killer = spawn('taskkill', ['/pid', String(child.pid), '/T', '/F'], { windowsHide: true, stdio: 'ignore' })
    killer.once('error', () => child.kill())
  } else {
    try { process.kill(-child.pid, 'SIGKILL') } catch { child.kill('SIGKILL') }
  }
}
export function runVideoProcess(executable: string, args: string[], options: {
  cwd: string; env: NodeJS.ProcessEnv; signal?: AbortSignal; timeoutMs: number;
  onLine?: (line: string) => void;
}): Promise<string> {
  return new Promise((resolve, reject) => {
    if (options.signal?.aborted) { reject(options.signal.reason); return }
    const child = spawn(executable, args, { cwd: options.cwd, env: options.env,
      windowsHide: true, detached: process.platform !== 'win32', stdio: ['ignore', 'pipe', 'pipe'] })
    let output = '', buffer = '', done = false, timedOut = false
    let forceTimer: ReturnType<typeof setTimeout> | undefined
    const finish = (error?: Error) => {
      if (done) return
      done = true; clearTimeout(timer); clearTimeout(forceTimer); options.signal?.removeEventListener('abort', abort)
      error ? reject(error) : resolve(output)
    }
    const abort = () => {
      stopVideoProcess(child)
      forceTimer ??= setTimeout(() => finish(Object.assign(new Error(timedOut ? '制作步骤超时，已停止相关进程，可从断点继续。' : '任务已取消'),
        { code: timedOut ? 'process_timeout' : 'cancelled', retryable: timedOut })), 5000)
    }
    const timer = setTimeout(() => { timedOut = true; abort() }, options.timeoutMs)
    options.signal?.addEventListener('abort', abort, { once: true })
    // Decode across chunks: a Chinese character can be split between pipe reads.
    child.stdout?.setEncoding('utf8')
    child.stderr?.setEncoding('utf8')
    child.stdout?.on('data', (text: string) => {
      output = (output + text).slice(-30000); buffer += text
      let newline: number
      while ((newline = buffer.indexOf('\n')) >= 0) { options.onLine?.(buffer.slice(0, newline)); buffer = buffer.slice(newline + 1) }
      buffer = buffer.slice(-30000)
    })
    child.stderr?.on('data', chunk => { output = (output + chunk.toString()).slice(-30000) })
    child.once('error', error => finish(Object.assign(new Error('无法启动制作组件：' + error.message), { code: 'runtime_missing', retryable: false })))
    child.once('close', code => {
      if (buffer && !done) { options.onLine?.(buffer); buffer = '' }
      if (timedOut) finish(Object.assign(new Error('制作步骤超时，已停止相关进程，可从断点继续。'), { code: 'process_timeout', retryable: true }))
      else if (options.signal?.aborted) finish(Object.assign(new Error('任务已取消'), { code: 'cancelled', retryable: false }))
      else if (code !== 0) finish(new Error(output || '制作进程退出：' + code))
      else finish()
    })
  })
}
