import unittest

from tests import helpers
from outbreak.content.director import STAGES, BY_ID
from outbreak.engine import director, hordes, tiles as T
from outbreak.engine.model import Zombie


def field(seed=3, **kw):
    g = helpers.make_game(seed=seed, **kw)
    lv = g.world.level
    from outbreak.engine import companion
    c = companion.current(g)
    for a in list(lv.actors):
        if a is not c:
            lv.remove_actor(a)
    g.hordes.clear()
    g.ring = None
    p = g.player
    p.hp = p.max_hp = 500
    p.infected = False
    p.panic = 0
    g.heat = 0
    for y in range(p.y - 10, p.y + 11):
        for x in range(p.x - 12, p.x + 13):
            lv.set_tile(x, y, T.GRASS)
    g.clock.turn = 1000
    return g, lv


def run(g, turns, step=5):
    for _ in range(0, turns, step):
        g.clock.turn += step
        director.tick(g)


def force_progress(g, value):
    g.requirements = lambda: [("a", value >= 0.99, ""), ("b", value >= 0.5, "")] if value < 1 else [("a", True, "")]
    director.progress = lambda game, _v=value: _v


class Base(unittest.TestCase):
    def setUp(self):
        self._orig = director.progress

    def tearDown(self):
        director.progress = self._orig


class Journey(Base):

    def test_twelve_stages_in_order(self):
        self.assertEqual(len(STAGES), 12)
        self.assertEqual([s.start for s in STAGES], sorted(s.start for s in STAGES))
        self.assertEqual(STAGES[0].id, "ordinary")
        self.assertEqual(STAGES[7].id, "ordeal")
        self.assertEqual(STAGES[-1].id, "return")

    def test_progress_rises_with_what_you_do(self):
        g, lv = field()
        self.assertGreaterEqual(director.progress(g), 0.0)
        before = director.progress(g)
        g.clock.turn += 240 * 4
        self.assertGreater(director.progress(g), before)

    def test_the_stage_follows_progress_and_never_runs_backwards(self):
        g, lv = field()
        d = director._dir(g)
        for value, expect in ((0.02, "ordinary"), (0.30, "tests"), (0.72, "ordeal")):
            director.progress = lambda game, _v=value: _v
            run(g, 5)
            self.assertEqual(STAGES[d.stage].id, expect)
        director.progress = lambda game: 0.1
        run(g, 5)
        self.assertEqual(STAGES[d.stage].id, "ordeal", "a story does not run backwards")

    def test_each_act_is_announced_once(self):
        g, lv = field()
        for value in (0.1, 0.1, 0.16, 0.16):
            director.progress = lambda game, _v=value: _v
            run(g, 5)
        acts = [t for _, t, tag in g.story if t.startswith("ACT ")]
        self.assertEqual(len(acts), len(set(acts)))
        self.assertTrue(any("Meeting the Mentor" in a for a in acts))

    def test_the_companion_remarks_on_a_new_act(self):
        g, lv = field()
        director.progress = lambda game: 0.5
        run(g, 5)
        self.assertTrue(any(tag == "ally" for _, _, tag in g.story))


class Tension(Base):
    def test_enemies_in_view_and_damage_raise_it_and_it_decays(self):
        g, lv = field()
        d = director._dir(g)
        g.visible_hostiles = lambda: [object()] * 3
        g.player.hp -= 40
        run(g, 15)
        self.assertGreater(d.tension, 25)
        g.visible_hostiles = lambda: []
        high = d.tension
        run(g, 150)
        self.assertLess(d.tension, high * 0.5)


