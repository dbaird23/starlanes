import { OUTFITS, SHIPS, WEAPONS } from "../data/universe";
import { weaponExitPoint } from "../engine/sprites";
import type { PersonType, ShipType, StockWeapon, WeaponType } from "../types";
import type { Ship } from "./ship";

export interface Projectile {
  x: number;
  y: number;
  vx: number;
  vy: number;
  angle: number;
  weap: WeaponType;
  ttl: number;
  fromPlayer: boolean;
  /** the firing ship — never hit by its own shots */
  owner: Ship;
  /** homing target */
  target: Ship | null;
  /** seconds left before the proximity fuse arms (ProxSafety) */
  armTime: number;
  /** how many times this shot has already submunitioned, for SubLimit */
  generation: number;
  /** the ship this shot struck directly, so a blast does not double-hit it */
  directHit?: Ship | null;
  /** point-defence hits absorbed so far, against the weapon's Durability */
  pdHits?: number;
}

/**
 * A beam that is currently firing. Damage lands once, when it goes off, but it
 * stays on screen for the weapon's Duration — up to 0.83s for the adult Wraith
 * Graviton Beam — and the ship holding it keeps flying. The endpoints are
 * therefore re-derived from the owner every frame rather than frozen at the
 * moment of firing: a Thunderhead Lance is 100px long and lasts a third of a
 * second, in which a ship at full throttle covers 79px, so a frozen beam tore
 * loose from the muzzle and hung in space behind the shooter.
 */
export interface BeamFx {
  x1: number;
  y1: number;
  x2: number;
  y2: number;
  weap: WeaponType;
  ttl: number;
  /** the ship it is coming out of, so the beam travels with her */
  owner: Ship | null;
  /** the shän mount it leaves from (wëap ExitType) */
  exitType: number;
  /** aim relative to the owner's own facing, for a fixed emitter */
  relAngle: number;
  /** a turret beam stays on this ship instead of on a fixed bearing */
  target: Ship | null;
  /** how far it reached when it fired, if nothing is being tracked */
  reach: number;
}

export interface ExplosionFx {
  x: number;
  y: number;
  /** spïn sheet key (400 + the bööm's GraphicIndex) */
  boomId: string;
  t: number;
  scale: number;
  /** sprite frames per second, from the bööm's FrameAdvance */
  fps: number;
}

export interface WeaponSlot {
  weap: WeaponType;
  count: number;
  cooldown: number;
  /** shots left in the current burst cycle, for weapons with a BurstCount */
  burstLeft: number;
}

/**
 * The reload to impose after a shot. A weapon with a BurstCount fires that
 * many rounds at its normal Reload and then pays the longer BurstReload —
 * which is what makes a chaingun a chaingun rather than a fast cannon. The
 * Bible multiplies the burst budget by how many of the weapon the ship
 * carries, for weapons that don't fire simultaneously.
 */
export function applyReload(slot: WeaponSlot): void {
  if (slot.weap.burstCount <= 0) {
    slot.cooldown = slot.weap.reloadSec;
    return;
  }
  // Flags 0x0040: all barrels fire together, so the budget is not multiplied.
  const budget =
    slot.weap.burstCount * (slot.weap.simultaneous ? 1 : Math.max(1, slot.count));
  if (slot.burstLeft <= 0) slot.burstLeft = budget;
  slot.burstLeft--;
  slot.cooldown =
    slot.burstLeft <= 0
      ? Math.max(slot.weap.burstReloadSec, slot.weap.reloadSec)
      : slot.weap.reloadSec;
}

/**
 * Chance (0-1) that a guided weapon loses its lock against these jammers.
 * JamVuln is the weapon's vulnerability to each of the four jamming types.
 */
export function jamChance(weap: WeaponType, jamming: number[]): number {
  let best = 0;
  for (let i = 0; i < 4; i++) {
    const vuln = (weap.jamVuln[i] ?? 0) / 100;
    const strength = Math.min(100, jamming[i] ?? 0) / 100;
    best = Math.max(best, vuln * strength);
  }
  return Math.min(0.95, best);
}

/** Cloak flag bits from ModType 17 (Nova Bible). */
export const CLOAK_VISIBLE_ON_RADAR = 0x0002;
export const CLOAK_DROPS_SHIELDS = 0x0004;
export const CLOAK_BREAKS_ON_DAMAGE = 0x0008;

