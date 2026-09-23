"""Source text stays editable when the installed font cannot map its glyphs."""
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch
from scene_preview import build_preview
from fonts import glyphs_for_range


def project_with_board(value):
    return {'title':'文字元数据验证','settings':{'background':'#ffffff'},'speakers':[{'id':'teacher','name':'方大招'}],
            'utterances':[{'id':'u','speakerId':'teacher','text':'观察已知条件。'}],'circuits':[],
            'shots':[{'id':'s','title':'题设','utteranceIds':['u'],'formulas':[],'actions':[],
                      'boardTexts':[{'id':'b','kind':'given','text':value}]}]}


class PreviewTextMetadataTest(unittest.TestCase):
    def test_plain_board_preserves_text_source_and_exact_visible_character_ranges(self):
        value='已知 R₁ = 6 Ω。\n电流 I = 2 A。'
        with tempfile.TemporaryDirectory(dir=Path.cwd()) as directory:
            preview=build_preview(project_with_board(value),'s',directory=Path(directory))
        board=next(e for e in preview['elements'] if e['id']=='board:b')
        self.assertEqual(board['text'],value)
        self.assertEqual(board['source'],{'type':'board','id':'b'})
        self.assertEqual(board['textKind'],'plain')
        utf16=value.encode('utf-16-le')
        selected=[utf16[c['start']*2:c['end']*2].decode('utf-16-le') for c in board['characters']]
        self.assertEqual(selected,[c for c in value if not c.isspace()])
        self.assertNotIn('selectionWarning',board)

    def test_unmappable_emoji_keeps_svg_and_editable_source_without_partial_selection(self):
        value='已知电阻 R=6 Ω。\n😀 电流 I=2 A。'
        # The actual bundled CJK font produces multiple fallback glyphs here.
        # Model that condition explicitly so the contract also holds on machines
        # which happen to install a font with a one-glyph emoji representation.
        def unavailable(line,start,end):
            if '😀' in line.source_text:raise ValueError('字体塑形后的字符数与原文不一致')
            return glyphs_for_range(line,start,end)
        with tempfile.TemporaryDirectory(dir=Path.cwd()) as directory,patch('fonts.glyphs_for_range',side_effect=unavailable):
            preview=build_preview(project_with_board(value),'s',directory=Path(directory))
        board=next(e for e in preview['elements'] if e['id']=='board:b')
        self.assertTrue(board['visible'])
        self.assertIn('<path',board['svg'])
        self.assertEqual(board['text'],value)
        self.assertEqual(board['source'],{'type':'board','id':'b'})
        self.assertNotIn('characters',board)
        self.assertEqual(board['selectionWarning'],'此段文字含无法逐字定位的字形，可编辑文字后选词。')
        self.assertIn(board['selectionWarning'],preview['warnings'])


if __name__=='__main__':unittest.main()
