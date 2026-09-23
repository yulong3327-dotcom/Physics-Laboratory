"""Deterministic illustration framing shared by story previews and video frames."""
import math
from video_runtime import PipelineError

STORY_MOTIONS = ('still', 'zoom-in', 'pan-left', 'pan-right', 'fade-in')


def story_frame_transform(motion, seconds, duration):
    """Absolute design-pixel transform. Pans include overscan to prevent gaps."""
    if motion not in STORY_MOTIONS:
        raise ValueError('剧情镜头运动无效，请选择静止、推近、左移、右移或淡入')
    if not all(isinstance(value, (int, float)) and not isinstance(value, bool) and math.isfinite(value) for value in (seconds, duration)) or duration <= 0:
        raise ValueError('剧情镜头时间必须有限，且时长必须大于零')
    at = min(duration, max(0, seconds))
    progress = at / duration
    scale, x, opacity = 1.0, 0.0, 1.0
    if motion == 'zoom-in':
        scale += .08 * progress
    elif motion in ('pan-left', 'pan-right'):
        scale = 1.1
        x = (1 - 2 * progress) * 76.8 * (1 if motion == 'pan-left' else -1)
    elif motion == 'fade-in':
        opacity = min(1, at / min(.5, duration))
    return {'scale': scale, 'x': x, 'y': 0.0, 'opacity': opacity}


def story_image_pixels(shot):
    from circuit import inline_image
    story = shot.get('story')
    if not isinstance(story, dict):
        raise PipelineError('剧情镜头设置无效，请重新保存剧情内容', code='story_invalid', stage='static_preflight', shot_id=shot.get('id'))
    if story.get('motion') not in STORY_MOTIONS:
        raise PipelineError('剧情镜头运动无效，请重新选择镜头运动', code='story_motion_invalid', stage='static_preflight', shot_id=shot.get('id'))
    if not story.get('imageDataUrl'):
        raise PipelineError('剧情镜头缺少插图，请在分镜页上传或生成插图后重试', code='story_image_missing', stage='static_preflight', shot_id=shot.get('id'))
    try:
        return inline_image(story['imageDataUrl'])
    except Exception as error:
        raise PipelineError('剧情插图无法读取，请重新上传有效的 PNG、JPEG 或 WebP 图片：' + str(error),
                            code='story_image_invalid', stage='static_preflight', shot_id=shot.get('id')) from error


def apply_story_frame(image, base_points, motion, seconds, duration):
    """Apply from immutable base geometry, so seeking never accumulates drift."""
    transform = story_frame_transform(motion, seconds, duration)
    image.points = base_points * transform['scale']
    image.points[:, 0] += transform['x'] / 135
    image.points[:, 1] -= transform['y'] / 135
    image.set_opacity(transform['opacity'])
    return transform
