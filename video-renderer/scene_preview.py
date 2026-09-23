"""Browser previews serialized from the same positioned Manim objects as video frames."""
from __future__ import annotations
import base64
from io import BytesIO
import json
from video_runtime import cue_position
from pathlib import Path
from xml.etree import ElementTree as ET
import numpy as np
from PIL import Image
from manim import VMobject, ImageMobject, config

SVG_NS = 'http://www.w3.org/2000/svg'
ET.register_namespace('', SVG_NS)

def _node(name, attributes=None):
    return ET.Element('{'+SVG_NS+'}'+name, {key:str(value) for key,value in (attributes or {}).items()})

def _num(value):
    if not np.isfinite(value):
        raise ValueError('预览对象包含非有限坐标')
    return f'{float(value):.5f}'.rstrip('0').rstrip('.') or '0'

def serialize_mobject(obj, *, width=1920, height=1080, frame_width=None, frame_height=None, crop=True, clip_bounds=None):
    """Return cropped SVG plus its global design-pixel box; no browser font layout.

    All coordinates are global 1920x1080 coordinates, including the cropped
    viewBox. A browser places the image at box.x/y with box.width/height.
    """
    fw=float(frame_width or config.frame_width);fh=float(frame_height or config.frame_height)
    sx,sy=width/fw,height/fh
    def point(p):return np.array([width/2+p[0]*sx,height/2-p[1]*sy])
    leaves=[item for item in obj.get_family() if isinstance(item,(VMobject,ImageMobject)) and item.has_points()]
    leaves=sorted(leaves,key=lambda item:item.z_index)
    root=_node('svg');defs=_node('defs');root.append(defs)
    boxes=[];gradient_index=0
    def paint(item,rgbas):
        nonlocal gradient_index
        values=np.asarray(rgbas,dtype=float)
        if len(values)==0 or not np.any(values[:,3]>0):return {'color':'none','opacity':1}
        def color(rgba):return '#'+''.join(f'{max(0,min(255,round(channel*255))):02x}' for channel in rgba[:3])
        if len(values)==1:return {'color':color(values[0]),'opacity':float(values[0,3])}
        identifier='paint-'+str(gradient_index);gradient_index+=1
        a,b=[point(p) for p in item.get_gradient_start_and_end_points()]
        gradient=_node('linearGradient',{'id':identifier,'gradientUnits':'userSpaceOnUse','x1':_num(a[0]),'y1':_num(a[1]),'x2':_num(b[0]),'y2':_num(b[1])})
        for index,rgba in enumerate(values):gradient.append(_node('stop',{'offset':_num(index/(len(values)-1)),'stop-color':color(rgba),'stop-opacity':_num(rgba[3])}))
        defs.append(gradient);return {'color':'url(#'+identifier+')','opacity':1}
    for item in leaves:
        points=np.asarray([point(p) for p in item.points])
        if isinstance(item,ImageMobject):
            pixels=np.asarray(item.get_pixel_array(),dtype=np.uint8)
            if pixels.ndim!=3 or pixels.shape[2] not in [3,4]:raise ValueError('图片像素格式无效')
            if pixels.shape[2]==4 and not np.any(pixels[:,:,3]):continue
            stream=BytesIO();Image.fromarray(pixels).save(stream,format='PNG')
            top_left,top_right,bottom_left=points[:3]
            if len(points)>3 and not np.allclose(points[3],top_right+bottom_left-top_left,atol=.05):
                raise ValueError('浏览器排版预览目前只支持平面仿射图片')
            u,v=top_right-top_left,bottom_left-top_left
            transform='matrix('+','.join(_num(x) for x in [u[0],u[1],v[0],v[1],top_left[0],top_left[1]])+')'
            root.append(_node('image',{'x':0,'y':0,'width':1,'height':1,'preserveAspectRatio':'none','transform':transform,'href':'data:image/png;base64,'+base64.b64encode(stream.getvalue()).decode()}))
            boxes.append([points[:,0].min(),points[:,1].min(),points[:,0].max(),points[:,1].max()]);continue
        path=[]
        for start,end in item.get_subpath_split_indices_from_points(item.points,n_dims=2):
            start,end=int(start),int(end)
            if end-start<4:continue
            path.append('M'+' '.join(_num(v) for v in points[start]))
            for index in range(start,end-3,4):path.append('C'+' '.join(_num(v) for v in points[index+1:index+4].ravel()))
            if item.consider_points_equals_2d(item.points[start],item.points[end-1]):path.append('Z')
        if not path:continue
        fill=paint(item,item.get_fill_rgbas());stroke=paint(item,item.get_stroke_rgbas());background=paint(item,item.get_stroke_rgbas(background=True))
        stroke_width=float(item.get_stroke_width())*.01*sx
        background_width=float(item.get_stroke_width(background=True))*.01*sx
        cap_name=getattr(item.cap_style,'name','AUTO');joint_name=getattr(item.joint_type,'name','AUTO')
        common={'d':' '.join(path),'stroke-linecap':{'ROUND':'round','SQUARE':'square'}.get(cap_name,'butt'),'stroke-linejoin':{'ROUND':'round','BEVEL':'bevel'}.get(joint_name,'miter'),'stroke-miterlimit':10}
        if background_width>0 and background['color']!='none':
            root.append(_node('path',{**common,'fill':'none','stroke':background['color'],'stroke-opacity':_num(background['opacity']),'stroke-width':_num(background_width)}))
        root.append(_node('path',{**common,'fill':fill['color'],'fill-opacity':_num(fill['opacity']),'fill-rule':'nonzero','stroke':stroke['color'] if stroke_width>0 else 'none','stroke-opacity':_num(stroke['opacity']),'stroke-width':_num(stroke_width)}))
        if fill['color']!='none' or (stroke_width>0 and stroke['color']!='none') or (background_width>0 and background['color']!='none'):
            pad=max(stroke_width if stroke['color']!='none' else 0,background_width if background['color']!='none' else 0)/2+1
            boxes.append([points[:,0].min()-pad,points[:,1].min()-pad,points[:,0].max()+pad,points[:,1].max()+pad])
    if boxes:
        values=np.asarray(boxes);left,top=values[:,:2].min(axis=0);right,bottom=values[:,2:].max(axis=0)
    else:left=top=0;right=bottom=1
    if clip_bounds:
        x,y,w,h=clip_bounds
        clip=_node('clipPath',{'id':'summary-content-clip','clipPathUnits':'userSpaceOnUse'})
        clip.append(_node('rect',{'x':x,'y':y,'width':w,'height':h}));defs.append(clip)
        group=_node('g',{'clip-path':'url(#summary-content-clip)'})
        for child in list(root):
            if child is not defs:root.remove(child);group.append(child)
        root.append(group)
        left=max(x,min(left,x+w-1));top=max(y,min(top,y+h-1))
        right=max(left+1,min(right,x+w));bottom=max(top+1,min(bottom,y+h))
    box={'x':float(left),'y':float(top),'width':float(max(1,right-left)),'height':float(max(1,bottom-top))}
    view=[box['x'],box['y'],box['width'],box['height']] if crop else [0,0,width,height]
    root.set('viewBox',' '.join(_num(v) for v in view));root.set('width',_num(view[2]));root.set('height',_num(view[3]))
    if not len(defs):root.remove(defs)
    return {'svg':ET.tostring(root,encoding='unicode'),'box':box}


