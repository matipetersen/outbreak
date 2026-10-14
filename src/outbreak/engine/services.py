"""Safe-haven services: trading, medical care, teaching, sleeping."""
from __future__ import annotations

from typing import List, Tuple

from outbreak.engine import companion, dialogue
from outbreak.engine.model import Human, Item

HEAL_COST = 6
TEACH_COST = 5
TEACH_WORDS = 3
LEAD_COST = 15
PAPERS_COST = 4
STOCK = ("bandage", "painkiller", "food", "medkit", "filter", "repair_kit", "molotov", "suppressant")


def refuses(game) -> str:
    """Why the haven will not deal with you, or an empty string."""
    if game.player.humanity < 20:
        return "They see what you have become and turn their backs."
    if game.rep.get("enclave", 0) < -30:
        return "Word of what you did has reached them. They will not serve you."
    return ""


def price_mult(game) -> float:
    rep = game.rep.get("enclave", 0)
    return max(0.7, 1.5 - rep / 200 - (0.15 if game.player.humanity >= 75 else 0.0))


def stock(game) -> List[Tuple[str, int]]:
    out = []
    ammo = game.item_def(game.era.defaults["ranged"]).ammo
    ids = list(STOCK) + ([ammo] if ammo else [])
    for item_id in ids:
        if item_id in game.items:
            d = game.item_def(item_id)
            out.append((item_id, max(1, int(round(d.value * price_mult(game))))))
    return out


def buy(game, item_id: str) -> str:
    r = refuses(game)
    if r:
        return r
    price = dict(stock(game)).get(item_id)
    d = game.item_def(item_id)
    if price is None:
        return "Not for sale."
    if game.player.coins < price:
        return f"You need {price} {game.era.coin}."
    if not game.player.can_hold(Item(item_id), d.stackable):
        return "Your pack is full."
    game.player.coins -= price
    game.player.add_item(Item(item_id, 1), d.stackable)
    return f"Bought {d.name.lower()} for {price}."


def sell_price(game, item: Item) -> int:
    d = game.item_def(item.id)
    base = d.value if d.kind != "component" else 0
    return max(0, int(base * 0.5 * item.qty))


def sell(game, index: int) -> str:
    r = refuses(game)
    if r:
        return r
    p = game.player
    if not 0 <= index < len(p.inventory):
        return "Nothing there."
    item = p.inventory[index]
    d = game.item_def(item.id)
    if d.kind == "component":
        return "You are not selling that."
    price = sell_price(game, item)
    if price <= 0:
        return "They are not interested."
    p.coins += price
    p.inventory.pop(index)
    return f"Sold {d.name.lower()} for {price}."


def heal(game) -> str:
    r = refuses(game)
    if r:
        return r
    p = game.player
    if p.coins < HEAL_COST:
        return f"The healer wants {HEAL_COST} {game.era.coin}."
    p.coins -= HEAL_COST
    p.hp = p.max_hp
    p.bleeding = 0
    p.fracture = False
    return "The healer patches you up."


def teach(game) -> str:
    r = refuses(game)
    if r:
        return r
    p = game.player
    if p.coins < TEACH_COST:
        return f"The {game.era.cipher_name.lower()} lessons cost {TEACH_COST} {game.era.coin}."
    learned = game.know.learn_random(game.rng, TEACH_WORDS)
    if not learned:
        return "There is nothing left they can teach you."
    p.coins -= TEACH_COST
    return f"You learn: {', '.join(learned)}."


def buy_lead(game) -> str:
    r = refuses(game)
    if r:
        return r
    if game.player.coins < LEAD_COST:
        return f"A lead costs {LEAD_COST} {game.era.coin}."
    if not game.reveal_random_lead():
        return "They have nothing new to tell you."
    game.player.coins -= LEAD_COST
    return "They tell you where to look."


def ask_papers(game) -> str:
    """The archivist knows where written pages were left: the nearest buildings that still hold some."""
    r = refuses(game)
    if r:
        return r
    p = game.player
    if p.coins < PAPERS_COST:
        return f"That costs {PAPERS_COST} {game.era.coin}."
    found = game.reveal_paper_leads(2)
    if not found:
        return "They know of no more pages that you have not read."
    p.coins -= PAPERS_COST
    from outbreak.util import cheb, compass, dist_words
    lines = [f"the {q.name}, {compass(q.x - p.x, q.y - p.y)}, about {dist_words(game.era.id, cheb(q.pos, p.pos))}" for q in found]
    return "Pages were left in " + " and in ".join(lines) + ". They are marked on your map."


def sleep(game, max_turns: int = 80) -> int:
    """Sleep in a bed.  Returns the turns slept (the infection clock keeps running)."""
    return min(max_turns, game.clock.until_hour(6.0))


PATROL_LINES = {
    "scout": ("\"Keep to the roads and off the high ground. They see you up there.\"",
              "\"We bring the stragglers in when we can. Not every day we can.\"",
              "\"Camps to the east are not friendly. Do not go knocking.\""),
    "soldier": ("\"Move along, civilian. This sector is not clear.\"",
                "\"We hold the roads. Beyond that you are on your own.\"",
                "\"Noise draws them. Noise draws the other kind too.\""),
}


MAX_COMPANIONS = 1
JOIN_TRUST = 15


def companions(game) -> List[Human]:
    c = companion.current(game)
    return [c] if c is not None else []


def talk_patrol(game, npc: Human) -> str:
    """A passing patrol: wary, but willing to share one tip with someone who still looks human."""
    if game.player.humanity < 20:
        return f"The {npc.name.lower()} looks at what you have become, and does not lower their weapon."
    name = npc.name.lower()
    if npc.group in game.aided and not game.aided[npc.group]:
        game.aided[npc.group] = True
        game.rep[npc.faction] = game.rep.get(npc.faction, 0) + 10
        game.adjust_humanity(4, "")
        npc.talked = True
        gift = "medkit" if "medkit" in game.items else "bandage"
        game.give_item(Item(gift, 1))
        game.reveal_random_lead()
        return (f"The {name} grips your arm. \"You came when we called. We do not forget that.\" "
                f"They press a {game.item_def(gift).name.lower()} into your hand and tell you what they know.")
    if not npc.talked:
        npc.talked = True
        game.rep[npc.faction] = game.rep.get(npc.faction, 0) + 2
        hello = dialogue.greeting(game, npc)
        if game.reveal_random_lead():
            return f"{hello}\n\nThen the {name} lowers their weapon and tells you where they have seen something worth finding."
        return f"{hello}\n\nThe {name} has no leads for you, but nods and wishes you luck."
    return dialogue.greeting(game, npc)


def join_refusal(game, npc: Human) -> str:
    """Why this person will not travel with you, or an empty string."""
    return companion.refusal(game, npc)


def ask_join(game, npc: Human) -> str:
    why = join_refusal(game, npc)
    if why:
        return why
    companion.recruit(game, npc)
    return f"{npc.name} falls in beside you. They will fight what you fight, and come in with you when you go through a door."


def dismiss(game, npc: Human) -> str:
    return companion.dismiss(game, npc)


def npc_title(npc: Human, game=None) -> str:
    if game is not None:
        from outbreak.engine import dialogue
        return dialogue.title(game, npc)
    return {"trader": "Trader", "healer": "Healer", "scholar": "Archivist"}.get(npc.role, npc.name)
