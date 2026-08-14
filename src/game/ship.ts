import {
  SHAN_ANIM_PARTS,
  SHAN_ANIM_SEQUENCE,
  SHAN_BANKS,
  SHAN_STOP_ANIM_DISABLED,
  SHAN_UNFOLD_FIRING,
  type ShipSprite,
} from "../engine/sprites";
import type { StockWeapon, Vec2 } from "../types";

export interface ShipStats {
  turnRate: number; // rad/s
  accel: number; // px/s^2
  maxSpeed: number; // px/s
}

export const SPARROW: ShipStats = { turnRate: 2.7, accel: 190, maxSpeed: 250 };
export const MULE: ShipStats = { turnRate: 1.6, accel: 120, maxSpeed: 180 };

export class Ship {
  pos: Vec2 = { x: 0, y: 0 };
  vel: Vec2 = { x: 0, y: 0 };
  angle = -Math.PI / 2;
  thrusting = false;
  stats: ShipStats;
  sprite: ShipSprite | null = null;
  /** the shïp type this hull is, for stats the engine looks up by id */
  typeId: string | null = null;

  /** which way the ship is turning this frame: -1 left, +1 right, 0 straight */
  turning: -1 | 0 | 1 = 0;
  /**
   * Position within the hull's extra sprite sets, in sets. Sequence hulls run
   * it round in a loop; folding hulls run it up and back down.
   */
  animTime = 0;
  /** whether a folding hull should be extending its parts rather than stowing them */
  unfolding = true;

  shield = 30;
  maxShield = 30;
  armor = 30;
  maxArmor = 30;
  shieldRechPerSec = 1;
  armorRechPerSec = 0;
  /** below this fraction of armor the ship goes dead in space */
  disableAt = 0.33;
  disabled = false;
  /** ion charge: at capacity the ship is nearly immobilised */
  ion = 0;
  maxIon = 100;
  ionDissipatePerSec = 15;
  /**
   * Gate transit bleach: 0 = normal hull, 1 = solid white silhouette.
   * Enter ramps 0→1 before the ship leaves; exit starts at 1 and falls to 0.
   */
  gateFlash = 0;
  /**
   * Weapon-glow overlay alpha (shän WeapImageID). Set to 1.0 each time the
   * ship fires a weapon; decays toward 0 at weapDecay/255 per game frame.
   * Only ships whose sprite carries a non-negative weapImage render this.
   */
  weapGlowAlpha = 0;

  get ionized(): boolean {
    return this.ion >= this.maxIon;
  }

  get radius(): number {
    return this.sprite ? Math.max(this.sprite.w, this.sprite.h) / 2 : 12;
  }

  initDefense(
    shield: number,
    armor: number,
    rechPerSec: number,
    disableAt = 0.33,
  ): void {
    this.shield = this.maxShield = shield;
    this.armor = this.maxArmor = armor;
    this.shieldRechPerSec = rechPerSec;
    this.disableAt = disableAt;
    this.disabled = false;
  }

  /** Ion charge bleeds away over time. */
  dissipateIon(dt: number): void {
    if (this.ion > 0)
      this.ion = Math.max(0, this.ion - this.ionDissipatePerSec * dt);
  }

  rechargeShields(dt: number): void {
    if (!this.disabled && this.shield < this.maxShield) {
      this.shield = Math.min(
        this.maxShield,
        this.shield + this.shieldRechPerSec * dt,
      );
    }
    // armor only regenerates if something aboard repairs it
    if (
      this.armorRechPerSec > 0 &&
      this.armor < this.maxArmor &&
      this.armor > 0
    ) {
      this.armor = Math.min(
        this.maxArmor,
        this.armor + this.armorRechPerSec * dt,
      );
      if (this.disabled && this.armor > this.maxArmor * this.disableAt)
        this.disabled = false;
    }
  }

  /**
   * EV damage rule: shields soak a hit, and armour only suffers once they are
   * gone. Crucially the overflow carries through — a shot that collapses the
   * last sliver of shielding still lands most of its punch on the hull, or a
   * ship with any shield regeneration at all could never be worn down.
   * Weapons with no shield damage (armour-piercing) bypass shields entirely.
   */
  takeHit(shieldDmg: number, armorDmg: number): void {
    let armorShare = armorDmg;
    if (shieldDmg > 0 && this.shield > 0) {
      if (this.shield >= shieldDmg) {
        this.shield -= shieldDmg;
        return; // absorbed outright
      }
      armorShare = armorDmg * ((shieldDmg - this.shield) / shieldDmg);
      this.shield = 0;
    }
    if (armorShare <= 0) return;
    this.armor -= armorShare;
    // crippled rather than killed: EV disables a ship before destroying it
    if (
      !this.disabled &&
      this.armor > 0 &&
      this.armor <= this.maxArmor * this.disableAt
    ) {
      this.disable();
    }
  }

