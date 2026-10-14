import unittest

from tests import helpers
from outbreak.engine import ambience, tiles as T
from outbreak.engine.spawn import spawn_zombie


def world_game(**kw):
    g = helpers.make_game(seed=kw.pop("seed", 3), **kw)
    helpers.empty_level_of_enemies(g.world.level)
    g.hordes.clear()
    g.ring = None
    g.player.hp = g.player.max_hp = 10 ** 6
    return g


def far_zombie(g, dist):
    lv, p = g.world.level, g.player
    spot = lv.free_spot_near(p.x + dist, p.y, 2)
    z = spawn_zombie(g, lv, spot, "walker", dormant=False)
    z.state = "idle"
    return z


class AmbienceTests(unittest.TestCase):
    def test_weather_changes_but_stays_valid_and_is_reproducible(self):
        def run(seed):
            g = world_game(seed=seed)
            seen = []
            for _ in range(240 * 6):
                g.clock.turn += 1
                ambience.weather_tick(g)
                seen.append(g.weather)
            return seen
        a, b = run(5), run(5)
        self.assertEqual(a, b)
        self.assertTrue(set(a) <= set(ambience.WEATHER))
        self.assertGreater(len(set(a)), 1)

    def test_rain_muffles_noise_and_fog_hides_you(self):
        g = world_game()
        z = far_zombie(g, 12)
        g.weather = "clear"
        g.emit_noise(g.player.pos, 12)
        self.assertEqual(z.state, "investigate")
        z.state, z.alert = "idle", 0.0
        g.weather = "storm"
        g.emit_noise(g.player.pos, 12)
        self.assertEqual(z.state, "idle")                       # 12 x 0.55: it never heard
        from outbreak.engine import ai
        g.weather = "clear"
        clear = ai.sight_range(g, z)
        g.weather = "fog"
        self.assertLess(ai.sight_range(g, z), clear * 0.6)

    def test_indoors_the_weather_does_not_matter(self):
        g = world_game()
        poi = next(q for q in g.pois.values() if q.kind == "house")
        helpers.teleport(g, poi.id + ":0")
        g.weather = "storm"
        self.assertEqual(ambience.hearing_scale(g), 1.0)
        self.assertEqual(ambience.sight_scale(g), 1.0)

    def test_places_and_ground_make_steps_louder(self):
        g = world_game()
        self.assertEqual(ambience.step_extra(g, T.GRASS), 0)
        self.assertGreater(ambience.step_extra(g, T.STAIRS_UP), 0)
        poi = next(q for q in g.pois.values() if q.kind == "industry")
        helpers.teleport(g, poi.id + ":0")
        self.assertGreaterEqual(ambience.step_extra(g, T.FLOOR), 2)
        self.assertEqual(ambience.exposure_of_ground(g), 1.0)

    def test_sneaking_is_not_louder_for_the_place(self):
        g = world_game()
        poi = next(q for q in g.pois.values() if q.kind == "industry")
        helpers.teleport(g, poi.id + ":0")
        z = spawn_zombie(g, g.level, g.level.free_spot_near(g.player.x + 7, g.player.y, 2), "walker", dormant=False)
        z.state = "idle"
        g.player.sneaking = True
        n0 = z.alert
        for dx in (1, -1):
            g.move(dx, 0)
        self.assertEqual(z.alert, n0)

    def test_a_sounding_alarm_pulses_then_stops_and_the_dead_come(self):
        g = world_game()
        z = far_zombie(g, 14)
        pos = (g.player.x + 14, g.player.y + 1)
        g.sources.append({"pos": pos, "radius": 15, "every": 3, "left": 9, "kind": "car alarm"})
        for _ in range(9):
            g.clock.turn += 1
            ambience.world_tick(g)
        self.assertEqual(z.state, "investigate")
        self.assertEqual(g.sources, [])

    def test_a_building_alarm_is_heard_in_the_street_not_just_inside(self):
        g = world_game()
        z = far_zombie(g, 6)
        poi = next(q for q in g.pois.values() if q.kind in ("market", "guard", "military", "lab"))
        poi.x, poi.y = g.player.x + 8, g.player.y
        fired = False
        for i in range(60):                                      # the alarm only goes off some of the time
            g.alarmed.discard(poi.id)
            g.sources.clear()
            ambience.building_alarm(g, poi)
            if g.sources:
                fired = True
                break
        self.assertTrue(fired)
        helpers.teleport(g, poi.id + ":0")                       # we are inside; the dead outside still heard it
        self.assertEqual(z.state, "investigate")

    def test_rain_washes_the_trail_away(self):
        g = world_game()
        g.scent[(5, 5)] = 0
        g.weather = "rain"
        g.clock.turn = 200
        ambience.weather_tick(g)
        self.assertNotIn((5, 5), g.scent)

    def test_each_building_alarm_gets_one_chance(self):
        g = world_game()
        poi = next(q for q in g.pois.values() if q.kind == "market")
        ambience.building_alarm(g, poi)
        self.assertIn(poi.id, g.alarmed)
        n = len(g.sources)
        ambience.building_alarm(g, poi)
        self.assertEqual(len(g.sources), n)

    def test_noise_leaves_rings_for_the_ui_and_rain_shrinks_them(self):
        g = world_game()
        g.weather = "clear"
        g.emit_noise(g.player.pos, 10)
        clear = g.pings[-1]["radius"]
        g.weather = "rain"
        g.emit_noise(g.player.pos, 10)
        self.assertLess(g.pings[-1]["radius"], clear)
        g.clock.turn += 10
        g._tick()
        self.assertEqual([q for q in g.pings if g.clock.turn - q["turn"] > 6], [])

    def test_only_heard_alarms_are_marked(self):
        g = world_game()
        g.sources.append({"pos": (g.player.x + 5, g.player.y), "radius": 15, "every": 3, "left": 9, "kind": "car alarm"})
        g.sources.append({"pos": (g.player.x + 60, g.player.y), "radius": 15, "every": 3, "left": 9, "kind": "car alarm"})
        self.assertEqual(len(ambience.heard_sources(g)), 1)


if __name__ == "__main__":
    unittest.main()
