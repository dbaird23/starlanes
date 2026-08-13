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
import { asset } from "../../asset";
import { SHIP_SPRITES } from "../../data/universe";
import { getSprite, rotationFrame } from "../../engine/sprites";
import { RaceScene, FOV_DEG, FOV_BOOST } from "./scene";
import { BOOST_MAX, RaceWorld, forwardOf } from "./sim";
import { rivalCommand, type RivalContext } from "./ai";
import type { RaceCommand, RaceOptions, RaceSprite } from "./types";

const MOUSE_SENS = 0.0022;
/** Arrow keys ask for the full turn rate; the axis commands are normalised. */
const KEY_TURN = 1;

const clamp1 = (v: number): number => (v < -1 ? -1 : v > 1 ? 1 : v);

/**
 * The secondary readout colour, and it is *not* the on-foot HUD's `#7d8a99`.
 *
 * That grey was chosen against a dead corridor, where the darkest thing in frame
 * is the background. Here the background is an authored nebula with cores far
 * brighter than the type, and a mid grey simply disappears over them. This keeps
 * the same hierarchy — secondary is still visibly quieter than the white values
 * — at a level that survives both ends of the sky.
 */
const LABEL = "rgba(214,228,244,0.82)";

/**
 * The dash's three recessed panels, **in the canopy art's own 0..1 space**.
 *
 * Measured off `cockpit.png` by scanning three rows across the dash band for
 * dark opaque runs; all three rows agreed to within a few thousandths, which is
 * what says these are panels and not a lucky threshold. Nothing reads the image
 * at runtime — exactly the contract `OPENINGS` states for the status-bar plate —
 * so **a revised canopy has to be re-measured and this table updated**, or the
 * readouts will sit on the frame instead of in the wells.
 */
const BEZEL = {
  left: { x0: 0.142, x1: 0.290 },
  centre: { x0: 0.408, x1: 0.591 },
  right: { x0: 0.710, x1: 0.864 },
};

/**
 * What the autopilot probe flies as: a competent line, no deliberate error.
 * Zero `lineError` puts it on the centreline, so its lap time is the benchmark
 * the rivals' skill draws are measured against.
 */
const AUTOPILOT_SKILL = { lineError: 0, lookAhead: 0.7, throttleCaution: 0.7, phase: 0 };

/** The Comara Racing Viper's hull length, in world units — its sprite is 32px. */
const HULL_LEN = 34;

/**
 * Overall gain on the engine cones.
 *
 * The sprite shader multiplies an additive sprite by 3.0 — that is what makes an
 * explosion read as light rather than paint — so a tint near 1.0 arrives at the
 * tone-map curve around 3.75 and clips to a flat white disc. 0.45 puts the core
 * just over 1.0, where the shoulder rolls it off and it reads as *hot* instead
 * of as a hole in the frame.
 *
 * Declared **above** `GLOW_TINT`, which multiplies by it at module load: the
 * other order is a temporal dead zone error that typechecks cleanly and throws
 * on import.
 */
const GLOW_GAIN = 0.45;

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

/**
 * The same four liveries, pulled most of the way to warm white, for the engine
 * cones.
 *
 * Every exhaust in the source movies is orange, and tinting a cone fully blue or
 * green to match its hull throws that away. But at five hundred units the cone
 * is all you can see, and four identical flames tell you nothing about who is
 * who in a race you are being paid on. Blending 0.6 toward white keeps them all
 * reading as fire while leaving just enough hue to sort the pack.
 */