  /**
   * Dead in space: engines, steering and weapons offline. Only residual drift
   * remains (and that bleeds off quickly). Called when armour crosses the
   * disable line, and for govt-flag derelicts at spawn.
   */
  disable(): void {
    this.disabled = true;
    this.thrusting = false;
    this.turning = 0;
    // kill the burn so they don't coast half a system still "flying"
    this.vel.x *= 0.15;
    this.vel.y *= 0.15;
  }

  get destroyed(): boolean {
    return this.armor <= 0;
  }

  constructor(stats: ShipStats) {
    this.stats = stats;
  }

  get speed(): number {
    return Math.hypot(this.vel.x, this.vel.y);
  }

  /**
   * Advance the hull's own animation. shän hulls carry their extra frames as
   * whole extra rotations stacked in one sheet, and Flags says what they are
   * for: a sequence that free-runs, or parts that fold and unfold.
   */
  advanceAnimation(dt: number): void {
    const s = this.sprite;
    if (!s || s.sets <= 1) return;
    // 0x0010: a disabled ship's animation freezes wherever it stopped
    if (this.disabled && s.flags & SHAN_STOP_ANIM_DISABLED) return;
    // AnimDelay is in 30ths of a second per frame; 0 means one frame a tick
    const step = s.animDelay > 0 ? (dt * 30) / s.animDelay : dt * 30;
    if (s.flags & SHAN_ANIM_SEQUENCE) {
      this.animTime = (this.animTime + step) % s.sets;
    } else if (s.flags & (SHAN_ANIM_PARTS | SHAN_UNFOLD_FIRING)) {
      const dir = this.unfolding ? 1 : -1;
      this.animTime = Math.max(
        0,
        Math.min(s.sets - 1, this.animTime + dir * step),
      );
    }
  }

  /**
   * Which sprite set to draw. Banking wins over the animation flags: the Bible
   * makes the first four Flags mutually exclusive, and says the one legal
   * combination (0x0001 with 0x0002) is still a banking ship.
   */
  get spriteSet(): number {
    const s = this.sprite;
    if (!s || s.sets <= 1) return 0;
    // set 1 is bank-left, set 2 bank-right; our angle grows clockwise
    if (s.flags & SHAN_BANKS)
      return this.turning < 0 ? 1 : this.turning > 0 ? 2 : 0;
    return Math.min(s.sets - 1, Math.floor(this.animTime));
  }

  update(dt: number, turn: -1 | 0 | 1, thrust: boolean): void {
    // disabled hulls cannot thrust or steer — only bleed residual drift
    if (this.disabled) {
      this.turning = 0;
      this.thrusting = false;
      this.pos.x += this.vel.x * dt;
      this.pos.y += this.vel.y * dt;
      this.vel.x *= Math.max(0, 1 - 2.2 * dt);
      this.vel.y *= Math.max(0, 1 - 2.2 * dt);
      if (this.speed < 3) {
        this.vel.x = 0;
        this.vel.y = 0;
      }
      return;
    }
    this.angle += turn * this.stats.turnRate * dt;
    this.turning = turn;
    this.thrusting = thrust;
    if (thrust) {
      this.vel.x += Math.cos(this.angle) * this.stats.accel * dt;
      this.vel.y += Math.sin(this.angle) * this.stats.accel * dt;
      const sp = this.speed;
      if (sp > this.stats.maxSpeed) {
        const k = this.stats.maxSpeed / sp;
        this.vel.x *= k;
        this.vel.y *= k;
      }
    }
    this.pos.x += this.vel.x * dt;
    this.pos.y += this.vel.y * dt;
  }

  /** Turn toward a world-space heading; returns true when roughly facing it. */
  steerToward(dt: number, targetAngle: number): boolean {
    if (this.disabled) {
      this.turning = 0;
      return false;
    }
    let diff = targetAngle - this.angle;
    while (diff > Math.PI) diff -= Math.PI * 2;
    while (diff < -Math.PI) diff += Math.PI * 2;
    const step = this.stats.turnRate * dt;
    if (Math.abs(diff) <= step) {
      this.angle = targetAngle;
      this.turning = 0;
      return true;
    }
    this.angle += Math.sign(diff) * step;
    this.turning = diff < 0 ? -1 : 1;
    return Math.abs(diff) < 0.12;
  }
}

