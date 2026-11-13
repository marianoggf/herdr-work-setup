"""The Kamehameha loader's other fighters (Custom settings > Loader > Characters).
Goku is the loader as it always was (kame.py, ssj.py, exit.py, in the chosen
color); the rest reuse every pose, timing, shot and exit of his, and change
only what they look like:

- Goku (with characters on): his orange gi with bare arms, blue wristbands, sash
  and boots; a plain skin-colored head and his spiky hair, black, golden when
  he powers up.
- Piccolo: a purple gi, green head and arms (short antennae), a light-blue sash
  and brown shoes; white ki, less of it than Goku.
- Vegeta: a blue suit with white gloves, boots and chest armour; a plain
  skin-colored head; his flame of
  hair with its widow's peak, black, golden when he powers up; Goku's ki, and a
  yellow Final Flash for a shot.
- Frieza: white, with a purple dome on his head, purple shoulders and shins, and
  a tail; purple ki and a purple shot.
- Krillin: Goku's orange, shorter than the rest (a fifth); a skin-colored head,
  bald (a shine); white ki, less of it than Piccolo.
- Trunks (as a boy): as short as Krillin; a dark green gi with bare arms, an
  orange belt and wristbands and golden boots; a plain skin-colored head under
  his lavender bowl cut, parted in the middle, which stands up golden (his
  father's flame, smaller) when he powers up; Goku's ki, less of it, and a
  yellow shot.
- Goten: as short as Krillin; Goku's orange gi over a dark blue long-sleeved
  undershirt, a blue sash, blue shin guards and dark shoes; a plain
  skin-colored head and his father's hair as a boy, black, golden when he
  powers up; Goku's ki, less of it.

Usage: cast.py small|big OUT_DIR NAME
  small: the charge stages 0-4 and the still firing pose
  big:   the ki stages 5-6, firing at those stages, and the exit (and its held
         version)
All on the canvas three times the slot (ssj.py's), centred on it: draw them so.
Run both for each fighter, into kame/cast/NAME/.
"""
import math
import sys
from pathlib import Path

from PIL import Image, ImageDraw

MODE, OUT, NAME = sys.argv[1], Path(sys.argv[2]), sys.argv[3]
OUT.mkdir(parents=True, exist_ok=True)

import kame as KM  # noqa: E402
import render as R  # noqa: E402

import ssj  # noqa: E402  (sets the 3x canvas: every stage of theirs is drawn on it, so hair has room)

if MODE == "big":
    import exit as EX  # noqa: E402

INK = (45, 28, 0)
BLUE = ((64, 170, 255), (150, 225, 255))
WHITE_KI = ((228, 234, 246), (172, 186, 214), (255, 255, 255))
PURPLE_KI = ((176, 84, 255), (122, 44, 204), (240, 222, 255))

SKIN = (255, 212, 168)
CAST = {
    "goku": dict(body=(255, 140, 26), energy=BLUE, ki=None, power=1.0, bolts=1.0, lightning=None, skin=True),
    "piccolo": dict(body=(92, 68, 172), energy=BLUE, ki=WHITE_KI, power=0.68, bolts=0.4, lightning=(200, 240, 255)),
    "vegeta": dict(body=(46, 74, 196), energy=((255, 196, 30), (255, 240, 150)), ki=None, power=1.0, bolts=1.0, lightning=None, skin=True),
    "frieza": dict(body=(238, 238, 246), energy=((176, 70, 255), (226, 176, 255)), ki=PURPLE_KI, power=1.0, bolts=1.0, lightning=(255, 130, 235)),
    "krillin": dict(body=(255, 140, 26), energy=BLUE, ki=WHITE_KI, power=0.45, bolts=0.0, lightning=None, skin=True, height=0.8),
    "trunks": dict(body=(40, 126, 90), energy=((255, 196, 30), (255, 240, 150)), ki=None, power=0.8, bolts=0.6, lightning=None, skin=True, height=0.8),
    "goten": dict(body=(255, 140, 26), energy=BLUE, ki=None, power=0.8, bolts=0.6, lightning=None, skin=True, height=0.8),
}
C = CAST[NAME]
POWERED = {"on": False}   # stages 5-6 and firing at them: transformed / serious


