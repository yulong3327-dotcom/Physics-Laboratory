"""Independent checks of generated lesson audio, timelines, geometry, and final MP4.

No TTS calls and no renderer changes. Content checks compare supplied text and
actual files; they are not an ASR transcript or a substitute for listening.
"""
from __future__ import annotations
import argparse
import json
import math
import os
from pathlib import Path
import re
import subprocess
import sys
import wave
import numpy as np

ROOT = Path(__file__).resolve().parents[1]
TOLERANCE = 0.2
sys.path.insert(0, str(ROOT / "video-renderer"))
from video_runtime import cue_position, PipelineError


def load(path):
    return json.loads(Path(path).read_text(encoding="utf-8-sig"))


def wav(path):
    with wave.open(str(path), "rb") as stream:
        if (stream.getnchannels(), stream.getsampwidth(), stream.getframerate()) != (1, 2, 24000):
            raise ValueError("Expected mono 16-bit 24 kHz PCM: " + str(path))
        return stream.readframes(stream.getnframes())


def srt(path):
    result = []
    def time(text):
        h, m, s, ms = (int(part) for part in re.split("[:,]", text))
        return h * 3600 + m * 60 + s + ms / 1000
    for block in re.split(r"\n\s*\n", Path(path).read_text(encoding="utf-8-sig").strip()):
        lines = block.splitlines()
        if len(lines) < 3:
            raise ValueError("Malformed SRT block: " + block)
        start, end = lines[1].split(" --> ")
        result.append({"start": time(start), "end": time(end), "text": "".join(lines[2:])})
    return result


class Audit:
    def __init__(self):
        self.errors, self.warnings, self.shots, self.cues, self.geometry, self.audio_lags = [], [], [], [], [], []
        self.video = None
    def check(self, condition, message):
        if not condition:
            self.errors.append(message)
        return bool(condition)


def check_event_visibility(shot, timeline):
    boards = {item['id'] for item in shot.get('boardTexts', []) if not item.get('cue')}
    formulas = {}
    for event in timeline['events']:
        item = event.get('data', {})
        if event['type'] == 'board': boards.add(item['id'])
        elif event['type'] == 'formula':
            track=item.get('cardId') or ''
            if track and track not in boards:
                error=PipelineError('公式出现时知识卡尚未显示：'+track,code='card_not_visible',stage='timeline_preflight',shot_id=shot['id']);error.object_id=item['id'];raise error
            rows=formulas.setdefault(track,[])
            if rows and item.get('display','replace')!='append':rows.pop()
            rows.append(item['id'])
        elif event['type'] == 'highlight':
            valid = item['targetId'] in boards if item['targetType'] == 'board' else any(item['targetId'] in rows for rows in formulas.values())
            if not valid:
                error = PipelineError('高亮发生时目标尚未出现或已被替换：' + item['targetId'], code='highlight_not_visible', stage='timeline_preflight', shot_id=shot['id'])
                error.object_id = item['targetId']
                raise error


