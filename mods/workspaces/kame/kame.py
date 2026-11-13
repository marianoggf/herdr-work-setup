"""Renders the Kamehameha loader for Herdr: a stick figure facing left, in a
wide stance with cupped hands at his hip, charging a ball of energy (a looping
animated WebP), and the same figure firing (a still PNG). Herdr draws the beam
itself, natively, from the firing hands across the tab title.

Usage: kame.py OUT_DIR [--sheet]
Writes kame-charge.webp / kame-fire.png (an orange figure) and one pair per
color in render.VARIANTS (the figure in that color; the energy stays blue), and
prints where the firing hands are, as fractions of the image, for loader.js.
"""
import math
import sys
from pathlib import Path

from PIL import Image, ImageDraw, ImageFilter

import render as R

FPS = 20
DUR = 2.0
N = int(FPS * DUR)

VX, VY, VS = 26, 80, 96   # world view: a 96-unit square, room above for the aura
HIP_X = 82
OUT = 96
SS = 4
W = OUT * SS
K = W / VS
FACING = -1               # the title is to his left

FIGURE = (255, 140, 26)   # an orange gi
GLOW = (64, 170, 255)
LIGHT = (150, 225, 255)
CORE = (255, 255, 255)

base = dict(lean=8, rot=0, fa1=40, fa2=100, ba1=20, ba2=120, fl1=25, fl2=-28, bl1=-22, bl2=-12)
CHARGE = dict(base, lean=-10, fa1=-65, fa2=70, ba1=-75, ba2=75, fl1=48, fl2=-58, bl1=-44, bl2=-8)
FIRE = dict(base, lean=14, fa1=90, fa2=2, ba1=86, ba2=4, fl1=50, fl2=-55, bl1=-46, bl2=-4)


def px(x, y):
    return ((x - VX) * K, (y - VY) * K)


def joints(p, dx=0.0):
    y = R.grounded_y(p)
    return {k: (HIP_X + dx + FACING * v[0], y + v[1]) for k, v in R.local_joints(p).items()}


def figure(dr, j, rgb, alpha=255, stroke=R.STROKE):
    col = rgb + (alpha,)
    w = stroke * K
    segs = [("hip", "neck"), ("sh", "belbow"), ("belbow", "bhand"), ("hip", "bknee"), ("bknee", "bfoot"),
            ("hip", "fknee"), ("fknee", "ffoot"), ("sh", "felbow"), ("felbow", "fhand")]
    for a, b in segs:
        A, B = px(*j[a]), px(*j[b])
        dr.line([A, B], fill=col, width=int(w))
        for P in (A, B):
            dr.ellipse([P[0] - w / 2, P[1] - w / 2, P[0] + w / 2, P[1] + w / 2], fill=col)
    hx, hy = px(*j["head"])
    r = (R.HEAD_R + (stroke - R.STROKE) / 2) * K
    dr.ellipse([hx - r, hy - r, hx + r, hy + r], fill=col)


def aura(img, j, strength):
    layer = Image.new("RGBA", (W, W), (0, 0, 0, 0))
    figure(ImageDraw.Draw(layer), j, GLOW, int(255 * strength), stroke=R.STROKE + 9)
    img.alpha_composite(layer.filter(ImageFilter.GaussianBlur(4 * SS)))


def ball(img, at, r):
    layer = Image.new("RGBA", (W, W), (0, 0, 0, 0))
    dr = ImageDraw.Draw(layer)
    cx, cy = px(*at)
    for scale, rgb, a in ((2.6, GLOW, 150), (1.6, LIGHT, 220)):
        rr = r * scale * K
        dr.ellipse([cx - rr, cy - rr, cx + rr, cy + rr], fill=rgb + (a,))
    img.alpha_composite(layer.filter(ImageFilter.GaussianBlur(2.2 * SS)))
    dr = ImageDraw.Draw(img)
    rr = r * 0.85 * K
    dr.ellipse([cx - rr, cy - rr, cx + rr, cy + rr], fill=CORE + (255,))


def mid(a, b):
    return ((a[0] + b[0]) / 2, (a[1] + b[1]) / 2)


