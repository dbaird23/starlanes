/**
 * The hand-authored decks, and the creatures on them.
 *
 * Levels are ASCII so a second one is data rather than code. `parseLevel`
 * turns the glyphs into a flat `Uint8Array` of wall ids — `0` is deck, and
 * anything else indexes a wall material — plus the player start, the extract
 * point and the spawn list.
 *
 * Three things sit on top of that grid, and the first two are Doom's data model
 * rather than a raycaster's:
 *
 * **Sectors.** A second, parallel ASCII layer names a region per cell, and each
 * region carries a light level and an overhead height. Light belongs to an
 * area, not to a wall — which is what lets a section be dead while the one you
 * came from is lit, and what a portal or visplane renderer would want if this
 * one is ever swapped out.
 *
 * **Bays.** The art direction is emphatic that a corridor must read as a run of
 * framed bays rather than one tube, and the cheapest way to say that is a
 * different wall material at a regular interval. That is applied here rather
 * than authored glyph by glyph: any hull cell standing on the bay grid is
 * promoted to `WALL.frame`, so the rhythm is a property of the deck and every
 * corridor gets it for free, whichever way it runs.
 *
 * **The section.** The 45 degree fold is not derived here at all any more: the
 * corridor is real geometry, built from this grid once at level load by
 * `mesh.ts`. What this file still owes it is `freeSpan` — how wide the space
 * through each cell is — because the chamfer is a *fraction* of that.
 */

import { WALL } from "./textures";
import type { FpsEnemyDef, FpsLevel, FpsSector, FpsSpawn } from "./types";

/**
 * Wraith Adult / Youth / Child. Nova draws all three from their own rlëD at 36
 * rotations per set, which is exactly the billboard format a raycaster wants —
 * so the tiers cost nothing but these numbers.
 *
 * They are the right monster for this in a way a ship would not be: the sprites
 * are lit from above and drawn from above, which reads as wrong on anything
 * that walks and reads as fine on something that hovers.
 */
export const ENEMY_DEFS: Record<string, FpsEnemyDef> = {
  adult: {
    kind: "adult",
    name: "Wraith",
    sheet: "ship-1080.png",
    frameSize: 48,
    frames: 36,
    health: 90,
    speed: 1.5,
    reach: 0.9,
    damage: 18,
    attackGap: 1.1,
    senseRange: 11,
    scale: 0.72,
    hover: 0.46,
    boomId: 402,
    deathSnd: 302,
  },
  youth: {
    kind: "youth",
    name: "Wraith youth",
    sheet: "ship-1082.png",
    frameSize: 40,
    frames: 36,
    health: 50,
    speed: 2.1,
    reach: 0.8,
    damage: 11,
    attackGap: 0.9,
    senseRange: 10,
    scale: 0.55,
    hover: 0.48,
    boomId: 401,
    deathSnd: 301,
  },
  child: {
    kind: "child",
    name: "Wraith child",
    sheet: "ship-1084.png",
    frameSize: 32,
    frames: 36,
    health: 26,
    speed: 2.7,
    reach: 0.7,
    damage: 6,
    attackGap: 0.7,
    senseRange: 9,
    scale: 0.38,
    hover: 0.52,
    boomId: 400,
    deathSnd: 301,
  },
};

/** Everything a sector needs; anything omitted takes the standard corridor. */
export interface SectorSpec {
  light?: number;
  height?: number;
  chamfer?: number;
  name?: string;
}

export interface ParseOptions {
  /**
   * A grid the same shape as the deck, one glyph per cell keying `sectors`.
   * Anything unlisted — including a shorter row — falls into sector 0.
   */
  sectorMap?: string[];
  /** glyph → sector. `"."` is the default and is always present. */
  sectors?: Record<string, SectorSpec>;
  /**
   * Structural frames every N cells, in both axes. 0 turns the rhythm off.
   * 3 is the reference's interval read against a 1-cell-wide corridor.
   */
  bay?: number;
}

