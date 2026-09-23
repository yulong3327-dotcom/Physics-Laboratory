from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch
import wave

from pipeline import FFMPEG, build_timeline, concatenate_wav, load, render, run, save, write_srt
from video_runtime import write_integrity
from video_summary import normalize_summary_project, resolve_shot_template, summary_shot_ids
from video_transition import prepare_summary_transition, transition_boundaries


class SummaryIntentTest(unittest.TestCase):
    def project(self):
        return {'utterances': [{'id': f'u{i}'} for i in range(5)],
                'shots': [{'id': f's{i}', 'title': '讲解', 'chapter': 1, 'utteranceIds': [f'u{i}'],
                           'layout': {'template': 'explain', 'elements': {}}} for i in range(5)]}

    def test_anchored_summary_continues_until_next_chapter(self):
        project = self.project()
        project['scriptNotes'] = [
            {'kind': 'summary', 'utteranceId': 'u0', 'placement': 'after', 'sourceLine': 2},
            {'kind': 'chapter', 'text': '下一章', 'utteranceId': 'u3', 'sourceLine': 6},
            {'kind': 'summary', 'utteranceId': 'u4', 'placement': 'after', 'sourceLine': 9}]
        self.assertEqual(summary_shot_ids(project), {'s1', 's2'})
        normalized = normalize_summary_project(project)
        self.assertEqual(normalized['shots'][1]['layout']['template'], 'summary')
        self.assertEqual(project['shots'][1]['layout']['template'], 'explain')

    def test_heading_and_explicit_summary_with_no_narration_false_positives(self):
        project = self.project()
        project['shots'][0]['summary'] = '现在总结这个电路'
        project['utterances'][0]['text'] = '稍后总结'
        project['shots'][1].update(title='知识总结', sectionTitle='本课总结')
        project['shots'][2]['sectionTitle'] = '本课总结'
        project['shots'][3]['sectionTitle'] = '新知识'
        project['shots'][4]['layout']['template'] = 'summary'
        self.assertEqual(summary_shot_ids(project), {'s1', 's2', 's4'})
        self.assertEqual(resolve_shot_template({'title': 'Recap', 'layout': {'template': 'question'}}), 'summary')
        self.assertEqual(resolve_shot_template({'title': '讲解', 'summary': '总结'}), 'explain')

    def test_only_entering_summary_in_a_rendered_sequence_inserts_transition(self):
        project = self.project()
        for index in [1, 2, 4]: project['shots'][index]['layout']['template'] = 'summary'
        selected = [{'id': shot['id']} for shot in project['shots']]
        self.assertEqual(transition_boundaries(project, selected), ['s1', 's4'])
        self.assertEqual(transition_boundaries(project, [{'id': 's1'}]), [])
        self.assertEqual(transition_boundaries(project, [{'id': 's1'}, {'id': 's2'}]), [])

    def test_note_only_summary_is_resolved_for_preflight_and_measured_preview(self):
        from video_preflight import preflight
        project = {'id': 'p', 'revision': 1, 'title': '讲解', 'settings': {'fps': 24}, 'circuits': [],
                   'speakers': [{'id': 'teacher'}], 'utterances': [{'id': 'u', 'text': '回顾知识', 'speakerId': 'teacher'}],
                   'scriptNotes': [{'kind': 'summary', 'utteranceId': 'u', 'sourceLine': 2}],
                   'shots': [{'id': 's', 'title': '公式应用', 'chapter': 1, 'utteranceIds': ['u'],
                              'layout': {'template': 'explain'}, 'formulas': [], 'actions': [], 'holdSeconds': .4}]}
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            def static_process(args, **kwargs):
                request = load(args[args.index('--input') + 1])
                self.assertEqual(request['project']['shots'][0]['layout']['template'], 'summary')
                save(args[args.index('--output') + 1], {'status': 'passed', 'shotId': 's', 'warnings': [], 'errors': []})
            with patch('pipeline.run', side_effect=static_process):
                result = preflight({'project': project, 'outputDir': str(root / 'output'), 'cacheDir': str(root / 'cache'),
                                    'shots': [{'id': 's', 'cacheKey': 's'}]}, static_only=True)
            self.assertEqual(result['status'], 'passed')
            audio = {'text': '回顾知识', 'duration': .4, 'boundaries': [{'textOffset': 0, 'wordLength': 4, 'offset': 0, 'duration': .4}]}
            with patch('pipeline.speech', return_value=audio):
                timeline = build_timeline(project, project['shots'][0], {}, root, root)
            self.assertEqual(timeline['shot']['layout']['template'], 'summary')
            self.assertEqual(project['shots'][0]['layout']['template'], 'explain')


