# EV Nova web reimplementation

TypeScript + Vite, no framework; canvas flight sim + HTML landed screens.

## Data pipeline

Game data is extracted from the original Mac/Windows resource files by
`scripts/extract-*.mjs` into `public/nova/{galaxy,sprites,picts,sounds}.json`.

- Source `.rez` files: `/Applications/EV Nova/Nova Files/` (22 of them).
- `scripts/rez.mjs` exports `parseRez()` — use it for throwaway probe scripts.
- Re-extract with, e.g.:

```bash
node scripts/extract-sprites.mjs "/Applications/EV Nova/Nova Files"
```

A second, identical copy of the data lives in the Wine install under
`~/Library/Application Support/WineNova/SharedSupport/prefix/drive_c/Program Files/EV Nova/`.
An older copy that used to sit in `~/Downloads/EV Nova/` was deleted in July
2026; it differed only in upstream fixes (6 `desc` typos, and `cron` 381's
OnStart/OnEnd, which the newer build swaps and whose PreHoldoff it clears).
Data extracted before that date will show those three sections as changed.

Ship sprite sheets are named for the **rlëD they came from**, not the shän that
referenced it, and written once — Nova's 288 ship types share only 65 hull
images, so per-type naming quadrupled the output.

## The Nova Bible

The authoritative format spec is at
`/Applications/EV Nova/Tools/Original Documentation/Nova Bible.txt`.
It is non-UTF8, so **grep needs `-a`**. When that path is missing, the same
prose is mirrored at
https://andrews05.github.io/evstuff/guides/evnbible.html — useful for reading,
but still verify offsets against extracted game data / raw rez. The Bible's
field order is not always struct order.

