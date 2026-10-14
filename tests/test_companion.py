import unittest

from tests import helpers
from outbreak.content.companions import ARCHETYPES, BY_ID
from outbreak.engine import combat, companion, services, tiles as T
from outbreak.engine.model import Human, Item, Zombie
from outbreak.engine.spawn import spawn_zombie


def field(seed=3, arch=None):
    g = helpers.make_game(seed=seed)
    lv = g.world.level
    c = companion.current(g)
    for a in list(lv.actors):
        if a is not c:
            lv.remove_actor(a)
    g.hordes.clear()
    g.ring = None
    p = g.player
    p.hp = p.max_hp = 10 ** 6
    p.infected = False
    for y in range(p.y - 10, p.y + 11):
        for x in range(p.x - 12, p.x + 13):
            lv.set_tile(x, y, T.GRASS)
    if arch:
        c.trait = ""
        companion.ensure_person(g, c, arch)
    return g, lv, c


class Profiles(unittest.TestCase):
    def test_you_start_with_one_companion_from_the_pool(self):
        seen = set()
        for seed in range(1, 25):
            g = helpers.make_game(seed=seed)
            c = companion.current(g)
            self.assertIsNotNone(c)
            self.assertEqual(c.state, "follow")
            self.assertIn(c.trait, BY_ID)
            self.assertTrue(c.name and c.name != "Survivor")
            seen.add(c.trait)
        self.assertGreaterEqual(len(seen), 5, "the pool is varied")

    def test_every_archetype_has_a_strength_a_flaw_and_a_voice(self):
        self.assertGreaterEqual(len(ARCHETYPES), 8)
        for a in ARCHETYPES:
            self.assertTrue(a.strength and a.flaw and a.intro and a.farewell)
            self.assertEqual(len(a.backstory), 3)
            self.assertTrue(a.idle and a.kill and a.hurt)

    def test_anyone_can_become_a_companion_with_a_profile_fixed_by_who_they_are(self):
        g, lv, c = field()
        g.companion_uid = 0
        c.state = "patrol"
        healer = Human(g.next_uid(), "Healer", "H", c.x + 2, c.y, 30, 30, role="healer", faction="enclave")
        lv.add_actor(healer)
        g.rep["enclave"] = 40
        self.assertEqual(services.ask_join(g, healer).split()[0], healer.name)
        self.assertEqual(healer.trait, "medic")
        self.assertEqual(g.companion_uid, healer.uid)
        self.assertEqual(healer.state, "follow")

    def test_only_one_at_a_time(self):
        g, lv, c = field()
        other = Human(g.next_uid(), "Trader", "T", c.x + 2, c.y, 30, 30, role="trader", faction="enclave")
        lv.add_actor(other)
        g.rep["enclave"] = 40
        self.assertIn("only one", services.ask_join(g, other).lower())