/**
 * Where an AI ship is in its errand. The Bible's four düde AI types split
 * cleanly across these: "1 - Wimpy Trader: Visits planets", "2 - Brave Trader:
 * Visits planets", "3 - Warship: seeks out and attacks his enemies, or jumps
 * out if there aren't any", "4 - Interceptor: seeks out his enemies, or parks
 * in orbit around a planet if he can't find any". So only 1 and 2 ever set
 * down; a warship leaves through hyperspace and an interceptor loiters.
 */
export type NpcPhase = "toPlanet" | "orbit" | "leaving" | "leavingBurn";

/**
 * Standing orders for the ships flying with you. "defend" keeps them on your
 * wing and lets them engage whatever threatens you; "attack" sends them at your
 * current target; "hold" pins them to a spot they will defend but not leave.
 */
export type EscortOrder = "defend" | "attack" | "hold";

export class NpcShip extends Ship {
  phase: NpcPhase = "toPlanet";
  target: Vec2 = { x: 0, y: 0 };
  /** the stellar this ship is heading for or circling, and how big it is */
  targetPlanetId: string | null = null;
  targetRadius = 60;
  /**
   * Set the frame this ship touches down; the game loop takes it off the board
   * and hands it back at the same pad once its business is done. It is not
   * `done` — a landing is the middle of an errand, not the end of one.
   */
  landing = false;
  /** where it sits on its orbit, and which way round it goes */
  orbitAngle = 0;
  orbitDir: 1 | -1 = Math.random() < 0.5 ? 1 : -1;
  done = false;
  hostile = false;
  fireCooldown = 0;
  missileCooldown = 0;
  govtId = -1;
  aiType = 1;
  /** düde class this ship was drawn from — its InfoTypes drive hail replies */
  dudeId: number | null = null;
  /**
   * The weapons this particular ship flies with, when they differ from its
   * hull's standard load — a përs captain's own loadout. Null means use the
   * ship type's stock weapons.
   */
  weapons: StockWeapon[] | null = null;
  /** the ship's own name, for named captains */
  shipName: string | null = null;
  /** mïsn id if this is a mission special ship */
  missionMisnId: number | null = null;
  /** a fighter launched from the player's bays */
  ally = false;
  /**
   * Which half of its government's speech bank this pilot uses. Nova splits
   * the even-sized banks into two voices, so this is rolled once and kept —
   * an escort that answers in one voice shouldn't report the kill in another.
   */
  voiceParity: 0 | 1 = Math.random() < 0.5 ? 0 : 1;
  /** spob id this ship is defending, if it launched from a besieged world */
  defenderOf: string | null = null;
  /** this hull's AI can cloak, and whether it currently is */
  canCloak = false;
  cloaked = false;
  /** the bay this fighter came from, and whether it's been called home */
  bayWeapId: string | null = null;
  recalling = false;
  /** a ship the player is contracted to protect */
  escorting = false;
  /** hired to fly with the player, and its standing order */
  hired = false;
  order: EscortOrder = "defend";
  /** where a "hold position" order pinned it */
  holdAt: Vec2 | null = null;
  /** përs id if this is a named captain */
  personId: number | null = null;
  /** already plundered — you only get the cargo once */
  boarded = false;
  /** the ship that most recently dealt damage to this one — focus target */
  lastAttacker: Ship | null = null;
  /**
   * Accumulated stray damage from the player when this ship is not targeted.
   * Compared against a reputation-scaled tolerance to decide whether to turn
   * hostile — friendly governments ignore more friendly fire than hostile ones.
   */
  strayDamage = 0;
  /** credits aboard, for boarding */
  booty = 0;
  bootyFlags = 0;
  /** seconds spent docked on a disabled ship, for NPC boarding */
  boardingTimer = 0;

  constructor(stats: ShipStats = MULE) {
    super(stats);
  }

