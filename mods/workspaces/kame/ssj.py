"""The Kamehameha's ki stages, Super Saiyan style, in a hard-edged comic look:
golden spiky hair, an aura of sharp yellow-and-white shards blasting far
upward (in clusters of three, big, medium and small, re-drawn every other
frame so it boils), and at full power (stage 6) thick cyan lightning with
white cores crackling all round him, and rocks lifting off the ground. He fires
still transformed (kame-fire5/6); after the shot he's back to normal.

Drawn on a canvas three times the size of the other stages, with the figure at
the same scale in its middle, so the aura can leave the loader's square: draw
them at three times the slot's size, centred on it.

Usage: ssj.py OUT_DIR [suffix=rrggbb ...]   (no colors: just the orange default)
Writes kame-charge5/6{suffix}.webp, kame-fire5/6{suffix}.webp, and a still of each charge.
"""
import math
import random
import sys
from pathlib import Path

from PIL import Image, ImageDraw

import kame as KM
import render as R

# Three times the view, centred where the normal one is centred.
cx0, cy0 = KM.VX + KM.VS / 2, KM.VY + KM.VS / 2
KM.VS = KM.VS * 3
KM.VX, KM.VY = cx0 - KM.VS / 2, cy0 - KM.VS / 2
KM.OUT = KM.OUT * 3
KM.W = KM.OUT * KM.SS
KM.K = KM.W / KM.VS
px = KM.px

YELLOW = (255, 214, 10)
GOLD = (255, 168, 0)
PALE = (255, 252, 225)
INK = (45, 28, 0)
CYAN = (70, 225, 255)
WHITE = (255, 255, 255)


def shard(dr, base, h, w, lean, rgb, rng, alpha=255, outline=None):
    """A flame shard: a tall jagged spike from `base` up `h`, `w` wide at the base."""
    bx, by = base
    left, right = [], []
    steps = 4
    for k in range(steps + 1):
        u = k / steps
        half = w * (1 - u) ** 1.2
        jag = rng.uniform(-0.25, 0.25) * w * (1 - u)
        y = by - h * u
        x = bx + lean * u * u
        left.append(px(x - half + jag, y))
        right.append(px(x + half + jag, y))
    pts = left + right[::-1]
    dr.polygon(pts, fill=rgb + (alpha,), outline=outline)


def body_points(j):
    segs = [("hip", "neck"), ("sh", "felbow"), ("felbow", "fhand"), ("sh", "belbow"), ("belbow", "bhand"),
            ("hip", "fknee"), ("fknee", "ffoot"), ("hip", "bknee"), ("bknee", "bfoot")]
    pts = []
    for a, b in segs:
        for u in (0.0, 0.5, 1.0):
            pts.append((j[a][0] + (j[b][0] - j[a][0]) * u, j[a][1] + (j[b][1] - j[a][1]) * u))
    pts.append(j["head"])
    return pts


def aura(img, j, rng, power):
    dr = ImageDraw.Draw(img)
    cx = j["hip"][0]
    top = j["head"][1]
    bottom = j["ffoot"][1] + 4
    # The blaze: clusters of three shards (big, medium, small) rising from all
    # round him, tallest behind his head, the outer ones leaning out.
    clusters = int(9 * power) + 3
    for layer, rgb, scale in ((0, YELLOW, 1.0), (1, GOLD, 0.62), (2, PALE, 0.42)):
        for c in range(clusters):
            u = (c + rng.uniform(-0.3, 0.3)) / (clusters - 1) - 0.5        # -0.5 left .. 0.5 right
            bx = cx + u * 50 * power
            by = rng.uniform(top + 12, bottom - 4)
            tall = (1 - abs(u) * 1.1) * 95 * power * rng.uniform(0.75, 1.15) + (by - top) * 0.9
            for size in (1.0, 0.68, 0.42):
                h = tall * size * scale
                w = (8 + 5 * size) * scale * (0.8 + 0.4 * power)
                ox = rng.uniform(-6, 6) * size
                shard(dr, (bx + ox, by), h, w, u * 34 * power + rng.uniform(-5, 5), rgb, rng)
    # the white-hot core hugging his body
    core = [p for p in body_points(j) if p[1] < j["ffoot"][1] - 8]   # not round the feet
    for x, y in core:
        r = rng.uniform(5, 8) * KM.K
        X, Y = px(x, y)
        dr.ellipse([X - r, Y - r * 1.3, X + r, Y + r], fill=PALE + (255,))
    for x, y in core[::2]:
        shard(dr, (x, y + 3), rng.uniform(14, 26) * power, 4.5, rng.uniform(-6, 6), PALE, rng)


