import unittest

from tests import helpers
from outbreak.engine import combat, tiles as T
from outbreak.engine.model import Hazard
from outbreak.engine.spawn import spawn_zombie


def arena(seed=3):
    g = helpers.make_game(seed=seed)
    lv = g.world.level
    helpers.empty_level_of_enemies(lv)
    g.hordes.clear()
    g.ring = None
    p = g.player
    p.hp = p.max_hp = 10 ** 6
    p.stamina = p.max_stamina = 100
    for y in range(p.y - 4, p.y + 5):
        for x in range(p.x - 6, p.x + 7):
            lv.set_tile(x, y, T.GRASS)
    return g, lv


def zombie_east(g, lv, special="walker", dist=1):
    z = spawn_zombie(g, lv, (g.player.x + dist, g.player.y), special, dormant=False)
    z.state = "idle"
    return z


class PushTests(unittest.TestCase):
    def test_a_shove_moves_it_back_and_stuns_it(self):
        g, lv = arena()
        g.rng.random = lambda: 0.0                      # every roll succeeds
        z = zombie_east(g, lv)
        x0 = z.x
        self.assertTrue(g.push())
        self.assertGreater(z.x, x0)
        self.assertGreaterEqual(z.stun, 1)
        self.assertEqual(z.state, "hunt")                # it knows who shoved it
        self.assertLess(g.player.stamina, 100)

    def test_a_stunned_zombie_loses_its_turns_then_recovers(self):
        g, lv = arena()
        g.rng.random = lambda: 0.0
        z = zombie_east(g, lv)
        g.push()
        pos = z.pos
        n = z.stun
        for _ in range(n):
            g.wait(1)
        self.assertEqual(z.stun, 0)
        self.assertEqual(z.pos, pos)

    def test_against_a_wall_it_is_slammed_and_hurt(self):
        g, lv = arena()
        g.rng.random = lambda: 0.0
        z = zombie_east(g, lv)
        lv.set_tile(z.x + 1, z.y, T.WALL)
        hp = z.hp
        g.push()
        self.assertEqual(z.x, g.player.x + 1)
        self.assertLess(z.hp, hp)

    def test_bosses_do_not_budge_and_brutes_resist(self):
        g, lv = arena()
        g.rng.random = lambda: 0.0
        b = zombie_east(g, lv, "alpha")
        x = b.x
        g.push()
        self.assertEqual(b.x, x)
        g2, lv2 = arena()
        brute = zombie_east(g2, lv2, "brute")
        g2.rng.random = lambda: 0.6                      # fine for a walker (0.9), not for a brute (0.45)
        x = brute.x
        g2.push()
        self.assertEqual(brute.x, x)

    def test_you_need_the_wind_and_something_to_push(self):
        g, lv = arena()
        self.assertFalse(g.push())                        # nothing there
        z = zombie_east(g, lv)
        g.player.stamina = 2
        self.assertFalse(g.push())
        self.assertEqual(z.stun, 0)

    def test_shoving_the_dead_onto_a_trap_works(self):
        g, lv = arena()
        g.rng.random = lambda: 0.0
        z = zombie_east(g, lv)
        lv.hazards[(z.x + 1, z.y)] = Hazard("spikes", 10 ** 9, 40)
        hp = z.hp
        g.push()
        self.assertTrue(z.hp < hp or z not in lv.actors)


if __name__ == "__main__":
    unittest.main()
