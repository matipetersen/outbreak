#!/usr/bin/env python3
"""Build web/dist/outbreak.html: one self-contained file (no network, no dependencies).

Game content (eras, zombie presets, items, perks ...) is exported from the Python data packs so the
browser game can never drift from the terminal game.  Run:  python3 web/build.py
"""
import dataclasses
import json
import os
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.join(os.path.dirname(HERE), "src"))

from outbreak import content  # noqa: E402
from outbreak.content import companions, director, dialogue, pets, story  # noqa: E402,F401  (exported below)
from outbreak.engine import encounters, ending  # noqa: E402
from outbreak.config import DIFFICULTIES  # noqa: E402
from outbreak.engine.clock import START_HOUR, TURNS_PER_DAY, TURNS_PER_HOUR  # noqa: E402

JS_ORDER = ["util", "crafting", "audio", "model", "player", "worldgen", "chunks", "loot", "interiors", "cipher", "pathing", "spawn", "combat", "ai", "lives", "base", "ambience", "mutation", "raiders", "military", "wild", "companion", "contagion", "objective", "director", "pets", "mounts", "memory",
            "hordes", "encounters", "dialogue", "services", "front", "factions", "saga", "ending", "records", "inventory_ops", "setup", "game", "save"]
UI_ORDER = ["ui"]


def plain(obj):
    if dataclasses.is_dataclass(obj) and not isinstance(obj, type):
        return {f.name: plain(getattr(obj, f.name)) for f in dataclasses.fields(obj)}
    if isinstance(obj, dict):
        return {k: plain(v) for k, v in obj.items()}
    if isinstance(obj, (list, tuple)):
        return [plain(v) for v in obj]
    return obj


# Glyph alphabets for unreadable words that render on every phone font (the runic block often does not).
WEB_GLYPHS = {"medieval": "\u00de\u00fe\u00d0\u00f0\u00c6\u00e6\u0152\u0153\u00df\u014a\u014b\u0192", "scifi": "\u2592\u2591\u2593\u2588"}


def _flat(v):
    """JSON has no tuple keys: (era, kind) becomes \"era|kind\"."""
    return {("|".join(k) if isinstance(k, tuple) else k): x for k, x in v.items()} if isinstance(v, dict) else v


def dump_content() -> str:
    eras = plain(content.ERAS)
    for era_id, glyphs in WEB_GLYPHS.items():
        eras[era_id]["glyphs"] = glyphs
    data = {
        "eras": eras,
        "presets": plain(content.PRESETS),
        "specials": plain(content.SPECIALS),
        "scenarios": plain(content.SCENARIOS),
        "origins": plain(content.ORIGINS),
        "openings": plain(content.OPENINGS),
        "dialogue": {k: v for k, v in ((n, plain(getattr(dialogue, n))) for n in ("GIVEN", "ROLE_WORD", "PERSONAS", "RUMOURS", "MEDIEVAL_SWAPS"))},
        "story": {k: _flat(v) for k, v in vars(story).items() if k.isupper()},
        "opening_alarms": content.openings.ALARMS,
        "opening_consequence": content.openings.CONSEQUENCE,
        "opening_default_affinity": content.openings.DEFAULT_AFFINITY,
        "perks": plain(content.PERKS),
        "branches": list(content.BRANCHES),
        "branch_names": plain(content.perks.BRANCH_NAMES),
        "recipes": plain(list(content.RECIPES)),
        "difficulties": plain(DIFFICULTIES),
        "events": plain(list(encounters.EVENTS)),
        "win_endings": {f"{k[0]}|{k[1]}": list(v) for k, v in ending.WIN.items()},
        "companions": {"archetypes": plain(list(content.companions.ARCHETYPES)), "strengths": content.companions.STRENGTHS,
                       "flaws": content.companions.FLAWS, "role_archetype": content.companions.ROLE_ARCHETYPE,
                       "names": list(content.companions.NAMES), "combat": {k: list(v) for k, v in content.companions.COMBAT_LINES.items()}, "personal": content.companions.PERSONAL, "era_variants": _flat(content.companions.ERA_VARIANTS), "gear_say": {k: list(v) for k, v in content.companions.GEAR_SAY.items()}, "personal_variants": _flat(content.companions.PERSONAL_VARIANTS), "situation": {k: list(v) for k, v in content.companions.SITUATION_LINES.items()}},
        "director": {"stages": plain(list(content.director.STAGES)), "act_lines": {k: list(v) for k, v in content.director.ACT_LINES.items()},
                     "relief_events": list(content.director.RELIEF_EVENTS), "threat_events": list(content.director.THREAT_EVENTS)},
        "pets": {"species": plain(list(content.pets.PETS)), "names": list(content.pets.PET_NAMES)},
        "clock": {"turns_per_day": TURNS_PER_DAY, "turns_per_hour": TURNS_PER_HOUR, "start_hour": START_HOUR},
    }
    return "const CONTENT = " + json.dumps(data, separators=(",", ":"), ensure_ascii=False) + ";\n"


