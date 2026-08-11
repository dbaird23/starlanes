/**
 * The on-foot session: pointer lock, the GL scene, the HUD, and the two end
 * cards. `Game` owns one of these while `mode === "fps"`.
 *
 * The world is three.js over a mesh built once from the deck (`mesh.ts`,
 * `glscene.ts`); everything else on screen — viewmodel, readouts, minimap, end
 * cards — is canvas 2D over the top of the blitted frame, which is where text
 * belongs and where the rest of the game's UI already lives.
 */

import type { Input } from "../../engine/input";
import { playAmbient, stopAmbient } from "../../engine/audio";
import { GlScene } from "./glscene";
import { FpsWorld, type FpsCommand } from "./sim";
import type { FpsOptions, FpsSprite } from "./types";
import { AIR_LOW, formatAir } from "./salvage";
import { placeProps } from "./props";

const MOUSE_SENS = 0.0022;
const KEY_TURN = 2.4;

const MONO = '"JetBrains Mono", ui-monospace, monospace';
const DISPLAY = '"Chakra Petch", "Verdana", sans-serif';

export class FpsSession {
  readonly world: FpsWorld;
  private readonly canvas: HTMLCanvasElement;

  private gl: GlScene | null = null;
  /** rolling mean of GL frame times, in ms — a probe hook, nothing draws it */
  frameMs = 0;

  /** true until the pointer is captured, and again whenever it is released */
  paused = true;
  private locked = false;
  private mouseDx = 0;
  private mouseDy = 0;
  private firing = false;
  private bob = 0;
  /** set when the player asks to leave; Game polls it */
  wantsExit = false;
  /**
   * Probe hook, off in play: drop every tile and the deck plate so the frame is
   * flat-shaded surfaces only. The section's silhouette — where the fold leaves
   * the deck, and how it turns a corner — is what is being judged when this is
   * on, and greebled photographic metal hides it completely.
   */
  noTextures = false;
  /**
   * ...and the other half of that hook: raise every sector to this level, so a
   * dead compartment can be looked at as though the ship still had power. What
   * the reference calls the "after" state (`corridors/corridor-lit.png`) is
   * this scene at `lightFloor` 0.9; the resting state (`damage/damage.png`) is
   * the same scene at 0.
   */
  lightFloor = 0;

  private onLockChange = (): void => {
    this.locked = document.pointerLockElement === this.canvas;
    // Esc is how the browser hands the pointer back, so losing the lock has to
    // pause rather than exit — the landed Esc handler would depart the planet
    if (!this.locked) this.paused = true;
  };
  private onMouseMove = (e: MouseEvent): void => {
    if (this.locked && !this.paused) {
      this.mouseDx += e.movementX;
      /*
       * Not inverted. Nova has no first-person mode and so no convention to
       * inherit, and every shooter since Quake has defaulted to mouse-forward
       * looking up; an invert toggle can go in with the other bindings.
       */
      this.mouseDy += e.movementY;
    }
  };
  private onMouseDown = (e: MouseEvent): void => {
    if (e.button === 0) this.firing = true;
  };
  private onMouseUp = (e: MouseEvent): void => {
    if (e.button === 0) this.firing = false;
  };

  constructor(canvas: HTMLCanvasElement, opts: FpsOptions) {
    this.canvas = canvas;
    this.world = new FpsWorld(opts);
    try {
      this.gl = new GlScene(opts.level);
      this.gl.setProps(placeProps(opts.level, this.world.run.stations));
      this.gl.setStations(this.world.run.stations, (x, y) =>
        opts.level.sectorOf[
          Math.floor(y) * opts.level.w + Math.floor(x)
        ] ?? 0,
      );
    } catch (e) {
      // no WebGL: the session still runs, it just has nothing to look at
      console.error("fps: WebGL unavailable", e);
    }

    document.addEventListener("pointerlockchange", this.onLockChange);
    window.addEventListener("mousemove", this.onMouseMove);
    window.addEventListener("mousedown", this.onMouseDown);
    window.addEventListener("mouseup", this.onMouseUp);

    if (opts.ambientSnd) playAmbient(opts.ambientSnd, true, 0.3);
  }

  /** Triangles in the static level mesh. Probe hook. */
  get glTris(): number {
    return this.gl?.tris ?? 0;
  }

