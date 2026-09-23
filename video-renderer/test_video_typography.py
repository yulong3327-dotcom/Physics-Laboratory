"""Check actual glyph faces, baseline alignment and TeX highlight preservation."""
from pathlib import Path
import tempfile
import unittest
from xml.etree import ElementTree as ET
import numpy as np
from manim import MathTex, tempconfig
from fonts import mixed_markup, mixed_text, glyphs_for_range, text_baseline_y, stix_tex_template, design_math_font_size, family
from scene import BoardMobject, FormulaMobject
from knowledge_cards import KnowledgeCard


class VideoTypographyTest(unittest.TestCase):
    def test_only_latin_letters_use_italic_face_and_source_ranges_survive(self):
        value='电功率 P=UI，R₁=10 Ω → A × ÷'
        root=ET.fromstring('<root>'+mixed_markup(value)+'</root>')
        self.assertEqual(''.join(root.itertext()),value)
        for span in root:
            if span.text in ['P','UI','R','A']:
                self.assertEqual(span.attrib['style'],'italic')
                self.assertEqual(span.attrib['font_family'],family('latinItalic'))
            else:self.assertNotIn('style',span.attrib)
        line=mixed_text(value)
        self.assertEqual(len(glyphs_for_range(line,4,8)),4)
        self.assertEqual(len(glyphs_for_range(line,3,4)),0)

    def test_card_and_plain_body_share_type_size_leading_and_left_alignment(self):
        with tempfile.TemporaryDirectory(dir=Path.cwd()) as directory,tempconfig({'media_dir':directory}):
            plain=BoardMobject('电功率 P\n电能 W',family('chinese'))
            card=KnowledgeCard({'text':'电功率 P\n电能 W','card':{'title':'电功率'}},750,[56])
            for (_,_,a),(_,_,b) in zip(plain.runs,card.body.runs):
                self.assertAlmostEqual(a.height,b.height,places=6)
                self.assertAlmostEqual(a.width,b.width,places=6)
            self.assertAlmostEqual((text_baseline_y(card.body.runs[0][2])-text_baseline_y(card.body.runs[1][2]))*135,56,places=5)
            self.assertAlmostEqual(card.title.get_left()[0],card.body.get_left()[0],places=6)

    def test_explicit_latex_letter_labels_are_italic_without_slanting_digits_or_losing_highlights(self):
        with tempfile.TemporaryDirectory(dir=Path.cwd()) as directory,tempconfig({'media_dir':directory,'tex_dir':str(Path(directory)/'Tex')}):
            def tex(value):return MathTex(value,tex_template=stix_tex_template(),font_size=design_math_font_size(42))
            for actual,expected in [(r'\mathrm{A}',r'A'),(r'\text{A}',r'\textit{A}'),(r'\text{2}',r'\textrm{2}'),(r'\mathrm{2}',r'2'),(r'\mathrm{\Omega}',r'\symup{\Omega}')]:
                a,b=tex(actual),tex(expected)
                np.testing.assert_allclose(a.get_all_points(),b.get_all_points(),atol=1e-5)
            for source,phrase in [(r'I=2\,\mathrm{A}',r'\mathrm{A}'),(r'I=2\,\mathrm{A}','A'),(r'P=6\,\text{W}','W')]:
                formula=FormulaMobject({'id':'f','latex':source},highlight_phrases=[phrase])
                self.assertEqual(formula.original_latex,source)
                self.assertTrue(formula.phrase_regions(phrase))


if __name__=='__main__':unittest.main()