/**
 * The reference's own profile: floor ~0.45 of the width, a chamfer of ~0.275 of
 * the width on each side. `chamfer` is that **fraction**, applied against
 * whatever the space's free span turns out to be — see `chamferRun` in
 * `mesh.ts`.
 */
const DEFAULT_SECTOR: FpsSector = {
  light: 1,
  height: 1,
  chamfer: 0.275,
  name: "default",
};

/**
 * A derelict freighter's main deck. South (the bottom) is the airlock you came
 * in by and the one you have to get back to; north is the reactor bay.
 *
 * `#` bulkhead · `=` inner housing · `D` door · `.` deck · `@` start · `X` extract
 * `A`/`Y`/`C` Wraith adult / youth / child.
 *
 * Every `D` is in the outer hull, and every one of them caps a run that would
 * otherwise be twenty cells of corridor ending in nothing. Rule 6 of the art
 * direction — "the view terminates on a door, never an infinite tube" — is
 * treated there as a rule of level design rather than as dressing, and in a
 * ship this dark it is also the only thing that tells you a passage has an end:
 * `door-face.png` carries hazard striping, and the door material is the one
 * that emits a little of its own light (`wallEmit`), so the far bulkhead is
 * visible from beyond the suit lamp's reach.
 */
const DECK = [
  "#D#########DD#########D#",
  "D......................D",
  "#.####.####..####.####.#",
  "#.#...A...#..#.......#.#",
  "#.#...=...#..#...=...#.#",
  "#.#.......#..#...A...#.#",
  "#.#########..#########.#",
  "D......................D",
  "#.###.#####..#####.###.#",
  "#.#.......#..#.....Y.#.#",
  "#.#.......#Y.#.......#.#",
  "#.#..=.=..#..#..=.=..#.#",
  "#.#.Y.....#..#.......#C#",
  "#.#.......#..#.......#.#",
  "#.######.##..#########.#",
  "D......................D",
  "#.###.#####..#####.###.#",
  "#.#.......#..#.......#.#",
  "#.#.......#..#..C....#.#",
  "#.#..C....#..#.......#.#",
  "#.#.......#..#.......#.#",
  "#.#########..######.##.#",
  "D.@X...................D",
  "#D#########DD#########D#",
];

/**
 * The derelict's power state, read as sectors.
 *
 * `a` is the airlock end you came in by — emergency lighting still up, so it is
 * the one part of the ship that looks like the reference. It fades north
 * through a half-lit midships into `d`, the dead forward third, and the reactor
 * bay `r` is both dark and two decks tall. Nothing here changes the plan; it is
 * entirely what the light is doing.
 *
 * **These numbers were all roughly halved once the suit lamp existed.** They
 * used to be the only light in the game, so they had to carry the near field as
 * well as the far, and the airlock at 0.85 came out looking fully powered
 * rather than emergency-lit on a corpse. The lamp owns the near field now — see
 * the lamp term in `glscene.ts` — so a sector level is what the *ship* is still
 * putting out, and 0.03 forward is honest: that third is dead, and what you see
 * of it is what you brought.
 */
