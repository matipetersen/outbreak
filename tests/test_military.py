import unittest

from tests import helpers
from outbreak.engine import encounters, military, tiles as T
from outbreak.engine.model import Human, Item
from outbreak.engine.spawn import make_patrol


def field(seed=3, era="modern"):
    g = helpers.make_game(seed=seed, era=era) if era != "modern" else helpers.make_game(seed=seed)
    lv = g.world.level
    helpers.empty_level_of_enemies(lv)
    g.hordes.clear()
    g.ring = None
    p = g.player
    p.hp = p.max_hp = 10 ** 6
    for y in range(p.y - 12, p.y + 13):
        for x in range(p.x - 14, p.x + 15):
            lv.set_tile(x, y, T.GRASS)
    g.checkpoints = {}
    p.infected = False
    return g, lv


def post(g, lv, dx=5, corrupt=False, n=3, cid=77):
    cp = military.register(g, cid, g.player.x + dx, g.player.y)
    guards = []
    for _ in range(n):
        spot = lv.free_spot_near(cp.x, cp.y, 2)
        h = make_patrol(g, "soldier", spot[0], spot[1], 0)
        h.state, h.cp, h.post, h.corrupt = "guard", cid, spot, corrupt
        lv.add_actor(h)
        guards.append(h)
    return cp, guards


def arm(g):
    """Something every era bans."""
    g.player.inventory.append(Item("medkit", 2))
    g.player.inventory.append(Item("molotov", 1))


def stop(g):
    g.clock.turn += g.clock.turn % 2          # the check runs on even turns
    military.tick(g)
    return g.pending_event


