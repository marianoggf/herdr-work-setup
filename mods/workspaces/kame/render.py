"""Renders the Stick Fight loader for Herdr as looping animated WebPs.

Two stick figures (left: red, right: blue) trade an even 8-second fight:
jab into a block, a sway, an uppercut dodged Matrix-style, a roundhouse ducked,
a leg sweep jumped, a flying kick dodged with a backflip, a flying kick blocked,
a double cross-counter, a body shot answered by a head kick, a mid-air kick
clash, then both reset to where they started so the loop is seamless.

Usage: render.py OUT_DIR [--sheet]
Writes stickfight.webp (each fighter in its own color) and one mono variant per
color in VARIANTS, plus sheet.png (a contact sheet) with --sheet.
"""
import math
import sys
from pathlib import Path

from PIL import Image, ImageDraw

FPS = 20
DUR = 11.0
N = int(FPS * DUR)

# World: a 124-unit square starting at (38, 50); the ground is at y=168.
VX, VY, VS = 38, 50, 124
GROUND = 168
OUT = 96            # output pixels (the loader shows at 20-40 px, 2x on retina)
SS = 4              # supersampling
W = OUT * SS
K = W / VS

THIGH, SHIN, TORSO, UARM, FARM = 18, 18, 22, 13, 13
HEAD_R, NECK_GAP = 7.5, 1.5
STROKE = 6.5

RED, BLUE, SPARK, NEUTRAL = (255, 84, 72), (72, 156, 255), (255, 196, 64), (139, 141, 147)

# Mono variants: the colors Custom settings > Loaders offers (white, grey and its swatches).
VARIANTS = {
    "white": (255, 255, 255),
    "grey": (139, 141, 147),
    "ff3d00": (0xff, 0x3d, 0x00), "f5a524": (0xf5, 0xa5, 0x24), "e3c07b": (0xe3, 0xc0, 0x7b),
    "3fae6a": (0x3f, 0xae, 0x6a), "22a99a": (0x22, 0xa9, 0x9a), "5b8def": (0x5b, 0x8d, 0xef),
    "8b7cf6": (0x8b, 0x7c, 0xf6), "d9649a": (0xd9, 0x64, 0x9a),
}

# ---------------------------------------------------------------- poses
# Local frame, facing right. Angles in degrees from straight down; positive
# turns toward the facing direction (90 = forward, 180 = up, -90 = back).
# fa/ba: front/back arm (upper, forearm relative); fl/bl: front/back leg.
# lean tips the torso forward; rot turns the whole body (flips).
P = {}
def pose(name, **kw):
    base = dict(lean=8, rot=0, fa1=40, fa2=100, ba1=20, ba2=120, fl1=25, fl2=-28, bl1=-22, bl2=-12)
    base.update(kw)
    P[name] = base

