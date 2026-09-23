"""Portable, process-local font registration and design-pixel text helpers.

Copy this module plus public/video/fonts with the project. No system install is
performed. VIDEO_FONT_DIR can select an alternative bundled font directory.
"""
from __future__ import annotations
from functools import lru_cache
from itertools import groupby
from pathlib import Path
import html
import json
import os
import re

# Shared 1920x1080 teaching typography. Layouts use these roles rather than
# inventing smaller body text to fit a particular lesson.
TITLE_PX = 36
BODY_PX = 42
NOTE_PX = 30
BODY_BASELINE_PX = 56


@lru_cache(maxsize=1)
def font_directory() -> Path:
    configured = os.environ.get('VIDEO_FONT_DIR')
    candidates = [Path(configured)] if configured else [
        Path(__file__).resolve().parent.parent / 'public' / 'video' / 'fonts',
        Path(__file__).resolve().parent.parent / 'assets' / 'fonts',
        Path(__file__).resolve().parent / 'fonts',
    ]
    for candidate in candidates:
        if (candidate / 'manifest.json').is_file():
            return candidate.resolve()
    raise FileNotFoundError('内置视频字体目录缺失；请随工程复制 public/video/fonts。')


@lru_cache(maxsize=1)
def font_manifest() -> dict:
    return json.loads((font_directory() / 'manifest.json').read_text(encoding='utf-8-sig'))


@lru_cache(maxsize=1)
def register_video_fonts() -> dict:
    """Register original TTF/OTF files with the native Pango backend for this process."""
    import manimpango
    directory = font_directory()
    for record in font_manifest()['fonts']:
        path = (directory / record['file']).resolve()
        if path.parent != directory or not path.is_file():
            raise FileNotFoundError('内置字体文件缺失：' + record['file'])
        if not manimpango.register_font(str(path)):
            raise RuntimeError('Pango 无法注册内置字体：' + record['file'])
    # Manim caches the font list independently from Pango.
    from manim import Text, MarkupText
    Text.font_list.cache_clear()
    MarkupText.font_list.cache_clear()
    available = set(manimpango.list_fonts())
    for record in font_manifest()['fonts']:
        if not any(name in available for name in record['families']):
            raise RuntimeError('Pango 未发现已注册字体：' + record['family'])
    return font_manifest()


def family(role: str = 'chinese') -> str:
    records = font_manifest()['fonts']
    return next(row['family'] for row in records if row['role'] == role)


def design_font_size(design_px: float, *, pixel_height: float = 1080, frame_height: float = 8) -> float:
    """Manim 0.19 Text/MarkupText: em scene units = font_size / 72.

    At a 1080-pixel, 8-unit canvas: 42 design pixels -> 22.4 Manim points.
    Design coordinates from a 1920x1080 Illustrator artboard are pixel values,
    even when Illustrator labels them pt. Do not apply an extra CSS pt->px factor.
    """
    if design_px <= 0 or pixel_height <= 0 or frame_height <= 0:
        raise ValueError('字号与画布尺寸必须大于零')
    return design_px * 72 * frame_height / pixel_height


def fixed_text_line_spacing(design_px: float, baseline_px: float) -> float:
    """Text only: line_spacing argument for an exact baseline distance.

    Text line stepping skips the Pango 96/72 factor used for glyph em size,
    so its spacing parameter is (baseline/font_size)*4/3 - 1. Prefer separate
    mixed_text rows positioned at baseline_px / pixels_per_unit for rich text.
    """
    if design_px <= 0 or baseline_px <= 0:
        raise ValueError('字号与行距必须大于零')
    return baseline_px / design_px * 4 / 3 - 1


