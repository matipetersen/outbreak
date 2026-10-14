"""Tile table.  Tiles are small ints so a level is a grid of bytearrays."""
from __future__ import annotations

from typing import NamedTuple


class TileInfo(NamedTuple):
    glyph: str
    walk: bool          # can be stepped on (closed doors count: bumping opens them)
    opaque: bool
    name: str
    color: str
    masks_scent: bool = False


(FLOOR, GRASS, ROAD, BRUSH, TREE, WATER, SHALLOW, RUBBLE, WALL, DOOR, DOOR_OPEN, LOCKED, STAIRS_UP,
 STAIRS_DOWN, CRATE, CRATE_OPEN, PORTAL, FENCE, BED, BENCH, CAMPFIRE, WORKSHOP, LOCKER) = range(23)

TILES = {
    FLOOR: TileInfo(".", True, False, "floor", "grey"),
    GRASS: TileInfo(",", True, False, "grass", "green"),
    ROAD: TileInfo(":", True, False, "road", "grey"),
    BRUSH: TileInfo('"', True, True, "thick brush", "green"),
    TREE: TileInfo("T", False, True, "tree", "green"),
    WATER: TileInfo("~", False, False, "deep water", "blue"),
    SHALLOW: TileInfo("-", True, False, "shallows", "cyan", masks_scent=True),
    RUBBLE: TileInfo("%", False, False, "rubble", "grey"),
    WALL: TileInfo("#", False, True, "wall", "white"),
    DOOR: TileInfo("+", True, True, "closed door", "yellow"),
    DOOR_OPEN: TileInfo("'", True, False, "open door", "yellow"),
    LOCKED: TileInfo("+", False, True, "locked door", "red"),
    STAIRS_UP: TileInfo("<", True, False, "stairs up", "white"),
    STAIRS_DOWN: TileInfo(">", True, False, "stairs down", "white"),
    CRATE: TileInfo("&", False, False, "crate", "yellow"),
    CRATE_OPEN: TileInfo("o", False, False, "empty crate", "grey"),
    PORTAL: TileInfo("H", True, False, "entrance", "white"),
    FENCE: TileInfo("=", False, False, "fence", "grey"),
    BED: TileInfo("b", False, False, "bed", "cyan"),
    BENCH: TileInfo("w", False, False, "workbench", "cyan"),
    CAMPFIRE: TileInfo("*", False, False, "campfire", "red"),
    WORKSHOP: TileInfo("W", False, False, "workshop", "cyan"),
    LOCKER: TileInfo("L", False, False, "locker", "yellow"),
}

# Precomputed lookups for the hot paths.
WALK = [False] * 256
OPAQUE = [False] * 256
for _id, _t in TILES.items():
    WALK[_id] = _t.walk
    OPAQUE[_id] = _t.opaque
