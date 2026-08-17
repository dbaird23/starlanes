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

**The opening sequence has exactly one player, and it is `IntroUi`.** A new
pilot sat through PICT 8200-8202 twice: `menu.ts` ran its own hardcoded
slideshow (`INTRO_PAGES` + `playIntro`) before handing over, and
`Game.startPilot` then played the same pictures from the chär template. The
menu's copy is gone. `IntroUi` wins because it is data-driven — IntroPict1-4,
their PictDelay dwell times and the IntroTextID dësc — so a plug-in template
plays. It kept what the menu version had that the other lacked: a page
counter, the click/space/esc hint, and **Esc skipping the whole sequence**
rather than one page. Its keydown listener is now **capture-phase with
`stopPropagation`**, because unlike the menu's version it plays over a system
that is already flying (`Input` listens on window too) — without that, Space
advanced the picture *and* fired a weapon behind it.

**Opening a pilot puts you over the world you left, not beside it.**
`startPilot` parked the ship at `planet.pos + (radius*2.2, radius*1.4)`, which
reads as starting off to the right of the planet. It now uses `{...home.pos}`,
the same rule `depart()` already states: you resume on the pad and fly clear
under your own power.

**Boarding money is 4% of the hull's cost.** düde Flags **0x0040** is "carries
money (amount depends on the ship's purchase price)" and the Bible never says
how much — no field holds an amount. The rate is ours; the ±25% spread is the
one figure the doc does give for carried money (përs `Credits`). A 12M
Manticore hands over 360-600k. All spawn paths carry booty now:
`spawnMissionShips` reads its düde's Booty flags, and `spawnFleetOf` — flëts
name no düde, so there is nothing to read — gives every fleet ship the money
flag on the same 4% rule (a warship carries the payroll). `applyPerson`
overwriting a düde money roll with the captain's own Credits is correct:
përs Credits ±25% is the documented figure for a named captain.

**A përs bound to one system is placed there, not rolled for.** The Bible's
"when ships are created, there is a 5% chance that a specific AI-person will
also be created" was the only way a captain could enter play, and reading it
as the whole rule makes a system-bound përs unreachable — it competes with
every wildcard-LinkSyst captain the system admits. That is what broke
**"Shoot down Derelict" (mïsn 754, Tutorial 006)**: the target is not a
special ship at all. 754 carries ShipCount -1, and the derelict is **përs
642**, a Pirate Viper named "- marked for demolition -" with LinkSyst 166
(Rautherion) and **ActiveOn `b9208`** — precisely the bit 754's OnAccept sets
and its OnSuccess clears. In Rautherion that përs was 1 of 157 candidates
behind a 5% roll, so the odds of meeting it were about 0.03% per ship spawned.
`placeLinkedPersons` now spawns, on entering a system, every available përs
whose LinkSyst is an explicit id in the Bible's 128-2175 band; there are 29 of
them and never more than three in one system (Jack Folstam, the Drifting
Derelicts, a few named traders). `maybeMakePerson` no longer considers that
band, so nobody doubles up, and the wildcard bands are untouched.

Do not go looking for the derelict on the mission instead. mïsn 755, "Silent
Mission;Tutorial 006a", is what 754's OnAccept starts (`S755`), and its ships
are genuinely 1 × düde 155 "Large Auroran War Ships" in sÿst 129 (Tichel) —
the front-line firepower Barry comments on in 754's DropCargText when you
reach Viking, which is 754's ReturnStel and sits in that same system. The
offsets are right; verified against the raw resource. Note also that düde 238,
"Tutorial Derelict", is **referenced by nothing in the shipped data** — it is
not the mechanism, and hunting for its caller is a dead end.

The other half is gövt Flags **0x0800**, "ships of this govt start out
disabled (derelicts)", which was extracted and never read. Both governments
named Derelicts (160, 180) carry it and between them own every përs it
applies to — the eleven Drifting Derelicts and the tutorial Viper — so
without it a derelict spawned with aggress 0 and AI type 1 and simply flew
off. It is applied in `applyPerson` only. Extending it to düde spawns would
be right for düde 227 "Association - disabled", 230 "Leviathan - disabled",
238 and 243 "Disabled Auroran Cruiser", whose names confirm the flag outright
— but gövt 159, the **Wraith**, also sets 0x0800, and disabling every Wraith
in flight is not a change to make without a reference build.

**People are cargo — and three fields decide who gets offered the job.** Nova
has no passenger berths: STR# 4000 entry 6 is "\*Passengers", the 103 missions
that carry them use CargoQty tons like any other freight, and a hull's capacity
for people is simply its free hold. What gates the offer is mïsn **Flags2 @82**
— values 0/1/2/4 only, exactly the three documented bits, each landing where
its meaning says (0x0001 "needs cargo room" on 194 of the 365 cargo missions,
0x0002 "pay on auto-abort" on the four *Refuel Trader* jobs, 0x0004 "fails if
disabled" on one). 0x0001 is **opt-in**: without it Nova still offers the job
to a full hold. Also read: **AvailShipType @84** (0 on all 791 — plug-ins
only) and shïp **InherentAI @66** (1-4 on all 288, the Shuttle a wimpy trader
and the Fed Destroyer a warship), which drives mïsn Flags 0x2000/0x4000
"unavailable if the player flies a cargo ship / a warship".

**Bribes, mercy and assistance are per-government.** gövt Flags **0x0200**
(warships take bribes) and **0x2000** (freighters) decide whether the Offer
Bribe button exists at all — 29 and 21 of the 68 governments — split by the
attacker's AI type; **0x8000** ("demand a larger percentage of your cash
supply") raises the price from 10% to a third, and covers the Pirates and the
Federation. You cannot buy off an Auroran, a Polaris or a Rebel. gövt Flags
**0x0400** "can't hail ships of this govt" now silences the Wraith, the
Hyperioids, derelicts and cargo drones. Two ränk Flags outrank a government's
manners: **0x0400** battle assistance (17 of 31 ranks) turns every ship of
theirs within 3000px to your side and calls the system's ReinfFleet in on your
behalf, and **0x0800** (20 of 31) is free repair/refuel, the rank-granted twin
of gövt Flags2 0x0010 Roadside Assistance.

**Pilot files are only written when you leave a planet** (`depart` /
`commitPilot`). Shopping, combat, mission accepts, jumps, and everything else
mutate the live RAM session only. Death, loading another pilot, or closing the
tab discards that session; Open Pilot reloads the last leave-planet save.

**Death is the end of the run, and the pod is a handle you pull.** Being
destroyed used to charge 10% of your credits and have a tug haul you in, which
is not a Nova rule at all. Dying now stops the game and returns to the main
menu with **no pilot loaded** (and does not write the live session). Non-strict
pilots can Continue from the last leave-planet save. Strict pilots are marked
`dead` on the pilot list (Continue disabled; still exportable/deletable) rather
than deleted.

The escape pod does **not** fire by itself. oütf ModType 20 is "auto-eject
(requires escape pod to work)" and outfit 187's own text says why it is worth
20,000 credits: it launches the pod "when it detects your armor state fall to
zero ... **without waiting for any input from the pilot**". So ModType 11 alone
gives you the *ability* to eject — Alt-X, or the sidebar's EJECT button, which
appears only when a pod is fitted — and ModType 20 pulls the handle for you.
`playerDestroyed(deliberate)` carries the distinction. **Strict play has no say
in it**: strict means a death is permanent, not that the pod is disabled, and
ejecting is precisely how a strict pilot survives. (It used to read
`escapePod && !strict`, which disarmed the pod for exactly the pilots who
needed it, and auto-ejected everyone else who merely owned one.)

Whichever way it fires, dësc **13999** (the reserved "message shown after the
player uses an escape pod") settles what it costs: you "work several dreary odd
jobs to scratch up enough money to buy a new ship", so hull, outfits, ammo and
cargo are gone and you come down at a nearby world in the chär template's
starting hull, keeping credits, record, missions and the outfits Flags 0x0004
marks as persistent. The desc is queued through `pendingMissionEvents` and read
on that landing.

**The outfitter lists what you own, wherever you are.** An owned item was
dropped from the grid by the tech-level filter, so a Map bought on its one
special-tech world (the three are techs 80/81/82) vanished the moment you left
and there is no other screen showing what you carry — it read as "the map isn't
kept". It is kept: none of the four map outfits sets Flags 0x0010 ("remove
after purchase") or 0x0008 ("can't be sold"). Owned items now always appear;
Buy and Sell are gated on whether the world actually trades the item, with
Flags **0x0800** ("can be sold anywhere, regardless of tech level") as the
documented exception, and the status line says which it is.

**S7evyn exists, and every storyline's last mission moves you to it.** The
Bounty Hunter, Federation and Rebellion chains were walked leg by leg in the
browser, and all three finished — but the closing `M472` did nothing in any of
them. **sÿst 472 is "S7evyn"**, the ATMOS epilogue system holding *Our Spiel*
and *Link*, gated `b9995` — the bit the finale itself sets one operator
earlier. Seven missions fire it: **354 Rebel I22, 381 Rebel II27, 417 Vellos31,
474 Fed43, 686 Auroran 029, 712 Pirate 011 and 887 Polaris 46** — the last leg
of all six major strings.

It was being deleted at extract time. Nova ships 545 sÿst resources for 403
systems, each variant gated by its own Visibility, and the pass that picks the
live one **dropped any name with no variant live at game start** — while the
comment directly above it promised the opposite and named S7evyn as the case
it was written for. Six groups were lost, and they are exactly the
post-storyline galaxy: Pentori/Willon/Chicea/Varden behind `b9500`, "Koria;
Rebs assim" behind `b148`, and S7evyn behind `b9995`.

What the fix rests on, all measured across the raw resources:

- **Group by the name before any ';'.** Only one pair differs on it — 483
  "Koria;Rebs !assim" against 533 "Koria; Rebs assim", same coordinates, same
  links, gated `!b148 & !b305` against `b148 | b305`. They are two states of
  one system, and merging them also stops the annotation being printed to the
  player as the system's name.
- **Lowest id is canonical.** For all 404 groups that have a variant live at
  start, that is the same resource the old pass kept, so no saved pilot's
  explored list or per-system ledger moves.
- **Exactly one variant is live at a time** — 0 groups have two. So a group is
  present iff some variant is true.
- **Only a start-dormant group may ever be hidden.** `visibleIf` is populated
  for those five groups and empty for every other, which is what stops a bit
  that merely switches variants from making a system vanish: Rebel I22 sets
  b147, which turns Sol's variant 130 off in favour of 531, and hiding on
  "current variant false" would have deleted **Sol** at the end of the
  Rebellion.

`systemHidden` / `chartedSystems` in `data/universe.ts` read the live bits
(`setVisibilityBits` re-points at `player.bits` in `startPilot`). A hidden
system is out of `Game.allSystems()` — the single choke point for every map
pass, so nodes, lanes, government haze and the unexplored-neighbour dots all
followed for free — out of `findRoute`, out of the ModType 16 bulk charts and
out of `resolveStel`'s random destination pool. It still exists, which is the
whole point: `moveToSystem` can put you there. `galaxy.json` also carries a
**`systemAlias`** map now (142 entries) and `getSystem` resolves through it —
mïsn 676's ShipSyst is 765, SPC-1421's b995 variant of the kept 308, and
resolved to nothing before.

One consequence worth knowing: an ncb move fires *inside* `collectLandingEvents`,
i.e. during `LandedUi.show()`, so `moveToSystem` calls `hide()` (which nulls
`planet`, making `render()` a no-op) and then `show()` carried on and re-opened
an empty panel. `LandedUi` now notices it was moved off the pad, restores the
planet long enough to draw the ending, and closes to flight on the last
Continue rather than falling through to the spaceport of a world it has left.
Verified end to end: Fed43 at Earth plays both ending pages and drops you in
S7evyn; a fresh pilot still charts **398** systems with no route to any gated
one and no gated world in 2373 random destination draws; after the finale it is
403.

**The bar offers more than one job, and Nova's brake on that is a control
bit.** Walking into a bar and being handed four storyline intros back to back
looked like a bug. The manual says the plural is intended — "the quantity and
difficulty of the missions you're offered in the bar tends to increase as you
build your reputation" — so there is no cap. What was missing is the brake,
and it is authored in the data: **crön 221 is named "Generic misn delay
cron"**, EnableOn `b6666`, OnEnd `!b6666`, so the bit lasts a day. **Ten
missions set b6666 when you refuse them and 35 test it in their AvailBits** —
nine of those in the bar, including the Bounty Hunter, Wild Geese, Auroran,
Polaris and Pirate intros. Turning one storyline down is meant to clear the
others off the board until tomorrow.

Two things stopped that firing:

- **The bar drained a list built on landing.** `maybeBarOffer` shifted a
  snapshot, so bits set by refusing offer #1 could not reach offers #2-4 —
  they had already been chosen. It now re-asks `availableMissions` before each
  offer and keeps a `barOffered` set so each job still gets one showing per
  landing. The bar's own mission list is a live query for the same reason.
- **AvailRandom was rolled per query.** The Bible: "Mission randomizing values
  are recalculated each time you warp into a system." Ours called
  `Math.random()` inside `availableMissions`, which meant the bar, the BBS,
  the spaceport and each counter rolled separately in one landing, and a
  land / take-off / land cycle was a reroll machine for a rare storyline
  intro. `rollMissionAvailability()` now clears a per-mission roll table and
  is called from `enterSystem` — all four arrival paths (opening a pilot, a
  hyperspace jump, a gate transit, and the ncb move operator, which had never
  charted the destination at all). Re-asking between offers is therefore free:
  the bits move, the dice do not.

Measured at Earth for a rating-200 pilot: seven bar jobs are eligible and the
per-visit average is **2.16 offers**, with four or more about 13% of the time
— so the run the player saw was the data, not a fault. Verified end to end:
with the Auroran and Wild Geese intros both up, refusing the Auroran sets
`b201` and drops only itself; refusing Wild Geese sets `b801 b6666` and empties
the bar; one day later crön 221 clears the bit and the board refills.

**Storylines are not mutually exclusive, and the engine has no opinion about
it.** Being mid-Bounty-Hunter does not block the Auroran, United Shipping or
Cunjo chains: 257 sets nothing on accept, and nothing in the shipped data
tests its bits but itself. Where Nova does want exclusivity it says so by
hand — **b424 is the Vell-os lock**, set on accepting "Return to Earth for
Training" (Vellos3) and cleared at Vellos27, and **184 missions test it**,
including the Bounty Hunter, United Shipping and Cunjo intros and most of the
generic freight. b423 (Vellos11) locks 11 more. So a Vell-os trainee really
does have the rest of the galaxy shut to them, and everyone else may run
several storylines at once by design.

**The storefront missions, and the three things that hid the Federation
storyline.** mïsn **AvailLoc** has seven values and only 0 (mission BBS), 1
(bar) and 3 (spaceport) were ever asked for, so the 22 missions posted at the
trade, shipyard and outfit dialogs could not be offered at all. `landed.ts`
now keeps a `counterOffers` map beside the BBS/bar/spaceport queues, filled on
landing and popped in `setView` as you step up to the counter — one per
counter per landing, matching the spaceport's rule, or refusing would raise
the next one immediately. Two more blockers sat behind it:

- **ShipGoal -1 was being thrown out with chase-off.** `availableMissions`
  rejected `shipGoal < 0 || shipGoal > 5`, but -1 is the Bible's "no specific
  goal for the special ships" and **243 of the 348** missions that carry
  special ships use it — including all six Fed Resupply legs. Only goal 6 is
  genuinely unresolvable. Those ships now fly too: `shipsTotal` counts them
  and `shipsDone` starts true, so **ShipBehav alone places them** (118
  goalless missions set 0 "always attack the player", 28 set 1 "protect", 97
  leave it -1). Killing one tallies `shipsKilled` without touching the
  objective, or an ambush you fought off would be waiting again on the way
  back; the "Hostile contacts" line now fires only when something hostile
  actually spawned, not on escorts.
- **A missing `b` in Nova's own data.** Fed1's AvailBits reads
  `!((b50 | 467) | b6666)`. `evalTest`'s fallback treats an unparseable token
  as true, which made the enclosing `!(...)` permanently false — the
  Federation storyline could never be offered even with AvailLoc 6 wired.
  It is the **only** bare number in all 791 missions, and Fed1's own OnFailure
  and OnAbort both set `b467`, so the intent is not in doubt. A bare digit run
  now reads as a control-bit reference.

Verified in play: Sigma1 at Earth's shipyard, Tutorial 002 at the trade centre
(the tutorial chain used to dead-end after step 1), and Fed1 at the outfitter
— accepting it sets b511 and books 20t of Military Stores to Spacedock III,
with its two ShipBehav-0 Aurorans waiting in Sol. Note Fed1 also wants
AvailRecord 2, AvailRating 150 and AvailRandom 50, so a brand-new pilot still
cannot see it (and even an eligible one only half the time per landing).

**mïsn AvailRecord is @6 and AvailRating @8 — an earlier pass had them
swapped, which broke every storyline gate in both directions.** The Bible's
order (AvailStel, AvailLoc, AvailRecord, AvailRating, AvailRandom) is the
struct order, and each field identifies itself: @8 is -1 on 184 missions —
the documented "ignored" for AvailRating, absurd as a record gate — and runs
0..12500 on the kill-point scale of STR# 138 (the bounty chain asks 5/100/200
as the bounties grow, the Bounty Hunters intro 150, late Auroran war missions
12500 — no legal record could reach that: all CompRewards for a single govt
sum to a few hundred). @6 is small (0..50) and its only two -1s ("record must
be <= -1", criminals only) sit on the two "Unregistered cutoff" missions. The
swap surfaced as **"Return With McGowan's Rejection" (mïsn 647, Wild Geese
7bII)**, offered in the bar on Harbor: read swapped it demanded pirate record
5 from a player the storyline itself has been arming against pirates; in
truth it has **no record gate at all** (@6 = 0) and wants 5 rating points.
The original was verified three ways: raw bytes (647 reads 0/5/100, Fed1
2/150/50), value distributions across all 791, and the user's own original
pilot file — the Windows .plt is unencrypted, and its per-system legal array
(base 5148, LE int16 per syst id) is seeded exactly from each govt's
InitialRec and moves only where something actually happens. `availableMissions`
now compares `player.ratingPoints` against AvailRating directly: it is a
points threshold, not a level index. Two real divergences from Nova remain —
see Known gaps: landing bribes (gövt Flags 0x4000/0x8000), and the record
model itself (ours is per-govt with global kill propagation; Nova's is
per-system).

**Contribute / Require is live — and it is Nova's whole license economy.**
The 64-bit Contribute pool (ship + owned outfits + held ränks + active cröns)
is matched against Require bits on five resources, and the stock game runs
real machinery on it: the Heavy Weapons / Missile / Fighter Bay / Protective
Technologies / Capital Ships / Capital Warships licenses contribute the bits
the licensed weapons, armor and capital hulls require (the Fed Carrier wants
0xCF — five licenses), the Federation Naval Rank of Commander contributes
0x7B and the Ambassador 0x1FF (licenses waived), the Sigma Bulk Delivery
missions require bits only Sigma-built hulls contribute, and the "Illegal"
blaster line contributes 0x200 instead of requiring anything. oütf
RequireGovt 128 on the licensed weapons means only Federation-allied shops
check papers — a pirate outfitter sells to anybody. Exactly 13 hulls
contribute nothing at all — the six Vell-os ships, the Wraiths, the
Hyperioid, the Krypt Pod and the Escape Pod — so every purchasable outfit's
"is a ship" Require bit fails aboard them and no outfitter will sell to a
Vell-os pilot, which is canon: ATMOS gated it through this system, and it
works here for free. Offsets, all verified
against the values in the resources themselves: oütf Contribute @30 /
Require @38 (an earlier pass read @1012-1027, which is 16 bytes of zero),
shïp @100 / @896, mïsn Require @1622, ränk Contribute @14, gövt Require @84
(zero across stock; the travel-permit gate in `clearedToLand`), crön
Contribute @790 / Require @798. Enforcement lives in `contribute.ts`
(playerContribute / requireMet / outfitRequireApplies) and gates the
outfitter (buy + the 0x0100 hide flag), the shipyard (buy + shïp Flags3
0x0200 hide), mission availability, crön activation and landing. Verified in
the browser at Earth: the Medium Blaster refuses with "You don't have the
required license!", buying the Heavy Weapons License unlocks it but not the
missile launcher, and holding rank 128 unlocks everything with no license
owned.

The same offset hunt found two more mïsn fields past Require: **ScanMask
@1630** (five missions; "Steal Hypergate Codes" reads 0xFFFF — contraband to
every government, and the low-bit values decode via the minor factions'
scan masks: the Drop Bear missions' 0xE is contraband to the Roughnecks,
Bureau, ATMOS and Ambrosia; wired into `contraband()` while the mission
cargo is aboard) and the real **OnShipDone @1632** — the old read at @1622 was the
Require field, so the 76 missions that carry a set string there never fired
it. Bounty Hunter1's OnShipDone is "b96", the bit its own AvailBits needs to
stop re-offering the Guild intro forever. The gövt pass also picked up
**InhJam1-4 @92** (the Federation reads 7/5/0/0) and **MediumName @100**,
extracted for later use.

The mïsn record ends with three more fields, all previously unread:
**AcceptButton @1887** and **RefuseButton @1919**, 32-byte strings whose
bounds are visible in the raw bytes (Rebel3 reads "I'm in" at 1887 and "I
need more time" at 1919, gapless), and **DispWeight @1952**, which "controls
the order that the mission is presented in the bar and mission BBS list"
(higher first; 44 missions set one). The buttons are **not always
agree/decline** — Wild Geese 7aI labels them "Rebels" and "Aurorans" and
Polaris43a "Federation"/"Auroran", so those are branch choices where
rendering "Accept"/"Refuse" loses the question the dialog is asking. 22
missions set both; empty falls back to Nova's own STR# 150 wording.

**The Wild Geese b-path runs end to end — verified leg by leg.** The
storyline that started the AvailRecord investigation was walked in the
browser through `window.game`, accepting each leg from the counter the data
names and flying to each destination: 634 in Earth's **bar** → 635 (New
Ireland bar) → the `R(b804 b805)` roll picks the b-path → 642 at Earth's
**spaceport** (AvailLoc 3, the storefront fix) → 643 → 644 → 645 → Harbor →
647 → 648. Every leg was offered exactly where its AvailStel/AvailLoc say,
and every OnSuccess bit fired.

The Harbor leg is the one worth keeping: by the time 645 sends you there the
per-system ledger reads **-8 in Scheall** — the storyline really has turned
the pirates against you, as the player reported — so Harbor (MinStatus 2)
refuses clearance, and it is the *active-mission destination override* in
`tryLand` that gets you down. Cold, with no mission covering it, the same
landing opens traffic control and the Pirates' 0x8000 bribe asks 23,450 of a
65,000 bankroll (2000 + a third). Both routes in, exactly as intended.

One gate to know about: 634 carries **AvailRating 5**, so a brand-new pilot
cannot open Wild Geese at all until they have a couple of kills behind them
(the walkthrough needed `ratingPoints` seeded). Whether 5 rating points is
~2 small kills or ~20 depends on the internal multiplier — see
`RATING_POINT_SCALE`, still unpinned.

**New Pilot is three dialogs, and it ends on the title screen.** Nova asks
who you are (full name, nickname, gender), then the strict-play question on
its own, then your ship's name — and then leaves you on the title screen to
choose Enter Ship yourself rather than launching you into the cockpit. Ours
was a single dialog that flew you immediately. All three now open pre-filled
from **STR# 128 "Default Names"**, which holds three suggestions of each in
one flat unlabelled list: 1-3 full names (Shane Merrol, Cade Connelly,
Goroth Obarskyr), 4-6 nicknames (Hunter, Hawkeye, Maverick), 7-9 ship names
(Ring of Glory, Snowy Owl, Cardinal Virtue). The grouping is confirmed by
the original's own title screen, which shows a fresh pilot flying the "Ring
of Glory" — entry 7. Creation persists through `Game.seedPilot` rather than
`startPilot`, because the pilot has to exist on disk without a session
starting; the chär intro sequence still plays on Enter Ship, from
`startPilot`, and must not be moved into creation.

The three fields are real state, not decoration: `<PNN>` is the nickname
("If no nickname was specified, Nova will use the player's full name here
instead"), `<PSN>` is the **ship's** name — an earlier pass had it echoing
the pilot's — and gender drives the Bible's `{G "male" "female"}` desc
substitution, which used to always take the male string. Those read through
`setPlayerIdentity` in `missions.ts`, module-scoped and set by `startPilot`
in the same shape as `setInterfaceForGovt`, rather than threading an extra
argument through all eighteen `substituteTags` call sites.

**STR# 2002 "misc strings" is extracted — 396 engine strings, and the
wording is the original's now.** `src/data/strings.ts` exposes `ui(n,
fallback)`, **1-based** like every other STR# reference here (sÿst Message,
përs CommQuote…), and every call passes the English string it replaces so a
short or missing bank degrades to what we shipped rather than to blanks.
Wired so far: the new pilot's opening hint, the too-far / too-fast /
unable-to-land / clearance-denied messages, the HUD's nav and target wells,
the map's destination panel, the trade, outfit, shipyard and hire labels,
and the title screen's readout.

Three things about the bank worth knowing. Entries **22/23 are a pair chosen
by stellar type** — "docking at" a station against "landing on" a planet —
and **24/25 sandwich the landing keybinding**, which is why the original's
opening line names the 'L' key; ours passes `formatChord(getBinding("land"))`
so a rebound key reads correctly. The same station/planet split runs through
**67/68** (too far), **71/72** (too fast) and **87/88** (unable to dock/land),
and it keys off `PlanetDef.kind`, which comes from spöb Flags 0x0010. Verified
in play: Spacedock II gives "You're too far away to dock at this station"
where Ryll gives "…to land on this planet", and a fresh pilot's first message
reads "Welcome to Nova - it would be a good idea to start by landing on Ryll
and having a look around. Hit 'L' to request landing clearance, then hit it
again to land."

Most of the bank is still unwired — the plunder panel, escort commands, the
smuggling and self-destruct messages, the gambling screen, and the small
connective words (391-396: "of", "and", "a", "an", "in", "N/A") that Nova
assembles sentences from. Adding one is a two-line change: find the entry
number in the extracted list and wrap the literal in `ui()`.

**The comm banks are extracted too, and they run in groups of five.** STR#
**3000** "Ship Comm Strings" (190 = 38 groups), **3001** "More Ship Comm" (5)
and **3002** "Stellar Comm Strings" (50 = 10 groups) hold everything a ship
or a world says over the radio, and both big banks are laid out as five ways
of saying the same thing — Nova picks one at random from the group that fits.
`shipComm(group, fallback)` / `stellarComm(group, fallback)` do that, with
`SHIP_COMM` and `STELLAR_COMM` naming every group so call sites read as
intent rather than arithmetic. Wired: the channel-open lines (a world's names
itself, since 3002 group 1 ends in "to "), a hostile ship's taunts, the
escort greeting, the tribute demand and its refusal, the planet bribe
refusal, and a ship with nothing to report.

**Two of 3002's groups are not interchangeable, and reading them as such is a
bug.** The surrender group (6) and the release group (8) hold two real lines
each, written for the two stellar kinds — "The planet agrees to pay you
tribute" against "…the station…" — and the group's other three slots are the
literal placeholders `<dominated = TRUE>` / `<dominated = FALSE>`. Picking at
random had Ryll, a planet, calling itself a station. `stellarCommByKind`
indexes those by `PlanetDef.kind` instead, and `pickGroup` drops any entry
starting with "<" so a marker can never be read out to the player. This is
the same kind-pairing as STR# 2002's 22/23, 67/68, 71/72 and 87/88 — when a
group looks short, check whether its entries are a pair rather than
alternatives.

**The hail is two negotiations, not one, and the buttons are governed by
different fields.** STR# 150 names five: Greetings (22), Request Assistance
(23), Offer Bribe (24), Beg For Mercy (25), Close Channel (21) — plus the
pair that had never been used, **Accept Payment (28) / Demand More (29)**.
The split matters because the Bible gates them separately: Offer Bribe is
money and depends only on whether the government takes bribes at all (gövt
Flags **0x0200** warships / **0x2000** freighters, split by the attacker's
AI type, with **0x8000** raising the ask), while Beg For Mercy is free and
is gated on Flags2 **0x0001**, whose text names it outright — "the request
assistance / beg for mercy button is disabled and the govt is not
talkative". So an untalkative government still takes your money; it just
will not hear a plea. Verified in play: a hostile Family Moash warship
offers Greetings / Offer Bribe / Close Channel and no mercy button, where a
Pirate offers all four. These were one conflated button before, labelled
"Beg For Mercy" and running the bribe.

**A losing ship ransoms itself.** Accept Payment / Demand More exist for the
other direction of the same negotiation, and STR# 3000 carries the whole
exchange: they hand it over (group 36 "Here, take it and go!"), they
grudgingly pay extra (35), they genuinely cannot (34 "Are you kidding? I
can't afford to pay that!"), or pushing too hard flips them back to a fight
(31 "Die, cheapskate!"). The offer appears on a hostile ship that is below
40% armour, not yet disabled, and carrying a düde Booty roll to pay with;
their ceiling is 1.5× that purse and each demand costs 20 percentage points
of patience, so squeezing is a real gamble. Accepting zeroes `booty` — the
ransom *is* the money, so you cannot pay-then-board for it twice. Measured:
a Leviathan opened at 12,000, was squeezed to 15,989, and a second ship
turned on the third demand.

Two smaller things from the same pass. **`btnLabel` is 1-based now**, like
`ui()` and every other STR# reference here; it took a 0-based array index
while its callers passed entry-minus-one, which read as an off-by-one every
time anyone checked it against the resource. And the negotiation and
assistance refusals now speak from STR# 3000 rather than hand-written
English — "I'd rather not" for a bad record, "I'm a little busy right now"
under fire, "You're not in any trouble" when you are unhurt. Four more behaviours the beta history names are now in, and they change
what Request Assistance means:

- **Heeding is a roll, not a certainty.** "when player has a rank that
  grants assistance from other ships, they are more likely to heed it" only
  makes sense if the base case can be refused, so the chance runs
  `clamp(0.55 + record×0.01, 0.25, 0.9)` and a rank (or a government running
  Roadside Assistance) lifts it to 0.95. A refusal speaks from STR# 3000's
  "I'm busy" group. The numbers are ours; the shape is the history's.
- **A raider will not tow you.** "non-xenophobic pirate ships will no longer
  give assistance after plundering the player" — `NpcShip.plunderedPlayer`
  is set when a boarder robs you, and those ships refuse outright.
- **Ships that cannot carry fuel are never offered it** — the fuel branch is
  gated on `maxFuelJumps > 0`, so a fuel-less hull only ever hears "you're
  not in any trouble".
- **The refuelling ask adjusts to your purse.** "auto-refueller now properly
  adjusts for the player's amount of credits": it opens at 3× the station
  rate but is trimmed to a quarter of what you actually hold, so being
  stranded with 800 credits costs 200 rather than being a dead end. It never
  rises above the flat rate — a rich pilot is not gouged for being rich,
  which is what the bribe fields are for.

**Pirates now actually rob a disabled player.** The AI already flew the
entire three-phase boarding approach at a crippled player's ship, docked,
and then took nothing — being disabled next to a pirate cost you only time.
`plunderPlayer` empties a share of the hold and a slice of the purse (rates
are ours; the Bible sets none) and marks the raider. **Mission cargo is
deliberately untouched**: it is not theirs to sell, and losing it would
silently fail storylines out of a fight you had already lost.

**`<SN>` — the special ships have names, and they come from mïsn ShipNameID /
ShipSubtitle.** The Bounty Hunters Guild intro asks you to "destroy an Auroran
ship named the `<SN>`" and printed the tag, because neither field was
extracted. Both read "-1 ignored, 128 and up pick from this STR# resource",
they sit at **@42** and **@50** either side of the already verified
ShipStart/CompGovt/CompReward run, and they name themselves: every value ≥ 128
lands in **25000-25047**, a band of STR# banks that exists for nothing else and
whose resource names are the ships in question — 25000 "Auroran Warships"
(Dechanik, Blood Honor, Doomblade…), 25001 "Pirate Raiders", 25006 "'Prodigal
Son'". 78 missions carry a name bank and 43 dëscs use the tag.

Three things worth knowing:

- **The roll happens where the offer is built** (`instantiateMission`), not on
  Accept. Nova picks at accept time, which is why the Bible warns `<SN>` "will
  screw up" in an offer description — and indeed **not one** of the 43 dëscs
  that use it is an offer text (26 BriefText, 26 QuickBrief, a couple of cargo
  and completion texts). So rolling it a moment earlier is invisible in play
  and cannot leak a raw tag. One roll per mission, so a briefing that names the
  ship twice names it the same twice.
- **`<SN>` falls back to the subtitle bank**, which is what Nova's own prose
  demands: all three missions that use the tag without a ShipNameID carry a
  ShipSubtitle instead, and it is the subtitle that completes the sentence —
  Rebel I21's "most of them have been named `<SN>`" against 25006 "Prodigal
  Son", Auroran 028's "as she flies through the Wolf 359 system in the `<SN>`"
  against 25024 "Krane". The hull-name last resort behind that is ours, so a
  plug-in naming neither still reads as English rather than as markup.
- **The ships carry the name too.** Hunting "the Doomblade" and finding an
  anonymous Thunderhead is the same bug as printing the tag, so a named
  mission ship answers to it in the HUD target well, the comms panel and every
  kill message (`shipLabel`), and ShipSubtitle overrides the hull's own shïp
  Subtitle on the class line. Only missions that actually name their ships
  hand one out; a plain düde spawn stays anonymous. Verified in play: the
  briefing reads "an Auroran ship named the Talons of Integrity" and the
  target well reads *Talons of Integrity / Abomination Va Themgiir Class*.

**Every desc tag the Bible lists is implemented now — and two of them were
never mission tags at all.** A census of all 791 dëscs and every STR# bank
settles where each one is actually used, which is not where you would guess:

- **`<DL>`**, the deadline, is the big one — 69 dëscs ("It has to be there by
  `<DL>`"). It is `acceptedDay + TimeLimit` written out by the chär template's
  own calendar ("July 23rd, 1177 NC"), and all **57** missions whose text uses
  it carry a TimeLimit, so the empty arm — STR# 2002 entry 396, Nova's own
  "N/A" — is for plug-ins only.
- **`<OSN>`**, "the offering ship name", appears in **no dësc**: it is in
  **STR# 7101 "Hail Quotes"**, where **41 of the 42 lines open with
  `<OSN>: `** — the bank carries its own speaker, and the 42nd names one
  outright ("Derelict vessel: ..."). So Nova prints those lines as they
  stand. We wrapped them in `${person.name}: "…"`, which said the name twice
  *and* printed two raw tags: **`Jack Folstam: "<OSN>: <PN>, I have recently
  been given information on a bounty."`** It now reads *Jack Folstam: Cade
  Connelly, I have recently been given information on a bounty.*
- **`<PRKnnn>` / `<SRKnnn>`** (dësc 5066, Fed37) narrow `<PRK>`/`<SRK>` to one
  government, so a Federation briefing names your Federation commission and
  not the Auroran one you outrank it with. `topRank(govtId)` already existed.
- **`<RRK>`** is the *full resource name* of the most recently granted rank
  ("Federation Naval Rank of Commander"), not its ConvName. `player.ranks` is
  appended to as commissions are granted, so its last entry is Nova's "most
  recently activated rank" — and ours survives a reload, where the Bible warns
  its own pointer "isn't cached between game sessions".
- **`<PST>`** (your hull), **`<PAY>`** (`abs(pay)`) and **`<REG>`** are used
  nowhere in the stock scenario. `<REG>` is "who Nova is registered to, or
  UNREGISTERED"; this engine reads your own data files and is not a registered
  copy, so it answers with the Bible's own alternative. Its one use is dësc
  32767, Nova's About box, which we deliberately do not show — ours is a
  clean-room notice of its own.

Two structural notes. `Game.rankTags()` is now **`descTags()`** and returns the
whole player side of the substitution (ranks, the per-govt lookup, the recent
rank, the hull) — the eighteen call sites still pass one argument. And
**`substituteText()`** runs the same pass over text that belongs to no mission:
the Bible says ncb Q-operator messages are "parsed for mission text tags ...
but not text-selection tags", and it is now wired to the përs comm quote (STR#
7100), the përs radio broadcast (7101) and both government chatter bands (7000+
and 7500+) — STR# 7022, the Prodigal Son's replies, addresses you as "Captain
`<PN>`" and had been printing the tag.

**përs @314 is a class line as often as a ship's name.** Deciding what `<OSN>`
should say forced the question, and the data answers it: of the 195 captains
that set the field, **142 repeat their own hull's shïp Subtitle exactly** —
"Standard", "Class I", "Class A", "12b Model" — and only the other 53 are
names ("Night-Master", "el Presidente", "w00tWare", "31337"). The comms panel
was printing all of them as names, so hailing Terrapin gave *"Standard —
Terrapin (Trader)"*. It now prefixes the name only when it differs from the
hull's subtitle: Terrapin reads *Terrapin (Trader)* and Jack Folstam still
reads *Night-Master — Valkyrie (Guild)*. `<OSN>` itself uses `shipLabel` — the
captain's name where there is one — for the same reason.

The **HUD target well reads it as the class line**, which is the same rule
from the other end: a përs's @314 overrides the hull's own shïp Subtitle
there exactly as a mïsn ShipSubtitle does, because that is what it is. It had
been ignored outright, so the well showed neither the 142 repeats nor the 53
real names — Jack Folstam read *Jack Folstam / Valkyrie Class III* and never
mentioned the ship at all, where he now reads *Jack Folstam / Valkyrie
Night-Master*. Terrapin is unchanged (*Terrapin / Terrapin Standard*: the
field and the hull's subtitle agree), and a Guild bounty hunter reads *Pirate
Enterprise Guild-Member* rather than the hull's "Stolen Tech". Only a përs's
field is taken this way — a mission ship's `shipName` is a proper name and
stays in the head, where the `<SN>` work put it.

**Duplicate stellars: 26 missions pointed at a world that isn't in any
system.** The Bible states the rule under TravelStel — "the mission travel
objectives will also be fulfilled when landing on a duplicate stellar that
has the identical name and coordinates to the stellar you specify here" — and
it matters because **68 of the shipped stellars belong to no system at all**.
They are alternate copies of a world, and 26 missions name one as their
destination, so `resolveStel` returned null and those missions could never be
completed. "Free Eiric" (mïsn 639) returns to spöb 506, a second New Ireland,
which dead-ended the entire **Wild Geese a-path** at its final leg; the
Auroran, Polaris and United Shipping chains each have their own
(`Return to Aurora`, `Take Terraforming Team to New Ireland`, the UHP-1002
deliveries). `duplicateStelId` now matches name **and** coordinates, as
documented; every duplicate in the stock data agrees on both with its placed
twin. `SPOBS_BY_ID` in `data/universe.ts` holds all stellars including the
unplaced ones, since `SPOB_INDEX` deliberately holds only the placed.

**The same rule governs AvailStel, where a mission is *posted*.** `stelMatches`
compared ids outright, and **eleven missions are posted at a stellar that is in
no system**, so they could not be offered anywhere: mïsn **680, 682 and 684**
(plus 690/916/917/918, the Wild Geese variants of Auroran 027) read spöb **439
"Aurora"**, an unplaced twin of the placed 338, and the four United Shipping 6a
legs read 448 "Tre'ar Zalom" against the placed 227. That dead-ended the
**Auroran chain at Auroran 023**. Every one has a twin agreeing on name and
coordinates, so `stelMatches` now falls through to `duplicateStelId` — but
**only when the named stellar is itself unplaced**, the same guard
`resolveStel` uses, because two *placed* pairs share a name and coordinates
(both are "Wormhole", spöbs 465/481 and 470/484) and must never stand in for
each other. No mission names any of those four. `duplicateStelId` is memoised
now: the offer filter asks it for every concrete-AvailStel mission on every
board query, and the answer is a property of the data rather than the save.

**Text-selection tags: one resolver, run at display time.** The Bible gives
three, sharing one shape and all honouring a leading `!` —
`{bXXX "if set" "if clear"}` on a control bit, `{G "male" "female"}` on the
pilot's gender, `{P[days] "registered" "unregistered"}` on whether the game is
paid for. No compound tests ("unlike the control bit test strings"), the
second string is optional ("if there is no second string, nothing will be
substituted"), and a quote inside an arm is C-escaped:
`{b002 "Dave \"pipeline\" Williams"}`. The selector letter is matched
**case-insensitively** because Nova's own data is inconsistent — 207 `{G`,
7 `{g`, 114 `{bN`, 1 `{BN`. P is always true here, the same answer `evalTest`
gives the ncb Pxxx test.

Two things were wrong, in opposite directions:

- **`{G}` and `{P}` were collapsed at load**, in a `cleanNovaText` pass over
  every dësc, ship and outfit description, always taking the first arm. So
  every description in the game was male, whatever the pilot answered at
  creation — and `substituteTags`'s own `{G}` regex, which did read the real
  gender, almost never saw a tag because the table had already been rewritten.
  That pass is gone; `DESCS` is verbatim now.
- **`{bNNN}` was never resolved on the mission path.** `resolveNovaText`
  existed and was called for the landing, bar, hire, shipyard and outfitter
  descriptions, but mission text goes through `substituteTags`, which did not
  call it — so briefings printed their markup. Auroran 015's completion text
  opens `{b809 "Your reunion with Eiric is a joyful one...`, which is the
  Wild Geese arm; without a resolver you got the tag instead of either
  reading. Selection now runs **first** in `substituteTags`, so a `<PN>` or
  `<DST>` inside the winning arm still gets filled.

`substituteText` — the ncb Q operator's message, përs comm quotes, government
chatter — deliberately does **not** run the selection pass: the Bible says a Q
message "is parsed for mission text tags ... but not text-selection tags". No
shipped STR# entry carries one, so it is the documented rule rather than a
visible difference. Verified: all 474 texts that carry a selection tag (316
dëscs, 130 outfit, 28 ship) resolve with none left raw, `{G}` follows the
pilot both ways, the one-arm form yields nothing when false, escaped quotes
survive, and the outfitter shows the Vell-os `b424` arm — "you may never be
able to buy any of them ever again" — only once that bit is set.

**The Auroran storyline runs end to end.** Walked leg by leg: 653 (any non-
Family-Heraan bar) → 654 Codec → 655 Dominance → 656 Skye → 657 Heraan →
658 → 659 → 660 → 661 → 664 → 665 → 666 → 667 Rimerta → 668 → 669 → 670 →
671 → 672 → 673 → 674 → 675 → 676 → 677 → 678 Aurora → 679 → 680 → 681
Goliath → 682 → 683 → 684 → 685 New England → **686 Auroran 029 LAST**, which
lands you in S7evyn. Four ranks granted (139, 140, 141, 142). Two things it
exercised for free: **mïsn 676's ShipSyst is 765**, the dropped SPC-1421
variant, which resolves through `systemAlias`; and 679 sets **b323**, which
flips Aurora/Heraan/Moash to their variant gates — all three stayed on the
chart, which is the start-dormant-only rule doing its job.

Two legs are AvailStel **-1** (673 Auroran 016, 683 Auroran 026) and follow a
leg whose destination will not clear you a second time — Viking and Nil'ar
Kemorya both refuse on the way back. They are meant to be taken on the landing
that completes the previous leg, or at any other inhabited world; there is
nothing to fix, but a walkthrough that departs and re-lands has to pick a
friendlier pad.

**The Wild Geese a-path runs end to end too — both branches.** Walked in the
browser: 634 (Earth bar) → 635 → forcing the `R(b804 b805)` roll to b804 →
636 at Earth's **spaceport** → 637 (Mairim) → 638 (Ryll) → 639 "Free Eiric",
whose objective is a **board** in NGC-1894, not a delivery → 640 at Misfire.
640 is the branch, and it renders its own labels from mïsn AcceptButton /
RefuseButton: the buttons read **"Rebels" and "Aurorans"**, not
Accept/Refuse. Taking Aurorans (refuse) sets b811 and **b6666**, the
one-day delay bit that crön 221 clears, after which 641 "Talk with Aurorans"
is offered — it carries AvailRandom 75, so it is a roll per landing. Two
gotchas for anyone scripting this: `landedUi.spaceportOffers` is **drained**
by the first `setView("spaceport")` (one offer per landing, by design), so
read `availableMissions(spob, loc, player)` directly instead; and `main.ts`
now exposes `window.MISSIONS` and `window.availableMissions` for exactly
that, since a dynamic `import()` yields a separate, empty module instance.

**Crossfire: one tolerance band, no target special case.** Ships turned
hostile far too easily, and inconsistently — a single hit provoked instantly
if the ship happened to be the player's current target, and otherwise fed a
damage accumulator, so whether a graze started a war depended on whether you
were cycling targets or hailing at the time. The Bible says nothing about
this, but the **Nova beta history** (same docs folder) records the whole
shape of the rule: "AI ships are more forgiving of accidental weapon hits",
three rounds of "changed / tweaked AI ships' tolerance for stray shots", and
— the entry that pins the inputs — "fixed bug where govt ships would ignore
stray shots if player had an 'always let land' rank", which only makes sense
if the tolerance consults the player's standing with that government. So it
is one accumulator per ship, a reputation-scaled threshold, and forgiveness
over time:

    tolerance = min(maxHp × 0.5, 40 + maxHp × 0.12) × clamp(1 + rec×0.02, 0.4, 3)

The absolute floor is what stops small hulls being hair-triggered — a
fraction-only band let one graze turn a Shuttle while a Leviathan absorbed
twenty, which is backwards, since it is the same shot. The `maxHp × 0.5` cap
keeps the floor under what the hull can actually take, so nothing dies
without ever having fought back. Stray damage decays a full band over
`STRAY_FORGIVE_SECONDS` (8), so a burst that stops is forgotten in the same
wall-clock time whatever the hull; the old decay scaled off maxHp, which had
big ships forgetting instantly and small ones never. Measured in the
browser: a 650-hp Federation trader forgives 24 light-blaster grazes but
turns on the **first** 8-gun Manticore volley — accidents forgiven,
deliberate attacks answered at once — a 40-hp Shuttle forgives 4 and a
3500-hp Leviathan 460, and the same trader's band runs 47 at record -50,
118 at 0 and 354 at +100. The interceptors' "piracy police" cascade stays
inside `provoke()` for the same reason: what they witness is an attack, not
a graze. **The numbers are ours** — the beta history proves the shape, never
the constants, so retune `strayTolerance` freely on feel.

**Hypergates / wormholes (Bible-aligned transit).** Selecting a working
hypergate (L cycle or click) starts the ring open animation; landing on it
when slow enough opens the **normal galaxy map** as a destination chooser —
same fog of war, gold link lines only to that gate's HyperLink systems, arrow
**Tab** cycles links (highlight only — map does not pan), Enter/Travel jumps.
Transit is **instant** (no fuel, no calendar day) after a short hull bleach:
ships fade to white on enter and recolour from white on exit (`gateFlash` on
`Ship`; ~0.38s in / ~0.55s out). You emerge at the **centre** of the far gate
moving outward at **half the hull's maximum speed** — the beta history's
"player and escorts emerge from hypergates/wormholes at half speed", which
replaced a flat guess of landing-speed-plus-20 — so most hulls must brake to
dock again; the far ring is open and immediately closes (L re-opens). Wormholes
have no chooser: land → random far end (unlinked pool or HyperLinks). CustPicID
drives the open/working frame split; CustSndID is emerge angle in Nova degrees
(0 = up, clockwise). Stock rings share one orientation, so a missing/invalid
CustSndID exits at ~4:00 (120°) rather than a random bearing. gövt Flags2
0x0020/0x0040/0x0080 steer NPC leave-via-gate/wormhole vs edge jump. NPCs
leaving via a gate get the same enter bleach before they leave the board.

**A wormhole is not a hypergate, and the hypergate lock is not an engine
rule.** `tryLand` tested `isHypergate || isWormhole` and then demanded ränk
147, so **every wormhole in the game was shut to every pilot who had not
finished Sigma4** — including the one in **Sol**, which is the first system
most players ever see one in. The data says both halves of that are wrong:

- All 19 working hypergates belong to **gövt 183 "Hypergate"** and read
  **MinStatus 32767**, the value the beta history says was added "for
  unavailable hypergates". **ränk 147 "Have Access to Hypergate System" is
  affiliated with gövt 183 and carries Flags 0x0200** — "all planets of the
  affiliated government will let the player land ... regardless of their
  MinStatus field". So Nova opens the network through machinery we already
  had: `clearedToLand` honours that rank flag, and `hasHypergateAccess` is
  **deleted** rather than reimplemented. (The migration that grants rank 147
  to old Sigma4 saves stays — it is still the key, just not a special case.)
- All 24 wormholes are **gövt -1, MinStatus 0, spöb Flags Uninhabited**, so
  they clear for anybody. They are a natural phenomenon, not Federation
  infrastructure.

The remaining 16 "HG-" stellars are **decorative**: gövt -1, no HyperLinks,
and spöb Flags without the can-land bit, which is what `gateIsWorking` reads.

**STR# 2002 84/85/86 are the proof that the engine keeps them apart**, and
they are wired now: 84 "Your ship is unable to" pairs with **85 "enter this
hypergate - it is offline."** or **86 "enter this wormhole - the radiation
levels are too extreme."** — the same kind-pairing as 22/23 and 87/88 — while
**81 "Hypergate usage denied."** is its own string for the network refusing
you, which is the MinStatus path above. We had one hand-written "the ring is
dark and will not answer" for all of it.

Two more from the beta history, both about gates of either kind:

- **"random mission destinations can no longer be hypergates".** A working
  hypergate is landable and *not* flagged uninhabited, so all 19 sat in the
  pool `resolveStel` draws a -2 or govt-coded TravelStel from — a cargo run to
  HG-Kania. Wormholes were already excluded by the uninhabited test. Missions
  that name a gate outright still work; only the random draw is filtered.
- **"hypergates and wormholes can't be hailed".** Targeting one and hailing
  opened traffic control, greeting and all.

Verified in play from a rankless pilot: the Sol wormhole transits to Chirt and
the Shuttle emerges at 120 of its 240 top speed, HG-Kania answers "Hypergate
usage denied." until rank 147 is granted and then powers up, HG-Vega reads
"…enter this hypergate - it is offline.", hailing the wormhole is refused, and
621 random destination rolls across every mission produced no gate.

**The destination chooser is the canvas map, and there is no other.**
`LandedUi`'s old HTML chooser — the `"gate"` view, `showGate`/`renderGate`, the
`gateMap` SVG mini-chart and its `.gatemap`/`.gm-*` stylesheet — has been
deleted (~140 lines). It had been unreachable since the canvas chooser landed,
and it still described behaviour the game no longer has: a wormhole listed as
a row reading "Somewhere far away" with an Enter button, where a wormhole now
transits on contact and never opens a panel at all. `Game.gateDestinations`
and `GateDestination` stay — the canvas chooser is their only caller now.

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
see hypergate note above). Letter shortcuts (B/N/T/S/O/R/L) and Esc-to-back
are unchanged. Keys the handler acts on must still call `game.swallowKey`.

**Landing / mission dialogs** (`events`, `offer`): Enter fires the affirmative
(`data-modal-default` — Accept / Continue); Esc fires the negative
(`data-modal-cancel` — Refuse / Decline) or the sole Continue. The Bible never
names these keys. Can't-refuse offers have no cancel; Esc must not Accept.
**Mission log is one panel.** The `missionInfo` keybinding (Classic **I**)
opens `InfoUi` in flight **and** while landed — there is no spaceport Mission
Log button or landed `"log"` view. Abort (when mïsn CanAbort allows) lives on
that panel with a custom confirm overlay.

**In-flight info panels (I / P / Alt-K) must not sit in the full-viewport
force rule.** A PWA pass put `#info-ui`, `#hail-ui` and `#plunder-ui` under
`inset: 0 !important` with `width/height: 100vw/100vh`. Those dialogs centre
with `left/top: 50%` + `translate(-50%,-50%)`, so the combo shoved them
off-screen and the I mission log looked dead. Only `#game`, `#landed-ui`,
`#menu-ui` and `#intro-ui` belong in that force rule.

**The flight sidebar is DOM, not canvas** (`src/ui/hud.ts` + the `.hud-*` block
in `style.css`). It implements Claude Design **3a, "Classic"**, from the *EV
Nova Sidebar Redesigns* project — Nova's brushed-metal plate rebuilt in CSS,
with black chrome-bezelled wells for every readout and a repeating
plate-and-piping "machinery" tail that absorbs whatever height is left over.
(It used to be 2a, "Deep Glass · Orbital", a dark-glass panel; that was
deliberately reversed in favour of looking like the original.) Layered
gradients, inset bezels and engraved type are a stylesheet in CSS and a few
hundred fragile lines in canvas 2D, and the landed screens were already HTML.
The one per-frame thing — the scanner's moving contacts — is a small nested
`<canvas>`.

Consequences worth knowing:

- **The plate is artwork now, and ïntf StatusBkgnd names it.** That field —
  700 for the default bar, 701-706 for the six governments — was the one thing
  on the resource still marked "deliberately undrawn". It is now the id of a
  JPEG at `public/hud/statusbar-<id>.jpg`. Nova's own 700-706 are *not*
  extracted (picts.json has no `status` category), so these are hand-drawn
  replacements, and **all seven governments now have one**. The art is drawn at
  HUD_W wide with `background-size: var(--hud-w) auto`, top-aligned: **it is
  never scaled to fit**, so a short window loses the bottom of the picture and
  nothing distorts.
- **706, Vell-os, is drawn rather than photographed.** The StatusBkgnd id also
  goes on the plate as a `plate-<id>` class, so a government can have a CSS
  skin instead of a JPEG, and Nova's Vell-os bar is the one plate that wants
  one: it is not metal at all but black, with cyan light piped around every
  opening and down both outer edges, fading below the instruments into a faint
  blue haze. Sampled off the original — edge piping `#48c0f8` beside the
  scanner and gone by the tail, opening outlines near-white cyan `#60e0e0`,
  ground `#001020`, openings pure black. That is gradients and glows, so it
  costs a few lines of CSS instead of a quarter-megabyte JPEG of a gradient.
  Its gradient stops are in **pixels, not percentages**, for the same reason
  the photographs are top-aligned: the light has to die where the instruments
  end (658px) whatever the window height. The rules are scoped
  `.plate-706:not(.has-art)`, so dropping a real `statusbar-706.jpg` in later
  wins without anything here being deleted first.
- A government with neither a JPEG nor a `plate-<id>` rule falls back to the
  CSS metal at the same geometry — one layout, several skins.
- **The plates are drawn 481 wide and shipped at 384**, which is 2× the 192 CSS
  px the panel occupies — sharp on a retina display and no bigger than it has
  to be. `PLATE_W` in `ui/hud.ts` stays **481** because that is the space the
  openings were *measured* in; only the aspect ratio matters at runtime, so
  re-exporting at another width needs no code change, while changing that
  constant would move every readout.
- **They are JPEGs for a reason, and it is not just size.** These are
  photographic metal, which PNG cannot compress — 6.7 MB for the six at 384
  wide, against **1.5 MB** of JPEG q88 at 43-48 dB PSNR. AVIF was smaller
  again (680 KB) but `sips` encoded one of the six into a file Chromium
  fetches whole, reports the correct dimensions for, and then decodes to
  **solid black** — the plate silently vanishes. Re-encoding the same source
  byte-for-byte reproduced it, and flattening the alpha did not help. If you
  re-export these, check each one actually paints; an encoder's exit code
  proves nothing.
- **The eight openings are a fixed contract, and every plate must match.**
  `OPENINGS` in `ui/hud.ts` holds them in the art's own 481x3190 space —
  scanner 21-369, gauges 412-584, nav 627-705, primary 748-799, secondary
  842-893, target 936-1220, cargo/credits/date 1263-1352, controls 1395-1649,
  all spanning x 43-435 — and each readout is positioned absolutely into its
  hole. Nothing reads the image at runtime. Measure a new plate by its **frame
  ridges**, which are all exactly 42px, and take the gaps between them; do
  *not* measure by looking for full-width black, because every hole has a soft
  lit reflection along its top and bottom inside edges and that test cuts each
  one short by ~25%. The six shipped plates agree to within ±11 art px (±4.4
  panel px) rather than exactly, which is fine — the differences are per-plate
  and systematic, i.e. how hard each one's bevel is drawn, not a hole in the
  wrong place. Two holes are tight and the code works around them: the
  primary hole is one line, so four primary slots collapse to "name +3", and
  the cargo hole is three lines, so Free and Credits are emitted first and
  the per-commodity manifest (ours, not Nova's) is what gets clipped. The
  date was a third line here until it moved to the map (see below), which
  buys the manifest one line back.
- **There is no EJECT button, by choice.** The plate is instrument holes and
  decorative tail with nowhere to put one, so pulling the pod's handle is
  Alt-X and only Alt-X. `playerDestroyed(deliberate)` and oütf ModType 20's
  auto-eject are unaffected — see "Death is the end of the run" above, which
  still holds in full. Note the key-hints hole does not currently advertise
  Alt-X; all sixteen of its slots are spoken for.
- **The ïntf also sets the width, the gutter, the colours, the font and the two
  type sizes** — everything except vertical position. `publishInterfaceVars()`
  in `data/universe.ts` writes them to `--hud-*` on `documentElement` and is
  re-run by `setInterfaceForGovt`, so flying a Polaris hull restyles the whole
  plate. Two horizontal measures the design happened to agree with are now
  taken from the resource outright: radarArea is 176 square at x=8, so the
  plate is 192 wide and the scanner is square; shieldArea starts at x=35,
  leaving the 27px gutter that is Nova's own column of gauge icons. The rects
  still cannot *position* anything vertically — the artwork's openings do
  that now.
- **The font is the ïntf's own StatusFont**, "Geneva" on all seven shipped
  interfaces, at StatFontSize 12 with SubtitleSize 10 for the target subtitle
  and the ledger labels. Geneva is still installed on macOS, so on the
  platform Nova shipped for this is literally the original face; the stack
  falls back to Verdana, its usual metric stand-in, elsewhere. Chakra Petch is
  no longer used by the HUD (JetBrains Mono still is, for the small stencil
  tags); both stay self-hosted in `public/fonts` — the game reads everything
  else locally and should not need the network to look right.
- **The plate carries no pilot name, no government and no scanner labels.**
  3a's scope is bare glass and so is Nova's; those were 2a's and were removed
  on request. The remaining non-Nova blocks — the primary-weapon lines and
  the key hints — are kept but drawn in the same idiom.
- **The date is not on the plate.** It was a third line in the cargo well and
  now closes out the map's destination panel (`drawMapPanel`), ruled off below
  Goods Traded / Services in that panel's own label-over-value idiom. It is
  anchored to the foot of the box rather than following the content's `ty`,
  because how far the goods and services lists run depends on which system is
  selected. Days pass by jumping, so it belongs on the chart you plan the jump
  from.
  `formatDateShort` in `game/calendar.ts` has no caller left; it is kept
  because it is the plate-width form, should anything want it back.
- **The full-screen map lays out left of the plate, not under it.** The
  sidebar stays up in map mode (`setVisible(flight || map)`) and is opaque,
  so `renderMap` taking the whole canvas width hid 176 of the 186 columns of
  its right-hand readout — government, standing, goods, services — and the
  map looked like it had no panel. It now paints its backdrop the full width
  (nothing of the flight scene shows through beside the bar) and lays the
  chart, panel, footer and buttons out in `fullW - SIDEBAR_W`. Everything
  clickable — `mapNodes`, `mapButtons` — is recorded during that same pass in
  canvas coordinates, so the hit tests followed the change for free.
- **Fuel is one continuous bar, with no jump count.** It used to be a segment
  per jump with "N JUMPS" printed beside it; 3a's plate has neither, and both
  were removed on request. The ïntf's two fuel colours survive the change —
  FuelFull fills, FuelPartial is the trough behind it — so nothing that was
  data-driven became a literal. Afterburning still takes the bar gold.
- **The key hints are a lit well, not engraved metal.** The plate stamps its
  *labels* into the brushed grey, which is right for something glanced at, but
  the hints are read: dark ink on the metal came out around 3:1 at 8px. They
  are now dim mono on black inside a bezelled well like every other readout,
  which is ~11:1. Don't move them back onto the plate.
- **`#hud-ui` is click-through** (`pointer-events: none`) so the canvas
  underneath still gets the mouse. Nothing on the panel is interactive today;
  anything added that should be must opt back in with `pointer-events: auto`,
  or it will look live and do nothing. That is exactly how the old EJECT
  button shipped broken.
- **Nothing flexes any more.** The panel used to be a flex column that gave up
  scanner height on a short window and dropped the key hints under 830px; with
  fixed artwork behind it that is wrong, so every block is at a fixed y and a
  short window simply loses the bottom. The last opening ends at 658px, so any
  window ≥ 660 tall shows the complete instrument set. Verified at 960, 900 and
  560px. The radar still scales off the smaller half-dimension so a
  letterboxed scope stays circular.
- `HUD_W` in `ui/hud.ts` is the single source of the sidebar width; `game.ts`
  takes `SIDEBAR_W` from it so the reserved canvas and the panel cannot drift.
- The HUD reads private Game state through small accessors (`hudClock`,
  `hasIff`, `cloakBits`, …) rather than those fields being made public.

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

**spöb MinStatus is measured against the per-system ledger — the Bible's
"your record in the current system", now taken literally.** An earlier pass
read it against the stellar's own government instead, reasoning from
Spacedock V: a Federation station (MinStatus 2) in Roughnecks space, on a
storyline that pays only Federation CompRewards — under the old
one-number-per-govt record model, reading the system meant reading the
Roughnecks and the storyline could not be finished. The per-system model
dissolves that: the Roughnecks' Ally classes include 1, the Federation's, so
Federation rewards lift Nesre Secundus at ally weight and Spacedock V clears
on its own system's record. The four independent gated stellars (Reflex-ion,
Pan, Beacon, Keystone, all -5) read their system's ledger too, which for an
untouched independent system is 0. ränk Flags **0x0200** — "all planets of
the affiliated government will let the player land ... regardless of their
MinStatus field" — is still honoured against `landingGovtId` (the stellar's
own govt, system fallback); 19 of the 31 ranks carry it.

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

**Your escorts' holds are yours — for commodities, and only from traders.**
Escort capacity was never pooled: `cargoCap` was hull + outfits and a hired
Sprite's 500 tons did nothing. The manual's *Escorts and Fighters* section
states both halves of the rule in one breath — escorts are worth having for
"providing additional cargo space on a profitable trade route", but "any
special cargo you need for a mission must always fit into your ship's own
cargo hold; no one else can be trusted with it". The Bible then narrows *who*:
shïp **InherentAI** @66 — "only ships with inherent AI of 1 or 2 can be used
to carry cargo when they are the player's escorts", the two trader AIs. Of the
79 hireable hulls only **27** read 1 or 2, so a hired Manticore's 500-ton hold
is worth nothing to you and a Sprite's is worth all of it.

The model is in `src/game/cargo.ts` and is entirely derived from the escort
list — no per-escort stowage state, nothing new in the pilot file. Things worth
knowing:

- **`player.cargoCap` still means the hull**, and must keep meaning it: it is
  the only figure mission freight may use. The fleet-wide number is
  `totalCargoCap`, surfaced as `Game.cargoCapacity()`. The two free-space
  questions are different and both are asked — `freeCommoditySpace` (buying,
  plunder, minerals) and `freeHoldSpace` (mission offers and `acceptMission`).
  Reaching for `cargoCap - cargoUsed()` again gets one of them wrong.
- **Commodities fill the escorts first and spill back into your hull.**
  Neither document says how a load is distributed, so this is ours, and the
  reason is that the other way round is a trap: a full hold would lock you out
  of mission cargo while your escorts flew empty. As it stands 400 tons aboard
  a Shuttle with a Sprite escort leaves the Shuttle's own 10 tons free.
- **Losing an escort spaces the overflow.** `enforceCargoCapacity` runs from
  `Game.settleFleetCargo()` on every path the wing shrinks — a death, payroll
  defection, dismissal, and taking a smaller prize as your flagship. Nothing
  says what becomes of the goods, and losing them is the only reading that
  makes the borrowed space a risk rather than free storage. Mission freight is
  never touched: it was in your own hull all along.
- `buyShip` checks the *hull's* share against the new hull, not `cargoUsed()`
  — the wing's holds come with you.
- The hiring hall states the rule before you pay: a "Carries For You" line
  reading `500 t` or `None (500 t, warship crew)`, and the wing heading totals
  it. The Alt-K cargo panel adds a Stowed line splitting aboard from escorts.

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

- **Landing bribes are live, and the will/always split is honoured.** gövt
  Flags **0x4000** "Planets of this govt will take bribes" and **0x8000**
  "... demand a larger percentage of your cash supply, and their planets will
  always take bribes" both feed the planet-hail Offer Bribe flow, and a
  record-refused landing on a bribable world now opens traffic control
  directly instead of hanging up (`tryLand` → `hailPlanet`), which is how the
  original lets anyone buy their way down to Harbor (spöb 422, MinStatus 2,
  the only world in Scheall — its govt 137 sets both flags). The opening ask
  mirrors the ship bribe: 2000 + 10% of cash, a third for 0x8000 worlds — the
  Bible's own 0x8000 text ties the larger cut to planets. A 0x4000-only world
  refuses a player whose record there is below -20 (the threshold is ours,
  reusing the greeting's "disgrace" line; the will/always split is the
  Bible's). Two other things about that storyline: mïsn 645 "Take
  Peace-Proposal to McGowan" also completes without a bribe because an active
  mission whose destination is the planet overrides the clearance check in
  `tryLand`, and the pirates shooting at you regardless are gövt Flags 0x0001
  Xenophobic — hostility says nothing about the landing rules.
- **The rating multiplier is 0.2, measured.** A crafted pilot at rating 6
  killed one Valkyrie Class I (shïp Strength 200) in the original and came
  out at 46, so Nova banks a fifth of a destroyed hull's Strength. We keep
  the ledger in raw Strength, so `RATING_THRESHOLDS` is the Bible's Appendix
  I list × 5 and `RATING_POINT_SCALE` (5) converts a mïsn AvailRating into
  our units. The earlier 10× guess put every rating gate at twice its true
  cost. Level names now come from **STR# 138**, which holds exactly the
  eleven the Bible prints; raw 230 (Nova 46) reads "Little Ability", which
  is what the original's own title screen showed for that pilot.
- **The crime model is measured and exact.** A Fed Destroyer (gövt 128,
  DisabPenalty 1 + KillPenalty 5 = 6) was destroyed in **Altair** in the
  original, from a crafted pilot whose ledger was zeroed first and who never
  left the system. Every system that moved fits `floor(penalty/(hops+1))`:
  Altair -6, Kania/Tenetria/Galvan (1 jump) -3, Tichel (2) -2, Sol and
  Fomalhaut (3) -1. The recipient set is equally sharp — those seven are
  **exactly the Federation systems within three jumps**. Independent,
  Auroran, Rebellion and Pirate systems inside the same radius took nothing,
  and the 50 Federation systems at four jumps or more took nothing, so the
  reach is a flat **3 jumps**, not "as far as the arithmetic still rounds
  to 1". Both facts are in `applyGovtRecord`.
- **The crime site is charged DisabPenalty + KillPenalty together**, twice
  confirmed: 1 + 5 = 6 in Altair, and 3 + 7 = 10 for a Pyrogenesis kill in
  Tichel. You cripple a ship on the way to destroying it, so both land.
- **Nothing ever goes up.** In both runs the victim's enemies sat well inside
  the radius and were untouched, so the Bible's "doing evil deeds to one
  government will improve your rating with its enemies" does not fire. Only
  allies are unverified — no allied-government system happened to lie within
  three jumps of Altair — and they are included on the Bible's word at the
  same falloff.
- **The .plt legal array is at byte 5150**, not 5148. An earlier off-by-one
  read every system's record as its neighbour's, which is what made the first
  experiment unreadable: the kill looked like it had happened in Sol when the
  player had said Tichel, and five different hypotheses were tested and
  discarded against data that was simply shifted by one. The base is settled
  by scoring candidates against gövt InitialRec across all 398 systems —
  5150 matches every one, 5148 misses 22. **Verify an offset that way before
  building on it**: the seeded pattern is a free oracle, and a near-miss base
  looks plausible enough to fool a spot check.

- **Legal records are per-system now — Nova's own model.**- **Legal records are per-system now — Nova's own model.** `reputation.ts`
  keeps a sparse ledger keyed by sÿst id: an untouched system reads its owning
  govt's InitialRec (the original .plt seeds exactly so — Nil'kemorya -5,
  Family Dani +2, Krypt +10), and `applyGovtRecord` lands every crime, comp
  reward and smuggling charge on all systems by the *system govt's own*
  relation to the acted-on govt — its systems in full, allies' at half,
  enemies' a quarter and inverted. `getGovtRecord` is a govt's standing view
  of the player (local ledger on its own or allied turf, its home systems'
  ledger elsewhere) and backs ship hails, provocation tolerance and
  `hostileToPlayer`, which also honours gövt Flags 0x0002 (nosy: reads the
  local ledger even off its turf). chär starting records seed per system;
  old per-govt saves migrate on load (`migrateGovtRecords` in `backfill`).
  `PlayerState.records` is legacy — nothing writes it. Verified in the
  browser: a fresh pilot shows the InitialRec pattern with zero stored
  entries, and one govt-137 pirate kill puts Scheall at -2 and every
  Federation system at +1 across 178 touched ledgers.
- **NPC gunnery is fixed — don't redo.** Every primary now fires
  independently on its own per-weapon cooldown with its own lead point,
  turrets and quadrant guns bear by their arcs rather than the nose, ammo
  depletes per weapon, and secondaries fire on `missileCooldown` — one
  missile type at a time, with fighter bays deploying one fighter per reload
  when no missile is available. NPC aim honours the difficulty setting:
  "hard" uses the exact lead point, "normal" averages the lead with the
  target's current position so the player can dodge by turning. NPC-on-NPC
  boarding also got a real three-phase dock (approach → brake → drift in).
- **shän `WeapImageID` weapon glow: the trigger and the decay rate are both
  measured now — don't retune without new data.** The glow lights on *any*
  weapon fire by a hull that has the sprite: it is a shän (hull) property,
  and the wëap-flag gate an earlier pass used (0x0200) is actually "weapon
  generates small smoke" — no stock weapon carries it, so the overlay could
  never trigger at all. `WeapDecay`'s unit was timed against the original
  (Wine build, decay-10 Manticore firing Ion Cannons): the glow was still
  visible ~1.6s after the last shot and gone by ~2.8s, ruling out
  wd/255-per-30Hz (0.85s). It now fades at wd/255 per 10Hz — 25.5/wd
  seconds, so the Bible's "good median" 50 is a half-second flash, the
  Manticore holds ~2.5s, and the slowest shipped hulls (3-5) keep a 5-8s
  afterglow. Crafted test pilots for this kind of probe: the Windows .plt is
  unencrypted — ship type index @6, outf counts @4126, weap counts @9246,
  ammo @9758 (see also the per-system legal array @5148 and bits @0xb7c2).
- **shän `ShieldImageID`** is `-1` on all 288 hulls and **`AltImageID`** is set
  on exactly one, so both are recorded but nothing renders them.
- **wëap `SubLimit`** is 0 on the only recursive weapon (Nanites), which can be
  read as neither "never split" nor "split forever"; an unstated limit is
  currently treated as a single split.
- **ShipGoal 6 (chase off) costs the Rebel II half of the Rebellion.**
  `availableMissions` drops any mission with `shipCount > 0 && shipGoal > 5`,
  and eleven missions carry goal 6. Ten are optional defence flavour, but
  **391 "Defend Rebel II; Rebel II18"** is the only thing in the shipped data
  that sets **b188**, which 389 (Rebel II19) requires — so the branch reached
  by *failing* Rebel7 (339's OnFailure is `b199 b132`, against the accept path's
  `b132` alone) dead-ends there. Verified standing on Rebel II with b189 set
  and record 40: the spaceport board is empty, and the filter runs before the
  AvailRandom roll so the mission is categorically absent. The Rebel I half is
  unaffected and completes.
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
- **Escort upgrade and sale are live** — the escort hail offers Upgrade
  Escort (shïp `UpgradeTo`, priced by `EscUpgrdCost`) and, on captured
  escorts, Sell Escort (`EscSellValue` via `escortSellValue`); both settle at
  the next shipyard landing (`processEscortPending`). `Subtitle` renders in
  the HUD target well and the shipyard Info dialog. Still unread: shïp
  `Flags3`, and `EscortType`'s four categories are not yet shown anywhere —
  the Bible only uses the field to organize the escort control menu, so a
  category label on the escort hail or hire hall is all it is owed.
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
- **gövt `DisabPenalty` and `BoardPenalty` are charged now.** DisabPenalty
  lands once, on the player shot or beam pass that first cripples a ship
  (both hit sites in `game.ts` compare `disabled` across `takeHit`);
  BoardPenalty lands in `tryBoard` as the boarding party crosses over, before
  the plunder panel opens — reactivating your own disabled escort charges
  nothing, and the derelict governments' penalties are 0 in the data so
  boarding a Drifting Derelict stays free. Escort-inflicted disables charge
  nothing (only the player's own fire does); their kills still charge
  KillPenalty via `destroyNpc`. ShootPenalty stays deliberately uncharged.

### Queue, roughly by size

Most of the earlier queue (pers loadout/HailPict, roid fragments, spob Fee /
misn DatePostInc / junk BuyOn+SellOn, colr, ScanMask) is done — see above.
Still open or only half-landed:

1. **WeapDecay is measured and pinned** — see the weapon-glow entry above.
2. **Mass → days/jump is done** — shïp Mass bands set 1/2/3 days per jump and
   the two density-scanner blip sizes; ModType 22 still shifts the total with
   a floor of 1.
3. **sÿst @110-140** — still unidentified (~32 bytes); does not block play.
7. **Status-bar plate revisions.** All seven governments are covered — six
   JPEGs and the drawn Vell-os skin — so this is only open if the artwork is
   revised. Two cut-outs would be worth resizing across all seven: the
   **cargo** hole is three lines, so a loaded hold's per-commodity manifest is
   clipped (roughly double its height to keep it), and the **primary weapon**
   hole is one line, which is why four slots read "name +3". There is also
   nowhere to put an EJECT button, which is why there isn't one.

   A new plate is drawn 481 wide to the geometry in `OPENINGS`, exported at
   384 wide as JPEG q88, and **checked that it actually paints in the browser**
   rather than trusting the encoder.

   On size: the six shipped plates total **1.5 MB**, nothing beside the 98 MB
   of extracted game data. The `.gitignore` note still applies — images don't
   delta, so every revision of a plate adds its full size to history again —
   so prefer `git commit --amend` when re-exporting the same plate.
