"""Generic cards keep layout, event visibility, editing coordinates and effects aligned."""
from copy import deepcopy
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch
import numpy as np
from manim import tempconfig, Rectangle
from scene import board_entrance_animation,highlight_mobjects,set_highlight_phase
from scene_layout import SceneLayout,box_of
from scene_preview import build_preview
from video_validation import check_event_visibility
from pipeline import speech
from test_circuit import asset


class KnowledgeCardsTest(unittest.TestCase):
    def project(self,count=3,circuit=False):
        boards=[{'id':'c'+str(i),'kind':'law','card':{'title':['电压规律','电流规律','电功率关系','适用条件'][i%4]},'text':''} for i in range(count)]
        formulas=[{'id':'f'+str(i),'cardId':'c'+str(i),'latex':['U=IR','I=2','P=UI','R=3'][i%4],'action':'write','cue':{'utteranceId':'u','phrase':str(i)}} for i in range(count)]
        shot={'id':'s','utteranceIds':['u'],'boardTexts':boards,'formulas':formulas,'highlights':[],'actions':[]}
        if circuit:shot['circuitAssetId']='test'
        return {'title':'通用知识卡','settings':{'background':'#ffffff'},'speakers':[{'id':'t','name':'老师'}],
                'utterances':[{'id':'u','speakerId':'t','text':'0123456789'}],'circuits':[asset()] if circuit else [],'shots':[shot]}

    def layout(self,project,directory):
        return SceneLayout({'projectTitle':project['title'],'settings':project['settings'],'shot':project['shots'][0],'circuit':project['circuits'][0] if project['circuits'] else None},directory)

    def test_three_cards_with_circuit_stack_without_overlapping_footer_and_formulas_stay_inside(self):
        p=self.project(circuit=True)
        with tempfile.TemporaryDirectory(dir=Path.cwd()) as d,tempconfig({'media_dir':d}):
            layout=self.layout(p,d);boxes=[box_of(layout.cards['c'+str(i)]) for i in range(3)]
            self.assertEqual(len(set(round(b['x'],4) for b in boxes)),1)
            for a,b in zip(boxes,boxes[1:]):self.assertLess(a['y']+a['height'],b['y'])
            for step,box in zip(p['shots'][0]['formulas'],boxes):
                f=box_of(layout.create_formula(step))
                self.assertGreaterEqual(f['x'],box['x']);self.assertLessEqual(f['x']+f['width'],box['x']+box['width'])
                self.assertGreater(f['y'],box['y']);self.assertLess(f['y']+f['height'],box['y']+box['height'])
            self.assertLess(boxes[-1]['y']+boxes[-1]['height'],832)
            self.assertEqual(layout.warnings,[])

    def test_four_cards_without_circuit_grid_wrap_titles_and_keep_body_formula_spacing(self):
        p=self.project(4)
        p['shots'][0]['boardTexts'][0]['card']['title']='说明温度保持不变时的电压电流与电阻之间的关系'
        p['shots'][0]['boardTexts'][0]['text']='温度等条件保持不变'
        with tempfile.TemporaryDirectory(dir=Path.cwd()) as d,tempconfig({'media_dir':d}):
            layout=self.layout(p,d);a,b,c=[box_of(layout.cards['c'+str(i)]) for i in range(3)]
            self.assertAlmostEqual(a['y'],b['y']);self.assertGreater(b['x'],a['x']+a['width']);self.assertGreater(c['y'],a['y']+a['height'])
            self.assertGreater(len(layout.cards['c0'].title.runs),1)
            for card in layout.cards.values():
                self.assertGreaterEqual((card.title.get_left()[0]-card.submobjects[-1].get_right()[0])*135,12)
            body=box_of(layout.elements['board-body:c0']['object']);formula=box_of(layout.create_formula(p['shots'][0]['formulas'][0]))
            self.assertLess(body['y']+body['height'],formula['y'])

    def test_dragging_card_moves_body_and_formula_and_explicit_formula_override_wins(self):
        p=self.project(1);p['shots'][0]['boardTexts'][0]['text']='保持温度不变'
        with tempfile.TemporaryDirectory(dir=Path.cwd()) as d,tempconfig({'media_dir':d}):
            first=self.layout(p,d);first.create_formula(p['shots'][0]['formulas'][0]);parent=first.elements['board:c0']['natural']
            p['shots'][0]['layout']={'elements':{'board:c0':{'x':350,'y':270,'scale':1.1}}}
            second=self.layout(p,d);second.create_formula(p['shots'][0]['formulas'][0])
            for key in ['board-body:c0','formula:f0']:
                old=box_of(first.elements[key]['object']);new=box_of(second.elements[key]['object'])
                self.assertAlmostEqual(new['x'],350+(old['x']-parent['x'])*1.1,places=5)
                self.assertAlmostEqual(new['width'],old['width']*1.1,places=5)
            p['shots'][0]['layout']['elements']['formula:f0']={'x':430,'y':530,'scale':.9}
            third=self.layout(p,d);third.create_formula(p['shots'][0]['formulas'][0])
            self.assertAlmostEqual(box_of(third.formulas['f0'])['x'],430)

    def test_formula_tracks_are_independent_and_hidden_card_cannot_leak_formula(self):
        p=self.project(2);s=p['shots'][0]
        s['formulas'].append({'id':'f2','cardId':'c0','latex':'U=6','action':'transform','cue':{'utteranceId':'u','phrase':'2'}})
        s['highlights']=[{'id':'h','targetType':'formula','targetId':'f1','phrase':'I=2','effect':'pointer','cue':{'utteranceId':'u','phrase':'3'}}]
        events=[{'type':'formula','data':f} for f in s['formulas']]+[{'type':'highlight','data':s['highlights'][0]}]
        check_event_visibility(s,{'events':events})
        with tempfile.TemporaryDirectory(dir=Path.cwd()) as d:
            result=build_preview(p,'s','highlight:h',d);elements={e['id']:e for e in result['elements']}
            self.assertFalse(elements['formula:f0']['visible']);self.assertTrue(elements['formula:f1']['visible']);self.assertTrue(elements['formula:f2']['visible'])
            self.assertEqual(elements['board:c0']['source']['type'],'cardTitle')
            s['boardTexts'][0]['cue']={'utteranceId':'u','phrase':'9'}
            with self.assertRaisesRegex(Exception,'知识卡尚未显示'):build_preview(p,'s','formula:f0',d)
            with self.assertRaisesRegex(Exception,'知识卡尚未显示'):check_event_visibility(s,{'events':events})

    def test_vector_effects_and_card_entrances_finish_at_exact_coordinates(self):
        for entrance in ['slide','settle']:
            obj=Rectangle(width=2,height=1).shift([1.,1.,0.]);expected=obj.points.copy()
            animation=board_entrance_animation(obj,entrance);animation.begin();animation.interpolate(1);animation.finish()
            np.testing.assert_allclose(obj.points,expected,atol=1e-8)
        region=Rectangle(width=2,height=.5)
        for effect in ['pointer','pulse','check','cross']:
            mark=highlight_mobjects([region],'#4F80FF',effect)
            self.assertGreater(len(mark.family_members_with_points()),0)
            before=mark.width;set_highlight_phase(mark,effect,.25)
            if effect=='pulse':self.assertGreater(mark.width,before)
            np.testing.assert_allclose(region.get_center(),[0,0,0])

    def test_settle_includes_same_cue_children_added_after_animation_is_created(self):
        from manim import VGroup,Circle
        shell=Rectangle(width=3,height=2,fill_opacity=.3);group=VGroup(shell)
        animation=board_entrance_animation(group,'settle')
        formula=Circle(radius=.3,fill_opacity=0);group.add(formula)
        expected=[obj.points.copy() for obj in group.family_members_with_points()]
        animation.begin();animation.interpolate(.5);animation.interpolate(1);animation.finish()
        self.assertEqual(len(group),2)
        for obj,points in zip(group.family_members_with_points(),expected):np.testing.assert_allclose(obj.points,points,atol=1e-8)
        self.assertAlmostEqual(group[0].get_fill_opacity(),.3)
        self.assertEqual(group[1].get_fill_opacity(),0)

    def test_excess_cards_and_long_content_warn_instead_of_shrinking(self):
        p=self.project(5);p['shots'][0]['boardTexts'][0]['text']='\n'.join(['不要缩小文字']*10)
        with tempfile.TemporaryDirectory(dir=Path.cwd()) as d,tempconfig({'media_dir':d}):
            layout=self.layout(p,d)
            self.assertTrue(any('超过4张' in warning for warning in layout.warnings))
            self.assertTrue(any('字幕' in warning for warning in layout.warnings))
            self.assertGreater(layout.cards['c0'].design_height,450)

    def test_default_speech_is_fish_s1_and_unknown_provider_never_calls_edge(self):
        with tempfile.TemporaryDirectory() as d,patch('pipeline.fish_generate',side_effect=RuntimeError('fish selected')) as fish,patch('pipeline.edge_generate') as edge:
            with self.assertRaisesRegex(RuntimeError,'fish selected'):speech({'id':'u','text':'电压'},{'voice':'voice'},Path(d),Path(d))
            self.assertEqual(fish.call_args.args[2]['model'],'s1');edge.assert_not_called()
            with self.assertRaisesRegex(ValueError,'不支持的语音服务'):speech({'id':'u','text':'电压'},{'voice':'voice'},Path(d),Path(d),options={'provider':'unknown'})
            edge.assert_not_called()


if __name__=='__main__':unittest.main()