**Always verify field offsets empirically before trusting the doc.** Its prose
is stale in places (it says "twelve fields" for weapons and "SpecialTech (x8)"
where the struct has 4 and 3), and — more dangerous — **its field order is not
always struct order**: the shän section prints the shield block where the data
actually holds `Flags`. Fields the doc names as scalars are sometimes arrays
(shän's weapon exit points are four mounts per class, not one).

Good empirical checks, in rough order of strength:

1. **Cross-field correlation.** shän `Flags` was confirmed because every hull
   with the banking bit carries exactly 3 sprite sets and every animated one
   carries 6.
2. **Against the assets.** `BaseSetCount × FramesPer` equals the base rlëD's own
   frame count for all 288 hulls.
3. **Semantics by name.** wëap `SubType` was confirmed because "Polaron
   Multi-Torp." splits into 5 of wëap 148, which is "Polaron Torp.".
4. **Adjacency to an already-verified field.** ship `InherentGovt` sits at @72
   because the Bible puts it immediately before Flags, and Flags is @74.

Comments should explain *why* an offset is what it is, citing the Bible or the
empirical evidence.

## Conventions

- Verify with `npx tsc --noEmit` and `npm run build`.
- Dev server runs on `:5173`; the game object is exposed as `window.game` for
  runtime probing (`mode`, `player`, `ship`, `weaponSlots`, `landedUi.view`,
  `activeInterfaceId`, …). Use it to confirm behaviour rather than assuming.
- Title music is off under `npm run dev` and on in a production build; override
  with `localStorage.music = "1"` / `"0"`.

### Probing from an automated browser session

`requestAnimationFrame` is paused when the tab is backgrounded, so canvas
screenshots can be stale. Verify by calling into `window.game` directly, or by
compositing the extracted sheets into a scratch canvas. Note that a dynamic
`import()` of a `/src/...` module may yield a *separate* module instance with
empty state — reach through `window.game` instead.

**`applyShipType()` writes `player.shipId`** — restore the original hull after
probing with it, or you will change the pilot's ship.

## Status

An audit found roughly a third of the Bible's documented fields unread. Work is
proceeding resource by resource.

### Recently completed — don't redo

**Hypergates / wormholes (Bible-aligned transit).** Selecting a working
hypergate (L cycle or click) starts the ring open animation; landing on it
when slow enough opens the **normal galaxy map** as a destination chooser —
same fog of war, gold link lines only to that gate's HyperLink systems, arrow
**Tab** cycles links (highlight only — map does not pan), Enter/Travel jumps.
Transit is **instant** (no fuel, no calendar day) after a short hull bleach:
ships fade to white on enter and recolour from white on exit (`gateFlash` on
`Ship`; ~0.38s in / ~0.55s out). You emerge at the **centre** of the far gate
moving outward slightly faster than landing speed, so you must brake to dock
again; the far ring is open and immediately closes (L re-opens). Wormholes have
no chooser: land → random far end (unlinked pool or HyperLinks). CustPicID
drives the open/working frame split; CustSndID is emerge angle in Nova degrees
(0 = up, clockwise). Stock rings share one orientation, so a missing/invalid
CustSndID exits at ~4:00 (120°) rather than a random bearing. gövt Flags2
0x0020/0x0040/0x0080 steer NPC leave-via-gate/wormhole vs edge jump. NPCs
leaving via a gate get the same enter bleach before they leave the board.

**Hyperspace jump sequence is Nova's full entry, not a charge timer.**
`JumpSequence` in `game.ts` runs three phases: **braking** (face retro and burn
until nearly stopped), **turning** (point at the destination system on the
map), **burning** (accelerate well past cruise so the ship streaks across the
current system), then the white flash and arrival. The Bible does not narrate
the beat, but it does name the controls:

- shïp **Flags** `0x0001` / `0x0002` / `0x0004` — slow / semi-fast / fast
  jumping at 75% / 125% / 150% (scales burn duration and top speed, not the
  calendar day cost; ModType 22 still owns days/jump).
- shïp **Flags2 `0x0020`** and oütf **ModType 37** — "jump without slowing
  down"; skip the retro phase (Vell-os, several cloaking variants, etc.).
  Inertialess hulls and an already-slow ship also skip braking.
- The no-jump zone (ModType 23 / radius 1000 about the origin) still gates
  *when* you may start the sequence; it does not replace it.
- The warp-up sound starts only on the **burn** phase (`beginJumpBurn`), not
  during braking or aligning.

Do not collapse this back into "turn toward dest and wait N seconds at cruise
speed" — that was the old behaviour and reads wrong in play. Burn numbers are
feel-tuned (~1.7s / mult, overspeed ≥ max(cruise×4.5, 950)×mult); retune in
`startJump` if a reference build disagrees, do not invent new phases.

**Landed menus take arrow keys.** In `landed.ts`, Up/Down (and Left/Right on
grids and the two-column spaceport) step the selection; Enter activates
Accept / Buy / Hire / the focused port button. Covers spaceport, trade, BBS,
shipyard (3-col), outfitter and hire hall (4-col), bar actions, and gamble
racers. Hypergate destinations use the canvas map chooser (Tab cycles links;
see hypergate note above). Letter shortcuts (B/N/T/S/O/I/R/L) and Esc-to-back
are unchanged. Keys the handler acts on must still call `game.swallowKey`.

**Landing / mission dialogs** (`events`, `offer`): Enter fires the affirmative
(`data-modal-default` — Accept / Continue); Esc fires the negative
(`data-modal-cancel` — Refuse / Decline) or the sole Continue. The Bible never
names these keys. Can't-refuse offers have no cancel; Esc must not Accept.
I in flight opens `InfoUi`; I while landed opens the spaceport Mission Log
(inert with no active missions) — do not route landed I through
`openMissionInfo`.

**In-flight info panels (I / P / Alt-K) must not sit in the full-viewport
force rule.** A PWA pass put `#info-ui`, `#hail-ui` and `#plunder-ui` under
`inset: 0 !important` with `width/height: 100vw/100vh`. Those dialogs centre
with `left/top: 50%` + `translate(-50%,-50%)`, so the combo shoved them
off-screen and the I mission log looked dead. Only `#game`, `#landed-ui`,
`#menu-ui` and `#intro-ui` belong in that force rule.

**The flight sidebar is DOM, not canvas** (`src/ui/hud.ts` + the `.hud-*` block
in `style.css`). It implements Claude Design 2a, "Deep Glass · Orbital", from
the *EV Nova Sidebar Redesigns* project. Layered gradients, a dashed target
frame, glow shadows and two webfonts are a stylesheet in CSS and a few hundred
fragile lines in canvas 2D, and the landed screens were already HTML. The one
per-frame thing — the scanner's moving contacts — is a small nested `<canvas>`.

Consequences worth knowing:

- **ïntf StatusBkgnd and the ïntf rects no longer position anything.** The
  plate was already deliberately undrawn; the rects cannot express this layout,
  so the arrangement is the design's. The resource still supplies *colours*
  (ShieldColor/ArmorColor/FuelFull/FuelPartial, BrightRadar/DimRadar), and
  gövt Color still tints the government name, so a plug-in restyles the panel
  even though it can no longer move things.
- **Fonts are self-hosted** in `public/fonts` (Chakra Petch, JetBrains Mono,
  latin subset only, 134 KB) rather than pulled from Google — the game reads
  everything else locally and should not need the network to look right.
- `HUD_W` in `ui/hud.ts` is the single source of the sidebar width; `game.ts`
  takes `SIDEBAR_W` from it so the reserved canvas and the panel cannot drift.
- The HUD reads private Game state through small accessors (`hudClock`,
  `hasIff`, `cloakBits`, …) rather than those fields being made public.
- On a window shorter than 830px the key hints are dropped and the scanner
  clamps down by `vh`; the radar scales off the smaller half-dimension so a
  letterboxed scope stays circular.

Earlier passes: `colr` emblem position · `outf`
flags/DispWeight/OnPurchase/OnSell · `govt` legal model
(CrimeTol/ScanFine/\*Penalty/InitialRec/MaxOdds), replacing a hardcoded
reputation formula and a name-matching hostility regex · `char` template
(OnStart bits, starting legal records, StartYear/DatePrefix/DateSuffix driving
the calendar) · `cron` news (IndNewsStr/NewsGovt/GovtNewsStr) · `spob` ambient
sound · hull default outfits made sellable · `syst` Visibility variant
selection · the bar/holovid/gamble/hire-escort screens.

**PICT 20000 + shipID — the shipyard's Info dialog, and the pictures behind
it.** A whole PICT range was going unextracted: 63 full-bleed 600x400 renders
of each hull in space, one per rlëD exactly like the 5000-series showroom shot
and the 3000-series target silhouette, and every one naming itself in its
resource name ("Shuttle" at 20128, "Rebel Lightning" at 20274). The Bible's
reserved-ID table does not list them. They now back a shipyard **Info** dialog,
which is where the hull's full specification lives — Nova puts it behind a
button rather than in the showroom, so the right-hand column is the picture and
the price block (Ship Price / Trade-In / Final Price / You Have) and the grid
cells carry no price at all. Esc closes the dialog and nothing else reaches the
counter under it.

Nova files one of the 63 wrongly: the Rebel IDA Frigate is ship 412, but its
picture — an IDA Frigate in rebel green, named for itself — sits at 20381,
where ship 381 is a Vell-os Dart that already has its own at 20173. A by-name
fallback recovers it (the trick `outfitPict` already uses for variants) and
rescues exactly those three hulls and nothing else. The Kestrel and the Escape
Pod have no render at all; the dialog falls back to the showroom shot.

**`shan`** — banking (158 hulls), sequence and folding animation, running
lights with all three BlinkModes, and weapon exit points (Gun/Turret/Guided/
Beam × 4 mounts, with Up/Dn perspective compression and Z offsets). Shots and
beams now leave the hull at the mount the weapon's `ExitType` names, and
alternate between mounts shot to shot.

**`weap` tail** — Seeker, GuidedTurn (per-missile turn rates replacing one
hardcoded constant), BurstCount/BurstReload, submunitions
(SubCount/Type/Theta/Limit), ProxSafety, MaxAmmo, Recoil, LiDensity (lightning
beams), Durability, Flags3, ExitType.

**`ship` InherentGovt** — the hull's own government, which now supplies an
NPC's govt where its düde names none, and swaps the player's status bar to
that government's `intf` (Polaris → 129, Pirate → 133, Vell-os → 134, …).

**ScanMask — the contraband system, now live.** gövt `ScanMask` @50, oütf
`ScanMask` @1006 and jünk `ScanMask` @36 are one interlocking 16-bit mask, and
reading them together produces exactly the right smuggling rules: the
Federation (0x8000) bans fighter bays and bio-weapons, the Auroran Empire
(0x4000) EMP torpedoes and Monkdillo Shells, the Polaris (0x2000) adds the
Wraith Cannon, the Krypt (0x0020) care only about the Ancient Vell-os
Sculpture, and the Pirates (0x0800) confiscate nearly every valuable cargo in
the game. One of the Federation's illegal outfits is literally named "Illegal
Medium Blaster". Patrols now scan passing traffic; `applySmuggling` already
existed with the ScanFine/SmugPenalty machinery and had never been called.

Also found in the same pass: oütf `ItemClass` @1004 is set on exactly one
outfit, "Dr Ralph's Exploration Map" = 25, matching the only përs with a
GrantClass ("Dr Ralph" = 25) — the two fields confirm each other outright. And
oütf `BuyRandom` @1008 now gates outfitter stock the same way hulls are gated
in the shipyard: 51 story-granted items (the Vell-os mind powers, the Bureau
Bomb) read 0 and are never sold, 36 read 100 and always are, and the rest turn
over daily. Measured against the shipped values the roll tracks them exactly —
a 5% item stocks 5.2% of days, a 50% item 49.9%, a 90% item 90.0%.

**`colr`** — the whole 244-byte resource, which was not extracted at all. It
packs gaplessly in the Bible's field order and every field identifies itself:
"Geneva"/9 and "Charcoal"/12 fall where the two font-name strings belong, the
progress bar reads as a 200x10 Rect centred on the window, and Button1-6 come
out at exactly the six positions `menu.ts` was already using. Those had been
read off this resource by hand and typed in as literals, along with the logo,
rollover and three slide-plate positions; all of them now come from the data,
so a plug-in that moves the title screen works. The colours are published as
CSS variables (`--ev-list-*`, `--ev-grid-*`) and drive the list and grid
selection styling.

**`syst` BkgndColor / Murk** — resolved. BkgndColor is a u32 at **@142** and
Murk an int16 at **@146**, in the Bible's own order; the previous pass had
them the other way round and could not make the bytes fit. Byte 142 is zero on
all 545 systems — exactly the leading `00` of `00RRGGBB` — and no colour
channel anywhere exceeds `0x7f`, so every value is the dark tint a space
backdrop wants. The thing that looked like a struct mystery (bytes 143 and 144
holding the same value on nebula systems) was just R and G being equal in an
olive-grey haze. 53 systems carry a tint, 111 a murk, and every tinted system
also has murk.

**`spob` SpecialTech (the real find) / `misn` DatePostInc / `junk` BuyOn+SellOn**
— chasing spöb Fee turned up something bigger: the Bible's "SpecialTech (x8)"
is correct and an earlier pass calling it 3 was wrong. Three sit inline at
@14-18 and the **other five were appended to the end of the record** at
@1092-1100. Reading them unlocks **486 items across 99 worlds** that were
invisible in shipyards and outfitters. Fee itself (@838) reads 0 on all 411
stellars — no shipped world charges a landing fee, so it is extracted and
otherwise unused. DatePostInc @72 now advances the calendar on mission
completion (136 missions; escort runs cost 3 days, "Rescue Raczak" 10), which
matters because salaries, cröns and time limits all move with the date. Junk
BuyOn/SellOn gate each direction of a special-commodity trade.

**`roid`** — PartCount/PartColor (debris in each family's own colour: white
ice, tan dust, deep-blue crystal, grey metal), FragType1 **and** 2 with
FragCount (a Metal Huge sheds a mix of Metal Big and Dust Medium, not clones),
ExplodeType, and Mass, which sets how far a hit shoves a rock. Replaced a
hardcoded explosion, a hardcoded two fragments, and a FragType2 that was never
read.

**`pers`** — ActiveOn (control-bit gate on whether a captain is in play),
HailPict, and the per-captain loadout (WeapType/WeapCount/AmmoLoad, x4 not the
x8 the Bible prints). Negative WeapCounts strip a hull's standard weapons, so
Ambrosia flies a Pegasus with its stock cannon removed. Also found: an
undocumented trailing string at @314 carrying the **ship's name** — Jack
Folstam flies the "Night-Master" — now shown in the comms panel. Reading
HailPict replaced a hand-written `PERSON_PICTS` map of the single case anyone
had spotted (përs 640 "Zero Wing" → PICT 7800), so plug-in captains work too.

**gövt `Color` / spöb `MinStatus` — the star map's real colours.** Color is a
u32 at **@164** (ShipColor @168, zero on all 68) and identifies itself
outright: all eight Federation resources read #2c2caf, all five Aurorans
#cf0c0c, both Polaris #7c1c7c, Vell-os #c3c310, Rebellion #2baa2b — sixteen
name-groups, each internally identical, which no other 4-byte window manages.
It replaced a `(govtId * 47) % 360` hue invented per id, and now drives both
the system dots and the territory haze. MinStatus @22 sits between Govt @20 and
CustPicID @24 and is what makes Nova's third map colour: a system whose every
inhabited world wants a better record than you have is drawn red. Reading the
two together reproduces the shipped map exactly — Kerella (Spacedock VI wants
2), Rigel (Rigel III, 4) and Lesten (Menin, 5) come up red inside Federation
blue, and Procyon and Capella, which hold nothing but uninhabited rocks, come
up grey. MinStatus is enforced on landing too: below it a world refuses you
clearance. Gates are exempt — all 19 stellars reading the Bible's 32767 "player
can never land" are hypergates, which you fly through rather than land on — and
so is a world you have already dominated.

**Map arrows and the fog of war.** mïsn Flags settles the markers: 0x0002 is
"don't show the red destination arrows", 0x0100 the briefing's green arrow and
0x0200 an extra arrow for the ShipSyst. A mission destination is now plotted
however far out it lies — the dot and its arrow appear with none of that
system's lanes, which is what an uncharted destination looks like in Nova. The
mission board and the offer panel carry a Map button, and M works from a landed
screen; the map remembers where it was opened from. ModType 16 charts now apply
**when the outfit is acquired** rather than on every stat recompute, which had
a 1000-credit map quietly re-charting from wherever you happened to be standing.

**Spaceport keyboard shortcuts.** B bar, N mission BBS (M being the map), T
trade centre, S shipyard, O outfitter, I mission log, R refuel, L or Esc to
leave, and Esc backs out of any counter to the spaceport by pressing that
screen's own Back button. They work from any of the counters, not just the
spaceport, so you can go from the outfitter to the shipyard without stopping in
between, and each key refuses a counter this world doesn't have rather than
opening an empty one. Inert on the modal panels (a mission offer, the landing
events) and while an input has focus.

**The landed screens must swallow the keys they handle** (`game.swallowKey`).
They are DOM, so their keydown handler runs during event dispatch, ahead of the
next `update()`; any key that changes the mode was otherwise handled twice.
M opened the map from a landed screen and the loop's own M handler shut it
again one frame later, and Esc left the planet and then quit to the main menu.
Both only reproduce with the loop running — a backgrounded tab pauses
`requestAnimationFrame`, which hides it — so drive `game.update()` by hand when
testing a key that crosses between the DOM UI and the loop.

**mïsn `CompGovt` was being read at the wrong offset, so no mission had ever
moved the player's legal record.** It sat at @90, which holds 127 on 704 of the
791 missions and takes six distinct values, none of them a valid govt id
(Nova's run 128-195) — `applyCompReward`'s `< 128` guard then threw every
mission reward away, and with it every MinStatus gate and every AvailRecord
mission in the game. The field is **@46**: 453 missions read a valid govt there
and 336 the Bible's "ignored" -1, which is 789 of the 791, and it names itself
— the `;Vellos` missions come out Vell-os, `;Rebel` Rebellion, `;Fed`
Federation, the interrogations Bureau. The struct packs gaplessly in the
Bible's order through here (ShipGoal@38, ShipBehav@40, ShipNameID@42,
ShipStart@44, CompGovt@46, CompReward@48, ShipSubtitle@50), putting CompGovt
immediately before the CompReward that was already read correctly.

**spöb MinStatus is measured against the stellar's own government**, not the
system's, with the system as fallback for an independent world. The Bible says
"your record in the current system", but the field sits in the spöb's
governmental-affiliation pair behind Govt, and 18 of the 170 gated stellars
belong to a different government than the system around them. Spacedock V
settles it: a Federation station (MinStatus 2) in Roughnecks space, where Fed5
returns and Fed6 is offered, while the Federation Resupply chain pays only in
Federation record — read against the system, that storyline cannot be
finished. The fallback matters for the four independent gated stellars
(Reflex-ion, Pan, Beacon, Keystone, all -5). ränk Flags **0x0200** — "all
planets of the affiliated government will let the player land ... regardless of
their MinStatus field" — is honoured too; 19 of the 31 ranks carry it.

**AI ships visit planets instead of evaporating on them.** Any NPC within 60px
of a stellar was deleted outright, and the spawn rolled a flat 70% chance of
sending *anything* at a random one — so warships and interceptors made for the
nearest world and popped. The Bible's four AI types divide the work: only
"1 - Wimpy Trader" and "2 - Brave Trader" *visit* planets, "3 - Warship ...
jumps out if there aren't any" enemies, and "4 - Interceptor ... parks in orbit
around a planet if he can't find any". A trader now touches down, comes off the
board for 6-20s and lifts off again on a fresh errand; an interceptor holds a
circle 150px above the surface, chasing a mark derived from its own bearing
(running the orbit angle off a clock let a distant ship chase a mark that
outran it, and one parked 1095px up and stayed). Folding hulls stow their parts
on final approach and put them back out on the climb, which is what the Bible
means by sprites "cycled upon landing, taking off, and entering/exiting
hyperspace" — an animation a ship that never took off could only half play.

**The no-jump zone.** You could enter hyperspace from a standstill on top of a
planet. The Bible names the rule exactly once, in oütf ModType 23 — "amount to
increase or decrease the no-jump zone's radius by (the standard radius is
1000)" — and the single outfit that uses it settles the geometry the doc never
states: the Horizontal Booster (ModVal **-500**) "allows you to enter
hyperspace from much closer to the **system center**". So it is a circle of
radius 1000 about the origin, not a skirt around each stellar — though 318 of
the 344 placed stellars sit inside it, which is why it reads from the cockpit
as being too close to the planet. Arrival is at 1700, safely outside. The
autopilot flies out of the zone before jumping rather than asking every frame.
Once outside, the jump sequence itself is the three-phase entry described
under "Recently completed" (brake → align → high-speed burn → flash).

