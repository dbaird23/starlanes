/**
 * The race session: pointer lock, the GL scene, the cockpit layer, the end card.
 * `Game` owns one of these while `mode === "race"`.
 *
 * Same split as the on-foot run: the world is three.js blitted into the game's
 * 2D canvas, and everything with text on it is canvas 2D over the top — which is
 * where text belongs and where the rest of the game's UI already lives.
 */

import * as THREE from "three";
import type { Input } from "../../engine/input";
import { SHIP_SPRITES } from "../../data/universe";
import { getSprite, rotationFrame } from "../../engine/sprites";
import { RaceScene, FOV_DEG, FOV_BOOST } from "./scene";
import { BOOST_MAX, RaceWorld, aimCommand, forwardOf } from "./sim";
import type { RaceCommand, RaceOptions, RaceSprite } from "./types";

const MOUSE_SENS = 0.0022;
/** Arrow keys ask for the full turn rate; the axis commands are normalised. */
const KEY_TURN = 1;

const clamp1 = (v: number): number => (v < -1 ? -1 : v > 1 ? 1 : v);

const MONO = '"JetBrains Mono", ui-monospace, monospace';
const DISPLAY = '"Chakra Petch", "Verdana", sans-serif';

/** The four GRN liveries, in the order their PICTs run (8530-8533). */
export const LIVERY_NAMES = ["Blue", "Green", "Yellow", "Red"];
const LIVERY_TINT: [number, number, number][] = [
  [0.45, 0.62, 1.35],
  [0.45, 1.3, 0.5],
  [1.35, 1.15, 0.35],
  [1.4, 0.42, 0.38],
];
const LIVERY_CSS = ["#6a9cff", "#5fd46a", "#e0c94a", "#e0605a"];

/**
 * How fast the camera catches up with the hull.
 *
 * Rigidly locked to the quaternion, every twitch of the mouse is a twitch of the
 * whole world and the frame reads as noise at speed. A short lag lets the hull
 * lead and the view follow, which is most of what makes a racer feel like it has
 * mass.
 */
const CAM_TAU = 0.08;

export class RaceSession {
  readonly world: RaceWorld;
  private readonly canvas: HTMLCanvasElement;
  private scene: RaceScene | null = null;

  /** rolling mean of GL frame times, in ms — a probe hook, nothing draws it */
  frameMs = 0;

  paused = true;
  private locked = false;
  private mouseDx = 0;
  private mouseDy = 0;
  private boosting = false;
  /** set when the player asks to leave; Game polls it */
  wantsExit = false;
  /** first Q arms the forfeit, second confirms it — see `update` */
  private quitArmed = 0;

  /** Probe hook, off in play: drop the 2D layer so the 3D frame can be judged. */
  noCockpit = false;
  /** Probe hook, off in play: fly the course unaided. See `update`. */
  autopilot = false;

  private camQuat = new THREE.Quaternion();
  private camFov = FOV_DEG;

  private onLockChange = (): void => {
    this.locked = document.pointerLockElement === this.canvas;
    // Esc is how the browser hands the pointer back, so losing the lock has to
    // pause rather than exit — the landed Esc handler would depart the planet
    if (!this.locked) this.paused = true;
  };
  private onMouseMove = (e: MouseEvent): void => {
    if (this.locked && !this.paused) {
      this.mouseDx += e.movementX;
      this.mouseDy += e.movementY;
    }
  };
  private onMouseDown = (e: MouseEvent): void => {
    if (e.button === 0) this.boosting = true;
  };
  private onMouseUp = (e: MouseEvent): void => {
    if (e.button === 0) this.boosting = false;
  };

