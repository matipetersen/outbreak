import unittest

from tests.helpers import make_game
from outbreak.engine import ai, combat
from outbreak.engine import tiles as T
from outbreak.engine.model import Item
from outbreak.engine.spawn import spawn_zombie


def trial(seed, sneak, from_behind, facing=(1, 0)):
    g = make_game(era="modern", zombies="classic", seed=seed)
    lv = g.world.level
    for a in list(lv.actors):
        if not a.is_player:
            lv.remove_actor(a)
    g.hordes.clear()
    g.ring = None
    p = g.player
    p.hp = p.max_hp = 10 ** 6
    p.infected = False
    spot = None
    for y in range(10, lv.h - 10):
        for x in range(10, lv.w - 24):
            if all(lv.free(x + i, y + j) and lv.tile(x + i, y + j) != T.PORTAL for i in range(16) for j in range(-2, 3)):
                spot = (x, y)
                break
        if spot:
            break
    if not spot:
        return None
    for i in range(16):                                   # the strip is grass: an open road makes you easier to see
        for j in range(-2, 3):
            lv.set_tile(spot[0] + i, spot[1] + j, T.GRASS)
    del lv.occ[p.pos]
    z = spawn_zombie(g, lv, (spot[0] + 12, spot[1]), "walker", dormant=False)
    z.state, z.facing = "idle", facing
    p.x, p.y = (spot[0], spot[1]) if from_behind else (spot[0] + 15, spot[1])
    lv.occ[p.pos] = p
    p.sneaking = sneak
    g.update_fov()
    step = 1 if from_behind else -1
    for _ in range(40):
        if max(abs(p.x - z.x), abs(p.y - z.y)) <= 1:
            break
        if z.state == "hunt":
            return {"noticed": True, "killed": False}
        g.move(step, 0)
    noticed = z.state == "hunt" or z.alert >= 70
    killed = False
    if not noticed and max(abs(p.x - z.x), abs(p.y - z.y)) <= 1:
        combat.player_attack(g, z)
        killed = z.hp <= 0
    return {"noticed": noticed, "killed": killed}


def rate(**kw):
    rs = [r for r in (trial(s, **kw) for s in range(1, 21)) if r]
    return sum(r["noticed"] for r in rs) / len(rs), sum(r["killed"] for r in rs) / len(rs), len(rs)


class Stealth(unittest.TestCase):
    def test_walking_up_to_a_zombie_gets_you_noticed(self):
        self.assertGreaterEqual(rate(sneak=False, from_behind=True)[0], 0.8)
        self.assertGreaterEqual(rate(sneak=False, from_behind=False)[0], 0.8)

    def test_sneaking_up_behind_or_at_the_side_works(self):
        noticed, killed, n = rate(sneak=True, from_behind=True)
        self.assertGreaterEqual(n, 15)
        self.assertLessEqual(noticed, 0.3)                # 20 seeded worlds: a world change moves this by a few points
        self.assertGreaterEqual(killed, 0.2)           # a sneak stab is no longer a sure kill
        noticed, killed, _ = rate(sneak=True, from_behind=True, facing=(0, 1))
        self.assertLessEqual(noticed, 0.4)
        self.assertGreaterEqual(killed, 0.12)

    def test_sneaking_straight_at_its_face_does_not(self):
        self.assertGreaterEqual(rate(sneak=True, from_behind=False)[0], 0.7)

    def test_exposure_awareness_and_facing(self):
        g = make_game(seed=2)
        lv = g.world.level
        z = spawn_zombie(g, lv, lv.free_spot_near(g.player.x + 8, g.player.y, 3), "walker", dormant=False)
        lv.move_actor(z, z.x + 1, z.y)
        self.assertEqual(z.facing, (1, 0))
        lv.move_actor(z, z.x, z.y - 1)
        self.assertEqual(z.facing, (0, -1))
        p = g.player
        p.x, p.y = z.x - 3, z.y
        z.facing = (1, 0)
        self.assertLess(ai.exposure(z, p), 0.65)
        z.facing = (-1, 0)
        self.assertGreater(ai.exposure(z, p), 0.95)
        z.state, z.alert = "idle", 0.0
        g.emit_noise(z.pos, 5)
        self.assertEqual(z.state, "investigate")
        self.assertTrue(0 < z.alert < 100)
        self.assertIn(ai.awareness_of(z), ("listening", "suspicious", "about to notice you"))


class Noise(unittest.TestCase):
    def test_fights_are_loud_and_a_fair_fight_ends_sneaking(self):
        g = make_game(era="medieval", seed=2)
        mace, dagger, bow = g.items["mace"], g.items["dagger"], g.items["bow"]
        self.assertGreaterEqual(combat.attack_noise(g, mace, False), 11)
        self.assertGreater(combat.attack_noise(g, mace, False), combat.attack_noise(g, g.items["sword"], False))
        self.assertLessEqual(combat.attack_noise(g, dagger, False), 4)
        self.assertEqual(combat.attack_noise(g, bow, False), bow.noise)
        lv = g.world.level
        for a in list(lv.actors):
            if not a.is_player:
                lv.remove_actor(a)
        p = g.player
        p.hp = p.max_hp = 10 ** 6
        far = spawn_zombie(g, lv, lv.free_spot_near(p.x + 9, p.y, 3), "walker", dormant=False)
        far.state = "idle"
        near = spawn_zombie(g, lv, lv.free_spot_near(p.x + 1, p.y, 2), "walker", dormant=False)
        near.state, near.alert = "hunt", 100.0
        p.weapon = Item("mace", 1, 55)
        p.sneaking = True
        combat.player_attack(g, near)
        self.assertFalse(p.sneaking)
        self.assertEqual(far.state, "investigate")
        self.assertTrue(0 < far.alert < 100)
        dormant = spawn_zombie(g, lv, lv.free_spot_near(p.x - 1, p.y, 2), "walker", dormant=False)
        dormant.state, dormant.facing = "dormant", (-1, 0)
        p.sneaking = True
        combat.player_attack(g, dormant)
        self.assertTrue(p.sneaking)
        combat.damage_player(g, 3, "x", near)
        self.assertFalse(p.sneaking)


if __name__ == "__main__":
    unittest.main()
