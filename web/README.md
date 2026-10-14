# OUTBREAK for phones and browsers

`dist/outbreak.html` is the whole game in one file: no install, no network needed once the page is open
(the three web fonts are optional and fall back to system fonts). Open it in any modern mobile browser.

```
python3 web/build.py          # builds dist/outbreak.html (and dist/outbreak.fragment.html)
node web/test/run_all.js      # engine tests: world, interiors, full playthroughs, rules, save/load
```

## How it relates to the terminal game

The JavaScript engine in `src/*.js` is a port of the Python engine in `src/outbreak/engine`, with the same
function and field names so the two stay easy to compare. Game data (eras, zombie presets, scenarios, items,
perks, recipes, moral encounters, endings) is **exported from the Python packs by `build.py`**, so adding an era
or a zombie preset in Python shows up here after a rebuild. The two engines use different random number
generators, so the same seed does not give the same world in both.

The story briefing (three pages) opens when a new game starts; the menu has a **Briefing** tile to read it again.
The new-game screen has a *How it starts* choice (or *Surprise me*).

## The map: planned whole, painted by chunks (web only)

The web game's world is 360x240 by default (about 9 times the old 120x76; any size up to a few hundred tiles a side works),
planned in full at the start and painted lazily. Terrain is a pure function of `(seed, x, y)`, so the planner can place
every building, camp, the refuge and the extraction point up front (the quest needs to know where they are). Tiles,
zombies, raiders, camps and patrols are painted per 48x48 chunk the first time you get within 56 tiles of it, from a random
stream derived from `(seed, chunk)` alone and with uids from a range reserved for that chunk. So the result never depends on
the order or the moment you visit chunks (a test checks both), which is what lets everyone in the shared world find the same
world. Every chunk owns its left column and top row as a highway (a bridge over water), so the world is connected by construction;
buildings never straddle a chunk and lanes lead from each building to the nearest highway. The start takes tens of milliseconds
even at 600x400. A save stores only the chunks you painted; the rest regenerates from the seed when you get there. Saves
from before this change still load (they keep their fixed 120x76 map).

## Real time in the hardcore modes (web only)

`normal` is turn-based. In the hardcore modes (private `living` and the shared world) the world runs **live**: there
are no turns. A tick happens every `tick_ms` (700 ms by default; the keeper sets it for the shared world), whatever you do.
An action takes effect at once and keeps you busy for the ticks it costs (a step is one tick, searching a crate two, forcing
a lock six), and the latest input you make while busy is queued and runs as soon as you are free. Menus, the bag and
the map do not stop the clock, and neither do events. Resting and sleeping are modes that pass in real time and stop
when something appears. A new survivor gets about 40 ticks of grace. In the private mode you can pause (Settings); in
the shared world nothing can pause, and the clock is anchored to the season start, so every player shares the same sun.
If the page was away for a long time (a hidden tab, a closed phone), the world jumps to the present instead of playing every
tick, and nothing hurts you while you are gone. The Python/terminal game is still turn-based in every mode.

## Shared world (web only)

The title screen has **Shared world**: one hardcore world for everyone who opens the published page. It needs the
artifact database (`db`) and the viewer's identity (`user`), so it only works from the published artifact with
sharing on. People who can only view it can read the world but not play; players need contributor access. The owner
(or any editor) is the **keeper**: they create the world, choose era, dead, goal, difficulty, season length and
how long a game day lasts in real time, and reset it whenever they want. Resetting ends the season for everyone,
clears the ledger and picks a new seed.

What is shared, and what is not. Every browser runs its own copy of the same seeded world (identical map,
buildings, and starting population whoever you are). The facts below go through the database:
* the **calendar**: a game day is `dayMs` of real time, so enemy level caps, zombie phases and the extraction
  deadline move on while nobody plays; each seeded enemy catches up its levels deterministically on the same schedule;
* **tombs**: your gear stays where you fell for anyone to loot (components included); looted once, gone for all;
* **named enemies**: the thing that killed you, and your risen body, keep a name and a level for everyone until
  somebody kills them;
* **kills**: ordinary enemies of the seeded population stay dead for everyone;
* **vault components** can only be taken once; the **outcome** (cure made, way out closed) closes the season;
* the **hall** of the fallen.

Not shared: where other players are right now, or what each browser's roaming hordes and wanderers do. This is a
shared ledger on top of identical seeded worlds, not a live server simulation. Tests run against an in-memory fake
of the database (`test/fakedb.js`); the real database was only exercised by publishing the page.

## Touch controls

* **Pad** (bottom left): hold to keep moving. The centre dot waits; hold it to rest.
* **Tap a tile** to walk there; you stop when an enemy appears. Tap an adjacent enemy to hit it, a far enemy to
  shoot it (ranged weapon equipped). Long-press a tile to see what it is. Pinch to zoom.
* **ACT** changes with context: pick up, search, talk, sleep, unlock, rest.
* **FIRE**, **BAG**, **MENU**. The menu holds craft, documents, skills, places, throw, sneak, run, light, settings.
* A red **CUT IT OFF** button appears when an arm or leg bite can still be amputated.
* Settings: left-handed layout, zoom, tap-to-travel, vibration.

The run autosaves to the browser's local storage (every 100 turns, when the page is hidden, and from the
menu). If the browser blocks storage the game tells you and plays without saving.