const DECK_SECTORS = [
  "rrrrrrrrrrrrrrrrrrrrrrrr",
  "rrrrrrrrrrrrrrrrrrrrrrrr",
  "rrrrrrrrrrrrrrrrrrrrrrrr",
  "rrrrrrrrrrrrrrrrrrrrrrrr",
  "rrrrrrrrrrrrrrrrrrrrrrrr",
  "rrrrrrrrrrrrrrrrrrrrrrrr",
  "dddddddddddddddddddddddd",
  "dddddddddddddddddddddddd",
  "dddddddddddddddddddddddd",
  "dddddddddddddddddddddddd",
  "dddddddddddddddddddddddd",
  "mmmmmmmmmmmmmmmmmmmmmmmm",
  "mmmmmmmmmmmmmmmmmmmmmmmm",
  "mmmmmmmmmmmmmmmmmmmmmmmm",
  "mmmmmmmmmmmmmmmmmmmmmmmm",
  "mmmmmmmmmmmmmmmmmmmmmmmm",
  "mmmmmmmmmmmmmmmmmmmmmmmm",
  "aaaaaaaaaaaaaaaaaaaaaaaa",
  "aaaaaaaaaaaaaaaaaaaaaaaa",
  "aaaaaaaaaaaaaaaaaaaaaaaa",
  "aaaaaaaaaaaaaaaaaaaaaaaa",
  "aaaaaaaaaaaaaaaaaaaaaaaa",
  "aaaaaaaaaaaaaaaaaaaaaaaa",
  "aaaaaaaaaaaaaaaaaaaaaaaa",
];

/**
 * The freighter's own section. Every sector keeps the reference's 0.275 of the
 * span, so the *shape* is one shape everywhere and only the size of the space
 * changes it: a one-cell passage gets a 0.275 chamfer and a 45% deck, the
 * two-cell spine asks for 0.55, and the wide compartments ask for more still.
 *
 * The overhead is what actually pays for that, which is why these are 1.2 and
 * not the 1.0 they used to be. Two chamfers eat `2c` of height between them, so
 * a 1.0 overhead can only afford 0.41 and the spine's deck would come out at
 * 59% of its width instead of the reference's 45%. At 1.2 it can afford 0.51,
 * which is 49% — and the eye, still fixed half a cell above the deck, still
 * sits at 40% of the overhead, which is where the reference's camera is. The
 * reactor bay is the exception and is the reason sector height exists: two
 * decks of it, open to the frames, and wide enough to take the full 0.55.
 */
const DECK_SECTOR_DEFS: Record<string, SectorSpec> = {
  a: { light: 0.3, height: 1.2, chamfer: 0.275, name: "airlock" },
  m: { light: 0.085, height: 1.2, chamfer: 0.275, name: "midships" },
  d: { light: 0.009, height: 1.2, chamfer: 0.275, name: "forward (dead)" },
  r: { light: 0.025, height: 1.9, chamfer: 0.275, name: "reactor bay" },
};

const WALL_GLYPHS: Record<string, number> = {
  "#": WALL.hull,
  "=": WALL.housing,
  "|": WALL.frame,
  "D": WALL.door,
};