/** Fuel drain per second while cloaked, from the 0x0010-0x0080 bits. */
export function cloakFuelDrain(flags: number): number {
  if (flags & 0x0080) return 8;
  if (flags & 0x0040) return 4;
  if (flags & 0x0020) return 2;
  if (flags & 0x0010) return 1;
  return 0;
}

/** Shield drain per second while cloaked, from the 0x0100-0x0800 bits. */
export function cloakShieldDrain(flags: number): number {
  if (flags & 0x0800) return 8;
  if (flags & 0x0400) return 4;
  if (flags & 0x0200) return 2;
  if (flags & 0x0100) return 1;
  return 0;
}

/** Beam weapons: hitscan, no projectile. Guidance 0 = beam, 3 = turreted beam. */
export function isBeam(weap: WeaponType): boolean {
  return weap.guidance === 0 || weap.guidance === 3;
}

/** Point defense fires itself at incoming missiles — never on a trigger. */
export function isPointDefense(weap: WeaponType): boolean {
  return weap.guidance === 9 || weap.guidance === 10;
}

/** Fighter bays launch a carried ship class (AmmoType is the shïp id). */
export function isFighterBay(weap: WeaponType): boolean {
  return weap.guidance === 99;
}

/** Turret-style weapons swivel to the selected target. */
export function isTurret(weap: WeaponType): boolean {
  return weap.guidance === 3 || weap.guidance === 4 || weap.guidance === 7 || weap.guidance === 8;
}

export function isPrimary(weap: WeaponType): boolean {
  // unguided, beams, rockets, quadrant weapons and turrets share the trigger
  return (
    weap.guidance === -1 ||
    weap.guidance === 4 ||
    weap.guidance === 6 ||
    weap.guidance === 7 ||
    weap.guidance === 8 ||
    isBeam(weap)
  );
}

export function isSecondary(weap: WeaponType): boolean {
  return weap.guidance === 1 || weap.guidance === 5;
}

/**
 * Hitscan along a beam: returns the first ship whose circle the ray crosses.
 * `ships` should exclude the shooter and anything friendly to it.
 */
export function beamHit(
  ox: number,
  oy: number,
  angle: number,
  length: number,
  ships: Ship[],
): { ship: Ship; dist: number } | null {
  const dx = Math.cos(angle);
  const dy = Math.sin(angle);
  let best: { ship: Ship; dist: number } | null = null;
  for (const s of ships) {
    const ex = s.pos.x - ox;
    const ey = s.pos.y - oy;
    const along = ex * dx + ey * dy; // projection onto the beam
    if (along < 0 || along > length) continue;
    const perp = Math.abs(ex * dy - ey * dx); // distance from the beam line
    if (perp > s.radius) continue;
    if (!best || along < best.dist) best = { ship: s, dist: along };
  }
  return best;
}

/** Build weapon slots from a ship class's stock loadout plus owned outfits. */
export function buildLoadout(
  shipId: string,
  outfits: Record<string, number>,
): WeaponSlot[] {
  const byWeap = new Map<string, WeaponSlot>();
  const add = (weapId: string, count: number) => {
    const weap = WEAPONS[weapId];
    if (!weap || count <= 0) return;
    const existing = byWeap.get(weapId);
    if (existing) existing.count += count;
    else byWeap.set(weapId, { weap, count, cooldown: 0, burstLeft: 0 });
  };

  const type = SHIPS[shipId];
  if (type) {
    // A hull's stock weapons are handed to the player as real outfits the
    // moment they take the ship (see hullOutfits), so they arrive through the
    // outfit loop below and are sellable like anything else. Only a stock
    // weapon with no oütf to represent it — none in stock Nova, but a plug-in
    // could — still has to be bolted on here, or the ship would fly unarmed.
    for (const sw of type.stockWeapons) {
      if (!outfitGrantingWeapon(sw.id)) add(String(sw.id), sw.count);
    }
  }
  for (const [outfId, owned] of Object.entries(outfits)) {
    const outf = OUTFITS[outfId];
    if (!outf || owned <= 0) continue;
    for (const mod of outf.mods) {
      if (mod.type === 1) add(String(mod.val), owned);
    }
  }
  return [...byWeap.values()];
}

