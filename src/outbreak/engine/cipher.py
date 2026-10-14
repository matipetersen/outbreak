"""The cipher: documents written in a code you learn word by word.

Unknown words show as glyphs.  Words are learned by *exposure* (seeing a word
again and again), by *study* (deliberately working at a document), and from
*teachers*.  Grammar words resolve once you are partly fluent; names once you
are very fluent, or once the document as a whole is decoded.  A decoded document
delivers its payload: a location, a vault code, a formula.
"""
from __future__ import annotations

import random
import re
from dataclasses import dataclass, field
from typing import Dict, List, Set, Tuple

from outbreak.content.eras import EraPack

EXPOSURE_TO_LEARN = 4
STUDY_LIMIT = 3
FUNCTION_FLUENCY = 0.25
FULL_FLUENCY = 0.80
DECODE_THRESHOLD = 0.6
NAMES = ("Hale", "Marsh", "Okoye", "Brandt", "Vega", "Ashby", "Kovac", "Reyes", "Lindqvist", "Dara")

FUNCTION_WORDS = frozenset(
    "the a an and or but of to in on at by for from with as is are was were be it its that this these those who "
    "what where when not only into through their his her your you they them we our one all some every than while "
    "can will would have has had which no do does did if so then there here".split())


@dataclass
class Document:
    id: str
    kind: str                         # research | code | evac | formula | diary | manual
    title: str
    text: str                         # template text, placeholders already filled
    words: List[str]                  # lexicon words in the text, in order
    payload: Dict[str, str] = field(default_factory=dict)
    studies: int = 0                  # how many times it has been studied

    def tokens(self) -> List[str]:
        return re.findall(r"[A-Za-z][A-Za-z'-]*|\d+|[^\sA-Za-z\d]", self.text)


# {slot} picks a lexicon word; {poi} {name} {n} {pad} fill specifics.
TEMPLATES: Dict[str, Tuple[str, ...]] = {
    "research": (
        "{leader} {name} sealed the {sample} for the {cure} in the {place} below {poi}. "
        "The {guard} hold the {place}. {warning}.",
        "The {sample} is kept in the {place} of {poi}. The {cure} cannot be made without it. {warning}.",
    ),
    "code": (
        "The {place} below {poi} opens with the {signal} code {n}. Tell no one. {warning}.",
        "{leader} {name} wrote the {place} code on this page: {n}. It is for {poi} only.",
    ),
    "evac": (
        "The {escape} leaves from {pad}. Bring the {signal}. Do not trust the {guard}. {warning}.",
        "{leader} {name}: the last {escape} will wait at {pad} until the {signal} fails.",
    ),
    "formula": (
        "{cure} formula, copy {n}. Combine the {sample} with the {sickness} {sample}. Add the catalyst slowly, "
        "then stabilise. The {cure} must not touch the {dead}. {warning}.",
    ),
    "manual": (
        "{leader} {name} wrote down how to build the {recipe}. Keep this page from the {dead}. {warning}.",
        "How to make the {recipe}, as the {guard} taught it. {name} says it saves lives. {warning}.",
    ),
    "diary": (
        "Day {n}. The {sickness} spread faster than the {leader} said. We hear the {dead} at night. "
        "I will not leave {name} behind.",
        "The {guard} left at dawn. {name} says the {cure} is a lie. I think the {dead} are listening for the {signal}.",
        "{leader} {name} has the {sample} and will not share it. {warning}. We keep the door shut.",
        "If you find this: do not go near the {place} under {poi}. The {dead} came up through it.",
        "Day {n}. No word on the {escape}. The {signal} is silent. {name} coughs all night.",
    ),
}


class Knowledge:
    """What the player can read.  Pure data, so it saves trivially."""

    def __init__(self, vocab: Tuple[str, ...], glyphs: str):
        self.vocab = vocab
        self.glyphs = glyphs
        self.known: Set[str] = set()
        self.exposure: Dict[str, int] = {}

    @property
    def fluency(self) -> float:
        return len(self.known) / len(self.vocab) if self.vocab else 1.0

    def learn(self, word: str) -> bool:
        if word in self.known or word not in self.vocab:
            return False
        self.known.add(word)
        return True

    def learn_random(self, rng: random.Random, n: int) -> List[str]:
        unknown = [w for w in self.vocab if w not in self.known]
        rng.shuffle(unknown)
        out = unknown[:n]
        self.known.update(out)
        return out

    def glyph_word(self, word: str) -> str:
        r = random.Random(word)
        return "".join(r.choice(self.glyphs) for _ in word)