const GLOW_TINT: [number, number, number][] = LIVERY_TINT.map((c) => [
  (c[0] * 0.4 + 1.25 * 0.6) * GLOW_GAIN,
  (c[1] * 0.4 + 1.05 * 0.6) * GLOW_GAIN,
  (c[2] * 0.4 + 0.8 * 0.6) * GLOW_GAIN,
]) as [number, number, number][];
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

  /**
   * The canopy. Loaded straight through `asset()` rather than `getSprite`,
   * which hardcodes the `nova/sprites/` prefix — the same reason `glscene.ts`
   * loads its tiles that way. Null until decoded, and the HUD simply falls back
   * to screen-margin readouts until then, so a missing file is a playable game
   * rather than a blank frame.
   */
  private cockpit: HTMLImageElement | null = null;

  /**
   * The engine cone. Drawn procedurally at construction so the rivals are
   * trackable *now*, and replaced by `race/engine-glow.png` if that file exists.
   *
   * A radial gradient is an honest stand-in for this one asset in a way it would
   * not be for the canopy or the hoop: what the movies show at range is a soft
   * white-hot core falling off through orange, which is exactly what a gradient
   * is. Authored art will beat it on the flare's shape, not its behaviour.
   */
  private glow: HTMLImageElement | null = null;

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

    const canopy = new Image();
    canopy.onload = (): void => {
      this.cockpit = canopy;
    };
    canopy.src = asset("race/cockpit.png");

    const stand = new Image();
    stand.onload = (): void => {
      this.glow = this.glow ?? stand;
    };
    stand.src = engineGlowDataUrl();
    // an authored cone wins if one has been dropped in
    const authored = new Image();
    authored.onload = (): void => {
      this.glow = authored;
    };
    authored.src = asset("race/engine-glow.png");

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
     * Probe hook, off in play: fly the course by itself.
     *
     * It runs the **rivals' own policy**, not a simpler one, and that is what
     * makes it useful for more than screenshots — it is the benchmark that says
     * whether the AI is fast because it drives well or because it is cheating.
     * A naive version (aim at the gate centre, full throttle, never lift) was
     * tried first and lapped 40% slower than the rivals, which proves nothing
     * about them and only that ignoring the speed/turn coupling is punished.
     */
    if (this.autopilot) {
      const me = this.world.player;
      const saved = me.skill;
      me.skill = AUTOPILOT_SKILL;
      Object.assign(
        cmd,
        rivalCommand(me, {
          course: this.world.course,
          playerProgress: me.progress,
          raceGates: this.world.course.gates.length * this.world.opts.laps,
          turnRate: tr,
          dt,
        }),
      );
      me.skill = saved;
    }

    const ctx: RivalContext = {
      course: this.world.course,
      playerProgress: this.world.player.progress,
      raceGates: this.world.course.gates.length * this.world.opts.laps,
      turnRate: tr,
      dt,
    };
    this.world.update(dt, cmd, (r) => rivalCommand(r, ctx));

    // the camera trails the hull rather than being welded to it
    const k = 1 - Math.exp(-dt / CAM_TAU);
    this.camQuat.slerp(this.world.player.quat, k);
    const wantFov = this.boosting && this.world.player.boost > 0 ? FOV_BOOST : FOV_DEG;
    this.camFov += (wantFov - this.camFov) * (1 - Math.exp(-dt / 0.12));
  }

  /**
   * The rivals, as billboards — hull plus engine cone.
   *
   * **The glow is what you actually track.** A 32x32 Nova sheet at five hundred
   * units is a handful of pixels whichever way it is filtered, and Nova's hulls
   * are drawn from directly above besides, so the silhouette is never quite the
   * one a level camera should see. The source movies solve it for us: what reads
   * across those four seconds is four orange engine cones, and the hulls only
   * have to hold up once something is close. So each rival gets an additive
   * glow, larger than the hull and unfogged, and the sprite behind it is a
   * bonus rather than the load-bearing cue.
   */
  private sprites(cam: THREE.Vector3): RaceSprite[] {
    const out: RaceSprite[] = [];
    const meta = SHIP_SPRITES[this.world.opts.shipId];
    const img = meta ? getSprite(meta.file) : null;
    const glow = this.glow;

    const fwd = new THREE.Vector3();
    for (const r of this.world.racers) {
      if (r.human) continue;

      // the cone sits behind the hull, along its own thrust axis
      if (glow?.naturalWidth) {
        forwardOf(r, fwd);
        out.push({
          pos: r.pos.clone().addScaledVector(fwd, -HULL_LEN * 0.55),
          img: glow,
          frameSize: glow.naturalWidth,
          frame: 0,
          /*
           * Sized against the hull, not against what looks findable at range.
           * The first cut used 34..60 units — *larger than the 48-unit gate
           * radius* — which at seventy metres filled a third of the canopy with
           * a white blob. A 34-unit hull already subtends a comfortable 30-70px
           * at five hundred units, so nothing needed oversizing; the earlier
           * worry was simply wrong.
           *
           * It still flares with throttle, so a rival lifting for a corner
           * visibly backs off — the one piece of their driving readable at range.
           */
          scale: HULL_LEN * (0.38 + 0.3 * Math.min(1, r.speed / this.world.stats.maxSpeed)),
          alpha: 1,
          additive: true,
          smooth: true,
          tint: GLOW_TINT[r.livery],
        });
      }

      // getSprite returns null until the image is decoded — skip, every frame
      if (!img || !meta) continue;
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
        // the hull's real length; see the glow above for why this is not
        // oversized the way the first cut assumed it had to be
        scale: HULL_LEN,
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

  /**
   * The canopy: scaled **by width**, anchored to the bottom, top allowed to
   * crop. The status-bar plate's rule exactly — artwork is never scaled to fit.
   *
   * Cover-scaling was tried first and is wrong, for a reason worth recording.
   * On any window taller than the art's 16:10 it scales by height instead, and
   * the overflow goes sideways: the outer bezels slide off the screen and take
   * the speed readout with them. Losing an instrument is a much worse failure
   * than the A-pillars not quite reaching the top, and width-scaling only
   * degrades that way on aspects taller than 16:10, which no game window is —
   * 16:9, 16:10 and ultrawide all overflow vertically and crop the top, which is
   * exactly what you want.
   *
   * Returns the rect it drew into, because the readouts are positioned in the
   * art's own space and need it to get back to pixels.
   */
  private drawCockpit(
    ctx: CanvasRenderingContext2D,
    w: number,
    h: number,
  ): { x: number; y: number; w: number; h: number } | null {
    const img = this.cockpit;
    if (!img?.naturalWidth) return null;
    const scale = w / img.naturalWidth;
    const dw = img.naturalWidth * scale;
    const dh = img.naturalHeight * scale;
    const dx = (w - dw) / 2;
    const dy = h - dh;
    ctx.drawImage(img, dx, dy, dw, dh);
    return { x: dx, y: dy, w: dw, h: dh };
  }

  private drawHud(ctx: CanvasRenderingContext2D, w: number, h: number): void {
    const world = this.world;
    const p = world.player;
    // one scalar drives every margin and font, so the panel thins on an
    // ultrawide instead of eating the view
    const s = Math.max(0.75, Math.min(1.4, Math.min(w / 1280, h / 800)));

    // the canopy goes down first and unshadowed — it is the surface the
    // readouts are lit against, not another readout
    const art = this.drawCockpit(ctx, w, h);
    /** A bezel's centre, and its width, in screen pixels. */
    const bez = (b: { x0: number; x1: number }): { cx: number; wide: number } =>
      art
        ? { cx: art.x + ((b.x0 + b.x1) / 2) * art.w, wide: (b.x1 - b.x0) * art.w }
        : { cx: w / 2, wide: 200 * s };
    /** A y fraction of the art, in screen pixels. */
    const ay = (f: number): number => (art ? art.y + f * art.h : h * f);

    /*
     * **Everything on this layer carries a drop shadow, and it is not styling.**
     *
     * The on-foot HUD's colours were picked against a dead corridor, which is
     * near black — pale grey on black is a contrast ratio you cannot lose. Here
     * the backdrop is an authored nebula whose bright cores are far lighter than
     * the type, so the lap counter and the gate distance vanish exactly when you
     * fly past something bright. A shadow costs one state change and holds the
     * readouts legible over both ends of the sky.
     */
    ctx.save();
    ctx.shadowColor = "rgba(0,0,0,0.9)";
    ctx.shadowBlur = 4 * s;
    ctx.shadowOffsetY = 1 * s;

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

    ctx.textBaseline = "alphabetic";
    ctx.textAlign = "center";

    /*
     * The three readouts sit **inside the dash's own recessed panels**, measured
     * off the art rather than floated at screen margins. It is the same contract
     * the status-bar plate states in `OPENINGS`: nothing reads the image at
     * runtime, so a revised canopy has to be re-measured and these updated. The
     * fallback when the art has not loaded keeps the game playable, which is why
     * `bez` has one.
     */
    const labelY = ay(0.893);
    const valueY = ay(0.941);

    /* speed — left bezel */
    const bl = bez(BEZEL.left);
    ctx.fillStyle = LABEL;
    ctx.font = `${10 * s}px ${MONO}`;
    ctx.fillText("SPEED", bl.cx, labelY);
    ctx.fillStyle = "rgba(214,230,246,0.95)";
    ctx.font = `${28 * s}px ${DISPLAY}`;
    ctx.fillText(String(Math.round(p.speed)), bl.cx, valueY);

    /* lap and place — centre bezel */
    const bc = bez(BEZEL.centre);
    const laps = world.opts.laps;
    ctx.fillStyle = LABEL;
    ctx.font = `${10 * s}px ${MONO}`;
    ctx.fillText(
      `GATE ${p.nextGate + 1}/${world.course.gates.length}   ${world.time.toFixed(1)}s`,
      bc.cx,
      labelY,
    );
    ctx.fillStyle = "rgba(214,230,246,0.95)";
    ctx.font = `${24 * s}px ${DISPLAY}`;
    ctx.fillText(
      `LAP ${Math.min(p.lap + 1, laps)}/${laps}   POS ${world.placeOf(p)}/4`,
      bc.cx,
      valueY,
    );

    /* boost — right bezel */
    const br = bez(BEZEL.right);
    const bw = br.wide * 0.72;
    ctx.fillStyle = LABEL;
    ctx.font = `${10 * s}px ${MONO}`;
    ctx.fillText("BOOST", br.cx, labelY);
    ctx.fillStyle = "rgba(12,16,22,0.8)";
    ctx.fillRect(br.cx - bw / 2, valueY - 12 * s, bw, 11 * s);
    ctx.fillStyle = "#e0a83c";
    ctx.fillRect(
      br.cx - bw / 2,
      valueY - 12 * s,
      bw * Math.min(1, p.boost / BOOST_MAX),
      11 * s,
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

    ctx.restore();
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

/**
 * The stand-in engine cone: white-hot core, orange shoulder, transparent edge.
 *
 * Built as a data URL rather than a canvas handed straight to three, because the
 * scene keys its texture cache on `img.src` — a canvas has none, so every rival
 * would allocate a fresh GPU texture every frame.
 */
function engineGlowDataUrl(): string {
  const n = 128;
  const c = document.createElement("canvas");
  c.width = n;
  c.height = n;
  const ctx = c.getContext("2d");
  if (!ctx) return "";
  const g = ctx.createRadialGradient(n / 2, n / 2, 0, n / 2, n / 2, n / 2);
  g.addColorStop(0, "rgba(255,255,250,1)");
  g.addColorStop(0.22, "rgba(255,214,140,0.95)");
  g.addColorStop(0.5, "rgba(255,130,40,0.45)");
  g.addColorStop(1, "rgba(255,90,20,0)");
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, n, n);
  return c.toDataURL("image/png");
}
