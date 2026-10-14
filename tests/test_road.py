import unittest

from tests import helpers
from outbreak import content
from outbreak.engine import encounters
from outbreak.engine.model import Item


class Road(unittest.TestCase):
    def test_dash_has_no_parts_and_a_road(self):
        for era in content.ERAS:
            g = helpers.make_game(era=era, scenario="dash", seed=3)
            self.assertEqual(g.scenario.requirements, ())
            self.assertTrue(g.requirements_met())
            self.assertEqual(len(g.incidents), 5)
            self.assertGreaterEqual(g.deadline_days, 8)

    def test_deadline_grows_with_the_route_and_never_below_the_minimum(self):
        small = helpers.make_game(scenario="extraction", seed=3)
        big = helpers.make_game(scenario="extraction", seed=3, map_w=240, map_h=150)
        self.assertGreaterEqual(small.deadline_days, small.scenario.deadline_days)
        self.assertGreater(big.deadline_days, small.deadline_days)
        self.assertEqual(helpers.make_game(scenario="cure", seed=3).deadline_days, 0)
        self.assertGreater(small.deadline_days, 10, "10 days is not enough to gather three parts and cross the map")

    def test_incidents_fire_once_when_you_get_close(self):
        g = helpers.make_game(scenario="dash", seed=3)
        helpers.empty_level_of_enemies(g.world.level)
        g.hordes.clear()
        g.ring = None
        inc = g.incidents[0]
        spot = g.world.level.free_spot_near(inc["x"], inc["y"], 4)
        helpers.teleport(g, "world", spot)
        g._check_incidents()
        self.assertIsNotNone(g.pending_event)
        self.assertEqual(g.pending_event.event_id, inc["event"])
        self.assertTrue(inc["done"])
        g.pending_event = None
        g._check_incidents()
        self.assertIsNone(g.pending_event, "an incident must fire only once")

    def test_incidents_are_not_random_events(self):
        g = helpers.make_game(scenario="dash", seed=3)
        g.clock.turn = 5000
        picked = {encounters.pick(g).id for _ in range(200)}
        self.assertFalse(any(i.startswith("road_") for i in picked))

    def test_every_road_event_choice_resolves(self):
        for ev in encounters.ROAD_EVENTS:
            for i, ch in enumerate(ev.choices):
                g = helpers.make_game(scenario="dash", seed=3)
                helpers.empty_level_of_enemies(g.world.level)
                g.player.coins = 50
                g.player.inventory.extend([Item("food", 3), Item("noisemaker", 1), Item("bandage", 2)])
                g.pending_event = encounters.start(g, ev)
                lost = g.lost_turns
                g.resolve_event(i)
                self.assertFalse(g.over and g.over.kind == "dead", f"{ev.id}/{i} killed the player outright")
                if any("time" in o.fx for o in ch.outcomes) and len(ch.outcomes) == 1:
                    self.assertGreater(g.lost_turns, lost, f"{ev.id}/{i}: the lost time was not counted")


    def test_lost_time_moves_the_deadline_closer(self):
        g = helpers.make_game(scenario="dash", seed=3)
        helpers.empty_level_of_enemies(g.world.level)
        g.hordes.clear()
        g.ring = None
        g.clock.turn = (g.deadline_days - 1) * 240 + 100
        g.wait(3)
        self.assertIsNone(g.over)
        g.lost_turns = 240 * 3
        g.clock.turn = (g.deadline_days - 3) * 240 + 238
        g.wait(5)
        self.assertEqual(g.over.kind, "left_behind")


if __name__ == "__main__":
    unittest.main()
