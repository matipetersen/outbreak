import random
import unittest

from tests import helpers  # noqa: F401
from outbreak import content
from outbreak.engine import cipher as C


class CipherTests(unittest.TestCase):
    def setUp(self):
        self.era = content.get_era("medieval")
        self.rng = random.Random(3)
        self.know = C.Knowledge(self.era.vocabulary(), self.era.glyphs)
        self.doc = C.make_document(self.rng, self.era, "d", "research", poi_name="Old Abbey",
                                   payload={"reveal": "x"})

    def test_unknown_text_is_unreadable_and_stable(self):
        a = C.render(self.doc, self.know)
        b = C.render(self.doc, self.know)
        self.assertEqual(a, b)
        for w in self.doc.words:
            self.assertNotIn(w, a)
        self.assertNotIn("Abbey", a)

    def test_exposure_teaches_words_after_enough_reads(self):
        learned_total = []
        for _ in range(C.EXPOSURE_TO_LEARN):
            learned_total += C.expose(self.doc, self.know)
        self.assertTrue(set(self.doc.words) <= self.know.known)
        self.assertTrue(C.is_decoded(self.doc, self.know))
        self.assertIn("Old Abbey", C.render(self.doc, self.know))

    def test_study_is_limited(self):
        for _ in range(C.STUDY_LIMIT + 2):
            C.study(self.rng, self.doc, self.know, bonus=1.0, words_per_try=3)
        self.assertEqual(self.doc.studies, C.STUDY_LIMIT)

    def test_fluency_resolves_grammar_before_names(self):
        self.know.known.update(self.era.vocabulary()[: int(len(self.know.vocab) * 0.3)])
        self.assertGreaterEqual(self.know.fluency, C.FUNCTION_FLUENCY)
        text = C.render(self.doc, self.know)
        self.assertIn("the", text.lower())

    def test_only_vocabulary_words_are_learnable(self):
        self.assertFalse(self.know.learn("banana"))
        self.assertTrue(self.know.learn(self.era.vocabulary()[0]))

    def test_every_era_documents_use_only_their_own_vocabulary(self):
        for era in content.ERAS.values():
            rng = random.Random(1)
            vocab = set(era.vocabulary())
            for kind in C.TEMPLATES:
                doc = C.make_document(rng, era, "x", kind, poi_name="Place", pad_name="Pad")
                self.assertTrue(set(doc.words) <= vocab, (era.id, kind))


if __name__ == "__main__":
    unittest.main()
