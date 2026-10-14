"""Item handling: use, equip, craft, pick up, search.  Each function returns the
number of turns it cost (0 = nothing happened, no turn spent)."""
from __future__ import annotations

from typing import List, Optional, Tuple

from outbreak.content.items import ItemDef
from outbreak.content.recipes import RECIPES, Recipe
from outbreak.engine import loot
from outbreak.engine import tiles as T
from outbreak.engine.model import Hazard, Item
from outbreak.util import DIRS4

SLOT_OF_KIND = {"weapon": "weapon", "armor": "armor", "light": "light"}


# ------------------------------------------------------------------ equip / drop
def equip(game, index: int) -> int:
    p = game.player
    if not 0 <= index < len(p.inventory):
        return 0
    item = p.inventory[index]
    d = game.item_def(item.id)
    slot = SLOT_OF_KIND.get(d.kind)
    if slot is None:
        return 0
    p.inventory.pop(index)
    old = getattr(p, slot)
    setattr(p, slot, item)
    if old is not None:
        p.inventory.append(old)
    game.msg(f"You equip the {d.name.lower()}.", "info")
    return 1


def unequip(game, slot: str) -> int:
    p = game.player
    item = getattr(p, slot, None)
    if item is None:
        return 0
    if not p.can_hold(item, game.item_def(item.id).stackable):
        game.msg("Your pack is full.", "warn")
        return 0
    setattr(p, slot, None)
    p.add_item(item, game.item_def(item.id).stackable)
    game.msg(f"You put away the {game.item_def(item.id).name.lower()}.", "info")
    return 1


def drop(game, index: int, qty: int = 0) -> int:
    p = game.player
    if not 0 <= index < len(p.inventory):
        return 0
    item = p.inventory[index]
    n = item.qty if qty <= 0 else min(qty, item.qty)
    game.level.drop(p.pos, Item(item.id, n, item.dur))
    item.qty -= n
    if item.qty <= 0:
        p.inventory.pop(index)
    game.msg(f"You drop the {game.item_def(item.id).name.lower()}.", "info")
    return 1


# ------------------------------------------------------------------ use
def use(game, index: int) -> int:
    p = game.player
    if not 0 <= index < len(p.inventory):
        return 0
    item = p.inventory[index]
    d = game.item_def(item.id)
    if d.kind in SLOT_OF_KIND:
        return equip(game, index)
    eff = d.effect
    if d.kind == "food":
        return _eat(game, item, d)
    if d.kind == "med":
        return _medicate(game, item, d)
    if d.kind == "material" and "refuel" in eff:
        return _refuel(game, item, d)
    if d.kind == "tool" and "repair" in eff:
        return _repair(game, item, d)
    if d.kind == "tool" and "barricade" in eff:
        return _barricade(game, item, d)
    if d.kind == "tool" and "trap" in eff:
        return _set_trap(game, item, d)
    if d.kind == "tool" and "fish" in eff:
        game.msg("Stand beside water and use the gather key to fish.", "info")
        return 0
    if d.kind == "throw":
        game.msg("Use the throw command (t) and pick a target.", "warn")
        return 0
    game.msg(f"You cannot use the {d.name.lower()} like that.", "warn")
    return 0


def _consume(game, item: Item) -> None:
    item.qty -= 1
    if item.qty <= 0:
        game.player.inventory.remove(item)


def _eat(game, item: Item, d: ItemDef) -> int:
    p = game.player
    p.hunger = max(0.0, p.hunger - float(d.effect.get("food", 30)))
    _consume(game, item)
    game.msg(f"You eat the {d.name.lower()}.", "info")
    sick = float(d.effect.get("sick", 0))
    if sick and game.rng.random() < sick:
        p.hp = max(1, p.hp - 4)
        p.hunger = min(100.0, p.hunger + 12)
        game.add_panic(6, raw=True)
        game.msg("Your stomach cramps and you bring half of it back up. Cook it next time.", "warn")
    return 2


