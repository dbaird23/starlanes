/**
 * The simulation: a player, some Wraiths, and the deck they are on.
 *
 * Deliberately knows nothing about `Game`. It takes an `FpsOptions`, runs on
 * `update(dt, cmd)`, and hands the renderer a list of billboards. What it
 * cannot do is touch pilot state — the only way a result leaves here is
 * `opts.onOutcome`, which the arcade entry point does not pass.
 */

import { WEAPONS } from "../../data/universe";
import { getSprite, rotationFrame } from "../../engine/sprites";
import { playSnd } from "../../engine/audio";
import { ENEMY_DEFS } from "./level";
import type { FpsEnemyDef, FpsLevel, FpsOptions, FpsSprite } from "./types";
import {
  type SalvageRun,
  type Station,
  newRun,
  placeStations,
  rollLoot,
  runOutcome,
  stepRun,
} from "./salvage";

/** Player collision radius and eye height, in cells. */
const BODY = 0.28;
const WALK = 3.1;
const RUN = 4.9;




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
  /** set once the last breaker is in, so the UI can say "get back to the lock" */
  cleared = false;

  /**
   * The salvage run — the air, the stations and the haul.
   *
   * It is a field on the world rather than a replacement for it because the
   * world already owns everything a run needs to ask about: where you are
   * standing, which way you are looking, and whether the button is down.
   */
  readonly run: SalvageRun;

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

    this.run = newRun(opts.level, placeStations(opts.level));

    /*
     * **Nothing is spawned.** The slice shipped as a shooter and the level
     * format still carries `spawns`, but a derelict is not a monster closet —
     * the tension is the clock, and something to shoot would give you a second
     * thing to spend attention on and a reason to want a weapon. The loop is
     * kept compiling because a boarding action fought by marines is a plausible
     * later mode, and deleting it would mean rebuilding it from nothing.
     */
    for (const s of [] as typeof opts.level.spawns) {
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

    /*
     * The run. `cmd.fire` is the same button it always was — there is nothing
     * to shoot, so the finger that used to pull a trigger holds a panel open.
     */
    const done = stepRun(this.run, dt, this.x, this.y, this.angle, cmd.fire);
    if (done) this.stationDone(done);

    const outcome = runOutcome(this.run, this.exitDist < 1.1);
    if (outcome === "lost") {
      this.finish(false);
      return;
    }
    if (this.run.powered && !this.cleared) {
      this.cleared = true;
      playSnd(371, 0.4); // Klaxxon: she has power, and you are still on her
    }
    if (outcome === "won") {
      playSnd(390, 0.55); // Airlock
      this.finish(true);
    }
  }

  /**
   * What a finished station does.
   *
   * A breaker's payoff is the light: `SalvageRun.power` is read by the renderer
   * every frame, so the compartment comes on around you. A locker's payoff is
   * rolled here and only *recorded* — nothing reaches the pilot's hold unless
   * `onOutcome` is wired, which the arcade entry point does not do.
   */
  private stationDone(st: Station): void {
    if (st.kind === "breaker") {
      playSnd(305, 0.5);
      // the sector names carry their own state ("forward (dead)"), which stops
      // being true the moment you throw the breaker
      this.run.note = `Power restored — ${st.label.replace(/\s*\(.*\)\s*$/, "")}`;
    } else {
      playSnd(390, 0.35);
      st.loot = rollLoot();
      this.run.haul.push(st.loot);
      this.run.note = st.loot.name;
    }
    this.run.noteLeft = 3;
  }

  private finish(won: boolean): void {
    if (this.ended) return;
    this.ended = true;
    this.state = won ? "won" : "lost";
    this.opts.onOutcome?.({
      won,
      enemiesKilled: this.run.breakers,
      enemiesTotal: this.run.breakersTotal,
      timeSec: this.elapsed,
      healthLeft: Math.max(0, this.run.air),
      haul: won ? this.run.haul.slice() : [],
    });
  }

  /*
   * `tryFire` lived here and is gone. A derelict run has nothing to shoot, and
   * leaving a weapon in the player's hands is the one change that would put the
   * clock second: with a trigger there is always something to do with the time.
   * The enemy machinery below stays — a boarding action fought by marines is a
   * plausible later mode and rebuilding it from nothing would be the expensive
   * way to find that out — but nothing spawns and nothing is fired.
   */
  sprites(): FpsSprite[] {
    const out: FpsSprite[] = [];
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
