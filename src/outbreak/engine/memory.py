"""The world remembers: where you fought, who you buried, and who got away.

* **Marks** are places that keep what happened there: a bad fight, a grave.  Walk back near one, long after, and the log says so.
  Graves show on the map.
* **Nemeses** are people who fled from you alive.  They are named and scarred; later the Director may send them back, stronger
  and angry, and killing one is remembered too.
"""
from __future__ import annotations

from dataclasses import dataclass
from typing import List

from outbreak.util import cheb

MAX_MARKS = 18
FIGHT_KILLS = 4                 # this many kills close together in time and space make a battlefield
FIGHT_WINDOW = 40
FIGHT_RADIUS = 8
REVISIT_RANGE = 4
REVISIT_AFTER = 300             # a mark speaks again only after this long
NEMESIS_NAMES = ("Vask", "Grell", "Dutch", "Harrow", "Pike", "Sloan", "Crane", "Moss", "Rourke", "Teague", "Brandt", "Skeet")
EPITHETS = ("the Scarred", "One-Ear", "the Limp", "Redhand", "the Hollow", "Gutter", "the Grin")
MAX_NEMESES = 3


@dataclass
class Mark:
    kind: str               # fight | grave
    x: int
    y: int
    level_id: str
    turn: int
    text: str
    shown: int = -9999


def _marks(game) -> List[Mark]:
    m = getattr(game, "marks", None)
    if m is None:
        m = game.marks = []
    return m


def _nemeses(game) -> list:
    n = getattr(game, "nemeses", None)
    if n is None:
        n = game.nemeses = []
    return n


def add(game, kind: str, pos, text: str) -> Mark:
    marks = _marks(game)
    for m in marks:
        if m.kind == kind == "fight" and m.level_id == game.level.id and cheb((m.x, m.y), pos) <= FIGHT_RADIUS:
            m.turn, m.text = game.clock.turn, text                     # the same battlefield, fought over again
            return m
    mark = Mark(kind, pos[0], pos[1], game.level.id, game.clock.turn, text)
    marks.append(mark)
    if len(marks) > MAX_MARKS:
        for i, m in enumerate(marks):
            if m.kind == "fight":
                del marks[i]
                break
        else:
            del marks[0]
    return mark


def graves(game, level_id: str) -> List[Mark]:
    return [m for m in _marks(game) if m.kind == "grave" and m.level_id == level_id]


# ------------------------------------------------------------------ every few turns
def tick(game) -> None:
    t, p = game.clock.turn, game.player
    if t % 10:
        return
    kills = p.stats.get("zombies", 0) + p.stats.get("humans", 0) + sum(getattr(a, "kills", 0) for a in _allies(game))
    last = getattr(game, "_kills_seen", kills)
    game._kills_seen = kills
    window = getattr(game, "_kill_log", None)
    if window is None:
        window = game._kill_log = []
    if kills > last:
        window.append((t, p.pos, kills - last))
    window[:] = [w for w in window if t - w[0] <= FIGHT_WINDOW]
    near = [w for w in window if cheb(w[1], p.pos) <= FIGHT_RADIUS]
    if sum(w[2] for w in near) >= FIGHT_KILLS and not any(m.kind == "fight" and cheb((m.x, m.y), p.pos) <= FIGHT_RADIUS
                                                         and t - m.turn < 120 for m in _marks(game)):
        add(game, "fight", p.pos, f"Day {game.clock.day}: you made a stand here. Old stains, and bones nobody buried.")
    _revisit(game, t)
    _prune_nemeses(game)


def _allies(game):
    from outbreak.engine import companion, pets
    return [a for a in (companion.current(game), pets.current(game)) if a is not None]


def _revisit(game, t: int) -> None:
    p, lid = game.player, game.level.id
    for m in _marks(game):
        if m.level_id == lid and cheb((m.x, m.y), p.pos) <= REVISIT_RANGE and t - m.turn > 200 and t - m.shown > REVISIT_AFTER:
            m.shown = t
            game.msg(m.text, "lore", key=(m.kind == "grave"))
            if m.kind == "grave":
                game.add_panic(4, raw=True)
            return


# ------------------------------------------------------------------ graves
def on_ally_death(game, name: str, kind: str, farewell: str, pos) -> None:
    add(game, "grave", pos, f"{name}'s grave. A cairn you made out of whatever was close. You remember what they said: {farewell}")


# ------------------------------------------------------------------ nemeses
def on_flee(game, h) -> None:
    """A raider or soldier broke and ran: if it lives, it will remember you."""
    from outbreak.engine.model import Human
    if not isinstance(h, Human) or h.role not in ("raider", "soldier") or h.title:
        return
    ns = _nemeses(game)
    if len(ns) >= MAX_NEMESES or any(n["uid"] == h.uid for n in ns):
        return
    rng = game.rng
    name = rng.choice([n for n in NEMESIS_NAMES if n not in {x["name"] for x in ns}] or NEMESIS_NAMES)
    h.title = rng.choice(EPITHETS)
    h.name = f"{name} {h.title}"
    ns.append({"uid": h.uid, "name": h.name, "role": h.role, "day": game.clock.day})
    game.msg(f"{h.name} runs. You will see that face again.", "lore")


def _prune_nemeses(game) -> None:
    ns = _nemeses(game)
    if not ns:
        return
    alive = {a.uid for a in game.world.level.actors if getattr(a, "hp", 0) > 0}
    ns[:] = [n for n in ns if n["uid"] in alive]


def on_kill_human(game, h) -> None:
    ns = _nemeses(game)
    for n in list(ns):
        if n["uid"] == h.uid:
            ns.remove(n)
            game.msg(f"{n['name']} is dead. Whatever they were owed, it is settled.", "lore", key=True)
            game.player.gain_xp(40)


def revenge(game, before_uid: int) -> bool:
    """A nemesis comes back with the next ambush: the freshest raider takes their name, scars and a grudge."""
    ns = _nemeses(game)
    pending = [n for n in ns if not n.get("back")]
    if not pending:
        return False
    lv = game.level
    fresh = [a for a in lv.actors if getattr(a, "role", "") == "raider" and a.uid > before_uid and a.hp > 0]
    if not fresh:
        return False
    n = pending[0]
    old = next((a for a in game.world.level.actors if a.uid == n["uid"]), None)
    if old is not None:
        game.world.level.remove_actor(old)
    h = fresh[0]
    n["uid"], n["back"] = h.uid, True                      # remembered still: killing this one settles it
    h.name, h.title = n["name"], n["name"].split(" ", 1)[-1]
    h.max_hp = h.hp = int(h.max_hp * 1.4)
    h.dmg = (h.dmg[0] + 1, h.dmg[1] + 2)
    h.morale = 100
    game.msg(f"{h.name} is among them, with a grudge and a limp. \"I told you I would find you.\"", "dir", key=True)
    return True