  /** Called from the canvas click handler: take the pointer and start. */
  requestLock(): void {
    if (this.world.state !== "playing") return;
    this.paused = false;
    if (!this.locked) void this.canvas.requestPointerLock?.();
  }

  dispose(): void {
    document.removeEventListener("pointerlockchange", this.onLockChange);
    window.removeEventListener("mousemove", this.onMouseMove);
    window.removeEventListener("mousedown", this.onMouseDown);
    window.removeEventListener("mouseup", this.onMouseUp);
    if (document.pointerLockElement === this.canvas) document.exitPointerLock?.();
    this.gl?.dispose();
    this.gl = null;
    stopAmbient();
  }

  update(dt: number, input: Input): void {
    // Q leaves, from anywhere including the end cards
    if (input.consume("KeyQ")) {
      this.wantsExit = true;
      return;
    }
    if (this.world.state !== "playing") {
      if (input.consume("Enter") || input.consume("NumpadEnter")) this.wantsExit = true;
      return;
    }
    if (this.paused) {
      this.mouseDx = 0;
      this.mouseDy = 0;
      return;
    }

    const down = (c: string): number => (input.isDown(c) ? 1 : 0);
    const cmd: FpsCommand = {
      forward: down("KeyW") - down("KeyS"),
      strafe: down("KeyD") - down("KeyA"),
      turn:
        this.mouseDx * MOUSE_SENS +
        (down("ArrowRight") - down("ArrowLeft")) * KEY_TURN * dt,
      look:
        -this.mouseDy * MOUSE_SENS +
        (down("ArrowUp") - down("ArrowDown")) * KEY_TURN * dt,
      fire: this.firing || input.isDown("Space"),
      run: input.shiftDown,
    };
    this.mouseDx = 0;
    this.mouseDy = 0;

    if (cmd.forward || cmd.strafe) this.bob += dt * (cmd.run ? 11 : 7);
    this.world.update(dt, cmd);
  }

  render(ctx: CanvasRenderingContext2D, w: number, h: number): void {
    const gl = this.gl;
    if (gl) {
      const sprites: FpsSprite[] = this.world.sprites();
      const run = this.world.run;
      gl.updateStations(run.stations, run.target);
      /*
       * **Throwing a breaker lights the compartment that breaker belongs to**,
       * and leaves the rest of the ship exactly as dead as it was. That is the
       * payoff, and it is why the sector model was worth keeping from the
       * raycaster: light belongs to an *area*, so restoring power is a thing
       * that happens to a place rather than a number going up on the HUD.
       *
       * It used to raise `uMinLight`, which is the probe hook's level-wide
       * floor — one breaker lit the whole deck including the three compartments
       * you had not reached, so the second and third breakers had nothing left
       * to show you.
       */
      gl.setPower(run.power);
      const t0 = performance.now();
      const frame = gl.render(
        {
          x: this.world.x,
          y: this.world.y,
          angle: this.world.angle,
          pitch: this.world.pitch,
        },
        sprites,
        Math.max(2, Math.round(w)),
        Math.max(2, Math.round(h)),
        this.noTextures,
        this.lightFloor,
      );
      this.frameMs += (performance.now() - t0 - this.frameMs) * 0.1;
      ctx.drawImage(frame, 0, 0, w, h);
    } else {
      ctx.fillStyle = "#05070a";
      ctx.fillRect(0, 0, w, h);
    }

    this.drawHud(ctx, w, h);
  }