def px(x, y):
    return KM.px(x, y)


def lw(units):
    return max(1, int(units * KM.K))


def seg(j, a, b, u0, u1):
    A, B = j[a], j[b]
    return ((A[0] + (B[0] - A[0]) * u0, A[1] + (B[1] - A[1]) * u0), (A[0] + (B[0] - A[0]) * u1, A[1] + (B[1] - A[1]) * u1))


def thick(dr, p, q, rgb, alpha, width, ink=True):
    """A rounded stroke from p to q, `width` world units wide, ink-edged."""
    for col, w in (((INK, width + 1.6),) if ink else ()) + ((rgb, width),):
        P, Q = px(*p), px(*q)
        dr.line([P, Q], fill=col + (alpha,), width=lw(w))
        for X, Y in (P, Q):
            r = w * KM.K / 2
            dr.ellipse([X - r, Y - r, X + r, Y + r], fill=col + (alpha,))


def head_arc(j, r, a0, a1, cy=0.0, ry=None):
    hx, hy = j["head"]
    hr = R.HEAD_R
    ry = r if ry is None else ry
    back = -KM.FACING
    return [px(hx + hr * r * math.cos(math.radians(a)) * back, hy - hr * cy - hr * ry * math.sin(math.radians(a))) for a in range(a0, a1 + 1, 8)]


# -- hair, after ssj.spike: Vegeta's flame, upright, with a widow's peak --------
def spike(base, ang, length, width, bend, hx, hy, hr):
    back = -KM.FACING
    a = math.radians(ang)
    d = (math.sin(a) * back, -math.cos(a))
    n = (math.cos(a) * back, math.sin(a))
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
    return quad(left, c1, tip) + quad(tip, c2, right)[1:]


VEGETA_HAIR = [             # (base, angle from up (+ = toward his back), length, width, bend), in head radii
    ((0.75, 0.4), 46, 2.5, 2.0, 0.35),
    ((0.5, 0.7), 24, 3.6, 2.3, 0.35),
    ((0.15, 0.92), 8, 4.7, 2.6, 0.25),     # the tallest
    ((-0.25, 0.9), -6, 4.1, 2.4, 0.2),
    ((-0.6, 0.7), -18, 3.0, 2.0, 0.15),
]
PEAK = ((-0.62, 0.62), -158, 0.95, 1.15, 0.0)   # the widow's peak, down over the brow


def vegeta_hair(dr, j, alpha, fill, shade, edge=INK, scale=1.0, peak=True):
    hx, hy = j["head"]
    hr = R.HEAD_R
    for k, (base, ang, length, width, bend) in enumerate(VEGETA_HAIR):
        pts = spike(base, ang, length * scale, width * (0.5 + 0.5 * scale), bend * scale, hx, hy, hr)
        dr.polygon([px(*p) for p in pts], fill=(shade if k == 0 else fill) + (alpha,))
        dr.line([px(*p) for p in pts], fill=edge + (alpha,), width=lw(1.3 if KM.VS > 100 else 0.9), joint="curve")
    dr.polygon(head_arc(j, 1.04, 12, 168), fill=fill + (alpha,))
    if peak:
        pts = spike(*PEAK, hx, hy, hr)
        dr.polygon([px(*p) for p in pts], fill=fill + (alpha,))