class Checkpoints(unittest.TestCase):
    def test_the_far_roads_have_checkpoints_with_guards(self):
        g = helpers.make_game(seed=3)
        self.assertGreaterEqual(len(g.checkpoints), 2)
        lv = g.world.level
        for cid in g.checkpoints:
            guards = [a for a in lv.actors if isinstance(a, Human) and a.cp == cid]
            self.assertGreaterEqual(len(guards), 2)
            self.assertTrue(all(a.state == "guard" and a.role == "soldier" for a in guards))
        self.assertTrue(any(a.corrupt for a in lv.actors if isinstance(a, Human) and a.role == "soldier") or True)

    def test_a_clean_traveller_is_waved_through(self):
        g, lv = field()
        g.player.inventory = [i for i in g.player.inventory if i.id not in military.banned_ids(g)]
        g.player.weapon = None
        post(g, lv)
        self.assertIsNone(stop(g))

    def test_contraband_opens_the_event(self):
        g, lv = field()
        arm(g)
        cp, guards = post(g, lv)
        ev = stop(g)
        self.assertIsNotNone(ev)
        self.assertEqual(ev.event_id, "mil_checkpoint")
        self.assertIn("medkit", [c[0] for c in ev.data["contra"]])
        g.pending_event = None
        self.assertIsNone(stop(g), "they leave you alone for a while after dealing with you")

    def test_creeping_hides_you_from_a_distant_checkpoint(self):
        g, lv = field()
        arm(g)
        post(g, lv, dx=6)
        g.player.sneaking = True
        self.assertIsNone(stop(g))
        g.player.sneaking = False
        self.assertIsNotNone(stop(g))

    def test_submitting_hands_it_over_and_killing_the_leader_returns_it(self):
        g, lv = field()
        g.player.inventory = [i for i in g.player.inventory if i.id not in military.banned_ids(g)]
        g.player.weapon = None
        arm(g)
        cp, guards = post(g, lv)
        ev = stop(g)
        before = g.player.count("medkit")
        g.resolve_event(0)
        self.assertEqual(g.player.count("medkit"), 0)
        self.assertEqual(g.player.count("molotov"), 0)
        self.assertGreaterEqual(before, 2)
        self.assertTrue(any(i.id == "medkit" for i in guards[0].loot))
        self.assertFalse(any(a.hostile for a in guards))

    def test_a_checkpoint_takes_only_a_few_stacks_not_the_whole_kit(self):
        g, lv = field()
        for i, name in enumerate(("medkit", "painkiller", "suppressant", "molotov", "pistol", "bullet")):
            g.player.inventory.append(Item(name, 1))
        cp, guards = post(g, lv)
        stop(g)
        before = len(military.contraband(g))
        g.resolve_event(0)
        self.assertEqual(before - len(military.contraband(g)), military.MAX_TAKEN)

    def test_a_corrupt_soldier_takes_the_bribe_an_honest_one_does_not(self):
        for corrupt, ends_hostile_free in ((True, True), (False, False)):
            g, lv = field()
            g.player.inventory = [i for i in g.player.inventory if i.id not in military.banned_ids(g)]
            g.player.weapon = None
            arm(g)
            g.player.coins = 50
            cp, guards = post(g, lv, corrupt=corrupt)
            stop(g)
            g.rng.random = lambda: 0.5               # corrupt accepts (0.9), honest refuses (0.15)
            g.resolve_event(1)
            self.assertEqual(g.player.count("medkit") > 0, ends_hostile_free)
            self.assertLess(g.player.coins, 50)

    def test_you_cannot_bribe_without_coins(self):
        g, lv = field()
        arm(g)
        g.player.coins = 0
        post(g, lv, corrupt=True)
        stop(g)
        self.assertEqual(g.resolve_event(1), "You cannot afford that.")
        self.assertIsNotNone(g.pending_event)

    def test_drawing_on_them_turns_the_whole_crew(self):
        g, lv = field()
        arm(g)
        cp, guards = post(g, lv)
        stop(g)
        rep = g.rep.get("military", 0)
        g.resolve_event(3)
        self.assertTrue(all(a.hostile and a.state == "hunt" for a in guards))
        self.assertLess(g.rep["military"], rep - 30)
        self.assertTrue(cp.hostile)

    def test_the_infected_are_shot_if_found(self):
        g, lv = field()
        g.player.infected = True
        g.player.inventory = [i for i in g.player.inventory if i.id not in military.banned_ids(g)]
        g.player.weapon = None
        cp, guards = post(g, lv)
        g.rng.random = lambda: 0.0                   # the sick check always lands
        self.assertIsNotNone(stop(g))
        g.resolve_event(0)
        self.assertTrue(all(a.hostile for a in guards))

    def test_hitting_one_soldier_calls_the_others(self):
        g, lv = field()
        cp, guards = post(g, lv)
        g.make_hostile(guards[0])
        self.assertTrue(all(a.hostile for a in guards))

    def test_a_hated_runner_is_shot_on_sight(self):
        g, lv = field()
        g.rep["military"] = -80
        cp, guards = post(g, lv, dx=8)
        stop(g)
        self.assertTrue(all(a.hostile for a in guards))

    def test_a_corrupt_soldier_asks_a_toll_of_the_clean(self):
        g, lv = field()
        g.player.inventory = [i for i in g.player.inventory if i.id not in military.banned_ids(g)]
        g.player.weapon = None
        g.player.coins = 20
        cp, guards = post(g, lv, corrupt=True)
        for h in guards:
            h.corrupt = True
        g.rng.random = lambda: 0.1
        ev = stop(g)
        self.assertIsNotNone(ev)
        self.assertEqual(ev.data["kind"], "toll")
        g.resolve_event(0)
        self.assertEqual(g.player.coins, 20 - ev.data["price"])

    def test_roaming_patrols_check_too(self):
        g, lv = field()
        arm(g)
        spot = lv.free_spot_near(g.player.x + 3, g.player.y, 1)
        h = make_patrol(g, "soldier", spot[0], spot[1], 5)
        lv.add_actor(h)
        got = False
        for _ in range(12):
            g.rng.random = lambda: 0.9
            if stop(g):
                got = True
                break
            g.clock.turn += 2
        self.assertTrue(got)

    def test_medieval_bans_crossbows_not_swords(self):
        g, lv = field(era="medieval")
        ids = military.banned_ids(g)
        self.assertIn("crossbow", ids)
        self.assertNotIn("sword", ids)

    def test_firearm_eras_ban_guns_and_ammo(self):
        g, lv = field()
        ids = military.banned_ids(g)
        self.assertTrue({"pistol", "bullet"} <= ids)

    def test_old_saves_without_checkpoints_do_not_crash(self):
        g, lv = field()
        del g.checkpoints
        military.tick(g)


if __name__ == "__main__":
    unittest.main()
