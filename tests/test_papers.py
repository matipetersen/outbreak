import unittest

from tests import helpers
from outbreak.engine import services
from outbreak.engine.model import Item


def hosts(g):
    return [q for q in g.pois.values() if q.docs]


class PaperTests(unittest.TestCase):
    def test_pages_scale_with_the_world_and_start_close_to_you(self):
        g = helpers.make_game(seed=3)
        diaries = [d for d in g.docs.values() if d.kind == "diary"]
        self.assertGreaterEqual(len(diaries), 9)
        sx, sy = g.world.start
        near = sum(len(q.docs) for q in hosts(g) if max(abs(q.x - sx), abs(q.y - sy)) <= 30)
        self.assertGreaterEqual(near, 4)

    def test_stepping_into_a_building_with_pages_tells_you(self):
        g = helpers.make_game(seed=3)
        poi = next(q for q in g.pois.values() if q.kind == "house" and q.docs)
        g.player.documents.clear()
        lv = g.ensure_level(poi.id + ":0")
        self.assertGreater(g._unread_in(lv), 0)
        for d in poi.docs:
            g.player.documents.append(d)
        self.assertEqual(g._unread_in(lv), 0)

    def test_the_archivist_marks_the_nearest_buildings_with_unread_pages(self):
        g = helpers.make_game(seed=3)
        g.rep["enclave"] = 50
        g.player.coins = 20
        before = g.player.coins
        text = services.ask_papers(g)
        self.assertIn("Pages were left in", text)
        marked = [q for q in g.pois.values() if q.papers]
        self.assertEqual(len(marked), 2)
        self.assertTrue(all(q.revealed for q in marked))
        self.assertEqual(g.player.coins, before - services.PAPERS_COST)
        nearer = min((q for q in g.pois.values() if q.docs and q.kind not in ("breach", "refuge", "pad")),
                     key=lambda q: max(abs(q.x - g.player.x), abs(q.y - g.player.y)))
        self.assertTrue(nearer.papers)

    def test_it_costs_coins_and_runs_out(self):
        g = helpers.make_game(seed=3)
        g.rep["enclave"] = 50
        g.player.coins = 1
        self.assertIn("costs", services.ask_papers(g))
        g.player.coins = 99
        for q in g.pois.values():
            for d in q.docs:
                g.player.documents.append(d)
        self.assertIn("no more pages", services.ask_papers(g))


if __name__ == "__main__":
    unittest.main()