export function parseLevel(
  name: string,
  rows: string[],
  opts: ParseOptions = {},
): FpsLevel {
  const h = rows.length;
  const w = rows[0].length;
  for (const [i, r] of rows.entries()) {
    if (r.length !== w) {
      throw new Error(`level "${name}" row ${i} is ${r.length} wide, not ${w}`);
    }
  }

  // sector 0 is always the fallback, so an unmapped cell is a lit corridor
  const sectors: FpsSector[] = [{ ...DEFAULT_SECTOR }];
  const sectorIndex = new Map<string, number>();
  for (const [glyph, spec] of Object.entries(opts.sectors ?? {})) {
    sectorIndex.set(glyph, sectors.length);
    sectors.push({
      light: spec.light ?? DEFAULT_SECTOR.light,
      height: spec.height ?? DEFAULT_SECTOR.height,
      chamfer: spec.chamfer ?? DEFAULT_SECTOR.chamfer,
      name: spec.name ?? glyph,
    });
  }

  const cells = new Uint8Array(w * h);
  const sectorOf = new Uint8Array(w * h);
  const spawns: FpsSpawn[] = [];
  let start = { x: 1.5, y: 1.5, angle: 0 };
  let exit = { x: 1.5, y: 1.5 };

  const bay = opts.bay ?? 3;

  for (let y = 0; y < h; y++) {
    const srow = opts.sectorMap?.[y];
    for (let x = 0; x < w; x++) {
      const idx = y * w + x;
      sectorOf[idx] = sectorIndex.get(srow?.[x] ?? "") ?? 0;

      const ch = rows[y][x];
      const wall = WALL_GLYPHS[ch];
      if (wall !== undefined) {
        cells[idx] = wall;
        continue;
      }
      const cx = x + 0.5;
      const cy = y + 0.5;
      switch (ch) {
        // the angle is filled in below, from the plan
        case "@":
          start = { x: cx, y: cy, angle: 0 };
          break;
        case "X":
          exit = { x: cx, y: cy };
          break;
        case "A":
          spawns.push({ kind: "adult", x: cx, y: cy });
          break;
        case "Y":
          spawns.push({ kind: "youth", x: cx, y: cy });
          break;
        case "C":
          spawns.push({ kind: "child", x: cx, y: cy });
          break;
      }
    }
  }

  /*
   * The bay rhythm, applied after the grid exists because it needs to know
   * which way each wall faces.
   *
   * Frames are a ring of hull structure, so they sit on absolute grid lines and
   * line up from one corridor into the next. Which line matters depends on the
   * wall's orientation, and a cell can tell that from its open neighbours: a
   * wall you see from the east or west runs north/south, so its frames step in
   * `y`. Applying both tests to every cell instead would turn the entire
   * `x % bay === 0` column into frames.
   *
   * Only hull is promoted. Housing and doors are authored materials and a frame
   * is a property of the hull, not of everything that happens to be solid.
   */
  if (bay > 0) {
    const open = (cx: number, cy: number): boolean =>
      cx >= 0 && cy >= 0 && cx < w && cy < h && cells[cy * w + cx] === 0;
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const idx = y * w + x;
        if (cells[idx] !== WALL.hull) continue;
        const facesEW = open(x - 1, y) || open(x + 1, y);
        const facesNS = open(x, y - 1) || open(x, y + 1);
        if ((facesEW && y % bay === 0) || (facesNS && x % bay === 0)) {
          cells[idx] = WALL.frame;
        }
      }
    }
  }

  /*
   * Which way you are looking when you come aboard.
   *
   * This used to be hardcoded north — "the deck runs north, so you come aboard
   * facing up the hull" — which was true of the first deck authored and of no
   * other: the derelict's airlock opens onto a corridor running *east*, so a
   * new run began with the camera 0.5 of a cell from a bulkhead. Taking the
   * longest open run out of the start cell states the intent instead of the
   * accident, and gives every deck the art direction's opening shot: a long
   * sightline terminating on a door.
   */
  {
    const gx = Math.floor(start.x);
    const gy = Math.floor(start.y);
    let best = -1;
    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]] as const) {
      let n = 0;
      let x = gx + dx;
      let y = gy + dy;
      while (x >= 0 && y >= 0 && x < w && y < h && cells[y * w + x] === 0) {
        n++;
        x += dx;
        y += dy;
      }
      if (n > best) {
        best = n;
        start.angle = Math.atan2(dy, dx);
      }
    }
  }

  const freeSpan = freeSpans(w, h, cells);

  return {
    name,
    w,
    h,
    cells,
    sectorOf,
    sectors,
    freeSpan,
    start,
    exit,
    spawns,
  };
}

/* -------------------------------------------------------------- free span */

/**
 * How wide the space through each open cell is: the shorter of its horizontal
 * and vertical runs of open cells.
 *
 * The shorter one is the answer because the chamfer is a single 45 degree fold
 * that goes all the way round a compartment. A room 7 cells by 4 takes its
 * section from the 4 — the same octagon on every wall, the way a hull is
 * actually built — where taking each wall's own perpendicular run would give
 * the long walls a chamfer nearly twice the short walls' and no two of them
 * would meet in the corners.
 */