# Goku's hair and Goten's, traced off Toriyama's drawing of Goku grown up beside
# himself as a boy (Goten's hair is that boy's): the outline of the whole black
# mass, in head radii round the middle of his head (x to the right, y up), from
# where it leaves his jaw on the left, over the top, to his jaw on the right.
# Grown up: one tall blade leaning left, four big spikes fanning out to the
# left, three thin ones straight out to the right. As a boy: the blade more
# upright, two spikes to the left, three to the right.
GOKU_HAIR = [
    (-0.77, -0.89), (-1.1, -0.85), (-1.36, -0.92), (-1.31, -0.86), (-1.04, -0.71), (-1.04, -0.68), (-1.09, -0.64), (-1.67, -0.6),
    (-1.94, -0.61), (-2.09, -0.64), (-2.09, -0.62), (-1.92, -0.46), (-1.68, -0.33), (-1.51, -0.28), (-1.43, -0.22), (-1.43, -0.19),
    (-1.9, 0.27), (-2.14, 0.45), (-2.31, 0.54), (-2.58, 0.54), (-2.59, 0.56), (-2.37, 0.78), (-2.09, 0.96), (-1.91, 1.02),
    (-1.76, 1.04), (-1.6, 0.99), (-1.57, 1.04), (-1.88, 1.55), (-2.12, 1.85), (-2.4, 1.96), (-2.6, 1.99), (-2.61, 2.01),
    (-2.48, 2.07), (-2.11, 2.16), (-1.87, 2.19), (-1.56, 2.19), (-1.4, 2.16), (-1.1, 1.98), (-0.8, 1.67), (-0.78, 1.69),
    (-0.78, 1.94), (-0.81, 2), (-0.91, 2.49), (-1.08, 2.79), (-1.37, 3.15), (-1.22, 3.14), (-0.84, 3), (-0.59, 2.87),
    (-0.47, 2.78), (-0.21, 2.49), (0, 2.16), (0.13, 1.84), (0.18, 1.56), (0.21, 1.52), (0.4, 1.54), (0.58, 1.49),
    (0.77, 1.4), (0.98, 1.18), (1.08, 0.96), (1.13, 0.94), (1.97, 0.94), (2.24, 0.91), (2.47, 0.87), (2.47, 0.85),
    (2.14, 0.76), (1.86, 0.64), (1.6, 0.49), (1.57, 0.42), (1.6, 0.39), (1.99, 0.34), (2.11, 0.29), (2.38, 0.25),
    (2.48, 0.2), (2.57, 0.2), (2.63, 0.18), (2.63, 0.16), (2.21, 0.05), (1.27, -0.31), (1.2, -0.39), (1.23, -0.44),
    (1.44, -0.51), (1.6, -0.53), (1.66, -0.55), (1.64, -0.56), (1.42, -0.58), (0.96, -0.71),
]
GOTEN_HAIR = [
    (-1.07, -0.28), (-1.26, -0.16), (-1.45, -0.1), (-1.42, -0.06), (-1.2, 0.01), (-1.16, 0.07), (-1.19, 0.13), (-1.42, 0.29),
    (-1.58, 0.37), (-1.96, 0.37), (-1.99, 0.39), (-2.08, 0.39), (-2.08, 0.44), (-1.89, 0.58), (-1.6, 0.75), (-1.44, 0.79),
    (-1.13, 0.79), (-1.04, 0.76), (-1, 0.82), (-1.08, 0.95), (-1.07, 1.08), (-1.25, 1.45), (-1.48, 1.84), (-1.73, 2.11),
    (-1.71, 2.15), (-1.48, 2.25), (-1.32, 2.28), (-0.75, 2.27), (-0.47, 2.15), (-0.38, 2.09), (-0.18, 1.86), (-0.13, 1.83),
    (-0.08, 1.84), (-0.12, 2.03), (-0.13, 2.32), (-0.19, 2.56), (-0.41, 3.03), (-0.08, 2.91), (0.1, 2.79), (0.39, 2.5),
    (0.54, 2.31), (0.67, 1.94), (0.76, 1.81), (0.76, 1.46), (0.82, 1.42), (1.04, 1.39), (1.18, 1.32), (1.3, 1.21),
    (1.43, 0.99), (1.55, 0.64), (1.8, 0.66), (1.9, 0.6), (2.18, 0.57), (2.79, 0.41), (2.79, 0.38), (2.1, 0.22),
    (2.04, 0.16), (2.12, 0.1), (2.66, -0.07), (2.77, -0.13), (2.82, -0.19), (2.19, -0.28), (2.1, -0.32), (1.52, -0.45),
    (1.49, -0.51), (1.53, -0.56), (1.82, -0.66), (1.84, -0.7), (1.27, -0.73),
]
# The hairline over his brow, right to left: three pointed locks, his forehead between them.
HAIRLINE = [(0.94, 0.34), (0.75, 0.6), (0.54, 0.38), (0.3, 0.62), (0, 0.2), (-0.33, 0.66), (-0.57, 0.38), (-0.75, 0.62), (-0.94, 0.34)]


