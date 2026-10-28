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
  end of a turn restock ammunition) and *Bring them out* (seven survivors hide in three houses across the north, two or three in each, so no single trip saves
  enough: bring at least four to the EXIT, one six-tile stretch of the south edge, in ten turns. A squad at a door brings that
  house out, and the noise of the barricade coming down draws the dead nearby and sends more down from the north after them.
  Survivors are slow and their escort waits for them; near the EXIT they run the last stretch, and an escort inside it brings
  out everyone close. Each is tethered to its escort on the map; each house shows how many are still inside) and *Take the town*
  (twelve turns: four buildings marked A to D, each infested; a base is yours after four seconds with your men inside and
  nobody else, living or dead; bases you hold restock ammunition. A rival faction of the era comes from the north for the
  same bases and shoots at you and at the dead: raiders, the military (with a machine gun) or a cult that does not break;
  four squads on normal, three on easy, five on hard. Wipe them out and a column of reinforcements, announced the turn
  before with an amber band on the north edge, arrives one squad bigger each time: one column on easy, two on normal, three
  on hard. Holding every base through a whole turn wins early, for you only once they have nobody left to send; otherwise
  whoever holds more at the end). The map labels what matters: REFUGE, SURVIVORS, EXIT and the bases, coloured
  by owner.
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
* **Windows**: buildings have them (not the survivors' boarded-up house; the refuge's are shuttered and stronger). Sight and
  shots go through, people do not; someone inside behind one is hard to hit. The dead smash them in, and a broken window
  can be climbed through or barricaded.
* **Sneak** (a third pace with Walk and Run): half speed, and nobody notices the squad until it is close or opens fire
  (then for two seconds). Fire from hiding at a zombie that has noticed no one gets more head shots; in close combat
  such a zombie goes down quietly (triple damage). A rival squad shot from behind (its chevron shows where it looks) or
  from hiding loses morale more than three times as fast, and a squad standing still turns to face whoever shoots it.
* **Face**: tap the side a squad should watch (a squad on the move turns that way when it arrives); an arrow at each of
  your squads shows it. **The rivals play the same game**: they act only on what their men can see; their lookouts always
  sneak, and when they spot your men holding a base they want, one squad (two if they have three or more) sneaks round
  behind them, holding its fire until it is close.
* **Snipers**: scouts that stay still for two seconds in brush or inside a building are set up: longer range, better aim,
  and nobody (the dead or the rivals) notices them until close. Moving gives them away.
* **What you see while planning**: the next wave and where it comes in (red marks on the edge), and a red arrow on every
  zombie you can see, pointing where it is going.

## Campaign: Zona Norte (web only)

**Campaña: Zona Norte** on the title screen: the northern suburbs of Buenos Aires in 2026, fought with the Battle mode. Its
screens, events and names are in Rioplatense Spanish (the battle screen itself stays in English, like the rest of the game).
Every district's clear/assault/defence battles are fought on a drawn map of it (`layout` in `CP_ZONES`, painted by
`bt_paint_layout`): the river where it is, the avenues, the rail lines, parks, and only its four places as the buildings
A to D (Puerto de Olivos and Estación Maipú with the Tren de la Costa in Olivos, the cathedral and the Hipódromo above the
barrancas in San Isidro, Tigre split by its river with one bridge, the Ford plant in Pacheco...). Hordes and rescues use
the generated maps.
Engine: `src/campaign.js` (pure and deterministic like a battle, saved under `outbreak.campaign.v1`); front-end:
`src/campaign_ui.js`; tests: `test/campaign.test.js`.

* **The map**: fourteen districts linked as their real neighbours are (Olivos, Florida, Villa Martelli, Munro, Martínez,
  San Isidro, Boulogne, San Fernando, Tigre, General Pacheco, Campo de Mayo, Nordelta, Escobar, Pilar), the river and the
  Delta to the east. You start in Florida with four squads named for barrios of Vicente López. Los Segadores hold Boulogne and
  General Pacheco on the Panamericana, los Milicos (the Fuerza de Tareas Conjunta) Campo de Mayo and Pilar, los Renacidos the
  cathedral in San Isidro; los del Unicenter in Martínez trade, and join you once their goodwill reaches four.
* **A day**: one operation on a district next to yours, fought as a battle with the district's own places as its buildings:
  *clear* it of the dead (Take the town with no rivals), *assault* a faction (their company and their reinforcements grow with
  the districts they hold), *rescue* survivors who signalled, *defend* a district under threat (a night Hold against a horde,
  or a defence starting inside your buildings against a faction), or *rest*. Abandoning a threatened district, trading with
  the Unicenter folk and refitting do not take the day.
* **The company persists**: the men a squad loses stay lost. Recruits fill the gaps; a new squad costs a recruit a man and
  supplies; machine-gun teams need the armoury at Campo de Mayo. Pacheco (the Ford plant) is a depot, San Fernando's hospital
  gives recruits.
* **The night**: districts pay, the dead spread from the worst districts (and can overrun a faction's), the factions take
  empty districts or mass against yours; a threat nobody answers is a district lost. Then an encounter asks you to decide:
  refugees off the Mitre tracks, a Task Force truce for one of your districts, the Reapers' toll on the Panamericana, the
  Reborn's preachers, medicine for the Unicenter, a horde coming down Libertador that you can meet, block or lead into a
  rival's district, a signal from a rooftop, deserters, a police armoury. Each choice moves something on the map.
* **Hard from the first night** (`CP_DIFF`; normal is meant to be hard, easy is the gentler first version): a horde comes for
  Florida the first night; every battle costs two supplies (without them, half ammunition); you start with six supplies and
  two recruits; districts away from Florida start more infested and the empty ones get worse every five days; clearing a
  district is a real fight (bigger waves from three sides, more dead inside); factions field an extra squad and come back
  after a day. Losing a defence of Florida does not end it: home is sacked (half the supplies and recruits) and scarred (one
  level of the dead; a rest day cleans one).
* **The end**: eight districts, or five once the Segadores, the Milicos and the Renacidos hold nothing, wins. Florida
  overrun (three scars), or the whole company gone with fewer than four recruits to raise another, loses.

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