def mixed_markup(text: str, *, title: bool = False) -> str:
    """Use one Pango layout to share a baseline across Chinese/Latin runs."""
    chinese = family('chinese')
    latin = family('latin')
    def role(char):
        if char.isalpha() and re.match(r'[A-Za-z\u00c0-\u024f]', char):return 'latinItalic'
        if re.match(r'[\u2190-\u22ff]', char):return 'math'
        return 'chinese' if re.match(r'[\u2e80-\u9fff\uf900-\ufaff\uff00-\uffef\U00020000-\U000323af]', char) else 'latin'
    spans = []
    for kind, chars in groupby(text, key=role):
        font = chinese if kind == 'chinese' else family('math') if kind == 'math' else latin
        weight = ' weight="600"' if title and kind == 'chinese' else ''
        style = ' style="italic"' if kind == 'latinItalic' else ''
        spans.append('<span font_family="' + html.escape(font, quote=True) + '"' + weight + style + '>' + html.escape(''.join(chars)) + '</span>')
    return ''.join(spans)


def mixed_text(text: str, *, design_px: float = 42, title: bool = False,
               pixel_height: float = 1080, frame_height: float = 8, **kwargs):
    """Single-baseline mixed text; place separate rows for exact 56px leading."""
    register_video_fonts()
    from manim import MarkupText
    kwargs.setdefault('disable_ligatures', True)
    result = MarkupText(mixed_markup(text, title=title), font=family('latin'),
                        font_size=design_font_size(design_px, pixel_height=pixel_height, frame_height=frame_height),
                        **kwargs)
    result.source_text = text
    return result


CN_FONT = 'FZLanTingYuanS-R-GB'
LATIN_FONT = 'STIX Two Text'
TITLE_FONT = CN_FONT
SYNTHETIC_TITLE = True


def make_text(value: str, size_px: float = 42, title: bool = False, color='#333333', **kwargs):
    """Scene-layout API: design-coordinate size, one correctly aligned Pango row."""
    return mixed_text(value, design_px=size_px, title=title, color=color, **kwargs)


def glyphs_for_range(line, start: int, end: int):
    """Get rendered glyphs for a half-open range in the original plain text.

    MarkupText.chars omits whitespace. Ligatures are disabled by mixed_text;
    unexpected shaping cannot silently highlight the wrong source characters.
    """
    from manim import VGroup
    text = getattr(line, 'source_text', None)
    if text is None:
        raise ValueError('字符区间高亮需要 mixed_text 生成的文字对象。')
    if not 0 <= start <= end <= len(text):
        raise ValueError('高亮字符区间超出原文长度。')
    visible = [index for index, char in enumerate(text) if not char.isspace()]
    if len(visible) != len(line.chars):
        raise ValueError('字体塑形后的字符数与原文不一致，无法可靠定位高亮；请拆分该文字片段。')
    return VGroup(*(line.chars[glyph_index] for glyph_index, char_index in enumerate(visible) if start <= char_index < end))


