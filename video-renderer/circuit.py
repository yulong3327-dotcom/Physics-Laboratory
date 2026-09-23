"""Manim circuit adapter with stable IDs, inline raster layers, and signed wire flow.

Editor coordinates are x-right/y-down. Component x/y are global centres.
Image dimensions are unrotated editor units; positive image rotation is clockwise.
"""
import base64
from copy import deepcopy
from io import BytesIO
from pathlib import Path
import math
import re
from xml.etree import ElementTree as ET
import numpy as np
from PIL import Image
from svgelements import Matrix
from manim import Group, VGroup, VMobject, SVGMobject, Text, VectorizedPoint, ImageMobject, Dot, Create, FadeIn

SVG_NS = 'http://www.w3.org/2000/svg'
MAX_IMAGE_BYTES = 8 * 1024 * 1024


def inline_image(data_url):
    """Decode only embedded raster images; portable renders never fetch image URLs."""
    match = re.fullmatch(r'data:image/(png|jpeg|webp);base64,([A-Za-z0-9+/]+={0,2})', data_url or '')
    if not match:
        raise ValueError('图片必须是内嵌 PNG、JPEG 或 WebP')
    raw = base64.b64decode(match[2], validate=True)
    if len(raw) > MAX_IMAGE_BYTES:
        raise ValueError('图片不得超过 8 MB')
    with Image.open(BytesIO(raw)) as image:
        if image.format != {'png': 'PNG', 'jpeg': 'JPEG', 'webp': 'WEBP'}[match[1]]:
            raise ValueError('图片内容与声明格式不一致')
        if image.width * image.height > 40_000_000:
            raise ValueError('图片分辨率过大')
        return np.array(image.convert('RGBA'))


def page_background(data_url, frame_width, frame_height):
    """Equivalent to CSS background-size:cover; background-position:center top."""
    image = ImageMobject(inline_image(data_url))
    image.scale(max(frame_width / image.width, frame_height / image.height))
    image.move_to([0, (frame_height - image.height) / 2, 0])
    image.set_z_index(-100)
    return image


def framed_svg(root, width, height, target, factor):
    root = deepcopy(root)
    root.insert(0, ET.Element('{' + SVG_NS + '}rect', {
        'x': str(-width/2), 'y': str(-height/2), 'width': str(width), 'height': str(height),
        'fill': '#000', 'opacity': '0'}))
    target.write_text(ET.tostring(root, encoding='unicode'), encoding='utf-8')
    obj = SVGMobject(str(target), height=None, width=None, use_svg_cache=False)
    if obj.submobjects:
        frame = obj.submobjects[0]
        obj.scale(width * factor / frame.width, about_point=[0, 0, 0])
        obj.shift(-frame.get_center())
        obj.remove(frame)
    return obj


def overlay_layers(component, directory, factor):
    """Keep SVG vector leaves and inline images in their original drawing order."""
    root = ET.fromstring(component['svg'])
    width, height = component['width'], component['height']
    if not any(element.tag.split('}')[-1] == 'image' for element in root.iter()):
        return [framed_svg(root, width, height, directory / ('component-' + component['id'] + '.svg'), factor)]
    layers = []
    def visit(element, ancestors):
        tag = element.tag.split('}')[-1]
        if tag in ['svg', 'g']:
            for child in element:
                visit(child, ancestors + [element])
            return
        if tag == 'image':
            href = element.get('href') or element.get('{http://www.w3.org/1999/xlink}href')
            pixels = inline_image(href)
            obj = ImageMobject(pixels)
            x, y = float(element.get('x', 0)), float(element.get('y', 0))
            w, h = float(element.get('width', pixels.shape[1])), float(element.get('height', pixels.shape[0]))
            if element.get('preserveAspectRatio', 'xMidYMid meet') != 'none':
                scale = min(w / pixels.shape[1], h / pixels.shape[0])
                fitted_w, fitted_h = pixels.shape[1] * scale, pixels.shape[0] * scale
                x += (w - fitted_w) / 2; y += (h - fitted_h) / 2
                w, h = fitted_w, fitted_h
            obj.stretch_to_fit_width(w).stretch_to_fit_height(h).move_to([x+w/2, -y-h/2, 0])
            lineage = [*ancestors, element]
            transform = Matrix(' '.join(e.get('transform', '') for e in lineage))
            matrix = np.array([[transform.a, -transform.c, 0], [-transform.b, transform.d, 0], [0, 0, 1]])
            obj.apply_matrix(matrix).shift([transform.e, -transform.f, 0]).scale(factor, about_point=[0, 0, 0])
            opacity = math.prod(float(e.get('opacity', 1)) for e in lineage)
            obj.set_opacity(opacity)
            layers.append(obj)
            return
        # The controlled renderer emits shape leaves. Preserve every ancestor transform/style.
        leaf_root = ET.Element(root.tag, root.attrib)
        parent = leaf_root
        for ancestor in ancestors[1:]:
            wrapper = ET.SubElement(parent, ancestor.tag, ancestor.attrib)
            parent = wrapper
        parent.append(deepcopy(element))
        layers.append(framed_svg(leaf_root, width, height, directory / ('component-' + component['id'] + '-layer-' + str(len(layers)) + '.svg'), factor))
    visit(root, [])
    return layers


