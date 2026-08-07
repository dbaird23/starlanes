/**
 * The simulation: a player, some Wraiths, and the deck they are on.
 *
 * Deliberately knows nothing about `Game`. It takes an `FpsOptions`, runs on
 * `update(dt, cmd)`, and hands the renderer a list of billboards. What it
 * cannot do is touch pilot state — the only way a result leaves here is
 * `opts.onOutcome`, which the arcade entry point does not pass.
 */

import { pathHitsCircle } from "../combat";
import { WEAPONS } from "../../data/universe";
import { BOOM_SPRITES } from "../../data/universe";
import { getSprite, rotationFrame } from "../../engine/sprites";
import { playSnd, playSndAt } from "../../engine/audio";
import { ENEMY_DEFS } from "./level";
import type { RaySprite } from "./raycast";
import type { FpsEnemyDef, FpsLevel, FpsOptions } from "./types";

/** Player collision radius and eye height, in cells. */
const BODY = 0.28;
const WALK = 3.1;
const RUN = 4.9;
/** Wraiths are not solid to each other, but they do keep out of walls. */
const ENEMY_BODY = 0.3;

/**
 * Nova's damage numbers are hull-scale — a Light Blaster does 4 shield and 1
 * armour to something with hundreds of both. On foot the same shot should put
 * a creature down in a couple of hits, so the two channels are summed and
 * scaled once, here, rather than the enemy health numbers being quietly
 * denominated in something else.
 */
const FOOT_DAMAGE = 4;

/**
 * How far a shot reaches, in cells.
 *
 * Deliberately *not* derived from the wëap's `durationSec * speed`: that is 650
 * px for a Light Blaster, a distance calibrated for ships crossing a system,
 * and there is no honest cells-per-pixel to convert it with. What bounds an
 * engagement here is the fog — you cannot see past about ten cells — so that is
 * what bounds the gun. `reloadSec`, `accuracy`, `burstCount` and the damage
 * channels all translate directly and are read from the resource.
 */
const SHOT_RANGE = 12;

/**
 * `playSndAt`'s falloff is calibrated in the space sim's pixels (full volume
 * inside 350, silent past 2600, panned on x/900). Rather than rework the audio
 * layer for a second scale, on-foot distances are converted into that one.
 */
const AUDIO_PX_PER_CELL = 220;

export interface FpsCommand {
  /** -1..1 */
  forward: number;
  strafe: number;
  /** radians to add to the heading this frame */
  turn: number;
  fire: boolean;
  run: boolean;
}

interface Enemy {
  def: FpsEnemyDef;
  x: number;
  y: number;
  health: number;
  facing: number;
  /** which way it slides around you, flipped occasionally so it weaves */
  strafe: number;
  strafeLeft: number;
  awake: boolean;
  attackCd: number;
  flash: number;
  dying: number;
  dead: boolean;
}

interface Puff {
  x: number;
  y: number;
  file: string;
  frameSize: number;
  frames: number;
  t: number;
  life: number;
  scale: number;
  hover: number;
}

export type FpsState = "playing" | "won" | "lost";

export class FpsWorld {
  readonly opts: FpsOptions;
  readonly level: FpsLevel;
  readonly total: number;

  x: number;
  y: number;
  angle: number;
  health: number;
  readonly maxHealth: number;

  ammo: number;
  readonly weaponId: string;
  private reloadLeft = 0;

  state: FpsState = "playing";
  killed = 0;
  elapsed = 0;
  /** decays after a hit, for the red edge on the HUD */
  hurt = 0;
  /** decays after firing, for the muzzle flare */
  muzzle = 0;
  /** set once when the last Wraith drops, so the UI can say "get back" */
  cleared = false;

  private enemies: Enemy[] = [];
  private puffs: Puff[] = [];
  private ended = false;

  /**
   * Cells you have been close enough to make out. The corner map draws only
   * these — a full deck plan would undo the dark, and fog of war is how the
   * galaxy map already works.
   */
  readonly seen: Uint8Array;

