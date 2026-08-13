/**
 * The race sim: flight, gate crossing, laps, standings.
 *
 * Deliberately knows nothing about `Game`, three's renderer or the DOM, exactly
 * as `FpsWorld` does — everything arrives through `RaceOptions`. That is what
 * lets the whole thing be driven headlessly from the console a few thousand
 * steps at a time, which is how the determinism and tunnelling checks are run.
 *
 * It *does* import `THREE.Vector3`/`Quaternion`. Those are maths, not rendering,
 * and hand-rolling quaternion composition is exactly where a week disappears.
 * Deliberate; noted here so the next reader knows it was not an accident.
 */

import * as THREE from "three";
import { SHIPS } from "../../data/universe";
import {
  CLEAN_RADIUS,
  Course,
  GATE_RADIUS,
  GATE_SPACING,
  GATE_TUBE,
  HULL_HALF,
  buildCourse,
} from "./course";
import type { RaceCommand, RaceOptions, RaceOutcome, Racer, RivalSkill } from "./types";

/** Forward is -Z in the local frame, as three's cameras are. */
const FWD = new THREE.Vector3(0, 0, -1);
const UP = new THREE.Vector3(0, 1, 0);
const RIGHT = new THREE.Vector3(1, 0, 0);

/**
 * Roll rate as a multiple of the hull's turn rate.
 *
 * **Invented.** Nova specifies one manoeuvrability figure and it has no roll
 * axis at all, because the flight sim is played from directly above. 1.6 is
 * fast enough that rolling to line up a banked hoop is a reflex rather than a
 * manoeuvre, which is what it has to be at 1.6s between gates.
 */
const ROLL_K = 1.6;

/**
 * How much of the turn rate survives at full throttle.
 *
 * **This is the most load-bearing invented number in the design.** Without it,
 * full throttle is strictly optimal — the Viper turns inside a 48-unit hoop at
 * any speed, so there is never a reason to lift, and the throttle stops being a
 * control at all. At 0.6 the fast line through a tight sequence genuinely costs
 * you steering, so backing off is sometimes right, and *that* is the game.
 */
const TURN_AT_SPEED = 0.6;

/**
 * Boost multiplier on top speed.
 *
 * Not invented: this is Nova's own shïp Flags 0x0001/0x0002/0x0004 jump-speed
 * ladder (75% / 125% / 150%), whose top rung the hyperdrive already uses.
 */
const BOOST_MULT = 1.5;
/** Seconds of boost a clean pass pays. */
const BOOST_REWARD = 1.2;
export const BOOST_MAX = 3.0;

/** What clipping the hoop costs: speed is scrubbed to this fraction. */
const CLIP_SCRUB = 0.4;
/** ...and you are shoved this far per second away from the rim. */
const CLIP_PUSH = 90;

/** Beyond this many gate-spacings off the centreline, nag the player. */
const OFF_COURSE = 3;

export interface RaceStats {
  maxSpeed: number;
  accel: number;
  turnRate: number;
}

/** A racer's own frame, derived from its quaternion. */
export function forwardOf(r: Racer, out = new THREE.Vector3()): THREE.Vector3 {
  return out.copy(FWD).applyQuaternion(r.quat);
}
export function upOf(r: Racer, out = new THREE.Vector3()): THREE.Vector3 {
  return out.copy(UP).applyQuaternion(r.quat);
}
export function rightOf(r: Racer, out = new THREE.Vector3()): THREE.Vector3 {
  return out.copy(RIGHT).applyQuaternion(r.quat);
}

export type RaceState = "countdown" | "racing" | "done";

/** Something worth hearing. Only the player's own events are emitted. */
export type RaceEvent =
  | "count"
  | "go"
  | "gate"
  | "clean"
  | "contact"
  | "miss"
  | "lap"
  | "finish";

/** Scratch, so the per-frame path allocates nothing. */
const _a = new THREE.Vector3();
const _b = new THREE.Vector3();
const _c = new THREE.Vector3();
const _q = new THREE.Quaternion();

export class RaceWorld {
  readonly opts: RaceOptions;
  readonly course: Course;
  readonly stats: RaceStats;
  readonly racers: Racer[] = [];

  state: RaceState = "countdown";
  /** seconds until the flag, then seconds since it */
  countdown = 3;
  time = 0;

  /** the human, for convenience — always `racers[0]` */
  get player(): Racer {
    return this.racers[0];
  }

  /** transient, for the HUD: what just happened */
  note = "";
  noteLeft = 0;
  /** 0..1, decaying — the clip shake */
  shake = 0;
  offCourse = false;

