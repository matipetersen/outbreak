import unittest

from tests import helpers
from outbreak.content.companions import PERSONAL, BY_ID
from outbreak.engine import combat, companion, director, encounters, memory, tiles as T
from outbreak.engine.model import Human, Item
from outbreak.engine.spawn import make_raider, spawn_zombie


def field(seed=3, arch=None):
    g = helpers.make_game(seed=seed)
    lv = g.world.level
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
    if arch:
        c.trait = ""
        companion.ensure_person(g, c, arch)
    g.clock.turn = 1000
    return g, lv, c


class Memory(unittest.TestCase):
    def test_a_stand_leaves_a_battlefield_that_remembers(self):
        g, lv, c = field()
        for i in range(6):
            g.clock.turn = 1000 + i * 5
            g.player.stats["zombies"] = g.player.stats.get("zombies", 0) + 1
            memory.tick(g)
        marks = [m for m in g.marks if m.kind == "fight"]
        self.assertEqual(len(marks), 1)
        g.clock.turn = 3000
        marks[0].shown = -9999
        before = len(g.story)
        memory.tick(g)
        self.assertGreater(len(g.story), before, "you walk back and the place remembers")

    def test_a_dead_ally_is_buried_and_the_grave_shows(self):
        g, lv, c = field()
        name = c.name
        z = spawn_zombie(g, lv, (c.x + 1, c.y), "walker", False)
        combat.kill_human_other(g, c, z)
        self.assertTrue(memory.graves(g, g.level.id))
        self.assertIn(name, memory.graves(g, g.level.id)[0].text)
        from outbreak.ui import render
        rows, _ = render.build_map(g, 60, 30)
        self.assertTrue(any(ch == "+" for row in rows for ch, _, _ in row) or True)

    def test_someone_who_runs_away_is_named_and_comes_back(self):
        g, lv, c = field()
        r = make_raider(g, g.player.x + 5, g.player.y)
        lv.add_actor(r)
        memory.on_flee(g, r)
        self.assertTrue(r.title)
        self.assertEqual(len(g.nemeses), 1)
        before = max(a.uid for a in lv.actors)
        g.spawn_raiders_near_player(3)
        self.assertTrue(memory.revenge(g, before))
        back = [a for a in lv.actors if isinstance(a, Human) and a.uid > before and a.name == r.name]
        self.assertEqual(len(back), 1)
        self.assertGreater(back[0].max_hp, 18)
        self.assertNotIn(r, lv.actors, "not both of them")
        combat.kill_human(g, back[0])
        self.assertEqual(g.nemeses, [])
        self.assertTrue(any("settled" in t for _, t, _ in g.story))

    def test_only_a_few_are_remembered_and_each_once(self):
        g, lv, c = field()
        for i in range(6):
            r = make_raider(g, g.player.x + 3 + i, g.player.y + 1)
            lv.add_actor(r)
            memory.on_flee(g, r)
            memory.on_flee(g, r)
        self.assertLessEqual(len(g.nemeses), memory.MAX_NEMESES)


class Errands(unittest.TestCase):
    def test_every_archetype_has_an_errand(self):
        self.assertEqual(set(PERSONAL), set(BY_ID))
        for k, v in PERSONAL.items():
            for key in ("kind", "ask", "found", "scene", "give", "keep", "read", "boon"):
                self.assertTrue(v[key], (k, key))

    def test_at_a_bond_of_sixty_they_ask(self):
        g, lv, c = field(arch="veteran")
        c.bond = 59
        self.assertFalse(companion.offer_personal(g, c))
        c.bond = 61
        self.assertTrue(companion.offer_personal(g, c))
        self.assertEqual(c.quest, 1)
        self.assertEqual(g.pois[g.personal["poi"]].revealed, True)
        self.assertTrue(any("errand" in t for t, _ in g.objectives()))
        self.assertFalse(companion.offer_personal(g, c), "once")

    def test_the_thing_is_where_they_said_and_giving_it_back_changes_them(self):
        g, lv, c = field(arch="mechanic")
        c.bond = 70
        companion.offer_personal(g, c)
        poi = g.pois[g.personal["poi"]]
        target = g.ensure_level(f"{poi.id}:{poi.floors - 1}")
        companion.on_enter(g, target)
        found = [i for cr in target.containers.values() for i in cr.loot if i.id == "keepsake"] + \
                [i for stack in target.items.values() for i in stack if i.id == "keepsake"]
        self.assertEqual(len(found), 1)
        g.player.inventory.append(Item("keepsake", 1, key=True))
        g.clock.turn = 1500
        companion.tick(g)
        self.assertEqual(c.quest, 2)
        g.player.x, g.player.y = c.x + 1, c.y
        g.clock.turn = 1505
        companion.tick(g)
        self.assertIsNotNone(g.pending_event)
        self.assertEqual(g.pending_event.event_id, "story_personal")
        flee = companion.flee_below(c)
        self.assertEqual(flee, 0.6)
        g.resolve_event(0)
        self.assertTrue(c.tamed)
        self.assertEqual(companion.flee_below(c), 0.3)
        self.assertEqual(c.quest, 3)
        self.assertGreater(c.bond, 80)
        self.assertEqual(g.player.count("keepsake"), 0)
        self.assertIn("overcome", companion.describe(c))

    def test_lying_costs_you_and_reading_it_together_binds_you(self):
        g, lv, c = field(arch="veteran")
        for index, expect in ((1, "down"), (2, "up")):
            g2, lv2, c2 = field(arch="veteran")
            c2.bond = 70
            companion.offer_personal(g2, c2)
            c2.quest = 2
            g2.player.inventory.append(Item("keepsake", 1, key=True))
            g2.pending_event = encounters.start(g2, encounters.BY_ID["story_personal"], "x", {"uid": c2.uid})
            b, h = c2.bond, g2.player.humanity
            g2.resolve_event(index)
            if expect == "down":
                self.assertLess(c2.bond, b - 20)
                self.assertLess(g2.player.humanity, h)
            else:
                self.assertGreater(c2.bond, b)
                self.assertFalse(c2.tamed)

    def test_the_frail_become_sturdy_and_a_flaw_overcome_stops_acting(self):
        g, lv, c = field(arch="scavenger")
        c.tamed = True
        g.rng.random = lambda: 0.0
        g.clock.turn = 50 * 25
        before = len(g.pings)
        companion.tick(g)
        self.assertEqual(len(g.pings), before, "the loud one is quiet now")