  constructor(opts: FpsOptions) {
    this.opts = opts;
    this.level = opts.level;
    this.x = opts.level.start.x;
    this.y = opts.level.start.y;
    this.angle = opts.level.start.angle;
    this.health = opts.health;
    this.maxHealth = opts.health;
    const slot = opts.loadout[0];
    this.weaponId = slot?.weaponId ?? "128";
    this.ammo = slot?.ammo ?? 100;
    this.seen = new Uint8Array(opts.level.w * opts.level.h);
    this.markSeen();

    for (const s of opts.level.spawns) {
      const def = ENEMY_DEFS[s.kind];
      if (!def) continue;
      this.enemies.push({
        def,
        x: s.x,
        y: s.y,
        health: def.health,
        facing: Math.random() * Math.PI * 2,
        strafe: Math.random() < 0.5 ? -1 : 1,
        strafeLeft: 1 + Math.random() * 2,
        awake: false,
        attackCd: 0,
        flash: 0,
        dying: 0,
        dead: false,
      });
    }
    this.total = this.enemies.length;
  }

  get weapon() {
    return WEAPONS[this.weaponId];
  }

  get remaining(): number {
    return this.total - this.killed;
  }

  /** cells to the extract point */
  get exitDist(): number {
    return Math.hypot(this.level.exit.x - this.x, this.level.exit.y - this.y);
  }

  solid(cx: number, cy: number): boolean {
    const gx = Math.floor(cx);
    const gy = Math.floor(cy);
    if (gx < 0 || gy < 0 || gx >= this.level.w || gy >= this.level.h) return true;
    return this.level.cells[gy * this.level.w + gx] > 0;
  }

  /** Move a body with wall sliding: each axis is tested on its own. */
  private slide(
    x: number,
    y: number,
    dx: number,
    dy: number,
    r: number,
  ): { x: number; y: number } {
    let nx = x;
    let ny = y;
    if (!this.solid(x + dx + Math.sign(dx) * r, y)) nx = x + dx;
    if (!this.solid(nx, y + dy + Math.sign(dy) * r)) ny = y + dy;
    return { x: nx, y: ny };
  }

  /** Light up the cells around you, out to a couple of cells. */
  private markSeen(): void {
    const { w, h } = this.level;
    const gx = Math.floor(this.x);
    const gy = Math.floor(this.y);
    for (let dy = -2; dy <= 2; dy++) {
      for (let dx = -2; dx <= 2; dx++) {
        const nx = gx + dx;
        const ny = gy + dy;
        if (nx < 0 || ny < 0 || nx >= w || ny >= h) continue;
        if (dx * dx + dy * dy > 6) continue;
        this.seen[ny * w + nx] = 1;
      }
    }
  }

  /** Nothing solid between two points. Sampled rather than DDA'd — cheap enough. */
  private clearLine(x0: number, y0: number, x1: number, y1: number): boolean {
    const dx = x1 - x0;
    const dy = y1 - y0;
    const len = Math.hypot(dx, dy);
    const steps = Math.ceil(len / 0.15);
    for (let i = 1; i < steps; i++) {
      const t = i / steps;
      if (this.solid(x0 + dx * t, y0 + dy * t)) return false;
    }
    return true;
  }