def _medicate(game, item: Item, d: ItemDef) -> int:
    p = game.player
    eff = d.effect
    if "suppress" in eff and not p.infected:
        game.msg("You are not infected: it would be wasted.", "warn")
        return 0
    if "splint" in eff and not p.fracture:
        game.msg("Nothing is broken.", "warn")
        return 0
    if "stop_bleed" in eff and not p.bleeding and p.hp >= p.max_hp and "heal" in eff and len(eff) == 2:
        game.msg("You are not hurt.", "warn")
        return 0
    if "heal" in eff:
        amount = int(eff["heal"] * (1.0 + p.mod("heal_mult")))
        p.hp = min(p.max_hp, p.hp + amount)
    if eff.get("stop_bleed"):
        if p.hemorrhage and eff.get("heal", 0) < 20:       # a bandage only slows a fresh stump; a medkit closes it
            p.bleeding = max(0, p.bleeding - 2)
        else:
            p.bleeding = 0
        if not p.bleeding:
            p.hemorrhage = False
    if eff.get("splint"):
        p.fracture = False
    if "suppress" in eff:
        p.infection_timer += int(eff["suppress"])
        game.msg("The suppressant steadies your blood. The infection slows.", "good")
    if "panic" in eff:
        game.add_panic(float(eff["panic"]), raw=True)
    if "filter" in eff:
        p.filter_turns = max(p.filter_turns, int(eff["filter"]))
        game.msg("You fit the filter. Spores will not reach your lungs for a while.", "info")
    _consume(game, item)
    game.msg(f"You use the {d.name.lower()}.", "info")
    return 2


def _refuel(game, item: Item, d: ItemDef) -> int:
    p = game.player
    if p.light is None:
        game.msg("You have no light to refuel.", "warn")
        return 0
    ld = game.item_def(p.light.id)
    p.light.dur = min(ld.durability, (p.light.dur or 0) + int(d.effect["refuel"]))
    _consume(game, item)
    game.msg(f"You top up your {ld.name.lower()}.", "info")
    return 1


def _repair(game, item: Item, d: ItemDef) -> int:
    p = game.player
    target = p.weapon if p.weapon and game.item_def(p.weapon.id).durability else (
        p.armor if p.armor else None)
    if target is None:
        game.msg("Nothing equipped needs repairs.", "warn")
        return 0
    td = game.item_def(target.id)
    if (target.dur or 0) >= td.durability:
        game.msg("It is already in good shape.", "warn")
        return 0
    target.dur = min(td.durability, (target.dur or 0) + int(d.effect["repair"]))
    _consume(game, item)
    game.msg(f"You repair your {td.name.lower()}.", "good")
    return 4


def door_adjacent(game) -> Optional[Tuple[int, int]]:
    p, lv = game.player, game.level
    for dx, dy in DIRS4:
        pos = (p.x + dx, p.y + dy)
        if lv.tile(*pos) in (T.DOOR, T.DOOR_OPEN):
            return pos
    return None


def _barricade(game, item: Item, d: ItemDef) -> int:
    pos = door_adjacent(game)
    if pos is None:
        game.msg("There is no door next to you.", "warn")
        return 0
    if game.level.tile(*pos) == T.DOOR_OPEN:
        if game.level.occ.get(pos) is not None:
            game.msg("Something is in the doorway.", "warn")
            return 0
        game.level.set_tile(pos[0], pos[1], T.DOOR)
    game.level.door_hp[pos] = int(d.effect["barricade"])
    _consume(game, item)
    game.msg("You wedge the door shut with everything you have.", "good")
    game.emit_noise(game.player.pos, 4, "player")
    return 3


def _set_trap(game, item: Item, d: ItemDef) -> int:
    lv, p = game.level, game.player
    if lv.hazards.get(p.pos) or lv.tile(*p.pos) in (T.DOOR, T.DOOR_OPEN, T.PORTAL):
        game.msg("Not here: you need clear floor.", "warn")
        return 0
    lv.hazards[p.pos] = Hazard("spikes", 10 ** 9, int(d.effect["trap"]))
    _consume(game, item)
    game.msg("You set the trap and step carefully off it. The dead will not see it.", "good")
    return 2


