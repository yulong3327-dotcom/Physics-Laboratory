"""Bounded process execution and portable cache integrity helpers."""
from __future__ import annotations
import hashlib
import json
import os
from pathlib import Path
import signal
import subprocess
import threading
import time
import wave

_children = set()
_watching = False
_windows_job = None


def supervise_windows_tree():
    """The kernel kills descendants even if the interpreter cannot run cleanup."""
    global _windows_job
    import ctypes
    from ctypes import wintypes
    class Limits(ctypes.Structure):
        _fields_=[('processTime',ctypes.c_int64),('jobTime',ctypes.c_int64),('flags',wintypes.DWORD),
                  ('minimumWorkingSet',ctypes.c_size_t),('maximumWorkingSet',ctypes.c_size_t),
                  ('activeProcessLimit',wintypes.DWORD),('affinity',ctypes.c_size_t),
                  ('priorityClass',wintypes.DWORD),('schedulingClass',wintypes.DWORD)]
    class IO(ctypes.Structure):
        _fields_=[(name,ctypes.c_uint64) for name in ('readOps','writeOps','otherOps','readBytes','writeBytes','otherBytes')]
    class Extended(ctypes.Structure):
        _fields_=[('basic',Limits),('io',IO),('processMemory',ctypes.c_size_t),('jobMemory',ctypes.c_size_t),
                  ('peakProcessMemory',ctypes.c_size_t),('peakJobMemory',ctypes.c_size_t)]
    kernel=ctypes.WinDLL('kernel32',use_last_error=True)
    kernel.CreateJobObjectW.restype=ctypes.c_void_p
    kernel.SetInformationJobObject.argtypes=[ctypes.c_void_p,ctypes.c_int,ctypes.c_void_p,wintypes.DWORD]
    kernel.GetCurrentProcess.restype=ctypes.c_void_p
    kernel.AssignProcessToJobObject.argtypes=[ctypes.c_void_p,ctypes.c_void_p]
    job=kernel.CreateJobObjectW(None,None);limits=Extended();limits.basic.flags=0x2000
    if not job or not kernel.SetInformationJobObject(job,9,ctypes.byref(limits),ctypes.sizeof(limits)) or not kernel.AssignProcessToJobObject(job,kernel.GetCurrentProcess()):
        raise RuntimeError('无法启动 Windows 子进程保护：'+str(ctypes.get_last_error()))
    _windows_job=job  # Keep this non-inheritable handle for the interpreter lifetime.


def windows_child_pids():
    """Snapshot direct children before launching a separate taskkill helper."""
    import ctypes
    from ctypes import wintypes
    class Entry(ctypes.Structure):
        _fields_=[('dwSize',wintypes.DWORD),('cntUsage',wintypes.DWORD),('th32ProcessID',wintypes.DWORD),
                  ('th32DefaultHeapID',ctypes.c_size_t),('th32ModuleID',wintypes.DWORD),('cntThreads',wintypes.DWORD),
                  ('th32ParentProcessID',wintypes.DWORD),('pcPriClassBase',wintypes.LONG),('dwFlags',wintypes.DWORD),
                  ('szExeFile',wintypes.WCHAR*260)]
    kernel=ctypes.windll.kernel32
    kernel.CreateToolhelp32Snapshot.restype=ctypes.c_void_p
    kernel.Process32FirstW.argtypes=[ctypes.c_void_p,ctypes.POINTER(Entry)]
    kernel.Process32NextW.argtypes=[ctypes.c_void_p,ctypes.POINTER(Entry)]
    kernel.CloseHandle.argtypes=[ctypes.c_void_p]
    snapshot=kernel.CreateToolhelp32Snapshot(2,0)
    if snapshot==ctypes.c_void_p(-1).value:return []
    entry=Entry();entry.dwSize=ctypes.sizeof(Entry);result=[]
    try:
        available=kernel.Process32FirstW(snapshot,ctypes.byref(entry))
        while available:
            if entry.th32ParentProcessID==os.getpid():result.append(entry.th32ProcessID)
            available=kernel.Process32NextW(snapshot,ctypes.byref(entry))
        return result
    finally:kernel.CloseHandle(snapshot)


def watch_parent():
    """Terminate orphan renderers after a hard local service exit."""
    global _watching
    if _watching or not os.environ.get('VIDEO_PARENT_PID'): return
    _watching = True
    parents = {int(os.environ['VIDEO_PARENT_PID']), os.getppid()}
    handles = []
    if os.name == 'nt':
        supervise_windows_tree()
        import ctypes
        kernel = ctypes.windll.kernel32
        kernel.OpenProcess.restype = ctypes.c_void_p
        kernel.WaitForSingleObject.argtypes = [ctypes.c_void_p, ctypes.c_uint]
        kernel.CloseHandle.argtypes = [ctypes.c_void_p]
        handles = [kernel.OpenProcess(0x00100000, False, pid) for pid in parents]
        def alive(): return all(handle and kernel.WaitForSingleObject(handle, 0) == 0x102 for handle in handles)
    else:
        def alive():
            for pid in parents:
                try: os.kill(pid, 0)
                except ProcessLookupError: return False
            return True
    def monitor():
        while alive(): time.sleep(1)
        try:
            if os.name == 'nt':
                # Killing our own tree can kill the taskkill helper before it
                # visits every descendant. Kill child trees, then exit ourselves.
                for pid in windows_child_pids():
                    subprocess.run(['taskkill','/PID',str(pid),'/T','/F'],stdout=subprocess.DEVNULL,stderr=subprocess.DEVNULL,creationflags=subprocess.CREATE_NO_WINDOW,timeout=15)
            else:
                for child in tuple(_children): stop_process_tree(child)
        finally:os._exit(1)
    threading.Thread(target=monitor, daemon=True).start()


