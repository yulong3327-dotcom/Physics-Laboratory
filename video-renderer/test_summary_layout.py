"""The summary paper is a real content boundary in preview and rendered frames."""
from copy import deepcopy
from pathlib import Path
import tempfile
import unittest
from xml.etree import ElementTree as ET

from manim import tempconfig
from scene_layout import SceneLayout,SUMMARY_CONTENT_BOUNDS,box_of,bounds_dict
from scene_preview import build_preview
from test_circuit import asset


class SummaryLayoutTest(unittest.TestCase):
    def project(self,circuit=False):
        shot={'id':'s','sectionTitle':'本课总结','utteranceIds':['u'],
              'layout':{'template':'summary','elements':{}},
              'boardTexts':[{'id':'b','kind':'law','card':{'title':'电功率规律'},'text':'同一段电路中的电功率'}],
              'formulas':[{'id':'f','cardId':'b','latex':'P=UI','action':'write','caption':'电功率的计算',
                           'cue':{'utteranceId':'u','phrase':'电功率'}}],
              'actions':[],'highlights':[]}
        if circuit:shot['circuitAssetId']='test'
        return {'title':'电功率','shots':[shot],'utterances':[{'id':'u','speakerId':'t','text':'归纳电功率的规律。'}],
                'settings':{'background':'#ffffff','showFormulaCaptions':True},'speakers':[{'id':'t','name':'老师'}],
                'circuits':[asset()] if circuit else []}

    def layout(self,project,directory):
        return SceneLayout({'projectTitle':project['title'],'shot':project['shots'][0],
                            'settings':project['settings'],'circuit':project['circuits'][0] if project['circuits'] else None},directory)

    def assert_inside(self,box):
        x,y,w,h=SUMMARY_CONTENT_BOUNDS
        self.assertGreaterEqual(box['x'],x-1e-6);self.assertGreaterEqual(box['y'],y-1e-6)
        self.assertLessEqual(box['x']+box['width'],x+w+1e-6);self.assertLessEqual(box['y']+box['height'],y+h+1e-6)

    def test_default_cards_and_subtitle_fit_in_white_paper(self):
        for circuit in [False,True]:
            with self.subTest(circuit=circuit),tempfile.TemporaryDirectory(dir=Path.cwd()) as d,tempconfig({'media_dir':d}):
                p=self.project(circuit);layout=self.layout(p,d)
                layout.create_formula(p['shots'][0]['formulas'][0]);layout.create_speaker(p['speakers'][0]);layout.create_subtitle(p['utterances'][0]['text'])
                for key,item in layout.elements.items():
                    if key in ['background','title']:continue
                    self.assert_inside(box_of(item['object']))
                    self.assertEqual(item['constraintBounds'],bounds_dict(SUMMARY_CONTENT_BOUNDS))
                footer=box_of(layout.footer)
                self.assertLess(box_of(layout.cards['b'])['y']+box_of(layout.cards['b'])['height'],footer['y'])
                self.assertGreater(box_of(layout.elements['subtitle']['object'])['y'],footer['y'])
                self.assertLess(box_of(layout.title)['y'],SUMMARY_CONTENT_BOUNDS[1])

    def test_imported_outside_placements_and_large_scales_are_constrained(self):
        p=self.project(True)
        p['shots'][0]['layout']['elements']={key:{'x':-500,'y':1200,'scale':4} for key in
            ['board:b','board-body:b','formula:f','formula-caption:f','circuit','circuit-label:a','circuit-annotation:v','footer','speaker','subtitle']}
        with tempfile.TemporaryDirectory(dir=Path.cwd()) as d,tempconfig({'media_dir':d}):
            layout=self.layout(p,d);layout.create_formula(p['shots'][0]['formulas'][0])
            layout.create_speaker(p['speakers'][0]);layout.create_subtitle('总结内容。'*30)
            layout.create_circuit_label({'id':'a','targetIds':['r'],'text':'电阻两端电压'})
            layout.create_circuit_annotation({'id':'v','targetIds':['r'],'annotation':{'kind':'voltage','label':'U','side':'above','offset':1000}})
            for key,item in layout.elements.items():
                if key not in ['background','title']:self.assert_inside(box_of(item['object']))
            self.assertTrue(any('总结页白色框内' in warning for warning in layout.warnings))

    def test_preview_exports_bounds_and_clips_marks_without_clipping_title(self):
        p=self.project();p['shots'][0]['highlights']=[{'id':'h','targetType':'formula','targetId':'f','phrase':'P=UI',
            'effect':'pointer','cue':{'utteranceId':'u','phrase':'规律'}}]
        p['shots'][0]['layout']['elements']['formula:f']={'x':1600,'y':850,'scale':2}
        original=deepcopy(p)
        with tempfile.TemporaryDirectory(dir=Path.cwd()) as d:
            preview=build_preview(p,'s','highlight:h',d)
        self.assertEqual(p,original)
        self.assertEqual(preview['contentBounds'],bounds_dict(SUMMARY_CONTENT_BOUNDS))
        for element in preview['elements']:
            clipped=any(node.tag.endswith('clipPath') for node in ET.fromstring(element['svg']).iter())
            if element['id'] in ['background','title']:
                self.assertFalse(clipped);self.assertNotIn('constraintBounds',element)
            else:
                self.assertTrue(clipped);self.assert_inside(element['box'])
                self.assertEqual(element['constraintBounds'],preview['contentBounds'])


if __name__=='__main__':unittest.main()
