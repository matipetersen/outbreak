"""Balance probes for the newer systems: wolves, boar, caves, forage, and who kills the bot.
Run:  PYTHONPATH=src python3 tools/balance.py [wolves|boar|caves|food|bot|all]"""
import os
import random
import statistics as st
import sys

sys.path.insert(0, os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "src"))
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from tests import helpers  # noqa: E402
from outbreak.engine import tiles as T, wild  # noqa: E402
from outbreak.engine.model import Animal, Item, Zombie  # noqa: E402

ERAS = ("medieval", "eighties", "modern", "scifi")


def best_weapon(g):
    """The best non-ranged weapon the era offers as plain loot (what a mid-game player might carry)."""
    cands = [d for d in g.items.values() if d.kind == "weapon" and not d.is_ranged and d.rarity <= 2]
    return max(cands, key=lambda d: sum(d.dmg) * (1 + (d.reach - 1) * 0.2))


def grove(g, trees=True):
    lv = g.world.level
    helpers.empty_level_of_enemies(lv)
    g.hordes.clear()
    g.ring = None
    p = g.player
    for y in range(p.y - 14, p.y + 15):
        for x in range(p.x - 16, p.x + 17):
            lv.set_tile(x, y, T.GRASS)
    if trees:
        for y in range(p.y - 2, p.y + 3):
            for x in range(p.x - 2, p.x + 3):
                if (x, y) != p.pos:
                    lv.set_tile(x, y, T.TREE if (x + y) % 3 else T.GRASS)
    return lv