# The charge builds in stages, by how long the agent has worked (loader.js
# picks one): the ball grows to its limit (stages 0-4), then a ki aura flares
# around him (5), then lightning crackles and rocks lift off the ground (6).
BALL = [1.4, 2.4, 3.4, 4.6, 6.0, 6.2, 6.6]
STAGES = len(BALL)


def ki(img, j, t, strength, ph):
    """Flames of ki licking up from the whole body, white at the core, blue outside."""
    pts = []
    segs = [("hip", "neck"), ("sh", "felbow"), ("felbow", "fhand"), ("sh", "belbow"), ("belbow", "bhand"),
            ("hip", "fknee"), ("fknee", "ffoot"), ("hip", "bknee"), ("bknee", "bfoot")]
    for a, b in segs:
        for u in (0.2, 0.6, 1.0):
            pts.append((j[a][0] + (j[b][0] - j[a][0]) * u, j[a][1] + (j[b][1] - j[a][1]) * u))
    pts.append(j["head"])
    outer = Image.new("RGBA", (W, W), (0, 0, 0, 0))
    inner = Image.new("RGBA", (W, W), (0, 0, 0, 0))
    do, di = ImageDraw.Draw(outer), ImageDraw.Draw(inner)
    for n, (x, y) in enumerate(pts):
        f = (t * 3.5 + n * 0.37) % 1                       # each tongue rises and dies
        h = (14 + 14 * math.sin(n * 2.1) ** 2) * strength * (0.55 + 0.6 * math.sin(math.pi * f))
        sway = 2.5 * math.sin(ph * 3 + n)
        wdt = 4.5 + 2.5 * math.sin(n * 1.3) ** 2
        tip = (x + sway, y - h - 6 * f)
        poly = [px(x - wdt, y + 2), px(x + wdt, y + 2), px(*tip)]
        do.polygon(poly, fill=GLOW + (int(255 * strength),))
        poly_in = [px(x - wdt * 0.5, y + 1), px(x + wdt * 0.5, y + 1), px(tip[0], tip[1] + h * 0.35)]
        di.polygon(poly_in, fill=(235, 248, 255, int(220 * strength)))
    glow = outer.filter(ImageFilter.GaussianBlur(1.4 * SS))
    img.alpha_composite(glow)
    img.alpha_composite(glow)
    img.alpha_composite(inner.filter(ImageFilter.GaussianBlur(0.8 * SS)))
    # sparks rising off him
    dr = ImageDraw.Draw(img)
    for n in range(10):
        p = (t / 0.9 + n / 10) % 1
        x = j["hip"][0] + 22 * math.sin(n * 2.7)
        y = j["ffoot"][1] - p * 80
        cx, cy = px(x + 2 * math.sin(ph * 2 + n), y)
        r = 0.9 * K
        dr.ellipse([cx - r, cy - r, cx + r, cy + r], fill=CORE + (int(230 * (1 - p)),))


def storm(img, j, i, t, ph):
    """Stage 6: lightning around him and rocks lifting off the ground."""
    dr = ImageDraw.Draw(img)
    for n in range(5):
        p = (t / 1.6 + n / 5) % 1
        x = j["hip"][0] + 30 * math.sin(n * 1.9 + 0.5)
        y = R.GROUND - p * 60
        cx, cy = px(x, y)
        s = (1.4 + n % 3 * 0.6) * K
        dr.polygon([(cx - s, cy), (cx, cy - s * 0.8), (cx + s, cy - s * 0.2), (cx + s * 0.4, cy + s * 0.7)],
                   fill=(150, 145, 140, int(255 * (1 - p ** 2))))
    if i % 5 in (0, 1):
        for n in range(2):
            ang = i * 0.9 + n * 2.6
            x, y = j["neck"][0] + 16 * math.cos(ang), j["neck"][1] + 20 * math.sin(ang)
            pts = [(x, y)]
            for k in range(4):
                x += 4 * math.cos(ang + 1.6) + (2.5 if k % 2 else -2.5)
                y += 4 * math.sin(ang + 1.6) + 3
                pts.append((x, y))
            dr.line([px(*q) for q in pts], fill=CORE + (240,), width=int(0.9 * K))
            dr.line([px(*q) for q in pts], fill=LIGHT + (120,), width=int(2.2 * K))