  update(dt: number, cmd: FpsCommand): void {
    if (this.state !== "playing") return;
    this.elapsed += dt;
    this.hurt = Math.max(0, this.hurt - dt * 2.2);
    this.muzzle = Math.max(0, this.muzzle - dt * 14);
    this.reloadLeft = Math.max(0, this.reloadLeft - dt);

    this.angle += cmd.turn;
    if (this.angle > Math.PI) this.angle -= Math.PI * 2;
    if (this.angle < -Math.PI) this.angle += Math.PI * 2;

    // move
    const speed = (cmd.run ? RUN : WALK) * dt;
    const fx = Math.cos(this.angle);
    const fy = Math.sin(this.angle);
    let mx = fx * cmd.forward - fy * cmd.strafe;
    let my = fy * cmd.forward + fx * cmd.strafe;
    const mag = Math.hypot(mx, my);
    if (mag > 1) {
      mx /= mag;
      my /= mag;
    }
    if (mag > 0.001) {
      const p = this.slide(this.x, this.y, mx * speed, my * speed, BODY);
      this.x = p.x;
      this.y = p.y;
    }

    this.markSeen();
    if (cmd.fire) this.tryFire();
    this.updateEnemies(dt);
    this.updatePuffs(dt);

    if (this.health <= 0) {
      this.finish(false);
      return;
    }
    if (!this.cleared && this.killed >= this.total) {
      this.cleared = true;
      playSnd(371, 0.4); // Klaxxon: the deck is clear, the ship is still dead
    }
    if (this.cleared && this.exitDist < 1.1) {
      playSnd(390, 0.55); // Airlock
      this.finish(true);
    }
  }

  private finish(won: boolean): void {
    if (this.ended) return;
    this.ended = true;
    this.state = won ? "won" : "lost";
    this.opts.onOutcome?.({
      won,
      enemiesKilled: this.killed,
      enemiesTotal: this.total,
      timeSec: this.elapsed,
      healthLeft: Math.max(0, this.health),
    });
  }

  private tryFire(): void {
    if (this.reloadLeft > 0 || this.ammo <= 0) return;
    const w = this.weapon;
    this.reloadLeft = w ? w.reloadSec : 0.33;
    this.ammo--;
    this.muzzle = 1;
    if (w?.sndId) playSnd(w.sndId, 0.4);

    // wëap Accuracy is the inaccuracy cone in degrees, straight off the resource
    const spread = ((w?.accuracy ?? 0) * Math.PI) / 180;
    const a = this.angle + (Math.random() - 0.5) * spread;
    const dx = Math.cos(a);
    const dy = Math.sin(a);

    // how far the shot gets before it buries itself in a bulkhead
    let wall = SHOT_RANGE;
    for (let d = 0.15; d <= SHOT_RANGE; d += 0.15) {
      if (this.solid(this.x + dx * d, this.y + dy * d)) {
        wall = d;
        break;
      }
    }

    const x1 = this.x + dx * wall;
    const y1 = this.y + dy * wall;
    let best: Enemy | null = null;
    let bestD = Infinity;
    for (const e of this.enemies) {
      if (e.dead) continue;
      const r = e.def.scale * 0.42;
      if (!pathHitsCircle(this.x, this.y, x1, y1, e.x, e.y, r)) continue;
      const d = Math.hypot(e.x - this.x, e.y - this.y);
      if (d < bestD) {
        bestD = d;
        best = e;
      }
    }

    const dmg = w ? (w.armorDmg + w.shieldDmg) * FOOT_DAMAGE : 20;
    if (best) {
      best.health -= dmg;
      best.flash = 0.5;
      best.awake = true;
      if (best.health <= 0) this.kill(best);
    } else {
      // sparks off the bulkhead, so a miss still reads
      this.addPuff(this.x + dx * (wall - 0.1), this.y + dy * (wall - 0.1), 400, 0.35, 0.5);
    }
  }

  private kill(e: Enemy): void {
    e.dead = true;
    e.dying = 0.45;
    this.killed++;
    this.addPuff(e.x, e.y, e.def.boomId, e.def.scale * 1.2, e.def.hover);
    playSndAt(
      e.def.deathSnd,
      0.5,
      (e.x - this.x) * AUDIO_PX_PER_CELL,
      (e.y - this.y) * AUDIO_PX_PER_CELL,
    );
  }