**Capturing a ship asks what you want done with her.** A successful boarding
silently swapped your hull for the prize and threw your own ship away. Nova
offers both, and the shïp resource is built for both — the plunder panel now
turns into a prize screen with *Make It My Ship* and *Add To My Fleet*, and
taking the helm drops your old hull into the wing. Captured escorts draw no
wage (they are property, not a contract) and sell for shïp **EscSellValue**,
which is zero on all 288 hulls and so always takes the Bible's documented
fallback of 10% of cost — 60,000 for a Starbridge.

That needed the **end of the shïp record, which was entirely unread**: the
Bible prints Subtitle, Flags3, UpgradeTo, EscUpgrdCost, EscSellValue and
EscortType between OnRetire and ShortName, but the struct puts ShortName
straight after OnRetire and appends the block to the end of the record — the
same trick spöb plays with its last five SpecialTechs. OnCapture @976 and
OnRetire @1231 are 255-byte strings packing gaplessly into ShortName @1486
(171 hulls set OnCapture, every one to `b8888`; OnRetire is empty throughout),
and from @1766 the appended block runs Subtitle (the Starbridge's is
"Class A"), Flags3 @1830 (eight values, all decomposing into documented bits),
UpgradeTo @1832 (154 valid ship ids, 134 reading the documented -1),
EscUpgrdCost @1834 as int32 (5,000 for a Shuttle, 1,000,000 for a Leviathan),
EscSellValue @1838 as int32, and EscortType @1842, which partitions the fleet
exactly 25/106/106/51 into the doc's Fighter/Medium/Warship/Freighter.

