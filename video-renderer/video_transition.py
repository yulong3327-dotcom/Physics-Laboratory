"""Default summary interstitial, normalized to the lesson's frame and PCM clocks."""
from __future__ import annotations
import hashlib
import json
import math
from pathlib import Path
from video_runtime import PipelineError, check_integrity, file_hash, valid_wav, write_integrity


TRANSITION_FILES = ['video.mp4', 'narration.wav', 'result.json']


def summary_transition_source():
    root = Path(__file__).resolve().parent.parent
    for directory in [root / 'public/video/templates', root / 'assets/templates']:
        source = directory / 'summary-transition.mp4'
        if source.is_file():
            return source
    raise PipelineError('缺少默认总结转场素材 summary-transition.mp4，请恢复模板素材后重试。',
                        code='summary_transition_missing', stage='static_preflight')


def transition_boundaries(project, selected):
    """Only boundaries inside this rendered selection, never a single-shot preview."""
    shots = {shot['id']: shot for shot in project['shots']}
    previous = None
    result = []
    for item in selected:
        shot = shots[item['id']]
        summary = (shot.get('layout') or {}).get('template') == 'summary'
        if summary and previous is False:
            result.append(shot['id'])
        previous = summary
    return result


def transition_metadata(source, width, height, fps):
    import av
    with av.open(str(source)) as container:
        if not container.streams.video:
            raise PipelineError('总结转场素材没有视频画面。', code='summary_transition_invalid', stage='static_preflight')
        streams = [container.streams.video[0], *list(container.streams.audio)[:1]]
        durations = [float(stream.duration * stream.time_base) for stream in streams if stream.duration is not None]
        duration = max(durations or [float(container.duration or 0) / av.time_base])
        if not math.isfinite(duration) or duration <= 0:
            raise PipelineError('总结转场素材时长无效。', code='summary_transition_invalid', stage='static_preflight')
        frames = math.ceil(duration * fps - 1e-8)
        return {'kind': 'summary-transition', 'sourceHash': file_hash(source),
                'sourceDuration': duration, 'duration': frames / fps, 'frames': frames,
                'width': width, 'height': height, 'fps': fps, 'hasAudio': bool(container.streams.audio)}


def prepare_summary_transition(cache, width, height, fps):
    from pipeline import FFMPEG, load, run, save
    source = summary_transition_source()
    metadata = transition_metadata(source, width, height, fps)
    cache_key = hashlib.sha256(json.dumps({'version': 2, **metadata}, sort_keys=True).encode()).hexdigest()
    directory = Path(cache) / 'transitions' / cache_key
    directory.mkdir(parents=True, exist_ok=True)
    if check_integrity(directory, TRANSITION_FILES):
        return directory, load(directory / 'result.json')
    duration = f"{metadata['duration']:.9f}"
    pending = directory / 'video.pending.mp4'
    # Match the summary background's center-cover crop so the final paper aligns.
    filters = (f'scale={width}:{height}:force_original_aspect_ratio=increase:force_divisible_by=2,'
               f'crop={width}:{height}:(iw-ow)/2:(ih-oh)/2,setsar=1,'
               f'fps={fps},tpad=stop_mode=clone:stop_duration=1')
    run([FFMPEG, '-y', '-i', source, '-map', '0:v:0', '-an', '-vf', filters,
         '-c:v', 'libx264', '-preset', 'medium', '-crf', '18', '-pix_fmt', 'yuv420p',
         '-r', str(fps), '-fps_mode', 'cfr', '-frames:v', str(metadata['frames']),
         '-video_track_timescale', str(fps * 512), '-movflags', '+faststart', pending])
    pending.replace(directory / 'video.mp4')
    pending_audio = directory / 'narration.pending.wav'
    inputs = ['-i', source, '-map', '0:a:0'] if metadata['hasAudio'] else ['-f', 'lavfi', '-i', 'anullsrc=r=24000:cl=mono']
    samples = round(metadata['duration'] * 24000)
    run([FFMPEG, '-y', *inputs, '-vn', '-ac', '1', '-ar', '24000',
         '-af', f'aresample=24000,apad,atrim=end_sample={samples}', '-c:a', 'pcm_s16le', '-t', duration, pending_audio])
    if not valid_wav(pending_audio, metadata['duration']):
        raise PipelineError('总结转场音轨时长不正确。', code='summary_transition_invalid', stage='render')
    pending_audio.replace(directory / 'narration.wav')
    metadata['cacheKey'] = cache_key
    save(directory / 'result.json', metadata)
    write_integrity(directory, TRANSITION_FILES, save)
    return directory, metadata


def transition_timeline(directory, before_shot_id):
    from pipeline import load
    directory = Path(directory)
    metadata = load(directory / 'result.json')
    return {'kind': 'summary-transition', 'duration': metadata['duration'], 'subtitles': [], 'events': [],
            'utterances': ([{'id': 'summary-transition-before-' + before_shot_id,
                            'audio': str(directory / 'narration.wav'), 'start': 0.0}]
                          if metadata['hasAudio'] else [])}
