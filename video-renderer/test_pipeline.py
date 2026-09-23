import unittest
from unittest.mock import patch, AsyncMock
from pathlib import Path
import tempfile
from pipeline import build_timeline, portable_shots, measured_segments, measured_cue, fish_generate, edge_generate, edge_generate_async
from copy import deepcopy
import os
import json
import asyncio
from pipeline import pronunciation_text, resolve_cue, make_subtitles
from video_runtime import PipelineError


class TimelineTest(unittest.TestCase):
    def test_board_and_formula_highlights_follow_measured_word_events(self):
        cue = {'utteranceId': 'u1', 'phrase': '功率'}
        project = {'title': 'test', 'settings': {'fps': 24}, 'speakers': [{'id': 'teacher'}], 'circuits': [], 'utterances': [{'id': 'u1', 'speakerId': 'teacher', 'text': '求功率'}]}
        shot = {'id': 's', 'utteranceIds': ['u1'], 'boardTexts': [{'id': 'b', 'text': '功率'}], 'formulas': [{'id': 'f', 'cue': cue}], 'actions': [], 'highlights': [{'id': 'h', 'targetType': 'formula', 'targetId': 'f', 'phrase': 'P', 'cue': cue}], 'holdSeconds': .5}
        audio = {'text': '求功率', 'duration': 1.2, 'boundaries': [{'textOffset': 0, 'wordLength': 1, 'offset': .1, 'duration': .2}, {'textOffset': 1, 'wordLength': 2, 'offset': .413, 'duration': .6}]}
        with tempfile.TemporaryDirectory() as directory, patch('pipeline.speech', return_value=audio):
            timeline = build_timeline(project, shot, {}, Path(directory), Path(directory))
        self.assertEqual(timeline['events'][0]['type'], 'board')
        events = [e for e in timeline['events'] if e['type'] in ['formula', 'highlight']]
        self.assertEqual([e['type'] for e in events], ['formula', 'highlight'])
        self.assertAlmostEqual(events[0]['time'], 1.013)
        self.assertEqual(events[0]['time'], events[1]['time'])
        shot['highlights'][0]['cue'] = {'utteranceId': 'u1', 'phrase': '求'}
        with tempfile.TemporaryDirectory() as directory, patch('pipeline.speech', return_value=audio), self.assertRaisesRegex(PipelineError, '尚未出现'):
            build_timeline(project, shot, {}, Path(directory), Path(directory))

    def test_pronunciation_preserves_original_positions(self):
        spoken, offsets = pronunciation_text('P1等于UI，求R2')
        self.assertEqual(spoken, 'P 一等于U乘I，求R 二')
        self.assertEqual(offsets[0], 0)
        self.assertEqual(offsets[-1], 9)
        self.assertEqual(len(spoken), len(offsets))

    def test_shot_duration_is_frame_aligned_without_moving_word_cues(self):
        project = {'title': 'test', 'settings': {'fps': 24}, 'speakers': [{'id': 'teacher'}], 'circuits': [], 'utterances': [{'id': 'u1', 'speakerId': 'teacher', 'text': '测试'}]}
        shot = {'id': 'shot-1', 'utteranceIds': ['u1'], 'formulas': [{'id': 'f1', 'cue': {'utteranceId': 'u1', 'phrase': '测试'}}], 'actions': [], 'holdSeconds': .5}
        utterance = {'id': 'u1', 'text': '测试', 'duration': 1.037, 'boundaries': [{'textOffset': 0, 'wordLength': 2, 'offset': .123, 'duration': .5}]}
        with tempfile.TemporaryDirectory() as directory, patch('pipeline.speech', return_value=utterance):
            timeline = build_timeline(project, shot, {}, Path(directory), Path(directory))
        self.assertAlmostEqual(timeline['duration'] * 24, round(timeline['duration'] * 24))
        event = next(e for e in timeline['events'] if e['type'] == 'formula')
        self.assertAlmostEqual(event['time'], .723)
        self.assertLessEqual(timeline['subtitles'][-1]['end'], timeline['duration'])

    def test_exported_cache_reuses_only_unchanged_shots(self):
        baseline = {'title': 'test', 'settings': {'fps': 24}, 'speakers': [{'id': 'teacher'}], 'circuits': [],
                    'utterances': [{'id': 'u1', 'speakerId': 'teacher', 'text': '第一段'}, {'id': 'u2', 'speakerId': 'teacher', 'text': '第二段'}],
                    'shots': [{'id': 's1', 'utteranceIds': ['u1']}, {'id': 's2', 'utteranceIds': ['u2']}]}
        recipe = {'rendererVersion': 'v1', 'shots': [{'id': 's1', 'cacheKey': 'old-1'}, {'id': 's2', 'cacheKey': 'old-2'}]}
        revised = deepcopy(baseline); revised['utterances'][0]['text'] += ' 修改。'
        resolved = portable_shots(revised, recipe, baseline, 'v1')
        self.assertNotEqual(resolved[0]['cacheKey'], 'old-1')
        self.assertEqual(resolved[1]['cacheKey'], 'old-2')
        renderer_changed = portable_shots(baseline, recipe, baseline, 'v2')
        self.assertNotEqual(renderer_changed[1]['cacheKey'], 'old-2')

    def test_subtitles_do_not_split_a_measured_word_or_overlap(self):
        text = '现在计算电功率并求答案。'
        words = [('现在', 0), ('计算', 2), ('电功率', 4), ('并', 7), ('求', 8), ('答案', 9)]
        boundaries = [{'textOffset': at, 'wordLength': len(word), 'offset': index*.4, 'duration': .4} for index, (word, at) in enumerate(words)]
        chunks = make_subtitles(text, boundaries, 2.5, max_chars=5)
        self.assertEqual(''.join(c['text'] for c in chunks), text)
        self.assertTrue(all(a['end'] <= b['start'] for a, b in zip(chunks, chunks[1:])))
        self.assertTrue(any('电功率' in c['text'] for c in chunks))

    def test_fish_split_has_real_start_for_every_cue_without_reordering_text(self):
        text = '先求电压，再用电压乘电流。'
        cues = [{'phrase': '电压'}, {'phrase': '再用'}]
        spans = measured_segments(text, cues)
        self.assertEqual(''.join(s['text'] for s in spans), text)
        segments = [{'textOffset': s['start'], 'offset': index*1.1} for index, s in enumerate(spans)]
        at = next(s['offset'] for s in segments if s['textOffset'] == text.index('电压'))
        self.assertEqual(measured_cue(cues[0], text, segments, 20), at)
        with self.assertRaisesRegex(ValueError, '真实合成片段'):
            measured_cue({'phrase': '乘电流'}, text, segments, 20)

    def test_fish_proxy_cdn_download_does_not_receive_service_token(self):
        with tempfile.TemporaryDirectory() as directory, patch.dict(os.environ, {'FISH_TTS_BASE_URL': 'https://school.example/projects', 'FISH_TTS_TOKEN': 'private'}, clear=True), patch('pipeline.fetch_audio', side_effect=[(b'{"url":"https://cdn.example/audio.mp3"}', 'application/json'), (b'audio', 'audio/mpeg')]) as fetch:
            fish_generate('电功率', '4f6e2feedf794916879cc41cb577de56', {'model': 's2-pro', 'chunkLength': 200}, Path(directory)/'voice.mp3')
            self.assertEqual(fetch.call_args_list[0].args[0], 'https://school.example/api/tts/generate')
            body = json.loads(fetch.call_args_list[0].args[1])
            self.assertEqual(body['reference_id'], '4f6e2feedf794916879cc41cb577de56')
            self.assertEqual(body['model'], 's2-pro')
            self.assertEqual(fetch.call_args_list[1].kwargs['headers'], {})

    def test_fish_direct_uses_documented_model_header(self):
        with tempfile.TemporaryDirectory() as directory, patch.dict(os.environ, {'FISH_API_KEY': 'private'}, clear=True), patch('pipeline.fetch_audio', return_value=(b'audio', 'audio/mpeg')) as fetch:
            fish_generate('功率', 'ba0fa9dc2da541e0a565533ce6949795', {'model': 's2-pro', 'chunkLength': 200}, Path(directory)/'voice.mp3')
            self.assertEqual(fetch.call_args.args[0], 'https://api.fish.audio/v1/tts')
            self.assertEqual(fetch.call_args.args[2]['model'], 's2-pro')
            self.assertEqual(fetch.call_args.args[2]['Authorization'], 'Bearer private')

    def test_edge_timeout_retries_are_bounded_and_do_not_leak_signed_urls(self):
        import aiohttp
        signed_url = 'https://edge.example/speech?TrustedClientToken=private&GEC=signature'
        with patch('pipeline.edge_generate_async', new=AsyncMock(side_effect=aiohttp.ConnectionTimeoutError(signed_url))) as generate, patch('pipeline.time.sleep'):
            with self.assertRaises(RuntimeError) as raised:
                edge_generate('测试', 'zh-CN-YunyangNeural', 'unused.mp3')
            self.assertEqual(generate.await_count, 3)
            self.assertIn('3', str(raised.exception))
            self.assertNotIn('TrustedClientToken', str(raised.exception))
            self.assertNotIn('private', str(raised.exception))

    def test_edge_uses_system_proxy_and_explicit_setting_takes_precedence(self):
        calls = []
        class Communication:
            def __init__(self, text, voice, boundary=None, proxy=None):
                calls.append({'proxy': proxy, 'boundary': boundary})
            async def stream(self):
                yield {'type': 'audio', 'data': b'actual-provider-fixture'}
                yield {'type': 'WordBoundary', 'text': '测试', 'offset': 1000000, 'duration': 2000000}
        with tempfile.TemporaryDirectory() as directory, patch('edge_tts.Communicate', Communication), patch('pipeline.urllib.request.getproxies', return_value={'https': 'http://127.0.0.1:8000'}), patch.dict(os.environ, {}, clear=True):
            events = asyncio.run(edge_generate_async('测试', 'zh-CN-YunyangNeural', Path(directory)/'sample.mp3'))
            self.assertEqual(calls[-1], {'proxy': 'http://127.0.0.1:8000', 'boundary': 'WordBoundary'})
            self.assertEqual(events[0]['offset'], .1)
            with patch.dict(os.environ, {'EDGE_TTS_PROXY': 'http://127.0.0.1:9000'}):
                asyncio.run(edge_generate_async('测试', 'zh-CN-YunyangNeural', Path(directory)/'explicit.mp3'))
            self.assertEqual(calls[-1]['proxy'], 'http://127.0.0.1:9000')

    def test_wrapped_sentence_final_punctuation_is_preserved_before_next_sentence(self):
        text = '计算R3。然后继续。'
        words = [('计算', 0), ('R3', 2), ('然后', 5), ('继续', 7)]
        boundaries = [{'textOffset': at, 'wordLength': len(word), 'offset': index*.4, 'duration': .4} for index, (word, at) in enumerate(words)]
        captions = make_subtitles(text, boundaries, 1.8, max_chars=4)
        self.assertEqual(''.join(c['text'] for c in captions), text)
        self.assertTrue(all(c['end'] > c['start'] for c in captions))
        self.assertTrue(captions[0]['text'].endswith('。'))

    def test_real_chinese_sentences_remain_separate_subtitle_intervals(self):
        text = '咱们已经学过，电功是电能转化的量度。电功率是表示电流做功快慢的物理量。'
        boundaries = [{'textOffset': i, 'wordLength': 1, 'offset': i*.2, 'duration': .2} for i, char in enumerate(text) if char.isalnum()]
        captions = make_subtitles(text, boundaries, len(text)*.2)
        self.assertEqual(''.join(c['text'] for c in captions), text)
        self.assertGreaterEqual(len(captions), 3)
        self.assertEqual(captions[0]['text'], '咱们已经学过，')
        self.assertLess(captions[0]['end'], 2)
        self.assertGreater(captions[-1]['start'], 2)

    def test_ratio_word_crossing_punctuation_keeps_one_caption(self):
        text = '功率比为9:6:2，继续。'
        words = [(0, 4, 0.0), (4, 1, 1.0), (6, 3, 1.5), (10, 2, 2.2)]
        boundaries = [{'textOffset': at, 'wordLength': length, 'offset': offset,
                       'duration': .4} for at, length, offset in words]
        captions = make_subtitles(text, boundaries, 3)
        self.assertEqual(''.join(c['text'] for c in captions), text)
        self.assertTrue(all(a['end'] <= b['start'] for a, b in zip(captions, captions[1:])))
        self.assertTrue(any('6:2' in c['text'] for c in captions))

    def test_keywords_are_measured(self):
        text = '先求电压，再求功率。'
        boundaries = [{'textOffset': i, 'wordLength': 1, 'offset': i * .2, 'duration': .2} for i in range(len(text))]
        self.assertAlmostEqual(resolve_cue({'phrase': '电压'}, text, boundaries, 3), .4)
        with self.assertRaisesRegex(ValueError, '时间事件'):
            resolve_cue({'phrase': '电压'}, text, [], 3)
        with self.assertRaisesRegex(ValueError, '找不到'):
            resolve_cue({'phrase': '电流'}, text, boundaries, 3)

    def test_subtitle_chunks_keep_all_source_text_with_no_overlap(self):
        text = '这是一段需要比较长的阅读时间的完整中文讲解，它介绍如何把功率公式代入电阻比例关系，然后再演示一个例题。'
        boundaries = [{'textOffset': i, 'wordLength': 1, 'offset': i * .2, 'duration': .2} for i in range(len(text))]
        chunks = make_subtitles(text, boundaries, len(text) * .2, max_chars=16)
        self.assertEqual(''.join(c['text'] for c in chunks), text)
        self.assertTrue(all(len(c['text'].rstrip('，。！？；：')) <= 16 for c in chunks))
        self.assertTrue(all(a['end'] <= b['start'] for a, b in zip(chunks, chunks[1:])))
        self.assertEqual(chunks[-1]['end'], len(text)*.2)