def saiyan_hair(dr, j, alpha, outline):
    """Black, edged in grey round the outside so it reads on a dark background; his face is drawn back over it, under the hairline."""
    hx, hy = j["head"]
    hr = R.HEAD_R
    fill, edge = (30, 30, 38), (128, 134, 156)

    def at(x, y):
        return px(hx + x * hr, hy - y * hr)
    pts = [at(*p) for p in outline]
    dr.line(pts, fill=edge + (alpha,), width=lw(1.1 if KM.VS > 100 else 0.8) * 2, joint="curve")
    dr.polygon(pts, fill=fill + (alpha,))
    face = [at(math.cos(math.radians(a)), math.sin(math.radians(a))) for a in range(160, 381, 5)] + [at(*p) for p in HAIRLINE]
    dr.polygon(face, fill=SKIN + (alpha,))


# Trunks' hair as a boy, front-on like Goku's: a smooth bowl a little bigger than
# his head, parted in the middle, each half falling past his cheek to a point at
# his jaw, with a shorter lock inside it; his forehead shows in the parting. One
# half, in head radii (x out from the middle, y up); the other mirrors it.
TRUNKS_HAIR = ([(0.0, 1.12)] + [(1.15 * math.cos(math.radians(a)), 1.15 * math.sin(math.radians(a))) for a in range(80, -11, -10)]
               + [(1.26, -0.46), (0.98, -0.22), (0.86, 0.04), (0.58, -0.1), (0.42, 0.22), (0.0, 0.66)])


def trunks_hair(dr, j, alpha):
    """Lavender, edged in a deeper purple round the outside only, with a shine."""
    hx, hy = j["head"]
    hr = R.HEAD_R
    fill, edge = (190, 166, 238), (104, 84, 164)
    ew = lw(1.3 if KM.VS > 100 else 0.9)
    halves = [[px(hx + side * x * hr, hy - y * hr) for x, y in TRUNKS_HAIR] for side in (1, -1)]
    for pts in halves:
        dr.line(pts + [pts[0]], fill=edge + (alpha,), width=ew * 2, joint="curve")
    for pts in halves:
        dr.polygon(pts, fill=fill + (alpha,))
    dr.line(head_arc(j, 0.78, 100, 148, ry=0.8), fill=(232, 220, 255, alpha), width=lw(0.9))


# -- what each one wears -------------------------------------------------------
def behind(dr, j, alpha):
    if NAME == "frieza":
        hx, hy = j["hip"]
        back = -KM.FACING
        pts = []
        for k in range(13):   # out behind him and curling up
            u = k / 12
            pts.append((hx + back * 24 * u, hy + 18 * u - 30 * u ** 3))   # drooping to the ground, the tip flicking up
        for k in range(len(pts) - 1):
            w = 5.2 * (1 - k / len(pts)) + 1.6
            thick(dr, pts[k], pts[k + 1], C["body"], alpha, w, ink=True)
        for k in range(len(pts) - 1):   # the white over the ink, so the joins don't show
            w = 5.2 * (1 - k / len(pts)) + 1.6
            thick(dr, pts[k], pts[k + 1], C["body"], alpha, w, ink=False)