# ------------------------------------------------------------------ writing
def make_document(rng: random.Random, era: EraPack, doc_id: str, kind: str,
                  poi_name: str = "", pad_name: str = "", payload: Dict[str, str] = None) -> Document:
    text = rng.choice(TEMPLATES[kind])
    words: List[str] = []

    def fill(match: re.Match) -> str:
        key = match.group(1)
        if key in era.lexicon:
            w = rng.choice(era.lexicon[key])
            words.append(w)
            return w
        return {"recipe": (payload or {}).get("name", "thing"), "poi": poi_name, "pad": pad_name, "name": rng.choice(NAMES), "n": str(rng.randint(2, 9)) +
                str(rng.randint(1, 9)) + str(rng.randint(1, 9))}.get(key, key)

    text = re.sub(r"\{(\w+)\}", fill, text)
    text = re.sub(r"(^|[.!?]\s+)([a-z])", lambda m: m.group(1) + m.group(2).upper(), text)
    title = {"research": "Research note", "code": "Access code", "evac": "Evacuation log",
             "formula": "Formula sheet", "diary": "Diary page", "manual": "Manual"}[kind]
    if kind == "manual":
        title = "Manual: " + (payload or {}).get("name", "crafting").lower()
    return Document(doc_id, kind, title, text, words, payload or {})


# ------------------------------------------------------------------ reading
def decoded_fraction(doc: Document, know: Knowledge) -> float:
    if not doc.words:
        return 1.0
    return sum(1 for w in doc.words if w in know.known) / len(doc.words)


def is_decoded(doc: Document, know: Knowledge) -> bool:
    return decoded_fraction(doc, know) >= DECODE_THRESHOLD


def render(doc: Document, know: Knowledge) -> str:
    """The text as the player currently sees it."""
    decoded = is_decoded(doc, know)
    flu = know.fluency
    word_set = set(doc.words)
    out = []
    for tok in doc.tokens():
        low = tok.lower()
        if not tok[0].isalpha():
            out.append(tok)
        elif low in know.known and low in word_set or tok in know.known:
            out.append(tok)
        elif low in word_set:
            out.append(know.glyph_word(tok))
        elif low in FUNCTION_WORDS:
            out.append(tok if decoded or flu >= FUNCTION_FLUENCY else know.glyph_word(tok))
        else:
            out.append(tok if decoded or flu >= FULL_FLUENCY else know.glyph_word(tok))
    text = ""
    for tok in out:
        text += tok if (not text or tok in ".,:;!?" or text.endswith("-")) else " " + tok
    return text


def expose(doc: Document, know: Knowledge, threshold: int = EXPOSURE_TO_LEARN) -> List[str]:
    """Reading a document exposes you to its unknown words; some sink in."""
    learned = []
    for w in dict.fromkeys(doc.words):
        if w in know.known:
            continue
        know.exposure[w] = know.exposure.get(w, 0) + 1
        if know.exposure[w] >= threshold:
            know.learn(w)
            learned.append(w)
    return learned


def study(rng: random.Random, doc: Document, know: Knowledge, bonus: float = 0.0, words_per_try: int = 1) -> List[str]:
    """Deliberate effort.  Returns the words decoded (empty on failure)."""
    if doc.studies >= STUDY_LIMIT:
        return []
    doc.studies += 1
    unknown = [w for w in dict.fromkeys(doc.words) if w not in know.known]
    rng.shuffle(unknown)
    learned = []
    chance = min(0.95, 0.5 + bonus + know.fluency * 0.3)
    for w in unknown[:max(1, words_per_try)]:
        if rng.random() < chance and know.learn(w):
            learned.append(w)
    return learned
