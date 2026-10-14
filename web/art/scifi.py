"""The sci-fi sprite set, drawn pixel by pixel (no pack): dark steel decks, bulkheads with light strips, coolant, hydroponic
growth, cargo containers; helmeted crew; the infected glow.  Same sprite names as the other sets.  CC0, like the rest of the art."""
from PIL import Image

S = 16


def C(h):
    h = h.lstrip("#")
    return (int(h[0:2], 16), int(h[2:4], 16), int(h[4:6], 16), 255)


def canvas(fill=None):
    return Image.new("RGBA", (S, S), fill or (0, 0, 0, 0))


def art(rows, pal):
    """ASCII -> image.  '.' is transparent; every other character must be in ``pal``."""
    assert len(rows) == S, len(rows)
    im = canvas()
    px = im.load()
    for y, row in enumerate(rows):
        assert len(row) == S, (y, row)
        for x, ch in enumerate(row):
            if ch != ".":
                px[x, y] = C(pal[ch])
    return im


def over(*layers):
    out = layers[0].copy()
    for layer in layers[1:]:
        out.alpha_composite(layer)
    return out


def plate(base, seam, hi, rivet, scratch=False):
    im = canvas(C(base))
    px = im.load()
    for i in range(S):
        px[i, 0] = C(seam)
        px[0, i] = C(seam)
    for i in range(1, S):
        px[i, 1] = C(hi)
    for x, y in ((3, 3), (12, 3), (3, 12), (12, 12)):
        px[x, y] = C(rivet)
    if scratch:
        for x, y in ((6, 8), (7, 9), (8, 9), (9, 10)):
            px[x, y] = C(seam)
    return im


floor_a = plate("#202b38", "#141c26", "#2a3949", "#46607a")
floor_b = plate("#1d2733", "#141c26", "#273544", "#46607a", scratch=True)

# hydroponic deck: dark teal soil-mat with bright sprouts
def deck_garden(seed):
    im = canvas(C("#10302c" if seed == 0 else "#0f2c2a"))
    px = im.load()
    for x, y in ((3, 4), (10, 2), (13, 9), (6, 12), (1, 10)) if seed == 0 else ((2, 3), (9, 5), (12, 12), (5, 10), (14, 2)):
        px[x, y] = C("#3fd68a")
        px[x, y + 1] = C("#1f9a63")
    for x, y in ((7, 7), (11, 14)):
        px[x, y] = C("#1b5b52")
    return im


grass_a, grass_b = deck_garden(0), deck_garden(1)

# corridor decking: dark grating with amber guide lights at the corners
def road():
    im = plate("#2a3138", "#1b2127", "#333c45", "#5a6672")
    px = im.load()
    for x, y in ((7, 7), (8, 7), (7, 8), (8, 8)):
        px[x, y] = C("#c98a22")
    return im


# coolant
def coolant(shallow=False):
    base = "#0b4f63" if not shallow else "#1b7a8c"
    im = canvas(C(base))
    px = im.load()
    for x, y in ((3, 3), (4, 3), (11, 9), (12, 9), (7, 13), (8, 13), (14, 5)):
        px[x, y] = C("#58e6ff") if not shallow else C("#a8f4ff")
    for x, y in ((2, 8), (9, 2), (13, 12)):
        px[x, y] = C("#0a3c4d") if not shallow else C("#3da6b8")
    return im


# bulkhead: riveted panel with a lit seam
wall = art([
    "bbbbbbbbbbbbbbbb",
    "bhhhhhhhhhhhhhhb",
    "bhggggggggggggdb",
    "bhgrggggggggrgdb",
    "bhggggggggggggdb",
    "bhggggggggggggdb",
    "bhcccccccccccgdb",
    "bhwwwwwwwwwwwgdb",
    "bhcccccccccccgdb",
    "bhggggggggggggdb",
    "bhggggggggggggdb",
    "bhgrggggggggrgdb",
    "bhggggggggggggdb",
    "bhdddddddddddddb",
    "bbbbbbbbbbbbbbbb",
    "bbbbbbbbbbbbbbbb",
], {"b": "#0f151c", "h": "#4a5d72", "g": "#34455a", "d": "#243142", "r": "#7d96b0", "c": "#0e6f86", "w": "#6af0ff"})

# alien flora: a glowing bulb-tree on the deck garden, two tints
def bulb_tree(garden, canopy, glow, trunk="#3a2a4a"):
    t = art([
        "................",
        "................",
        ".....kkkkkk.....",
        "....kccccccc....",
        "...kcccgcccck...",
        "...kccgcccccck..",
        "..kccccccgcccck.",
        "..kcgccccccccck.",
        "...kccccccgcck..",
        "....kcccccccK...",
        ".....kkkttk.....",
        ".......tt.......",
        ".......tt.......",
        "......tttt......",
        "................",
        "................",
    ], {"k": "#0a1a1e", "c": canopy, "g": glow, "t": trunk, "K": "#0a1a1e"})
    return over(garden, t)


