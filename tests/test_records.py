import os
import tempfile
import unittest
from pathlib import Path

from tests import helpers
from outbreak import records


def finished(days, scenario="endless", mode="normal", seed=2):
    g = helpers.make_game(scenario=scenario, mode=mode, seed=seed)
    g.clock.turn = 240 * (days - 1)
    g.end("dead", "killed by a test") if mode != "living" else g.end("won")
    return g


class RecordTests(unittest.TestCase):
    def setUp(self):
        self.dir = tempfile.mkdtemp()
        self.p = Path(self.dir) / "records.json"

    def test_first_run_then_new_record_then_a_worse_run(self):
        a = records.submit(finished(5), self.p)
        self.assertIn("First recorded", a[0])
        b = records.submit(finished(9), self.p)
        self.assertIn("NEW RECORD", b[0])
        c = records.submit(finished(3), self.p)
        self.assertIn("Record for", c[0])
        self.assertIn("ranks #3 of 3", c[0])
        self.assertEqual(len(records.load(self.p)), 3)

    def test_objectives_and_modes_are_compared_separately(self):
        records.submit(finished(20), self.p)
        r = records.submit(finished(2, scenario="dash"), self.p)
        self.assertIn("First recorded", r[0])

    def test_summary_lists_the_best_of_each(self):
        records.submit(finished(5), self.p)
        records.submit(finished(7), self.p)
        lines = records.summary(records.load(self.p))
        self.assertTrue(any("7 days" in l for l in lines))
        self.assertEqual(records.summary([])[0].split(".")[0], "No finished runs yet")

    def test_unwritable_home_does_not_break_the_ending(self):
        records.submit(finished(4), Path("/proc/nope/records.json"))


if __name__ == "__main__":
    unittest.main()