pose("stance")
# Blue stands taller with its hands low (a kicker's guard), so the two never match.
pose("stance_b", lean=4, fa1=28, fa2=115, ba1=8, ba2=105, fl1=28, fl2=-20, bl1=-26, bl2=-8)
pose("stance_b2", lean=2, fa1=34, fa2=108, ba1=14, ba2=100, fl1=30, fl2=-30, bl1=-22, bl2=-18)
pose("taunt", lean=0, fa1=100, fa2=70, ba1=8, ba2=105, fl1=28, fl2=-20, bl1=-26, bl2=-8)
pose("taunt2", lean=0, fa1=95, fa2=115, ba1=8, ba2=105, fl1=28, fl2=-22, bl1=-26, bl2=-10)
pose("stance2", lean=11, fa1=46, ba1=26, fl1=32, fl2=-46, bl1=-16, bl2=-30)
pose("jab", lean=16, fa1=92, fa2=4, ba1=22, ba2=125, fl1=38, fl2=-35, bl1=-32, bl2=-4)
pose("cross", lean=22, fa1=30, fa2=115, ba1=92, ba2=4, fl1=36, fl2=-38, bl1=-34, bl2=-2)
pose("jab_low", lean=34, fa1=75, fa2=4, ba1=20, ba2=125, fl1=50, fl2=-70, bl1=-40, bl2=0)
pose("block", lean=-4, fa1=70, fa2=100, ba1=55, ba2=115, fl1=22, fl2=-30, bl1=-26, bl2=-10)
pose("slideblock", lean=10, fa1=70, fa2=100, ba1=55, ba2=115, fl1=42, fl2=-55, bl1=-42, bl2=-6)
pose("sway", lean=-25, fa1=30, fa2=110, ba1=0, ba2=120, fl1=30, fl2=-20, bl1=-24, bl2=-30)
pose("uppercut", lean=-4, fa1=30, fa2=110, ba1=70, ba2=100, fl1=18, fl2=-8, bl1=-20, bl2=-2)
pose("leanback", lean=-50, fa1=-50, fa2=30, ba1=-70, ba2=20, fl1=45, fl2=-95, bl1=5, bl2=-70)
pose("chamber", lean=-5, fa1=50, fa2=90, ba1=-20, ba2=60, fl1=95, fl2=-120, bl1=-5, bl2=-5)
pose("roundhouse", lean=-28, fa1=50, fa2=70, ba1=-60, ba2=40, fl1=125, fl2=-2, bl1=-8, bl2=-2)
pose("duck", lean=35, fa1=45, fa2=115, ba1=30, ba2=125, fl1=75, fl2=-130, bl1=-15, bl2=-115)
pose("crouch", lean=25, fa1=-30, fa2=30, ba1=-45, ba2=30, fl1=60, fl2=-110, bl1=30, bl2=-110)
pose("sweep_in", lean=40, fa1=15, fa2=10, ba1=-10, ba2=10, fl1=30, fl2=-20, bl1=35, bl2=-150)
pose("sweep", lean=45, fa1=15, fa2=10, ba1=-10, ba2=10, fl1=80, fl2=-2, bl1=35, bl2=-150)
pose("tuck", lean=5, fa1=110, fa2=70, ba1=90, ba2=80, fl1=85, fl2=-130, bl1=50, bl2=-120)
pose("flykick", lean=-22, fa1=60, fa2=40, ba1=-45, ba2=75, fl1=98, fl2=-2, bl1=30, bl2=-120)
pose("airkick", lean=-18, fa1=60, fa2=40, ba1=-40, ba2=60, fl1=105, fl2=-60, bl1=30, bl2=-120)
pose("land", lean=25, fa1=45, fa2=40, ba1=-15, ba2=60, fl1=55, fl2=-95, bl1=10, bl2=-100)
pose("hit_head", lean=-35, fa1=-20, fa2=40, ba1=-40, ba2=50, fl1=30, fl2=-20, bl1=-25, bl2=-30)
pose("hit_body", lean=45, fa1=25, fa2=80, ba1=15, ba2=90, fl1=30, fl2=-45, bl1=-30, bl2=-15)
pose("stagger", lean=-20, fa1=10, fa2=60, ba1=-40, ba2=50, fl1=30, fl2=-10, bl1=-35, bl2=-25)


def d(a):
    r = math.radians(a)
    return math.sin(r), math.cos(r)


def local_joints(p):
    """Joint positions in the local frame (hip at the origin, facing +x)."""
    R = p["rot"]
    def at(o, ang, L):
        s, c = d(ang)
        return (o[0] + L * s, o[1] + L * c)
    hip = (0.0, 0.0)
    tor = 180 - p["lean"] + R
    neck = at(hip, tor, TORSO)
    sh = at(hip, tor, TORSO - 2)
    head = at(hip, tor, TORSO + NECK_GAP + HEAD_R)
    j = dict(hip=hip, neck=neck, head=head, sh=sh)
    for side in ("f", "b"):
        a1, a2 = p[side + "a1"], p[side + "a2"]
        l1, l2 = p[side + "l1"], p[side + "l2"]
        j[side + "elbow"] = at(sh, a1 + R, UARM)
        j[side + "hand"] = at(j[side + "elbow"], a1 + a2 + R, FARM)
        j[side + "knee"] = at(hip, l1 + R, THIGH)
        j[side + "foot"] = at(j[side + "knee"], l1 + l2 + R, SHIN)
    return j


