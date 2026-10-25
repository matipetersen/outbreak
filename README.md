# OUTBREAK

A zombie survival roguelike for the terminal. You choose **when** the collapse happens (the era),
**what** the dead are (the zombie type) and **what you are trying to do** (the scenario).

It is a standalone game: it shares nothing with the Jedi Fugitive game in the parent directory
except the repository. Pure Python, standard library only (curses).

```
python3 play.py                      # title screen -> new game form
python3 play.py --new --era medieval --zombies swarm --scenario extraction --seed 7
python3 play.py --continue           # resume the autosave
python3 play.py --list               # every era, zombie preset, scenario and origin
```
On Windows install `windows-curses` first (`pip install windows-curses`). Needs a terminal of at least 80x24.

## The three choices

**Era** (what you have): Medieval 1348, 1986, Modern, Far-future station. Each is a data pack: its own
weapons, armour, lights, place names, factions, medicines, and the vocabulary of the cipher you learn to read.
No guns in 1348; bows are quiet, mail is heavy. In 2026 a shot is loud and ammunition is the real currency.

**The dead** (what hunts you) are built from parameters, not hard-coded classes:
speed, senses, how the infection spreads, intelligence, decay over the days, and how you kill them.

| preset | feel | inspired by |
|---|---|---|
| `classic` | slow, noise-driven, head shots only; everyone who dies rises | Romero |
| `rot` | slow, track your scent, rot over weeks; people are the real danger | The Walking Dead |
| `rage` | sprinters, near-instant infection, they starve after a few weeks | 28 Days Later |
| `spore` | spore clouds in closed rooms (carry filters), blind brutes hunt by sound | The Last of Us |
| `bio` | the longer it spreads the worse the mutations; a hunter that never stops | Resident Evil |
| `swarm` | frail but huge hordes that pile over fences; go quiet or die | World War Z |
| `night` | clever pack hunters that burn in sunlight; deadly by night and indoors | I Am Legend |

**Scenario** (your goal):
* `cure` - you start bitten with a slow strain. Find three components in locked vaults, decipher the formula,
  and synthesise a cure at the refuge before the fever turns you.
* `extraction` - gather three parts, reach the extraction point before the way out closes and hold out until the pickup.
  The deadline is computed from the route (the farther the parts and the extraction point are, the longer you get: about 96
  tiles of real progress a day, plus time for every vault), never less than 10 days.
* `dash` - no parts, only the road: get to the extraction point before the way closes and hold out. A shorter, more
  physical run, with five incidents on the way. **In the web game Dash is a different mode**: no calendar and no siege, a
  tide of the dead rolling up the road behind you, and a transport you have to board before it leaves (see *Dash: the tide*
  below).
* `endless` - no exit and no clock. Live as long as you can, or gather the three components and the formula
  and make the cure at the refuge, which ends it with a win. Nobody starts bitten. Every day past the third the
  world gets worse, without limit: the dead get +6% a day of health and damage (up to x3), hordes and ambient
  spawns grow with it, and in hardcore the enemy level cap rises with the calendar (up to 40, not 15). To keep
  a long life possible, vaults and containers you emptied refill (about half of them) every 4 days. Dying
  is a survival result ("Survived 23 days") with a bigger score per day. Combined with `living` it is the eternal
  hardcore world. **In the web game the endless world has phases, factions with outposts, world events, people living in
  your base and three endings of its own** (see *The endless world* below); the curve is gentler there (+3.5% a day, up to
  x2.4) because the danger comes from what the world does, not from bigger numbers.

On the road to the extraction point (`extraction` and `dash`) things happen: wrecked convoys, an abandoned checkpoint, a
bridge that is out, a column of refugees, an ambush, the dead crossing the road. Each is placed on the route when the world
is created and fires once when you get close. Choices cost items, health, humanity or time; time lost does not simulate the world
(nothing hunts you while you lose it) but counts against the deadline.

All three end with a hold-out finale. Who shows up depends on your **humanity**: the Alpha if you stayed human,
armed people who have heard about you if you did not.

**News needs a source (web only).** In endless you only hear about what your character could know: places you have seen,
been told of by someone (what an NPC tells you goes on your map), or that are close enough to hear (25 tiles); factions only
once you have seen one of their buildings or talked to one of them. A radio (the base project) hears the whole city.
Public broadcasts (a supply drop, a firebreak warning, the blood moon, the weather) still reach everyone. What happens at
your base while you are away (the morning report, a raid) is told when you walk back in. And people speak of time by the
calendar: lines written for weeks into the collapse ("they stripped us of rank on day three", "a radio that stopped talking
weeks ago") follow the game day until enough time has passed.

**Horses (web only).** Small herds of wild horses (striders on the station) graze on open ground away from the city:
about one chunk in three that has some, never in the woods or within 25 tiles of the start. They notice you from 6 tiles
(3 creeping) and bolt like deer. Get next to one (tap it or ACT) and offer food: 30%, +20% creeping, +15% with wild greens,
+10% if you are decent; a refusal sends it running. Tamed, it follows you or waits, heals slowly and shies from the dead.
To ride you need a **saddle** (Craft: 3 cloth, 1 wood, 1 scrap). On horseback you cover two tiles a turn, three at a gallop
(RUN), spend no stamina and cannot creep, but hooves are loud (noise 6, 10 at a gallop). You cannot ride indoors: going
through a door leaves it tied outside. 45% of the blows aimed at the rider land on the horse; under 35% health it may throw
you (4 damage) and bolt, and if it dies you are thrown and it is lost. Tap the horse chip for its sheet. (`web/src/mounts.js`,
the sprite is drawn in `web/art/animals.py`)

**The bite is for everyone (web only).** The dead used to only hurt the living around you. Now a zombie's bite infects
them by the same rule as you: the strain's chance per bite, less what their armour stops (soldiers 30%, scouts and guards
15%, raiders 10%, your companion whatever you gave them to wear), a fever on the strain's own clock, and at the end they
get up as one of the dead where they stand ("Turned ..."), hunting you. The opening grace still protects your people. Your
companion tells you when they are bitten, and their sheet offers what you have yourself: cut off a bitten arm or leg in time
with a blade (they live, weaker, and closer to you), a suppressant to slow it, or letting them go before it happens (they
do not get up). An outpost guard who dies or turns is one fewer in its garrison. In endless, people at your base can be
bitten in a raid or on a scavenging run: the fever starts the next morning, and the morning after they turn and hurt (and
may bite) others, unless you cut it off before the fever or let them go. (`web/src/contagion.js`)

