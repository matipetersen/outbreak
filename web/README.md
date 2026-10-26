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
the order or the moment you visit chunks (a test checks both). Every chunk owns its left column and top row as a highway (a bridge over water), so the world is connected by construction;
buildings never straddle a chunk and lanes lead from each building to the nearest highway. The start takes tens of milliseconds
even at 600x400. A save stores only the chunks you painted; the rest regenerates from the seed when you get there. Saves
from before this change still load (they keep their fixed 120x76 map).

## Real time in the hardcore modes (web only)

`normal` is turn-based. In hardcore (`living`) the world runs **live**: there
are no turns. A tick happens every `tick_ms` (700 ms by default), whatever you do.
An action takes effect at once and keeps you busy for the ticks it costs (a step is one tick, searching a crate two, forcing
a lock six), and the latest input you make while busy is queued and runs as soon as you are free. Menus, the bag and
the map do not stop the clock, and neither do events. Resting and sleeping are modes that pass in real time and stop
when something appears. A new survivor gets about 40 ticks of grace. You can pause (Settings).
While the page is away (a hidden tab, a closed phone) the world does not run: at most three seconds' worth of ticks are
played when you come back. The Python/terminal game is still turn-based in every mode.

## Dash and Endless are different here (web only)

`src/front.js` turns Dash into a pursuit: a tide of the dead rolls up the road behind you instead of a calendar, and the
finish is boarding a transport that is already loading, not a siege. `src/factions.js` and `src/saga.js` give the endless
world phases, factions that hold buildings as outposts, world events, people who live and work in your base, projects,
and three endings (cure, exodus, sanctuary). Both patch the scenario text exported from Python at load time, so the
terminal game keeps the old Dash and Endless. Everything is in the save (`front`, `saga`); older saves get a tide or a
city when they load. Tests: `test/tide.test.js`, `test/saga.test.js`.

## Battle: squads against the dead (web only)

A separate mode on the title screen (**Battle**), with its own setup and save (`outbreak.battle.v1`). It is WEGO: every
turn you give orders to four squads while nothing moves, then **EXECUTE** plays ten seconds of battle that you watch but
cannot change (x1, x2, x4 or skip). Engine: `src/battle.js` (pure, deterministic: the whole state, random stream included,
is plain JSON, so a saved battle goes on exactly as it would have). Front-end: `src/battle_ui.js`. Tests: `test/battle.test.js`.

* **Objectives**: *Hold the refuge* (ten turns from dusk into the dark; the dead inside wear it down; squads inside at the
  end of a turn restock ammunition) and *Bring them out* (survivors barricaded in a house to the north come out to the
  first squad at their door and follow it; bring at least half to the south edge in ten turns).
* **Your company** is bought on the setup screen from 13 points, one to five squads: riflemen (or the era's line) 3,
  shield squad 3, heavy weapon 4, scouts 2. Each objective offers a standard company to start from; the choice is kept for
  the next battle and stored in the save. The first squads take the posts nearest the danger.
* **Orders**: tap a squad (or its card), then tap a tile or drag a route; *Fire at will* / *Hold fire*; *Walk* / *Run*
  (nobody shoots while running); one special action: shield squads build a barricade (four quiet seconds, four per
  battle), scouts throw a lure that calls the dead for two turns. Orders carry over between turns.
* **Squads** come from the era (longbowmen and Greek fire in 1348, M16s and an M60 in 1986, pulse rifles in the station).
  Every shot is noise and noise brings the dead; accuracy falls with range; in the dark you see and shoot five tiles.
  Morale falls with losses and when the dead swarm a squad; a broken squad runs for safety until it rallies.
* **The dead** come from the zombie preset: speed, sight, hearing, smell, how a bite spreads and how fast it turns a man,
  head-shot-only killing, the dead rising, fences that only the swarm climbs, the sun-shy dead that hide in buildings by
  day and burn in the open, spores in closed rooms, mutations that get worse each turn, and the specials (brutes break
  barricades, screamers call the horde, bloaters burst, leapers pounce, clickers hunt by sound).
* **What you see while planning**: the next wave and where it comes in (red marks on the edge), and a red arrow on every
  zombie you can see, pointing where it is going.

## Touch controls

* **Pad** (bottom left): hold to keep moving. The centre dot waits; hold it to rest.
* **Tap a tile** to walk there, enemies in view or not; you stop when you arrive, when you are hurt, or when you tap again. Something in the way gets walked around. Tap an enemy out of reach to walk up to it. Tap an adjacent enemy to hit it, a far enemy to
  shoot it (ranged weapon equipped). Long-press a tile to see what it is. Pinch to zoom.
* **ACT** changes with context: pick up, search, talk, sleep, unlock, rest.
* **FIRE**, **BAG**, **MENU**. The menu holds craft, documents, skills, places, throw, sneak, run, light, settings.
* A red **CUT IT OFF** button appears when an arm or leg bite can still be amputated.
* Settings: left-handed layout, zoom, tap-to-travel, vibration.
* **Apple Pencil**: once the pen has touched the screen, a palm resting on it is ignored (no stray taps, presses or pinch zoom) while the pen is down and for a moment after.

The run autosaves to the browser's local storage (every 100 turns, when the page is hidden, and from the
menu). If the browser blocks storage the game tells you and plays without saving.

## GitHub Pages (play from your phone)

`.github/workflows/pages.yml` builds the game, runs the engine tests and publishes `web/_site` (made by `web/pages.py`:
`index.html`, a real web manifest, icons and a service worker) on every push to `main`. One-time setup: repo
**Settings -> Pages -> Source: GitHub Actions**. Then open `https://<user>.github.io/outbreak/` on the phone and use
"Add to Home Screen" for a fullscreen, offline app. Saves live in that browser's local storage.
