"""The hall of records: how far each finished run got, kept between games.

The engine stays pure; this module is the only place that touches the disk for it.  A run is scored by days survived
first (that is what an endless world is about) and points second, and compared only with runs of the same objective
and mode: ten days of a dash are not ten days of an endless world.
"""
from __future__ import annotations

import json
import time
from pathlib import Path
from typing import Dict, List, Optional

from outbreak.engine import save as savemod

KEEP = 200


def path() -> Path:
    return savemod.data_dir() / "records.json"


def load(p: Optional[Path] = None) -> List[Dict]:
    try:
        data = json.loads(Path(p or path()).read_text())
        return [r for r in data if isinstance(r, dict)] if isinstance(data, list) else []
    except (OSError, ValueError):
        return []


def _store(runs: List[Dict], p: Optional[Path] = None) -> None:
    target = Path(p or path())
    try:
        target.parent.mkdir(parents=True, exist_ok=True)
        target.write_text(json.dumps(runs[-KEEP:]))
    except OSError:
        pass                                                   # a read-only home must not break the ending


def entry_of(game) -> Dict:
    e, c, p = game.over, game.cfg, game.player
    return {"scenario": c.scenario, "mode": c.mode, "era": c.era, "zombies": c.zombies, "kind": e.kind, "title": e.title,
            "days": game.clock.day, "score": e.score, "kills": p.kills, "level": p.level, "when": int(time.time())}


def _key(r: Dict):
    return (r["days"], r["score"])


def submit(game, p: Optional[Path] = None) -> List[str]:
    """Record the finished run; return the lines the end screen shows about it."""
    run = entry_of(game)
    runs = load(p)
    same = [r for r in runs if r.get("scenario") == run["scenario"] and r.get("mode") == run["mode"]]
    best = max(same, key=_key) if same else None
    rank = 1 + sum(1 for r in same if _key(r) > _key(run))
    runs.append(run)
    _store(runs, p)
    name = f"{run['scenario']} / {'hardcore' if run['mode'] == 'living' else run['mode']}"
    if best is None:
        return [f"First recorded run of {name}."]
    if _key(run) > _key(best):
        return [f"NEW RECORD for {name}: {run['days']} days, {run['score']} points (before: {best['days']} days, {best['score']})."]
    return [f"Record for {name}: {best['days']} days, {best['score']} points. This run ranks #{rank} of {len(same) + 1}."]


def summary(runs: Optional[List[Dict]] = None) -> List[str]:
    """The records screen: the best run of each objective and mode, then the latest runs."""
    runs = load() if runs is None else runs
    if not runs:
        return ["No finished runs yet. Your records appear here when a run ends."]
    out = ["BEST OF EACH"]
    groups: Dict[tuple, Dict] = {}
    for r in runs:
        k = (r.get("scenario"), r.get("mode"))
        if k not in groups or _key(r) > _key(groups[k]):
            groups[k] = r
    for (sc, mode), r in sorted(groups.items()):
        out.append(f"  {sc:<10} {'hardcore' if mode == 'living' else mode:<9} {r['days']:>3} days  {r['score']:>5} pts  "
                   f"L{r['level']}  {r['kills']} kills  {r['title']}")
    out += ["", "LATEST"]
    for r in reversed(runs[-10:]):
        out.append(f"  {time.strftime('%Y-%m-%d', time.localtime(r['when']))}  {r['scenario']:<10} {r['days']:>3} days  "
                   f"{r['score']:>5} pts  {r['title']}")
    return out