def grounded_y(p):
    j = local_joints(p)
    low = max(v[1] for k, v in j.items() if k not in ("head", "neck"))
    return GROUND - STROKE / 2 - low


# ---------------------------------------------------------------- timeline
def key(t, name, x, y=None, ease="io", **over):
    p = dict(P[name])
    p.update(over)
    return dict(t=t, p=p, x=x, y=y, ease=ease)

A = [  # left fighter, facing right: a quick-bouncing boxer
    key(0.00, "stance", 72), key(0.22, "stance2", 73), key(0.44, "stance", 75), key(0.62, "stance2", 76),
    key(0.95, "jab", 79, ease="out"),                       # jab into the block
    key(1.10, "stance", 76),
    key(1.25, "cross", 82, ease="out"),                     # cross, swayed
    key(1.42, "stance", 79),
    key(1.62, "leanback", 81, ease="out"),                  # Matrix under the uppercut
    key(1.85, "stance", 77),
    key(2.05, "chamber", 74),
    key(2.20, "roundhouse", 74, ease="out"),                # roundhouse over the duck
    key(2.38, "stance2", 74),
    key(2.50, "crouch", 75),
    key(2.62, "tuck", 77, 112, ease="out"),                 # jump the sweep
    key(2.76, "tuck", 82, 102),
    key(2.95, "flykick", 88, 116, ease="in"),               # dive kick, dodged by the backflip
    key(3.10, "flykick", 90, 132),
    key(3.22, "land", 94),
    key(3.42, "stance", 93),
    key(3.58, "stance2", 90),
    key(3.75, "block", 88),
    key(3.85, "block", 88),                                 # takes the flying kick on the guard
    key(4.02, "slideblock", 78, ease="out"),
    key(4.22, "stance", 78),
    key(4.40, "stance2", 79),
    key(4.55, "stance", 80),
    key(4.68, "hit_body", 73, ease="out"),                  # eats the body jab
    key(4.95, "stance2", 75),
    key(5.12, "stance", 77),
    key(5.34, "jab_low", 89.5, ease="out"),                 # body shot lands
    key(5.52, "stance", 85),
    key(5.70, "stance2", 87),
    key(5.84, "stance", 88),
    key(5.98, "hit_head", 78, ease="out"),                  # eats the head kick
    key(6.20, "stance2", 74),
    key(6.38, "stance", 76),
    key(6.55, "duck", 82, ease="out"),                      # ducks the second roundhouse
    key(6.62, "duck", 84),
    key(6.76, "uppercut", 100, ease="out"),                 # and comes up with an uppercut
    key(6.95, "stance", 94),
    key(7.15, "stance2", 92),
    key(7.32, "crouch", 92),
    key(7.58, "flykick", 96, 106, ease="out"),              # flying kick over the duck
    key(7.76, "land", 100),
    key(7.95, "land", 100),                                 # swept
    key(8.05, "tuck", 95, 146, rot=90, ease="out"),         # backward roll out of it
    key(8.25, "tuck", 88, 146, rot=220),
    key(8.42, "crouch", 82, rot=360),
    key(8.62, "stance", 82, rot=360),
    key(8.82, "crouch", 84, rot=360),
    key(9.02, "jab", 93, 120, rot=360, ease="out"),         # superman punch
    key(9.20, "land", 97, rot=360),
    key(9.42, "stance", 92, rot=360),
    key(9.60, "stance2", 88, rot=360), key(9.78, "stance", 84, rot=360), key(9.96, "stance2", 80, rot=360),
    key(10.14, "stance", 77, rot=360), key(10.32, "stance2", 75, rot=360), key(10.52, "stance", 73, rot=360),
    key(10.74, "stance2", 72, rot=360), key(11.00, "stance", 72, rot=360),
]

