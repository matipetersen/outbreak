"""Turn game state into a drawable view.  No curses here: the result is plain
data (rows of coloured cells), so it is easy to test and to print headlessly."""
from __future__ import annotations

from dataclasses import dataclass
from typing import List, Optional, Tuple

from outbreak.engine import ambience, mutation
from outbreak.engine import tiles as T
from outbreak.engine.game import Game
from outbreak.engine import companion, director, memory, pets
from outbreak.engine.model import Animal, Human, Zombie
from outbreak.util import Pos, cheb, compass, dist_words

Cell = Tuple[str, str, bool]          # glyph, colour name, bold
Line = Tuple[str, str]                # text, colour name

POI_LETTER = {"cave": "n", "medical": "M", "market": "$", "guard": "P", "lab": "L", "transit": "U", "military": "A",
              "faith": "C", "industry": "F", "refuge": "R", "pad": "E", "house": "h"}
ZOMBIE_COLOR = {"walker": "red", "crawler": "red", "brute": "magenta", "bloater": "green", "screamer": "yellow",
                "leaper": "red", "clicker": "cyan", "stalker": "magenta", "alpha": "magenta"}
TAG_COLOR = {"obj": "yellow", "ally": "magenta", "info": "white", "good": "green", "bad": "red", "warn": "yellow", "combat": "grey",
             "lore": "cyan", "loud": "yellow"}
BLANK: Cell = (" ", "grey", False)


@dataclass
class View:
    map_rows: List[List[Cell]]
    side: List[Line]
    log: List[Line]
    origin: Pos = (0, 0)              # world coordinates of the top-left map cell

    def map_text(self) -> str:
        return "\n".join("".join(c[0] for c in row) for row in self.map_rows)

    def to_text(self) -> str:
        return self.map_text() + "\n" + "\n".join(t for t, _ in self.side) + "\n" + "\n".join(t for t, _ in self.log)


def bar(value: float, maximum: float, width: int = 10) -> str:
    maximum = max(1.0, maximum)
    filled = int(round(width * max(0.0, min(1.0, value / maximum))))
    return "[" + "#" * filled + "-" * (width - filled) + "]"


# ------------------------------------------------------------------ map
def _glyph(game: Game, x: int, y: int, visible: bool) -> Cell:
    lv = game.level
    t = lv.tile(x, y)
    info = T.TILES[t]
    ch, color, bold = info.glyph, info.color, False
    portal = lv.portals.get((x, y))
    if portal is not None and t == T.PORTAL:
        if portal.target == "world":
            ch, color, bold = "^", "yellow", True
        else:
            poi = game.pois.get(portal.target.rsplit(":", 1)[0])
            ch, color, bold = (POI_LETTER.get(poi.kind, "H") if poi else "H"), "white", True
    if t == T.LOCKED:
        ch, color, bold = "+", "red", True
    elif t == T.STAIRS_UP:
        ch, color, bold = "<", "green", True                  # stairs must not hide among floor tiles
    elif t == T.STAIRS_DOWN:
        ch, color, bold = ">", "magenta", True
    if lv.kind == "overworld" and any(s["pos"] == (x, y) for s in ambience.heard_sources(game)):
        return ("!", "magenta", True)                       # something is sounding there
    if not visible:
        return (ch, "grey", False)
    hz = lv.hazards.get((x, y))
    if hz is not None and hz.kind == "snare":
        if not hz.hidden:
            return ("x", "red", True)
        hz = None
    if hz is not None:
        if hz.kind == "spikes":
            return ("*", "yellow", True)
        return ("^" if hz.kind == "fire" else "~", "red" if hz.kind == "fire" else "green", True)
    if (x, y) in lv.corpses and t in (T.FLOOR, T.GRASS, T.ROAD, T.BRUSH, T.SHALLOW):
        ch, color = "x", "grey"
    if (x, y) in lv.docs:
        ch, color, bold = "?", "cyan", True
    if (x, y) in lv.items:
        ch, color, bold = "!", "yellow", True
    return (ch, color, bold)


def _actor_cell(a) -> Cell:
    if a.is_player:
        return ("@", "white", True)
    if isinstance(a, Zombie):
        return (a.glyph, ZOMBIE_COLOR.get(a.special, "red"), "boss" in a.flags)
    if isinstance(a, Human):
        return (a.glyph, "yellow" if a.hostile else "cyan", True)
    if isinstance(a, Animal):
        return (a.glyph, "magenta" if a.pet else "cyan" if a.stray else "green", a.pet)
    return ("?", "white", False)


