import unittest

from tests import helpers
from outbreak.engine import combat, tiles as T


class EndlessTests(unittest.TestCase):
    def test_no_deadline_no_infection_and_the_cure_is_optional(self):
        g = helpers.make_game(scenario="endless", seed=3)
        self.assertEqual(g.deadline_days, 0)
        self.assertFalse(g.player.infected)
        self.assertEqual(g.scenario.final_site, "refuge")
        self.assertEqual(len([q for q in g.pois.values() if q.component]), 3)
        for _ in range(240 * 14):                                # two weeks pass; nothing ends it
            g.clock.turn += 1
            g._time_events()
        self.assertIsNone(g.over)

    def test_pressure_grows_with_the_days_and_only_in_endless(self):
        e = helpers.make_game(scenario="endless", seed=3)
        c = helpers.make_game(scenario="cure", seed=3)
        self.assertEqual(e.pressure, 1.0)
        e.clock.turn = 240 * 20
        c.clock.turn = 240 * 20
        self.assertGreater(e.pressure, 1.8)
        self.assertEqual(c.pressure, 1.0)
        e.clock.turn = 240 * 400
        self.assertEqual(e.pressure, 3.0)

    def test_the_dead_are_tougher_later(self):
        from outbreak.engine.spawn import make_zombie
        g = helpers.make_game(scenario="endless", seed=3)
        early = make_zombie(g, "walker", 5, 5, fresh=True).max_hp
        g.clock.turn = 240 * 30
        late = make_zombie(g, "walker", 5, 5, fresh=True).max_hp
        self.assertGreater(late, early * 1.25)

    def test_enemy_level_cap_is_lifted(self):
        from outbreak.engine import lives
        g = helpers.make_game(scenario="endless", seed=3)
        g.clock.turn = 240 * 30
        self.assertGreater(lives.level_cap(g), 15)

    def test_looted_places_refill(self):
        g = helpers.make_game(scenario="endless", seed=3)
        poi = next(q for q in g.pois.values() if q.kind in ("market", "house"))
        lv = g.ensure_level(poi.id + ":0")
        spots = list(lv.containers)
        if not spots:
            self.skipTest("no container here")
        for pos in spots:
            lv.containers[pos].opened = True
            lv.containers[pos].loot = []
        for _ in range(60):
            g._restock()
        self.assertTrue(any(not lv.containers[p].opened for p in spots))

    def test_dying_is_a_survival_result(self):
        g = helpers.make_game(scenario="endless", seed=3)
        g.clock.turn = 240 * 9
        g.player.hp = 1
        combat.damage_player(g, 99, "killed by a walker")
        self.assertTrue(g.over.title.startswith("Survived 10 days"), g.over.title)
        self.assertIn("killed by a walker", g.over.text.lower())

    def test_the_cure_ends_it(self):
        g = helpers.make_game(scenario="endless", seed=3)
        g.end("won")
        self.assertTrue(g.over.victory)
        self.assertIn("ure", g.over.title)


if __name__ == "__main__":
    unittest.main()