**Being shot now starts a fight.** `provoke` sent *every* ship fleeing, so
nothing in the game ever returned fire unless it had been born hostile. The
düde AIType decides, and the Bible names all four: only type 1 "Wimpy Trader"
runs, and it is the rarest — 20 of Nova's 147 düdes, against 12 brave traders,
65 warships and 50 interceptors, all of which now turn and fight. The
interceptor's documented "piracy police" clause is in as well: firing on a
non-enemy ship turns any interceptor watching from within 1600px. No legal
penalty is charged for opening fire — see ShootPenalty under "Known gaps".

**Beams follow the ship firing them.** `BeamFx` froze its world coordinates at
the moment of firing and then sat there for the weapon's Duration — up to 0.83s
for the adult Wraith Graviton Beam. A Thunderhead Lance is 100px long and lasts
a third of a second, in which a ship at full throttle covers 79px, so the beam
tore loose from the muzzle and hung in space. Beams now carry their owner, mount
and relative aim and are re-anchored every frame; a turreted beam also tracks the
hull it is burning, and a beam whose shooter dies is cut short.

**Swept projectile collision.** Hits were tested only at the point a shot
reached each frame. Nova's unguided rounds cover 20-40 px per thirtieth of a
second and a Shuttle is 12 px across, so shots stepped clean over small ships:
measured against a stationary target at 300 px, the point test caught 33 of the
58 crossings the swept test finds. `pathHitsCircle` now tests the segment for
ships, asteroids and the player alike.