/**
 * Which mount a weapon occupies. Nova splits its guidance modes between the
 * hull's two mount pools: turrets and beam/quadrant turrets draw on MaxTurrets,
 * fixed guns and beams on MaxGuns. Guided missiles, rockets and fighter bays
 * take neither — they are limited by ammo and free mass instead.
 */
export function mountKind(guidance: number): "gun" | "turret" | null {
  if (guidance === 3 || guidance === 4 || guidance === 9 || guidance === 10) return "turret";
  if (guidance === -1 || guidance === 0 || guidance === 7 || guidance === 8) return "gun";
  return null;
}

/**
 * Which oütf grants a given wëap, via ModType 1. Every one of the stock
 * weapons across Nova's 274 armed hulls has one, which is what lets a hull's
 * armament be expressed as ordinary owned outfits.
 */
let weaponOutfitIndex: Map<number, string> | null = null;
function outfitGrantingWeapon(weapId: number): string | null {
  // Only cache once the universe is actually loaded, so a call that lands
  // before galaxy.json arrives doesn't freeze an empty index in place.
  const outfitIds = Object.keys(OUTFITS);
  if (!outfitIds.length) return null;
  if (!weaponOutfitIndex) {
    const index = new Map<number, string>();
    for (const outfId of outfitIds) {
      for (const mod of OUTFITS[outfId].mods) {
        if (mod.type === 1 && !index.has(mod.val)) index.set(mod.val, outfId);
      }
    }
    weaponOutfitIndex = index;
  }
  return weaponOutfitIndex.get(weapId) ?? null;
}

/**
 * The outfits a hull arrives with: its stock weapons (wëap WeapType/WeapCount,
 * mapped back to the oütf that grants each) plus its DefaultItems. Nova hands
 * these to the player on purchase or capture, which is what makes the Shuttle's
 * Light Blaster something you can walk into an outfitter and sell.
 */
export function hullOutfits(shipId: string): Record<string, number> {
  const out: Record<string, number> = {};
  const type = SHIPS[shipId];
  if (!type) return out;
  for (const sw of type.stockWeapons) {
    const outfId = outfitGrantingWeapon(sw.id);
    if (outfId) out[outfId] = (out[outfId] ?? 0) + sw.count;
  }
  for (const item of type.defaultItems) {
    const outfId = String(item.id);
    if (OUTFITS[outfId]) out[outfId] = (out[outfId] ?? 0) + item.count;
  }
  return out;
}

/**
 * Mass of everything a hull comes with. The Bible is explicit that FreeMass
 * "is in addition to the space taken up by the ship's stock weapons", so once
 * those weapons are counted as owned outfits their mass has to be added back
 * or every ship would show less room than it really has — and selling a stock
 * weapon would hand back space the player was never charged for.
 */
export function hullOutfitMass(shipId: string): number {
  let mass = 0;
  for (const [outfId, n] of Object.entries(hullOutfits(shipId))) {
    mass += (OUTFITS[outfId]?.mass ?? 0) * n;
  }
  return mass;
}

/** Add a hull's own outfits into an owned-outfit map, in place. */
export function grantHullOutfits(shipId: string, outfits: Record<string, number>): void {
  for (const [outfId, n] of Object.entries(hullOutfits(shipId))) {
    outfits[outfId] = (outfits[outfId] ?? 0) + n;
  }
}

/** Guns and turrets currently fitted, counting the hull's stock weapons too. */
export function countMounts(
  shipId: string,
  outfits: Record<string, number>,
): { guns: number; turrets: number } {
  let guns = 0;
  let turrets = 0;
  for (const slot of buildLoadout(shipId, outfits)) {
    const kind = mountKind(slot.weap.guidance);
    if (kind === "gun") guns += slot.count;
    else if (kind === "turret") turrets += slot.count;
  }
  return { guns, turrets };
}

/**
 * The hull's mount limits plus any ModType 45/46 reinforcement outfits.
 * A few of Ambrosia's own hulls ship with more weapons than their limits allow
 * (the Manticore carries eight turrets against a MaxTurrets of four), so these
 * are only ever compared against a purchase — you keep what a hull came with.
 */
export function mountLimits(
  shipId: string,
  outfits: Record<string, number>,
): { guns: number; turrets: number } {
  const type = SHIPS[shipId];
  const bonus = outfitBonuses(outfits);
  return {
    guns: (type?.maxGuns ?? 0) + bonus.maxGuns,
    turrets: (type?.maxTurrets ?? 0) + bonus.maxTurrets,
  };
}