class CircuitMobject(Group):
    def __init__(self, asset, directory, font='Microsoft YaHei', width=6.0, height=3.5, **kwargs):
        super().__init__(**kwargs)
        geometry = asset.get('geometry')
        if not geometry:
            raise ValueError(f"电路素材 {asset['id']} 缺少矢量几何，请在工作台重新生成分镜。")
        self.components, self.wires, self.ports, self.labels = {}, {}, {}, {}
        self.geometry = deepcopy(geometry)
        self.flow_particles, self._flows = {}, []
        self._hidden_ids = set()
        self._flow_time = 0.0
        bounds = geometry['bounds']
        self.factor = min(width / bounds['width'], height / bounds['height'])
        self.origin = np.array([bounds['x'] + bounds['width']/2, bounds['y'] + bounds['height']/2])
        # Invisible local anchors retain the editor-to-scene mapping through all
        # layout transforms. New switch/slider bounds must never recenter a shot.
        self.reference_origin = VectorizedPoint([0., 0., 0.])
        self.reference_x = VectorizedPoint([self.factor, 0., 0.])
        self.add(self.reference_origin, self.reference_x)
        self.directory = Path(directory); self.directory.mkdir(parents=True, exist_ok=True)
        def point(p):
            return np.array([(p['x']-self.origin[0])*self.factor, -(p['y']-self.origin[1])*self.factor, 0])
        real = geometry.get('viewMode', asset.get('viewMode')) == 'real'
        for wire in geometry['wires']:
            svg = f'<svg xmlns="{SVG_NS}" width="{bounds["width"]}" height="{bounds["height"]}" viewBox="{bounds["x"]} {bounds["y"]} {bounds["width"]} {bounds["height"]}"><rect x="{bounds["x"]}" y="{bounds["y"]}" width="{bounds["width"]}" height="{bounds["height"]}" fill="#000" opacity="0"/><path d="{wire["path"]}" fill="none" stroke="#414748" stroke-width="{5 if real else 2.6}" stroke-linecap="round" stroke-linejoin="round"/></svg>'
            path = self.directory / f"wire-{wire['id']}.svg"; path.write_text(svg, encoding='utf-8')
            vector = SVGMobject(str(path), height=None, width=None, use_svg_cache=False)
            if vector.submobjects:
                frame = vector.submobjects[0]
                vector.scale(bounds['width'] * self.factor / frame.width, about_point=[0, 0, 0])
                vector.shift(-frame.get_center())
                vector.remove(frame)
            obj = Group(vector)
            self.wires[wire['id']] = obj
            self.add(obj)
            current = wire.get('current')
            curves = vector.family_members_with_points()
            if geometry.get('currentFlow', asset.get('currentFlow', False)) and isinstance(current, (float, int)) and math.isfinite(current) and abs(current) >= 1e-5 and curves:
                curve = curves[0]
                samples = np.linspace(0, 1, max(80, curve.get_num_curves() * 24))
                points = np.array([curve.point_from_proportion(t) for t in samples])
                lengths = np.concatenate([[0], np.cumsum(np.linalg.norm(np.diff(points, axis=0), axis=1))])
                length = lengths[-1] / self.factor
                if length > 0:
                    count = min(256, max(1, math.ceil(length / 48)))
                    particles = VGroup(*[Dot(radius=2.7*self.factor, color='#FFE45C', stroke_color='#B9911B', stroke_width=.55) for _ in range(count)])
                    particles.set_z_index(5)
                    obj.add(particles); self.flow_particles[wire['id']] = particles
                    self._flows.append({'id': wire['id'], 'curve': curve, 'length': length, 'samples': samples,
                                        'distances': lengths / lengths[-1], 'current': current, 'particles': particles})
        for component in geometry['components']:
            w, h = component['width'], component['height']
            layers = []
            raster = component.get('image')
            if raster:
                obj = ImageMobject(inline_image(raster['dataUrl']))
                obj.stretch_to_fit_width(raster['width'] * self.factor).stretch_to_fit_height(raster['height'] * self.factor)
                obj.rotate(-math.radians(raster['rotation']), about_point=[0, 0, 0])
                layers.append(obj)
            layers.extend(overlay_layers(component, self.directory, self.factor))
            obj = Group(*layers).shift(point(component))
            self.components[component['id']] = obj
            self.add(obj)
            if component.get('label'):
                from fonts import mixed_text,NOTE_PX
                label = mixed_text(component['label'], design_px=NOTE_PX, color='#333333')
                if label.width > max(w*self.factor*1.6, 1.8):
                    label.scale_to_fit_width(max(w*self.factor*1.6, 1.8))
                # Vertical leads occupy the space below the symbol; names sit inside the loop.
                direction = np.array([1 if obj.get_center()[0] < 0 else -1, 0, 0]) if component['height'] > component['width'] else np.array([0, -1, 0])
                label.next_to(obj, direction, buff=0.12)
                self.labels[component['id']] = label; self.add(label)
            for terminal_id, location in component['terminals'].items():
                anchor = VectorizedPoint(point(location))
                self.ports[f"{component['id']}:{terminal_id}"] = anchor; self.add(anchor)
        # Physical editor wires are above apparatus so contacts are visible; particles stay above both.
        if real:
            for wire in self.wires.values():
                self.remove(wire); self.add(wire)
        self._original_opacities = {id(obj): (obj.get_fill_opacity(), obj.get_stroke_opacity()) for obj in self.get_family() if isinstance(obj, VMobject)}
        self._image_opacities = {id(obj): obj.stroke_opacity for obj in self.get_family() if isinstance(obj, ImageMobject)}
        if self._flows:
            self.add_updater(lambda mob, dt: mob.advance_flow(dt))
            self.advance_flow(0)

    def advance_flow(self, dt):
        self._flow_time += dt
        for flow in self._flows:
            hidden = 'circuit' in self._hidden_ids or flow['id'] in self._hidden_ids
            speed = min(140, 40 + 30 * math.log10(1 + abs(flow['current']) * 100))
            phase = self._flow_time * speed * (1 if flow['current'] > 0 else -1) / flow['length']
            for index, particle in enumerate(flow['particles']):
                fraction = (index / len(flow['particles']) + phase) % 1
                alpha = float(np.interp(fraction, flow['distances'], flow['samples']))
                particle.move_to(flow['curve'].point_from_proportion(alpha)).set_opacity(0 if hidden else 1)

    def set_visibility(self, identifier, visible):
        target = self.resolve_target(identifier)
        if visible:
            self._hidden_ids.discard(identifier)
        else:
            self._hidden_ids.add(identifier)
        for obj in target.get_family():
            if isinstance(obj, VMobject):
                fill, stroke = self._original_opacities.get(id(obj), (0, 0))
                obj.set_fill(opacity=fill if visible else 0); obj.set_stroke(opacity=stroke if visible else 0)
            elif isinstance(obj, ImageMobject):
                obj.set_opacity(self._image_opacities.get(id(obj), 1) if visible else 0)
        if self._flows:
            self.advance_flow(0)

    def with_geometry(self, geometry, directory):
        """Build a simulation snapshot at the exact original scene transform."""
        geometry = deepcopy(geometry)
        geometry['bounds'] = deepcopy(self.geometry['bounds'])
        replacement = CircuitMobject({'id':'state', 'geometry':geometry}, directory)
        source = replacement.reference_origin.get_center().copy()
        target = self.reference_origin.get_center().copy()
        scale = np.linalg.norm(self.reference_x.get_center()-target) / np.linalg.norm(replacement.reference_x.get_center()-source)
        replacement.scale(scale, about_point=source).shift(target-source)
        for identifier, label in replacement.labels.items():
            if identifier in self.labels:
                if label.width:label.scale(self.labels[identifier].width/label.width)
                label.move_to(self.labels[identifier].get_center())
        for identifier in self._hidden_ids:
            replacement.set_visibility(identifier, False)
            if identifier in replacement.labels:replacement.labels[identifier].set_opacity(0)
        replacement._flow_time = self._flow_time
        replacement.advance_flow(0)
        return replacement

    def draw_animations(self, identifier):
        """Create vector paths and fade raster layers without passing Group to Create."""
        animations = []
        def visit(obj):
            if isinstance(obj, ImageMobject):
                animations.append(FadeIn(obj))
            elif isinstance(obj, VMobject):
                if obj.has_points() or obj.submobjects:
                    animations.append(Create(obj))
            else:
                for child in obj.submobjects:
                    visit(child)
        visit(self.resolve_target(identifier))
        return animations

    def has_raster(self, identifier):
        return any(isinstance(obj, ImageMobject) for obj in self.resolve_target(identifier).get_family())

    def component(self, identifier):
        return self.components[identifier]

    def wire(self, identifier):
        return self.wires[identifier]

    def port(self, component_id, terminal_id=None):
        key = f'{component_id}:{terminal_id}' if terminal_id is not None else component_id
        return self.ports[key]

    def resolve_target(self, identifier):
        if identifier == 'circuit':
            return self
        for mapping in [self.components, self.wires, self.ports]:
            if identifier in mapping:
                return mapping[identifier]
        raise KeyError(f'不存在的电路对象：{identifier}')