tree = bulb_tree(grass_a, "#2a8f6f", "#9affd0")
tree_b = bulb_tree(grass_b, "#6a3fa8", "#e0b0ff", "#2d2a4a")

brush = over(grass_a, art([
    "................",
    "................",
    "................",
    "..g.............",
    "..gg....v....g..",
    "..ggg...vv..gg..",
    "...gg..vvv.ggg..",
    "...ggg.vvv.gg...",
    "..gggg.vv.ggg...",
    ".ggggvvv.gggg...",
    ".gggvvvvgggg....",
    ".ggvvvvgggg.....",
    "..gvvvvgg.......",
    "...vvvgg........",
    "................",
    "................",
], {"g": "#2fbf86", "v": "#8a5ad0"}))

rubble = over(floor_a, art([
    "................",
    "................",
    "......ss........",
    ".....ssss.y.....",
    "..ss.sSSs..y....",
    ".ssssSSSss......",
    ".sSSsSSSsss.....",
    "..sSSSsSSSss.ww.",
    "...sssSSSSss.w..",
    "....ssSSSss.....",
    "..y..ssssss.....",
    ".w..............",
    "..w.....y.......",
    "................",
    "................",
    "................",
], {"s": "#56626f", "S": "#3a444f", "y": "#f0c040", "w": "#7ad8ff"}))

fence = over(grass_a, art([
    "................",
    "................",
    "................",
    "................",
    "................",
    ".pp..........pp.",
    ".pp..........pp.",
    ".pp.cccccccc.pp.",
    ".ppwwwwwwwwwwpp.",
    ".pp.cccccccc.pp.",
    ".pp..........pp.",
    ".pp..........pp.",
    ".pp..........pp.",
    ".kk..........kk.",
    "................",
    "................",
], {"p": "#5b6b7e", "k": "#222c38", "c": "#1aa9c9", "w": "#9af4ff"}))

def cargo(open_=False):
    rows = [
        "................",
        "................",
        "..kkkkkkkkkkkk..",
        ".kBBBBBBBBBBBBk.",
        ".kBhhhhhhhhhhBk.",
        ".kBBBBBBBBBBBBk.",
        ".koooooooooooBk.",
        ".koYYYYYYYYYoBk.",
        ".koooooooooooBk.",
        ".kBBBBBBBBBBBBk.",
        ".kBhhhhhhhhhhBk.",
        ".kBBBBBBBBBBBBk.",
        "..kkkkkkkkkkkk..",
        "................",
        "................",
        "................",
    ]
    if open_:
        rows = [
            "................",
            "..kkkkkkkkkkkk..",
            ".kBBBBBBBBBBBBk.",
            ".kBhhhhhhhhhhBk.",
            ".kkkkkkkkkkkkkk.",
            ".kddddddddddddk.",
            ".kdgggggggggddk.",
            ".kdgyygggyyggdk.",
            ".kdgggggggggddk.",
            ".kddddddddddddk.",
            ".kBBBBBBBBBBBBk.",
            ".kBhhhhhhhhhhBk.",
            "..kkkkkkkkkkkk..",
            "................",
            "................",
            "................",
        ]
    return over(floor_a, art(rows, {"k": "#0c1218", "B": "#3a5f86", "h": "#5b86b4", "o": "#2c4a6c", "Y": "#f0a020", "d": "#0a1218",
                                    "g": "#1f3a50", "y": "#6af0ff"}))


# ---- people: helmeted crew.  H helmet, V visor, S skin, B suit, b trim, c chest light, L legs, l boots, G gear
HUMAN = [
    "................",
    ".....HHHHHH.....",
    "....HHHHHHHH....",
    "....HVVVVVVH....",
    "....HVVVVVVH....",
    "....HHHHHHHH....",
    ".....bBBBBb.....",
    "...GbBBBBBBbG...",
    "..SGBBBBBBBBGS..",
    "..SGBBBccBBBGS..",
    "...bBBBccBBBb...",
    "....bBBBBBBb....",
    "....LLL..LLL....",
    "....LLL..LLL....",
    "....lll..lll....",
    "................",
]


def crew(helm, visor, suit, trim, chest, legs, gear="#8a96a3", boots="#1a222c", skin="#d9a98a"):
    return art(HUMAN, {"H": helm, "V": visor, "S": skin, "B": suit, "b": trim, "c": chest, "L": legs, "l": boots, "G": gear})