  constructor(canvas: HTMLCanvasElement, opts: RaceOptions) {
    this.canvas = canvas;
    this.world = new RaceWorld(opts);
    try {
      this.scene = new RaceScene(this.world.course);
    } catch (e) {
      // no WebGL: the session still runs, it just has nothing to look at
      console.error("race: WebGL unavailable", e);
    }
    this.camQuat.copy(this.world.player.quat);

    document.addEventListener("pointerlockchange", this.onLockChange);
    window.addEventListener("mousemove", this.onMouseMove);
    window.addEventListener("mousedown", this.onMouseDown);
    window.addEventListener("mouseup", this.onMouseUp);
  }

  get glTris(): number {
    return this.scene?.tris ?? 0;
  }

  requestLock(): void {
    if (this.world.state === "done") return;
    this.paused = false;
    if (!this.locked) void this.canvas.requestPointerLock?.();
  }

  dispose(): void {
    document.removeEventListener("pointerlockchange", this.onLockChange);
    window.removeEventListener("mousemove", this.onMouseMove);
    window.removeEventListener("mousedown", this.onMouseDown);
    window.removeEventListener("mouseup", this.onMouseUp);
    if (document.pointerLockElement === this.canvas) document.exitPointerLock?.();
    this.scene?.dispose();
    this.scene = null;
  }

  update(dt: number, input: Input): void {
    if (this.world.state === "done") {
      if (input.consume("Enter") || input.consume("NumpadEnter") || input.consume("KeyQ")) {
        this.wantsExit = true;
      }
      return;
    }

    /*
     * **Q is a forfeit, so it asks first.** The stake was debited on entry, so
     * an instant quit is an instant loss of up to 5,000 credits on a key the
     * on-foot run trains you to press without thinking. One press arms it and
     * says so; a second inside four seconds retires.
     */
    if (input.consume("KeyQ")) {
      if (this.quitArmed > 0) {
        this.world.retire();
        return;
      }
      this.quitArmed = 4;
      this.world.say(
        this.world.opts.stake > 0
          ? `Q again to retire — you forfeit ${this.world.opts.stake.toLocaleString()} cr`
          : "Q again to leave",
        4,
      );
    }
    if (this.quitArmed > 0) this.quitArmed = Math.max(0, this.quitArmed - dt);

    if (this.paused) {
      this.mouseDx = 0;
      this.mouseDy = 0;
      return;
    }

    const down = (c: string): number => (input.isDown(c) ? 1 : 0);
    const throttle = down("KeyW") ? 1 : down("KeyS") ? 0 : 0.6;

    /*
     * **The axis commands are normalised rates, not angles.** `stepRacer`
     * multiplies them by `turnRate * dt`, so feeding a raw mouse delta in
     * radians (which the first cut did) multiplies an angle by a rate and gets
     * neither: the result is framerate-dependent and about a degree per hundred
     * pixels. Converting the delta to a rate first — radians this frame divided
     * by the frame — and then normalising against the hull's own turn rate makes
     * the mouse frame-rate independent and caps it at what the Viper can do.
     */
    const tr = this.world.stats.turnRate;
    const inv = 1 / Math.max(dt, 1e-4);
    const cmd: RaceCommand = {
      yaw: clamp1(
        ((this.mouseDx * MOUSE_SENS) * inv) / tr +
          (down("ArrowRight") - down("ArrowLeft")) * KEY_TURN,
      ),
      pitch: clamp1(
        ((-this.mouseDy * MOUSE_SENS) * inv) / tr +
          (down("ArrowUp") - down("ArrowDown")) * KEY_TURN,
      ),
      roll: clamp1(down("KeyD") - down("KeyA")),
      throttle,
      boost: this.boosting || input.isDown("Space"),
    };
    this.mouseDx = 0;
    this.mouseDy = 0;

    /*
     * Probe hook, off in play: fly the course by itself, so a frame can be
     * looked at from somewhere on the line rather than from wherever a
     * hands-off ship drifted to. It shares `aimCommand` with the rivals, so
     * what it proves about steering is what they will do.
     */
    if (this.autopilot) {
      const g = this.world.course.gates[
        this.world.player.nextGate % this.world.course.gates.length
      ];
      aimCommand(this.world.player, g.pos, dt, tr, cmd);
      cmd.roll = 0;
      cmd.throttle = 1;
    }

    this.world.update(dt, cmd);

    // the camera trails the hull rather than being welded to it
    const k = 1 - Math.exp(-dt / CAM_TAU);
    this.camQuat.slerp(this.world.player.quat, k);
    const wantFov = this.boosting && this.world.player.boost > 0 ? FOV_BOOST : FOV_DEG;
    this.camFov += (wantFov - this.camFov) * (1 - Math.exp(-dt / 0.12));
  }