  /*
   * The viewmodel is gone with the weapon. There was never any first-person art
   * in Nova to draw one from, and a pair of hands holding nothing is worse than
   * an empty frame: what the player's attention should be on is the panel they
   * are standing at and the number counting down.
   */
  private drawHud(ctx: CanvasRenderingContext2D, w: number, h: number): void {
    const world = this.world;

    if (world.hurt > 0.01) {
      const g = ctx.createRadialGradient(
        w / 2, h / 2, Math.min(w, h) * 0.3,
        w / 2, h / 2, Math.max(w, h) * 0.62,
      );
      g.addColorStop(0, "rgba(120,0,0,0)");
      g.addColorStop(1, `rgba(150,10,10,${(0.55 * world.hurt).toFixed(2)})`);
      ctx.fillStyle = g;
      ctx.fillRect(0, 0, w, h);
    }

    if (world.state === "playing") {
      this.drawCrosshair(ctx, w, h);
      this.drawHold(ctx, w, h);
      this.drawReadouts(ctx, w, h);
      this.drawMap(ctx, w, h);
    }

    const run = world.run;
    if (this.paused && world.state === "playing") {
      this.card(ctx, w, h, world.opts.title.toUpperCase(), [
        "Five minutes of air. Throw every breaker, then get back to the lock.",
        "",
        "W A S D move · mouse looks around · hold click or Space to work a panel",
        "Lockers cost air. Shift run · Esc pause · Q leave",
      ]);
    } else if (world.state === "won") {
      /*
       * The haul is listed and not totalled, because a total is a score and a
       * list is a story: three lines of what you actually carried out is what
       * makes the locker you skipped at 0:40 worth remembering.
       */
      const lines = [
        `She has power, and you made the lock with ${formatAir(run.air)} in the tank.`,
        "",
      ];
      if (run.haul.length) {
        lines.push("Carried out:");
        for (const g of run.haul.slice(0, 6)) lines.push(`  ${g.name}`);
        if (run.haul.length > 6) lines.push(`  ...and ${run.haul.length - 6} more`);
      } else {
        lines.push("You touched nothing on the way. She is still yours.");
      }
      lines.push("", "Enter — back to the bar");
      this.card(ctx, w, h, "SHE'S YOURS", lines);
    } else if (world.state === "lost") {
      this.card(ctx, w, h, "OUT OF AIR", [
        `${run.breakers} of ${run.breakersTotal} breakers thrown.`,
        run.haul.length
          ? `You were carrying ${run.haul.length} find${run.haul.length > 1 ? "s" : ""}. They stay aboard.`
          : "",
        "",
        "Enter — back to the bar",
      ]);
    }
  }

  private drawCrosshair(ctx: CanvasRenderingContext2D, w: number, h: number): void {
    const cx = Math.round(w / 2);
    const cy = Math.round(h / 2);
    ctx.strokeStyle = "rgba(180,230,200,0.65)";
    ctx.lineWidth = 1;
    ctx.beginPath();
    for (const [dx, dy] of [[-1, 0], [1, 0], [0, -1], [0, 1]] as const) {
      ctx.moveTo(cx + dx * 5, cy + dy * 5);
      ctx.lineTo(cx + dx * 11, cy + dy * 11);
    }
    ctx.stroke();
  }

  /**
   * The tank, the objective, and the hold ring.
   *
   * Three readouts and no more. The shooter's HUD had hull, ammo, contacts and
   * a weapon name, and every one of them was a number you could watch instead
   * of looking at the ship; the run has exactly one number worth watching and
   * it is the one you cannot get back.
   */
  private drawReadouts(ctx: CanvasRenderingContext2D, w: number, h: number): void {
    const run = this.world.run;
    ctx.textBaseline = "alphabetic";

    /* ---- the tank, bottom left, and it is the only big number on screen */
    const low = run.air < AIR_LOW;
    const bx = 26;
    const by = h - 34;
    ctx.font = `500 11px ${MONO}`;
    ctx.fillStyle = low ? "#c66" : "#7d8a99";
    ctx.textAlign = "left";
    ctx.fillText("AIR", bx, by - 26);
    ctx.font = `600 30px ${MONO}`;
    /*
     * The last minute pulses. It is the only animated thing in the HUD, so it
     * cannot be mistaken for anything else, and it starts at `AIR_LOW` rather
     * than at some fraction of the tank so it means the same thing on a run
     * you spent well and one you didn't.
     */
    const pulse = low ? 0.72 + 0.28 * Math.abs(Math.sin(this.world.elapsed * 4)) : 1;
    ctx.fillStyle = low
      ? `rgba(230,90,90,${pulse.toFixed(2)})`
      : "rgba(196,214,232,0.92)";
    ctx.fillText(formatAir(run.air), bx, by);

    /* ---- the objective, bottom right: breakers, then get out */
    ctx.textAlign = "right";
    ctx.font = `500 11px ${MONO}`;
    ctx.fillStyle = "#7d8a99";
    ctx.fillText(run.powered ? "SHIP" : "BREAKERS", w - 26, by - 26);
    ctx.font = `600 20px ${MONO}`;
    ctx.fillStyle = run.powered ? "rgba(150,225,170,0.95)" : "rgba(196,214,232,0.92)";
    ctx.fillText(
      run.powered ? "GET BACK TO THE LOCK" : `${run.breakers} / ${run.breakersTotal}`,
      w - 26,
      by,
    );

    /* ---- and what just happened, under the reticle */
    if (run.noteLeft > 0) {
      ctx.textAlign = "center";
      ctx.font = `500 13px ${MONO}`;
      ctx.fillStyle = `rgba(196,224,208,${Math.min(1, run.noteLeft).toFixed(2)})`;
      ctx.fillText(run.note, w / 2, h / 2 + 54);
    }
  }

