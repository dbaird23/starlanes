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
 * **The bevel.** The 45 degree fold is a heightfield over the whole deck rather
 * than a strip glued to each wall, so it is derived here from the plan as a
 * distance field — see `BevelField` and `buildBevel` below. That is what makes
 * it turn corners: the field knows how far the nearest solid is in *every*
 * direction, so the fold has no reason to stop where one wall does.
 */

import { chamferRun } from "./section";
import { WALL, wallInset } from "./textures";
import type {
  BevelField,
  FpsEnemyDef,
  FpsLevel,
  FpsSector,
  FpsSpawn,
} from "./types";

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
 * whatever the space's free span turns out to be — see `section.ts`.
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
 * `lampAt` in `raycast.ts` — so a sector level is what the *ship* is still
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
  a: { light: 0.45, height: 1.2, chamfer: 0.275, name: "airlock" },
  m: { light: 0.16, height: 1.2, chamfer: 0.275, name: "midships" },
  d: { light: 0.03, height: 1.2, chamfer: 0.275, name: "forward (dead)" },
  r: { light: 0.06, height: 1.9, chamfer: 0.275, name: "reactor bay" },
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
        // the deck runs north, so you come aboard facing up the hull
        case "@":
          start = { x: cx, y: cy, angle: -Math.PI / 2 };
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

  const freeSpan = freeSpans(w, h, cells);
  const bevel = buildBevel(w, h, cells, sectorOf, sectors, freeSpan);

  return {
    name,
    w,
    h,
    cells,
    sectorOf,
    sectors,
    freeSpan,
    bevel,
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

/* ------------------------------------------------------------ bevel field */

/**
 * Samples per cell on each axis. Eight is plenty: the field is exact at every
 * sample (see below), so the lattice only has to be fine enough that bilinear
 * interpolation between samples does not visibly round off a crease, and the
 * creases here are metre-scale.
 */
const BEVEL_SUB = 8;

/**
 * How far out the field is kept, in cells. Nothing reads it past the chamfer
 * run, so this only has to cover the largest run plus enough slope for the
 * renderer's march to sphere-trace across open deck in a few steps.
 */
const BEVEL_CLAMP = 2.5;

/** ...and how far a sample looks for the solid that is nearest to it. */
const BEVEL_SEARCH = 3;

/**
 * The bevel heightfield, built once per level.
 *
 * ## Why a field and not a strip per wall
 *
 * See `BevelField`. The one-line version: `h(p) = chamferRun(p) - d(p)` has no
 * corners in it, so the fold turns every corner the plan happens to contain and
 * we never have to decide which wall a corner belongs to.
 *
 * ## The distance is exact, not a distance *transform*
 *
 * The obvious build is a distance transform over the lattice — mark the solid
 * samples, sweep. That gives the distance to the nearest solid *sample*, which
 * staircases at the lattice pitch, and a bevel whose foot wobbles by an eighth
 * of a cell down a dead straight wall is exactly the artifact this renderer has
 * been fighting all along. Nova's decks are unit squares, so the honest
 * distance is available for the asking: the distance from a point to an
 * axis-aligned rectangle is three `max`es and a square root, and there are only
 * ever a few dozen candidate cells. `BEVEL_SEARCH` of 3 covers every solid that
 * could be within `BEVEL_CLAMP`.
 *
 * A material's `inset` — the 0.15 of a cell a bay frame stands proud of the
 * bays either side — is subtracted from its own rectangle's distance, which
 * inflates that cell in the field. So the rib is a rib in the fold as well as
 * in the vertical face, without the renderer's two halves having to agree about
 * anything but the number.
 *
 * ## The run and the overhead are per cell, smoothed
 *
 * `chamferRun` is a fraction of the space's free span, so it genuinely differs
 * from one part of the deck to the next — 0.275 in a one-cell passage against
 * 0.51 in the two-cell spine. Left as a step at the cell boundary that is a
 * step in the fold, so the per-cell values are propagated into the solids and
 * then blurred once. The renderer takes the wall column's own top and bottom
 * from these same two fields, so the vertical face and the bevel cannot end up
 * disagreeing about where they meet whatever the smoothing does.
 */
function buildBevel(
  w: number,
  h: number,
  cells: Uint8Array,
  sectorOf: Uint8Array,
  sectors: FpsSector[],
  freeSpan: Uint8Array,
): BevelField {
  const n = w * h;
  const chamCell = new Float32Array(n);
  const ceilCell = new Float32Array(n);
  const known = new Uint8Array(n);

  for (let i = 0; i < n; i++) {
    if (cells[i] !== 0) continue;
    const sec = sectors[sectorOf[i]];
    ceilCell[i] = sec.height;
    chamCell[i] = chamferRun(sec.chamfer, freeSpan[i] || 1, sec.height);
    known[i] = 1;
  }
  // solid cells take the mean of whatever open cells touch them, spread far
  // enough in to cover a thick bulkhead
  for (let pass = 0; pass < 3; pass++) {
    const src = known.slice();
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const i = y * w + x;
        if (src[i]) continue;
        let sc = 0;
        let se = 0;
        let k = 0;
        for (let dy = -1; dy <= 1; dy++) {
          for (let dx = -1; dx <= 1; dx++) {
            const jx = x + dx;
            const jy = y + dy;
            if (jx < 0 || jy < 0 || jx >= w || jy >= h) continue;
            const j = jy * w + jx;
            if (!src[j]) continue;
            sc += chamCell[j];
            se += ceilCell[j];
            k++;
          }
        }
        if (k > 0) {
          chamCell[i] = sc / k;
          ceilCell[i] = se / k;
          known[i] = 1;
        }
      }
    }
  }
  for (let i = 0; i < n; i++) {
    if (!known[i]) {
      chamCell[i] = DEFAULT_SECTOR.chamfer;
      ceilCell[i] = DEFAULT_SECTOR.height;
    }
  }
  /*
   * Erode before blurring, and only the run.
   *
   * `freeSpan` is `min(horizontal run, vertical run)` through a cell, which is
   * the right measure for a room and spikes at a **doorway**: the one cell of
   * corridor that a compartment opens off has seven cells of vertical run
   * through it and asks for the full 0.51, with 0.275 either side of it. As a
   * wall-anchored chamfer that was invisible — it only made one column's face
   * thinner. As a heightfield it is a blister in the fold, and worse, two folds
   * of 0.51 in a passage one cell wide leave no deck between them at all.
   *
   * A 3x3 minimum says the thing that is actually true: the fold can only be as
   * big as the tightest place near it. The blur afterwards is what keeps the
   * transition a taper rather than a step.
   */
  erodeCells(chamCell, w, h);
  blurCells(chamCell, w, h);
  blurCells(ceilCell, w, h);

  const sub = BEVEL_SUB;
  const sw = w * sub + 1;
  const sh = h * sub + 1;
  const lo = new Float32Array(sw * sh);
  const up = new Float32Array(sw * sh);
  const nearId = new Uint8Array(sw * sh);
  const nearSec = new Uint8Array(sw * sh);
  const chamS = new Float32Array(sw * sh);
  const ceilS = new Float32Array(sw * sh);

  for (let j = 0; j < sh; j++) {
    const py = j / sub;
    const cy = py >= h ? h - 1 : py | 0;
    for (let i = 0; i < sw; i++) {
      const px = i / sub;
      const cx = px >= w ? w - 1 : px | 0;

      let best = Infinity;
      let rawBest = Infinity;
      let bestId = 0;
      let openBest = Infinity;
      let openSec = 0;
      const x0 = Math.max(0, cx - BEVEL_SEARCH);
      const x1 = Math.min(w - 1, cx + BEVEL_SEARCH);
      const y0 = Math.max(0, cy - BEVEL_SEARCH);
      const y1 = Math.min(h - 1, cy + BEVEL_SEARCH);
      for (let ky = y0; ky <= y1; ky++) {
        const dy = py < ky ? ky - py : py > ky + 1 ? py - (ky + 1) : 0;
        for (let kx = x0; kx <= x1; kx++) {
          const dx = px < kx ? kx - px : px > kx + 1 ? px - (kx + 1) : 0;
          const dd = dx === 0 ? dy : dy === 0 ? dx : Math.sqrt(dx * dx + dy * dy);
          const c = cells[ky * w + kx];
          if (c !== 0) {
            const e = dd - wallInset(c);
            if (e < best) best = e;
            /*
             * The *material* is chosen on the raw distance, not on the inset
             * one. A bay frame stands 0.15 proud of the bays either side, so
             * read with its inflation it is the nearest solid to most of the
             * bay as well as to itself — and its lit trim came out running the
             * whole length of every wall, which is the one thing the art
             * direction says the trim must not do. The rib is still a rib in
             * the geometry; only which tile dresses it is decided here.
             */
            if (dd < rawBest) {
              rawBest = dd;
              bestId = c;
            }
          } else if (dd < openBest) {
            openBest = dd;
            openSec = sectorOf[ky * w + kx];
          }
        }
      }

      const here = cells[cy * w + cx];
      let d: number;
      let id: number;
      let sec: number;
      if (here !== 0) {
        // inside a bulkhead: how far to the deck, and the inflation on top
        id = here;
        sec = openSec;
        d = -((openBest === Infinity ? BEVEL_CLAMP : openBest) + wallInset(here));
      } else {
        id = bestId;
        sec = sectorOf[cy * w + cx];
        d = best === Infinity ? BEVEL_CLAMP : best;
      }

      const cham = cellLerp(chamCell, w, h, px, py);
      const ceil = cellLerp(ceilCell, w, h, px, py);
      let hl = cham - d;
      if (hl > BEVEL_CLAMP) hl = BEVEL_CLAMP;
      else if (hl < -BEVEL_CLAMP) hl = -BEVEL_CLAMP;

      const o = j * sw + i;
      lo[o] = hl;
      up[o] = ceil - (hl > 0 ? hl : 0);
      nearId[o] = id;
      nearSec[o] = sec;
      chamS[o] = cham;
      ceilS[o] = ceil;
    }
  }

  return { sub, sw, sh, lo, up, id: nearId, sec: nearSec, cham: chamS, ceil: ceilS };
}

