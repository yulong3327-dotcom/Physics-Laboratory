"""Reference-video capabilities keep event semantics and positioned geometry."""
from copy import deepcopy
from pathlib import Path
import tempfile
import unittest
import numpy as np
from manim import tempconfig, VMobject
from circuit import CircuitMobject
from scene import animation_span
from scene_layout import SceneLayout, box_of
from scene_preview import build_preview
from video_validation import Audit, check_event_visibility, validate_state_geometry
from test_circuit import asset


class ReferenceEffectsTest(unittest.TestCase):
    def project(self):
        cue=lambda phrase:{'utteranceId':'u','phrase':phrase}
        return {'title':'串联分压','settings':{'background':'#ffffff'},'speakers':[{'id':'teacher','name':'老师'}],
                'utterances':[{'id':'u','speakerId':'teacher','text':'先给定律，再写电流，替换结果，回看定律。'}], 'circuits':[],
                'shots':[{'id':'s','utteranceIds':['u'],'boardTexts':[],'actions':[],
                    'formulas':[{'id':'law','latex':'U=IR','action':'write','cue':cue('定律')},
                                {'id':'current','latex':'I=2','action':'write','display':'append','cue':cue('电流')},
                                {'id':'result','latex':'U=6','action':'write','cue':cue('结果')}],
                    'highlights':[{'id':'h','targetType':'formula','targetId':'law','phrase':'U=IR','effect':'box','cue':cue('回看') }]}]}

    def test_append_retains_older_row_and_highlight_while_replace_retires_only_latest(self):
        project=self.project();shot=project['shots'][0]
        events=[{'type':'formula','data':item} for item in shot['formulas']]+[{'type':'highlight','data':shot['highlights'][0]}]
        check_event_visibility(shot,{'events':events})
        wrong=deepcopy(events);wrong[-1]['data']['targetId']='current'
        with self.assertRaisesRegex(Exception,'已被替换'):check_event_visibility(shot,{'events':wrong})
        with tempfile.TemporaryDirectory(dir=Path.cwd()) as directory:
            preview=build_preview(project,'s','highlight:h',directory)
            objects={item['id']:item for item in preview['elements']}
            self.assertTrue(objects['formula:law']['visible']);self.assertTrue(objects['formula:result']['visible'])
            self.assertFalse(objects['formula:current']['visible'])
            self.assertLess(objects['formula:law']['box']['y']+objects['formula:law']['box']['height'],objects['formula:result']['box']['y'])
            self.assertIn('0.16',objects['formula:law']['svg'])

    def test_geometry_snapshot_keeps_editor_mapping_and_hidden_state_and_stops_unknown_flow(self):
        original=asset()
        with tempfile.TemporaryDirectory(dir=Path.cwd()) as directory:
            circuit=CircuitMobject(original,Path(directory)/'before',width=5,height=3).scale(1.7).shift([2.,-1.,0.])
            circuit.set_visibility('r',False)
            positions={key:value.get_center().copy() for key,value in circuit.ports.items()}
            snapshot=deepcopy(original['geometry'])
            snapshot['bounds']={'x':-200,'y':-200,'width':500,'height':500}
            for wire in snapshot['wires']:wire['current']=None
            replacement=circuit.with_geometry(snapshot,Path(directory)/'after')
            for key,position in positions.items():np.testing.assert_allclose(replacement.ports[key].get_center(),position,atol=1e-8)
            self.assertEqual(replacement.flow_particles,{})
            self.assertIn('r',replacement._hidden_ids)
            replacement.set_visibility('r',True)
            self.assertTrue(any(m.get_stroke_opacity()>0 for m in replacement.components['r'].get_family() if isinstance(m,VMobject)))
            circuit.set_visibility('circuit',False)
            hidden=circuit.with_geometry(snapshot,Path(directory)/'hidden')
            hidden.set_visibility('circuit',True)
            self.assertTrue(any(m.get_fill_opacity()>0 for m in hidden.labels['r'].get_family() if isinstance(m,VMobject)))

    def test_annotation_uses_same_parent_transform_and_does_not_move_circuit(self):
        timeline={'projectTitle':'电压范围','settings':{'background':'#fff'},'speakers':[],'circuit':asset(),
                  'shot':{'id':'s','boardTexts':[],'formulas':[],'actions':[]}}
        annotation={'id':'u1','type':'annotation','targetIds':['r'],'annotation':{'kind':'voltage','label':'U₁','offset':42}}
        with tempfile.TemporaryDirectory(dir=Path.cwd()) as directory:
            with tempconfig({'media_dir':directory,'frame_width':128/9,'frame_height':8}):
                layout=SceneLayout(timeline,Path(directory)/'one')
                before={key:port.get_center().copy() for key,port in layout.circuit.ports.items()}
                _,_,mark=layout.create_circuit_annotation(annotation);base=box_of(mark);natural=layout.elements['circuit']['natural']
                for key,position in before.items():np.testing.assert_allclose(layout.circuit.ports[key].get_center(),position,atol=1e-8)
                changed=deepcopy(timeline);changed['shot']['layout']={'elements':{'circuit':{'x':250,'y':280,'scale':1.2}}}
                second=SceneLayout(changed,Path(directory)/'two');_,_,scaled=second.create_circuit_annotation(annotation);actual=box_of(scaled)
                self.assertAlmostEqual(actual['width'],base['width']*1.2,places=5)
                self.assertAlmostEqual(actual['x'],250+(base['x']-natural['x'])*1.2,places=5)

    def test_authored_duration_is_capped_before_next_event(self):
        event={'type':'board','data':{'durationSeconds':2.0,'entrance':'write'}}
        self.assertEqual(animation_span([event],5,30),2)
        self.assertAlmostEqual(animation_span([event],.5,30),.5-1/30)
        self.assertEqual(animation_span([event],.01,30),0)

    def test_state_preflight_rejects_disconnected_geometry_even_with_valid_ids(self):
        snapshot=asset()['geometry']
        snapshot['wires']=snapshot['wires'][:1]
        snapshot['wires'][0]['path']='M -49 0 L -80 0 L -80 50 L 50 50 L 50 0'
        with tempfile.TemporaryDirectory(dir=Path.cwd()) as directory:
            audit=Audit();validate_state_geometry({'id':'s'},{'id':'open','geometry':snapshot},audit,Path(directory))
            self.assertTrue(any('misses r.left' in error for error in audit.errors))


if __name__=='__main__':unittest.main()
