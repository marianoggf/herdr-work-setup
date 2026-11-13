"""Renders the Mascot loader for Herdr as looping animated WebPs.

The pixel mascot (14x8 body, side arms, four legs) runs through six routines:
walk, juggle, jumping jacks, wave, dance and foot tap. Each output file plays
all six in a different shuffled order, so the loader picks one at random.

Usage: render.py OUT_DIR [--sheet]
"""
import random
import sys
from pathlib import Path

from PIL import Image

GRID = 24            # sprite pixels per side
X0, Y0 = -5, -9      # grid origin in sprite coordinates
SCALE = 4            # output 96 px
BODY_W, BODY_H, GROUND = 14, 8, 11
LEG_X = [1, 3, 10, 12]
ORANGE = (215, 119, 87, 255)
BALLS = [(255, 214, 170, 255), (247, 178, 140, 255), (255, 235, 210, 255)]
EYE = (20, 20, 20, 255)
ROUTINE_MS = 4000
VARIANTS = 4

ARMS = {
    "rest": (-2, 4, 2, 2), "hi": (-2, 3, 2, 2), "lo": (-2, 5, 2, 2),
    "up": (-2, -2, 2, 4), "flap": (-2, 1, 2, 2),
}


def F(**o):
    f = dict(dx=0, dy=0, armL="rest", armR="rest", lift=(0, 0, 0, 0), spread=0,
             eyeDx=0, eyeDy=0, wink=False)
    f.update(o)
    return f


ROUTINES = {
    "walk": (6, [F(lift=(1, 0, 1, 0), armL="hi", armR="lo", eyeDx=1), F(eyeDx=1),
                 F(lift=(0, 1, 0, 1), armL="lo", armR="hi", eyeDx=1), F(eyeDx=1)]),
    "jacks": (5, [F(), F(dy=1, armL="lo", armR="lo"),
                  F(dy=-3, lift=(3, 3, 3, 3), spread=1, armL="up", armR="up", eyeDy=-1),
                  F(dy=1, armL="lo", armR="lo")]),
    "wave": (5, [F(armR="up"), F(armR="flap"), F(armR="up"),
                 F(armR="flap", wink=True), F(armR="up", wink=True), F(armR="flap")]),
    "dance": (4, [F(dx=-1, armL="up", lift=(0, 0, 1, 0), eyeDx=-1), F(dy=1, armL="lo", armR="lo"),
                  F(dx=1, armR="up", lift=(0, 1, 0, 0), eyeDx=1), F(dy=1, armL="lo", armR="lo")]),
    "juggle": (8, [F(armL="hi", eyeDy=-1), F(eyeDy=-1), F(armR="hi", eyeDy=-1), F(eyeDy=-1)]),
    "tap": (4, [F(lift=(0, 0, 0, 1), eyeDx=-1), F(eyeDx=-1), F(lift=(0, 0, 0, 1), eyeDx=-1), F(eyeDx=-1),
                F(lift=(0, 0, 0, 1), eyeDx=1), F(eyeDx=1), F(lift=(0, 0, 0, 1), eyeDx=1), F(eyeDx=1, armR="hi")]),
}


def draw(name, f, t, blink):
    img = Image.new("RGBA", (GRID, GRID), (0, 0, 0, 0))
    px = img.load()

    def rect(x, y, w, h, c):
        for yy in range(y, y + h):
            for xx in range(x, x + w):
                gx, gy = xx - X0, yy - Y0
                if 0 <= gx < GRID and 0 <= gy < GRID:
                    px[gx, gy] = c

    dx, dy = f["dx"], f["dy"]
    for i, lx in enumerate(LEG_X):
        x = lx + dx + (-f["spread"] if i < 2 else f["spread"])
        top, bottom = BODY_H + dy, GROUND - f["lift"][i]
        rect(x, top, 1, max(1, bottom - top), ORANGE)
    ax, ay, aw, ah = ARMS[f["armL"]]
    rect(ax + dx, ay + dy, aw, ah, ORANGE)
    ax, ay, aw, ah = ARMS[f["armR"]]
    rect(BODY_W - ax - aw + dx, ay + dy, aw, ah, ORANGE)
    rect(dx, dy, BODY_W, BODY_H, ORANGE)
    for i, ex in enumerate((2, 11)):
        x, y = ex + dx + f["eyeDx"], 2 + dy + f["eyeDy"]
        if blink or (f["wink"] and i == 1):
            rect(x, y + 1, 1, 1, EYE)
        else:
            rect(x, y, 1, 2, EYE)

    if name == "juggle":
        for i, c in enumerate(BALLS):
            p = (t * 0.8 + i / 3) % 1
            if p < 0.62:
                g = p / 0.62
                x, y = -1.5 + 16 * g, 3 - 10 * 4 * g * (1 - g)
            else:
                g = (p - 0.62) / 0.38
                x, y = 14.5 - 16 * g, 3 - 2.5 * 4 * g * (1 - g)
            rect(round(x), round(y), 1, 1, c)
    return img.resize((GRID * SCALE, GRID * SCALE), Image.NEAREST)


def routine_frames(name, start_ms):
    fps, frames = ROUTINES[name]
    step = round(1000 / fps)
    out = []
    for k in range(ROUTINE_MS // step):
        t = (start_ms + k * step) / 1000
        blink = (k * step) % 3400 < step and k > 0
        out.append((draw(name, frames[k % len(frames)], t, blink), step))
    return out


def main():
    out_dir = Path(sys.argv[1])
    out_dir.mkdir(parents=True, exist_ok=True)
    rng = random.Random(7)
    names = list(ROUTINES)
    orders = []
    for v in range(VARIANTS):
        order = names[:]
        rng.shuffle(order)
        orders.append(order)
        seq, ms = [], 0
        for name in order:
            seq += routine_frames(name, ms)
            ms += ROUTINE_MS
        imgs, durs = zip(*seq)
        imgs[0].save(out_dir / f"mascot-{v}.webp", save_all=True, append_images=list(imgs[1:]),
                     duration=list(durs), loop=0, lossless=True, disposal=2)
        print(f"mascot-{v}.webp", " → ".join(order))
    if "--sheet" in sys.argv:
        cells = [routine_frames(n, 0) for n in names]
        cols = max(len(c) for c in cells[:1]) and 8
        sheet = Image.new("RGBA", (cols * 100, len(names) * 100), (29, 31, 34, 255))
        for r, frames in enumerate(cells):
            for c in range(cols):
                img = frames[c % len(frames)][0]
                sheet.alpha_composite(img, (c * 100 + 2, r * 100 + 2))
        sheet.save(out_dir / "sheet.png")


main()