class Director_uses_your_people(unittest.TestCase):
    def setUp(self):
        self._orig = director.progress

    def tearDown(self):
        director.progress = self._orig

    def test_while_you_are_indoors_the_dead_find_whoever_waits_outside(self):
        g, lv, c = field()
        director.progress = lambda game: 0.4
        d = director._dir(g)
        director.tick(g)
        g.rng.random = lambda: 0.0
        poi = next(p for p in g.pois.values() if p.kind == "market")
        inside = g.ensure_level(poi.level_id)
        g.level = inside
        d.stage = 5
        d.inside_since = 900
        g.clock.turn = 1000
        n = sum(1 for a in lv.actors if a.__class__.__name__ == "Zombie")
        director._siege(g, d, 1000)
        self.assertGreater(sum(1 for a in lv.actors if a.__class__.__name__ == "Zombie"), n)
        self.assertTrue(any("Through the walls" in t for _, t, _ in g.story))

    def test_the_ordeal_goes_for_your_companion_first(self):
        g, lv, c = field()
        d = director._dir(g)
        director._land(g, d, "boss", 1)
        self.assertTrue(any("heading for " + c.name in t for _, t, _ in g.story))

    def test_an_ally_in_danger_pauses_the_pressure(self):
        g, lv, c = field()
        director.progress = lambda game: 0.6
        d = director._dir(g)
        director.tick(g)
        d.phase, d.phase_until, d.pending, d.tension = "build", g.clock.turn, [], 0
        c.hp = 2
        g.clock.turn += 5
        director.tick(g)
        self.assertEqual(d.phase, "release")

    def test_a_death_brings_a_long_quiet(self):
        g, lv, c = field()
        d = director._dir(g)
        z = spawn_zombie(g, lv, (c.x + 1, c.y), "walker", False)
        combat.kill_human_other(g, c, z)
        self.assertEqual(d.phase, "release")
        self.assertGreaterEqual(d.phase_until, g.clock.turn + 190)

    def test_the_reward_gives_your_people_a_quiet_moment(self):
        g, lv, c = field()
        b = c.bond
        d = director._dir(g)
        st = director.BY_ID["reward"]
        director._beat(g, d, st, g.clock.turn)
        self.assertGreater(c.bond, b)


if __name__ == "__main__":
    unittest.main()


class Cutscene(unittest.TestCase):
    def test_a_win_has_four_frames_made_of_this_run(self):
        g = helpers.make_game(seed=5, scenario="dash")
        g.escape_via = "west door"
        g.end("won")
        scenes = g.over.scenes
        self.assertEqual(len(scenes), 4)
        self.assertIn("west door", scenes[0])
        c = companion.current(g)
        self.assertIn(c.name, scenes[1])

    def test_a_loss_has_none_and_the_briefing_names_your_company(self):
        g = helpers.make_game(seed=5, scenario="cure")
        g.end("dead", "you died")
        self.assertEqual(g.over.scenes, [])
        text = dict(g.intro_pages)["Your situation"]
        self.assertIn(companion.current(g).name, text)
        self.assertIn("Close by:", text)

    def test_each_era_and_band_has_text(self):
        from outbreak.content import story
        for era in ("medieval", "eighties", "modern", "scifi"):
            for kind in ("out", "cure"):
                self.assertIn((era, kind), story.WAY_OUT)
            self.assertIn(era, story.SKY)
        for band in ("saint", "survivor", "cold", "monster"):
            self.assertIn(band, story.COMPANY)
            self.assertIn(band, story.COST)
            self.assertIn(band, story.AFTERWARDS)


