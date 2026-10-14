import unittest

from tests import helpers
from outbreak.engine import ai, combat, raiders, tiles as T
from outbreak.engine.model import Hazard, Human
from outbreak.engine.spawn import make_raider


def field(seed=3, **kw):
    g = helpers.make_game(seed=seed, **kw)
    lv = g.world.level
    helpers.empty_level_of_enemies(lv)
    g.hordes.clear()
    g.ring = None
    p = g.player
    p.hp = p.max_hp = 10 ** 6
    for y in range(p.y - 12, p.y + 13):
        for x in range(p.x - 14, p.x + 15):
            lv.set_tile(x, y, T.GRASS)
            lv.hazards.pop((x, y), None)
    return g, lv


def raider_at(g, lv, dx, dy=0, **kw):
    r = make_raider(g, g.player.x + dx, g.player.y + dy)
    r.state = "hunt"
    for k, v in kw.items():
        setattr(r, k, v)
    lv.add_actor(r)
    return r


class RaiderTactics(unittest.TestCase):
    def test_camps_have_hidden_ambushers_and_snares(self):
        g = helpers.make_game(seed=3)
        lv = g.world.level
        hidden = [a for a in lv.actors if isinstance(a, Human) and a.hidden]
        snares = [h for h in lv.hazards.values() if h.kind == "snare"]
        self.assertTrue(g.world.camps)
        self.assertTrue(hidden)
        self.assertGreaterEqual(len(snares), 4 * len(g.world.camps) // 2)
        self.assertTrue(all(h.hidden for h in snares))
        self.assertEqual({a.squad for a in hidden} - {0} <= {a.squad for a in lv.actors if isinstance(a, Human)}, True)

    def test_hidden_raiders_are_not_visible_or_targeted(self):
        g, lv = field()
        r = raider_at(g, lv, 5, hidden=True, state="idle")
        g.update_fov()
        self.assertNotIn(r, g.visible_actors())
        self.assertNotIn(r, g.visible_hostiles())

    def test_walking_up_springs_the_ambush_creeping_up_does_not(self):
        g, lv = field()
        a = raider_at(g, lv, 3, hidden=True, state="idle", squad=7)
        b = raider_at(g, lv, 8, 4, hidden=True, state="idle", squad=7)
        humans = [a, b]
        ai._human(g, a, humans)
        self.assertFalse(a.hidden)
        ai._human(g, b, humans)
        self.assertFalse(b.hidden)                              # the whole squad springs with it
        g2, lv2 = field()
        c = raider_at(g2, lv2, 3, hidden=True, state="idle", squad=9)
        g2.player.sneaking = True
        g2.rng.random = lambda: 0.9                             # it never spots you either
        ai._human(g2, c, [c])
        self.assertTrue(c.hidden)

    def test_a_creeping_player_can_spot_the_ambusher_first(self):
        g, lv = field()
        c = raider_at(g, lv, 3, hidden=True, state="idle", squad=9)
        g.player.sneaking = True
        g.rng.random = lambda: 0.1
        ai._human(g, c, [c])
        self.assertFalse(c.hidden)
        self.assertEqual(c.state, "idle")                       # it has not seen you

    def test_hidden_snares_hurt_alert_the_camp_and_can_be_spotted_and_disarmed(self):
        g, lv = field()
        p = g.player
        near = raider_at(g, lv, 9, state="idle")
        lv.hazards[(p.x + 1, p.y)] = Hazard("snare", 10 ** 9, 8, hidden=True)
        hp = p.hp
        g.move(1, 0)
        self.assertLess(p.hp, hp)
        self.assertEqual(near.state, "hunt")
        self.assertNotIn((p.x, p.y), lv.hazards)
        # a spotted one is refused unless you creep, and disarming gives scrap
        lv.hazards[(p.x + 1, p.y)] = Hazard("snare", 10 ** 9, 8, hidden=False)
        self.assertFalse(g.move(1, 0))
        p.sneaking = True
        scrap = p.count("scrap")
        self.assertTrue(g.move(1, 0))
        self.assertNotIn((p.x + 1, p.y), lv.hazards)
        self.assertEqual(p.count("scrap"), scrap + 1)

    def test_you_spot_snares_as_you_get_close(self):
        g, lv = field()
        p = g.player
        lv.hazards[(p.x + 2, p.y)] = Hazard("snare", 10 ** 9, 8, hidden=True)
        g.rng.random = lambda: 0.0
        p.sneaking = True
        raiders.notice_snares(g)
        self.assertFalse(lv.hazards[(p.x + 2, p.y)].hidden)

    def test_snares_catch_the_dead_too(self):
        g, lv = field()
        from outbreak.engine.spawn import spawn_zombie
        z = spawn_zombie(g, lv, (g.player.x + 6, g.player.y), "walker", dormant=False)
        lv.hazards[z.pos] = Hazard("snare", 10 ** 9, 40, hidden=True)
        g._hazards()
        self.assertTrue(z.hp <= 0 or z not in lv.actors)

    def test_a_raider_does_not_shoot_forever_it_reloads(self):
        g, lv = field()
        r = raider_at(g, lv, 5)
        r.acc = 0
        shots = 0
        reloads = 0
        for _ in range(40):
            before = r.ammo
            ai._human(g, r, [r])
            if r.ammo < before:
                shots += 1
            if r.reload > 0:
                reloads += 1
        self.assertGreater(reloads, 0)
        self.assertLess(shots, 36)
        self.assertGreater(shots, 8)

    def test_a_raider_backs_off_instead_of_fleeing_when_you_close_in(self):
        g, lv = field()
        r = raider_at(g, lv, 2)
        ai._human(g, r, [r])
        self.assertGreater(max(abs(r.x - g.player.x), abs(r.y - g.player.y)), 2)    # it stepped back to range
        self.assertEqual(r.state, "hunt")
        self.assertGreater(r.morale, 30)

    def test_friends_dying_breaks_morale_and_it_runs(self):
        g, lv = field()
        a = raider_at(g, lv, 5, squad=4)
        b = raider_at(g, lv, 6, 1, squad=4)
        for _ in range(3):
            raiders.shaken(g, b)
        self.assertLess(a.morale, 30)
        d0 = max(abs(a.x - g.player.x), abs(a.y - g.player.y))
        ai._human(g, a, [a, b])
        self.assertGreater(max(abs(a.x - g.player.x), abs(a.y - g.player.y)), d0)
        a.hp = a.max_hp
        a.morale = 90
        self.assertEqual(a.state, "hunt")

    def test_flankers_do_not_walk_straight_at_you(self):
        g, lv = field()
        r = raider_at(g, lv, 11, mag=0, ammo=0, reach=1, flank=1)
        ys = set()
        for _ in range(6):
            ai._human(g, r, [r])
            ys.add(r.y)
        self.assertGreater(len(ys), 1)                           # it drifted off the straight line to you


class RaidersEverywhere(unittest.TestCase):
    def test_events_ambush_you_with_hidden_men_and_snares(self):
        g, lv = field()
        n = raiders.ambush(g, lv, 4)
        self.assertGreaterEqual(n, 3)
        mine = [a for a in lv.actors if isinstance(a, Human)]
        self.assertTrue(any(a.hidden for a in mine))
        self.assertTrue(any(not a.hidden and a.state == "hunt" for a in mine))
        self.assertEqual(len({a.squad for a in mine}), 1)
        self.assertTrue(any(h.kind == "snare" and h.hidden for h in lv.hazards.values()))
        # the visible ones are targets, the hidden ones are not
        g.update_fov()
        self.assertTrue(all(not a.hidden for a in g.visible_actors()))

    def test_the_road_event_effect_uses_it(self):
        g, lv = field()
        g.spawn_raiders_near_player(4)
        self.assertTrue(any(isinstance(a, Human) and a.hidden for a in lv.actors))

    def test_final_stand_raiders_are_a_squad(self):
        g, lv = field()
        crew = [raider_at(g, lv, 6 + i) for i in range(3)]
        raiders.squad_up(g, crew)
        self.assertEqual(len({r.squad for r in crew}), 1)
        self.assertEqual({r.flank for r in crew}, {1, -1})

    def test_tripwires_are_scattered_on_far_roads(self):
        g = helpers.make_game(seed=3)
        lv = g.world.level
        sx, sy = g.world.start
        snares = [pos for pos, h in lv.hazards.items() if h.kind == "snare"]
        camps = g.world.camps
        far = [pos for pos in snares if lv.tile(*pos) == T.ROAD and max(abs(pos[0] - sx), abs(pos[1] - sy)) >= 30]
        self.assertGreaterEqual(len(far), 2)
        self.assertTrue(all(lv.hazards[pos].hidden for pos in far))


if __name__ == "__main__":
    unittest.main()