  /**
   * What happened this frame, for the session to turn into sound and sparks.
   *
   * Strings rather than callbacks, and drained by the caller rather than pushed
   * to it, so the sim stays exactly as free of the renderer and the audio engine
   * as it is of `Game` — which is what lets it be stepped a few thousand times
   * from a console with nothing attached.
   */
  events: RaceEvent[] = [];

  gatesMissed = 0;
  bestLapSec = 0;
  private lapStart = 0;
  private ended = false;
  /** the countdown number last beeped for; -1 so the opening 3 is not skipped */
  private counted = -1;

  constructor(opts: RaceOptions) {
    this.opts = opts;
    this.course = buildCourse(opts.seed);

    const st = SHIPS[opts.shipId];
    /*
     * The hull's real numbers, straight through. `SHIPS` has already run
     * `convertShipStats`, so these are engine units: for the Comara Racing Viper
     * (167) that is maxSpeed 315, accel 225, turnRate 4.19 rad/s. The fallback
     * exists only so a bad id cannot produce a NaN course.
     */
    this.stats = {
      maxSpeed: st?.maxSpeed ?? 315,
      accel: st?.accel ?? 225,
      turnRate: st?.turnRate ?? 4.19,
    };

    // the player, then the three rivals — the liveries the player did not take
    this.racers.push(this.spawn(opts.livery, true, 0));
    let slot = 1;
    for (let i = 0; i < 4; i++) {
      if (i === opts.livery) continue;
      this.racers.push(this.spawn(i, false, slot++));
    }
  }

  /**
   * Put a racer on the grid: half a gate-spacing behind gate 0, abreast on the
   * course's own frame so the four of them start side by side rather than
   * stacked in one point.
   */
  private spawn(livery: number, human: boolean, slot: number): Racer {
    const t = -0.5 / this.course.gates.length;
    const f = this.course.frameAt(t);
    const lane = (slot - 1.5) * (GATE_RADIUS * 0.42);
    const pos = f.pos.clone().addScaledVector(f.right, lane);

    /*
     * `Matrix4.lookAt(eye, target, up)` sets **-Z** pointing from eye to target,
     * because it is the camera convention — and forward here is -Z for exactly
     * that reason. So the target is `+tangent`: negating it (which the first cut
     * did) puts the whole grid on the line facing backwards, which reads as the
     * course having no gates on it rather than as an orientation bug.
     */
    const quat = new THREE.Quaternion().setFromRotationMatrix(
      new THREE.Matrix4().lookAt(new THREE.Vector3(0, 0, 0), f.tangent, f.up),
    );

    const s = this.course.seed;
    const skill: RivalSkill = human
      ? { lineError: 0, lookAhead: 0, throttleCaution: 0, phase: 0 }
      : {
          lineError: GATE_RADIUS * (0.18 + 0.3 * frac(s, slot * 13 + 1)),
          lookAhead: 0.55 + 0.35 * frac(s, slot * 13 + 2),
          throttleCaution: 0.5 + 0.5 * frac(s, slot * 13 + 3),
          phase: frac(s, slot * 13 + 4) * Math.PI * 2,
        };

    return {
      livery,
      human,
      pos,
      quat,
      speed: 0,
      boost: 0,
      gatesCleared: 0,
      nextGate: 0,
      missed: 0,
      lap: 0,
      param: ((t % 1) + 1) % 1,
      progress: 0,
      finished: false,
      finishTime: 0,
      skill,
    };
  }

  /**
   * Advance one racer. **The player and the AI both come through here**, which
   * is what makes the race fair and what makes an AI bug show up as a flying
   * bug rather than as a mysterious result.
   */
  stepRacer(r: Racer, cmd: RaceCommand, dt: number): void {
    if (r.finished) return;
    const { maxSpeed, accel, turnRate } = this.stats;

    /* ---- orientation ---------------------------------------------------- */
    const speedFrac = maxSpeed > 0 ? Math.min(1, r.speed / maxSpeed) : 0;
    const rate = turnRate * (1 - (1 - TURN_AT_SPEED) * speedFrac);

    // yaw about the local up; positive rotation about up turns *left*, so a
    // rightward command is a negative angle
    r.quat.multiply(_q.setFromAxisAngle(UP, -cmd.yaw * rate * dt));
    r.quat.multiply(_q.setFromAxisAngle(RIGHT, cmd.pitch * rate * dt));
    r.quat.multiply(_q.setFromAxisAngle(FWD, cmd.roll * turnRate * ROLL_K * dt));
    r.quat.normalize();

    /* ---- speed ----------------------------------------------------------- */
    const boosting = cmd.boost && r.boost > 0;
    if (boosting) r.boost = Math.max(0, r.boost - dt);
    const target = maxSpeed * (boosting ? BOOST_MULT : Math.max(0, Math.min(1, cmd.throttle)));
    const dv = accel * dt;
    r.speed += THREE.MathUtils.clamp(target - r.speed, -dv, dv);

    /* ---- integrate, then test the segment we just swept ------------------- */
    const prev = _a.copy(r.pos);
    forwardOf(r, _b);
    r.pos.addScaledVector(_b, r.speed * dt);

    this.checkGate(r, prev, r.pos, dt);

    r.param = this.course.advanceParam(r.param, r.pos);
    r.progress = r.gatesCleared + this.gateFraction(r);
  }

