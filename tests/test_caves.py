import unittest
from collections import deque

from tests import helpers
from outbreak.engine import ai, tiles as T, wild
from outbreak.engine.model import Animal, Item, Zombie
from outbreak.util import DIRS4


def caves(g):
    return [p for p in g.pois.values() if p.kind == "cave"]


class Caves(unittest.TestCase):
    def test_the_world_has_cave_mouths_far_from_the_start(self):
        for seed in (3, 4, 5):
            g = helpers.make_game(seed=seed)
            cs = caves(g)
            self.assertGreaterEqual(len(cs), 1, seed)
            for c in cs:
                self.assertGreaterEqual(max(abs(c.x - g.world.start[0]), abs(c.y - g.world.start[1])), 16)
                self.assertEqual(g.world.level.tile(*c.pos), T.PORTAL)
                self.assertEqual(g.world.level.portals[c.pos].target, c.level_id)

    def test_a_cave_is_a_system_of_chambers_with_a_way_out(self):
        g = helpers.make_game(seed=3)
        lv = g.ensure_level(caves(g)[0].level_id)
        floor = {(x, y) for y in range(lv.h) for x in range(lv.w) if lv.tiles[y][x] == T.FLOOR}
        self.assertGreaterEqual(len(floor), 330)
        seen, q = {lv.entry}, deque([lv.entry])
        while q:
            x, y = q.popleft()
            for dx, dy in DIRS4:
                n = (x + dx, y + dy)
                if n in floor and n not in seen:
                    seen.add(n)
                    q.append(n)
        self.assertEqual(seen, floor, "every chamber can be walked to")
        exits = [k for k, v in lv.portals.items() if v.target == "world"]
        self.assertEqual(len(exits), 1)
        self.assertLessEqual(max(abs(exits[0][0] - lv.entry[0]), abs(exits[0][1] - lv.entry[1])), 1)

    def test_it_holds_nests_of_the_dormant_crates_and_mushrooms(self):
        g = helpers.make_game(seed=3)
        lv = g.ensure_level(caves(g)[0].level_id)
        dead = [a for a in lv.actors if isinstance(a, Zombie)]
        self.assertGreaterEqual(len(dead), 4)
        self.assertTrue(all(a.state == "dormant" for a in dead))
        self.assertGreaterEqual(len(lv.containers), 2)
        self.assertTrue(any(i.id == "mushroom" for stack in lv.items.values() for i in stack))
        self.assertTrue(all(max(abs(a.x - lv.entry[0]), abs(a.y - lv.entry[1])) >= 3 for a in dead))

    def test_it_is_black_unless_you_carry_light(self):
        g = helpers.make_game(seed=3)
        lv = g.ensure_level(caves(g)[0].level_id)
        pos = g.world.level.portals and caves(g)[0].pos
        g._use_portal(pos) if g.level is g.world.level and g.player.pos == pos else None
        g.level = lv
        g.player.x, g.player.y = lv.entry
        g.player.light = None
        dark = g.vision_radius()
        self.assertLess(dark, 6)
        light = next(i for i, d in g.items.items() if d.kind == "light" and d.light > 3)
        g.player.light, g.player.light_on = Item(light, 1, g.items[light].durability), True
        self.assertGreater(g.vision_radius(), dark)

    def test_walking_through_the_mouth_takes_you_in_and_out(self):
        g = helpers.make_game(seed=3)
        c = caves(g)[0]
        wl = g.world.level
        helpers.empty_level_of_enemies(wl)
        g.player.x, g.player.y = c.x, c.y + 1
        wl.occ.clear()
        wl.occ[g.player.pos] = g.player
        g.player.hp = g.player.max_hp = 10 ** 6
        g.move(0, -1)
        self.assertEqual(g.level.id, c.level_id)
        exit_pos = next(k for k, v in g.level.portals.items() if v.target == "world")
        dx, dy = exit_pos[0] - g.player.x, exit_pos[1] - g.player.y
        g.level.occ = {k: v for k, v in g.level.occ.items() if v is g.player}
        g.move(dx, dy)
        self.assertIs(g.level, g.world.level)

    def test_caves_are_not_building_hosts(self):
        g = helpers.make_game(seed=3)
        self.assertTrue(all(not p.component and not p.docs for p in caves(g)))


