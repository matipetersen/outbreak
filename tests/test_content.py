import unittest

from tests import helpers  # noqa: F401  (puts src/ on sys.path)
from outbreak import content
from outbreak.content.eras import FACTION_ROLES, LEXICON_SLOTS, POI_KINDS
from outbreak.content.perks import MODIFIER_KEYS


class ContentTests(unittest.TestCase):
    def test_every_era_is_complete(self):
        for era in content.ERAS.values():
            for kind in POI_KINDS:
                self.assertTrue(era.pois[kind], (era.id, kind))
            for role in FACTION_ROLES:
                self.assertIn(role, era.factions)
            for slot in LEXICON_SLOTS:
                self.assertGreaterEqual(len(era.lexicon[slot]), 3)
            self.assertTrue(era.glyphs)
            for origin in content.ORIGINS:
                self.assertIn(origin, era.origin_names)

    def test_origin_kits_resolve_in_every_era(self):
        for era in content.ERAS.values():
            for origin in content.ORIGINS.values():
                for token, qty in origin.kit:
                    if token == "@ammo":
                        self.assertTrue(era.items[era.defaults["ranged"]].ammo)
                    elif token.startswith("@"):
                        self.assertIn(token[1:], era.defaults)
                    else:
                        self.assertIn(token, era.items)

    def test_presets_reference_real_specials(self):
        for p in content.PRESETS.values():
            for sid, weight, day in p.specials:
                self.assertIn(sid, content.SPECIALS)
                self.assertGreater(weight, 0)
            for sid in p.names:
                self.assertIn(sid, content.SPECIALS)
            self.assertGreater(p.speed, 0)
            self.assertIn(p.kill_rule, ("head", "any"))

    def test_scenarios_name_their_items_in_every_era(self):
        for sc in content.SCENARIOS.values():
            for req in sc.requirements:
                self.assertEqual(set(req.names), set(content.ERAS))
                self.assertIn(req.poi_kind, POI_KINDS)

    def test_recipes_use_known_items(self):
        for era in content.ERAS.values():
            for r in content.RECIPES:
                for item_id, _ in r.inputs:
                    self.assertIn(item_id, era.items)

    def test_perk_modifiers_are_unique_keys_with_ranks(self):
        for p in content.PERKS.values():
            self.assertGreater(p.max_rank, 0)
            self.assertTrue(p.mods)
        self.assertGreater(len(MODIFIER_KEYS), 10)

    def test_unknown_ids_give_helpful_errors(self):
        with self.assertRaises(KeyError) as cm:
            content.get_era("bronze-age")
        self.assertIn("medieval", str(cm.exception))


if __name__ == "__main__":
    unittest.main()
