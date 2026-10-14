"""Where you are going, said in the log: changes to your objectives and a line each morning."""
from __future__ import annotations

WATCH_EVERY = 10


def _snapshot(game) -> dict:
    snap = {n: (done, hint) for n, done, hint in game.requirements()}
    site = game.pois[game.final_site_id]
    snap[game.scenario.final_verb.capitalize()] = (False, site.name if site.revealed else "location unknown")
    return snap


def watch(game) -> None:
    t = game.clock.turn
    if t % WATCH_EVERY:
        return
    now, before = _snapshot(game), getattr(game, "objective_seen", None) or {}
    game.objective_seen = now
    if not before:
        first = next(((n, h) for n, (done, h) in now.items() if not done), None)
        if first:
            game.msg(f"Goal: {first[0]} ({first[1]}).", "obj")
        return
    for name, (done, hint) in now.items():
        old = before.get(name)
        if old is None:
            continue
        if done and not old[0]:
            game.msg(f"Done: {name}.", "obj", key=True)
        elif not done and old[0]:
            game.msg(f"Lost: {name}.", "obj")
        elif hint != old[1] and not done:
            game.msg(f"{name}: {hint}.", "obj")
    if t % 240 == 0:
        nxt = next(((n, h) for n, (done, h) in now.items() if not done), None)
        if nxt:
            game.msg(f"Day {game.clock.day}. Still to do: {nxt[0]} ({nxt[1]}).", "obj")
