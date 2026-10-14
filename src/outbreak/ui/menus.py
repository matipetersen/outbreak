"""Title screen and the new-game form, where era, zombie type and objective are chosen."""
from __future__ import annotations

import curses
import random
import textwrap
from typing import List, Optional

from outbreak import content, records
from outbreak.config import DIFFICULTIES, MODES, RANDOMIZABLE, GameConfig
from outbreak.engine import save as savemod
from outbreak.ui.curses_ui import ENTER, ESC, HELP, UI

TITLE = r"""
   ___  _   _ _____ ____  ____  _____    _    _  __
  / _ \| | | |_   _| __ )|  _ \| ____|  / \  | |/ /
 | | | | | | | | | |  _ \| |_) |  _|   / _ \ | ' /
 | |_| | |_| | | | | |_) |  _ <| |___ / ___ \| . \
  \___/ \___/  |_| |____/|_| \_\_____/_/   \_\_|\_\
"""

FIELDS = ("era", "zombies", "scenario", "mode", "origin", "opening", "difficulty", "needs", "permadeath", "seed", "randomize", "start")
LABELS = {"era": "Era", "zombies": "The dead", "scenario": "Objective", "origin": "Who you are", "opening": "How it starts", "mode": "Mode",
          "difficulty": "Difficulty", "needs": "Hunger", "permadeath": "Permadeath", "seed": "Seed",
          "randomize": ">> RANDOM <<", "start": ">> BEGIN <<"}


def _options(cfg: GameConfig, field: str) -> List[str]:
    if field == "era":
        return ["random"] + list(content.ERAS)
    if field == "zombies":
        return ["random"] + list(content.PRESETS)
    if field == "scenario":
        return ["random"] + list(content.SCENARIOS)
    if field == "origin":
        return ["random"] + list(content.ORIGINS)
    if field == "mode":
        return ["random"] + list(MODES)
    if field == "opening":
        return ["random"] + list(content.OPENINGS)
    if field == "difficulty":
        return list(DIFFICULTIES)
    return []


def _label(cfg: GameConfig, field: str) -> str:
    if field in RANDOMIZABLE and getattr(cfg, field) == "random":
        return "Random"
    if field == "randomize":
        return "everything"
    era = content.get_era(cfg.era) if cfg.era != "random" else None
    if field == "era":
        return era.name
    if field == "zombies":
        return content.get_preset(cfg.zombies).name
    if field == "scenario":
        return content.get_scenario(cfg.scenario).name
    if field == "origin":
        return era.origin_names[cfg.origin] if era else cfg.origin.title()
    if field == "mode":
        return MODE_NAMES[cfg.mode]
    if field == "opening":
        return "Surprise me" if cfg.opening == "random" else content.get_opening(cfg.opening).name
    if field == "difficulty":
        return cfg.difficulty.title()
    if field == "needs":
        return "on (food matters)" if cfg.needs else "off"
    if field == "permadeath":
        return "on (death deletes the save)" if cfg.permadeath else "off"
    if field == "seed":
        return str(cfg.seed) if cfg.seed is not None else "random"
    return ""


def _blurb(cfg: GameConfig, field: str) -> str:
    if field in RANDOMIZABLE and getattr(cfg, field) == "random":
        return "Drawn when the game starts: any of the choices, at random."
    if field == "randomize":
        return "Enter: set era, the dead, objective, who you are and mode to random. Then begin."
    if field == "era":
        e = content.get_era(cfg.era)
        return f"{e.year}. {e.blurb}"
    if field == "zombies":
        z = content.get_preset(cfg.zombies)
        return f"{z.blurb}  (Inspired by: {z.inspired_by}.)"
    if field == "scenario":
        return content.get_scenario(cfg.scenario).blurb
    if field == "origin":
        return content.get_origin(cfg.origin).blurb
    if field == "mode":
        return MODE_BLURBS[cfg.mode]
    if field == "opening":
        if cfg.opening == "random" or cfg.era == "random":
            return "The scene you wake up in is picked for who you are: scholars start studying, medics on their rounds."
        o = content.get_opening(cfg.opening)
        return f"{o.scenes[cfg.era]}  [{o.perk}]"
    if field == "difficulty":
        d = DIRECTIONS[cfg.difficulty]
        return d
    if field == "needs":
        return "Hunger adds pressure: you must eat or you will weaken and starve."
    if field == "permadeath":
        return "Classic roguelike rules. Turn off to keep your autosave after dying."
    if field == "seed":
        return "Left/Right to change, or leave random. The same seed gives the same world."
    return "Start the game."


