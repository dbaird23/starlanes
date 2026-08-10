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

/**
 * The viewmodel is still drawn in canvas 2D, and it was authored against the
 * raycaster's 480-wide buffer. Keeping that as its design width and scaling to
 * the window means the gun is the same size on every display instead of
 * shrinking to a splinter at 1280.
 */
const GUN_W = 480;
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
    if (this.locked && !this.paused) this.mouseDx += e.movementX;
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
      return;
    }

    const down = (c: string): number => (input.isDown(c) ? 1 : 0);
    const cmd: FpsCommand = {
      forward: down("KeyW") - down("KeyS"),
      strafe: down("KeyD") - down("KeyA"),
      turn:
        this.mouseDx * MOUSE_SENS +
        (down("ArrowRight") - down("ArrowLeft")) * KEY_TURN * dt,
      fire: this.firing || input.isDown("Space"),
      run: input.shiftDown,
    };
    this.mouseDx = 0;

    if (cmd.forward || cmd.strafe) this.bob += dt * (cmd.run ? 11 : 7);
    this.world.update(dt, cmd);
  }

  render(ctx: CanvasRenderingContext2D, w: number, h: number): void {
    const gl = this.gl;
    if (gl) {
      const sprites: FpsSprite[] = this.world.sprites();
      const t0 = performance.now();
      const frame = gl.render(
        { x: this.world.x, y: this.world.y, angle: this.world.angle },
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

    this.drawWeapon(ctx, w, h);
    this.drawHud(ctx, w, h);
  }

  /**
   * There is no first-person viewmodel anywhere in Nova's art — the outfit
   * pictures are 3/4 product shots on black — so the gun is a few polygons.
   * Drawn into the low-res buffer on purpose, so it wears the same pixels as
   * the world instead of floating above it.
   */
  private drawWeapon(ctx: CanvasRenderingContext2D, w: number, h: number): void {
    if (this.world.state !== "playing") return;
    const k = w / GUN_W;
    const bx = GUN_W * 0.74 + Math.sin(this.bob) * 4;
    const by = h / k + Math.abs(Math.cos(this.bob)) * 3;
    const kick = this.world.muzzle * 7;

    ctx.save();
    ctx.scale(k, k);
    ctx.translate(bx, by + kick);
    ctx.rotate(-0.12);
    // stock and receiver, canted in from the right the way a held rifle sits
    ctx.fillStyle = "#14181d";
    ctx.beginPath();
    ctx.moveTo(-4, 0);
    ctx.lineTo(2, -26);
    ctx.lineTo(30, -22);
    ctx.lineTo(34, 0);
    ctx.closePath();
    ctx.fill();
    ctx.fillStyle = "#1e242b";
    ctx.fillRect(-2, -34, 22, 12);
    // barrel, with the housing Nova's hardware is all wrapped in
    ctx.fillStyle = "#262c34";
    ctx.beginPath();
    ctx.moveTo(3, -32);
    ctx.lineTo(5, -62);
    ctx.lineTo(15, -62);
    ctx.lineTo(17, -32);
    ctx.closePath();
    ctx.fill();
    ctx.strokeStyle = "#0a0c0f";
    ctx.lineWidth = 1;
    ctx.stroke();
    ctx.fillStyle = "#39424c";
    ctx.fillRect(4, -50, 12, 2);
    ctx.fillRect(4, -42, 12, 2);

    if (this.world.muzzle > 0.02) {
      const m = this.world.muzzle;
      const g = ctx.createRadialGradient(10, -64, 1, 10, -64, 30 * m);
      g.addColorStop(0, `rgba(255,244,220,${(0.95 * m).toFixed(2)})`);
      g.addColorStop(0.35, `rgba(255,178,96,${(0.6 * m).toFixed(2)})`);
      g.addColorStop(1, "rgba(255,120,40,0)");
      ctx.globalCompositeOperation = "lighter";
      ctx.fillStyle = g;
      ctx.fillRect(-24, -98, 68, 68);
      ctx.globalCompositeOperation = "source-over";
    }
    ctx.restore();
  }

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
      this.drawReadouts(ctx, w, h);
      this.drawMap(ctx, w, h);
    }

    if (this.paused && world.state === "playing") {
      this.card(ctx, w, h, world.opts.title.toUpperCase(), [
        "Click to take the deck.",
        "",
        "W A S D move · mouse look · click or Space fire",
        "Shift run · Esc pause · Q leave",
      ]);
    } else if (world.state === "won") {
      const mins = Math.floor(world.elapsed / 60);
      const secs = Math.floor(world.elapsed % 60);
      this.card(ctx, w, h, "DECK CLEAR", [
        `${world.total} contacts down. You made the airlock with ${Math.max(0, Math.round(world.health))} left.`,
        `Time ${mins}:${String(secs).padStart(2, "0")}`,
        "",
        "Enter — back to the bar",
      ]);
    } else if (world.state === "lost") {
      this.card(ctx, w, h, "YOU DIDN'T MAKE IT", [
        `${world.killed} of ${world.total} contacts down.`,
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

  private drawReadouts(ctx: CanvasRenderingContext2D, w: number, h: number): void {
    const world = this.world;
    ctx.textBaseline = "alphabetic";

    // health, bottom left
    const bx = 26;
    const by = h - 34;
    ctx.font = `500 11px ${MONO}`;
    ctx.fillStyle = "#7d8a99";
    ctx.textAlign = "left";
    ctx.fillText("HULL", bx, by - 10);
    ctx.fillStyle = "rgba(0,0,0,0.55)";
    ctx.fillRect(bx, by, 190, 12);
    const frac = Math.max(0, world.health / world.maxHealth);
    ctx.fillStyle = frac > 0.5 ? "#4fa3d1" : frac > 0.25 ? "#d1a24f" : "#d14f4f";
    ctx.fillRect(bx + 1, by + 1, Math.round(188 * frac), 10);
    ctx.strokeStyle = "rgba(140,160,180,0.35)";
    ctx.lineWidth = 1;
    ctx.strokeRect(bx + 0.5, by + 0.5, 189, 11);

    // ammo, bottom right
    ctx.textAlign = "right";
    ctx.fillStyle = "#7d8a99";
    ctx.fillText("ROUNDS", w - 26, by - 10);
    ctx.font = `700 26px ${MONO}`;
    ctx.fillStyle = world.ammo > 0 ? "#c8d4e0" : "#d14f4f";
    ctx.fillText(String(world.ammo), w - 26, by + 12);

    // contacts, top left
    ctx.textAlign = "left";
    ctx.font = `600 13px ${DISPLAY}`;
    ctx.fillStyle = "#8c99a8";
    ctx.fillText(world.opts.title, 26, 34);
    ctx.font = `500 12px ${MONO}`;
    ctx.fillStyle = world.remaining ? "#c8d4e0" : "#7fd18f";
    ctx.fillText(
      world.remaining
        ? `CONTACTS  ${world.remaining} / ${world.total}`
        : "DECK CLEAR",
      26,
      54,
    );

    if (world.cleared) {
      ctx.textAlign = "center";
      ctx.font = `600 15px ${DISPLAY}`;
      ctx.fillStyle = "#7fd18f";
      ctx.fillText(
        `Return to the airlock — ${world.exitDist.toFixed(0)}m`,
        w / 2,
        h - 74,
      );
    }
  }

  /** A corner deck plan, showing only what you have walked past. */
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