  /**
   * The hold ring: the verb, drawn where the verb happens.
   *
   * It is at the reticle and not on the panel because the panel is a rectangle
   * on a wall three metres away and the thing being reported is *your* action.
   * The ring only exists while a station is in reach, so it doubles as the
   * prompt — there is no "press E to use" line anywhere in the game.
   */
  private drawHold(ctx: CanvasRenderingContext2D, w: number, h: number): void {
    const run = this.world.run;
    if (run.target < 0) return;
    const st = run.stations[run.target];
    const cx = Math.round(w / 2);
    const cy = Math.round(h / 2);
    const r = 22;

    ctx.lineWidth = 2;
    ctx.strokeStyle = "rgba(150,180,205,0.35)";
    ctx.beginPath();
    ctx.arc(cx, cy, r, 0, Math.PI * 2);
    ctx.stroke();

    if (st.progress > 0.001) {
      // a locker's ring is amber, because amber is what the air is going into
      ctx.strokeStyle = st.kind === "locker" ? "rgba(240,180,90,0.95)" : "rgba(150,230,175,0.95)";
      ctx.beginPath();
      ctx.arc(cx, cy, r, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * st.progress);
      ctx.stroke();
    }

    ctx.textAlign = "center";
    ctx.textBaseline = "alphabetic";
    ctx.font = `500 11px ${MONO}`;
    ctx.fillStyle = "rgba(180,205,225,0.8)";
    ctx.fillText(st.label.toUpperCase(), cx, cy + r + 18);
    if (st.kind === "locker" && st.progress <= 0.001) {
      ctx.fillStyle = "rgba(240,180,90,0.75)";
      ctx.fillText("COSTS AIR", cx, cy + r + 32);
    }
  }

  private drawMap(ctx: CanvasRenderingContext2D, w: number, _h: number): void {
    const world = this.world;
    const lvl = world.level;
    const cell = 4;
    const mw = lvl.w * cell;
    const mh = lvl.h * cell;
    const ox = w - mw - 26;
    const oy = 26;

    ctx.fillStyle = "rgba(4,7,10,0.72)";
    ctx.fillRect(ox - 5, oy - 5, mw + 10, mh + 10);
    ctx.strokeStyle = "rgba(140,160,180,0.3)";
    ctx.lineWidth = 1;
    ctx.strokeRect(ox - 4.5, oy - 4.5, mw + 9, mh + 9);
    for (let y = 0; y < lvl.h; y++) {
      for (let x = 0; x < lvl.w; x++) {
        const i = y * lvl.w + x;
        if (!world.seen[i]) continue;
        ctx.fillStyle = lvl.cells[i] > 0 ? "#5d6b7d" : "#141c26";
        ctx.fillRect(ox + x * cell, oy + y * cell, cell, cell);
      }
    }
    if (world.cleared) {
      ctx.fillStyle = "#7fd18f";
      ctx.fillRect(ox + lvl.exit.x * cell - 2.5, oy + lvl.exit.y * cell - 2.5, 5, 5);
    }
    // a wedge, so the map says which way you are facing as well as where you are
    ctx.save();
    ctx.translate(ox + world.x * cell, oy + world.y * cell);
    ctx.rotate(world.angle);
    ctx.fillStyle = "#f0f4f8";
    ctx.beginPath();
    ctx.moveTo(4, 0);
    ctx.lineTo(-2.5, -2.5);
    ctx.lineTo(-2.5, 2.5);
    ctx.closePath();
    ctx.fill();
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
    ctx.fillStyle = "#c8d4e0";
    ctx.font = `700 34px ${DISPLAY}`;
    ctx.fillText(title, w / 2, h / 2 - 46);
    ctx.font = `400 14px ${MONO}`;
    ctx.fillStyle = "#8c99a8";
    lines.forEach((l, i) => ctx.fillText(l, w / 2, h / 2 - 8 + i * 22));
    ctx.textAlign = "left";
  }
}
