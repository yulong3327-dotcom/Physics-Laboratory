"""Azure narration, exact word cues, Manim shots, and FFmpeg assembly.

This entry point only consumes declarative project data. It never executes model code.
"""
from __future__ import annotations
import argparse
import asyncio
import time
import html
import inspect
import urllib.request
import urllib.error
import urllib.parse
import hashlib
import importlib.util
import json
import math
import os
from pathlib import Path
import re
import shutil
import subprocess
import sys
import tempfile
import wave
import threading
import queue
from datetime import datetime, timezone
from contextlib import nullcontext
from video_speech import SpeechRequestControl, prepare_speech_window
from email.utils import parsedate_to_datetime
from video_runtime import PipelineError, cue_position, run_process, valid_wav, wav_duration, write_integrity, check_integrity, file_hash, watch_parent

# Preflight imports these helpers while this file is running as the CLI.
# Share telemetry and runtime state instead of importing a second module copy.
if __name__ == '__main__':
    sys.modules['pipeline'] = sys.modules[__name__]

_LOCAL_FFMPEG = Path(__file__).resolve().parent.parent / '.video-tools' / 'ffmpeg.exe'
FFMPEG = os.environ.get('VIDEO_FFMPEG') or (str(_LOCAL_FFMPEG) if _LOCAL_FFMPEG.exists() else 'ffmpeg')
DEFAULT_PRONUNCIATIONS = {'I方': 'I 的平方', 'U方': 'U 的平方'}
TELEMETRY = {'retries': 0, 'phases': []}
_TTS_REQUEST = threading.local()
_phase_started = time.monotonic()
_phase_key = None


def telemetry():
    values = [dict(item) for item in TELEMETRY['phases']]
    if values: values[-1]['seconds'] = time.monotonic() - _phase_started
    return {'retries': TELEMETRY['retries'], 'phases': values}


def retry_delay(headers, fallback):
    value = headers.get('Retry-After') if headers else None
    if value is None: return fallback
    try: seconds = float(value)
    except (ValueError, TypeError):
        try: seconds = parsedate_to_datetime(value).timestamp() - time.time()
        except (ValueError, TypeError, OverflowError): return fallback
    return max(0, seconds) if math.isfinite(seconds) else fallback


def speech_retry(provider, attempt, delay):
    TELEMETRY['retries'] += 1
    print(json.dumps({'event':'speech_retry','provider':provider,'attempt':attempt,'maxAttempts':3,'retryAfterSeconds':delay}),flush=True)
    control = getattr(_TTS_REQUEST, 'control', None) if provider == 'fish' else None
    if control is not None:
        control.pause(delay)
    else:
        time.sleep(delay)


def load(path):
    return json.loads(Path(path).read_text(encoding='utf-8-sig'))


def save(path, value):
    path = Path(path)
    path.parent.mkdir(parents=True, exist_ok=True)
    temporary = path.with_suffix(path.suffix + '.tmp')
    with temporary.open('w', encoding='utf-8') as stream:
        json.dump(value, stream, ensure_ascii=False, indent=2); stream.flush(); os.fsync(stream.fileno())
    temporary.replace(path)


def emit(progress, stage, cached=0, **details):
    global _phase_started, _phase_key
    key=(details.get('phase'),details.get('shotId'))
    if details.get('phase') and key!=_phase_key:
        if TELEMETRY['phases']: TELEMETRY['phases'][-1]['seconds']=time.monotonic()-_phase_started
        _phase_started=time.monotonic();_phase_key=key
        TELEMETRY['phases'].append({'phase':key[0],'shotId':key[1],'seconds':0})
    print(json.dumps({'event': 'progress', 'progress': round(progress, 1), 'stage': stage, 'cachedShots': cached, **details}, ensure_ascii=False), flush=True)


def run(args, **kwargs):
    return run_process(args, **kwargs)


def probe():
    executable = shutil.which(FFMPEG) or (FFMPEG if Path(FFMPEG).is_file() else None)
    latex = shutil.which('xelatex') and shutil.which('dvisvgm')
    messages = []
    if not latex:
        messages.append('MathTex 需要 XeLaTeX、unicode-math、xeCJK 与 dvisvgm；运行预检可确认实际字体公式编译。')
    if not executable:
        messages.append('未找到 FFmpeg；可通过 VIDEO_FFMPEG 指定可执行文件。')
    return {'python': True, 'manim': importlib.util.find_spec('manim') is not None,
            'speech': importlib.util.find_spec('azure') is not None and importlib.util.find_spec('azure.cognitiveservices') is not None and importlib.util.find_spec('azure.cognitiveservices.speech') is not None,
            'edge': importlib.util.find_spec('edge_tts') is not None,
            'ffmpeg': bool(executable), 'latex': bool(latex), 'messages': messages}


class PronunciationOrigins(list):
    """Per spoken character source ranges; list values remain the legacy start map."""
    def __init__(self):
        super().__init__()
        self.ends = []


PRONUNCIATION_VERSION = 'physics-zh-v3'
_SPEECH_UNITS = {'Ω': '欧姆', 'Ω': '欧姆', '欧': '欧姆', 'A': '安培', '安': '安培',
                 'V': '伏特', '伏': '伏特', 'W': '瓦特', '瓦': '瓦特'}
_SPEECH_PREFIXES = {'m': '毫', 'k': '千', 'M': '兆', 'μ': '微', 'µ': '微', 'u': '微'}
_SPEECH_SUPERSCRIPTS = str.maketrans('⁰¹²³⁴⁵⁶⁷⁸⁹⁻⁺', '0123456789-+')
_SPEECH_SUBSCRIPTS = str.maketrans('₀₁₂₃₄₅₆₇₈₉₋₊', '0123456789-+')
_SPEECH_COMMANDS = {'Omega': '欧姆', 'times': '乘', 'cdot': '乘', 'div': '除以',
    'colon': '比', 'ratio': '比', 'approx': '约等于', 'ne': '不等于', 'neq': '不等于',
    'le': '小于或等于', 'leq': '小于或等于', 'ge': '大于或等于', 'geq': '大于或等于',
    'propto': '正比于', 'Rightarrow': '所以', 'Longrightarrow': '所以', 'rightarrow': '得到',
    'longrightarrow': '得到', 'to': '得到', 'infty': '无穷大', 'alpha': '阿尔法',
    'beta': '贝塔', 'gamma': '伽马', 'theta': '西塔', 'rho': '柔', 'pi': '派',
    'eta': '伊塔', 'Delta': '德尔塔', 'delta': '德尔塔', 'mu': '缪', 'pm': '正负'}


def _index_name(value):
    if value.startswith(('-', '+')):
        return ('负' if value[0]=='-' else '正')+_index_name(value[1:])
    if re.fullmatch(r'\d', value):
        return '零一二三四五六七八九'[int(value)]
    return value.replace('-', '负').replace('+', '正')


