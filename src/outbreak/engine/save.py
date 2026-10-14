"""Saving and loading.  A save is a pickle of the Game behind a small header.

Pickle is not safe against untrusted files; saves are your own, in your own
data directory.  The header lets us refuse a save from an incompatible version.
"""
from __future__ import annotations

import os
import pickle
import tempfile
from pathlib import Path
from typing import Optional

SAVE_VERSION = 1
MAGIC = b"OUTBREAKSAVE"


class SaveError(Exception):
    pass


def data_dir() -> Path:
    base = os.environ.get("OUTBREAK_HOME")
    if base:
        return Path(base)
    xdg = os.environ.get("XDG_DATA_HOME") or os.path.join(os.path.expanduser("~"), ".local", "share")
    return Path(xdg) / "outbreak"


def default_path() -> Path:
    return data_dir() / "autosave.sav"


def save(game, path: Optional[Path] = None) -> Path:
    path = Path(path) if path else default_path()
    path.parent.mkdir(parents=True, exist_ok=True)
    payload = pickle.dumps((SAVE_VERSION, game), protocol=pickle.HIGHEST_PROTOCOL)
    fd, tmp = tempfile.mkstemp(dir=path.parent, prefix=".save-")
    try:
        with os.fdopen(fd, "wb") as fh:
            fh.write(MAGIC + payload)
        os.replace(tmp, path)                      # atomic: a crash never leaves half a save
    except BaseException:
        if os.path.exists(tmp):
            os.unlink(tmp)
        raise
    return path


def load(path: Optional[Path] = None):
    path = Path(path) if path else default_path()
    try:
        raw = path.read_bytes()
    except FileNotFoundError:
        raise SaveError(f"no save at {path}") from None
    if not raw.startswith(MAGIC):
        raise SaveError("not an OUTBREAK save file")
    try:
        version, game = pickle.loads(raw[len(MAGIC):])
    except Exception as exc:                       # corrupt or from another build
        raise SaveError(f"could not read save: {exc}") from exc
    if version != SAVE_VERSION:
        raise SaveError(f"save version {version} is not supported (expected {SAVE_VERSION})")
    return game


def delete(path: Optional[Path] = None) -> None:
    path = Path(path) if path else default_path()
    try:
        path.unlink()
    except FileNotFoundError:
        pass


def exists(path: Optional[Path] = None) -> bool:
    return (Path(path) if path else default_path()).exists()