B = [  # right fighter, facing left: a slower, swaying kicker
    key(0.00, "stance_b", 128), key(0.35, "stance_b2", 126), key(0.70, "stance_b", 124),
    key(0.88, "block", 122),
    key(1.02, "block", 123),
    key(1.15, "stance_b", 124),
    key(1.30, "sway", 127, ease="out"),
    key(1.45, "stance_b2", 124),
    key(1.62, "uppercut", 111, ease="out"),
    key(1.85, "stance_b", 122),
    key(2.05, "stance_b2", 122),
    key(2.20, "duck", 120, ease="out"),
    key(2.38, "duck", 120),
    key(2.45, "sweep_in", 122),
    key(2.58, "sweep", 118, ease="out"),
    key(2.70, "crouch", 121),
    key(2.84, "tuck", 120, 98, rot=120, ease="out"),        # backflip away, over the dive
    key(2.98, "tuck", 129, 90, rot=260),
    key(3.14, "land", 136, lean=12),
    key(3.45, "stance_b", 138),
    key(3.60, "crouch", 141),
    key(3.85, "flykick", 136.7, 115, ease="out"),           # flying kick into the block
    key(4.00, "land", 132),
    key(4.22, "stance_b", 131),
    key(4.40, "stance_b2", 126),
    key(4.55, "jab_low", 116.5, ease="out"),                # body jab lands
    key(4.72, "stance_b", 122),
    key(4.95, "stance_b2", 124),
    key(5.12, "stance_b", 126),
    key(5.26, "stance_b", 127),
    key(5.44, "hit_body", 133, ease="out"),
    key(5.62, "stance_b", 130),
    key(5.72, "chamber", 129),
    key(5.84, "roundhouse", 128, ease="out"),               # head kick lands
    key(6.02, "stance_b", 128),
    key(6.20, "stance_b2", 128),
    key(6.38, "chamber", 127),
    key(6.55, "roundhouse", 126, ease="out"),               # ducked
    key(6.70, "stance_b", 123),
    key(6.92, "hit_head", 127, ease="out"),                 # eats the uppercut
    key(7.12, "stance_b2", 129),
    key(7.30, "stance_b", 131),
    key(7.48, "duck", 130, ease="out"),                     # ducks the flying kick
    key(7.66, "duck", 130),
    key(7.82, "sweep_in", 132),
    key(7.95, "sweep", 134, ease="out"),                    # sweeps the landing
    key(8.15, "crouch", 132),
    key(8.40, "stance_b", 130),
    key(8.62, "stance_b", 128),
    key(8.82, "stance_b2", 128),
    key(9.02, "stance_b", 128),
    key(9.16, "hit_head", 130, ease="out"),                 # eats the superman punch
    key(9.40, "stance_b2", 132),
    key(9.65, "taunt", 132), key(9.85, "taunt2", 132),      # "come on"
    key(10.05, "taunt", 131), key(10.25, "taunt2", 130),
    key(10.50, "stance_b", 129), key(10.75, "stance_b2", 128), key(11.00, "stance_b", 128),
]
for k in B:  # after the backflip Blue stays a full turn round
    if k["t"] >= 3.14:
        k["p"]["rot"] = 360

# (time, kind, x, y): sparks where a hit or a block lands, dust where feet hit the floor.
FX = [
    (0.95, "block", 110, 111),
    (2.58, "dust", 82, None),
    (3.22, "dust", 94, None), (3.14, "dust", 136, None),
    (3.85, "block", 101, 110),
    (4.02, "dust", 84, None), (4.00, "dust", 132, None),
    (4.55, "hit", 82, 125),
    (5.34, "hit", 125, 124),
    (5.84, "hit", 97, 105),
    (6.76, "hit", 113, 101),
    (7.76, "dust", 100, None),
    (7.95, "hit", 99, 157),
    (8.42, "dust", 82, None),
    (9.02, "clash", 124, 99),
    (9.20, "dust", 97, None),
]


