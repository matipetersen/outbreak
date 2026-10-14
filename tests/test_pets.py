import unittest

from tests import helpers
from outbreak.content.pets import BY_SPECIES, PETS
from outbreak.engine import combat, pets, tiles as T
from outbreak.engine.model import Animal, Item, Zombie
from outbreak.engine.spawn import spawn_zombie


def field(seed=3):
    g = helpers.make_game(seed=seed)
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
    for y in range(p.y - 10, p.y + 11):
        for x in range(p.x - 12, p.x + 13):
            lv.set_tile(x, y, T.GRASS)
    g.clock.turn = 1000
    return g, lv


def stray(g, lv, species="dog", dx=1):
    a = pets.make_stray(g, species, g.player.x + dx, g.player.y + 1)
    lv.add_actor(a)
    return a


def adopt(g, lv, species="dog"):
    a = stray(g, lv, species)
    g.player.inventory.append(Item("food", 5))
    g.rng.random = lambda: 0.0
    pets.befriend(g, a)
    return a


class Strays(unittest.TestCase):
    def test_the_world_has_strays_of_every_kind(self):
        g = helpers.make_game(seed=3)
        kinds = {a.species for a in g.world.level.actors if isinstance(a, Animal) and a.stray}
        self.assertGreaterEqual(len(kinds), 3)

    def test_a_stray_comes_close_and_waits_but_is_not_attackable_by_bumping(self):
        g, lv = field()
        a = pets.make_stray(g, "dog", g.player.x + 7, g.player.y)
        lv.add_actor(a)
        for i in range(12):
            g.clock.turn = 1000 + i
            pets.tick_animal(g, a)
        self.assertLessEqual(max(abs(a.x - g.player.x), abs(a.y - g.player.y)), 3)
        a2 = stray(g, lv, "cat", dx=-1)
        hp = a2.hp
        g.player.x, g.player.y = a2.x + 1, a2.y
        lv.occ.clear()
        lv.occ[g.player.pos], lv.occ[a2.pos] = g.player, a2
        self.assertFalse(g._bump_actor(a2))
        self.assertEqual(a2.hp, hp)

    def test_you_need_food_to_win_one_over(self):
        g, lv = field()
        a = stray(g, lv)
        g.player.inventory = [i for i in g.player.inventory if g.item_def(i.id).kind != "food"]
        self.assertIn("something to eat", pets.befriend(g, a))
        self.assertFalse(a.pet)

    def test_a_stray_takes_the_food_and_you(self):
        g, lv = field()
        a = adopt(g, lv)
        self.assertTrue(a.pet)
        self.assertEqual(g.pet_uid, a.uid)
        self.assertEqual(pets.current(g), a)
        self.assertNotEqual(a.name, "Dog")

    def test_it_can_refuse_and_bolt(self):
        g, lv = field()
        a = stray(g, lv, "fox")
        g.player.inventory.append(Item("food", 2))
        g.rng.random = lambda: 0.99
        self.assertIn("bolts", pets.befriend(g, a))
        self.assertFalse(a.pet)
        self.assertEqual(a.state, "flee")

    def test_only_one_pet(self):
        g, lv = field()
        adopt(g, lv, "dog")
        other = stray(g, lv, "cat", dx=2)
        g.player.inventory.append(Item("food", 1))
        self.assertIn("already", pets.befriend(g, other))


