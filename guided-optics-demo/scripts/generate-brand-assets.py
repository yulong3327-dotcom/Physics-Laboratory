from pathlib import Path
from PIL import Image, ImageDraw, ImageFont

root = Path(__file__).resolve().parent.parent
scale = 2
size = 512 * scale
icon = Image.new('RGBA', (size, size), '#8252ef')
draw = ImageDraw.Draw(icon)
avatar = Image.open(root / 'public/guide-avatar.png').convert('RGBA')
# Remove only the connected white background, preserving eyes and teeth.
mask = Image.new('RGB', avatar.size)
mask.putdata([(255, 255, 255) if min(r, g, b) > 230 else (0, 0, 0) for r, g, b, _ in avatar.getdata()])
ImageDraw.floodfill(mask, (0, 0), (255, 0, 0))
ImageDraw.floodfill(mask, (255, 0), (255, 0, 0))
ImageDraw.floodfill(mask, (0, 255), (255, 0, 0))
ImageDraw.floodfill(mask, (255, 255), (255, 0, 0))
alpha = Image.new('L', avatar.size)
alpha.putdata([0 if color == (255, 0, 0) else 255 for color in mask.getdata()])
avatar.putalpha(alpha)
avatar = avatar.resize((354*scale, 354*scale), Image.Resampling.LANCZOS).rotate(8, resample=Image.Resampling.BICUBIC, expand=True)
icon.alpha_composite(avatar, (4*scale, 54*scale))
draw = ImageDraw.Draw(icon)
draw.rounded_rectangle((322*scale, 65*scale, 490*scale, 236*scale), radius=62*scale, fill='#f8efff')
draw.polygon([(344*scale, 210*scale), (328*scale, 260*scale), (392*scale, 222*scale)], fill='#f8efff')
latin = ImageFont.truetype('C:/Windows/Fonts/arialbd.ttf', 88*scale)
draw.text((405*scale, 155*scale), 'AI', fill='#8c54ee', font=latin, anchor='mm')
draw.ellipse((-160*scale, 373*scale, 720*scale, 1020*scale), fill='#ffffff')
font = ImageFont.truetype('D:/化学项目/阿里妈妈数黑体.ttf', 60*scale)
draw.text((256*scale, 445*scale), '精准学实验室', fill='#8152e8', font=font, anchor='mm')
icon = icon.resize((512, 512), Image.Resampling.LANCZOS)
icon.save(root / 'public/app-icon.png')
resources = root / 'android/app/src/main/res'
for density, pixels in [('mdpi',48),('hdpi',72),('xhdpi',96),('xxhdpi',144),('xxxhdpi',192)]:
    folder = resources / f'mipmap-{density}'
    resized = icon.resize((pixels,pixels), Image.Resampling.LANCZOS)
    resized.save(folder / 'ic_launcher.png')
    resized.save(folder / 'ic_launcher_round.png')
    foreground = Image.new('RGBA', (pixels*108//48, pixels*108//48))
    safe = pixels*66//48
    inset = (foreground.width-safe)//2
    foreground.alpha_composite(icon.resize((safe,safe),Image.Resampling.LANCZOS),(inset,inset))
    foreground.save(folder / 'ic_launcher_foreground.png')
print('Brand icon and Android launcher images generated.')
