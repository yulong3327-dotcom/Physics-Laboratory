"""Small request windows with shared provider backoff and failure cancellation."""
from contextlib import contextmanager
from concurrent.futures import ThreadPoolExecutor
import os
import threading
import time


class SpeechWindowStopped(RuntimeError):
    pass


class SpeechRequestControl:
    def __init__(self):
        self.stopped = threading.Event()
        self.degraded = threading.Event()
        self._state = threading.Condition()
        self._deadline = 0.0
        self._active = 0

    def check(self):
        if self.stopped.is_set():
            raise SpeechWindowStopped('另一配音片段失败，已停止后续请求')

    def backoff(self, seconds):
        # Once throttled, keep this utterance's remaining requests serial. Every
        # worker observes the longest provider deadline, including CDN downloads.
        with self._state:
            self.degraded.set()
            self._deadline = max(self._deadline, time.monotonic() + seconds)
            self._state.notify_all()

    def stop(self):
        with self._state:
            self.stopped.set()
            self._state.notify_all()

    def pause(self, seconds):
        if self.stopped.wait(seconds):
            self.check()

    @contextmanager
    def request(self):
        # Inspect the deadline, degraded limit and active count atomically. A
        # waiter must recheck after every wakeup, including a newly received 429.
        with self._state:
            while True:
                self.check()
                remaining = self._deadline - time.monotonic()
                limit = 1 if self.degraded.is_set() else 2
                if remaining <= 0 and self._active < limit:
                    self._active += 1
                    break
                self._state.wait(timeout=remaining if remaining > 0 else None)
        try:
            yield
        except BaseException:
            self.stop()
            raise
        finally:
            with self._state:
                self._active -= 1
                self._state.notify_all()


def speech_concurrency():
    try:
        return max(1, min(2, int(os.environ.get('VIDEO_TTS_CONCURRENCY', '2'))))
    except (TypeError, ValueError):
        return 2


def prepare_speech_window(items, prepare, control, concurrency=None):
    """Submit no more than one window; preserve completed work on failure."""
    results = []
    concurrency = speech_concurrency() if concurrency is None else concurrency

    def run(item):
        control.check()
        try:
            return prepare(*item) if isinstance(item, tuple) else prepare(item)
        except BaseException:
            control.stop()
            raise

    with ThreadPoolExecutor(max_workers=concurrency, thread_name_prefix='tts') as executor:
        first = 0
        while first < len(items):
            control.check()
            width = 1 if control.degraded.is_set() else concurrency
            futures = [executor.submit(run, item) for item in items[first:first + width]]
            failures = []
            for future in futures:
                try:
                    results.append(future.result())
                except BaseException as error:
                    failures.append(error)
            if failures:
                # A cancelled sibling must not hide the actual provider failure.
                raise next((error for error in failures if not isinstance(error, SpeechWindowStopped)), failures[0])
            first += width
    return results