def pronunciation_text(text, dictionary=None):
    """Read physics notation in Chinese without editing source or subtitle text.

    Fractions use numerator / denominator order ("除以"). Keeping that order
    lets source keywords retain real word times, including nested TeX groups.
    """
    dictionary = DEFAULT_PRONUNCIATIONS if dictionary is None else dictionary
    keys = sorted((key for key in dictionary if key), key=len, reverse=True)
    output, origins = [], PronunciationOrigins()

    def emit(value, first, stop):
        if not value:
            return
        first = max(0, min(first, max(0, len(text)-1)))
        stop = max(first+1, min(stop, len(text)))
        span = stop-first
        for j, char in enumerate(value):
            output.append(char)
            origins.append(first+min(span-1, j*span//len(value)))
            origins.ends.append(first+min(span, max(1, math.ceil((j+1)*span/len(value)))))

    def group(at, limit):
        while at < limit and text[at].isspace():
            at += 1
        if at >= limit:
            raise ValueError('公式朗读缺少参数，请检查分式、上下标或发音词典。')
        if text[at] != '{':
            return at, at+1, at+1
        depth, end = 1, at+1
        while end < limit and depth:
            if text[end] == '{': depth += 1
            elif text[end] == '}': depth -= 1
            end += 1
        if depth:
            raise ValueError('公式朗读的大括号不配对，请检查公式或发音词典。')
        return at+1, end-1, end

    def number_before(at):
        return bool(re.search(r'(?:\d|[零一二三四五六七八九十百千万两])\s*$', text[:at]))

    def scan(first, limit, force_units=False):
        i, previous_atom = first, False
        while i < limit:
            key = next((k for k in keys if text.startswith(k, i) and i+len(k) <= limit), None)
            if key:
                emit(dictionary[key], i, i+len(key)); i += len(key)
                previous_atom=bool(re.fullmatch(r'[A-Za-z0-9_^{}⁰¹²³⁴⁵⁶⁷⁸⁹]+(?:方)?',key));continue
            char = text[i]
            if char == '\\':
                match = re.match(r'\\([A-Za-z]+|.)', text[i:limit], re.S)
                if not match:
                    i += 1; continue
                command, next_at = match[1], i+len(match[0])
                if command in ['frac', 'dfrac', 'tfrac']:
                    if previous_atom:emit('乘',max(first,i-1),i)
                    a,b,next_at = group(next_at,limit); c,d,stop = group(next_at,limit)
                    before = len(origins)
                    numerator_grouped = bool(re.search(r'[+\-=]', text[a:b]))
                    if numerator_grouped: emit('括号',i,a)
                    scan(a,b)
                    if numerator_grouped: emit('括号',max(a,b-1),b)
                    if len(origins)>before: origins[before]=i
                    emit('除以', b,c)
                    grouped = bool(re.search(r'[+\-=]', text[c:d]))
                    if grouped: emit('括号',c,c+1)
                    scan(c,d)
                    if grouped: emit('括号',max(c,d-1),d)
                    if len(origins)>before: origins.ends[-1]=stop
                    i=stop; previous_atom=True; continue
                if command in ['mathrm','textrm','text','operatorname','mathbf','mathit','mathsf']:
                    a,b,stop=group(next_at,limit); before=len(origins)
                    scan(a,b,force_units=command in ['mathrm','textrm','text'])
                    if len(origins)>before: origins[before]=i; origins.ends[-1]=stop
                    i=stop; previous_atom=True; continue
                if command in ['sqrt']:
                    if previous_atom:emit('乘',max(first,i-1),i)
                    emit('根号',i,next_at);a,b,stop=group(next_at,limit);scan(a,b)
                    if origins:origins.ends[-1]=stop
                    i=stop;previous_atom=True;continue
                if command=='mu':
                    suffix=re.match(r'\s*([AVW])',text[next_at:limit])
                    if suffix and (force_units or number_before(i)):
                        stop=next_at+len(suffix[0]);emit('微'+_SPEECH_UNITS[suffix[1]],i,stop);i=stop;previous_atom=False;continue
                if command in ['begin','end']:
                    _,_,i=group(next_at,limit);continue
                if command in ['left','right','quad','qquad',',',';','!',':',' ','(',')','[',']','$']:
                    if command in ['quad','qquad',',',';',' ','!']:emit(' ',i,next_at)
                    i=next_at;continue
                if command == '\\':emit('，',i,next_at);i=next_at;previous_atom=False;continue
                if command in _SPEECH_COMMANDS:
                    emit(_SPEECH_COMMANDS[command],i,next_at);i=next_at;previous_atom=command in ['Omega','infty'];continue
                raise ValueError('公式朗读暂不支持 LaTeX 命令 \\'+command+'，请在发音词典中指定读法。')
            if char in ['^','_']:
                unbraced=re.match(r'[+-]?\d+|[A-Za-z]',text[i+1:limit])
                if unbraced:a,b,stop=i+1,i+1+len(unbraced[0]),i+1+len(unbraced[0])
                else:a,b,stop=group(i+1,limit)
                value=text[a:b]
                if char=='_' and '\\' in value:
                    emit(' ',i,a);scan(a,b);origins.ends[-1]=stop;i=stop;previous_atom=True;continue
                if char=='_':spoken=' '+_index_name(value)
                elif value=='2':spoken='的平方'
                elif value=='3':spoken='的立方'
                else:spoken='的'+_index_name(value)+'次方'
                emit(spoken,i,stop);i=stop;previous_atom=True;continue
            if char in '⁰¹²³⁴⁵⁶⁷⁸⁹⁻⁺₀₁₂₃₄₅₆₇₈₉₋₊':
                sub=char in '₀₁₂₃₄₅₆₇₈₉₋₊';alphabet='₀₁₂₃₄₅₆₇₈₉₋₊' if sub else '⁰¹²³⁴⁵⁶⁷⁸⁹⁻⁺'
                stop=i+1
                while stop<limit and text[stop] in alphabet:stop+=1
                value=text[i:stop].translate(_SPEECH_SUBSCRIPTS if sub else _SPEECH_SUPERSCRIPTS)
                spoken=(' '+_index_name(value)) if sub else ('的平方' if value=='2' else '的立方' if value=='3' else '的'+_index_name(value)+'次方')
                emit(spoken,i,stop);i=stop;previous_atom=True;continue
            unit=re.match(r'([mkMμµu]?)([ΩΩAVW欧安伏瓦])',text[i:limit])
            if unit and (force_units or unit[2] in ['Ω','Ω'] or number_before(i) or re.search(r'(?:单位|量纲)[^，。！？；]{0,24}$',text[:i])):
                stop=i+len(unit[0])
                # A symbol inside an English word (12WIFI) is not a unit.
                if stop==limit or not text[stop].isascii() or not text[stop].isalpha():
                    already_full=unit[2] in '欧安伏瓦' and text.startswith({'欧':'姆','安':'培','伏':'特','瓦':'特'}[unit[2]],stop)
                    if not already_full:
                        emit(_SPEECH_PREFIXES.get(unit[1],'')+_SPEECH_UNITS[unit[2]],i,stop);i=stop;previous_atom=False;continue
            if char.isascii() and char.isalpha():
                word=re.match(r'[A-Za-z]+',text[i:limit])[0]
                # Only adjacent conventional physics variables imply multiplication;
                # preserve prose abbreviations such as AI, CPU and WiFi.
                if len(word)>1 and (len(word)>4 or any(c not in 'PRIUEQ' for c in word)):
                    emit(word,i,i+len(word));i+=len(word);previous_atom=False;continue
                if previous_atom:emit('乘',max(first,i-1),i)
                emit(char,i,i+1);i+=1
                index=re.match(r'\d+',text[i:limit])
                if index:
                    emit(' '+_index_name(index[0]),i,i+len(index[0]));i+=len(index[0])
                previous_atom=True;continue
            if char.isdigit():
                number=re.match(r'\d+(?:\.\d+)?',text[i:limit])[0]
                if previous_atom:emit('乘',max(first,i-1),i)
                emit(number,i,i+len(number));i+=len(number);previous_atom=True;continue
            if char in '=:：+−-×⋅·÷/<>≤≥≠≈∝→⇒':
                if char in ':：':
                    left=text[:i].rstrip();right=text[i+1:limit].lstrip()
                    ratio=bool(left and right and re.search(r'[\dA-Za-z₀-₉⁰-⁹})]$',left) and re.match(r'[\dA-Za-z\\({]',right))
                    spoken='比' if ratio else char
                else:spoken={'=':'等于','+':'加','−':'减','-':'减','×':'乘','⋅':'乘','·':'乘','÷':'除以','/':'除以','<':'小于','>':'大于','≤':'小于或等于','≥':'大于或等于','≠':'不等于','≈':'约等于','∝':'正比于','→':'得到','⇒':'所以'}[char]
                emit(spoken,i,i+1);i+=1;previous_atom=False;continue
            if char in '${}':i+=1;continue
            if char in '（(':
                emit('括号',i,i+1);i+=1;previous_atom=False;continue
            if char in '）)':
                emit('括号',i,i+1);i+=1;previous_atom=True;continue
            emit(char,i,i+1);i+=1
            if not char.isspace():previous_atom=False
    scan(0,len(text))
    # One whitespace character is sufficient to separate Latin names. Preserve
    # its complete source range instead of altering offsets after normalization.
    compact, mapped=[],PronunciationOrigins()
    for char,start,stop in zip(output,origins,origins.ends):
        if char.isspace() and compact and compact[-1]==' ':
            mapped.ends[-1]=max(mapped.ends[-1],stop);continue
        compact.append(' ' if char.isspace() else char);mapped.append(start);mapped.ends.append(stop)
    return ''.join(compact), mapped


def source_boundary(text, origins, first, stop, offset, duration):
    """Map actual provider word events to source spans, including stripped TeX."""
    if first<0 or first>=len(origins):return None
    stop=max(first+1,min(stop,len(origins)))
    start=min(origins[first:stop])
    ends=getattr(origins,'ends',[value+1 for value in origins])
    end=max(ends[first:stop])
    return {'text':text[start:end],'offset':offset,'duration':duration,'textOffset':start,'wordLength':end-start}


def spoken_segment(spoken, origins, first, stop):
    """Slice the already normalized utterance; never reparse a cut TeX command."""
    ends=getattr(origins,'ends',[value+1 for value in origins])
    a=next((i for i,value in enumerate(ends) if value>first),len(origins))
    b=next((i for i,value in enumerate(ends) if value>stop),len(origins))
    return spoken[a:b]


def pronunciation_metadata(spoken, origins):
    return {'spokenText':spoken,'pronunciationVersion':PRONUNCIATION_VERSION,
            'spokenTextOffsets':list(origins),'spokenTextEnds':origins.ends}


def utf16_to_python(text, offset):
    return len(text.encode('utf-16-le')[:offset * 2].decode('utf-16-le', errors='ignore'))


def resolve_cue(cue, text, boundaries, duration):
    time = 0.0
    phrase = cue.get('phrase')
    if phrase:
        at = cue_position(cue, text)
        match = next((b for b in boundaries if b['textOffset'] <= at < b['textOffset'] + b['wordLength']), None)
        if match is None:
            match = next((b for b in boundaries if at <= b['textOffset'] < at + len(phrase)), None)
        if match is None:
            raise ValueError(f'配音未返回关键词“{phrase}”的时间事件，请检查发音或同步点。')
        time = match['offset']
    time += cue.get('offset', 0)
    if not math.isfinite(time) or time < 0 or time > duration:
        raise ValueError('动画同步点超出对应台词音频')
    return time


def make_subtitles(text, boundaries, duration, max_chars=30):
    """Keep whole measured words together when wrapping original subtitle text."""
    pieces = []
    start = 0
    for match in re.finditer(r'[，。！？；：,!?;:]+|$', text):
        end = match.end()
        if end <= start:
            continue
        at = start
        while at < end:
            stop = min(end, at + max_chars)
            crossing = next((b for b in boundaries if b['textOffset'] < stop < b['textOffset'] + b['wordLength']), None)
            if crossing:
                stop = crossing['textOffset'] if crossing['textOffset'] > at else min(end, crossing['textOffset'] + crossing['wordLength'])
            if pieces and not any(char.isalnum() for char in text[at:stop]):
                pieces[-1]['text'] += text[at:stop]; at = stop; continue
            first = next((b for b in boundaries if b['textOffset'] + b['wordLength'] > at), None)
            last = next((b for b in boundaries if b['textOffset'] >= stop), None)
            if first is None:
                # Unvoiced final punctuation belongs to the preceding caption.
                if pieces and not any(char.isalnum() for char in text[at:stop]):
                    pieces[-1]['text'] += text[at:stop]; at = stop; continue
                raise ValueError('配音时间事件不完整，不能可靠生成字幕。')
            pieces.append({'text': text[at:stop], 'start': first['offset'], 'end': last['offset'] if last else duration})
            at = stop
        start = end
    # A word-boundary provider can emit two adjacent punctuation fragments
    # with the same timestamp (for example the two sides of ``6:2``).
    # Keep the source text intact while coalescing those captions so the
    # validation timeline remains strictly ordered.
    merged = []
    for piece in (p for p in pieces if p['end'] > p['start']):
        if merged and piece['start'] < merged[-1]['end']:
            merged[-1]['text'] += piece['text']
            merged[-1]['end'] = max(merged[-1]['end'], piece['end'])
        else:
            merged.append(piece)
    return merged

def _speech_azure(utterance, speaker, directory, cache_dir, pronunciations=None):
    import azure.cognitiveservices.speech as sdk
    text = utterance['text']
    dictionary = {**DEFAULT_PRONUNCIATIONS, **{x['text']: x['spoken'] for x in pronunciations or []}}
    spoken, origins = pronunciation_text(text, dictionary)
    key = hashlib.sha256(json.dumps({'text': text, 'spoken': spoken, 'voice': speaker['voice'], 'format': 'pcm24k-v3', 'pronunciationVersion': PRONUNCIATION_VERSION, 'sourceOffsets':list(origins), 'sourceEnds':origins.ends}, ensure_ascii=False, sort_keys=True).encode()).hexdigest()
    shared = Path(cache_dir) / 'speech' / key
    shared.mkdir(parents=True, exist_ok=True)
    meta_file, wav_file = shared / 'speech.json', shared / 'speech.wav'
    if not speech_cache_valid(wav_file, meta_file):
        key_value, region = os.environ.get('AZURE_SPEECH_KEY'), os.environ.get('AZURE_SPEECH_REGION')
        if not key_value or not region:
            raise RuntimeError('Azure 配音未配置：请设置 AZURE_SPEECH_KEY 与 AZURE_SPEECH_REGION。')
        config = sdk.SpeechConfig(subscription=key_value, region=region)
        config.speech_synthesis_voice_name = speaker['voice']
        config.set_speech_synthesis_output_format(sdk.SpeechSynthesisOutputFormat.Riff24Khz16BitMonoPcm)
        config.set_property(sdk.PropertyId.SpeechServiceResponse_RequestWordBoundary, 'true')
        temporary = shared / 'speech.pending.wav'
        synth = sdk.SpeechSynthesizer(speech_config=config, audio_config=sdk.audio.AudioOutputConfig(filename=str(temporary)))
        boundaries = []
        def boundary(event):
            spoken_start = utf16_to_python(spoken, event.text_offset)
            spoken_end = utf16_to_python(spoken, event.text_offset + event.word_length)
            if spoken_start >= len(origins):
                return
            mapped = source_boundary(text, origins, spoken_start, spoken_end, event.audio_offset / 10_000_000, event.duration.total_seconds())
            if mapped: boundaries.append(mapped)
        synth.synthesis_word_boundary.connect(boundary)
        completed = queue.Queue(maxsize=1)
        def await_synthesis():
            try:
                completed.put((True, synth.speak_text_async(spoken).get()))
            except Exception as error:
                completed.put((False, error))
        threading.Thread(target=await_synthesis, daemon=True).start()
        try:
            okay, result = completed.get(timeout=180)
        except queue.Empty:
            synth.stop_speaking_async()
            raise PipelineError('Azure 配音超时，已保留当前音色，请稍后重试。', code='speech_timeout', retryable=True) from None
        if not okay:
            raise PipelineError('Azure 配音连接失败，请稍后重试。', code='speech_network', retryable=True) from result
        if result.reason != sdk.ResultReason.SynthesizingAudioCompleted:
            details = sdk.SpeechSynthesisCancellationDetails.from_result(result)
            code=str(details.error_code)
            retryable=any(name in code for name in ['ConnectionFailure','ServiceTimeout','TooManyRequests','ServiceUnavailable','ServiceError'])
            raise PipelineError(f'Azure 配音失败：{details.reason}；{details.error_details}',code='speech_network' if retryable else 'speech_configuration',retryable=retryable)
        with wave.open(str(temporary), 'rb') as wav:
            duration = wav.getnframes() / wav.getframerate()
        if not boundaries or duration <= 0:
            raise RuntimeError('Azure 未返回有效音频或逐词时间事件；不能生成同步视频。')
        boundaries.sort(key=lambda b: (b['offset'], b['textOffset']))
        temporary.replace(wav_file)
        save(meta_file, {'text': text, 'voice': speaker['voice'], **pronunciation_metadata(spoken, origins), 'duration': duration, 'boundaries': boundaries, 'alignment': 'word_boundaries', 'speechSource': 'azure'})
        write_integrity(shared, ['speech.wav','speech.json'], save)
    metadata = load(meta_file)
    metadata['cacheKey'] = key
    directory = Path(directory); directory.mkdir(parents=True, exist_ok=True)
    destination = directory / f"{utterance['id']}.wav"
    shutil.copy2(wav_file, destination)
    save(directory / f"{utterance['id']}.json", metadata)
    return {**metadata, 'audio': str(destination), 'id': utterance['id'], 'speakerId': speaker['id']}


def speech_azure(utterance, speaker, directory, cache_dir, pronunciations=None):
    for attempt in range(3):
        try:return _speech_azure(utterance,speaker,directory,cache_dir,pronunciations)
        except PipelineError as error:
            # An SDK deadline pauses this process; it must exit before another
            # process can reuse the SDK output path.
            if not error.retryable or error.code=='speech_timeout' or attempt==2:raise
            speech_retry('azure',attempt+2,1+attempt*2)


class NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        return None


def origin(url):
    parsed = urllib.parse.urlparse(url)
    if parsed.scheme not in ['http', 'https'] or not parsed.hostname or parsed.username or parsed.password:
        raise ValueError('配音服务或音频 URL 无效')
    return parsed.scheme.lower(), parsed.hostname.lower(), parsed.port or (443 if parsed.scheme == 'https' else 80)


def speech_cache_valid(wav_file, meta_file):
    try:
        metadata = load(meta_file)
        return check_integrity(Path(wav_file).parent, ['speech.wav','speech.json']) and valid_wav(wav_file, metadata['duration'])
    except (OSError, ValueError, KeyError, TypeError):
        return False


def fetch_audio(url, body=None, headers=None):
    origin(url)
    control = getattr(_TTS_REQUEST, 'control', None)
    for attempt in range(3):
        waiting = 1 + attempt * 2
        request = urllib.request.Request(url, data=body, headers=headers or {})
        with control.request() if control else nullcontext():
            try:
                with urllib.request.build_opener(NoRedirect).open(request, timeout=180) as response:
                    payload = response.read(32 * 1024 * 1024 + 1)
                    if len(payload) > 32 * 1024 * 1024:
                        raise PipelineError('单段配音响应超过 32 MB', code='speech_response')
                    return payload, response.headers.get('Content-Type', '')
            except urllib.error.HTTPError as error:
                retryable = error.code == 429 or 500 <= error.code <= 599
                waiting = retry_delay(error.headers, waiting)
                message = f'配音服务返回 HTTP {error.code}'
                if error.code in [301, 302, 303, 307, 308, 401, 403]:
                    message = f'配音服务需要登录或授权，HTTP {error.code}；请检查当前服务端令牌。'
            except (urllib.error.URLError, TimeoutError, ConnectionError, OSError) as error:
                retryable = True
                message = '配音网络连接中断或超时'
            if control is not None:
                # Publish throttling/failure before releasing this request's slot.
                # A sibling CDN fetch or retry cannot slip past the new deadline.
                if retryable and attempt < 2:
                    control.backoff(waiting)
                else:
                    control.stop()
        if not retryable or attempt == 2:
            raise PipelineError(message + f'（已尝试 {attempt+1} 次，保留当前音色）。',
                                code='speech_network' if retryable else 'speech_configuration', retryable=retryable) from None
        speech_retry('fish',attempt+2,waiting)


def fish_generate(spoken, voice, options, path):
    base = os.environ.get('FISH_TTS_BASE_URL', '').strip()
    api_key = os.environ.get('FISH_API_KEY', '').strip() or os.environ.get('FISH_AUDIO_API_KEY', '').strip()
    model = options.get('model') or 's1'
    headers = {'Content-Type': 'application/json'}
    payload = {'text': spoken, 'reference_id': voice, 'format': 'mp3', 'chunk_length': options.get('chunkLength', 200),
               'normalize': True, 'latency': 'normal'}
    if base:
        parsed = urllib.parse.urlparse(base)
        endpoint = urllib.parse.urlunparse((parsed.scheme, parsed.netloc, '/api/tts/generate', '', '', ''))
        origin(endpoint)
        token = os.environ.get('FISH_TTS_TOKEN', '').strip()
        if token:
            headers['Authorization'] = 'Bearer ' + token
        payload['model'] = model
    elif api_key:
        # Fish official API accepts JSON for reference_id. model is a request header.
        # https://docs.fish.audio/api-reference/endpoint/openapi-v1/text-to-speech.md
        endpoint = 'https://api.fish.audio/v1/tts'
        headers.update({'Authorization': 'Bearer ' + api_key, 'model': model})
    else:
        raise RuntimeError('Fish 配音需要 FISH_TTS_BASE_URL 或 FISH_API_KEY（兼容 FISH_AUDIO_API_KEY）。')
    data, content_type = fetch_audio(endpoint, json.dumps(payload, ensure_ascii=False).encode('utf-8'), headers)
    if 'json' in content_type or data.lstrip().startswith(b'{'):
        result = json.loads(data)
        if not isinstance(result.get('url'), str):
            raise RuntimeError('Fish 代理没有返回音频或有效的音频 URL。')
        location = urllib.parse.urljoin(endpoint, result['url'])
        # A returned CDN URL may be fetched, but the service credential stays at its own origin.
        download_headers = {'Authorization': headers['Authorization']} if origin(location) == origin(endpoint) and 'Authorization' in headers else {}
        data, content_type = fetch_audio(location, headers=download_headers)
    if not data or 'text/html' in content_type or 'json' in content_type:
        raise RuntimeError('Fish 返回的内容不是有效音频，请检查平台登录或接口。')
    Path(path).write_bytes(data)


async def edge_generate_async(spoken, voice, path):
    import edge_tts
    if not re.fullmatch(r'[a-z]{2}-[A-Z]{2}-[A-Za-z]+Neural', voice):
        raise ValueError('Edge 需要 zh-CN-YunyangNeural 等音色，不能使用 Fish 角色 ID。')
    kwargs = {'text': spoken, 'voice': voice}
    if 'boundary' in inspect.signature(edge_tts.Communicate).parameters:
        kwargs['boundary'] = 'WordBoundary'
    proxy = os.environ.get('EDGE_TTS_PROXY') or urllib.request.getproxies().get('https')
    if proxy:
        kwargs['proxy'] = proxy
    communicator = edge_tts.Communicate(**kwargs)
    records = []
    with Path(path).open('wb') as audio:
        async for chunk in communicator.stream():
            if chunk['type'] == 'audio':
                audio.write(chunk['data'])
            elif chunk['type'] in ['WordBoundary', 'SentenceBoundary']:
                records.append({'kind': chunk['type'], 'text': html.unescape(chunk['text']), 'offset': chunk['offset']/10_000_000, 'duration': chunk['duration']/10_000_000})
    if not Path(path).stat().st_size:
        raise RuntimeError('Edge 没有返回配音音频')
    return records


def edge_generate(spoken, voice, path):
    import aiohttp
    for attempt in range(3):
        try:
            return asyncio.run(asyncio.wait_for(edge_generate_async(spoken, voice, path), timeout=180))
        except Exception as error:
            transient = isinstance(error, (aiohttp.ClientError, asyncio.TimeoutError, TimeoutError, ConnectionError)) or error.__class__.__name__ in ['NoAudioReceived', 'ClientConnectionError', 'ClientConnectorError', 'ServerDisconnectedError', 'WSServerHandshakeError', 'TimeoutError', 'ConnectionResetError']
            status=getattr(error,'status',None)
            if status:transient=status in [408,429] or status>=500
            if not transient or attempt == 2:
                raise PipelineError(f'Edge 配音失败（已尝试 {attempt+1} 次）：{error.__class__.__name__}。请检查网络或稍后重试。', code='speech_network', retryable=transient) from None
            speech_retry('edge',attempt+2,retry_delay(getattr(error,'headers',None),1+attempt))


def normalize_audio(source, target):
    target = Path(target)
    pending = target.with_name(target.stem + '.pending.wav')
    run([FFMPEG, '-y', '-i', source, '-ac', '1', '-ar', '24000', '-c:a', 'pcm_s16le', pending], timeout=120)
    wav_duration(pending)
    pending.replace(target)
    with wave.open(str(target), 'rb') as audio:
        duration = audio.getnframes() / audio.getframerate()
    if duration <= 0:
        raise RuntimeError('配音音频时长无效')
    return duration


def measured_segments(text, cues, max_chars=32):
    """Every split is a real synthesis request. Character positions are not timing estimates."""
    positions = {0, len(text)}
    for cue in cues:
        if cue.get('phrase'):
            at = cue_position(cue, text)
            positions.add(at)
    positions.update(m.end() for m in re.finditer(r'[，。！？；：,!?;:]+', text))
    base = sorted(positions)
    for start, end in zip(base, base[1:]):
        positions.update(range(start + max_chars, end, max_chars))
    spans = []
    ordered = sorted(positions)
    for start, end in zip(ordered, ordered[1:]):
        if start < end:
            spans.append({'start': start, 'end': end, 'text': text[start:end]})
    return spans


def measured_cue(cue, text, segments, duration):
    at = cue_position(cue, text)
    segment = next((s for s in segments if s['textOffset'] == at), None)
    if segment is None:
        raise ValueError('关键词必须位于真实合成片段的起点，不能估计片段内部时间。')
    time = segment['offset'] + cue.get('offset', 0)
    if time < 0 or time > duration:
        raise ValueError('动画同步点超出台词音频')
    return time


def speech(utterance, speaker, directory, cache_dir, pronunciations=None, options=None, cues=None):
    options = options or {'provider': 'fish', 'model': 's1', 'chunkLength': 200, 'pauseSeconds': .5}
    provider = options['provider']; cues = cues or []
    if provider not in ['azure','fish','edge']:raise ValueError('不支持的语音服务：'+str(provider))
    if provider == 'azure':
        return speech_azure(utterance, speaker, directory, cache_dir, pronunciations)
    text = utterance['text']
    dictionary = {**DEFAULT_PRONUNCIATIONS, **{x['text']: x['spoken'] for x in pronunciations or []}}
    spoken, origins = pronunciation_text(text, dictionary)
    split = measured_segments(text, cues)
    cache_input = {'provider': provider, 'model': options['model'], 'voice': speaker['voice'], 'chunkLength': options['chunkLength'], 'text': text,
                   'spoken': spoken, 'segments': split, 'format': 'pcm24k-measured-v2', 'pronunciationVersion': PRONUNCIATION_VERSION, 'sourceOffsets':list(origins), 'sourceEnds':origins.ends, 'endpoint': os.environ.get('FISH_TTS_BASE_URL') if provider == 'fish' else None}
    if provider == 'fish':
        cache_input.update({'normalize': True, 'latency': 'normal'})
    key = hashlib.sha256(json.dumps(cache_input, ensure_ascii=False, sort_keys=True).encode()).hexdigest()
    shared = Path(cache_dir) / 'speech' / key; shared.mkdir(parents=True, exist_ok=True)
    wav_file, meta_file = shared / 'speech.wav', shared / 'speech.json'
    if not speech_cache_valid(wav_file, meta_file):
        boundaries, duration = [], 0
        if provider == 'edge':
            records = edge_generate(spoken, speaker['voice'], shared / 'source.mp3')
            duration = normalize_audio(shared / 'source.mp3', shared / 'candidate.wav')
            cursor = 0
            for record in records:
                if record['kind'] != 'WordBoundary':
                    continue
                position = spoken.find(record['text'], cursor)
                if position < 0 or position >= len(origins):
                    boundaries = []; break
                mapped = source_boundary(text, origins, position, position+len(record['text']), record['offset'], record['duration'])
                if mapped: boundaries.append(mapped)
                cursor = position + len(record['text'])
            try:
                if not boundaries:
                    raise ValueError('没有逐词事件')
                for cue in cues:
                    resolve_cue(cue, text, boundaries, duration)
                make_subtitles(text, boundaries, duration)
            except ValueError:
                boundaries = []
        if boundaries:
            (shared / 'candidate.wav').replace(wav_file)
            metadata = {'text': text, **pronunciation_metadata(spoken, origins), 'voice': speaker['voice'], 'duration': duration, 'boundaries': boundaries, 'alignment': 'word_boundaries', 'speechSource': provider, 'cacheKey': key}
        else:
            segments, offset = [], 0.0
            pending_wav = shared / 'speech.pending.wav'
            # A provider request is independent for each measured fragment.  Keep a
            # very small, configurable window: this cuts wall time without creating
            # an unbounded retry/429 storm.  We only submit the next window after all
            # requests in the current one succeeded, so a failed request never leaves
            # queued work behind.  Every fragment still has its own content cache and
            # is assembled in source order below.
            fragment_locks = {fragment: threading.Lock() for fragment in (
                spoken_segment(spoken, origins, part['start'], part['end']) for part in split)}
            def prepare_part(index, part):
                _TTS_REQUEST.control = control
                fragment = spoken_segment(spoken, origins, part['start'], part['end'])
                if not fragment.strip():
                    return index, part, fragment, None, 0.0
                # Nest content-keyed fragments in the portable utterance cache.
                # A repeated fragment shares one request, with no concurrent writes.
                fragment_input = {'provider': provider, 'voice': speaker['voice'], 'options': options,
                                  'spoken': fragment, 'endpoint': cache_input['endpoint'], 'format': 'pcm24k-v1'}
                fragment_key = hashlib.sha256(json.dumps(fragment_input, ensure_ascii=False, sort_keys=True).encode()).hexdigest()
                fragment_dir = shared / 'fragments' / fragment_key
                with fragment_locks[fragment]:
                    fragment_dir.mkdir(parents=True, exist_ok=True)
                    source, audio_file = fragment_dir / 'source.mp3', fragment_dir / 'audio.wav'
                    marker = fragment_dir / 'complete.json'
                    try: reusable = valid_wav(audio_file) and load(marker).get('sha256') == file_hash(audio_file)
                    except (OSError, ValueError, KeyError): reusable = False
                    if not reusable:
                        # Adopt verified partial caches made by the serial pipeline.
                        legacy = shared / f'segment-{index}.wav'
                        try: legacy_valid = valid_wav(legacy) and load(shared / f'segment-{index}.complete.json').get('sha256') == file_hash(legacy)
                        except (OSError, ValueError, KeyError): legacy_valid = False
                        if legacy_valid:
                            shutil.copy2(legacy, audio_file)
                        else:
                            control.check()
                            if provider == 'fish':
                                fish_generate(fragment, speaker['voice'], options, source)
                            else:
                                edge_generate(fragment, speaker['voice'], source)
                            normalize_audio(source, audio_file)
                        save(marker, {'sha256':file_hash(audio_file)})
                    part_duration = wav_duration(audio_file)
                return index, part, fragment, audio_file, part_duration

            control = SpeechRequestControl()
            prepared = prepare_speech_window(list(enumerate(split)), prepare_part, control, concurrency=None if provider == 'fish' else 1)

            with wave.open(str(pending_wav), 'wb') as combined:
                combined.setnchannels(1); combined.setsampwidth(2); combined.setframerate(24000)
                for index, part, fragment, audio_file, part_duration in sorted(prepared, key=lambda item: item[0]):
                    if not fragment.strip():
                        segments.append({'text':part['text'],'spokenText':fragment,'textOffset':part['start'],'wordLength':part['end']-part['start'],'offset':offset,'duration':0.0})
                        continue
                    with wave.open(str(audio_file), 'rb') as audio:
                        combined.writeframes(audio.readframes(audio.getnframes()))
                    segments.append({'text': part['text'], 'spokenText': fragment, 'textOffset': part['start'], 'wordLength': part['end']-part['start'], 'offset': offset, 'duration': part_duration})
                    offset += part_duration
            if offset<=0:raise ValueError('台词规范化后没有可朗读内容，请补充台词或发音词典。')
            pending_wav.replace(wav_file)
            metadata = {'text': text, **pronunciation_metadata(spoken, origins), 'voice': speaker['voice'], 'duration': offset, 'boundaries': [], 'segments': segments, 'alignment': 'measured_segments', 'speechSource': provider, 'cacheKey': key}
        save(meta_file, metadata)
        write_integrity(shared, ['speech.wav','speech.json'], save)
    metadata = load(meta_file)
    destination = Path(directory); destination.mkdir(parents=True, exist_ok=True)
    audio_file = destination / f"{utterance['id']}.wav"
    shutil.copy2(wav_file, audio_file); save(destination / f"{utterance['id']}.json", metadata)
    return {**metadata, 'audio': str(audio_file), 'id': utterance['id'], 'speakerId': speaker['id']}


def measured_subtitles(segments):
    """Attach unvoiced TeX delimiters to adjacent captions without losing source."""
    result, pending = [], ''
    for segment in segments:
        if segment['duration']<=0:
            if result:result[-1]['text']+=segment['text']
            else:pending+=segment['text']
        else:
            result.append({'text':pending+segment['text'],'start':segment['offset'],'end':segment['offset']+segment['duration']})
            pending=''
    if pending and result:result[-1]['text']+=pending
    return result


def build_timeline(project, shot, voices, directory, cache_dir):
    if project.get('shots'):
        from video_summary import normalize_summary_project
        project = normalize_summary_project(project)
        shot = next((item for item in project['shots'] if item['id'] == shot['id']), shot)
    options = project.get('speech') or {'provider': 'fish', 'model': 's1', 'chunkLength': 200, 'pauseSeconds': .5}
    offset, gap = 0.6, options['pauseSeconds']
    utterances, events, subtitles = [], [], []
    action_sets = [('board', shot.get('boardTexts', [])), ('formula', shot['formulas']), ('circuit', shot['actions']), ('highlight', shot.get('highlights', []))]
    for item in shot.get('boardTexts', []):
        if not item.get('cue'):
            events.append({'type': 'board', 'time': 0.0, 'data': item})
    dictionary = project.get('pronunciations', [])
    for uid in shot['utteranceIds']:
        utterance = next(u for u in project['utterances'] if u['id'] == uid)
        speaker = next(s for s in project['speakers'] if s['id'] == utterance['speakerId'])
        cues = [item['cue'] for _, items in action_sets for item in items if item.get('cue', {}).get('utteranceId') == uid]
        audio = speech(utterance, speaker, directory / 'audio', cache_dir, dictionary, options, cues)
        audio['start'] = offset
        utterances.append(audio)
        events.append({'type': 'speaker', 'time': offset, 'speakerId': speaker['id']})
        subs = (measured_subtitles(audio['segments']) if audio.get('alignment') == 'measured_segments' else make_subtitles(audio['text'], audio['boundaries'], audio['duration']))
        for sub in subs:
            subtitles.append({**sub, 'start': sub['start'] + offset, 'end': sub['end'] + offset, 'speakerId': speaker['id']})
        for kind, items in action_sets:
            for item in items:
                if item.get('cue', {}).get('utteranceId') == uid:
                    at = (measured_cue(item['cue'], audio['text'], audio['segments'], audio['duration']) if audio.get('alignment') == 'measured_segments' else resolve_cue(item['cue'], audio['text'], audio['boundaries'], audio['duration']))
                    events.append({'type': kind, 'time': offset + at, 'data': item})
                    if kind=='highlight':events.append({'type':'highlight_end','time':offset+at+item.get('durationSeconds',3.0),'id':item['id']})
        offset += audio['duration'] + gap
    for sub in subtitles:
        events.append({'type': 'subtitle', 'time': sub['start'], 'text': sub['text']})
        events.append({'type': 'subtitle', 'time': sub['end'], 'text': ''})
    duration=math.ceil((offset-gap+shot['holdSeconds'])*project['settings']['fps'])/project['settings']['fps']
    events=[e for e in events if e['type']!='highlight_end' or e['time']<duration]
    # Clear events sort before next caption at an identical boundary.
    order = {'speaker': 1, 'board': 2, 'formula': 3, 'circuit': 4, 'highlight': 5, 'subtitle': 6, 'highlight_end':0}
    events.sort(key=lambda e: (e['time'], 0 if e['type'] == 'subtitle' and not e.get('text') else order[e['type']]))
    from video_validation import check_event_visibility
    check_event_visibility(shot,{'events':events})
    return {'shot': shot, 'projectTitle': project['title'], 'problem': project.get('problem'), 'settings': project['settings'], 'speakers': project['speakers'],
            'circuit': next((c for c in project['circuits'] if c['id'] == shot.get('circuitAssetId')), None),
            'utterances': utterances, 'subtitles': subtitles, 'events': events,
            'duration': math.ceil((offset - gap + shot['holdSeconds']) * project['settings']['fps']) / project['settings']['fps']}


def write_srt(subtitles, path):
    def timestamp(seconds):
        ms = max(0, round(seconds * 1000)); hours, ms = divmod(ms, 3_600_000); minutes, ms = divmod(ms, 60_000); secs, ms = divmod(ms, 1000)
        return f'{hours:02}:{minutes:02}:{secs:02},{ms:03}'
    contents = '\n\n'.join(f"{i+1}\n{timestamp(s['start'])} --> {timestamp(s['end'])}\n{s['text']}" for i, s in enumerate(subtitles))
    Path(path).write_text(contents + '\n', encoding='utf-8')


def concatenate_wav(timeline, target):
    sample_rate = 24000
    total = math.ceil(timeline['duration'] * sample_rate)
    # Mono PCM is composited exactly from audio sample offsets; no tempo changes.
    output = bytearray(total * 2)
    for utterance in timeline['utterances']:
        with wave.open(utterance['audio'], 'rb') as audio:
            if audio.getframerate() != sample_rate or audio.getnchannels() != 1 or audio.getsampwidth() != 2:
                raise ValueError('配音格式必须为 24 kHz、单声道、16-bit PCM')
            frames = audio.readframes(audio.getnframes())
        start = round(utterance['start'] * sample_rate) * 2
        output[start:start + len(frames)] = frames
    with wave.open(str(target), 'wb') as audio:
        audio.setnchannels(1); audio.setsampwidth(2); audio.setframerate(sample_rate); audio.writeframes(output)


SHOT_CACHE_FILES = ['video.mp4', 'result.json', 'timeline.json', 'narration.wav', 'subtitles.srt']


def reusable_production_shot(manifest, item):
    """Skip preflight only when the video and its source audio are both verified."""
    directory = Path(manifest['cacheDir']).resolve() / 'shots' / item['cacheKey']
    shot = next((shot for shot in manifest['project']['shots'] if shot['id'] == item['id']), None)
    if shot is None or not check_integrity(directory, SHOT_CACHE_FILES): return False
    names = ['timeline.json', 'narration.wav', 'subtitles.srt'] + [
        f'audio/{uid}.{extension}' for uid in shot['utteranceIds'] for extension in ('wav', 'json')]
    return (check_integrity(directory, ['static.json'], 'static.complete.json')
            and check_integrity(directory, names, 'timeline.complete.json'))


def render_shot(manifest, item):
    """Commit one complete cache entry. No course output is published here."""
    project = manifest['project']
    shot = next(s for s in project['shots'] if s['id'] == item['id'])
    directory = Path(manifest['cacheDir']).resolve() / 'shots' / item['cacheKey']
    directory.mkdir(parents=True, exist_ok=True)
    names = SHOT_CACHE_FILES
    if check_integrity(directory, names):
        return directory, load(directory / 'timeline.json'), load(directory / 'result.json'), True
    timeline = load(directory / 'timeline.json')
    renderer = Path(__file__).resolve().parent
    width, height, fps = manifest['width'], manifest['height'], manifest['fps']
    # Shared cross-process LaTeX cache: identical formulas reuse SVG across
    # shot subprocesses instead of re-running xelatex every time.
    latex_cache = Path(manifest['cacheDir']).resolve().parent / 'latex-cache'
    latex_cache.mkdir(parents=True, exist_ok=True)
    environment = {**os.environ, 'VIDEO_TIMELINE': str(directory / 'timeline.json'), 'PYTHONIOENCODING': 'utf-8', 'VIDEO_LATEX_CACHE_DIR': str(latex_cache)}
    # Manim adds several deep folders and long filenames. Keep disposable media
    # outside content-addressed caches to avoid Windows legacy path limits.
    with tempfile.TemporaryDirectory(prefix='video-shot-') as scratch:
        media = Path(scratch)
        run([sys.executable, '-m', 'manim', str(renderer / 'scene.py'), 'LessonShot', '--renderer', 'cairo', '--format', 'mp4', '--disable_caching', '--media_dir', media,
             '-r', f'{width},{height}', '--fps', str(fps), '-o', 'visual'], env=environment, timeout=float(os.environ.get('VIDEO_MANIM_TIMEOUT_SECONDS','600')))
        visuals = list((media / 'videos').rglob('visual.mp4'))
        if len(visuals) != 1:
            raise PipelineError('Manim 未输出唯一镜头视频', code='shot_output_missing', stage='render', shot_id=shot['id'])
        pending = directory / 'video.pending.mp4'
        run([FFMPEG, '-y', '-i', visuals[0], '-i', directory / 'narration.wav', '-map', '0:v:0', '-map', '1:a:0', '-c:v', 'copy', '-c:a', 'aac', '-b:a', '160k', '-t', f"{timeline['duration']:.6f}", '-movflags', '+faststart', pending])
    pending.replace(directory / 'video.mp4')
    result = {'duration': timeline['duration'], 'width': width, 'height': height, 'fps': fps, 'speechSource': project.get('speech', {}).get('provider', 'fish'), 'shotId': shot['id']}
    save(directory / 'result.json', result)
    write_integrity(directory, names, save)
    return directory, timeline, result, False


def production_error(error, stage, shot_id=None):
    details = {'code': getattr(error, 'code', 'shot_failed'), 'stage': getattr(error, 'stage', None) or stage,
               'shotId': shot_id, 'objectId': getattr(error, 'object_id', None),
               'message': str(error), 'retryable': getattr(error, 'retryable', False), 'severity': 'error'}
    for key in ['AZURE_SPEECH_KEY', 'AI_API_KEY', 'FISH_API_KEY', 'FISH_AUDIO_API_KEY', 'FISH_TTS_TOKEN']:
        secret = os.environ.get(key, '').strip()
        if secret: details['message'] = details['message'].replace(secret, '[redacted]')
    return details


def render(manifest):
    from video_summary import normalize_summary_project
    manifest = {**manifest, 'project': normalize_summary_project(manifest['project'])}
    project = manifest['project']; output = Path(manifest['outputDir']).resolve(); output.mkdir(parents=True, exist_ok=True)
    cache = Path(manifest['cacheDir']).resolve(); cache.mkdir(parents=True, exist_ok=True)
    from video_preflight import preflight
    # The node receipt describes every requested shot, including failures. It is
    # observational; only verified cache contents are trusted when resuming.
    items = manifest['shots']
    if not items or len({item['id'] for item in items}) != len(items):
        raise PipelineError('制作清单必须包含非空且不重复的镜头', code='invalid_shot_manifest', stage='production')
    receipt_path = output / 'production-nodes.json'
    try: previous = load(receipt_path)
    except (OSError, ValueError): previous = {}
    same_run = (isinstance(previous, dict) and previous.get('projectId') == project['id']
                and previous.get('projectRevision') == project['revision']
                and previous.get('rendererVersion') == manifest.get('rendererVersion'))
    previous_nodes = previous.get('nodes') if same_run else []
    old_nodes = {node.get('shotId'): node for node in previous_nodes if isinstance(node, dict) and isinstance(node.get('shotId'), str)} if isinstance(previous_nodes, list) else {}
    now = lambda: datetime.now(timezone.utc).isoformat()
    receipt = {'schemaVersion': 1, 'projectId': project['id'], 'projectRevision': project['revision'],
               'rendererVersion': manifest.get('rendererVersion'), 'status': 'running', 'phase': 'shots',
               'expectedShotIds': [item['id'] for item in items], 'missingShotIds': [], 'startedAt': now(), 'nodes': []}
    for item in items:
        old = old_nodes.get(item['id'], {})
        attempts = old.get('attempts', 0) if old.get('cacheKey') == item['cacheKey'] else 0
        receipt['nodes'].append({'shotId': item['id'], 'cacheKey': item['cacheKey'], 'status': 'queued',
                                 'phase': 'queued', 'attempts': attempts if type(attempts) is int and attempts >= 0 else 0,
                                 'cached': False})
    def persist_nodes():
        receipt['updatedAt'] = now()
        save(receipt_path, receipt)
    # Reusing a job directory must never expose a stale completion marker/output.
    for name in ['result.json', 'video.mp4', 'subtitles.srt', 'validation.json']:
        (output / name).unlink(missing_ok=True)
    persist_nodes()
    completed = []
    cached = 0
    for index, (item, node) in enumerate(zip(items, receipt['nodes'])):
        node.update(status='running', phase='render', attempts=node['attempts'] + 1, startedAt=now())
        persist_nodes()
        try:
            if not reusable_production_shot(manifest, item):
                node['phase'] = 'preflight'; persist_nodes()
                def shot_progress(progress, stage, **details):
                    emit((index + min(35, max(0, progress)) / 100) / len(items) * 90,
                         stage, cached, **details)
                preflight({**manifest, 'shots': [item], 'outputDir': str(output / 'nodes' / item['id'])},
                          on_progress=shot_progress)
            node['phase'] = 'render'; persist_nodes()
            emit((index + .35) / len(items) * 90, f"绘制镜头 {index+1}/{len(items)}：{item['id']}", cached, phase='render', shotId=item['id'])
            directory, timeline, result, reused = render_shot(manifest, item)
            cached += int(reused)
            completed.append((item, directory, timeline, result))
            node.update(status='succeeded', phase='complete', cached=reused, duration=result['duration'],
                        artifactDirectory=str(directory), finishedAt=now())
        except Exception as error:
            details = production_error(error, node['phase'], item['id'])
            node.update(status='failed', phase=details['stage'], error=details, finishedAt=now())
        persist_nodes()
        emit((index + 1) / len(items) * 90, f"已处理镜头 {index+1}/{len(items)}" + ('，失败镜头保留待修复' if node['status'] == 'failed' else ''),
             cached, phase='shot_complete', shotId=item['id'])
    failures = [node['error'] for node in receipt['nodes'] if node['status'] != 'succeeded']
    if failures:
        receipt.update(status='failed', phase='shots', missingShotIds=[entry['shotId'] for entry in failures], finishedAt=now())
        persist_nodes()
        first = failures[0]
        error = PipelineError(f"{len(failures)}/{len(items)} 个镜头未完成，未合成成片；已完成镜头保留。{first['shotId']}：{first['message']}",
                              code='production_incomplete', retryable=all(entry['retryable'] for entry in failures),
                              stage='production', shot_id=first['shotId'])
        error.issues = failures
        raise error
    def assembly_phase(phase):
        receipt['phase'] = phase
        persist_nodes()
    try:
        assembly_phase('assembly')
        assemble_production(manifest, completed, cached, assembly_phase)
    except Exception as error:
        receipt.update(status='failed', error=production_error(error, receipt['phase']), finishedAt=now())
        persist_nodes()
        raise
    receipt.update(status='succeeded', phase='complete', finishedAt=now()); persist_nodes()
    emit(100, '视频已完成', cached)


def assemble_production(manifest, completed, cached, on_phase):
    """Called only after all requested nodes passed; preserve the established PCM/CFR clocks."""
    from video_transition import transition_boundaries, prepare_summary_transition
    project = manifest['project']
    output, cache = Path(manifest['outputDir']).resolve(), Path(manifest['cacheDir']).resolve()
    renderer = Path(__file__).resolve().parent
    width, height, fps = manifest['width'], manifest['height'], manifest['fps']
    boundaries = set(transition_boundaries(project, manifest['shots']))
    transition = prepare_summary_transition(cache, width, height, fps) if boundaries else None
    rendered, narration_paths, segment_durations, global_subtitles, offset = [], [], [], [], 0.0
    transitions = []
    for item, directory, timeline, result in completed:
        shot = next(s for s in project['shots'] if s['id'] == item['id'])
        if shot['id'] in boundaries:
            transition_directory, transition_result = transition
            rendered.append(transition_directory / 'video.mp4')
            narration_paths.append(transition_directory / 'narration.wav')
            segment_durations.append(transition_result['duration'])
            transitions.append({'beforeShotId': shot['id'], 'start': offset, **transition_result})
            offset += transition_result['duration']
        rendered.append(directory / 'video.mp4')
        narration_paths.append(directory / 'narration.wav')
        segment_durations.append(result['duration'])
        global_subtitles.extend({**sub, 'start': sub['start'] + offset, 'end': sub['end'] + offset} for sub in timeline['subtitles'])
        offset += result['duration']
    emit(95, '合成整片与独立字幕', cached)
    # Simple local names keep user strings out of ffconcat. Hard links avoid a
    # second full copy of every encoded shot; cross-volume exports fall back.
    pieces = output / 'segments'; pieces.mkdir(exist_ok=True)
    for i, video in enumerate(rendered):
        destination = pieces / f'{i:04}.mp4'
        destination.unlink(missing_ok=True)
        try: os.link(video, destination)
        except OSError: shutil.copy2(video, destination)
    listing = pieces / 'concat.txt'
    listing.write_text('\n'.join(f"file '{i:04}.mp4'\nduration {segment_durations[i]:.9f}" for i in range(len(rendered))), encoding='utf-8')
    # Concatenate raw PCM and encode AAC once. Segment AAC priming must not move later cues.
    with wave.open(str(output / 'narration.wav'), 'wb') as combined:
        combined.setnchannels(1); combined.setsampwidth(2); combined.setframerate(24000)
        for narration in narration_paths:
            with wave.open(str(narration), 'rb') as source:
                if (source.getnchannels(), source.getsampwidth(), source.getframerate()) != (1, 2, 24000):
                    raise PipelineError('合成音轨格式不一致', code='audio_format_invalid', stage='assembly')
                while frames := source.readframes(65536):
                    combined.writeframesraw(frames)
    # Manim wait boundaries can leave sparse PTS. Encode a fixed frame grid explicitly.
    # Pad the last still frame before trimming so the exact target duration is preserved.
    frame_count = round(offset * fps)
    run([FFMPEG, '-y', '-f', 'concat', '-safe', '1', '-i', listing, '-i', output / 'narration.wav',
         '-map', '0:v:0', '-map', '1:a:0', '-vf', 'tpad=stop_mode=clone:stop_duration=1',
         '-c:v', 'libx264', '-preset', 'medium', '-crf', '18', '-pix_fmt', 'yuv420p',
         '-r', str(fps), '-fps_mode', 'cfr', '-frames:v', str(frame_count),
         '-c:a', 'aac', '-b:a', '160k', '-t', f'{offset:.6f}', '-movflags', '+faststart', output / 'video.mp4'])
    write_srt(global_subtitles, output / 'subtitles.srt')
    on_phase('validation')
    emit(98, '校验完整成片、音画同步与字幕', cached, phase='validation')
    quality_manifest = output / 'validation-manifest.json'
    save(quality_manifest, {**manifest, 'transitions': transitions})
    run([sys.executable, renderer / 'video_validation.py', '--manifest', quality_manifest],
        timeout=float(os.environ.get('VIDEO_VALIDATION_TIMEOUT_SECONDS', '600')))
    quality = load(output / 'validation.json')
    if quality.get('status') != 'passed':
        raise PipelineError('成片验收未通过，已保留完成镜头供重试。', code='validation_failed', stage='validation')
    save(output / 'result.json', {'duration': offset, 'cachedShots': cached, 'speechSource': project.get('speech', {}).get('provider', 'fish'), 'width': width, 'height': height, 'fps': fps,
         'transitions':transitions,'validation':quality,'keyframes':quality.get('keyframes', []),'metrics':telemetry()})
    save(output/'telemetry.json',telemetry())


def shot_content(project, shot):
    utterances = [next(u for u in project['utterances'] if u['id'] == uid) for uid in shot['utteranceIds']]
    speaker_ids = {u['speakerId'] for u in utterances}
    return {'title': project['title'], 'problem': project.get('problem'), 'shot': {key: value for key, value in shot.items() if key != 'reviewNotes'},
            'utterances': utterances, 'speakers': [s for s in project['speakers'] if s['id'] in speaker_ids],
            'circuit': next((c for c in project['circuits'] if c['id'] == shot.get('circuitAssetId')), None),
            'settings': project['settings'], 'speech': project.get('speech'), 'pronunciations': project.get('pronunciations')}


def portable_shots(project, recipe, baseline, renderer_version):
    selected = recipe.get('shots') or [{'id': shot['id']} for shot in project['shots']]
    shots = []
    for item in selected:
        shot = next(s for s in project['shots'] if s['id'] == item['id'])
        old = next((s for s in baseline.get('shots', []) if s['id'] == item['id']), None)
        unchanged = old and shot_content(project, shot) == shot_content(baseline, old) and recipe.get('rendererVersion') == renderer_version
        key = item.get('cacheKey') if unchanged else None
        if not key:
            key = hashlib.sha256(json.dumps({'content': shot_content(project, shot), 'renderer': renderer_version,
                'width': recipe.get('width', 1920), 'height': recipe.get('height', 1080)}, ensure_ascii=False, sort_keys=True).encode()).hexdigest()
        shots.append({'id': shot['id'], 'cacheKey': key})
    return shots


def main():
    watch_parent()
    parser = argparse.ArgumentParser()
    parser.add_argument('--probe', action='store_true'); parser.add_argument('--preflight', action='store_true'); parser.add_argument('--static-only', action='store_true'); parser.add_argument('--manifest'); parser.add_argument('--project'); parser.add_argument('--output', default='output')
    args = parser.parse_args()
    if args.probe:
        print(json.dumps(probe(), ensure_ascii=False)); return
    if args.manifest:
        manifest = load(args.manifest)
    elif args.project:
        from video_summary import normalize_summary_project
        project_file = Path(args.project).resolve(); project = load(project_file); recipe_file = project_file.parent / 'render' / 'recipe.json'
        project = normalize_summary_project(project)
        recipe = load(recipe_file) if recipe_file.exists() else {}
        baseline_file = project_file.parent / 'render' / 'project.json'
        baseline = load(baseline_file) if baseline_file.exists() else {}
        if baseline.get('shots'): baseline = normalize_summary_project(baseline)
        renderer_hash = hashlib.sha256()
        for filename in sorted(p.name for p in Path(__file__).resolve().parent.glob('*.py') if not p.name.startswith('test_')):
            renderer_hash.update(filename.encode('utf-8'))
            renderer_hash.update((Path(__file__).resolve().parent / filename).read_bytes())
        for folder in ['fonts', 'templates']:
            location=next((root/folder for root in [Path(__file__).resolve().parent.parent/'public'/'video',Path(__file__).resolve().parent.parent/'assets'] if (root/folder).is_dir()),None)
            if location:
                for asset in sorted(location.iterdir(),key=lambda p:p.name):
                    if asset.is_file():
                        renderer_hash.update((folder+'/'+asset.name).encode('utf-8'));renderer_hash.update(asset.read_bytes())
        shots = portable_shots(project, recipe, baseline, renderer_hash.hexdigest())
        manifest = {'project': project, 'shots': shots, 'cacheDir': str(project_file.parent / 'cache'), 'outputDir': str(Path(args.output).resolve()), 'width': recipe.get('width', 1920), 'height': recipe.get('height', 1080), 'fps': project['settings']['fps']}
    else:
        parser.error('请传入 --manifest 或 --project')
    if args.preflight or args.static_only:
        from video_preflight import preflight
        preflight(manifest, args.static_only)
    else:render(manifest)


if __name__ == '__main__':
    try:
        main()
    except Exception as error:
        message = str(error)
        for key in ['AZURE_SPEECH_KEY', 'AI_API_KEY', 'FISH_API_KEY', 'FISH_AUDIO_API_KEY', 'FISH_TTS_TOKEN']:
            secret = os.environ.get(key, '').strip()
            if secret:
                message = message.replace(secret, '[redacted]')
        print(message, file=sys.stderr)
        print(json.dumps({'event':'error','message':message,'errorCode':getattr(error,'code','pipeline_failed'),
              'retryable':getattr(error,'retryable',False),'phase':getattr(error,'stage',None),'stage':getattr(error,'stage',None),
              'shotId':getattr(error,'shot_id',None),'objectId':getattr(error,'object_id',None),'issues':getattr(error,'issues',None)},ensure_ascii=False),flush=True)
        sys.exit(1)













