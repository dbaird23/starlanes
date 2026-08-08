# Art reference — Derelict

Target look for the on-foot mini-game in `src/game/fps/`. Drop reference images
in the subfolders below; this file records what has been read *out* of them, so
the build agents have a spec whether or not they can see the pictures.

## Naming — read this before adding files

`.gitignore` carries `* [0-9].*` to swallow Finder/sync duplicates ("game 2.ts").
A file called `corridor 1.png` matches that pattern and will be **silently
ignored by git**. Use hyphens or underscores: `corridor-1.png`, `corridor_01.png`.

## What's here

```
corridors/   perspective shots that set proportion, rhythm and lighting
materials/   flat, straight-on close-ups that get cut into wall tiles
panels/      breakers, terminals and lockers — dead and live. The verb.
props/       what's lying around: crates, consoles, conduit, cabling
rooms/       spaces that are not corridors
doors/       bulkheads and hatches — the view always terminates on one
airlock/     where every run starts and ends
damage/      breaches and scorching — why she is dead
```

## The spec, read off the first two corridor references

Two images: a white greebled industrial corridor, and a navy one lit with cyan
backlighting and warm white ceiling panels.

### 1. The cross-section is an octagon, and it is straight in plan

The 45° angles in both images are **not floor-plan angles** — they are the
profile. Floor, lower chamfer, vertical wall, upper chamfer, ceiling. In the
navy corridor the benches are the lower chamfer and the backlit blue panels are
the upper one. Neither corridor bends.

This is why the renderer stays a raycaster. A column is already drawn as a
vertical strip; it becomes three bands — lower chamfer, main wall, upper chamfer
— each with its own texture and shading. At 45° the band heights fall out of the
per-column distance the DDA already computes.

Starting profile, as a fraction of corridor width (refine against a straight-on
shot if we get one — these are read off a perspective image and are a first cut,
not a measurement):

| Band | Share of width |
|---|---|
| Floor | ~0.45 |
| Lower chamfers | ~0.27 each |
| Vertical walls | full remaining height |
| Upper chamfers | ~0.27 each |
| Ceiling | ~0.45 |

Corridor reads roughly as wide as it is tall.

### 2. Rhythm down the length

Structural frames segment the corridor into bays at a regular interval. This
does more against the endless-tube read than any single texture will. Every
corridor should be visibly divided into bays rather than running as one tube.

### 3. Light strips are the primary visual

Vertical pairs set into the chamfer edges in the white corridor; ceiling panels
down the centre in the navy one. They are **emissive**: they must not be fogged.
They go through the additive composite path already built for explosions in
`raycast.ts` (`RaySprite.additive`).

### 4. Floor

A dark centre runner on a lighter deck, the deck catching a reflection of the
strips. Both references do this; it reads as a walked route.

### 5. Two complete palettes

- **White industrial** — cool grey-white ground, small warm orange indicators.
- **Navy** — slate/navy ground, cyan glow, warm white ceiling panels.

Small warm accents on cool ground, in both. These map directly onto
per-government wall sets: the material changes, the structure does not.

### 6. The view terminates on a door

Never an infinite tube — always a bulkhead, with hazard striping and a bay
number. Worth treating as a rule of level design, not just set dressing.

### 7. These are the "after" state

Both references are powered ships with the lights on. Derelict is that corridor
**dark**, found by suit lamp — and the moment a panel comes up is the moment a
section turns into the reference. So these images are the target for the reveal,
not for the resting state.

## Still wanted

- **Panels, in both states.** The whole game is walking up to one and holding a
  key, so this is the most-looked-at object in the build and the dead-to-live
  transition is the reward. Breaker, terminal, locker closed, locker open —
  each unpowered and each lit.
- **The airlock interior.** First and last thing seen every run.
- **A breach.** Nothing else so far explains why the ship is dead, and a torn
  hull with starfield through it says it with no writing at all.
- **Material close-ups.** Flat-on, filling the frame, evenly lit. There are none
  yet, and perspective corridor shots cannot be cut into tiles — a tile with
  perspective baked into it fights the perspective the renderer is drawing.
  Four or five distinct materials covers a whole ship.
- **A room that is not a corridor.** Both references are corridors; the deck
  needs compartments, a reactor space and a bridge.
- **A door or bulkhead, straight on.** Point 6 makes this load-bearing.
- **Props.** Crates, consoles, conduit, spilled cargo — the second-biggest lever
  against the boxy read after geometry.
- **A dark or powered-down interior**, ideally as a matched pair with the same
  corridor lit — that pair *is* the reveal when a panel comes up, and it shows
  how much work the light is doing.
- **Lower priority, only for capital hulls:** an air canister in a wall bracket,
  and a vertical ladder through a deck hatch.

## Audio needs nothing

Nova's own bank covers it: `snd-390` Airlock for doors, `snd-150..154` for
interaction beeps, `snd-371` Klaxxon and `snd-370` Red Alert for the low-air
warning, `snd-10034` "Rundown station" as room tone, and `snd-380`/`snd-381`
Cloak Off/On — a 1.25s falling and rising energy swell that is very close to a
panel powering down and up. Footsteps and breathing are the only gaps and are
cheaper synthesised in Web Audio than shipped as files.
