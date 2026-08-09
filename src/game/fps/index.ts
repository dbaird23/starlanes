/**
 * The on-foot session: pointer lock, the low-resolution buffer, the HUD, and
 * the two end cards. `Game` owns one of these while `mode === "fps"`.
 *
 * Everything 3D is drawn into a fixed-width offscreen buffer and blitted up
 * with smoothing off, so the cost does not move with the window or the device
 * pixel ratio and the chunky upscale is a choice rather than an accident. The
 * readouts are drawn afterwards at full resolution, where text belongs.
 */

import type { Input } from "../../engine/input";
import { playAmbient, stopAmbient } from "../../engine/audio";
import { renderScene, type RaySprite } from "./raycast";
import { FpsWorld, type FpsCommand } from "./sim";
import {
  deckPixels,
  preloadMaterials,
  wallEmit,
  wallGain,
  wallGlow,
  wallInset,
  wallRepeat,
  wallTexture,
} from "./textures";
import type { FpsOptions } from "./types";

/** Columns cast per frame. Fixed, so a big window costs no more than a small one. */
const RENDER_W = 480;
const MOUSE_SENS = 0.0022;
const KEY_TURN = 2.4;

const MONO = '"JetBrains Mono", ui-monospace, monospace';
const DISPLAY = '"Chakra Petch", "Verdana", sans-serif';

export class FpsSession {
  readonly world: FpsWorld;
  private readonly canvas: HTMLCanvasElement;

  private buf = document.createElement("canvas");
  private bufCtx: CanvasRenderingContext2D | null;
  private depth = new Float32Array(RENDER_W);

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
    this.bufCtx = this.buf.getContext("2d");
    preloadMaterials();

    document.addEventListener("pointerlockchange", this.onLockChange);
    window.addEventListener("mousemove", this.onMouseMove);
    window.addEventListener("mousedown", this.onMouseDown);
    window.addEventListener("mouseup", this.onMouseUp);

    if (opts.ambientSnd) playAmbient(opts.ambientSnd, true, 0.3);
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
    const bctx = this.bufCtx;
    if (!bctx) return;
    const renderH = Math.max(120, Math.round((RENDER_W * h) / Math.max(1, w)));
    if (this.buf.width !== RENDER_W || this.buf.height !== renderH) {
      this.buf.width = RENDER_W;
      this.buf.height = renderH;
    }

    const sprites: RaySprite[] = this.world.sprites();
    renderScene(
      bctx,
      RENDER_W,
      renderH,
      {
        level: this.world.level,
        cam: { x: this.world.x, y: this.world.y, angle: this.world.angle },
        sprites,
        mat: {
          texture: this.noTextures ? (): null => null : wallTexture,
          gain: wallGain,
          repeat: wallRepeat,
          glow: wallGlow,
          emit: wallEmit,
          inset: wallInset,
          deck: this.noTextures ? null : deckPixels(),
        },
      },
      this.depth,
    );
    this.drawWeapon(bctx, RENDER_W, renderH);

    ctx.imageSmoothingEnabled = false;
    ctx.drawImage(this.buf, 0, 0, w, h);
    ctx.imageSmoothingEnabled = true;

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
    const bx = w * 0.74 + Math.sin(this.bob) * 4;
    const by = h + Math.abs(Math.cos(this.bob)) * 3;
    const kick = this.world.muzzle * 7;

    ctx.save();
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