class Cycle(Base):
    def test_quiet_builds_into_an_announced_threat_then_release(self):
        g, lv = field()
        director.progress = lambda game: 0.30
        d = director._dir(g)
        run(g, 5)
        d.phase, d.phase_until, d.pending = "build", g.clock.turn, []
        d.tension = 0
        zombies = lambda: sum(1 for a in lv.actors if isinstance(a, Zombie)) + sum(h.size for h in g.hordes)
        n = zombies()
        run(g, 10)
        self.assertEqual(d.phase, "peak")
        self.assertTrue(d.pending, "it is announced first")
        self.assertTrue(any(tag == "dir" for _, _, tag in g.story))
        self.assertEqual(zombies(), n, "nothing has landed yet")
        run(g, director.TELEGRAPH + 10)
        self.assertFalse(d.pending)
        self.assertGreater(zombies() + len([a for a in lv.actors if not isinstance(a, Zombie)]) , 0)
        d.tension = 0
        d.last_threat = g.clock.turn - 100
        run(g, 15)
        self.assertEqual(d.phase, "release")

    def test_it_eases_off_when_you_are_in_trouble(self):
        g, lv = field()
        director.progress = lambda game: 0.60
        d = director._dir(g)
        run(g, 5)
        d.phase, d.phase_until, d.pending = "build", g.clock.turn, []
        g.player.hp = int(g.player.max_hp * 0.2)
        run(g, 10)
        self.assertEqual(d.phase, "release")
        self.assertEqual(d.pending, [])
        self.assertGreaterEqual(d.mercy, 1)

    def test_it_does_nothing_inside_a_building_or_in_the_final_stand(self):
        g, lv = field()
        director.progress = lambda game: 0.30
        d = director._dir(g)
        run(g, 5)
        d.phase, d.phase_until, d.pending, d.tension = "build", g.clock.turn, [], 0
        g.final = object()
        run(g, 30)
        self.assertEqual(d.threats, 0)
        g.final = None

    def test_it_works_indoors_too(self):
        g, lv = field()
        poi = next(q for q in g.pois.values() if q.kind == "house")
        inner = helpers.teleport(g, poi.id + ":0")
        helpers.empty_level_of_enemies(inner)
        director.progress = lambda game: 0.30
        d = director._dir(g)
        d.pending = [(g.clock.turn, "horde", 5)]
        before = len(inner.actors)
        run(g, 5)
        self.assertEqual(d.pending, [])
        self.assertGreater(len(inner.actors), before)
        self.assertTrue(any(tag == "dir" for _, _, tag in g.log))

    def test_it_leaves_a_haven_alone(self):
        g, lv = field()
        g.level.safe = True
        d = director._dir(g)
        d.pending = [(g.clock.turn, "horde", 5)]
        run(g, 5)
        self.assertEqual(len(d.pending), 1)

    def test_world_threat_generation_is_scaled_by_the_phase(self):
        g, lv = field()
        director.progress = lambda game: 0.60
        d = director._dir(g)
        run(g, 5)
        d.phase = "release"
        calm = director.scale(g)
        d.phase = "peak"
        hot = director.scale(g)
        self.assertLess(calm, 0.5)
        self.assertGreater(hot, 1.0)

    def test_early_acts_are_gentle(self):
        g, lv = field()
        director.progress = lambda game: 0.02
        d = director._dir(g)
        run(g, 5)
        d.phase = "peak"
        self.assertLessEqual(director.scale(g), 0.6)

    def test_events_lean_by_phase(self):
        g, lv = field()
        d = director._dir(g)
        d.phase = "release"
        self.assertGreater(director.event_bias(g, "cache"), 1.0)
        self.assertLess(director.event_bias(g, "toll"), 1.0)
        d.phase = "peak"
        self.assertGreater(director.event_bias(g, "toll"), 1.0)
        self.assertEqual(director.event_bias(g, "nonexistent"), 1.0)