  /**
   * **Swept crossing, and it must stay swept.**
   *
   * `main.ts` clamps dt to 0.05s, so at 315 units/s a racer covers **15.75
   * units in one step** against a tube 2.2 units thick. Any proximity test —
   * "am I within N of the gate centre" — silently fails at full throttle and
   * only at full throttle, which is the worst kind of bug to find late. This is
   * the same lesson the projectile code already learned: test the segment, not
   * the point.
   *
   * The test is signed distance to the gate's plane before and after. A crossing
   * is a sign change from negative (approaching) to positive (past), and where
   * it crossed decides everything:
   *
   * - inside the hole with clearance → a pass;
   * - inside the hole but within a hull's width of the rim → a pass *and* a clip;
   * - outside the hoop altogether → a miss, and the gate index does not advance,
   *   so the punishment is exactly the time it costs to come back for it.
   */
  private checkGate(r: Racer, prev: THREE.Vector3, cur: THREE.Vector3, dt: number): void {
    const gates = this.course.gates;
    const g = gates[r.nextGate % gates.length];

    const d0 = _c.copy(prev).sub(g.pos).dot(g.normal);
    const d1 = _c.copy(cur).sub(g.pos).dot(g.normal);
    if (!(d0 < 0 && d1 >= 0)) return;

    const u = d0 / (d0 - d1 || 1e-6);
    const hit = _c.copy(prev).lerp(cur, u);
    // the component of the hit offset perpendicular to the gate's axis
    const rel = hit.sub(g.pos);
    const radial = rel.addScaledVector(g.normal, -rel.dot(g.normal)).length();

    if (radial >= GATE_RADIUS) {
      /*
       * Went past outside the hoop. The gate index deliberately does not
       * advance — the punishment is the time it costs to come back for it, for
       * a rival exactly as for the player.
       *
       * The per-racer tally is not decoration: rival misses were invisible when
       * only the human's were counted, and an AI that had quietly stopped
       * taking gates looked identical at the finish to one that was merely
       * slow. It is the cheapest possible check that the rivals are racing.
       */
      r.missed++;
      if (r.human) {
        this.gatesMissed++;
        this.say("MISSED GATE");
        this.events.push("miss");
      }
      return;
    }

    if (radial > GATE_RADIUS - GATE_TUBE - HULL_HALF) {
      // through the hole, but the rim caught us
      r.speed *= CLIP_SCRUB;
      const away = rel.normalize();
      r.pos.addScaledVector(away, -CLIP_PUSH * 0.016);
      if (r.human) {
        this.shake = 1;
        this.say("CONTACT");
        this.events.push("contact");
      }
    } else if (radial <= CLEAN_RADIUS) {
      r.boost = Math.min(BOOST_MAX, r.boost + BOOST_REWARD);
      if (r.human) {
        this.say("CLEAN");
        this.events.push("clean");
      }
    } else if (r.human) {
      this.events.push("gate");
    }

    r.gatesCleared++;
    r.nextGate = (r.nextGate + 1) % gates.length;

    if (r.nextGate === 0) {
      r.lap++;
      if (r.human) {
        const lap = this.time - this.lapStart;
        if (lap > 0 && (this.bestLapSec === 0 || lap < this.bestLapSec)) {
          this.bestLapSec = lap;
        }
        this.lapStart = this.time;
        this.events.push(r.lap >= this.opts.laps ? "finish" : "lap");
      }
      if (r.lap >= this.opts.laps) {
        r.finished = true;
        /*
         * **The finish time is sub-frame**, taken at the crossing rather than at
         * the end of the step that contained it. `u` is already solved for the
         * gate test, so this costs one multiply — and without it two racers who
         * cross the line in the same frame get *identical* times and share a
         * place, which was reproducible rather than theoretical: seed 1234 put
         * two rivals on the same 92.0s and left nobody in second. With money
         * riding on placement a dead heat is not a result.
         */
        r.finishTime = this.time - dt * (1 - u);
      }
    }
  }

  /** How far between the last gate and the next, 0..1 — the fractional progress. */
  private gateFraction(r: Racer): number {
    const gates = this.course.gates;
    const g = gates[r.nextGate % gates.length];
    const d = r.pos.distanceTo(g.pos);
    return THREE.MathUtils.clamp(1 - d / GATE_SPACING, 0, 0.999);
  }