def validate_geometry(asset, audit, directory):
    from svgelements import Path as SvgPath
    geometry = asset.get("geometry")
    if not audit.check(bool(geometry), asset["id"] + ": missing geometry"):
        return
    bounds = geometry["bounds"]
    audit.check(all(math.isfinite(v) for v in bounds.values()) and bounds["width"] > 0 and bounds["height"] > 0, asset["id"] + ": invalid viewport")
    components = {c["id"]: c for c in geometry["components"]}
    for wire in geometry["wires"]:
        path = SvgPath(wire["path"])
        for endpoint, position in [(wire["from"], path.point(0)), (wire["to"], path.point(1))]:
            cid, terminal = endpoint.split(".")
            expected = components[cid]["terminals"][terminal]
            error = abs(complex(position.x, position.y) - complex(expected["x"], expected["y"]))
            audit.check(error < 1e-6, asset["id"] + "/" + wire["id"] + ": exported path misses " + endpoint)
        x0, y0, x1, y1 = path.bbox()
        audit.check(x0 >= bounds["x"] - 1e-6 and y0 >= bounds["y"] - 1e-6 and x1 <= bounds["x"] + bounds["width"] + 1e-6 and y1 <= bounds["y"] + bounds["height"] + 1e-6,
                    asset["id"] + "/" + wire["id"] + ": path exceeds viewport")
    sys.path.insert(0, str(ROOT / "video-renderer"))
    from manim import tempconfig, VMobject
    from circuit import CircuitMobject
    with tempconfig({"media_dir": str(directory / "manim"), "verbosity": "ERROR"}):
        circuit = CircuitMobject(asset, directory / asset["id"], width=5.7, height=3.25)
        max_error = 0.0
        for transform in range(2):
            if transform:
                circuit.scale(0.71).rotate(0.31).move_to([1.3, -0.4, 0])
            for wire in geometry["wires"]:
                wire_object = circuit.wire(wire["id"])
                # Raster-capable circuit adapters group the vector path with current particles.
                vector = wire_object if isinstance(wire_object, VMobject) else wire_object.submobjects[0]
                members = [m for m in vector.family_members_with_points() if m.has_points()]
                if not audit.check(len(members) == 1, asset["id"] + "/" + wire["id"] + ": ambiguous rendered wire path"):
                    continue
                obj = members[0]
                for endpoint, actual in [(wire["from"], obj.get_start()), (wire["to"], obj.get_end())]:
                    cid, terminal = endpoint.split(".")
                    error = float(np.linalg.norm(actual - circuit.port(cid, terminal).get_center()))
                    max_error = max(max_error, error)
                    audit.check(error < 1e-5, asset["id"] + "/" + wire["id"] + ": actual Manim endpoint misses transformed port")
        audit.geometry.append({"asset": asset["id"], "maxRenderedEndpointError": max_error, "viewportChecked": True})


def validate_state_geometry(shot, action, audit, directory):
    """Every simulated parameter snapshot must still join its rendered ports."""
    validate_geometry({'id':shot['id']+'-state-'+action['id'],'geometry':action.get('geometry')},audit,directory)


