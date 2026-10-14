"""Animal sprites, 16x16, side view facing right, drawn pixel by pixel (CC0, like the rest).  Same ASCII helper as scifi.py.
``variant`` 'wild' is natural colour; 'scifi' keeps the shapes and adds a glow (eyes, collar lights) for the station."""
from PIL import Image

S = 16


def _C(h):
    h = h.lstrip("#")
    return (int(h[0:2], 16), int(h[2:4], 16), int(h[4:6], 16), 255)


def _art(rows, pal):
    assert len(rows) == S, len(rows)
    im = Image.new("RGBA", (S, S), (0, 0, 0, 0))
    px = im.load()
    for y, row in enumerate(rows):
        assert len(row) == S, (y, row)
        for x, ch in enumerate(row):
            if ch != ".":
                px[x, y] = _C(pal.get(ch, pal["k"]))
    return im


# k outline, f fur, F light fur, d dark fur, e eye, n nose, a accent, t tail tip, w white
RABBIT = [
    "................",
    "................",
    "................",
    ".........kk.....",
    "........kfFk....",
    "........kfFk....",
    "........kffk....",
    "...kkk.kkffkk...",
    "..kFFfkkfffefk..",
    "..kFFffffffffnk.",
    "...kfffffffffk..",
    "....kffffFFfk...",
    "....kdkkkkdk....",
    "................",
    "................",
    "................",
]
DEER = [
    "................",
    "..........a.a...",
    "..........aaa...",
    "...........aa.a.",
    "..........kffka.",
    ".........kfffek.",
    "..kk.....kffffn.",
    ".kffkkkkkkfffk..",
    ".kfffffffffffk..",
    ".kfffffffffFFk..",
    ".kFFFFFFFFFFFk..",
    "..kkfkkkkkfkk...",
    "...kdk....kdk...",
    "...kdk....kdk...",
    "...kk......kk...",
    "................",
]
BOAR = [
    "................",
    "................",
    "................",
    "................",
    "...kkkkkkk......",
    "..kddddddddkk...",
    ".kdddfdfdddddkk.",
    ".kdfdddddddddddk",
    ".kddddddddddkaek",
    ".kdddddddddddnnk",
    ".kddddddddddkaak",
    "..kkddkkkkddkk..",
    "...kdk....kdk...",
    "...kkk....kkk...",
    "................",
    "................",
]
WOLF = [
    "................",
    "................",
    "................",
    "..........k.k...",
    ".........kfkfk..",
    "..kk.....kfffek.",
    ".kffkkkkkkffffnk",
    ".kfffffffffffk..",
    "kffffffffffffk..",
    "kfFFFFFFFFFfk...",
    ".kkfkkkkkkfkk...",
    "...kfk....kfk...",
    "...kfk....kfk...",
    "...kkk....kkk...",
    "................",
    "................",
]
DOG = [
    "................",
    "................",
    "................",
    "................",
    "..........kk....",
    ".........kdfkk..",
    "..kk.....kdffek.",
    ".kffkkkkkkfffffn",
    ".kfffffffffaaak.",
    ".kffffffffffffk.",
    ".kFFFFFFFFFFFk..",
    "..kkfkkkkkfkk...",
    "...kfk....kfk...",
    "...kFk....kFk...",
    "...kk......kk...",
    "................",
]
CAT = [
    "................",
    "................",
    "...k............",
    "...kk......k.k..",
    "....kk....kfkfk.",
    "....kfk...kfffek",
    "...kfffkkkkffffn",
    "..kfdfdfffffffk.",
    "..kfffffffffFFk.",
    "..kfdfdfffffFFk.",
    "...kkfffffffkk..",
    "....kfk...kfk...",
    "....kFk...kFk...",
    "....kk....kk....",
    "................",
    "................",
]
CROW = [
    "................",
    "................",
    "................",
    "................",
    "........kkk.....",
    ".......kffek....",
    ".......kfffbbk..",
    "...kk.kkffkk....",
    "..kffkkfffffk...",
    ".kfffffffffffk..",
    ".kfffffffffffk..",
    "..kkffffffffk...",
    "....kkkfkkfkk...",
    ".......kk.kk....",
    "................",
    "................",
]
FOX = [
    "................",
    "................",
    "................",
    "..........k.k...",
    ".........kfkfk..",
    "..kkk....kfffek.",
    ".kfffkkkkkffffnk",
    "kftfffffffffffk.",
    "kttffffffffFFk..",
    ".kkfffffffFFFk..",
    "..kkfkkkkkfkk...",
    "...kdk....kdk...",
    "...kdk....kdk...",
    "...kkk....kkk...",
    "................",
    "................",
]

