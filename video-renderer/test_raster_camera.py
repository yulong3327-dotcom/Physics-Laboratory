"""Caching must preserve every output pixel, including fades and live edits."""
import unittest
import numpy as np
from manim import Camera, ImageMobject, Rectangle, tempconfig
from raster_camera import LessonCamera


class RasterCameraTest(unittest.TestCase):
    def test_summary_clips_vector_raster_and_transient_frames_preserving_header_and_static_buffer(self):
        from scene_layout import SUMMARY_CONTENT_BOUNDS,xy
        for width,height in [(640,360),(1280,720)]:
            with self.subTest(width=width),tempconfig({'pixel_width':width,'pixel_height':height,'frame_width':128/9,'frame_height':8}):
                camera=LessonCamera();camera.content_bounds=SUMMARY_CONTENT_BOUNDS
                background=Rectangle(width=128/9,height=8,stroke_width=0,fill_color='#80A0FF',fill_opacity=1)
                header=Rectangle(width=4,height=.35,stroke_width=0,fill_color='#FFFFFF',fill_opacity=1).move_to(xy(500,185))
                background._summary_unclipped=header._summary_unclipped=True
                camera.capture_mobjects([background,header]);base=camera.pixel_array.copy()
                x,y,w,h=SUMMARY_CONTENT_BOUNDS
                left=int(np.ceil(x*width/1920));right=int(np.floor((x+w)*width/1920))
                top=int(np.ceil(y*height/1080));bottom=int(np.floor((y+h)*height/1080))
                outside=np.ones((height,width),dtype=bool);outside[top:bottom,left:right]=False
                vector=Rectangle(width=20,height=12,stroke_width=10,fill_color='#FF0000',fill_opacity=1)
                raster=ImageMobject(np.full((60,60,4),[0,255,0,255],dtype=np.uint8)).scale_to_fit_width(20)
                # No explicit tag is needed for animation-created objects.
                for item in [vector,raster,vector.copy().shift([2,2,0])]:
                    camera.pixel_array[:]=base
                    camera.capture_mobjects([item])
                    np.testing.assert_array_equal(camera.pixel_array[outside],base[outside])
                    self.assertTrue(np.any(camera.pixel_array[~outside]!=base[~outside]))
                # The same clipping also applies when static and dynamic leaves
                # are captured together rather than from Manim's cached frame.
                camera.reset();camera.capture_mobjects([background,vector,header])
                np.testing.assert_array_equal(camera.pixel_array[outside],base[outside])

    def test_matches_standard_camera_on_reuse_rotation_fade_pixel_edit_and_clipping(self):
        rng=np.random.default_rng(23)
        with tempconfig({'pixel_width':640,'pixel_height':360,'frame_width':128/9,'frame_height':8}):
            reference,cached=Camera(),LessonCamera()
            images=[ImageMobject(rng.integers(0,256,size=(81,103,4),dtype=np.uint8)).scale(2).rotate(.22).shift([1.,.4,0.]),
                    ImageMobject(rng.integers(0,256,size=(111,136,4),dtype=np.uint8)).scale(2).shift([2.,0.,0.])]
            original_points=[obj.points.copy() for obj in images]
            for step in range(7):
                if step==2:images[0].shift([.05,.17,0.])
                if step==3:images[1].set_opacity(.31)
                if step==4:images[0].pixel_array[30:40,40:60]=[255,0,0,200]
                if step==5:images[0].shift([6.,-1.,0.])
                if step==6:images[1].set_opacity(0)
                before=[obj.points.copy() for obj in images]
                reference.reset();cached.reset()
                reference.capture_mobjects(images);cached.capture_mobjects(images)
                np.testing.assert_array_equal(cached.pixel_array,reference.pixel_array,err_msg='step '+str(step))
                for obj,points in zip(images,before):np.testing.assert_array_equal(obj.points,points)
            self.assertEqual(len(cached._lesson_raster_cache),len(images))


if __name__=='__main__':unittest.main()
