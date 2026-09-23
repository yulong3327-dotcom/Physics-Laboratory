import unittest
from manim import Rectangle,VGroup
from scene import BoardMobject,highlight_mobjects
from fonts import glyphs_for_range


class BoardHighlightSpacingTest(unittest.TestCase):
    def test_current_box_and_marker_leave_one_pixel_before_adjacent_i(self):
        text='电流 I=2 A'
        board=BoardMobject(text,'FZLanTingYuanS-R-GB',width=6,size=42)
        region=board.phrase_regions('电流')[0]
        line=board.runs[0][2]
        neighbour=glyphs_for_range(line,text.index('I'),text.index('I')+1)
        for effect,default in [('box',.08),('marker',.065)]:
            with self.subTest(effect=effect):
                mark=highlight_mobjects([region],'#FF6600',effect)[0]
                outer_right=mark.get_right()[0]+mark.get_stroke_width()*.01/2
                self.assertLessEqual(outer_right+1/135,neighbour.get_left()[0]+1e-9)
                self.assertAlmostEqual(region.get_left()[0]-mark.get_left()[0],default)
                self.assertLess(mark.get_center()[0],region.get_center()[0])

    def test_formula_regions_without_board_gaps_keep_default_padding_and_center(self):
        region=VGroup(Rectangle(width=1.3,height=.4))
        for effect,padding in [('box',.16),('marker',.13)]:
            with self.subTest(effect=effect):
                mark=highlight_mobjects([region],'#4F80FF',effect)[0]
                self.assertAlmostEqual(mark.width,region.width+padding)
                self.assertAlmostEqual(mark.get_center()[0],region.get_center()[0])
                self.assertAlmostEqual(mark.corner_radius,.055)


if __name__=='__main__':unittest.main()
