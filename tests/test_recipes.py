import unittest

from tests import helpers
from outbreak.content.recipes import RECIPES, STARTERS
from outbreak.engine import cipher, inventory_ops
from outbreak.engine.model import Item


def manual_docs(g):
    return [d for d in g.docs.values() if d.kind == "manual"]


class RecipeTests(unittest.TestCase):
    def test_you_start_with_the_basics_only(self):
        g = helpers.make_game(seed=2)
        self.assertEqual(set(g.player.recipes), set(STARTERS))
        self.assertIn("bandage", STARTERS)
        self.assertNotIn("medkit", STARTERS)

    def test_advanced_recipes_are_locked_until_you_learn_them(self):
        g = helpers.make_game(seed=2)
        g.know.known.update(g.know.vocab)                      # fluency is not the problem
        g.player.inventory.extend([Item("bandage", 4), Item("chem", 4)])
        r = next(x for x in RECIPES if x.id == "medkit")
        ok, why = inventory_ops.recipe_status(g, r)
        self.assertFalse(ok)
        self.assertIn("manual", why)
        g.player.recipes.append("medkit")
        self.assertTrue(inventory_ops.recipe_status(g, r)[0])

    def test_a_manual_exists_for_every_learnable_recipe_and_teaches_it(self):
        for era in ("medieval", "eighties", "modern", "scifi"):
            g = helpers.make_game(era=era, seed=4)
            learn = {d.payload["recipe"] for d in manual_docs(g)}
            for r in RECIPES:
                if not r.starter and inventory_ops.recipe_output(g, r):
                    if (r.needs == "firearms" and not g.era.firearms) or (r.needs == "electricity" and not g.era.electricity):
                        continue
                    self.assertIn(r.id, learn, (era, r.id))
        g = helpers.make_game(seed=4)
        doc = manual_docs(g)[0]
        rid = doc.payload["recipe"]
        self.assertNotIn(rid, g.player.recipes)
        g.know.known.update(doc.words)                         # you can read it now
        g.collect_document(doc.id)
        g.read_document(doc.id)
        self.assertIn(rid, g.player.recipes)

    def test_a_new_survivor_keeps_what_you_learned(self):
        g = helpers.make_game(seed=2, mode="living")
        g.player.recipes.append("medkit")
        g.player.hp = 1
        from outbreak.engine import combat
        combat.damage_player(g, 99, "killed by a test")
        self.assertIn("medkit", g.player.recipes)


if __name__ == "__main__":
    unittest.main()