  /** The rivals, as billboards. */
  private sprites(cam: THREE.Vector3): RaceSprite[] {
    const out: RaceSprite[] = [];
    const meta = SHIP_SPRITES[this.world.opts.shipId];
    if (!meta) return out;
    const img = getSprite(meta.file);
    // getSprite returns null until the image is decoded — skip, every frame
    if (!img) return out;

    const fwd = new THREE.Vector3();
    for (const r of this.world.racers) {
      if (r.human) continue;
      forwardOf(r, fwd);
      const heading = Math.atan2(fwd.z, fwd.x);
      const camBearing = Math.atan2(r.pos.z - cam.z, r.pos.x - cam.x);
      // the extra quarter turn is because Nova's frame 0 faces up, not along +x
      const frame = rotationFrame(meta.framesPer, heading - camBearing - Math.PI / 2);
      out.push({
        pos: r.pos.clone(),
        img,
        frameSize: meta.w,
        frame,
        /*
         * Oversized against the 32-unit hull on purpose. Nova draws every ship
         * at a fixed sprite size whatever the range, so magnifying here is in
         * keeping rather than a cheat — and a 32px sheet at 500 units is
         * otherwise a smear you cannot race against.
         */
        scale: 56,
        alpha: 1,
        tint: LIVERY_TINT[r.livery],
      });
    }
    return out;
  }

  render(ctx: CanvasRenderingContext2D, w: number, h: number): void {
    const scene = this.scene;
    const p = this.world.player;
    if (scene) {
      scene.updateGates(p.nextGate, this.world.time);
      const t0 = performance.now();
      const frame = scene.render(
        { pos: p.pos, quat: this.camQuat, fov: this.camFov },
        this.sprites(p.pos),
        Math.max(2, Math.round(w)),
        Math.max(2, Math.round(h)),
      );
      this.frameMs += (performance.now() - t0 - this.frameMs) * 0.1;
      ctx.drawImage(frame, 0, 0, w, h);
    } else {
      ctx.fillStyle = "#05070a";
      ctx.fillRect(0, 0, w, h);
    }
    if (!this.noCockpit) this.drawHud(ctx, w, h);
  }

  /* ------------------------------------------------------------------ 2D */

