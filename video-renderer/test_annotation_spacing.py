"""Measurement text stays readable beside component names and stacked ranges."""
from pathlib import Path
import tempfile
import unittest
import numpy as np
from manim import tempconfig, DOWN
from scene_layout import SceneLayout
from test_circuit import asset


class AnnotationSpacingTest(unittest.TestCase):
    def test_vertical_current_arrow_preserves_wire_and_reverses_direction(self):
        circuit=asset()
        circuit['geometry']['wires']=[{'id':'vertical','path':'M 60 45 L 60 -45','from':'r.left','to':'r.right'}]
        timeline={'projectTitle':'电流方向','settings':{'background':'#fff'},'speakers':[],'circuit':circuit,
                  'shot':{'id':'s','boardTexts':[],'formulas':[],'actions':[],
                          'layout':{'elements':{'circuit':{'x':530,'y':430,'scale':1.2}}}}}
        with tempfile.TemporaryDirectory(dir=Path.cwd()) as directory:
            with tempconfig({'media_dir':directory,'frame_width':128/9,'frame_height':8}):
                layout=SceneLayout(timeline,Path(directory))
                wire=layout.circuit.resolve_target('vertical')
                layout.circuit.labels['r'].shift([-4,0,0])
                before=wire.get_all_points().copy()
                for direction in ('forward','reverse'):
                    action={'id':direction,'type':'annotation','targetIds':['vertical'],
                            'annotation':{'kind':'current','label':'I','side':'above','offset':24,'direction':direction}}
                    _,_,obj=layout.create_circuit_annotation(action)
                    arrow=obj[0][0]; delta=arrow.get_end()-arrow.get_start()
                    self.assertAlmostEqual(delta[0],0,places=7)
                    self.assertGreater(delta[1] if direction=='forward' else -delta[1],0)
                    self.assertLess(arrow.get_center()[0],wire.get_left()[0])
                    self.assertAlmostEqual(wire.get_left()[0]-arrow.get_center()[0],24/135*1.2,places=6)
                    self.assertLess(obj[1].get_right()[0],arrow.get_center()[0])
                    np.testing.assert_allclose(wire.get_all_points(),before,atol=1e-8)

    def test_voltage_avoids_name_and_total_range_avoids_previous_measurement(self):
        timeline={'projectTitle':'分压','settings':{'background':'#fff'},'speakers':[],'circuit':asset(),
                  'shot':{'id':'s','boardTexts':[],'formulas':[],'actions':[]}}
        def annotation(identifier, targets, offset):
            return {'id':identifier,'type':'annotation','targetIds':targets,
                    'annotation':{'kind':'voltage','label':'U','side':'below','offset':offset}}
        with tempfile.TemporaryDirectory(dir=Path.cwd()) as directory:
            with tempconfig({'media_dir':directory,'frame_width':128/9,'frame_height':8}):
                layout=SceneLayout(timeline,Path(directory))
                layout.circuit.labels['r'].next_to(layout.circuit.components['r'],DOWN,buff=.12)
                _,_,partial=layout.create_circuit_annotation(annotation('partial',['r'],0))
                self.assertLess(partial[1].get_top()[1],layout.circuit.labels['r'].get_bottom()[1])
                # Different target sets may span the same interval: the total
                # must be put on a new line even with the same requested offset.
                wire=next(iter(layout.circuit.wires))
                _,_,total=layout.create_circuit_annotation(annotation('total',['r',wire],0))
                self.assertLess(total[1].get_top()[1],partial[1].get_bottom()[1])
                _,old,replaced=layout.create_circuit_annotation(annotation('replacement',['r',wire],0))
                self.assertEqual(old,'circuit-annotation:total')
                self.assertAlmostEqual(replaced[1].get_center()[1],total[1].get_center()[1])


if __name__=='__main__':unittest.main()
