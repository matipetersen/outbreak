import io
import os
import tempfile
import unittest
from contextlib import redirect_stdout

from tests import helpers
from outbreak import cli, content
from outbreak.bot import play
from outbreak.engine import encounters, services
from outbreak.engine import save as savemod
from outbreak.engine import tiles as T
from outbreak.engine.model import Item
from outbreak.ui import render


def quiet(g):
    helpers.empty_level_of_enemies(g.world.level)
    g.hordes.clear()
    g.ring = None
    return g


def prepare_final(g):
    for req in g.scenario.requirements:
        g.player.inventory.append(Item(req.id))
    g.formula_found = True
    g.know.known.update(g.know.vocab)
    site = g.pois[g.final_site_id]
    lv = g.ensure_level(site.level_id)
    spot = lv.free_spot_near(lv.bench[0], lv.bench[1], 1)
    helpers.teleport(g, site.level_id, spot)
    return lv


class VictoryTests(unittest.TestCase):
    def test_both_scenarios_can_be_won(self):
        for scenario in ("cure", "extraction", "dash"):
            for era in content.ERAS:
                g = quiet(helpers.make_game(era=era, scenario=scenario, seed=5))
                prepare_final(g)
                g.player.hp = g.player.max_hp = 10 ** 6
                self.assertTrue(g.use_bench(), (era, scenario))
                helpers.break_out(g)
                self.assertIsNotNone(g.over, (era, scenario))
                self.assertTrue(g.over.victory, (era, scenario, g.over.title))

    def test_cannot_start_the_finale_unprepared(self):
        g = quiet(helpers.make_game(scenario="cure"))
        site = g.pois[g.final_site_id]
        lv = g.ensure_level(site.level_id)
        helpers.teleport(g, site.level_id, lv.free_spot_near(lv.bench[0], lv.bench[1], 1))
        self.assertFalse(g.use_bench())
        self.assertIsNone(g.final)

    def test_formula_needs_fluency_not_just_the_paper(self):
        g = quiet(helpers.make_game(scenario="cure"))
        for req in g.scenario.requirements:
            g.player.inventory.append(Item(req.id))
        g.formula_found = True
        g.know.known.clear()
        self.assertFalse(g.requirements_met())
        g.know.known.update(g.know.vocab)
        self.assertTrue(g.requirements_met())

    def test_low_humanity_brings_the_humans_to_the_finale(self):
        g = quiet(helpers.make_game(scenario="extraction", seed=7))
        prepare_final(g)
        g.player.hp = g.player.max_hp = 10 ** 6
        g.player.humanity = 5
        g.use_bench()
        for _ in range(g.scenario.final_turns // 2 + 3):
            g.wait(1)
        self.assertTrue(any(a.name == "Raider" for a in g.level.actors))

    def test_extraction_deadline_ends_the_run(self):
        g = quiet(helpers.make_game(scenario="extraction"))
        g.clock.turn = g.deadline_days * 240 + 238
        g.wait(5)
        self.assertEqual(g.over.kind, "left_behind")

    def test_the_ending_depends_on_humanity(self):
        titles = set()
        for h in (90, 55, 25, 3):
            g = quiet(helpers.make_game(scenario="cure", seed=2))
            g.player.humanity = h
            g.end("won")
            titles.add(g.over.title)
        self.assertEqual(len(titles), 4)


class WorldInteractionTests(unittest.TestCase):
    def test_entering_and_leaving_a_building(self):
        g = quiet(helpers.make_game(seed=3))
        poi = next(p for p in g.pois.values() if p.kind == "house")
        door_front = g.world.level.free_spot_near(poi.x, poi.y + 1, 2)
        helpers.teleport(g, "world", door_front)
        g.move(poi.x - door_front[0], poi.y - door_front[1])
        self.assertEqual(g.level.poi_id, poi.id)
        self.assertEqual(g.level.id, poi.level_id)
        exits = [pos for pos, pt in g.level.portals.items() if pt.target == "world"]
        self.assertTrue(exits)
        ex = exits[0]
        helpers.empty_level_of_enemies(g.level)
        helpers.teleport(g, g.level.id, g.level.free_spot_near(ex[0], ex[1], 1))
        g.move(ex[0] - g.player.x, ex[1] - g.player.y)
        self.assertIs(g.level, g.world.level)
        self.assertNotIn(g.player.pos, g.level.portals)

    def test_stairs_connect_floors(self):
        g = quiet(helpers.make_game(seed=3))
        poi = next(p for p in g.pois.values() if p.floors >= 2 and p.kind not in ("refuge", "pad"))
        lv0 = g.ensure_level(poi.level_id)
        helpers.empty_level_of_enemies(lv0)
        down = next(pos for pos, pt in lv0.portals.items() if pt.label == "down")
        helpers.teleport(g, lv0.id, lv0.free_spot_near(down[0], down[1], 1))
        g.move(down[0] - g.player.x, down[1] - g.player.y)
        self.assertEqual(g.level.id, f"{poi.id}:1")
        self.assertTrue(g.level.walkable(*g.player.pos))

    def test_deciphered_documents_reveal_places_and_codes(self):
        g = quiet(helpers.make_game(scenario="cure", seed=4))
        research = next(d for d in g.docs.values() if d.kind == "research")
        target = g.pois[research.payload["reveal"]]
        target.revealed = target.lead = False
        g.collect_document(research.id)
        g.know.known.update(research.words)
        text, _ = g.read_document(research.id)
        self.assertTrue(target.lead)
        code = next(d for d in g.docs.values() if d.kind == "code" and d.payload["code"] == target.id)
        g.know.known.update(code.words)
        g.read_document(code.id)
        self.assertTrue(target.code_known)

    def test_vault_opens_with_a_code_and_holds_the_component(self):
        g = quiet(helpers.make_game(scenario="cure", seed=4))
        poi = next(p for p in g.pois.values() if p.component)
        for floor in range(poi.floors):
            lv = g.ensure_level(f"{poi.id}:{floor}")
        lv = g.levels[f"{poi.id}:{poi.floors - 1}"]
        self.assertIsNotNone(lv.vault_lock)
        poi.code_known = True
        helpers.empty_level_of_enemies(lv)
        spot = lv.free_spot_near(lv.vault_lock[0], lv.vault_lock[1], 2)
        helpers.teleport(g, lv.id, spot)
        pos = lv.vault_lock
        for _ in range(3):
            g.try_unlock(pos)
        self.assertNotEqual(lv.tile(*pos), T.LOCKED)
        crate = next(p for p, c in lv.containers.items() if c.note == "vault")
        from outbreak.engine import inventory_ops
        inventory_ops.search(g, crate)
        self.assertEqual(g.player.count(poi.component), 1)

    def test_encounters_apply_their_effects(self):
        g = quiet(helpers.make_game(seed=2))
        g.player.inventory.append(Item("food", 2))
        before = g.player.humanity
        ev = encounters.start(g, encounters.BY_ID["hungry"])
        g.pending_event = ev
        g.resolve_event(0)
        self.assertGreater(g.player.humanity, before)
        self.assertIsNone(g.pending_event)

    def test_every_event_choice_resolves_without_error(self):
        for ev in encounters.EVENTS:
            for i, choice in enumerate(ev.choices):
                g = quiet(helpers.make_game(seed=2))
                g.player.inventory += [Item("food", 3), Item("bandage", 3)]
                g.player.coins = 50
                g.pending_event = encounters.start(g, ev)
                g.resolve_event(i)
                g.wait(2)

    def test_haven_services(self):
        g = quiet(helpers.make_game(seed=2))
        refuge = g.pois[g.refuge_id]
        lv = g.ensure_level(refuge.level_id)
        helpers.teleport(g, lv.id)
        roles = {a.role for a in lv.actors}
        self.assertEqual(roles, {"trader", "healer", "scholar"})
        g.player.coins = 100
        g.player.hp = 5
        self.assertIn("patches", services.heal(g))
        self.assertEqual(g.player.hp, g.player.max_hp)
        before = len(g.know.known)
        services.teach(g)
        self.assertGreater(len(g.know.known), before)
        stock = services.stock(g)
        self.assertIn("Bought", services.buy(g, stock[0][0]))
        g.player.humanity = 5
        self.assertIn("turn their backs", services.heal(g))

    def test_sleeping_burns_the_infection_clock(self):
        g = quiet(helpers.make_game(scenario="cure", seed=2))
        refuge = g.pois[g.refuge_id]
        lv = g.ensure_level(refuge.level_id)
        helpers.teleport(g, lv.id)
        t = g.player.infection_timer
        slept = g.sleep()
        self.assertGreater(slept, 0)
        self.assertEqual(g.player.infection_timer, t - slept)


class PersistenceTests(unittest.TestCase):
    def test_save_and_load_roundtrip_continues_identically(self):
        g = helpers.make_game(era="medieval", zombies="rot", seed=11)
        play(g, 150, seed=1)
        with tempfile.TemporaryDirectory() as d:
            path = os.path.join(d, "x.sav")
            savemod.save(g, path)
            h = savemod.load(path)
        self.assertEqual(h.clock.turn, g.clock.turn)
        self.assertEqual(h.player.pos, g.player.pos)
        play(g, 60, seed=2)
        play(h, 60, seed=2)
        self.assertEqual(h.clock.turn, g.clock.turn)
        self.assertEqual(h.player.pos, g.player.pos)
        self.assertEqual(h.log[-5:], g.log[-5:])

    def test_corrupt_and_foreign_files_are_rejected_cleanly(self):
        with tempfile.TemporaryDirectory() as d:
            bad = os.path.join(d, "bad.sav")
            with open(bad, "wb") as fh:
                fh.write(b"not a save")
            with self.assertRaises(savemod.SaveError):
                savemod.load(bad)
            with open(bad, "wb") as fh:
                fh.write(savemod.MAGIC + b"garbage")
            with self.assertRaises(savemod.SaveError):
                savemod.load(bad)
            with self.assertRaises(savemod.SaveError):
                savemod.load(os.path.join(d, "missing.sav"))

    def test_same_seed_same_run(self):
        runs = []
        for _ in range(2):
            g = helpers.make_game(era="scifi", zombies="spore", seed=21)
            play(g, 200, seed=4)
            runs.append((g.clock.turn, g.player.pos, g.player.hp, [m[1] for m in g.log[-8:]]))
        self.assertEqual(runs[0], runs[1])


class SmokeTests(unittest.TestCase):
    def test_every_combination_survives_a_short_bot_run(self):
        for era in content.ERAS:
            for zombies in content.PRESETS:
                for scenario in content.SCENARIOS:
                    g = helpers.make_game(era=era, zombies=zombies, scenario=scenario, seed=hash((era, zombies)) % 50)
                    play(g, 120, seed=1)

    def test_all_origins_and_difficulties_start(self):
        for origin in content.ORIGINS:
            for diff in ("easy", "normal", "hard"):
                g = helpers.make_game(origin=origin, difficulty=diff, needs=True)
                g.wait(5)
                self.assertGreater(g.player.hp, 0)

    def test_view_renders_in_every_state(self):
        g = helpers.make_game(seed=2)
        for w, h in ((40, 12), (80, 30), (200, 60)):
            view = render.build_view(g, w, h, 6, 100)
            self.assertEqual(len(view.map_rows), h)
            self.assertTrue(all(len(r) == w for r in view.map_rows))
        view = render.build_view(g, 60, 20, 6, 100, cursor=g.player.pos)
        self.assertIn("HP", "\n".join(t for t, _ in view.side))
        self.assertTrue(render.places(g))
        poi = next(p for p in g.pois.values() if p.kind == "house")
        helpers.teleport(g, poi.level_id)
        render.build_view(g, 60, 20, 6, 100)


class CliTests(unittest.TestCase):
    def test_list_and_bot_and_errors(self):
        buf = io.StringIO()
        with redirect_stdout(buf):
            self.assertEqual(cli.main(["--list"]), 0)
        self.assertIn("Nightstalkers", buf.getvalue())
        buf = io.StringIO()
        with redirect_stdout(buf):
            self.assertEqual(cli.main(["--era", "medieval", "--zombies", "swarm", "--seed", "3", "--bot", "80"]), 0)
        self.assertIn("medieval/swarm", buf.getvalue())
        with self.assertRaises(SystemExit):
            cli.main(["--era", "stone-age"])

    def test_show_prints_a_frame(self):
        buf = io.StringIO()
        with redirect_stdout(buf):
            self.assertEqual(cli.main(["--show", "--seed", "1"]), 0)
        self.assertIn("HP", buf.getvalue())


if __name__ == "__main__":
    unittest.main()