def front(dr, j, alpha):
    hx, hy = j["head"]
    hr = R.HEAD_R
    back = -KM.FACING
    if C.get("skin"):   # a plain head: skin, no face
        X, Y = px(hx, hy)
        r = R.HEAD_R * KM.K
        dr.ellipse([X - r, Y - r, X + r, Y + r], fill=SKIN + (alpha,))
    if NAME == "piccolo":   # green arms and head out of a purple gi, a sash, brown shoes, the antennae
        green = (86, 178, 64)
        for a, b in (("sh", "belbow"), ("sh", "felbow")):
            p, q = seg(j, a, b, 0.3, 1.0)
            thick(dr, p, q, green, alpha, R.STROKE, ink=False)
        for a, b in (("belbow", "bhand"), ("felbow", "fhand")):
            thick(dr, j[a], j[b], green, alpha, R.STROKE, ink=False)
        p, q = seg(j, "neck", "hip", 0.86, 0.98)
        thick(dr, p, q, (120, 176, 228), alpha, R.STROKE * 1.1, ink=False)
        for a, b in (("bknee", "bfoot"), ("fknee", "ffoot")):
            p, q = seg(j, a, b, 0.72, 1.0)
            thick(dr, p, q, (176, 92, 40), alpha, R.STROKE * 1.1, ink=False)
        X, Y = px(hx, hy)
        r = R.HEAD_R * KM.K
        dr.ellipse([X - r, Y - r, X + r, Y + r], fill=green + (alpha,))
        for (bx, by), (tx, ty) in (((-0.25, 0.85), (-0.7, 1.55)), ((0.15, 0.95), (-0.25, 1.7))):
            p, q = (hx + bx * hr * back, hy - by * hr), (hx + tx * hr * back, hy - ty * hr)
            thick(dr, p, q, green, alpha, 1.2, ink=False)
            thick(dr, q, q, green, alpha, 2.0, ink=False)
    elif NAME == "goku":   # his gi: bare arms, blue wristbands, sash and boots; black hair (golden powered up: ssj.hair)
        blue = (44, 78, 168)
        for a, b in (("sh", "belbow"), ("sh", "felbow")):
            p, q = seg(j, a, b, 0.35, 1.0)
            thick(dr, p, q, SKIN, alpha, R.STROKE * 0.95, ink=False)
        for a, b in (("belbow", "bhand"), ("felbow", "fhand")):
            thick(dr, j[a], j[b], SKIN, alpha, R.STROKE * 0.95, ink=False)
            p, q = seg(j, a, b, 0.62, 0.8)
            thick(dr, p, q, blue, alpha, R.STROKE * 1.1, ink=False)
        p, q = seg(j, "neck", "hip", 0.84, 0.98)
        thick(dr, p, q, blue, alpha, R.STROKE * 1.15, ink=False)
        for a, b in (("bknee", "bfoot"), ("fknee", "ffoot")):
            p, q = seg(j, a, b, 0.66, 1.0)
            thick(dr, p, q, blue, alpha, R.STROKE * 1.1, ink=False)
        if not POWERED["on"]:
            saiyan_hair(dr, j, alpha, GOKU_HAIR)
    elif NAME == "vegeta":
        for a, b in (("felbow", "fhand"), ("belbow", "bhand"), ("fknee", "ffoot"), ("bknee", "bfoot")):
            p, q = seg(j, a, b, 0.5, 1.0)   # gloves and boots
            thick(dr, p, q, (250, 250, 250), alpha, R.STROKE * 1.05)
        p, q = seg(j, "neck", "hip", 0.0, 0.55)   # chest armour
        thick(dr, p, q, (250, 250, 250), alpha, R.STROKE * 1.5)
        p, q = seg(j, "neck", "hip", 0.55, 0.72)  # its ochre belly guard
        thick(dr, p, q, (226, 178, 70), alpha, R.STROKE * 1.35)
        if POWERED["on"]:
            vegeta_hair(dr, j, alpha, ssj.YELLOW, ssj.GOLD)
        else:
            # black, but edged in grey so it reads on a dark background; shorter than the golden flame
            vegeta_hair(dr, j, alpha, (52, 54, 70), (36, 38, 50), edge=(128, 134, 156), scale=0.62)
    elif NAME == "frieza":
        purple = (132, 52, 196)
        dr.polygon(head_arc(j, 1.0, 12, 172, cy=-0.05), fill=purple + (alpha,))          # the dome
        dr.line(head_arc(j, 0.62, 70, 140, cy=0.05, ry=0.55), fill=(214, 170, 255, alpha), width=lw(0.9))   # its gloss
        sx, sy = j["sh"]
        r = R.STROKE * 0.62 * KM.K
        X, Y = px(sx, sy)
        dr.ellipse([X - r, Y - r, X + r, Y + r], fill=purple + (alpha,))
        for a, b in (("fknee", "ffoot"), ("bknee", "bfoot")):
            p, q = seg(j, a, b, 0.35, 0.8)
            thick(dr, p, q, purple, alpha, R.STROKE * 0.75, ink=False)
    elif NAME == "krillin":
        X, Y = px(hx + 0.32 * hr * back, hy - 0.5 * hr)        # the shine on his bald head
        r = 0.3 * hr * KM.K
        dr.ellipse([X - r, Y - r * 0.7, X + r, Y + r * 0.7], fill=(255, 236, 205, alpha))
    elif NAME == "trunks":   # a sleeveless green gi: bare arms, orange wristbands and belt, golden boots; lavender hair
        orange, gold = (250, 138, 30), (238, 192, 64)
        for a, b in (("sh", "belbow"), ("sh", "felbow")):
            p, q = seg(j, a, b, 0.35, 1.0)
            thick(dr, p, q, SKIN, alpha, R.STROKE * 0.95, ink=False)
        for a, b in (("belbow", "bhand"), ("felbow", "fhand")):
            thick(dr, j[a], j[b], SKIN, alpha, R.STROKE * 0.95, ink=False)
            p, q = seg(j, a, b, 0.62, 0.8)
            thick(dr, p, q, orange, alpha, R.STROKE * 1.1, ink=False)
        p, q = seg(j, "neck", "hip", 0.84, 0.98)
        thick(dr, p, q, orange, alpha, R.STROKE * 1.15, ink=False)
        for a, b in (("bknee", "bfoot"), ("fknee", "ffoot")):
            p, q = seg(j, a, b, 0.6, 1.0)
            thick(dr, p, q, gold, alpha, R.STROKE * 1.1, ink=False)
        if POWERED["on"]:
            vegeta_hair(dr, j, alpha, ssj.YELLOW, ssj.GOLD, scale=0.8, peak=False)
        else:
            trunks_hair(dr, j, alpha)
    elif NAME == "goten":   # Goku's gi over long dark blue sleeves, a blue sash, blue shin guards, dark shoes; his father's hair
        blue, shoe = (44, 78, 168), (58, 60, 80)
        for a, b in (("sh", "belbow"), ("sh", "felbow")):
            p, q = seg(j, a, b, 0.35, 1.0)
            thick(dr, p, q, blue, alpha, R.STROKE * 0.95, ink=False)
        for a, b in (("belbow", "bhand"), ("felbow", "fhand")):
            thick(dr, j[a], j[b], SKIN, alpha, R.STROKE * 0.95, ink=False)   # his hands
            p, q = seg(j, a, b, 0.0, 0.72)
            thick(dr, p, q, blue, alpha, R.STROKE * 0.95, ink=False)
        p, q = seg(j, "neck", "hip", 0.84, 0.98)
        thick(dr, p, q, blue, alpha, R.STROKE * 1.15, ink=False)
        for a, b in (("bknee", "bfoot"), ("fknee", "ffoot")):
            p, q = seg(j, a, b, 0.55, 1.0)
            thick(dr, p, q, shoe, alpha, R.STROKE * 1.1, ink=False)
            p, q = seg(j, a, b, 0.55, 0.82)
            thick(dr, p, q, blue, alpha, R.STROKE * 1.1, ink=False)
        if not POWERED["on"]:
            saiyan_hair(dr, j, alpha, GOTEN_HAIR)