  private drawHud(ctx: CanvasRenderingContext2D, w: number, h: number): void {
    const world = this.world;
    const p = world.player;
    // one scalar drives every margin and font, so the panel thins on an
    // ultrawide instead of eating the view
    const s = Math.max(0.75, Math.min(1.4, Math.min(w / 1280, h / 800)));

    // the clip shake moves the *marker*, not the readouts — a lap timer that
    // jitters reads as a rendering fault rather than as an impact
    if (world.shake > 0) {
      ctx.save();
      const k = world.shake * 6 * s;
      ctx.translate(Math.sin(world.time * 90) * k, Math.cos(world.time * 71) * k);
      this.drawGateArrow(ctx, w, h, s);
      ctx.restore();
    } else {
      this.drawGateArrow(ctx, w, h, s);
    }

    const pad = 26 * s;
    ctx.textBaseline = "alphabetic";

    /* speed, bottom left */
    ctx.fillStyle = "#7d8a99";
    ctx.font = `${10 * s}px ${MONO}`;
    ctx.textAlign = "left";
    ctx.fillText("SPEED", pad, h - pad - 26 * s);
    ctx.fillStyle = "rgba(196,214,232,0.92)";
    ctx.font = `${30 * s}px ${DISPLAY}`;
    ctx.fillText(String(Math.round(p.speed)), pad, h - pad);

    /* boost, bottom right */
    const bw = 120 * s;
    ctx.fillStyle = "#7d8a99";
    ctx.font = `${10 * s}px ${MONO}`;
    ctx.textAlign = "right";
    ctx.fillText("BOOST", w - pad, h - pad - 26 * s);
    ctx.fillStyle = "rgba(20,26,34,0.75)";
    ctx.fillRect(w - pad - bw, h - pad - 18 * s, bw, 10 * s);
    ctx.fillStyle = "#e0a83c";
    ctx.fillRect(w - pad - bw, h - pad - 18 * s, bw * Math.min(1, p.boost / BOOST_MAX), 10 * s);

    /* lap and place, top centre */
    ctx.textAlign = "center";
    ctx.fillStyle = "rgba(196,214,232,0.92)";
    ctx.font = `${22 * s}px ${DISPLAY}`;
    const laps = world.opts.laps;
    ctx.fillText(
      `LAP ${Math.min(p.lap + 1, laps)}/${laps}    POS ${world.placeOf(p)}/4`,
      w / 2,
      pad + 20 * s,
    );
    ctx.fillStyle = "#7d8a99";
    ctx.font = `${11 * s}px ${MONO}`;
    ctx.fillText(
      `GATE ${p.nextGate + 1}/${world.course.gates.length}   ${world.time.toFixed(1)}s`,
      w / 2,
      pad + 46 * s,
    );

    /* transient note */
    if (world.noteLeft > 0) {
      ctx.globalAlpha = Math.min(1, world.noteLeft * 2);
      ctx.fillStyle = "#e0c94a";
      ctx.font = `${16 * s}px ${DISPLAY}`;
      ctx.fillText(world.note, w / 2, h * 0.66);
      ctx.globalAlpha = 1;
    }
    if (world.offCourse) {
      ctx.fillStyle = "#e0605a";
      ctx.font = `${18 * s}px ${DISPLAY}`;
      ctx.fillText("RETURN TO COURSE", w / 2, h * 0.72);
    }

    /* countdown */
    if (world.state === "countdown") {
      const n = Math.ceil(world.countdown);
      ctx.fillStyle = "rgba(224,201,74,0.95)";
      ctx.font = `${86 * s}px ${DISPLAY}`;
      ctx.fillText(n > 0 ? String(n) : "GO", w / 2, h / 2);
    }

    if (this.paused && world.state !== "done") {
      this.card(ctx, w, h, "Comara Racing Viper", [
        `${LIVERY_NAMES[world.opts.livery]} — ${world.opts.title}`,
        "",
        "Mouse — steer      A / D — roll",
        "W — throttle       S — brake",
        "Shift or click — boost (earned by clean gates)",
        "",
        "Click to take the controls.    Q — retire",
      ]);
    }

    if (world.state === "done") {
      const place = world.outcomePlace();
      this.card(ctx, w, h, place === 1 ? "You win" : `Finished ${ordinal(place)}`, [
        `Best lap ${world.bestLapSec > 0 ? world.bestLapSec.toFixed(2) + "s" : "—"}`,
        `Total ${world.time.toFixed(2)}s   Gates missed ${world.gatesMissed}`,
        "",
        "Enter — back to the bar",
      ]);
    }
  }

