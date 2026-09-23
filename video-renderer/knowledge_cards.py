"""Reusable knowledge cards measured in design pixels, independent of lesson topic."""
import math
import numpy as np
from manim import VGroup, RoundedRectangle, VMobject

UNIT=135


class KnowledgeCard(VGroup):
    def __init__(self,spec,width,formula_heights):
        from scene import BoardMobject
        from fonts import family,TITLE_PX,BODY_PX,BODY_BASELINE_PX
        super().__init__()
        self.card_title=spec['card']['title'];self.original_text=spec.get('text','')
        self.title=BoardMobject(self.card_title,family('chinese'),width=(width-100)/UNIT,size=TITLE_PX,color='#FFFFFF',line_spacing=48,title=True)
        self.body=BoardMobject(self.original_text,family('chinese'),width=(width-84)/UNIT,size=BODY_PX,line_spacing=BODY_BASELINE_PX)
        self.runs=self.body.runs
        header=max(54,self.title.height*UNIT+24)
        body_height=self.body.height*UNIT if self.original_text.strip() else 0
        formula_height=sum(formula_heights)+max(0,len(formula_heights)-1)*18
        height=header+20+body_height+(18 if body_height and formula_height else 0)+formula_height+22
        height=max(142,height)
        panel=RoundedRectangle(width=width/UNIT,height=(height-header/2)/UNIT,corner_radius=16/UNIT,stroke_width=0,fill_color='#EAF4FF',fill_opacity=1)
        panel.move_to([width/2/UNIT,-(height+header/2)/2/UNIT,0])
        title_width=min(width-18,max(180,self.title.width*UNIT+72))
        bar=RoundedRectangle(width=title_width/UNIT,height=header/UNIT,corner_radius=11/UNIT,stroke_width=0,fill_color='#5B80F8',fill_opacity=1)
        bar.move_to([(18+title_width/2)/UNIT,-header/2/UNIT,0])
        self.title.shift(np.array([56/UNIT,-header/2/UNIT,0])-self.title.get_left())
        # A vector paperclip stays crisp in both browser SVG and final video.
        clip_points=np.array([[-4,-31],[-17,-13],[-15,1],[-5,8],[7,4],[24,-21],[23,-31],[14,-35],[7,-31],[-5,-13],[-4,-7],[2,-8],[14,-27]],dtype=float)/UNIT
        clip=VMobject(color='#9DBAFF',stroke_width=4.5).set_points_smoothly(np.column_stack([clip_points,np.zeros(len(clip_points))]))
        clip.shift([16/UNIT,-12/UNIT,0])
        self.add(panel,bar,self.title,clip)
        if body_height:
            # Title and body share a left text edge, after the paperclip gutter.
            self.body.shift(np.array([56/UNIT,-(header+20)/UNIT,0])-self.body.get_corner(np.array([-1.,1.,0.])))
        self.design_width,self.design_height=width,height
        self.formula_boxes=[];y=header+20+body_height+(18 if body_height and formula_height else 0)
        for item_height in formula_heights:
            self.formula_boxes.append((28,y,width-56,item_height));y+=item_height+18

    def phrase_regions(self,phrase,occurrence=1):return self.body.phrase_regions(phrase,occurrence)


def card_columns(count,has_circuit,content_layout):
    if content_layout=='cards-grid':return 1 if count==1 else 2
    if content_layout=='circuit-left' or has_circuit:return 1 if count<=3 else 2
    return 1 if count==1 else 2


def card_positions(cards,area,columns):
    """Pack variable-height rows with consistent gutters; never shrink content."""
    x,y,width,height=area;gap=24
    positions=[];cursor=y
    for start in range(0,len(cards),columns):
        row=cards[start:start+columns];row_height=max(card.design_height for card in row)
        for index,card in enumerate(row):positions.append((x+index*((width-gap*(columns-1))/columns+gap),cursor))
        cursor+=row_height+gap
    return positions,max(0,cursor-gap-(y+height))