class Effects(unittest.TestCase):
    def test_a_medic_patches_you_up(self):
        g, lv, c = field(arch="medic")
        p = g.player
        p.max_hp, p.hp = 100, 30
        g.clock.turn = 1000
        companion.tick(g)
        self.assertGreater(p.hp, 30)
        self.assertTrue(any(t == "ally" for _, _, t in g.log))

    def test_a_scout_reveals_ambushers(self):
        g, lv, c = field(arch="hunter")
        from outbreak.engine.spawn import make_raider
        r = make_raider(g, c.x + 4, c.y)
        r.hidden, r.state = True, "idle"
        lv.add_actor(r)
        g.clock.turn = 1000
        companion.tick(g)
        self.assertFalse(r.hidden)

    def test_a_scavenger_comes_back_with_something(self):
        g, lv, c = field(arch="scavenger")
        g.rng.random = lambda: 0.0
        n = sum(i.qty for i in g.player.inventory)
        companion.on_return(g)
        self.assertGreater(sum(i.qty for i in g.player.inventory), n)

    def test_a_loud_companion_makes_noise(self):
        g, lv, c = field(arch="scavenger")
        g.rng.random = lambda: 0.0
        g.clock.turn = 50 * 25
        before = len(g.pings)
        companion.tick(g)
        self.assertGreater(len(g.pings), before)

    def test_a_hungry_companion_eats_your_food(self):
        g, lv, c = field(arch="hunter")
        g.player.inventory.append(Item("food", 3))
        c.since = 0
        g.clock.turn = 1000
        companion.tick(g)
        self.assertEqual(g.player.count("food"), 2)

    def test_a_coward_runs_early_and_a_pacifist_will_not_fight_people(self):
        g, lv, c = field(arch="mechanic")
        self.assertEqual(companion.flee_below(c), 0.6)
        g2, lv2, c2 = field(arch="preacher")
        raider = Human(g2.next_uid(), "Raider", "r", c2.x + 3, c2.y, 10, 10, role="raider", faction="raiders", hostile=True)
        self.assertTrue(companion.refuses_to_fight(c2, raider))
        z = Zombie(1, "Z", "z", 0, 0, 5, 5)
        self.assertFalse(companion.refuses_to_fight(c2, z))

    def test_a_fighter_fights_better_than_a_frail_medic(self):
        g, lv, c = field(arch="veteran")
        g2, lv2, m = field(arch="medic")
        self.assertGreater(c.max_hp, m.max_hp)
        self.assertGreater(sum(c.dmg), sum(m.dmg))


class Bond(unittest.TestCase):
    def test_time_and_gifts_raise_it_and_killing_innocents_lowers_it(self):
        g, lv, c = field(arch="preacher")
        b = c.bond
        g.clock.turn = 100
        companion.tick(g)
        self.assertGreater(c.bond, b)
        g.player.inventory.append(Item("food", 1))
        b = c.bond
        companion.give(g, c, len(g.player.inventory) - 1)
        self.assertGreater(c.bond, b)
        victim = Human(g.next_uid(), "Stranger", "S", c.x + 2, c.y, 5, 5, role="survivor", faction="enclave")
        b = c.bond
        companion.on_player_kills_human(g, victim)
        self.assertLess(c.bond, b - 10, "a pacifist cannot bear it")

    def test_a_broken_bond_makes_them_leave(self):
        g, lv, c = field()
        c.bond = 3
        g.clock.turn = 7
        companion.tick(g)
        self.assertIsNone(companion.current(g))
        self.assertEqual(c.state, "patrol")

    def test_what_you_have_become_matters(self):
        g, lv, c = field()
        g.player.humanity = 10
        companion.tick(g)
        self.assertIsNone(companion.current(g))

    def test_their_story_comes_out_as_the_bond_grows(self):
        g, lv, c = field(arch="veteran")
        c.bond = 40
        t1 = companion.talk(g, c)
        self.assertIn(BY_ID["veteran"].backstory[0][1:20], t1)
        self.assertEqual(c.story, 1)
        c.bond = 90
        companion.talk(g, c)
        companion.talk(g, c)
        self.assertEqual(c.story, 3)

    def test_advice_names_the_next_objective(self):
        g, lv, c = field()
        self.assertIn(c.name, companion.advice(g))


class Death(unittest.TestCase):
    def test_a_dead_companion_stays_dead_and_the_log_says_so(self):
        g, lv, c = field()
        c.hp = 1
        z = spawn_zombie(g, lv, (c.x + 1, c.y), "walker", False)
        combat.kill_human_other(g, c, z)
        self.assertIsNone(companion.current(g))
        self.assertEqual(g.companion_uid, 0)
        self.assertIn(c.name, g.fallen_allies[-1][0])
        self.assertTrue(any("is dead" in t and tag == "ally" for _, t, tag in g.story))
        self.assertNotIn(c, lv.actors)

    def test_anyone_else_can_take_their_place(self):
        g, lv, c = field()
        combat.kill_human_other(g, c, spawn_zombie(g, lv, (c.x + 2, c.y), "walker", False))
        other = Human(g.next_uid(), "Soldier", "f", g.player.x + 2, g.player.y, 20, 20, role="soldier", faction="military")
        lv.add_actor(other)
        g.rep["military"] = 30
        services.ask_join(g, other)
        self.assertEqual(g.companion_uid, other.uid)

    def test_the_ending_remembers_them(self):
        g, lv, c = field()
        name = c.name
        combat.kill_human_other(g, c, spawn_zombie(g, lv, (c.x + 2, c.y), "walker", False))
        from outbreak.engine import ending
        e = ending.build(g, "dead", "test")
        self.assertTrue(any(name in line for line in e.summary))


