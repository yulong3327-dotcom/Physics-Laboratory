"""One 1920x1080 object layout shared by browser SVG previews and Manim video."""
from pathlib import Path
import numpy as np
from manim import Group, VGroup, Line, Arrow, RoundedRectangle, ImageMobject
from circuit import CircuitMobject, inline_image
from fonts import register_video_fonts, mixed_text, family, design_math_font_size, TITLE_PX, BODY_PX, NOTE_PX, BODY_BASELINE_PX

DESIGN_W, DESIGN_H, UNIT = 1920, 1080, 135
SAFE_AREA=(141.12,123.36,1637.76,833.28)
# Inset from the white paper in the cover-scaled summary background, leaving
# room for its rounded corners and the strokes of animated teaching marks.
SUMMARY_CONTENT_BOUNDS=(204,248,1506,644)

def xy(x,y):return np.array([(x-960)/UNIT,(540-y)/UNIT,0.])
def box_of(obj):return {'x':float(obj.get_left()[0]*UNIT+960),'y':float(540-obj.get_top()[1]*UNIT),'width':float(obj.width*UNIT),'height':float(obj.height*UNIT)}
def top_left(obj,x,y):
    obj.shift(xy(x,y)-obj.get_corner(np.array([-1.,1.,0.])));return obj

def bounds_dict(bounds):return dict(zip(('x','y','width','height'),bounds))

def constrain_to_bounds(obj,bounds):
    """Keep the complete object inside a design-pixel rectangle, even after edits."""
    x,y,w,h=bounds
    factor=min(1,w/max(obj.width*UNIT,1e-9),h/max(obj.height*UNIT,1e-9))
    if factor<1:obj.scale(factor)
    actual=box_of(obj)
    top_left(obj,max(x,min(actual['x'],x+w-actual['width'])),max(y,min(actual['y'],y+h-actual['height'])))
    return factor

def fit(obj,box,align='center'):
    x,y,w,h=box
    if obj.width and obj.height:obj.scale(min(1,w/UNIT/obj.width,h/UNIT/obj.height))
    obj.move_to(xy(x+w/2,y+h/2))
    if align=='left':top_left(obj,x,y)
    return obj

def template_asset(name):
    root=Path(__file__).resolve().parent.parent
    for directory in [root/'public/video/templates',root/'assets/templates']:
        path=directory/name
        if path.is_file():return path
    raise ValueError('缺少模板素材：'+name)