def fight(species, n, era, seed, weapon="best", armor=False, sneak=False, approach=False, turns=120):
    """A player stands his ground against n animals that start 8 tiles away.  Returns (won, hp_lost, turns)."""
    g = helpers.make_game(seed=seed, era=era)
    lv = grove(g, trees=False)
    p = g.player
    p.infected = False
    d = best_weapon(g) if weapon == "best" else None
    if d:
        p.weapon = Item(d.id, 1, d.durability or None)
    if armor:
        a = min((x for x in g.items.values() if x.kind == "armor" and x.defense > 0), key=lambda x: x.defense)
        p.armor = Item(a.id, 1, a.durability or None)
    p.hp = p.max_hp
    hp0 = p.hp
    rng = random.Random(seed)
    beasts = []
    for i in range(n):
        a = wild.make_animal(g, p.x + 8 + (i % 2), p.y + 2 * i - n // 2 * 2, species)
        lv.add_actor(a)
        beasts.append(a)
    p.sneaking = sneak
    for turn in range(turns):
        if g.over:
            break
        g.clock.turn = max(g.clock.turn, 1000) + 1 if turn == 0 else g.clock.turn
        alive = [b for b in beasts if b in lv.actors and b.hp > 0]
        if not alive:
            return True, hp0 - p.hp, turn
        near = [b for b in alive if max(abs(b.x - p.x), abs(b.y - p.y)) == 1]
        if near:
            tgt = min(near, key=lambda b: b.hp)
            g.move(tgt.x - p.x, tgt.y - p.y)
        elif approach:
            tgt = min(alive, key=lambda b: max(abs(b.x - p.x), abs(b.y - p.y)))
            dx, dy = (tgt.x > p.x) - (tgt.x < p.x), (tgt.y > p.y) - (tgt.y < p.y)
            if not g.move(dx, dy):
                g.move(dx, 0) or g.move(0, dy)
        else:
            g._spend(1)
        if p.hp < p.max_hp * 0.4:
            for i, it in enumerate(list(p.inventory)):
                if it.id in ("medkit", "bandage"):
                    g.use(i)
                    break
    return False, hp0 - p.hp, turns


def probe_fights():
    print("\n== Animal fights: win pct, mean HP lost, by era, weapon, armour ==")
    for species, n in (("wolf", 1), ("wolf", 2), ("wolf", 3), ("boar", 1)):
        for era in ERAS:
            for label, kw in (("best weapon", {}), ("best+armour", {"armor": True}), ("fists", {"weapon": None})):
                res = [fight(species, n, era, s, **kw) for s in range(30)]
                win = sum(1 for r in res if r[0]) / len(res)
                lost = st.mean(r[1] for r in res)
                print(f"{species:5s} x{n} {era:9s} {label:12s} win {win:5.0%}  hp lost {lost:5.1f}")


def probe_hunt():
    print("\n== Hunting: the player walks up to the animal (80 turns). kill pct, mean turns, HP lost ==")
    for species in ("rabbit", "deer", "boar"):
        for era in ("medieval", "modern"):
            for label, kw in (("walk", {}), ("sneak", {"sneak": True})):
                res = [fight(species, 1, era, s, approach=True, turns=80, **kw) for s in range(30)]
                win = [r for r in res if r[0]]
                print(f"{species:6s} {era:9s} {label:6s} kill {len(win) / len(res):5.0%}  turns {st.mean(r[2] for r in win) if win else 0:5.1f}  hp lost {st.mean(r[1] for r in res):5.1f}")


def probe_caves():
    print("\n== Caves vs buildings: dormant dead, loot value, floor tiles ==")
    rows = {"cave": [], "floor": [], "house": []}
    for seed in range(1, 13):
        g = helpers.make_game(seed=seed)
        for poi in g.pois.values():
            kind = "cave" if poi.kind == "cave" else "house" if poi.kind == "house" else "floor"
            if kind == "floor" and poi.kind in ("refuge", "pad"):
                continue
            lv = g.ensure_level(poi.level_id)
            zs = sum(1 for a in lv.actors if isinstance(a, Zombie))
            val = 0
            for c in lv.containers.values():
                val += c.coins + sum(g.item_def(i.id).value * i.qty for i in c.loot)
            for stack in lv.items.values():
                val += sum(g.item_def(i.id).value * i.qty for i in stack)
            rows[kind].append((zs, val, sum(1 for y in range(lv.h) for x in range(lv.w) if lv.tiles[y][x] == T.FLOOR)))
    for k, v in rows.items():
        if v:
            print(f"{k:6s} n={len(v):3d}  zombies {st.mean(x[0] for x in v):5.1f}  loot value {st.mean(x[1] for x in v):6.1f}  "
                  f"floor tiles {st.mean(x[2] for x in v):6.0f}  value/zombie {st.mean(x[1] for x in v) / max(1, st.mean(x[0] for x in v)):5.1f}")


def probe_food():
    print("\n== Food: units of hunger relief per action, vs the 0.12/turn drain (1 day = 240 turns = 28.8) ==")
    g = helpers.make_game(seed=3)
    food = {i: d.effect.get("food", 0) for i, d in g.items.items() if d.kind == "food"}
    print("food items:", food)
    for tile, ch in ((T.GRASS, wild.FORAGE_CHANCE[T.GRASS]), (T.BRUSH, wild.FORAGE_CHANCE[T.BRUSH])):
        exp = ch * 1.5 * food["forage"]
        print(f"forage on {T.TILES[tile].name:12s}: {exp:5.1f} per {wild.FORAGE_TURNS} turns  = {exp / 28.8 * 100:4.0f}% of a day's hunger")
    print(f"deer ~2.5 meat: raw {2.5 * food['raw_meat']:.0f} / cooked {2.5 * food['meat']:.0f}   wolf 1.5: cooked {1.5 * food['meat']:.0f}")
    print(f"rod: {0.5 * food['fish']:.1f} per 8 turns   net: {0.65 * 1.5 * food['fish']:.1f} per 12 turns")


def probe_bot():
    from outbreak.bot import play
    from collections import Counter
    print("\n== Bot: causes of death over 40 runs x 3000 turns ==")
    causes, alive, lens = Counter(), 0, []
    for i in range(40):
        era = ERAS[i % 4]
        g = helpers.make_game(seed=100 + i, era=era)
        play(g, 3000, seed=i)
        lens.append(g.clock.turn)
        if g.over:
            causes[(g.over.kind, (g.over.text or "")[:40])] += 1
        else:
            alive += 1
    print("alive at 3000:", alive, " mean turn:", int(st.mean(lens)))
    for (k, t), c in causes.most_common():
        print(f"{c:3d}  {k:8s} {t}")


def probe_cave_run(kind="cave"):
    """The bot, dropped at a cave mouth with a torch (or without one), for 500 turns: does it live, how much does it open?"""
    from outbreak.bot import Bot
    print(f"\n== {kind} runs: the bot enters for 500 turns (30 seeds) ==")
    for label, lit in (("with torch", True), ("no light", False)):
        alive = opened = n = 0
        kills = []
        for seed in range(1, 31):
            g = helpers.make_game(seed=seed, era="modern")
            caves = [p for p in g.pois.values() if p.kind == kind]
            if not caves:
                continue
            p = g.player
            p.infected = False
            d = best_weapon(g)
            p.weapon = Item(d.id, 1, d.durability or None)
            if lit:
                light = max((x for x in g.items.values() if x.kind == "light"), key=lambda x: x.light)
                p.light, p.light_on = Item(light.id, 1, light.durability), True
            lv = helpers.teleport(g, caves[0].level_id)
            bot = Bot(g, seed)
            t0 = g.clock.turn
            while not g.over and g.clock.turn - t0 < 500:
                bot.step()
            n += 1
            alive += 0 if g.over else 1
            opened += sum(1 for c in lv.containers.values() if c.opened)
            kills.append(p.stats.get("zombies", 0))
        print(f"{label:10s} survive {alive}/{n}  crates opened/cave {opened / max(1, n):.1f}  zombies killed/cave {st.mean(kills):.1f}")


def probe_sneak_walk():
    """A 28-step walk through a scatter of idle dead, creeping or walking: how many hunt you, and how many silent kills a creeper gets."""
    from outbreak.engine.spawn import spawn_zombie
    print("\n== Walking through 14 idle dead (28 steps), 20 seeds ==")
    for label, sneak in (("walking", False), ("creeping", True)):
        hunted, steps_turns = [], []
        for seed in range(1, 21):
            g = helpers.make_game(seed=seed)
            lv = grove(g, trees=False)
            p = g.player
            p.infected = False
            p.hp = p.max_hp = 10 ** 6
            g.clock.turn = 600
            rng = random.Random(seed)
            zs = []
            for i in range(14):
                for _ in range(20):
                    x, y = p.x + rng.randint(3, 28), p.y + rng.randint(-6, 6)
                    if lv.free(x, y):
                        z = spawn_zombie(g, lv, (x, y), "walker", False)
                        z.state = "idle"
                        z.facing = rng.choice([(1, 0), (-1, 0), (0, 1), (0, -1), (1, 1), (-1, -1)])
                        zs.append(z)
                        break
            p.sneaking = sneak
            t0 = g.clock.turn
            for _ in range(28):
                g.move(1, 0) or g.move(1, 1) or g.move(1, -1)
                p.hp = p.max_hp
                p.sneaking = sneak
                p.stamina = 100
            hunted.append(sum(1 for z in zs if z.state == "hunt") / max(1, len(zs)))
            steps_turns.append(g.clock.turn - t0)
        print(f"{label:9s} hunting {st.mean(hunted):5.0%}   turns taken {st.mean(steps_turns):5.1f}")


def probe_stab():
    """The creeper's blow: from behind, on an unaware walker, with the best loose weapon: kills outright how often?"""
    from outbreak.engine.spawn import spawn_zombie
    print("\n== Stab in the back (creeping, unaware walker adjacent) ==")
    for era in ("medieval", "modern"):
        kills = n = 0
        for seed in range(1, 41):
            g = helpers.make_game(seed=seed, era=era)
            lv = grove(g, trees=False)
            p = g.player
            p.infected = False
            p.hp = p.max_hp = 10 ** 6
            d = best_weapon(g)
            p.weapon = Item(d.id, 1, d.durability or None)
            g.clock.turn = 600
            z = spawn_zombie(g, lv, (p.x + 1, p.y), "brute" if seed % 4 == 0 else "walker", False)
            z.state, z.alert, z.facing = "idle", 0.0, (1, 0)
            p.sneaking = True
            hp = z.hp
            g.move(1, 0)
            n += 1
            kills += 0 if z in lv.actors else 1
        print(f"{era:9s} killed outright {kills / n:5.0%} of {n}")


def probe_stealth():
    """How well does creeping hide you?  Ten idle dead stand 4-9 tiles away; the player stands, or creeps, for 40 turns; how many
    noticed, and how many a stab would have found unaware."""
    from outbreak.engine import ai
    print("\n== Stealth: idle dead 4-9 tiles away, 40 turns, 20 seeds ==")
    for label, sneak in (("standing", False), ("creeping", True)):
        noticed, unaware = [], []
        for seed in range(1, 21):
            g = helpers.make_game(seed=seed)
            lv = grove(g, trees=False)
            p = g.player
            p.infected = False
            p.hp = p.max_hp = 10 ** 6
            g.clock.turn = 600
            rng = random.Random(seed)
            zs = []
            from outbreak.engine.spawn import spawn_zombie
            for i in range(10):
                for _ in range(20):
                    x, y = p.x + rng.randint(-9, 9), p.y + rng.randint(-9, 9)
                    if 4 <= max(abs(x - p.x), abs(y - p.y)) <= 9 and lv.free(x, y):
                        z = spawn_zombie(g, lv, (x, y), "walker", False)
                        z.state = "idle"
                        z.facing = rng.choice([(1, 0), (-1, 0), (0, 1), (0, -1), (1, 1), (-1, -1)])
                        zs.append(z)
                        break
            p.sneaking = sneak
            g.player.stamina = 100
            for _ in range(40):
                g._spend(1)
                p.hp = p.max_hp
            noticed.append(sum(1 for z in zs if z.state == "hunt") / max(1, len(zs)))
            unaware.append(sum(1 for z in zs if z.state != "hunt" and z.alert < 70) / max(1, len(zs)))
        print(f"{label:9s} noticed {st.mean(noticed):5.0%}   still unaware {st.mean(unaware):5.0%}")


if __name__ == "__main__":
    which = sys.argv[1] if len(sys.argv) > 1 else "all"
    for name, fn in (("wolves", probe_fights), ("hunt", probe_hunt), ("caves", probe_caves), ("food", probe_food), ("bot", probe_bot), ("stealth", probe_stealth), ("walk", probe_sneak_walk), ("stab", probe_stab), ("cave", probe_cave_run), ("market", lambda: probe_cave_run("market")), ("military", lambda: probe_cave_run("military"))):
        if which in ("all", name):
            fn()
