"""Command line entry point."""
from __future__ import annotations

import argparse
import sys
from typing import List, Optional

from outbreak import content
from outbreak.config import DIFFICULTIES, MODES, RANDOMIZABLE, GameConfig


def build_parser() -> argparse.ArgumentParser:
    p = argparse.ArgumentParser(prog="outbreak", description="OUTBREAK - a zombie survival roguelike.")
    p.add_argument("--era", choices=["random"] + sorted(content.ERAS), help="technology level / when the collapse happens")
    p.add_argument("--zombies", choices=["random"] + sorted(content.PRESETS), help="what kind of dead")
    p.add_argument("--scenario", choices=["random"] + sorted(content.SCENARIOS), help="your objective")
    p.add_argument("--origin", choices=["random"] + sorted(content.ORIGINS), help="who you are")
    p.add_argument("--opening", choices=["random"] + sorted(content.OPENINGS), help="how the story starts")
    p.add_argument("--mode", choices=["random"] + list(MODES), help="normal: one life; living: the world goes on after you")
    p.add_argument("--difficulty", choices=sorted(DIFFICULTIES))
    p.add_argument("--random", action="store_true", help="draw era, zombies, scenario, origin and mode at random")
    p.add_argument("--seed", type=int, help="world seed (same seed, same world)")
    p.add_argument("--needs", action="store_true", help="enable hunger")
    p.add_argument("--no-permadeath", action="store_true", help="keep the save after dying")
    p.add_argument("--new", action="store_true", help="skip the title screen and start a game with these options")
    p.add_argument("--continue", dest="resume", action="store_true", help="load the autosave straight away")
    p.add_argument("--list", action="store_true", help="list eras, zombie presets, scenarios and origins")
    p.add_argument("--bot", type=int, metavar="TURNS", help="headless: let a simple bot play TURNS turns and report")
    p.add_argument("--show", action="store_true", help="headless: print the opening view and exit")
    return p


def describe_options() -> str:
    lines = ["ERAS"]
    lines += [f"  {e.id:<9} {e.name}: {e.blurb}" for e in content.ERAS.values()]
    lines += ["", "ZOMBIE PRESETS (--zombies)"]
    lines += [f"  {z.id:<9} {z.name} [{z.inspired_by}]" for z in content.PRESETS.values()]
    lines += ["", "SCENARIOS (--scenario)"]
    lines += [f"  {s.id:<11} {s.name}" for s in content.SCENARIOS.values()]
    lines += ["", "ORIGINS (--origin)"]
    lines += [f"  {o.id:<8} {o.blurb}" for o in content.ORIGINS.values()]
    lines += ["", "OPENINGS (--opening)"]
    lines += [f"  {o.id:<8} {o.name}: {o.perk}" for o in content.OPENINGS.values()]
    return "\n".join(lines)


def config_from_args(args) -> GameConfig:
    cfg = GameConfig()
    for field in ("era", "zombies", "scenario", "origin", "opening", "mode", "difficulty", "seed"):
        value = getattr(args, field)
        if value is not None:
            setattr(cfg, field, value)
    if args.random:
        for f in RANDOMIZABLE:
            setattr(cfg, f, "random")
    cfg.needs = bool(args.needs)
    cfg.permadeath = not args.no_permadeath
    return cfg


def run_bot(cfg: GameConfig, turns: int) -> int:
    from outbreak.bot import play
    from outbreak.engine.game import Game
    game = play(Game(cfg), turns)
    p = game.player
    status = game.over.title if game.over else "still alive"
    print(f"{game.cfg.era}/{game.cfg.zombies}/{game.cfg.scenario} seed={game.seed}: {status} at {game.clock.stamp()} "
          f"(level {p.level}, {p.kills} kills, humanity {p.humanity})")
    return 0


def main(argv: Optional[List[str]] = None) -> int:
    args = build_parser().parse_args(argv)
    if args.list:
        print(describe_options())
        return 0
    cfg = config_from_args(args)
    try:
        cfg.resolve().validate()
    except (KeyError, ValueError) as exc:
        print(f"error: {exc}", file=sys.stderr)
        return 2
    if args.bot:
        return run_bot(cfg, args.bot)
    if args.show:
        from outbreak.engine.game import Game
        from outbreak.ui import render
        print(render.build_view(Game(cfg), 70, 24, 8, 100).to_text())
        return 0
    from outbreak.ui.play import play
    return play(cfg, args)