# ------------------------------------------------------------------ crafting
def recipe_output(game, r: Recipe) -> Optional[str]:
    if r.out == "@ammo":
        ranged = game.era.items[game.era.defaults["ranged"]]
        return ranged.ammo or None
    return r.out if r.out in game.items else None


def recipe_status(game, r: Recipe) -> Tuple[bool, str]:
    """(can craft now, reason if not)."""
    out = recipe_output(game, r)
    if out is None:
        return False, "not possible in this era"
    if r.needs == "firearms" and not game.era.firearms:
        return False, "needs firearms"
    if r.needs == "electricity" and not game.era.electricity:
        return False, "needs electricity"
    if r.needs == "workshop" and not game.adjacent_tile(T.WORKSHOP):
        return False, "stand beside a workshop (build one in your base)"
    if r.id not in getattr(game.player, "recipes", ()):
        return False, "you do not know how: find and decipher a manual"
    if game.know.fluency < r.fluency:
        return False, f"needs {int(r.fluency * 100)}% fluency in the {game.era.cipher_name.lower()}"
    missing = [f"{q}x {game.item_def(i).name.lower()}" for i, q in r.inputs if game.player.count(i) < q]
    if missing:
        return False, "missing " + ", ".join(missing)
    return True, ""


def craft(game, recipe_id: str) -> int:
    r = next((x for x in RECIPES if x.id == recipe_id), None)
    if r is None:
        return 0
    ok, reason = recipe_status(game, r)
    if not ok:
        game.msg(f"You cannot craft that: {reason}.", "warn")
        return 0
    p = game.player
    for item_id, qty in r.inputs:
        for _ in range(qty):
            if game.rng.random() >= p.mod("craft_save"):
                p.take(item_id, 1)
    out = recipe_output(game, r)
    game.give_item(Item(out, r.qty))
    p.gain_xp(2)
    game.msg(f"You craft {r.qty}x {game.item_def(out).name.lower()}.", "good")
    return r.turns


# ------------------------------------------------------------------ pickup / search
def pickup(game) -> int:
    p, lv = game.player, game.level
    stack = lv.items.get(p.pos)
    docs = lv.docs.pop(p.pos, [])
    for doc_id in docs:
        game.collect_document(doc_id)
    if not stack:
        return 1 if docs else 0
    taken = False
    for item in list(stack):
        d = game.item_def(item.id)
        if p.add_item(Item(item.id, item.qty, item.dur), d.stackable):
            stack.remove(item)
            taken = True
            game.msg(f"You pick up {item.qty}x {d.name.lower()}." if d.stackable else f"You pick up the {d.name.lower()}.",
                     "info")
        else:
            game.msg("Your pack is full.", "warn")
            break
    if not stack:
        del lv.items[p.pos]
    return 1 if taken or docs else 0


def search(game, pos) -> int:
    lv, p = game.level, game.player
    c = lv.containers.get(pos)
    if c is None:
        return 0
    if c.opened:
        game.msg("It is empty.", "info")
        return 0
    c.opened = True
    lv.set_tile(pos[0], pos[1], T.CRATE_OPEN)
    game.emit_noise(p.pos, 3, "player")
    found: List[str] = []
    bonus = loot.roll_items(game.rng, game.era, game.poi_kind_of(lv), 1.0, 1.0) \
        if game.rng.random() < p.mod("loot") else []
    for item in c.loot + bonus:
        d = game.item_def(item.id)
        if p.add_item(Item(item.id, item.qty, item.dur), d.stackable):
            found.append(d.name.lower())
        else:
            lv.drop(p.pos, item)
            found.append(f"{d.name.lower()} (left at your feet)")
    if c.coins:
        p.coins += c.coins
        found.append(f"{c.coins} {game.era.coin}")
    if c.note == "vault":
        comp = game.vault_component(lv)
        if comp:
            game.give_item(Item(comp, 1))
            game.msg(f"You found the {game.item_def(comp).name}!", "good")
            p.gain_xp(40)
    for doc_id in c.docs:
        game.collect_document(doc_id)
    game.msg("You search the crate: " + ", ".join(found) + "." if found else "You search the crate. Nothing useful.",
             "info")
    return 2
