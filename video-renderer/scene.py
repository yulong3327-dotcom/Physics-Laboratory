"""Controlled light textbook Manim scene, driven entirely by a resolved timeline."""
from pathlib import Path
from itertools import groupby
import json
import os
import shutil
import re
from functools import lru_cache
import sys
import numpy as np
from manim import *
from manim.mobject.text.tex_mobject import MathTexPart
sys.path.insert(0, str(Path(__file__).resolve().parent))
from circuit import CircuitMobject, page_background, inline_image
from raster_camera import LessonCamera

# Only complete SVGs are shared across renderers; compiler intermediates stay
# private so an interrupted or concurrent shot cannot poison the next render.
from latex_cache import install_shared_tex_cache
install_shared_tex_cache()

INK, MUTED, BLUE, ORANGE = '#333333', '#333333', '#4F80FF', '#FF6600'
HIGHLIGHT_COLORS = ['#4F80FF', '#FF6600', '#16C863', '#FF4D4D']


def complete_fragment(value):
    depth = 0
    for char in value:
        if char == '{':
            depth += 1
        elif char == '}':
            depth -= 1
        if depth < 0:
            return False
    return depth == 0 and bool(value.strip()) and value.strip() not in ['=', ':', r'\quad', r'\qquad', r'\Longrightarrow', r'\longrightarrow']


@lru_cache(maxsize=1)
def unicode_formula_template():
    if not shutil.which('xelatex'):
        raise RuntimeError('含中文的公式需要 XeLaTeX、xeCJK 与中文字体，请配置公式运行环境。')
    template = TexTemplate(tex_compiler='xelatex', output_format='.xdv')
    cjk_font = 'Microsoft YaHei' if os.name == 'nt' else 'Noto Sans CJK SC'
    template.add_to_preamble(r'\usepackage{xeCJK}\setCJKmainfont{' + cjk_font + '}')
    return template


def has_cjk(value):
    return bool(re.search(r'[\u3400-\u9fff\uf900-\ufaff]', value))


def update_dynamic_label(scene, labels, identifiers, label, targets, circuit, bounds=(-6.45, -.3)):
    """Replace one annotation per target set without touching component names."""
    key = tuple(sorted(identifiers))
    if key in labels:
        scene.remove(labels[key])
    group = Group(*targets)
    if len(targets) == 1 and group.height > group.width:
        direction = LEFT if group.get_center()[0] < circuit.get_center()[0] else RIGHT
        available = (group.get_left()[0] - bounds[0] if direction[0] < 0 else bounds[1] - group.get_right()[0]) - 0.16
        if label.width > max(0.2, min(1.75, available)):
            label.scale_to_fit_width(max(0.2, min(1.75, available)))
        label.next_to(group, direction, buff=0.16)
    else:
        label.next_to(group, UP, buff=0.18)
    if label.get_left()[0] < bounds[0]:
        label.shift(RIGHT * (bounds[0] - label.get_left()[0]))
    if label.get_right()[0] > bounds[1]:
        label.shift(LEFT * (label.get_right()[0] - bounds[1]))
    labels[key] = label
    scene.add(label)
    return label



