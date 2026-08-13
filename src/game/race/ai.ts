/**
 * The three GRN rivals.
 *
 * They fly **the same `stepRacer` the player does** — same acceleration, same
 * turn rate, same speed/turn coupling, same swept gate test. Nothing here
 * teleports a rival along the spline or grants it a different top speed, and
 * that is deliberate on two counts: a race you can win by being better is only
 * meaningful if the opposition is subject to the same physics, and an AI bug
 * then shows up as a *flying* bug — a rival visibly overshooting a corner —
 * rather than as a mysterious result at the finish.
 *
 * What differs between the four ships is entirely in this file: where on the
 * course each one chooses to be, how far ahead it looks, and how much it lifts
 * for a corner.
 */

import * as THREE from "three";
import { GATE_SPACING, type Course } from "./course";
import { aimCommand } from "./sim";
import type { RaceCommand, Racer } from "./types";

/**
 * How hard a rival lifts off the throttle for curvature.
 *
 * The course's curvature runs to roughly 0.01 rad/unit at the tightest, so this
 * scales that into a meaningful fraction of throttle. It is what makes a rival
 * visibly slow for a corner instead of ploughing through at full power, which is
 * most of what makes them read as *driving* rather than following a rail.
 */
const CURVE_LIFT = 60;

/** Seconds of course a rival looks ahead, before its own skill modifies it. */
const LOOK_BASE = 0.55;

/**
 * How far a rival's chosen line wanders from the centre, as a fraction of its
 * own `lineError`. The wander is a slow sinusoid in course position, so a rival
 * drifts from the inside to the outside over a few gates rather than jittering.
 *
 * Without this the four of them fly single file down the exact centreline and
 * there is never an overtaking lane, because they all want the same metre of
 * space at the same moment.
 */
const WEAVE = 0.8;

const _look = new THREE.Vector3();
const _gate = new THREE.Vector3();
const _gr = new THREE.Vector3();
const _toGate = new THREE.Vector3();
const _cmd: RaceCommand = { pitch: 0, yaw: 0, roll: 0, throttle: 1, boost: false };

/**
 * Rubber-banding: how much a rival's target speed is scaled by the gap to the
 * player, and the cap either way.
 *
 * Deliberately mild and asymmetric in effect rather than in formula — a rival
 * that is behind gains a little, one that is ahead loses a little, and 6% is
 * small enough that a genuinely faster lap still wins. A four-way race settled
 * in the first fifteen seconds is a poor bar game when there is money on it.
 */
const RUBBER_K = 0.06;
const RUBBER_MIN = 0.94;
const RUBBER_MAX = 1.06;

/**
 * ...and it stops entirely for the last stretch of the final lap.
 *
 * **A race you have won has to stay won.** Rubber-banding that runs to the line
 * takes a lead the player earned over three laps and hands it back in the last
 * corner, which reads as the game cheating — and here it would be taking real
 * credits with it.
 */
const NO_RUBBER_AFTER = 0.8;

export interface RivalContext {
  course: Course;
  /** the human's total progress, for the leash */
  playerProgress: number;
  /** total gates in the whole race, for the "final stretch" test */
  raceGates: number;
  turnRate: number;
  dt: number;
}

/**
 * One rival's command for this frame.
 *
 * The steering target is a point *ahead on the spline*, offset onto this
 * rival's own line — not the next gate. Aiming at the gate itself produces a
 * ship that snaps from hoop to hoop in straight segments and corners like a
 * shopping trolley; aiming down the course produces one that carries a line
 * through a sequence, which is what a racer looks like.
 */
export function rivalCommand(r: Racer, ctx: RivalContext): RaceCommand {
  const { course, turnRate, dt } = ctx;
  const skill = r.skill;

  // where this rival is on the course, and where it is looking
  const ahead = (r.speed * (LOOK_BASE + skill.lookAhead * 0.5)) / Math.max(1, course.length);
  const t = r.param + ahead;
  const f = course.frameAt(t);

  /*
   * Its own line: a slow weave across the corridor, phased per rival so the
   * four of them are never in the same place. The offset is taken on the
   * course's own frame rather than in world space, so "outside of the corner"
   * means the same thing on a climb as it does on the flat.
   */
  const wob = Math.sin(t * Math.PI * 2 * 3 + skill.phase);
  const lateral = skill.lineError * (1 - WEAVE + WEAVE * wob);
  const vertical = skill.lineError * 0.45 * Math.cos(t * Math.PI * 2 * 2 + skill.phase);

  _look
    .copy(f.pos)
    .addScaledVector(f.right, lateral)
    .addScaledVector(f.up, vertical);

  /*
   * **Blend the aim onto the gate as it comes up, and pin it there if the gate
   * is behind.**
   *
   * Following the spline alone is what a racing line looks like, and it is also
   * not good enough: the look-ahead cuts the corner at a tight gate, the rival
   * crosses the plane outside the hoop, and `nextGate` does not advance. The
   * first cut did exactly that — two of three rivals missed gate 8 and then flew
   * the remaining three laps of spline with their gate index frozen, sailing
   * through the hoop's neighbourhood once a lap without ever taking it.
   *
   * Blending onto the gate centre near the gate guarantees the pass. Pinning to
   * it when the gate is *behind* is the recovery, and it is the same recovery a
   * player makes: aim at the hoop you owe, which means turning round and going
   * back for it. Nothing force-advances a gate — a rival pays for a miss in the
   * seconds it costs, exactly as you do.
   */
  const gate = course.gates[r.nextGate % course.gates.length];
  const behind = _toGate.copy(r.pos).sub(gate.pos).dot(gate.normal) > 0;
  const dGate = r.pos.distanceTo(gate.pos);
  const near = behind
    ? 1
    : THREE.MathUtils.clamp(1 - dGate / (GATE_SPACING * 1.3), 0, 1);

  if (near > 0) {
    // its own line through the hoop, kept well inside the aperture
    const gRight = _gr.crossVectors(gate.up, gate.normal).normalize();
    const room = gate.radius * 0.4;
    _gate
      .copy(gate.pos)
      .addScaledVector(gRight, THREE.MathUtils.clamp(lateral, -room, room))
      .addScaledVector(gate.up, THREE.MathUtils.clamp(vertical, -room, room));
    _look.lerp(_gate, near);
  }

  aimCommand(r, _look, dt, turnRate, _cmd);

  /* throttle: lift for what is coming, by this rival's own caution */
  const curve = course.curvatureAt(t);
  const lift = Math.min(0.55, curve * CURVE_LIFT * skill.throttleCaution);
  let throttle = 1 - lift;

  /* the leash */
  const finalStretch = r.gatesCleared > ctx.raceGates * NO_RUBBER_AFTER;
  if (!finalStretch) {
    const gap = ctx.playerProgress - r.progress;
    throttle *= THREE.MathUtils.clamp(1 + gap * RUBBER_K, RUBBER_MIN, RUBBER_MAX);
  }

  _cmd.throttle = THREE.MathUtils.clamp(throttle, 0, 1);
  /*
   * Bank *into* the turn — a rightward yaw rolls right, as an aircraft does.
   * Roll does not steer, so this is cosmetic to the sim and not cosmetic on
   * screen: the Nova sheet ships three sets and the banked art is selected off
   * this, so a rival that never rolls wears the level-flight set through every
   * corner on the course.
   */
  _cmd.roll = THREE.MathUtils.clamp(_cmd.yaw * 1.2, -1, 1);
  // spend boost on the straights, never into a corner — the same call a player
  // learns to make, and it is what stops them burning it where it does no good
  _cmd.boost = r.boost > 0 && lift < 0.1;
  return _cmd;
}
