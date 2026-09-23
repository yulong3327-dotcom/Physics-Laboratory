"""Share only complete SVG formulas; keep TeX compiler scratch files isolated."""
from pathlib import Path
from tempfile import TemporaryDirectory
from threading import RLock
from xml.etree import ElementTree
import os

from manim import config, tempconfig
from manim.utils.tex_file_writing import tex_hash, tex_to_svg_file


_compile_lock = RLock()


def valid_svg(path):
    try:
        return ElementTree.parse(path).getroot().tag.rsplit('}', 1)[-1] == 'svg'
    except (OSError, ElementTree.ParseError):
        return False


def cached_tex_to_svg_file(expression, environment=None, tex_template=None):
    directory = os.environ.get('VIDEO_LATEX_CACHE_DIR')
    if not directory:
        return tex_to_svg_file(expression, environment, tex_template)
    template = tex_template or config['tex_template']
    source = (template.get_texcode_for_expression_in_env(expression, environment)
              if environment is not None else template.get_texcode_for_expression(expression))
    directory = Path(directory).resolve()
    directory.mkdir(parents=True, exist_ok=True)
    cached = directory / (tex_hash(source) + '.svg')
    if valid_svg(cached):
        return cached
    # Manim's cleanup deletes every non-SVG intermediate in tex_dir. Sharing
    # that directory lets one renderer remove another renderer's active XDV.
    # A unique scratch directory also makes retries safe after a killed writer.
    with _compile_lock, TemporaryDirectory(prefix='.compile-', dir=directory) as scratch:
        if valid_svg(cached):
            return cached
        with tempconfig({'tex_dir': scratch}):
            generated = tex_to_svg_file(expression, environment, template)
        if not valid_svg(generated):
            raise ValueError('公式编译未输出完整 SVG，请重试。')
        # A reader can only see a complete SVG. Different processes may compile
        # the same miss concurrently, but never read or overwrite scratch files.
        try:
            Path(generated).replace(cached)
        except PermissionError:
            # On Windows another renderer can briefly hold the published file.
            if not valid_svg(cached):
                raise
        return cached


def install_shared_tex_cache():
    if os.environ.get('VIDEO_LATEX_CACHE_DIR'):
        from manim.mobject.text import tex_mobject
        tex_mobject.tex_to_svg_file = cached_tex_to_svg_file