  /**
   * Live standings: 1st through 4th.
   *
   * A finished racer always outranks an unfinished one however far round the
   * unfinished one is — otherwise crossing the line would *drop* you a place
   * while the rest kept accumulating progress behind you.
   */
  placeOf(r: Racer): number {
    let ahead = 0;
    for (const o of this.racers) {
      if (o === r) continue;
      if (o.finished && r.finished) {
        if (o.finishTime < r.finishTime) ahead++;
      } else if (o.finished !== r.finished) {
        if (o.finished) ahead++;
      } else if (o.progress > r.progress) {
        ahead++;
      }
    }
    return ahead + 1;
  }

  say(msg: string, secs = 1.4): void {
    this.note = msg;
    this.noteLeft = secs;
  }

  update(dt: number, cmd: RaceCommand, rivalCmd?: (r: Racer) => RaceCommand): void {
    if (this.state === "done") return;

    if (this.state === "countdown") {
      /*
       * One tick per number *shown*, which is not the same as one per crossing.
       * Watching for crossings alone beeps on 3->2 and 2->1 and never on the 3
       * itself, so the card reads "3 2 1 GO" over two beeps and a chime. Tracking
       * the displayed value instead covers the first frame too, and still cannot
       * double-fire on a short frame or skip on a long one.
       */
      const now0 = Math.ceil(this.countdown);
      if (now0 !== this.counted && now0 > 0) {
        this.counted = now0;
        this.events.push("count");
      }
      this.countdown -= dt;
      const now = Math.ceil(this.countdown);
      if (now !== this.counted && now > 0) {
        this.counted = now;
        this.events.push("count");
      }
      if (this.countdown <= 0) {
        this.state = "racing";
        this.countdown = 0;
        this.lapStart = 0;
        this.events.push("go");
      }
      return;
    }

    this.time += dt;
    if (this.noteLeft > 0) this.noteLeft = Math.max(0, this.noteLeft - dt);
    if (this.shake > 0) this.shake = Math.max(0, this.shake - dt * 3);

    this.stepRacer(this.player, cmd, dt);
    if (rivalCmd) {
      for (const r of this.racers) {
        if (r.human) continue;
        this.stepRacer(r, rivalCmd(r), dt);
      }
    }

    // the leash: say something, do nothing
    const near = this.course.pointAt(this.player.param);
    this.offCourse = near.distanceTo(this.player.pos) > GATE_SPACING * OFF_COURSE;

    if (this.player.finished) this.finish(false);
  }

  /** Give up. The stake is already gone, so this is a forfeit and not a 4th. */
  retire(): void {
    this.finish(true);
  }

  private finish(retired: boolean): void {
    if (this.ended) return;
    this.ended = true;
    this.state = "done";
    const p = this.player;
    this.opts.onOutcome?.({
      place: retired ? 4 : this.placeOf(p),
      laps: p.lap,
      totalSec: p.finished ? p.finishTime : this.time,
      bestLapSec: this.bestLapSec,
      gatesCleared: p.gatesCleared,
      gatesMissed: this.gatesMissed,
      stake: this.opts.stake,
      retired,
    });
  }

  outcomePlace(): number {
    return this.placeOf(this.player);
  }
}

/**
 * A steering command that points a racer at a world point.
 *
 * Proportional against *what the hull can actually do this frame*: dividing the
 * angular error by `rate * dt` gives 1.0 exactly when the turn would take the
 * whole frame's allowance, so the clamp means "turn onto it if you can, else
 * turn as hard as you are able". The player's mouse goes through the same
 * normalisation, which is what keeps a probe's autopilot and a human flying the
 * same aircraft.
 *
 * Shared by the autopilot probe hook and — shortly — by the rivals.
 */
export function aimCommand(
  r: Racer,
  target: THREE.Vector3,
  dt: number,
  turnRate: number,
  out: RaceCommand,
): RaceCommand {
  const inv = _q.copy(r.quat).invert();
  const v = _a.copy(target).sub(r.pos).applyQuaternion(inv);
  // forward is -Z, so +x is "target lies to the right" and +y "above"
  const yawErr = Math.atan2(v.x, -v.z);
  const pitchErr = Math.atan2(v.y, Math.hypot(v.x, v.z));
  const step = Math.max(1e-5, turnRate * dt);
  out.yaw = THREE.MathUtils.clamp(yawErr / step, -1, 1);
  out.pitch = THREE.MathUtils.clamp(pitchErr / step, -1, 1);
  return out;
}

/** The course hash, for the rival draws. Kept local so `sim` has no RNG of its own. */
function frac(seed: number, i: number): number {
  let h = (i * 374761393 + (i * 7 + 11) * 668265263 + seed * 2246822519) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

export type { RaceOutcome };