class PipelineError(RuntimeError):
    def __init__(self, message, *, code='invalid_content', retryable=False, stage=None, shot_id=None):
        super().__init__(message)
        self.code, self.retryable, self.stage, self.shot_id = code, retryable, stage, shot_id


def cue_position(cue, text):
    phrase = cue.get('phrase')
    occurrence = cue.get('occurrence', 1)
    if not isinstance(occurrence, int) or isinstance(occurrence, bool) or occurrence < 1:
        raise ValueError('同步关键词出现次数必须为正整数')
    if not phrase:
        if occurrence != 1:
            raise ValueError('指定同步词出现次数时必须填写关键词')
        return 0
    cursor = -len(phrase)
    for _ in range(occurrence):
        cursor = text.find(phrase, cursor + len(phrase))
        if cursor < 0:
            raise ValueError(f'找不到同步关键词“{phrase}”第 {occurrence} 次出现')
    return cursor


def stop_process_tree(child):
    if child.poll() is not None:
        return
    if os.name == 'nt':
        try:
            subprocess.run(['taskkill', '/PID', str(child.pid), '/T', '/F'], stdout=subprocess.DEVNULL,
                           stderr=subprocess.DEVNULL, timeout=15, creationflags=subprocess.CREATE_NO_WINDOW)
        finally:
            if child.poll() is None:
                child.kill()
    else:
        try:
            os.killpg(child.pid, signal.SIGKILL)
        except ProcessLookupError:
            pass


def run_process(args, *, timeout=600, **kwargs):
    """Drain logs continuously without retaining an unbounded Manim transcript."""
    settings = dict(stdout=subprocess.PIPE, stderr=subprocess.STDOUT, encoding='utf-8', errors='replace')
    settings.update(kwargs)
    if os.name == 'nt':
        settings.setdefault('creationflags', subprocess.CREATE_NO_WINDOW)
    else:
        settings.setdefault('start_new_session', True)
    child = subprocess.Popen([str(arg) for arg in args], **settings)
    _children.add(child)
    chunks = []
    def drain():
        try:
            while True:
                block = child.stdout.read(4096)
                if not block:
                    break
                chunks.append(block)
                if len(chunks) > 16:
                    del chunks[:-16]
        finally:
            child.stdout.close()
    reader = threading.Thread(target=drain, daemon=True)
    reader.start()
    started = time.monotonic()
    try:
        while child.poll() is None:
            remaining = timeout - (time.monotonic() - started)
            if remaining <= 0:
                stop_process_tree(child)
                raise PipelineError(f'{Path(str(args[0])).name} 执行超时（{timeout:g} 秒），可重试当前阶段。', code='process_timeout', retryable=True)
            try:
                child.wait(timeout=min(15, remaining))
            except subprocess.TimeoutExpired:
                print(json.dumps({'event': 'heartbeat', 'process': Path(str(args[0])).name}), flush=True)
        reader.join(timeout=5)
        output = ''.join(chunks)[-30000:]
        if child.returncode:
            raise PipelineError(f'{Path(str(args[0])).name} 执行失败：\n{output[-12000:]}', code='process_failed')
        return output
    finally:
        if child.poll() is None:
            stop_process_tree(child)
        try:
            child.wait(timeout=5)
        except subprocess.TimeoutExpired:
            child.kill()
            child.wait(timeout=5)
        reader.join(timeout=5)
        _children.discard(child)


def wav_duration(path):
    with wave.open(str(path), 'rb') as audio:
        if (audio.getnchannels(), audio.getsampwidth(), audio.getframerate()) != (1, 2, 24000):
            raise ValueError('配音格式必须为 24 kHz、单声道、16-bit PCM')
        frames = audio.getnframes()
        if frames <= 0 or len(audio.readframes(frames)) != frames * 2:
            raise ValueError('配音缓存不完整')
        return frames / 24000


def valid_wav(path, expected=None):
    try:
        duration = wav_duration(path)
        return expected is None or abs(duration - expected) <= 1 / 24000 + 1e-8
    except (OSError, EOFError, ValueError, wave.Error):
        return False


def file_hash(path):
    digest = hashlib.sha256()
    with Path(path).open('rb') as stream:
        for block in iter(lambda: stream.read(1024 * 1024), b''):
            digest.update(block)
    return digest.hexdigest()


def write_integrity(directory, names, save, marker='complete.json'):
    save(Path(directory) / marker, {'version': 1, 'files': {name: file_hash(Path(directory) / name) for name in names}})


def check_integrity(directory, names, marker='complete.json'):
    try:
        marker = json.loads((Path(directory) / marker).read_text(encoding='utf-8'))
        return all(marker['files'].get(name) == file_hash(Path(directory) / name) for name in names)
    except (OSError, ValueError, KeyError, TypeError):
        return False