class Log(unittest.TestCase):
    def test_the_default_log_is_objectives_and_companion_not_noise(self):
        g, lv, c = field()
        g.msg("You swing at the thing and miss.", "combat")
        g.msg("Mina: \"hi\"", "ally")
        g.msg("Done: something.", "obj")
        g.msg("A horde appears!", "bad", key=True)
        tags = {t for _, _, t in g.story}
        self.assertIn("ally", tags)
        self.assertIn("obj", tags)
        self.assertNotIn("combat", tags)
        self.assertTrue(any("swing" in t for _, t, _ in g.log), "the full log keeps everything")

    def test_objective_changes_are_announced(self):
        g, lv, c = field()
        g.clock.turn = 10
        from outbreak.engine import objective
        objective.watch(g)
        n = len(g.story)
        g.formula_found = True
        for p in g.pois.values():
            if p.component:
                p.lead = True
                p.revealed = True
        g.clock.turn = 20
        objective.watch(g)
        self.assertTrue(any(t == "obj" for _, _, t in g.story[n - 1:]) or len(g.story) > n)

    def test_build_log_pins_the_goal(self):
        from outbreak.ui import render
        g, lv, c = field()
        g.msg("Day 1.", "obj")
        lines = render.build_log(g, 5, 80)
        self.assertTrue(lines[0][0].startswith("GOAL"))
        self.assertLessEqual(len(lines), 5)
        full = render.build_log(g, 5, 80, full=True)
        self.assertFalse(any(t.startswith("GOAL") for t, _ in full))


