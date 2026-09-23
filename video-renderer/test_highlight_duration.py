"""Measured highlight lifetime stays independent of frame-aligned shot duration."""
from copy import deepcopy
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch
from pipeline import build_timeline


class HighlightDurationTest(unittest.TestCase):
    def fixture(self, duration=6.037):
        cue={'utteranceId':'u1','phrase':'功率','offset':.087}
        project={'title':'时长验收','settings':{'fps':24},'speakers':[{'id':'teacher'}],'circuits':[],
                 'utterances':[{'id':'u1','speakerId':'teacher','text':'求功率'}]}
        shot={'id':'s','utteranceIds':['u1'],'boardTexts':[{'id':'b','text':'功率'}],'formulas':[],'actions':[],
              'highlights':[{'id':'h','targetType':'board','targetId':'b','phrase':'功率','cue':cue}],'holdSeconds':.5}
        audio={'text':'求功率','duration':duration,'boundaries':[{'textOffset':0,'wordLength':1,'offset':.1,'duration':.2},
                                                               {'textOffset':1,'wordLength':2,'offset':.413,'duration':.6}]}
        return project,shot,audio

    def build(self, project, shot, audio):
        with tempfile.TemporaryDirectory() as directory,patch('pipeline.speech',return_value=deepcopy(audio)):
            return build_timeline(project,shot,{},Path(directory),Path(directory))

    def test_explicit_duration_expires_from_measured_cue_without_frame_rounding(self):
        project,shot,audio=self.fixture();shot['highlights'][0]['durationSeconds']=1.237
        original=deepcopy(shot)
        timeline=self.build(project,shot,audio)
        start=next(e for e in timeline['events'] if e['type']=='highlight')
        end=next(e for e in timeline['events'] if e['type']=='highlight_end')
        self.assertAlmostEqual(start['time'],1.1)
        self.assertAlmostEqual(end['time'],2.337)
        self.assertEqual(end['id'],'h')
        self.assertNotAlmostEqual(end['time']*24,round(end['time']*24))
        self.assertEqual(shot,original)

    def test_legacy_highlight_without_duration_uses_three_seconds(self):
        project,shot,audio=self.fixture()
        timeline=self.build(project,shot,audio)
        start=next(e for e in timeline['events'] if e['type']=='highlight')
        end=next(e for e in timeline['events'] if e['type']=='highlight_end')
        self.assertAlmostEqual(end['time']-start['time'],3)
        self.assertNotIn('durationSeconds',shot['highlights'][0])

    def test_lifetime_at_or_after_final_frame_is_clipped_without_extending_shot_or_moving_cue(self):
        project,shot,audio=self.fixture(duration=1.037)
        reference=self.build(project,shot,audio)
        start=next(e for e in reference['events'] if e['type']=='highlight')['time']
        for lifetime in [reference['duration']-start,20]:
            with self.subTest(lifetime=lifetime):
                shot['highlights'][0]['durationSeconds']=lifetime
                timeline=self.build(project,shot,audio)
                self.assertEqual(timeline['duration'],reference['duration'])
                self.assertAlmostEqual(timeline['duration']*24,round(timeline['duration']*24))
                self.assertEqual(next(e for e in timeline['events'] if e['type']=='highlight')['time'],start)
                self.assertFalse(any(e['type']=='highlight_end' for e in timeline['events']))
                self.assertEqual(timeline['subtitles'],reference['subtitles'])


if __name__=='__main__':unittest.main()