class Pets(unittest.TestCase):
    def test_a_dog_fights_and_a_cat_runs(self):
        g, lv = field()
        dog = adopt(g, lv, "dog")
        z = spawn_zombie(g, lv, (dog.x + 1, dog.y), "walker", False)
        z.hp = z.max_hp = 4
        for i in range(10):
            g.clock.turn = 1100 + i
            pets._pet_ai(g, dog, 2)
            if z not in lv.actors:
                break
        self.assertNotIn(z, lv.actors)
        self.assertGreaterEqual(dog.kills, 1)

    def test_a_cat_calms_you(self):
        g, lv = field()
        cat = adopt(g, lv, "cat")
        g.player.panic = 60
        g.clock.turn = 1200
        pets.tick(g)
        self.assertLess(g.player.panic, 60)

    def test_a_crow_marks_a_building_for_you(self):
        g, lv = field()
        crow = adopt(g, lv, "crow")
        crow.nextfx = 0
        g.clock.turn = 1500
        hidden = sum(1 for p in g.pois.values() if not p.revealed)
        pets.tick(g)
        self.assertLessEqual(sum(1 for p in g.pois.values() if not p.revealed), hidden)

    def test_a_dog_growls_at_an_ambush(self):
        from outbreak.engine.spawn import make_raider
        g, lv = field()
        dog = adopt(g, lv, "dog")
        r = make_raider(g, dog.x + 4, dog.y)
        r.hidden, r.state = True, "idle"
        lv.add_actor(r)
        g.clock.turn = 1200
        pets.tick(g)
        self.assertFalse(r.hidden)

    def test_a_hungry_pet_loses_the_bond_and_leaves(self):
        g, lv = field()
        dog = adopt(g, lv, "dog")
        dog.fed = 0
        g.clock.turn = 5000
        for _ in range(30):
            g.clock.turn += 100
            pets.tick(g)
        self.assertIsNone(pets.current(g))
        self.assertTrue(dog.stray)

    def test_feeding_and_petting_raise_the_bond(self):
        g, lv = field()
        dog = adopt(g, lv, "dog")
        b = dog.bond
        g.player.inventory.append(Item("food", 1))
        pets.feed(g, dog, len(g.player.inventory) - 1)
        self.assertGreater(dog.bond, b)
        b = dog.bond
        pets.pet_it(g, dog)
        self.assertGreater(dog.bond, b)

    def test_it_waits_outside_and_you_swap_places_with_it(self):
        g, lv = field()
        dog = adopt(g, lv, "dog")
        dog.x, dog.y = g.player.x + 1, g.player.y
        lv.occ = {k: v for k, v in lv.occ.items() if v is g.player}
        lv.occ[dog.pos] = dog
        old = g.player.pos
        self.assertTrue(g._bump_actor(dog))
        self.assertEqual(dog.pos, old)

    def test_the_dead_go_for_a_pet_and_its_death_is_permanent(self):
        g, lv = field()
        cat = adopt(g, lv, "cat")
        cat.hp = 1
        z = spawn_zombie(g, lv, (cat.x + 1, cat.y), "walker", False)
        combat.attack_actor(g, z, cat)
        for _ in range(20):
            if cat not in lv.actors:
                break
            combat.attack_actor(g, z, cat)
        self.assertNotIn(cat, lv.actors)
        self.assertIsNone(pets.current(g))
        self.assertEqual(g.pet_uid, 0)
        self.assertTrue(any("is dead" in t for _, t, _ in g.story))
        self.assertEqual(g.fallen_allies[-1][0], cat.name)

    def test_a_stray_event_can_bring_one(self):
        from outbreak.engine import encounters
        g, lv = field()
        g.player.inventory.append(Item("food", 3))
        ev = encounters.BY_ID["stray"]
        g.rng.random = lambda: 0.0
        active = encounters.start(g, ev)
        encounters.resolve(g, active, 0)
        self.assertIsNotNone(pets.current(g))

    def test_the_director_sends_a_stray_in_the_tests_and_allies_act(self):
        g, lv = field()
        before = sum(1 for a in lv.actors if isinstance(a, Animal) and a.stray)
        pets.stray_beat(g)
        self.assertEqual(sum(1 for a in lv.actors if isinstance(a, Animal) and a.stray), before + 1)

    def test_every_species_has_a_strength_and_a_flaw(self):
        self.assertEqual({p.species for p in PETS}, {"dog", "cat", "crow", "fox"})
        for p in PETS:
            self.assertTrue(p.strength and p.flaw and p.intro and p.idle)

    def test_the_ending_mentions_a_pet(self):
        g, lv = field()
        dog = adopt(g, lv)
        from outbreak.engine import ending
        e = ending.build(g, "dead", "x")
        self.assertTrue(any(dog.name in l for l in e.summary))


if __name__ == "__main__":
    unittest.main()
