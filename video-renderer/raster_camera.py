"""Pixel-exact raster reuse for the mostly stationary lesson diagrams."""
from hashlib import blake2b
from itertools import groupby
from weakref import WeakKeyDictionary
import numpy as np
from PIL import Image
from manim import Camera


class LessonCamera(Camera):
    """Cache Manim's own raster transform, then composite its occupied pixels.

    Apparatus and paper backgrounds stay fixed while current particles move.
    The standard camera transforms every image and composites a full frame for
    every leaf on every frame. Here the transform is reused only when both the
    complete RGBA content and the camera-mapped corners are unchanged. Fades,
    state swaps, camera moves and editor scaling therefore invalidate naturally.
    """
    content_bounds=None

    def capture_mobjects(self,mobjects,**kwargs):
        """Clip summary teaching pixels, including transient animation objects.

        Preserve draw order and the existing static-frame buffer. Background
        and title leaves are explicitly exempt; newly created marks, current
        particles and Manim animation copies are constrained by default.
        """
        if self.content_bounds is None:return super().capture_mobjects(mobjects,**kwargs)
        x,y,w,h=self.content_bounds;sx=self.pixel_width/1920;sy=self.pixel_height/1080
        left=max(0,int(np.ceil(x*sx)));right=min(self.pixel_width,int(np.floor((x+w)*sx)))
        top=max(0,int(np.ceil(y*sy)));bottom=min(self.pixel_height,int(np.floor((y+h)*sy)))
        displayed=self.get_mobjects_to_display(mobjects,**kwargs)
        for exempt,group in groupby(displayed,key=lambda obj:getattr(obj,'_summary_unclipped',False)):
            if exempt:
                super().capture_mobjects(list(group),include_submobjects=False)
                continue
            regions=[self.pixel_array[:top],self.pixel_array[bottom:],self.pixel_array[top:bottom,:left],self.pixel_array[top:bottom,right:]]
            saved=[region.copy() for region in regions]
            super().capture_mobjects(list(group),include_submobjects=False)
            for region,previous in zip(regions,saved):region[:]=previous

    def display_image_mobject(self,image_mobject,pixel_array):
        if not hasattr(self,'_lesson_raster_cache'):self._lesson_raster_cache=WeakKeyDictionary()
        pixels=np.ascontiguousarray(image_mobject.get_pixel_array())
        corners=self.points_to_subpixel_coords(image_mobject,image_mobject.points)
        key=(pixels.shape,pixels.dtype.str,blake2b(pixels,digest_size=16).digest(),
             corners.tobytes(),self.pixel_width,self.pixel_height,image_mobject.resampling_algorithm)
        cached=self._lesson_raster_cache.get(image_mobject)
        if cached is None or cached[0]!=key:
            # Use Manim itself for exact interpolation and clipping. Only the
            # immutable raster result is cached; vector/current drawing is live.
            layer=np.zeros_like(pixel_array)
            super().display_image_mobject(image_mobject,layer)
            image=Image.fromarray(layer,mode='RGBA');bounds=image.getbbox()
            overlay=image.crop(bounds) if bounds else None
            cached=(key,bounds,overlay)
            self._lesson_raster_cache[image_mobject]=cached
        _,bounds,overlay=cached
        if bounds is None:return
        left,top,right,bottom=bounds
        region=Image.fromarray(pixel_array[top:bottom,left:right],mode='RGBA')
        pixel_array[top:bottom,left:right]=np.asarray(Image.alpha_composite(region,overlay))