def charge_frame(i, rgb, stage=4):
    t = i / FPS
    ph = 2 * math.pi * t / DUR
    img = Image.new("RGBA", (W, W), (0, 0, 0, 0))
    j = joints(CHARGE, dx=(0.35 + 0.15 * stage) * math.sin(ph * 14))   # a tremble that grows
    hands = mid(j["fhand"], j["bhand"])
    at = (hands[0] + 4, hands[1] - 1)                          # in the palms, just behind him
    if stage >= 5:
        ki(img, j, t, 0.75 if stage == 5 else 1.0, ph)
    aura(img, j, 0.14 + 0.05 * stage + 0.1 * math.sin(ph * 6) + 0.05 * math.sin(ph * 17))
    if stage == 6:
        storm(img, j, i, t, ph)
    figure(ImageDraw.Draw(img), j, rgb)
    # energy drawn in: sparks spiralling into the palms
    dr = ImageDraw.Draw(img)
    for n in range(4 + 2 * min(stage, 4)):
        p = (t / 0.8 + n / 8) % 1
        ang = n * 2.4 + p * 3.2
        dist = 30 * (1 - p) + 3
        x, y = at[0] + dist * math.cos(ang), at[1] + dist * math.sin(ang) * 0.8
        cx, cy = px(x, y)
        r = (0.9 + 0.9 * p) * K
        dr.ellipse([cx - r, cy - r, cx + r, cy + r], fill=LIGHT + (int(80 + 175 * p),))
    r = BALL[stage]
    ball(img, at, r * (1 + 0.22 * math.sin(ph * 4)) + 0.3 * math.sin(ph * 22))
    # crackle
    for n in range(2):
        if (i + n * 7) % 9 < 2:
            ang = (i * 1.7 + n * 3.1)
            x0, y0 = px(at[0] + 4 * math.cos(ang), at[1] + 4 * math.sin(ang))
            x1, y1 = px(at[0] + 9 * math.cos(ang + 0.4), at[1] + 9 * math.sin(ang + 0.4))
            dr.line([(x0, y0), (x1, y1)], fill=CORE + (220,), width=int(0.9 * K))
    return img.resize((OUT, OUT), Image.LANCZOS)


def fire_frame(rgb):
    img = Image.new("RGBA", (W, W), (0, 0, 0, 0))
    j = joints(FIRE)
    hands = mid(j["fhand"], j["bhand"])
    aura(img, j, 0.5)
    figure(ImageDraw.Draw(img), j, rgb)
    ball(img, (hands[0] - 2, hands[1]), 5.5)
    return img.resize((OUT, OUT), Image.LANCZOS), hands


def write(out, suffix, rgb):
    for stage in range(STAGES):
        frames = [charge_frame(i, rgb, stage) for i in range(N)]
        frames[0].save(out / f"kame-charge{stage}{suffix}.webp", save_all=True, append_images=frames[1:],
                       duration=int(1000 / FPS), loop=0, lossless=False, quality=78, alpha_quality=80, method=6)
    fire, hands = fire_frame(rgb)
    fire.save(out / f"kame-fire{suffix}.png", optimize=True)
    return frames, fire, hands


def main():
    out = Path(sys.argv[1])
    out.mkdir(parents=True, exist_ok=True)
    frames, fire, hands = write(out, "", FIGURE)
    hx, hy = px(hands[0] - 2, hands[1])
    print(f"fire hands at x={hx / W:.3f} y={hy / W:.3f} of the image")
    if "--sheet" in sys.argv:
        picks = [charge_frame(i, FIGURE, s) for s in range(STAGES) for i in (0, 9)] + [fire]
        sheet = Image.new("RGBA", (len(picks) * OUT * 2, OUT * 2), (24, 26, 31, 255))
        for n, f in enumerate(picks):
            sheet.alpha_composite(f.resize((OUT * 2, OUT * 2)), (n * OUT * 2, 0))
        sheet.save(out / "kame-sheet.png")
        return
    for name, rgb in R.VARIANTS.items():
        write(out, f"-{name}", rgb)


if __name__ == "__main__":
    main()