MODE_NAMES = {"normal": "Normal - one life", "living": "Hardcore - the world goes on"}
MODE_BLURBS = {"normal": "One survivor, one life. Permadeath deletes the save.",
               "living": "You die, the world does not. A new survivor walks out of the refuge into the same world; "
                         "what killed you levels up and keeps its name; your body rises. Infinite lives. "
                         "The cure is for the world: nobody starts bitten."}

DIRECTIONS = {"easy": "Fewer dead, more loot, gentler hits, longer fuse.",
              "normal": "The intended experience.",
              "hard": "More dead, scarce loot, brutal hits, a short fuse."}


def new_game_menu(ui: UI, cfg: Optional[GameConfig] = None) -> Optional[GameConfig]:
    cfg = cfg or GameConfig()
    idx = 0
    s = ui.s
    while True:
        s.erase()
        h, w = s.getmaxyx()
        ui.put(0, 2, "NEW GAME", "yellow", True)
        for i, f in enumerate(FIELDS):
            on = i == idx
            label = f"{LABELS[f]:<12}"
            value = _label(cfg, f)
            arrows = "< " + value + " >" if f not in ("start",) and f != "seed" else value
            ui.put(2 + i * 1 + (1 if f == "start" else 0), 2, ("> " if on else "  ") + label + arrows,
                   "green" if f == "start" else "white", on)
        y = 2 + len(FIELDS) + 2
        for line in textwrap.wrap(_blurb(cfg, FIELDS[idx]), max(20, w - 6)):
            ui.put(y, 3, line, "cyan")
            y += 1
        ui.put(h - 1, 2, "Up/Down: select   Left/Right: change   Enter: confirm   Esc: back", "grey")
        s.refresh()
        key = s.getch()
        f = FIELDS[idx]
        if key == ESC:
            return None
        if key in (curses.KEY_UP, ord("k")):
            idx = (idx - 1) % len(FIELDS)
        elif key in (curses.KEY_DOWN, ord("j")):
            idx = (idx + 1) % len(FIELDS)
        elif key in (curses.KEY_LEFT, curses.KEY_RIGHT, ord("h"), ord("l"), ord(" ")):
            step = -1 if key in (curses.KEY_LEFT, ord("h")) else 1
            _change(cfg, f, step)
        elif key in ENTER:
            if f == "start":
                return cfg
            if f == "randomize":
                for rf in RANDOMIZABLE:
                    setattr(cfg, rf, "random")
            elif f == "seed":
                cfg.seed = random.randrange(1 << 30) if cfg.seed is None else None
            else:
                _change(cfg, f, 1)


def _change(cfg: GameConfig, field: str, step: int) -> None:
    if field in ("needs", "permadeath"):
        setattr(cfg, field, not getattr(cfg, field))
    elif field == "seed":
        cfg.seed = (cfg.seed + step) if cfg.seed is not None else random.randrange(1 << 30)
    elif field not in ("start", "randomize"):
        opts = _options(cfg, field)
        cur = getattr(cfg, field)
        setattr(cfg, field, opts[(opts.index(cur) + step) % len(opts)])


def title_screen(ui: UI) -> str:
    """Returns 'continue', 'new' or 'quit'."""
    s = ui.s
    has_save = savemod.exists()
    options = (["Continue"] if has_save else []) + ["New game", "Records", "How to play", "Quit"]
    idx = 0
    while True:
        s.erase()
        h, w = s.getmaxyx()
        y = max(1, h // 2 - 8)
        for i, line in enumerate(TITLE.strip("\n").split("\n")):
            ui.put(y + i, max(0, (w - 52) // 2), line, "red", True)
        ui.put(y + 6, max(0, (w - 46) // 2), "a zombie survival roguelike - any era, any plague", "grey")
        for i, o in enumerate(options):
            ui.put(y + 9 + i, w // 2 - 8, ("> " if i == idx else "  ") + o, "white", i == idx)
        s.refresh()
        key = s.getch()
        if key in (curses.KEY_UP, ord("k")):
            idx = (idx - 1) % len(options)
        elif key in (curses.KEY_DOWN, ord("j")):
            idx = (idx + 1) % len(options)
        elif key in ENTER:
            choice = options[idx]
            if choice == "How to play":
                ui.text_screen("How to play", HELP)
            elif choice == "Records":
                ui.text_screen("Records", "\n".join(records.summary()))
            else:
                return {"Continue": "continue", "New game": "new", "Quit": "quit"}[choice]
        elif key in (ord("q"), ESC):
            return "quit"