_figure = KM.figure


def figure(dr, j, rgb, alpha=255, stroke=R.STROKE):
    if rgb != C["body"]:
        return _figure(dr, j, rgb, alpha, stroke)
    behind(dr, j, alpha)
    _figure(dr, j, rgb, alpha, stroke)
    front(dr, j, alpha)


KM.figure = figure

# Shorter: every joint pulled toward the ground under his hip (his head and
# limbs keep their thickness, so he reads stockier, as Krillin does).
if C.get("height"):
    _joints = KM.joints

    def joints(p, dx=0.0):
        j = _joints(p, dx)
        gx, gy = j["hip"][0], max(j["ffoot"][1], j["bfoot"][1]) + R.STROKE / 2
        h = C["height"]
        return {k: (gx + (x - gx) * h, gy + (y - gy) * h) for k, (x, y) in j.items()}
    KM.joints = joints
KM.GLOW, KM.LIGHT = C["energy"]


def save(frames, path, fps):
    frames[0].save(path, save_all=True, append_images=frames[1:], duration=int(1000 / fps), loop=0,
                   lossless=False, quality=80, alpha_quality=85, method=6)


if MODE == "small":
    for stage in range(5):
        save([KM.charge_frame(i, C["body"], stage) for i in range(KM.N)], OUT / f"kame-charge{stage}.webp", KM.FPS)
    fire, _ = KM.fire_frame(C["body"])
    fire.save(OUT / "kame-fire.png", optimize=True)
