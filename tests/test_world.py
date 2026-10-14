import random
import unittest

from tests import helpers
from outbreak import content
from outbreak.content.eras import POI_KINDS
from outbreak.engine import interiors as I
from outbreak.engine import tiles as T
from outbreak.engine.model import POI, Zombie
from outbreak.engine.worldgen import FLOORS, generate_overworld


class WorldTests(unittest.TestCase):
    def test_every_poi_kind_exists_and_is_reachable_from_the_start(self):
        for era in content.ERAS.values():
            for seed in range(6):
                w = generate_overworld(random.Random(seed), era, 120, 76)
                self.assertTrue(set(POI_KINDS) <= {p.kind for p in w.pois.values()}, (era.id, seed))
                seen = helpers.reachable(w.level, w.start)
                for poi in w.pois.values():
                    if poi.kind == "breach":
                        continue
                    self.assertIn((poi.x, poi.y), seen, (era.id, seed, poi.name))

    def test_generation_is_deterministic(self):
        era = content.get_era("modern")
        a = generate_overworld(random.Random(9), era, 120, 76)
        b = generate_overworld(random.Random(9), era, 120, 76)
        self.assertEqual([bytes(r) for r in a.level.tiles], [bytes(r) for r in b.level.tiles])
        self.assertEqual(a.start, b.start)

    def test_small_and_large_maps(self):
        era = content.get_era("scifi")
        for w, h in ((100, 64), (200, 120)):
            world = generate_overworld(random.Random(2), era, w, h)
            self.assertEqual((world.level.w, world.level.h), (w, h))


class _Spawner:
    n = 0

    def __call__(self, level, pos, special=None, dormant=True):
        _Spawner.n += 1
        z = Zombie(_Spawner.n, "z", "z", pos[0], pos[1], 10, 10)
        level.add_actor(z)
        return z


class InteriorTests(unittest.TestCase):
    def test_all_floors_are_connected(self):
        for era in content.ERAS.values():
            ctx = I.GenContext(era, content.get_preset("spore"), 1.0, 1.0, _Spawner())
            for seed in range(4):
                for kind in POI_KINDS + ("house", "refuge", "pad"):
                    poi = POI(f"p{seed}", kind, "X", 5, 5, floors=FLOORS[kind],
                              component="sample" if kind in POI_KINDS else "")
                    for floor in range(poi.floors):
                        lv = I.generate(poi, floor, seed, ctx, ["d1"])
                        seen = helpers.reachable(lv, lv.entry)
                        for pos, c in lv.containers.items():
                            if c.note == "vault":
                                continue
                            near = [(pos[0] + dx, pos[1] + dy) for dx, dy in ((1, 0), (-1, 0), (0, 1), (0, -1))]
                            self.assertTrue(any(n in seen for n in near), (era.id, kind, floor, pos))
                        for pos in lv.portals:
                            self.assertTrue(pos in seen or any(
                                (pos[0] + dx, pos[1] + dy) in seen for dx, dy in ((1, 0), (-1, 0), (0, 1), (0, -1))))

    def test_last_floor_has_a_locked_vault_with_the_component(self):
        era = content.get_era("modern")
        ctx = I.GenContext(era, content.get_preset("classic"), 1.0, 1.0, _Spawner())
        found = 0
        for seed in range(10):
            poi = POI("lab", "lab", "Lab", 5, 5, floors=3, component="catalyst")
            lv = I.generate(poi, 2, seed, ctx, [])
            vault = [c for c in lv.containers.values() if c.note == "vault"]
            if vault:
                found += 1
                self.assertIsNotNone(lv.vault_lock)
                self.assertEqual(lv.tile(*lv.vault_lock), T.LOCKED)
        self.assertGreaterEqual(found, 8)

    def test_documents_are_never_lost(self):
        era = content.get_era("modern")
        ctx = I.GenContext(era, content.get_preset("classic"), 1.0, 1.0, _Spawner())
        for seed in range(15):
            poi = POI("h", "house", "House", 5, 5)
            docs = ["a", "b", "c", "d"]
            lv = I.generate(poi, 0, seed, ctx, docs)
            placed = [d for c in lv.containers.values() for d in c.docs] + [d for ds in lv.docs.values() for d in ds]
            self.assertEqual(sorted(placed), sorted(docs), seed)


if __name__ == "__main__":
    unittest.main()