class Combat(unittest.TestCase):
    def test_the_dead_attack_a_companion_and_it_can_die(self):
        g, lv, c = field(arch="medic")
        g.clock.turn = 1000                       # past the opening grace
        c.hp = 6
        z = spawn_zombie(g, lv, (c.x + 1, c.y), "walker", False)
        z.hp = z.max_hp = 500
        z.speed = 2.0                                   # a runner: you cannot walk away from it
        z.dmg, z.acc = (30, 40), 95                     # one clean blow: running to you is not a guarantee
        del lv.occ[g.player.pos]
        g.player.x, g.player.y = c.x - 7, c.y
        lv.occ[g.player.pos] = g.player
        for _ in range(80):
            if companion.current(g) is None:
                break
            g.clock.turn += 1
            from outbreak.engine import ai
            ai.run(g)
        self.assertIsNone(companion.current(g), "a companion is not invincible")
        self.assertTrue(any("is dead" in t for _, t, _ in g.story))

    def test_every_companion_role_is_a_target_not_just_fighters(self):
        g, lv, c = field(arch="medic")
        c.role = "survivor"
        z = spawn_zombie(g, lv, (c.x + 2, c.y), "walker", False)
        z.state, z.target = "hunt", c.pos
        z.hp = z.max_hp = 500
        z.dmg, z.acc = (4, 6), 95
        del lv.occ[g.player.pos]
        g.player.x, g.player.y = c.x + 8, c.y + 8
        lv.occ[g.player.pos] = g.player
        hp = c.hp
        from outbreak.engine import ai
        for _ in range(12):
            g.clock.turn += 1
            ai.run(g)
        self.assertLess(c.hp, hp)

    def test_they_do_not_leave_you_to_chase_a_fight_while_you_run(self):
        g, lv, c = field(arch="brute")
        z = spawn_zombie(g, lv, (c.x + 5, c.y + 3), "walker", False)
        z.state = "idle"
        del lv.occ[g.player.pos]
        g.player.x, g.player.y = c.x - 9, c.y
        lv.occ[g.player.pos] = g.player
        before = max(abs(c.x - g.player.x), abs(c.y - g.player.y))
        from outbreak.engine import ai
        for _ in range(6):
            g.clock.turn += 1
            ai.run(g)
        after = max(abs(c.x - g.player.x), abs(c.y - g.player.y))
        self.assertLess(after, before, "they come back to you")
        self.assertTrue(companion.should_hold_back(g, c, z) or after < before)

    def test_a_reckless_one_still_charges(self):
        g, lv, c = field(arch="veteran")
        self.assertEqual(companion.leash(c), companion.LEASH_RECKLESS)
        g2, lv2, m = field(arch="medic")
        self.assertEqual(companion.leash(m), companion.LEASH)

    def test_they_shout_when_a_fight_starts_when_you_are_hit_and_when_left_behind(self):
        g, lv, c = field(arch="veteran")
        z = spawn_zombie(g, lv, (c.x + 1, c.y), "walker", False)
        from outbreak.engine import ai
        g.clock.turn = 2000
        ai._human_fight(g, c, z)
        self.assertTrue(any(tag == "ally" and "Contact" in t or tag == "ally" and c.name in t for _, t, tag in g.story[-4:]))
        n = len(g.story)
        g.clock.turn = 3000
        combat.damage_player(g, 6, "test")
        self.assertGreater(len(g.story), n, "a shout when you are hit")
        g.clock.turn = 4000
        companion.on_regroup(g, c)
        self.assertIn("ally", [tag for _, _, tag in g.story[-2:]])

    def test_their_blows_show_in_the_story_log(self):
        g, lv, c = field(arch="veteran")
        z = spawn_zombie(g, lv, (c.x + 1, c.y), "walker", False)
        z.hp = z.max_hp = 100
        for _ in range(8):
            combat.attack_actor(g, c, z)
        self.assertTrue(any(tag == "ally" and ("hits" in t or "misses" in t) for _, t, tag in g.story))


if __name__ == "__main__":
    unittest.main()


class OpeningGrace(unittest.TestCase):
    def test_the_dead_hit_your_people_softer_in_the_opening(self):
        from outbreak.engine import combat
        hits = {}
        for turn in (10, 2000):
            g, lv, c = field(arch="medic")
            g.clock.turn = turn
            z = spawn_zombie(g, lv, (c.x + 1, c.y), "walker", False)
            z.dmg, z.acc = (10, 10), 100
            c.hp = c.max_hp = 100
            for _ in range(20):
                combat.attack_actor(g, z, c)
            hits[turn] = 100 - c.hp
        self.assertLess(hits[10], hits[2000] * 0.6)

    def test_the_tide_keeps_them_at_your_shoulder(self):
        g, lv, c = field(arch="brute")
        self.assertEqual(companion.leash(c, g), companion.LEASH_RECKLESS if companion.is_reckless(c) else companion.LEASH)
        class R: active = True
        g.ring = R()
        self.assertEqual(companion.leash(c, g), companion.LEASH_TIDE)


class Mirroring(unittest.TestCase):
    def test_they_creep_and_run_when_you_do(self):
        g, lv, c = field(arch="brute")
        g.clock.turn = 1000
        g.player.sneaking = True
        companion.tick(g)
        self.assertTrue(c.sneaking and not c.sprinting)
        g.player.sneaking, g.player.sprinting = False, True
        companion.tick(g)
        self.assertTrue(c.sprinting and not c.sneaking)
        g.player.sprinting = False
        companion.tick(g)
        self.assertFalse(c.sneaking or c.sprinting)

    def test_a_creeping_companion_is_only_noticed_up_close(self):
        from outbreak.engine import ai
        g, lv, c = field(arch="brute")
        z = spawn_zombie(g, lv, (c.x + 4, c.y), "walker", False)
        self.assertIs(ai.nearest_foe(g, z, [c], 5), c)
        c.sneaking = True
        self.assertIsNone(ai.nearest_foe(g, z, [c], 5))

    def test_they_level_up_with_you(self):
        g, lv, c = field(arch="brute")
        hp, lvl = c.max_hp, c.lvl
        g.player.gain_xp(10 ** 5)
        companion.tick(g)
        self.assertEqual(c.lvl, g.player.level)
        self.assertGreater(c.max_hp, hp)
        self.assertTrue(any("grows with you" in t for _, t, _ in g.log))