PALETTES = {
    "rabbit": {"k": "#2b2018", "f": "#a8896a", "F": "#e9dfcf", "e": "#1a1a1a", "n": "#e89aa0"},
    "deer": {"k": "#2b1c12", "f": "#a8693a", "F": "#e6cfa0", "d": "#6a3f22", "e": "#1a1a1a", "n": "#3a2a22", "a": "#d7c7a0"},
    "boar": {"k": "#1a1410", "d": "#5d4636", "f": "#7a5e49", "e": "#e8d8b8", "n": "#d68a8a", "a": "#f2eedd"},
    "wolf": {"k": "#1c1f26", "f": "#868b96", "F": "#c4c8d0", "e": "#ffd24a", "n": "#16181d"},
    "dog": {"k": "#2b1c12", "f": "#c28f4a", "F": "#ecd4a8", "d": "#7a4f26", "e": "#1a1a1a", "n": "#2a1a14", "a": "#d9453a"},
    "cat": {"k": "#2b1c12", "f": "#e29a45", "F": "#f6dcb0", "d": "#a8601f", "e": "#7aff9a", "n": "#e89aa0"},
    "crow": {"k": "#0c0d14", "f": "#262a3a", "e": "#e8e8f0", "b": "#d6c47a"},
    "fox": {"k": "#2b1408", "f": "#dd6a2c", "F": "#f4e4d0", "d": "#3a2418", "e": "#1a1a1a", "n": "#16100c", "t": "#ffffff"},
}
SHAPES = {"rabbit": RABBIT, "deer": DEER, "boar": BOAR, "wolf": WOLF, "dog": DOG, "cat": CAT, "crow": CROW, "fox": FOX}

# the station's version: the same animals, with lit eyes and a faint metallic tint (strays that lived off the hydroponics)
SCIFI_PAL = {
    "rabbit": {"e": "#6af0ff", "f": "#9aa6b8", "F": "#dfe9f2", "n": "#7ad8ff"},
    "deer": {"e": "#6af0ff", "a": "#7ad8ff", "f": "#8a7a9a", "d": "#5a4a6a"},
    "boar": {"e": "#ffd24a", "a": "#9af4ff", "f": "#5a6a74", "d": "#3f4d58"},
    "wolf": {"e": "#ff5a5a", "f": "#6f7a92", "F": "#b4c0d6"},
    "dog": {"e": "#6af0ff", "a": "#33e0ff", "f": "#a08a6a"},
    "cat": {"e": "#ff6af0", "f": "#7a8aa8", "F": "#cdd8ea", "d": "#4a566e"},
    "crow": {"e": "#33e0ff", "f": "#1f2a3a", "b": "#7ad8ff"},
    "fox": {"e": "#33e0ff", "f": "#a860e0", "F": "#e8d8ff", "d": "#2a1a40", "t": "#6af0ff"},
}


def sprites(variant="wild"):
    out = {}
    for name, rows in SHAPES.items():
        pal = dict(PALETTES[name])
        if variant == "scifi":
            pal.update(SCIFI_PAL[name])
        out["a_" + name] = _art(rows, pal)
    return out
