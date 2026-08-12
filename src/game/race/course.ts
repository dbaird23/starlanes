/**
 * The course: a closed loop of hoops in space, generated from one integer.
 *
 * ## Where the numbers come from
 *
 * Every dimension here is derived from the Comara Racing Viper's own stats
 * rather than picked. `convertShipStats` turns shïp 167's raw `speed 525 /
 * accel 900 / turn 80` into **maxSpeed 315, accel 225, turnRate 4.19 rad/s**,
 * and from those:
 *
 * - Steady turn radius at cruise is `v/ω = 315/4.19` = **75 units**. That is
 *   *tiny* against a 48-unit hoop — the Viper can turn inside a gate. So the
 *   course cannot be about whether you can make the corner, because you always
 *   can. It has to be about **threading the hole while carrying speed**, which
 *   is why difficulty lives in the aperture and the sequence and never in the
 *   spacing.
 * - The hull is ~32 units (the sprite is 32px), so a 48-unit major radius is
 *   about three hull-widths of clearance: demanding at 315, forgiving at half
 *   throttle.
 * - `GATE_SPACING` 500 is ~1.6s at cruise; 24 gates is 12,000 units and ~38s a
 *   lap, so three laps is about 115s. The salvage run is 300s, so this sits
 *   where a bar diversion should.
 *
 * ## Why the modulation is sinusoidal and not noise
 *
 * Per-gate jitter gives a spline with cusps — a sequence of unrelated kinks that
 * reads as a random walk. Two low-frequency sinusoids at *integer* harmonics of
 * the loop give a **course**: long banked sweeps, a couple of climbs, one
 * corkscrew, and it closes on itself seamlessly because an integer number of
 * cycles fits the circle exactly.
 *
 * `tightness` scales those amplitudes and nothing else. Gate count, gate radius,
 * spacing and lap count are identical on every course in the game — the rule the
 * salvage run states as "difficulty is layout and sequence, never new numbers".
 */

import * as THREE from "three";
import type { Gate, RaceCourse } from "./types";

/** Hoops per lap. */
export const GATE_COUNT = 24;
/** Centreline distance between hoops, in world units. ~1.6s at cruise. */
export const GATE_SPACING = 500;
/** The torus's major radius: the tube's centreline. The *hole* is this less `GATE_TUBE`. */
export const GATE_RADIUS = 48;
/** The tube's minor radius — how thick the hoop is. */
export const GATE_TUBE = 2.2;
/** Half the Viper's width, for the collision and clean-pass tests. */
export const HULL_HALF = 16;
/**
 * Inside this radius a pass counts as *clean* and pays boost. A third of the
 * aperture: wide enough to be a line you can choose, tight enough that choosing
 * it costs you something on the way in.
 */
export const CLEAN_RADIUS = GATE_RADIUS / 3;

/** How many centreline samples are cached for the nearest-point search. */
const SAMPLES = GATE_COUNT * 8;

/**
 * The starfield's integer hash, unchanged.
 *
 * Reused rather than reinvented because it is already deterministic,
 * allocation-free and trusted in the shipped build. There is no `Math.random`
 * anywhere in this file, and there must not be: a course the player is meant to
 * learn cannot rearrange itself between attempts, which is the whole reason this
 * mini-game exists instead of a die roll.
 */