class Doors(unittest.TestCase):
    def test_they_follow_you_in_and_out(self):
        g, lv, c = field(arch="brute")
        door = next((pos for pos, pt in lv.portals.items() if pt.target != "world" and g.pois[pt.target.rsplit(":", 1)[0]].kind == "house"), None)
        self.assertIsNotNone(door)
        from outbreak.engine import tiles as T
        p = g.player
        spot = lv.free_spot_near(door[0], door[1] + 1, 2)
        del lv.occ[p.pos]
        p.x, p.y = spot
        lv.occ[p.pos] = p
        lv.remove_actor(c)
        c.x, c.y = lv.free_spot_near(spot[0] + 1, spot[1], 2)
        lv.add_actor(c)
        self.assertTrue(g._use_portal(door))
        self.assertIsNot(g.level, lv)
        self.assertIn(c, g.level.actors)
        self.assertIs(companion.current(g), c)
        portal = next(pos for pos, pt in g.level.portals.items() if pt.target == "world")
        self.assertTrue(g._use_portal(portal))
        self.assertIs(g.level, g.world.level)
        self.assertIn(c, g.world.level.actors)
        self.assertIs(companion.current(g), c)

    def test_one_left_far_behind_waits_outside(self):
        g, lv, c = field(arch="brute")
        door = next(pos for pos, pt in lv.portals.items() if pt.target != "world")
        p = g.player
        spot = lv.free_spot_near(door[0], door[1] + 1, 2)
        del lv.occ[p.pos]
        p.x, p.y = spot
        lv.occ[p.pos] = p
        lv.remove_actor(c)
        c.x, c.y = spot[0] + 28, spot[1]
        lv.add_actor(c)
        g._use_portal(door)
        self.assertNotIn(c, g.level.actors)
        self.assertIn(c, g.world.level.actors)


class Feedback(unittest.TestCase):
    def test_a_refused_shot_shows_in_the_focused_log(self):
        g, lv, c = field(arch="brute")
        g.clock.turn = 500
        g.msg("Out of bullets.", "warn")
        g.msg("Noise from a drain.", "info")
        shown = [t for _, t, _ in g.story_log()]
        self.assertIn("Out of bullets.", shown)
        self.assertNotIn("Noise from a drain.", shown)
        g.clock.turn = 600
        self.assertNotIn("Out of bullets.", [t for _, t, _ in g.story_log()])


