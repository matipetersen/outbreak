import unittest

from outbreak import content
from outbreak.config import RANDOMIZABLE, GameConfig
from outbreak.engine.game import Game


class RandomMode(unittest.TestCase):
    def test_resolve_replaces_every_random_with_a_valid_choice(self):
        cfg = GameConfig(seed=5, **{f: "random" for f in RANDOMIZABLE}).resolve().validate()
        self.assertNotIn("random", [getattr(cfg, f) for f in RANDOMIZABLE])
        self.assertIn(cfg.mode, ("normal", "living"))

    def test_with_a_seed_the_draw_is_reproducible_and_without_one_it_varies(self):
        a = GameConfig(seed=9, **{f: "random" for f in RANDOMIZABLE}).resolve()
        b = GameConfig(seed=9, **{f: "random" for f in RANDOMIZABLE}).resolve()
        self.assertEqual(a, b)
        draws = {tuple(getattr(GameConfig(seed=s, **{f: "random" for f in RANDOMIZABLE}).resolve(), f) for f in RANDOMIZABLE)
                 for s in range(40)}
        self.assertGreater(len(draws), 20)
        free = {GameConfig(**{f: "random" for f in RANDOMIZABLE}).resolve().era for _ in range(60)}
        self.assertEqual(free, set(content.ERAS))

    def test_only_the_random_fields_change(self):
        cfg = GameConfig(seed=3, era="medieval", zombies="random", scenario="dash", origin="guard").resolve()
        self.assertEqual((cfg.era, cfg.scenario, cfg.origin), ("medieval", "dash", "guard"))
        self.assertNotEqual(cfg.zombies, "random")

    def test_a_game_is_built_from_a_random_config_and_says_what_was_drawn(self):
        g = Game(GameConfig(seed=4, **{f: "random" for f in RANDOMIZABLE}))
        self.assertNotIn("random", [getattr(g.cfg, f) for f in RANDOMIZABLE])
        self.assertTrue(any(m[1].startswith("Random draw:") for m in g.log))

    def test_plain_configs_are_untouched_and_unknown_values_still_fail(self):
        cfg = GameConfig(seed=2)
        self.assertIs(cfg.resolve(), cfg)
        with self.assertRaises(KeyError):
            GameConfig(era="nope").resolve().validate()

    def test_cli_random_flag(self):
        from outbreak import cli
        args = cli.build_parser().parse_args(["--random", "--seed", "3"])
        cfg = cli.config_from_args(args)
        self.assertEqual(cfg.era, "random")
        self.assertEqual(cfg.resolve().validate().seed, 3)


if __name__ == "__main__":
    unittest.main()