@lru_cache(maxsize=1)
def stix_tex_template():
    """XeLaTeX formula template using portable font files by absolute path.

    STIX Two Text handles \text{} Latin; STIX Two Math supplies true math
    italics/operators/fractions; xeCJK uses the bundled Chinese font.
    """
    import shutil
    from manim import TexTemplate
    if not shutil.which('xelatex'):
        raise RuntimeError('内置字体公式需要 XeLaTeX；请配置现有 TeX 环境的 xelatex。')
    directory = font_directory().as_posix().rstrip('/') + '/'
    if any(char in directory for char in '{}\n\r'):
        raise ValueError('TeX 字体目录不得含花括号或换行。')
    font_path = r'\detokenize{' + directory + '}'
    records = {row['role']: row for row in font_manifest()['fonts']}
    preamble = r"""\usepackage{amsmath}
\usepackage{fontspec}
\usepackage{unicode-math}
\usepackage{xeCJK}
"""
    preamble += r'\setmainfont[Path={' + font_path + r'},ItalicFont={' + records['latinItalic']['file'] + r'}]{' + records['latin']['file'] + '}\n'
    preamble += r'\setmathfont[Path={' + font_path + r'}]{' + records['math']['file'] + '}\n'
    preamble += r'\setCJKmainfont[Path={' + font_path + r'}]{' + records['chinese']['file'] + '}\n'
    # Literal English in \text (for example unit labels) uses the same true
    # italic face as board text. Digits, whitespace, Chinese and TeX commands
    # are left intact; this does not change the source/highlight substrings.
    preamble += r"""
\ExplSyntaxOn
\AtBeginDocument{
\cs_new_eq:NN \lesson_original_text:n \text
\cs_new_eq:NN \lesson_original_mathrm:n \symup
\tl_new:N \l_lesson_text_tl
\cs_set_protected:Npn \text #1
  {
    \group_begin:
    \tl_set:Nn \l_lesson_text_tl {#1}
    \regex_replace_all:nnN {(\c{special}\cB\{.*?\cE\})|([A-Za-z]+)} {\1\c{textit}\cB\{\2\cE\}} \l_lesson_text_tl
    \exp_args:NV \lesson_original_text:n \l_lesson_text_tl
    \group_end:
  }
\cs_set_protected:Npn \mathrm #1
  {
    \group_begin:
    \tl_set:Nn \l_lesson_text_tl {#1}
    \regex_replace_all:nnN {(\c{special}\cB\{.*?\cE\})|([A-Za-z]+)} {\1\c{symit}\cB\{\2\cE\}} \l_lesson_text_tl
    \exp_args:NV \lesson_original_mathrm:n \l_lesson_text_tl
    \group_end:
  }
}
\ExplSyntaxOff
""" + '\n'
    return TexTemplate(tex_compiler='xelatex', output_format='.xdv', preamble=preamble,
                       documentclass=r'\documentclass[preview,10pt]{standalone}')



def design_math_font_size(design_px: float, *, pixel_height: float = 1080, frame_height: float = 8) -> float:
    """MathTex em size for stix_tex_template's explicit 10 TeX-point document.

    dvisvgm converts TeX pt (72.27/in) to SVG bp (72/in), then Manim applies
    SCALE_FACTOR_PER_FONT_POINT. This differs from Pango Text's /72 rule.
    """
    from manim.constants import SCALE_FACTOR_PER_FONT_POINT
    if design_px <= 0 or pixel_height <= 0 or frame_height <= 0:
        raise ValueError('字号与画布尺寸必须大于零')
    svg_em = 10 * 72 / 72.27
    return design_px * frame_height / pixel_height / (svg_em * SCALE_FACTOR_PER_FONT_POINT)


@lru_cache(maxsize=512)
def _svg_baseline_ratio(svg_file: str) -> float:
    """Baseline offset from glyph-box centre, normalized by its unscaled height."""
    from xml.etree import ElementTree as ET
    from manim import SVGMobject
    svg = ET.parse(svg_file)
    positions = [float(node.attrib['y']) for node in svg.iter()
                 if node.tag.rsplit('}', 1)[-1] == 'use' and 'y' in node.attrib]
    if not positions:
        raise ValueError('Pango SVG 没有可识别的字形基线。')
    # Cairo can offset fallback font runs by a fractional SVG unit. The lower
    # baseline is the line's baseline; glyph outlines and explicit descenders
    # remain exactly as Pango shaped them.
    baseline = max(positions)
    raw = SVGMobject(svg_file, should_center=False, height=None, width=None)
    if not raw.height:
        return 0.0
    # SVGMobject flips y about the glyph-box centre (not the SVG origin).
    return float((raw.get_center()[1] - baseline) / raw.height)


def text_baseline_y(line) -> float:
    """Current scene-coordinate baseline after translation/uniform scaling."""
    if not hasattr(line, 'source_text'):
        raise ValueError('基线定位需要 mixed_text 生成的单行文字对象。')
    if '\n' in line.source_text or '\r' in line.source_text:
        raise ValueError('固定行距请逐行创建文字，再分别定位基线。')
    return float(line.get_center()[1] + _svg_baseline_ratio(str(line.file_name)) * line.height)


def place_text_baseline(line, left_x: float, baseline_y: float):
    """Position the visible left edge and true baseline without changing type size."""
    line.shift([left_x - line.get_left()[0], baseline_y - text_baseline_y(line), 0])
    return line
