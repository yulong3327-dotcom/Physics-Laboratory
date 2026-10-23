"""Build local WOFF2 subsets from the app's supplied font collection."""
import argparse
from pathlib import Path
from fontTools import subset

parser = argparse.ArgumentParser()
parser.add_argument("font_dir", type=Path)
args = parser.parse_args()
root = Path(__file__).resolve().parents[1]
text = (root / "index.html").read_text(encoding="utf-8")
for source in (root / "src").rglob("*"):
    if source.suffix in {".tsx", ".ts", ".json", ".css"}:
        text += source.read_text(encoding="utf-8")
unicodes = {ord(c) for c in text} | set(range(32, 256)) | set(range(0x370, 0x400)) | set(range(0x2200, 0x2300))
out = root / "public" / "fonts"
out.mkdir(parents=True, exist_ok=True)
fonts = {
    "方正兰亭圆简体.ttf": "lab-round.woff2",
    "方正兰亭圆简体_中.ttf": "lab-round-medium.woff2",
    "阿里妈妈数黑体.ttf": "lab-display.woff2",
    "STIXTwoText.ttf": "lab-text.woff2",
    "STIX Two Math.otf": "lab-math.woff2",
}
for original, target in fonts.items():
    options = subset.Options()
    options.flavor = "woff2"
    options.layout_features = ["*"]
    font = subset.load_font(str(args.font_dir / original), options)
    subsetter = subset.Subsetter(options=options)
    subsetter.populate(unicodes=unicodes)
    subsetter.subset(font)
    subset.save_font(font, str(out / target), options)
    print(f"{target}: {(out / target).stat().st_size:,} bytes")