**`syst` Message / Interference / ReinfFleet** — message buoys (STR# 1000,
1-based; Porto Rillia's Message of 3 is that bank's "Welcome to Porto Rillia"
line), sensor static scattering radar contacts and breaking the locks of
missiles whose Seeker says they are confused by interference, and real
reinforcement fleets: 291 systems name a flët, called after ReinfTime and
rate-limited by ReinfIntrval, replacing an improvised spawn from whatever düde
happened to live there.

### Known gaps in completed work

- **NPC gunnery fires one weapon.** `attackAi` picks the *first* primary in
  the hull's stock loadout and fires only that, on one ship-wide cooldown, and
  only when the nose is within 0.2 rad of the target — turrets included, which
  should bear anywhere. Secondaries (missiles) are never fired by NPCs at all.
- **shän `WeapImageID`/`WeapDecay`** (81 hulls have a weapon glow): extracted
  into the manifest but not rendered. `WeapDecay`'s units are unpinned — the
  Bible says only that "50 is a good median number", and the shipped values
  (3…100) give lifetimes from ~1s to ~35s depending on the reading. Needs a
  reference build to settle before it is worth drawing.
- **shän `ShieldImageID`** is `-1` on all 288 hulls and **`AltImageID`** is set
  on exactly one, so both are recorded but nothing renders them.
