"""The whole intended progression, using real game actions (only walking is skipped)."""
import unittest

from tests import helpers
from outbreak import content
from outbreak.engine import inventory_ops
from outbreak.engine import tiles as T


def fetch_document(g, doc_id):
    """Find the document where the generator hid it and pick it up the way a player would."""
    if doc_id in g.player.documents:
        return
    poi = next(p for p in g.pois.values() if doc_id in p.docs)
    floor = poi.docs.index(doc_id) % max(1, poi.floors)
    lv = g.ensure_level(f"{poi.id}:{floor}")
    helpers.empty_level_of_enemies(lv)
    for pos, c in lv.containers.items():
        if doc_id in c.docs:
            helpers.teleport(g, lv.id, lv.free_spot_near(pos[0], pos[1], 1))
            inventory_ops.search(g, pos)
            return
    for pos, ids in lv.docs.items():
        if doc_id in ids:
            helpers.teleport(g, lv.id, pos)
            g.pickup()
            return
    raise AssertionError(f"document {doc_id} lost in {poi.name}")


def decode(g, doc_id):
    for _ in range(4):
        g.read_document(doc_id)


def loot_vault(g, poi):
    top = f"{poi.id}:{poi.floors - 1}"
    for f in range(poi.floors):
        g.ensure_level(f"{poi.id}:{f}")
    lv = g.levels[top]
    helpers.empty_level_of_enemies(lv)
    helpers.teleport(g, top, lv.free_spot_near(lv.vault_lock[0], lv.vault_lock[1], 2))
    for _ in range(4):
        if lv.tile(*lv.vault_lock) == T.LOCKED:
            g.try_unlock(lv.vault_lock)
    assert lv.tile(*lv.vault_lock) != T.LOCKED
    crate = next(p for p, c in lv.containers.items() if c.note == "vault")
    helpers.teleport(g, top, lv.free_spot_near(crate[0], crate[1], 1))
    inventory_ops.search(g, crate)


class ChainTests(unittest.TestCase):
    def play_through(self, era, scenario, seed):
        g = helpers.make_game(era=era, scenario=scenario, seed=seed, origin="scholar")
        helpers.empty_level_of_enemies(g.world.level)
        g.hordes.clear()
        g.ring = None
        for doc in list(g.docs.values()):
            fetch_document(g, doc.id)
            decode(g, doc.id)
        for req in g.scenario.requirements:
            poi = next(p for p in g.pois.values() if p.component == req.id)
            self.assertTrue(poi.lead, (era, scenario, "lead never revealed", poi.name))
            self.assertTrue(poi.code_known)
            loot_vault(g, poi)
            self.assertEqual(g.player.count(req.id), 1, (era, scenario, req.id))
        self.assertTrue(g.pois[g.final_site_id].revealed)
        if g.scenario.needs_formula:
            self.assertTrue(g.formula_found)
            self.assertGreaterEqual(g.know.fluency, g.scenario.formula_fluency)
        self.assertTrue(g.requirements_met())
        site = g.pois[g.final_site_id]
        lv = g.ensure_level(site.level_id)
        helpers.teleport(g, lv.id, lv.free_spot_near(lv.bench[0], lv.bench[1], 1))
        g.player.hp = g.player.max_hp = 10 ** 6
        self.assertTrue(g.use_bench())
        helpers.break_out(g)
        self.assertTrue(g.over and g.over.victory, (era, scenario, g.over and g.over.title))

    def test_cure_chain_in_every_era(self):
        for era in content.ERAS:
            self.play_through(era, "cure", 3)

    def test_extraction_chain_in_every_era(self):
        for era in content.ERAS:
            self.play_through(era, "extraction", 4)

    def test_chain_across_several_seeds(self):
        for seed in range(6, 14):
            self.play_through("modern", "cure" if seed % 2 else "extraction", seed)


if __name__ == "__main__":
    unittest.main()