/** Starting ammo for a ship's stock secondary weapons. */
/**
 * Clamp a weapon's ammo to what the ship can actually hold. MaxAmmo is stated
 * per instance of the weapon, so two of the same bay carry twice as many; 0
 * means the weapon sets no limit of its own and the outfit's Max governs.
 */
export function ammoCapped(weapId: string, rounds: number, instances = 1): number {
  const weap = WEAPONS[weapId];
  if (!weap || weap.maxAmmo <= 0) return rounds;
  return Math.min(rounds, weap.maxAmmo * Math.max(1, instances));
}

/**
 * The government a hull is of by nature, for AI combat purposes. A düde that
 * names its own government still wins — the düde is the specific role a ship
 * was spawned into — but where it names none, the hull itself decides, which
 * is how a stray Federation Viper reads as Federation rather than as nobody.
 * Only the combat half of InherentGovt counts here.
 */
export function inherentCombatGovt(shipId: string | null): number {
  const g = shipId ? SHIPS[shipId]?.inherentGovt : null;
  return g && g.combat ? g.govt : -1;
}

/**
 * What a named captain actually flies with. The Bible has a përs WeapCount
 * apply "in addition to the standard weapons already included with the ship",
 * and a negative count remove that many of a standard weapon — which is how
 * a captain can fly a stock hull stripped of its cannon and carrying something
 * better instead.
 */
export function personLoadout(person: PersonType, type: ShipType): StockWeapon[] {
  if (!person.loadout.length) return type.stockWeapons;
  const merged = type.stockWeapons.map((w) => ({ ...w }));
  for (const extra of person.loadout) {
    const hit = merged.find((w) => w.id === extra.id);
    if (hit) {
      hit.count += extra.count;
      hit.ammo = Math.max(hit.ammo, extra.ammo);
    } else if (extra.count > 0) {
      merged.push({ ...extra });
    }
  }
  return merged.filter((w) => w.count > 0);
}

export function stockAmmo(shipId: string): Record<string, number> {
  const ammo: Record<string, number> = {};
  const type = SHIPS[shipId];
  if (type) {
    for (const sw of type.stockWeapons) {
      if (sw.ammo > 0) ammo[String(sw.id)] = sw.ammo;
    }
  }
  return ammo;
}

export interface OutfitBonuses {
  cargo: number;
  shield: number;
  armor: number;
  mass: number;
  /** raw Nova stat units, added to the hull's own before conversion */
  accel: number;
  speed: number;
  turn: number;
  /** shield/armor points per second */
  shieldRech: number;
  armorRech: number;
  /** extra jumps of fuel (Nova: 100 units = 1 jump) */
  fuel: number;
  /** afterburner fuel burn, units/sec; 0 means no afterburner fitted */
  afterburner: number;
  /** cloaking device flag bits (ModType 17); 0 = none fitted */
  cloak: number;
  /** fuel regenerated per second by scoops (ModType 18) */
  fuelScoop: number;
  /** can scoop up mined minerals (ModType 31) */
  miningScoop: boolean;
  /** ModType 11/13/14/19/37/38/49 */
  escapePod: boolean;
  densityScanner: boolean;
  iff: boolean;
  autoRefuel: boolean;
  fastJump: boolean;
  inertialDamper: boolean;
  repairSystem: boolean;
  /** ModType 22: days added to (or removed from) each jump */
  hyperSpeed: number;
  /**
   * ModType 23: "amount to increase or decrease the no-jump zone's radius by
   * (the standard radius is 1000)". One outfit uses it — the Horizontal
   * Booster, at -500 — and its own description says what the zone is centred
   * on: it "allows you to enter hyperspace from much closer to the system
   * center".
   */
  jumpDist: number;
  /** ModType 25: boarding troops */
  marines: number;
  /** ModType 33-36: jamming strength against each seeker type */
  jamming: number[];
  /** ModType 30: cloak-scanner flag bits */
  cloakScanner: number;
  /** ModType 44: govt class whose reinforcements are inhibited (-1 = all) */
  reinfInhibit: number[];
  /** ModType 39/40: ion dissipation per second and extra ion capacity */
  ionDissipate: number;
  ionCapacity: number;
  /** ModType 45/46: extra gun and turret mounts (Sigma Mount Reinforcement) */
  maxGuns: number;
  maxTurrets: number;
}