**Crafting weapons, arrows and shields (web only).** Every weapon recipe (nail club, ground blade, reinforced spear, scrap
bow, the era's own bow and spear where it has them), arrows (the era's arrows or darts, and improvised shafts) and two
shields are known from the start and can be made anywhere. A workshop no longer gates them: beside one the work takes the
listed time and comes out in full condition; away from one it takes half as long again, weapons and shields come out at 60%
condition, and arrows one fewer. Shields are a new item worn in the off hand (Pack > Off hand): a plank shield blocks 22% of
the blows that land (zombies and people alike), a reinforced one 34%; each block costs it condition (two against heavy hitters)
until it splits. They need the other hand free, so they do nothing with a bow, a polearm or a long gun (a pistol is fine).
(`web/src/crafting.js`)

**Dash: the tide (web only).** Dash and Extraction used to be the same run with one phase removed. In the web game Dash is
a pursuit: a front of the dead rolls up the road from where you started towards the way out at about 0.42 tiles a turn
(x0.85 easy, x1.15 hard, faster at night), after a short grace. It is a line, not a crowd: what matters is how far along the
road you are (inside a building, the building's door counts). Everything you stop for costs ground: searching a building,
a night's sleep, a road incident's lost hours (`time` in an event moves the tide on by what it would have walked). The HUD
shows how far behind it is, with warnings at 30, 15 and 6 tiles. If it reaches you the dead come at you from every side,
more the further it has rolled past; 30 tiles past you, it is over ("Swallowed by the tide"). Buildings it has rolled over
fill with the dead. The way out is known from the start. Within 22 tiles of it the transport starts loading: you have 60
turns to reach its doors, and the tide closes in behind you for the last stretch. Stepping through the doors is the win:
no bench, no hold-out, no break-out. In hardcore the next survivor gets a race of their own. (`web/src/front.js`)

**The endless world (web only).** Endless used to be one curve and the hero's journey on a loop. Now the world moves on
by itself (`web/src/saga.js`, `web/src/factions.js`):
* *Phases* that change the rules: the Collapse (days 1-4), the Scramble (5-12), the Holdouts (13-25), the Long Winter
  (26-40) and the End of Days (41+). Each one sets how much refills in looted buildings, how well foraging works, what things
  cost, how many of the dead wander, and which world events can happen. The Director walks a window of the journey that
  fits the phase instead of looping it. When the Holdouts begin the soldiers come apart: half their outposts turn raider.
* *Factions with outposts.* The era's five factions (soldiers, civilians, raiders, the cult, the people looking for a cure)
  start with a handful of buildings each. Once a day they gain or lose supplies and strength, move into empty buildings
  near their own, fight hostile neighbours (raiders fight everyone; the cult fights soldiers and scientists; soldiers and
  scientists fall out in the Holdouts; the civilians and the cult in the Winter), and lose garrison to passing hordes. An
  outpost that loses its last defender is taken by the winner or falls to the dead. What happens is reported each day
  (places you know, or anywhere once you have a radio) and kept in *Menu > The world*.
* *Outposts are places.* The ground floor of an outpost holds its garrison and the one in charge, and the dead are
  cleared from it. At the door a voice behind a barricade stops you, unless they like you: talk your way in, pay, offer
  food, back out, or force it (the whole building turns on you). Raider dens shoot on sight. Inside, the one in charge
  trades (prices by your standing with them), takes requests (food, medicine during a fever), lets you sleep, and can spare
  someone to come with you or to live at your base. Kill a hostile garrison to the last and the building is empty and
  yours to claim. You cannot claim a building someone holds.
* *Sieges and calls for help.* Friendly outposts get surrounded: you hear about it, the dead are at their doors when you
  arrive, and breaking the siege earns their thanks (+15 standing, a gift); ignore it and it costs them.
* *World events*, announced before they land (twice as early with a radio): a supply drop (marked, contested), a voice
  on the air (sometimes true, sometimes bait), the grey (fog for days), a migration (a huge horde crossing the map), a
  firebreak (a district burned: buildings emptied, outposts gutted, fire on the ground), the change (more of the special
  dead, for good), a blood moon (a night of raids), a fever at an outpost, a war between two factions (you choose a side
  or none), the cult's procession to open someone's doors (stand in its way or not), a warlord who unites the raiders
  (kill them in their seat and the raiders break), famine and cold (prices, food, foraging, stamina), and, at the end of
  days, the fall of the old refuge.
* *Your people.* Room for one, plus two for every cot you build (up to four cots). Your companion can stay at the base, and anyone there
  can come out with you. People also come from outposts, from refugees at your door, and from true broadcasts. Each has a
  job: guard (holds the walls when you are away and thins the raids when you are not), scavenge (brings things back from
  nearby buildings, with a risk that grows with the phase), medic, build, grow food (greenhouse) and research
  (laboratory). Every morning at six they eat from the locker and report; hungry people lose heart and leave.
* *Projects* built together over days: a radio, a lookout, a greenhouse, an infirmary, a wall, a generator, a laboratory
  and a vehicle, each with an effect. Materials come from your pack and the locker (base structures too).
* *Three endings besides death*, each a final stand of 40-60 turns at your base with no door to run for: the cure
  (laboratory, 100 research, the three components and the deciphered formula), the exodus (finish the vehicle) and the
  sanctuary (a radio, three allied outposts, day 20). The old refuge's bench no longer makes the cure in endless.

**Raiders are a squad, not a target.** Camps are no longer a clearing with some men standing in it:
* *Ambushes.* Half of a camp's raiders lie hidden in cover 4-9 tiles round it. They are not drawn, not targeted and not
  counted as enemies in sight until they spring: when you come within 3 tiles (2 if you creep), when one of their squad
  starts hunting you, or when you bump into one. They all spring together (`Raiders burst out of cover!`). A creeping player
  can spot one first (25% a turn within 3 tiles): it has not seen you and you can avoid it or strike first.
* *Snares.* Five hidden snares are laid on the approaches of every camp. Stepping on one costs 8 health and a bleed, makes
  a clatter (noise 12) and alerts every raider within 14 tiles. You may spot one as you walk next to it (35%; 70% and from
  2 tiles if you creep): it shows as a red X. A spotted snare will not let you step on it unless you creep, in which case
  you disarm it and keep a scrap. The dead trip them too, so camps thin out zombie hordes.
* *Fire discipline.* Gunmen and archers carry a magazine (6 shots, 5 arrows) and must reload (3 turns, from cover if
  they can), they back off to range when you close in instead of standing still, and take cover between bursts a third of
  the time. In pairs one side works round to your flank instead of walking into the barrel.
* *Morale.* Raiders no longer run on contact. They run when below 30% health or when their morale breaks: each friend
  killed near them costs 25. Out of sight it recovers 2 a turn, and they come back.
* *Everywhere.* Ambushes are not only for camps: raider road events and the Dash finale spring the same hidden squad
  (half in cover, three hidden snares round you), and lone tripwires are scattered along the far roads.

**The world remembers, companions ask for one thing, and the Director leans on your people.**
* *Marks* (`engine/memory.py`): a **stand** (four kills close together in time and place) leaves a battlefield; walk back near it
  more than 200 turns later and the log tells you so. **Graves**: whoever travelled with you and died is buried where they fell,
  shown as a yellow `+` on the map (a cross on the web), and remembered in your own words (what they said). Visiting a grave
  costs a little panic.
* *Nemeses*: a raider or soldier who breaks and runs from you alive is **named and scarred** ("Vask the Scarred"); up to three at
  once. Later the Director's next ambush brings one back, 40% tougher, hitting harder, with a line of dialogue. Killing them is
  recorded in the log and pays XP; if the original stood somewhere else in the meantime, they are not duplicated.
* *Personal errands*: at a **bond of 60** each companion asks you for one thing (a military post, a clinic, a stall, a farmhouse, a
  workshop, a chapel, a station, a card room - each archetype has its own). The place is marked on the map and the errand appears
  in your objectives. The first time you enter it, a **keepsake** (a key item, takes no pack space) is in a crate on its last
  floor. Bring it back to them (within three tiles, nothing hunting you) and a scene plays with three endings: **give it back**
  (+20 bond, +4 humanity, and their flaw is **overcome**: reckless ones hold the line, cowards stand their ground, the loud
  ones go quiet, the hungry stop eating your food, the pacifist will fight to defend you, the frail gain 12 health),
  **say you found nothing** (-25 bond, -6 humanity, 6 coins: they know), or **read it together** (+10 bond, +2 humanity, calm,
  and their whole story).
* *The Director and your people*: allies hurt (under 40%) raise tension; an ally under 25% pauses the pressure. **While you are
  indoors** (act 5 or later, 50+ turns) the dead may find whoever waits outside, and you hear it through the walls. The
  **ordeal's** big threat heads for your companion first. The **reward** gives you and them a quiet moment (+6 bond). When
  someone dies the world goes quiet for 200 turns.

**Fixes after playtesting: the Director indoors, a weaker sneak, a gentler first wave.**
* *The Director works indoors.* Threats are no longer world-only: inside a building or a cave the dead "find a way in" (spawned on
  floor tiles away from you), raiders follow you down the stairs, and a special or boss was "in here all along". Havens and safe
  rooms are left alone. (`director._land_indoors`.)
* *Stealth nerfed.* Creeping still halves how far the dead see you, but a sneak stab now lands 85% of the time, finds the head 60%
  of the time and does x1.75 instead of x2 (an outright kill went from ~95% to ~35%); creeping is never silent (noise 1-2 per step),
  and it drains 0.7 stamina per step instead of 0.4.
* *The opening tide spares your people.* For the first 480 turns, and while the opening ring is active, the dead go for you before
  your companion or pet, hit them for 40% damage, and the companion's leash shrinks to 3 tiles. A hurt companion who flees runs
  towards you instead of into the dark, and companions have 1.6x their profile HP + 10 (medic 36, veteran 74, brute 93; you start at 80). (`companion.early_grace`.)

* *Your companion mirrors you.* When you creep, they creep (the dead only notice them within 2 tiles); when you sprint, they take a
  free step every other turn to keep up; both stop the moment they fight. When you level up, they level up with you (+3 max HP,
  +1 damage, +2 accuracy per level), with a line in the log. (`companion.mirror`, `companion.grow`.)

**Playtest fixes (dash).** The Alpha of the final stand spawned without a "last heard you" turn, lost interest at once and stood
still: it now hunts from the first turn (same fix for the stalker that follows you in). Your companion now comes inside with you
and back out (anyone within 12 tiles when you take a door, a stair or a cave mouth; further behind they wait outside), so the old
"I will keep watch out here" is only for the ones left far behind. The focused log also shows what just happened to you (a refused
shot such as "Out of bullets", a hit, a wound) for two turns, instead of hiding it. (`Game.story_log`.)

**The final stand is a break-out.** Holding out is only half of it: when the clock runs out the work is done but the room is not
safe, and one way out is picked at random each time (the west, east or north door, or the main entrance, at least 8 tiles from you).
A knot of the dead crowds that door, the waves keep coming at their fastest, the HUD shows `GET OUT: <door>` and the log gives the
direction and distance every few turns (the web version pulses a green frame on the tile). Step onto it and you win. (`Game._start_breakout`.)

**Orders for your companion.** Free actions (no turn), usable from across the field: *Engage nearest* (go for the closest enemy past
the usual leash until it is down), *Fall back* (break off and come to your side, defending only if cornered), *Escape!* (run with you,
two steps a turn, never fighting), *Fire from a distance* (keep 3+ tiles off and shoot; needs a ranged weapon, so veterans and hunters)
and *Stay close* (a 2-tile leash: only what comes near you). Each holds for 30-60 turns, then "back to normal". Flaws bite: cowards
refuse to engage half the time, reckless ones refuse to fall back or escape 40% of the time (until tamed). Terminal: `K`. Web: the
"Orders" chip next to your companion, the menu tile, or `k`. (`companion.give_order`, `ai._obey`.)

**Keeping up.** You never have to slow down for your companion: when they fall more than 4 tiles behind they take two steps a turn,
more than 10 behind three, and if they are lost 30 tiles back with nothing hunting them they catch up out of breath. They are
carried through doors from up to 20 tiles away (it used to be 12).

**A briefing about this run, and a cutscene when you win.** The opening now has a "Your situation" page made of the run's own facts: who
you were (your origin), the hour and the light, what is in your hands, the two nearest buildings with direction and distance, and who
is already beside you with their first words. A win ends with a four-frame cutscene before the scorecard: *The way out* (the door you
actually took, the aircraft or the refuge of your era), *Beside you* (your companion's words, shaped by your humanity; the ones you lost;
your pet; or the quiet if you are alone), *What it cost* (days, dead, limbs, a line for who you became) and *Afterwards*. Web: tap through
the frames; terminal: any key. (`engine/setup.situation`, `engine/ending.cutscene`, `content/story.py`.)

**People with a voice, and a readable briefing.** The people of the havens and the roads are no longer "Trader / Healer / Archivist /
Scout": each has a name from their era and one of two personalities per role (a shrewd trader or a weary one, a gentle healer or a brusque
one, a dry archivist or an excitable one, a careful scout or a wry one, a formal soldier or a tired one, a shaken survivor or a hardened one).
Their greeting reads your state (first meeting, hurt, bitten, someone with you, night, how human you still are), "The news?" tells you
things that are true about this run (a horde on the move and where, the checkpoint nearest to you, a nemesis who still lives, the people
you lost, the days left before the way out closes, what the soldiers think of you), and "About them" gives their story, one piece at a
time. Web: the same sheet for every conversation; terminal: a menu after the greeting. (`engine/dialogue.py`, `content/dialogue.py`.)
The briefing and these conversations use a near-opaque backdrop and the body face at 17px instead of the thin typewriter one.

