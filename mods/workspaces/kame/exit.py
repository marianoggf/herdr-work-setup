"""The Kamehameha's exit, played once after the beam: he stands up, flares a
quick golden ki (the ground cracking and pebbles lifting round his feet),
crouches, and blasts off straight up, breaking the ground where he stood (a
crater, chunks of rock flying out and falling, a burst of dust), leaving a
golden streak as he leaves the frame. Then the debris settles and fades and the
canvas goes empty, so a late hide never shows it start again.

Drawn on the same canvas as the ki stages (three times the slot, centred on it).

Usage: exit.py OUT_DIR [suffix=rrggbb ...]
Writes kame-exit{suffix}.webp and a contact sheet, exit-sheet.png.
"""
import math
import random
import sys
from pathlib import Path

from PIL import Image, ImageDraw

import ssj  # sets the 3x canvas on kame
import kame as KM
import render as R

px = KM.px
FPS = 30
DUR = 1.8
N = int(FPS * DUR)

base = dict(lean=8, rot=0, fa1=40, fa2=100, ba1=20, ba2=120, fl1=25, fl2=-28, bl1=-22, bl2=-12)
FIRE = KM.FIRE
STAND = dict(base, lean=0, fa1=-12, fa2=14, ba1=14, ba2=10, fl1=8, fl2=-4, bl1=-8, bl2=-4)
POWER = dict(base, lean=-6, fa1=-38, fa2=40, ba1=40, ba2=-40, fl1=22, fl2=-26, bl1=-22, bl2=-8)   # fists clenched, chest out
CROUCH = dict(base, lean=24, fa1=-50, fa2=20, ba1=-60, ba2=20, fl1=62, fl2=-115, bl1=20, bl2=-105)
FLY = dict(base, lean=-4, fa1=155, fa2=8, ba1=-35, ba2=25, fl1=4, fl2=-4, bl1=20, bl2=-70)       # a fist thrust up and forward, one knee bent

GROUND = R.GROUND
DIRT = (110, 92, 70)
DARK = (55, 45, 35)
DUST = (190, 175, 150)


def lerp(a, b, u):
    return {k: a[k] + (b[k] - a[k]) * u for k in a}


def ease(u):
    return u * u * (3 - 2 * u)


def state(t):
    """(pose, lift): the pose, and how far his feet are off the ground."""
    if t < 0.06:
        return lerp(FIRE, STAND, ease(t / 0.06)), 0
    if t < 0.1:
        return lerp(STAND, POWER, ease((t - 0.06) / 0.04)), 0
    if t < 0.24:
        return POWER, 0
    if t < 0.27:
        return lerp(POWER, CROUCH, ease((t - 0.24) / 0.03)), 0
    if t < LAUNCH:
        return lerp(CROUCH, FLY, ease((t - 0.27) / (LAUNCH - 0.27))), 0
    k = t - LAUNCH
    return FLY, 100 * k + 2200 * k * k    # accelerating hard, but on screen for ~8 frames


def figure_at(p, lift, tremble=0.0):
    j = KM.joints(p, dx=tremble)
    return {k: (v[0], v[1] - lift) for k, v in j.items()}


LAUNCH = 0.3
SETTLED = 1.05   # the dust has spread
DOWN = 1.75      # the last rock is down: only the crater and the dust are left


def chunks():
    rng = random.Random(7)
    out = []
    for n in range(22):
        ang = math.radians(rng.uniform(15, 165))
        speed = rng.uniform(120, 260)
        out.append((math.cos(ang) * speed, -math.sin(ang) * speed, rng.uniform(2.6, 5.2), rng.uniform(0, 6.28), rng.choice([DIRT, DARK, (140, 120, 95)])))
    return out


CHUNKS = chunks()