def validate_shot(project, source_shot, directory, audit):
    timeline = load(directory / "timeline.json")
    identifier = source_shot["id"]
    source = {u["id"]: u for u in project["utterances"]}
    speakers = {speaker["id"]: speaker for speaker in project["speakers"]}
    utterances = timeline["utterances"]
    audit.check([u["id"] for u in utterances] == source_shot["utteranceIds"], identifier + ": wrong utterance order/coverage")
    audit.check("".join(s["text"] for s in timeline["subtitles"]) == "".join(source[uid]["text"] for uid in source_shot["utteranceIds"]),
                identifier + ": subtitle text does not exactly cover narration")
    duration = timeline["duration"]
    combined = wav(directory / "narration.wav")
    expected_pcm = bytearray(len(combined))
    audit.check(abs(len(combined) / 48000 - duration) < 1 / 24000 + 1e-9, identifier + ": narration duration mismatch")
    local_utterances = {}
    previous_end = 0.0
    for utterance in utterances:
        uid = utterance["id"]
        label = identifier + "/" + uid
        local_utterances[uid] = utterance
        audit.check(utterance["text"] == source[uid]["text"], label + ": narration text changed")
        audit.check(utterance["speakerId"] == source[uid]["speakerId"], label + ": wrong speaker")
        audit.check(utterance["voice"] == speakers[source[uid]["speakerId"]]["voice"], label + ": wrong voice")
        audit.check(utterance.get("speechSource") == project.get("speech", {}).get("provider", "fish"), label + ": wrong speech provenance")
        audit.check(utterance["start"] >= previous_end - 1e-8, label + ": overlapping audio")
        previous_end = utterance["start"] + utterance["duration"]
        audit.check(previous_end <= duration + 1e-8, label + ": audio extends beyond shot")
        actual_pcm = wav(utterance["audio"])
        audit.check(abs(len(actual_pcm) / 48000 - utterance["duration"]) < 1 / 24000 + 1e-9, label + ": measured WAV duration disagrees with metadata")
        sample_start = round(utterance["start"] * 24000) * 2
        expected_pcm[sample_start:sample_start + len(actual_pcm)] = actual_pcm
        records = utterance.get("boundaries") if utterance.get("alignment") == "word_boundaries" else utterance.get("segments")
        if not audit.check(bool(records), label + ": no measured alignment"):
            continue
        covered = set()
        last_offset = -1.0
        for record in records:
            start, stop = record["textOffset"], record["textOffset"] + record["wordLength"]
            audit.check(0 <= start < stop <= len(utterance["text"]), label + ": invalid text offset")
            audit.check(record["text"] == utterance["text"][start:stop], label + ": boundary text differs from original")
            audit.check(record["offset"] >= last_offset - 1e-8 and record["offset"] >= 0 and record["duration"] >= 0
                        and record["offset"] + record["duration"] <= utterance["duration"] + 0.03, label + ": invalid measured boundary time")
            last_offset = record["offset"]
            covered.update(range(start, stop))
        missing = [i for i, char in enumerate(utterance["text"]) if char.isalnum() and i not in covered]
        audit.check(not missing, label + ": alphanumeric narration characters have no speech boundary: " + str(missing))

    audit.check(bytes(expected_pcm) == combined, identifier + ": composed narration PCM differs from source audio or pause locations")
    subtitles = timeline["subtitles"]
    previous_end = 0.0
    for index, caption in enumerate(subtitles):
        audit.check(caption["start"] >= previous_end - 1e-8, identifier + ": overlapping subtitles at " + str(index))
        audit.check(0 <= caption["start"] < caption["end"] <= duration + 1e-8, identifier + ": subtitle outside shot")
        previous_end = caption["end"]
    # Map every displayed caption back onto the actual spoken words. Exact text
    # coverage alone misses an entire sentence wrongly attached to a short caption.
    utterance_index, text_position = 0, 0
    for caption in subtitles:
        if utterance_index >= len(utterances):
            audit.check(False, identifier + ": extra subtitle content")
            break
        utterance = utterances[utterance_index]
        stop = text_position + len(caption["text"])
        audit.check(utterance["text"][text_position:stop] == caption["text"], identifier + ": caption crosses or changes an utterance")
        records = utterance.get("boundaries") or utterance.get("segments") or []
        spoken = [record for record in records if record["textOffset"] < stop and record["textOffset"] + record["wordLength"] > text_position]
        if spoken:
            first_start = utterance["start"] + spoken[0]["offset"]
            last_end = utterance["start"] + max(record["offset"] + record["duration"] for record in spoken)
            audit.check(abs(caption["start"] - first_start) <= TOLERANCE, identifier + ": caption begins >0.2 s from its first spoken word")
            audit.check(caption["end"] >= last_end - 0.05, identifier + ": caption disappears before its spoken words finish")
        text_position = stop
        if text_position == len(utterance["text"]):
            utterance_index += 1
            text_position = 0
    disk_subtitles = srt(directory / "subtitles.srt")
    audit.check(len(disk_subtitles) == len(subtitles), identifier + ": SRT count differs")
    for disk, planned in zip(disk_subtitles, subtitles):
        audit.check(disk["text"] == planned["text"] and abs(disk["start"] - planned["start"]) <= 0.001 and abs(disk["end"] - planned["end"]) <= 0.001,
                    identifier + ": SRT differs from resolved timeline")

    events = timeline["events"]
    audit.check(all(a["time"] <= b["time"] for a, b in zip(events, events[1:])), identifier + ": events out of order")
    for index, event in enumerate(events):
        if event["type"] == "subtitle" and event.get("text") and index + 1 < len(events):
            next_event = events[index + 1]
            audit.check(not (next_event["type"] == "subtitle" and not next_event.get("text") and abs(next_event["time"] - event["time"]) < 1e-8),
                        identifier + ": new caption erased at its own start")
    expected_events = {item["id"]: item for item in source_shot["formulas"] + source_shot["actions"] + source_shot.get("boardTexts", []) + source_shot.get("highlights", [])}
    actual_events = {event["data"]["id"]: event for event in events if event["type"] in ["formula", "circuit", "board", "highlight"]}
    audit.check(set(actual_events) == set(expected_events), identifier + ": formula/action/board/highlight coverage differs from current project")
    for event_id, expected in expected_events.items():
        if event_id not in actual_events:
            continue
        event = actual_events[event_id]
        audit.check(event["data"].get("cue") == expected.get("cue"), identifier + "/" + event_id + ": stale cue")
        if "latex" in expected:
            audit.check(event["data"]["latex"] == expected["latex"], identifier + "/" + event_id + ": stale formula")
        if "targetIds" in expected:
            audit.check(event["data"]["targetIds"] == expected["targetIds"], identifier + "/" + event_id + ": stale circuit targets")
        for field in ["text", "phrase", "targetId", "targetType", "occurrence", "color", "effect", "display", "entrance", "durationSeconds", "annotation", "state", "geometry", "card", "cardId"]:
            if field in expected:
                audit.check(event["data"].get(field) == expected[field], identifier + "/" + event_id + ": stale " + field)
        if not expected.get("cue"):
            audit.check(event["type"] == "board" and event["time"] == 0, identifier + "/" + event_id + ": static board must appear at shot start")
            continue
        cue = expected["cue"]
        utterance = local_utterances[cue["utteranceId"]]
        record, offset = None, 0.0
        if cue.get("phrase"):
            position = cue_position(cue, utterance["text"])
            audit.check(position >= 0, identifier + "/" + event_id + ": cue missing from original text")
            if utterance["alignment"] == "word_boundaries":
                records = utterance["boundaries"]
                record = next((b for b in records if b["textOffset"] <= position < b["textOffset"] + b["wordLength"]), None)
                record = record or next((b for b in records if position <= b["textOffset"] < position + len(cue["phrase"])), None)
                if record and record["textOffset"] < position and record["duration"] > TOLERANCE:
                    audit.warnings.append(identifier + "/" + event_id + ": cue begins inside a grouped speech token; true syllable onset cannot be certified to 0.2 s from word metadata")
            else:
                record = next((b for b in utterance["segments"] if b["textOffset"] == position), None)
            if not audit.check(record is not None, identifier + "/" + event_id + ": cue has no real alignment event"):
                continue
            offset = record["offset"]
        expected_time = utterance["start"] + offset + cue.get("offset", 0)
        error = abs(event["time"] - expected_time)
        audit.check(error <= TOLERANCE, identifier + "/" + event_id + ": cue error >0.2 s: " + str(error))
        audit.cues.append({"shot": identifier, "id": event_id, "errorSeconds": error, "alignment": utterance["alignment"]})
    audit.shots.append({"id": identifier, "duration": duration, "utterances": len(utterances), "subtitles": len(subtitles),
                        "alignment": sorted(set(u["alignment"] for u in utterances)), "pcmExact": bytes(expected_pcm) == combined})
    return timeline


