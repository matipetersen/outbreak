import unittest

from tests import helpers
from outbreak.engine import combat
from outbreak.engine.model import Item
from outbreak.engine.spawn import make_zombie


def new(**kw):
    kw.setdefault("era", "modern")
    g = helpers.make_game(**kw)
    helpers.empty_level_of_enemies(g.world.level)
    g.hordes.clear()
    g.ring = None
    return g


def put_zombie(g, dx=1, dy=0, special="walker", state="hunt"):
    p = g.player
    z = make_zombie(g, special, p.x + dx, p.y + dy)
    g.level.add_actor(z)
    z.state = state
    return z


class CombatTests(unittest.TestCase):
    def test_classic_dead_shrug_off_body_shots_but_not_headshots(self):
        g = new(zombies="classic")
        z = put_zombie(g)
        body = combat.hurt_zombie(g, z, 6, head=False)
        z2 = put_zombie(g, 0, 1)
        head = combat.hurt_zombie(g, z2, 6, head=True)
        self.assertLess(body, head)
        self.assertEqual(head, 18)

    def test_rage_dead_do_not_care_about_headshots_as_much(self):
        g = new(zombies="rage")
        z = put_zombie(g)
        self.assertEqual(combat.hurt_zombie(g, z, 6, head=False), 6)

    def test_fire_hurts_nightstalkers_double(self):
        g = new(zombies="night")
        a, b = put_zombie(g), put_zombie(g, 0, 1)
        plain = combat.hurt_zombie(g, a, 5, head=False)
        fire = combat.hurt_zombie(g, b, 5, head=False, fire=True)
        self.assertEqual(fire, plain * 2)

    def test_sneak_attack_on_unaware_zombie_kills_quietly(self):
        g = new(zombies="classic")
        g.player.weapon = Item("knife", 1, 40)
        z = put_zombie(g, state="dormant")
        z.hp = 6
        combat.player_attack(g, z)
        self.assertNotIn(z, g.level.actors)

    def test_weapons_break(self):
        g = new()
        g.player.weapon = Item("bat", 1, 1)
        z = put_zombie(g)
        z.hp = 10 ** 6
        z.max_hp = z.hp
        for _ in range(5):
            combat.player_attack(g, z)
            if g.player.weapon is None:
                break
        self.assertIsNone(g.player.weapon)

    def test_firing_uses_ammo_and_is_loud(self):
        g = new()
        g.player.weapon = Item("pistol", 1, 50)
        before = g.player.count("bullet")
        g.player.add_item(Item("bullet", 5), True)
        z = put_zombie(g, 4, 0, state="dormant")
        z.state = "dormant"
        # the noise of the shot wakes the zombie
        g.fire(z)
        self.assertEqual(g.player.count("bullet"), before + 4)
        self.assertNotEqual(z.state, "dormant")


