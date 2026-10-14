"""What the people of the havens and the roads say to you: who they are, how they greet you, what they have heard.

Voices come from ``content.dialogue``; the greeting reads your state (hurt, bitten, who is with you, the hour), the news
reads the world (a horde on the move, a checkpoint on the road, a name you made an enemy of, the people you lost).
"""
from __future__ import annotations

from outbreak.content import dialogue as D
from outbreak.engine import companion, memory
from outbreak.engine.model import Human
from outbreak.util import cheb, compass


def _era(game, text: str) -> str:
    """The same line, worded for the age: no rifles or doctorates in the middle ages."""
    if game.era.id == "medieval":
        for old, new in D.MEDIEVAL_SWAPS:
            text = text.replace(old, new)
    return text


def _key(npc: Human) -> str:
    return npc.role if npc.role in D.PERSONAS else "survivor"


def persona(npc: Human) -> D.Persona:
    group = D.PERSONAS[_key(npc)]
    return group[npc.uid % len(group)]


def given(game, npc: Human) -> str:
    pool = D.GIVEN[game.era.id]
    return pool[(npc.uid * 7) % len(pool)]


def title(game, npc: Human) -> str:
    return f"{given(game, npc)}, {D.ROLE_WORD.get(npc.role, 'survivor')}"


def greeting(game, npc: Human) -> str:
    p, pl = persona(npc), game.player
    n = npc.chats
    npc.chats += 1
    if pl.infected:
        line = p.sick
    elif pl.hp < pl.max_hp * 0.5:
        line = p.hurt
    elif n == 0:
        line = p.first
    elif companion.current(game) is not None and n % 3 == 0:
        line = p.company
    elif game.clock.is_night and n % 2 == 1:
        line = p.night
    else:
        line = p.again[n % len(p.again)]
    if pl.humanity < 40 and n > 0:
        line += " They keep a little distance from you."
    return _era(game, line)


def about(game, npc: Human) -> str:
    p = persona(npc)
    i = npc.asked
    npc.asked += 1
    if i < len(p.bio):
        return _era(game, p.bio[i])
    return f"{given(game, npc)} has told you everything worth telling. Which is a kind of answer."


def _facts(game, npc: Human) -> list:
    pl, out = game.player, []
    hordes = [h for h in getattr(game, "hordes", []) if h.size >= 6]
    if hordes:
        h = min(hordes, key=lambda x: cheb(x.pos, pl.pos))
        if cheb(h.pos, pl.pos) <= 90:
            out.append(f"\"A crowd of them is moving, somewhere {compass(h.x - pl.x, h.y - pl.y)} of here. I would not be on that side tonight.\"")
    cps = [c for c in getattr(game, "checkpoints", {}).values() if not c.hostile]
    if cps:
        c = min(cps, key=lambda x: cheb((x.x, x.y), pl.pos))
        out.append(f"\"Soldiers hold the road {compass(c.x - pl.x, c.y - pl.y)} of here. They search packs. Leave anything you would miss.\"")
    ns = getattr(game, "nemeses", [])
    if ns:
        out.append(f"\"{ns[0]['name']} is still out there. They say you are the reason they ran. People remember that.\"")
    lost = getattr(game, "fallen_allies", [])
    if lost:
        out.append(f"\"I heard about {lost[-1][0]}. I am sorry. Nobody warns you how often you will say that.\"")
    if game.deadline_days:
        left = game.deadline_days - game.clock.day
        out.append(f"\"The way out closes after day {game.deadline_days}. It is day {game.clock.day}. {left} to go, if you are counting.\""
                   if left > 0 else "\"This is the last day. Whatever you mean to do, do it now.\"")
    if game.rep.get("military", 0) <= -20:
        out.append("\"The soldiers know your name, and not kindly. Be careful on the roads.\"")
    if game.rep.get("enclave", 0) >= 30:
        out.append("\"People here speak well of you. Do not let it go to your head, but it is nice to hear.\"")
    return out


def news(game, npc: Human) -> str:
    facts = _facts(game, npc) + list(D.RUMOURS[_key(npc)])
    line = facts[(npc.uid + npc.heard) % len(facts)]
    npc.heard += 1
    return _era(game, line)