def validate_video(video, project, timelines, audit, global_srt=None):
    import av
    from scipy.signal import correlate
    expected_duration = sum(t["duration"] for t in timelines)
    with av.open(str(video)) as container:
        audit.check(len(container.streams.video) == 1 and len(container.streams.audio) == 1, "MP4 must contain one video and one narration stream")
        if not container.streams.video or not container.streams.audio:
            return
        stream = container.streams.video[0]
        audit.check((stream.width, stream.height) == (project["settings"]["width"], project["settings"]["height"]), "MP4 dimensions do not match the project")
        audit.check(abs(float(stream.average_rate) - project["settings"]["fps"]) < 0.02, "MP4 frame rate differs from project")
        for stream in [container.streams.video[0], container.streams.audio[0]]:
            if stream.duration is not None:
                duration = float(stream.duration * stream.time_base)
                audit.check(abs(duration - expected_duration) <= TOLERANCE, "MP4 " + stream.type + " duration differs by >0.2 s")
    with av.open(str(video)) as packet_container:
        video_stream = packet_container.streams.video[0]
        pts = sorted(float(packet.pts * packet.time_base) for packet in packet_container.demux(video_stream) if packet.pts is not None)
        expected_interval = 1 / project["settings"]["fps"]
        frame_errors = [abs((b - a) - expected_interval) for a, b in zip(pts, pts[1:])]
        max_frame_error = max(frame_errors, default=0.0)
        audit.check(max_frame_error <= max(2 * float(video_stream.time_base), 1e-6), "MP4 frame timestamps are not constant at the requested frame rate")
        audit.video = {"width": video_stream.width, "height": video_stream.height, "averageFrameRate": float(video_stream.average_rate),
                       "frameCount": len(pts), "maxFrameIntervalErrorSeconds": max_frame_error,
                       "expectedDuration": expected_duration}
    decoded = subprocess.run([(os.environ.get("VIDEO_FFMPEG") or (str(ROOT / ".video-tools/ffmpeg.exe") if (ROOT / ".video-tools/ffmpeg.exe").exists() else "ffmpeg")), "-loglevel", "error", "-i", str(video), "-vn", "-ac", "1", "-ar", "24000", "-f", "s16le", "-"],
                             stdout=subprocess.PIPE, stderr=subprocess.PIPE, check=True, timeout=300).stdout
    actual = np.frombuffer(decoded, dtype="<i2").astype(np.float32)
    global_offset = 0.0
    global_subtitles = []
    for timeline in timelines:
        global_subtitles.extend({**s, "start": s["start"] + global_offset, "end": s["end"] + global_offset} for s in timeline["subtitles"])
        for utterance in timeline["utterances"]:
            reference = np.frombuffer(wav(utterance["audio"]), dtype="<i2").astype(np.float32)
            window = min(28800, len(reference))
            positions = range(0, max(1, len(reference) - window + 1), 2400)
            local = max(positions, key=lambda p: float(np.dot(reference[p:p + window], reference[p:p + window])))
            template = reference[local:local + window].copy()
            template -= template.mean()
            energy = float(np.linalg.norm(template))
            if not audit.check(energy > 1, utterance["id"] + ": source narration is silent"):
                continue
            expected_start = round((global_offset + utterance["start"]) * 24000) + local
            lower = max(0, expected_start - 24000)
            upper = min(len(actual), expected_start + window + 24000)
            search = actual[lower:upper]
            if not audit.check(len(search) >= len(template), utterance["id"] + ": final MP4 truncates narration"):
                continue
            correlations = correlate(search, template, mode="valid", method="fft")
            best = int(np.argmax(correlations))
            candidate = search[best:best + len(template)].copy()
            candidate -= candidate.mean()
            score = float(np.dot(candidate, template) / max(1.0, energy * np.linalg.norm(candidate)))
            lag = (lower + best - expected_start) / 24000
            audit.check(score > 0.85, utterance["id"] + ": MP4 audio cannot be matched to source narration")
            audit.check(abs(lag) <= TOLERANCE, utterance["id"] + ": measured final MP4 audio shift >0.2 s: " + str(lag))
            audit.audio_lags.append({"utterance": utterance["id"], "measuredShiftSeconds": lag, "correlation": score})
        global_offset += timeline["duration"]
    if global_srt:
        on_disk = srt(global_srt)
        audit.check(len(on_disk) == len(global_subtitles), "Final SRT caption count differs")
        for actual_caption, expected in zip(on_disk, global_subtitles):
            audit.check(actual_caption["text"] == expected["text"] and abs(actual_caption["start"] - expected["start"]) < 0.0011
                        and abs(actual_caption["end"] - expected["end"]) < 0.0011, "Final SRT differs from the concatenated timeline")


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--project", type=Path, default=ROOT / "examples/power-lesson/project.json")
    parser.add_argument("--audio-dir", type=Path, default=ROOT / "artifacts/lesson-audio")
    parser.add_argument("--partial", action="store_true", help="Validate completed shots while synthesis is ongoing.")
    parser.add_argument("--video", type=Path, help="Also validate the actual final MP4, including measured audio drift.")
    parser.add_argument("--srt", type=Path, help="Final SRT; defaults to subtitles.srt next to --video.")
    parser.add_argument("--preview", action="store_true", help="Expect the workbench 1280x720 preview dimensions instead of final project dimensions.")
    parser.add_argument("--skip-geometry", action="store_true", help="Skip repeated geometry checks after they have passed.")
    parser.add_argument("--report", type=Path, default=ROOT / "artifacts/lesson-validation/report.json")
    args = parser.parse_args()
    os.environ["PATH"] = str(ROOT / ".video-tools") + os.pathsep + os.environ.get("PATH", "")
    project = load(args.project)
    if args.preview:
        project["settings"] = {**project["settings"], "width": 1280, "height": 720}
    audit = Audit()
    timelines, missing = [], []
    for shot in project["shots"]:
        directory = args.audio_dir / shot["id"]
        if not all((directory / name).exists() for name in ["timeline.json", "narration.wav", "subtitles.srt"]):
            missing.append(shot["id"])
            continue
        try:
            timelines.append(validate_shot(project, shot, directory, audit))
        except Exception as error:
            audit.errors.append(shot["id"] + ": validator could not finish: " + str(error))
    if not args.partial:
        audit.check(not missing, "Missing completed shots: " + ", ".join(missing))
    if not args.skip_geometry:
        for asset in project["circuits"]:
            try:
                validate_geometry(asset, audit, args.report.parent / "geometry")
            except Exception as error:
                audit.errors.append(asset["id"] + ": geometry check could not finish: " + str(error))
        for shot in project['shots']:
            for action in shot.get('actions',[]):
                if action['type']!='state':continue
                try:validate_state_geometry(shot,action,audit,args.report.parent/'geometry')
                except Exception as error:audit.errors.append(shot['id']+'/'+action['id']+': state geometry check could not finish: '+str(error))
    if args.video:
        if audit.check(len(timelines) == len(project["shots"]), "Full MP4 checking requires all shot timelines"):
            try:
                validate_video(args.video, project, timelines, audit, args.srt or args.video.parent / "subtitles.srt")
            except Exception as error:
                audit.errors.append("MP4 verification could not finish: " + str(error))
    report = {"status": "failed" if audit.errors else "partial_pass" if missing else "passed", "missingShots": missing,
              "checkedShots": audit.shots, "errors": audit.errors, "warnings": audit.warnings, "cueChecks": audit.cues,
              "geometryChecks": audit.geometry, "actualMp4AudioChecks": audit.audio_lags, "videoChecks": audit.video,
              "maxCueMetadataErrorSeconds": max((c["errorSeconds"] for c in audit.cues), default=None),
              "maxMeasuredMp4AudioShiftSeconds": max((abs(c["measuredShiftSeconds"]) for c in audit.audio_lags), default=None),
              "limits": ["Exact content checks compare project text and generated metadata/subtitles, not ASR.",
                         "Cue checks certify recorded speech boundaries; grouped tokens may not certify individual syllable onset.",
                         "MP4 correlation measures actual encoded-audio drift; full listening and visual QA remain separate."]}
    args.report.parent.mkdir(parents=True, exist_ok=True)
    args.report.write_text(json.dumps(report, ensure_ascii=False, indent=2), encoding="utf-8")
    print(json.dumps({key: report[key] for key in ["status", "missingShots", "errors", "warnings", "maxCueMetadataErrorSeconds", "maxMeasuredMp4AudioShiftSeconds"]}, ensure_ascii=False))
    print("Report: " + str(args.report))
    if audit.errors:
        raise SystemExit(1)




