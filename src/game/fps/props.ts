/**
 * The clutter: what makes a compartment read as somewhere people worked.
 *
 * The deck is a beautifully built empty tube, and an empty tube is the one thing
 * a *derelict* cannot be. What is missing is not detail — every surface already
 * carries its own photographed steel — it is **evidence of the crew**: things
 * that were being used when whatever happened happened, and are now lying where
 * they stopped.
 *
 * Three rules, and they are all about staying out of the way of the run:
 *
 * - **Props never block.** `sim.ts` collides against the grid and nothing else,
 *   so a crate you can walk through is a bug you can see. Everything here hugs a
 *   bulkhead, in the dead space between the bench and the wall that the player's
 *   own radius already keeps them out of.
 * - **Props never sit on a station.** A breaker you cannot see is a breaker that
 *   is not in the game; `PROP_CLEAR` keeps the clutter off them.
 * - **Props are deterministic.** A hash of the cell, not `Math.random`. A deck
 *   the player is meant to learn — where the second run is faster because you
 *   know the way — cannot rearrange itself between attempts.
 */

import type { FpsLevel } from "./types";
import type { Station } from "./salvage";

export type PropKind =
  /** a shipping crate, stacked against the bulkhead */
  | "crate"
  /** a gas bottle in its cradle, standing on the bench */
  | "canister"
  /** panelling that came off the wall and is now on the deck */
  | "debris"
  /** a junction box, high on the wall, which is the only one that is not a mess */
  | "junction";

export interface Prop {
  kind: PropKind;
  /** cells */
  x: number;
  y: number;
  /** height of the prop's *base* above the deck, in cells */
  base: number;
  /** yaw, radians — for boxes, so they are not all square to the corridor */
  angle: number;
  /** scale, 1 being the kind's nominal size */
  scale: number;
  sector: number;
}

/** How close to a station is too close. */
const PROP_CLEAR = 1.2;
/**
 * How far out of the cell's centre a prop stands, toward its wall — and there
 * are two answers, because the section is an octagon and not a box.
 *
 * The **deck** is only the middle ~45% of the corridor; outside that the lower
 * chamfer rises as a bench, and anything standing at 0.33 is not against the
 * wall, it is buried in the bench at the angle the bench happens to be. 0.21
 * puts a crate's back against the foot of the bench, which is where a crate
 * that had been pushed out of the way would be.
 *
 * A **junction box** is the opposite: it is bolted to the vertical face, which
 * only exists above the bench, so it wants nearly the full half-cell.
 */
const HUG_DECK = 0.21;
const HUG_WALL = 0.45;

/**
 * A stable hash of a cell. The constants are the usual triple of large primes;
 * what matters is only that it is a pure function of the coordinates, so the
 * same deck dresses the same way on every run and in every session.
 */
function hash(x: number, y: number, salt: number): number {
  let h = (x * 73856093) ^ (y * 19349663) ^ (salt * 83492791);
  h = Math.imul(h ^ (h >>> 15), 2246822507);
  h = Math.imul(h ^ (h >>> 13), 3266489909);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

/** The direction of a solid neighbour, as an angle pointing into the cell. */
function wallFace(level: FpsLevel, cx: number, cy: number, pick: number): number | null {
  const { w, h, cells } = level;
  const found: number[] = [];
  const dirs: [number, number, number][] = [
    [1, 0, Math.PI],
    [-1, 0, 0],
    [0, 1, -Math.PI / 2],
    [0, -1, Math.PI / 2],
  ];
  for (const [dx, dy, facing] of dirs) {
    const nx = cx + dx;
    const ny = cy + dy;
    if (nx < 0 || ny < 0 || nx >= w || ny >= h || cells[ny * w + nx] !== 0) found.push(facing);
  }
  if (!found.length) return null;
  return found[Math.floor(pick * found.length) % found.length];
}

/**
 * Dress the deck.
 *
 * The mix is deliberately weighted toward the deck rather than the walls: what
 * sells an abandoned space is things that *fell*, and a corridor whose greeble
 * is all neatly bolted at chest height reads as maintained.
 */
export function placeProps(level: FpsLevel, stations: Station[]): Prop[] {
  const out: Prop[] = [];
  const startX = Math.floor(level.start.x);
  const startY = Math.floor(level.start.y);

  for (let cy = 0; cy < level.h; cy++) {
    for (let cx = 0; cx < level.w; cx++) {
      const ci = cy * level.w + cx;
      if (level.cells[ci] !== 0) continue;
      // the cell you open your eyes in stays clear, so the first shot is the
      // art direction's: a long sightline down a corridor, not a pile of boxes
      if (cx === startX && cy === startY) continue;

      const r = hash(cx, cy, 1);
      if (r > 0.34) continue;

      const facing = wallFace(level, cx, cy, hash(cx, cy, 2));
      if (facing === null) continue;

      const pick = hash(cx, cy, 3);
      const kind: PropKind =
        pick < 0.38 ? "crate" : pick < 0.62 ? "debris" : pick < 0.84 ? "canister" : "junction";
      const hug = kind === "junction" ? HUG_WALL : HUG_DECK;
      const px = cx + 0.5 - Math.cos(facing) * hug;
      const py = cy + 0.5 - Math.sin(facing) * hug;
      if (stations.some((s) => Math.hypot(s.x - px, s.y - py) < PROP_CLEAR)) continue;

      out.push({
        kind,
        x: px,
        y: py,
        /*
         * A junction box is bolted to the wall at head height; everything else
         * stands on the deck. A canister on the *bench* was the first cut and it
         * was wrong twice over — the bench is a 45 degree slope, so a cylinder
         * standing on it either floats or sinks, and there is no reading of the
         * geometry where both ends of it touch.
         */
        base: kind === "junction" ? 0.62 : 0,
        // boxes are nudged off square: nothing in a wrecked ship is aligned
        angle: facing + (hash(cx, cy, 4) - 0.5) * 0.5,
        scale: 0.8 + hash(cx, cy, 5) * 0.5,
        sector: level.sectorOf[ci],
      });
    }
  }
  return out;
}