function hash(x: number, y: number, seed: number): number {
  let h = (x * 374761393 + y * 668265263 + seed * 2246822519) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

/** One 0..1 draw from a seed, by index. */
function draw(seed: number, i: number): number {
  return hash(i, i * 7 + 11, seed);
}

/** Base circle radius that makes the loop `GATE_COUNT * GATE_SPACING` around. */
const BASE_R = (GATE_COUNT * GATE_SPACING) / (2 * Math.PI);

const WORLD_UP = new THREE.Vector3(0, 1, 0);

export interface CourseFrame {
  pos: THREE.Vector3;
  tangent: THREE.Vector3;
  up: THREE.Vector3;
  right: THREE.Vector3;
}

export class Course implements RaceCourse {
  readonly seed: number;
  readonly gates: Gate[];
  readonly length: number;
  readonly tightness: number;
  readonly curve: THREE.CatmullRomCurve3;

  /** cached centreline, for the incremental nearest-point search */
  private readonly samples: THREE.Vector3[] = [];

  constructor(seed: number) {
    this.seed = seed;
    this.tightness = 0.25 + 0.7 * draw(seed, 0);

    /*
     * Two radial harmonics and one vertical, all at integer multiples of the
     * loop so the shape closes without a seam. The second radial harmonic is a
     * third the amplitude of the first and at a higher frequency — that is what
     * turns a lopsided oval into a course with a fast side and a technical one.
     */
    const k1 = 2 + Math.floor(draw(seed, 1) * 2); // 2..3
    const k2 = 2 + Math.floor(draw(seed, 2) * 3); // 2..4
    const k3 = k1 * 2 + 1;
    const p1 = draw(seed, 3) * Math.PI * 2;
    const p2 = draw(seed, 4) * Math.PI * 2;
    const p3 = draw(seed, 5) * Math.PI * 2;

    const aR = BASE_R * (0.10 + 0.22 * this.tightness);
    const aR2 = aR * 0.35;
    const aY = BASE_R * (0.06 + 0.18 * this.tightness);

    const pts: THREE.Vector3[] = [];
    for (let i = 0; i < GATE_COUNT; i++) {
      const th = (i / GATE_COUNT) * Math.PI * 2;
      const r = BASE_R + aR * Math.sin(k1 * th + p1) + aR2 * Math.sin(k3 * th + p3);
      const y = aY * Math.sin(k2 * th + p2);
      pts.push(new THREE.Vector3(Math.cos(th) * r, y, Math.sin(th) * r));
    }

    /*
     * Centripetal, not uniform. Uniform Catmull-Rom overshoots badly where the
     * control points bunch up — and they do bunch, because the radial modulation
     * pulls neighbouring gates together on the inside of a sweep. An overshoot
     * there is a spline that loops outside its own gates, which the AI would
     * then dutifully fly.
     */
    this.curve = new THREE.CatmullRomCurve3(pts, true, "centripetal", 0.5);
    this.length = this.curve.getLength();

    for (let i = 0; i < SAMPLES; i++) {
      this.samples.push(this.curve.getPointAt(i / SAMPLES));
    }

    // the gate's own pose comes from the *spline* at its parameter, not from the
    // control point it was built from — centripetal Catmull-Rom passes through
    // its controls, but the tangent there is the curve's and not the chord's
    this.gates = pts.map((_, i) => {
      const t = i / GATE_COUNT;
      const f = this.frameAt(t);
      return {
        index: i,
        pos: f.pos.clone(),
        normal: f.tangent.clone(),
        up: f.up.clone(),
        radius: GATE_RADIUS,
        t,
      };
    });
  }

  /** Position on the centreline. `t` wraps, and is arc-length parameterised. */
  pointAt(t: number): THREE.Vector3 {
    return this.curve.getPointAt(wrap01(t));
  }

  /** Unit tangent — the direction the course runs at `t`. */
  tangentAt(t: number): THREE.Vector3 {
    return this.curve.getTangentAt(wrap01(t)).normalize();
  }

  /**
   * A full orthonormal frame at `t`, with the hoop **banked into the turn**.
   *
   * The bank is not decoration. A hoop that stays world-upright through a hard
   * left presents its aperture edge-on to the line you actually fly, so the
   * gate you are being asked to thread is the one shape you cannot see. Leaning
   * it into the turn puts the hole square to the approach, which is what a real
   * banked track does and for the same reason.
   */
  frameAt(t: number): CourseFrame {
    const pos = this.pointAt(t);
    const tangent = this.tangentAt(t);

    // a reference up that cannot be parallel to the tangent
    const ref =
      Math.abs(tangent.dot(WORLD_UP)) > 0.97 ? new THREE.Vector3(1, 0, 0) : WORLD_UP;
    const right = new THREE.Vector3().crossVectors(tangent, ref).normalize();
    const up = new THREE.Vector3().crossVectors(right, tangent).normalize();

    // curvature vector, by finite difference of the tangent along arc length
    const ds = 1 / SAMPLES;
    const t2 = this.tangentAt(t + ds);
    const kv = t2.sub(tangent).multiplyScalar(1 / (ds * this.length));
    const bank = THREE.MathUtils.clamp(kv.dot(right) * this.length * 0.05, -0.7, 0.7);

    const q = new THREE.Quaternion().setFromAxisAngle(tangent, bank);
    up.applyQuaternion(q).normalize();
    right.crossVectors(tangent, up).normalize();

    return { pos, tangent, up, right };
  }

  /**
   * Curvature at `t`, in radians per world unit. The AI lifts off the throttle
   * by this, which is what makes a rival slow for a corner instead of ploughing
   * straight on at full power.
   */
  curvatureAt(t: number): number {
    const ds = 4 / SAMPLES;
    const a = this.tangentAt(t);
    const b = this.tangentAt(t + ds);
    return a.angleTo(b) / (ds * this.length);
  }

  /**
   * Track the nearest point on the centreline **incrementally**.
   *
   * Searching a window around where the racer was last frame rather than the
   * whole loop is not only cheaper — it is the only correct answer. A global
   * nearest-point search snaps to the wrong lobe wherever the course passes
   * near itself, which the radial modulation guarantees it does, and a rival
   * whose parameter teleports across the map flies off at a tangent.
   */
  advanceParam(from: number, pos: THREE.Vector3): number {
    const start = Math.round(wrap01(from) * SAMPLES);
    let best = start;
    let bestD = Infinity;
    // a window of ±1/8 lap: far more than a frame's travel, far less than a lobe
    const win = Math.round(SAMPLES / 8);
    for (let i = start - win; i <= start + win; i++) {
      const idx = ((i % SAMPLES) + SAMPLES) % SAMPLES;
      const d = this.samples[idx].distanceToSquared(pos);
      if (d < bestD) {
        bestD = d;
        best = i;
      }
    }
    return wrap01(best / SAMPLES);
  }
}

/** Wrap a spline parameter into [0,1). */
export function wrap01(t: number): number {
  return ((t % 1) + 1) % 1;
}

export function buildCourse(seed: number): Course {
  return new Course(seed);
}