/**
 * Aggregate non-weapon outfit effects.
 * ModType/ModVal semantics per the Nova Bible: 5 shield recharge (1000 = 1
 * point/frame), 7 accel, 8 speed, 9 turn (100 = 30°/sec), 12 fuel (100 = 1
 * jump), 15 afterburner (fuel per second), 29 armor recharge.
 */
export function outfitBonuses(outfits: Record<string, number>): OutfitBonuses {
  const b: OutfitBonuses = {
    cargo: 0, shield: 0, armor: 0, mass: 0,
    accel: 0, speed: 0, turn: 0,
    shieldRech: 0, armorRech: 0, fuel: 0, afterburner: 0,
    cloak: 0, fuelScoop: 0, miningScoop: false,
    escapePod: false, densityScanner: false, iff: false, autoRefuel: false,
    fastJump: false, inertialDamper: false, repairSystem: false,
    hyperSpeed: 0, jumpDist: 0, marines: 0, jamming: [0, 0, 0, 0],
    cloakScanner: 0, reinfInhibit: [], ionDissipate: 0, ionCapacity: 0,
    maxGuns: 0, maxTurrets: 0,
  };
  for (const [outfId, owned] of Object.entries(outfits)) {
    const outf = OUTFITS[outfId];
    if (!outf || owned <= 0) continue;
    b.mass += outf.mass * owned;
    for (const mod of outf.mods) {
      const v = mod.val * owned;
      switch (mod.type) {
        case 2: b.cargo += v; break;
        case 4: b.shield += v; break;
        case 5: b.shieldRech += (v / 1000) * 30; break;
        case 6: b.armor += v; break;
        case 7: b.accel += v; break;
        case 8: b.speed += v; break;
        // outfit turn units are ten times finer than the hull's Maneuver field
        case 9: b.turn += v / 10; break;
        case 12: b.fuel += v / 100; break;
        case 15: b.afterburner = Math.max(b.afterburner, mod.val); break;
        // 17: cloak flags; 18: frames per unit of fuel (negative = fuel sucking)
        case 17: b.cloak |= mod.val; break;
        case 18: if (mod.val !== 0) b.fuelScoop += (30 / mod.val) * owned; break;
        case 29: b.armorRech += (v / 1000) * 30; break;
        case 11: b.escapePod = true; break;
        case 13: b.densityScanner = true; break;
        case 14: b.iff = true; break;
        case 19: b.autoRefuel = true; break;
        case 22: b.hyperSpeed += mod.val; break;
        case 23: b.jumpDist += v; break;
        case 25: b.marines += v; break;
        case 31: b.miningScoop = true; break;
        case 33: case 34: case 35: case 36:
          b.jamming[mod.type - 33] += v;
          break;
        // 16 (maps) is not a ship stat — it charts systems when acquired,
        // and is applied in Game.chartFromOutfit rather than here.
        case 30: b.cloakScanner |= mod.val; break;
        // 39: 100 = one ion point per frame; 40: extra ion capacity
        case 39: b.ionDissipate += (v / 100) * 30; break;
        case 40: b.ionCapacity += v; break;
        case 44: b.reinfInhibit.push(mod.val); break;
        case 45: b.maxGuns += v; break;
        case 46: b.maxTurrets += v; break;
        case 37: b.fastJump = true; break;
        case 38: b.inertialDamper = true; break;
        case 49: b.repairSystem = true; break;
      }
    }
  }
  return b;
}

/** wëap Flags3 bits. */
export const W3_AMMO_AT_BURST_END = 0x0001;
export const W3_TRANSLUCENT = 0x0002;
export const W3_NEAREST_MOUNT = 0x0010;
export const W3_EXCLUSIVE = 0x0020;

/*
 * Which of a hull's four exit points each weapon fires from next. A ship with
 * one gun but two wing mounts alternates between them shot after shot rather
 * than always firing from the same wing, so the counter has to survive across
 * volleys; it is keyed per ship and per weapon so two different guns keep
 * their own place in the rotation.
 */
const nextMount = new WeakMap<Ship, Map<string, number>>();