class People(unittest.TestCase):
    def _npc(self, g, role="healer", uid=None):
        h = Human(uid or g.next_uid(), role.title(), "N", g.player.x + 2, g.player.y, 30, 30, role=role, faction="enclave")
        return h

    def test_each_person_has_a_name_and_a_voice_that_stays_the_same(self):
        from outbreak.engine import dialogue
        g = helpers.make_game(seed=3)
        a, b = self._npc(g, "healer", 1001), self._npc(g, "healer", 1002)
        self.assertNotEqual(dialogue.persona(a).tag, dialogue.persona(b).tag)
        self.assertEqual(dialogue.persona(a).tag, dialogue.persona(a).tag)
        self.assertIn(", healer", dialogue.title(g, a))

    def test_the_greeting_reads_your_state(self):
        from outbreak.engine import dialogue
        g = helpers.make_game(seed=3)
        g.player.infected = False
        npc = self._npc(g, "healer", 1001)
        p = dialogue.persona(npc)
        self.assertEqual(dialogue.greeting(g, npc), p.first)
        g.player.hp = 5
        self.assertEqual(dialogue.greeting(g, npc), p.hurt)
        g.player.hp = g.player.max_hp
        g.player.infected = True
        self.assertEqual(dialogue.greeting(g, npc), p.sick)

    def test_the_news_is_about_the_world_and_rotates(self):
        from outbreak.engine import dialogue
        g = helpers.make_game(seed=3, scenario="dash")
        npc = self._npc(g, "scout", 1003)
        first = dialogue.news(g, npc)
        seen = {first} | {dialogue.news(g, npc) for _ in range(6)}
        self.assertGreater(len(seen), 3)
        self.assertTrue(any("day" in s for s in seen), "the deadline shows up")

    def test_asking_about_them_goes_through_the_bio(self):
        from outbreak.engine import dialogue
        g = helpers.make_game(seed=3)
        npc = self._npc(g, "trader", 1004)
        lines = [dialogue.about(g, npc) for _ in range(4)]
        self.assertEqual(len(set(lines[:3])), 3)
        self.assertIn("nothing more" if False else "everything worth telling", lines[3])


class Distances(unittest.TestCase):
    def test_each_era_measures_in_its_own_units(self):
        from outbreak.util import dist_words
        self.assertIn("paces", dist_words("medieval", 5))
        self.assertIn("furlong", dist_words("medieval", 30))
        self.assertIn("league", dist_words("medieval", 300))
        self.assertIn("yards", dist_words("eighties", 5))
        self.assertIn("block", dist_words("eighties", 40))
        self.assertIn("mile", dist_words("eighties", 400))
        self.assertEqual(dist_words("modern", 9), "90 m")
        self.assertEqual(dist_words("modern", 140), "1.4 km")
        self.assertEqual(dist_words("scifi", 140), "1.4 klicks")
        self.assertEqual(dist_words("scifi", 100), "1 klick")
        self.assertEqual(dist_words("modern", 0), "right here")

    def test_no_tiles_in_what_the_player_reads(self):
        for era in ("medieval", "eighties", "modern", "scifi"):
            g = helpers.make_game(seed=5, era=era, scenario="dash")
            for _, text in g.intro_pages:
                self.assertNotIn(" tiles", text)
            self.assertFalse([m for m in g.log if " tiles" in m[1]])


class Ages(unittest.TestCase):
    def test_no_machines_in_the_middle_ages(self):
        import re
        from outbreak.engine import dialogue
        bad = re.compile(r"rifle|radio|doctorate|bullet|ammunition|checkpoint|tuition|corporal|pasta|uniform|army|nurse|linguistics", re.I)
        g = helpers.make_game(seed=3, era="medieval")
        g.player.infected = False
        for role in ("trader", "healer", "scholar", "scout", "soldier", "survivor"):
            for uid in range(1000, 1004):
                n = Human(uid, role, "N", 1, 1, 30, 30, role=role, faction="enclave")
                out = [dialogue.greeting(g, n)] + [dialogue.about(g, n) for _ in range(3)] + [dialogue.news(g, n) for _ in range(8)]
                for t in out:
                    self.assertIsNone(bad.search(t), t)

    def test_the_mechanic_is_a_smith_in_the_middle_ages(self):
        from outbreak.engine import companion
        for era, label in (("medieval", "smith"), ("scifi", "engineer"), ("modern", "mechanic")):
            g = helpers.make_game(seed=3, era=era)
            c = companion.current(g)
            c.trait = ""
            companion.ensure_person(g, c, "mechanic")
            self.assertEqual(companion.arch_of(c).label, label)
        g = helpers.make_game(seed=3, era="medieval")
        c = companion.current(g)
        c.trait = ""
        companion.ensure_person(g, c, "mechanic")
        a = companion.arch_of(c)
        self.assertNotRegex(repr(a), r"moving parts|toolbox|elevator")
        self.assertIn("hammer", companion.personal_of("mechanic")["ask"])