class Orders(unittest.TestCase):
    def _fight(self, arch="brute", at=6):
        from outbreak.engine import ai
        g, lv, c = field(arch=arch)
        g.clock.turn = 1000
        z = spawn_zombie(g, lv, (c.x + at, c.y), "walker", False)
        z.hp = z.max_hp = 400
        z.dmg = (1, 1)
        z.state, z.target = "idle", None
        return g, lv, c, z, ai

    def test_engage_sends_them_after_the_nearest_enemy(self):
        g, lv, c, z, ai = self._fight("brute", 9)
        del lv.occ[g.player.pos]
        g.player.x, g.player.y = c.x - 12, c.y             # far beyond the usual leash
        lv.occ[g.player.pos] = g.player
        g.visible_hostiles = lambda: [z]
        c.tamed = True
        companion.give_order(g, c, "engage")
        self.assertEqual(companion.order_of(c), "engage")
        d0 = max(abs(c.x - z.x), abs(c.y - z.y))
        for _ in range(8):
            g.clock.turn += 1
            ai.run(g)
        self.assertLess(max(abs(c.x - z.x), abs(c.y - z.y)), d0)

    def test_engage_with_nothing_in_sight_is_refused(self):
        g, lv, c, z, ai = self._fight()
        g.visible_hostiles = lambda: []
        companion.give_order(g, c, "engage")
        self.assertEqual(companion.order_of(c), "")

    def test_fall_back_and_escape_bring_them_to_you_without_fighting(self):
        for kind in ("fallback", "escape"):
            g, lv, c, z, ai = self._fight("brute", 2)
            c.tamed = True
            del lv.occ[g.player.pos]
            g.player.x, g.player.y = c.x - 10, c.y
            lv.occ[g.player.pos] = g.player
            z.state, z.target = "idle", None
            companion.give_order(g, c, kind)
            hp = z.hp
            for _ in range(6):
                g.clock.turn += 1
                ai.run(g)
            self.assertLessEqual(max(abs(c.x - g.player.x), abs(c.y - g.player.y)), 6, kind)
            self.assertEqual(z.hp, hp, kind)

    def test_ranged_needs_a_ranged_weapon_and_keeps_the_distance(self):
        g, lv, c, z, ai = self._fight("brute", 2)
        companion.give_order(g, c, "ranged")
        self.assertEqual(companion.order_of(c), "", "a brute has nothing to shoot with")
        c.reach = 6
        c.tamed = True
        companion.give_order(g, c, "ranged")
        self.assertEqual(companion.order_of(c), "ranged")
        z.state, z.target = "hunt", c.pos
        for _ in range(3):
            g.clock.turn += 1
            ai.run(g)
        self.assertGreaterEqual(max(abs(c.x - z.x), abs(c.y - z.y)), 2)

    def test_orders_expire(self):
        g, lv, c, z, ai = self._fight()
        c.tamed = True
        companion.give_order(g, c, "guard")
        self.assertEqual(companion.leash(c, g), 2)
        g.clock.turn += companion.ORDERS["guard"][2] + 1
        companion.tick(g)
        self.assertEqual(companion.order_of(c), "")


class KeepingUp(unittest.TestCase):
    def test_they_hustle_when_they_fall_behind(self):
        from outbreak.engine import ai
        g, lv, c = field(arch="brute")
        g.clock.turn = 1000
        c.x, c.y = lv.free_spot_near(g.player.x - 11, g.player.y, 2)
        lv.remove_actor(c)
        lv.add_actor(c)
        d0 = max(abs(c.x - g.player.x), abs(c.y - g.player.y))
        for _ in range(4):
            g.clock.turn += 1
            ai.run(g)
        d1 = max(abs(c.x - g.player.x), abs(c.y - g.player.y))
        self.assertLessEqual(d1, d0 - 6, "more than one step a turn when far behind")

    def test_a_lost_companion_catches_up(self):
        g, lv, c = field(arch="brute")
        g.clock.turn = 1000
        lv.remove_actor(c)
        c.x, c.y = g.player.x + 34, g.player.y
        lv.add_actor(c)
        companion.tick(g)
        self.assertLess(max(abs(c.x - g.player.x), abs(c.y - g.player.y)), 8)
        self.assertTrue(any("catches up" in t for _, t, _ in g.log))


class Trees(unittest.TestCase):
    def test_you_swap_places_with_your_companion_in_a_narrow_path(self):
        g, lv, c = field(arch="mechanic")
        p = g.player
        lv.remove_actor(c)
        c.x, c.y = p.x + 1, p.y
        lv.add_actor(c)
        before = (p.pos, c.pos)
        self.assertTrue(g.move(1, 0))
        self.assertEqual((p.pos, c.pos), (before[1], before[0]))

    def test_a_companion_boxed_in_by_trees_finds_its_way_to_you(self):
        from outbreak.engine import ai
        g, lv, c = field(arch="mechanic")
        g.clock.turn = 1000
        lv.remove_actor(c)
        p = g.player
        c.x, c.y = p.x - 8, p.y
        lv.add_actor(c)
        for dy in (-1, 0, 1):
            for dx in (-1, 0, 1):
                if dx or dy:
                    lv.set_tile(c.x + dx, c.y + dy, T.TREE)
        for _ in range(12):
            g.clock.turn += 1
            ai.run(g)
        self.assertLessEqual(max(abs(c.x - p.x), abs(c.y - p.y)), 5)
        self.assertTrue(any("undergrowth" in t for _, t, _ in g.log))


