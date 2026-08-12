/**
 * The GRN race's data shapes.
 *
 * Everything the mini-game needs arrives through `RaceOptions` rather than being
 * read off the Game, exactly as `FpsOptions` does for the on-foot run — and the
 * invariant matters *more* here, because this callback carries money. With
 * `onOutcome` omitted the race cannot touch the pilot's credits at all, which is
 * what makes a practice run structurally free rather than free by convention.
 */

import type * as THREE from "three";

/**
 * One hoop on the course.
 *
 * `normal` points *along the course* — the direction you are meant to cross in —
 * and it is the spline's own tangent at this gate rather than an independently
 * authored field. That is deliberate: gate positions define the spline, the
 * spline orients the gates, the AI flies the spline and the crossing test uses
 * `normal`, so there is one source of truth and nothing to drift out of sync.
 */
export interface Gate {
  index: number;
  pos: THREE.Vector3;
  /** unit, along the course */
  normal: THREE.Vector3;
  /** unit, perpendicular to `normal` — which way is "up" through the hoop */
  up: THREE.Vector3;
  /** major radius of the torus: the tube's centreline, not the hole */
  radius: number;
  /** spline parameter of this gate, in segments */
  t: number;
}

export interface RaceCourse {
  seed: number;
  gates: Gate[];
  /** total centreline length, in world units */
  length: number;
  /**
   * 0..1, how hard this particular course is laid out. It scales the modulation
   * amplitudes and *nothing else* — gate count, gate radius, spacing and lap
   * count are the same on every course in the game. Difficulty is layout and
   * sequence, never new numbers; the salvage run states the same rule.
   */
  tightness: number;
}

/** What the session hands the sim each frame. All axes are -1..1 but throttle. */
export interface RaceCommand {
  /** nose up positive */
  pitch: number;
  /** nose right positive */
  yaw: number;
  /** roll right positive */
  roll: number;
  /** 0..1 */
  throttle: number;
  boost: boolean;
}

export interface Racer {
  /** 0-3, indexing the GRN liveries — Blue, Green, Yellow, Red */
  livery: number;
  human: boolean;
  pos: THREE.Vector3;
  /** orientation; forward is -Z in the local frame, as three's cameras are */
  quat: THREE.Quaternion;
  speed: number;
  /** seconds of boost left in hand */
  boost: number;
  /** how many gates cleared in total, across every lap — the progress counter */
  gatesCleared: number;
  /** index of the gate being aimed at now */
  nextGate: number;
  lap: number;
  /** spline parameter, tracked incrementally — never searched for globally */
  param: number;
  /**
   * Total course progress in gates-plus-fraction. The *only* thing standings
   * order off, so a rival and the player are compared by one number.
   */
  progress: number;
  finished: boolean;
  finishTime: number;
  /** for the AI: its own line, its caution, its look-ahead. Zero on the human. */
  skill: RivalSkill;
}

export interface RivalSkill {
  /** how far off the centreline this rival's line sits, in world units */
  lineError: number;
  /** seconds of look-ahead when steering */
  lookAhead: number;
  /** how hard it lifts for a corner, 0..1 */
  throttleCaution: number;
  /** phase of this rival's lateral weave along the course */
  phase: number;
}

/**
 * A billboard to draw this frame.
 *
 * Deliberately *not* `FpsSprite`. That type's `(x, y, hover)` is already
 * `(worldX, worldZ, worldY)` under dishonest names — `glscene.ts` does
 * `position.set(s.x, s.hover, s.y)` — which is survivable in a game played on a
 * flat deck and actively misleading in one played in three dimensions. The
 * billboard *code* is being copied either way, so sharing the type would buy
 * nothing but a foot-gun.
 */
export interface RaceSprite {
  pos: THREE.Vector3;
  img: HTMLImageElement;
  /** side of one (square) frame in the sheet */
  frameSize: number;
  frame: number;
  /** world height of the billboard */
  scale: number;
  alpha: number;
  /** blend as light rather than as paint — the engine cones want this */
  additive?: boolean;
  /** multiplies the texel; how the four liveries get their colour */
  tint?: [number, number, number];
}

export interface RaceOutcome {
  /** 1-4 */
  place: number;
  laps: number;
  totalSec: number;
  bestLapSec: number;
  gatesCleared: number;
  gatesMissed: number;
  /** what was staked going in; already debited, so this is for the report only */
  stake: number;
  /** true when the player quit rather than finished — a forfeit, not a 4th */
  retired: boolean;
}

export interface RaceOptions {
  title: string;
  /** picks the course; stable per world, so a track can be learned */
  seed: number;
  laps: number;
  /** which GRN colour the player flies. The other three are the rivals. */
  livery: number;
  /** shïp id whose real stats drive the flight model. 167 is the Comara Racing Viper. */
  shipId: string;
  /** already debited by `startRace`; 0 for a practice run */
  stake: number;
  /**
   * Called once when the race ends. Omitted for a practice run, which is
   * precisely what makes it free — with no callback there is nowhere for a
   * result to reach the pilot's credits.
   */
  onOutcome?: (o: RaceOutcome) => void;
}
