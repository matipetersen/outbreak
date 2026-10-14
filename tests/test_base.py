import unittest

from tests import helpers
from outbreak.engine import base, combat, tiles as T
from outbreak.engine.model import Item, Zombie
from outbreak.engine.spawn import spawn_zombie


def in_house(seed=3, **kw):
    g = helpers.make_game(seed=seed, **kw)
    poi = next(q for q in g.pois.values() if q.kind == "house")
    helpers.teleport(g, poi.id + ":0")
    helpers.empty_level_of_enemies(g.level)
    g.player.hp = g.player.max_hp = 10 ** 6
    return g, g.level


def stock(g, **items):
    for k, v in items.items():
        g.player.inventory.append(Item(k, v))


class BaseTests(unittest.TestCase):
    def test_claim_needs_a_cleared_building(self):
        g = helpers.make_game(seed=3)
        self.assertIn("building", base.can_claim(g))                    # the overworld is not a base
        g, lv = in_house()
        z = spawn_zombie(g, lv, lv.free_spot_near(*lv.entry, 5), "walker", dormant=True)
        self.assertIn("Clear", base.can_claim(g))
        lv.remove_actor(z)
        self.assertEqual(base.can_claim(g), "")
        self.assertTrue(base.claim(g))
        self.assertEqual(g.base_id, lv.id)
        self.assertTrue(lv.safe)

    def test_build_costs_materials_and_has_limits(self):
        g, lv = in_house()
        base.claim(g)
        ok, why = base.status(g, base.BY_ID["workshop"])
        self.assertFalse(ok)
        self.assertIn("missing", why)
        stock(g, wood=12, scrap=9, cloth=3)
        wood0 = g.player.count("wood")
        self.assertTrue(base.build(g, "workshop"))
        self.assertEqual(g.player.count("wood"), wood0 - 4)
        self.assertIn(T.WORKSHOP, [lv.tile(x, y) for y in range(lv.h) for x in range(lv.w)])
        self.assertFalse(base.status(g, base.BY_ID["workshop"])[0])      # one is all you get

    def test_workshop_unlocks_weapon_crafting_and_stays_connected(self):
        from outbreak.engine import inventory_ops
        from outbreak.content.recipes import by_id
        g, lv = in_house()
        base.claim(g)
        stock(g, wood=12, scrap=9)
        r = by_id()["nailbat"]
        self.assertIn("workshop", inventory_ops.recipe_status(g, r)[1])
        base.build(g, "workshop")
        self.assertTrue(inventory_ops.recipe_status(g, r)[0])
        self.assertTrue(g.craft("nailbat"))
        self.assertGreaterEqual(g.player.count("nailbat"), 1)
        self.assertTrue(base._connected(lv, g.player.pos, lv.entry))

    def test_barricade_is_a_gate_the_dead_must_batter(self):
        g, lv = in_house()
        base.claim(g)
        stock(g, wood=4, scrap=2)
        base.build(g, "barricade")
        pos = next(p for p, s in lv.built.items() if s == "barricade")
        self.assertEqual(lv.tile(*pos), T.DOOR)
        self.assertEqual(lv.door_hp[pos], base.BARRICADE_HP)

    def test_locker_keeps_things_across_deaths_in_hardcore(self):
        g, lv = in_house(mode="living")
        base.claim(g)
        stock(g, wood=4, scrap=2, food=3)
        base.build(g, "locker")
        idx = next(i for i, it in enumerate(g.player.inventory) if it.id == "food")
        self.assertTrue(base.stash_put(g, idx))
        self.assertEqual(lv.stash[0].id, "food")
        g.player.hp = 1
        combat.damage_player(g, 99, "killed by a test")
        self.assertIsNone(g.over)
        self.assertEqual(g.level.id, lv.id)                                # the next one wakes in the base
        self.assertEqual(lv.stash[0].id, "food")                           # and the locker is still full
        self.assertTrue(base.stash_take(g, 0))
        self.assertGreaterEqual(g.player.count("food"), 3)

    def test_the_dead_raid_a_base_at_night_and_it_stops_being_safe(self):
        g, lv = in_house()
        base.claim(g)
        g.raid_next = 0
        g.clock.turn = 240 * 3 + 215                                       # deep night
        self.assertTrue(g.clock.is_night)
        for _ in range(400):
            g._base_tick()
            if any(isinstance(a, Zombie) for a in lv.actors):
                break
            g.clock.turn += 1
        zs = [a for a in lv.actors if isinstance(a, Zombie)]
        self.assertTrue(zs)
        self.assertFalse(lv.safe)
        self.assertTrue(all(z.state == "hunt" for z in zs))

    def test_sleeping_in_a_base_is_cut_short_by_a_raid(self):
        g, lv = in_house()
        base.claim(g)
        g.clock.turn = 240 * 2 + 150
        spot = lv.free_spot_near(lv.entry[0], lv.entry[1] + 0, 3)
        z = spawn_zombie(g, lv, spot, "walker", dormant=False)
        lv.safe = True
        z.state = "hunt"
        t0 = g.clock.turn
        g.sleep()
        self.assertLess(g.clock.turn - t0, 80)


if __name__ == "__main__":
    unittest.main()
