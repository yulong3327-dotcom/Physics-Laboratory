"""Production-node isolation with real cache checks and no media subprocesses."""
from contextlib import contextmanager
from copy import deepcopy
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch
import wave

import pipeline
from video_runtime import PipelineError, check_integrity, write_integrity


CACHE_FILES = ['video.mp4', 'result.json', 'timeline.json', 'narration.wav', 'subtitles.srt']


def manifest_in(directory):
    root = Path(directory)
    # Deliberately not sorted: production and recovery must retain lesson order.
    shot_ids = ['s9', 's2', 's7']
    project = {
        'id': 'isolation-course', 'revision': 4, 'title': '独立镜头恢复',
        'settings': {'width': 1920, 'height': 1080, 'fps': 24, 'background': '#ffffff'},
        'speakers': [{'id': 'teacher', 'name': '方大招', 'voice': 'fixture', 'color': '#123456'}],
        'speech': {'provider': 'edge', 'model': 'edge', 'chunkLength': 200, 'pauseSeconds': .2},
        'utterances': [{'id': f'u-{sid}', 'speakerId': 'teacher', 'text': f'讲解 {sid}。'} for sid in shot_ids],
        'circuits': [],
        'shots': [{'id': sid, 'title': f'镜头 {sid}', 'chapter': 1, 'utteranceIds': [f'u-{sid}'],
                   'formulas': [], 'actions': [], 'boardTexts': [{'id': f'b-{sid}', 'text': '电流相等', 'kind': 'law'}],
                   'highlights': [], 'holdSeconds': 0} for sid in shot_ids],
    }
    return {'project': project, 'rendererVersion': 'fixture-renderer-v1',
            'shots': [{'id': sid, 'cacheKey': f'cache-{sid}'} for sid in shot_ids],
            'cacheDir': str(root / 'cache'), 'outputDir': str(root / 'out'),
            'width': 1280, 'height': 720, 'fps': 24}


class MediaFixture:
    """Only external generation is mocked; render orchestration and checksums run."""
    def __init__(self, manifest):
        self.manifest = manifest
        self.preflight_calls = []
        self.draw_calls = []
        self.assembly_calls = []
        self.validation_calls = 0
        self.failures = {}
        self.before_draw = None

    def preflight(self, manifest, *args, **kwargs):
        if len(manifest['shots']) != 1:
            raise AssertionError('Production preflight must operate on one selected shot')
        item = manifest['shots'][0]
        self.preflight_calls.append(item['id'])
        if self.failures.get(item['id']) == 'preflight':
            raise PipelineError('synthetic preflight failure', code='speech_network', retryable=True,
                                stage='speech_timeline', shot_id=item['id'])
        self.assert_node_directory(manifest, item)
        directory = Path(manifest['cacheDir']) / 'shots' / item['cacheKey']
        directory.mkdir(parents=True, exist_ok=True)
        shot = next(shot for shot in manifest['project']['shots'] if shot['id'] == item['id'])
        timeline = {'shot': shot, 'duration': 1, 'events': [], 'utterances': [],
                    'subtitles': [{'start': 0, 'end': 1, 'text': f'讲解 {item["id"]}。'}]}
        pipeline.save(directory / 'timeline.json', timeline)
        with wave.open(str(directory / 'narration.wav'), 'wb') as audio:
            audio.setnchannels(1)
            audio.setsampwidth(2)
            audio.setframerate(24000)
            audio.writeframes(b'\x01\x00' * 24000)
        pipeline.write_srt(timeline['subtitles'], directory / 'subtitles.srt')
        pipeline.save(directory / 'static.json', {'status': 'passed', 'shotId': item['id'], 'errors': [], 'warnings': []})
        write_integrity(directory, ['static.json'], pipeline.save, 'static.complete.json')
        audio_directory = directory / 'audio'
        audio_directory.mkdir(exist_ok=True)
        names = ['timeline.json', 'narration.wav', 'subtitles.srt']
        for uid in shot['utteranceIds']:
            (audio_directory / f'{uid}.wav').write_bytes((directory / 'narration.wav').read_bytes())
            pipeline.save(audio_directory / f'{uid}.json', {'duration': 1, 'boundaries': []})
            names.extend([f'audio/{uid}.wav', f'audio/{uid}.json'])
        write_integrity(directory, names, pipeline.save, 'timeline.complete.json')
        report = {'status': 'passed', 'shots': [{**item, 'duration': 1}], 'errors': [], 'warnings': []}
        pipeline.save(Path(manifest['outputDir']) / 'preflight.json', report)
        return report

    def assert_node_directory(self, manifest, item):
        expected = Path(self.manifest['outputDir']) / 'nodes' / item['id']
        if Path(manifest['outputDir']) != expected:
            raise AssertionError(f'Expected per-shot preflight output at {expected}')

    def run(self, args, **kwargs):
        arguments = [str(value) for value in args]
        if '-m' in arguments and arguments[arguments.index('-m') + 1] == 'manim':
            timeline = pipeline.load(kwargs['env']['VIDEO_TIMELINE'])
            sid = timeline['shot']['id']
            self.draw_calls.append(sid)
            if self.before_draw:
                self.before_draw(sid)
            if self.failures.get(sid) == 'render':
                raise PipelineError('synthetic draw failure', code='process_failed', retryable=True,
                                    stage='render', shot_id=sid)
            media = Path(arguments[arguments.index('--media_dir') + 1])
            video = media / 'videos' / 'fixture' / 'visual.mp4'
            video.parent.mkdir(parents=True, exist_ok=True)
            video.write_bytes(f'visual-{sid}'.encode())
        elif any(Path(argument).name == 'video_validation.py' for argument in arguments):
            self.validation_calls += 1
            quality = pipeline.load(arguments[arguments.index('--manifest') + 1])
            pipeline.save(Path(quality['outputDir']) / 'validation.json', {'status': 'passed', 'keyframes': [], 'errors': [], 'warnings': []})
        elif '-f' in arguments and arguments[arguments.index('-f') + 1] == 'concat':
            listing = Path(arguments[arguments.index('-i') + 1])
            videos = [listing.parent / line[6:-1] for line in listing.read_text(encoding='utf-8').splitlines() if line.startswith("file '")]
            self.assembly_calls.append([video.read_bytes() for video in videos])
            Path(arguments[-1]).write_bytes(b'complete-course-video')
        elif arguments[0] == str(pipeline.FFMPEG):
            # Per-shot audio muxing copies our distinct fixture visual bytes.
            source = Path(arguments[arguments.index('-i') + 1])
            Path(arguments[-1]).write_bytes(source.read_bytes())
        else:
            raise AssertionError(f'Unexpected subprocess: {arguments}')
        return ''

    @contextmanager
    def installed(self):
        with patch('video_preflight.preflight', side_effect=self.preflight), \
             patch('pipeline.run', side_effect=self.run), \
             patch('pipeline.emit'):
            yield self


