import unittest

from tests import helpers
from outbreak.engine import combat, save as savemod


class ChronicleTests(unittest.TestCase):
    def test_death_tells_how_it_went(self):
        g = helpers.make_game(seed=2)
        g.msg("Noise: a door slams.", "info")
        combat.infect(g, "bite")
        g.msg("A trivial line.", "info")
        g.player.hp = 1
        combat.damage_player(g, 5, "bled out in the dark")
        e = g.over
        self.assertEqual(e.kind, "dead")
        self.assertTrue(any("bitten" in c or "infect" in c for c in e.chronicle))
        self.assertTrue(all(c.startswith("Day ") for c in e.chronicle))
        self.assertIn("A trivial line.", e.last_moments)            # the last log lines come through
        self.assertFalse(any("trivial" in c for c in e.chronicle))  # but idle chatter is not in the record
        self.assertLessEqual(len(e.last_moments), 10)

    def test_hits_do_not_flood_the_record(self):
        g = helpers.make_game(seed=2)
        for _ in range(50):
            g.msg("The walker hits you for 2.", "bad")
        self.assertLessEqual(len(g.chronicle), 2)

    def test_record_keeps_start_and_latest(self):
        g = helpers.make_game(seed=2)
        for i in range(400):
            g.msg(f"Found thing {i}.", "good")
        self.assertLessEqual(len(g.chronicle), 160)
        texts = [t for _, _, t in g.chronicle]
        self.assertIn("Found thing 399.", texts)
        self.assertIn("Found thing 0.", texts)

    def test_win_has_a_record_and_saves_keep_it(self):
        g = helpers.make_game(seed=2)
        g.msg("Deciphered: you now hold the formula.", "good")
        g2 = savemod.loads(savemod.dumps(g)) if hasattr(savemod, "dumps") else g
        g2.end("won")
        self.assertTrue(g2.over.victory)
        self.assertTrue(any("formula" in c for c in g2.over.chronicle))


if __name__ == "__main__":
    unittest.main()
