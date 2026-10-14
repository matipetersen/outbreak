"""Builds the sprite atlases from Kenney's CC0 packs (see art/src/LICENSE-*.txt).

  modern     Roguelike Modern City + Roguelike Characters     (used by every era but the medieval one)
  medieval   Tiny Town + Tiny Dungeon
  scifi      drawn in code (art/scifi.py): steel decks, bulkheads, coolant, helmeted crew, glowing infected

Run:  python3 web/art/build_atlas.py     (needs Pillow)   ->  art/atlas_<set>.png + art/atlas_<set>.json
web/build.py inlines them into the page.  Nothing here is needed at play time.  Both sets name their sprites alike.
"""
import colorsys
import json
import os
import sys

from PIL import Image

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
PITCH, S = 17, 16                                  # the sheets are 16px tiles with a 1px margin


def sheet(name):
    return Image.open(os.path.join(HERE, "src", name)).convert("RGBA")


CITY, CHARS = sheet("modern-city.png"), sheet("characters.png")


def tile(img, c, r):
    return img.crop((c * PITCH, r * PITCH, c * PITCH + S, r * PITCH + S))


def over(bg, *layers):
    out = bg.copy()
    for layer in layers:
        out.alpha_composite(layer)
    return out


def hue_shift(img, hue, sat=1.0, val=1.0):
    """Recolour the green body: every opaque, green-ish pixel gets the new hue."""
    out = img.copy()
    px = out.load()
    for y in range(S):
        for x in range(S):
            r, g, b, a = px[x, y]
            if a == 0:
                continue
            h, s, v = colorsys.rgb_to_hsv(r / 255, g / 255, b / 255)
            if 0.2 < h < 0.45 and s > 0.25:        # the green of the orc body
                r2, g2, b2 = colorsys.hsv_to_rgb(hue / 360, min(1, s * sat), min(1, v * val))
                px[x, y] = (int(r2 * 255), int(g2 * 255), int(b2 * 255), a)
    return out


def flat(colour, spots=()):
    t = Image.new("RGBA", (S, S), colour)
    px = t.load()
    for x, y, c in spots:
        px[x, y] = c
    return t


grass_a, grass_b = tile(CITY, 1, 26), tile(CITY, 3, 26)
for g in (grass_a, grass_b):                          # the sheet's grass has a dirt pixel on its corner edge
    for x, y in ((15, 0), (15, 1), (15, 2), (14, 0)):
        g.putpixel((x, y), g.getpixel((8, 8)))
def _plain_floor(src, shade):
    """The sheet's floor pieces carry bevelled edges for building plazas; tiled alone they make a staircase pattern.
    Keep the pack's colour and give each tile just a faint grout line."""
    counts = {}
    for px in list(src.getdata()):
        if px[3] == 255:
            counts[px] = counts.get(px, 0) + 1
    base = max(counts, key=counts.get)
    base = tuple(min(255, int(c * shade)) for c in base[:3]) + (255,)
    grout = tuple(int(c * 0.88) for c in base[:3]) + (255,)
    t = Image.new("RGBA", (S, S), base)
    for i in range(S):
        t.putpixel((i, S - 1), grout)
        t.putpixel((S - 1, i), grout)
    return t


floor_a, floor_b = _plain_floor(tile(CITY, 25, 0), 1.0), _plain_floor(tile(CITY, 25, 0), 0.95)
road = tile(CITY, 11, 19)
def _commonest(img):
    counts = {}
    for px in list(img.getdata()):
        if px[3] == 255 and px[2] > px[0] + 40:      # opaque and bluish: the water, not the stone rim
            counts[px] = counts.get(px, 0) + 1
    return max(counts, key=counts.get)


water_ref = _commonest(tile(CITY, 27, 5))
water = flat(water_ref, [(3, 3, (255, 255, 255, 70)), (4, 3, (255, 255, 255, 70)), (11, 9, (255, 255, 255, 70)),
                         (12, 9, (255, 255, 255, 70)), (7, 13, (255, 255, 255, 60)), (8, 13, (255, 255, 255, 60))])
shallow = Image.blend(water, flat((200, 235, 235, 255)), 0.35)

def modern():
    SPRITES = {
        "floor_a": floor_a, "floor_b": floor_b,
        "grass_a": grass_a, "grass_b": grass_b,
        "road": road,
        "water": water, "shallow": shallow,
        "wall": tile(CITY, 6, 5),
        "brush": over(grass_a, tile(CITY, 31, 13)),
        "tree": over(grass_a, tile(CITY, 33, 11)),
        "tree_b": over(grass_b, tile(CITY, 32, 11)),
        "rubble": over(tile(CITY, 18, 1), tile(CITY, 13, 13)),   # dark stones on a pale slab: it must not read as a crate
        "fence": over(grass_a, tile(CITY, 20, 14)),
        "crate": over(floor_a, tile(CITY, 13, 16)),
        "crate_open": over(floor_a, tile(CITY, 13, 15)),
        # people
        "player": tile(CHARS, 1, 6),
        "human": tile(CHARS, 0, 6), "raider": tile(CHARS, 1, 10), "trader": tile(CHARS, 0, 8), "healer": tile(CHARS, 0, 9),
        "scholar": tile(CHARS, 1, 5), "soldier": tile(CHARS, 1, 7), "scout": tile(CHARS, 0, 7),
    }
    # the dead: the green body in a torn shirt, recoloured per kind
    body, shirt = tile(CHARS, 0, 3), tile(CHARS, 7, 3)
    for special, (hue, sat, val) in {
        "walker": (110, 1.0, 1.0), "crawler": (80, 0.9, 0.75), "brute": (285, 0.7, 0.9), "bloater": (65, 1.0, 1.15),
        "screamer": (48, 1.0, 1.2), "leaper": (18, 1.0, 1.1), "clicker": (185, 0.9, 1.0), "stalker": (300, 0.8, 0.7),
        "alpha": (335, 1.0, 1.1),
    }.items():
        SPRITES["z_" + special] = over(hue_shift(body, hue, sat, val), shirt)
    return SPRITES