def ease(kind, u):
    if kind == "out":
        return 1 - (1 - u) ** 3
    if kind == "in":
        return u ** 2
    if kind == "lin":
        return u
    return u * u * (3 - 2 * u)


def state(track, t):
    t %= DUR
    for a, b in zip(track, track[1:]):
        if a["t"] <= t <= b["t"]:
            u = ease(b["ease"], (t - a["t"]) / (b["t"] - a["t"]) if b["t"] > a["t"] else 1)
            p = {k: a["p"][k] + (b["p"][k] - a["p"][k]) * u for k in a["p"]}
            x = a["x"] + (b["x"] - a["x"]) * u
            if a["y"] is None and b["y"] is None:
                y = grounded_y(p)
            else:
                ya = a["y"] if a["y"] is not None else grounded_y(a["p"])
                yb = b["y"] if b["y"] is not None else grounded_y(b["p"])
                y = ya + (yb - ya) * u
            return p, x, y
    raise ValueError(t)


# ---------------------------------------------------------------- drawing
def px(x, y):
    return ((x - VX) * K, (y - VY) * K)


def world_joints(p, x, y, facing):
    return {k: (x + facing * v[0], y + v[1]) for k, v in local_joints(p).items()}


def draw_figure(layer, p, x, y, facing, rgb, alpha):
    dr = ImageDraw.Draw(layer)
    j = world_joints(p, x, y, facing)
    col = rgb + (alpha,)
    w = STROKE * K
    segs = [("hip", "neck"),
            ("sh", "belbow"), ("belbow", "bhand"), ("hip", "bknee"), ("bknee", "bfoot"),
            ("hip", "fknee"), ("fknee", "ffoot"), ("sh", "felbow"), ("felbow", "fhand")]
    for a, b in segs:
        A_, B_ = px(*j[a]), px(*j[b])
        dr.line([A_, B_], fill=col, width=int(w))
        for P_ in (A_, B_):
            dr.ellipse([P_[0] - w / 2, P_[1] - w / 2, P_[0] + w / 2, P_[1] + w / 2], fill=col)
    hx, hy = px(*j["head"])
    r = HEAD_R * K
    dr.ellipse([hx - r, hy - r, hx + r, hy + r], fill=col)


def draw_shadow(dr, x, y, rgb):
    lift = max(0.0, (GROUND - 34) - y)
    k = max(0.35, 1 - lift / 70)
    cx, cy = px(x, GROUND + 1.5)
    rw, rh = 15 * K * k, 2.6 * K * k
    dr.ellipse([cx - rw, cy - rh, cx + rw, cy + rh], fill=rgb + (int(70 * k),))


def draw_fx(dr, t, spark_rgb, dust_rgb):
    for t0, kind, x, y in FX:
        dt = (t - t0) % DUR
        if kind == "dust":
            if dt > 0.4:
                continue
            u = dt / 0.4
            for side in (-1, 1):
                for i, off in enumerate((6, 12)):
                    cx, cy = px(x + side * (off + 10 * u), GROUND - 2 - 3 * u - i)
                    r = (2.2 + 2.5 * u) * K * (1 - 0.25 * i)
                    a = int(150 * (1 - u) ** 1.4)
                    dr.ellipse([cx - r, cy - r, cx + r, cy + r], fill=dust_rgb + (a,))
            continue
        life = 0.32 if kind == "clash" else 0.24
        if dt > life:
            continue
        u = dt / life
        size = {"block": 9, "hit": 12, "clash": 17}[kind]
        a = int(255 * (1 - u) ** 1.3)
        cx, cy = px(x, y)
        rays = 10 if kind == "clash" else 8
        for i in range(rays):
            ang = math.radians(i * 360 / rays + (22.5 if kind == "hit" else 0))
            long = 1.0 if i % 2 == 0 else 0.6
            r0, r1 = size * (0.25 + 0.55 * u) * K, size * long * (0.7 + 0.6 * u) * K
            dr.line([(cx + r0 * math.cos(ang), cy + r0 * math.sin(ang)),
                     (cx + r1 * math.cos(ang), cy + r1 * math.sin(ang))],
                    fill=spark_rgb + (a,), width=int((3.2 - 2 * u) * K))
        if u < 0.35:
            r = size * 0.38 * (1 - u) * K
            dr.ellipse([cx - r, cy - r, cx + r, cy + r], fill=spark_rgb + (a,))
        if kind == "clash":
            r = size * (0.6 + 1.4 * u) * K
            dr.ellipse([cx - r, cy - r, cx + r, cy + r], outline=spark_rgb + (int(a * 0.8),), width=int(1.8 * K))