function takeMounts(shooter: Ship, weapId: string, n: number): number {
  let byWeap = nextMount.get(shooter);
  if (!byWeap) nextMount.set(shooter, (byWeap = new Map()));
  const at = byWeap.get(weapId) ?? 0;
  byWeap.set(weapId, (at + n) % 4);
  return at;
}

/** Spawn projectiles for one shot of a weapon from a ship. */
export function fireWeapon(
  shooter: Ship,
  weap: WeaponType,
  count: number,
  fromPlayer: boolean,
  target: Ship | null,
  aimAngle?: number,
): Projectile[] {
  const out: Projectile[] = [];
  const n = Math.min(count, 4); // cap parallel shots for sanity
  const mount0 = takeMounts(shooter, weap.id, n);
  for (let i = 0; i < n; i++) {
    const jitter = ((Math.random() * 2 - 1) * weap.accuracy * Math.PI) / 180;
    const angle = (aimAngle ?? shooter.angle) + jitter;
    /*
     * Shots leave the hull at the mount the weapon's ExitType names, not from
     * the ship's centre — so a Shuttle's two wing guns fire from its wings and
     * a capital ship's turrets from the turret blisters rather than all
     * streaming out of one point. Each of the `count` parallel shots takes the
     * next of the four exit points in that class, which is what makes a pair
     * of guns alternate left and right.
     */
    /*
     * Flags3 0x0010: "Weapon fires from whatever weapon exit point is closest
     * to the target" — so an Ion Cannon shoots from the blister on the side
     * the target is on, instead of walking round the mounts in turn.
     */
    let mount = mount0 + i;
    if (weap.flags3 & W3_NEAREST_MOUNT && target) {
      let best = Infinity;
      for (let m = 0; m < 4; m++) {
        const e = weaponExitPoint(shooter.sprite, weap.exitType, m, shooter.angle);
        const d = Math.hypot(
          shooter.pos.x + e.x - target.pos.x,
          shooter.pos.y + e.y - target.pos.y,
        );
        if (d < best) { best = d; mount = m; }
      }
    }
    const exit = weaponExitPoint(shooter.sprite, weap.exitType, mount, shooter.angle);
    // Fall back to the nose when the hull declares no mount for this class.
    const from =
      exit.x === 0 && exit.y === 0
        ? {
            x: Math.cos(shooter.angle) * shooter.radius,
            y: Math.sin(shooter.angle) * shooter.radius,
          }
        : exit;
    out.push({
      x: shooter.pos.x + from.x,
      y: shooter.pos.y + from.y,
      vx: shooter.vel.x + Math.cos(angle) * weap.speed,
      vy: shooter.vel.y + Math.sin(angle) * weap.speed,
      angle,
      weap,
      ttl: weap.durationSec,
      fromPlayer,
      owner: shooter,
      target: weap.guidance === 1 ? target : null,
      armTime: weap.proxSafetySec,
      generation: 0,
    });
  }
  /*
   * Recoil shoves the firing ship, "inversely proportional to its mass" — so
   * the Wraith beams and the heavy cannon push a light hull around noticeably
   * and barely stir a freighter. Negative values pull the ship forwards.
   */
  if (weap.recoil !== 0 && n > 0) {
    const mass = Math.max(10, SHIPS[shooter.typeId ?? ""]?.mass ?? 100);
    const push = (weap.recoil * n * 30) / mass;
    shooter.vel.x -= Math.cos(shooter.angle) * push;
    shooter.vel.y -= Math.sin(shooter.angle) * push;
  }
  return out;
}

/** Fallback for a guided weapon whose GuidedTurn is missing. */
const HOMING_TURN = 2.4; // rad/s

/** Seeker 0x4000: the shot loses its lock if the target strays off the nose. */
const SEEKER_LOSES_LOCK = 0x4000;
/** Seeker 0x0008: the shot is confused by a system's sensor interference. */
export const SEEKER_CONFUSED_BY_INTERFERENCE = 0x0008;

/**
 * Chance per second that a system's static shakes a missile off its target.
 * Only weapons whose Seeker says they are confused by interference care —
 * which is the Radar Missile and the EW Missile, not the IR Missile.
 */
export function interferenceBreaksLock(weap: WeaponType, interference: number): number {
  if (!(weap.seeker & SEEKER_CONFUSED_BY_INTERFERENCE)) return 0;
  return Math.min(0.9, interference / 100);
}