def validate_manifest(manifest):
    """Production gate: verify every frame, subtitle, event and narration offset."""
    import av
    from copy import deepcopy
    from pipeline import save
    from video_summary import normalize_summary_project
    from video_transition import (TRANSITION_FILES, summary_transition_source, transition_boundaries,
                                  transition_metadata, transition_timeline)
    from video_runtime import check_integrity, valid_wav
    project = deepcopy(manifest['project'])
    project = normalize_summary_project(project)
    project['settings'].update(width=manifest['width'], height=manifest['height'], fps=manifest['fps'])
    output = Path(manifest['outputDir']); audit = Audit(); timelines = []; keyframes = []; checked_transitions = []
    try:
        transitions = manifest.get('transitions', [])
        expected_boundaries = transition_boundaries(project, manifest['shots'])
        audit.check([item['beforeShotId'] for item in transitions] == expected_boundaries,
                    '总结转场缺失、重复或出现在错误的镜头前')
        expected_transition = (transition_metadata(summary_transition_source(), manifest['width'], manifest['height'], manifest['fps'])
                               if expected_boundaries else None)
        checked_assets=set()
        for item in manifest['shots']:
            for transition in transitions:
                if transition['beforeShotId'] != item['id']: continue
                directory = Path(manifest['cacheDir']) / 'transitions' / transition['cacheKey']
                audit.check(check_integrity(directory, TRANSITION_FILES), '总结转场缓存校验失败')
                metadata = load(directory / 'result.json')
                audit.check(expected_transition is not None and all(metadata.get(key) == value for key, value in expected_transition.items()),
                            '总结转场与当前素材或成片设置不一致')
                audit.check(abs(transition['start'] - sum(t['duration'] for t in timelines)) < 1e-8,
                            '总结转场插入时间不正确')
                audit.check(valid_wav(directory / 'narration.wav', metadata['duration']), '总结转场音轨不完整')
                timelines.append(transition_timeline(directory, item['id']))
                checked_transitions.append({'beforeShotId': item['id'], 'start': transition['start'], 'duration': metadata['duration'],
                                            'sourceHash': metadata['sourceHash'], 'audioPreserved': metadata['hasAudio']})
            shot = next(shot for shot in project['shots'] if shot['id'] == item['id'])
            timeline = validate_shot(project, shot, Path(manifest['cacheDir'])/'shots'/item['cacheKey'], audit)
            check_event_visibility(shot, timeline); timelines.append(timeline)
            asset=next((asset for asset in project['circuits'] if asset['id']==shot.get('circuitAssetId')),None)
            if asset and asset['id'] not in checked_assets:
                validate_geometry(asset,audit,output/'geometry');checked_assets.add(asset['id'])
            for action in shot.get('actions',[]):
                if action['type']=='state':validate_state_geometry(shot,action,audit,output/'geometry')
        validate_video(output/'video.mp4', project, timelines, audit, output/'subtitles.srt')
        requested = []; offset = 0
        shot_index = 0
        for timeline in timelines:
            if timeline.get('kind') == 'summary-transition':
                offset += timeline['duration']
                continue
            shot_index += 1
            last = max((event['time'] for event in timeline['events'] if event['type'] in ['board','formula','highlight']), default=.5)
            requested.append((offset+min(timeline['duration']-1/manifest['fps'],last+.5), f'keyframes/{shot_index:03}.png'))
            offset += timeline['duration']
        (output/'keyframes').mkdir(exist_ok=True)
        count = 0; previous = -1
        with av.open(str(output/'video.mp4')) as video:
            for frame in video.decode(video=0):
                when = float(frame.time or 0)
                audit.check(when>previous, '视频解码帧顺序异常'); previous=when; count+=1
                while requested and when>=requested[0][0]-1e-6:
                    _,name=requested.pop(0);frame.to_image().save(output/name);keyframes.append(name)
        audit.check(abs(count-round(offset*manifest['fps']))<=1, '视频解码帧数不完整')
        audit.check(not requested, '视频缺少镜头关键帧')
        if audit.video is not None:audit.video['decodedFrames']=count
    except Exception as error:
        audit.errors.append(str(error))
    report={'status':'failed' if audit.errors else 'passed','projectId':project['id'],'projectRevision':project['revision'],
            'checkedShots':audit.shots,'checkedTransitions':checked_transitions,'errors':audit.errors,'warnings':audit.warnings,'cueChecks':audit.cues,
            'videoChecks':audit.video,'geometryChecks':audit.geometry,'actualMp4AudioChecks':audit.audio_lags,'keyframes':keyframes,
            'maxCueMetadataErrorSeconds':max((c['errorSeconds'] for c in audit.cues),default=None),
            'maxMeasuredMp4AudioShiftSeconds':max((abs(c['measuredShiftSeconds']) for c in audit.audio_lags),default=None),
            'toleranceSeconds':TOLERANCE,'humanReview':'pending'}
    save(output/'validation.json',report)
    if audit.errors:raise PipelineError('成片自动验收失败：'+'；'.join(audit.errors[:6]),code='validation_failed',stage='validation')
    return report


if __name__ == '__main__':
    from video_runtime import watch_parent
    watch_parent()
    if '--manifest' in sys.argv:
        parser=argparse.ArgumentParser();parser.add_argument('--manifest',required=True);args=parser.parse_args()
        validate_manifest(load(args.manifest))
    else:main()