def frame(i, a_rgb, b_rgb, spark_rgb, neutral_rgb):
    t = i / FPS
    img = Image.new("RGBA", (W, W), (0, 0, 0, 0))
    dr = ImageDraw.Draw(img)
    # the mat
    gx0, gy = px(42, GROUND + 1.5)
    gx1, _ = px(158, GROUND + 1.5)
    dr.line([(gx0, gy), (gx1, gy)], fill=neutral_rgb + (60,), width=int(1.4 * K))
    for track, facing in ((A, 1), (B, -1)):
        _, x, y = state(track, t)
        draw_shadow(dr, x, y, neutral_rgb)
    # motion trails: the same fighter a beat and two beats ago, faint, under the figure
    for lag, alpha in ((0.10, 45), (0.05, 95)):
        for track, facing, rgb in ((A, 1, a_rgb), (B, -1, b_rgb)):
            p, x, y = state(track, t - lag)
            layer = Image.new("RGBA", (W, W), (0, 0, 0, 0))
            draw_figure(layer, p, x, y, facing, rgb, 255)
            layer.putalpha(layer.getchannel("A").point(lambda v: v * alpha // 255))
            img.alpha_composite(layer)
    for track, facing, rgb in ((A, 1, a_rgb), (B, -1, b_rgb)):
        p, x, y = state(track, t)
        draw_figure(img, p, x, y, facing, rgb, 255)
    draw_fx(ImageDraw.Draw(img), t, spark_rgb, neutral_rgb)
    return img.resize((OUT, OUT), Image.LANCZOS)


def render(path, a_rgb, b_rgb, spark_rgb, neutral_rgb):
    frames = [frame(i, a_rgb, b_rgb, spark_rgb, neutral_rgb) for i in range(N)]
    frames[0].save(path, save_all=True, append_images=frames[1:], duration=int(1000 / FPS),
                   loop=0, lossless=False, quality=75, alpha_quality=80, method=6, minimize_size=True)
    return frames


def main():
    out = Path(sys.argv[1])
    out.mkdir(parents=True, exist_ok=True)
    frames = render(out / "stickfight.webp", RED, BLUE, SPARK, NEUTRAL)
    if "--sheet" in sys.argv:
        cols, step = 10, 2
        picks = frames[::step]
        rows = math.ceil(len(picks) / cols)
        sheet = Image.new("RGBA", (cols * OUT, rows * OUT), (24, 26, 31, 255))
        for n, f in enumerate(picks):
            sheet.alpha_composite(f, ((n % cols) * OUT, (n // cols) * OUT))
            ImageDraw.Draw(sheet).text(((n % cols) * OUT + 3, (n // cols) * OUT + 2), f"{n * step / FPS:.1f}", fill=(120, 120, 120, 255))
        sheet.save(out / "sheet.png")
        return
    for name, rgb in VARIANTS.items():
        render(out / f"stickfight-{name}.webp", rgb, rgb, rgb, rgb)


if __name__ == "__main__":
    main()