/**
 * Did a shot's path this frame pass within `r` of (cx, cy)? Testing only where
 * the shot *ended up* is not enough: Nova's unguided rounds cover 20-40 px in
 * a thirtieth of a second (the Heavy Blaster Turret does 26), while a Shuttle
 * is 12 px across, so a point sample steps clean over small ships and the shot
 * sails on. Measured before this was swept, ten seconds of point-blank fire on
 * a Shuttle landed nothing at all at frame rate and hit normally when the same
 * ten seconds were stepped ten times finer.
 */
export function pathHitsCircle(
  x0: number,
  y0: number,
  x1: number,
  y1: number,
  cx: number,
  cy: number,
  r: number,
): boolean {
  const dx = x1 - x0;
  const dy = y1 - y0;
  const len2 = dx * dx + dy * dy;
  if (len2 === 0) return Math.hypot(cx - x0, cy - y0) < r;
  // closest approach of the segment to the circle's centre
  const t = Math.max(0, Math.min(1, ((cx - x0) * dx + (cy - y0) * dy) / len2));
  const nx = x0 + dx * t;
  const ny = y0 + dy * t;
  return Math.hypot(cx - nx, cy - ny) < r;
}

export function updateProjectile(p: Projectile, dt: number): void {
  if (p.target && !p.target.destroyed) {
    const desired = Math.atan2(p.target.pos.y - p.y, p.target.pos.x - p.x);
    let diff = desired - p.angle;
    while (diff > Math.PI) diff -= Math.PI * 2;
    while (diff < -Math.PI) diff += Math.PI * 2;
    /*
     * Each missile now turns at its own GuidedTurn rather than every warhead
     * in the game sharing one rate: the EMP Torpedo lumbers at 20 where the
     * IR Missile whips round at 70, which is most of what separates them.
     */
    if (p.weap.seeker & SEEKER_LOSES_LOCK && Math.abs(diff) > Math.PI / 2) {
      p.target = null;
    } else {
      const step = (p.weap.guidedTurnRate || HOMING_TURN) * dt;
      p.angle += Math.abs(diff) <= step ? diff : Math.sign(diff) * step;
      p.vx = Math.cos(p.angle) * p.weap.speed;
      p.vy = Math.sin(p.angle) * p.weap.speed;
    }
  }
  p.x += p.vx * dt;
  p.y += p.vy * dt;
  p.ttl -= dt;
  if (p.armTime > 0) p.armTime -= dt;
}

/**
 * The shots a dying projectile breaks into. Nova spawns these both when a
 * shot reaches the end of its life and when its proximity fuse trips, which
 * is what turns the Polaron Multi-Torp into five Polaron Torps at 45 degrees
 * of spread. `subLimit` caps a weapon that submunitions into itself so the
 * Nanites cannot divide forever.
 */
export function spawnSubmunitions(p: Projectile): Projectile[] {
  const sub = p.weap.subType !== null ? WEAPONS[String(p.weap.subType)] : null;
  if (!sub || p.weap.subCount <= 0) return [];
  /*
   * A weapon that splits into copies of itself may only recurse SubLimit
   * times. The Nanites are the only shipped example and they state a SubLimit
   * of 0, which cannot be taken at face value in either direction: read as a
   * hard zero the weapon would never split at all, and read as "no limit" it
   * would recurse forever. So an unstated limit means a single split — enough
   * for the weapon to behave as defined, without an unbounded chain.
   */
  if (p.weap.subType === Number(p.weap.id)) {
    const limit = p.weap.subLimit > 0 ? p.weap.subLimit : 1;
    if (p.generation >= limit) return [];
  }
  const out: Projectile[] = [];
  for (let i = 0; i < p.weap.subCount; i++) {
    const spread = ((Math.random() * 2 - 1) * p.weap.subTheta * Math.PI) / 180;
    const angle = p.angle + spread;
    out.push({
      x: p.x,
      y: p.y,
      vx: Math.cos(angle) * sub.speed,
      vy: Math.sin(angle) * sub.speed,
      angle,
      weap: sub,
      ttl: sub.durationSec,
      fromPlayer: p.fromPlayer,
      owner: p.owner,
      target: sub.guidance === 1 ? p.target : null,
      armTime: sub.proxSafetySec,
      generation: p.generation + 1,
    });
  }
  return out;
}