class InfectionTests(unittest.TestCase):
    def test_amputation_cures_a_limb_bite_once_per_limb(self):
        g = new(zombies="classic")
        p = g.player
        p.weapon = Item("machete", 1, 50)
        combat.infect(g)
        p.bite_limb, p.bite_window = "arm", 20
        self.assertIsNone(combat.can_amputate(g))
        hp_before, max_before = p.hp, p.max_hp
        self.assertTrue(combat.amputate(g))
        self.assertFalse(p.infected)
        self.assertEqual(p.lost, ["arm"])
        self.assertGreater(hp_before - p.hp, 18, "cutting off a limb must hurt a lot")
        self.assertEqual(p.max_hp, max_before - 10)
        self.assertTrue(p.hemorrhage)
        combat.infect(g)
        p.bite_limb, p.bite_window = "arm", 20
        self.assertIn("already gone", combat.can_amputate(g))

    def test_a_fresh_stump_bleeds_until_bound_and_never_stops_alone(self):
        g = new(zombies="classic")
        p = g.player
        p.weapon = Item("machete", 1, 50)
        combat.infect(g)
        p.bite_limb, p.bite_window = "leg", 20
        combat.amputate(g)
        self.assertEqual(p.bleeding, 3)
        for _ in range(400):
            g.rng.random()
            g.clock.turn += 1
            g._player_conditions() if p.hp > 5 else None
        self.assertGreaterEqual(p.bleeding, 3, "a stump must not stop bleeding on its own")
        p.hp = p.max_hp
        p.inventory.append(Item("bandage", 1))
        g.use(len(p.inventory) - 1)
        self.assertEqual(p.bleeding, 1)                 # one bandage only slows it
        self.assertTrue(p.hemorrhage)
        p.inventory.append(Item("bandage", 1))
        g.use(len(p.inventory) - 1)
        self.assertEqual(p.bleeding, 0)
        self.assertFalse(p.hemorrhage)

    def test_second_limb_is_far_worse_and_can_kill(self):
        g = new(zombies="classic")
        p = g.player
        p.weapon = Item("machete", 1, 50)
        combat.infect(g)
        p.bite_limb, p.bite_window = "arm", 20
        combat.amputate(g)
        p.hp = 30                                       # hurt, as after a fight
        combat.infect(g)
        p.bite_limb, p.bite_window = "leg", 20
        self.assertGreater(combat.amputation_shock(g), 40)
        combat.amputate(g)
        self.assertIsNotNone(g.over, "a second amputation at 30 hp must kill")

    def test_lost_limbs_cripple(self):
        g = new(zombies="classic")
        p = g.player
        p.lost = ["leg"]
        g.toggle_sprint()
        self.assertFalse(p.sprinting)
        self.assertLess(p.evade, 0)
        p.lost = ["arm"]
        self.assertEqual(p.capacity, 18)
        from outbreak.engine import combat as c
        p.weapon = Item("bow", 1, 30) if "bow" in g.items else p.weapon
        if p.weapon and p.weapon.id == "bow":
            self.assertEqual(c.weapon_def(g).id, "fists")

    def test_torso_bites_cannot_be_cut_away(self):
        g = new()
        g.player.weapon = Item("machete", 1, 50)
        combat.infect(g)
        g.player.bite_limb, g.player.bite_window = "torso", 0
        self.assertIsNotNone(combat.can_amputate(g))

    def test_infection_clock_turns_you_into_one_of_them(self):
        g = new(zombies="rage", scenario="extraction")
        combat.infect(g)
        for _ in range(g.player.infection_timer + 2):
            g.wait(1)
            if g.over:
                break
        self.assertEqual(g.over.kind, "turned")

    def test_suppressant_buys_time(self):
        g = new(scenario="cure")
        p = g.player
        p.inventory.append(Item("suppressant", 1))
        t = p.infection_timer
        g.use(len(p.inventory) - 1)
        self.assertGreaterEqual(p.infection_timer, t + 290)

    def test_cure_scenario_starts_infected_and_extraction_does_not(self):
        self.assertTrue(helpers.make_game(scenario="cure").player.infected)
        self.assertFalse(helpers.make_game(scenario="extraction").player.infected)


class NoiseTests(unittest.TestCase):
    def test_noise_wakes_only_what_can_hear_it(self):
        g = new(zombies="classic")
        near = put_zombie(g, 5, 0, state="dormant")
        far = put_zombie(g, 30, 0, state="dormant")
        g.emit_noise(g.player.pos, 10)
        self.assertEqual(near.state, "investigate")
        self.assertEqual(far.state, "dormant")

    def test_loud_noise_builds_heat_quiet_does_not(self):
        g = new()
        g.emit_noise(g.player.pos, 3)
        self.assertEqual(g.heat, 0)
        g.emit_noise(g.player.pos, 24)
        self.assertGreater(g.heat, 0)

    def test_heat_summons_the_stalker(self):
        g = new()
        g.stalker_ready = 0
        g.heat = 100
        g.wait(1)
        self.assertIsNotNone(g.stalker)
        self.assertEqual(g.stalker.special, "stalker")


class SurvivalTests(unittest.TestCase):
    def test_bleeding_kills_unless_treated(self):
        g = new()
        g.player.bleeding = 3
        g.player.hp = 5
        for _ in range(20):
            g.wait(1)
        self.assertIsNotNone(g.over)

    def test_bandage_stops_bleeding(self):
        g = new()
        g.player.bleeding = 2
        g.player.inventory.append(Item("bandage", 1))
        g.use(len(g.player.inventory) - 1)
        self.assertEqual(g.player.bleeding, 0)

    def test_perk_points_and_levels(self):
        g = new()
        p = g.player
        self.assertEqual(p.gain_xp(500) > 0, True)
        self.assertGreater(p.perk_points, 0)
        self.assertTrue(p.learn_perk("heavy"))
        self.assertEqual(p.mod("melee_dmg"), 0.12 * p.perks["heavy"])

    def test_nightstalkers_burn_in_daylight(self):
        g = new(zombies="night")
        g.clock.turn = 12 * 10
        z = put_zombie(g, 10, 0, state="idle")
        z.hp = z.max_hp = 4
        g.wait(4)
        self.assertNotIn(z, g.level.actors)


if __name__ == "__main__":
    unittest.main()