- **wëap `SubLimit`** is 0 on the only recursive weapon (Nanites), which can be
  read as neither "never split" nor "split forever"; an unstated limit is
  currently treated as a single split.
- **sÿst @110-140 is still unidentified** — a 16-slot paired block (8 ids at
  @110-124, 8 small values at @126-140, used together by ~65 systems). It is
  **not** Person1-8: only 7 of 228 entries name a përs whose LinkSyst points
  back at the listing system, and read as düde only 18/192 have a matching
  govt (against 900/2747 for the verified düde block at @68). The Bible's
  Person(x8) is almost certainly the zero-filled 8-slot block at @412-426,
  which is literally "at the end" as documented and unused in stock data.
  Locating @110-140 no longer blocks anything — BkgndColor/Murk are resolved
  and sit after it — but it remains ~32 bytes of unread syst data. A
  membership test cannot settle it: of the 48 distinct ids used, 100% are
  valid përs *and* valid mïsn ids and 96% valid spöb ids, because those ranges
  overlap almost entirely. The paired values at @126-140 are percentages
  (1..100) whose per-system sums do not reach 100, so they are independent
  chances rather than a distribution.
- **shïp `UpgradeTo`/`EscUpgrdCost` are extracted but no escort can be
  upgraded yet** — there is no UI for it. The same pass read `Subtitle`
  (target display), `Flags3` and `EscortType` (the four escort-menu
  categories), none of which is rendered either.
