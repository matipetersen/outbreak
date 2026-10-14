import unittest

from tests import helpers
from outbreak.engine import tiles as T
from outbreak.engine.model import Hazard, Item, Zombie


def at_pad(seed=3, scenario="dash"):
    g = helpers.make_game(scenario=scenario, seed=seed)
    helpers.teleport(g, g.final_site_id + ":0")
    lv = g.level
    helpers.empty_level_of_enemies(g.world.level)
    g.player.hp = g.player.max_hp = 10 ** 6
    return g, lv


def zombies(lv):
    return [a for a in lv.actors if isinstance(a, Zombie)]


class SiegeTests(unittest.TestCase):
    def test_haven_has_side_doors(self):
        g, lv = at_pad()
        self.assertEqual(len(g._siege_doors(lv)), 3)

    def test_ready_check_warns_once_then_starts(self):
        g, lv = at_pad()
        self.assertFalse(g.use_bench(True))
        self.assertIsNone(g.final)
        self.assertTrue(any("barricaded" in t for _, t, _ in g.log[-2:]))
        self.assertTrue(g.use_bench(True))
        self.assertIsNotNone(g.final)

    def test_no_warning_when_all_doors_are_secured(self):
        g, lv = at_pad()
        for d in g._siege_doors(lv):
            lv.door_hp[d] = 40
        self.assertTrue(g.use_bench(True))

    def test_an_unbarricaded_door_breaks_at_once_and_a_barricade_holds(self):
        g, lv = at_pad()
        g.use_bench()
        f = g.final
        weak, strong = f.doors[0], f.doors[1]
        lv.door_hp[strong] = 40
        g._siege_wave(f, weak, 3)
        self.assertEqual(lv.tile(*weak), T.DOOR_OPEN)
        self.assertEqual(len(zombies(lv)), 3)
        g._siege_wave(f, strong, 3)
        self.assertEqual(lv.tile(*strong), T.DOOR)
        self.assertEqual(len(zombies(lv)), 3)                       # still behind the door
        self.assertEqual(f.pending[strong], 3)
        for _ in range(4):
            g._siege_wave(f, strong, 3)
        self.assertEqual(lv.tile(*strong), T.DOOR_OPEN)             # they got through in the end...
        self.assertGreaterEqual(len(zombies(lv)), 15)           # ...all together

    def test_waves_speed_up_and_grow(self):
        g, lv = at_pad()
        g.use_bench()
        f = g.final
        f.turns_left = f.total - 2
        f.next_wave = 1
        g._final_tick()
        early = f.next_wave
        f.turns_left = 8
        f.next_wave = 1
        g._final_tick()
        self.assertLess(f.next_wave, early)

    def test_spike_trap_hurts_the_first_to_step_on_it(self):
        from outbreak.engine.spawn import spawn_zombie
        g, lv = at_pad()
        p = g.player
        p.inventory.append(Item("spike_trap", 1))
        self.assertTrue(g.use(len(p.inventory) - 1))
        trap_pos = p.pos
        self.assertEqual(lv.hazards[trap_pos].kind, "spikes")
        z = spawn_zombie(g, lv, (trap_pos[0] + 3, trap_pos[1] - 3), "walker", dormant=False)
        hp = z.hp
        del lv.occ[z.pos]
        z.x, z.y = trap_pos
        lv.occ[trap_pos] = z
        p.x, p.y = trap_pos[0] + 2, trap_pos[1] - 2
        g._hazards()
        self.assertNotIn(trap_pos, lv.hazards)
        self.assertTrue(z.hp < hp or z not in lv.actors)

    def test_trap_is_craftable(self):
        from outbreak.content.recipes import by_id
        self.assertIn("spike_trap", by_id())


if __name__ == "__main__":
    unittest.main()