class SummaryTransitionRenderTest(unittest.TestCase):
    def test_actual_render_keeps_transition_audio_captions_and_keyframes_in_sync(self):
        import av
        import numpy as np
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            cache, output = root / 'cache', root / 'output'
            project = {'id': 'summary-smoke', 'revision': 1, 'title': '测试', 'settings': {'width': 320, 'height': 180, 'fps': 24},
                       'speakers': [{'id': 'teacher', 'voice': 'test'}], 'speech': {'provider': 'fish'},
                       'circuits': [], 'utterances': [], 'shots': []}
            selected = []
            for index, color in enumerate(['red', 'green', 'blue']):
                shot_id, uid = f's{index}', f'u{index}'
                text = ['开始讲解', '知识总结', '总结补充'][index]
                shot = {'id': shot_id, 'title': text, 'chapter': 1, 'utteranceIds': [uid],
                        'formulas': [], 'actions': [], 'boardTexts': [], 'highlights': [], 'holdSeconds': .4}
                project['shots'].append(shot)
                project['utterances'].append({'id': uid, 'text': text, 'speakerId': 'teacher'})
                selected.append({'id': shot_id, 'cacheKey': shot_id})
                directory = cache / 'shots' / shot_id
                directory.mkdir(parents=True)
                speech_file = directory / 'voice.wav'
                time = np.arange(9600) / 24000
                samples = np.sin(2 * np.pi * ((330 + index * 150) * time + 870 * time ** 2)) * 8000 * np.sin(np.pi * time / .4)
                with wave.open(str(speech_file), 'wb') as audio:
                    audio.setnchannels(1); audio.setsampwidth(2); audio.setframerate(24000)
                    audio.writeframes(samples.astype('<i2').tobytes())
                utterance = {'id': uid, 'text': text, 'speakerId': 'teacher', 'voice': 'test', 'speechSource': 'fish',
                             'alignment': 'measured_segments', 'audio': str(speech_file), 'start': .2, 'duration': .4,
                             'segments': [{'text': text, 'textOffset': 0, 'wordLength': len(text), 'offset': 0, 'duration': .4}]}
                timeline = {'duration': 1, 'utterances': [utterance], 'subtitles': [{'text': text, 'start': .2, 'end': .6}],
                            'events': [{'type': 'subtitle', 'time': .2, 'text': text}, {'type': 'subtitle', 'time': .6, 'text': ''}]}
                concatenate_wav(timeline, directory / 'narration.wav')
                save(directory / 'timeline.json', timeline)
                save(directory / 'result.json', {'duration': 1})
                write_srt(timeline['subtitles'], directory / 'subtitles.srt')
                run([FFMPEG, '-y', '-f', 'lavfi', '-i', f'color=c={color}:s=320x180:r=24:d=1',
                     '-i', directory / 'narration.wav', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-t', '1', directory / 'video.mp4'])
                write_integrity(directory, ['video.mp4', 'result.json', 'timeline.json', 'narration.wav', 'subtitles.srt'], save)
            manifest = {'project': project, 'shots': selected, 'cacheDir': str(cache), 'outputDir': str(output),
                        'width': 320, 'height': 180, 'fps': 24}
            with patch('video_preflight.preflight'):
                render(manifest)
            result, validation = load(output / 'result.json'), load(output / 'validation.json')
            self.assertEqual(validation['status'], 'passed')
            self.assertEqual(len(result['transitions']), 1)
            self.assertEqual(result['transitions'][0]['beforeShotId'], 's1')
            duration = result['transitions'][0]['duration']
            self.assertAlmostEqual(result['duration'], 3 + duration)
            self.assertEqual(len(validation['actualMp4AudioChecks']), 4)
            self.assertTrue(all(item['correlation'] > .85 for item in validation['actualMp4AudioChecks']))
            self.assertEqual(len(result['keyframes']), 3)
            from video_validation import srt
            captions = srt(output / 'subtitles.srt')
            self.assertAlmostEqual(captions[1]['start'], 1.2 + duration, delta=.001)
            self.assertAlmostEqual(captions[2]['start'], 2.2 + duration, delta=.001)
            transition_directory, metadata = prepare_summary_transition(cache, 320, 180, 24)
            with av.open(str(transition_directory / 'video.mp4')) as clip:
                self.assertEqual(len(list(clip.decode(video=0))), metadata['frames'])
            with wave.open(str(transition_directory / 'narration.wav'), 'rb') as audio:
                self.assertAlmostEqual(audio.getnframes() / 24000, duration)
                self.assertGreater(np.max(np.abs(np.frombuffer(audio.readframes(audio.getnframes()), dtype='<i2'))), 100)


if __name__ == '__main__':
    unittest.main()
