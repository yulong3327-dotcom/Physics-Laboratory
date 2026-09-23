import base64
from io import BytesIO
from pathlib import Path
import unittest
from xml.etree import ElementTree as ET
import numpy as np
from PIL import Image
from manim import Rectangle, Circle, Group, ImageMobject, tempconfig, PI
from scene_preview import serialize_mobject, preview_events

class SerializerTest(unittest.TestCase):
    def test_global_pixel_box_and_cubic_paths_preserve_position_and_stroke(self):
        with tempconfig({'frame_width':128/9,'frame_height':8}):
            obj=Rectangle(width=2,height=1,fill_color='#4F80FF',fill_opacity=.7,stroke_width=4).shift([2,1,0])
            result=serialize_mobject(obj);svg=ET.fromstring(result['svg']);path=next(n for n in svg if n.tag.endswith('path'))
            self.assertIn('C',path.attrib['d']);self.assertEqual(path.attrib['fill'],'#4f80ff');self.assertAlmostEqual(float(path.attrib['fill-opacity']),.7)
            self.assertAlmostEqual(float(path.attrib['stroke-width']),5.4)
            self.assertLess(result['box']['x'],1095);self.assertGreater(result['box']['x'],1090)
            self.assertLess(result['box']['y'],337.5);self.assertGreater(result['box']['y'],332)

    def test_raster_rotation_and_current_alpha_are_serialized_once(self):
        image=ImageMobject(np.full((10,20,4),[255,120,0,128],dtype=np.uint8)).set_opacity(.5).rotate(PI/2)
        result=serialize_mobject(image);svg=ET.fromstring(result['svg']);node=next(n for n in svg if n.tag.endswith('image'))
        pixels=np.asarray(Image.open(BytesIO(base64.b64decode(node.attrib['href'].split(',')[1]))))
        self.assertTrue(np.all(pixels[:,:,3]==64));self.assertIn('matrix(',node.attrib['transform']);self.assertGreater(result['box']['height'],result['box']['width'])

    def test_group_draw_order_uses_z_index_and_empty_paths_do_not_expand_box(self):
        front=Circle(radius=.5,fill_color='#FF6600',fill_opacity=1,stroke_width=0).set_z_index(2)
        back=Rectangle(width=2,height=2,fill_color='#4F80FF',fill_opacity=1,stroke_width=0).set_z_index(0)
        result=serialize_mobject(Group(front,back));nodes=[n for n in ET.fromstring(result['svg']) if n.tag.endswith('path')]
        self.assertEqual([n.attrib['fill'] for n in nodes],['#4f80ff','#ff6600'])

    def test_stage_order_uses_original_utterance_positions_and_stable_target_priority(self):
        project={'utterances':[{'id':'u1','text':'先给条件再显示公式然后强调'}]}
        cue={'utteranceId':'u1','phrase':'公式'}
        shot={'utteranceIds':['u1'],'boardTexts':[{'id':'b','cue':{'utteranceId':'u1','phrase':'条件'}}],'formulas':[{'id':'f','cue':cue}],'highlights':[{'id':'h','cue':cue}]}
        self.assertEqual([e['id'] for e in preview_events(project,shot)],['board:b','formula:f','highlight:h'])

    def test_selection_metadata_matches_visible_glyphs_after_scaling_and_wrap(self):
        from scene import BoardMobject
        from scene_layout import top_left,box_of
        from scene_preview import text_metadata
        from fonts import family
        text='电阻 R = 6 Ω\n电流 I = 2 A'
        obj=BoardMobject(text,family('chinese'),width=4,size=42).scale(1.2)
        top_left(obj,410,300)
        meta=text_metadata('board:b',obj,{'formulas':[]})
        self.assertEqual(meta['text'],text)
        self.assertEqual(meta['source'],{'type':'board','id':'b'})
        self.assertEqual(''.join(text[c['start']:c['end']] for c in meta['characters']),''.join(text.split()))
        for item in meta['characters']:
            expected=box_of(obj.phrase_regions(text[item['start']:item['end']],text[:item['start']].count(text[item['start']:item['end']])+1)[0])
            for key in expected:self.assertAlmostEqual(item['box'][key],expected[key],places=5)

if __name__=='__main__':unittest.main()