else:
    gold = (ssj.YELLOW, ssj.GOLD, ssj.PALE, ssj.CYAN)
    if C["ki"]:
        ssj.YELLOW, ssj.GOLD, ssj.PALE = C["ki"]
    if C["lightning"]:
        ssj.CYAN = C["lightning"]
    _aura, _bolts = ssj.aura, ssj.lightning
    ssj.aura = lambda img, j, rng, power: _aura(img, j, rng, power * C["power"])
    ssj.lightning = lambda img, j, rng, bolts: _bolts(img, j, rng, round(bolts * C["bolts"]))
    if NAME not in ("goku", "goten"):           # Goten's stands up like his father's
        ssj.hair = lambda img, j, rng: None     # their own hair (or none), drawn with the figure
    POWERED["on"] = True
    for stage in (5, 6):
        save([ssj.frame(i, C["body"], stage) for i in range(KM.N)], OUT / f"kame-charge{stage}.webp", KM.FPS)
        save([ssj.fire(i, C["body"], stage) for i in range(20)], OUT / f"kame-fire{stage}.webp", KM.FPS)
    # The exit: back to normal, in the same light as Goku's.
    POWERED["on"] = False
    ssj.YELLOW, ssj.GOLD, ssj.PALE, ssj.CYAN = gold
    rgb = C["body"]
    save([EX.frame(i, rgb) for i in range(EX.N)], OUT / "kame-exit.webp", EX.FPS)
    held = [EX.frame(i, rgb, hold=True) for i in range(int(EX.DOWN * EX.FPS) + 1)]
    held[-1] = EX.frame(int(EX.DOWN * EX.FPS), rgb, hold=True, rocks=False, loop=0)
    held[0].save(OUT / "kame-exit-hold.webp", save_all=True, append_images=held[1:],
                 duration=[int(1000 / EX.FPS)] * (len(held) - 1) + [4000], loop=0, lossless=False, quality=80, alpha_quality=85, method=6)