class SceneLayout:
    def __init__(self,timeline,directory):
        from scene import BoardMobject,place_problem_circuit
        register_video_fonts()
        self.timeline,self.shot,self.settings=timeline,timeline['shot'],timeline['settings']
        self.directory=Path(directory);self.directory.mkdir(parents=True,exist_ok=True)
        requested=self.shot.get('layout') or {}
        from video_summary import resolve_shot_template
        template=resolve_shot_template(self.shot)
        # The supplied question AI is a component specification sheet, not a page template.
        self.template=template if template not in ['auto','question'] else 'explain'
        self.content_bounds=SUMMARY_CONTENT_BOUNDS if self.template=='summary' else None
        self.overrides=requested.get('elements') or {};self.elements={};self.warnings=[]
        self.boards={};self.circuit=self.problem_image=None;self.background_object=None
        self.formula_extras={};self._annotation_targets={};self._measurement_regions={};self.has_circuit=bool(timeline.get('circuit'))
        self.formulas={};self._prepared_formulas={};self.cards={};self.board_children={};self.card_formula_slots={}
        self.story_image=None
        if self.shot.get('story') is not None:
            self.create_story_layout()
            return
        formula_order=[event['data'] for event in timeline.get('events',[]) if event.get('type',event.get('kind'))=='formula'] or self.shot.get('formulas',[])
        self.formula_rows={};self.formula_row_counts={}
        for step in formula_order:
            track=step.get('cardId') or '';count=self.formula_row_counts.get(track,0)
            if not count or step.get('display','replace')=='append':count+=1
            self.formula_rows[step['id']]=count-1;self.formula_row_counts[track]=count
        self.formula_row_count=self.formula_row_counts.get('',1)
        self.background='#4F80FF' if self.template=='summary' else self.settings['background']
        if self.template=='question':
            board_slot=(170,255,760,565);self.circuit_slot=(1010,260,740,365);self.formula_slot=(1000,655,750,165)
        elif self.template=='summary':
            board_slot=(230,275,700 if self.has_circuit else 1454,470)
            self.circuit_slot=(990,285,690,280);self.formula_slot=(970,590,710,160) if self.has_circuit else (290,590,1340,160)
        else:
            board_slot=(1010,255,740,310) if self.has_circuit else (170,255,1580,310)
            self.circuit_slot=(170,275,740,510);self.formula_slot=(1000,590,750,230) if self.has_circuit else (260,600,1400,220)
        card_specs=[b for b in self.shot.get('boardTexts',[]) if b.get('card')]
        content_layout=requested.get('contentLayout','auto')
        if card_specs:
            if self.has_circuit or content_layout=='circuit-left':
                board_slot=(170,255,740,260);self.circuit_slot=(170,310,740,485);self.cards_area=(1000,250,750,570)
            else:
                board_slot=(170,245,1580,220);self.cards_area=(170,250,1580,570)
            if self.template=='summary':
                if self.has_circuit or content_layout=='circuit-left':
                    board_slot=(230,270,700,200);self.circuit_slot=(230,310,700,450);self.cards_area=(960,270,724,490)
                else:
                    board_slot=(230,270,1454,200);self.cards_area=(230,270,1454,490)
        self.board_slot=board_slot
        if self.template=='summary':
            image=ImageMobject(str(template_asset('summary-background.png')))
            image.scale(max((1920/UNIT)/image.width,(1080/UNIT)/image.height)).move_to([0,0,0])
            self.background_object=self.register('background',image,'总结底板','background')
        elif self.settings.get('backgroundImage'):
            image=ImageMobject(inline_image(self.settings['backgroundImage']))
            image.scale(max((1920/UNIT)/image.width,(1080/UNIT)/image.height)).move_to([0,0,0])
            self.background_object=self.register('background',image,'纸张背景','background')
        self.title=self.make_title(self.shot.get('sectionTitle') or timeline['projectTitle'])
        footer=RoundedRectangle(width=(1454 if self.content_bounds else 1630)/UNIT,height=(96 if self.content_bounds else 112)/UNIT,corner_radius=16/UNIT,stroke_width=0,fill_color='#EAF0F8',fill_opacity=1).move_to(xy(957,830) if self.content_bounds else xy(960,898))
        self.footer=self.register('footer',footer,'字幕底板','decoration')
        specs=list(self.shot.get('boardTexts') or []);problem=timeline.get('problem') or {}
        # Older lesson snapshots predate boardTexts. Keep only their stated
        # quantities visible; derived/symbolic quantities retain their own cues.
        if 'boardTexts' not in self.shot and not problem.get('text') and timeline.get('circuit'):
            givens=[]
            for quantity in timeline['circuit'].get('quantities',[]):
                if quantity.get('provenance')!='given':continue
                value=quantity.get('value')
                if value is None:continue
                number=str(int(value)) if float(value).is_integer() else str(value)
                givens.append(str(quantity['symbol'])+' = '+number+' '+str(quantity.get('unit','')))
            if givens:specs.append({'id':'__given','kind':'given','text':'\n'.join(givens)})
        # Only explicit storyboard boards appear on screen; deleting a problem stays deleted.
        self.board_specs=specs;cursor=board_slot[1]
        for spec in specs:
            if spec.get('card'):continue
            card=self.template=='question' and spec['kind']=='problem'
            board=BoardMobject(spec['text'],family('chinese'),width=(board_slot[2]-(48 if card else 0))/UNIT,size=BODY_PX,line_spacing=BODY_BASELINE_PX)
            if card:
                panel=RoundedRectangle(width=board_slot[2]/UNIT,height=max(128/UNIT,board.height+48/UNIT),corner_radius=12/UNIT,stroke_color='#8DD7FF',stroke_width=5/1.35,fill_color='#DCF0FF',fill_opacity=1).move_to(board.get_center()).set_z_index(0)
                board.add_to_back(panel)
            top_left(board,board_slot[0],cursor)
            key='board:'+spec['id'];label={'keyword':'关键词','law':'定律','problem':'题干','given':'已知条件','derivation':'推导'}.get(spec['kind'],'板书')
            self.boards[spec['id']]=self.register(key,board,label,'board')
            if not self.overrides.get(key) and cursor+board.height*UNIT>board_slot[1]+board_slot[3]+.5:self.warn(label+'超出默认排版区域，请移动、拆段或手动缩放')
            cursor+=board.height*UNIT+28
        if card_specs:
            content_bottom=760 if self.content_bounds else 820
            if cursor>board_slot[1]:
                if self.has_circuit or content_layout=='circuit-left':
                    x,y,w,h=self.circuit_slot;new_y=max(y,cursor+16);self.circuit_slot=(x,new_y,w,max(150,content_bottom-5-new_y))
                else:
                    x,y,w,h=self.cards_area;new_y=max(y,cursor+12);self.cards_area=(x,new_y,w,max(0,content_bottom-new_y))
            if any(not f.get('cardId') for f in self.shot.get('formulas',[])):
                if self.has_circuit or content_layout=='circuit-left':
                    self.formula_slot=(230,620,700,140) if self.content_bounds else (170,665,740,150)
                    x,y,w,h=self.circuit_slot;self.circuit_slot=(x,y,w,max(120,self.formula_slot[1]-25-y))
                else:
                    self.formula_slot=(290,620,1340,140) if self.content_bounds else (260,665,1400,150)
                    x,y,w,h=self.cards_area;self.cards_area=(x,y,w,max(0,self.formula_slot[1]-25-y))
            self.create_cards(card_specs,content_layout)
        if self.has_circuit:
            c=CircuitMobject(timeline['circuit'],self.directory/'geometry',family('chinese'),width=self.circuit_slot[2]/UNIT,height=self.circuit_slot[3]/UNIT)
            place_problem_circuit(c)
            if c.width and c.height:c.scale(min(self.circuit_slot[2]/UNIT/c.width,self.circuit_slot[3]/UNIT/c.height))
            c.move_to(xy(self.circuit_slot[0]+self.circuit_slot[2]/2,self.circuit_slot[1]+self.circuit_slot[3]/2))
            self.circuit=self.register('circuit',c,'电路素材','circuit')
        elif problem.get('imageDataUrl') and not requested.get('hideProblemImage',False):
            image=ImageMobject(inline_image(problem['imageDataUrl']));image.scale(min(self.circuit_slot[2]/UNIT/image.width,self.circuit_slot[3]/UNIT/image.height));fit(image,self.circuit_slot)
            self.problem_image=self.register('problem-image',image,'题目图片','image')
        self.static_ids=[key for key in self.elements if not key.startswith(('board:','board-body:')) and key!='circuit']

    def create_story_layout(self):
        from story_scene import story_image_pixels
        self.template='story';self.content_bounds=None;self.background='#101820'
        self.overrides={};self.board_specs=[];self.has_circuit=False
        image=ImageMobject(story_image_pixels(self.shot))
        image.scale(max((1920/UNIT)/image.width,(1080/UNIT)/image.height)).move_to([0,0,0])
        self.story_image=self.register('story-image',image,'剧情插图','background')
        self._story_base_points=image.points.copy()
        # A fixed high-contrast footer remains readable on every illustration.
        footer=RoundedRectangle(width=1740/UNIT,height=146/UNIT,corner_radius=16/UNIT,stroke_width=0,fill_color='#F4F7FC',fill_opacity=.97).move_to(xy(960,972))
        self.footer=self.register('footer',footer,'字幕底板','decoration')
        self.static_ids=['story-image','footer']

    def apply_story_time(self,seconds,duration):
        from story_scene import apply_story_frame
        return apply_story_frame(self.story_image,self._story_base_points,self.shot['story']['motion'],seconds,duration)

    def warn(self,message):
        if message not in self.warnings:self.warnings.append(message)

    def layer(self,key):
        if key in ['background','story-image']:return -1000
        if key.startswith('board:'):return 1000+next((i for i,b in enumerate(self.board_specs) if key=='board:'+b['id']),0)*100
        if key.startswith('board-body:'):return self.layer('board:'+key.split(':',1)[1])+10
        if key in ['circuit','problem-image']:return 10000
        if key.startswith(('circuit-label:','circuit-annotation:')):return 20000+next((i for i,a in enumerate(self.shot.get('actions',[])) if key.split(':',1)[1]==a['id']),0)*100
        if key.startswith(('formula:','formula-caption:','formula-badge:')):
            suffix=key.split(':',1)[1];index=next((i for i,f in enumerate(self.shot['formulas']) if f['id']==suffix),0)
            return 50000+index*100+(5 if key.startswith('formula-caption:') else 6 if key.startswith('formula-badge:') else 0)
        return {'title':90000,'footer':91000,'speaker':92000,'subtitle':93000}.get(key,80000)

    def layer_object(self,key,obj):
        base=self.layer(key)
        for member in obj.get_family():
            relative=getattr(member,'_layout_relative_z',float(member.z_index));member._layout_relative_z=relative
            member.z_index=base+max(0,min(8,relative))
            member._summary_unclipped=key in ['background','title']
        return obj

    def register(self,key,obj,label,kind,parent_id=None):
        natural=box_of(obj);override=self.overrides.get(key) if kind!='background' else None;scale=float((override or {}).get('scale',1))
        if override:
            scale=max(.2,min(4,scale));obj.scale(scale)
            x=max(0,min(float(override['x']),DESIGN_W-obj.width*UNIT));y=max(0,min(float(override['y']),DESIGN_H-obj.height*UNIT));top_left(obj,x,y)
        elif parent_id and parent_id in self.elements:
            parent=self.elements[parent_id];origin=parent['natural'];placement=parent['placement'];scale=placement['scale']
            obj.scale(scale);top_left(obj,placement['x']+(natural['x']-origin['x'])*scale,placement['y']+(natural['y']-origin['y'])*scale)
        constraint=self.content_bounds if key not in ['background','title'] else None
        if constraint:
            before=box_of(obj);scale*=constrain_to_bounds(obj,constraint)
            bounded=box_of(obj)
            if any(abs(before[k]-bounded[k])>.5 for k in before):self.warn(label+'已限制在总结页白色框内；内容较多时请拆分镜头')
        actual=box_of(obj)
        if kind!='background':
            if actual['x']<0 or actual['y']<0 or actual['x']+actual['width']>1920+.5 or actual['y']+actual['height']>1080+.5:self.warn(label+'超出画面，请移动或手动缩小')
            if kind in ['board','card','formula','circuit','image']:
                x,y,w,h=constraint or SAFE_AREA
                if actual['x']<x-.5 or actual['y']<y-.5 or actual['x']+actual['width']>x+w+.5 or actual['y']+actual['height']>y+h+.5:self.warn(label+'超出教学安全区，请移动或拆分')
            if (kind=='card' or parent_id and parent_id.startswith('board:')) and actual['y']<(878 if self.content_bounds else 954) and actual['y']+actual['height']>(782 if self.content_bounds else 832):self.warn(label+'与字幕区域重叠，请上移或拆分镜头')
        self.layer_object(key,obj)
        self.elements[key]={'object':obj,'label':label,'kind':kind,'placement':{'x':actual['x'],'y':actual['y'],'scale':scale},'natural':natural,'parentId':parent_id,'constraintBounds':bounds_dict(constraint) if constraint else None}
        return obj

    def make_title(self,value):
        title=mixed_text(value,design_px=TITLE_PX,title=True,color='#FFFFFF')
        if self.template=='summary':
            top_left(title,204.73,165.25)
            if title.width*UNIT>1300:self.warn('总结标题过长，请精简或手动缩放')
            return self.register('title',title,'本课脚本名称','title')
        w=title.width*UNIT+52
        bar=RoundedRectangle(width=w/UNIT,height=63.36/UNIT,corner_radius=8/UNIT,stroke_width=0,fill_color='#4F80FF',fill_opacity=1).move_to(xy(171.84+w/2,185.76))
        title.move_to(bar.get_center());group=Group(bar,title)
        pin=self.settings.get('titlePinImage')
        image=ImageMobject(inline_image(pin)) if pin else ImageMobject(str(template_asset('reference-title-pin.png')))
        image.scale_to_fit_height(48/UNIT);image.move_to(xy(177,167));group.add(image)
        return self.register('title',group,'知识点标题','title')

    def create_formula(self,step):
        from scene import FormulaMobject,BoardMobject
        obj=self.formula_object(step)
        card_id=step.get('cardId');parent_id='board:'+card_id if card_id else None
        if card_id:
            if card_id not in self.card_formula_slots:raise ValueError('公式绑定的知识卡不存在：'+card_id)
            x,y,w,h=self.card_formula_slots[card_id][self.formula_rows[step['id']]]
            if step.get('role')=='misconception':y+=46;h-=46
            if self.settings.get('showFormulaCaptions') and step.get('caption'):h-=50
        else:
            x,y,w,h=self.formula_slot
            if self.formula_row_count>1:
                h=max(76,h/self.formula_row_count);y+=self.formula_rows.get(step['id'],0)*h
        obj.move_to(xy(x+w/2,y+h/2))
        if not self.overrides.get('formula:'+step['id']):
            if obj.width*UNIT>w or obj.height*UNIT>h:self.warn('公式超出默认排版区域，请拆步或手动缩放')
            if not card_id and y+h>self.formula_slot[1]+self.formula_slot[3]+.5:self.warn('累计公式超出默认排版区域，请拆分镜头或手动移动')
        self.register('formula:'+step['id'],obj,'公式 · '+step['latex'][:32],'formula',parent_id);extras=[]
        self.formulas[step['id']]=obj
        if self.settings.get('showFormulaCaptions',False) and step.get('caption'):
            caption=BoardMobject(step['caption'],family('chinese'),width=w/UNIT,size=NOTE_PX);top_left(caption,x,y+h+10);key='formula-caption:'+step['id'];self.register(key,caption,'公式注释','annotation','formula:'+step['id']);extras.append(key)
        if step.get('role')=='misconception':
            badge=mixed_text('猜想 · 待检验',design_px=NOTE_PX,color='#FF6600');top_left(badge,x,y-45);key='formula-badge:'+step['id'];self.register(key,badge,'教学猜想标记','annotation','formula:'+step['id']);extras.append(key)
        self.formula_extras[step['id']]=extras
        return obj

    def formula_object(self,step):
        from scene import FormulaMobject
        if step['id'] not in self._prepared_formulas:
            phrases=[h['phrase'] for h in self.shot.get('highlights',[]) if h['targetType']=='formula' and h['targetId']==step['id']]
            self._prepared_formulas[step['id']]=FormulaMobject(step,highlight_phrases=phrases,color='#FF6600' if step.get('role')=='misconception' else '#333333',font_size=design_math_font_size(BODY_PX))
        return self._prepared_formulas[step['id']].copy()

    def create_cards(self,specs,content_layout):
        from knowledge_cards import KnowledgeCard,card_columns,card_positions
        columns=card_columns(len(specs),self.has_circuit,content_layout)
        x,y,w,h=self.cards_area;width=(w-24*(columns-1))/columns
        if len(specs)==1 and not self.has_circuit and content_layout!='circuit-left':width=min(width,1100);self.cards_area=(x+(w-width)/2,y,width,h)
        objects=[]
        for spec in specs:
            if not spec['card'].get('title','').strip():raise ValueError('知识卡标题不能为空：'+spec['id'])
            steps=[f for f in self.shot.get('formulas',[]) if f.get('cardId')==spec['id']]
            if not spec.get('text','').strip() and not steps:raise ValueError('知识卡需要正文或绑定公式：'+spec['id'])
            heights=[float(BODY_BASELINE_PX)]*self.formula_row_counts.get(spec['id'],0)
            for step in steps:
                obj=self.formula_object(step);row=self.formula_rows[step['id']]
                extra=(46 if step.get('role')=='misconception' else 0)+(50 if self.settings.get('showFormulaCaptions') and step.get('caption') else 0)
                heights[row]=max(heights[row],obj.height*UNIT+extra+12)
                if obj.width*UNIT>width-56 and not self.overrides.get('formula:'+step['id']):self.warn('知识卡公式过宽，请拆步或手动调整')
            objects.append(KnowledgeCard(spec,width,heights))
        positions,overflow=card_positions(objects,self.cards_area,columns)
        if len(specs)>4:self.warn('知识卡超过4张，请拆分镜头以保持清晰')
        if overflow>.5 and any(not self.overrides.get('board:'+s['id']) for s in specs):self.warn('知识卡内容超出字幕上方的排版区域，请拆分镜头或手动调整')
        for spec,card,(left,top) in zip(specs,objects,positions):
            delta=xy(left,top)-card.get_corner(np.array([-1.,1.,0.]));card.shift(delta);card.body.shift(delta)
            self.card_formula_slots[spec['id']]=[(960+(delta[0]+a/UNIT)*UNIT,540-(delta[1]-b/UNIT)*UNIT,c,d) for a,b,c,d in card.formula_boxes]
            key='board:'+spec['id'];self.cards[spec['id']]=card
            self.boards[spec['id']]=self.register(key,card,'知识卡 · '+spec['card']['title'],'card')
            if spec.get('text','').strip():
                child='board-body:'+spec['id'];self.register(child,card.body,'知识卡正文','board',key);self.board_children[spec['id']]=[child]
            else:self.board_children[spec['id']]=[]

    def board_group(self,identifier):
        return VGroup(self.boards[identifier],*[self.elements[key]['object'] for key in self.board_children.get(identifier,[])])

    def create_speaker(self,speaker):
        if self.template=='story':
            obj=mixed_text(speaker['name'],design_px=TITLE_PX,color='#24334A')
            fit(obj,(120,932,230,78));return self.register('speaker',obj,'角色姓名','speaker')
        obj=mixed_text(speaker['name'],design_px=TITLE_PX,color=speaker.get('color','#333333'));obj.move_to(xy(330,830) if self.content_bounds else xy(275,898))
        return self.register('speaker',obj,'角色姓名','speaker')

    def create_subtitle(self,value):
        from scene import BoardMobject
        if self.template=='story':
            obj=BoardMobject(value,family('chinese'),width=1400/UNIT,size=BODY_PX,line_spacing=BODY_BASELINE_PX)
            if obj.height*UNIT>112:self.warn('字幕超过两行，请缩短字幕分段')
            fit(obj,(370,916,1400,112));return self.register('subtitle',obj,'旁白字幕','subtitle')
        obj=BoardMobject(value,family('chinese'),width=(1170 if self.content_bounds else 1310)/UNIT,size=BODY_PX,line_spacing=BODY_BASELINE_PX);obj.move_to(xy(1065,830) if self.content_bounds else xy(1075,898))
        if obj.height*UNIT>106:self.warn('字幕超过两行，请缩短字幕分段')
        return self.register('subtitle',obj,'旁白字幕','subtitle')

    def create_circuit_label(self,action):
        from scene import update_dynamic_label
        key='circuit-label:'+action['id'];target_key=tuple(sorted(action['targetIds']));previous=self._annotation_targets.get(target_key)
        label=mixed_text(action['text'],design_px=NOTE_PX,color='#4F80FF')
        # Choose label placement in the circuit's original geometry, then apply
        # the same parent transform as the browser. Moving the circuit needs no new SVG.
        parent=self.elements['circuit'];natural=parent['natural'];placement=parent['placement']
        self.circuit.scale(1/placement['scale'],about_point=xy(placement['x'],placement['y'])).shift(xy(natural['x'],natural['y'])-xy(placement['x'],placement['y']))
        class Host:
            def add(self,obj):pass
            def remove(self,obj):pass
        try:
            targets=[self.circuit.resolve_target(i) for i in action['targetIds']]
            update_dynamic_label(Host(),{},action['targetIds'],label,targets,self.circuit,bounds=((self.circuit_slot[0]-960)/135,(self.circuit_slot[0]+self.circuit_slot[2]-960)/135))
        finally:
            self.circuit.shift(xy(placement['x'],placement['y'])-xy(natural['x'],natural['y'])).scale(placement['scale'],about_point=xy(placement['x'],placement['y']))
        self.register(key,label,'电路标注 · '+action['text'],'annotation','circuit');self._annotation_targets[target_key]=key
        return key,previous,label

    def replace_circuit_state(self,action):
        if not action.get('geometry'):raise ValueError('状态动作缺少累计仿真几何，请重新准备视频工程：'+action['id'])
        old=self.circuit
        replacement=old.with_geometry(action['geometry'],self.directory/('state-'+action['id']))
        self.layer_object('circuit',replacement)
        self.circuit=replacement
        # Keep the original parent placement: dependent labels/measurements use
        # this mapping, even when an open switch changes the symbol bounds.
        self.elements['circuit']['object']=replacement
        return old,replacement

    def create_circuit_annotation(self,action):
        annotation=action['annotation'];kind=annotation['kind']
        key='circuit-annotation:'+action['id']
        target_key=(kind,*sorted(action['targetIds']),annotation.get('side','below'))
        previous=self._annotation_targets.get(target_key)
        parent=self.elements['circuit'];natural=parent['natural'];placement=parent['placement']
        # Use the same parent transform as labels and the browser drag editor.
        self.circuit.scale(1/placement['scale'],about_point=xy(placement['x'],placement['y'])).shift(xy(natural['x'],natural['y'])-xy(placement['x'],placement['y']))
        try:
            target=Group(*[self.circuit.resolve_target(i) for i in action['targetIds']])
            color=annotation.get('color') or '#333333'
            label=mixed_text(annotation['label'],design_px=NOTE_PX,color=color)
            sign=1 if annotation.get('side','below')=='above' else -1
            # A vertical wire has no useful horizontal span. Render its current
            # arrow vertically instead of rejecting a valid circuit target.
            vertical=kind=='current' and target.width<24/UNIT and target.height>=24/UNIT
            if vertical:
                # Rotate the measurement coordinate system, not the label.
                # Above maps to the left side; forward maps to upward current.
                target=target.copy().rotate(-np.pi/2,about_point=np.zeros(3))
            edge=target.get_top()[1] if sign>0 else target.get_bottom()[1]
            level=edge+sign*float(annotation.get('offset',40))/UNIT
            left,right=target.get_left()[0],target.get_right()[0]
            if right-left<24/UNIT:raise ValueError('电路方向标注目标过窄，请选择跨越两个端点的目标')
            # Offset is a minimum distance. Leave component names and earlier
            # measurement labels readable when stacking partial/total voltage.
            # The coordinate system here is the circuit's natural placement.
            blockers=[]
            for name in self.circuit.labels.values():
                box=(name.get_left()[0],name.get_right()[0],name.get_bottom()[1],name.get_top()[1])
                if vertical:box=(box[2],box[3],-box[1],-box[0])
                if box[1]>left and box[0]<right:
                    blockers.append((box[2],box[3]))
            for identifier,region in self._measurement_regions.items():
                if vertical:region=(region[2],region[3],-region[1],-region[0])
                if identifier!=previous and region[1]>left and region[0]<right:
                    blockers.append((region[2],region[3]))
            half=(label.width if vertical else label.height)/2+12/UNIT
            for bottom,top in sorted(blockers,key=lambda box:box[0],reverse=sign<0):
                # Distant names on other branches must not push a vertical
                # current indicator away from the wire it describes.
                if vertical and (level+half<=bottom or level-half>=top):continue
                if sign<0 and bottom<=edge and level+half>bottom:level=min(level,bottom-half)
                if sign>0 and top>=edge and level-half<top:level=max(level,top+half)
            lines=VGroup()
            if kind=='voltage':
                label.move_to([(left+right)/2,level,0])
                gap=label.width/2+8/UNIT
                center=(left+right)/2
                if gap*2+24/UNIT>right-left:
                    label.move_to([center,level+sign*(label.height/2+8/UNIT),0]);gap=0
                lines.add(Line([left,edge,0],[left,level+sign*10/UNIT,0],color=color,stroke_width=1.8),Line([right,edge,0],[right,level+sign*10/UNIT,0],color=color,stroke_width=1.8))
                lines.add(Arrow([center-gap,level,0],[left,level,0],buff=0,color=color,stroke_width=2,tip_length=9/UNIT,max_tip_length_to_length_ratio=.25),Arrow([center+gap,level,0],[right,level,0],buff=0,color=color,stroke_width=2,tip_length=9/UNIT,max_tip_length_to_length_ratio=.25))
            else:
                start,end=([left,level,0],[right,level,0])
                if annotation.get('direction','forward')=='reverse':start,end=end,start
                lines.add(Arrow(start,end,buff=0,color=color,stroke_width=2.5,tip_length=12/UNIT))
                label.move_to([(left+right)/2,level+sign*((label.width if vertical else label.height)/2+8/UNIT),0])
            if vertical:
                lines.rotate(np.pi/2,about_point=np.zeros(3))
                x,y,_=label.get_center();label.move_to([-y,x,0])
            obj=Group(lines,label)
            if previous:self._measurement_regions.pop(previous,None)
            self._measurement_regions[key]=(obj.get_left()[0],obj.get_right()[0],obj.get_bottom()[1],obj.get_top()[1])
        finally:
            self.circuit.shift(xy(placement['x'],placement['y'])-xy(natural['x'],natural['y'])).scale(placement['scale'],about_point=xy(placement['x'],placement['y']))
        self.register(key,obj,'电压范围' if kind=='voltage' else '电流方向','annotation','circuit')
        self._annotation_targets[target_key]=key
        return key,previous,obj
