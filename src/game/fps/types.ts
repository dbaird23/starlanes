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
 * A wall is an octagon in section, so a column of it is three bands: the 45
 * degree chamfer up off the deck, the vertical face, and the 45 degree chamfer
 * in under the overhead. Each takes its own material and its own light.
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
   * The 45 degree chamfer's run, in cells — the same in both axes, since it is
   * 45 degrees. This has to be a sector property rather than a renderer
   * constant because the art direction states it as a **fraction of corridor
   * width** (~0.275), and a two-cell corridor is twice as wide as a one-cell
   * one. It is the sector that knows how wide its corridors are.
   */
  chamfer: number;
  /** For authoring and debugging only. */
  name: string;
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
