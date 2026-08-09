/**
 * The on-foot mini-game's data shapes.
 *
 * Everything the slice needs is passed in through `FpsOptions` rather than read
 * off the Game, which is what keeps v1 a diversion: with no `onOutcome` the
 * whole thing is unable to touch pilot state, and wiring it to a real boarding
 * action later is a matter of filling in the callback and generating a level
 * from the boarded hull instead of hardcoding one.
 */

/**
 * The corridor is an octagon in section, so its surfaces come in three bands:
 * the 45 degree bevel up off the deck, the vertical face, and the 45 degree
 * bevel in under the overhead. Each takes its own material and its own light.
 *
 * The two bevels are **not** properties of any one wall — see `BevelField`.
 * A band is only ever a way of choosing a material, which is why this is an
 * enum and not a piece of geometry.
 */
export enum WallBand {
  Lower = 0,
  Main = 1,
  Upper = 2,
}

/** The deck texture, decoded once, for the per-pixel floor cast. */
export interface DeckPixels {
  /** RGBA, w*h*4 — kept as bytes so the renderer needs no endianness */
  data: Uint8ClampedArray;
  w: number;
  h: number;
  /** power-of-two side masks, so the inner loop wraps with & rather than % */
  maskX: number;
  maskY: number;
}

/**
 * A region of the deck with its own lighting and ceiling height — Doom's
 * sector, minus the floor height a raycaster cannot have.
 *
 * The model is deliberately Doom's rather than something bespoke: light and
 * height belong to an *area*, not to a wall, so a renderer that later grew
 * proper visplanes or a portal engine would read the same data. The renderer
 * asks for the sector of the open cell a ray is standing in, which is Doom's
 * rule too — a wall is lit by the sector you are looking at it from, not by
 * whatever is behind it.
 */
export interface FpsSector {
  /** Multiplier on everything lit here, 0..1. 0 is a dead section. */
  light: number;
  /**
   * Overhead height above the deck, in cells. The deck itself never moves, so
   * this only lifts the ceiling and with it the upper chamfer.
   */
  height: number;
  /**
   * The 45 degree chamfer's run **as a fraction of the space's free span** —
   * the art direction's ~0.275, which puts the deck at 45% of the corridor's
   * width. It is a ratio and not a measurement in cells: see `section.ts`,
   * which turns it into a run against `FpsLevel.freeSpan` and the overhead.
   */
  chamfer: number;
  /** For authoring and debugging only. */
  name: string;
}

/**
 * The bevel, as a **heightfield over the whole deck** rather than as something
 * belonging to a wall.
 *
 * This is the one idea the on-foot renderer turns on. A chamfer anchored to a
 * wall plane necessarily stops where that wall stops, so every junction, every
 * doorway and every corner used to end in a square-cornered gap; an earlier
 * pass tried to hide that by capping each opening with a flat bulkhead and an
 * octagonal hole, which is a different building, not a fix.
 *
 * Read instead as
 *
 *     h(p) = max(0, chamferRun(p) - distanceFromPointToNearestSolid(p))
 *
 * the fold stops belonging to any wall at all. It is deck wherever the nearest
 * solid is further away than the run, it rises at 45 degrees as you approach
 * anything solid, and it meets the vertical face exactly where the run reaches
 * zero — which is the wall plane, so the section along a straight wall is the
 * octagon it always was. And it wraps corners for free, convex and concave
 * alike, because **a distance field has no corners in it**: at an outside
 * corner the nearest solid is a point rather than a plane, so the fold turns as
 * a quarter-cone; at an inside corner two ramps meet and mitre.
 *
 * The overhead is the same field mirrored down from the sector's ceiling.
 *
 * Sampled on a sub-cell lattice (`sub` per cell) and read back bilinearly, so
 * the renderer's per-column march costs a table lookup rather than a search.
 * The distance itself is computed **exactly** — as the distance to the nearest
 * solid cell's rectangle, not to the nearest solid *sample* — so a straight
 * wall gives an exactly linear ramp and the deck edge does not wobble along the
 * lattice.
 */