def read(*parts):
    with open(os.path.join(HERE, *parts), encoding="utf8") as fh:
        return fh.read()


def engine_js() -> str:
    parts = [dump_content()]
    for name in JS_ORDER:
        path = os.path.join(HERE, "src", name + ".js")
        if os.path.exists(path):
            parts.append(f"// ===== {name}.js =====\n" + read("src", name + ".js"))
    return "\n".join(parts)


def _icon_uri(name: str) -> str:
    import base64
    with open(os.path.join(HERE, "art", "icons", name), "rb") as fh:
        return "data:image/png;base64," + base64.b64encode(fh.read()).decode()


def icon_tags() -> str:
    """The home-screen icon (art/make_icon.py): favicon, iOS apple-touch-icon, and the pieces the web manifest is made from."""
    if not os.path.exists(os.path.join(HERE, "art", "icons", "icon-180.png")):
        return ""
    return (f'<link rel="icon" type="image/png" sizes="32x32" href="{_icon_uri("icon-32.png")}">\n'
            f'<link rel="apple-touch-icon" sizes="180x180" href="{_icon_uri("icon-180.png")}">')


def icon_data() -> str:
    if not os.path.exists(os.path.join(HERE, "art", "icons", "icon-512.png")):
        return ""
    return "const ICON_DATA = " + json.dumps({"192": _icon_uri("icon-192.png"), "512": _icon_uri("icon-512.png")}) + ";\n"


def sprite_data() -> str:
    """The sprite atlas (art/build_atlas.py, Kenney CC0 packs) inlined as a data URI.  Without it the game draws vectors."""
    import base64
    sets = {}
    for name in ("modern", "medieval", "scifi"):
        png, meta = os.path.join(HERE, "art", f"atlas_{name}.png"), os.path.join(HERE, "art", f"atlas_{name}.json")
        if not (os.path.exists(png) and os.path.exists(meta)):
            continue
        with open(png, "rb") as fh:
            src = "data:image/png;base64," + base64.b64encode(fh.read()).decode()
        data = json.load(open(meta))
        data["src"] = src
        sets[name] = data
    if not sets:
        return ""
    return "const SPRITE_DATA = " + json.dumps({"sets": sets, "era": {"medieval": "medieval", "scifi": "scifi"}, "default": "modern"}) + ";\n"


def main() -> None:
    os.makedirs(os.path.join(HERE, "dist"), exist_ok=True)
    import re
    engine = engine_js()
    names = sorted(set(re.findall(r"^(?:function|class|const|let)\s+([A-Za-z_$][\w$]*)", engine, re.M)))
    export = ("\nif (typeof module !== 'undefined') { const __x = {}; for (const n of " + json.dumps(names) +
              ") { try { __x[n] = eval(n); } catch (e) { /* not initialised */ } } module.exports = __x; }\n")
    with open(os.path.join(HERE, "dist", "engine.js"), "w", encoding="utf8") as fh:
        fh.write(engine + export)
    ui = "\n".join(read("src", n + ".js") for n in UI_ORDER)
    ui = sprite_data() + icon_data() + ui
    pieces = {
        "/*__CSS__*/": read("src", "style.css"),
        "/*__BODY__*/": read("src", "body.html"),
        "/*__ENGINE__*/": engine.replace("</script", "<\\/script"),
        "/*__UI__*/": ui.replace("</script", "<\\/script"),
    }
    # 1. a complete standalone document
    html = read("src", "index.template.html")
    html = html.replace("<!--__ICONS__-->", icon_tags())
    for key, val in pieces.items():
        html = html.replace(key, val)
    out = os.path.join(HERE, "dist", "outbreak.html")
    with open(out, "w", encoding="utf8") as fh:
        fh.write(html)
    # 2. the same page as a fragment for hosts that supply their own <html>/<head>/<body>
    frag = ("<title>OUTBREAK</title>\n" + icon_tags() + "\n" + FONT_LINK + "\n<style>\n" + pieces["/*__CSS__*/"] + "\n</style>\n" + pieces["/*__BODY__*/"] +
            "\n<script>\n" + pieces["/*__ENGINE__*/"] + "\n</script>\n<script>\n" + pieces["/*__UI__*/"] + "\n</script>\n")
    out2 = os.path.join(HERE, "dist", "outbreak.fragment.html")
    with open(out2, "w", encoding="utf8") as fh:
        fh.write(frag)
    print(f"wrote {out} ({os.path.getsize(out) / 1024:.0f} KiB) and {os.path.basename(out2)}")


FONT_LINK = ('<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=IBM+Plex+Mono:wght@400;500&'
             'family=IBM+Plex+Sans:wght@400;500;600&family=Special+Elite&display=swap">')

if __name__ == "__main__":
    main()