def crater(dr, t, fade):
    cx = KM.HIP_X
    a = int(255 * fade)
    rng = random.Random(3)
    # cracks running out across the ground
    for n in range(9):
        side = -1 if n % 2 else 1
        x, y = cx + side * rng.uniform(4, 10), GROUND
        pts = [(x, y)]
        for k in range(4):
            x += side * rng.uniform(5, 9)
            y += rng.uniform(-1.2, 1.2)
            pts.append((x, y))
        dr.line([px(*p) for p in pts], fill=ssj.INK + (a,), width=int(1.0 * KM.K))
    # the hole
    pts = []
    for k in range(20):
        ang = 2 * math.pi * k / 20
        r = 1 + rng.uniform(-0.18, 0.18)
        pts.append(px(cx + 20 * r * math.cos(ang), GROUND + 1 + 4.5 * r * math.sin(ang)))
    dr.polygon(pts, fill=DARK + (a,), outline=ssj.INK + (a,))
    # a broken rim of upturned earth, light enough to read on a dark background
    for k in range(10):
        ang = math.pi + math.pi * k / 9
        x, y = cx + 21 * math.cos(ang), GROUND + 1 + 4.5 * math.sin(ang)
        s = rng.uniform(2.2, 3.6)
        dr.polygon([px(x - s, y + 1), px(x + rng.uniform(-1, 1), y - s * 1.3), px(x + s, y + 1)], fill=(170, 150, 120, a), outline=ssj.INK + (a,))
    inner = [px(cx + 12 * math.cos(2 * math.pi * k / 16), GROUND + 2 + 2.6 * math.sin(2 * math.pi * k / 16)) for k in range(16)]
    dr.polygon(inner, fill=(30, 24, 20, a))