class Gear(unittest.TestCase):
    def _give(self, g, item_id, qty=1):
        from outbreak.engine.model import Item
        g.player.inventory.append(Item(item_id, qty, g.item_def(item_id).durability or None))
        return len(g.player.inventory) - 1

    def test_a_weapon_changes_what_they_hit_with(self):
        g, lv, c = field(arch="medic")
        base = c.dmg
        i = self._give(g, "mace" if "mace" in g.items else "bat")
        c.tamed = True
        companion.equip(g, c, i)
        self.assertIsNotNone(c.gear_weapon)
        self.assertGreater(c.dmg[1], base[1])
        self.assertFalse(any(it.id == c.gear_weapon.id and it is c.gear_weapon for it in g.player.inventory))
        companion.unequip(g, c, "weapon")
        self.assertEqual(c.dmg, base)
        self.assertTrue(any(it.id in ("mace", "bat") for it in g.player.inventory))

    def test_armour_turns_blows_and_levelling_keeps_the_base(self):
        from outbreak.engine import combat
        g, lv, c = field(arch="medic")
        g.clock.turn = 2000
        c.hp = c.max_hp = 1000
        z = spawn_zombie(g, lv, (c.x + 1, c.y), "walker", False)
        z.dmg, z.acc = (6, 6), 100
        hits = {}
        for armour in (False, True):
            if armour:
                companion.equip(g, c, self._give(g, "vest" if "vest" in g.items else "jerkin"))
            hp = c.hp
            for _ in range(10):
                combat.attack_actor(g, z, c)
            hits[armour] = hp - c.hp
        self.assertLess(hits[True], hits[False])
        base = c.bdmg
        g.player.gain_xp(10 ** 5)
        companion.tick(g)
        self.assertGreater(c.bdmg[1], base[1])

    def test_a_ranged_weapon_needs_ammunition_and_a_pacifist_refuses(self):
        g, lv, c = field(arch="brute")
        c.tamed = True
        bow = "bow" if "bow" in g.items else "pistol"
        ammo = g.item_def(bow).ammo
        companion.equip(g, c, self._give(g, bow))
        self.assertEqual(c.reach, 1, "no ammunition yet")
        companion.equip(g, c, self._give(g, ammo, 5))
        self.assertGreater(c.reach, 1)
        self.assertEqual(c.gear_ammo, 5)
        for _ in range(5):
            companion.use_ammo(g, c)
        self.assertEqual(c.reach, 1, "out of ammunition: melee again")
        g2, lv2, p = field(arch="preacher")
        msg = companion.equip(g2, p, self._give(g2, "mace" if "mace" in g2.items else "bat"))
        self.assertIsNone(p.gear_weapon)
        self.assertIn("will not carry", msg)

    def test_gear_comes_back_when_they_leave_and_drops_when_they_fall(self):
        g, lv, c = field(arch="brute")
        c.tamed = True
        companion.equip(g, c, self._give(g, "mace" if "mace" in g.items else "bat"))
        companion.dismiss(g, c)
        self.assertIsNone(c.gear_weapon)
        self.assertTrue(any(it.id in ("mace", "bat") for it in g.player.inventory))
        g, lv, c = field(arch="brute")
        c.tamed = True
        companion.equip(g, c, self._give(g, "mace" if "mace" in g.items else "bat"))
        companion.on_death(g, c, "a test")
        self.assertTrue(any(it.id in ("mace", "bat") for stack in lv.items.values() for it in stack))