class FishConfigurationTest(unittest.TestCase):
    def test_official_defaults_and_alias_are_sent_without_exposing_key_in_body(self):
        with tempfile.TemporaryDirectory() as directory, patch.dict(os.environ, {'FISH_API_KEY': '  ', 'FISH_AUDIO_API_KEY': ' alias-key ', 'FISH_TTS_BASE_URL': ' '}, clear=True), patch('pipeline.fetch_audio', return_value=(b'audio', 'audio/mpeg')) as fetch:
            output = Path(directory) / 'voice.mp3'
            fish_generate('电功率', 'ba0fa9dc2da541e0a565533ce6949795', {}, output)
            url, body, headers = fetch.call_args.args
            self.assertEqual(url, 'https://api.fish.audio/v1/tts')
            self.assertEqual(headers, {'Content-Type': 'application/json', 'Authorization': 'Bearer alias-key', 'model': 's1'})
            self.assertEqual(json.loads(body), {'text': '电功率', 'reference_id': 'ba0fa9dc2da541e0a565533ce6949795', 'format': 'mp3', 'chunk_length': 200, 'normalize': True, 'latency': 'normal'})
            self.assertEqual(output.read_bytes(), b'audio')

    def test_primary_key_takes_precedence_and_custom_model_chunk_are_preserved(self):
        with tempfile.TemporaryDirectory() as directory, patch.dict(os.environ, {'FISH_API_KEY': ' primary ', 'FISH_AUDIO_API_KEY': 'alias'}, clear=True), patch('pipeline.fetch_audio', return_value=(b'audio', 'audio/mpeg')) as fetch:
            fish_generate('功率', '4f6e2feedf794916879cc41cb577de56', {'model': 's2-pro', 'chunkLength': 240}, Path(directory) / 'voice.mp3')
            self.assertEqual(fetch.call_args.args[2]['Authorization'], 'Bearer primary')
            self.assertEqual(fetch.call_args.args[2]['model'], 's2-pro')
            self.assertEqual(json.loads(fetch.call_args.args[1])['chunk_length'], 240)

    def test_missing_key_fails_before_network_or_output(self):
        with tempfile.TemporaryDirectory() as directory, patch.dict(os.environ, {}, clear=True), patch('pipeline.fetch_audio') as fetch:
            output = Path(directory) / 'voice.mp3'
            with self.assertRaisesRegex(RuntimeError, 'FISH_API_KEY'):
                fish_generate('功率', '4f6e2feedf794916879cc41cb577de56', {}, output)
            fetch.assert_not_called()
            self.assertFalse(output.exists())


if __name__ == '__main__':
    unittest.main()








