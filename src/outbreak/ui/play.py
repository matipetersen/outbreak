"""Glue between the CLI, the title screen and the curses UI."""
from __future__ import annotations

import curses

from outbreak.config import GameConfig
from outbreak.engine import save as savemod
from outbreak.engine.game import Game
from outbreak.ui.curses_ui import UI
from outbreak.ui.menus import new_game_menu, title_screen


def play(cfg: GameConfig, args) -> int:
    def main(stdscr) -> None:
        ui = UI(stdscr, None)
        game = None
        fresh = False
        if args.resume:
            game = _try_load(ui)
        elif args.new:
            game = Game(cfg)
            fresh = True
        while game is None:
            choice = title_screen(ui)
            if choice == "quit":
                return
            if choice == "continue":
                game = _try_load(ui)
            else:
                chosen = new_game_menu(ui, cfg)
                if chosen is not None:
                    game = Game(chosen)
                    fresh = True
        ui.g = game
        if fresh:
            ui.briefing()
        game.autosave_path = savemod.default_path()
        ui.run()

    try:
        curses.wrapper(main)
    except KeyboardInterrupt:
        pass
    return 0


def _try_load(ui: UI):
    try:
        return savemod.load()
    except savemod.SaveError as exc:
        ui.message(str(exc))
        return None
