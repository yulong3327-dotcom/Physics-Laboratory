"""A failed/concurrent compiler must never expose an incomplete formula cache."""
from pathlib import Path
from tempfile import TemporaryDirectory
from unittest import TestCase, main
from unittest.mock import patch
from concurrent.futures import ThreadPoolExecutor
from xml.etree import ElementTree
import os

from manim import TexTemplate, config
from manim.utils.tex_file_writing import tex_hash
from latex_cache import cached_tex_to_svg_file


class LatexCacheTest(TestCase):
    def test_reuses_valid_svg_and_recovers_from_interrupted_compile(self):
        with TemporaryDirectory() as root, patch.dict(os.environ, VIDEO_LATEX_CACHE_DIR=root):
            template = TexTemplate()
            target = Path(root) / (tex_hash(template.get_texcode_for_expression_in_env('P=UI', 'align*')) + '.svg')
            target.write_text('<svg', encoding='utf-8')
            stale = Path(root) / target.with_suffix('.xdv').name
            stale.write_bytes(b'incomplete compiler output')
            original_tex_dir = config['tex_dir']
            def compile_svg(*args):
                self.assertNotEqual(config.get_dir('tex_dir'), Path(root))
                self.assertTrue(stale.exists())
                result = config.get_dir('tex_dir') / target.name
                result.write_text('<svg xmlns="http://www.w3.org/2000/svg"><path d="M0 0 L1 1"/></svg>', encoding='utf-8')
                return result
            with patch('latex_cache.tex_to_svg_file', side_effect=compile_svg) as compile_call:
                self.assertEqual(cached_tex_to_svg_file('P=UI', 'align*', template), target)
                self.assertEqual(cached_tex_to_svg_file('P=UI', 'align*', template), target)
                compile_call.assert_called_once()
            ElementTree.parse(target)
            self.assertEqual(config['tex_dir'], original_tex_dir)
            self.assertFalse(list(Path(root).glob('.compile-*')))

    def test_failed_compile_does_not_publish_or_leave_scratch_directory(self):
        with TemporaryDirectory() as root, patch.dict(os.environ, VIDEO_LATEX_CACHE_DIR=root):
            original_tex_dir = config['tex_dir']
            def interrupted(*args):
                (config.get_dir('tex_dir') / 'partial.svg').write_text('<svg', encoding='utf-8')
                raise RuntimeError('interrupted')
            with patch('latex_cache.tex_to_svg_file', side_effect=interrupted):
                with self.assertRaisesRegex(RuntimeError, 'interrupted'):
                    cached_tex_to_svg_file('P=UI')
            self.assertEqual(list(Path(root).iterdir()), [])
            self.assertEqual(config['tex_dir'], original_tex_dir)

    def test_parallel_requests_compile_once_and_get_complete_svg(self):
        with TemporaryDirectory() as root, patch.dict(os.environ, VIDEO_LATEX_CACHE_DIR=root):
            def compile_svg(*args):
                result = config.get_dir('tex_dir') / 'result.svg'
                result.write_text('<svg xmlns="http://www.w3.org/2000/svg"/>', encoding='utf-8')
                return result
            with patch('latex_cache.tex_to_svg_file', side_effect=compile_svg) as compile_call:
                with ThreadPoolExecutor(max_workers=4) as pool:
                    paths = list(pool.map(lambda _: cached_tex_to_svg_file('P=UI'), range(4)))
                compile_call.assert_called_once()
            self.assertEqual(len(set(paths)), 1)
            ElementTree.parse(paths[0])


if __name__ == '__main__':
    main()
