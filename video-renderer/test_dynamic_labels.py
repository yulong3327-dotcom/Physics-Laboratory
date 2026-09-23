"""Regressions for replacing teaching annotations without overwriting component names."""
import unittest
from manim import Scene, Group, Rectangle, Line, Text, RIGHT, LEFT, UP
from scene import update_dynamic_label, place_problem_circuit

class DynamicLabelTest(unittest.TestCase):
    def test_problem_resistor_label_moves_clear_of_a_lower_return_wire(self):
        resistor=Rectangle(width=.8,height=.18).move_to([0,0,0])
        wire=Line([-2,-.38,0],[2,-.38,0])
        label=Text('R = 8 Ω',font='Microsoft YaHei',font_size=21).next_to(resistor,[0,-1,0],buff=.12)
        circuit=Group(wire,resistor,label)
        circuit.components={'r':resistor};circuit.wires={'return':wire};circuit.labels={'r':label}
        self.assertGreater(label.get_top()[1],wire.get_center()[1])
        self.assertLess(label.get_bottom()[1],wire.get_center()[1])
        place_problem_circuit(circuit)
        self.assertLess(label.get_top()[1],wire.get_center()[1]-.05)
        self.assertLessEqual(circuit.height,2.7)
        self.assertLessEqual(circuit.width,5)

    def make_scene(self):
        source=Rectangle(width=.3,height=1.4).move_to([-4.85,.3,0])
        resistor=Rectangle(width=.3,height=1.4).move_to([-2.05,.3,0])
        upper=Line([-4.85,1.35,0],[-2.05,1.35,0])
        lower=Line([-4.85,-.75,0],[-2.05,-.75,0])
        name=Text('电阻R',font='Microsoft YaHei',font_size=20).move_to([-2.05,-.55,0])
        circuit=Group(source,resistor,upper,lower,name)
        scene=Scene();scene.add(circuit)
        return scene,circuit,source,resistor,name

    def test_same_target_replaces_R_annotation_with_I_and_preserves_component_name(self):
        scene,circuit,source,resistor,name=self.make_scene()
        labels={}
        before=Text('R=3 Ω',font='Microsoft YaHei',font_size=20)
        after=Text('I=3 A',font='Microsoft YaHei',font_size=20)
        update_dynamic_label(scene,labels,['r1'],before,[resistor],circuit)
        update_dynamic_label(scene,labels,['r1'],after,[resistor],circuit)
        self.assertNotIn(before,scene.mobjects)
        self.assertIn(after,scene.mobjects)
        self.assertEqual(len(labels),1)
        self.assertIs(labels[('r1',)],after)
        self.assertIn(name,circuit.submobjects)
        self.assertEqual(name.text,'电阻R')

    def test_vertical_targets_place_annotations_outside_the_single_loop(self):
        scene,circuit,source,resistor,name=self.make_scene()
        labels={}
        voltage=Text('U=9 V',font='Microsoft YaHei',font_size=20)
        current=Text('I=3 A',font='Microsoft YaHei',font_size=20)
        update_dynamic_label(scene,labels,['source'],voltage,[source],circuit)
        update_dynamic_label(scene,labels,['r1'],current,[resistor],circuit)
        self.assertLess(voltage.get_right()[0],source.get_left()[0])
        self.assertGreater(current.get_left()[0],resistor.get_right()[0])
        for label in [voltage,current]:
            self.assertGreaterEqual(label.get_left()[0],-6.45-1e-9)
            self.assertLessEqual(label.get_right()[0],-.3+1e-9)
            self.assertLess(label.get_top()[1],1.35)
            self.assertGreater(label.get_bottom()[1],-.75)
        self.assertEqual(len(labels),2)

    def test_long_label_near_right_boundary_shrinks_without_pressing_on_component(self):
        scene,circuit,source,resistor,name=self.make_scene()
        self.assertAlmostEqual(resistor.get_right()[0],-1.9)
        label=Text('控制变量：电阻R保持不变',font='Microsoft YaHei',font_size=20)
        original_width=label.width
        update_dynamic_label(scene,{},['r1'],label,[resistor],circuit)
        self.assertLess(label.width,original_width)
        self.assertGreaterEqual(label.get_left()[0],resistor.get_right()[0]+.16-1e-9)
        self.assertLessEqual(label.get_right()[0],-.3+1e-9)

    def test_same_target_set_reordered_replaces_and_horizontal_target_stays_above(self):
        scene,circuit,source,resistor,name=self.make_scene()
        labels={}
        first=Text('先前说明',font='Microsoft YaHei',font_size=20)
        replacement=Text('共同电流',font='Microsoft YaHei',font_size=20)
        update_dynamic_label(scene,labels,['source','r1'],first,[source,resistor],circuit)
        update_dynamic_label(scene,labels,['r1','source'],replacement,[resistor,source],circuit)
        self.assertNotIn(first,scene.mobjects)
        self.assertIn(replacement,scene.mobjects)
        self.assertEqual(len(labels),1)
        self.assertGreater(replacement.get_bottom()[1],max(source.get_top()[1],resistor.get_top()[1]))

if __name__=='__main__':
    unittest.main()
