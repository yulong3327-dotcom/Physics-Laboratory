"""Editor stages show finite emphasis without inventing speech timestamps."""
from copy import deepcopy
from pathlib import Path
import tempfile
import unittest
from xml.etree import ElementTree as ET
from scene_preview import build_preview


class PreviewHighlightDurationTest(unittest.TestCase):
    def test_explicit_and_legacy_highlights_only_show_at_their_named_stage(self):
        for explicit in [False,True]:
            with self.subTest(explicit=explicit),tempfile.TemporaryDirectory(dir=Path.cwd()) as directory:
                highlight={'id':'h','targetType':'board','targetId':'b','phrase':'功率','effect':'marker','color':'#FF6600',
                           'cue':{'utteranceId':'u1','phrase':'功率'}}
                if explicit:highlight['durationSeconds']=1.5
                project={'title':'功率的计算','settings':{'background':'#ffffff'},'circuits':[],
                         'speakers':[{'id':'teacher','name':'方大招','color':'#333333'}],
                         'utterances':[{'id':'u1','speakerId':'teacher','text':'强调功率。下一步继续。'}],
                         'shots':[{'id':'s','utteranceIds':['u1'],'boardTexts':[{'id':'b','kind':'keyword','text':'功率'},
                                  {'id':'next','kind':'keyword','text':'继续','cue':{'utteranceId':'u1','phrase':'下一步'}}],
                                   'formulas':[],'actions':[],'highlights':[highlight]}]}
                original=deepcopy(project)
                def has_mark(preview):
                    element=next(e for e in preview['elements'] if e['id']=='board:b')
                    return any(node.attrib.get('fill')=='#ff6600' and float(node.attrib.get('fill-opacity',1))>0 for node in ET.fromstring(element['svg']))
                active=build_preview(project,'s','highlight:h',directory)
                later=build_preview(project,'s','board:next',directory)
                self.assertTrue(has_mark(active))
                self.assertFalse(has_mark(later))
                self.assertEqual(project,original)


if __name__=='__main__':unittest.main()