class Beats(Base):
    def test_the_ordeal_sends_one_big_thing_and_the_reward_pays(self):
        g, lv = field()
        d = director._dir(g)
        director.progress = lambda game: 0.72
        run(g, 5)
        self.assertTrue(any(k == "boss" for _, k, _ in d.pending))
        before = sum(1 for a in lv.actors if isinstance(a, Zombie))
        run(g, director.TELEGRAPH + 30)
        self.assertGreater(sum(1 for a in lv.actors if isinstance(a, Zombie)) + sum(h.size for h in g.hordes), before)
        n = g.player.count("medkit")
        director.progress = lambda game: 0.80
        run(g, 5)
        self.assertGreater(g.player.count("medkit"), n)
        self.assertEqual(d.phase, "release")

    def test_the_mentor_gives_a_lead(self):
        g, lv = field()
        director.progress = lambda game: 0.15
        leads = sum(1 for p in g.pois.values() if p.lead)
        run(g, 5)
        self.assertGreaterEqual(sum(1 for p in g.pois.values() if p.lead), leads)

    def test_status_line(self):
        g, lv = field()
        director._dir(g)
        self.assertIn("Act", director.status(g))

    def test_endless_goes_round_the_journey_again(self):
        g, lv = field(scenario="endless")
        d = director._dir(g)
        seen = set()
        for turn in range(1000, 1000 + 240 * 20, 120):
            g.clock.turn = turn
            director.tick(g)
            if g.clock.turn % 5 == 0:
                seen.add(d.stage)
        self.assertGreaterEqual(len(seen), 4)
        self.assertLess(max(seen), len(STAGES) - 1, "the endless run never reaches the return")


if __name__ == "__main__":
    unittest.main()


class FinalAlpha(unittest.TestCase):
    def test_the_alpha_in_the_final_stand_chases_you_across_the_room(self):
        from outbreak.engine import ai
        g = helpers.make_game(seed=5, scenario="dash", era="modern")
        site = g.pois[g.final_site_id]
        lv = helpers.teleport(g, site.id + ":0")
        del lv.occ[g.player.pos]
        g.player.x, g.player.y = (24, 4)
        lv.occ[g.player.pos] = g.player
        g.requirements_met = lambda: True
        g.use_bench()
        g.final.turns_left = g.scenario.final_turns // 2
        g.clock.turn = 900
        for _ in range(3):
            g.clock.turn += 1
            g._final_tick()
        alpha = next(a for a in lv.actors if a.name == "Alpha")
        start = alpha.pos
        for _ in range(12):
            g.clock.turn += 1
            ai.run(g)
        self.assertEqual(alpha.state, "hunt")
        self.assertNotEqual(alpha.pos, start)


class Breakout(unittest.TestCase):
    def _start(self, seed=5):
        g = helpers.make_game(seed=seed, scenario="dash", era="modern")
        site = g.pois[g.final_site_id]
        lv = helpers.teleport(g, site.id + ":0")
        g.requirements_met = lambda: True
        g.use_bench()
        return g, lv

    def test_when_the_clock_runs_out_you_must_leave_by_one_door(self):
        g, lv = self._start()
        g.clock.turn = 900
        g.final.turns_left = 1
        g._final_tick()
        f = g.final
        self.assertIsNotNone(f, "not won yet")
        self.assertIsNotNone(f.exit)
        self.assertIn(f.exit, [o[0] for o in g._breakout_exits(f)])
        self.assertIsNone(g.over)

    def test_reaching_the_exit_wins_and_the_door_is_random(self):
        seen = set()
        for seed in range(3, 15):
            g, lv = self._start(seed)
            g.final.turns_left = 1
            g._final_tick()
            seen.add(g.final.exit_name)
        self.assertGreaterEqual(len(seen), 2)
        g, lv = self._start()
        g.final.turns_left = 1
        g._final_tick()
        e = g.final.exit
        if lv.portals.get(e) is not None:
            g._use_portal(e)
        else:
            del lv.occ[g.player.pos]
            g.player.x, g.player.y = e
            lv.occ[e] = g.player
            g.clock.turn += 1
            g._final_tick()
        self.assertEqual(g.over.kind, "won")
