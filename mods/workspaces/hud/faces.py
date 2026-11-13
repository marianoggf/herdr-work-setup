"""Builds the Status Face loader from a sprite sheet of the status-bar face
(8 columns: grin, ouch, scream, look, centre, look, head turned, head turned;
rows: health from full to near death, then dead and god mode).

The loop tells a little story: at each health level he glances around and
reacts, picking up more blood level by level, flashes god mode, and heals.

Usage: faces.py SHEET.png OUT_DIR
Writes hud.webp (the whole story, for previews), hud-0..4.webp (one loop per
health level, the loader picks by how long the agent has worked), strip.png + seq.json (for preview.html).
"""
import json
import sys
from pathlib import Path

from PIL import Image, ImageDraw

COLS = [(0, 96), (102, 200), (206, 304), (310, 408), (414, 512), (518, 616), (622, 744), (750, 864)]
ROWS = [(5, 131), (137, 263), (269, 395), (401, 527), (533, 659), (665, 794)]
GRIN, OUCH, SCREAM, LOOK_A, CENTER, LOOK_B, TURN_A, TURN_B = range(8)
BOX = 128
OUT = 96

# (column, row, ms, health %)
SEQ = []
LEVELS = []  # each health level's own loop: hud-<n>.webp, shown by how long the agent has worked
def level(row, health, beats):
    LEVELS.append((row, beats))
    for col, ms in beats:
        SEQ.append((col, row, ms, health))

level(0, 100, [(CENTER, 700), (LOOK_A, 450), (CENTER, 250), (LOOK_B, 450), (CENTER, 400), (GRIN, 700)])
level(1, 80, [(OUCH, 250), (CENTER, 500), (LOOK_B, 400), (LOOK_A, 400), (CENTER, 400)])
level(2, 60, [(TURN_A, 300), (CENTER, 400), (TURN_B, 300), (CENTER, 500), (LOOK_A, 400)])
level(3, 40, [(SCREAM, 350), (CENTER, 450), (LOOK_B, 400), (CENTER, 400), (OUCH, 300)])
level(4, 20, [(CENTER, 500), (LOOK_A, 400), (LOOK_B, 400), (TURN_A, 300), (GRIN, 800)])
SEQ.append((1, 5, 900, 200))   # god mode, then back to full health


def defringe(cell):
    """The scaled sheet blends the face's outline into white. Peel off light,
    greyish pixels touching the transparent outside, then un-blend the next
    ring from white so the edge keeps its own color at partial opacity."""
    px = cell.load()
    w, h = cell.size
    outside = lambda x, y: x < 0 or y < 0 or x >= w or y >= h or px[x, y][3] == 0
    edge = lambda x, y: any(outside(x + dx, y + dy) for dx, dy in ((1, 0), (-1, 0), (0, 1), (0, -1)))
    for _ in range(3):
        peel = [(x, y) for y in range(h) for x in range(w)
                if px[x, y][3] and edge(x, y) and min(px[x, y][:3]) > 120
                and max(px[x, y][:3]) - min(px[x, y][:3]) < 90]
        for x, y in peel:
            px[x, y] = (0, 0, 0, 0)
    for x, y in [(x, y) for y in range(h) for x in range(w) if px[x, y][3] and edge(x, y)]:
        r, g, b, _ = px[x, y]
        a = max(255 - r, 255 - g, 255 - b) / 255
        a = max(a, 0.35)
        un = lambda c: max(0, min(255, round((c - 255 * (1 - a)) / a)))
        px[x, y] = (un(r), un(g), un(b), round(a * 255))


def cut(sheet, col, row):
    (x0, x1), (y0, y1) = COLS[col], ROWS[row]
    cell = sheet.crop((x0, y0, x1, y1)).convert("RGBA")
    # the sheet's white background goes, reached from the cell's edges only (teeth stay)
    w, h = cell.size
    for seed in [(0, 0), (w - 1, 0), (0, h - 1), (w - 1, h - 1), (w // 2, 0), (w // 2, h - 1)]:
        if sum(cell.getpixel(seed)[:3]) > 690:
            ImageDraw.floodfill(cell, seed, (0, 0, 0, 0), thresh=60)
    defringe(cell)
    box = Image.new("RGBA", (BOX, BOX), (0, 0, 0, 0))
    box.alpha_composite(cell, ((BOX - w) // 2, (BOX - h) // 2))
    return box


def main():
    sheet = Image.open(sys.argv[1]).convert("RGB")
    out = Path(sys.argv[2]); out.mkdir(parents=True, exist_ok=True)
    frames = [cut(sheet, c, r).resize((OUT, OUT), Image.LANCZOS) for c, r, _, _ in SEQ]
    for n, (row, beats) in enumerate(LEVELS):
        lf = [cut(sheet, c, row).resize((OUT, OUT), Image.LANCZOS) for c, _ in beats]
        lf[0].save(out / f"hud-{n}.webp", save_all=True, append_images=lf[1:],
                   duration=[ms for _, ms in beats], loop=0, quality=92, method=6, disposal=2)
    frames[0].save(out / "hud.webp", save_all=True, append_images=frames[1:],
                   duration=[ms for _, _, ms, _ in SEQ], loop=0, quality=92, method=6, disposal=2)
    strip = Image.new("RGBA", (BOX * 8, BOX * 6), (0, 0, 0, 0))
    for r in range(6):
        for c in range(8 if r < 5 else 2):
            strip.alpha_composite(cut(sheet, c, r), (c * BOX, r * BOX))
    strip.save(out / "strip.png")
    json.dump({"box": BOX, "seq": SEQ}, open(out / "seq.json", "w"))
    sheet_prev = Image.new("RGBA", (len(SEQ) * 50, 50), (60, 60, 58, 255))
    for i, f in enumerate(frames):
        sheet_prev.alpha_composite(f.resize((48, 48)), (i * 50, 1))
    sheet_prev.save(out / "sheet.png")
    print(len(SEQ), "frames,", sum(ms for _, _, ms, _ in SEQ), "ms")


main()