**Sound (web).** Retro chip sound, all synthesised in the browser with WebAudio (square and pulse voices, triangle bass, crunchy 8-bit noise; no
files, a few KB of code in `web/src/audio.js`). Effects: steps by surface (and quieter when you creep), blows, kills, shots, blasts,
doors, hurt, the dead noticing you, pickups, healing, level up, the log's warnings, and a heartbeat when you are badly hurt or terrified.
Sounds that have a place in the world (a shot, a zombie spotting you) are panned and quieter with distance. Music: a minor-key loop per
era (D dorian, E minor, A minor, C-sharp phrygian) whose layers and tempo follow the Director's tension, the dead hunting you nearby,
your health and the final stand: bass and sparse notes when it is calm, an arpeggio and hi-hat when it tightens, drums and a tritone
stab when it peaks. Settings: sound effects, music and volume (remembered). Audio starts after your first tap (browser rule). The
engine only asks for a sound by name (`sfx(game, 'kill', pos)`), so it costs nothing in tests or the terminal build, which stays silent.

**Distances in the units of the era, and a sci-fi look of its own.** Nothing says "tiles" any more: the middle ages count paces, furlongs
and leagues, the eighties yards, blocks and miles, the modern day metres and kilometres, the sci-fi setting metres and klicks (a tile is
about 10 m, 30 m for the medieval map; `util.dist_words`). The sci-fi era has its own sprite set, drawn pixel by pixel in
`web/art/scifi.py` (no pack): dark steel decks with rivets, lit bulkheads, coolant instead of water, a hydroponic deck instead of
grass with bulb trees in two tints, cargo containers, energy barriers, helmeted crew in role colours, and infected that glow. The log
over the map now sits on a dark gradient with brighter text.

