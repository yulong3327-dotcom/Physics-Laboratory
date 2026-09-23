import tempfile
import unittest
from pathlib import Path
from manim import tempconfig
from scene import FormulaMobject, highlight_mobjects


class FormulaHighlightNestingTest(unittest.TestCase):
    def test_whole_formula_and_nested_ratio_each_keep_real_geometry(self):
        latex = r'P_1:P_2=\frac{1}{R_1}:\frac{1}{R_2}=R_2:R_1'
        with tempfile.TemporaryDirectory(dir=Path.cwd()) as directory, tempconfig({'media_dir': directory, 'verbosity': 'ERROR'}):
            formula = FormulaMobject({'id': 'batch-13-f6', 'latex': latex}, [r'R_2:R_1', latex])
            full = formula.phrase_regions(latex)[0]
            local = formula.phrase_regions(r'R_2:R_1')[0]
            self.assertIs(full, formula)
            self.assertGreater(local.width, 0)
            self.assertLess(local.width, full.width / 2)
            self.assertGreater(local.get_center()[0], full.get_center()[0])
            full_mark = highlight_mobjects([full], '#4F80FF', 'box')[0]
            local_mark = highlight_mobjects([local], '#FF6600', 'underline')[0]
            self.assertGreater(full_mark.width, local_mark.width)
            self.assertNotIn(latex, formula.token_groups)
            # Regions follow the same transformed object rather than copied glyphs.
            formula.scale(.7).shift([1.2, -.3, 0])
            self.assertAlmostEqual(formula.phrase_regions(latex)[0].width, formula.width)
            self.assertGreater(formula.phrase_regions(r'R_2:R_1')[0].width, 0)
            with self.assertRaises(ValueError):
                formula.phrase_regions(latex, 2)

    def test_whole_highlight_preserves_declared_animation_factors(self):
        latex = r'P_1=I^2R_1'
        step = {'id': 'factor-step', 'latex': latex, 'parts': [{'id': 'current', 'latex': 'I^2'}, {'id': 'resistance', 'latex': 'R_1'}]}
        with tempfile.TemporaryDirectory(dir=Path.cwd()) as directory, tempconfig({'media_dir': directory, 'verbosity': 'ERROR'}):
            formula = FormulaMobject(step, [latex])
            self.assertIs(formula.phrase_regions(latex)[0], formula)
            for identifier in ['current', 'resistance']:
                self.assertTrue(formula.part(identifier).family_members_with_points())
                self.assertGreater(formula.part(identifier).width, 0)
                self.assertLess(formula.part(identifier).width, formula.width)
            self.assertEqual(len(formula.ordered_parts()), 2)

    def test_full_expression_without_other_fragments_is_highlightable(self):
        latex = r'W=60\,\mathrm{J}'
        with tempfile.TemporaryDirectory(dir=Path.cwd()) as directory, tempconfig({'media_dir': directory, 'verbosity': 'ERROR'}):
            formula = FormulaMobject({'id': 'answer', 'latex': latex}, [latex])
            self.assertIs(formula.phrase_regions(latex)[0], formula)
            self.assertGreater(highlight_mobjects(formula.phrase_regions(latex), '#16C863', 'box')[0].width, formula.width)


if __name__ == '__main__':
    unittest.main()
