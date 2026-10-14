import unittest

from tests import helpers
from outbreak.engine import tiles as T


def open_game(**kw):
    g = helpers.make_game(**kw)
    helpers.empty_level_of_enemies(g.world.level)
    g.hordes.clear()
    g.ring = None
    g.player.infected = False
    g.player.hp = g.player.max_hp = 10 ** 6
    lv = g.world.level
    p = g.player
    for y in range(8, lv.h - 8):                       # a spot with room to pace back and forth
        for x in range(8, lv.w - 8):
            if all(lv.free(x + i, y) and lv.tile(x + i, y) in (T.GRASS, T.ROAD) for i in range(-2, 4)):
                del lv.occ[p.pos]
                p.x, p.y = x, y
                lv.occ[p.pos] = p
                g.update_fov()
                return g
    raise AssertionError("no open ground")


def pace(g, steps):
    for i in range(steps):
        if i % 10 == 0:
            helpers.empty_level_of_enemies(g.world.level)
            g.hordes.clear()
            g.pending_event = None
        g.move(1 if i % 2 == 0 else -1, 0)


class Stamina(unittest.TestCase):
    def test_walking_nonstop_wears_you_down(self):
        g = open_game(seed=3)
        s0 = g.player.stamina
        pace(g, 60)
        self.assertLess(g.player.stamina, s0 - 10)
        pace(g, 400)
        self.assertLess(g.player.stamina, 15, "a long march must empty the tank")

    def test_exhaustion_slows_you_and_warns_once(self):
        g = open_game(seed=3)
        g.player.stamina = 12
        t0 = g.clock.turn
        pace(g, 20)
        winded = g.clock.turn - t0
        g2 = open_game(seed=3)
        g2.player.stamina = 90
        t1 = g2.clock.turn
        pace(g2, 20)
        fresh = g2.clock.turn - t1
        self.assertGreater(winded, fresh * 1.3, "a winded walker must be slower than a fresh one")
        warnings = [m for m in g.log if "winded" in m[1] or "exhausted" in m[1]]
        self.assertGreaterEqual(len(warnings), 1)
        self.assertLessEqual(len(warnings), 2)

    def test_creeping_does_not_drain_and_resting_restores(self):
        g = open_game(seed=3)
        g.player.stamina = 50
        g.player.sneaking = True
        pace(g, 40)
        self.assertGreater(g.player.stamina, 50, "sneaking should recover more than it spends")
        g.player.sneaking = False
        g.player.stamina = 5
        helpers.empty_level_of_enemies(g.world.level)
        g.hordes.clear()
        g.pending_event = None
        g.rest(30)
        self.assertGreater(g.player.stamina, 40)

    def test_running_burns_out_fast_and_then_stops(self):
        g = open_game(seed=3)
        g.toggle_sprint()
        self.assertTrue(g.player.sprinting)
        steps = 0
        while g.player.sprinting and steps < 100:
            g.move(1 if steps % 2 == 0 else -1, 0)
            steps += 1
        self.assertFalse(g.player.sprinting)
        self.assertLess(steps, 45)

    def test_shallow_water_costs_more(self):
        g = open_game(seed=3)
        a = g.player.stamina
        g._tire(T.GRASS, False, False)
        grass = a - g.player.stamina
        g.player.stamina = a
        g._tire(T.SHALLOW, False, False)
        self.assertGreater(a - g.player.stamina, grass)


if __name__ == "__main__":
    unittest.main()