def place_problem_circuit(circuit):
    """Fit a readable diagram and keep static labels clear of actual wire paths."""
    samples = []
    for wire in circuit.wires.values():
        for path in wire.family_members_with_points():
            if isinstance(path, VMobject) and path.get_num_curves():
                samples.extend(path.point_from_proportion(t) for t in np.linspace(0, 1, max(64, path.get_num_curves()*32)))
    points = np.array(samples)
    if len(points):
        for identifier, label in circuit.labels.items():
            component = circuit.components[identifier]
            direction = DOWN if component.width >= component.height else (RIGHT if label.get_center()[0] >= component.get_center()[0] else LEFT)
            for _ in range(40):
                left, right = label.get_left()[0]-.06, label.get_right()[0]+.06
                bottom, top = label.get_bottom()[1]-.06, label.get_top()[1]+.06
                if not np.any((points[:,0]>=left)&(points[:,0]<=right)&(points[:,1]>=bottom)&(points[:,1]<=top)):
                    break
                label.shift(direction*.08)
            else:
                raise ValueError('电路标签无法避开导线：' + identifier)
    # Preserve the established wire-clear positions unless a label intersects a
    # symbol or an earlier label. Move only that label; topology stays untouched.
    placed = []
    def label_box(label, margin=.06):
        return (label.get_left()[0]-margin, label.get_bottom()[1]-margin,
                label.get_right()[0]+margin, label.get_top()[1]+margin)
    def boxes_overlap(a, b):
        return a[0] < b[2] and b[0] < a[2] and a[1] < b[3] and b[1] < a[3]
    component_boxes = [label_box(obj, 0) for obj in circuit.components.values()]
    def blocked(label):
        box = label_box(label)
        if any(boxes_overlap(box, other) for other in component_boxes + placed):
            return True
        return bool(len(points) and np.any((points[:,0]>=box[0]) & (points[:,0]<=box[2]) &
                                          (points[:,1]>=box[1]) & (points[:,1]<=box[3])))
    for identifier, label in circuit.labels.items():
        if blocked(label):
            component = circuit.components[identifier]
            preferred = DOWN if component.width >= component.height else (RIGHT if label.get_center()[0] >= component.get_center()[0] else LEFT)
            directions = [preferred, -preferred] + ([RIGHT, LEFT] if abs(preferred[1]) else [UP, DOWN])
            candidates = []
            # Nearby cardinal positions first; tangential offsets help fit
            # parallel branches without shrinking names or moving conductors.
            for gap in [.12, .2, .28, .44, .6, .84, 1.12, 1.62, 2.12, 2.8]:
                for direction in directions:
                    tangent = np.array([-direction[1], direction[0], 0])
                    for offset in [0, .16, -.16, .32, -.32, .64, -.64]:
                        candidate = label.copy().next_to(component, direction, buff=gap).shift(tangent*offset)
                        candidates.append(candidate)
            candidates.sort(key=lambda candidate: np.linalg.norm(candidate.get_center()-component.get_center()))
            for candidate in candidates:
                if not blocked(candidate):
                    label.move_to(candidate.get_center())
                    break
            else:
                raise ValueError('电路标签无法避开元件、导线和其他标签：' + identifier)
        placed.append(label_box(label, 0))
    circuit.scale(min(1,5.0/circuit.width,2.7/circuit.height))
    circuit.move_to([3.12,.98,0])
    return circuit


def occurrence_start(text, phrase, occurrence=1):
    cursor = -len(phrase)
    for _ in range(occurrence):
        cursor = text.find(phrase, cursor + len(phrase))
        if cursor < 0:
            raise ValueError('高亮文字不存在：' + phrase)
    return cursor


class BoardMobject(VGroup):
    """Wrapped text with a stable character mapping back to the original board text."""
    def __init__(self, value, font, width=5.8, size=42, color=INK, line_spacing=56, title=False, **kwargs):
        super().__init__(**kwargs)
        self.original_text, self.runs = value, []
        from fonts import mixed_text, place_text_baseline
        # Design-pixel type sizes and explicit line steps are shared with SVG previews.
        budget=max(4,width*135/size)
        lines,start,used=[],0,0.0
        for index,char in enumerate(value):
            if char=='\n': lines.append((start,index));start=index+1;used=0;continue
            weight=1 if ord(char)>255 else .53
            if used+weight>budget and index>start:lines.append((start,index));start=index;used=0
            used+=weight
        if start<len(value):lines.append((start,len(value)))
        line_index=0
        for first,stop in lines:
            if not value[first:stop].strip():line_index+=1;continue
            # If measured glyphs exceed the line, wrap rather than shrink the fixed type size.
            while first<stop:
                end=stop
                line=mixed_text(value[first:end],design_px=size,title=title,color=color,disable_ligatures=True)
                while line.width>width and end>first+1:
                    end-=1;line=mixed_text(value[first:end],design_px=size,title=title,color=color,disable_ligatures=True)
                place_text_baseline(line,0,-line_index*line_spacing/135)
                self.add(line);self.runs.append((first,end,line));first=end;line_index+=1
        self.set_z_index(2)

    def phrase_regions(self, phrase, occurrence=1):
        first = occurrence_start(self.original_text, phrase, occurrence); stop = first + len(phrase)
        regions = []
        for a, b, line in self.runs:
            lo, hi = max(first, a), min(stop, b)
            if lo < hi:
                from fonts import glyphs_for_range
                chars = glyphs_for_range(line, lo-a, hi-a)
                if chars:
                    region=VGroup(*chars)
                    before=glyphs_for_range(line,0,lo-a)
                    after=glyphs_for_range(line,hi-a,b-a)
                    region._highlight_horizontal_gaps=(
                        region.get_left()[0]-before.get_right()[0] if len(before) else None,
                        after.get_left()[0]-region.get_right()[0] if len(after) else None)
                    regions.append(region)
        if not regions:
            raise ValueError('高亮范围没有可见字符')
        return regions


