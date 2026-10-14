import unittest

from tests.helpers import make_game
from outbreak.engine import combat, lives
from outbreak.engine.model import Zombie
from outbreak.engine.spawn import make_raider, spawn_zombie


def living(**kw):
    kw.setdefault("mode", "living")
    kw.setdefault("seed", 3)
    return make_game(**kw)


def clear(g):
    lv = g.world.level
    for a in list(lv.actors):
        if not a.is_player:
            lv.remove_actor(a)
    g.hordes.clear()
    return lv


class LivingWorld(unittest.TestCase):
    def test_normal_mode_still_ends_on_death(self):
        g = make_game(seed=3)
        g.player.hp = 0
        g.end("dead", "x")
        self.assertIsNotNone(g.over)

    def test_death_replaces_player_and_world_continues(self):
        g = living()
        lv = clear(g)
        g.player.gain_xp(200)
        old_level = g.player.level
        old_pos = g.player.pos
        item_ids = [i.id for i in g.player.inventory]
        turn = g.clock.turn
        z = spawn_zombie(g, lv, lv.free_spot_near(old_pos[0] + 1, old_pos[1], 3), "walker", dormant=False)
        g.player.hp = 1
        combat.damage_player(g, 5, "torn apart", z)
        self.assertIsNone(g.over)
        self.assertEqual(g.generation, 2)
        self.assertEqual(len(g.fallen), 1)
        self.assertEqual(g.clock.turn, turn)
        self.assertEqual(g.player.level, max(1, old_level // 2))
        self.assertGreater(g.player.hp, 0)
        refuge = g.pois[g.refuge_id]
        self.assertLess(abs(g.player.x - refuge.x) + abs(g.player.y - refuge.y), 20)
        self.assertTrue(g.death_notice)
        # gear on the floor, body on the corpse list
        self.assertIn(old_pos, lv.items)
        self.assertEqual(lv.corpses[old_pos][1], 2)
        self.assertTrue(set(item_ids) <= {i.id for i in lv.items[old_pos]})

    def test_killer_levels_and_is_named(self):
        g = living()
        lv = clear(g)
        z = spawn_zombie(g, lv, lv.free_spot_near(g.player.x + 1, g.player.y, 3), "walker", dormant=False)
        g.clock.turn = 10 * 240          # a late day: the level cap is high
        hp0, lvl0 = z.max_hp, z.lvl
        g.player.hp = 1
        combat.damage_player(g, 9, "x", z)
        self.assertGreater(z.lvl, lvl0)
        self.assertGreater(z.max_hp, hp0)
        self.assertTrue(z.title.startswith("Killer of"))
        self.assertIn("Lv", z.name)
        self.assertIn(z, lv.actors)                 # it does not go away

    def test_fallen_body_rises_named_and_leveled(self):
        g = living()
        lv = clear(g)
        g.player.gain_xp(400)
        pos = g.player.pos
        g.player.hp = 0
        g.end("dead", "bled out")
        g.clock.turn += 60
        # the new survivor is far away, so the body can rise
        g._rising_dead()
        fallen = [a for a in lv.actors if isinstance(a, Zombie) and a.pos == pos]
        self.assertEqual(len(fallen), 1)
        self.assertTrue(fallen[0].name.startswith("Fallen "))
        self.assertGreaterEqual(fallen[0].lvl, 2)

    def test_enemies_level_by_killing_and_are_capped_by_the_calendar(self):
        g = living()
        lv = clear(g)
        raider = make_raider(g, 0, 0)
        spot = lv.free_spot_near(g.player.x + 10, g.player.y + 10, 4)
        lv.add_actor(raider)
        lv.move_actor(raider, *spot)
        for _ in range(40):
            lives.grant_xp(g, raider, 30)
        self.assertEqual(raider.lvl, lives.level_cap(g))
        self.assertLessEqual(raider.lvl, 3)            # day 1
        g.clock.turn = 6 * 240
        lives.grant_xp(g, raider, 500)
        self.assertGreater(raider.lvl, 3)

    def test_normal_mode_enemies_do_not_level(self):
        g = make_game(seed=3)
        lv = clear(g)
        raider = make_raider(g, 0, 0)
        lv.add_actor(raider)
        lives.grant_xp(g, raider, 500)
        self.assertEqual(raider.lvl, 1)

    def test_cure_is_for_the_world_nobody_starts_bitten(self):
        g = living(scenario="cure")
        self.assertFalse(g.player.infected)
        self.assertIn("one of many", g.intro_pages[3][1])
        n = make_game(scenario="cure", seed=3)
        self.assertTrue(n.player.infected)

    def test_turning_is_a_death_too(self):
        g = living()
        g.player.infected = True
        g.player.infection_timer = 1
        g._spend(2)
        self.assertEqual(g.generation, 2)
        self.assertFalse(g.player.infected)

    def test_world_state_persists_across_lives(self):
        g = living()
        g.know.learn_random(g.rng, 10)
        known = len(g.know.known)
        lead_poi = next(iter(g.pois.values()))
        lead_poi.lead = True
        g.player.hp = 0
        g.end("dead", "x")
        self.assertTrue(lead_poi.lead)
        self.assertLessEqual(len(g.know.known), known + 6)            # a new origin may teach a few words
        self.assertGreaterEqual(len(g.know.known), known // 2)

    def test_big_horde_does_not_lose_zombies(self):
        from outbreak.engine import hordes
        g = living(zombies="swarm")
        lv = clear(g)
        p = g.player
        h = hordes.spawn_horde(g, lv.free_spot_near(p.x + 8, p.y + 8, 4), 60, p.pos)
        total = 0
        for _ in range(8):
            if h in g.hordes:
                hordes.materialize(g, h) if g.clock.turn >= h.wait_until else None
            g.clock.turn += 13
        zs = sum(1 for a in lv.actors if isinstance(a, Zombie))
        left = sum(x.size for x in g.hordes)
        self.assertGreaterEqual(zs + left, 55)

    def test_death_inside_building_respawns_outside_with_world_level(self):
        from tests.helpers import teleport
        g = living()
        poi = next(q for q in g.pois.values() if q.kind not in ("breach", "refuge", "pad", "house"))
        teleport(g, poi.level_id)
        g.player.hp = 0
        g.end("dead", "x")
        self.assertIs(g.level, g.world.level)
        self.assertIn(g.player, [g.world.level.occ[g.player.pos]])

    def test_save_roundtrip_keeps_the_living_state(self):
        import tempfile, os
        from outbreak.engine import save
        g = living()
        g.player.hp = 0
        g.end("dead", "x")
        path = os.path.join(tempfile.mkdtemp(), "s.sav")
        save.save(g, path)
        g2 = save.load(path)
        self.assertEqual(g2.generation, 2)
        self.assertEqual(len(g2.fallen), 1)
        g2._spend(20)


if __name__ == "__main__":
    unittest.main()