  /**
   * The next gate, as a 2D marker.
   *
   * This is the navigation UI that actually matters. A hoop 2,000 units out is a
   * few pixels of dark ring against a bright nebula, and once you have missed
   * one it is *behind* you — which is exactly when a projected point lies about
   * where it is, because a point behind the camera projects mirrored. Hence the
   * `behind` flag: when it is set the direction is negated before the chevron is
   * clamped to its circle.
   */
  private drawGateArrow(
    ctx: CanvasRenderingContext2D,
    w: number,
    h: number,
    s: number,
  ): void {
    const scene = this.scene;
    if (!scene) return;
    const p = this.world.player;
    const g = this.world.course.gates[p.nextGate % this.world.course.gates.length];
    const pr = scene.project(g.pos, w, h);
    const dist = p.pos.distanceTo(g.pos);

    const cx = w / 2;
    const cy = h / 2;
    let dx = pr.x - cx;
    let dy = pr.y - cy;
    if (pr.behind) {
      dx = -dx;
      dy = -dy;
    }
    const len = Math.hypot(dx, dy) || 1;
    const ring = Math.min(w, h) * 0.32;
    const onScreen = !pr.behind && len < ring;

    ctx.save();
    ctx.textAlign = "center";
    ctx.font = `${10 * s}px ${MONO}`;

    if (onScreen) {
      // four corner ticks around the hoop, sized by range
      const r = Math.max(16 * s, (GATE_SCREEN * s * 900) / Math.max(120, dist));
      ctx.strokeStyle = "rgba(224,168,60,0.85)";
      ctx.lineWidth = 2 * s;
      ctx.beginPath();
      for (const [ax, ay] of CORNERS) {
        ctx.moveTo(pr.x + ax * r, pr.y + ay * r * 0.45);
        ctx.lineTo(pr.x + ax * r, pr.y + ay * r);
        ctx.lineTo(pr.x + ax * r * 0.45, pr.y + ay * r);
      }
      ctx.stroke();
      ctx.fillStyle = "rgba(224,168,60,0.8)";
      ctx.fillText(String(Math.round(dist)), pr.x, pr.y + r + 16 * s);
    } else {
      const ux = dx / len;
      const uy = dy / len;
      const x = cx + ux * ring;
      const y = cy + uy * ring;

      ctx.save();
      ctx.translate(x, y);
      ctx.rotate(Math.atan2(uy, ux));
      // red when the gate is behind you: the one state that needs signposting,
      // because it is the state you are in after a miss
      ctx.fillStyle = pr.behind ? "rgba(224,96,90,0.9)" : "rgba(224,168,60,0.9)";
      ctx.beginPath();
      ctx.moveTo(14 * s, 0);
      ctx.lineTo(-8 * s, -9 * s);
      ctx.lineTo(-8 * s, 9 * s);
      ctx.closePath();
      ctx.fill();
      ctx.restore();

      ctx.fillStyle = "rgba(224,168,60,0.8)";
      ctx.fillText(String(Math.round(dist)), x, y + 26 * s);
    }
    ctx.restore();
  }

  private card(
    ctx: CanvasRenderingContext2D,
    w: number,
    h: number,
    title: string,
    lines: string[],
  ): void {
    ctx.fillStyle = "rgba(0,0,0,0.68)";
    ctx.fillRect(0, 0, w, h);
    ctx.textAlign = "center";
    ctx.fillStyle = LIVERY_CSS[this.world.opts.livery];
    ctx.font = `34px ${DISPLAY}`;
    ctx.fillText(title, w / 2, h / 2 - 60);
    ctx.fillStyle = "rgba(196,214,232,0.9)";
    ctx.font = `14px ${MONO}`;
    lines.forEach((l, i) => ctx.fillText(l, w / 2, h / 2 - 20 + i * 22));
  }
}

/** Half-size of the on-screen bracket at 900 units. */
const GATE_SCREEN = 30;
const CORNERS: [number, number][] = [
  [-1, -1],
  [1, -1],
  [-1, 1],
  [1, 1],
];

function ordinal(n: number): string {
  return n === 1 ? "1st" : n === 2 ? "2nd" : n === 3 ? "3rd" : `${n}th`;
}
