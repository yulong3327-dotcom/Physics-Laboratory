import base64
from pathlib import Path
import tempfile
import unittest
from manim import tempconfig
from scene import BoardMobject, FormulaMobject, lesson_header, highlight_mobjects

class BoardTest(unittest.TestCase):
    def test_repeated_phrases_resolve_to_the_requested_visible_occurrence(self):
        board=BoardMobject('已知电流为2 A；电流为2 A。', 'Microsoft YaHei', width=1.45, size=42)
        first=board.phrase_regions('电流',1)
        second=board.phrase_regions('电流',2)
        self.assertNotEqual(tuple(first[0].get_center()),tuple(second[0].get_center()))
        phrase='电流为2 A；电流'
        spanning=board.phrase_regions(phrase)
        self.assertGreater(len(spanning),1)
        self.assertTrue(all(region.width>0 for region in spanning))
        self.assertEqual(sum(len(region) for region in spanning),len(phrase.replace(' ','')))
        with self.assertRaisesRegex(ValueError,'不存在'):board.phrase_regions('电流',3)

    def test_emphasis_opacity_and_header_follow_the_style_contract(self):
        board=BoardMobject('关键词','Microsoft YaHei')
        regions=board.phrase_regions('关键词')
        self.assertAlmostEqual(highlight_mobjects(regions,'#4F80FF','marker')[0].get_fill_opacity(),.32)
        self.assertAlmostEqual(highlight_mobjects(regions,'#FF6600','underline')[0].get_stroke_opacity(),.4)
        box=highlight_mobjects(regions,'#16C863','box')[0]
        self.assertAlmostEqual(box.get_fill_opacity(),.16)
        self.assertAlmostEqual(box.get_stroke_width(),3.5)
        self.assertGreater(box.corner_radius,0)
        pin='data:image/png;base64,'+base64.b64encode((Path(__file__).resolve().parents[1]/'public/video/title-pin.png').read_bytes()).decode()
        short=lesson_header('电功率','Microsoft YaHei',pin)
        long=lesson_header('电功率公式与应用','Microsoft YaHei',pin)
        self.assertGreater(long[0].width,short[0].width)
        self.assertEqual(len(short),3)
        self.assertGreater(short[2].height,0)
        self.assertGreater(short.get_left()[0],-7.12)
        self.assertLess(short.get_top()[1],4)

    def test_formula_repeated_factor_is_independently_addressable(self):
        with tempfile.TemporaryDirectory(dir=Path.cwd()) as directory, tempconfig({'media_dir':Path(directory).as_posix()}):
            f=FormulaMobject({'latex':r'P=I^2R+I^2R','parts':[{'id':'i','latex':'I^2'}]},highlight_phrases=['I^2'])
            one=f.phrase_regions('I^2',1)[0];two=f.phrase_regions('I^2',2)[0]
            self.assertGreater(one.width,0)
            self.assertGreater(two.get_left()[0],one.get_right()[0])
            self.assertGreater(len(f.part('i')),0)

if __name__=='__main__':unittest.main()