# Super Saiyan hair, after reference line art of the form: a tall upright mass
# of long, curved, leaf-shaped spikes (two curved edges meeting at a point),
# layered back to front, the biggest rising almost straight up, the mass
# narrow at the head and widest part-way up like a flame, and a lock of bangs
# over the brow. Seen side-on, as he faces left. Each spike: (base x, base y)
# on the head and length and width, in head radii (x toward his back, y up);
# angle in degrees from straight up, positive toward his back; bend at the tip.
SPIKES_BACK = [           # behind, in deeper gold
    ((0.75, 0.4), 112, 2.3, 2.0, 0.5),
    ((0.75, 0.5), 76, 3.1, 2.3, 0.6),
    ((0.5, 0.75), 44, 3.9, 2.5, 0.7),
]
SPIKES_MID = [            # the main mass
    ((0.25, 0.9), 22, 4.4, 2.7, 0.7),
    ((-0.05, 0.95), 3, 4.9, 2.8, 0.55),   # the tallest
    ((-0.4, 0.85), -16, 3.7, 2.3, 0.45),
]
SPIKES_FRONT = [          # over the brow, reaching forward and up
    ((-0.7, 0.6), -42, 2.6, 1.8, 0.35),
]
BANG = ((-0.72, 0.45), -160, 1.6, 0.85, -0.25)   # the lock falling over the forehead


def spike(base, ang, length, width, bend, back, hx, hy, hr, sway=0.0):
    """A curved leaf-shaped spike as a list of world points."""
    a = math.radians(ang + sway)
    d = (math.sin(a) * back, -math.cos(a))          # along the spike
    n = (math.cos(a) * back, math.sin(a))           # across it, toward his back side
    bx, by = hx + base[0] * hr * back, hy - base[1] * hr
    L, W = length * hr, width * hr
    left = (bx - n[0] * W / 2, by - n[1] * W / 2)
    right = (bx + n[0] * W / 2, by + n[1] * W / 2)
    tip = (bx + d[0] * L + n[0] * bend * hr, by + d[1] * L + n[1] * bend * hr)
    c1 = (bx + d[0] * L * 0.42 - n[0] * W * 0.42, by + d[1] * L * 0.42 - n[1] * W * 0.42)
    c2 = (bx + d[0] * L * 0.6 + n[0] * W * 0.35, by + d[1] * L * 0.6 + n[1] * W * 0.35)

    def quad(p0, c, p1, steps=10):
        return [((1 - u) ** 2 * p0[0] + 2 * (1 - u) * u * c[0] + u * u * p1[0],
                 (1 - u) ** 2 * p0[1] + 2 * (1 - u) * u * c[1] + u * u * p1[1]) for u in (k / steps for k in range(steps + 1))]
    return quad(left, c1, tip) + quad(tip, c2, right)[1:], tip, (bx, by), n


def hair(img, j, rng):
    """Super Saiyan hair: layered curved spikes, ink-outlined, stirring in the aura."""
    dr = ImageDraw.Draw(img)
    hx, hy = j["head"]
    back = -KM.FACING            # behind him is +x (he faces left)
    hr = R.HEAD_R
    ink = int(1.4 * KM.K)

    def draw(spec, fill, shade, glint=False):
        base, ang, length, width, bend = spec
        pts, tip, b, n = spike(base, ang, length * rng.uniform(0.97, 1.04), width, bend, back, hx, hy, hr, rng.uniform(-3, 3))
        dr.polygon([px(*p) for p in pts], fill=fill + (255,))
        # shade down the back half: a thinner leaf from the same base
        sh, _, _, _ = spike((base[0] + 0.18, base[1]), ang + 3, length * 0.8, width * 0.42, bend, back, hx, hy, hr)
        dr.polygon([px(*p) for p in sh], fill=shade + (255,))
        if glint:
            m = (b[0] + (tip[0] - b[0]) * 0.25 - n[0] * hr * 0.3, b[1] + (tip[1] - b[1]) * 0.25 - n[1] * hr * 0.3)
            e = (b[0] + (tip[0] - b[0]) * 0.62 - n[0] * hr * 0.15, b[1] + (tip[1] - b[1]) * 0.62 - n[1] * hr * 0.15)
            dr.line([px(*m), px(*e)], fill=(255, 252, 215, 255), width=int(1.0 * KM.K))
        dr.line([px(*p) for p in pts], fill=INK + (255,), width=ink, joint="curve")

    for spec in SPIKES_BACK:
        draw(spec, GOLD, (230, 125, 0))
    for k, spec in enumerate(SPIKES_MID):
        draw(spec, YELLOW, GOLD, glint=k < 2)
    for spec in SPIKES_FRONT:
        draw(spec, YELLOW, GOLD)
    # a cap over the top of the head where the spikes root
    cap = [px(hx + hr * 1.02 * math.cos(math.radians(a)) * back, hy - hr * 1.02 * math.sin(math.radians(a))) for a in range(-15, 200, 10)]
    dr.polygon(cap, fill=YELLOW + (255,))
    draw(BANG, YELLOW, GOLD)


