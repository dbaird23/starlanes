/**
 * The on-foot mini-game's data shapes.
 *
 * Everything the slice needs is passed in through `FpsOptions` rather than read
 * off the Game, which is what keeps v1 a diversion: with no `onOutcome` the
 * whole thing is unable to touch pilot state, and wiring it to a real boarding
 * action later is a matter of filling in the callback and generating a level
 * from the boarded hull instead of hardcoding one.
 */

/** A parsed level: a grid of wall ids plus the things standing on it. */
export interface FpsLevel {
  name: string;
  w: number;
  h: number;
  /** w*h cells, 0 empty, >0 an index into `walls` (1-based) */
  cells: Uint8Array;
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
  /** 700-705: which government's status-bar plate supplies the bulkheads. */
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