def build_map(game: Game, w: int, h: int, cursor: Optional[Pos] = None) -> Tuple[List[List[Cell]], Pos]:
    lv, p = game.level, game.player
    ox = max(0, min(lv.w - w, p.x - w // 2)) if lv.w > w else -((w - lv.w) // 2)
    oy = max(0, min(lv.h - h, p.y - h // 2)) if lv.h > h else -((h - lv.h) // 2)
    rows: List[List[Cell]] = []
    for sy in range(h):
        y = oy + sy
        row: List[Cell] = []
        for sx in range(w):
            x = ox + sx
            if not lv.in_bounds(x, y):
                row.append(BLANK)
                continue
            vis = (x, y) in game.visible
            if not vis and not lv.seen[y][x]:
                row.append(BLANK)
                continue
            row.append(_glyph(game, x, y, vis))
        rows.append(row)
    # known buildings you cannot currently see
    if lv.kind == "overworld":
        for poi in game.pois.values():
            if poi.kind == "breach" or not (poi.revealed or poi.visited):
                continue
            sx, sy = poi.x - ox, poi.y - oy
            if 0 <= sx < w and 0 <= sy < h and rows[sy][sx][0] == " ":
                rows[sy][sx] = (POI_LETTER.get(poi.kind, "H"), "magenta", True)
            elif 0 <= sx < w and 0 <= sy < h and poi.pos not in game.visible:
                rows[sy][sx] = (POI_LETTER.get(poi.kind, "H"), "magenta", True)
    for m in memory.graves(game, lv.id):                                  # whoever you buried
        sx, sy = m.x - ox, m.y - oy
        if 0 <= sx < w and 0 <= sy < h and lv.seen[m.y][m.x] and rows[sy][sx][0] in (" ", ".", ",", '"'):
            rows[sy][sx] = ("+", "yellow", True)
    for a in lv.actors:
        if a.pos in game.visible and not getattr(a, "hidden", False):
            sx, sy = a.x - ox, a.y - oy
            if 0 <= sx < w and 0 <= sy < h:
                rows[sy][sx] = _actor_cell(a)
    sx, sy = p.x - ox, p.y - oy
    if 0 <= sx < w and 0 <= sy < h:
        rows[sy][sx] = ("@", "white", True)
    if cursor is not None:
        cx, cy = cursor[0] - ox, cursor[1] - oy
        if 0 <= cx < w and 0 <= cy < h:
            ch, color, _ = rows[cy][cx]
            rows[cy][cx] = ("X" if ch == " " else ch, "yellow", True)
    return rows, (ox, oy)


# ------------------------------------------------------------------ sidebar
def _hours(turns: int) -> str:
    return f"{turns / 10:.0f}h" if turns >= 20 else f"{turns} turns"


def build_side(game: Game) -> List[Line]:
    p, c, era = game.player, game.clock, game.era
    lv = game.level
    out: List[Line] = []
    out.append((f"{game.era.origin_names[game.cfg.origin]}  Lv{p.level}", "white"))
    weather = f"  {game.weather}" if game.weather != "clear" and game.level.kind == "overworld" else ""
    out.append((f"{c.stamp()}  {c.phase}{weather}", "cyan" if c.is_night else "yellow"))
    out.append((lv.name[:28], "grey"))
    reg = mutation.here(game)
    out.append((f"{reg.name[:20]}: {mutation.traits_text(reg)}"[:30], "red" if reg.traits else "grey"))
    out.append(("", "grey"))
    hp_color = "green" if p.hp > p.max_hp * 0.5 else "yellow" if p.hp > p.max_hp * 0.25 else "red"
    out.append((f"HP    {bar(p.hp, p.max_hp)} {p.hp}", hp_color))
    out.append((f"Stam  {bar(p.stamina, p.max_stamina)}", "white"))
    pc = "green" if p.panic < 40 else "yellow" if p.panic < 75 else "red"
    out.append((f"Panic {bar(p.panic, p.max_panic)}", pc))
    hc = "green" if p.humanity >= 60 else "yellow" if p.humanity >= 25 else "red"
    out.append((f"Human {bar(p.humanity, 100)} {p.humanity}", hc))
    if game.cfg.mode == "living":
        out.append((f"Survivor #{game.generation}  fallen {len(game.fallen)}", "grey"))
    out.append((f"Noise {bar(game.heat, 100)}", "red" if game.heat > 60 else "yellow" if game.heat > 30 else "grey"))
    if game.cfg.needs:
        out.append((f"Hungr {bar(p.hunger, 100)}", "red" if p.hunger > 75 else "grey"))
    if p.infected:
        extra = f"  cut it off! {p.bite_window}" if p.bite_window > 0 and p.bite_limb in ("arm", "leg") else ""
        out.append((f"INFECTED {_hours(p.infection_timer)} left{extra}", "red"))
    flags = []
    if p.bleeding:
        flags.append("bleeding")
    if p.fracture:
        flags.append("broken leg")
    if p.lost:
        flags.append("no " + "/".join(p.lost))
    if p.disguise_turns:
        flags.append("disguised")
    if p.filter_turns:
        flags.append("filtered")
    if p.sneaking:
        flags.append("sneaking")
    if p.sprinting:
        flags.append("running")
    if flags:
        out.append((", ".join(flags), "yellow"))
    out.append(("", "grey"))
    out.append((_equip_line(game, p.weapon, "Hand"), "white"))
    if p.armor:
        out.append((_equip_line(game, p.armor, "Wear"), "white"))
    if p.light:
        state = "on" if p.light_on else "off"
        out.append((f"Light {game.item_def(p.light.id).name} ({p.light.dur}) {state}", "white"))
    out.append((f"{era.coin.title()}: {p.coins}   XP {p.xp}", "grey"))
    if p.perk_points:
        out.append((f"{p.perk_points} perk point(s)! (p)", "green"))
    out.append(("", "grey"))
    for text, done in game.objectives()[:5]:
        out.append((("[x] " if done else "[ ] ") + text, "green" if done else "white"))
    if game.final:
        f = game.final
        if f.exit is not None:
            out.append((f"GET OUT: {f.exit_name}, {dist_words(game.era.id, max(abs(f.exit[0] - game.player.x), abs(f.exit[1] - game.player.y)))}", "red"))
        else:
            out.append((f"HOLD OUT: {f.turns_left} turns", "red"))
    ally = companion.current(game)
    out.append(("", "grey"))
    if ally is not None:
        waiting = " (waiting)" if ally.state == "wait" else ""
        out.append((f"With you: {ally.name}{waiting}", "magenta"))
        out.append((f" {companion.arch_of(ally).label}  hp {ally.hp}/{ally.max_hp}  {companion.bond_word(ally)}", "magenta"))
    else:
        out.append(("Alone." + (f" Lost: {', '.join(n for n, _ in game.fallen_allies[-2:])}" if game.fallen_allies else ""), "grey"))
    pet = pets.current(game)
    if pet is not None:
        out.append((f"Pet: {pet.name} the {pet.species} ({pets.hunger_of(game, pet)}, hp {pet.hp}/{pet.max_hp})", "magenta"))
    mood = director.status(game)
    if mood:
        out.append((mood, "grey"))
    hostiles = sorted(game.visible_hostiles(), key=lambda a: cheb(a.pos, p.pos))
    if hostiles:
        out.append(("", "grey"))
        out.append(("In view:", "grey"))
        for a in hostiles[:4]:
            out.append((f" {a.glyph} {a.name} {cheb(a.pos, p.pos)}", ZOMBIE_COLOR.get(getattr(a, 'special', ''), "yellow")))
    return out


def _equip_line(game: Game, item, label: str) -> str:
    if item is None:
        return f"{label}: fists" if label == "Hand" else f"{label}: none"
    d = game.item_def(item.id)
    extra = f" ({item.dur}/{d.durability})" if d.durability and item.dur is not None else ""
    if d.ammo:
        extra += f" [{game.player.count(d.ammo)} {game.item_def(d.ammo).name.lower()}]"
    return f"{label}: {d.name}{extra}"


def build_log(game: Game, lines: int, width: int, full: bool = False) -> List[Line]:
    """The log: by default only what matters (objectives, your companion, key events) under a pinned goal; ``full`` shows all."""
    source = game.log if full or not getattr(game, "story", None) else game.story_log()
    out: List[Line] = []
    for turn, text, tag in source[-lines * 2:]:
        color = TAG_COLOR.get(tag, "white")
        while len(text) > width:
            cut = text.rfind(" ", 0, width)
            cut = cut if cut > 10 else width
            out.append((text[:cut], color))
            text = "  " + text[cut:].lstrip()
        out.append((text, color))
    if full or lines < 3:
        return out[-lines:]
    goal = next((t for t, done in game.objectives() if not done), None)
    out = out[-(lines - 1):]
    return ([(f"GOAL  {goal}"[:width], "yellow")] + out) if goal else out


def build_view(game: Game, map_w: int, map_h: int, log_lines: int = 6, log_w: int = 100,
               cursor: Optional[Pos] = None, full_log: bool = False) -> View:
    rows, origin = build_map(game, map_w, map_h, cursor)
    return View(rows, build_side(game), build_log(game, log_lines, log_w, full_log), origin)


def places(game: Game) -> List[Tuple[str, str]]:
    """Known buildings with direction and distance, for the 'places' screen."""
    p = game.player
    out = []
    for poi in sorted(game.pois.values(), key=lambda q: cheb(q.pos, p.pos)):
        if poi.kind == "breach" or not (poi.revealed or poi.visited):
            continue
        d = cheb(poi.pos, p.pos)
        mark = "visited" if poi.visited else "known"
        if poi.papers and not poi.visited:
            mark += ", papers rumoured"
        out.append((f"{POI_LETTER.get(poi.kind, 'H')}  {poi.name:<28} {compass(poi.x - p.x, poi.y - p.y):<11} {dist_words(game.era.id, d):>14}  {mark}",
                    "magenta" if poi.id == game.final_site_id else "white"))
    return out
