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

## Files

All resized on commit — square assets to 1024, perspective reference to 1280
wide. The whole folder is ~25 MB; images do not delta, so resize *before*
committing a replacement rather than after.

```
corridors/corridor-lit.png        the reference look, powered
corridors/corridor-dark.png       the same corridor dead — the resting state
materials/wall-main.png           main bulkhead tile
materials/wall-grimy.png          the same wall, unlit and oxidised
materials/trim-light-channel.png  angled trim with a recessed light channel
materials/deck-plate.png          diamond tread with a worn walkway
materials/door-face.png           armoured door face, hazard band
panels/breaker-dead.png           the switch, unpowered
panels/breaker-live.png           the switch, powered — pixel-aligned with the above
panels/locker-closed.png          loot, closed
panels/locker-open.png            loot, open
doors/bulkhead.png                what every sightline terminates on
rooms/compartment.png             equipment compartment
rooms/reactor.png                 two-deck reactor space
rooms/bridge.png                  bridge with forward viewport
props/crates.png                  cargo containers
props/consoles.png                console, terminal, opened access panel
props/conduit.png                 cabling, pipe, gas cylinder
```

### The breaker pair is a free emissive map

`breaker-dead.png` and `breaker-live.png` are the same 1024x1024 render with
identical framing and identical lighting — only the glowing elements differ.
Subtracting dead from live yields a clean emissive layer (gauges, breaker
slots, label strips, dials, lamps; 5.5% of the frame, everything else black).

So the implementation of the reveal is: the dead image is the wall texture, the
difference is an additive layer, and throwing the switch fades one over the
other through the compositing path `raycast.ts` already has for explosions.
**Any future panel pair must keep this property** — same framing, same
lighting, only the emission changes.

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

- **The airlock interior.** First and last thing seen every run.
- **A breach.** Nothing else so far explains why the ship is dead, and a torn
  hull with starfield through it says it with no writing at all.
- **Lower priority, only for capital hulls:** an air canister in a wall bracket,
  and a vertical ladder through a deck hatch.
- **Later, if a second ship class is wanted:** the same set again in the navy
  palette. The structure would not change, only the material.

## Audio needs nothing

Nova's own bank covers it: `snd-390` Airlock for doors, `snd-150..154` for
interaction beeps, `snd-371` Klaxxon and `snd-370` Red Alert for the low-air
warning, `snd-10034` "Rundown station" as room tone, and `snd-380`/`snd-381`
Cloak Off/On — a 1.25s falling and rising energy swell that is very close to a
panel powering down and up. Footsteps and breathing are the only gaps and are
cheaper synthesised in Web Audio than shipped as files.