export interface BevelField {
  /** samples per cell on each axis */
  sub: number;
  /** lattice size: `w * sub + 1` by `h * sub + 1` */
  sw: number;
  sh: number;
  /**
   * `chamferRun - signedDistanceToNearestSolid`, in cells: the bevel's height
   * above the deck. **Not** clamped at zero — negative means "this is deck, and
   * by this much", which is what lets the renderer's march sphere-trace across
   * open floor in a couple of steps instead of creeping.
   */
  lo: Float32Array;
  /**
   * ...and the underside of the overhead, `ceiling - max(0, lo)`. Kept as its
   * own lattice rather than derived, so the upper march is one lookup too.
   */
  up: Float32Array;
  /**
   * The wall id of the nearest solid, per sample — which material dresses the
   * bevel here. This is how a bay frame's lit trim carries down onto the fold
   * and round the corner with it.
   */
  id: Uint8Array;
  /** ...and the sector of the nearest **open** cell, which is what lights it. */
  sec: Uint8Array;
  /**
   * The chamfer run and the overhead height, on the same lattice: the renderer
   * reads these for the texture coordinate across the slope and for the wall
   * column's own top and bottom, so that the face and the bevel cannot disagree
   * about where they meet.
   *
   * They are smoothed across cell boundaries on purpose — a one-cell passage
   * asks for a run of 0.275 and the two-cell spine for 0.51, and an abrupt step
   * between them is a step in the fold — and they are on *this* lattice rather
   * than the cell grid so that everything the pixel loop wants comes off one
   * set of indices. Sampling the field once yields a lattice offset and two
   * fractions, and every one of these arrays is then three lerps away.
   */
  cham: Float32Array;
  ceil: Float32Array;
}

/** A parsed level: a grid of wall ids plus the things standing on it. */
export interface FpsLevel {
  name: string;
  w: number;
  h: number;
  /** w*h cells, 0 empty, >0 an index into `walls` (1-based) */
  cells: Uint8Array;
  /** w*h, index into `sectors` for every cell, walls included */
  sectorOf: Uint8Array;
  /** sector table; index 0 is always the level's default */
  sectors: FpsSector[];
  /**
   * `min(horizontal run, vertical run)` of open cells through each cell, in
   * cells — how wide the space is, which is what the chamfer is a fraction of.
   * Zero on solid cells.
   */
  freeSpan: Uint8Array;
  /** the bevel heightfield over the whole deck — see `BevelField` */
  bevel: BevelField;
  /** player start, in cells */
  start: { x: number; y: number; angle: number };
  /** where you have to get back to once the deck is clear */
  exit: { x: number; y: number };
  spawns: FpsSpawn[];
}

export interface FpsSpawn {
  kind: string;
  x: number;
  y: number;
}

/** One enemy class. The three Wraith sizes are three of these. */
export interface FpsEnemyDef {
  kind: string;
  name: string;
  /** sprite sheet under public/nova/sprites */
  sheet: string;
  /** frame side in the sheet (square) */
  frameSize: number;
  /** rotation frames in one set — 36 for every Nova hull */
  frames: number;
  health: number;
  speed: number;
  /** cells; how close it has to be to swipe */
  reach: number;
  damage: number;
  /** seconds between swipes */
  attackGap: number;
  /** how far away it notices you, in cells */
  senseRange: number;
  /** world height of the billboard, in cells */
  scale: number;
  /** how far up the billboard floats: 0 stands on the deck, 1 is eye level */
  hover: number;
  /** bööm id for its death, and snd id */
  boomId: number;
  deathSnd: number;
}

export interface FpsOutcome {
  won: boolean;
  enemiesKilled: number;
  enemiesTotal: number;
  timeSec: number;
  healthLeft: number;
}

export interface FpsOptions {
  title: string;
  level: FpsLevel;
  /** wëap ids, in slot order. The slice ships one. */
  loadout: { weaponId: string; ammo: number }[];
  health: number;
  /**
   * Extra bodies you can lose before the run ends. Unused by the slice; this is
   * where a marine platoon goes when boarding is wired up for real.
   */
  lives?: number;
  /**
   * Reserved for a per-government material set. The bulkheads used to be cut
   * out of `public/hud/statusbar-<govt>.jpg`; they are now the tiles under
   * `public/fps/`, which are one palette (the reference's white industrial),
   * so nothing reads this yet. Kept because the art direction says the
   * structure does not change between governments, only the material — so
   * this is where the second set will be selected.
   */
  wallPlate?: number;
  /** snd id for the room tone. 10034 is "Rundown station". */
  ambientSnd?: number;
  /**
   * Called once when the run ends. **Omitted by the arcade entry point**, which
   * is precisely what makes it a diversion — with no callback there is nowhere
   * for a result to reach the pilot's credits, cargo, record or bits.
   */
  onOutcome?: (o: FpsOutcome) => void;
}