def highlight_mobjects(regions, color, effect):
    marks = VGroup()
    for region in regions:
        def horizontal_padding(default,stroke_width):
            # Cairo/SVG use .01 scene units per stroke-width unit. Reserve one
            # design pixel beyond the outer stroke, separately on each side.
            half_stroke=stroke_width*.01/2
            gaps=getattr(region,'_highlight_horizontal_gaps',(None,None))
            return tuple(default if gap is None else min(default,gap-half_stroke-1/135) for gap in gaps)
        if effect=='pointer':
            end=region.get_corner(UR)+np.array([8/135,8/135,0])
            mark=Arrow(end+np.array([48/135,48/135,0]),end,buff=0,color=color,stroke_width=5,tip_length=12/135).set_z_index(3)
        elif effect in ['check','cross']:
            anchor=region.get_right()+RIGHT*26/135
            if getattr(region,'_highlight_horizontal_gaps',(None,None))[1] is not None:anchor=region.get_bottom()+DOWN*24/135
            if effect=='check':
                mark=VMobject(color=color,stroke_width=5).set_points_as_corners([anchor+np.array([-12/135,0,0]),anchor+np.array([-3/135,-9/135,0]),anchor+np.array([17/135,14/135,0])])
            else:mark=VGroup(Line(anchor+np.array([-10/135,-10/135,0]),anchor+np.array([10/135,10/135,0]),color=color,stroke_width=5),Line(anchor+np.array([-10/135,10/135,0]),anchor+np.array([10/135,-10/135,0]),color=color,stroke_width=5))
            mark.set_z_index(3)
        elif effect == 'marker':
            left,right=horizontal_padding(.065,0)
            width=max(1/135,region.width+left+right)
            mark = RoundedRectangle(width=width, height=max(.16,region.height+.10),corner_radius=min(.055,width/2),stroke_width=0,fill_color=color,fill_opacity=.32)
            mark.move_to(region.get_center()+RIGHT*(right-left)/2).set_z_index(1)
        elif effect == 'underline':
            mark = Line(region.get_corner(DL)+DOWN*.055, region.get_corner(DR)+DOWN*.055,
                        color=color, stroke_width=7, stroke_opacity=.4).set_z_index(3)
        else:
            left,right=horizontal_padding(.08,3.5)
            width=max(1/135,region.width+left+right)
            mark = RoundedRectangle(width=width,height=max(.18,region.height+.14),corner_radius=min(.055,width/2),color=color,stroke_width=3.5,fill_color=color,fill_opacity=.16).move_to(region.get_center()+RIGHT*(right-left)/2).set_z_index(1)
        marks.add(mark)
    return marks


def highlight_color(item,index):
    return item.get('color') or {'check':'#16A56A','cross':'#E44747'}.get(item['effect'],HIGHLIGHT_COLORS[index%4])


def set_highlight_phase(mark,effect,seconds):
    if effect=='pulse':
        scale=1+.055*(1-np.cos(seconds*4*np.pi))
        mark.scale(scale/getattr(mark,'_pulse_scale',1));mark._pulse_scale=scale
    return mark


def board_entrance_animation(board,entrance):
    if entrance=='write':return Write(board)
    if entrance=='slide':return FadeIn(board,shift=LEFT*.4)
    if entrance=='settle':return CardSettle(board,rate_func=linear)
    return FadeIn(board)


