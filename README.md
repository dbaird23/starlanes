# Starlanes

A browser-based recreation of the classic Mac game *Escape Velocity Nova* — inertial 2D flight, planet landings, commodity trading, and hyperjumps — running on a clean-room TypeScript/Canvas engine that imports the **real EV Nova galaxy** from your own copy of the game's data files.

## Run it

```bash
npm install
npm run dev
```

Then open **http://localhost:5173**.

### Play online (PWA)

A live version is deployed to GitHub Pages at https://calebbaird.github.io/starlanes/ (or your fork's equivalent).

It is a **Progressive Web App**:
- Install it to your home screen / dock for a native-like experience.
- Works offline after the first visit (all sprites, sounds, music, and galaxy data are cached).
- Auto-updates when a new version is pushed.

Click the install icon in the address bar (Chrome/Edge) or use the browser's "Install" menu.

## Importing the EV Nova data

The engine loads its universe from `public/nova/galaxy.json`, generated from EV Nova's data files (Windows `.rez` format, e.g. from the community-maintained distribution at escape-velocity.games or your own installation):

```bash
node scripts/extract-nova.mjs  "<path to EV Nova/Nova Files>"
node scripts/extract-sprites.mjs "<path to EV Nova/Nova Files>"
node scripts/extract-picts.mjs   "<path to EV Nova/Nova Files>"
node scripts/extract-sounds.mjs  "<path to EV Nova/Nova Files>"
```

This parses the `.rez` resource containers and decodes `sÿst` (star systems), `spöb` (planets/stations), `gövt` (governments), and `dësc` (landing descriptions) per the Nova Bible — currently 404 systems, 411 stellar objects, and 390 landing descriptions, including each world's real commodity price levels from its flag bits.

The extracted data is for personal use with a copy of the game you own; don't redistribute `galaxy.json`.

## Controls

EV Nova's own keys, with the arrow keys flying the ship instead of WASD.

