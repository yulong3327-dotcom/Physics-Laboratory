import base64
from copy import deepcopy
from io import BytesIO
from pathlib import Path
import tempfile
import unittest
import numpy as np
from PIL import Image
from manim import ImageMobject, Group, tempconfig
from circuit import CircuitMobject, page_background, inline_image

def png_data(color=(100, 140, 180, 160)):
    image=Image.new('RGBA',(20,10),color)
    stream=BytesIO(); image.save(stream,format='PNG')
    return 'data:image/png;base64,'+base64.b64encode(stream.getvalue()).decode()

def asset():
    raster=png_data()
    overlay='<svg xmlns="http://www.w3.org/2000/svg" viewBox="-50 -40 100 80"><g transform="translate(-20 -10) scale(2)"><image href="'+raster+'" width="20" height="10" opacity="0.5" transform="rotate(90 10 5)"/><line x1="0" y1="0" x2="20" y2="10" stroke="#333" stroke-width="2"/></g></svg>'
    return {'id':'test','geometry':{'viewMode':'real','currentFlow':True,'bounds':{'x':-100,'y':-60,'width':200,'height':120},
        'components':[{'id':'r','x':0,'y':0,'width':100,'height':80,'label':'R','terminals':{'left':{'x':-50,'y':0},'right':{'x':50,'y':0}},
            'svg':overlay,'image':{'dataUrl':raster,'width':80,'height':40,'rotation':90}}],
        'wires':[{'id':'positive','path':'M -50 0 L -80 0 L -80 50 L 50 50 L 50 0','from':'r.left','to':'r.right','current':2},
            {'id':'negative','path':'M -50 -20 C -20 -50 20 -50 50 -20','from':'r.left','to':'r.right','current':-2},
            {'id':'zero','path':'M -40 -10 L 40 -10','from':'r.left','to':'r.right','current':0},
            {'id':'unknown','path':'M -40 10 L 40 10','from':'r.left','to':'r.right'}]}}

class CircuitTest(unittest.TestCase):
    def test_inline_background_covers_without_stretch_and_top_aligned(self):
        image=page_background(png_data(),16,9)
        self.assertAlmostEqual(image.width/image.height,2)
        self.assertGreaterEqual(image.width,16)
        self.assertGreaterEqual(image.height,9)
        self.assertAlmostEqual(image.get_top()[1],4.5)
        self.assertAlmostEqual(image.get_center()[0],0)
        with self.assertRaises(ValueError):
            inline_image('https://example.org/a.png')

    def test_raster_overlay_rotation_and_alpha_survive_hide_show_and_group_transform(self):
        with tempfile.TemporaryDirectory() as directory:
            circuit=CircuitMobject(asset(),directory,width=6,height=4)
            images=[o for o in circuit.component('r').get_family() if isinstance(o,ImageMobject)]
            self.assertEqual(len(images),2)
            self.assertAlmostEqual(images[0].width,40*circuit.factor)
            self.assertAlmostEqual(images[0].height,80*circuit.factor)
            # SVG rotate about (10,5), followed by scale+translate, keeps overlay centred.
            np.testing.assert_allclose(images[1].get_center(),[0,0,0],atol=1e-8)
            self.assertAlmostEqual(images[1].width,20*circuit.factor)
            self.assertAlmostEqual(images[1].height,40*circuit.factor)
            before=[i.pixel_array[:,:,3].copy() for i in images]
            circuit.set_visibility('r',False)
            self.assertTrue(all(np.max(i.pixel_array[:,:,3])==0 for i in images))
            circuit.set_visibility('r',True)
            for im,alpha in zip(images,before):
                np.testing.assert_array_equal(im.pixel_array[:,:,3],alpha)
            old_port=circuit.port('r','left').get_center().copy()
            old_wire=circuit._flows[0]['curve'].get_start().copy()
            np.testing.assert_allclose(old_port,old_wire,atol=1e-8)
            circuit.scale(1.5).shift([1,2,0])
            np.testing.assert_allclose(circuit.port('r','left').get_center(),circuit._flows[0]['curve'].get_start(),atol=1e-8)
            self.assertIs(circuit.resolve_target('r'),circuit.component('r'))
            self.assertIs(circuit.resolve_target('positive'),circuit.wire('positive'))
            self.assertTrue(circuit.draw_animations('circuit'))

    def test_curved_wire_control_points_outside_bounds_do_not_move_terminals(self):
        example=asset()
        example['geometry']['wires']=[{'id':'curve','path':'M -50 0 C -300 -150 300 150 50 0','from':'r.left','to':'r.right','current':1}]
        with tempfile.TemporaryDirectory() as directory:
            circuit=CircuitMobject(example,directory)
            curve=circuit._flows[0]['curve']
            np.testing.assert_allclose(curve.get_start(),circuit.port('r','left').get_center(),atol=1e-8)
            np.testing.assert_allclose(curve.get_end(),circuit.port('r','right').get_center(),atol=1e-8)

    def test_wire_flow_runs_per_frame_with_signed_direction_and_no_unknown_particles(self):
        with tempfile.TemporaryDirectory() as directory:
            circuit=CircuitMobject(asset(),directory,width=6,height=4)
            self.assertEqual(set(circuit.flow_particles),{'positive','negative'})
            self.assertTrue(circuit.has_time_based_updater())
            initial={key:particles[0].get_center().copy() for key,particles in circuit.flow_particles.items()}
            circuit.update(1/24)
            for flow in circuit._flows:
                point=flow['particles'][0].get_center()
                self.assertGreater(np.linalg.norm(point-initial[flow['id']]),0)
                expected_side=flow['curve'].get_start() if flow['current']>0 else flow['curve'].get_end()
                self.assertLess(np.linalg.norm(point-expected_side),.3)
            circuit.set_visibility('circuit',False); circuit.update(.1)
            self.assertTrue(all(dot.get_fill_opacity()==0 for dots in circuit.flow_particles.values() for dot in dots))
            circuit.set_visibility('circuit',True); circuit.update(.1)
            self.assertTrue(all(dot.get_fill_opacity()==1 for dots in circuit.flow_particles.values() for dot in dots))
            no_flow=asset(); no_flow['geometry']['currentFlow']=False
            self.assertFalse(CircuitMobject(no_flow,Path(directory)/'off').has_time_based_updater())

if __name__=='__main__':
    unittest.main()