class CardSettle(Animation):
    def begin(self):
        # Same-cue formulas are attached after events are collected, so capture
        # the final group only when playback starts, never at construction.
        self.final_card=self.mobject.copy()
        super().begin()

    def interpolate_mobject(self,alpha):
        final=self.final_card.copy().rotate(.07*np.sin(alpha*2*np.pi)*(1-alpha)).shift(UP*.35*(1-alpha)**2)
        final.fade(1-min(1,alpha*4))
        self.mobject.become(final)


def lesson_header(value, font, pin_image=None):
    title = Text(value, font=font, font_size=32, color='#FFFFFF')
    if title.width > 11.45:
        title.scale_to_fit_width(11.45)
    bar = RoundedRectangle(width=title.width+.76, height=max(.65,title.height+.22), corner_radius=.08,
                           stroke_width=0, fill_color=BLUE, fill_opacity=1)
    bar.to_edge(UP,buff=.37).to_edge(LEFT,buff=.59)
    title.move_to(bar.get_center()+RIGHT*.06)
    result = Group(bar,title)
    if pin_image:
        pin = ImageMobject(inline_image(pin_image)).scale_to_fit_height(.63)
        pin.move_to(bar.get_corner(UL)+[.04,-.05,0])
        result.add(pin)
    return result


class FormulaMobject(MathTex):
    """A formula with stable semantic part handles, preserving whole TeX compilation."""
    def __init__(self, step, highlight_phrases=None, **kwargs):
        # The whole expression already has a stable object. Isolating it would
        # claim every glyph before a nested keyword or semantic factor can group.
        highlights = [phrase for phrase in dict.fromkeys(highlight_phrases or []) if phrase != step['latex']]
        declared = [p for p in step.get('parts', []) if complete_fragment(p['latex']) and p['latex'] in step['latex']]
        # Overlapping fragments cannot both be isolated by MathTex. Prefer smaller factors.
        parts = [p for p in declared if not any(q['latex'] != p['latex'] and q['latex'] in p['latex'] for q in declared)]
        fallback = [token for token in ['I^2', 'U^2', 'R_1', 'R_2', 'R_3', 'P_1', 'P_2', 'P_3'] if token in step['latex']]
        isolated = sorted(set(highlights) | {p['latex'] for p in parts}, key=len, reverse=True) or fallback
        from fonts import stix_tex_template
        kwargs.setdefault('tex_template',stix_tex_template())
        super().__init__(step['latex'], substrings_to_isolate=isolated, **kwargs)
        self.part_latex = {p['id']: p['latex'] for p in parts}
        self.original_latex = step['latex']
        # Manim 0.21 retains isolated fragments in SVG groups, not top-level MathTex parts.
        # Re-group their existing paths so matching transforms operate on real factors.
        all_paths = self.family_members_with_points()
        claimed = set()
        token_groups = {}
        for latex in isolated:
            occurrences = []
            for matched, match_id in self.matched_strings_and_ids:
                if matched != latex:
                    continue
                paths = [obj for obj in self.id_to_vgroup_dict[match_id].family_members_with_points() if id(obj) not in claimed]
                if not paths:
                    continue
                claimed.update(id(obj) for obj in paths)
                group = MathTexPart(); group.add(*paths); group.tex_string = latex
                occurrences.append(group)
            token_groups[latex] = occurrences
        remainder = MathTexPart(); remainder.add(*[obj for obj in all_paths if id(obj) not in claimed])
        remainder.tex_string = 'remainder:' + step['latex']
        self.submobjects = [*sum(token_groups.values(), []), remainder]
        self.parts_by_id = {key: VGroup(*token_groups.get(latex, [])) for key, latex in self.part_latex.items()}
        self.token_groups = token_groups
        self.set_z_index(2)

    def phrase_regions(self, phrase, occurrence=1):
        if phrase == self.original_latex:
            if occurrence != 1:
                raise ValueError('公式高亮项无法独立定位：' + phrase)
            return [self]
        groups = self.token_groups.get(phrase, [])
        if occurrence < 1 or occurrence > len(groups):
            raise ValueError('公式高亮项无法独立定位：' + phrase)
        return [groups[occurrence-1]]

    def part(self, identifier):
        return self.parts_by_id[identifier]

    def correspondence(self, previous):
        if not isinstance(previous, FormulaMobject):
            return {}
        return {previous.part_latex[key]: self.part_latex[key] for key in self.part_latex.keys() & previous.part_latex.keys() if previous.part_latex[key] != self.part_latex[key]}

    def ordered_parts(self):
        parts = [part for part in self.parts_by_id.values() if len(part)]
        return sorted(parts, key=lambda part: part.get_center()[0])