# the infected: gaunt, hunched, eyes and veins lit.  e eyes, S skin, m mouth, B torn suit, t torn patch, L legs, l feet
INFECTED = [
    "................",
    ".....SSSSSS.....",
    "....SSSSSSSS....",
    "....SeSSSSeS....",
    "....SSSSSSSS....",
    ".....SmmmmS.....",
    "....bbSSSSbb....",
    "...bBBBBBBBBb...",
    "..SSBBttBBBBSS..",
    "..S.BBBBBBBB.S..",
    "..S.bBBBBBBb.S..",
    "....bBBBBBBb....",
    "....LLL..LLL....",
    "....LL....LL....",
    "....ll....ll....",
    "................",
]
CRAWLER = [
    "................", "................", "................", "................", "................", "................",
    "................", "................", ".....SSSSS......", "....SeSSSeS.....", "....SSmmmSS.....", "..bbbBBBBBBbb...",
    ".SSbBBttBBBBbSS.", ".S..bBBBBBBb..S.", ".S...LL..LL...S.", "................",
]
BRUTE = [
    "................",
    "....SSSSSSSS....",
    "...SSSSSSSSSS...",
    "...SeSSSSSSeS...",
    "...SSSSSSSSSS...",
    "....SmmmmmmS....",
    "..bbbSSSSSSbbb..",
    ".bBBBBBBBBBBBBb.",
    "SSBBBBttBBBBBBSS",
    "SSBBBBBBBBBBBBSS",
    "SS.bBBBBBBBBb.SS",
    "...bBBBBBBBBb...",
    "...LLLL..LLLL...",
    "...LLLL..LLLL...",
    "...llll..llll...",
    "................",
]


def infected(skin, eyes, suit="#4a5568", trim="#2d3748", legs="#2b3340", feet="#1a222c", patch="#7a2a2a", scale=None):
    return art(INFECTED, {"S": skin, "e": eyes, "m": "#2a0d0d", "B": suit, "b": trim, "t": patch, "L": legs, "l": feet})


def sprites():
    sp = {
        "floor_a": floor_a, "floor_b": floor_b, "grass_a": grass_a, "grass_b": grass_b, "road": road(),
        "water": coolant(), "shallow": coolant(True), "wall": wall, "brush": brush, "tree": tree, "tree_b": tree_b,
        "rubble": rubble, "fence": fence, "crate": cargo(), "crate_open": cargo(True),
        "player": crew("#e8eef5", "#33e0ff", "#dfe7f0", "#8fa3b8", "#33e0ff", "#4a5d72", gear="#33e0ff"),
        "human": crew("#7d8a98", "#9fb4c8", "#5d6d7f", "#3d4a59", "#c0d0e0", "#37424f"),
        "raider": crew("#3b2230", "#ff4a3a", "#7a2d2d", "#4a1c1c", "#ff7a3a", "#2a1a1a", gear="#b0b0b0"),
        "trader": crew("#a7742a", "#ffd24a", "#c99a3a", "#7d5a1f", "#ffe9a0", "#4a3a1f"),
        "healer": crew("#e8f4ee", "#7affc4", "#f2f7f4", "#9acbb4", "#ff5a5a", "#6a8a7a"),
        "scholar": crew("#5a3f8a", "#e0b0ff", "#7a58b0", "#4a3470", "#e0b0ff", "#33284d"),
        "soldier": crew("#3f5a3a", "#9aff8a", "#566f4a", "#33452e", "#ccff99", "#2a3a26", gear="#9aa98a"),
        "scout": crew("#2f6b72", "#8af4ff", "#3f8c96", "#255459", "#bffaff", "#244a50"),
    }
    sp["z_walker"] = infected("#5fd38a", "#ff4a4a")
    sp["z_crawler"] = art(CRAWLER, {"S": "#88c070", "e": "#ffe14a", "m": "#2a0d0d", "B": "#4a5568", "b": "#2d3748", "t": "#7a2a2a", "L": "#2b3340"})
    sp["z_brute"] = art(BRUTE, {"S": "#8a5ad0", "e": "#ffe14a", "m": "#2a0d0d", "B": "#4a3a5a", "b": "#2d2540", "t": "#7a2a2a", "L": "#2b2a40", "l": "#1a1830"})
    sp["z_bloater"] = infected("#c8d84a", "#ff6a4a", suit="#6a7a3a", trim="#4a5a2a")
    sp["z_screamer"] = infected("#ffb04a", "#ffffff", suit="#7a4a2a", trim="#5a3a1a")
    sp["z_leaper"] = infected("#ff7a4a", "#ffe14a", suit="#7a3a2a", trim="#5a2a1a")
    sp["z_clicker"] = infected("#4ac8e8", "#ffffff", suit="#2a4a6a", trim="#1a3550")
    sp["z_stalker"] = infected("#a05ad0", "#ff4af0", suit="#2a2040", trim="#1a1530", legs="#1a1530")
    sp["z_alpha"] = art(BRUTE, {"S": "#e8503a", "e": "#ffffaa", "m": "#2a0d0d", "B": "#5a2a2a", "b": "#3a1a1a", "t": "#9a4a2a", "L": "#3a1a1a", "l": "#220f0f"})
    return sp
