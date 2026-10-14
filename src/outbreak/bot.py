"""A simple autonomous player, used to fuzz the engine and to sanity-check balance.

It is deliberately not clever: it heals when hurt, fights what is adjacent,
loots what it stands next to, reads what it finds, and heads for the nearest
interesting building.  If even this bot can sometimes win, the game is fair.
"""
from __future__ import annotations

import random
from outbreak.engine import combat, encounters, services
from outbreak.engine import tiles as T
from outbreak.engine.game import Game
from outbreak.engine.pathing import descend, distance_field
from outbreak.util import DIRS8, cheb

HEAL_ORDER = ("medkit", "bandage", "painkiller")


class Bot:
    def __init__(self, game: Game, seed: int = 0):
        self.g = game
        self.rng = random.Random(seed)
        self.goal = None
        self.goal_field = None
        self.stuck = 0
        self.last = None

    # ------------------------------------------------------------ helpers
    def _use_first(self, ids) -> bool:
        p = self.g.player
        for item_id in ids:
            for i, it in enumerate(p.inventory):
                if it.id == item_id:
                    return self.g.use(i)
        return False

    def _equip_best(self) -> None:
        g, p = self.g, self.g.player
        best, best_score = None, -1
        for i, it in enumerate(p.inventory):
            d = g.item_def(it.id)
            if d.kind == "weapon" and not d.is_ranged:
                score = sum(d.dmg) * (1 + (d.reach - 1) * 0.2)
                cur = g.item_def(p.weapon.id) if p.weapon else None
                if score > (sum(cur.dmg) if cur else 0) and score > best_score:
                    best, best_score = i, score
            elif d.kind == "armor":
                cur = g.item_def(p.armor.id) if p.armor else None
                if d.defense > (cur.defense if cur else 0):
                    g.equip(i)
                    return
            elif d.kind == "light" and p.light is None:
                g.equip(i)
                return
        if best is not None:
            g.equip(best)

    def _decide_event(self) -> None:
        g = self.g
        ev = g.pending_event
        ok = [i for i, c in enumerate(ev.definition.choices) if encounters.can_afford(g, c)]
        g.resolve_event(self.rng.choice(ok) if ok else 0)
        if g.pending_event is not None:
            g.pending_event = None

    def _choose_goal(self):
        """The nearest building worth entering: anything revealed or seen, components first."""
        g, p = self.g, self.g.player
        lv = g.level
        if lv.kind != "overworld":
            return None
        if g.requirements_met():
            return g.pois[g.final_site_id]
        wanted = []
        for poi in g.pois.values():
            if poi.kind == "breach" or poi.done or poi.visited:
                continue
            if not (poi.revealed or lv.seen[poi.y][poi.x]):
                continue
            bonus = -30 if poi.component and poi.revealed else 0
            wanted.append((cheb(poi.pos, p.pos) + bonus, poi))
        if wanted:
            return min(wanted, key=lambda t: t[0])[1]
        site = g.pois[g.final_site_id]
        if site.revealed and not g.requirements_met() and p.count(g.scenario.requirements[0].id):
            return site
        return None

    def _escape_ring(self) -> bool:
        """Head for the widest gap in the closing tide."""
        import math
        g, p = self.g, self.g.player
        ring = g.ring
        if not ring or not ring.active or g.level is not g.world.level:
            return False
        lv = g.world.level
        cx, cy = ring.center
        best, best_score = None, -1.0
        for i in range(24):
            ang = i * math.tau / 24
            x = int(cx + math.cos(ang) * (ring.radius + 7) * 1.25)
            y = int(cy + math.sin(ang) * (ring.radius + 7) * 0.9)
            x, y = max(3, min(lv.w - 4, x)), max(3, min(lv.h - 4, y))
            score = min([cheb((x, y), h.pos) for h in g.hordes] or [99]) - cheb((x, y), p.pos) * 0.15
            if score > best_score:
                best, best_score = (x, y), score
        return self._walk_to(best)

    # ------------------------------------------------------------ main step
    def step(self) -> bool:
        g, p, lv = self.g, self.g.player, self.g.level
        if g.over:
            return False
        if g.pending_event:
            self._decide_event()
            return True
        # emergencies
        if p.infected and not combat.can_amputate(g) and p.bite_window > 0:
            g.amputate()
            return True
        if (p.hp < p.max_hp * 0.5 or p.bleeding) and self._use_first(HEAL_ORDER):
            return True
        if p.fracture and self._use_first(("splint",)):
            return True
        if p.infected and p.infection_timer < 200 and self._use_first(("suppressant",)):
            return True
        # fight
        hostiles = [a for a in g.visible_hostiles() if cheb(a.pos, p.pos) <= 12]
        w = combat.weapon_def(g)
        if hostiles:
            hostiles.sort(key=lambda a: cheb(a.pos, p.pos))
            near = hostiles[0]
            d = cheb(near.pos, p.pos)
            if d <= max(1, w.reach) and not (w.is_ranged and d == 1):
                if g.attack(near):
                    return True
            if w.is_ranged and d <= w.reach and g.fire(near):
                return True
            if len(hostiles) >= 4 or (p.hp < p.max_hp * 0.35 and d <= 3):
                if self._flee(hostiles):
                    return True
            if d <= 1 and g.attack(near):
                return True
        if self._escape_ring():
            return True
        # loot
        if lv.items.get(p.pos) or p.pos in lv.docs:
            if g.pickup():
                self._equip_best()
                return True
        for dx, dy in DIRS8:
            pos = (p.x + dx, p.y + dy)
            c = lv.containers.get(pos)
            if c is not None and not c.opened and lv.tile(*pos) == T.CRATE:
                g.interact()
                return True
        for doc_id in list(p.documents):
            doc = g.docs[doc_id]
            if not getattr(doc, "_bot_read", False):
                doc._bot_read = True
                g.read_document(doc_id)
                g.study_document(doc_id)
                return True
        # npc services at the refuge
        npc = g.adjacent_npc()
        if npc and not getattr(npc, "_bot_done", False):
            npc._bot_done = True
            services.heal(g) if npc.role == "healer" else services.teach(g) if npc.role == "scholar" else None
            return True
        if p.hp < p.max_hp * 0.7 and not g.visible_hostiles() and g.rest(10):
            return True
        # bench
        if lv.bench and g.requirements_met() and lv.poi_id == g.final_site_id and not g.final:
            return self._walk_to(lv.bench, adjacent=True) or g.interact() == ""
        if g.final:
            if self._maybe_fight_final():
                return True
            if g.final.exit is not None and self._walk_to(g.final.exit):          # the break-out: run for the door
                return True
            g.wait(1)
            return True
        return self._explore()

    def _maybe_fight_final(self) -> bool:
        g, p = self.g, self.g.player
        hostile = [a for a in g.visible_hostiles()]
        if hostile:
            near = min(hostile, key=lambda a: cheb(a.pos, p.pos))
            if cheb(near.pos, p.pos) <= max(1, combat.weapon_def(g).reach):
                return g.attack(near) or g.fire(near)
        return False

    def _flee(self, hostiles) -> bool:
        g, p, lv = self.g, self.g.player, self.g.level
        best, best_score = None, -1
        for dx, dy in DIRS8:
            n = (p.x + dx, p.y + dy)
            if not lv.free(*n) or lv.tile(*n) in (T.DOOR,):
                continue
            score = min(cheb(n, h.pos) for h in hostiles)
            if score > best_score:
                best, best_score = (dx, dy), score
        if best:
            return g.move(*best)
        return False

    def _walk_to(self, target, adjacent: bool = False) -> bool:
        g, p, lv = self.g, self.g.player, self.g.level
        if cheb(p.pos, target) <= (1 if adjacent else 0):
            return False
        field = distance_field(lv, target, 160)
        nxt = descend(lv, field, p.pos, self.rng) if p.pos in field else None
        if nxt is None:
            return self._random_move()
        return g.move(nxt[0] - p.x, nxt[1] - p.y)

    def _random_move(self) -> bool:
        dx, dy = self.rng.choice(DIRS8)
        return self.g.move(dx, dy)

    def _explore(self) -> bool:
        g, p, lv = self.g, self.g.player, self.g.level
        if lv.kind == "overworld":
            goal = self._choose_goal()
            if goal is not None:
                if cheb(p.pos, goal.pos) == 0:
                    return g.wait(1)
                if self._walk_to(goal.pos):
                    return True
            # wander away from the breach, preferring roads
            if self.rng.random() < 0.2 or self.goal is None:
                self.goal = (p.x + self.rng.randint(-25, 25), p.y + self.rng.randint(-15, 15))
            tx = min(max(2, self.goal[0]), lv.w - 3)
            ty = min(max(2, self.goal[1]), lv.h - 3)
            if self._walk_to((tx, ty)):
                return True
            return self._random_move()
        # inside: loot what can be reached, force the vault, then leave
        field = distance_field(lv, p.pos, 120)
        crates = [pos for pos, c in lv.containers.items() if not c.opened and lv.tile(*pos) == T.CRATE
                  and any((pos[0] + dx, pos[1] + dy) in field for dx, dy in DIRS8)]
        lock = lv.vault_lock
        if not crates and lock and lv.tile(*lock) == T.LOCKED and g.requirements_met() is False:
            if self._walk_to(lock, adjacent=True):
                return True
            return g.try_unlock(lock) or self._random_move()
        if crates:
            target = min(crates, key=lambda q: cheb(q, p.pos))
            if self._walk_to(target, adjacent=True):
                return True
        # stairs down, else exit
        for pos, portal in lv.portals.items():
            if portal.label == "down":
                if self._walk_to(pos):
                    return True
        for pos, portal in lv.portals.items():
            if portal.label in ("outside",):
                poi = g.poi_of_level(lv)
                if poi:
                    poi.done = True
                if self._walk_to(pos):
                    return True
        return self._random_move()


def play(game: Game, max_turns: int = 3000, seed: int = 0) -> Game:
    bot = Bot(game, seed)
    start = game.clock.turn
    guard = 0
    while not game.over and game.clock.turn - start < max_turns and guard < max_turns * 6:
        guard += 1
        bot.step()
    return game