  updateAi(dt: number): void {
    const dx = this.target.x - this.pos.x;
    const dy = this.target.y - this.pos.y;
    const dist = Math.hypot(dx, dy);

    /*
     * A trader touches down when it is on the pad and slow enough to be there
     * rather than flying past. The old rule fired at a flat 60px and 260 units
     * of speed, which for a big stellar was still well inside the surface and
     * fast enough to be a crash — and it deleted the ship outright.
     */
    if (
      this.phase === "toPlanet" &&
      dist < this.targetRadius + 12 &&
      this.speed < 90
    ) {
      this.landing = true;
      this.vel = { x: 0, y: 0 };
      return;
    }
    if (this.phase === "leavingBurn" && Math.hypot(this.pos.x, this.pos.y) > 3200) {
      this.done = true; // jumped out
      return;
    }

    /*
     * An interceptor with nothing to chase "parks in orbit around a planet",
     * so it circles rather than closing: it stays on the board, in sight, and
     * near enough to the traffic it is there to scan.
     */
    if (this.phase === "orbit") {
      const ring = this.targetRadius + 150;
      /*
       * Chase a mark on the ring a little ahead of where the ship already is,
       * rather than running the orbit angle off a clock. A clock-driven mark
       * runs away from a ship that starts 1900 units out, and it settles into
       * whatever wide circle happens to match the angular rate — measured, one
       * interceptor parked 1095 units up and stayed there. Deriving the mark
       * from the ship's own bearing makes the ring the only stable place to
       * be, and dropping the lead while out of position sends it straight in.
       */
      const bearing = Math.atan2(
        this.pos.y - this.target.y,
        this.pos.x - this.target.x,
      );
      const lead = Math.abs(dist - ring) > 100 ? 0 : this.orbitDir * 0.6;
      this.orbitAngle = bearing + lead;
      const want = {
        x: this.target.x + Math.cos(this.orbitAngle) * ring,
        y: this.target.y + Math.sin(this.orbitAngle) * ring,
      };
      const gap = Math.hypot(want.x - this.pos.x, want.y - this.pos.y);
      const facing = this.steerToward(
        dt,
        Math.atan2(want.y - this.pos.y, want.x - this.pos.x),
      );
      this.update(dt, 0, facing && gap > 40);
      return;
    }

    // Jump exit sequence: brake to near-stop, then streak out at boosted speed.
    if (this.phase === "leaving") {
      this.unfolding = true;
      // Can't jump from inside the gravity well (radius 1000). Fly outward
      // toward the exit target first, matching the player's autopilot rule.
      if (Math.hypot(this.pos.x, this.pos.y) < 1000) {
        const outAng = Math.atan2(
          this.target.y - this.pos.y,
          this.target.x - this.pos.x,
        );
        const facing = this.steerToward(dt, outAng);
        this.update(dt, 0, facing);
        return;
      }
      if (this.speed < 45) {
        // Snap the exit target very far in the current exit direction so the
        // bearing stays constant during the burn — no zig-zagging as the ship
        // passes the original (closer) target point.
        const ang = Math.atan2(
          this.target.y - this.pos.y,
          this.target.x - this.pos.x,
        );
        this.target = {
          x: this.pos.x + Math.cos(ang) * 20000,
          y: this.pos.y + Math.sin(ang) * 20000,
        };
        this.phase = "leavingBurn";
      } else {
        const brakeAngle = Math.atan2(-this.vel.y, -this.vel.x);
        const facing = this.steerToward(dt, brakeAngle);
        this.update(dt, 0, facing);
        return;
      }
    }
    if (this.phase === "leavingBurn") {
      this.unfolding = true;
      const base = this.stats;
      this.stats = {
        ...base,
        maxSpeed: Math.max(base.maxSpeed * 4.5, 950),
        accel: Math.max(base.accel * 3.5, 600),
      };
      const facing = this.steerToward(dt, Math.atan2(dy, dx));
      this.update(dt, 0, facing);
      this.stats = base;
      return;
    }

    /*
     * shän Flags 0x0002 hulls "cycle upon landing, taking off, and
     * entering/exiting hyperspace": stow the parts on final approach and put
     * them back out once clear of the pad.
     */
    const near = this.phase === "toPlanet" && dist < 500;
    this.unfolding = !near;

    // steer toward target, braking as we approach a planet
    const targetAngle = Math.atan2(dy, dx);
    let thrust = false;
    if (near && this.speed > Math.max(40, dist * 0.4)) {
      // flip and burn to slow down
      const brakeAngle = Math.atan2(-this.vel.y, -this.vel.x);
      const facing = this.steerToward(dt, brakeAngle);
      thrust = facing;
    } else {
      const facing = this.steerToward(dt, targetAngle);
      thrust = facing;
    }
    this.update(dt, 0, thrust);
  }
}
