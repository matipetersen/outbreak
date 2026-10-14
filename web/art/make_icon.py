"""The app icon: a pixel-art skull with acid-green eyes on the game's dark teal, same pixel language as the sprites.
Run:  python3 web/art/make_icon.py      ->  art/icon-512.png, icon-192.png, icon-180.png (apple-touch), icon-32.png
No transparency (iOS fills transparent corners with black), and the skull sits well inside the maskable safe zone.
"""
import math
import os

from PIL import Image

HERE = os.path.dirname(os.path.abspath(__file__))

_HALF = [                                  # the left half of the skull; the right is its mirror image
    "........",
    "....kkkk",
    "...kBBBB",
    "..kBBBBB",
    "..kBBBBB",
    "..kBBBBB",
    "..kBkkkB",
    "..kBGGGB",
    "..kBGGGB",
    "..kBkkkB",
    "..kBBBBn",
    "..kBBBBn",
    "...kBBBB",
    "...kBkBk",
    "....kBkB",
    ".....kkk",
]
SKULL = [h + h[::-1] for h in _HALF]
PAL = {"k": (13, 18, 20), "B": (232, 222, 196), "G": (124, 255, 107), "n": (60, 52, 44)}


def render(size):
    bg0, bg1 = (22, 40, 40), (8, 12, 14)                        # a faint teal glow in the middle of the game's dark
    img = Image.new("RGB", (size, size))
    px = img.load()
    cx = cy = size / 2
    for y in range(size):
        for x in range(size):
            t = min(1.0, math.hypot(x - cx, y - cy) / (size * 0.72))
            px[x, y] = tuple(int(a + (b - a) * t) for a, b in zip(bg0, bg1))
    cell = max(1, int(size * 0.052))                            # the skull is 16 cells wide: about 83% of the icon
    ox = int(cx - 8 * cell)
    oy = int(cy - 8 * cell) - cell // 2
    eyes = []
    for r, row in enumerate(SKULL):
        for c, ch in enumerate(row):
            if ch == ".":
                continue
            if ch == "G":
                eyes.append((c, r))
            for dy in range(cell):
                for dx in range(cell):
                    px[ox + c * cell + dx, oy + r * cell + dy] = PAL[ch]
    glow = Image.new("RGB", (size, size), (0, 0, 0))             # the eyes light the bone around them
    gp = glow.load()
    for (c, r) in eyes:
        gx, gy = ox + c * cell + cell // 2, oy + r * cell + cell // 2
        rad = cell * 3
        for y in range(max(0, gy - rad), min(size, gy + rad)):
            for x in range(max(0, gx - rad), min(size, gx + rad)):
                d = math.hypot(x - gx, y - gy) / rad
                if d < 1:
                    v = int(46 * (1 - d) ** 2)
                    old = gp[x, y]
                    gp[x, y] = (old[0], min(255, old[1] + v), old[2])
    out = Image.new("RGB", (size, size))
    op, ip = out.load(), img.load()
    for y in range(size):
        for x in range(size):
            a, g = ip[x, y], gp[x, y]
            op[x, y] = (a[0], min(255, a[1] + g[1]), a[2])
    # the eyes themselves stay crisp
    for (c, r) in eyes:
        for dy in range(cell):
            for dx in range(cell):
                op[ox + c * cell + dx, oy + r * cell + dy] = PAL["G"]
    return out


def main():
    os.makedirs(os.path.join(HERE, "icons"), exist_ok=True)
    for size, name in ((512, "icon-512.png"), (192, "icon-192.png"), (180, "icon-180.png"), (32, "icon-32.png")):
        render(size).save(os.path.join(HERE, "icons", name), optimize=True)
        print(name, size)


if __name__ == "__main__":
    main()