/** A 3x3 minimum over the cell grid, edges clamped. */
function erodeCells(f: Float32Array, w: number, h: number): void {
  const src = f.slice();
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      let m = src[y * w + x];
      for (let dy = -1; dy <= 1; dy++) {
        const jy = y + dy;
        if (jy < 0 || jy >= h) continue;
        for (let dx = -1; dx <= 1; dx++) {
          const jx = x + dx;
          if (jx < 0 || jx >= w) continue;
          const v = src[jy * w + jx];
          if (v < m) m = v;
        }
      }
      f[y * w + x] = m;
    }
  }
}

/** A separable 1-2-1 blur over the cell grid, edges clamped. */
function blurCells(f: Float32Array, w: number, h: number): void {
  const tmp = new Float32Array(f.length);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const a = f[y * w + (x > 0 ? x - 1 : 0)];
      const b = f[y * w + x];
      const c = f[y * w + (x < w - 1 ? x + 1 : w - 1)];
      tmp[y * w + x] = (a + 2 * b + c) / 4;
    }
  }
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const a = tmp[(y > 0 ? y - 1 : 0) * w + x];
      const b = tmp[y * w + x];
      const c = tmp[(y < h - 1 ? y + 1 : h - 1) * w + x];
      f[y * w + x] = (a + 2 * b + c) / 4;
    }
  }
}

/**
 * Bilinear over a per-cell field, sampled at cell **centres** — so the value
 * halfway between two cells is the mean of the two, and a cell's own centre is
 * its own value. `raycast.ts` re-implements this on the same convention.
 */
function cellLerp(f: Float32Array, w: number, h: number, x: number, y: number): number {
  let u = x - 0.5;
  let v = y - 0.5;
  if (u < 0) u = 0;
  else if (u > w - 1.0001) u = w - 1.0001;
  if (v < 0) v = 0;
  else if (v > h - 1.0001) v = h - 1.0001;
  const i = u | 0;
  const j = v | 0;
  const fx = u - i;
  const fy = v - j;
  const o = j * w + i;
  const a = f[o] + (f[o + 1] - f[o]) * fx;
  const b = f[o + w] + (f[o + w + 1] - f[o + w]) * fx;
  return a + (b - a) * fy;
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
    p: { light: 0.85, name: "powered" },
    k: { light: 0.26, name: "browned out" },
    l: { light: 0.045, name: "dead" },
  },
  bay: 3,
});