TOWN, DUNGEON = sheet("tiny-town.png"), sheet("tiny-dungeon.png")


def _plain(src, shade=1.0):
    """A flat tile of the commonest colour of ``src``, with a faint grout line (see _plain_floor)."""
    return _plain_floor(src, shade)


def _skin_to_green(img, hue=105, sat=0.55, val=0.85):
    """Make a villager look dead: skin tones (orange-peach) become a sickly green, clothes stay."""
    out = img.copy()
    px = out.load()
    for y in range(S):
        for x in range(S):
            r, g, b, a = px[x, y]
            if a == 0:
                continue
            h, s_, v = colorsys.rgb_to_hsv(r / 255, g / 255, b / 255)
            if 0.03 < h < 0.13 and 0.2 < s_ < 0.75 and v > 0.55:
                r2, g2, b2 = colorsys.hsv_to_rgb(hue / 360, sat, v * val)
                px[x, y] = (int(r2 * 255), int(g2 * 255), int(b2 * 255), a)
    return out


def medieval():
    grass_a, grass_b = tile(TOWN, 0, 0), tile(TOWN, 1, 0)
    slab = _plain(tile(TOWN, 1, 9))
    sea = (66, 140, 205, 255)
    water = flat(sea, [(3, 3, (255, 255, 255, 90)), (4, 3, (255, 255, 255, 90)), (11, 9, (255, 255, 255, 90)),
                       (12, 9, (255, 255, 255, 90)), (7, 13, (255, 255, 255, 80)), (8, 13, (255, 255, 255, 80))])
    sp = {
        "floor_a": slab, "floor_b": _plain(tile(TOWN, 1, 9), 0.95),
        "grass_a": grass_a, "grass_b": grass_b,
        "road": tile(TOWN, 4, 3),                                   # packed dirt
        "water": water, "shallow": Image.blend(water, flat((190, 225, 240, 255)), 0.4),
        "wall": tile(TOWN, 5, 6),
        "brush": over(grass_a, tile(TOWN, 5, 0)),
        "tree": over(grass_a, tile(TOWN, 4, 2)),
        "tree_b": over(grass_b, tile(TOWN, 3, 2)),
        "rubble": over(grass_a, tile(TOWN, 7, 3)),
        "fence": over(grass_a, tile(TOWN, 9, 6)),
        "crate": over(slab, tile(DUNGEON, 5, 7)),
        "crate_open": over(slab, tile(DUNGEON, 7, 7)),
        # people (Tiny Dungeon)
        "player": tile(DUNGEON, 4, 7), "human": tile(DUNGEON, 2, 8), "raider": tile(DUNGEON, 3, 7),
        "trader": tile(DUNGEON, 3, 8), "healer": tile(DUNGEON, 0, 7), "scholar": tile(DUNGEON, 2, 7),
        "soldier": tile(DUNGEON, 0, 8), "scout": tile(DUNGEON, 1, 7),
        # the dead: villagers gone green, and the dungeon's own horrors for the strange ones
        "z_walker": _skin_to_green(tile(DUNGEON, 1, 7)),
        "z_crawler": tile(DUNGEON, 2, 10),            # spider
        "z_brute": tile(DUNGEON, 1, 9),               # cyclops
        "z_bloater": tile(DUNGEON, 0, 9),             # slime
        "z_screamer": tile(DUNGEON, 0, 10),           # bat
        "z_leaper": tile(DUNGEON, 3, 10),
        "z_clicker": tile(DUNGEON, 4, 10),
        "z_stalker": tile(DUNGEON, 1, 10),            # ghost
        "z_alpha": tile(DUNGEON, 2, 9),               # red horror
    }
    return sp


def build(name, sprites):
    names = list(sprites)
    cols = 8
    rows = (len(names) + cols - 1) // cols
    atlas = Image.new("RGBA", (cols * S, rows * S), (0, 0, 0, 0))
    manifest = {}
    for i, n in enumerate(names):
        atlas.paste(sprites[n], ((i % cols) * S, (i // cols) * S))
        manifest[n] = [i % cols, i // cols]
    atlas.save(os.path.join(HERE, f"atlas_{name}.png"), optimize=True)
    with open(os.path.join(HERE, f"atlas_{name}.json"), "w") as fh:
        json.dump({"size": S, "sprites": manifest}, fh)
    big = atlas.resize((atlas.width * 6, atlas.height * 6), Image.NEAREST)     # a magnified sheet for a human to look at
    bg = Image.new("RGBA", big.size, (90, 100, 95, 255))
    bg.alpha_composite(big)
    bg.save(os.path.join(HERE, f"contact_{name}.png"))
    print(f"{name}: {len(names)} sprites, atlas {atlas.size}")


def main():
    import animals
    import scifi
    build("modern", {**modern(), **animals.sprites()})
    build("medieval", {**medieval(), **animals.sprites()})
    build("scifi", {**scifi.sprites(), **animals.sprites("scifi")})


if __name__ == "__main__":
    main()
