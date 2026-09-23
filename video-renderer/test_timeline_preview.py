from pathlib import Path
import tempfile
import unittest
from scene_preview import build_preview


class MeasuredPreviewTest(unittest.TestCase):
    def fixture(self):
        board = {'id': 'b', 'kind': 'law', 'text': '串联电流相等', 'cue': {'utteranceId': 'u', 'phrase': '串联'}}
        mark = {'id': 'h', 'targetType': 'board', 'targetId': 'b', 'phrase': '电流', 'effect': 'box',
                'cue': {'utteranceId': 'u', 'phrase': '电流'}, 'durationSeconds': 1}
        shot = {'id': 's', 'title': '串联', 'utteranceIds': ['u'], 'boardTexts': [board], 'formulas': [], 'actions': [], 'highlights': [mark]}
        project = {'title': '电学', 'shots': [shot], 'settings': {'background': '#ffffff'}, 'circuits': [],
                   'speakers': [{'id': 'teacher', 'name': '方大招', 'color': '#4F80FF'}],
                   'utterances': [{'id': 'u', 'speakerId': 'teacher', 'text': '串联电流相等'}]}
        timeline = {'shot': shot, 'duration': 5, 'events': [
            {'type': 'speaker', 'time': .6, 'speakerId': 'teacher'},
            {'type': 'subtitle', 'time': .6, 'text': '串联电流相等'},
            {'type': 'subtitle', 'time': 1.6, 'text': ''},
            {'type': 'board', 'time': 2, 'data': board},
            {'type': 'highlight', 'time': 3, 'data': mark},
            {'type': 'highlight_end', 'time': 4, 'id': 'h'},
        ]}
        return project, timeline

    def test_recorded_times_control_visibility_subtitle_gaps_and_emphasis_expiry(self):
        project, timeline = self.fixture()
        with tempfile.TemporaryDirectory(dir=Path.cwd()) as directory:
            def frame(at):
                return {item['id']: item for item in build_preview(project, 's', directory=directory, measured_timeline=timeline, time=at)['elements']}
            before = frame(1)
            self.assertFalse(before['board:b']['visible'])
            self.assertTrue(before['subtitle']['visible'])
            shown = frame(2.5)
            self.assertTrue(shown['board:b']['visible'])
            self.assertFalse(shown['subtitle']['visible'])
            marked = frame(3.5)
            after = frame(4.1)
            self.assertNotEqual(marked['board:b']['svg'], shown['board:b']['svg'])
            self.assertEqual(after['board:b']['svg'], shown['board:b']['svg'])

    def test_timeline_identity_and_range_are_checked(self):
        project, timeline = self.fixture()
        with self.assertRaisesRegex(ValueError, '超出'):
            build_preview(project, 's', measured_timeline=timeline, time=6)
        timeline['shot'] = {'id': 'other'}
        with self.assertRaisesRegex(ValueError, '不属于'):
            build_preview(project, 's', measured_timeline=timeline, time=1)


if __name__ == '__main__':
    unittest.main()