def frame(i, rgb, hold=False, loop=None, rocks=True, dust=1.0):
    """Frame i. `hold`: the dust stops spreading at SETTLED and nothing fades, so it
    ends on the crater and its dust once the rocks are down; `loop` (0-1) is where
    the crater dot's loop is: the dust rolls and wisps rise off it, and at 0 it is
    the held frame plus the wisps; `rocks`: False leaves the rocks out; `dust`
    (1 to 0) thins the dust and smoke out as it clears."""
    t = i / FPS
    img = Image.new("RGBA", (KM.W, KM.W), (0, 0, 0, 0))
    dr = ImageDraw.Draw(img)
    p, lift = state(t)
    tremble = 1.8 * math.sin(t * 160) if 0.08 <= t < 0.27 else 0.0
    j = figure_at(p, lift, tremble)
    rng = random.Random(500 + i // 2)
    gone = 0.0 if hold else max(0.0, min(1.0, (t - SETTLED) / 0.4))   # everything fades out at the end
    fade = 1 - gone

    # the ground: cracks start under the charge, the crater from the launch
    if 0.1 <= t < LAUNCH:
        u = (t - 0.1) / (LAUNCH - 0.1)
        r2 = random.Random(3)
        for n in range(int(9 * u)):
            side = -1 if n % 2 else 1
            x, y = KM.HIP_X + side * r2.uniform(4, 10), GROUND
            pts = [(x, y)]
            for k in range(4):
                x += side * r2.uniform(5, 9) * u
                y += r2.uniform(-1.2, 1.2)
                pts.append((x, y))
            dr.line([px(*q) for q in pts], fill=ssj.INK + (255,), width=int(1.0 * KM.K))
    if t >= LAUNCH and fade > 0:
        crater(dr, t, fade)

    # powering up, no ki: pebbles lifting round his feet as he trembles
    if 0.07 <= t < 0.42:
        # pebbles lifting round his feet
        for n in range(6):
            q = ((t - 0.07) / 0.2 + n / 6) % 1
            x = KM.HIP_X + 22 * math.sin(n * 2.3)
            X, Y = px(x, GROUND - q * 30)
            s = 1.3 * KM.K
            dr.ellipse([X - s, Y - s, X + s, Y + s], fill=DIRT + (int(255 * (1 - q)),))

    # the streak he leaves going up
    if t >= LAUNCH and lift > 0:
        top = j["hip"][1] + 6
        streak = max(0.0, 1 - (t - 0.6) / 0.3)
        if streak > 0:
            w = 12 * streak
            pts = [px(KM.HIP_X - w, GROUND), px(KM.HIP_X - 3, top), px(KM.HIP_X + 3, top), px(KM.HIP_X + w, GROUND)]
            dr.polygon(pts, fill=(235, 238, 245, int(150 * streak)))
            dr.line([px(KM.HIP_X, GROUND), px(KM.HIP_X, top)], fill=ssj.PALE + (int(255 * streak),), width=int(2.4 * KM.K * streak + 1))

    # speed lines and afterimages as he rockets up
    if LAUNCH <= t < LAUNCH + 0.3:
        u = (t - LAUNCH) / 0.3
        lr = random.Random(900 + i)
        for n in range(12):
            x = KM.HIP_X + lr.uniform(-34, 34)
            y0 = lr.uniform(KM.VY, GROUND - 20)
            dr.line([px(x, y0), px(x, min(GROUND - 2, y0 + lr.uniform(40, 110)))], fill=ssj.PALE + (int(220 * (1 - u)),), width=int(lr.uniform(0.6, 1.6) * KM.K))
        for back, alpha in ((1.0 / FPS, 150), (2.0 / FPS, 95), (3.0 / FPS, 50)):
            pb, lb = state(t - back)
            if lb > 0:
                ghost = Image.new("RGBA", img.size, (0, 0, 0, 0))
                KM.figure(ImageDraw.Draw(ghost), figure_at(pb, lb), rgb, stroke=R.STROKE + 2)
                ghost.putalpha(ghost.getchannel("A").point(lambda v: v * alpha // 255))
                img.alpha_composite(ghost)
    # him (gone once he's well above the frame)
    if j["head"][1] > KM.VY - 40:
        KM.figure(ImageDraw.Draw(img), j, ssj.INK, stroke=R.STROKE + 2.6)
        KM.figure(ImageDraw.Draw(img), j, rgb)
    dr = ImageDraw.Draw(img)

    # the launch: a white flash, a shockwave along the ground, dust, rocks flying
    if LAUNCH <= t < LAUNCH + 0.3:
        u = (t - LAUNCH) / 0.3
        X, Y = px(KM.HIP_X, GROUND)
        for ring, (size, width) in enumerate(((70, 3.0), (45, 2.0))):
            uu = max(0.0, u - ring * 0.15) / (1 - ring * 0.15)
            r = (10 + size * uu) * KM.K
            dr.ellipse([X - r, Y - r * 0.28, X + r, Y + r * 0.28], outline=ssj.PALE + (int(255 * (1 - uu)),), width=int(width * KM.K))
        if u < 0.35:
            f = 30 * KM.K * (1 - u)
            dr.ellipse([X - f, Y - f, X + f, Y + f * 0.4], fill=(255, 255, 240, int(230 * (1 - u / 0.35))))
    if t >= LAUNCH and fade > 0:
        k = (min(t, SETTLED) if hold else t) - LAUNCH
        for n in range(10):  # dust billowing out low
            side = -1 if n % 2 else 1
            x = KM.HIP_X + side * (6 + n * 2.2 + 30 * (1 - math.exp(-3 * k)))
            y = GROUND - 3 - (n % 3) * 3 - 6 * (1 - math.exp(-2 * k))
            grow = 0.0
            if loop is not None:   # each clump rolls on its own: drifts, lifts and swells, back where it began
                roll = lambda f, ph: math.sin(2 * math.pi * f * loop + ph) - math.sin(ph)
                x += side * 1.4 * roll(1, n * 1.1)
                y += 1.1 * roll(1, n * 2.3 + 1)
                grow = 1.3 * roll(2, n * 0.9)
            X, Y = px(x, y)
            r = (3 + n % 4 + 6 * (1 - math.exp(-2 * k)) + grow) * KM.K
            dr.ellipse([X - r, Y - r, X + r, Y + r], fill=DUST + (int(170 * fade * dust * math.exp(-1.2 * k)),))
        if loop is not None:
            smoke(dr, loop, int(170 * fade * dust * math.exp(-1.2 * k)))
        k = t - LAUNCH
        for vx, vy, s, rot, col in CHUNKS if rocks else []:  # rocks flung out, falling back
            x = KM.HIP_X + vx * k * 1.6
            y = GROUND - 2 + vy * k * 1.6 + 300 * k * k
            if y > GROUND + 2:
                continue
            X, Y = px(x, y)
            S = s * KM.K
            a = rot + k * 9
            poly = [(X + S * math.cos(a + q * 2.1), Y + S * 0.8 * math.sin(a + q * 2.1)) for q in range(3)]
            dr.polygon(poly, fill=col + (int(255 * fade),), outline=ssj.INK + (int(255 * fade),))
    if LAUNCH <= t < LAUNCH + 1.0 / FPS:   # one white impact frame
        flash = Image.new("RGBA", img.size, (255, 255, 240, 0))
        d2 = ImageDraw.Draw(flash)
        X, Y = px(KM.HIP_X, GROUND - 30)
        r = 70 * KM.K
        d2.ellipse([X - r, Y - r, X + r, Y + r], fill=(255, 255, 240, 200))
        img.alpha_composite(flash)
    if 0.09 <= t < LAUNCH + 0.25:   # the whole frame shakes
        amp = 5 if t >= LAUNCH else 2
        shaken = Image.new("RGBA", img.size, (0, 0, 0, 0))
        shaken.alpha_composite(img, (int(random.Random(i).uniform(-amp, amp) * KM.K), int(random.Random(i + 99).uniform(-amp, amp) * KM.K)))
        img = shaken
    return img.resize((KM.OUT, KM.OUT), Image.LANCZOS)


# The crater dot's smoke: puffs born inside the dust clouds and the crater (in
# the dust's own color and opacity, so each one grows out of where it starts),
# rising, swelling, breaking up and fading. They're let out one after another
# in the first part of the loop and all gone before it ends, so the loop starts
# with nothing in the air: the exit's held last frame, without a seam.
SMOKE_FROM = {"left": (-42, GROUND - 11, -1, 4.5), "right": (42, GROUND - 11, 1, 4.5), "crater": (0, GROUND + 1, 0, 3.2)}
SMOKE_PUFFS = [("crater", 0.0), ("left", 0.06), ("right", 0.12), ("crater", 0.2), ("left", 0.27), ("right", 0.33), ("crater", 0.4)]
SMOKE_LIFE = 0.56   # of the loop


def smoke(dr, loop, alpha0):
    for where, birth in SMOKE_PUFFS:
        q = (loop - birth) / SMOKE_LIFE
        if not 0 <= q < 1:
            continue
        x0, y0, dx, r0 = SMOKE_FROM[where]
        cx = KM.HIP_X + x0 + dx * 9 * q + 2.5 * math.sin(2 * math.pi * q + birth * 10) * q
        cy = y0 - 58 * (1 - (1 - q) ** 1.5)          # quick out, slowing as it thins
        alpha = int(alpha0 * (1 - q) ** 1.3)
        spread = 7 * q * q                            # one puff, then pieces drifting apart
        for piece in range(3):
            ang = piece * 2.1 + birth * 7
            X, Y = px(cx + spread * math.cos(ang), cy + spread * 0.6 * math.sin(ang))
            r = (r0 + 5.5 * q) * (1 - 0.3 * q) * (0.8 + 0.2 * (piece == 0)) * KM.K
            dr.ellipse([X - r, Y - r, X + r, Y + r], fill=DUST + (alpha,))


CLEAR = 10.0   # s for the dust and smoke to clear
SMOKE_LOOP = 4.0


def crater_dot(out):
    """The Crater finished dot: from the exit's held last frame (the crater and
    its dust, same canvas, same place), the dust rolls and puffs of smoke rise
    off it, all of it slowly thinning out over CLEAR seconds until only the
    crater is left, held (crater.webp). crater-still.png is that crater alone,
    for a dot that finished long ago."""
    step = 0.05
    n = int(CLEAR / step) + 1
    frames = []
    for k in range(n):
        tau = k * step
        u = min(1.0, tau / CLEAR)
        frames.append(frame(int(DOWN * FPS), KM.FIGURE, hold=True, rocks=False, loop=(tau / SMOKE_LOOP) % 1,
                            dust=1 - u * u * (3 - 2 * u)))
    frames[0].save(out / "crater.webp", save_all=True, append_images=frames[1:],
                   duration=[int(step * 1000)] * (n - 1) + [16_000_000], loop=0, lossless=False, quality=80, alpha_quality=85, method=6)
    frames[-1].save(out / "crater-still.png", optimize=True)


def main():
    out = Path(sys.argv[1])
    out.mkdir(parents=True, exist_ok=True)
    colors = [("", KM.FIGURE)]
    for arg in sys.argv[2:]:
        name, hexv = arg.split("=")
        colors.append((name, tuple(int(hexv[k:k + 2], 16) for k in (0, 2, 4))))
    crater_dot(out)
    for suffix, rgb in colors:
        frames = [frame(i, rgb) for i in range(N)]
        frames[0].save(out / f"kame-exit{suffix}.webp", save_all=True, append_images=frames[1:],
                       duration=int(1000 / FPS), loop=0, lossless=False, quality=80, alpha_quality=85, method=6)
        # For the Crater finished dot: the same, but it ends on the settled crater, held, so the dot takes over unseen.
        held = [frame(i, rgb, hold=True) for i in range(int(DOWN * FPS) + 1)]
        held[-1] = frame(int(DOWN * FPS), rgb, hold=True, rocks=False, loop=0)   # the crater dot's first frame
        held[0].save(out / f"kame-exit-hold{suffix}.webp", save_all=True, append_images=held[1:],
                     duration=[int(1000 / FPS)] * (len(held) - 1) + [4000], loop=0, lossless=False, quality=80, alpha_quality=85, method=6)
        if not suffix:
            picks = frames[0:22]
            w = KM.OUT // 2
            sheet = Image.new("RGBA", (11 * w, 2 * w), (24, 26, 31, 255))
            for n, f in enumerate(picks):
                sheet.alpha_composite(f.resize((w, w)), ((n % 11) * w, (n // 11) * w))
            sheet.save(out / "exit-sheet.png")


if __name__ == "__main__":
    main()