class ProductionNodesTest(unittest.TestCase):
    def test_manim_scratch_is_short_isolated_and_cleaned_after_success_or_failure(self):
        for failure in [False, True]:
            with self.subTest(failure=failure), tempfile.TemporaryDirectory() as root:
                manifest = manifest_in(Path(root) / ('nested-deployment-' * 4))
                fixture = MediaFixture(manifest)
                scratch_paths = []
                original_run = fixture.run
                def track_media(args, **kwargs):
                    arguments = [str(value) for value in args]
                    if '--media_dir' in arguments:
                        media = Path(arguments[arguments.index('--media_dir') + 1])
                        scratch_paths.append(media)
                        self.assertFalse(media.is_relative_to(Path(manifest['cacheDir'])))
                        self.assertLess(len(str(media / 'videos/scene/720p24/partial_movie_files/LessonShot/partial_movie_file_list.txt')), 240)
                        self.assertTrue(media.is_dir())
                    return original_run(args, **kwargs)
                fixture.run = track_media
                if failure:
                    fixture.failures['s9'] = 'render'
                with fixture.installed():
                    if failure:
                        with self.assertRaises(PipelineError):
                            pipeline.render(manifest)
                    else:
                        pipeline.render(manifest)
                self.assertEqual(len(scratch_paths), 3)
                self.assertEqual(len(set(scratch_paths)), 3)
                self.assertTrue(all(not path.exists() for path in scratch_paths))
                for sid in ['s2', 's7']:
                    self.assert_successful_cache(manifest, sid)
                self.assertEqual((Path(manifest['outputDir']) / 'result.json').exists(), not failure)

    def report(self, manifest):
        return pipeline.load(Path(manifest['outputDir']) / 'production-nodes.json')

    def assert_successful_cache(self, manifest, shot_id):
        item = next(item for item in manifest['shots'] if item['id'] == shot_id)
        directory = Path(manifest['cacheDir']) / 'shots' / item['cacheKey']
        self.assertTrue(check_integrity(directory, CACHE_FILES), shot_id)
        return directory

    def test_first_failure_isolated_and_restart_only_generates_failed_shot(self):
        for failed_stage in ['preflight', 'render']:
            with self.subTest(stage=failed_stage), tempfile.TemporaryDirectory() as directory:
                manifest = manifest_in(directory)
                original = deepcopy(manifest)
                fixture = MediaFixture(manifest)
                fixture.failures['s9'] = failed_stage
                persisted_during_work = []

                def inspect_persistence(sid):
                    if sid == 's2':
                        persisted_during_work.append(self.report(manifest))

                fixture.before_draw = inspect_persistence
                with fixture.installed():
                    with self.assertRaises(PipelineError) as failed:
                        pipeline.render(manifest)
                self.assertEqual(failed.exception.code, 'production_incomplete')
                self.assertTrue(any(issue['shotId'] == 's9' for issue in failed.exception.issues))
                report = self.report(manifest)
                self.assertEqual(report['schemaVersion'], 1)
                self.assertEqual(report['projectId'], 'isolation-course')
                self.assertEqual(report['projectRevision'], 4)
                self.assertEqual(report['status'], 'failed')
                self.assertEqual([node['shotId'] for node in report['nodes']], ['s9', 's2', 's7'])
                self.assertEqual([node['status'] for node in report['nodes']], ['failed', 'succeeded', 'succeeded'])
                self.assertEqual(report['missingShotIds'], ['s9'])
                self.assertEqual(fixture.preflight_calls, ['s9', 's2', 's7'])
                self.assertEqual(fixture.draw_calls, ['s2', 's7'] if failed_stage == 'preflight' else ['s9', 's2', 's7'])
                self.assertEqual(fixture.assembly_calls, [], 'incomplete lessons cannot be silently shortened')
                self.assertEqual(fixture.validation_calls, 0)
                self.assertFalse((Path(manifest['outputDir']) / 'video.mp4').exists())
                self.assertEqual(len(persisted_during_work), 1)
                self.assertEqual(persisted_during_work[0]['status'], 'running')
                self.assertEqual(persisted_during_work[0]['nodes'][0]['status'], 'failed', 'failure must survive a later process interruption')
                good_directories = [self.assert_successful_cache(manifest, sid) for sid in ['s2', 's7']]
                before = [{name: (path / name).read_bytes() for name in CACHE_FILES} for path in good_directories]

                # A new execution object simulates losing all worker memory.
                recovered = MediaFixture(manifest)
                with recovered.installed():
                    pipeline.render(manifest)
                self.assertEqual(recovered.preflight_calls, ['s9'])
                self.assertEqual(recovered.draw_calls, ['s9'])
                self.assertEqual(recovered.assembly_calls, [[b'visual-s9', b'visual-s2', b'visual-s7']])
                self.assertEqual(recovered.validation_calls, 1)
                completed = self.report(manifest)
                self.assertEqual(completed['status'], 'succeeded')
                self.assertEqual(completed['missingShotIds'], [])
                self.assertTrue(all(node['status'] == 'succeeded' for node in completed['nodes']))
                self.assertTrue(all(node['cached'] for node in completed['nodes'][1:]))
                self.assertGreater(completed['nodes'][0]['attempts'], report['nodes'][0]['attempts'])
                self.assertEqual(before, [{name: (path / name).read_bytes() for name in CACHE_FILES} for path in good_directories])
                self.assertEqual(pipeline.load(Path(manifest['outputDir']) / 'result.json')['cachedShots'], 2)
                self.assertEqual(pipeline.load(Path(manifest['outputDir']) / 'result.json')['validation']['status'], 'passed')
                self.assertEqual(manifest, original, 'render must not rewrite caller-owned project data')

    def test_all_failed_nodes_reported_in_order_and_no_partial_output_is_assembled(self):
        with tempfile.TemporaryDirectory() as directory:
            manifest = manifest_in(directory)
            fixture = MediaFixture(manifest)
            fixture.failures = {'s9': 'preflight', 's7': 'render'}
            with fixture.installed(), \
                 patch('video_transition.transition_boundaries', return_value=['s7']), \
                 patch('video_transition.prepare_summary_transition') as transition:
                with self.assertRaises(PipelineError) as failed:
                    pipeline.render(manifest)
            self.assertEqual(failed.exception.code, 'production_incomplete')
            self.assertEqual([issue['shotId'] for issue in failed.exception.issues], ['s9', 's7'])
            self.assertEqual(self.report(manifest)['missingShotIds'], ['s9', 's7'])
            self.assert_successful_cache(manifest, 's2')
            self.assertEqual(fixture.preflight_calls, ['s9', 's2', 's7'])
            self.assertEqual(fixture.assembly_calls, [])
            self.assertEqual(fixture.validation_calls, 0)
            transition.assert_not_called()

    def test_same_size_cache_corruption_rebuilds_only_damaged_node(self):
        with tempfile.TemporaryDirectory() as directory:
            manifest = manifest_in(directory)
            initial = MediaFixture(manifest)
            with initial.installed():
                pipeline.render(manifest)
            damaged = self.assert_successful_cache(manifest, 's2') / 'video.mp4'
            original = damaged.read_bytes()
            damaged.write_bytes(b'x' * len(original))
            self.assertFalse(check_integrity(damaged.parent, CACHE_FILES))
            recovered = MediaFixture(manifest)
            with recovered.installed():
                pipeline.render(manifest)
            self.assertEqual(recovered.preflight_calls, ['s2'])
            self.assertEqual(recovered.draw_calls, ['s2'])
            self.assertEqual(damaged.read_bytes(), original)
            self.assertEqual(recovered.assembly_calls, [[b'visual-s9', b'visual-s2', b'visual-s7']])
            self.assert_successful_cache(manifest, 's2')
            self.assertEqual(self.report(manifest)['status'], 'succeeded')

    def test_verified_cache_survives_absent_node_journal_without_regeneration(self):
        with tempfile.TemporaryDirectory() as directory:
            manifest = manifest_in(directory)
            initial = MediaFixture(manifest)
            with initial.installed():
                pipeline.render(manifest)
            (Path(manifest['outputDir']) / 'production-nodes.json').unlink()
            recovered = MediaFixture(manifest)
            with recovered.installed():
                pipeline.render(manifest)
            self.assertEqual(recovered.preflight_calls, [])
            self.assertEqual(recovered.draw_calls, [])
            self.assertEqual(recovered.assembly_calls, [[b'visual-s9', b'visual-s2', b'visual-s7']])
            self.assertTrue(all(node['cached'] for node in self.report(manifest)['nodes']))
            self.assertEqual(pipeline.load(Path(manifest['outputDir']) / 'result.json')['cachedShots'], 3)

    def test_same_size_source_audio_damage_repairs_only_affected_preflight(self):
        with tempfile.TemporaryDirectory() as directory:
            manifest = manifest_in(directory)
            initial = MediaFixture(manifest)
            with initial.installed():
                pipeline.render(manifest)
            directory = self.assert_successful_cache(manifest, 's2')
            damaged = directory / 'audio' / 'u-s2.wav'
            original = damaged.read_bytes()
            damaged.write_bytes(original[:-2] + b'\x02\x00')
            names = ['timeline.json', 'narration.wav', 'subtitles.srt', 'audio/u-s2.wav', 'audio/u-s2.json']
            self.assertFalse(check_integrity(directory, names, 'timeline.complete.json'))
            self.assertTrue(check_integrity(directory, CACHE_FILES), 'the video checksum alone cannot certify source audio')
            recovered = MediaFixture(manifest)
            with recovered.installed():
                pipeline.render(manifest)
            self.assertEqual(recovered.preflight_calls, ['s2'])
            self.assertEqual(recovered.draw_calls, [], 'the complete video can be reused when repaired audio is identical')
            self.assertEqual(damaged.read_bytes(), original)
            self.assertTrue(check_integrity(directory, names, 'timeline.complete.json'))
            self.assertEqual(self.report(manifest)['status'], 'succeeded')

    def test_failed_rebuild_cannot_expose_an_old_completed_course(self):
        with tempfile.TemporaryDirectory() as directory:
            manifest = manifest_in(directory)
            initial = MediaFixture(manifest)
            with initial.installed():
                pipeline.render(manifest)
            output = Path(manifest['outputDir'])
            self.assertTrue((output / 'video.mp4').exists())
            damaged = self.assert_successful_cache(manifest, 's2') / 'video.mp4'
            damaged.unlink()
            recovered = MediaFixture(manifest)
            recovered.failures['s2'] = 'render'
            with recovered.installed():
                with self.assertRaises(PipelineError) as failed:
                    pipeline.render(manifest)
            self.assertEqual(failed.exception.code, 'production_incomplete')
            self.assertEqual(self.report(manifest)['missingShotIds'], ['s2'])
            self.assertFalse((output / 'result.json').exists(), 'an old completion receipt must not certify the failed rebuild')
            self.assertFalse((output / 'video.mp4').exists(), 'the job must not expose stale output as the current render')
            self.assertEqual(recovered.assembly_calls, [])
            self.assert_successful_cache(manifest, 's9')
            self.assert_successful_cache(manifest, 's7')

    def test_process_interruption_leaves_receipt_and_resume_reuses_completed_shot(self):
        class ProcessInterrupted(BaseException): pass
        with tempfile.TemporaryDirectory() as directory:
            manifest = manifest_in(directory)
            interrupted = MediaFixture(manifest)
            def stop_in_second_shot(sid):
                if sid == 's2': raise ProcessInterrupted()
            interrupted.before_draw = stop_in_second_shot
            with interrupted.installed():
                with self.assertRaises(ProcessInterrupted): pipeline.render(manifest)
            self.assertEqual([node['status'] for node in self.report(manifest)['nodes']], ['succeeded', 'running', 'queued'])
            self.assert_successful_cache(manifest, 's9')
            self.assertFalse((Path(manifest['outputDir']) / 'result.json').exists())
            recovered = MediaFixture(manifest)
            with recovered.installed(): pipeline.render(manifest)
            self.assertEqual(recovered.preflight_calls, ['s2', 's7'])
            self.assertEqual(recovered.draw_calls, ['s2', 's7'])
            self.assertEqual(pipeline.load(Path(manifest['outputDir']) / 'result.json')['cachedShots'], 1)

    def test_assembly_failure_persists_failed_phase_and_keeps_all_successful_nodes(self):
        with tempfile.TemporaryDirectory() as directory:
            manifest = manifest_in(directory)
            fixture = MediaFixture(manifest)
            real_run = fixture.run
            def failed_assembly(args, **kwargs):
                arguments = [str(arg) for arg in args]
                if '-f' in arguments and arguments[arguments.index('-f') + 1] == 'concat':
                    raise PipelineError('disk exhausted', code='output_full', stage='assembly')
                return real_run(args, **kwargs)
            fixture.run = failed_assembly
            with fixture.installed():
                with self.assertRaisesRegex(PipelineError, 'disk exhausted'): pipeline.render(manifest)
            report = self.report(manifest)
            self.assertEqual(report['status'], 'failed')
            self.assertEqual(report['phase'], 'assembly')
            self.assertEqual(report['error']['code'], 'output_full')
            self.assertTrue(all(node['status'] == 'succeeded' for node in report['nodes']))
            self.assertEqual(report['missingShotIds'], [])
            self.assertFalse((Path(manifest['outputDir']) / 'result.json').exists())
            recovered = MediaFixture(manifest)
            with recovered.installed(): pipeline.render(manifest)
            self.assertEqual(recovered.preflight_calls, [])
            self.assertEqual(recovered.draw_calls, [])
            self.assertEqual(len(recovered.assembly_calls), 1)

    def test_failed_validation_cannot_publish_completion_and_resume_keeps_shots(self):
        with tempfile.TemporaryDirectory() as directory:
            manifest = manifest_in(directory)
            fixture = MediaFixture(manifest)
            real_run = fixture.run
            def failed_validation(args, **kwargs):
                result = real_run(args, **kwargs)
                if any(Path(str(argument)).name == 'video_validation.py' for argument in args):
                    pipeline.save(Path(manifest['outputDir']) / 'validation.json',
                                  {'status': 'failed', 'errors': ['narration truncated']})
                return result
            fixture.run = failed_validation
            with fixture.installed():
                with self.assertRaises(PipelineError) as failed:
                    pipeline.render(manifest)
            self.assertEqual(failed.exception.code, 'validation_failed')
            self.assertEqual(self.report(manifest)['phase'], 'validation')
            self.assertEqual(self.report(manifest)['status'], 'failed')
            self.assertTrue(all(node['status'] == 'succeeded' for node in self.report(manifest)['nodes']))
            self.assertFalse((Path(manifest['outputDir']) / 'result.json').exists())
            recovered = MediaFixture(manifest)
            with recovered.installed():
                pipeline.render(manifest)
            self.assertEqual(recovered.draw_calls, [])
            self.assertEqual(recovered.preflight_calls, [])
            self.assertEqual(self.report(manifest)['status'], 'succeeded')

    def test_cross_volume_segment_copy_fallback_preserves_lesson_order(self):
        with tempfile.TemporaryDirectory() as directory:
            manifest = manifest_in(directory)
            fixture = MediaFixture(manifest)
            with fixture.installed(), patch('pipeline.os.link', side_effect=OSError('different device')):
                pipeline.render(manifest)
            self.assertEqual(fixture.assembly_calls, [[b'visual-s9', b'visual-s2', b'visual-s7']])
            self.assertEqual(self.report(manifest)['status'], 'succeeded')


if __name__ == '__main__':
    unittest.main()