  private updateEnemies(dt: number): void {
    for (const e of this.enemies) {
      e.flash = Math.max(0, e.flash - dt * 2.5);
      if (e.dead) {
        e.dying = Math.max(0, e.dying - dt);
        continue;
      }

      const dx = this.x - e.x;
      const dy = this.y - e.y;
      const dist = Math.hypot(dx, dy);
      if (!e.awake) {
        if (dist < e.def.senseRange && this.clearLine(e.x, e.y, this.x, this.y)) {
          e.awake = true;
        } else {
          continue; // asleep in the dark
        }
      }

      e.strafeLeft -= dt;
      if (e.strafeLeft <= 0) {
        e.strafe = -e.strafe;
        e.strafeLeft = 1.2 + Math.random() * 2.2;
      }

      /*
       * They weave rather than bee-line. That is better to fight, and it is
       * also what makes the 36 pre-rendered rotations earn their place: a
       * creature that always pointed straight at you would only ever show one
       * frame of its sheet.
       */
      const toward = Math.atan2(dy, dx);
      const bias = dist < e.def.reach * 2 ? 1.1 : 0.55;
      const heading = toward + e.strafe * bias;
      const step = e.def.speed * dt;
      if (dist > e.def.reach * 0.8) {
        const p = this.slide(
          e.x,
          e.y,
          Math.cos(heading) * step,
          Math.sin(heading) * step,
          ENEMY_BODY,
        );
        if (p.x !== e.x || p.y !== e.y) {
          e.facing = Math.atan2(p.y - e.y, p.x - e.x);
        }
        e.x = p.x;
        e.y = p.y;
      } else {
        e.facing = toward;
      }

      e.attackCd -= dt;
      if (dist < e.def.reach && e.attackCd <= 0) {
        e.attackCd = e.def.attackGap;
        this.health -= e.def.damage;
        this.hurt = 1;
        playSnd(154, 0.35);
      }
    }
    this.enemies = this.enemies.filter((e) => !e.dead || e.dying > 0);
  }

  private addPuff(
    x: number,
    y: number,
    boomId: number,
    scale: number,
    hover: number,
  ): void {
    const sheet = BOOM_SPRITES[String(boomId)];
    if (!sheet) return;
    this.puffs.push({
      x,
      y,
      file: sheet.file,
      frameSize: sheet.h,
      frames: sheet.frames,
      t: 0,
      life: Math.max(0.25, sheet.frames / 30),
      scale,
      hover,
    });
  }

  private updatePuffs(dt: number): void {
    for (const p of this.puffs) p.t += dt;
    this.puffs = this.puffs.filter((p) => p.t < p.life);
  }

  /** Everything the raycaster should draw as a billboard, this frame. */
  sprites(): RaySprite[] {
    const out: RaySprite[] = [];
    for (const e of this.enemies) {
      const img = getSprite(e.def.sheet);
      if (!img) continue;
      /*
       * Which side of the creature we are looking at. Nova's frame 0 faces up
       * (-y) and advances clockwise, so the frame that reads as "going away
       * from the camera" is the one at -90° relative to the camera's bearing on
       * it — hence the extra quarter turn.
       */
      const camBearing = Math.atan2(e.y - this.y, e.x - this.x);
      const frame = rotationFrame(e.def.frames, e.facing - camBearing - Math.PI / 2);
      out.push({
        x: e.x,
        y: e.y,
        img,
        frameSize: e.def.frameSize,
        frame,
        scale: e.def.scale,
        hover: e.def.hover,
        alpha: e.dead ? Math.max(0, e.dying / 0.45) : 1,
        flash: e.flash,
      });
    }
    for (const p of this.puffs) {
      const img = getSprite(p.file);
      if (!img) continue;
      const frame = Math.min(p.frames - 1, Math.floor((p.t / p.life) * p.frames));
      out.push({
        x: p.x,
        y: p.y,
        img,
        frameSize: p.frameSize,
        frame,
        scale: p.scale,
        hover: p.hover,
        // fade the tail of the animation out rather than cutting it
        alpha: Math.min(1, 2.6 * (1 - p.t / p.life)),
        flash: 0,
        additive: true,
      });
    }
    return out;
  }

  /** Live enemies, for the scanner blips on the HUD. */
  contacts(): { x: number; y: number; awake: boolean }[] {
    return this.enemies
      .filter((e) => !e.dead)
      .map((e) => ({ x: e.x, y: e.y, awake: e.awake }));
  }
}