def semantic_transition(previous, target):
    """Transform stable part IDs with public Transform APIs, including unequal glyph trees."""
    animations = [FadeOut(previous)]
    target_parts = []
    selected = set()
    for identifier, part in target.parts_by_id.items():
        if not len(part):
            continue
        target_parts.append(part)
        selected.update(id(member) for member in part.submobjects)
        old = previous.parts_by_id.get(identifier)
        if old is not None and len(old):
            animations.append(ReplacementTransform(old.copy(), part))
        else:
            animations.append(FadeIn(part))
    remainder = VGroup(*[member for member in target.submobjects if id(member) not in selected])
    animations.append(FadeIn(remainder))
    return AnimationGroup(*animations), (remainder, target_parts, target)


def effect_duration(event):
    default=.8 if event.get('type')=='formula' and event.get('data',{}).get('action') in ['cancel','reciprocal'] else .42
    return event.get('data',{}).get('durationSeconds',default) if event.get('type') in ['board','formula','circuit'] else default


def animation_span(events, available, frame_rate):
    """Respect authored pacing while keeping the next speech cue on time."""
    requested=max((effect_duration(event) for event in events),default=.42)
    return min(requested,max(0,available-1/frame_rate))

class LessonShot(Scene):
    def __init__(self,**kwargs):
        kwargs.setdefault('camera_class',LessonCamera)
        super().__init__(**kwargs)

    def construct(self):
        timeline_path = Path(os.environ['VIDEO_TIMELINE'])
        timeline = json.loads(timeline_path.read_text(encoding='utf-8-sig'))
        shot, settings = timeline['shot'], timeline['settings']
        from scene_layout import SceneLayout
        layout=SceneLayout(timeline,timeline_path.parent)
        self.camera.content_bounds=layout.content_bounds
        self.camera.background_color=layout.background
        for key in layout.static_ids:self.add(layout.elements[key]['object'])
        if shot.get('story') is not None:
            self.construct_story(timeline,layout)
            return
        board_objects=layout.boards
        board_marks,formula_marks=[],{}
        marks_by_id={}
        for item in layout.board_specs:
            if not item.get('cue') and item.get('entrance','appear')=='appear':self.add(layout.board_group(item['id']))
        visible_boards={item['id'] for item in layout.board_specs if not item.get('cue')}
        circuit=layout.circuit;circuit_visible=True
        if circuit:
            for event in timeline['events']:
                if event['type']=='circuit' and event['data']['type'] in ['draw','show']:
                    if 'circuit' in event['data']['targetIds']:circuit_visible=False
                    for identifier in event['data']['targetIds']:
                        circuit.set_visibility(identifier,False)
                        if identifier in circuit.labels:circuit.labels[identifier].set_opacity(0)
            self.add(circuit)
        formula = subtitle = speaker_tag = None
        formula_id=None;visible_formulas=set();formula_tracks={}
        formula_extras=[]
        groups = [(when, list(items)) for when, items in groupby(timeline['events'], key=lambda e: round(e['time'], 6))]
        for group_index, (when, events) in enumerate(groups):
            if when > self.time:
                self.wait(when - self.time)
            next_time = groups[group_index+1][0] if group_index+1 < len(groups) else timeline['duration']
            span=animation_span(events,next_time-self.time,config.frame_rate)
            animations = []
            cleanup = []
            entering_cards={}
            for event in events:
                animation_start=len(animations)
                if event['type'] == 'board':
                    identifier=event['data']['id'];visible_boards.add(identifier)
                    board=layout.board_group(identifier);entrance=event['data'].get('entrance','appear')
                    if span>.09 and entrance in ['fade','write','slide','settle']:
                        animations.append(board_entrance_animation(board,entrance))
                        if identifier in layout.cards:entering_cards[identifier]=board
                    else:self.add(board)
                elif event['type'] == 'highlight':
                    emphasis = event['data']
                    target = board_objects[emphasis['targetId']] if emphasis['targetType'] == 'board' else layout.formulas.get(emphasis['targetId']) if emphasis['targetId'] in visible_formulas else None
                    if target is None:
                        raise ValueError('高亮目标尚未显示')
                    regions = target.phrase_regions(emphasis['phrase'], emphasis.get('occurrence',1))
                    index = next(i for i,h in enumerate(shot.get('highlights',[])) if h['id']==emphasis['id'])
                    mark = highlight_mobjects(regions, highlight_color(emphasis,index), emphasis['effect'])
                    layout.layer_object(emphasis['targetType']+':'+emphasis['targetId'],mark)
                    (board_marks if emphasis['targetType']=='board' else formula_marks.setdefault(emphasis['targetId'],[])).append(mark)
                    marks_by_id[emphasis['id']]=mark
                    if emphasis['effect']=='pulse':
                        mark._pulse_elapsed=0
                        def pulse(mob,dt):
                            mob._pulse_elapsed+=dt;set_highlight_phase(mob,'pulse',mob._pulse_elapsed)
                        mark.add_updater(pulse)
                    if span > .09:
                        animations.append(FadeIn(mark, rate_func=lambda alpha, duration=span: smooth(min(1, alpha*duration/.12)),suspend_mobject_updating=emphasis['effect']!='pulse'))
                    else:
                        self.add(mark)
                elif event['type'] == 'highlight_end':
                    mark=marks_by_id.pop(event['id'],None)
                    if mark is not None:self.remove(mark)
                elif event['type'] == 'speaker':
                    if speaker_tag:
                        self.remove(speaker_tag)
                    speaker = next(s for s in timeline['speakers'] if s['id'] == event['speakerId'])
                    speaker_tag = layout.create_speaker(speaker)
                    self.add(speaker_tag)
                elif event['type'] == 'subtitle':
                    if subtitle:
                        self.remove(subtitle)
                    subtitle = None
                    if event['text']:
                        subtitle = layout.create_subtitle(event['text'])
                        self.add(subtitle)
                elif event['type'] == 'formula':
                    step = event['data']
                    track=step.get('cardId') or ''
                    if track and track not in visible_boards:raise ValueError('公式出现时知识卡尚未显示：'+track)
                    formula_id=formula_tracks.get(track);formula=layout.formulas.get(formula_id)
                    formula_extras=layout.formula_extras.get(formula_id,[])
                    append=step.get('display','replace')=='append'
                    # Match valid tokens inside the complete expression, not incomplete fractions.
                    if not append:
                        for mark in formula_marks.pop(formula_id,[]):self.remove(mark)
                        visible_formulas.discard(formula_id)
                    new_formula = layout.create_formula(step)
                    if formula is not None and not append:
                        if span > 0.09:
                            if step['action'] == 'reciprocal' and new_formula.ordered_parts():
                                ordered = new_formula.ordered_parts()
                                selected = {id(member) for part in ordered for member in part.submobjects}
                                remainder = VGroup(*[member for member in new_formula.submobjects if id(member) not in selected])
                                animations.extend([FadeOut(formula), FadeIn(remainder), LaggedStart(*[Write(part) for part in ordered], lag_ratio=.25)])
                                cleanup.append((remainder, ordered, new_formula))
                            elif step['action'] in ['cancel', 'substitute', 'transform', 'ratio']:
                                transition, cleanup_entry = semantic_transition(formula, new_formula)
                                cleanup.append(cleanup_entry)
                                cancelled = []
                                if step['action'] == 'cancel':
                                    for key, latex in formula.part_latex.items():
                                        if latex in ['I^2', 'U^2'] and latex not in step['latex']:
                                            cancelled.extend(formula.part(key).submobjects)
                                if cancelled:
                                    slashes = VGroup(*[Line(part.get_corner(DL), part.get_corner(UR), color=ORANGE, stroke_width=3) for part in cancelled])
                                    animations.append(Succession(Create(slashes), AnimationGroup(transition, FadeOut(slashes)), run_time=span))
                                else:
                                    animations.append(transition)
                            else:
                                animations.extend([FadeOut(formula), FadeIn(new_formula)])
                        else:
                            self.remove(formula); self.add(new_formula)
                    elif track in entering_cards:
                        entering_cards[track].add(new_formula)
                    elif span > 0.09:
                        animations.append(Write(new_formula))
                    else:
                        self.add(new_formula)
                    formula = new_formula
                    formula_id=step['id'];visible_formulas.add(formula_id)
                    formula_tracks[track]=formula_id
                    if not append:
                        for key in formula_extras:self.remove(layout.elements[key]['object'])
                    formula_extras=layout.formula_extras.get(step['id'],[])
                    for key in formula_extras:self.add(layout.elements[key]['object'])
                elif event['type'] == 'circuit' and circuit:
                    action = event['data']; targets = [circuit.resolve_target(identifier) for identifier in action['targetIds']]
                    if action['type'] in ['hide', 'show', 'draw']:
                        opacity = 0 if action['type'] == 'hide' else 1
                        if 'circuit' in action['targetIds']:
                            circuit_visible = opacity == 1
                        for identifier, target in zip(action['targetIds'], targets):
                            circuit.set_visibility(identifier, opacity == 1)
                            if identifier in circuit.labels:
                                circuit.labels[identifier].set_opacity(opacity)
                        if action['type'] == 'draw' and span > 0.09:
                            for identifier in action['targetIds']:
                                animations.extend(circuit.draw_animations(identifier))
                    elif action['type'] == 'highlight':
                        if span > 0.09:
                            for identifier, target in zip(action['targetIds'], targets):
                                animations.append(Circumscribe(target, color=BLUE, buff=.08) if circuit.has_raster(identifier) else Indicate(target, color=BLUE, scale_factor=1.02))
                        else:
                            for identifier, target in zip(action['targetIds'], targets):
                                if circuit.has_raster(identifier):
                                    self.add(SurroundingRectangle(target, color=BLUE, buff=.08))
                                else:
                                    target.set_color(BLUE)
                    elif action['type'] == 'label' and action.get('text') and targets:
                        key,previous,label=layout.create_circuit_label(action)
                        if previous:self.remove(layout.elements[previous]['object'])
                        self.add(label)
                    elif action['type']=='annotation':
                        key,previous,annotation=layout.create_circuit_annotation(action)
                        if previous:self.remove(layout.elements[previous]['object'])
                        if span>.09:animations.append(FadeIn(annotation))
                        else:self.add(annotation)
                    elif action['type']=='state':
                        previous,circuit=layout.replace_circuit_state(action)
                        # A snapshot is one coherent physical state: arrows and
                        # lit apparatus are replaced together at its speech cue.
                        self.remove(previous);self.add(circuit)
                for animation in animations[animation_start:]:
                    animation.set_run_time(min(span,effect_duration(event)))
            if animations:
                self.play(*animations)
            for remainder, ordered, completed_formula in cleanup:
                self.remove(remainder, *ordered)
                self.add(completed_formula)
        if timeline['duration'] > self.time:
            self.wait(timeline['duration'] - self.time)

    def construct_story(self,timeline,layout):
        duration=timeline['duration'];cursor=0.0
        layout.apply_story_time(0,duration)
        subtitle=speaker_tag=None
        events=[event for event in timeline['events'] if event['type'] in ['speaker','subtitle']]
        def advance(stop):
            nonlocal cursor
            stop=max(cursor,min(duration,float(stop)))
            if stop>cursor:
                start=cursor;span=stop-start
                self.play(UpdateFromAlphaFunc(layout.story_image,lambda image,alpha:layout.apply_story_time(start+alpha*span,duration)),run_time=span,rate_func=linear)
                cursor=stop
        for when,items in groupby(events,key=lambda event:round(event['time'],6)):
            advance(when)
            for event in items:
                if event['type']=='speaker':
                    if speaker_tag is not None:self.remove(speaker_tag)
                    speaker=next(s for s in timeline['speakers'] if s['id']==event['speakerId'])
                    speaker_tag=layout.create_speaker(speaker);self.add(speaker_tag)
                else:
                    if subtitle is not None:self.remove(subtitle)
                    subtitle=layout.create_subtitle(event['text']) if event.get('text') else None
                    if subtitle is not None:self.add(subtitle)
        advance(duration)