| Key | Action |
| --- | --- |
| ↑ ↓ ← → | Accelerate · reverse course · rotate |
| Z | Afterburner |
| Space | Fire primary weapons |
| Left Ctrl | Fire selected secondary (missile, or scramble a fighter bay) |
| W | Select secondary weapon |
| ` (or Tab) | Target select — cycles ships |
| R | Target closest ship |
| Y | Communicate — hail a ship, or a world's traffic control |
| B | Board a disabled ship |
| C | Recall fighters |
| U | Engage cloak |
| L | Land/dock — targets worlds, cycles them, lands on the second press |
| J | Hyper jump along your plotted course |
| M | Galaxy map |
| Q | Autopilot — flies to your targeted world and lands, or runs your plotted course |
| \ | Select jump destination — steps through this system's hyperlanes |
| N | Nav system off — clears the course and drops the autopilot |
| E · F · V | Escort orders — attack my target · form up · hold position |
| P | Player info |
| I | Mission info |
| Alt-K | Jettison cargo |
| Alt-X | Eject in your escape pod |
| Shift-Q | Self-destruct |
| Esc | Menu |

Demanding tribute from a world is a comms option (**Y** with the world targeted), as in the
original. Still unbound: Nova's separate escort-dismissal key (escorts are released from
the spaceport's hiring hall instead) and the secondary-weapon jettison dialog.

## The loop

New pilots start exactly as the scenario's `chär` template says: a Shuttle, 25,000
credits, and a random one of Kania, Fomalhaut, Porto Rillia or Moonrise. Buy commodities where the price level is **Low** (green), haul them somewhere they're **High** (red), and sell — the price levels are each world's real ones from the original game. Refuel at any inhabited spaceport. Your game saves automatically whenever you're docked (localStorage).

## Project layout

- `scripts/rez.mjs` — shared .rez container parser (also a CLI: `node scripts/rez.mjs <file>` prints an inventory)
- `scripts/extract-nova.mjs` — galaxy decoder → `public/nova/galaxy.json`
- `scripts/extract-sprites.mjs` — `rlëD` sprite decoder → PNG spritesheets in `public/nova/sprites/` (all 288 ships + stellar, weapon, and explosion graphics)
- `scripts/extract-picts.mjs` — QuickDraw PICT v2 decoder → landing landscapes, shipyard portraits, and outfit pictures in `public/nova/picts/`
- `scripts/extract-sounds.mjs` — Mac `snd ` decoder (8-bit PCM + ima4) → WAVs in `public/nova/sounds/`, plus the soundtrack
- `src/data/universe.ts` — commodities, galaxy loading, hyperlane graph, price decoding
- `src/game/game.ts` — game modes (flight / map / landed), jumps, landing, economy, HUD, zoomable map
- `src/game/ship.ts` — flight model and NPC autopilot
- `src/engine/` — input, starfield, procedural ship/planet drawing
- `src/game/missions.ts`, `src/game/bits.ts` — mission logic and the control-bit engine
- `src/game/reputation.ts` — combat rating and per-government legal records
- `src/engine/audio.ts` — sound effects and music (menu only)
- `src/ui/hail.ts` — ship-to-ship comms panel
- `src/ui/landed.ts` — spaceport, Trade Center, shipyard, outfitter, bar, and mission UI

## The galaxy's own clock

All 125 `crön` events are decoded and running. The game keeps EV Nova's real calendar —
day one is **July 8th, 1177 NC** — and every jump or landing advances it. Events activate
inside their date windows, wait out their PreHoldoff, fire their `OnStart` bits, run for
their Duration, then fire `OnEnd` and sit out their PostHoldoff before they can recur.
Storylines and galactic politics therefore move whether or not you're watching.

Fleets (`flët`, 128 of them) arrive as formations rather than lone ships — a flagship with
its escort types in tow, filtered by government and system, so a Federation patrol shows up
in Federation space flying together.

## Missions

All 791 `mïsn` resources are decoded, along with the control-bit (ncb) engine that drives
Nova's storylines: test expressions gate availability, and accepting/completing/failing
missions sets bits, starts follow-up missions (`Sxxx`), and grants outfits (`Gxxx`).
Delivery and story missions are offered from the **Mission BBS**, the **Bar**, and
spaceport walk-ups, and from named captains over the radio; active jobs live in the
**Mission Log** (abortable when the data allows), destinations get EV's red arrows on the
map, and time limits tick against the game date (a day passes per jump and per landing).
All six ship goals work — destroy, disable, board, escort, observe and rescue — spawning
their real target ships in the right system. Ships you're escorting form up on you, jump
with you, and the contract is fulfilled by landing at the destination with them alive. Escorts and observation targets spawn
friendly, rescue targets start disabled, and losing an escort fails the contract.

## Reputation

Every kill feeds two systems decoded from the real data. Your **combat rating** grows by
each destroyed ship's Strength value and climbs EV's ladder (Harmless → Ultimate Rating).
Your **legal record** is tracked per government: killing a ship angers its government and
its allies (via the decoded `gövt` class/ally/enemy matrix) and pleases its enemies.
Missions apply their own `CompGovt`/`CompReward` swings. Both gate mission availability,
and shipyards/outfitters honor each item's own availability expression, so Federation
military hardware only appears once you've earned it.

## Special commodities

Beyond the six exchange goods, Nova's `jünk` resources are traded only at named
worlds — each one lists the spöbs that stock it and the spöbs that will pay for it, and
carries its own price. They appear under **Local specialities** in the Trade Center of any
world on either list, so Vrenna Ice Lizard Pelts change hands where the data says they do.

This is also what a röid's `YieldType` means when it reads 1000 or more: the value is
`1000 + n` for the nth `jünk`. Ice fields yield **Water**, crystal fields yield **Opals**,
and metal fields yield plain Metal — all three land in your hold under their own names.

## Asteroids and mining

Systems carry the asteroid fields their data describes — each system's count and its
16-bit `AstTypes` mask pick from the sixteen `röid` types, drawn with the real rock
sprites. Shoot them and they break along their own fragment chains (Huge → Big → Medium →
Small) and spit out resource boxes worth exactly what that röid's `YieldType`/`YieldQty`
say. Fit an **Asteroid Scoop** and the boxes tractor in as cargo. Flying into a rock hurts.

## Planetary domination

Hail an inhabited world (**Y**) and demand tribute. Its `DefenseDude` fleet launches in
waves — the `DefCount` encoding is the Bible's own (2206 means 120 ships in waves of six),
so Earth's 600-strong garrison is exactly as unassailable as it should be. Beat them all
and the world submits, firing its `OnDominate` bits and paying its real `Tribute` every
day; press **D** again to release it.

## Cloaking

Cloaking devices honour their flag bits: visible-on-radar, drop-shields-on-activation,
collapse-when-hit, and fuel or shield drain per second. Nova's own Cloaking Organ bleeds
8 shield points a second and fails when they run out; the Fed device dumps your shields
the instant it engages. While cloaked, hostiles lose track of you.

## Outfits

Outfit effects are read from each item's `ModType`/`ModVal` pairs, in the Bible's own
units: shield capacity and recharge (1000 = a point per frame), armor, cargo space,
acceleration, top speed, turn rate (100 = 30°/sec), fuel capacity (100 = one jump), and
afterburners (fuel units per second). Engine upgrades add to the hull's raw stats before
conversion, so a Sigma Engine Tune-up moves speed, acceleration, turning and fuel exactly
as the data says. Also wired: escape pods (eject and live), IFF decoders and density scanners (which gate
radar colour-coding and asteroid contacts), auto-refuellers, fast jump and hyperspace
speed modifiers, inertial dampers, repair systems, and the four jamming types — a
`JamVuln` match lets your jammers shake a missile's lock, so an IR jammer really does
counter an IR missile. **Marine platoons** let you storm a disabled ship and capture it,
with odds weighed against its crew; a failed assault costs you the platoon. Without a
platoon you can still rush a disabled hull with your own crew, but spacers aren't soldiers
— they count for a quarter of what marines do, and a beaten-back boarding party costs you
hull instead.

**Ionization** is live: Nova's system-killers (Ion Cannon, EMP Torpedo, EW Missile,
Nanites, Polaron) dump ion charge into what they hit, and an ionized ship crawls, can't
fire and can't engage its hyperdrive until the charge bleeds off — ion dissipators and
absorbers tune both ends of that. **Cloak scanners** honour their flag bits, revealing
cloaked hulls on radar, on screen, or making them targetable; AI ships whose class carries
cloaking flags now vanish when they run. **Reinforcement inhibitors** suppress the govt
response fleets that otherwise arrive when you make enemies in their space.

## Flying

Thrust and inertia are EV's: **↓** swings your nose onto the reverse of your course so a
burn kills your speed. Hulls flagged inertialess in the data — the Vell-os ships, the
Wraiths, the Krypt Pod — instead stop dead when you let off, and **↓** brakes them
outright. An inertial damper outfit does the same for anything else.

Carriers scramble fighters by selecting the bay as a secondary (**W**) and firing it
(**Left Ctrl**), and recall them with **C**; a fighter that makes it home stows itself
back in its bay.

## Weapons

All of Nova's weapon guidance modes are implemented: unguided guns, homing missiles,
freefall bombs and rockets, fixed and quadrant turrets, **beams** (hitscan, drawn in each
weapon's real colours and reach — the Pulse Laser is pink and 400px long because the data
says so), **point-defense** turrets and beams that shoot down incoming missiles by
themselves, and **fighter bays** that launch carried ships (`AmmoType` names the ship
class) to fight alongside you. Your fighters and your shots pass harmlessly through each
other.

## Combat

Press **Tab** to target, **Space** for primary weapons, **Left Ctrl** for secondaries (missiles need a target and ammo). Traffic is spawned from each system's real `düde` tables, so you meet the ships that government actually flies; warships hunt hostiles on their own, and pirates hunt you. Shields recharge; armor doesn't. If your armor gives out, a tug hauls you to the nearest port and repairs cost 10% of your credits — unless you're flying **strict**, in which case death deletes the pilot, as in the original.

Buy weapons and upgrades at any **Outfitter** (limited by your ship's free mass), and ships at any **Shipyard**.

## Disabling, boarding and piracy

Ships don't simply explode: once armor falls past 33% (10% for tougher hulls, per the
shïp flags) they go **disabled** — drifting, powerless, out of the fight. Pull alongside a
disabled ship, match its velocity and press **B** to board it. What you take is decided by
the düde `Booty` flags: credits scaled to the hull's value and whichever of the six
commodities that class carries. Piracy is noticed — the victim's government and its allies
remember it. Each ship can only be stripped once.

## Named captains

516 `përs` captains fly the galaxy, appearing as roughly 5% of new ships and never
returning once killed. They use their own ship class, government, and shield modifier, and
they talk: their radio lines and comms replies come from STR# 7101 and 7100. Some carry a
`LinkMission` — hail them and ask what they want, or board them, and they hand you the job
over the radio.

## Targeting and the map

**L** targets stellars the way EV Nova did: the first press selects the nearest world and
further presses cycle onward, with the target shown in the sidebar; press it again in
range and you land. **Tab** does the same for ships. Both are marked with Nova's own
animated target cursor (spïn 650), lifted straight from the game.

The galaxy starts dark. Systems are charted as you fly them, unvisited neighbours show as
grey dots, and everything else stays hidden until a **map** outfit reveals it — the
`ModType` 16 ranges are honoured, so a "Map" that charts three jumps really does light up
everything within three jumps.

## Hailing

With a world targeted, **Y** raises its traffic control: ask for landing clearance, ask
what the port offers, or — if your record there is poor — bribe the controller.

Press **Y** with a ship targeted to open comms. Replies depend on who they are and what
you've done: friendly traffic will transfer a jump of fuel or tell you what's happening
locally, while raiders can be begged or bribed into breaking off — the badly damaged and
the barely-provoked are the ones who listen.

## Hypergates and wormholes

Gates are stellars flagged in the data (`Flags2` 0x1000 / 0x2000), and landing on one
opens a destination chooser instead of a spaceport. Hypergates list their real
`HyperLink` network — 35 gates wired to each other across the galaxy — and travel is
instant and free of fuel. Wormholes (24 of them) drop you somewhere far away without
telling you where first.

**The ring opens for you, not on a timer.** Of the 65 stellar graphics Nova ships, exactly
two animate, and they animate differently — which the sheets themselves say. The
hypergate's 42 frames climb from a dark, closed ring (627 opaque pixels) to a bright open
one (3398) and plateau there: a one-shot opening, not a loop. The wormhole's 32 frames hold
flat brightness and the last frame is identical to the first: a seamless cycle. Every other
stellar is a single still.

So a hypergate sits shut. Press **L** beside one and the ring powers up, and only when it
is fully open does the destination chart appear. It holds open while you choose, and shuts
again if you back out or fly off — and shuts behind you when you come out the far end. A
wormhole has no ring to open, so it simply turns, always, and you fly straight in.

Not every gate answers. The data splits them cleanly: 19 working gates carry Nova's
can-land bit and belong to govt 183, named "Hypergate"; the other 16 drop that bit, have no
government at all, and wear a separate sprite the resource calls "Broken Hypergate". The
dead ones stay dark however long you sit in front of them — which is what the storyline
means when a Rebel technician offers you "the parts of it that work, that is".

Nova has no artwork for a gate dialog — its interface pictures name a Spaceport, a Bar, a
Map, a Trade floor and so on, and nothing for a gate — so the chooser plots the network
instead of only listing it: every linked system at its real galaxy-map position, joined to
the gate you're standing on, hoverable against the list and clickable to travel. Ends you
have not visited are drawn dimmer but still named, because a hypergate posts its own
network. A wormhole gets a blank chart, since it does not tell you where it goes.

## Escorts

Inhabited spaceports have a **hiring hall**: pay a tenth of a hull's price up front and a
thousandth of it a day, and its pilot flies with you. Escorts jump with you, form up when
you launch, and take orders in flight — **E** to send the wing at your target, **F** to
call them back to your wing, **V** to pin them to a spot they'll defend but not leave. The
same three keys command fighters off your bays. Wages are drawn whenever you land, and a
pilot who can't make payroll wakes up alone.

## Weapon mounts

Hulls carry only as many guns and turrets as their `MaxGuns`/`MaxTurrets` allow, and the
outfitter counts what's already bolted on — a Shuttle mounts two guns and no turrets, so
the third blaster is refused. Nova's guidance modes decide which pool a weapon draws on:
turrets and beam turrets take turret mounts, fixed guns, beams and quadrant weapons take
gun mounts, and missiles and fighter bays take neither. The **Sigma Mount Reinforcement**
adds its real +4 guns and +2 turrets. A few of Ambrosia's own hulls ship with more weapons
than their limits allow — the Manticore carries eight turrets against a MaxTurrets of four
— so the rule is Nova's: you keep what a hull came with, you just can't add to it.

## Which ship a picture belongs to

Nova's 288 ship types share only **65 hulls** between them — every second-hand Shuttle,
Pirate Valkyrie and Auroran variant draws from one of 65 `rlëD` sprites — and it keeps one
shipyard portrait and one target silhouette per hull, reusing it "for all higher-numbered
ship types with the same base sprites". The sprite extractor records each ship's `rlëD` and
resolves it to a `baseId`, the lowest ship id drawing from it, which is the hull whose
pictures apply.

Reading that rule as "walk down ids until a picture turns up" is what it looks like from
the outside, and it is wrong: ids are sparse and unrelated, so the walk crosses hull
boundaries. It put a Rebel Thunderhead in front of 95 unrelated ship types and left 231 of
288 ships showing another hull's portrait. Going through `baseId` instead, 287 of 288 ships
get their own picture — the Escape Pod is the one hull Nova never drew.

Outfit pictures need no such rule. `PICT 6000 + id - 128` is exact, and every one of the
228 pictures Nova ships lands on a real outfit, so the index is sound on its own. Fourteen
outfits simply have no art; four of those are variants or renames of something that does
("Thorium Reactor - ionisation" beside "Thorium Reactor") and borrow it by name. The
remaining ten — the Hellhound Missile, the Light Cannon, Repair Droids, the IFF Projectors
and friends — were added to the scenario without pictures, and keep a named placeholder.

## The interface art

The title screen runs on Nova's own artwork, including rlëD 8020 — a seven-frame strip of
button icons that lives in the middle of the emblem. Rolling over a button swaps in its
icon (a figure in a pod for a new pilot, an EXIT sign for quit) and the ATMOS glyphs are
the resting frame. The pilot readout shows the hull you're flying as the same red target
silhouette the HUD uses (`PICT 3000 + shipID - 128`), falling back from named variants to
their base hull.

The landed panels wear Nova's real window chrome. Its interface PICTs are bespoke per
screen — 8529 is literally the Galaxy Racing Network panel — so they can't be dropped into
a layout that reflows; PICT 8506 is the exception, a plain rectangular window that
nine-slices into scalable chrome. Its slice numbers are measured off the file rather than
eyeballed.

The extractors keep each resource's own Mac name where the `.rez` carried one, so an
otherwise anonymous interface picture says what it is. That is how the frames identify
themselves — 8500 is "Spaceport", 8503 "Bar", 8509 "Map", 8020 "Main menu rollover" — and
how PICT 9000-9008 turn out to be news banners ("Hyper News Network", "Polaris News
Service"), the art for a news feed that doesn't exist yet.

The names settle things size alone gets wrong. The sixteen 100x100 pictures at 8530-8563
look like comms portraits and are nothing of the kind: they are "Racing buttons", in
unclicked, clicked, win-state and disabled sets, belonging to the racing game whose
backdrop is 8529. The one genuine 100x100 portrait is PICT 7800, and its name is the
answer to what it is.

## All your base

PICT 7800 is named **CATS**. `përs` 640 is a captain called "Zero Wing" who flies a
Leviathan with five times its shields, and his CommQuote is the Zero Wing line out of
STR# 7100. Hail him and you get the line with the man himself filling the comms panel.
Nova shipped in 2002; the joke was current.

## A note on which copy of Nova you extract from

Entry indices in a `.rez` resource map are numbered across the whole set of files rather
than from 1 within each one, and each file records its own base at header offset 16. The
Mac 1.1 release happens to start every file at 1, so the difference is invisible there;
the Windows 1.0.x repackaging does not, and reading its indices as 1-based silently yields
nothing out of twenty of its twenty-two files. `scripts/rez.mjs` honours the base, and is
now the only copy of that parser — `extract-nova.mjs` used to carry a byte-identical
duplicate, which is exactly how the two drifted apart.

The assets here come from the Mac 1.1 build. The Windows 1.0.x data is a slightly older
edit of the same scenario — different weapon entries, uncorrected typos in a few `dësc`
strings — so the two are not interchangeable.

## Roadmap ideas

- Banking frames and weapon trail particles (animated stellars are done — the gates were
  the only two, and they now turn)
- Remaining mission depth: `Require`/`Contribute` bit fields, negative-pay reward encodings
- News and better bar scenes; in-flight music (the soundtrack is title-screen only)
- Automated tests — there are none, and the `.rez` decoders and the ncb expression
  evaluator are the parts that would most repay them
- Plugin loading (ARPIA II, Polycon, and friends use the same resource formats). Several
  data paths are already wired for it but inert against the stock scenario: missions gated
  on holding a world (`AvailRecord` ≤ -32000), galaxy-wide and news-only `öops` disasters
  (`stellar` -1/-2), and the `Q`/`T`/`Y` ncb ops. The `X` op is still unimplemented — it
  appears only in the tutorial missions and its operands don't line up with their
  destinations, so its meaning can't be recovered from the data alone.

**PWA + GitHub Pages deployment is now complete** (see "Play online" above).