- **spöb Flags 0x0100 is not "deadly" at that bit.** The Bible calls it
  "stellar is deadly - all ships that touch it are destroyed immediately", but
  all 27 stellars reading it are also landable, and they are Port Kane, Menin,
  Syracuse and Forticus Shipyards — ordinary inhabited worlds you land on. It
  is not read, and AI traders are not steered away from those 27.
- **jünk `SellOn`** is `"h33r"` on the Vrenna Ice Lizard Pelts — not a valid
  control-bit expression. `evalTest` returns true for unparseable input, so it
  reads as "no gate" rather than silently locking the trade, which is the
  safe way round. The only other user, `BuyOn "b43"`, is well-formed.
- **sÿst `Message`** is 20003 on Nil'kol, matching no STR# 1000 entry (the bank
  has 20) and no dësc. Treated as a slip in Nova's data: no buoy is shown.
- **cölr `GridDim`/`GridBright`** read #ff0000 and #404040 in that order, so
  taken at the Bible's word the "bright" selection square is the duller of the
  two and grey-on-black would barely show. The neighbouring Prog triple
  (#ff0000 / #800000 / #404040) sets the house style — red highlights,
  #404040 structural lines — so they are named in the extractor by what they
  are for (`gridSelection` / `gridLine`) rather than by the doc's order. Two
  colours, no third sample to settle it.
- **cölr Button1-6 are column-major** (down the left column, then the right)
  while `menu.ts` lists its buttons interleaved left/right for DOM order.
  Map them by an explicit index, never positionally.
- **përs `GrantCount`/`GrantProb` are the reverse of the Bible's order** —
  settled by playing it. Only one captain uses the block (162 "Dr Ralph",
  reading 25 / 1 / 50) so the data cannot separate them, but the matching
  outfit is "Dr Ralph's Exploration Map", a unique item: read the Bible's way
  round, boarding him produced **39 copies of a one-off map**. Read as
  count @310 / prob @312 it is a single map at 50%, which is what a story
  item should do.
- **gövt `MaxOdds` is extracted but deliberately not gating reinforcements.**
  The Bible ties it to the call ("the combat odds against them exceed
  MaxOdds") without saying what "combat odds" counts. The obvious reading —
  attackers over defenders as a percentage — never clears even the lowest of
  the shipped thresholds (50..1000 across 65 governments) for a lone player,
  which switched reinforcements off almost entirely when tried. Reverted;
  do not re-wire it without pinning the unit first.
- **gövt `ShootPenalty` is extracted and deliberately never charged.** The
  Bible annotates the field itself "(currently ignored)", so the original
  costs you nothing on your record for merely opening fire — only disabling,
  boarding or destroying registers. A pass had wired it up, which made
  shooting a Federation ship cost 5 evilness against Nova's 0. It is now left
  out of the `Crime` union in `reputation.ts` outright, so charging it is a
  type error rather than a comment to be overlooked. Do not re-wire it.
- **gövt `DisabPenalty` and `BoardPenalty` are extracted and not yet charged
  — this one is a real gap, not a deliberate omission.** Unlike ShootPenalty
  the Bible does not mark them ignored, so Nova honours both: disabling a
  ship should cost DisabPenalty and plundering it BoardPenalty. `applyCrime`
  accepts them and `penaltyFor` reads them, but nothing calls it with either
  — only `"kill"` has call sites (`game.ts`, on player and NPC deaths). The
  hooks would be `checkDisableGoals` and `tryBoard`/`claimPrize`.

### Queue, roughly by size

Most of the earlier queue (pers loadout/HailPict, roid fragments, spob Fee /
misn DatePostInc / junk BuyOn+SellOn, colr, ScanMask) is done — see above.
Still open or only half-landed:

1. **NPC gunnery** — fire all primaries/turrets properly; fire secondaries.
2. **shän WeapImageID / WeapDecay** — weapon-glow render once units are pinned
   against a reference build.
3. **shïp escort upgrade UI** — UpgradeTo / EscUpgrdCost are extracted; no
   screen uses them yet. Subtitle / Flags3 / EscortType also unread in UI.
4. **Contribute / Require** — still cross-cutting and incomplete vs the Bible
   (ScanMask is live; the rest of the bit-mask gates are not fully wired).
5. **sÿst @110-140** — still unidentified (~32 bytes); does not block play.
6. **Mass → days/jump** — Bible ties hull Mass bands to 1/2/3 days per jump
   (and density-scanner blip size); we still advance a flat
   `max(1, 1 + hyperSpeed)` and ignore Mass for travel time.