def preview_events(project, shot):
    utterances={u['id']:u for u in project['utterances']}
    indices={uid:i for i,uid in enumerate(shot['utteranceIds'])}
    priority={'board':1,'formula':2,'circuit':3,'highlight':4}
    events=[]
    for kind,items in [('board',shot.get('boardTexts',[])),('formula',shot.get('formulas',[])),('circuit',shot.get('actions',[])),('highlight',shot.get('highlights',[]))]:
        for index,item in enumerate(items):
            cue=item.get('cue')
            if not cue:continue
            uid=cue['utteranceId'];text=utterances[uid]['text'];phrase=cue.get('phrase','');position=cue_position(cue,text)
            if position<0:raise ValueError('预览定位词不在原台词中：'+phrase)
            events.append({'id':kind+':'+item['id'],'kind':kind,'data':item,'utteranceId':uid,'position':position,'order':(indices[uid],position,float(cue.get('offset',0)),priority[kind],index)})
    return sorted(events,key=lambda e:e['order'])


def _subtitle_clause(text, position):
    import re
    starts=[0]+[m.end() for m in re.finditer('[，。！？；：]',text)]
    first=max(p for p in starts if p<=position)
    last=next((p for p in starts if p>position),len(text))
    return text[first:last] or text


def text_metadata(identifier, obj, shot):
    """Expose original text and actual glyph boxes; offsets use browser UTF-16."""
    from scene_layout import box_of
    from fonts import glyphs_for_range
    metadata={}
    if identifier.startswith('board:') and hasattr(obj,'card_title'):
        return {'text':obj.card_title,'textKind':'plain','source':{'type':'cardTitle','id':identifier[6:]}}
    if identifier.startswith(('board:','board-body:')):
        value=obj.original_text;metadata={'text':value,'textKind':'plain','source':{'type':'board','id':identifier.split(':',1)[1]}}
        utf16=[0]
        for char in value:utf16.append(utf16[-1]+len(char.encode('utf-16-le'))//2)
        # A font may render one source character as several paths (for example
        # an unsupported emoji). Keep editing/preview available without exposing
        # incorrect selection boxes for any part of that board.
        try:
            for start,end,line in obj.runs:
                glyphs_for_range(line,0,end-start)
        except ValueError:
            metadata['selectionWarning']='此段文字含无法逐字定位的字形，可编辑文字后选词。'
            return metadata
        characters=[]
        for start,end,line in obj.runs:
            for index in range(start,end):
                if value[index].isspace():continue
                glyphs=glyphs_for_range(line,index-start,index-start+1)
                if len(glyphs):characters.append({'start':utf16[index],'end':utf16[index+1],'box':box_of(glyphs)})
        metadata['characters']=characters
    elif identifier.startswith('formula:'):
        step=next(f for f in shot['formulas'] if f['id']==identifier[8:])
        metadata={'text':step['latex'],'textKind':'latex','source':{'type':'formula','id':step['id']}}
    elif identifier.startswith('circuit-label:'):
        action=next(a for a in shot['actions'] if a['id']==identifier[14:])
        metadata={'text':action.get('text',''),'textKind':'plain','source':{'type':'action','id':action['id']}}
    elif identifier.startswith('circuit-annotation:'):
        action=next(a for a in shot['actions'] if a['id']==identifier.split(':',1)[1])
        metadata={'text':action['annotation']['label'],'textKind':'plain','source':{'type':'action','id':action['id']}}
    elif identifier=='title':
        metadata={'text':shot.get('sectionTitle') or '', 'textKind':'plain','source':{'type':'title','id':'title'}}
    elif identifier=='subtitle' and shot.get('story') is not None:
        metadata={'text':obj.original_text,'textKind':'plain','source':{'type':'subtitle','id':'subtitle'}}
    return metadata


def build_preview(project, shot_id, stage=None, directory=None, measured_timeline=None, time=None):
    """Build edit stages or event states from an already measured speech timeline."""
    from manim import Group, SurroundingRectangle, tempconfig
    from scene_layout import SceneLayout,bounds_dict
    from video_summary import normalize_summary_project
    project=normalize_summary_project(project)
    from scene import highlight_mobjects, highlight_color, set_highlight_phase, update_dynamic_label
    from fonts import mixed_text
    shot=next((item for item in project['shots'] if item['id']==shot_id),None)
    if shot is None:raise ValueError('找不到需要预览的镜头')
    events=preview_events(project,shot)
    labels={'board':'板书','formula':'公式','circuit':'电路动作','highlight':'强调'}
    stages=[{'id':'opening','label':'开场'}]+[{'id':event['id'],'label':labels[event['kind']]+' · '+(event['data'].get('phrase') or event['data'].get('latex') or event['data'].get('text') or event['data'].get('type') or event['data']['id'])[:45]} for event in events]
    if measured_timeline is not None:
        if measured_timeline['shot']['id'] != shot_id:raise ValueError('时间轴不属于此镜头')
        if time is None or not np.isfinite(time) or time < 0 or time > measured_timeline['duration']:raise ValueError('时间轴位置超出镜头范围')
        events=[{**event,'kind':event['type'],'id':event['type']+':'+str(event.get('data',{}).get('id',event.get('id',index)))} for index,event in enumerate(measured_timeline['events'])]
        selected='time';stages=[{'id':'time','label':f'{time:.3f} 秒'}]
        end=max((i for i,event in enumerate(events) if event['time']<=time+1e-8),default=-1)
    else:
        selected=stage or next((event['id'] for event in reversed(events) if event['kind']=='formula'),events[-1]['id'] if events else 'opening')
        if selected not in {s['id'] for s in stages}:raise ValueError('预览阶段不存在，请刷新分镜')
        end=-1 if selected=='opening' else next(i for i,event in enumerate(events) if event['id']==selected)
    reached=events[:end+1]
    timeline={'projectTitle':project['title'],'shot':shot,'problem':project.get('problem'),'settings':project['settings'],'speakers':project['speakers'],'events':events,'circuit':next((asset for asset in project['circuits'] if asset['id']==shot.get('circuitAssetId')),None)}
    location=Path(directory or Path.cwd()/'media'/'scene-preview');location.mkdir(parents=True,exist_ok=True)
    with tempconfig({'frame_width':128/9,'frame_height':8,'pixel_width':1920,'pixel_height':1080,'media_dir':str(location),'verbosity':'ERROR'}):
        layout=SceneLayout(timeline,location)
        if layout.story_image is not None:
            # Unmeasured edit preview shows the complete illustration. Measured
            # playback uses the same absolute transform as LessonShot.
            layout.apply_story_time(time if measured_timeline is not None else 1,measured_timeline['duration'] if measured_timeline is not None else 1)
        visible=set(layout.static_ids)
        if layout.circuit is not None:visible.add('circuit')
        visible.update('board:'+item['id'] for item in layout.board_specs if not item.get('cue'))
        for item in layout.board_specs:
            if not item.get('cue'):visible.update(layout.board_children.get(item['id'],[]))
        current_formula=None;formula_event=None;formula_tracks={}
        marks={};marks_by_id={};extra_circuit=[]
        circuit=layout.circuit
        if circuit:
            for action in shot.get('actions',[]):
                if action['type'] in ['draw','show']:
                    for identifier in action['targetIds']:
                        circuit.set_visibility(identifier,False)
                        if identifier in circuit.labels:circuit.labels[identifier].set_opacity(0)
        class AnnotationHost:
            def add(self,obj):
                if obj not in extra_circuit:extra_circuit.append(obj)
            def remove(self,obj):
                if obj in extra_circuit:extra_circuit.remove(obj)
        for event in reached:
            item=event.get('data',{});kind=event['kind']
            if kind=='speaker':
                speaker=next(s for s in project['speakers'] if s['id']==event['speakerId'])
                layout.create_speaker(speaker);visible.add('speaker');continue
            if kind=='subtitle':
                if event.get('text'):layout.create_subtitle(event['text']);visible.add('subtitle')
                else:visible.discard('subtitle')
                continue
            if kind=='highlight_end':
                previous=marks_by_id.pop(event['id'].removeprefix('highlight_end:'),None)
                if previous:
                    key,mark=previous
                    if key in marks and mark in marks[key]:marks[key].remove(mark)
                continue
            if kind=='board':
                visible.add('board:'+item['id']);visible.update(layout.board_children.get(item['id'],[]))
            elif kind=='formula':
                track=item.get('cardId') or ''
                if track and 'board:'+track not in visible:raise ValueError('公式出现时知识卡尚未显示：'+track)
                formula_event=formula_tracks.get(track);current_formula=layout.formulas.get(formula_event['id']) if formula_event else None
                if current_formula is not None and item.get('display','replace')!='append':
                    visible.discard('formula:'+formula_event['id']);marks.pop('formula:'+formula_event['id'],None)
                    visible.difference_update(layout.formula_extras.get(formula_event['id'],[]))
                current_formula=layout.create_formula(item);formula_event=item;visible.add('formula:'+item['id']);visible.update(layout.formula_extras.get(item['id'],[]))
                formula_tracks[track]=item
            elif kind=='circuit' and circuit:
                targets=[circuit.resolve_target(identifier) for identifier in item['targetIds']]
                if item['type'] in ['hide','show','draw']:
                    shown=item['type']!='hide'
                    for identifier in item['targetIds']:
                        circuit.set_visibility(identifier,shown)
                        if identifier in circuit.labels:circuit.labels[identifier].set_opacity(1 if shown else 0)
                elif item['type']=='label' and item.get('text'):
                    key,previous,label=layout.create_circuit_label(item)
                    if previous:visible.discard(previous)
                    visible.add(key)
                elif item['type']=='annotation':
                    key,previous,annotation=layout.create_circuit_annotation(item)
                    if previous:visible.discard(previous)
                    visible.add(key)
                elif item['type']=='state':
                    previous,circuit=layout.replace_circuit_state(item)
                    extra_circuit.clear()
                elif item['type']=='highlight' and (event['id']==selected or measured_timeline is not None and abs(event['time']-time)<1e-6):
                    for identifier,target in zip(item['targetIds'],targets):
                        if circuit.has_raster(identifier):extra_circuit.append(SurroundingRectangle(target,color='#4F80FF',buff=.08))
                        else:target.set_color('#4F80FF')
            elif kind=='highlight':
                key=item['targetType']+':'+item['targetId']
                if key not in visible:raise ValueError('高亮发生时目标尚未出现或已被替换：'+item['targetId'])
                # A finite hold can only be shown at its named edit stage until real
                # speech timing exists. Do not convert seconds into fake text timing.
                if measured_timeline is None and event['id']!=selected:continue
                target=layout.boards[item['targetId']] if item['targetType']=='board' else layout.formulas[item['targetId']]
                regions=target.phrase_regions(item['phrase'],item.get('occurrence',1))
                index=next(i for i,h in enumerate(shot.get('highlights',[])) if h['id']==item['id'])
                mark=highlight_mobjects(regions,highlight_color(item,index),item['effect'])
                set_highlight_phase(mark,item['effect'],time-event['time'] if measured_timeline is not None else .125)
                layout.layer_object(key,mark)
                marks.setdefault(key,[]).append(mark)
                marks_by_id[item['id']]=(key,mark)
        if circuit and measured_timeline is not None:circuit.advance_flow(time)
        active=events[end] if end>=0 else None
        uid=None if measured_timeline is not None else active['utteranceId'] if active else (shot['utteranceIds'][0] if shot['utteranceIds'] else None)
        if uid:
            utterance=next(u for u in project['utterances'] if u['id']==uid)
            speaker=next(s for s in project['speakers'] if s['id']==utterance['speakerId'])
            layout.create_speaker(speaker);layout.create_subtitle(_subtitle_clause(utterance['text'],active['position'] if active else 0));visible.update(['speaker','subtitle'])
        elements=[]
        for identifier,item in sorted(layout.elements.items(),key=lambda pair:layout.layer(pair[0])):
            obj=item['object'];members=[*marks.get(identifier,[]),obj]
            if identifier=='circuit':members.extend(extra_circuit)
            serialized=serialize_mobject(Group(*members),clip_bounds=(0,0,1920,1080) if identifier=='story-image' else layout.content_bounds if item.get('constraintBounds') else None)
            elements.append({'id':identifier,'label':item['label'],'kind':item['kind'],**serialized,'placement':item['placement'],'visible':identifier in visible,**({'parentId':item['parentId']} if item.get('parentId') else {}),**({'constraintBounds':item['constraintBounds']} if item.get('constraintBounds') else {}),**text_metadata(identifier,obj,shot)})
        for element in elements:
            if element['id']=='title' and not element.get('text'):element['text']=project['title']
            if element.get('selectionWarning'):layout.warn(element['selectionWarning'])
        result={'width':1920,'height':1080,'template':layout.template,'stages':stages,'stage':selected,'elements':elements,'background':layout.background,'warnings':layout.warnings}
        if layout.content_bounds:result['contentBounds']=bounds_dict(layout.content_bounds)
        return result


def main():
    from video_runtime import watch_parent
    watch_parent()
    import argparse,tempfile
    parser=argparse.ArgumentParser(description=__doc__);parser.add_argument('--input',type=Path,required=True);parser.add_argument('--output',type=Path,required=True);parser.add_argument('--media-dir',type=Path);args=parser.parse_args()
    source=json.loads(args.input.read_text(encoding='utf-8-sig'))
    args.output.parent.mkdir(parents=True,exist_ok=True)
    # MiKTeX dvisvgm must run on the same drive as its temporary media directory.
    media=(args.media_dir or Path.cwd()/'.video-data/cache/preview-media').resolve();media.mkdir(parents=True,exist_ok=True)
    result=build_preview(source['project'],source['shotId'],source.get('stage'),media,source.get('timeline'),source.get('time'))
    temporary=args.output.with_suffix('.pending.json')
    temporary.write_text(json.dumps(result,ensure_ascii=False),encoding='utf-8');temporary.replace(args.output)
    print(json.dumps({'output':str(args.output),'elements':len(result['elements']),'stage':result['stage']}))

if __name__=='__main__':main()