def lightning(img, j, rng, bolts):
    """Cyan bolts with white cores, crackling through the aura."""
    dr = ImageDraw.Draw(img)
    cx, cy = j["hip"][0], (j["hip"][1] + j["head"][1]) / 2
    for _ in range(bolts):
        a = rng.uniform(0, 2 * math.pi)
        r = rng.uniform(14, 40)
        x, y = cx + r * math.cos(a), cy + r * math.sin(a) * 1.4 - 10
        heading = rng.uniform(0, 2 * math.pi)
        pts = [(x, y)]
        for k in range(rng.randint(5, 8)):
            heading += rng.uniform(-1.3, 1.3)
            step = rng.uniform(4, 8)
            x += step * math.cos(heading)
            y += step * math.sin(heading)
            pts.append((x, y))
        q = [px(*p) for p in pts]
        dr.line(q, fill=CYAN + (255,), width=int(2.6 * KM.K), joint="curve")
        dr.line(q, fill=WHITE + (255,), width=int(0.9 * KM.K), joint="curve")


def rocks(img, t, j):
    dr = ImageDraw.Draw(img)
    for n in range(8):
        p = (t / 1.6 + n / 8) % 1
        x = j["hip"][0] + 55 * math.sin(n * 1.9 + 0.5)
        y = R.GROUND - p * 120
        X, Y = px(x, y)
        s = (1.8 + n % 3 * 0.9) * KM.K
        dr.polygon([(X - s, Y), (X, Y - s * 0.8), (X + s, Y - s * 0.2), (X + s * 0.4, Y + s * 0.7)],
                   fill=(120, 110, 95, int(255 * (1 - p ** 2))), outline=INK + (255,))


def frame(i, rgb, stage):
    t = i / KM.FPS
    ph = 2 * math.pi * t / KM.DUR
    rng = random.Random(stage * 1000 + i // 2)   # the aura boils: new shapes every other frame
    img = Image.new("RGBA", (KM.W, KM.W), (0, 0, 0, 0))
    j = KM.joints(KM.CHARGE, dx=(0.5 + 0.25 * stage) * math.sin(ph * 14))
    power = 0.85 if stage == 5 else 1.25
    aura(img, j, rng, power)
    if stage == 6:
        rocks(img, t, j)
    KM.figure(ImageDraw.Draw(img), j, INK, stroke=R.STROKE + 2.6)   # a comic ink outline
    KM.figure(ImageDraw.Draw(img), j, rgb)
    hair(img, j, rng)
    hands = KM.mid(j["fhand"], j["bhand"])
    at = (hands[0] + 4, hands[1] - 1)
    r = KM.BALL[stage]
    KM.ball(img, at, r * (1 + 0.22 * math.sin(ph * 4)) + 0.3 * math.sin(ph * 22))
    lightning(img, j, rng, 1 if stage == 5 and i % 6 == 0 else (5 if stage == 6 else 0))
    return img.resize((KM.OUT, KM.OUT), Image.LANCZOS)


def fire(i, rgb, stage):
    """Firing, still transformed: the aura, the hair, the ball at his palms (and the lightning at full power)."""
    rng = random.Random(stage * 2000 + i // 2)
    img = Image.new("RGBA", (KM.W, KM.W), (0, 0, 0, 0))
    j = KM.joints(KM.FIRE)
    aura(img, j, rng, 0.85 if stage == 5 else 1.25)
    KM.figure(ImageDraw.Draw(img), j, INK, stroke=R.STROKE + 2.6)
    KM.figure(ImageDraw.Draw(img), j, rgb)
    hair(img, j, rng)
    hands = KM.mid(j["fhand"], j["bhand"])
    KM.ball(img, (hands[0] - 2, hands[1]), 5.5)
    if stage == 6:
        lightning(img, j, rng, 4)
    return img.resize((KM.OUT, KM.OUT), Image.LANCZOS)


def main():
    out = Path(sys.argv[1])
    out.mkdir(parents=True, exist_ok=True)
    colors = [("", KM.FIGURE)]
    for arg in sys.argv[2:]:
        name, hexv = arg.split("=")
        colors.append((name, tuple(int(hexv[k:k + 2], 16) for k in (0, 2, 4))))
    for suffix, rgb in colors:
        for stage in (5, 6):
            frames = [frame(i, rgb, stage) for i in range(KM.N)]
            frames[0].save(out / f"kame-charge{stage}{suffix}.webp", save_all=True, append_images=frames[1:],
                           duration=int(1000 / KM.FPS), loop=0, lossless=False, quality=80, alpha_quality=85, method=6)
            frames[8].save(out / f"still{stage}{suffix}.png")
            shots = [fire(i, rgb, stage) for i in range(20)]
            shots[0].save(out / f"kame-fire{stage}{suffix}.webp", save_all=True, append_images=shots[1:],
                          duration=int(1000 / KM.FPS), loop=0, lossless=False, quality=80, alpha_quality=85, method=6)
            if not suffix:
                shots[4].save(out / f"firestill{stage}.png")


if __name__ == "__main__":
    main()