**Forests, and people of their age.** Fixes from a playthrough in a medieval forest: you now swap places with your companion when
they are in your way (a one-tile path through the trees used to leave you stuck behind them), and a companion who is boxed in by trees
or rubble for five turns pushes through to you instead of standing there (the player may slip diagonally between two trees where the
characters' pathfinding may not, so they could be cut off). Companions and the people you meet are written for the age: in the middle
ages the mechanic is a smith (hammer and forge, not toolboxes and elevators), the medic a herbalist, the scavenger a pedlar, the
preacher a friar, the gambler a dicer, and the dialogue drops rifles, radios and doctorates (`ERA_VARIANTS`, `PERSONAL_VARIANTS`,
`MEDIEVAL_SWAPS`); the sci-fi mechanic is an engineer who serviced airlocks.

**Equip your companion; animals with sprites.** From the companion's sheet (terminal: talk to them, "Equip them") you can hand them a
weapon or armour from your pack, and ammunition for what they carry. A weapon sets their damage (its damage plus half their own) and
accuracy; a bow or firearm gives them reach but only while they have ammunition (each shot uses one, then they fall back to melee and
say so; handing them more fixes it); armour takes its defence off every blow. A pacifist will not carry a weapon, a coward is very glad of
armour, and gifts raise the bond. What you gave comes back to your pack when they leave and is left on the ground where they fall; their
own base stats still level up with you. The wildlife and your pets (rabbit, deer, boar, wolf, dog, cat, crow, fox) are drawn as pixel
sprites in the same style as the people (`web/art/animals.py`; the sci-fi station has lit-eye versions), with a small dot for a pet
(purple), a stray you could feed (teal) or an animal charging you (red).

**An app icon.** The page carries its own icon (`web/art/make_icon.py`: a pixel skull with acid-green eyes on the game's dark teal): favicon, the
iOS `apple-touch-icon` (180 px) and an installable web manifest (192/512 px, maskable) made when the page loads, plus the standalone meta
tags, and the title screen shows it. To get it on a phone: remove the old home-screen shortcut and add the page again (iOS caches the icon
it saw the first time).

**The Director: the hero's journey as a pacing chart.** `engine/director.py` reads two things. *Progress* (65% objectives met, 35% how
much of the clock is gone, a little more once the final site is known; the endless run goes round the journey again and again)
picks one of the **twelve stages** (Ordinary World, Call to Adventure, Refusal, Meeting the Mentor, Crossing the Threshold, Tests/
Allies/Enemies, Approach to the Inmost Cave, the Ordeal, the Reward, the Road Back, the Resurrection, the Return), each with a
target intensity, a length of quiet, and a one-time beat: the call reveals a lead, the mentor another, the threshold sends a first
real test, the tests bring a stray animal to follow you, the approach shows you where the final site is, the **ordeal** sends one
large thing (the strongest special the strain has, 30% tougher, with company) after a warning, the reward hands you supplies, the
road back sends a pursuing horde. *Tension* (enemies in view, damage taken, panic, noise, decaying) says how hard it is pressing
now. It runs **build, peak, release**: after a quiet stretch with tension low it schedules a horde, an ambush or a hunting special,
**announces it ten turns before it lands** (a cue in the log, then a compass direction), then eases for a stretch. When you are in
trouble (under 35% health, or bleeding with nothing to bandage with) it releases instead of piling on. It also scales the world's
own wanderers and random events by phase and tilts which events you get: relief (a stranger, a cache, a stray) in the release,
trouble (a toll, bait) at the peak. The first four acts are always gentle. Each new act is announced in the log (`ACT 5: ...`), and
your companion remarks on it. The sidebar shows `Act 5/12 ... [###..] build`.

**Pets.** Strays live in the world: dogs and cats near buildings, crows and foxes out in the open (one or two of each on a small map,
roughly one in three chunks on the big one). They are curious, not tame: a dog or cat will come to within three tiles and wait; a
crow or fox keeps its distance. **Stand next to one and offer it food** (terminal `e`, web tap it): a dog accepts 85% of the time, a
cat 50%, a crow 45%, a fox 40%, plus 15% if you are creeping and 10% if you are decent. A failed try loses the food and sends it
off. Some road events (`A stray`) and the Director's "tests" act can also send one. **One pet at a time, alongside your human
companion**; it waits outside buildings and caves, and you swap places with it in a corridor.
* *Dog* (16 hp): fights beside you, growls at ambushers and at dead you cannot yet see; barks at the wrong time.
* *Cat* (8 hp): calms your panic; sometimes finds scraps when you leave a building; runs from fights; wanders off if ignored.
* *Crow* (5 hp): marks a building on your map every 300 turns; sometimes brings coins; caws, and the dead listen.
* *Fox* (10 hp): brings you a rabbit now and then; bolts from fights.
* They need feeding: hungry after 500 turns, starving after 900, when the bond starts to fray; at 0 it leaves. Petting and feeding
  raise the bond. The dead go for a pet like anyone else; **a dead pet stays dead**, and the log says so.

**A companion, and a log that follows the story.**
* *You start with one person at your side*, drawn at random from a pool of eight (veteran, medic, scavenger, hunter, mechanic,
  preacher, brute, gambler), each with a personal name, **one strength and one flaw**:
  fighter (hits hard) / medic (dresses your wounds below 60% health, every 60 turns) / scavenger (comes back with something
  when you leave a building) / scout (spots ambushers and snares) / calm (steadies your panic) / tinker (repairs your weapon) /
  tough / lucky; against coward (flees at 60% health) / loud (makes noise now and then) / hungry (eats from your pack) / frail /
  pacifist (will not fight people, and a killing you cannot justify costs 15 bond) / reckless (charges, does not break off).
* **One at a time, and they stay dead.** If they die the log says so, who killed them, how many days and kills, and what they
  said; the ending lists everyone you lost. **Anyone who is not hostile can take their place**: a trader, healer or archivist
  (be known or well-liked), a patrol member (earn their trust), or a stranger you helped (some road events end with someone
  asking to come along). The person's profile comes from who they are (a healer is a medic) and their id.
* **Bond (0-100)** rises with time together (+1 per 100 turns), shared kills, food and medicine you give them, and falls when
  you kill people who were not hostile. At 5 they leave. At 35, 60 and 85 they tell you a part of their story when you talk
  (a lead on your map, a medkit, and at the end +3 max health for you).
* *In a fight* a companion is **a target like anyone else** (the dead and raiders go for them, whatever their role, and prefer
  whoever is closer), and **stays with you**: they fight within 6 tiles of you (12 for the reckless) and come back when you run,
  calling after you ("Wait! Do not leave me here!") if you leave them behind. They shout when a fight starts, when you are hit
  ("Behind you!") and when they break; their blows and wounds appear in the story log.
* *Talking*: terminal `e` beside them, web tap them or the chip under the bars: **Talk**, **What next?** (their read on the next
  objective and where it is), **Give** food or medicine, **Wait here / Follow me**, **Go your own way**. They wait outside
  when you go into a building or cave, and say so.
* **The log** now shows only what matters by default: a pinned **GOAL**, objective changes (`Done: ...`, new leads, the last
  day), everything your companion says or does, and key events. Combat noise and step notes stay in the full log. Terminal `J`
  toggles it; on the web tap the log, or open Journal for the Story and Everything tabs.

**Food: hunting, foraging, cooking.** Rations are no longer the only meal.
* *Game.* Rabbits (`r`), deer (`d`) and boar (`b`) graze on grass and brush, away from the start. They notice you from 5, 7 and
  4 tiles (3 tiles less if you creep, and then only 30% of the time per turn). Once they have noticed you they run, a little
  faster than you can walk (a second step every third turn), sliding round obstacles, so **walking one down mostly fails**
  (about 15% for a deer and 30% for a rabbit in open country, in the balance probe). A creeping hunter can walk up and stab
  an unaware animal for **triple damage**, which works about 40% (deer) to 60% (rabbit) of the time. A boar does not run when
  you are close: it charges and gores (3-7, through armour). Walk into game to attack (melee only for now: they are not shot
  at). A kill drops 1-3 **raw meat**.
* *Raw meat* feeds 16 but has a 35% chance of cramps (-4 health, hungrier). **Cook** it (craft menu, `cook`: raw meat + a plank)
  for **cooked meat**, which feeds 40 (a deer is about three days of hunger; a day is 28.8).
* *Foraging.* Terminal `F`, web **Forage** button (key `z`): 5 turns on grass (40%) or brush (65%) for 1-2 wild greens
  (feed 6, about 13-20% of a day's hunger per action); +10% in rain or fog, -25% at night. A patch (radius 2) stays picked for 800 turns. Something hunting you stops it.
* *Gather* is one key for living off the land (terminal `F`, web **Gather** button or `z`; the button names what it will do):
  - **Chop**: with a blade (6 turns) or something heavy (9) next to a tree. 2-4 planks, a stump-free clearing where it stood
    (it opens sightlines), and noise 8 every third turn. Not on the rim of the map, not bare-handed.
  - **Fish**: next to water with a **rod** (wood + cloth + scrap; 8 turns, 50%, one fish, 4% to snap) or a **net**
    (3 cloth + wood; 12 turns, 65%, up to 2 fish, 35% to tear). Quiet. Raw fish feeds 12 (12% cramps); cook it with a plank
    (`cook_fish`) for grilled fish (30). +10% in rain or fog, -20% at night.
  - **Forage** otherwise, as above.
* *Nail bomb* (chem + 2 scrap + cloth, no workshop; throw it): 11-18 to everything in radius 2 with line of sight, loud (16),
  and it hurts you too if you are inside the radius. All of these recipes are known from the start.
* Checkpoints take only the most valuable **three stacks** of contraband, not your whole kit.

**Caves and the deep woods.**
* *Cave mouths* (`n` on the map; "Cave", "Old mine", "Sinkhole", "Quarry tunnel"): small rock outcrops with a dark doorway, placed
  out in the woods at least 24 tiles from the start (16 on a crowded small map) and well off the edge of the map (two on the small map, up to eight on a
  big one). Inside is a winding system of chambers (a cellular-automaton cave, the same every run of a seed), **black**: unlit
  you see 3 tiles, and a torch or lantern is what lets you see further (a light is also a beacon to the dead). Nests of 2-4
  dormant dead sleep in the far chambers, 3-4 rich crates sit in dead ends (scrap, parts, chemicals, fuel), pale
  **mushrooms** lie on the floor (food 10, 10% cramps), and with a spore plague there are spore beds. Caves hold no documents
  and are never a quest host. One way in, one way out.
* *Deep woods*: where at least 7 of the 25 tiles round you are trees. You are told once when you walk under the canopy.
  The dead see you from 25% less far; forage pays +20% and a quarter of what you find is **wild herbs** (heal 4, calm).
* *Wolves* (`w`) hunt in packs of 2-3 in the deep woods only: they notice you from 7 tiles (10 at night; a creeping player
  is noticed 30% of the time per turn), charge, and call the whole pack within 9 tiles. They bite for 3-6 (armour counts and
  wears, a deep bite can bleed) and take a **second step every fourth turn**, which is a bite at your heels if you run: you
  cannot outwalk them, but they cannot enter a building or a cave, and they lose interest if you get 8 tiles beyond their
  notice range. Kill one for 1-2 raw meat.

**Balance probes.** `PYTHONPATH=src python3 tools/balance.py [wolves|hunt|caves|food|bot|cave|market|military|all]` measures the
newer systems (fights against wolves and boar, how often a chase or a stalk works, cave versus building loot and danger,
food per action, what kills the bot, bot runs inside a cave). Last numbers: two wolves cost about 15-20 of 80 health with
the best loose weapon and three about 38; caves hold about 1.3 times the loot of a building floor for about 1.4 times the
dead, and a torch matters (the bot lives 40% of 500-turn cave runs with one and 17% without).

**Checkpoints and corrupt soldiers.** The far roads (at least 35 tiles from the start) have military checkpoints: three
soldiers holding the highway (two on the small map, more on a big one). Come within 7 tiles in sight of one (3 if you are
creeping) and it stops you, once per 500 turns. Roaming military patrols do the same, but only half the time and at most
once per 300 turns. They are looking for **contraband**: medicine (medkit, suppressant, painkiller), thrown explosives and
in the firearm eras every gun and bullet (in 1348, crossbows). Quest items are never taken. If you carry nothing they
wave you on; a corrupt one may stop you for a road tax instead. A bite you cannot hide (40% chance per stop) is the worst
thing they can find. You choose:
* *Submit* - they take it all. An honest soldier means to hand it in; a corrupt one pockets it. Either way the **leader
  carries it**: kill him and it drops. If you are infected, they shoot.
* *Bribe* - 4 + 2 per contraband item (+8 if sick; sick pays double). A corrupt soldier takes it 90% of the time (75% if
  you are sick); an honest one 15% (never if sick), and when it fails he keeps the money and takes the goods.
* *Talk* - 22% + humanity/220 + military reputation/250 (less if sick). Failing it is a search.
* *Draw* - the whole crew turns on you and military reputation drops 40. At -50 every checkpoint shoots on sight.
About 38% of soldiers are corrupt (decided by their id, so it is the same on every run of a seed). Hostile soldiers fight like
raider squads: magazines, reloads, cover.

**Push and run.** The web controls have a **PUSH** button (keyboard V; terminal `P`) next to **SNEAK** and a new **RUN** button
(keyboard X; terminal `R`; sneak is H on the web). Push shoves the nearest hostile within reach: it staggers back a tile (two if
you are level 4 or more and it is not a brute), loses two turns, and wakes up hunting you. A wall or a solid thing behind it
costs it 2-4 health and a third lost turn. Brutes resist (45% less likely to move), the Alpha and other bosses never budge, a
missing arm makes your shove 30% less likely to work, it costs 8 stamina and is quiet (noise 3). Use it to make room, to
break off, or to steer the dead onto a spike trap or into a fire. The button lights up and names the target when something is
within reach.

**Learning the language.** Everything written (research notes, vault codes, the formula, crafting manuals, diary pages)
is in the era's cipher. Where it comes from:
* *Pages* lie in the crates and on the floors of buildings, houses above all (a loose page shows as a teal mark; crates must
  be searched). Reading a page exposes you to its unknown words (a word sinks in after four exposures); *studying* it
  (three tries per page) decodes words on purpose. A page is *deciphered* once about 60% of its key words are known, and
  only then does it act (marks a vault, gives a code, teaches a recipe).
* The *diary pages* are the practice material. They scale with the world (about one for every five buildings: ~50 on the web
  map, 9 on the terminal one) and the first quarter are placed within about 30 tiles of where you start, the next quarter
  within the nearest third of the map, so the language can be picked up from the first day.
* Stepping into a building that still holds pages you have not read tells you so (`You glimpse written pages somewhere in
  here.`).
* The **Archivist** at the refuge teaches 3 words for 5 coins, and for 4 more marks the two nearest buildings that still hold
  unread pages (*papers rumoured* in the places list).
* Your origin and your opening scene start you with a few words, and some road events teach more.

**Crafting.** You start knowing the five basics (bandage, splint, fire bomb, noisemaker, barricade kit). The
rest (spike trap, repair kit, filter, medkit, suppressant, ammunition) are learned from a **manual**: one
written page per recipe, hidden in buildings like any other document, in the era's cipher. Read and decipher it
and you know the recipe for good (a new survivor in hardcore keeps what you learned). Using a recipe still
needs the materials and, for the advanced ones, enough fluency in the cipher. The craft screen lists only
what you know and says how many are still to find.

**Weapons are made at a workshop.** Standing beside a workshop (you build one in your base) you can make a
nail-studded club (known from the start), and, from manuals, a ground-down blade, a reinforced spear, a scrap bow
and improvised arrows for it. They are never found in loot; they are the reason to have a base.

**A base of your own** (`o` in the terminal game, *Base* in the web menu). Step into a building with nothing
hostile left in it and claim it. Inside it you can build, on the clear floor beside you, a **workshop**, up to two
**cots** (sleep there to heal; a raid or a wound wakes you early), a **locker** (a stash: what you store there
stays, and in hardcore the next survivor wakes up in your base with the locker still full) and **barricades**
(braced gates of 40 hp the dead must batter down; you cannot wall yourself in). At night, while you are in it, the
dead find your base: a raid of several zombies comes in at the entrance, and the base stops being safe until
they are dead. Only one base at a time; claiming another leaves the old one to the dead.

**The world plays its part** (`ambience.py` / `ambience.js`). Noise is no longer only yours:
* *Ground and places.* Stairs, open doors and, inside buildings, the kind of place make every step louder: broken
  glass in markets and labs, loose metal in industrial sites, echoing platforms and halls, creaking house floors.
  Sneaking is silent on all of it. On an open road or splashing through shallows you are also easier to see.
* *Weather* (outdoors; rolled every half day): **rain** muffles noise (x0.7), washes your scent trail away and shortens
  sight; **fog** halves what the dead see and shortens your own view; **storms** do all of that, harder, and add
  thunder claps that pull the dead toward wherever they landed. Indoors weather does not matter. The weather
  shows in the clock line.
* *Things that go off on their own.* Now and then a car alarm starts to wail somewhere out of sight, or something
  collapses in the distance; the dead go to see. The first time you enter a market, guard post, military site or lab
  its alarm may still have power (30%) and shriek for a while, loud enough for the street to hear it. Pushing through
  brush by day can flush a flock of crows.
  All of these can be used: a distant alarm pulls zombies away from you, a storm covers a run, and a mistake in a
  glass-strewn market brings the street in.

**Eras play differently** (`EraRules` in `content/eras.py`; every number is data):
| | medieval | eighties | modern | sci-fi |
|---|---|---|---|---|
| the world makes noise | bells, livestock, collapses | car alarms, sirens | car alarms, phones, helicopters | klaxons, patrol drones, power surges |
| building alarms | none | 20% | 30% | 45% |
| your footsteps | x0.8 (soft ground) | x1 | x1.1 (hard floors) | x1.15 |
| your own night view | -1 | 0 | +1 | +2 (visor) |
| a carried light shows you | x2.2 (a beacon) | x1.8 | x1.7 | x1.3 |
| the dead in the dark | as usual | as usual | as usual | no penalty (they sense heat) |
| brush hides you | x0.45 | x0.5 | x0.5 | x0.65 |
| how much the plague can mutate | x0.3 | x0.7 | x1.0 | x1.4 |

Patrol drones drift across the map and, if they get near you while you are not creeping, scan you and call the dead.

**The strain changes, district by district.** Each plague has a `mutates` rate (Biohazard 1.0, Spore 0.6, Rage 0.35,
Swarm 0.3, Slow rot 0.2, Classic and Nightstalkers 0.1); times the era's science and ramped over the first 12 days, it is
the daily chance that a district's dead gain a trait. The map is cut into districts (about 6 on the terminal map, up to 30
on the big web one), named for their compass position and what stands in them ("North-East Garrison", "South Labs"). Labs,
bases, hospitals and ground zero are **hot** and breed it up to 1.7x faster; each district runs its own dice, so they
diverge. Eight traits exist, at most four per district, and not all are improvements: *faster, tougher, keener senses,
harder hitting, hulking (big, slower), brittle but quick, howling (hears everything), swifter*. A trait applies to the
dead already walking in that district and to every zombie born there afterwards; it also raises the share of the strange
ones. Crossing into a district tells you what its dead are like (`You enter the South Labs. The dead here are faster,
tougher.`), the status line and the web header show it, and the web menu has a **Strain map** listing every district with
its direction, distance and what you know of it (only districts you have entered, or heard of, are known). So the same
Classic dead in a medieval world hardly change in a month, while Biohazard in a sci-fi world has districts with four
traits by day 20, and the road you choose is a choice of which mutations you meet. The briefing says which of these you
are playing. (A horde that wanders between districts keeps the traits of where it was born.)

**The records.** Every finished run (won, dead, turned, left behind) is kept on your machine
(`records.json` next to the saves, or the browser's storage) and compared with your earlier runs of the same
objective and mode: days survived first, points second. The end screen says whether it is a new record, and
the title screen has a *Records* page with the best of each and the latest runs.

**The siege.** The hold-out is not a countdown you stand through. The final site has a main entrance and three
side doors. Waves arrive at a random one of them, get bigger, and come faster as the clock runs down. A side
door that is not barricaded breaks on the first wave; a barricaded one (barricade kit, 40 hp) batters for a few
waves and then everything that piled up behind it comes through at once. The first time you use the console
the game tells you which doors are open and lets you prepare; the second time it starts for good. Prepare with
barricade kits, **spike traps** (craftable from wood and scrap; set where you stand, they wound the first of the
dead to step on them), fire bombs and noisemakers, and re-barricade a door that still stands while you hold.

**Opening** (how the story starts): you do not begin in a vacuum. Pick, or let the game pick from who you are,
a scene: studying, preparing a meal, out hunting, on your rounds, standing watch, fixing things, at the market,
a funeral vigil. Each has its own text per era and small consequences (a ranged weapon and food for the hunter, a
bigger vocabulary for the student, armour for the guard, a steadier conscience at the vigil, the hour you
start at). A three-page briefing (the scene, the world and what the dead are, what you must do) plays before
the first turn; `B` re-reads it.

**Mode**:
* `normal` - one survivor, one life; permadeath deletes the save.
* `living` ("Hardcore - the world goes on", `--mode living`) - your death is not the end. A new survivor
  (another origin) walks out of the refuge into the *same* world at the same hour: the dead, the vaults, the
  patrols and the clock are untouched. Your gear lies where you fell and your body rises as a named, levelled
  zombie. Whatever killed you levels up, takes a name ("Killer of Paramedic #1") and stays. The new survivor
  keeps your documents and half your cipher knowledge and starts at half your level. Infinite lives: the run
  ends only by winning or, in `extraction`, when the way out closes. The cure is for the world: nobody starts bitten.
  Enemies (zombies, raiders, patrols) gain levels by killing, capped by the calendar (level 3 on day 1, +1 per day,
  maximum 15). Big hordes keep every zombie instead of dropping the ones that do not fit on screen.

The web build also has a much larger map (360x240) planned whole and painted by chunks as you approach (see
`web/README.md`); the terminal game keeps its fixed 120x76 map. In the web build hardcore runs in **real time** (no turns); see `web/README.md`.

**Random**: era, the dead, objective, who you are and mode can each be set to `random` (the new-game screen has a Random
option on each choice and a "random everything" entry; `--era random` ... or `--random` on the command line). It is drawn when
the game starts, reproducibly if you also give a seed, and the log says what came up.

## How it plays

* **Sneaking up on them.** A zombie that has not noticed you has an awareness meter and a facing (the pale wedge on
  it in the web build). While you are in its sight the meter fills: fast if you are close, in front of it, running or
  making noise; slowly if you are sneaking (`s`) or behind it (it sees about 60% as well over its shoulder, 80% at its
  side). At 100 it hunts you (a red `!`); at 40 it turns to look; a `?` means it is on edge. Hit one that has not noticed
  you (meter under 70) and you cannot miss: a double-damage head blow that kills most. Sneaking on soft ground makes no
  noise, walking is always noticed, and walking straight at one's face is too. Idle zombies keep going the way they face,
  so wait, pick a side, and come in behind or beside it.
  Sneaking costs you: half speed (two ticks a step), no running, and it ends as soon as you fight a zombie that
  has noticed you or get hit. Fighting is never quiet: a blow carries 1.5x the weapon's noise (1.3x more for blunt
  weapons: a mace is heard from about 12 tiles), halved for a stealth strike. Everything within earshot goes to look
  (more rattled the closer it is, never past "about to notice you" without seeing you). The web build has a SNEAK button and a "Strike" action for this.
* **Stamina and the march.** Every step costs stamina (1.5 walking, 3 running, 0.4 creeping, half as much again in shallow
  water); standing still, resting and creeping win it back faster than they spend it. Marching nonstop empties the tank in about
  130 steps: below 20 you are winded (every other step takes two ticks), at zero you are exhausted (every step takes two) and
  cannot run. Running burns out in about 30 steps. Fast dead will catch a tired walker; stop, creep or rest to recover.
* **Noise is the game.** Every action makes noise; loud ones raise a *noise meter*. Fill it and a Stalker
  comes for you. Blades and bows are quiet; guns draw hordes. Sneak (`s`) halves what they notice.
* **Hordes are real.** Crowds roam the map, are drawn to noise, and become individual zombies when close.
  The game opens with a tide closing on the breach from every side but one.
* **Bitten?** Arm or leg: you have a short window to **cut it off** (`x`, needs a blade). It is not a free cure:
  it costs about 30 health (the first limb; the second costs nearly twice as much and will kill you unless you are
  nearly whole), permanently lowers your maximum health and stamina, and leaves a stump that bleeds until you bind
  it (a bandage only slows it, a medkit closes it). A lost leg halves your speed, stops you running and wrecks your
  evasion; a lost arm cuts your accuracy and melee damage, carries less, and rules out bows, polearms and rifles.
  Torso: suppressants only buy time. Spore presets infect through the air unless you wear a filter.
* **Injuries**: bleeding, broken legs, lost limbs. **Panic** wrecks your aim and can freeze you.
* **Day and night**: you see less in the dark, lights make you visible, some dead change at night.
* **Documents are written in a cipher.** Unknown words show as glyphs. You learn them by exposure, by
  studying, and from teachers. Deciphered documents reveal where components are, give vault codes and the
  formula; better recipes need fluency too.
* **Choices**: the road throws moral encounters at you. Humanity changes who will trade with you, how you are
  remembered, and who you face at the end.
* **Everyone fights everyone.** Zombies attack any living person they see, not just you: a patrol that
  meets a horde loses people, and what it loses gets up again (even on presets where the dead normally do not
  turn). Raiders and patrols shoot each other on sight. Gunfire draws the dead whoever fires.
* **Patrols**: enclave scouts and military soldiers walk between buildings and the raider camps. They leave
  you alone unless you attack them. Talk to one (`e`) for a tip, once, if you still look human.
* **Calls for help**: a patrol under attack shouts, and you hear it ("a call for help to the north-east").
  Kill something near them while they are in trouble and they remember: next time they thank you with a
  medical item and a lead, and trust you.
* **Companions**: ask a patrol member to come with you (`e` > ask) once they trust you (answered a call, or
  enough reputation). Up to two. They follow, fight what you fight, wait outside when you go indoors, and
  leave if you become inhuman. Tell them to go their way from the same menu.
* **Far away, in the abstract**: patrols you cannot see still walk their routes and still fight, resolved
  coarsely every 20 turns (they kill or lose to nearby dead, raiders and hordes). Over a long game the
  patrols thin out.
* **Gore disguise** (`v`): smear yourself with a corpse to walk past mindless dead.
* **The record**: when a run ends (won, dead, turned, left behind) a second page retells how it went: a
  chronicle of the moments that mattered (bites, amputations, documents deciphered, event choices, first
  visits, level-ups, hordes, boss kills, every 25th kill, survivors lost) and the last ten log lines before
  the end. Routine hits and idle chatter are left out; a long run keeps its opening and its latest events.

## Keys (press `?` in game)

`arrows/hjkl/yubn` move or attack, `.` wait, `r` rest, `g` pick up, `e` interact (crates, people, beds, bench),
`i` inventory, `c` craft, `d` documents, `p` skills, `m` places, `f` fire, `t` throw, `x` amputate,
`s` sneak, `R` run, `L` light, `v` gore, `B` briefing, `Q` save and quit.

## Layout

```
src/outbreak/
  content/   data packs: eras, zombie presets, scenarios, items, perks, recipes
  engine/    game rules; deterministic for a given seed; no I/O except save.py
  ui/        render.py (state -> drawable view, no curses) and the curses front-end
  bot.py     a simple autonomous player used for fuzzing and balance checks
tests/       unittest suite (no dependencies)
```

Adding an era or a zombie preset is a data change: add a function to `content/eras.py` or an entry in
`content/zombies.py`. Both are validated at import time, and the test suite iterates over every pack.

```
python3 -m unittest discover -s tests -t .      # ~30 s
python3 play.py --bot 1500 --era scifi --zombies spore --seed 3      # headless bot run
python3 play.py --show --seed 4                  # print the opening view
```

Saves live in `$OUTBREAK_HOME` or `~/.local/share/outbreak/`. They are Python pickles of your own game:
do not load save files from people you do not trust.

## Art credits

The web build draws with pixel sprites from **Kenney** (www.kenney.nl): *Roguelike Modern City* and
*Roguelike Characters* for every era but the medieval one, *Tiny Town* and *Tiny Dungeon* for the medieval one (its
dead are villagers gone green, plus the dungeon pack's spiders, slimes, bats and ghosts). All are **CC0** (public domain; the licence files are in `web/art/src/`). A small atlas is built
from them by `web/art/build_atlas.py` (Pillow; the result, `atlas.png` + `atlas.json`, is committed and inlined by
`web/build.py`). The zombies are the packs' green body in a torn shirt, recoloured per kind. *Settings > Pixel
sprites* turns them off and draws plain shapes instead, which is also what happens if the atlas is missing.
