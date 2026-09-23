"""Real Manim acceptance checks for design coordinates and fixed typography."""
from copy import deepcopy
from pathlib import Path
import tempfile
import unittest
from manim import tempconfig
from scene_layout import SceneLayout,box_of,UNIT
from fonts import design_font_size,design_math_font_size,text_baseline_y


class SceneLayoutTest(unittest.TestCase):
    def fixture(self, boards=None):
        return {'projectTitle':'电功率的计算','settings':{'background':'#ffffff'},'speakers':[], 'circuit':None,
                'shot':{'id':'s','sectionTitle':'电功率的计算','boardTexts':boards or [],'highlights':[],'formulas':[],'actions':[]}}

    def test_same_override_preserves_box_across_preview_and_output_resolutions(self):
        timeline=self.fixture([{'id':'b','kind':'given','text':'已知电流 I=2A'}])
        timeline['shot']['layout']={'template':'explain','elements':{'board:b':{'x':280,'y':330,'scale':1.25}}}
        boxes=[]
        with tempfile.TemporaryDirectory(dir=Path.cwd()) as directory:
            for width,height in [(1920,1080),(1280,720)]:
                with tempconfig({'pixel_width':width,'pixel_height':height,'frame_width':128/9,'frame_height':8}):
                    layout=SceneLayout(deepcopy(timeline),Path(directory))
                    item=layout.elements['board:b'];box=box_of(item['object']);boxes.append(box)
                    self.assertAlmostEqual(box['x'],280,places=6);self.assertAlmostEqual(box['y'],330,places=6)
                    self.assertAlmostEqual(box['width'],item['natural']['width']*1.25,places=6)
                    self.assertEqual(item['placement']['scale'],1.25)
        for key in boxes[0]:self.assertAlmostEqual(boxes[0][key],boxes[1][key],places=5)

    def test_board_keeps_42px_type_and_56px_true_baselines(self):
        timeline=self.fixture([{'id':'b','kind':'derivation','text':'H\ng\n电功率 P=UI'}])
        with tempfile.TemporaryDirectory(dir=Path.cwd()) as directory:
            layout=SceneLayout(timeline,Path(directory));lines=[run[2] for run in layout.boards['b'].runs]
            self.assertEqual(len(lines),3)
            for line in lines:self.assertAlmostEqual(line.font_size,design_font_size(42),places=6)
            for first,second in zip(lines,lines[1:]):
                self.assertAlmostEqual((text_baseline_y(first)-text_baseline_y(second))*UNIT,56,places=5)

    def test_overflow_warns_without_automatically_shrinking_board_or_subtitle(self):
        timeline=self.fixture([{'id':str(i),'kind':'keyword','text':'电功率公式与比例'} for i in range(15)])
        with tempfile.TemporaryDirectory(dir=Path.cwd()) as directory:
            layout=SceneLayout(timeline,Path(directory))
            last=box_of(layout.boards['14'])
            self.assertGreater(last['y']+last['height'],1080)
            self.assertTrue(any('超出画面' in warning for warning in layout.warnings))
            self.assertTrue(any('超出默认排版区域' in warning for warning in layout.warnings))
            for board in layout.boards.values():
                for _,_,line in board.runs:self.assertAlmostEqual(line.font_size,design_font_size(42),places=6)
            subtitle=layout.create_subtitle('电功率表示电流做功的快慢。'*8)
            self.assertGreater(len(subtitle.runs),2)
            self.assertTrue(any('字幕超过两行' in warning for warning in layout.warnings))
            for _,_,line in subtitle.runs:self.assertAlmostEqual(line.font_size,design_font_size(42),places=6)

    def test_formula_uses_stix_math_design_size_and_explicit_placement(self):
        timeline=self.fixture();timeline['shot']['layout']={'template':'explain','elements':{'formula:f':{'x':1000,'y':650,'scale':1.2}}}
        with tempfile.TemporaryDirectory(dir=Path.cwd()) as directory,tempconfig({'media_dir':directory}):
            layout=SceneLayout(timeline,Path(directory));formula=layout.create_formula({'id':'f','latex':r'P=I^2R','parts':[]})
            box=box_of(formula)
            self.assertAlmostEqual(box['x'],1000,places=5);self.assertAlmostEqual(box['y'],650,places=5)
            self.assertAlmostEqual(formula.font_size,design_math_font_size(42)*1.2,places=5)

    def test_problem_source_does_not_force_question_template_or_reinsert_deleted_board(self):
        timeline=self.fixture();timeline['problem']={'text':'某电阻阻值是6 Ω，求电压。'}
        timeline['shot']['layout']={'template':'question','elements':{}}
        with tempfile.TemporaryDirectory(dir=Path.cwd()) as directory:
            layout=SceneLayout(timeline,Path(directory))
            self.assertEqual(layout.template,'explain')
            self.assertEqual(layout.board_specs,[])
            self.assertNotIn('board:__problem',layout.elements)

    def test_formula_caption_inherits_parent_transform_but_explicit_override_wins(self):
        timeline=self.fixture();timeline['settings']['showFormulaCaptions']=True
        step={'id':'f','latex':'P=UI','caption':'电功率的计算'}
        with tempfile.TemporaryDirectory(dir=Path.cwd()) as directory,tempconfig({'media_dir':directory}):
            normal=SceneLayout(deepcopy(timeline),Path(directory));normal.create_formula(step)
            parent=normal.elements['formula:f'];child=normal.elements['formula-caption:f']
            timeline['shot']['layout']={'template':'explain','elements':{'formula:f':{'x':800,'y':520,'scale':1.25}}}
            moved=SceneLayout(deepcopy(timeline),Path(directory));moved.create_formula(step)
            actual=moved.elements['formula-caption:f']
            self.assertAlmostEqual(actual['placement']['x'],800+(child['placement']['x']-parent['placement']['x'])*1.25,places=5)
            self.assertAlmostEqual(actual['placement']['y'],520+(child['placement']['y']-parent['placement']['y'])*1.25,places=5)
            self.assertEqual(actual['parentId'],'formula:f')
            timeline['shot']['layout']['elements']['formula-caption:f']={'x':220,'y':420,'scale':.9}
            explicit=SceneLayout(timeline,Path(directory));explicit.create_formula(step)
            self.assertAlmostEqual(explicit.elements['formula-caption:f']['placement']['x'],220,places=5)
            self.assertAlmostEqual(explicit.elements['formula-caption:f']['placement']['y'],420,places=5)


if __name__=='__main__':unittest.main()
