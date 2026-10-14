"""Difficulty matrix: the bot played over every zombie preset x era (x difficulty), to see which options bite.

    PYTHONPATH=src:. python3 tools/matrix.py [turns] [seeds]

It reports, per option, how many runs were still alive at the end and how long the dead lasted.  The bot is deliberately
simple, so read the numbers as "relative lethality", not as how a person fares.
"""
import statistics as st
import sys
from concurrent.futures import ProcessPoolExecutor

from tests import helpers
from outbreak import content
from outbreak.bot import play


def one(args):
    era, zombies, difficulty, scenario, seed, turns = args
    g = helpers.make_game(seed=seed, era=era, zombies=zombies, difficulty=difficulty, scenario=scenario)
    play(g, turns, seed=seed)
    return (era, zombies, difficulty, scenario, g.clock.turn, g.over.kind if g.over else "alive", g.player.level)


def main(turns=1500, seeds=3):
    jobs = []
    for z in content.PRESETS:
        for era in content.ERAS:
            for s in range(seeds):
                jobs.append((era, z, "normal", "dash", 200 + s, turns))
    for d in ("easy", "hard"):
        for era in content.ERAS:
            for s in range(seeds):
                jobs.append((era, "classic", d, "dash", 200 + s, turns))
    with ProcessPoolExecutor() as ex:
        rows = list(ex.map(one, jobs, chunksize=2))

    def table(title, key):
        groups = {}
        for r in rows:
            groups.setdefault(key(r), []).append(r)
        print(f"\n== {title} ==  (bot, {turns} turns, {seeds} seeds per era)")
        for k, rs in groups.items():
            alive = sum(1 for r in rs if r[5] == "alive")
            died = [r[4] for r in rs if r[5] != "alive"]
            print(f"{str(k):22s} alive {alive:2d}/{len(rs):2d}   mean death turn {int(st.mean(died)) if died else '-':>5}   avg level {st.mean(r[6] for r in rs):.1f}")

    table("by zombie preset (normal)", lambda r: r[1] if r[2] == "normal" else None) if False else None
    normal = [r for r in rows if r[2] == "normal"]
    rows_n = rows
    rows = normal
    table("by zombie preset (normal difficulty)", lambda r: r[1])
    table("by era (normal difficulty)", lambda r: r[0])
    rows = [r for r in rows_n if r[1] == "classic"]
    table("by difficulty (classic zombies)", lambda r: r[2])


if __name__ == "__main__":
    main(*(int(a) for a in sys.argv[1:]))