class Forest(unittest.TestCase):
    def _grove(self, g):
        lv = g.world.level
        helpers.empty_level_of_enemies(lv)
        p = g.player
        for y in range(p.y - 8, p.y + 9):
            for x in range(p.x - 10, p.x + 11):
                lv.set_tile(x, y, T.GRASS)
        for y in range(p.y - 2, p.y + 3):
            for x in range(p.x - 2, p.x + 3):
                if (x, y) != p.pos:
                    lv.set_tile(x, y, T.TREE if (x + y) % 3 else T.GRASS)
        return lv

    def test_deep_woods_are_detected_and_announced_once(self):
        g = helpers.make_game(seed=3)
        lv = self._grove(g)
        g.clock.turn += 1
        self.assertTrue(wild.forest_here(g))
        g.msg_log = None
        n = len(g.log)
        wild.forest_note(g)
        wild.forest_note(g)
        self.assertEqual(len(g.log), n + 1)
        self.assertIn("canopy", g.log[-1][1])

    def test_the_dead_see_less_from_under_the_trees(self):
        g = helpers.make_game(seed=3)
        lv = self._grove(g)
        z = helpers.spawn_zombie_at(g, lv, 6) if hasattr(helpers, "spawn_zombie_at") else None
        from outbreak.engine.spawn import spawn_zombie
        z = spawn_zombie(g, lv, (g.player.x + 6, g.player.y), "walker", False)
        g.clock.turn += 1
        deep = ai.sight_range(g, z)
        for y in range(g.player.y - 2, g.player.y + 3):
            for x in range(g.player.x - 2, g.player.x + 3):
                if (x, y) != g.player.pos and (x, y) != z.pos:
                    lv.set_tile(x, y, T.GRASS)
        g.clock.turn += 1
        self.assertLess(deep, ai.sight_range(g, z))

    def test_wolves_hunt_as_a_pack_and_bite(self):
        g = helpers.make_game(seed=3)
        lv = self._grove(g)
        p = g.player
        p.hp = p.max_hp = 500
        a = wild.make_animal(g, p.x + 5, p.y + 6, "wolf")
        b = wild.make_animal(g, p.x + 9, p.y + 6, "wolf")
        lv.add_actor(a)
        lv.add_actor(b)
        for y in range(p.y - 2, p.y + 3):
            for x in range(p.x - 2, p.x + 3):
                if (x, y) != p.pos:
                    lv.set_tile(x, y, T.GRASS)
        g.clock.turn = 1
        wild.tick(g, a)
        self.assertEqual((a.state, b.state), ("charge", "charge"), "one wolf alerts its pack")
        hp0 = p.hp
        a.x, a.y = p.x + 1, p.y
        g.rng.random = lambda: 0.1
        g.clock.turn = 5
        wild.tick(g, a)
        self.assertLess(p.hp, hp0)

    def test_forest_forage_pays_better_and_can_give_herbs(self):
        g = helpers.make_game(seed=3)
        self._grove(g)
        g.rng.random = lambda: 0.0
        g.clock.turn = 1000
        self.assertTrue(g.forage())
        self.assertGreater(g.player.count("herbs"), 0)

    def test_wolf_packs_live_in_the_woods_only(self):
        g = helpers.make_game(seed=3)
        lv = g.world.level
        wolves = [a for a in lv.actors if isinstance(a, Animal) and a.species == "wolf"]
        self.assertGreaterEqual(len(wolves), 2)
        near = sum(1 for w in wolves if wild.in_forest_at(lv, w.pos))
        self.assertGreaterEqual(near, len(wolves) // 2)


if __name__ == "__main__":
    unittest.main()
