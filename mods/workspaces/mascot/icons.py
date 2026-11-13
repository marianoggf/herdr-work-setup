"""Renders the animated agent icons: one looping WebP per routine, framed like
the static mascot icon (20x20 sprite pixels, shown at 14 px in Herdr)."""
import sys
from pathlib import Path
import importlib.util

spec = importlib.util.spec_from_file_location("r", Path(__file__).with_name("render.py"))
src = Path(__file__).with_name("render.py").read_text().replace("\nmain()\n", "\n")
r = type(sys)("r"); exec(compile(src, "render.py", "exec"), r.__dict__)

r.GRID, r.X0, r.Y0, r.SCALE = 20, -3, -8, 4
# a smaller jump so it stays inside the icon's box
fps, frames = r.ROUTINES["jacks"]
frames[2]["dy"] = -2; frames[2]["lift"] = (2, 2, 2, 2)

out = Path(sys.argv[1]); out.mkdir(parents=True, exist_ok=True)
for name in r.ROUTINES:
    fps, frames = r.ROUTINES[name]
    step = round(1000 / fps)
    loop_ms = 4800 if name == "juggle" else step * len(frames) * (4 if len(frames) < 8 else 2)
    seq = []
    for k in range(loop_ms // step):
        t = k * step / 1000
        seq.append(r.draw(name, frames[k % len(frames)], t, blink=(k == len(frames) * 2 - 1)))
    seq[0].save(out / f"{name}.webp", save_all=True, append_images=seq[1:], duration=step, loop=0, lossless=True, disposal=2)
    print(name, len(seq), "frames")
from PIL import Image
sheet = Image.new("RGBA", (6 * 90, 90), (29, 31, 34, 255))
for i, name in enumerate(r.ROUTINES):
    im = Image.open(out / f"{name}.webp"); im.seek(2 if name != "wave" else 1)
    sheet.alpha_composite(im.convert("RGBA"), (i * 90 + 5, 5))
sheet.save(out / "sheet.png")