function freeSpans(w: number, h: number, cells: Uint8Array): Uint8Array {
  const spanX = new Uint8Array(w * h);
  const spanY = new Uint8Array(w * h);
  for (let y = 0; y < h; y++) {
    let x = 0;
    while (x < w) {
      if (cells[y * w + x] !== 0) {
        x++;
        continue;
      }
      let e = x;
      while (e < w && cells[y * w + e] === 0) e++;
      const len = Math.min(255, e - x);
      for (let i = x; i < e; i++) spanX[y * w + i] = len;
      x = e;
    }
  }
  for (let x = 0; x < w; x++) {
    let y = 0;
    while (y < h) {
      if (cells[y * w + x] !== 0) {
        y++;
        continue;
      }
      let e = y;
      while (e < h && cells[e * w + x] === 0) e++;
      const len = Math.min(255, e - y);
      for (let i = y; i < e; i++) spanY[i * w + x] = len;
      y = e;
    }
  }
  const out = new Uint8Array(w * h);
  for (let i = 0; i < w * h; i++) {
    out[i] = spanX[i] < spanY[i] ? spanX[i] : spanY[i];
  }
  return out;
}

export const DERELICT = parseLevel("Derelict", DECK, {
  sectorMap: DECK_SECTORS,
  sectors: DECK_SECTOR_DEFS,
  bay: 3,
});

/* ------------------------------------------------------------ test corridor */

/**
 * One straight run, for looking at the section rather than playing.
 *
 * One cell wide and 17 long, which is the art direction's table taken
 * literally: floor 0.45 of the width, a 0.275 chamfer either side, an overhead
 * at 1.0, and a corridor that reads as wide as it is tall. It comes out square
 * on screen because `PLANE` and `WALL_H` were set so a world unit of height and
 * a world unit of width cover the same pixels.
 *
 * The overhead is 1.0 and not something roomier for a reason that is easy to
 * miss: the eye is fixed at 0.5 above the deck (that is what `hover` 0.5 means
 * to every billboard), so **only** a 1.0 overhead puts the camera on the
 * centreline of the vertical face. Raise it to 1.6 for a taller corridor and
 * the chamfer's top edge slides down onto the horizon, the face ends up
 * entirely above eye level, and the section stops reading as a section.
 *
 * Frames land every 3 cells off the bay grid, and the view terminates on a door
 * at the far end rather than on more corridor — the reference treats that as a
 * rule of level design rather than as dressing.
 *
 * There is no `X`: the extract point stays at its default inside the forward
 * bulkhead, which is unreachable, so the run never ends and the camera can be
 * parked anywhere.
 */
const CORRIDOR = [
  "###", //  0
  "#D#", //  1  the bulkhead the whole sightline terminates on
  "#.#", //  2
  "#.#", //  3
  "#.#", //  4
  "#.#", //  5
  "#.#", //  6
  "#.#", //  7
  "#.#", //  8
  "#.#", //  9
  "#.#", // 10
  "#.#", // 11
  "#.#", // 12
  "#.#", // 13
  "#.#", // 14
  "#.#", // 15
  "#.#", // 16
  "#.#", // 17
  "#@#", // 18  you start at the after end looking forward
  "###", // 19
];

/** Powered aft, browning out midships, dead at the bulkhead. */
const CORRIDOR_SECTORS = [
  "lll", //  0
  "lll", //  1
  "lll", //  2
  "lll", //  3
  "lll", //  4
  "lll", //  5
  "kkk", //  6
  "kkk", //  7
  "kkk", //  8
  "kkk", //  9
  "kkk", // 10
  "ppp", // 11
  "ppp", // 12
  "ppp", // 13
  "ppp", // 14
  "ppp", // 15
  "ppp", // 16
  "ppp", // 17
  "ppp", // 18
  "ppp", // 19
];

export const TEST_CORRIDOR = parseLevel("Test corridor", CORRIDOR, {
  sectorMap: CORRIDOR_SECTORS,
  sectors: {
    p: { light: 0.62, name: "powered" },
    k: { light: 0.15, name: "browned out" },
    l: { light: 0.02, name: "dead" },
  },
  bay: 3,
});
