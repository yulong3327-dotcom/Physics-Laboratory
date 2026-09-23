import json
import hashlib
import os
from pathlib import Path
import shutil
import struct
import tempfile
import threading
import time
import unittest
from unittest.mock import patch
import urllib.error
import wave
from concurrent.futures import ThreadPoolExecutor
from contextlib import contextmanager

import pipeline
from video_runtime import PipelineError, wav_duration, file_hash
from video_speech import SpeechRequestControl, SpeechWindowStopped, prepare_speech_window


def write_audio(path, sample=1, frames=240):
    with wave.open(str(path), 'wb') as stream:
        stream.setparams((1, 2, 24000, 0, 'NONE', 'not compressed'))
        stream.writeframes(struct.pack('<h', sample) * frames)


def normalize(source, target):
    shutil.copy2(source, target)
    return wav_duration(target)


class SpeechParallelTest(unittest.TestCase):
    def synthesize(self, directory, text='甲。乙。丙。', voice='voice-1'):
        return pipeline.speech({'id': 'u1', 'speakerId': 'teacher', 'text': text},
                               {'id': 'teacher', 'voice': voice}, Path(directory) / 'out', Path(directory) / 'cache',
                               options={'provider': 'fish', 'model': 's1', 'chunkLength': 200, 'pauseSeconds': .5})

    def test_parallel_completion_preserves_real_sample_order_and_cue_offsets(self):
        second_done = threading.Event()
        active, peak, calls = 0, 0, []
        lock = threading.Lock()

        def generate(text, voice, options, path):
            nonlocal active, peak
            with lock:
                active += 1; peak = max(peak, active); calls.append(text)
            if text.startswith('甲'):
                self.assertTrue(second_done.wait(2), 'Second request should overlap the first')
            number = {'甲': 1, '乙': 2, '丙': 3}[text[0]]
            write_audio(path, number, number * 240)
            if text.startswith('乙'):
                second_done.set()
            with lock:
                active -= 1

        with tempfile.TemporaryDirectory() as directory, patch.dict(os.environ, {'VIDEO_TTS_CONCURRENCY': '2'}), patch('pipeline.fish_generate', side_effect=generate), patch('pipeline.normalize_audio', side_effect=normalize):
            result = self.synthesize(directory)
            with wave.open(result['audio'], 'rb') as audio:
                samples = audio.readframes(audio.getnframes())
            self.assertEqual(samples, b''.join(struct.pack('<h', n) * (n * 240) for n in (1, 2, 3)))
            self.assertEqual([segment['offset'] for segment in result['segments']], [0, .01, .03])
            self.assertEqual(pipeline.measured_cue({'phrase': '乙'}, result['text'], result['segments'], result['duration']), .01)
            self.assertEqual(peak, 2)
            self.assertEqual(len(calls), 3)
            self.synthesize(directory)
            self.assertEqual(len(calls), 3, 'Verified utterance cache must avoid all new requests')

    def test_duplicate_fragments_share_one_content_cache_and_voice_change_misses(self):
        calls = []

        def generate(text, voice, options, path):
            calls.append((text, voice)); write_audio(path)

        with tempfile.TemporaryDirectory() as directory, patch('pipeline.fish_generate', side_effect=generate), patch('pipeline.normalize_audio', side_effect=normalize):
            self.synthesize(directory, '甲。甲。')
            self.assertEqual(calls, [('甲。', 'voice-1')])
            self.synthesize(directory, '甲。甲。', voice='voice-2')
            self.assertEqual(calls[-1], ('甲。', 'voice-2'))
            self.assertEqual(len(calls), 2)

    def test_failure_stops_new_windows_and_retry_reuses_successful_fragment(self):
        first_started = threading.Event()
        second_failed = threading.Event()
        calls = []

        def generate(text, voice, options, path):
            calls.append(text)
            if text.startswith('甲'):
                first_started.set()
                self.assertTrue(second_failed.wait(2))
                write_audio(path)
            else:
                self.assertTrue(first_started.wait(2))
                second_failed.set()
                raise PipelineError('provider unavailable', code='speech_network', retryable=True)

        with tempfile.TemporaryDirectory() as directory, patch.dict(os.environ, {'VIDEO_TTS_CONCURRENCY': '2'}), patch('pipeline.normalize_audio', side_effect=normalize):
            with patch('pipeline.fish_generate', side_effect=generate), self.assertRaisesRegex(PipelineError, 'provider unavailable'):
                self.synthesize(directory)
            self.assertCountEqual(calls, ['甲。', '乙。'])
            cached = list((Path(directory) / 'cache').glob('speech/*/fragments/*/complete.json'))
            self.assertEqual(len(cached), 1)
            calls.clear()
            with patch('pipeline.fish_generate', side_effect=lambda text, voice, options, path: (calls.append(text), write_audio(path))):
                self.synthesize(directory)
            self.assertCountEqual(calls, ['乙。', '丙。'])

    def test_configured_serial_mode_and_throttled_window_stop_parallel_dispatch(self):
        active, peak = 0, 0
        control = SpeechRequestControl()

        def prepare(index):
            nonlocal active, peak
            active += 1; peak = max(peak, active)
            control.backoff(0)
            active -= 1
            return index

        with patch.dict(os.environ, {'VIDEO_TTS_CONCURRENCY': '1'}):
            self.assertEqual(prepare_speech_window([1, 2, 3], prepare, control), [1, 2, 3])
        self.assertEqual(peak, 1)

        barrier = threading.Barrier(2)
        lock = threading.Lock()
        control = SpeechRequestControl()
        later_active, later_peak = 0, 0

        def throttled(index):
            nonlocal later_active, later_peak
            if index < 2:
                barrier.wait(timeout=2)
                control.backoff(0)
            else:
                with lock:
                    later_active += 1; later_peak = max(later_peak, later_active)
                time.sleep(.01)
                with lock:
                    later_active -= 1
            return index

        with patch.dict(os.environ, {'VIDEO_TTS_CONCURRENCY': '2'}):
            self.assertEqual(prepare_speech_window(list(range(6)), throttled, control), list(range(6)))
        self.assertEqual(later_peak, 1, 'After throttling subsequent windows must remain serial')

    def test_verified_serial_partial_cache_is_migrated_without_resynthesis(self):
        calls = []
        # Construct the exact pre-concurrency cache identity independently. Never
        # call speech() to create the parent: that would conceal a hash migration.
        text = '甲。乙。丙。'
        spoken, origins = pipeline.pronunciation_text(text, pipeline.DEFAULT_PRONUNCIATIONS)
        original_input = {'provider': 'fish', 'model': 's1', 'voice': 'voice-1', 'chunkLength': 200,
                          'text': text, 'spoken': spoken, 'segments': pipeline.measured_segments(text, []),
                          'format': 'pcm24k-measured-v2', 'pronunciationVersion': pipeline.PRONUNCIATION_VERSION,
                          'sourceOffsets': list(origins), 'sourceEnds': origins.ends,
                          'endpoint': None, 'normalize': True, 'latency': 'normal'}
        old_key = hashlib.sha256(json.dumps(original_input, ensure_ascii=False, sort_keys=True).encode()).hexdigest()
        with tempfile.TemporaryDirectory() as directory, patch.dict(os.environ, {'VIDEO_TTS_CONCURRENCY': '1'}, clear=True), patch('pipeline.normalize_audio', side_effect=normalize):
            parent = Path(directory) / 'cache' / 'speech' / old_key
            parent.mkdir(parents=True)
            legacy = parent / 'segment-0.wav'
            write_audio(legacy, 7)
            (parent / 'segment-0.complete.json').write_text(json.dumps({'sha256': file_hash(legacy)}), encoding='utf-8')
            with patch('pipeline.fish_generate', side_effect=lambda text, voice, options, path: (calls.append(text), write_audio(path))):
                result = self.synthesize(directory)
            self.assertEqual(calls, ['乙。', '丙。'])
            self.assertEqual(result['cacheKey'], old_key)
            with wave.open(result['audio'], 'rb') as stream:
                self.assertEqual(stream.readframes(240), struct.pack('<h', 7) * 240)

    def test_shared_retry_after_deadline_and_stop_interrupt_wait(self):
        control = SpeechRequestControl()
        with patch('video_speech.time.monotonic', return_value=100):
            control.backoff(7)
            control.backoff(2)
        self.assertEqual(control._deadline, 107)
        self.assertTrue(control.degraded.is_set())
        control.stopped.set()
        with self.assertRaises(SpeechWindowStopped):
            with control.request():
                self.fail('Stopped window cannot begin a provider request')

    def test_http_429_uses_shared_deadline_and_retains_provider_retry_after(self):
        control = SpeechRequestControl()
        pipeline._TTS_REQUEST.control = control
        error = urllib.error.HTTPError('https://tts.example', 429, 'rate limit', {'Retry-After': '11'}, None)
        response = unittest.mock.MagicMock()
        response.__enter__.return_value = response
        response.read.return_value = b'audio'
        response.headers = {'Content-Type': 'audio/mpeg'}
        try:
            with patch('pipeline.urllib.request.build_opener') as opener, patch.object(control, 'backoff', wraps=control.backoff) as backoff, patch('pipeline.speech_retry') as retry, patch.object(control, 'request', return_value=pipeline.nullcontext()):
                opener.return_value.open.side_effect = [error, response]
                self.assertEqual(pipeline.fetch_audio('https://tts.example')[0], b'audio')
                backoff.assert_called_once_with(11)
                retry.assert_called_once_with('fish', 2, 11)
        finally:
            del pipeline._TTS_REQUEST.control

    def test_two_http_workers_share_longest_429_deadline_and_retry_serially(self):
        control = SpeechRequestControl()
        initial_requests = threading.Barrier(2)
        both_backoffs = threading.Event()
        allow_retries = threading.Event()
        both_retry_entries = threading.Event()
        first_success = threading.Event()
        release_success = threading.Event()
        lock = threading.Lock()
        now = [100.0]
        calls, backoffs, entries, active, peak = {}, [], 0, 0, 0
        original_request = control.request

        @contextmanager
        def observed_request():
            nonlocal entries
            with lock:
                entries += 1
                if entries == 4:
                    both_retry_entries.set()
            with original_request():
                yield

        class Response:
            headers = {'Content-Type': 'audio/mpeg'}
            def __enter__(self):
                return self
            def read(self, limit):
                first_success.set()
                if not release_success.wait(2):
                    raise AssertionError('Test did not release the in-flight request')
                return b'audio'
            def __exit__(self, *_):
                nonlocal active
                with lock:
                    active -= 1

        def open_request(request, timeout):
            nonlocal active, peak
            key = request.full_url[-1]
            with lock:
                calls[key] = calls.get(key, 0) + 1
                attempt = calls[key]
            if attempt == 1:
                initial_requests.wait(timeout=2)
                delay = '7' if key == 'a' else '11'
                raise urllib.error.HTTPError(request.full_url, 429, 'rate limit', {'Retry-After': delay}, None)
            self.assertGreaterEqual(now[0], 111, 'Neither worker may retry before the longest deadline')
            with lock:
                active += 1; peak = max(peak, active)
            return Response()

        def retry(provider, attempt, delay):
            with lock:
                backoffs.append(delay)
                if len(backoffs) == 2:
                    both_backoffs.set()
            self.assertTrue(allow_retries.wait(2))

        def worker(key):
            pipeline._TTS_REQUEST.control = control
            return pipeline.fetch_audio('https://tts.example/' + key)

        with patch('video_speech.time.monotonic', side_effect=lambda: now[0]), patch('pipeline.urllib.request.build_opener') as opener, patch('pipeline.speech_retry', side_effect=retry), patch.object(control, 'request', side_effect=observed_request):
            opener.return_value.open.side_effect = open_request
            with ThreadPoolExecutor(max_workers=1) as executor:
                future = executor.submit(prepare_speech_window, ['a', 'b'], worker, control, 2)
                try:
                    self.assertTrue(both_backoffs.wait(2))
                    self.assertEqual(control._deadline, 111)
                    self.assertEqual(calls, {'a': 1, 'b': 1})
                    now[0] = 110
                    allow_retries.set()
                    self.assertTrue(both_retry_entries.wait(2))
                    self.assertFalse(first_success.is_set())
                    with control._state:
                        now[0] = 111
                        control._state.notify_all()
                    self.assertTrue(first_success.wait(2))
                    self.assertEqual(active, 1)
                    self.assertEqual(sum(calls.values()), 3)
                    release_success.set()
                    self.assertEqual(future.result(timeout=2), [(b'audio', 'audio/mpeg')] * 2)
                    self.assertEqual(peak, 1)
                finally:
                    allow_retries.set(); release_success.set(); control.stop()


if __name__ == '__main__':
    unittest.main()
