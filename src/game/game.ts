import {
  BOOM_SPRITES,
  DESCS,
  DUDES,
  convertShipStats,
  findRoute,
  FLEETS,
  pickStartSystemId,
  START_TEMPLATE,
  getSystem,
  GLOW_SPRITES,
  LIGHT_SPRITES,
  MISSIONS,
  OUTFITS,
  PERSONS,
  RANKS,
  BOOMS,
  NEBULAE,
  nebulaPict,
  ROID_SPRITES,
  ROIDS,
  STR_LISTS,
  SHIP_SPRITES,
  SHIPS,
  SPOB_INDEX,
  START_SYSTEM_ID,
  SYSTEMS,
  systemGovtColor,
  govtHaze,
  landingAllowed,
  landingGovtId,
  MIN_STATUS_NEVER,
  COMMODITIES,
  INTERFACE,
  setInterfaceForGovt,
  UI_PICTS,
  type PictInfo,
  govtAllied,
  govtClassmate,
  govtEnemy,
  COLR,
  GOVTS,
  GOVT_NAMES,
  GOVT_FLAGS,
  GOVT_FLAGS2,
  CRONS,
  ALL_GOVT_IDS,
  OOPSES,
  GOVT_VOICES,
  SPOB_GOVT,
  SPOB_INDEX as SPOBS,
  WEAPON_SPRITES,
  WEAPONS,
  JUNKS,
  junkCargoKey,
  junkFromCargoKey,
  roidYield,
} from "../data/universe";
import {
  drawNpcShip,
  drawPlanet,
  drawPlayerShip,
  drawThrustFlame,
} from "../engine/draw";
import { IntroUi } from "../ui/intro";
import {
  blinkIntensity,
  drawSheetFrame,
  drawShipSprite,
  getPict,
  rotationFrame,
  spriteFrame,
  weaponExitPoint,
  SHAN_HIDE_LIGHTS_DISABLED,
  SHAN_UNFOLD_FIRING,
  type ShipSprite,
} from "../engine/sprites";
import { applySet, evalTest } from "./bits";
import { formatDate } from "./calendar";
import {
  cargoUsed as fleetCargoUsed,
  commodityTons,
  enforceCargoCapacity,
  fleetCargoCap,
  freeCommoditySpace,
  freeHoldSpace,
  missionCargoUsed,
  stowage,
  totalCargoCap,
} from "./cargo";
import { runCrons } from "./crons";
import { runOopses } from "./oops";
import {
  descText,
  instantiateMission,
  isSilentMission,
  missionDisplayName,
  substituteTags,
  testContext,
  type MissionEvent,
} from "./missions";
import {
  isPilotDead,
  listPilots,
  loadPilot,
  markPilotDead,
  savePilot,
} from "./pilots";
import {
  applyCompReward,
  applyCrime,
  applySmuggling,
  contraband,
  crimeTolerance,
  getRecord,
  ratingLevel,
  ratingName,
} from "./reputation";
import {
  getVolume,
  playMenuClose,
  playMenuOpen,
  playPlayerDeath,
  playerDeathDuration,
  playSnd,
  playSndAt,
  preloadCoreSnds,
  preloadSnds,
  setVolume,
  SND,
  sndDuration,
  startSustained,
  stopSustained,
  toggleMuted,
  VOICE,
  voiceBank,
  voiceSnd,
  type VoiceKind,
} from "../engine/audio";
import {
  beamHit,
  buildLoadout,
  interferenceBreaksLock,
  jamChance,
  personLoadout,
  cloakFuelDrain,
  cloakShieldDrain,
  CLOAK_BREAKS_ON_DAMAGE,
  CLOAK_DROPS_SHIELDS,
  ammoCapped,
  inherentCombatGovt,
  applyReload,
  reloadInterval,
  volleyCount,
  W3_AMMO_AT_BURST_END,
  W3_TRANSLUCENT,
  fireWeapon,
  leadPoint,
  isBeam,
  isFighterBay,
  isPointDefense,
  isPrimary,
  isSecondary,
  isTurret,
  isQuadrantGun,
  countMounts,
  mountKind,
  mountLimits,
  outfitBonuses,
  stockAmmo,
  grantHullOutfits,
  hullOutfits,
  hullOutfitMass,
  updateProjectile,
  pathHitsCircle,
  spawnSubmunitions,
  type BeamFx,
  type ExplosionFx,
  type Projectile,
  type WeaponSlot,
} from "./combat";
import { Input } from "../engine/input";
import {
  actionConsume,
  actionDown,
  consumeCycleTargets,
  formatChord,
  getBinding,
  type ActionId,
} from "../keybindings";
import { simFastForCapsLock } from "../settings";
import { InfoUi, type InfoPickItem, type InfoRow } from "../ui/info";
import { drawStarfield } from "../engine/starfield";
import type {
  ActiveMission,
  CharTemplate,
  FleetType,
  MissionType,
  RankType,
  PersonType,
  PlanetDef,
  PlayerState,
  SystemDef,
  Vec2,
  WeaponType,
} from "../types";
import { HailUi, type HailOption } from "../ui/hail";
import { PlunderUi } from "../ui/plunder";
import { HUD_W, HudUi } from "../ui/hud";
import type { CaptureResult, PlunderHold } from "../ui/plunder";
import { LandedUi } from "../ui/landed";
import { NpcShip, SPARROW, Ship, type EscortOrder } from "./ship";

type Mode = "menu" | "flight" | "map" | "landed";

/**
 * Hyperspace entry, as Nova plays it (and as the SDA notes spell out):
 *   1. brake  — face retro and burn until nearly stopped, unless the hull or an
 *      outfit can "jump without slowing down" (shïp Flags2 0x0020 / oütf 37);
 *   2. turn   — point at the destination system on the map;
 *   3. warm   — hold still while the warp-up sample spools (sound starts here);
 *   4. burn   — accelerate well past cruise speed toward that heading, so you
 *      streak across the current system before the white flash and arrival.
 * Warm+burn wall time equals the warp sample (128 / 129), scaled by shïp
 * Flags 0x0001/2/4 jumping speed which also pitches the sample.
 */
interface JumpSequence {
  phase: "braking" | "turning" | "warming" | "burning";
  /** map bearing of the destination system */
  targetAngle: number;
  /** game-dt seconds left holding still while the drive spools */
  warmLeft: number;
  /** game-dt seconds left on the high-speed burn */
  burnLeft: number;
  /** original burn length for white-out timing */
  burnTotal: number;
  /** temporary maxSpeed / accel while burning into hyperspace */
  burnSpeed: number;
  burnAccel: number;
  /** snd 128 (1× clock) or 129 (2× clock) */
  warpSndId: number;
  /** ship jump-speed mult — shortens spool and pitches the warp sample up */
  playbackRate: number;
}

interface Message {
  text: string;
  time: number;
}

/** A speck of debris thrown off a shattering asteroid (röid PartCount/Color). */
interface Particle {
  x: number;
  y: number;
  vx: number;
  vy: number;
  color: string;
  ttl: number;
  life: number;
}

interface Asteroid {
  typeId: string;
  x: number;
  y: number;
  vx: number;
  vy: number;
  armor: number;
  frame: number;
  spin: number;
}

interface Mineral {
  x: number;
  y: number;
  vx: number;
  vy: number;
  /** index into COMMODITIES, or null when this rock yields a jünk instead */
  yieldType: number | null;
  /** jünk id for the ice and crystal fields, which yield Water and Opals */
  junkId: number | null;
  ttl: number;
}

/*
 * The two mission arrows the mïsn Flags bits distinguish: the ordinary
 * destination marker (red, suppressed by 0x0002) and the briefing arrow
 * (green, 0x0100), which is what the mission board's Map button shows.
 */
const MISSION_ARROW = "#e05a4a";
const BRIEFING_ARROW = "#5ada54";

/**
 * Governments that board disabled ships rather than finishing them off.
 * Pirates (137, 192), Houseless Warriors (170), Associated Guild of Free
 * Traders / "Fr Trad" (169), Association of Free Traders / "Assoc" (176, 177).
 */
const BOARDER_GOVTS = new Set([137, 169, 170, 176, 177, 192]);

const LAND_DIST = 2.4; // multiples of planet radius (from surface-ish)
const LAND_SPEED = 130;
/** Leave a gate slightly too fast to re-dock without braking. */
const GATE_EMERGE_SPEED = LAND_SPEED + 20;
/**
 * Default exit bearing when CustSndID does not pin one (Bible: "any other
 * value" → random). Stock rings all share the same art, open at ~4:00 on
 * the clock, so a fixed bearing matches the sprite better than a roll.
 * Degrees are Nova's: 0 = up, clockwise (120° ≈ 4:00).
 */
const GATE_EMERGE_DEG = 120;
/** Seconds to bleach white on gate entry / recolour on exit. */
const GATE_ENTER_FLASH = 0.38;
const GATE_EXIT_FLASH = 0.55;
const REFUEL_COST_PER_JUMP = 150;
/** gövt Flags2: ships of this govt don't use hypergates / prefer gates / prefer wormholes */
const GOVT_NO_HYPERGATES = 0x0020;
const GOVT_PREFER_HYPERGATES = 0x0040;
const GOVT_PREFER_WORMHOLES = 0x0080;

/**
 * A template's opening legal record. Nova sets the given status in that
 * government's space and its allies', and the negative of it among its
 * enemies, so a pilot can start wanted by one side and welcome on the other.
 */
function startingRecords(tmpl: CharTemplate | null): Record<string, number> {
  const out: Record<string, number> = {};
  /*
   * gövt InitialRec is where every government's opinion of a new pilot starts
   * — most read 0, but a few open in credit or in the red before the chär
   * template's own starting records are layered on top.
   */
  for (const id of ALL_GOVT_IDS) {
    const rec = GOVTS[String(id)]?.initialRec ?? 0;
    if (rec !== 0) out[String(id)] = rec;
  }
  for (const { govt, status } of tmpl?.records ?? []) {
    if (status === 0) continue;
    for (const other of ALL_GOVT_IDS) {
      if (other === govt || govtAllied(govt, other))
        out[String(other)] = status;
      else if (govtEnemy(govt, other)) out[String(other)] = -status;
    }
  }
  return out;
}
function defaultPlayer(): PlayerState {
  // the scenario's own starting template decides ship, cash and where you begin
  const tmpl = START_TEMPLATE;
  const startShip =
    tmpl && SHIPS[String(tmpl.shipType)] ? String(tmpl.shipType) : "128";
  return {
    credits: tmpl?.cash ?? 10000,
    fuelJumps: 3,
    maxFuelJumps: 3,
    cargo: {},
    cargoCap: 10,
    systemId: pickStartSystemId(),
    landedOn: null,
    lastPad: null,
    shipId: startShip,
    // A new pilot owns the hull's armament outright rather than having it
    // welded on: the Shuttle's Light Blaster is a Light Blaster outfit, so it
    // shows in the outfitter and can be sold like any other.
    outfits: hullOutfits(startShip),
    hullDefaults: true,
    ammo: stockAmmo(startShip),
    bits: {},
    date: 0,
    activeMissions: [],
    // chär Govt1-4 / Status1-4: the record this template opens with in each
    // government's space, and the negative of it in their enemies'.
    records: startingRecords(tmpl),
    ratingPoints: tmpl?.kills ?? 0,
    strict: false,
    difficulty: "normal",
    personsKilled: [],
    dominated: [],
    tributeDay: 0,
    planetRecords: {},
    explored: [],
    crons: [],
    oopses: [],
    ranks: [],
    salaryDay: 0,
    escorts: [],
    escortPayDay: 0,
  };
}

/** What a hold entry is called — a commodity, or one of Nova's jünk goods. */
function cargoLabel(cargoId: string): string {
  const junk = junkFromCargoKey(cargoId);
  if (junk) return junk.name;
  return COMMODITIES.find((c) => c.id === cargoId)?.name ?? cargoId;
}

const SIDEBAR_W = HUD_W;

/** audio key for the hyperdrive spool-up, so the jump can cut it short */
const JUMP_SND_KEY = "jump:warp";
/**
 * The space Nova authors its ïntf status bars in. Every stock interface puts
 * its indicators inside x 0-192, ending with the cargo readout at y 552, and
 * the whole thing is scaled onto SIDEBAR_W at draw time.
 */

/** A gate ring is shut until a pilot opens it, and shuts again behind them. */
type GatePhase = "opening" | "open" | "closing";

/** Nova runs its sprite animations at the engine's 30 frames a second. */
const STELLAR_FPS = 30;

/** One end of a gate's network, with what the panel needs to plot it. */
export interface GateDestination {
  spobId: string;
  name: string;
  systemName: string;
  /** galaxy-map position of the far system, or null if it can't be resolved */
  mapPos: Vec2 | null;
  /** whether the pilot has been there — unvisited ends stay unnamed */
  explored: boolean;
}

/** How many ships one pilot can keep on the payroll. */
export const MAX_ESCORTS = 6;

/** Up front, a tenth of the hull; then a thousandth of it every day. */
export function escortHireFee(hullCost: number): number {
  return Math.max(1000, Math.round(hullCost * 0.1));
}

export function escortWage(hullCost: number): number {
  return Math.max(50, Math.round(hullCost / 1000));
}

/**
 * What a captured escort fetches. shïp EscSellValue is "the amount of cash the
 * player gets for selling off a captured escort of this type. If you input a
 * number that's less than or equal to zero here, Nova will default to 10% of
 * the ship's original cost" — and all 288 shipped hulls read zero, so the
 * fallback is the only branch stock data ever takes.
 */
export function escortSellValue(shipId: string): number {
  const type = SHIPS[shipId];
  if (!type) return 0;
  return type.escSellValue > 0
    ? type.escSellValue
    : Math.round(type.cost * 0.1);
}

export class Game {
  private canvas: HTMLCanvasElement;
  private ctx: CanvasRenderingContext2D;
  private input = new Input();
  private landedUi: LandedUi;
  private introUi = new IntroUi();
  private plunderUi = new PlunderUi();
  private hudUi = new HudUi();
  private infoUi = new InfoUi();
  private hailUi: HailUi;

  mode: Mode = "menu";
  player: PlayerState;
  pilotId: string | null = null;
  pilotName = "Captain";
  /**
   * Mode to restore after Esc → title → Enter ship. Null when there is no
   * live session (cold title, or the pilot was explicitly reloaded/killed).
   */
  private resumeMode: Mode | null = null;
  /**
   * Simulation clock multiplier. Caps Lock always toggles 2×; Preferences
   * only choose which lock state is fast (on or off). The frame loop
   * multiplies dt by this so physics, AI and cooldowns all race.
   */
  get timeScale(): number {
    return simFastForCapsLock(this.input.capsLock) ? 2 : 1;
  }
  /** set by main.ts to reopen the title menu */
  onMenu: (() => void) | null = null;
  ship = new Ship(SPARROW);
  npcs: NpcShip[] = [];
  private npcSpawnTimer = 3;
  /** NPC flying to the player to transfer fuel; null when no transfer in progress */
  private fuelHelper: NpcShip | null = null;
  private observeTimer = 0.5;
  private secondaryIdx = 0;
  private reinforceTimer = 45;
  /** seconds until the next contraband scan attempt */
  private scanTimer = 25;
  /** shots that died this frame and may still owe a blast */
  private detonated: Projectile[] = [];
  /** a reinforcement fleet called but not yet arrived (ReinfTime) */
  private pendingReinforcement: { fleet: FleetType; at: number } | null = null;
  /** how many defenders a besieged world has left */
  private domination = new Map<string, number>();

  route: string[] = []; // system ids to traverse, in order
  routeDest: string | null = null;
  /** Prior frame's jump-possible state — edge-detect ready-to-jump (snd 154). */
  private wasJumpPossible = false;
  weaponSlots: WeaponSlot[] = [];
  /** afterburner fuel burn (units/sec); 0 when none is fitted */
  private afterburnerBurn = 0;
  private afterburning = false;
  private cloakFlags = 0;
  /** true when the hull (shïp Flags2 0x40) or an inertial damper makes it so */
  private inertialess = false;
  cloaked = false;
  private fuelScoopRate = 0;
  private hasMiningScoop = false;
  private gear = {
    escapePod: false,
    autoEject: false,
    densityScanner: false,
    iff: false,
    autoRefuel: false,
    fastJump: false,
    inertialDamper: false,
    hyperSpeed: 0,
    jumpDist: 0,
    marines: 0,
    jamming: [0, 0, 0, 0] as number[],
    cloakScanner: 0,
    reinfInhibit: [] as number[],
  };
  projectiles: Projectile[] = [];
  beams: BeamFx[] = [];
  explosions: ExplosionFx[] = [];
  asteroids: Asteroid[] = [];
  /** floating mineral boxes from cracked asteroids */
  minerals: Mineral[] = [];
  particles: Particle[] = [];
  targetNpc: NpcShip | null = null;
  /** EV targets stellars too: L cycles them, a second press lands */
  targetPlanet: PlanetDef | null = null;
  /** Planets cleared by a paid bribe this flight session (resets on new system entry). */
  private bribedPlanets = new Set<string>();
  /**
   * Per-planet bribe negotiation state for this system visit.
   * rejected:      refused a lower-price request this hail session — cleared on re-hail.
   * nextAmount:    opening ask for the next hail (raised after each refusal).
   * lowestOffered: floor price; they will never agree to go at or below this again.
   */
  private bribeState = new Map<
    string,
    { rejected: boolean; nextAmount: number; lowestOffered: number }
  >();
  /** the autopilot has the stick (Q) */
  private autopilot = false;
  /**
   * Hypergate rings, by spöb id. Selecting a working gate starts the open
   * sequence; landing on it opens the destination map. After transit the far
   * ring is open and immediately closes.
   */
  private gateAnim = new Map<string, { phase: GatePhase; frame: number }>();
  /** gate we landed on while it was still opening — show chooser when open */
  private gateDocking: PlanetDef | null = null;
  /**
   * Source hypergate while the destination map is up. Null for a normal
   * hyperspace map. Esc / Done cancels without travelling.
   */
  private gateChooser: PlanetDef | null = null;
  /**
   * Dest spöb id while the player is bleaching white into a gate. Null once
   * the enter flash finishes and transit applies. Exit flash is just
   * ship.gateFlash decaying on the far side.
   */
  private pendingGateDest: string | null = null;
  private jump: JumpSequence | null = null;
  private jumpFlash = 0;
  /** Offscreen buffer for the solid-white hull silhouette during gateFlash. */
  private gateFlashBuf: HTMLCanvasElement | null = null;
  private gateFlashCtx: CanvasRenderingContext2D | null = null;
  /**
   * Player death is not instant: klaxon ×3 then explode (~4.6s of stock audio)
   * while fire animations keep sparking at the wreck. Null when not dying.
   */
  private playerDeath: {
    t: number;
    duration: number;
    withPod: boolean;
    x: number;
    y: number;
    nextFx: number;
    /** seconds to wait after explosion before resolving (non-pod only) */
    waitLeft: number;
  } | null = null;

  private messages: Message[] = [];
  private pendingMissionEvents: MissionEvent[] = [];
  private time = 0;
  private mapNodes: { id: string; x: number; y: number }[] = [];
  /** clickable rects for the map's own button bar */
  private mapButtons: {
    id: string;
    x: number;
    y: number;
    w: number;
    h: number;
  }[] = [];
  /** which system the info panel is describing */
  private mapSelected: string | null = null;
  /**
   * Where "Done" goes. Nova's map is reachable from the mission board as well
   * as from the cockpit, and closing it has to put you back where you were.
   */
  private mapReturn: Mode = "flight";
  /**
   * Systems to mark while the map is open for a mission you have not accepted
   * yet — the board's Map button previews where a posting would send you.
   */
  private mapPreview: string[] = [];
  /** Nova's "Show Borders" toggle — government space as coloured haze */
  private mapBorders = true;
  private mapZoom = 2.2;
  private mapCenter = { x: 0, y: 0 };
  private mapScale = 1; // effective px per map unit, set during render
  /**
   * Floating mini-map overlay deadline (including fade-out). Refreshed by the
   * display-mini-map bind (held open while down) and by cycle-jump-dest peeks;
   * after release it lingers fully then fades away.
   */
  private floatingMapUntil = 0;
  private mouse = { x: 0, y: 0 };
  private drag: { x: number; y: number; moved: number } | null = null;
  private lastDragMoved = 0;

  constructor(canvas: HTMLCanvasElement) {
    this.canvas = canvas;
    this.ctx = canvas.getContext("2d")!;
    // menu-backdrop state until a pilot is chosen
    this.player = defaultPlayer();
    this.landedUi = new LandedUi(this);
    this.hailUi = new HailUi(this);
    this.applyShipType(this.player.shipId);

    const resize = () => {
      const dpr = window.devicePixelRatio || 1;
      canvas.width = window.innerWidth * dpr;
      canvas.height = window.innerHeight * dpr;
      this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    };
    window.addEventListener("resize", resize);
    resize();

    canvas.addEventListener("click", (e) => this.onClick(e));
    canvas.addEventListener("wheel", (e) => {
      if (this.mode !== "map") return;
      e.preventDefault();
      const k = e.deltaY < 0 ? 1.2 : 1 / 1.2;
      this.mapZoom = Math.min(12, Math.max(0.7, this.mapZoom * k));
    });
    canvas.addEventListener("mousedown", (e) => {
      if (this.mode === "map")
        this.drag = { x: e.clientX, y: e.clientY, moved: 0 };
    });
    window.addEventListener("mouseup", () => {
      this.lastDragMoved = this.drag?.moved ?? 0;
      this.drag = null;
    });
    // Track cursor over the whole window so aim-cursor stays live when the
    // pointer crosses the HUD or leaves the canvas briefly.
    window.addEventListener("mousemove", (e) => {
      const rect = canvas.getBoundingClientRect();
      this.mouse = { x: e.clientX - rect.left, y: e.clientY - rect.top };
      if (this.drag && this.mode === "map") {
        this.mapCenter.x -= (e.movementX ?? 0) / this.mapScale;
        this.mapCenter.y -= (e.movementY ?? 0) / this.mapScale;
        this.drag.moved +=
          Math.abs(e.movementX ?? 0) + Math.abs(e.movementY ?? 0);
      }
    });

    // park the camera over the start system for the menu backdrop
    const home = this.system.planets[0];
    if (home) {
      this.ship.pos = {
        x: home.pos.x + home.radius * 2.2,
        y: home.pos.y + home.radius * 1.4,
      };
    }
    this.populateNpcs();
  }

  /** Begin playing as a pilot (new or loaded). Called from the main menu. */
  /**
   * Title "Enter ship": resume a session paused with Esc when the same pilot
   * is still selected; otherwise load that pilot from disk (as Open Pilot does).
   */
  enterShip(pilotId: string, strict?: boolean): void {
    if (this.tryResume(pilotId)) return;
    this.startPilot(pilotId, strict);
  }

  /** True if a live session for this pilot is sitting under the title menu. */
  hasPausedSession(pilotId?: string | null): boolean {
    if (!this.resumeMode || !this.pilotId) return false;
    if (pilotId != null && pilotId !== this.pilotId) return false;
    return true;
  }

  /**
   * Restore the mode Esc interrupted. Returns false if there is nothing to
   * resume (caller should load the pilot instead).
   */
  tryResume(pilotId: string): boolean {
    if (!this.hasPausedSession(pilotId) || !this.resumeMode) return false;
    const mode = this.resumeMode;
    this.resumeMode = null;
    if (mode === "landed" && this.player.landedOn) {
      const home = this.system.planets.find(
        (p) => p.id === this.player.landedOn,
      );
      if (home) {
        this.mode = "landed";
        this.landedUi.show(home, this.system);
        return true;
      }
    }
    if (mode === "map") {
      this.mode = "map";
      return true;
    }
    // flight (default), or landed without a pad to re-open
    this.mode = "flight";
    return true;
  }

  startPilot(pilotId: string, strict?: boolean, difficulty?: "normal" | "hard"): void {
    preloadCoreSnds();
    this.resumeMode = null;
    if (isPilotDead(pilotId)) {
      // Strict deaths stay on the list but never fly again.
      this.pilotId = null;
      this.mode = "menu";
      this.onMenu?.();
      return;
    }
    this.pilotId = pilotId;
    this.pilotName =
      listPilots().find((p) => p.id === pilotId)?.name ?? "Captain";
    const saved = loadPilot(pilotId);
    this.player = { ...defaultPlayer(), ...(saved ?? {}) };
    if (strict !== undefined) this.player.strict = strict;
    if (difficulty !== undefined) this.player.difficulty = difficulty;
    // Migration: Sigma4 onAccept fires k147 (rank 147 = hypergate access).
    // Pilots that completed the mission before rank granting was wired have b49
    // but no rank 147. Grant it retroactively so the hypergate unlocks.
    if (
      this.player.bits["49"] &&
      !this.player.ranks.includes(147)
    ) {
      this.player.ranks.push(147);
    }
    if (!saved) {
      // chär OnStart: the control bits the scenario wants set the moment a
      // pilot exists. Without these the opening links of a story chain never
      // become available, which reads as "no missions here" rather than a bug.
      const onStart = START_TEMPLATE?.onStart;
      if (onStart) applySet(onStart, this.player.bits, this.bitHandlers());
    }
    this.markExplored(this.player.systemId);
    for (const [outfId, owned] of Object.entries(this.player.outfits)) {
      if (owned > 0) this.chartFromOutfit(outfId, false);
    }
    this.applyShipType(this.player.shipId);
    this.ship.shield = this.ship.maxShield;
    this.ship.armor = this.ship.maxArmor;
    this.ship.vel = { x: 0, y: 0 };
    this.route = [];
    this.routeDest = null;
    if (this.player.routeDest && this.player.routeDest !== this.player.systemId) {
      const restored = findRoute(this.player.systemId, this.player.routeDest);
      if (restored) {
        this.route = restored;
        this.routeDest = this.player.routeDest;
      }
    }
    this.jump = null;
    stopSustained(JUMP_SND_KEY); // a pilot switch mid-charge leaves nothing humming
    this.projectiles = [];
    this.explosions = [];
    this.targetNpc = null;
    this.messages = [];

    const sys = this.system;
    // Disk saves are written on leave, so a load is almost always in flight
    // over lastPad. landedOn is only non-null mid-session (or in old saves).
    const padId = this.player.landedOn ?? this.player.lastPad;
    const home = padId
      ? (sys.planets.find((p) => p.id === padId) ?? sys.planets[0])
      : sys.planets[0];
    if (home) {
      // Same rule as depart(): on the pad, not parked off to one side.
      this.ship.pos = { ...home.pos };
    } else {
      this.ship.pos = { x: 900, y: 600 };
    }
    this.npcs = [];
    this.dockedNpcs = [];
    this.populateNpcs();
    this.populateAsteroids();
    this.spawnMissionShips();

    /*
     * A brand-new pilot gets the scenario's opening sequence — chär
     * IntroPictID 1-4 held for PictDelay seconds each, then the IntroTextID
     * dësc. The shipped ".Trader" runs PICTs 8200-8202. It plays over the
     * game, which is already set up behind it, so dismissing it drops you
     * straight into the world.
     */
    if (!saved && START_TEMPLATE) {
      const picts = START_TEMPLATE.introPicts
        .map((id) => UI_PICTS[String(id)])
        .filter((p): p is PictInfo => !!p);
      this.introUi.show(
        picts,
        START_TEMPLATE.pictDelays,
        descText(START_TEMPLATE.introTextId) ?? "",
        () => undefined,
      );
    }

    if (this.player.landedOn && home) {
      this.mode = "landed";
      this.landedUi.show(home, sys);
    } else {
      this.mode = "flight";
      this.message(
        `Welcome to the ${sys.name} system. Press M for the map, L to land.`,
      );
    }
    // No disk write — progress is RAM until the next leave-planet commit.
  }

  /**
   * Destinations reachable from a hypergate's HyperLink list. Wormholes are
   * not listed — the Bible dumps you at a random far end with no choice.
   */
  gateDestinations(gate: PlanetDef): GateDestination[] {
    return gate.hyperLinks
      .map((spobId) => this.describeGateDest(spobId))
      .filter((d): d is GateDestination => d !== null);
  }

  private describeGateDest(spobId: string): GateDestination | null {
    const entry = SPOBS.get(spobId);
    if (!entry) return null;
    let systemName = "unknown space";
    let mapPos: Vec2 | null = null;
    let explored = false;
    try {
      const sys = getSystem(entry.systemId);
      systemName = sys.name;
      mapPos = sys.mapPos;
      explored = this.player.explored.includes(entry.systemId);
    } catch {
      /* orphaned spob */
    }
    return {
      spobId,
      name: entry.planet.name,
      systemName,
      mapPos,
      explored,
    };
  }

  /** System ids that are valid travel targets from the open gate chooser. */
  private gateChooserSystemIds(): string[] {
    if (!this.gateChooser) return [];
    const ids: string[] = [];
    const seen = new Set<string>();
    for (const d of this.gateDestinations(this.gateChooser)) {
      const entry = SPOBS.get(d.spobId);
      if (!entry || seen.has(entry.systemId)) continue;
      seen.add(entry.systemId);
      ids.push(entry.systemId);
    }
    return ids;
  }

  /**
   * Bible wormhole rules: linked → random among HyperLinks; fully unlinked →
   * random among other unlinked wormholes. Picked once at transit time.
   */
  private pickWormholeDest(gate: PlanetDef): string | null {
    if (gate.hyperLinks.length > 0) {
      const opts = gate.hyperLinks.filter((id) => SPOBS.has(id));
      if (!opts.length) return null;
      return opts[Math.floor(Math.random() * opts.length)];
    }
    const others = [...SPOBS.values()].filter(
      (e) =>
        e.planet.isWormhole &&
        e.planet.hyperLinks.length === 0 &&
        e.planet.id !== gate.id,
    );
    if (!others.length) return null;
    return others[Math.floor(Math.random() * others.length)].planet.id;
  }

  /**
   * Whether this gate will answer at all. Working hypergates carry the
   * can-land bit; broken ones do not. Wormholes always answer if landable.
   */
  gateIsWorking(gate: PlanetDef): boolean {
    return gate.isWormhole || gate.landable;
  }

  /**
   * Frame where opening finishes and the "working" loop begins (Bible
   * CustPicID). Defaults to the last frame when unset.
   */
  private gateOpenEnd(planet: PlanetDef): number {
    const last = Math.max(0, (planet.spriteFrames || 1) - 1);
    const split = planet.gateAnimSplit;
    if (split === null || split === undefined) return last;
    if (split === 0) return Math.floor((last + 1) / 2);
    return Math.max(0, Math.min(last, split));
  }

  /**
   * Which frame of an animated stellar to draw. Wormholes always loop;
   * hypergates only run while selected/opening/closing.
   */
  gateFrame(planet: PlanetDef): number {
    if (planet.spriteFrames <= 1) return 0;
    if (planet.isWormhole) {
      return Math.floor(this.time * STELLAR_FPS) % planet.spriteFrames;
    }
    return this.gateAnim.get(planet.id)?.frame ?? 0;
  }

  /**
   * Start (or resume) opening a working hypergate. Selection and NPC
   * approach both use this; landing opens the destination map once ready.
   * `silent` skips the player "powering up" line (AI traffic still plays the
   * ring sound so you can hear someone using the gate).
   */
  private beginOpenGate(gate: PlanetDef, silent = false): void {
    if (!gate.isHypergate || !this.gateIsWorking(gate)) return;
    const state = this.gateAnim.get(gate.id);
    if (state?.phase === "open" || state?.phase === "opening") return;
    const frame = state?.frame ?? 0;
    this.gateAnim.set(gate.id, { phase: "opening", frame });
    playSnd(153, silent ? 0.22 : 0.35);
    if (!silent)
      this.message(`${gate.name} acknowledges. The ring is powering up...`);
  }

  /**
   * An NPC on final approach to a working hypergate starts the ring so it is
   * opening (or open) by the time they touch down.
   */
  private maybeOpenGateForNpc(npc: NpcShip): void {
    if (npc.phase !== "toPlanet" || !npc.targetPlanetId) return;
    const pad = this.system.planets.find((p) => p.id === npc.targetPlanetId);
    if (!pad?.isHypergate || !this.gateIsWorking(pad)) return;
    const dist = Math.hypot(pad.pos.x - npc.pos.x, pad.pos.y - npc.pos.y);
    if (dist < pad.radius + 420) this.beginOpenGate(pad, true);
  }

  /** True if the player is still using this ring (select, dock, chooser, or enter flash). */
  private playerUsingGate(gateId: string): boolean {
    return (
      this.targetPlanet?.id === gateId ||
      this.gateDocking?.id === gateId ||
      this.gateChooser?.id === gateId ||
      // mid bleach-in: keep the ring open until transit applies
      this.pendingGateDest != null
    );
  }

  /** Let the ring shut — backed out of the chooser, flew off, or just arrived. */
  private closeGate(gateId: string): void {
    const state = this.gateAnim.get(gateId);
    if (state && state.phase !== "closing") state.phase = "closing";
    if (this.gateDocking?.id === gateId) this.gateDocking = null;
  }

  /**
   * Destination map for a hypergate. Same fog of war as the normal map; only
   * HyperLink systems are selectable, with link lines drawn to them.
   */
  private openGateChooser(gate: PlanetDef): void {
    this.gateChooser = gate;
    this.gateDocking = null;
    this.player.landedOn = null;
    this.landedUi.hide();
    this.mode = "map";
    this.mapReturn = "flight";
    this.mapPreview = [];
    this.mapCenter = { ...this.system.mapPos };
    const links = this.gateChooserSystemIds();
    this.mapSelected = links[0] ?? this.system.id;
    this.projectiles = [];
    this.targetNpc = null;
    this.autopilot = false;
  }

  /** Run gate rings; finish pending landings once the ring is open. */
  private updateGates(dt: number): void {
    const step = STELLAR_FPS * dt;
    for (const [id, state] of [...this.gateAnim]) {
      const planet =
        this.system.planets.find((p) => p.id === id) ??
        (this.gateChooser?.id === id ? this.gateChooser : null);
      if (!planet) {
        this.gateAnim.delete(id);
        continue;
      }
      const openEnd = this.gateOpenEnd(planet);
      const last = Math.max(0, (planet.spriteFrames || 1) - 1);
      if (state.phase === "opening") {
        state.frame = Math.min(openEnd, state.frame + step);
        if (state.frame >= openEnd) {
          state.phase = "open";
          state.frame = openEnd;
          if (
            this.gateDocking?.id === id &&
            (this.mode === "flight" || this.mode === "landed")
          ) {
            this.openGateChooser(this.gateDocking);
          }
        }
      } else if (state.phase === "open") {
        // Bible "working" loop: frames from the split through the end
        if (last > openEnd) {
          state.frame += step;
          if (state.frame > last) state.frame = openEnd;
        } else {
          state.frame = openEnd;
        }
      } else if (state.phase === "closing") {
        state.frame -= step;
        if (state.frame <= 0) this.gateAnim.delete(id);
      }
    }
    // fly away from a gate you had selected / were docking and it powers down
    if (this.mode === "flight" && this.targetPlanet?.isHypergate) {
      const g = this.targetPlanet;
      const d = Math.hypot(
        g.pos.x - this.ship.pos.x,
        g.pos.y - this.ship.pos.y,
      );
      if (d > g.radius * LAND_DIST + 400) {
        const st = this.gateAnim.get(g.id);
        if (st && st.phase !== "closing") {
          this.message(`${g.name} powers down.`);
          this.closeGate(g.id);
        }
      }
    }
    if (this.gateDocking && this.mode === "flight") {
      const g = this.gateDocking;
      const d = Math.hypot(
        g.pos.x - this.ship.pos.x,
        g.pos.y - this.ship.pos.y,
      );
      if (d > g.radius * LAND_DIST + 260) {
        this.message(`${g.name} powers down.`);
        this.closeGate(g.id);
      }
    }
  }

  /**
   * Start (or complete) gate/wormhole travel. The hull bleaches white, then
   * transit is instant — no fuel, no calendar day — and the far side recolours
   * from white. Emerge at the far ring's centre, moving slightly too fast to
   * re-dock without braking.
   */
  useGate(destSpobId: string): void {
    if (!SPOBS.get(destSpobId)) {
      this.message("The gate hums, then falls silent. Nothing happens.");
      return;
    }
    if (this.pendingGateDest) return;
    // close any chooser / landed panel and freeze on the ring while we bleach
    this.gateChooser = null;
    this.gateDocking = null;
    this.landedUi.hide();
    this.jump = null;
    stopSustained(JUMP_SND_KEY);
    this.mode = "flight";
    this.ship.vel = { x: 0, y: 0 };
    this.ship.thrusting = false;
    this.ship.gateFlash = 0;
    this.pendingGateDest = destSpobId;
  }

  /** Apply the actual system swap once the enter flash has finished. */
  private applyGateTransit(destSpobId: string): void {
    const entry = SPOBS.get(destSpobId);
    if (!entry) {
      this.message("The gate hums, then falls silent. Nothing happens.");
      this.ship.gateFlash = 0;
      return;
    }
    this.player.systemId = entry.systemId;
    this.markExplored(entry.systemId);
    this.player.landedOn = null;
    const dest = entry.planet;
    // CustSndID is Nova degrees (0 = up, clockwise). Our ship angle is
    // 0 = +x, clockwise — subtract 90° so velocity matches the ring art.
    const novaDeg =
      dest.emergeAngle != null &&
      dest.emergeAngle >= 0 &&
      dest.emergeAngle <= 359
        ? dest.emergeAngle
        : GATE_EMERGE_DEG;
    const ang = ((novaDeg - 90) * Math.PI) / 180;
    // centre of the far gate, already under way outward
    this.ship.pos = { x: dest.pos.x, y: dest.pos.y };
    this.ship.angle = ang;
    this.ship.vel = {
      x: Math.cos(ang) * GATE_EMERGE_SPEED,
      y: Math.sin(ang) * GATE_EMERGE_SPEED,
    };
    // solid white on arrival; decays over GATE_EXIT_FLASH
    this.ship.gateFlash = 1;
    this.mode = "flight";
    this.gateChooser = null;
    this.landedUi.hide();
    this.npcs = [];
    this.dockedNpcs = [];
    this.projectiles = [];
    this.explosions = [];
    this.targetNpc = null;
    // don't leave the far ring selected — you just left it and are braking away
    this.targetPlanet = null;
    this.route = [];
    this.routeDest = null;
    this.autopilot = false;
    // far ring is open and immediately starts closing; L re-opens it
    this.gateAnim.clear();
    this.gateDocking = null;
    if (dest.isHypergate && dest.spriteFrames > 1) {
      this.gateAnim.set(dest.id, {
        phase: "closing",
        frame: this.gateOpenEnd(dest),
      });
    }
    this.populateNpcs();
    this.spawnMissionShips();
    playSnd(130, 0.5);
    this.message(
      dest.isWormhole
        ? `The wormhole flings you into the ${this.system.name} system.`
        : `You emerge from ${dest.name} in the ${this.system.name} system.`,
    );
  }

  /** Drop a paused session (deleted pilot, etc.) so Enter ship cannot resume it. */
  clearPausedSession(pilotId?: string | null): void {
    if (pilotId != null && this.pilotId !== pilotId) return;
    this.resumeMode = null;
    this.pilotId = null;
  }

  /**
   * Esc from flight: pause and show the title menu. The live session stays in
   * memory so Enter ship resumes where you left off. Open Pilot / New Pilot
   * still load from disk (and replace this session). Death also clears it.
   */
  exitToMenu(): void {
    if (this.mode !== "menu" && this.pilotId) {
      this.resumeMode = this.mode;
    } else {
      this.resumeMode = null;
    }
    this.landedUi.hide();
    this.hailUi.close();
    this.infoUi.close();
    this.plunderUi.close();
    // a jump abandoned mid-charge must not go on spooling over the menu
    this.jump = null;
    stopSustained(JUMP_SND_KEY);
    this.mode = "menu";
    // keep pilotId — Enter ship for this pilot resumes instead of reloading
    this.onMenu?.();
  }

  /*
   * What the status sidebar needs to read. It lives in ../ui/hud and is DOM,
   * so it reaches in from outside rather than drawing from in here; these keep
   * the underlying state private instead of widening it wholesale.
   */
  get hudClock(): number {
    return this.time;
  }
  /** Debug helper: player.records keyed by government name instead of numeric ID. */
  get namedRecords(): Record<string, number> {
    const nameCounts: Record<string, number> = {};
    for (const g of Object.values(GOVTS)) {
      nameCounts[g.name] = (nameCounts[g.name] ?? 0) + 1;
    }
    const out: Record<string, number> = {};
    for (const [idStr, val] of Object.entries(this.player.records)) {
      const g = GOVTS[idStr];
      if (!g) continue;
      const key = nameCounts[g.name] > 1 ? `${g.name} (${idStr})` : g.name;
      out[key] = val;
    }
    return out;
  }
  get hasDensityScanner(): boolean {
    return this.gear.densityScanner;
  }
  get hasIff(): boolean {
    return this.gear.iff;
  }
  /** Rank 147 "Have Access to Hypergate System" — granted by Sigma4 and the Rebel sideline. */
  get hasHypergateAccess(): boolean {
    return this.player.ranks.includes(147);
  }
  get cloakBits(): number {
    return this.cloakFlags;
  }
  get isAfterburning(): boolean {
    return this.afterburning;
  }
  get afterburnerFuel(): number {
    return this.afterburnerBurn;
  }

  get system(): SystemDef {
    return getSystem(this.player.systemId);
  }

  /**
   * Days only pass on jumps and landings, so that's when the galaxy's own
   * clock gets a chance to run.
   */
  private advanceDays(days: number): void {
    if (days <= 0) return;
    this.player.date += days;
    runCrons(
      this.player,
      this.bitHandlers(),
      {
        outfits: this.player.outfits,
        explored: this.player.explored,
        male: true,
      },
      (cron, phase) => {
        if (phase === "start") this.message(`News: ${cron.name}.`);
      },
    );
    runOopses(
      this.player,
      {
        outfits: this.player.outfits,
        explored: this.player.explored,
        male: true,
      },
      days,
    );
  }

  /** Note the current system as charted. */
  private markExplored(systemId = this.player.systemId): void {
    if (!this.player.explored.includes(systemId))
      this.player.explored.push(systemId);
  }

  isExplored(systemId: string): boolean {
    return this.player.explored.includes(systemId);
  }

  /**
   * Open the galaxy map. `previewSpobs` are the stellars of a mission that has
   * only been *offered* — the board's Map button, which lets you see where a
   * posting would send you before you take it. The map centres on the first
   * one you cannot already see rather than on your own system, since the whole
   * point of looking is that the destination may be somewhere unfamiliar.
   */
  openMap(previewSpobs: string[] = []): void {
    // don't clobber an open hypergate destination chart
    if (this.gateChooser) return;
    const wasMap = this.mode === "map";
    this.mapReturn = wasMap ? this.mapReturn : this.mode;
    this.mapPreview = previewSpobs
      .map((id) => SPOB_INDEX.get(id)?.systemId)
      .filter((id): id is string => id !== undefined);
    this.mode = "map";
    if (this.mapPreview.length > 0) {
      const target = getSystem(this.mapPreview[0]);
      this.mapCenter = { ...target.mapPos };
      this.mapSelected = target.id;
    } else {
      this.mapCenter = { ...this.system.mapPos };
    }
    if (this.mapReturn === "landed") this.landedUi.suspend();
    if (!wasMap) playMenuOpen();
  }

  /**
   * Take a key out of this frame's input before the game loop reads it. The
   * landed screens are DOM, and their keydown handler runs during the browser's
   * event dispatch — ahead of the next update() — so a key that changes the
   * mode would otherwise be handled twice: M opened the map from a landed
   * screen and the loop's own M handler shut it again on the very next frame,
   * and Esc left the planet and then quit to the main menu. Input's listener is
   * a field initialiser, so it is always registered first and the code is
   * already recorded by the time this is called.
   */
  swallowKey(code: string): void {
    this.input.consume(code);
  }

  /** Leave the map, back to wherever it was opened from. */
  closeMap(): void {
    if (this.mode === "map") playMenuClose();
    if (this.gateChooser) {
      // backing out of the gate chart shuts the ring
      this.closeGate(this.gateChooser.id);
      this.gateChooser = null;
      this.gateDocking = null;
      this.mapPreview = [];
      this.mode = "flight";
      this.mapReturn = "flight";
      return;
    }
    this.mapPreview = [];
    this.mode = this.mapReturn === "landed" ? "landed" : "flight";
    if (this.mode === "landed") this.landedUi.resume();
    this.mapReturn = "flight";
  }

  /**
   * Chart whatever one outfit's ModType 16 maps cover. Nova applies a map when
   * you acquire it, not continuously: charting on every stat recompute would
   * quietly re-run a "3 jumps from here" map from wherever you happened to be
   * standing, so a single 1000-credit chart would light up the whole galaxy as
   * you flew it. Called from the two places an outfit can arrive — the
   * outfitter and a control-bit grant — and once over the hold at pilot start,
   * which covers a template or a hull that comes with one.
   */
  private chartFromOutfit(outfId: string, announce = true): void {
    const outf = OUTFITS[outfId];
    if (!outf) return;
    const before = this.player.explored.length;
    for (const mod of outf.mods) if (mod.type === 16) this.applyMap(mod.val);
    const gained = this.player.explored.length - before;
    if (gained > 0 && announce) {
      this.message(
        `Chart updated: ${gained} new system${gained === 1 ? "" : "s"}.`,
      );
    }
  }

  /**
   * ModType 16 maps: a positive value charts that many jumps out, -1 charts
   * inhabited independent space, and -1000 and down chart a govt class.
   */
  private applyMap(range: number): void {
    if (range > 0) {
      let frontier = [this.player.systemId];
      const seen = new Set(frontier);
      for (let step = 0; step < range; step++) {
        const next: string[] = [];
        for (const id of frontier) {
          for (const link of getSystem(id).links) {
            if (seen.has(link)) continue;
            seen.add(link);
            next.push(link);
          }
        }
        frontier = next;
      }
      for (const id of seen) this.markExplored(id);
      return;
    }
    if (range === -1) {
      for (const sys of SYSTEMS) {
        if (sys.planets.some((p) => p.landable && !p.uninhabited))
          this.markExplored(sys.id);
      }
      return;
    }
    if (range <= -1000) {
      const cls = -1000 - range;
      for (const sys of SYSTEMS) {
        if (govtClassmate(sys.govtId, cls)) this.markExplored(sys.id);
      }
    }
  }

  private get viewW(): number {
    return window.innerWidth;
  }
  private get viewH(): number {
    return window.innerHeight;
  }

  message(text: string): void {
    this.messages.push({ text, time: this.time });
    if (this.messages.length > 5) this.messages.shift();
  }

  // ---------------- persistence ----------------

  /**
   * Write the live pilot to disk. Only used when leaving a planet: that is the
   * sole durable checkpoint. Mid-session progress is RAM-only; death, a pilot
   * switch, or closing the tab discards it. Strict death only marks the index
   * entry deceased.
   */
  /**
   * Strip all ship-specific outfits, keeping only those the pilot carries
   * across hulls — licenses and other outfits flagged 0x0004 (persistent).
   * Call this before switching to a new ship so the old loadout doesn't
   * transfer.
   */
  private keepPilotOutfits(): void {
    const kept: Record<string, number> = {};
    for (const [id, n] of Object.entries(this.player.outfits)) {
      if (((OUTFITS[id]?.flags ?? 0) & 0x0004) !== 0) kept[id] = n;
    }
    this.player.outfits = kept;
  }

  private commitPilot(): void {
    if (this.pilotId) {
      this.player.routeDest = this.routeDest;
      savePilot(this.pilotId, this.player);
    }
  }

  /** Apply a ship class's real stats to the player's ship. */
  private applyShipType(shipId: string): void {
    const type = SHIPS[shipId];
    if (!type) return;
    this.player.shipId = shipId;
    this.ship.sprite = SHIP_SPRITES[shipId] ?? null;
    this.ship.typeId = shipId;
    /*
     * The status bar belongs to the hull's inherent government: fly a Polaris
     * ship and you get the Polaris panel. Nova keys this off the attributes
     * half of InherentGovt, the same half that governs voice and jamming,
     * rather than the combat half — a ship can read as Federation in a fight
     * without being a Federation ship. Hulls with no inherent govt, and the
     * governments that name no ïntf of their own, keep the default bar.
     */
    const inherent = SHIPS[shipId]?.inherentGovt ?? null;
    setInterfaceForGovt(inherent?.attributes ? inherent.govt : null);
    const bonus = outfitBonuses(this.player.outfits);
    this.ship.initDefense(
      type.shield + bonus.shield,
      type.armor + bonus.armor,
      type.shieldRechPerSec + bonus.shieldRech,
      (type.flags & 0x10) !== 0 ? 0.1 : 0.33,
    );
    this.recomputeLoadout();
    this.player.fuelJumps = Math.min(
      this.player.fuelJumps,
      this.player.maxFuelJumps,
    );
  }

  /** Recompute weapons, cargo, defenses and handling from ship class + outfits. */
  recomputeLoadout(): void {
    const type = SHIPS[this.player.shipId];
    if (!type) return;
    const bonus = outfitBonuses(this.player.outfits);
    this.weaponSlots = buildLoadout(this.player.shipId, this.player.outfits);
    // warm the fire sounds now — decoding on the first trigger pull swallows it
    preloadSnds(this.weaponSlots.map((s) => s.weap.sndId));
    this.player.cargoCap = type.cargo + bonus.cargo;
    this.player.maxFuelJumps = type.fuelJumps + Math.floor(bonus.fuel);

    // engine upgrades add to the hull's raw stats, then convert together
    this.ship.stats = convertShipStats({
      speed: type.rawSpeed + bonus.speed,
      accel: type.rawAccel + bonus.accel,
      turn: type.rawTurn + bonus.turn,
    });
    this.afterburnerBurn = bonus.afterburner;
    this.cloakFlags = bonus.cloak;
    this.fuelScoopRate = bonus.fuelScoop;
    this.hasMiningScoop = bonus.miningScoop;
    this.ship.maxIon = 100 + bonus.ionCapacity;
    this.ship.ionDissipatePerSec = 15 + bonus.ionDissipate;
    this.inertialess =
      bonus.inertialDamper ||
      (SHIPS[this.player.shipId]?.flags2 & 0x0040) !== 0;
    this.gear = {
      escapePod: bonus.escapePod,
      autoEject: bonus.autoEject,
      densityScanner: bonus.densityScanner,
      iff: bonus.iff,
      autoRefuel: bonus.autoRefuel,
      fastJump: bonus.fastJump,
      inertialDamper: bonus.inertialDamper,
      hyperSpeed: bonus.hyperSpeed,
      jumpDist: bonus.jumpDist,
      marines: bonus.marines,
      jamming: bonus.jamming,
      cloakScanner: bonus.cloakScanner,
      reinfInhibit: bonus.reinfInhibit,
    };
    // a repair system slowly welds the hull back together
    if (bonus.repairSystem)
      this.ship.armorRechPerSec = Math.max(this.ship.armorRechPerSec, 0.5);
    if (bonus.cloak === 0) this.cloaked = false;

    this.ship.maxShield = type.shield + bonus.shield;
    this.ship.maxArmor = type.armor + bonus.armor;
    this.ship.shieldRechPerSec = type.shieldRechPerSec + bonus.shieldRech;
    this.ship.armorRechPerSec = bonus.armorRech;
    this.ship.shield = Math.min(this.ship.shield, this.ship.maxShield);
    this.ship.armor = Math.min(this.ship.armor, this.ship.maxArmor);
  }

  /**
   * Whether an outfit's weapons would overrun the hull's mounts, and which
   * pool ran out. Nothing is blocked for an outfit that carries no weapon, or
   * one whose weapons are missiles or fighter bays.
   */
  mountBlock(outfId: string): "gun" | "turret" | null {
    const outf = OUTFITS[outfId];
    if (!outf) return null;
    const fitted = countMounts(this.player.shipId, this.player.outfits);
    const limits = mountLimits(this.player.shipId, this.player.outfits);
    for (const mod of outf.mods) {
      if (mod.type !== 1) continue;
      const weap = WEAPONS[String(mod.val)];
      if (!weap) continue;
      const kind = mountKind(weap.guidance);
      if (kind === "gun" && fitted.guns >= limits.guns) return "gun";
      if (kind === "turret" && fitted.turrets >= limits.turrets)
        return "turret";
    }
    return null;
  }

  /** Fitted vs available mounts, for the outfitter's readout. */
  mountStatus(): {
    guns: number;
    turrets: number;
    maxGuns: number;
    maxTurrets: number;
  } {
    const fitted = countMounts(this.player.shipId, this.player.outfits);
    const limits = mountLimits(this.player.shipId, this.player.outfits);
    return {
      guns: fitted.guns,
      turrets: fitted.turrets,
      maxGuns: limits.guns,
      maxTurrets: limits.turrets,
    };
  }

  /** Free outfit mass remaining on the player's ship. */
  freeMassLeft(): number {
    const type = SHIPS[this.player.shipId];
    if (!type) return 0;
    // FreeMass excludes the hull's own stock weapons (Nova Bible), so their
    // mass is added back before the owned outfits — which now include them —
    // are charged against it.
    return (
      type.freeMass +
      hullOutfitMass(this.player.shipId) -
      outfitBonuses(this.player.outfits).mass
    );
  }

  /**
   * Buy a ship at the shipyard. Trade-in credits the old hull at 25%.
   *
   * The net was clamped at zero, so trading down handed the yard the
   * difference: a captured Leviathan (12,000,000, so 3,000,000 in trade)
   * bought a 10,000-credit Shuttle for "free" and the other 2,990,000
   * vanished. A negative price is change owed, and 69 of the 85 purchasable
   * hulls sit below a Leviathan's trade-in, so this is most of the lot once
   * you are flying a capital ship.
   */
  buyShip(shipId: string): { ok: boolean; reason?: string } {
    const type = SHIPS[shipId];
    const current = SHIPS[this.player.shipId];
    if (!type) return { ok: false, reason: "Unknown ship class." };
    const tradeIn = current ? Math.floor(current.cost * 0.25) : 0;
    const price = type.cost - tradeIn;
    if (this.player.credits < price) {
      return { ok: false, reason: "You cannot afford this ship." };
    }
    /*
     * The wing's holds come with you, so what has to fit here is the hull's
     * share: mission freight, which never leaves your own hold, plus whatever
     * commodities the escorts cannot take.
     */
    const fleet = fleetCargoCap(this.player);
    const mustFit =
      missionCargoUsed(this.player) +
      Math.max(0, commodityTons(this.player) - fleet);
    if (mustFit > type.cargo) {
      return {
        ok: false,
        reason: "Your cargo will not fit in this ship's hold.",
      };
    }
    this.player.credits -= price;
    this.keepPilotOutfits();
    grantHullOutfits(shipId, this.player.outfits);
    this.applyShipType(shipId);
    this.player.fuelJumps = type.fuelJumps; // delivered fully fueled
    const stock = stockAmmo(shipId);
    for (const [weapId, count] of Object.entries(stock)) {
      this.player.ammo[weapId] = ammoCapped(
        weapId,
        Math.max(this.player.ammo[weapId] ?? 0, count),
      );
    }
    return { ok: true };
  }

  // ---------------- update ----------------

  /**
   * In-flight DOM overlays that freeze the sim (boarding, hail, P/I/jettison).
   * The H floating minimap is canvas-only and does *not* count — flight keeps
   * running under it.
   */
  private flightOverlayOpen(): boolean {
    return this.infoUi.open || this.hailUi.open || this.plunderUi.open;
  }

  update(dt: number): void {
    // held weapon sounds are driven from here, not from the firing branch, so
    // that landing, jumping or dying with the trigger down still cuts them off
    this.updateFiringLoops();

    if (this.mode === "menu") {
      /*
       * Cold title (no paused pilot): living backdrop traffic. A session
       * paused with Esc freezes in place so Enter ship restores it unchanged.
       */
      if (!this.resumeMode) {
        this.time += dt;
        for (const npc of this.npcs) {
          npc.updateAi(dt);
          if (npc.landing) npc.done = true;
        }
        this.npcs = this.npcs.filter((n) => !n.done);
        if (this.npcs.length < 2) this.spawnNpc();
      }
      this.input.endFrame();
      return;
    }

    if (this.mode === "landed") {
      this.time += dt;
      this.updateGates(dt);
      /*
       * Mission log (I) is the same panel landed or in flight. LandedUi's
       * keydown also opens it (and swallows the key); this path covers a
       * mouse-bound missionInfo and any press that was not swallowed.
       */
      if (this.infoUi.open) {
        if (this.input.consume("Escape")) {
          if (!this.infoUi.handleEscape()) this.infoUi.close();
        } else if (actionConsume(this.input, "missionInfo")) {
          this.infoUi.close();
        } else if (
          this.input.consume("Enter") ||
          this.input.consume("NumpadEnter")
        ) {
          this.infoUi.handleEnter();
        } else if (this.input.consume("KeyA")) {
          this.infoUi.handleAbort();
        } else if (this.input.consume("ArrowDown")) {
          this.infoUi.handleArrow(1);
        } else if (this.input.consume("ArrowUp")) {
          this.infoUi.handleArrow(-1);
        } else {
          for (const [code, letter] of [
            ["KeyG", "g"], ["KeyC", "c"], ["KeyE", "e"],
            ["KeyH", "h"], ["KeyK", "k"],
          ] as const) {
            if (this.input.consume(code)) {
              this.infoUi.handleTabKey(letter);
              break;
            }
          }
        }
      } else if (actionConsume(this.input, "missionInfo")) {
        this.openMissionInfo();
      }
      this.input.endFrame();
      return; // DOM UI handles the counters
    }

    if (this.mode === "flight" && this.input.consume("Escape")) {
      // open overlays take Esc first (close them, don't quit to title)
      if (this.infoUi.open) {
        if (!this.infoUi.handleEscape()) this.infoUi.close();
        this.input.endFrame();
        return;
      }
      if (this.hailUi.open) {
        this.hailUi.close();
        this.input.endFrame();
        return;
      }
      if (this.plunderUi.open) {
        this.plunderUi.dismiss();
        this.input.endFrame();
        return;
      }
      /*
       * Mid-jump / gate bleach normally rides out without Esc (Nova). But a
       * disabled hull can get stuck in the jump align forever (no steering),
       * and you must always be able to open the menu when dead in space.
       */
      if (this.ship.disabled) {
        this.cancelJumpSequence();
        this.pendingGateDest = null;
        this.ship.gateFlash = 0;
        this.exitToMenu();
        this.input.endFrame();
        return;
      }
      if (this.jump || this.pendingGateDest) {
        this.input.endFrame();
        return;
      }
      this.exitToMenu();
      this.input.endFrame();
      return;
    }

    /*
     * Boarding / hail / info freeze the flight sim. Map mode also freezes
     * flight (handled below). The H floating minimap does not — it peeks
     * over a still-running system.
     */
    if (this.mode === "flight" && this.flightOverlayOpen()) {
      // Mission log keys while the panel freezes flight.
      if (this.infoUi.open) {
        if (
          this.input.consume("Enter") ||
          this.input.consume("NumpadEnter")
        ) {
          this.infoUi.handleEnter();
        } else if (this.input.consume("KeyA")) {
          this.infoUi.handleAbort();
        } else if (this.input.consume("ArrowDown")) {
          this.infoUi.handleArrow(1);
        } else if (this.input.consume("ArrowUp")) {
          this.infoUi.handleArrow(-1);
        } else {
          for (const [code, letter] of [
            ["KeyG", "g"], ["KeyC", "c"], ["KeyE", "e"],
            ["KeyH", "h"], ["KeyK", "k"],
          ] as const) {
            if (this.input.consume(code)) {
              this.infoUi.handleTabKey(letter);
              break;
            }
          }
        }
      } else if (this.hailUi.open) {
        for (const code of ["KeyG", "KeyO", "KeyA", "KeyL", "KeyD"] as const) {
          if (this.input.consume(code)) {
            this.hailUi.handleKey(code);
            break;
          }
        }
      }
      this.input.endFrame();
      return;
    }

    this.time += dt;

    // Gate chooser keys run first so Tab cycles destinations even when Tab is
    // also the map binding (e.g. Starsector preset). updateGateChooserKeys
    // consumes Tab only when the gate chooser is open; otherwise it's a no-op
    // and the map binding below can consume it normally.
    if (this.mode === "map") {
      this.updateGates(dt);
      this.updateGateChooserKeys();
      if (this.input.consume("Escape")) this.closeMap();
    }
    if (actionConsume(this.input, "map")) {
      if (this.mode === "map") this.closeMap();
      else if (this.mode === "flight") this.openMap();
    }

    // flight controls (also run under the map, EV-style time keeps passing? No — pause under map)
    if (this.mode === "flight") {
      this.updateFlight(dt);
    }

    this.input.endFrame();
  }

  /** Tab cycles linked gate systems (Shift-Tab reverse); map stays put. Enter travels. */
  private updateGateChooserKeys(): void {
    if (!this.gateChooser) return;
    const links = this.gateChooserSystemIds();
    if (!links.length) return;
    let idx = links.indexOf(this.mapSelected ?? "");
    if (idx < 0) idx = 0;
    if (this.input.consume("Tab")) {
      idx = this.input.shiftDown
        ? (idx - 1 + links.length) % links.length
        : (idx + 1) % links.length;
      this.mapSelected = links[idx];
    }
    if (this.input.consume("Enter") || this.input.consume("NumpadEnter")) {
      this.travelGateToSelected();
    }
  }

  /** Resolve the chooser selection to a HyperLink spöb and transit. */
  private travelGateToSelected(): void {
    if (!this.gateChooser || !this.mapSelected) return;
    const dest = this.gateDestinations(this.gateChooser).find((d) => {
      const e = SPOBS.get(d.spobId);
      return e?.systemId === this.mapSelected;
    });
    if (!dest) {
      this.message("That system is not on this gate's network.");
      return;
    }
    this.useGate(dest.spobId);
  }

  private updateFlight(dt: number): void {
    const sys = this.system;

    // death sequence: no controls, but explosions must keep animating
    if (this.playerDeath) {
      this.updatePlayerDeath(dt);
      this.advanceExplosions(dt);
      return;
    }

    /*
     * Jump becomes possible (course set, outside the well, fuel ≥ 1): the HUD
     * address goes full opacity and we chirp 154 so you know J will take now.
     * Does not fire on mid-route arrivals (wasJumpPossible stays true across
     * the jump) or when the tank is dry.
     */
    const inWell = this.insideNoJumpZone();
    const jumpPossible =
      this.route.length > 0 && !inWell && this.player.fuelJumps >= 1;
    if (jumpPossible && !this.wasJumpPossible) {
      playSnd(SND.DENY, 0.45); // 154
    }
    this.wasJumpPossible = jumpPossible;

    /*
     * Gate enter flash: hull bleaches white on the pad, then transit. Controls
     * are locked so you stay centred on the ring.
     */
    if (this.pendingGateDest) {
      this.ship.vel = { x: 0, y: 0 };
      this.ship.thrusting = false;
      this.ship.gateFlash = Math.min(
        1,
        this.ship.gateFlash + dt / GATE_ENTER_FLASH,
      );
      this.updateGates(dt);
      if (this.ship.gateFlash >= 1) {
        const dest = this.pendingGateDest;
        this.pendingGateDest = null;
        this.applyGateTransit(dest);
      }
      return;
    }

    // exit flash: recolour from white after emerging
    if (this.ship.gateFlash > 0) {
      this.ship.gateFlash = Math.max(
        0,
        this.ship.gateFlash - dt / GATE_EXIT_FLASH,
      );
    }

    if (this.jump) {
      this.updateJumpSequence(dt);
    } else {
      // Hold aim-cursor: steer at the pointer each frame; left/right are ignored.
      const aimCursor = actionDown(this.input, "aimCursor");
      let turn = aimCursor
        ? 0
        : (actionDown(this.input, "turnLeft") ? -1 : 0) +
          (actionDown(this.input, "turnRight") ? 1 : 0);
      const thrust = actionDown(this.input, "accelerate");
      // Down swings the nose onto the reverse of your course, so a burn slows
      // you; inertialess hulls simply stop instead
      const braking = actionDown(this.input, "reverse");
      // Hold aim-assist: auto-turn toward the selected ship or stellar
      const aimAssist =
        !aimCursor &&
        turn === 0 &&
        !braking &&
        actionDown(this.input, "aimAssist");
      // touching the controls takes the ship back off the autopilot
      if (
        this.autopilot &&
        (turn !== 0 || thrust || braking || aimAssist || aimCursor)
      ) {
        this.autopilot = false;
        this.message("Autopilot disengaged.");
      }
      if (this.autopilot) {
        // the autopilot has the stick; the command keys below still answer
        if (!this.updateAutopilot(dt)) {
          this.autopilot = false;
          this.message("Autopilot disengaged.");
        }
      } else {
        if (braking) {
          if (this.inertialess) {
            this.ship.vel.x *= Math.max(0, 1 - 2.5 * dt);
            this.ship.vel.y *= Math.max(0, 1 - 2.5 * dt);
          } else if (this.ship.speed > 1) {
            const retro = Math.atan2(-this.ship.vel.y, -this.ship.vel.x);
            this.ship.steerToward(dt, retro);
            turn = 0;
          }
        } else if (aimCursor) {
          // Rate-limited turn toward the cursor; clamps so one frame cannot overshoot.
          const aim = this.cursorWorldPoint();
          this.ship.steerToward(
            dt,
            Math.atan2(aim.y - this.ship.pos.y, aim.x - this.ship.pos.x),
          );
          turn = 0;
        } else if (aimAssist) {
          const aim = this.selectedAimPoint();
          if (aim) {
            this.ship.steerToward(
              dt,
              Math.atan2(aim.y - this.ship.pos.y, aim.x - this.ship.pos.x),
            );
            turn = 0; // steerToward already applied the turn
          }
        }
        // afterburner: hold to trade fuel for speed (100 units = 1 jump)
        // Implies thrust — activating the burner accelerates the ship even
        // without the thrust key held.
        this.afterburning =
          this.afterburnerBurn > 0 &&
          actionDown(this.input, "afterburner") &&
          this.player.fuelJumps > 0.05;
        if (this.inertialess && !thrust && !braking) {
          // an inertialess hull holds station the moment you stop pushing
          this.ship.vel.x *= Math.max(0, 1 - 3 * dt);
          this.ship.vel.y *= Math.max(0, 1 - 3 * dt);
        }
        if (this.ship.ionized) {
          // ionized: engines barely respond
          this.ship.vel.x *= Math.max(0, 1 - 1.5 * dt);
          this.ship.vel.y *= Math.max(0, 1 - 1.5 * dt);
        }
        if (this.afterburning) {
          this.player.fuelJumps = Math.max(
            0,
            this.player.fuelJumps - (this.afterburnerBurn / 100) * dt,
          );
          const base = this.ship.stats;
          this.ship.stats = {
            ...base,
            maxSpeed: base.maxSpeed * 1.5,
            accel: base.accel * 3,
          };
          this.ship.update(dt, turn as -1 | 0 | 1, true);
          this.ship.stats = base;
        } else {
          this.ship.update(dt, turn as -1 | 0 | 1, thrust);
        }
      }

      // Bound in Preferences; defaults match Nova with arrow-key flight.
      if (actionConsume(this.input, "land")) this.selectOrLand();
      if (actionConsume(this.input, "cycleStellars")) this.cycleStellars();
      /*
       * Jump engages the hyperdrive. A press reports why it cannot (no course,
       * gravity well, fuel). Holding keeps trying quietly so you can:
       *  - fly out of the no-jump zone with jump held and leave the moment you clear it
       *  - ride a multi-system plot without re-tapping after each arrival
       */
      if (actionConsume(this.input, "jump")) this.startJump(false);
      else if (actionDown(this.input, "jump")) this.startJump(true);
      if (consumeCycleTargets(this.input)) this.cycleTarget();
      if (actionConsume(this.input, "targetClosest")) this.targetClosest();
      if (actionConsume(this.input, "selectUnderCursor"))
        this.selectUnderCursor();
      if (actionConsume(this.input, "hail")) this.hailTarget();
      if (actionConsume(this.input, "board")) this.tryBoard();
      if (actionConsume(this.input, "cloak")) this.toggleCloak();
      // audio: - / = ride the master gain, 0 mutes (not rebindable)
      if (this.input.consume("Minus")) this.nudgeVolume(-0.1);
      if (this.input.consume("Equal")) this.nudgeVolume(0.1);
      if (this.input.consume("Digit0")) {
        this.message(toggleMuted() ? "Sound muted." : "Sound unmuted.");
      }
      if (actionConsume(this.input, "selectSecondary")) this.cycleSecondary();
      if (actionConsume(this.input, "escortAttack"))
        this.orderEscorts("attack");
      if (actionConsume(this.input, "escortForm")) this.orderEscorts("defend");
      if (actionConsume(this.input, "escortHold")) this.orderEscorts("hold");
      if (actionConsume(this.input, "recallFighters")) this.recallFighters();
      if (actionConsume(this.input, "selfDestruct")) this.selfDestruct();
      else if (actionConsume(this.input, "autopilot")) this.toggleAutopilot();
      /*
       * Display mini map (default H): show the floating chart only — does not
       * change the jump selection. Hold keeps it up; release fades it out.
       * Select jump destination (default \): step the course and peek the map.
       */
      if (actionConsume(this.input, "cycleJumpDest")) {
        this.cycleJumpDestination();
        this.peekFloatingMap();
      }
      if (
        actionConsume(this.input, "hyperSelect") ||
        actionDown(this.input, "hyperSelect")
      ) {
        this.peekFloatingMap();
      }
      if (actionConsume(this.input, "navOff")) this.navOff();
      if (actionConsume(this.input, "eject")) this.ejectFromShip();
      if (actionConsume(this.input, "playerInfo")) this.openPlayerInfo();
      if (actionConsume(this.input, "missionInfo")) this.openMissionInfo();
      if (actionConsume(this.input, "jettison")) this.openJettison();
      this.updateWeapons(dt);
    }

    this.updateGates(dt);
    this.updateScans(dt);
    /*
     * Hulls whose extra sprite sets are folding parts (shän Flags 0x0002) stow
     * them for landing and hyperspace and put them back out in open flight —
     * the Bible has the sprites "cycled upon landing, taking off, and
     * entering/exiting hyperspace". Flag 0x0080 instead ties the same
     * animation to the trigger, so those hulls unfold to shoot.
     */
    this.ship.unfolding =
      this.ship.sprite && this.ship.sprite.flags & SHAN_UNFOLD_FIRING
        ? actionDown(this.input, "firePrimary") &&
          !this.ship.ionized &&
          !this.ship.disabled
        : this.jump === null;
    this.ship.advanceAnimation(dt);
    for (const npc of this.npcs) npc.advanceAnimation(dt);
    this.ship.rechargeShields(dt);
    this.ship.dissipateIon(dt);
    for (const npc of this.npcs) npc.dissipateIon(dt);
    this.updateReinforcements(dt);
    this.updatePendingReinforcement();
    this.updateCloak(dt);
    // fuel scoops top the tanks back up over time
    if (
      this.fuelScoopRate > 0 &&
      this.player.fuelJumps < this.player.maxFuelJumps
    ) {
      this.player.fuelJumps = Math.min(
        this.player.maxFuelJumps,
        this.player.fuelJumps + (this.fuelScoopRate / 100) * dt,
      );
    }
    if (this.jumpFlash > 0) this.jumpFlash -= dt;

    // NPCs
    this.npcSpawnTimer -= dt;
    if (this.npcSpawnTimer <= 0) {
      this.npcSpawnTimer = 8 + Math.random() * 10;
      if (this.npcs.length < sys.traffic + 1) {
        // now and then a whole formation shows up instead of a single ship
        if (this.npcs.length < sys.traffic - 1 && Math.random() < 0.15)
          this.spawnFleet();
        else this.spawnNpc();
      }
    }
    // Abort a fuel transfer if the helper has been destroyed or turned hostile.
    if (
      this.fuelHelper &&
      (this.fuelHelper.done ||
        this.fuelHelper.hostile ||
        !this.npcs.includes(this.fuelHelper))
    ) {
      this.message("Fuel transfer aborted.");
      this.fuelHelper = null;
    }
    for (const npc of this.npcs) {
      npc.rechargeShields(dt);
      // stray-fire memory fades — a burst of crossfire is forgiven over ~10s
      if (npc.strayDamage > 0)
        npc.strayDamage = Math.max(
          0,
          npc.strayDamage - (npc.maxShield + npc.maxArmor) * 0.1 * dt,
        );
      if (npc === this.fuelHelper) {
        this.updateFuelHelperAi(npc, dt);
      } else if (npc.escorting && !npc.disabled && !npc.hostile) {
        // the ship you're escorting flies with you
        this.updateEscorteeAi(npc, dt);
      } else if (npc.ionized && !npc.disabled) {
        // ionized: barely under control
        npc.pos.x += npc.vel.x * dt * 0.3;
        npc.pos.y += npc.vel.y * dt * 0.3;
      } else if (npc.disabled) {
        // dead in space: no thrust, no guns, no errands — residual drift only
        npc.landing = false;
        npc.cloaked = false;
        npc.update(dt, 0, false);
      } else if (npc.ally) this.updateAllyAi(npc, dt);
      else if (npc.hostile) this.updateHostileAi(npc, dt);
      else if (npc.aiType === 3 || npc.aiType === 4)
        this.updateWarshipAi(npc, dt);
      else npc.updateAi(dt);
      if (!npc.disabled) {
        this.maybeOpenGateForNpc(npc);
        if (npc.landing) this.dockNpc(npc, dt);
      }
    }
    this.updateDockedNpcs(dt);
    this.npcs = this.npcs.filter((n) => !n.done);
    if (
      this.targetNpc &&
      (this.targetNpc.done || !this.npcs.includes(this.targetNpc))
    ) {
      this.targetNpc = null;
    }

    this.updateAsteroids(dt);
    this.updateMissionWatch(dt);
    this.updateProjectiles(dt);
    this.updatePointDefense(dt);
    this.updateBeams(dt);
    this.advanceExplosions(dt);
  }

  private advanceExplosions(dt: number): void {
    for (const fx of this.explosions) fx.t += dt;
    this.explosions = this.explosions.filter((fx) => {
      const sheet = BOOM_SPRITES[fx.boomId];
      return sheet ? fx.t * fx.fps < sheet.frames : fx.t < 0.5;
    });
  }

  // ---------------- combat ----------------

  /**
   * Point the nose at this — selected ship first, else the selected stellar.
   * Used by hold-A aim assist.
   */
  private selectedAimPoint(): { x: number; y: number } | null {
    if (this.targetNpc && !this.targetNpc.done) {
      // Lead the target using the first forward-firing primary's speed so
      // hold-A steers toward the intercept point rather than current position.
      const fwdPrimary = this.weaponSlots.find(
        (s) => isPrimary(s.weap) && !isTurret(s.weap) && !isBeam(s.weap) && s.weap.speed > 0,
      );
      if (fwdPrimary) {
        return leadPoint(this.ship, this.targetNpc, fwdPrimary.weap.speed);
      }
      return this.targetNpc.pos;
    }
    if (this.targetPlanet) return this.targetPlanet.pos;
    return null;
  }

  /**
   * World-space point under the cursor in the flight view (camera centred on
   * the player). Used by aim-cursor; safe even when the pointer is over the HUD.
   */
  private cursorWorldPoint(): { x: number; y: number } {
    const viewW = this.viewW - SIDEBAR_W;
    // Clamp into the playfield so aiming into the sidebar still aims past the edge
    const mx = Math.max(0, Math.min(viewW, this.mouse.x));
    const my = Math.max(0, Math.min(this.viewH, this.mouse.y));
    return {
      x: mx - viewW / 2 + this.ship.pos.x,
      y: my - this.viewH / 2 + this.ship.pos.y,
    };
  }

  /** Cloaked ships hide from targeting unless your scanner can see them. */
  private canSee(npc: NpcShip): boolean {
    if (!npc.cloaked) return true;
    return (this.gear.cloakScanner & 0x000f) !== 0;
  }

  private cycleTarget(): void {
    // Allies/escorts are only pickable with select-under-cursor, not R / `.
    const visible = this.npcs.filter((n) => this.canSee(n) && !n.ally);
    if (visible.length === 0) {
      this.targetNpc = null;
      this.message("No contacts on sensors.");
      return;
    }
    /*
     * Cycle contacts then clear the lock (no one), then start again — so you
     * can deselect without a separate key: A → B → … → last → none → A …
     */
    const idx = this.targetNpc ? visible.indexOf(this.targetNpc) : -1;
    if (idx < 0) {
      // nothing locked, or the lock left the list — take the first contact
      this.targetNpc = visible[0]!;
    } else if (idx >= visible.length - 1) {
      this.targetNpc = null;
    } else {
      this.targetNpc = visible[idx + 1]!;
    }
    this.targetPlanet = null;
    // Beep3 — the short select click; used to be played only as a jump refusal
    playSnd(SND.TARGET, 0.45);
  }

  govtLabel(govtId: number): string {
    return govtId >= 128
      ? (GOVT_NAMES[String(govtId)] ?? "Unaffiliated")
      : "Independent";
  }

  /** Step the master volume and confirm it with a beep at the new level. */
  private nudgeVolume(delta: number): void {
    setVolume(getVolume() + delta);
    const pct = Math.round(getVolume() * 100);
    this.message(`Volume ${pct}%.`);
    playSnd(SND.BEEP1, 0.6);
  }

  private toggleCloak(): void {
    if (this.cloakFlags === 0) {
      this.message("No cloaking device fitted.");
      return;
    }
    this.cloaked = !this.cloaked;
    if (this.cloaked && (this.cloakFlags & CLOAK_DROPS_SHIELDS) !== 0)
      this.ship.shield = 0;
    playSnd(this.cloaked ? SND.CLOAK_ON : SND.CLOAK_OFF, 0.4);
    this.message(
      this.cloaked ? "Cloaking device engaged." : "Cloaking device disengaged.",
    );
  }

  /** Cloaks burn fuel and/or shields, and collapse when the tank runs dry. */
  private updateCloak(dt: number): void {
    if (!this.cloaked) return;
    const fuelDrain = cloakFuelDrain(this.cloakFlags);
    const shieldDrain = cloakShieldDrain(this.cloakFlags);
    if (fuelDrain > 0) {
      this.player.fuelJumps = Math.max(
        0,
        this.player.fuelJumps - (fuelDrain / 100) * dt,
      );
      if (this.player.fuelJumps <= 0) {
        this.cloaked = false;
        this.message("Cloaking device fails — out of fuel.");
        return;
      }
    }
    if (shieldDrain > 0) {
      this.ship.shield = Math.max(0, this.ship.shield - shieldDrain * dt);
      if (this.ship.shield <= 0) {
        this.cloaked = false;
        this.message("Cloaking device fails — shields exhausted.");
      }
    }
  }

  /**
   * A stellar's defence fleet. DefCount over 1000 encodes waves:
   * the last digit is ships per wave, the leading digits (less 1 from the
   * first) are the total — so 1082 is four waves of two, eight in all.
   */
  private defenceFleetSize(planet: PlanetDef): {
    total: number;
    perWave: number;
  } {
    const raw = planet.defCount;
    if (raw <= 0) return { total: 0, perWave: 0 };
    if (raw <= 1000) return { total: raw, perWave: Math.min(raw, 4) };
    const perWave = raw % 10;
    const total = Math.floor(raw / 10) - 100;
    return { total: Math.max(0, total), perWave: Math.max(1, perWave) };
  }

  /** Provoke a world's defenders, or claim it once they're gone. */
  private tryDominate(planet: PlanetDef): void {
    const dist = Math.hypot(
      planet.pos.x - this.ship.pos.x,
      planet.pos.y - this.ship.pos.y,
    );
    if (dist > planet.radius * 3 + 400) {
      this.message(`Move closer to ${planet.name} to press the demand.`);
      return;
    }
    if (planet.uninhabited || !planet.landable) {
      this.message(`${planet.name} has nothing to surrender.`);
      return;
    }
    if (this.player.dominated.includes(planet.id)) {
      // release it again
      this.player.dominated = this.player.dominated.filter(
        (id) => id !== planet.id,
      );
      applySet(planet.onRelease, this.player.bits, this.bitHandlers());
      this.message(`You release ${planet.name} from tribute.`);
      return;
    }

    const fleet = this.defenceFleetSize(planet);
    const remaining = this.domination.get(planet.id) ?? fleet.total;
    if (fleet.total === 0) {
      this.completeDomination(planet);
      return;
    }
    const alive = this.npcs.filter(
      (n) => n.defenderOf === planet.id && !n.done,
    ).length;
    if (remaining <= 0) {
      this.completeDomination(planet);
      return;
    }
    if (alive > 0) {
      this.message(
        `${planet.name}'s defenders are still up: ${remaining} left.`,
      );
      return;
    }
    this.launchDefenders(planet, fleet.perWave, remaining);
  }

  private launchDefenders(
    planet: PlanetDef,
    perWave: number,
    remaining: number,
  ): void {
    const dude = DUDES[String(planet.defDude)];
    const wave = Math.min(perWave, remaining);
    if (!dude || wave <= 0) {
      this.completeDomination(planet);
      return;
    }
    this.domination.set(planet.id, remaining);
    for (let i = 0; i < wave; i++) {
      const pick = this.weightedPick(dude.ships);
      const typeId = pick && SHIPS[String(pick.id)] ? String(pick.id) : null;
      if (!typeId) continue;
      const type = SHIPS[typeId];
      const npc = new NpcShip({
        turnRate: type.turnRate,
        accel: type.accel,
        maxSpeed: type.maxSpeed,
      });
      npc.typeId = typeId;
      npc.govtId = dude.govt >= 128 ? dude.govt : inherentCombatGovt(typeId);
      this.setNpcHostile(npc);
      npc.defenderOf = planet.id;
      npc.initDefense(
        type.shield,
        type.armor,
        type.shieldRechPerSec,
        (type.flags & 0x10) !== 0 ? 0.1 : 0.33,
      );
      npc.sprite = SHIP_SPRITES[typeId] ?? null;
      const ang = Math.random() * Math.PI * 2;
      npc.pos = {
        x: planet.pos.x + Math.cos(ang) * (planet.radius + 60),
        y: planet.pos.y + Math.sin(ang) * (planet.radius + 60),
      };
      npc.angle = ang;
      this.npcs.push(npc);
    }
    this.message(
      `${planet.name} launches its defence fleet — ${remaining} ships remain.`,
    );
  }

  private completeDomination(planet: PlanetDef): void {
    this.player.dominated.push(planet.id);
    this.domination.delete(planet.id);
    applySet(planet.onDominate, this.player.bits, this.bitHandlers());
    const daily = planet.tribute > 0 ? planet.tribute : planet.techLevel * 1000;
    this.message(
      `${planet.name} submits. Tribute: ${daily.toLocaleString()} cr per day.`,
    );
    playSnd(152, 0.5);
  }

  /** Rank names for mission-text substitution. */
  rankTags(): { conv: string; short: string } {
    const rank = this.topRank();
    return { conv: rank?.convName ?? "", short: rank?.shortName ?? "" };
  }

  /** Highest-weighted rank the player holds, optionally for one government. */
  topRank(govtId?: number): RankType | null {
    let best: RankType | null = null;
    for (const id of this.player.ranks) {
      const rank = RANKS[String(id)];
      if (!rank) continue;
      if (govtId !== undefined && rank.govt !== govtId) continue;
      if (!best || rank.weight > best.weight) best = rank;
    }
    return best;
  }

  /** How this government's worlds price their goods for you. */
  priceMultiplier(govtId: number): number {
    const rank = this.topRank(govtId);
    return rank && rank.priceMod > 0 ? rank.priceMod / 100 : 1;
  }

  /**
   * Will this world clear you to land? spöb MinStatus against your record with
   * whichever government owns it, plus the two things the Bible lets override
   * it: a world you have already dominated no longer gets a say, and ränk
   * Flags 0x0200 is "all planets of the affiliated government will let the
   * player land when he has this rank, regardless of their MinStatus field"
   * — 19 of the 31 ranks carry it, among them the Federation Naval Rank of
   * Commander and the Vell-os T0-T5 ladder.
   */
  clearedToLand(planet: PlanetDef, systemGovtId: number): boolean {
    if (this.player.dominated.includes(planet.id)) return true;
    if (this.bribedPlanets.has(planet.id)) return true;
    const govtId = landingGovtId(planet, systemGovtId);
    if (govtId >= 128 && this.rankFlag(govtId, 0x0200)) return true;
    // Block landing while a tribute siege is active (fleet not yet defeated, or
    // fleet defeated but planet not yet formally submitted on a second demand).
    if (this.domination.has(planet.id)) return false;
    const govtRecord = getRecord(this.player, govtId);
    const planetRecord = (this.player.planetRecords ?? {})[planet.id];
    const record = planetRecord !== undefined ? planetRecord : govtRecord;
    return landingAllowed(planet, record);
  }

  /**
   * Call the system's own ReinfFleet in on the player's side. Nova ties this to
   * ränk Flags 0x0400; the fleet and its delay are the system's, the same pair
   * the hostile call uses.
   */
  private callReinforcementsFor(govtId: number): void {
    if (this.pendingReinforcement) return;
    const sys = this.system;
    const fleet =
      sys.reinfFleet !== null
        ? FLEETS.find((f) => f.id === sys.reinfFleet)
        : null;
    if (!fleet) return;
    this.pendingReinforcement = { fleet, at: this.time + sys.reinfDelay };
    this.message(`${this.govtLabel(govtId)} reinforcements are on the way.`);
  }

  /** Some ranks buy you safe passage. */
  private rankFlag(govtId: number, bit: number): boolean {
    for (const id of this.player.ranks) {
      const rank = RANKS[String(id)];
      if (rank && rank.govt === govtId && (rank.flags & bit) !== 0) return true;
    }
    return false;
  }

  private grantRank(rankId: number): void {
    const rank = RANKS[String(rankId)];
    if (!rank || this.player.ranks.includes(rankId)) return;
    // 0x0001 / 0x0010: taking this commission supersedes others from the same govt
    if ((rank.flags & 0x0011) !== 0) {
      this.player.ranks = this.player.ranks.filter((id) => {
        const other = RANKS[String(id)];
        if (!other || other.govt !== rank.govt) return true;
        if ((other.flags & 0x0008) !== 0) return true; // permanent
        if ((rank.flags & 0x0010) !== 0 && other.weight > rank.weight)
          return true;
        return false;
      });
    }
    this.player.ranks.push(rankId);
    this.message(`You are granted the rank of ${rank.convName || rank.name}.`);
    playSnd(152, 0.4);
  }

  private revokeRank(rankId: number): void {
    const rank = RANKS[String(rankId)];
    if (!rank || !this.player.ranks.includes(rankId)) return;
    if ((rank.flags & 0x0008) !== 0) return; // permanent ranks stay
    this.player.ranks = this.player.ranks.filter((id) => id !== rankId);
    this.message(`You have lost the rank of ${rank.convName || rank.name}.`);
  }

  /** Commissions pay a salary, up to their cap. */
  private collectSalary(): void {
    if (this.player.ranks.length === 0) return;
    const days =
      Math.floor(this.player.date) - Math.floor(this.player.salaryDay);
    if (days <= 0) return;
    this.player.salaryDay = Math.floor(this.player.date);
    let total = 0;
    for (const id of this.player.ranks) {
      const rank = RANKS[String(id)];
      if (rank && rank.salary > 0) total += rank.salary * days;
    }
    if (total > 0) {
      this.player.credits += total;
      this.message(`Salary received: ${total.toLocaleString()} cr.`);
    }
  }

  /** Dominated worlds pay up as the days pass. */
  private collectTribute(): void {
    if (this.player.dominated.length === 0) return;
    const days =
      Math.floor(this.player.date) - Math.floor(this.player.tributeDay);
    if (days <= 0) return;
    this.player.tributeDay = Math.floor(this.player.date);
    let total = 0;
    for (const id of this.player.dominated) {
      const entry = SPOBS.get(id);
      if (!entry) continue;
      const p = entry.planet;
      total += (p.tribute > 0 ? p.tribute : p.techLevel * 1000) * days;
    }
    if (total > 0) {
      this.player.credits += total;
      this.message(`Tribute received: ${total.toLocaleString()} cr.`);
    }
  }

  /** Board a disabled ship: plunder its hold, or answer its distress call. */
  private tryBoard(): void {
    const t = this.targetNpc;
    if (!t) {
      this.message(
        `No target selected. Press ${formatChord(getBinding("cycleTargets"))} to select a ship.`,
      );
      return;
    }
    if (!t.disabled) {
      this.message(
        `${this.shipLabel(t)} is not disabled — you cannot board it.`,
      );
      return;
    }
    const dist = Math.hypot(
      t.pos.x - this.ship.pos.x,
      t.pos.y - this.ship.pos.y,
    );
    if (dist > 20) {
      this.message("Too far away to board. Get closer.");
      return;
    }
    const rel = Math.hypot(
      t.vel.x - this.ship.vel.x,
      t.vel.y - this.ship.vel.y,
    );
    if (rel > 90) {
      this.message("Matching velocity failed — slow down to board.");
      return;
    }
    playSnd(SND.AIRLOCK, 0.45);

    // a mission special ship that wanted boarding is satisfied now
    this.creditBoardGoal(t);

    // a named captain may have something to say — or offer
    if (t.personId !== null) {
      const person = PERSONS[String(t.personId)];
      if (person && person.linkMission >= 128) {
        this.offerPersonMission(person);
        return;
      }
    }

    // Boarding a disabled escort reactivates it rather than plundering it.
    if (t.hired || t.ally) {
      const limp = t.maxArmor * t.disableAt + t.maxArmor * 0.05;
      t.armor = Math.min(t.maxArmor, limp);
      t.disabled = false;
      this.message(`${this.shipLabel(t)} reactivated.`);
      return;
    }

    if (t.boarded) {
      this.message(`${this.shipLabel(t)} has already been stripped.`);
      return;
    }
    this.openPlunder(t);
  }

  /**
   * Roll the victim's manifest once, then hand it to the plunder dialog. The
   * düde's Booty flags decide what's aboard: 0x40 money, 0x01-0x20 the six
   * commodities.
   */
  private openPlunder(t: NpcShip): void {
    // Both ships come to a dead stop when the boarding party crosses over.
    this.ship.vel.x = 0;
    this.ship.vel.y = 0;
    t.vel.x = 0;
    t.vel.y = 0;
    const hold: PlunderHold = { credits: 0, cargo: {}, ammo: {}, energy: 0 };
    if (t.booty > 0 && (t.bootyFlags & 0x40) !== 0) hold.credits = t.booty;
    else if (t.booty > 0) hold.credits = t.booty;
    for (const [i, c] of COMMODITIES.entries()) {
      if ((t.bootyFlags & (1 << i)) === 0) continue;
      hold.cargo[c.id] = Math.max(1, 1 + Math.floor(Math.random() * 5));
    }
    // their reactors are worth siphoning if you're short a jump
    hold.energy = this.player.fuelJumps < this.player.maxFuelJumps ? 100 : 0;
    // rounds for any ammo weapon you both carry
    for (const slot of this.weaponSlots) {
      if (slot.weap.ammoType < 0) continue;
      const carried =
        (t.typeId ? SHIPS[t.typeId]?.stockWeapons : undefined) ?? [];
      if (carried.some((w) => String(w.id) === slot.weap.id)) {
        hold.ammo[slot.weap.id] = 2 + Math.floor(Math.random() * 6);
      }
    }

    const crew = Math.max(1, (t.typeId ? SHIPS[t.typeId]?.crew : 0) || 10);
    // Without a marine platoon you can still rush them with your own crew, but
    // spacers are not soldiers: they count for a quarter of what marines do,
    // and a hull with no crew of its own musters a token party of two.
    const myCrew = Math.max(2, SHIPS[this.player.shipId]?.crew ?? 0);
    // ModType 25 marines split by sign per the Bible:
    //   positive ModVal → adds to effective crew (trained fighters count fully)
    //   negative ModVal → direct percentage boost (e.g. -5 → +5% capture odds)
    // Untrained spacers count for a quarter of their number; marines add on top.
    const marineCrew = Math.max(0, this.gear.marines);
    const marineBonus = this.gear.marines < 0 ? -this.gear.marines / 100 : 0;
    const withMarines = marineCrew > 0;
    const effectiveCrew = myCrew * 0.25 + marineCrew;
    const odds = t.typeId && !t.ally
      ? Math.min(0.75, effectiveCrew / (effectiveCrew + crew) + marineBonus)
      : null;

    /*
     * A named captain can hand over an outfit when boarded: përs GrantClass
     * names an oütf ItemClass and Nova "will choose a random outfit item of
     * that ItemClass". Exactly one captain in the shipped game uses it — 162
     * "Dr Ralph", granting class 25, and the only outfit carrying ItemClass 25
     * is "Dr Ralph's Exploration Map", so the two fields confirm each other.
     *
     * GrantProb and GrantCount are read in the Bible's stated order, which
     * cannot be checked against a second sample; see the note in CLAUDE.md.
     */
    const grantLoot = (): string | null => {
      const person = t.personId !== null ? PERSONS[String(t.personId)] : null;
      if (!person || person.grantClass <= 0) return null;
      if (Math.random() * 100 >= Math.max(1, person.grantProb)) return null;
      const pool = Object.values(OUTFITS).filter(
        (o) => o.itemClass === person.grantClass,
      );
      if (!pool.length) return null;
      const pick = pool[Math.floor(Math.random() * pool.length)];
      const max = Math.max(1, person.grantCount);
      const qty = Math.max(
        1,
        Math.floor(max / 2 + Math.random() * (max / 2 + 1)),
      );
      this.player.outfits[pick.id] = (this.player.outfits[pick.id] ?? 0) + qty;
      this.recomputeLoadout();
      return qty > 1
        ? `${qty} x ${pick.name.split(";")[0]}`
        : pick.name.split(";")[0];
    };

    const strip = () => {
      t.boarded = true;
      const granted = grantLoot();
      if (granted) this.message(`They hand over ${granted}.`);
      // piracy is a crime, and the victim's government notices
      if (t.govtId >= 128) applyCrime(this.player, t.govtId, "kill");
    };

    this.plunderUi.show({
      shipName: this.shipLabel(t),
      hold,
      captureOdds: odds,
      freeCargo: freeCommoditySpace(this.player),
      take: (what) => {
        // Each boarding action risks triggering a reactor explosion (10%).
        const maybeExplode = (note: string) => {
          if (Math.random() < 0.1) {
            this.destroyNpc(t, true);
            return { note, shipLost: true };
          }
          return { note, shipLost: false };
        };

        if (what === "credits") {
          this.player.credits += hold.credits;
          const note = `Took ${hold.credits.toLocaleString()} credits.`;
          hold.credits = 0;
          strip();
          return maybeExplode(note);
        }
        if (what === "energy") {
          this.player.fuelJumps = this.player.maxFuelJumps;
          hold.energy = 0;
          strip();
          return maybeExplode("You filled your reactors with energy from this ship.");
        }
        if (what === "ammo") {
          const taken: string[] = [];
          for (const [wid, rounds] of Object.entries(hold.ammo)) {
            this.player.ammo[wid] = ammoCapped(
              wid,
              (this.player.ammo[wid] ?? 0) + rounds,
            );
            taken.push(
              `${rounds} ${WEAPONS[wid]?.name.split(";")[0] ?? "rounds"}`,
            );
            delete hold.ammo[wid];
          }
          strip();
          const note = taken.length
            ? `Took ${taken.join(", ")}.`
            : "Nothing to take.";
          return maybeExplode(note);
        }
        // cargo: fill what space you have, heaviest hold first
        let space = freeCommoditySpace(this.player);
        const taken: string[] = [];
        for (const [id, tons] of Object.entries(hold.cargo)) {
          if (space <= 0) break;
          const n = Math.min(space, tons);
          this.player.cargo[id] = (this.player.cargo[id] ?? 0) + n;
          space -= n;
          if (n >= tons) delete hold.cargo[id];
          else hold.cargo[id] = tons - n;
          taken.push(
            `${n}t ${COMMODITIES.find((c) => c.id === id)?.name ?? id}`,
          );
        }
        strip();
        const note = taken.length
          ? `Took ${taken.join(", ")}.`
          : "No room in your hold.";
        return maybeExplode(note);
      },
      capture: (): CaptureResult => {
        // One attempt only — mark boarded immediately so re-boarding is
        // blocked regardless of outcome.
        t.boarded = true;
        if (odds === null || !t.typeId) return { taken: false, note: "" };
        if (Math.random() < odds) {
          // Outcome 1: success
          const captured = t.typeId;
          t.done = true;
          if (this.targetNpc === t) this.targetNpc = null;
          this.pendingPrize = captured;
          this.message(
            withMarines
              ? `Your marines take the ${this.hullName(captured)}!`
              : `Your crew storms the ${this.hullName(captured)} and takes her!`,
          );
          return {
            taken: true,
            prize: this.hullName(captured),
            yourShip: this.hullName(this.player.shipId),
            roomInWing: this.player.escorts.length < MAX_ESCORTS,
          };
        }
        // Outcome 2: ship explodes / Outcome 3: boarding party ejected
        if (Math.random() < 0.5) {
          this.destroyNpc(t, true);
        } else {
          this.message(
            withMarines
              ? "The assault is thrown back — your boarding party is ejected."
              : "Your crew is thrown back off the boarding tube.",
          );
        }
        return { taken: false, note: "" };
      },
      claim: (choice) => this.claimPrize(choice),
      close: () => {
        this.claimPrize("escort"); // walking away still leaves the prize taken
      },
    });
  }

  /** A prize taken but not yet assigned — the plunder panel is asking. */
  private pendingPrize: string | null = null;

  /** The hull's plain class name, without Nova's ";variant" suffix. */
  private hullName(shipId: string): string {
    return SHIPS[shipId]?.name.split(";")[0] ?? "ship";
  }

  /**
   * Settle a captured ship. Nova's two options, both of which the shïp
   * resource is built for: fly her yourself, in which case your old hull drops
   * back into the wing (shïp OnRetire is "evaluated when you sell a ship of
   * this type and/or replace it with a captured ship"), or keep your own ship
   * and add the prize to your escorts (EscSellValue is what "a captured
   * escort" fetches when you later sell her).
   */
  private claimPrize(choice: "flagship" | "escort"): void {
    const prize = this.pendingPrize;
    this.pendingPrize = null;
    if (!prize) return;
    const room = this.player.escorts.length < MAX_ESCORTS;

    if (choice === "flagship") {
      const old = this.player.shipId;
      // shïp OnRetire fires for the hull you are stepping out of
      const retire = SHIPS[old]?.onRetire;
      if (retire) applySet(retire, this.player.bits, this.bitHandlers());
      const keepOld = room && old !== prize;
      if (keepOld)
        this.player.escorts.push({ shipId: old, wage: 0, captured: true });
      this.keepPilotOutfits();
      grantHullOutfits(prize, this.player.outfits);
      this.applyShipType(prize);
      this.player.fuelJumps = this.player.maxFuelJumps;
      // the crew you left behind flies her off the pad beside you, so the
      // handover is visible now rather than only after the next takeoff
      if (keepOld) this.spawnPrizeEscort(old);
      this.message(
        keepOld
          ? `You take the helm of the ${this.hullName(prize)}; your ${this.hullName(old)} falls in behind.`
          : room
            ? `You take the helm of the ${this.hullName(prize)}.`
            : `You take the helm of the ${this.hullName(prize)}, abandoning your ${this.hullName(old)} — your command was full.`,
      );
    } else if (room) {
      this.player.escorts.push({ shipId: prize, wage: 0, captured: true });
      this.spawnPrizeEscort(prize);
      this.message(`The ${this.hullName(prize)} joins your fleet.`);
    } else {
      this.message(
        `Your command is full — the ${this.hullName(prize)} is cut loose.`,
      );
      this.pendingPrize = null;
      return;
    }
    // taking the helm of a smaller prize can leave the manifest over capacity,
    // even with your old hull falling in behind to carry some of it
    this.settleFleetCargo();
    // shïp OnCapture: 171 hulls set a bit when taken
    const onCapture = SHIPS[prize]?.onCapture;
    if (onCapture) applySet(onCapture, this.player.bits, this.bitHandlers());
  }

  /** Put a freshly taken prize in the sky beside you, crewed and friendly. */
  private spawnPrizeEscort(shipId: string): void {
    const type = SHIPS[shipId];
    if (!type) return;
    const npc = new NpcShip({
      turnRate: type.turnRate,
      accel: type.accel,
      maxSpeed: type.maxSpeed,
    });
    npc.typeId = shipId;
    npc.ally = true;
    npc.hired = true;
    npc.hostile = false;
    npc.govtId = -1;
    npc.order = "defend";
    npc.initDefense(type.shield, type.armor, type.shieldRechPerSec);
    npc.sprite = SHIP_SPRITES[shipId] ?? null;
    const side = this.player.escorts.length % 2 === 0 ? 1 : -1;
    const off = this.ship.radius + 60;
    npc.pos = {
      x:
        this.ship.pos.x +
        Math.cos(this.ship.angle + (Math.PI / 2) * side) * off,
      y:
        this.ship.pos.y +
        Math.sin(this.ship.angle + (Math.PI / 2) * side) * off,
    };
    npc.angle = this.ship.angle;
    npc.vel = { ...this.ship.vel };
    this.npcs.push(npc);
  }

  /** Public label for the comms panel: a named captain, else the hull class. */
  hailLabel(t: NpcShip): string {
    return this.shipLabel(t);
  }

  /** The one-word state Nova prints on the Status line of the comms panel. */
  hailStatus(t: NpcShip): { text: string; tone: "good" | "bad" | "plain" } {
    if (t.disabled) return { text: "Disabled", tone: "bad" };
    if (t.hostile) return { text: "Hostile", tone: "bad" };
    if (t.ally) return { text: "Escort", tone: "good" };
    if (t.phase === "leaving" || t.phase === "leavingBurn") return { text: "Outbound", tone: "plain" };
    return { text: "Neutral", tone: "plain" };
  }

  private shipLabel(t: NpcShip): string {
    if (t.personId !== null) {
      const p = PERSONS[String(t.personId)];
      if (p) return p.name;
    }
    return t.typeId
      ? (SHIPS[t.typeId]?.name.split(";")[0] ?? "The ship")
      : "The ship";
  }

  /** Missions whose goal was to disable/board/rescue these ships. */
  private creditBoardGoal(t: NpcShip): void {
    if (t.missionMisnId === null) return;
    const active = this.player.activeMissions.find(
      (a) => a.misnId === t.missionMisnId,
    );
    const m = MISSIONS[String(t.missionMisnId)];
    if (!active || !m || active.shipsDone) return;
    if (m.shipGoal !== 2 && m.shipGoal !== 5) return; // board / rescue
    active.shipsKilled += 1;
    if (active.shipsKilled >= active.shipsTotal) {
      active.shipsDone = true;
      applySet(m.onShipDone, this.player.bits, this.bitHandlers());
      if (!isSilentMission(m)) {
        this.message(`Objective complete: ${active.name}.`);
        const doneText = descText(m.shipDoneText);
        if (doneText) {
          this.pendingMissionEvents.push({
            title: active.name,
            text: substituteTags(
              doneText,
              m,
              active,
              this.pilotName,
              this.rankTags(),
            ),
          });
        }
      }
    }
  }

  /** A named captain hands you a job. */
  private offerPersonMission(person: PersonType): void {
    const m = MISSIONS[String(person.linkMission)];
    if (!m) return;
    if (this.player.activeMissions.some((a) => a.misnId === m.id)) {
      this.message(`${person.name} has nothing further for you.`);
      return;
    }
    this.landedUi.showShipOffer(m, person.name);
  }

  /** Open comms with the current target. */
  private hailTarget(): void {
    if (this.targetPlanet && !this.targetNpc) {
      this.hailPlanet(this.targetPlanet);
      return;
    }
    const t = this.targetNpc;
    if (!t) {
      this.message(
        `No target selected. Press ${formatChord(getBinding("cycleTargets"))} for ships, ${formatChord(getBinding("land"))} for worlds.`,
      );
      return;
    }
    // gövt Flags 0x0400: "Can't hail ships of this govt." The Wraith and the
    // Krypt carry it — there is nobody in there to answer the radio.
    if (
      t.govtId >= 128 &&
      ((GOVT_FLAGS[String(t.govtId)] ?? 0) & 0x0400) !== 0
    ) {
      this.message("No response on any frequency.");
      return;
    }
    playSnd(154, 0.4);
    const greeting = t.hired
      ? this.escortHailGreeting(t)
      : "Communications channel open.";
    this.hailUi.show(t, greeting);
  }

  /** Call a world's traffic control. */
  private hailPlanet(p: PlanetDef): void {
    const govtId = SPOB_GOVT.get(p.id) ?? -1;
    const record = getRecord(this.player, govtId);
    playSnd(154, 0.4);

    if (p.uninhabited || !p.landable) {
      this.hailUi.showPlanet(
        p,
        `Static. There is nobody on ${p.name} to answer.`,
        [],
      );
      return;
    }
    const greeting =
      record < -20
        ? `"${p.name} traffic control. Your record here is a disgrace, Captain. Keep your distance."`
        : record > 20
          ? `"${p.name} control. Always a pleasure — the pads are clear whenever you want them."`
          : `"${p.name} traffic control, go ahead."`;

    // gövt Flags 0x4000: planets take bribes. 0x8000: always take bribes and
    // demand a higher cut (same flag as ship greedy-bribe rule).
    const govtFlags = GOVT_FLAGS[String(govtId)] ?? 0;
    const planetTakesBribes =
      (govtFlags & 0x4000) !== 0 || (govtFlags & 0x8000) !== 0;
    const alreadyCleared = this.clearedToLand(p, this.system.govtId);
    const hostile = !alreadyCleared && p.minStatus !== MIN_STATUS_NEVER;

    const opts: { label: string; action: () => string | null | void }[] = [];

    // Friendly: Greetings. Hostile (bribeable): Offer bribe. Otherwise nothing.
    if (!hostile) {
      opts.push({
        label: "Greetings",
        action: () => {
          playSnd(151, 0.4);
          return greeting;
        },
      });
    }

    if (!p.uninhabited && p.landable) {
      const held = this.player.dominated.includes(p.id);
      const DEADLY_LEVEL = 6; // index of "Deadly" in RATING_LEVELS
      const tributeDismissals = [
        `"You're far too puny to be anything but a bother to us. Go away."`,
        `"Ha! Come back when you've actually won a fight or two."`,
        `"We don't take demands from lightweights. Move along."`,
        `"Is this some kind of joke? Get out of our airspace."`,
        `"You haven't earned the right to threaten us. Not even close."`,
        `"Try that again after you've actually scared someone. Goodbye."`,
      ];
      opts.push({
        label: held ? "Release from tribute" : "Demand tribute",
        action: () => {
          playSnd(151, 0.4);
          if (!held && ratingLevel(this.player.ratingPoints) < DEADLY_LEVEL) {
            return tributeDismissals[
              Math.floor(Math.random() * tributeDismissals.length)
            ];
          }
          // Demanding tribute from a previously friendly world turns them hostile.
          // Only the planet's own record is marked — the government at large
          // is unaffected; combined record (govt + planet) now falls below
          // minStatus, blocking landing and setting the hail to hostile mode.
          if (!hostile) {
            this.player.planetRecords ??= {};
            this.player.planetRecords[p.id] = -1000;
          }
          this.hailUi.close();
          this.tryDominate(p);
          return null;
        },
      });
    }

    if (planetTakesBribes && hostile) {
      // On a fresh hail, clear the rejected flag so the player can offer again,
      // but keep nextAmount and lowestOffered so the history carries over.
      const existing = this.bribeState.get(p.id);
      if (existing?.rejected) {
        this.bribeState.set(p.id, { ...existing, rejected: false });
      }

      const rejectionLines = [
        `"Your greed has been noted. Go away."`,
        `"Price goes up, not down. You had your chance."`,
        `"We don't negotiate with hagglers. Get out of our airspace."`,
        `"You're testing our patience. Close this channel."`,
        `"That's not how this works. The price just went up."`,
      ];

      const showBribeOffer = (amount: number): void => {
        const capped = Math.min(this.player.credits, Math.round(amount));
        const st = this.bribeState.get(p.id) ?? {
          rejected: false,
          nextAmount: capped,
          lowestOffered: capped,
        };
        // Track the lowest price offered so far — this becomes the floor.
        const lowestOffered = Math.min(st.lowestOffered, capped);
        this.bribeState.set(p.id, { ...st, rejected: false, nextAmount: capped, lowestOffered });
        this.hailUi.showPlanet(
          p,
          `"${capped.toLocaleString()} credits for landing clearance. Cash."`,
          [
            {
              label: "Accept Price",
              action: () => {
                if (this.player.credits < capped)
                  return `"You don't have the funds. Come back when you do."`;
                playSnd(151, 0.4);
                this.player.credits -= capped;
                this.bribedPlanets.add(p.id);
                this.bribeState.delete(p.id);
                this.hailUi.close();
                this.tryLand(p);
                return null;
              },
            },
            {
              label: "Lower Price",
              action: () => {
                const cur = this.bribeState.get(p.id)!;
                const proposed = amount * (0.7 + Math.random() * 0.15);
                const higher = Math.round(amount * (1.15 + Math.random() * 0.15));
                // Refuse if the proposed lower would hit or beat the previous floor,
                // guaranteeing they never agree to the lowest amount offered before.
                if (Math.random() < 0.5 && proposed > cur.lowestOffered) {
                  // Agree — go lower.
                  showBribeOffer(proposed);
                } else {
                  // Refuse — raise price, lock out further bargaining this hail.
                  playSnd(153, 0.4);
                  this.bribeState.set(p.id, { ...cur, rejected: true, nextAmount: higher });
                  const msg = rejectionLines[Math.floor(Math.random() * rejectionLines.length)];
                  this.hailUi.showPlanet(p, msg, opts);
                }
                return null;
              },
            },
          ],
        );
      };

      opts.push({
        label: "Offer Bribe",
        action: () => {
          const current = this.bribeState.get(p.id);
          if (current?.rejected)
            return `"We already told you — get lost."`;
          const startAmount = current?.nextAmount ?? 5000;
          if (this.player.credits < startAmount)
            return `"Don't waste our time."`;
          playSnd(151, 0.4);
          showBribeOffer(startAmount);
          return null;
        },
      });
    }
    this.hailUi.showPlanet(p, "Communications channel open.", opts);
  }

  private hailGreeting(t: NpcShip): string {
    if (t.personId !== null) {
      const person = PERSONS[String(t.personId)];
      // CommQuote/HailQuote index their STR# from 1, so the array index is one
      // lower. Reading them straight gave every captain the next one's line —
      // Zero Wing answered with the greeting that follows "All your base are
      // belong to us" instead of the line itself. The lists confirm it: the
      // highest CommQuote in the data is 44 and STR# 7100 holds exactly 44.
      const quote = person
        ? STR_LISTS["7100"]?.[person.commQuote - 1]
        : undefined;
      if (quote) return `"${quote}"`;
      if (person) return `"${person.name} here. What do you want?"`;
    }
    if (t.disabled) return `"We're dead in the water. Do what you like."`;
    const govt = this.govtLabel(t.govtId);
    const record = getRecord(this.player, t.govtId);
    if (t.hostile) {
      return t.armor < t.maxArmor * 0.4
        ? `"We're hit bad. What do you want?"`
        : `"You're a long way from safe harbor. Move along before we take an interest in your cargo."`;
    }
    if (record < -20) {
      return `"${govt} vessel here. We know who you are, and we've got nothing to say to you."`;
    }
    if (record > 20) {
      return `"Good to see a friendly ship out here. ${govt} salutes you, Captain."`;
    }
    return this.greetingInfo(t);
  }

  /** STR# 150 holds Nova's own button labels; 20-24 are the comms panel's. */
  private btnLabel(index: number, fallback: string): string {
    return STR_LISTS["150"]?.[index] ?? fallback;
  }

  /**
   * What a hailed ship says when you open with Greetings, from its düde
   * InfoTypes field: good prices, disaster news, a quote out of STR# 7500+,
   * or its government's generic chatter in STR# 7000 + govtID - 128.
   */
  private greetingInfo(t: NpcShip): string {
    const dude = t.dudeId !== null ? DUDES[String(t.dudeId)] : null;
    const info = dude?.infoTypes ?? 0;
    const pick = <T>(a: T[]): T | null =>
      a.length ? a[Math.floor(Math.random() * a.length)] : null;

    if ((info & 0x1000) !== 0) {
      // a world they have been to lately, and what was cheap or dear there
      const worlds = this.system.planets.filter(
        (p) => p.exchange && Object.keys(p.prices).length,
      );
      const world = pick(worlds);
      if (world) {
        const entries = Object.entries(world.prices).filter(
          ([, lvl]) => lvl !== "med",
        );
        const entry = pick(entries);
        if (entry) {
          const [id, level] = entry;
          const name =
            COMMODITIES.find((c) => c.id === id)?.name.toLowerCase() ?? id;
          return `"The last time I was on ${world.name}, the price of ${name} was really ${
            level === "low" ? "low" : "high"
          }."`;
        }
      }
    }
    if ((info & 0x2000) !== 0) {
      const oops = this.player.oopses.find((o) => o.endDay > this.player.date);
      if (oops) {
        const type = OOPSES.find((x) => x.id === oops.id);
        if (type)
          return `"Word is there's trouble out at ${type.name}. Steer clear if you can."`;
      }
    }
    if ((info & 0xf000) === 0x4000) {
      const line = pick(STR_LISTS[String(7500 + (info & 0x0fff))] ?? []);
      if (line) return `"${line}"`;
    }
    if ((info & 0x8000) !== 0 && t.govtId >= 128) {
      const line = pick(STR_LISTS[String(7000 + t.govtId - 128)] ?? []);
      if (line) return `"${line}"`;
    }
    return `"Nothing to report, Captain. Safe flying."`;
  }

  /** Build the reply text shown when an escort is hailed. */
  private escortHailGreeting(t: NpcShip): string {
    const hire = this.player.escorts.find((e) => e.shipId === t.typeId);
    if (!hire) return "Communications channel open.";
    const type = SHIPS[hire.shipId];
    const sellValue = escortSellValue(hire.shipId);
    const upgradeId = type?.upgradeTo ?? -1;
    const upgradeType = upgradeId !== -1 ? SHIPS[String(upgradeId)] : null;
    const upgradeCost = type?.escUpgrdCost ?? 0;
    let msg = `"On your wing, Captain. Sell value: ${sellValue.toLocaleString()} cr.`;
    if (upgradeType) {
      msg += ` Upgrade to ${upgradeType.name.split(";")[0]}: ${upgradeCost.toLocaleString()} cr.`;
    }
    if (hire.pendingSell) {
      msg += ` Pending sale at next shipyard."`;
    } else if (hire.pendingUpgrade) {
      msg += ` Upgrade pending at next shipyard."`;
    } else {
      msg += `"`;
    }
    return msg;
  }

  /**
   * The comms panel's options, as Nova defines them: Greetings, Request
   * Assistance, Offer Bribe and Beg For Mercy, with Close Channel added by the
   * panel itself. Two gövt Flags2 bits decide which of them a government will
   * entertain — 0x0001 makes it untalkative and kills assistance and mercy,
   * 0x0008 stops it answering greetings at all. That pair is set on the Wraith
   * and the Krypt, which is why neither ever replies.
   */
  hailOptions(t: NpcShip): { label: string; action: () => string | null | void }[] {
    // Hired escorts get dedicated management options, not the standard comms menu.
    if (t.hired) {
      const opts: { label: string; action: () => string | null | void }[] = [];
      const hire = this.player.escorts.find((e) => e.shipId === t.typeId);
      if (hire) {
        const type = SHIPS[hire.shipId];
        const upgradeId = type?.upgradeTo ?? -1;
        const upgradeType = upgradeId !== -1 ? SHIPS[String(upgradeId)] : null;
        if (upgradeType) {
          opts.push({
            label: hire.pendingUpgrade ? "Cancel Upgrade" : "Upgrade Escort",
            action: () => {
              hire.pendingUpgrade = !hire.pendingUpgrade;
              if (hire.pendingUpgrade) hire.pendingSell = false;
              return this.escortHailGreeting(t);
            },
          });
        }
        if (hire.captured) {
          opts.push({
            label: hire.pendingSell ? "Cancel Sell" : "Sell Escort",
            action: () => {
              hire.pendingSell = !hire.pendingSell;
              if (hire.pendingSell) hire.pendingUpgrade = false;
              return this.escortHailGreeting(t);
            },
          });
        }
        opts.push({
          label: "Release",
          action: () => {
            const idx = this.player.escorts.indexOf(hire);
            if (idx >= 0) this.releaseEscort(idx);
          },
        });
      }
      return opts;
    }

    const opts: { label: string; action: () => string | null | void }[] = [];
    const record = getRecord(this.player, t.govtId);
    const flags2 = t.govtId >= 128 ? (GOVT_FLAGS2[String(t.govtId)] ?? 0) : 0;
    const untalkative = (flags2 & 0x0001) !== 0;
    const noGreeting = (flags2 & 0x0008) !== 0;
    const roadsideAssistance = (flags2 & 0x0010) !== 0;

    // a named captain with a job still offers it over the radio
    if (t.personId !== null) {
      const person = PERSONS[String(t.personId)];
      if (
        person &&
        person.linkMission >= 128 &&
        MISSIONS[String(person.linkMission)] &&
        !this.player.activeMissions.some((a) => a.misnId === person.linkMission)
      ) {
        opts.push({
          label: "Ask what they want",
          action: () => {
            this.offerPersonMission(person);
          },
        });
      }
    }

    if (t.hostile) {
      opts.push({
        label: this.btnLabel(21, "Greetings"),
        action: () => this.hailGreeting(t),
      });
      if (!untalkative) {
        /*
         * gövt Flags: 0x0200 "warships will take bribes", 0x2000 "freighters
         * will take bribes", 0x8000 "demand a larger percentage" (pirates).
         * Bribeable ships enter the barter flow; others get the old plea.
         */
        const flags =
          t.govtId >= 128 ? (GOVT_FLAGS[String(t.govtId)] ?? 0) : 0;
        const freighter = t.aiType === 1 || t.aiType === 2;
        const takesBribes = freighter
          ? (flags & 0x2000) !== 0
          : (flags & 0x0200) !== 0;
        const greedy = (flags & 0x8000) !== 0;
        opts.push({
          label: this.btnLabel(24, "Beg For Mercy"),
          action: () => {
            if (takesBribes) {
              const amount = Math.min(
                this.player.credits,
                2000 +
                  Math.floor(this.player.credits * (greedy ? 0.33 : 0.1)),
              );
              this.showMercyNegotiation(t, amount, amount);
              return null;
            }
            // Non-bribeable: plea only — works if they're badly damaged or
            // barely provoked (same rule as the old system).
            const merciful = t.armor < t.maxArmor * 0.4 || record > -10;
            if (merciful) {
              t.hostile = false;
              t.phase = "leaving";
              const ang =
                Math.atan2(t.pos.y, t.pos.x) +
                (Math.random() - 0.5) * Math.PI;
              t.target = {
                x: t.pos.x + Math.cos(ang) * 5000,
                y: t.pos.y + Math.sin(ang) * 5000,
              };
              this.message("The attacker breaks off.");
              return `"...Fine. You're not worth the plating. Get out of our sight."`;
            }
            return `"Mercy? You should have thought of that earlier."`;
          },
        });
      }
      return opts;
    }

    if (!noGreeting) {
      opts.push({
        label: this.btnLabel(21, "Greetings"),
        action: () => { playSnd(151, 0.4); return this.hailGreeting(t); },
      });
    }
    if (!untalkative) {
      /*
       * Two ränk Flags outrank a government's ordinary manners: 0x0400 is
       * "player can always request battle assistance from ships of the
       * affiliated government, who will also call in reinforcements on the
       * player's behalf if they are available" (17 of the 31 ranks), and
       * 0x0800 is "ships allied with the affiliated govt will always repair or
       * refuel the player for free" (20 of 31), which is gövt Flags2 0x0010
       * Roadside Assistance granted by standing rather than by nationality.
       */
      const battleAssist = t.govtId >= 128 && this.rankFlag(t.govtId, 0x0400);
      const freeRepair =
        roadsideAssistance ||
        (t.govtId >= 128 && this.rankFlag(t.govtId, 0x0800));
      opts.push({
        label: this.btnLabel(22, "Request Assistance"),
        action: () => {
          if (!freeRepair && !battleAssist && record < -10) {
            return `"We don't help ships with your reputation. Good luck out there."`;
          }
          // under fire, a rank that carries battle assistance turns the
          // neighbourhood: everything of theirs in scanner range takes your
          // side, and the system's own reinforcement fleet is called for you
          const attackers = this.npcs.filter(
            (n) =>
              n.hostile &&
              !n.done &&
              Math.hypot(n.pos.x - this.ship.pos.x, n.pos.y - this.ship.pos.y) <
                3000,
          );
          if (battleAssist && attackers.length > 0) {
            let helpers = 0;
            for (const n of this.npcs) {
              if (n.hostile || n.done || n.ally) continue;
              if (n.govtId !== t.govtId && !govtAllied(n.govtId, t.govtId))
                continue;
              const d = Math.hypot(
                n.pos.x - this.ship.pos.x,
                n.pos.y - this.ship.pos.y,
              );
              if (d > 3000) continue;
              n.ally = true;
              helpers++;
            }
            this.callReinforcementsFor(t.govtId);
            return helpers > 0
              ? `"Hold on, Captain — we're coming about. All ships, engage."`
              : `"Acknowledged. We're calling in whatever is close by."`;
          }
          // Busy in combat — not available for repairs or fuel runs.
          const inCombat = this.npcs.some(
            (n) =>
              n !== t &&
              n.hostile &&
              !n.done &&
              Math.hypot(n.pos.x - t.pos.x, n.pos.y - t.pos.y) < 3000,
          );
          if (inCombat)
            return `"A bit busy right now, Captain. You're on your own."`;

          // Fuel assistance: needs at least one jump to get underway.
          const needFuel = this.player.fuelJumps < 1;
          const hurt = this.ship.armor < this.ship.maxArmor;
          const crippled = this.ship.disabled;
          if (!needFuel && !hurt && !crippled)
            return `"You look in good shape to us, Captain. Safe flying."`;
          let dispatchedFueler = false;
          if (needFuel) {
            if (this.fuelHelper)
              return `"Help is already on the way, Captain. Hold your position."`;
          }
          /*
           * gövt Flags2 0x0010 / ränk Flags 0x0800: full free repairs.
           * Otherwise a disabled hull still gets a limp-home patch — same
           * courtesy as a jump of fuel, just enough above the disable line
           * to get engines and weapons back online so you can reach a pad.
           */
          let patched = false;
          let fullSeal = false;
          if (freeRepair && (hurt || crippled)) {
            this.ship.armor = this.ship.maxArmor;
            this.ship.disabled = false;
            patched = true;
            fullSeal = true;
          } else if (crippled) {
            // ~5% above disableAt (typically 33% → ~38% of max armor)
            const limp =
              this.ship.maxArmor * this.ship.disableAt +
              this.ship.maxArmor * 0.05;
            this.ship.armor = Math.max(
              this.ship.armor,
              Math.min(this.ship.maxArmor, limp),
            );
            this.ship.disabled = false;
            patched = true;
          }
          /*
           * Fuel dispatch. Three tiers by record:
           *   < -10       — refused above
           *   -10..149    — paid: open barter negotiation (3× station rate to start)
           *   ≥ 150 or freeRepair — gratis: dispatch immediately
           */
          if (needFuel) {
            const fuelFee =
              freeRepair || record >= 150 ? 0 : REFUEL_COST_PER_JUMP * 3;
            if (fuelFee > 0) {
              // Hand off to the negotiation overlay; return null keeps hail open.
              this.showFuelNegotiation(t, fuelFee, fuelFee);
              return null;
            }
            t.boardingTimer = 0;
            this.fuelHelper = t;
            dispatchedFueler = true;
          }
          if (fullSeal)
            return dispatchedFueler
              ? `"Hold position — dispatching a fueler and sealing that hull for you."`
              : `"Hold position — sealing that hull for you. You're free to fly."`;
          if (patched)
            return dispatchedFueler
              ? `"We're patching enough hull for thrusters and dispatching a fueler. Limp clear, Captain."`
              : `"We're patching enough hull for thrusters. You're not pretty, but you're free to fly."`;
          if (dispatchedFueler)
            return `"Acknowledged — dispatching a fueler. Hold position, Captain."`;
          return `"You look in good shape to us, Captain. Safe flying."`;
        },
      });
    }
    return opts;
  }

  /**
   * Mercy barter for a hostile ship — same flow as fuel / docking bribes.
   * On accept the attacker stands down and leaves; on a failed Lower Price
   * they raise their demand and lock out further bargaining this hail.
   */
  private showMercyNegotiation(
    t: NpcShip,
    amount: number,
    lowestOffered: number,
    rejected = false,
    overrideMsg?: string,
  ): void {
    const capped = Math.min(this.player.credits, Math.round(amount));
    const lo = Math.min(lowestOffered, capped);
    const rejectionLines = [
      `"Not enough. We don't come cheap."`,
      `"We've already lowered our price. That's as far as we go."`,
      `"Stop wasting our time. Final offer."`,
    ];
    const standDown = (): void => {
      t.hostile = false;
      t.phase = "leaving";
      const ang =
        Math.atan2(t.pos.y, t.pos.x) + (Math.random() - 0.5) * Math.PI;
      t.target = {
        x: t.pos.x + Math.cos(ang) * 5000,
        y: t.pos.y + Math.sin(ang) * 5000,
      };
      this.message("The attacker breaks off.");
    };

    const opts: HailOption[] = [
      {
        label: "Accept Price",
        action: () => {
          if (this.player.credits < capped)
            return `"You don't have the funds. We'll be collecting in scrap, then."`;
          playSnd(151, 0.4);
          this.player.credits -= capped;
          standDown();
          this.hailUi.close();
          return null;
        },
      },
    ];

    if (!rejected) {
      opts.push({
        label: "Lower Price",
        action: () => {
          const proposed = amount * (0.7 + Math.random() * 0.15);
          const higher = Math.round(amount * (1.15 + Math.random() * 0.15));
          if (Math.random() < 0.5 && proposed > lo) {
            this.showMercyNegotiation(t, proposed, lo);
          } else {
            const msg =
              rejectionLines[Math.floor(Math.random() * rejectionLines.length)];
            this.showMercyNegotiation(t, higher, lo, true, msg);
          }
          return null;
        },
      });
    }

    const msg =
      overrideMsg ??
      `"${capped.toLocaleString()} credits and we'll let you go. Not a credit less."`;
    this.hailUi.showShipNegotiation(t, msg, opts);
  }

  /**
   * In-space fuel barter — mirrors the planet landing-bribe negotiation.
   *
   * Shows a ship-comms negotiation overlay with "Accept Price" and (while not
   * yet rejected) "Lower Price". Lower Price has a 50% chance to succeed;
   * failure raises the ask and locks out further bargaining for this hail.
   *
   * `amount`        current asking price
   * `lowestOffered` floor: they will never agree to go at or below this again
   * `rejected`      true after a failed bargain — removes the Lower Price button
   * `overrideMsg`   shown instead of the price line (used for rejection quips)
   */
  private showFuelNegotiation(
    t: NpcShip,
    amount: number,
    lowestOffered: number,
    rejected = false,
    overrideMsg?: string,
  ): void {
    const capped = Math.min(this.player.credits, Math.round(amount));
    const lo = Math.min(lowestOffered, capped);
    const rejectionLines = [
      `"That's not enough. We're not a charity, Captain."`,
      `"We've already come down. That's our final offer."`,
      `"You're wasting our time. Take it or leave it."`,
    ];

    const opts: HailOption[] = [
      {
        label: "Accept Price",
        action: () => {
          if (this.player.credits < capped)
            return `"You don't have the funds, Captain."`;
          this.player.credits -= capped;
          t.boardingTimer = 0;
          this.fuelHelper = t;
          this.hailUi.close();
          return null;
        },
      },
    ];

    if (!rejected) {
      opts.push({
        label: "Lower Price",
        action: () => {
          const proposed = amount * (0.7 + Math.random() * 0.15);
          const higher = Math.round(amount * (1.15 + Math.random() * 0.15));
          if (Math.random() < 0.5 && proposed > lo) {
            // Agree — go lower.
            this.showFuelNegotiation(t, proposed, lo);
          } else {
            // Refuse — raise price, lock out further bargaining.
            const msg =
              rejectionLines[Math.floor(Math.random() * rejectionLines.length)];
            this.showFuelNegotiation(t, higher, lo, true, msg);
          }
          return null;
        },
      });
    }

    const msg =
      overrideMsg ??
      `"${capped.toLocaleString()} credits to transfer a jump's worth of fuel."`;
    this.hailUi.showShipNegotiation(t, msg, opts);
  }

  /**
   * Beams and chainguns carry wëap flag 0x0010: their sound is held for as
   * long as you hold the trigger, not restarted on every tick of the reload.
   * Keyed per weapon so a ship mounting two of them hums once, not twice.
   */
  private updateFiringLoops(): void {
    const firing =
      this.mode === "flight" &&
      !this.flightOverlayOpen() &&
      this.jump === null &&
      actionDown(this.input, "firePrimary") &&
      !this.ship.ionized &&
      !this.ship.disabled;
    for (const slot of this.weaponSlots) {
      if (!slot.weap.sndLoop || !slot.weap.sndId || !isPrimary(slot.weap))
        continue;
      const key = `weap:${slot.weap.id}`;
      if (firing) startSustained(key, slot.weap.sndId, true, 0.35);
      else stopSustained(key);
    }
  }

  private updateWeapons(dt: number): void {
    for (const slot of this.weaponSlots) {
      slot.cooldown = Math.max(0, slot.cooldown - dt);
    }
    // Disabled = weapons offline (ship.disable docstring); ionized same for guns.
    // Uses action bindings, not raw Space — mouse-fire presets must honour this too.
    const canShoot = !this.ship.ionized && !this.ship.disabled;
    if (actionDown(this.input, "firePrimary") && canShoot) {
      for (const slot of this.weaponSlots) {
        if (!isPrimary(slot.weap) || slot.cooldown > 0) continue;
        applyReload(slot);
        // Series: one shot (mounts rotate). Simultaneous (0x0040): all copies.
        const volley = volleyCount(slot.weap, slot.count);
        // looped weapons are held by updateFiringLoops instead
        if (slot.weap.sndId && !slot.weap.sndLoop)
          playSnd(slot.weap.sndId, 0.35);
        // turrets swivel onto the selected target; everything else fires ahead
        let aim: number | undefined;
        if (this.targetNpc && (isTurret(slot.weap) || isQuadrantGun(slot.weap))) {
          // beams are instant — aim at current position; projectiles lead
          const aimPos =
            isBeam(slot.weap)
              ? this.targetNpc.pos
              : leadPoint(this.ship, this.targetNpc, slot.weap.speed);
          const aimAngle = Math.atan2(
            aimPos.y - this.ship.pos.y,
            aimPos.x - this.ship.pos.x,
          );
          if (isTurret(slot.weap)) {
            aim = aimAngle;
          } else {
            // Quadrant gun: aim only if target is within ±45° of the arc centre.
            // Guidance 7 = front (nose), guidance 8 = rear (nose + π).
            const centre =
              slot.weap.guidance === 8
                ? this.ship.angle + Math.PI
                : this.ship.angle;
            let diff = aimAngle - centre;
            while (diff > Math.PI) diff -= Math.PI * 2;
            while (diff < -Math.PI) diff += Math.PI * 2;
            if (Math.abs(diff) <= Math.PI / 4) aim = aimAngle;
          }
        }
        if (isBeam(slot.weap)) {
          this.fireBeam(this.ship, slot.weap, volley, true, aim);
        } else {
          this.projectiles.push(
            ...fireWeapon(
              this.ship,
              slot.weap,
              volley,
              true,
              this.targetNpc,
              aim,
            ),
          );
        }
      }
    }
    // Secondary fires whichever is selected — missiles launch, fighter bays
    // scramble, exactly as EV treats bays as secondary weapons
    if (actionConsume(this.input, "fireSecondary") && canShoot) {
      const slot = this.selectedSecondary();
      if (!slot) {
        this.message("No secondary weapon selected.");
      } else if (slot.cooldown <= 0) {
        if (isFighterBay(slot.weap)) {
          const bays = this.player.ammo[slot.weap.id] ?? slot.count;
          if (bays <= 0) this.message(`${slot.weap.name}: no fighters left.`);
          else {
            slot.cooldown = Math.max(1, slot.weap.reloadSec);
            this.player.ammo[slot.weap.id] = bays - 1;
            this.launchFighter(slot.weap);
          }
        } else {
          const ammoLeft = this.player.ammo[slot.weap.id] ?? 0;
          if (ammoLeft <= 0)
            this.message(`No ammunition for ${slot.weap.name}.`);
          else if (slot.weap.guidance === 1 && !this.targetNpc) {
            this.message("Select a target first (`).");
          } else {
            applyReload(slot);
            if (slot.weap.sndId) playSnd(slot.weap.sndId, 0.4);
            /*
             * Flags3 0x0001: "Weapon will only use ammo at the end of a burst
             * cycle" — the chainguns and the Polaron and Ion Cannon spend one
             * round per burst rather than per shot.
             */
            const volley = Math.min(
              volleyCount(slot.weap, slot.count),
              ammoLeft,
            );
            const spends =
              !(slot.weap.flags3 & W3_AMMO_AT_BURST_END) || slot.burstLeft <= 0;
            // Ammo is per shot that leaves the rail; a simultaneous volley spends
            // one round per barrel.
            if (spends)
              this.player.ammo[slot.weap.id] = Math.max(0, ammoLeft - volley);
            this.projectiles.push(
              ...fireWeapon(
                this.ship,
                slot.weap,
                volley,
                true,
                this.targetNpc,
              ),
            );
          }
        }
      }
    }
  }

  /** Which ïntf the status bar is currently drawn from (for runtime probing). */
  get activeInterfaceId(): number {
    return INTERFACE.id;
  }

  /** Secondary weapons and fighter bays share the selection, EV-style. */
  private secondarySlots(): WeaponSlot[] {
    return this.weaponSlots.filter(
      (s) => isSecondary(s.weap) || isFighterBay(s.weap),
    );
  }

  selectedSecondary(): WeaponSlot | null {
    const list = this.secondarySlots();
    if (list.length === 0) return null;
    return list[this.secondaryIdx % list.length] ?? null;
  }

  private cycleSecondary(): void {
    const list = this.secondarySlots();
    if (list.length === 0) {
      this.message("No secondary weapons fitted.");
      return;
    }
    this.secondaryIdx = (this.secondaryIdx + 1) % list.length;
    this.message(
      `Secondary: ${list[this.secondaryIdx].weap.name.split(";")[0]}.`,
    );
  }

  /** Call every launched fighter home. */
  private recallFighters(): void {
    const out = this.npcs.filter((n) => n.ally);
    if (out.length === 0) {
      this.message("No fighters to recall.");
      return;
    }
    for (const f of out) f.recalling = true;
    this.message(
      `Recalling ${out.length} fighter${out.length === 1 ? "" : "s"}.`,
    );
  }

  /** Target the nearest hostile ship (classic R). */
  private targetClosest(): void {
    let best: NpcShip | null = null;
    let bestD = Infinity;
    for (const n of this.npcs) {
      if (!this.canSee(n) || n.ally || !n.hostile || n.disabled) continue;
      const d = Math.hypot(
        n.pos.x - this.ship.pos.x,
        n.pos.y - this.ship.pos.y,
      );
      if (d < bestD) {
        bestD = d;
        best = n;
      }
    }
    if (!best) {
      this.message("No hostiles on sensors.");
      return;
    }
    this.targetNpc = best;
    this.targetPlanet = null;
    playSnd(SND.TARGET, 0.45);
  }

  /** A recalled fighter flies home and stows itself in its bay. */
  private dockFighter(f: NpcShip): void {
    f.done = true;
    if (this.targetNpc === f) this.targetNpc = null;
    if (f.bayWeapId) {
      this.player.ammo[f.bayWeapId] = (this.player.ammo[f.bayWeapId] ?? 0) + 1;
    }
    playSnd(150, 0.3);
  }

  /**
   * Keep every live beam attached to the ship firing it. The endpoints are
   * recomputed from the owner's current position, facing and shän mount, so a
   * beam sweeps with the hull instead of hanging in space where it was fired;
   * a beam that was tracking a ship follows her too, and one whose shooter has
   * gone is cut short.
   */
  private updateBeams(dt: number): void {
    for (const b of this.beams) {
      b.ttl -= dt;
      if (b.ttl <= 0) continue;
      const owner = b.owner;
      if (!owner) continue; // point-defence flash: fixed where it went off
      if (owner !== this.ship && !this.npcs.includes(owner as NpcShip)) {
        b.ttl = 0; // the shooter is gone, and so is her beam
        continue;
      }
      const exit = weaponExitPoint(owner.sprite, b.exitType, 0, owner.angle);
      let angle = owner.angle + b.relAngle;
      let reach = b.reach;
      if (b.target && !b.target.destroyed) {
        const dx = b.target.pos.x - owner.pos.x;
        const dy = b.target.pos.y - owner.pos.y;
        angle = Math.atan2(dy, dx);
        // stop on the hull it is burning, never past the weapon's own range
        reach = Math.min(Math.max(60, b.weap.beamLength), Math.hypot(dx, dy));
      }
      const ox =
        owner.pos.x +
        (exit.x || exit.y ? exit.x : Math.cos(angle) * owner.radius);
      const oy =
        owner.pos.y +
        (exit.x || exit.y ? exit.y : Math.sin(angle) * owner.radius);
      b.x1 = ox;
      b.y1 = oy;
      b.x2 = ox + Math.cos(angle) * reach;
      b.y2 = oy + Math.sin(angle) * reach;
    }
    this.beams = this.beams.filter((b) => b.ttl > 0);
  }

  /**
   * Whether a projectile may damage this NPC. Your wing (you + escorts) is
   * immune to its own fire; every other ship can hit every other ship so AI
   * dogfights actually connect. The previous filter skipped *all* non-ally
   * shots against non-ally hulls, so hostiles never damaged each other.
   *
   * Same-faction NPC shots pass through each other — two Federation ships
   * in the same battle never trigger on crossfire from their own side.
   */
  private projectileCanHitNpc(p: Projectile, npc: NpcShip): boolean {
    if (p.fromPlayer) return !npc.ally;
    const owner = p.owner as NpcShip | null;
    if (owner?.ally) return !npc.ally;
    // Same-faction NPC crossfire is ignored: govtClassmate covers both same
    // govt and shared class (e.g. two different Federation dudes).
    if (owner && owner.govtId >= 128 && govtClassmate(owner.govtId, npc.govtId))
      return false;
    // independent / hostile NPC fire: anyone but the shooter (already excluded)
    return true;
  }

  /** Beams are hitscan: damage lands the instant they fire. */
  private fireBeam(
    shooter: Ship,
    weap: WeaponType,
    count: number,
    fromPlayer: boolean,
    aimAngle?: number,
  ): void {
    const angle = aimAngle ?? shooter.angle;
    const length = Math.max(60, weap.beamLength);
    // player / escort beams skip your wing; hostile beams may hit anyone else
    // (including other hostiles) so fleet fights work the same as gunfire
    const targets: Ship[] = fromPlayer
      ? this.npcs.filter((n) => !n.ally)
      : [
          this.ship,
          ...this.npcs.filter(
            (n) => n !== shooter && !(n.ally && (shooter as NpcShip).ally),
          ),
        ];
    // Beams leave from the hull's BeamPos mounts, same as shots leave the guns
    const exit = weaponExitPoint(
      shooter.sprite,
      weap.exitType,
      0,
      shooter.angle,
    );
    const ox =
      shooter.pos.x +
      (exit.x || exit.y ? exit.x : Math.cos(angle) * shooter.radius);
    const oy =
      shooter.pos.y +
      (exit.x || exit.y ? exit.y : Math.sin(angle) * shooter.radius);
    const hit = beamHit(
      ox,
      oy,
      angle,
      length,
      targets.filter((s) => s !== shooter),
    );
    // an asteroid closer than the ship soaks the beam instead
    let rockHit: { a: Asteroid; dist: number } | null = null;
    if (fromPlayer) {
      const dxu = Math.cos(angle);
      const dyu = Math.sin(angle);
      for (const a of this.asteroids) {
        const ex = a.x - ox;
        const ey = a.y - oy;
        const along = ex * dxu + ey * dyu;
        if (along < 0 || along > length) continue;
        if (Math.abs(ex * dyu - ey * dxu) > this.asteroidRadius(a)) continue;
        if (!rockHit || along < rockHit.dist) rockHit = { a, dist: along };
      }
    }
    if (rockHit && (!hit || rockHit.dist < hit.dist)) {
      this.beams.push({
        x1: ox,
        y1: oy,
        x2: ox + Math.cos(angle) * rockHit.dist,
        y2: oy + Math.sin(angle) * rockHit.dist,
        weap,
        ttl: Math.max(0.06, weap.durationSec),
        owner: shooter,
        exitType: weap.exitType,
        relAngle: angle - shooter.angle,
        target: null,
        reach: rockHit.dist,
      });
      this.damageAsteroid(rockHit.a, weap.armorDmg + weap.shieldDmg);
      return;
    }
    const reach = hit ? hit.dist : length;
    this.beams.push({
      x1: ox,
      y1: oy,
      x2: ox + Math.cos(angle) * reach,
      y2: oy + Math.sin(angle) * reach,
      weap,
      ttl: Math.max(0.06, weap.durationSec),
      owner: shooter,
      exitType: weap.exitType,
      relAngle: angle - shooter.angle,
      // a turret's beam stays on what it was aimed at as both ships move
      target: hit && isTurret(weap) ? hit.ship : null,
      reach,
    });
    if (!hit) return;
    // Simultaneous beams stack damage; series passes count=1 so one emitter.
    const shots = Math.max(1, Math.min(count, 4));
    hit.ship.takeHit(weap.shieldDmg * shots, weap.armorDmg * shots);
    if (fromPlayer) {
      const npc = hit.ship as NpcShip;
      if (this.npcs.includes(npc)) {
        npc.lastAttacker = this.ship;
        this.maybeProvoke(npc, weap.shieldDmg * shots + weap.armorDmg * shots);
        if (npc.destroyed) this.destroyNpc(npc, true);
      }
    } else if (hit.ship === this.ship && this.ship.destroyed) {
      this.playerDestroyed();
    }
  }

  /** An NPC (hostile or allied fighter) firing a beam at a chosen target. */
  private fireBeamFromNpc(
    npc: NpcShip,
    weap: WeaponType,
    count: number,
    target: Ship,
    angle: number,
  ): void {
    const length = Math.max(60, weap.beamLength);
    const ox = npc.pos.x + Math.cos(angle) * npc.radius;
    const oy = npc.pos.y + Math.sin(angle) * npc.radius;
    const hit = beamHit(ox, oy, angle, length, [target]);
    const reach = hit ? hit.dist : length;
    this.beams.push({
      x1: ox,
      y1: oy,
      x2: ox + Math.cos(angle) * reach,
      y2: oy + Math.sin(angle) * reach,
      weap,
      ttl: Math.max(0.06, weap.durationSec),
      owner: npc,
      exitType: weap.exitType,
      relAngle: angle - npc.angle,
      target: hit ? hit.ship : null,
      reach,
    });
    if (!hit) return;
    const shots = Math.max(1, Math.min(count, 4));
    hit.ship.takeHit(weap.shieldDmg * shots, weap.armorDmg * shots);
    if (hit.ship === this.ship) {
      if (this.ship.destroyed) this.playerDestroyed();
    } else {
      const victim = hit.ship as NpcShip;
      if (this.npcs.includes(victim)) {
        victim.lastAttacker = npc;
        if (victim.destroyed) {
          // credit only when your escort made the kill
          this.destroyNpc(victim, npc.ally, npc.ally ? npc : null);
        }
      }
    }
  }

  /** Launch a carried fighter; it fights alongside you until it dies. */
  private launchFighter(bay: WeaponType): void {
    const typeId = String(bay.ammoType);
    const type = SHIPS[typeId];
    if (!type) {
      this.message(`${bay.name} is empty.`);
      return;
    }
    const fighter = new NpcShip({
      turnRate: type.turnRate,
      accel: type.accel,
      maxSpeed: type.maxSpeed,
    });
    fighter.typeId = typeId;
    fighter.ally = true;
    fighter.hostile = false;
    fighter.govtId = -1;
    fighter.initDefense(type.shield, type.armor, type.shieldRechPerSec);
    fighter.sprite = SHIP_SPRITES[typeId] ?? null;
    const side = Math.random() < 0.5 ? 1 : -1;
    const off = this.ship.radius + 20;
    fighter.pos = {
      x:
        this.ship.pos.x +
        Math.cos(this.ship.angle + (Math.PI / 2) * side) * off,
      y:
        this.ship.pos.y +
        Math.sin(this.ship.angle + (Math.PI / 2) * side) * off,
    };
    fighter.angle = this.ship.angle;
    fighter.vel = { ...this.ship.vel };
    fighter.bayWeapId = bay.id;
    this.npcs.push(fighter);
    if (bay.sndId) playSnd(bay.sndId, 0.4);
    this.message(`${type.name.split(";")[0]} launched.`);
  }

  // ---------------- hired escorts ----------------

  /**
   * Put the pilot's hired escorts in the sky beside them. Called on every
   * takeoff and arrival, since escorts live on the pilot rather than in the
   * system's ship list.
   */
  private spawnEscorts(): void {
    for (let i = 0; i < this.player.escorts.length; i++) {
      const hire = this.player.escorts[i];
      const type = SHIPS[hire.shipId];
      if (!type) continue;
      const npc = new NpcShip({
        turnRate: type.turnRate,
        accel: type.accel,
        maxSpeed: type.maxSpeed,
      });
      npc.typeId = hire.shipId;
      npc.ally = true;
      npc.hired = true;
      npc.hostile = false;
      npc.govtId = -1;
      npc.order = "defend";
      npc.initDefense(type.shield, type.armor, type.shieldRechPerSec);
      npc.sprite = SHIP_SPRITES[hire.shipId] ?? null;
      // fan them out behind the player so they don't spawn on top of each other
      const side = i % 2 === 0 ? 1 : -1;
      const rank = Math.floor(i / 2) + 1;
      const off = this.ship.radius + 40 * rank;
      npc.pos = {
        x:
          this.ship.pos.x +
          Math.cos(this.ship.angle + (Math.PI / 2) * side) * off,
        y:
          this.ship.pos.y +
          Math.sin(this.ship.angle + (Math.PI / 2) * side) * off,
      };
      npc.angle = this.ship.angle;
      npc.vel = { ...this.ship.vel };
      this.npcs.push(npc);
    }
  }

  /** Hired crews draw their wages as the days pass; broke pilots lose them. */
  private payEscorts(): void {
    if (this.player.escorts.length === 0) return;
    const days =
      Math.floor(this.player.date) - Math.floor(this.player.escortPayDay);
    if (days <= 0) return;
    this.player.escortPayDay = Math.floor(this.player.date);
    const due = this.player.escorts.reduce((sum, e) => sum + e.wage * days, 0);
    if (due <= 0) return;
    if (this.player.credits >= due) {
      this.player.credits -= due;
      this.message(`Escort wages paid: ${due.toLocaleString()} cr.`);
      return;
    }
    // can't make payroll: they take what there is and quit
    this.player.credits = 0;
    this.player.escorts = [];
    for (const npc of this.npcs) {
      if (npc.hired) npc.done = true;
    }
    this.message(
      "You could not make payroll. Your escorts have left your service.",
    );
    // and anything stowed in their holds goes with them
    this.settleFleetCargo();
  }

  /** Hire a ship to fly with you. Wages are a thousandth of the hull per day. */
  hireEscort(shipId: string): { ok: boolean; reason?: string } {
    const type = SHIPS[shipId];
    if (!type) return { ok: false, reason: "Unknown ship class." };
    if (this.player.escorts.length >= MAX_ESCORTS) {
      return { ok: false, reason: "You cannot command any more escorts." };
    }
    const fee = escortHireFee(type.cost);
    if (this.player.credits < fee) {
      return { ok: false, reason: "You cannot afford the hiring fee." };
    }
    this.player.credits -= fee;
    this.player.escorts.push({ shipId, wage: escortWage(type.cost) });
    // wages start accruing from today, not from whenever they were last drawn
    this.player.escortPayDay = Math.floor(this.player.date);
    return { ok: true };
  }

  /**
   * Process pending sell/upgrade actions for escorts when landing at a shipyard.
   * Results are queued as a landed event so the player sees a summary popup.
   */
  private processEscortPending(): void {
    const lines: string[] = [];
    for (let i = this.player.escorts.length - 1; i >= 0; i--) {
      const hire = this.player.escorts[i];
      if (hire.pendingSell) {
        hire.pendingSell = false;
        const paid = escortSellValue(hire.shipId);
        const name = this.hullName(hire.shipId);
        this.player.credits += paid;
        this.player.escorts.splice(i, 1);
        this.settleFleetCargo();
        lines.push(`Your ${name} was sold for ${paid.toLocaleString()} cr.`);
      } else if (hire.pendingUpgrade) {
        hire.pendingUpgrade = false;
        const type = SHIPS[hire.shipId];
        const upgradeId = type?.upgradeTo ?? -1;
        const upgradeType = upgradeId !== -1 ? SHIPS[String(upgradeId)] : null;
        if (upgradeType) {
          const cost = type!.escUpgrdCost;
          if (this.player.credits >= cost) {
            this.player.credits -= cost;
            const oldName = type!.name.split(";")[0];
            hire.shipId = upgradeType.id;
            lines.push(
              `Your ${oldName} was upgraded to a ${upgradeType.name.split(";")[0]} for ${cost.toLocaleString()} cr.`,
            );
          } else {
            lines.push(
              `Could not afford to upgrade your ${type!.name.split(";")[0]} — ${type!.escUpgrdCost.toLocaleString()} cr needed.`,
            );
          }
        }
      }
    }
    if (lines.length > 0) {
      this.pendingMissionEvents.push({
        title: "Escort Update",
        text: lines.join("\n\n"),
      });
    }
  }

  /** Release an escort: they stay in the system as a neutral independent ship. */
  releaseEscort(index: number): void {
    const hire = this.player.escorts[index];
    if (!hire) return;
    const name = this.hullName(hire.shipId);
    this.player.escorts.splice(index, 1);
    const npc = this.npcs.find((n) => n.hired && n.typeId === hire.shipId);
    if (npc) {
      npc.ally = false;
      npc.hired = false;
      // govtId stays -1 (Independent)
      // Use the hull's own inherent AI so it reacts to combat the same way
      // any normally-spawned ship of this type would: aiType 1 flees,
      // aiType 2+ turns hostile when provoked.
      npc.aiType = SHIPS[hire.shipId]?.inherentAi ?? 2;
    }
    this.settleFleetCargo();
    this.message(`${name} released from your service.`);
  }

  /** Dismiss an escort silently (payroll default). */
  dismissEscort(index: number): void {
    const hire = this.player.escorts[index];
    if (!hire) return;
    this.player.escorts.splice(index, 1);
    const npc = this.npcs.find((n) => n.hired && n.typeId === hire.shipId);
    if (npc) npc.done = true;
    this.settleFleetCargo();
  }

  /** Give every ship flying with you a standing order. */
  private orderEscorts(order: EscortOrder): void {
    const wing = this.npcs.filter((n) => n.ally && !n.done);
    if (wing.length === 0) {
      this.message("You have no ships under your command.");
      return;
    }
    if (order === "attack" && !this.targetNpc) {
      this.message("No target selected.");
      return;
    }
    for (const npc of wing) {
      npc.order = order;
      npc.holdAt = order === "hold" ? { ...npc.pos } : null;
      if (order !== "hold") npc.recalling = false;
    }
    const what =
      order === "attack"
        ? `attack ${this.targetNpc?.typeId ? (SHIPS[this.targetNpc.typeId]?.name.split(";")[0] ?? "target") : "target"}`
        : order === "hold"
          ? "hold position"
          : "form up";
    this.message(`Escorts: ${what}.`);
    // One of the wing answers — sending you six overlapping voices would be a
    // mess. An attack order gets the targeting line, anything else the ack.
    this.speak(
      wing[Math.floor(Math.random() * wing.length)],
      order === "attack" ? VOICE.TARGET : VOICE.ACKNOWLEDGE,
    );
  }

  /**
   * Escort speech. The gövt VoiceType picks the bank; a government set to -1
   * (the Wraith, the Krypt) simply doesn't answer.
   */
  private speak(npc: NpcShip, kind: VoiceKind): void {
    const voiceType =
      npc.govtId >= 128 ? (GOVT_VOICES[String(npc.govtId)] ?? 0) : 0;
    const snd = voiceSnd(voiceType, kind, npc.voiceParity);
    if (snd !== null) playSnd(snd, 0.55);
  }

  /** A ship under your protection tucks in beside you. */
  private updateEscorteeAi(npc: NpcShip, dt: number): void {
    const dx = this.ship.pos.x - npc.pos.x;
    const dy = this.ship.pos.y - npc.pos.y;
    const dist = Math.hypot(dx, dy);
    if (dist > 220) {
      const facing = npc.steerToward(dt, Math.atan2(dy, dx));
      npc.update(dt, 0, facing);
    } else {
      npc.update(dt, 0, false);
    }
  }

  /** Fighters escort the player and dive on whatever is hostile. */
  private updateAllyAi(npc: NpcShip, dt: number): void {
    if (npc.recalling) {
      const dx = this.ship.pos.x - npc.pos.x;
      const dy = this.ship.pos.y - npc.pos.y;
      const dist = Math.hypot(dx, dy);
      if (dist < this.ship.radius + npc.radius + 12) {
        this.dockFighter(npc);
        return;
      }
      const facing = npc.steerToward(dt, Math.atan2(dy, dx));
      npc.update(dt, 0, facing);
      return;
    }
    // "attack" sends the wing at whatever you have targeted, wherever it is
    if (npc.order === "attack" && this.targetNpc && !this.targetNpc.done) {
      this.attackAi(npc, dt, this.targetNpc);
      return;
    }
    // a ship holding position only engages what comes to it
    const anchor =
      npc.order === "hold" && npc.holdAt ? npc.holdAt : this.ship.pos;
    const reach = npc.order === "hold" ? 700 : 1400;
    let prey: Ship | null = null;
    let best = reach;
    for (const other of this.npcs) {
      if (!other.hostile || other.disabled || other === npc) continue;
      const d = Math.hypot(other.pos.x - anchor.x, other.pos.y - anchor.y);
      if (d < best) {
        best = d;
        prey = other;
      }
    }
    if (prey) {
      this.attackAi(npc, dt, prey);
      return;
    }
    // nothing to fight: sit on the anchor — your wing, or the spot you pinned
    this.stationKeep(npc, dt, anchor, npc.order === "hold" ? 60 : 140);
  }

  /**
   * Hold a ship on a point without letting it pendulum around it. Thrust alone
   * only ever swaps one overshoot for the next, so once the ship is inside the
   * distance it needs to stop in, it turns around and burns off its speed.
   */
  private stationKeep(
    npc: NpcShip,
    dt: number,
    anchor: Vec2,
    slack: number,
  ): void {
    const dx = anchor.x - npc.pos.x;
    const dy = anchor.y - npc.pos.y;
    const dist = Math.hypot(dx, dy);
    const speed = npc.speed;
    const accel = Math.max(1, npc.stats.accel);

    if (dist <= slack) {
      // on station: kill any residual drift so it stops rather than circling
      if (speed > 8) {
        const retro = Math.atan2(-npc.vel.y, -npc.vel.x);
        const facing = npc.steerToward(dt, retro);
        npc.update(dt, 0, facing);
      } else {
        npc.update(dt, 0, false);
      }
      return;
    }
    // how much room this hull needs to shed its speed
    const stopDist = (speed * speed) / (2 * accel);
    const closing = (npc.vel.x * dx + npc.vel.y * dy) / (dist || 1);
    if (closing > 0 && stopDist >= dist - slack) {
      const retro = Math.atan2(-npc.vel.y, -npc.vel.x);
      const facing = npc.steerToward(dt, retro);
      npc.update(dt, 0, facing);
      return;
    }
    const facing = npc.steerToward(dt, Math.atan2(dy, dx));
    npc.update(dt, 0, facing);
  }

  /** Point-defense turrets shoot down incoming guided weapons by themselves. */
  private updatePointDefense(dt: number): void {
    for (const slot of this.weaponSlots) {
      if (!isPointDefense(slot.weap)) continue;
      slot.cooldown = Math.max(0, slot.cooldown - dt);
      if (slot.cooldown > 0) continue;
      const range = isBeam(slot.weap)
        ? Math.max(120, slot.weap.beamLength)
        : 400;
      // incoming missiles first — that is what point defense is for
      const incoming = this.projectiles.find(
        (p) =>
          !p.fromPlayer &&
          p.weap.guidance === 1 &&
          Math.hypot(p.x - this.ship.pos.x, p.y - this.ship.pos.y) < range,
      );
      if (!incoming) continue;
      applyReload(slot);
      const angle = Math.atan2(
        incoming.y - this.ship.pos.y,
        incoming.x - this.ship.pos.x,
      );
      /*
       * Durability is "how many point defense hits a shot from this weapon can
       * take before it is destroyed", so a tough warhead soaks several bursts
       * instead of popping to the first one. 0 means any hit kills it, which
       * is what most of Nova's missiles read.
       */
      incoming.pdHits = (incoming.pdHits ?? 0) + 1;
      if (incoming.pdHits > incoming.weap.durability) incoming.ttl = 0;
      if (isBeam(slot.weap)) {
        this.beams.push({
          x1: this.ship.pos.x,
          y1: this.ship.pos.y,
          x2: incoming.x,
          y2: incoming.y,
          weap: slot.weap,
          ttl: 0.08,
          // a flicker at the muzzle; the missile it burned is already gone
          owner: null,
          exitType: slot.weap.exitType,
          relAngle: 0,
          target: null,
          reach: Math.hypot(
            incoming.x - this.ship.pos.x,
            incoming.y - this.ship.pos.y,
          ),
        });
      } else {
        this.projectiles.push(
          ...fireWeapon(this.ship, slot.weap, 1, true, null, angle),
        );
      }
      this.spawnExplosion(
        incoming.x,
        incoming.y,
        0.5,
        incoming.weap.explodBoom ?? 128,
      );
    }
  }

  /**
   * Fly the fuel helper NPC alongside the player and transfer fuel once docked.
   * Uses the same three-phase boarding approach (approach → brake → drift in),
   * but instead of boarding it trickles fuelJumps into the player until they
   * have at least one jump. Transfer rate: 1 jump/second.
   */
  private updateFuelHelperAi(npc: NpcShip, dt: number): void {
    const DOCK_RANGE = 25;
    const DOCK_SPEED = 15;
    const DRIFT_SPEED = 30;
    const BRAKE_DIST = 350;
    const FUEL_RATE = 1.0; // jumps per second

    const dx = this.ship.pos.x - npc.pos.x;
    const dy = this.ship.pos.y - npc.pos.y;
    const dist = Math.hypot(dx, dy);

    const braking = npc.boardingTimer === -1;
    if (!braking && dist > BRAKE_DIST) {
      // Approach — full thrust toward the player.
      const facing = npc.steerToward(dt, Math.atan2(dy, dx));
      npc.update(dt, 0, facing);
    } else if (braking || npc.speed > DOCK_SPEED) {
      // Brake — face retrograde and thrust until stopped.
      npc.boardingTimer = -1;
      if (npc.speed > DOCK_SPEED) {
        const brakeAngle = Math.atan2(-npc.vel.y, -npc.vel.x);
        const facing = npc.steerToward(dt, brakeAngle);
        npc.update(dt, 0, facing);
      } else {
        npc.vel.x = 0;
        npc.vel.y = 0;
        npc.boardingTimer = 0;
        npc.update(dt, 0, false);
      }
    } else {
      // Stopped (or nearly). Nudge slowly toward the player if not yet in range.
      if (dist > DOCK_RANGE) {
        const len = dist || 1;
        npc.vel.x = (dx / len) * DRIFT_SPEED;
        npc.vel.y = (dy / len) * DRIFT_SPEED;
      } else {
        npc.vel.x = 0;
        npc.vel.y = 0;
      }
      npc.update(dt, 0, false);
      if (dist <= DOCK_RANGE) {
        // Transfer fuel at FUEL_RATE jumps per second until one jump is full.
        this.player.fuelJumps = Math.min(
          this.player.maxFuelJumps,
          this.player.fuelJumps + FUEL_RATE * dt,
        );
        if (this.player.fuelJumps >= 1) {
          this.message("Fuel transfer complete. Safe travels, Captain.");
          this.fuelHelper = null;
        }
      }
    }
  }

  private updateHostileAi(npc: NpcShip, dt: number): void {
    if (this.cloaked) {
      // they've lost you: carry on about their business
      npc.updateAi(dt);
      return;
    }
    // If a non-player ship recently hit us, focus on them until they are gone.
    const a = npc.lastAttacker;
    if (a && a !== this.ship) {
      const npcA = a as NpcShip;
      if (this.npcs.includes(npcA) && !npcA.done) {
        this.attackAi(npc, dt, npcA);
        return;
      }
      npc.lastAttacker = null; // stale — fall back to player
    }
    this.attackAi(npc, dt, this.ship);
  }

  /** System-govt warships hunt hostiles; otherwise they go about their business. */
  private updateWarshipAi(npc: NpcShip, dt: number): void {
    // Prefer whoever most recently hit us over raw proximity.
    const a = npc.lastAttacker;
    if (a) {
      const npcA = a as NpcShip;
      const valid =
        a === this.ship
          ? !this.ship.disabled && !this.playerDeath
          : this.npcs.includes(npcA) && !npcA.done;
      if (valid) {
        if (a === this.ship) this.setNpcHostile(npc);
        this.attackAi(npc, dt, a);
        return;
      }
      npc.lastAttacker = null;
    }
    let prey: Ship | null = null;
    let best = 1600;
    for (const other of this.npcs) {
      if (!other.hostile || other === npc) continue;
      if (!govtEnemy(npc.govtId, other.govtId)) continue;
      const d = Math.hypot(other.pos.x - npc.pos.x, other.pos.y - npc.pos.y);
      if (d < best) {
        best = d;
        prey = other;
      }
    }
    if (prey) {
      this.attackAi(npc, dt, prey);
      return;
    }
    /*
     * Nothing to hunt. A warship (AIType 3) "jumps out if there aren't any";
     * an interceptor (AIType 4) "parks in orbit around a planet". Neither
     * lands, so a ship of either type still carrying a trader's approach — the
     * old spawn gave one to 70% of everything — is put back on its own errand.
     */
    if (npc.phase === "toPlanet") this.setNpcErrand(npc, this.system);
    npc.updateAi(dt);
  }

  private attackAi(npc: NpcShip, dt: number, target: Ship): void {
    // a disabled ship cannot chase or fire — only drift
    if (npc.disabled) {
      npc.update(dt, 0, false);
      return;
    }
    if ((target as NpcShip).disabled) {
      if (BOARDER_GOVTS.has(npc.govtId) && !(target as NpcShip).boarded) {
        // Three-phase boarding approach:
        //   approach  → fly straight at the target
        //   brake     → face retrograde and thrust until fully stopped
        //               (boardingTimer = -1 marks this phase so an overshoot
        //               doesn't flip back to approach)
        //   dock      → if still too far, nudge slowly toward target and drift;
        //               increment timer until boarding completes
        const dx = target.pos.x - npc.pos.x;
        const dy = target.pos.y - npc.pos.y;
        const dist = Math.hypot(dx, dy);
        const DOCK_RANGE = 12;
        const DOCK_SPEED = 15;
        const DRIFT_SPEED = 30;
        const BRAKE_DIST = 350; // commit to braking inside this distance
        const BOARD_TIME = 2.0;

        const braking = npc.boardingTimer === -1;
        if (!braking && dist > BRAKE_DIST) {
          // Approach — full thrust toward target.
          const facing = npc.steerToward(dt, Math.atan2(dy, dx));
          npc.update(dt, 0, facing);
        } else if (braking || npc.speed > DOCK_SPEED) {
          // Brake — committed; face retrograde and thrust until stopped.
          npc.boardingTimer = -1;
          if (npc.speed > DOCK_SPEED) {
            const brakeAngle = Math.atan2(-npc.vel.y, -npc.vel.x);
            const facing = npc.steerToward(dt, brakeAngle);
            npc.update(dt, 0, facing);
          } else {
            // Fully stopped — exit braking phase.
            npc.vel.x = 0;
            npc.vel.y = 0;
            npc.boardingTimer = 0;
            npc.update(dt, 0, false);
          }
        } else {
          // Stopped. If too far away, add a slow drift toward the target.
          if (dist > DOCK_RANGE) {
            const len = dist || 1;
            npc.vel.x = (dx / len) * DRIFT_SPEED;
            npc.vel.y = (dy / len) * DRIFT_SPEED;
          }
          npc.update(dt, 0, false);
          if (dist <= DOCK_RANGE) {
            npc.boardingTimer += dt;
            if (npc.boardingTimer >= BOARD_TIME) {
              (target as NpcShip).boarded = true;
              npc.vel.x = 0;
              npc.vel.y = 0;
              target.vel.x = 0;
              target.vel.y = 0;
            }
          }
        }
        return;
      }
      // Non-boarder hostile: prefer any non-disabled active threat within
      // 1400px before finishing off the disabled ship. Beyond that threshold
      // it is faster to destroy the sitting target first and then move on.
      let activeTarget: Ship | null = null;
      let bestDist = 1400;
      for (const other of this.npcs) {
        if (other === npc || other.disabled || other.done) continue;
        if (!govtEnemy(npc.govtId, other.govtId)) continue;
        const d = Math.hypot(
          other.pos.x - npc.pos.x,
          other.pos.y - npc.pos.y,
        );
        if (d < bestDist) {
          bestDist = d;
          activeTarget = other;
        }
      }
      if (activeTarget) {
        this.attackAi(npc, dt, activeTarget);
        return;
      }
      // No active threats nearby — fall through and destroy the disabled ship.
    }
    const dx = target.pos.x - npc.pos.x;
    const dy = target.pos.y - npc.pos.y;
    const dist = Math.hypot(dx, dy);
    /*
     * A named captain runs at their own Coward threshold — "at what percent of
     * total shield capacity will the person run away from a fight" — instead
     * of the flat quarter-armour rule every other ship uses.
     */
    const person = npc.personId !== null ? PERSONS[String(npc.personId)] : null;
    const fleeing =
      person && person.coward > 0
        ? npc.shield < npc.maxShield * (person.coward / 100)
        : npc.armor < npc.maxArmor * 0.25;
    // a fleeing ship with a cloak uses it
    if (npc.canCloak) npc.cloaked = fleeing;

    // Look up the primary weapon early so we can steer toward the intercept
    // point rather than the target's current position — a crossing target at
    // speed will always be missed if we aim at where it is now.
    const type = npc.typeId ? SHIPS[npc.typeId] : null;
    // Ensure each NPC has its own weapons array so ammo can be tracked per-ship.
    // Normalize sw.ammo: 0 (unlimited) → -1 so that 0 can mean "depleted".
    if (!npc.weapons && type) {
      npc.weapons = type.stockWeapons.map((w) => ({
        ...w,
        ammo: w.ammo === 0 ? -1 : w.ammo,
        cooldown: 0,
      }));
    }
    const armament = npc.weapons ?? type?.stockWeapons;
    // First primary weapon drives the nose-aim / lead calculation for steering.
    const firstPrimary = armament?.find((sw) => {
      const w = WEAPONS[String(sw.id)];
      return w && isPrimary(w);
    });
    const firstWeap = firstPrimary ? WEAPONS[String(firstPrimary.id)] : null;

    // Intercept point: hard mode uses exact lead; normal mode aims at the
    // current position so the player can dodge by changing direction.
    const hard = this.player.difficulty === "hard";
    const aimPos = (() => {
      if (fleeing || !firstWeap || isBeam(firstWeap) || firstWeap.speed <= 0)
        return target.pos;
      const lead = leadPoint(npc, target, firstWeap.speed);
      if (hard) return lead;
      return { x: (target.pos.x + lead.x) / 2, y: (target.pos.y + lead.y) / 2 };
    })();
    const desired = fleeing
      ? Math.atan2(-dy, -dx)
      : Math.atan2(aimPos.y - npc.pos.y, aimPos.x - npc.pos.x);

    const facing = npc.steerToward(dt, desired);
    const thrust = fleeing ? facing : facing && dist > 180;
    npc.update(dt, 0, thrust);
    if (fleeing && dist > 2400) npc.done = true; // escaped

    npc.missileCooldown = Math.max(0, npc.missileCooldown - dt);
    /*
     * Aggress is "how close ships have to be before the person will attack
     * them, on a scale of 1 (close) to 3 (far)"; everything else keeps the
     * engine's standing 700px engagement range.
     */
    const reach =
      person && person.aggress > 0 ? 350 + person.aggress * 350 : 700;
    // Fire every primary weapon independently on its own per-weapon cooldown.
    if (!fleeing && dist < reach) {
      for (const sw of armament ?? []) {
        const w = WEAPONS[String(sw.id)];
        if (!w || !isPrimary(w)) continue;
        if (sw.ammo === 0) continue; // depleted
        sw.cooldown = Math.max(0, (sw.cooldown ?? 0) - dt);
        if (sw.cooldown > 0) continue;
        const turret = isTurret(w);
        const quadrant = isQuadrantGun(w);
        // Each weapon computes its own lead point so fast guns and slow guns
        // aim correctly even when mounted on the same hull.
        const wAimPos = (() => {
          if (isBeam(w) || w.speed <= 0) return target.pos;
          const lead = leadPoint(npc, target, w.speed);
          if (hard) return lead;
          return { x: (target.pos.x + lead.x) / 2, y: (target.pos.y + lead.y) / 2 };
        })();
        const wDesired = Math.atan2(
          wAimPos.y - npc.pos.y,
          wAimPos.x - npc.pos.x,
        );
        let wDiff = wDesired - npc.angle;
        while (wDiff > Math.PI) wDiff -= Math.PI * 2;
        while (wDiff < -Math.PI) wDiff += Math.PI * 2;
        // Turrets swivel independently. Quadrant guns fire within ±45° of
        // their arc centre. Fixed guns need the nose within ~11° of intercept.
        const arcCentre = w.guidance === 8 ? npc.angle + Math.PI : npc.angle;
        let quadDiff = wDesired - arcCentre;
        while (quadDiff > Math.PI) quadDiff -= Math.PI * 2;
        while (quadDiff < -Math.PI) quadDiff += Math.PI * 2;
        const canFire =
          turret ||
          (quadrant && Math.abs(quadDiff) <= Math.PI / 4) ||
          Math.abs(wDiff) < 0.2;
        if (!canFire) continue;
        const volley = volleyCount(w, sw.count);
        sw.cooldown = reloadInterval(w, sw.count);
        if (sw.ammo > 0) sw.ammo -= volley;
        if (w.sndId) {
          playSndAt(
            w.sndId,
            0.35,
            npc.pos.x - this.ship.pos.x,
            npc.pos.y - this.ship.pos.y,
          );
        }
        if (isBeam(w)) {
          const aim = Math.atan2(
            target.pos.y - npc.pos.y,
            target.pos.x - npc.pos.x,
          );
          this.fireBeamFromNpc(npc, w, volley, target, aim);
        } else {
          const aimAngle =
            turret || quadrant
              ? Math.atan2(wAimPos.y - npc.pos.y, wAimPos.x - npc.pos.x)
              : undefined;
          this.projectiles.push(
            ...fireWeapon(npc, w, volley, false, target, aimAngle),
          );
        }
      }
    }

    // Secondary weapons (missiles, rockets) fire independently on their own cooldown.
    if (!fleeing && npc.missileCooldown <= 0 && dist < reach) {
      const missileStock = armament?.find((sw) => {
        const w = WEAPONS[String(sw.id)];
        return w && isSecondary(w) && sw.count > 0 && sw.ammo !== 0;
      });
      if (missileStock) {
        const missileWeap = WEAPONS[String(missileStock.id)]!;
        const volley = volleyCount(missileWeap, missileStock.count);
        npc.missileCooldown = reloadInterval(missileWeap, missileStock.count);
        if (missileStock.ammo > 0) missileStock.ammo -= volley;
        if (missileWeap.sndId) {
          playSndAt(
            missileWeap.sndId,
            0.35,
            npc.pos.x - this.ship.pos.x,
            npc.pos.y - this.ship.pos.y,
          );
        }
        this.projectiles.push(
          ...fireWeapon(npc, missileWeap, volley, false, target, undefined),
        );
      } else {
        // Fighter bays: deploy one fighter per reload cycle.
        const bayStock = armament?.find((sw) => {
          const w = WEAPONS[String(sw.id)];
          return w && isFighterBay(w) && sw.count > 0 && sw.ammo !== 0;
        });
        if (bayStock) {
          const bayWeap = WEAPONS[String(bayStock.id)]!;
          npc.missileCooldown = reloadInterval(bayWeap, bayStock.count);
          if (bayStock.ammo > 0) bayStock.ammo -= 1;
          const typeId = String(bayWeap.ammoType);
          const fType = SHIPS[typeId];
          if (fType) {
            const fighter = new NpcShip({
              turnRate: fType.turnRate,
              accel: fType.accel,
              maxSpeed: fType.maxSpeed,
            });
            fighter.typeId = typeId;
            fighter.govtId = npc.govtId;
            fighter.initDefense(fType.shield, fType.armor, fType.shieldRechPerSec);
            fighter.sprite = SHIP_SPRITES[typeId] ?? null;
            const side = Math.random() < 0.5 ? 1 : -1;
            const off = npc.radius + 20;
            fighter.pos = {
              x: npc.pos.x + Math.cos(npc.angle + (Math.PI / 2) * side) * off,
              y: npc.pos.y + Math.sin(npc.angle + (Math.PI / 2) * side) * off,
            };
            fighter.angle = npc.angle;
            fighter.vel = { ...npc.vel };
            fighter.lastAttacker = npc.lastAttacker;
            if (npc.hostile) this.setNpcHostile(fighter);
            else if (npc.ally) fighter.ally = true;
            this.npcs.push(fighter);
            if (bayWeap.sndId)
              playSndAt(bayWeap.sndId, 0.35, npc.pos.x - this.ship.pos.x, npc.pos.y - this.ship.pos.y);
          }
        }
      }
    }
  }

  private updateProjectiles(dt: number): void {
    for (const p of this.projectiles) {
      // the step this shot takes is swept, not sampled at its endpoint —
      // see pathHitsCircle for why a point test misses small ships outright
      const x0 = p.x;
      const y0 = p.y;
      updateProjectile(p, dt);
      if (p.ttl <= 0) continue;
      // rocks are in the way too
      for (const a of this.asteroids) {
        if (
          pathHitsCircle(x0, y0, p.x, p.y, a.x, a.y, this.asteroidRadius(a))
        ) {
          // a hit shoves the rock, and röid Mass says how hard: the Bible has
          // Mass "used when weapons hit asteroids", and it runs 125 for an ice
          // pebble to 1500 for an ice mountain, so heavy rocks barely budge
          const mass = ROIDS[a.typeId]?.mass ?? 200;
          const shove = (p.weap.impact * 12) / mass;
          a.vx += Math.cos(p.angle) * shove;
          a.vy += Math.sin(p.angle) * shove;
          this.damageAsteroid(a, p.weap.armorDmg + p.weap.shieldDmg);
          p.ttl = 0;
          p.directHit = null;
          this.detonated.push(p);
          break;
        }
      }
      if (p.ttl <= 0) continue;
      // your jammers can shake a missile that is tracking you
      if (
        p.target === this.ship &&
        p.weap.guidance === 1 &&
        Math.random() < jamChance(p.weap, this.gear.jamming) * dt
      ) {
        p.target = null;
        this.message(`Jammers break the ${p.weap.name} lock.`);
      } else if (
        p.target &&
        p.weap.guidance === 1 &&
        Math.random() <
          interferenceBreaksLock(p.weap, this.system.interference) * dt
      ) {
        // the system's own static does the jammers' work for them
        p.target = null;
      }
      for (const npc of this.npcs) {
        if ((npc as Ship) === p.owner) continue;
        // same wing is immune; everyone else is fair game (incl. AI vs AI)
        if (!this.projectileCanHitNpc(p, npc)) continue;
        // ProxSafety keeps a just-launched shot from detonating on its own ship
        const r =
          npc.radius + (p.armTime > 0 ? 4 : Math.max(4, p.weap.proxRadius));
        if (pathHitsCircle(x0, y0, p.x, p.y, npc.pos.x, npc.pos.y, r)) {
          npc.takeHit(p.weap.shieldDmg, p.weap.armorDmg);
          if (p.weap.impact > 0) {
            const mass = SHIPS[npc.typeId ?? ""]?.mass ?? 200;
            const shove = (p.weap.impact * 12) / mass;
            npc.vel.x += Math.cos(p.angle) * shove;
            npc.vel.y += Math.sin(p.angle) * shove;
          }
          npc.lastAttacker = p.fromPlayer ? this.ship : (p.owner as Ship);
          if (p.weap.ionization > 0) {
            npc.ion = Math.min(npc.maxIon, npc.ion + p.weap.ionization);
          }
          p.ttl = 0;
          p.directHit = npc;
          this.detonated.push(p);
          if (p.weap.explodBoom !== null) {
            this.spawnExplosion(p.x, p.y, 1, p.weap.explodBoom);
          }
          if (p.fromPlayer) this.maybeProvoke(npc, p.weap.shieldDmg + p.weap.armorDmg);
          if (npc.destroyed) {
            const owner = p.fromPlayer ? null : (p.owner as NpcShip);
            this.destroyNpc(
              npc,
              p.fromPlayer || !!owner?.ally,
              owner && !p.fromPlayer ? owner : null,
            );
          }
          break;
        }
      }
      if (p.ttl > 0 && !p.fromPlayer && !(p.owner as NpcShip).ally) {
        const r =
          this.ship.radius +
          (p.armTime > 0 ? 4 : Math.max(4, p.weap.proxRadius));
        if (
          pathHitsCircle(x0, y0, p.x, p.y, this.ship.pos.x, this.ship.pos.y, r)
        ) {
          this.ship.takeHit(p.weap.shieldDmg, p.weap.armorDmg);
          if (p.weap.impact > 0) {
            const mass = SHIPS[this.player.shipId]?.mass ?? 200;
            const shove = (p.weap.impact * 12) / mass;
            this.ship.vel.x += Math.cos(p.angle) * shove;
            this.ship.vel.y += Math.sin(p.angle) * shove;
          }
          if (p.weap.ionization > 0) {
            this.ship.ion = Math.min(
              this.ship.maxIon,
              this.ship.ion + p.weap.ionization,
            );
            if (this.ship.ionized) this.message("Your systems are ionized!");
          }
          p.ttl = 0;
          p.directHit = this.ship;
          this.detonated.push(p);
          if (p.weap.explodBoom !== null) {
            this.spawnExplosion(p.x, p.y, 1, p.weap.explodBoom);
          }
          if (
            this.cloaked &&
            (this.cloakFlags & CLOAK_BREAKS_ON_DAMAGE) !== 0
          ) {
            this.cloaked = false;
            this.message("The hit collapses your cloak.");
          }
          if (this.ship.destroyed) this.playerDestroyed();
        }
      }
    }
    /*
     * BlastRadius: a warhead with one damages everything inside it, not just
     * whatever it touched. 60 of Nova's weapons carry a blast, and it is what
     * makes torpedoes worth firing into a formation. Flags 0x0100 spares the
     * player from their own blast, and the ship that was hit directly is
     * excluded so it is not damaged twice for one shot.
     */
    for (const p of this.detonated) {
      if (p.weap.blastRadius <= 0) continue;
      const r = p.weap.blastRadius;
      const hurt = (s: Ship): void => {
        if (s === p.directHit || s.destroyed) return;
        if (Math.hypot(s.pos.x - p.x, s.pos.y - p.y) > r + s.radius) return;
        s.takeHit(p.weap.shieldDmg, p.weap.armorDmg);
        if (p.weap.ionization > 0)
          s.ion = Math.min(s.maxIon, s.ion + p.weap.ionization);
      };
      for (const npc of this.npcs) {
        if ((npc as Ship) === p.owner) continue;
        // same wing filter as direct hits — don't blast your own escorts
        if (!this.projectileCanHitNpc(p, npc)) continue;
        const before = npc.armor + npc.shield;
        hurt(npc);
        if (npc.armor + npc.shield < before) {
          npc.lastAttacker = p.fromPlayer ? this.ship : (p.owner as Ship);
          if (p.fromPlayer) this.maybeProvoke(npc, p.weap.shieldDmg + p.weap.armorDmg);
        }
        if (npc.destroyed) {
          const owner = p.fromPlayer ? null : (p.owner as NpcShip);
          this.destroyNpc(
            npc,
            p.fromPlayer || !!owner?.ally,
            owner && !p.fromPlayer ? owner : null,
          );
        }
      }
      if (p.weap.blastHurtsPlayer && p.owner !== this.ship) {
        hurt(this.ship);
        if (this.ship.destroyed) this.playerDestroyed();
      }
    }
    this.detonated.length = 0;

    /*
     * A dying shot breaks into its submunitions — both when it runs out of
     * life and when something trips its proximity fuse, which is what the
     * Bible specifies and what makes the Polaron Multi-Torp worth carrying.
     * Collected after the loop so the new shots are not themselves stepped
     * on the frame they are born.
     */
    const spawned: Projectile[] = [];
    for (const p of this.projectiles) {
      if (p.ttl > 0) continue;
      spawned.push(...spawnSubmunitions(p));
      // 0x8000 flak: a shot that simply ran out of life still goes off
      if (p.weap.detonateOnExpiry && p.directHit === undefined) {
        p.directHit = null;
        this.detonated.push(p);
        if (p.weap.explodBoom !== null)
          this.spawnExplosion(p.x, p.y, 1, p.weap.explodBoom);
      }
    }
    this.projectiles = this.projectiles.filter((p) => p.ttl > 0);
    if (spawned.length) this.projectiles.push(...spawned);
  }

  /** Shooting a peaceful trader makes it run for the exit. */
  /**
   * Someone just shot this ship. What it does about it is its düde AIType, and
   * the Bible names all four: 1 "Wimpy Trader — visits planets and runs away
   * when attacked", 2 "Brave Trader — fights back when attacked", 3 "Warship
   * — seeks out and attacks his enemies", 4 "Interceptor". Only the first
   * runs, and it is much the rarest: of Nova's 147 düdes just 20 are wimpy
   * traders against 12 brave ones, 65 warships and 50 interceptors. This used
   * to send every one of them fleeing, so nothing in the game ever shot back
   * at you unless it had already been born hostile.
   */
  /**
   * Mark an NPC as fighting the player. Red Alert (snd 370) plays only when
   * this is the first hostile in the system — not every time a new ship piles
   * on after combat has already started.
   */
  private setNpcHostile(npc: NpcShip): void {
    if (npc.ally || npc.hostile || npc.done) return;
    const alreadyUnderAttack = this.npcs.some(
      (n) => n !== npc && n.hostile && !n.done && !n.disabled,
    );
    npc.hostile = true;
    if (!alreadyUnderAttack) playSnd(SND.RED_ALERT, 0.6);
  }

  private provoke(npc: NpcShip): void {
    if (npc.ally || npc.hostile) return; // your own escorts, and anyone already fighting
    /*
     * No legal penalty is charged here. gövt ShootPenalty exists and is
     * extracted, but the Bible annotates the field itself "(currently
     * ignored)" — Nova never charges it, so opening fire costs you nothing on
     * your record until you disable, board or destroy something. A previous
     * pass wired it up, which made shooting a Federation ship cost 5 evilness
     * where the original charges 0; see applyCrime, which no longer accepts
     * "shoot" as a crime at all.
     */
    if (npc.aiType === 1) {
      if (npc.phase !== "leaving") {
        npc.phase = "leaving";
        const ang =
          Math.atan2(npc.pos.y, npc.pos.x) + (Math.random() - 0.5) * Math.PI;
        npc.target = {
          x: npc.pos.x + Math.cos(ang) * 5000,
          y: npc.pos.y + Math.sin(ang) * 5000,
        };
      }
      return;
    }
    // updateHostileAi flies them at the player; phase is a trader's waypoint
    this.setNpcHostile(npc);
    /*
     * The interceptor is also Nova's "piracy police", which the Bible has
     * "attacking any ship that fires on or attempts to board another,
     * non-enemy ship while the interceptor is watching". Watching means in
     * sensor range of the ship that was hit.
     */
    for (const other of this.npcs) {
      if (other === npc || other.aiType !== 4 || other.hostile || other.ally)
        continue;
      if (Math.hypot(other.pos.x - npc.pos.x, other.pos.y - npc.pos.y) > 1600)
        continue;
      if (govtEnemy(other.govtId, npc.govtId)) continue; // they were enemies anyway
      this.setNpcHostile(other);
    }
  }

  /**
   * Provoke an NPC hit by the player, respecting stray-fire tolerance.
   *
   * If the player has the NPC explicitly targeted, a single shot is enough —
   * they know exactly what they're shooting at. Otherwise the shot is treated
   * as stray fire: damage is accumulated against a tolerance band that scales
   * with the player's reputation with that government.
   *
   *   tolerance = (maxShield + maxArmor) × fraction
   *   fraction  = clamp(0.06 + record × 0.003, 0.01, 0.75)
   *
   * At record 0 the band is 6% of total HP — a handful of grazing hits before
   * they turn. At record +200 (trusted ally) it's 66%, absorbing the vast
   * majority of crossfire. At record −50 (already suspect) it's down to 1%,
   * one solid hit and they're hostile.
   */
  private maybeProvoke(npc: NpcShip, damage: number): void {
    if (npc.ally || npc.hostile) return;
    if (npc === this.targetNpc) {
      this.provoke(npc);
      return;
    }
    const record = getRecord(this.player, npc.govtId);
    const maxHp = npc.maxShield + npc.maxArmor;
    const fraction = Math.max(0.05, Math.min(0.75, 0.15 + record * 0.003));
    npc.strayDamage += damage;
    if (npc.strayDamage >= maxHp * fraction) {
      this.provoke(npc);
    }
  }

  /** Disable goals tick over the moment the target stops fighting. */
  private checkDisableGoals(): void {
    for (const active of this.player.activeMissions) {
      if (active.shipsDone) continue;
      const m = MISSIONS[String(active.misnId)];
      if (!m || m.shipGoal !== 1) continue;
      const mine = this.npcs.filter((n) => n.missionMisnId === active.misnId);
      if (mine.length === 0 || !mine.every((n) => n.disabled)) continue;
      active.shipsDone = true;
      applySet(m.onShipDone, this.player.bits, this.bitHandlers());
      if (!isSilentMission(m)) {
        this.message(`Objective complete: ${active.name}.`);
        const doneText = descText(m.shipDoneText);
        if (doneText) {
          this.pendingMissionEvents.push({
            title: active.name,
            text: substituteTags(
              doneText,
              m,
              active,
              this.pilotName,
              this.rankTags(),
            ),
          });
        }
      }
    }
  }

  private destroyNpc(
    npc: NpcShip,
    byPlayer: boolean,
    killer: NpcShip | null = null,
  ): void {
    npc.done = true;
    if (this.targetNpc === npc) this.targetNpc = null;
    // a player escort that made the kill crows about it
    if (killer && !killer.done && killer.ally) this.speak(killer, VOICE.VICTORY);
    this.spawnExplosion(
      npc.pos.x,
      npc.pos.y,
      Math.max(1, npc.radius / 24),
      npc.radius > 40 ? 133 : 132,
    );
    const shipName = npc.typeId
      ? (SHIPS[npc.typeId]?.name.split(";")[0] ?? "Ship")
      : "Ship";
    this.message(
      npc.ally ? `Your ${shipName} was destroyed.` : `${shipName} destroyed.`,
    );

    // an escort that dies on your watch is a failed contract
    if (npc.missionMisnId !== null) {
      const active = this.player.activeMissions.find(
        (a) => a.misnId === npc.missionMisnId,
      );
      const m = active ? MISSIONS[String(active.misnId)] : null;
      if (active && m && m.shipGoal === 3 && !active.shipsDone) {
        applySet(m.onFailure, this.player.bits, this.bitHandlers());
        applyCompReward(this.player, m.compGovt, m.compReward, true);
        this.player.activeMissions = this.player.activeMissions.filter(
          (a) => a !== active,
        );
        if (!isSilentMission(m)) {
          this.message(
            `Mission failed: ${active.name} — the ship you were escorting was destroyed.`,
          );
          const failText = descText(m.failText);
          if (failText) {
            this.pendingMissionEvents.push({
              title: `Mission failed: ${active.name}`,
              text: substituteTags(
                failText,
                m,
                active,
                this.pilotName,
                this.rankTags(),
              ),
            });
          }
        }
      }
    }
    if (npc.defenderOf) {
      const left = Math.max(0, (this.domination.get(npc.defenderOf) ?? 1) - 1);
      this.domination.set(npc.defenderOf, left);
    }
    // a hired escort that dies is off the payroll for good
    if (npc.hired && npc.typeId) {
      const idx = this.player.escorts.findIndex((e) => e.shipId === npc.typeId);
      if (idx >= 0) {
        this.player.escorts.splice(idx, 1);
        // whatever she was hauling for you burned with her
        this.settleFleetCargo();
      }
    }
    if (
      npc.personId !== null &&
      !this.player.personsKilled.includes(npc.personId)
    ) {
      this.player.personsKilled.push(npc.personId); // they don't come back
    }
    if (!byPlayer || npc.ally) return;
    // combat rating + legal record
    if (npc.typeId)
      this.player.ratingPoints += Math.max(0, SHIPS[npc.typeId]?.strength ?? 0);
    if (npc.govtId >= 128) applyCrime(this.player, npc.govtId, "kill");
    // mission special-ship goals
    if (npc.missionMisnId !== null) {
      const active = this.player.activeMissions.find(
        (a) => a.misnId === npc.missionMisnId,
      );
      const m = MISSIONS[String(npc.missionMisnId)];
      if (active && m && m.shipGoal < 0) {
        /*
         * A goalless ship satisfies nothing by dying, but the tally still has
         * to move: spawnMissionShips replaces `shipsTotal - shipsKilled` of
         * them every time you enter the system, so without this an ambush you
         * fought off would be waiting again on the way back.
         */
        active.shipsKilled += 1;
      } else if (active && m && !active.shipsDone) {
        active.shipsKilled += 1;
        if (active.shipsKilled >= active.shipsTotal) {
          active.shipsDone = true;
          applySet(m.onShipDone, this.player.bits, this.bitHandlers());
          if (!isSilentMission(m)) {
            this.message(`Objective complete: ${active.name}.`);
            const doneText = descText(m.shipDoneText);
            if (doneText) {
              this.pendingMissionEvents.push({
                title: active.name,
                text: substituteTags(
                  doneText,
                  m,
                  active,
                  this.pilotName,
                  this.rankTags(),
                ),
              });
            }
          }
        } else if (!isSilentMission(m)) {
          this.message(
            `${active.name}: ${active.shipsKilled}/${active.shipsTotal} destroyed.`,
          );
        }
      }
    }
  }

  /** Spawn a mission's special ships if this is the system they were set in. */
  private spawnMissionShips(): void {
    for (const active of this.player.activeMissions) {
      if (active.shipsTotal <= 0) continue;
      if (active.shipSystemId !== this.player.systemId) continue;
      const mDef = MISSIONS[String(active.misnId)];
      const goal = mDef?.shipGoal ?? 0;
      /*
       * A satisfied objective stops the spawn. ShipGoal -1 carries no
       * objective, so its missions are flagged shipsDone the moment they are
       * accepted — those ships still have to fly, placed by ShipBehav alone,
       * so only a goal-driven shipsDone is allowed to skip them.
       */
      if (active.shipsDone && goal >= 0) continue;
      const remaining = active.shipsTotal - active.shipsKilled;
      if (remaining <= 0) continue;
      const dude = DUDES[String(active.shipDude)];
      let hostileSpawned = false;
      for (let i = 0; i < remaining; i++) {
        const shipEntry = dude ? this.weightedPick(dude.ships) : null;
        const typeId =
          shipEntry && SHIPS[String(shipEntry.id)]
            ? String(shipEntry.id)
            : null;
        if (!typeId) continue;
        const type = SHIPS[typeId];
        const npc = new NpcShip({
          turnRate: type.turnRate,
          accel: type.accel,
          maxSpeed: type.maxSpeed,
        });
        npc.typeId = typeId;
        npc.govtId =
          (dude?.govt ?? -1) >= 128 ? dude!.govt : inherentCombatGovt(typeId);
        // you only shoot the ones you were sent to kill or cripple
        const wantHostile = goal === 0 || goal === 1;
        /*
         * ShipBehav overrides that when the mission says so: 0 makes the
         * special ships always attack the player and 1 makes them protect
         * them, whatever the goal implies. 208 missions set 0 and 40 set 1.
         * For a goalless mission it is the only thing placing them at all.
         */
        if (mDef?.shipBehav === 1) {
          npc.hostile = false;
          npc.ally = true;
        } else if (mDef?.shipBehav === 0 || wantHostile) {
          this.setNpcHostile(npc);
          hostileSpawned = true;
        }
        // rescue targets start dead in space
        if (goal === 5) npc.disabled = true;
        if (goal === 3) npc.escorting = true;
        npc.missionMisnId = active.misnId;
        npc.initDefense(type.shield, type.armor, type.shieldRechPerSec);
        npc.sprite = SHIP_SPRITES[typeId] ?? null;
        const ang = Math.random() * Math.PI * 2;
        const r = 900 + Math.random() * 900;
        npc.pos = { x: Math.cos(ang) * r, y: Math.sin(ang) * r };
        npc.angle = Math.random() * Math.PI * 2;
        this.npcs.push(npc);
      }
      // escorts and protectors are not contacts to warn about
      if (hostileSpawned && (!mDef || !isSilentMission(mDef))) this.message(`Hostile contacts: ${active.name}.`);
    }
  }

  /**
   * Observe goals complete by seeing the ships; escort goals complete once
   * you reach the destination with them still alive.
   */
  private updateMissionWatch(dt: number): void {
    this.observeTimer -= dt;
    if (this.observeTimer > 0) return;
    this.observeTimer = 0.5;
    this.checkDisableGoals();
    for (const active of this.player.activeMissions) {
      if (active.shipsDone) continue;
      const m = MISSIONS[String(active.misnId)];
      if (!m) continue;
      if (m.shipGoal === 4) {
        const seen = this.npcs.some(
          (n) =>
            n.missionMisnId === active.misnId &&
            Math.hypot(n.pos.x - this.ship.pos.x, n.pos.y - this.ship.pos.y) <
              2000,
        );
        if (seen) {
          active.shipsDone = true;
          applySet(m.onShipDone, this.player.bits, this.bitHandlers());
          if (!isSilentMission(m)) {
            this.message(`Observation complete: ${active.name}.`);
            const doneText = descText(m.shipDoneText);
            if (doneText) {
              this.pendingMissionEvents.push({
                title: active.name,
                text: substituteTags(
                  doneText,
                  m,
                  active,
                  this.pilotName,
                  this.rankTags(),
                ),
              });
            }
          }
        }
      }
    }
  }

  /** Fill the system's asteroid field from its röid type mask. */
  private populateAsteroids(): void {
    this.asteroids = [];
    this.minerals = [];
    this.particles = [];
    const sys = this.system;
    const count = Math.max(0, Math.min(16, sys.asteroids));
    if (count === 0 || sys.astTypes === 0) return;
    const types: string[] = [];
    for (let bit = 0; bit < 16; bit++) {
      if ((sys.astTypes & (1 << bit)) !== 0 && ROIDS[String(128 + bit)]) {
        types.push(String(128 + bit));
      }
    }
    if (types.length === 0) return;
    // Nova's asteroid counts are per-region; a handful on screen reads right
    for (let i = 0; i < count * 2; i++) {
      this.asteroids.push(
        this.makeAsteroid(types[Math.floor(Math.random() * types.length)]),
      );
    }
  }

  private makeAsteroid(
    typeId: string,
    at?: { x: number; y: number },
  ): Asteroid {
    const roid = ROIDS[typeId];
    const ang = Math.random() * Math.PI * 2;
    const dist = 600 + Math.random() * 1800;
    const drift = 8 + Math.random() * 22;
    const driftAng = Math.random() * Math.PI * 2;
    return {
      typeId,
      x: at ? at.x : this.ship.pos.x + Math.cos(ang) * dist,
      y: at ? at.y : this.ship.pos.y + Math.sin(ang) * dist,
      vx: Math.cos(driftAng) * drift,
      vy: Math.sin(driftAng) * drift,
      armor: roid?.strength ?? 100,
      frame: Math.random() * 36,
      spin:
        ((roid?.spinRate ?? 50) / 100) * 30 * (Math.random() < 0.5 ? -1 : 1),
    };
  }

  /** röid 128-143 draw from spïn 800-815. */
  private roidSheet(typeId: string) {
    return ROID_SPRITES[String(800 + parseInt(typeId, 10) - 128)];
  }

  private asteroidRadius(a: Asteroid): number {
    const sheet = this.roidSheet(a.typeId);
    return sheet ? Math.max(sheet.w, sheet.h) / 2 : 16;
  }

  private updateAsteroids(dt: number): void {
    for (const a of this.asteroids) {
      a.x += a.vx * dt;
      a.y += a.vy * dt;
      a.frame += a.spin * dt;
      // keep the field around the player rather than simulating the whole belt
      const dx = a.x - this.ship.pos.x;
      const dy = a.y - this.ship.pos.y;
      const d = Math.hypot(dx, dy);
      if (d > 3000) {
        const back = this.makeAsteroid(a.typeId);
        a.x = back.x;
        a.y = back.y;
      }
      // Asteroids are scenery you can mine, not obstacles. Nova's röid resource
      // has no collision or damage field at all — ships fly straight through
      // them, and only weapons fire breaks them up.
    }

    // mineral boxes drift, and a mining scoop pulls them in
    for (const m of this.minerals) {
      m.x += m.vx * dt;
      m.y += m.vy * dt;
      m.ttl -= dt;
      const dx = this.ship.pos.x - m.x;
      const dy = this.ship.pos.y - m.y;
      const d = Math.hypot(dx, dy);
      if (this.hasMiningScoop && d < 320) {
        // tractor it in
        m.vx += (dx / (d || 1)) * 220 * dt;
        m.vy += (dy / (d || 1)) * 220 * dt;
      }
      if (d < this.ship.radius + 14) {
        if (this.hasMiningScoop) this.collectMineral(m);
        m.ttl = 0;
      }
    }
    this.minerals = this.minerals.filter((m) => m.ttl > 0);

    // debris coasts outward and fades; it is scenery, so nothing collides
    for (const p of this.particles) {
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      p.vx *= 1 - Math.min(1, 1.2 * dt);
      p.vy *= 1 - Math.min(1, 1.2 * dt);
      p.ttl -= dt;
    }
    if (this.particles.length)
      this.particles = this.particles.filter((p) => p.ttl > 0);
  }

  private collectMineral(m: Mineral): void {
    const space = freeCommoditySpace(this.player);
    if (space <= 0) {
      this.message("Your hold is full.");
      return;
    }
    const junk = m.junkId !== null ? JUNKS[String(m.junkId)] : null;
    const commodity = m.yieldType !== null ? COMMODITIES[m.yieldType] : null;
    const id = junk ? junkCargoKey(junk.id) : (commodity?.id ?? "metal");
    const name = junk ? junk.name : (commodity?.name ?? "minerals");
    this.player.cargo[id] = (this.player.cargo[id] ?? 0) + 1;
    playSnd(150, 0.3);
    this.message(`Scooped 1t of ${name}.`);
  }

  /**
   * Ships you anger in their own space call for help — unless you carry a
   * reinforcement inhibitor covering that government's class.
   */
  private updateReinforcements(dt: number): void {
    const govtId = this.system.govtId;
    if (govtId < 128) return;
    const provoked = this.npcs.some((n) => n.hostile && n.govtId === govtId);
    const wanted = getRecord(this.player, govtId) < -30;
    /*
     * gövt MaxOdds (50-1000 across 65 governments) is documented as the
     * threshold for this call — help arrives when "the combat odds against
     * them exceed the MaxOdds field". What Nova counts as "combat odds" is
     * not stated, though, and the obvious reading (attackers over defenders,
     * as a percentage) never clears even the lowest threshold for a lone
     * player, which would switch reinforcements off almost entirely. Left
     * ungated until the unit is pinned down; the field is extracted.
     */
    if (!provoked && !wanted) {
      this.reinforceTimer = 45;
      return;
    }
    if (
      this.gear.reinfInhibit.some((v) => v === -1 || govtClassmate(govtId, v))
    )
      return;
    this.reinforceTimer -= dt;
    if (this.reinforceTimer > 0) return;
    /*
     * The system names the formation that answers the call (ReinfFleet) and how
     * long it takes to arrive (ReinfTime, in frames), rather than us improvising
     * one from whatever düde happens to spawn here. 291 of the 398 systems name
     * a fleet — Sol calls flët 145, Kania flët 129 after 30 seconds.
     */
    const sys = this.system;
    const fleet =
      sys.reinfFleet !== null
        ? FLEETS.find((f) => f.id === sys.reinfFleet)
        : null;
    if (!fleet) {
      this.reinforceTimer = 60;
      return;
    }
    // ReinfIntrval is the cooldown in days before this system can call again.
    this.reinforceTimer = Math.max(30, sys.reinfInterval * 24 * 60);
    this.pendingReinforcement = { fleet, at: this.time + sys.reinfDelay };
    this.message(`${this.govtLabel(govtId)} reinforcements are on the way.`);
  }

  /*
   * Patrols scan passing traffic for contraband. A government scans for the
   * bits in its own ScanMask, and an outfit or cargo whose ScanMask shares a
   * bit with it is illegal to that government — so an EMP Torpedo is fine in
   * Federation space and a hanging offence in Auroran, while the Pirates will
   * take almost anything worth having. Getting caught costs the government's
   * ScanFine and a SmugPenalty against your record; coming up clean costs
   * nothing but the wait. Cloaked ships are not scanned.
   */
  private updateScans(dt: number): void {
    if (this.cloaked) return;
    this.scanTimer -= dt;
    if (this.scanTimer > 0) return;
    this.scanTimer = 20 + Math.random() * 25;

    // the scanner has to be a non-hostile local warship, and close enough
    const scanner = this.npcs.find(
      (n) =>
        !n.hostile &&
        !n.ally &&
        !n.disabled &&
        n.govtId >= 128 &&
        (GOVTS[String(n.govtId)]?.scanMask ?? 0) !== 0 &&
        Math.hypot(n.pos.x - this.ship.pos.x, n.pos.y - this.ship.pos.y) < 900,
    );
    if (!scanner) return;

    const found = contraband(this.player, scanner.govtId);
    const label = this.govtLabel(scanner.govtId);
    if (!found.outfits.length && !found.cargo.length) {
      this.message(`${label} patrol scans you and finds nothing.`);
      return;
    }
    const caught = [...found.cargo, ...found.outfits];
    const paid = applySmuggling(this.player, scanner.govtId);
    this.message(
      `${label} patrol detects ${caught[0]}${caught.length > 1 ? ` and ${caught.length - 1} more` : ""}!`,
    );
    if (paid > 0)
      this.message(`You are fined ${paid.toLocaleString()} credits.`);
    // being caught turns the patrol on you, as any crime does
    this.provoke(scanner);
    this.setNpcHostile(scanner); // in case provoke only made a wimpy flee
  }

  /** The called-for fleet drops out of hyperspace once ReinfTime has elapsed. */
  private updatePendingReinforcement(): void {
    const call = this.pendingReinforcement;
    if (!call || this.time < call.at) return;
    this.pendingReinforcement = null;
    const before = this.npcs.length;
    this.spawnFleetOf(call.fleet, true);
    if (this.npcs.length > before) {
      this.message(
        `${this.govtLabel(call.fleet.govt)} reinforcements have arrived.`,
      );
    }
  }

  /** A shot or beam struck an asteroid. */
  private damageAsteroid(a: Asteroid, dmg: number): void {
    a.armor -= dmg;
    if (a.armor > 0) return;
    const roid = ROIDS[a.typeId];
    /*
     * ExplodeType names the bööm rather than every rock sharing one, so a
     * huge asteroid goes up bigger than a pebble (Nova steps 0/0/1/2 across
     * each family's four sizes).
     */
    if (roid?.explodeBoom != null)
      this.spawnExplosion(a.x, a.y, 0.7, roid.explodeBoom);
    /*
     * PartCount particles in the rock's own PartColor — white for ice, tan for
     * dust, deep blue for crystal. This is the only thing that visually tells
     * the four asteroid families apart when they shatter.
     */
    if (roid && roid.partCount > 0) {
      for (let i = 0; i < Math.min(roid.partCount, 50); i++) {
        const ang = Math.random() * Math.PI * 2;
        const sp = 30 + Math.random() * 90;
        this.particles.push({
          x: a.x,
          y: a.y,
          vx: Math.cos(ang) * sp,
          vy: Math.sin(ang) * sp,
          color: roid.partColor,
          ttl: 0.4 + Math.random() * 0.6,
          life: 1,
        });
      }
    }
    // spit out resource boxes for anyone with a scoop. What a rock is worth is
    // its röid YieldType: a commodity, or a jünk for the ice and crystal fields
    const yield_ = roid ? roidYield(roid.yieldType) : null;
    const qty =
      roid && roid.yieldQty > 0
        ? Math.max(1, Math.round(roid.yieldQty * (0.5 + Math.random())))
        : 0;
    for (let i = 0; i < Math.min(qty, 6); i++) {
      const ang = Math.random() * Math.PI * 2;
      this.minerals.push({
        x: a.x,
        y: a.y,
        vx: Math.cos(ang) * (20 + Math.random() * 30),
        vy: Math.sin(ang) * (20 + Math.random() * 30),
        yieldType: yield_ && "commodity" in yield_ ? yield_.commodity : null,
        junkId: yield_ && "junk" in yield_ ? yield_.junk.id : null,
        ttl: 25,
      });
    }
    // big rocks break into smaller ones
    const idx = this.asteroids.indexOf(a);
    if (idx >= 0) this.asteroids.splice(idx, 1);
    /*
     * FragCount sub-asteroids, +/- 50%, each picked at random between
     * FragType1 and FragType2 where both are set — which is how a Metal Huge
     * sheds a mix of Metal Big and Dust Medium rather than four clones.
     */
    const fragTypes = (roid?.fragTypes ?? []).filter((f) => ROIDS[String(f)]);
    if (fragTypes.length && (roid?.fragCount ?? 0) > 0) {
      const n = Math.max(
        1,
        Math.round(roid!.fragCount * (0.5 + Math.random())),
      );
      for (let i = 0; i < Math.min(n, 6); i++) {
        const pick = fragTypes[Math.floor(Math.random() * fragTypes.length)];
        const frag = this.makeAsteroid(String(pick), { x: a.x, y: a.y });
        const ang = Math.random() * Math.PI * 2;
        frag.vx = Math.cos(ang) * 40;
        frag.vy = Math.sin(ang) * 40;
        this.asteroids.push(frag);
      }
    } else {
      // the field replenishes itself from the edge
      this.asteroids.push(this.makeAsteroid(a.typeId));
    }
  }

  /** Fleets that may appear in this system. */
  private eligibleFleets(): FleetType[] {
    const sysId = parseInt(this.player.systemId, 10);
    const govtId = this.system.govtId;
    return FLEETS.filter((f) => {
      if (!SHIPS[String(f.leadShip)]) return false;
      if (
        f.appearOn &&
        !evalTest(f.appearOn, this.player.bits, {
          outfits: this.player.outfits,
          explored: this.player.explored,
          male: true,
        })
      )
        return false;
      const link = f.linkSyst;
      if (link === -1) return true;
      if (link >= 128 && link <= 2175) return link === sysId;
      if (link >= 10000 && link <= 10255) return govtId === link - 9872;
      if (link >= 15000 && link <= 15255)
        return govtAllied(link - 14872, govtId);
      if (link >= 20000 && link <= 20255) return govtId !== link - 19872;
      if (link >= 25000 && link <= 25255)
        return govtEnemy(link - 24872, govtId);
      return false;
    });
  }

  /** Bring in a whole formation: a flagship with its escorts in tow. */
  private spawnFleet(): void {
    const options = this.eligibleFleets();
    if (options.length === 0) return;
    this.spawnFleetOf(options[Math.floor(Math.random() * options.length)]);
  }

  /**
   * Put one flët into the system. `announce` distinguishes ordinary traffic,
   * which introduces itself by name, from a reinforcement call, whose arrival
   * the caller reports instead.
   */
  private spawnFleetOf(fleet: FleetType, asReinforcement = false): void {
    const hostile = this.hostileToPlayer(fleet.govt);

    // the formation arrives together, from the same direction
    const ang = Math.random() * Math.PI * 2;
    const dist = 1400 + Math.random() * 700;
    const originX = this.ship.pos.x + Math.cos(ang) * dist;
    const originY = this.ship.pos.y + Math.sin(ang) * dist;

    const makeShip = (typeId: string, slot: number): NpcShip | null => {
      const type = SHIPS[typeId];
      if (!type) return null;
      const npc = new NpcShip({
        turnRate: type.turnRate,
        accel: type.accel,
        maxSpeed: type.maxSpeed,
      });
      npc.typeId = typeId;
      npc.govtId = fleet.govt;
      npc.aiType = 3; // fleets fly as warships
      npc.initDefense(
        type.shield,
        type.armor,
        type.shieldRechPerSec,
        (type.flags & 0x10) !== 0 ? 0.1 : 0.33,
      );
      if (hostile) this.setNpcHostile(npc);
      npc.sprite = SHIP_SPRITES[typeId] ?? null;
      // stagger them into a loose formation behind the flagship
      const row = Math.floor(slot / 3);
      const col = (slot % 3) - 1;
      npc.pos = {
        x:
          originX +
          Math.cos(ang) * row * 70 +
          Math.cos(ang + Math.PI / 2) * col * 70,
        y:
          originY +
          Math.sin(ang) * row * 70 +
          Math.sin(ang + Math.PI / 2) * col * 70,
      };
      npc.angle = ang + Math.PI;
      const dest = this.system.planets[0];
      npc.phase = dest ? "toPlanet" : "leaving";
      npc.target = dest
        ? { x: dest.pos.x, y: dest.pos.y }
        : { x: -originX, y: -originY };
      return npc;
    };

    let slot = 0;
    const lead = makeShip(String(fleet.leadShip), slot++);
    if (!lead) return;
    this.npcs.push(lead);
    for (const esc of fleet.escorts) {
      const n =
        esc.min +
        Math.floor(Math.random() * Math.max(1, esc.max - esc.min + 1));
      for (let i = 0; i < Math.min(n, 4); i++) {
        const ship = makeShip(String(esc.id), slot++);
        if (ship) this.npcs.push(ship);
      }
    }
    if (!asReinforcement) this.message(`${fleet.name} enters the system.`);
  }

  /** Is this captain in play, alive, and flying a hull we have? */
  private personAvailable(p: PersonType): boolean {
    if (this.player.personsKilled.includes(p.id)) return false;
    if (!SHIPS[String(p.shipType)]) return false;
    // ActiveOn gates whether this captain is in play at all
    if (p.activeOn && !evalTest(p.activeOn, this.player.bits)) return false;
    return true;
  }

  /**
   * A përs whose LinkSyst names one specific system is *placed* there, not
   * rolled for. The Bible's "5% chance that a specific AI-person will also be
   * created" governs the general pool, and reading it as the only way in makes
   * a system-bound captain unreachable: in Rautherion, përs 642 — the tutorial
   * derelict, gated on the very bit "Shoot down Derelict" sets on accept — is
   * one of 157 candidates the system admits, so the odds of meeting it were
   * 0.05 × 1/157 per ship spawned and the mission's target never appeared.
   *
   * Only the 29 përs with an explicit id in the Bible's 128-2175 band are
   * placed (never more than three in one system: Jack Folstam and a named
   * trader or two). Everything with a wildcard LinkSyst stays on the 5% roll.
   */
  private placeLinkedPersons(): void {
    const sysId = parseInt(this.player.systemId, 10);
    for (const person of Object.values(PERSONS)) {
      const link = person.linkSyst;
      if (link < 128 || link > 2175 || link !== sysId) continue;
      if (!this.personAvailable(person)) continue;
      const npc = new NpcShip();
      this.applyPerson(npc, person);
      if (!npc.ally && this.hostileToPlayer(npc.govtId)) {
        if (person.linkMission < 128) this.setNpcHostile(npc);
      }
      const ang = Math.random() * Math.PI * 2;
      const r = 400 + Math.random() * 1200;
      npc.pos = { x: Math.cos(ang) * r, y: Math.sin(ang) * r };
      this.setNpcErrand(npc, this.system);
      npc.angle = Math.atan2(npc.target.y - npc.pos.y, npc.target.x - npc.pos.x);
      this.npcs.push(npc);
    }
  }

  /** 5% of ships are a named captain, per the Nova Bible. */
  private maybeMakePerson(npc: NpcShip): void {
    if (Math.random() > 0.05) return;
    const govtId = this.system.govtId;
    const candidates = Object.values(PERSONS).filter((p) => {
      if (!this.personAvailable(p)) return false;
      const link = p.linkSyst;
      if (link === -1) return true;
      // an explicitly placed captain is already in the system; see
      // placeLinkedPersons — re-rolling one here would double them up
      if (link >= 128 && link <= 2175) return false;
      if (link >= 9999 && link <= 10255) return govtId === link - 9872;
      if (link >= 20000 && link <= 20255) return govtId !== link - 19872;
      return false;
    });
    if (candidates.length === 0) return;
    this.applyPerson(
      npc,
      candidates[Math.floor(Math.random() * candidates.length)],
    );
  }

  /** Turn a freshly made hull into a specific named captain. */
  private applyPerson(npc: NpcShip, person: PersonType): void {
    const type = SHIPS[String(person.shipType)];
    npc.personId = person.id;
    npc.typeId = String(person.shipType);
    npc.govtId = person.govt;
    npc.aiType = person.aiType;
    npc.sprite = SHIP_SPRITES[npc.typeId] ?? null;
    npc.stats = {
      turnRate: type.turnRate,
      accel: type.accel,
      maxSpeed: type.maxSpeed,
    };
    npc.shipName = person.shipName || null;
    npc.weapons = personLoadout(person, type);
    // ShieldMod is a percentage of the stock ship's shields
    const shieldMult = person.shieldMod > 0 ? person.shieldMod / 100 : 1;
    npc.initDefense(
      Math.round(type.shield * shieldMult),
      type.armor,
      type.shieldRechPerSec,
      (type.flags & 0x10) !== 0 ? 0.1 : 0.33,
    );
    if (person.credits > 0) {
      npc.booty = Math.round(person.credits * (0.75 + Math.random() * 0.5));
      npc.bootyFlags |= 0x40;
    }
    // a captain with a job to offer shouldn't open fire before offering it
    if (person.linkMission >= 128) npc.hostile = false;
    /*
     * gövt Flags 0x0800, "ships of this govt start out disabled (derelicts)".
     * Both governments named Derelicts carry it, and between them they own
     * every përs the field applies to: the eleven Drifting Derelicts and the
     * tutorial's Pirate Viper. Without it a "derelict" spawns with aggress 0
     * and AI type 1 and simply flies off, which is not something you can be
     * sent to shoot down.
     */
    if (((GOVT_FLAGS[String(person.govt)] ?? 0) & 0x0800) !== 0)
      npc.disabled = true;

    const radio = STR_LISTS["7101"]?.[person.hailQuote - 1]; // 1-based, as above
    if (radio) this.message(`${person.name}: "${radio}"`);
  }

  /**
   * Spawn one of Nova's bööm explosions. The bööm resource says which spïn
   * sheet to play (400 + GraphicIndex), which snd to fire (300 + SoundIndex)
   * and how fast to run the frames — FrameAdvance is hundredths of a sprite
   * frame per 30Hz tick, so a nuclear detonation at 30 crawls while a blaster
   * impact at 100 snaps past.
   */
  private spawnExplosion(
    x: number,
    y: number,
    scale: number,
    boomType = 133,
    /** skip the bööm snd (player death plays its own 371×3 → 303 sequence) */
    silent = false,
  ): void {
    const boom = BOOMS[String(boomType)] ?? BOOMS["133"];
    if (!boom) return;
    const boomId = String(400 + boom.graphicIndex);
    if (!BOOM_SPRITES[boomId]) return;
    // SoundIndex -1 is a silent explosion (Nova Bible); without the guard that
    // asked for snd 299. No stock bööm uses it, but a plug-in easily could.
    if (!silent && boom.soundIndex >= 0) {
      playSndAt(
        300 + boom.soundIndex,
        0.45,
        x - this.ship.pos.x,
        y - this.ship.pos.y,
      );
    }
    this.explosions.push({
      x,
      y,
      boomId,
      t: 0,
      scale,
      fps: (30 * Math.max(10, boom.frameAdvance)) / 100,
    });
  }

  /**
   * `deliberate` is the pilot pulling the handle — Alt-X or the sidebar's EJECT
   * button. A fitted escape pod always answers that. It does *not* answer on
   * its own when the ship blows up: oütf ModType 20 is "auto-eject (requires
   * escape pod to work)" and the outfit's own text says why it exists, firing
   * the pod "when it detects your armor state fall to zero ... without waiting
   * for any input from the pilot". A pod alone waits for the pilot, which is
   * what makes the 20,000-credit auto-eject "something of a must".
   *
   * Strict play has no say in this. Strict means a death is permanent, not
   * that the pod is disabled — ejecting is exactly how a strict pilot lives.
   */
  private playerDestroyed(deliberate = false): void {
    // already mid-sequence (further hits while armour is zero)
    if (this.playerDeath) return;

    this.projectiles = [];
    this.beams = [];
    // dying mid-charge cuts the hyperdrive with everything else
    this.jump = null;
    stopSustained(JUMP_SND_KEY);
    this.ship.vel = { x: 0, y: 0 };
    this.ship.thrusting = false;
    this.autopilot = false;
    this.hailUi.close();
    this.infoUi.close();

    const withPod = this.gear.escapePod && (deliberate || this.gear.autoEject);
    // Klaxon ×3 → ShipExplodes (+ Eject with the boom if you have a pod)
    const duration = Math.max(playPlayerDeath(withPod), playerDeathDuration());
    this.playerDeath = {
      t: 0,
      duration,
      withPod,
      waitLeft: withPod ? 0 : 1.0,
      x: this.ship.pos.x,
      y: this.ship.pos.y,
      nextFx: 0,
    };
    // opening burst — more fire is spawned every few frames in updatePlayerDeath
    this.spawnExplosion(this.ship.pos.x, this.ship.pos.y, 2.0, 133, true);
    this.spawnExplosion(this.ship.pos.x, this.ship.pos.y, 1.4, 132, true);
  }

  /**
   * Hold on the wreck while klaxons and the explode sample play. Sparks keep
   * lighting at the hull; only when the cue ends do we resolve pod / tug / menu.
   */
  private updatePlayerDeath(dt: number): void {
    const d = this.playerDeath;
    if (!d) return;
    d.t += dt;
    this.ship.pos.x = d.x;
    this.ship.pos.y = d.y;
    this.ship.vel = { x: 0, y: 0 };
    this.ship.thrusting = false;
    // slow tumble of the hulk
    this.ship.angle += 0.55 * dt;

    // continuous fire: secondary blasts for the whole sound sequence
    d.nextFx -= dt;
    if (d.nextFx <= 0) {
      // denser early (klaxon phase), still burning through the boom sample
      const early = d.t < d.duration * 0.35;
      d.nextFx = early
        ? 0.12 + Math.random() * 0.1
        : 0.22 + Math.random() * 0.18;
      const spread = early ? 55 : 80;
      const ox = (Math.random() - 0.5) * spread;
      const oy = (Math.random() - 0.5) * spread;
      const scale = (early ? 1.1 : 0.7) + Math.random() * 1.1;
      // 133 = ship exploding, 132 = ship breakup (smaller fire)
      const kind = Math.random() < 0.55 ? 133 : 132;
      this.spawnExplosion(d.x + ox, d.y + oy, scale, kind, true);
    }

    if (d.t >= d.duration) {
      if (d.waitLeft > 0) {
        d.waitLeft -= dt;
      } else {
        this.finishPlayerDeath();
      }
    }
  }

  private finishPlayerDeath(): void {
    const d = this.playerDeath;
    if (!d) return;
    this.playerDeath = null;
    this.explosions = [];

    /*
     * The escape pod is the only thing that lets you keep playing. dësc 13999,
     * the reserved "message shown after the player uses an escape pod", says
     * what it costs you: you drift, a prospector picks you up, and you "work
     * several dreary odd jobs to scratch up enough money to buy a new ship" —
     * so the hull and everything bolted to it are gone. Credits, record,
     * missions and the outfits Flags 0x0004 marks as staying with you through
     * a change of ship survive; you come back down in a Shuttle.
     */
    if (d.withPod) {
      // the hull a new pilot flies — the chär template's own starting ship
      const podShip =
        START_TEMPLATE && SHIPS[String(START_TEMPLATE.shipType)]
          ? String(START_TEMPLATE.shipType)
          : "128";
      const keep: Record<string, number> = {};
      for (const [id, n] of Object.entries(this.player.outfits)) {
        if (((OUTFITS[id]?.flags ?? 0) & 0x0004) !== 0) keep[id] = n;
      }
      this.player.outfits = keep;
      this.player.ammo = {};
      this.player.cargo = {};
      this.applyShipType(podShip);
      grantHullOutfits(podShip, this.player.outfits);
      this.recomputeLoadout();
      this.ship.shield = this.ship.maxShield;
      this.ship.armor = this.ship.maxArmor;
      this.ship.vel = { x: 0, y: 0 };
      const haven =
        this.system.planets.find((p) => p.landable) ??
        getSystem(START_SYSTEM_ID).planets.find((p) => p.landable);
      const text = DESCS["13999"];
      if (haven) {
        this.ship.pos = {
          x: haven.pos.x + haven.radius * 2,
          y: haven.pos.y + haven.radius,
        };
        if (text) this.pendingMissionEvents.push({ title: "", text });
        this.player.landedOn = haven.id;
        this.player.lastPad = haven.id;
        this.mode = "landed";
        // RAM only — next leave-planet commits. Death before then loses the pod trip.
        this.landedUi.show(haven, this.system);
      } else {
        this.message(
          "You eject in your escape pod and are picked up — the ship is lost, but you live.",
        );
      }
      return;
    }
    /*
     * Without a pod, the run ends. Live progress since the last leave-planet
     * is discarded (it was never written). The main menu opens with no pilot
     * loaded. Strict: mark the pilot dead so they cannot Continue. Otherwise
     * Open Pilot reloads the last leave-planet save.
     */
    const id = this.pilotId;
    const wasStrict = this.player.strict;
    this.pilotId = null; // nothing more is written for this run
    this.resumeMode = null;
    this.landedUi.hide();
    this.hailUi.close();
    this.infoUi.close();
    this.plunderUi.close();
    this.mode = "menu";
    if (wasStrict && id) markPilotDead(id);
    // pilotId is null → menu clears the selected pilot ("no pilot loaded")
    this.onMenu?.();
  }

  // ---------------- landing ----------------

  private nearestPlanet(): { planet: PlanetDef; dist: number } | null {
    let best: { planet: PlanetDef; dist: number } | null = null;
    for (const p of this.system.planets) {
      const d = Math.hypot(
        p.pos.x - this.ship.pos.x,
        p.pos.y - this.ship.pos.y,
      );
      if (!best || d < best.dist) best = { planet: p, dist: d };
    }
    return best;
  }

  /**
   * First press targets the nearest stellar (and cycles onward from there);
   * pressing again with one selected and in range takes you down.
   */
  // ---------------- autopilot and nav ----------------

  /**
   * Nova's Q: hand the stick over. With a world targeted the autopilot flies
   * there and lands; otherwise it flies the plotted hyperspace course, jumping
   * on arrival. Any manual input, or N, drops it.
   */
  private toggleAutopilot(): void {
    if (this.autopilot) {
      this.autopilot = false;
      this.message("Autopilot disengaged.");
      return;
    }
    if (!this.targetPlanet && this.route.length === 0) {
      this.message(
        "Autopilot needs a destination — target a world (L) or plot a course (M).",
      );
      return;
    }
    this.autopilot = true;
    this.message(
      this.targetPlanet
        ? `Autopilot engaged: ${this.targetPlanet.name}.`
        : "Autopilot engaged: following plotted course.",
    );
  }

  /**
   * Fly the ship for one frame. Returns false once there is nothing left to do,
   * which drops the autopilot back into your hands.
   */
  private updateAutopilot(dt: number): boolean {
    if (this.targetPlanet) {
      const dx = this.targetPlanet.pos.x - this.ship.pos.x;
      const dy = this.targetPlanet.pos.y - this.ship.pos.y;
      const dist = Math.hypot(dx, dy);
      if (dist <= this.targetPlanet.radius * LAND_DIST + 40) {
        // close enough: kill the drift, then set her down
        if (this.ship.speed > 60) {
          const retro = Math.atan2(-this.ship.vel.y, -this.ship.vel.x);
          const facing = this.ship.steerToward(dt, retro);
          this.ship.update(dt, 0, facing);
          return true;
        }
        this.autopilot = false;
        this.tryLand(this.targetPlanet);
        return false;
      }
      // brake into the approach so we don't sail straight past
      const closing =
        (this.ship.vel.x * dx + this.ship.vel.y * dy) / (dist || 1);
      const braking = dist < 900 && closing > dist * 0.9;
      const desired = braking
        ? Math.atan2(-this.ship.vel.y, -this.ship.vel.x)
        : Math.atan2(dy, dx);
      const facing = this.ship.steerToward(dt, desired);
      this.ship.update(dt, 0, facing);
      return true;
    }
    if (this.route.length > 0) {
      /*
       * A course plotted from a standing start begins inside the no-jump zone,
       * so fly out of it first rather than asking startJump every frame and
       * papering the screen with the refusal.
       */
      if (this.insideNoJumpZone()) {
        const out = Math.atan2(this.ship.pos.y, this.ship.pos.x);
        const facing = this.ship.steerToward(dt, out);
        this.ship.update(dt, 0, facing);
        return true;
      }
      this.startJump(); // startJump handles fuel and takes over the stick
      return this.jump !== null;
    }
    return false;
  }

  /** Step the plotted course through this system's neighbours (default \). */
  private cycleJumpDestination(): void {
    const links = this.system.links.filter((id) => {
      try {
        getSystem(id);
        return true;
      } catch {
        return false;
      }
    });
    if (links.length === 0) {
      this.message("No hyperlanes lead out of this system.");
      return;
    }
    const current = this.route.length > 0 ? this.route[0] : null;
    const idx = current ? links.indexOf(current) : -1;
    this.setDestination(links[(idx + 1) % links.length]);
  }

  /** Full-opacity linger after H / \ (or after releasing H). */
  private static readonly FLOAT_MAP_HOLD = 2.4;
  /** Fade duration after the hold; total on-screen time is HOLD + FADE. */
  private static readonly FLOAT_MAP_FADE = 0.85;

  /**
   * Keep the floating mini map up for a few seconds. Called while display-mini-map
   * is held and when cycle-jump-dest peeks the course — not a full map mode.
   * After the hold it fades out rather than vanishing.
   */
  private peekFloatingMap(): void {
    this.floatingMapUntil =
      this.time + Game.FLOAT_MAP_HOLD + Game.FLOAT_MAP_FADE;
  }

  private floatingMapVisible(): boolean {
    return (
      this.mode === "flight" &&
      (this.floatingMapUntil > this.time ||
        actionDown(this.input, "hyperSelect"))
    );
  }

  /** 1 while held / during the hold; eases to 0 over FLOAT_MAP_FADE. */
  private floatingMapAlpha(): number {
    if (actionDown(this.input, "hyperSelect")) return 1;
    const remaining = this.floatingMapUntil - this.time;
    if (remaining <= 0) return 0;
    if (remaining >= Game.FLOAT_MAP_FADE) return 1;
    // ease-out so the last bit is a soft dissolve
    const t = remaining / Game.FLOAT_MAP_FADE;
    return t * t;
  }

  /** Nova's N: forget the course and take back the stick. */
  private navOff(): void {
    this.route = [];
    this.routeDest = null;
    this.autopilot = false;
    this.message("Navigation computer cleared.");
  }

  /** True while an escape pod is fitted — the sidebar shows EJECT for it. */
  get hasEscapePod(): boolean {
    return this.gear.escapePod;
  }

  /** Alt-X, or the sidebar button: leave in the pod while the ship still flies. */
  ejectFromShip(): void {
    if (this.playerDeath || this.mode !== "flight") return;
    if (!this.gear.escapePod) {
      this.message("You have no escape pod fitted.");
      return;
    }
    if (!confirm("Abandon ship? Your ship, outfits and cargo will be lost."))
      return;
    // death cue (klaxon ×3 + explode + eject) is handled in playerDestroyed
    this.player.cargo = {};
    this.playerDestroyed(true);
  }

  /** Nova's self-destruct: scuttle the ship where it stands. */
  private selfDestruct(): void {
    if (!confirm("Self-destruct? This will destroy your ship.")) return;
    this.player.cargo = {};
    this.playerDestroyed();
  }

  /** Nova's P: what you are flying and what is bolted to it. */
  private openPlayerInfo(): void {
    if (this.infoUi.open) {
      this.infoUi.close();
      return;
    }
    const type = SHIPS[this.player.shipId];
    const mounts = this.mountStatus();
    const rating = ratingName(this.player.ratingPoints);
    const outfits = Object.entries(this.player.outfits)
      .map(
        ([id, n]) =>
          `${n > 1 ? `${n} × ` : ""}${OUTFITS[id]?.name.split(";")[0] ?? id}`,
      )
      .sort();
    const wing = this.player.escorts
      .map((e) => SHIPS[e.shipId]?.name.split(";")[0] ?? "Ship")
      .sort();

    const kb = (id: ActionId): string => {
      const c = getBinding(id);
      return c.code ? formatChord(c) : "—";
    };

    // Cargo manifest: commodities in the hold
    const cargoRows: { label: string; value: string }[] = Object.entries(
      this.player.cargo,
    )
      .filter(([, qty]) => qty > 0)
      .map(([id, qty]) => ({
        label: COMMODITIES.find((c) => c.id === id)?.name ?? id,
        value: `${qty}t`,
      }));

    // Honors: active ranks with their government name
    const honorRows: { label: string; value: string }[] =
      this.player.ranks.map((id) => {
        const rank = RANKS[String(id)];
        const govtName = GOVTS[String(rank?.govt)]?.name ?? "";
        return {
          label: rank?.name ?? `Rank ${id}`,
          value: govtName,
        };
      });

    this.infoUi.show({
      title: this.pilotName,
      sections: [],
      tabs: [
        {
          id: "general",
          label: "General",
          sections: [
            {
              title: "Ship",
              rows: [
                {
                  label: "Class",
                  value: type?.name.split(";")[0] ?? "Unknown",
                },
                {
                  label: "Shields",
                  value: `${Math.round(this.ship.shield)} / ${Math.round(this.ship.maxShield)}`,
                },
                {
                  label: "Armor",
                  value: `${Math.round(this.ship.armor)} / ${Math.round(this.ship.maxArmor)}`,
                },
                {
                  label: "Fuel",
                  value: `${Math.floor(this.player.fuelJumps)} / ${this.player.maxFuelJumps} jumps`,
                },
                { label: "Free mass", value: `${this.freeMassLeft()} tons` },
                {
                  label: "Mounts",
                  value:
                    mounts.maxGuns > 0 || mounts.maxTurrets > 0
                      ? `${Math.min(mounts.guns, mounts.maxGuns)}/${mounts.maxGuns} guns · ${Math.min(mounts.turrets, mounts.maxTurrets)}/${mounts.maxTurrets} turrets`
                      : "None",
                },
              ],
            },
            {
              title: "Record",
              rows: [
                {
                  label: "Credits",
                  value: `${this.player.credits.toLocaleString()} cr`,
                },
                { label: "Combat rating", value: rating },
                { label: "Date", value: formatDate(this.player.date) },
                {
                  label: "Systems charted",
                  value: String(this.player.explored.length),
                },
              ],
            },
          ],
        },
        {
          id: "cargo",
          label: "Cargo",
          sections: [
            {
              title: "Hold",
              rows: [
                {
                  label: "Ship capacity",
                  value: `${this.player.cargoCap} tons`,
                },
                ...(this.fleetCapacity()
                  ? [
                      {
                        label: "Escort capacity",
                        value: `${this.fleetCapacity()} tons`,
                      },
                    ]
                  : []),
                {
                  label: "Used",
                  value: `${this.cargoUsed()} / ${this.cargoCapacity()} tons`,
                },
              ],
            },
            ...(cargoRows.length
              ? [{ title: "Manifest", rows: cargoRows }]
              : [{ title: "Manifest", rows: [], note: "Hold is empty." }]),
          ],
        },
        {
          id: "extras",
          label: "Extras",
          sections: [
            {
              title: "Outfits",
              rows: [],
              note: outfits.length ? outfits.join(", ") : "Nothing fitted.",
            },
            {
              title: "Escorts",
              rows: [],
              note: wing.length ? wing.join(", ") : "Flying solo.",
            },
          ],
        },
        {
          id: "honors",
          label: "Honors",
          sections: [
            {
              title: "Ranks & titles",
              rows: honorRows,
              note: honorRows.length ? undefined : "No ranks or titles held.",
            },
          ],
        },
        {
          id: "keybindings",
          label: "Keybindings",
          sections: [
            {
              title: "Flight",
              rows: [
                {
                  label: "Turn left / right",
                  value: `${kb("turnLeft")} / ${kb("turnRight")}`,
                },
                {
                  label: "Accelerate / reverse",
                  value: `${kb("accelerate")} / ${kb("reverse")}`,
                },
                { label: "Afterburner", value: kb("afterburner") },
                { label: "Aim toward target", value: kb("aimAssist") },
                { label: "Aim toward cursor", value: kb("aimCursor") },
                { label: "Autopilot", value: kb("autopilot") },
              ],
            },
            {
              title: "Combat",
              rows: [
                { label: "Fire primary", value: kb("firePrimary") },
                { label: "Fire secondary", value: kb("fireSecondary") },
                { label: "Select secondary", value: kb("selectSecondary") },
                { label: "Cycle targets", value: kb("cycleTargets") },
                {
                  label: "Target nearest hostile",
                  value: kb("targetClosest"),
                },
                {
                  label: "Select under cursor",
                  value: kb("selectUnderCursor"),
                },
                { label: "Board disabled ship", value: kb("board") },
                { label: "Eject (escape pod)", value: kb("eject") },
              ],
            },
            {
              title: "Navigation",
              rows: [
                { label: "Land / dock", value: kb("land") },
                {
                  label: "Cycle planets / stations",
                  value: kb("cycleStellars"),
                },
                { label: "Hyperspace jump", value: kb("jump") },
                {
                  label: "Select jump destination",
                  value: kb("cycleJumpDest"),
                },
                { label: "Star map", value: kb("map") },
                { label: "Mini map", value: kb("hyperSelect") },
              ],
            },
            {
              title: "Escorts & comms",
              rows: [
                { label: "Hail", value: kb("hail") },
                { label: "Escorts: attack target", value: kb("escortAttack") },
                { label: "Escorts: form up", value: kb("escortForm") },
                { label: "Escorts: hold position", value: kb("escortHold") },
                { label: "Recall fighters", value: kb("recallFighters") },
              ],
            },
            {
              title: "Info",
              rows: [
                {
                  label: "Player info (this panel)",
                  value: kb("playerInfo"),
                },
                { label: "Mission log", value: kb("missionInfo") },
                { label: "Jettison cargo", value: kb("jettison") },
                { label: "Engage cloak", value: kb("cloak") },
                { label: "Nav system off", value: kb("navOff") },
              ],
            },
          ],
        },
      ],
      close: () => undefined,
    });
  }

  /**
   * Nova's I: the jobs you are carrying; click one for its briefing.
   * Same panel in flight and while landed — keybinding only (no spaceport
   * menu entry). Abort is offered when mïsn CanAbort allows it.
   */
  openMissionInfo(): void {
    if (this.infoUi.open) {
      this.infoUi.close();
      return;
    }
    this.infoUi.show({
      title: "Mission Log",
      sections: () =>
        this.player.activeMissions.some((a) => {
          const m = MISSIONS[String(a.misnId)];
          return !m || !isSilentMission(m);
        })
          ? []
          : [
              {
                title: "No active missions",
                rows: [],
                note: "Look for work at a spaceport BBS or bar.",
              },
            ],
      pickList: () =>
        this.player.activeMissions
          .filter((a) => {
            const m = MISSIONS[String(a.misnId)];
            return !m || !isSilentMission(m);
          })
          .map((a) => this.missionPickItem(a)),
      onAbortPick: (id) => {
        const active = this.player.activeMissions.find(
          (a) => this.missionPickId(a) === id,
        );
        if (active) this.abortMission(active);
      },
      close: () => undefined,
    });
  }

  /**
   * Stable id for a live mission row (indices shift when one is aborted).
   * Must be safe in an HTML `data-pick` attribute — null bytes (and similar)
   * are truncated by the browser, which made list clicks always snap back to
   * the first mission.
   */
  private missionPickId(a: ActiveMission): string {
    return [
      a.misnId,
      a.acceptedDay,
      a.name,
      a.travelSpobId ?? "",
      a.returnSpobId ?? "",
    ]
      .map((part) => encodeURIComponent(String(part)))
      .join("|");
  }

  private missionPickItem(a: ActiveMission): InfoPickItem {
    const dest = a.travelDone ? a.returnSpobId : a.travelSpobId;
    const entry = dest ? SPOBS.get(dest) : null;
    let where = "wherever the job ends";
    if (entry) {
      let sysName = "deep space";
      try {
        sysName = getSystem(entry.systemId).name;
      } catch {
        // a destination in a system this galaxy build doesn't have
      }
      where = `${entry.planet.name}, ${sysName}`;
    }
    const rows: InfoRow[] = [{ label: "Destination", value: where }];
    if (a.cargoLoaded && a.cargoName) {
      rows.push({
        label: "Carrying",
        value: `${a.cargoQty}t ${a.cargoName}`,
      });
    }
    let timeLeft = "";
    if (a.timeLimit > 0) {
      const left = Math.max(
        0,
        a.timeLimit - (this.player.date - a.acceptedDay),
      );
      timeLeft = `${Math.ceil(left)} day${Math.ceil(left) === 1 ? "" : "s"} left`;
      rows.push({ label: "Time left", value: timeLeft });
    }
    // Collapsed row shows destination always, and the clock when the job has one.
    const subtitle = timeLeft ? `${where} · ${timeLeft}` : where;
    /*
     * BriefText is the full briefing shown after Accept; QuickBrief is the
     * one-line log restatement. Prefer the full text when you open a job.
     */
    const m = MISSIONS[String(a.misnId)];
    const raw = m
      ? (descText(m.briefText) ?? descText(m.quickBrief) ?? "")
      : "";
    const body = raw
      ? substituteTags(raw, m!, a, this.pilotName, this.rankTags())
      : "";
    return {
      id: this.missionPickId(a),
      label: a.name,
      subtitle,
      rows,
      body: body || undefined,
      canAbort: !!(m && m.canAbort),
    };
  }

  /** Whether the I / P / jettison panel is up (landed key handlers need this). */
  get infoOpen(): boolean {
    return this.infoUi.open;
  }

  /**
   * Esc against the info panel: dismiss abort confirm first, else close.
   * Returns true when the panel handled the key (caller should swallow it).
   */
  escapeInfo(): boolean {
    if (!this.infoUi.open) return false;
    if (!this.infoUi.handleEscape()) this.infoUi.close();
    return true;
  }

  /** Enter against the info panel (abort confirm). No-op when none is up. */
  enterInfo(): void {
    if (this.infoUi.open) this.infoUi.handleEnter();
  }

  /** A — abort the expanded mission in the mission log. */
  abortInfo(): void {
    if (this.infoUi.open) this.infoUi.handleAbort();
  }

  /** ArrowUp / ArrowDown through the mission log list. */
  arrowInfo(delta: number): void {
    if (this.infoUi.open) this.infoUi.handleArrow(delta);
  }

  /** Nova's Alt-K: the hold, with a way to put it over the side. */
  private openJettison(): void {
    if (this.infoUi.open) {
      this.infoUi.close();
      return;
    }
    this.infoUi.show({
      title: "Cargo Hold",
      // a thunk, so the tonnage falls as you dump
      sections: () => {
        /*
         * Two lines when a trader flies with you, one otherwise. The split
         * matters to the player because only the hull's share competes with
         * mission freight — see cargo.ts.
         */
        const fleet = this.fleetCapacity();
        const split = this.cargoStowage();
        const rows = [
          {
            label: "Used",
            value: `${this.cargoUsed()} / ${this.cargoCapacity()} tons`,
          },
        ];
        if (fleet > 0) {
          rows.push({
            label: "Stowed",
            value: `${split.hull}t aboard · ${split.fleet}t in escorts (${fleet}t)`,
          });
        }
        return [{ title: "Hold", rows }];
      },
      jettison: () =>
        Object.entries(this.player.cargo)
          .filter(([, tons]) => tons > 0)
          .map(([id, tons]) => ({
            id,
            name: cargoLabel(id),
            tons,
          })),
      onJettison: (id, qty) => this.jettison(id, qty),
      close: () => undefined,
    });
  }

  /** Nova's Alt-K: dump a commodity overboard to make room. */
  jettison(commodityId: string, qty: number): void {
    const held = this.player.cargo[commodityId] ?? 0;
    const dumped = Math.min(held, qty);
    if (dumped <= 0) return;
    if (dumped >= held) delete this.player.cargo[commodityId];
    else this.player.cargo[commodityId] = held - dumped;
    this.message(`Jettisoned ${dumped}t of ${cargoLabel(commodityId)}.`);
  }

  /**
   * Land binding: lock the nearest stellar if nothing is targeted, otherwise
   * keep trying to land on the current target (range/speed messages only —
   * never steps to another world). Cycle planets with cycleStellars (":").
   */
  private selectOrLand(): void {
    const stellars = this.system.planets;
    if (stellars.length === 0) {
      this.message("There is nothing to land on in this system.");
      return;
    }
    if (!this.targetPlanet) {
      const byDist = [...stellars].sort(
        (a, b) =>
          Math.hypot(a.pos.x - this.ship.pos.x, a.pos.y - this.ship.pos.y) -
          Math.hypot(b.pos.x - this.ship.pos.x, b.pos.y - this.ship.pos.y),
      );
      this.setTargetPlanet(byDist[0]!);
      return;
    }
    this.tryLand(this.targetPlanet);
  }


  /**
   * Cycle planets / stations / gates by distance from the ship (nearest first).
   * After the last body, clears the lock (nothing selected), then starts over.
   * Separate from Land so L only docks the locked stellar.
   */
  private cycleStellars(): void {
    const byDist = this.system.planets
      .filter((el) => !el.isWormhole)
      .sort(
        (a, b) =>
          Math.hypot(a.pos.x - this.ship.pos.x, a.pos.y - this.ship.pos.y) -
          Math.hypot(b.pos.x - this.ship.pos.x, b.pos.y - this.ship.pos.y),
      );
    if (byDist.length === 0) {
      this.message("There is nothing to target in this system.");
      return;
    }
    /*
     * Same pattern as cycleTarget: A → B → … → last → none → A …
     * so you can deselect a stellar without a separate key.
     */
    const idx = this.targetPlanet ? byDist.indexOf(this.targetPlanet) : -1;
    if (idx < 0) {
      this.setTargetPlanet(byDist[0]!);
    } else if (idx >= byDist.length - 1) {
      this.setTargetPlanet(null);
    } else {
      this.setTargetPlanet(byDist[idx + 1]!);
    }
  }

  /**
   * Target a stellar. Selecting a working hypergate starts its open sequence;
   * landing (when close and slow) is what opens the destination chart.
   * Focus cue: snd 151 when you can land (or use a working gate/wormhole),
   * snd 153 when clearance is refused or the stellar is unusable.
   */
  private setTargetPlanet(planet: PlanetDef | null): void {
    const prev = this.targetPlanet;
    this.targetPlanet = planet;
    this.targetNpc = null;
    if (
      prev &&
      prev.isHypergate &&
      prev.id !== planet?.id &&
      this.gateDocking?.id !== prev.id
    ) {
      this.closeGate(prev.id);
    }
    if (!planet) return;
    if (planet.isHypergate && this.gateIsWorking(planet) && this.hasHypergateAccess) {
      this.beginOpenGate(planet);
    }
    const dist = Math.round(
      Math.hypot(
        planet.pos.x - this.ship.pos.x,
        planet.pos.y - this.ship.pos.y,
      ),
    );
    this.message(`Target: ${planet.name} (${dist} away).`);
    playSnd(
      this.canLandOn(planet) ? SND.BEEP2 : SND.LANDING_DENIED,
      0.45,
    );
  }

  /**
   * Whether targeting this stellar should sound as landable (151) rather than
   * denied (153). Mirrors tryLand's clearance rules, not range or speed.
   */
  private canLandOn(planet: PlanetDef): boolean {
    const isGate = planet.isHypergate || planet.isWormhole;
    if (isGate)
      return (
        this.gateIsWorking(planet) &&
        this.hasHypergateAccess &&
        this.clearedToLand(planet, this.system.govtId)
      );
    if (!planet.landable) return false;
    if (this.hasActiveMissionToPlanet(planet.id)) return true;
    return this.clearedToLand(planet, this.system.govtId);
  }

  private tryLand(chosen?: PlanetDef): void {
    // Dead in space: no engines, no docking thrusters, no traffic clearance.
    // Hail a friendly ship for assistance first — landing would soft-lock you
    // into free full repairs on a pad you cannot actually reach under power.
    if (this.ship.disabled) {
      this.message(
        "Your ship is disabled — you cannot land. Request assistance from a nearby ship.",
      );
      playSnd(SND.LANDING_DENIED, 0.55);
      return;
    }
    const near = chosen
      ? {
          planet: chosen,
          dist: Math.hypot(
            chosen.pos.x - this.ship.pos.x,
            chosen.pos.y - this.ship.pos.y,
          ),
        }
      : this.nearestPlanet();
    if (!near) {
      this.message("There is nowhere to land in this system.");
      return;
    }
    const { planet, dist } = near;
    if (dist > planet.radius * LAND_DIST + 60) {
      this.message(`Too far from ${planet.name} to land.`);
      playSnd(SND.LANDING_DENIED, 0.55);
      return;
    }
    const isGate = planet.isHypergate || planet.isWormhole;
    if (isGate && !this.gateIsWorking(planet)) {
      // a dead gate: its ring stays dark however long you sit in front of it
      this.message(
        `${planet.name} is derelict. The ring is dark and will not answer.`,
      );
      return;
    }
    if (isGate && !this.hasHypergateAccess) {
      this.message(
        `${planet.name}: hypergate access denied.`,
      );
      playSnd(SND.LANDING_DENIED, 0.55);
      return;
    }
    if (!planet.landable && !isGate) {
      this.message(`You cannot land on ${planet.name}.`);
      return;
    }
    if (this.ship.speed > LAND_SPEED) {
      this.message("You are moving too fast to land.");
      playSnd(SND.LANDING_DENIED, 0.55);
      return;
    }

    /*
     * spöb MinStatus: "the point on your record in the current system that
     * you'll be denied landing clearance on this stellar", ignored outright on
     * an uninhabited one. 32767 is a world that never clears anybody — the
     * Bible's "player can never land" — and 19 stellars read it, so those get
     * a flat refusal rather than an invitation to improve your standing.
     *
     * Exception: if you have an active mission whose current destination
     * (travelSpobId or returnSpobId) is this planet, you may land anyway.
     */
    if (
      !isGate &&
      !this.hasActiveMissionToPlanet(planet.id) &&
      !this.clearedToLand(planet, this.system.govtId)
    ) {
      this.message(
        planet.minStatus === MIN_STATUS_NEVER
          ? `${planet.name} refuses all traffic. You are not getting down there.`
          : `${planet.name} denies you landing clearance. They want a better record than yours.`,
      );
      playSnd(SND.LANDING_DENIED, 0.55); // snd 154
      return;
    }

    this.ship.vel = { x: 0, y: 0 };
    this.hailUi.close();
    if (isGate) {
      // Wormhole: Bible teleports you with no chooser. Hypergate: destination
      // map once the ring is open (select already started the open sequence).
      if (planet.isWormhole) {
        const destId = this.pickWormholeDest(planet);
        if (!destId) {
          this.message("The wormhole churns, but goes nowhere.");
          return;
        }
        this.useGate(destId);
        return;
      }
      this.gateDocking = planet;
      this.beginOpenGate(planet);
      const st = this.gateAnim.get(planet.id);
      if (st?.phase === "open") this.openGateChooser(planet);
      else
        this.message(`${planet.name} is still powering up. Hold position...`);
      return;
    }

    this.player.landedOn = planet.id;
    this.player.lastPad = planet.id;
    // Landing does not move the calendar. Nova advances the date on hyperspace
    // jumps (and on missions that set DatePostInc), and nowhere else — there is
    // no landing rule in the Bible, and putting one here made a shopping run
    // through four worlds cost four days.
    this.mode = "landed";
    this.projectiles = [];
    this.targetNpc = null;
    this.ship.shield = this.ship.maxShield;
    this.ship.armor = this.ship.maxArmor; // free repairs while docked, EV-style
    /*
     * Auto-recharger (oütf ModType 19) only talks to spaceport computers —
     * same places that sell fuel by hand, at the same price. It must not top
     * up on uninhabited rocks or other pads with no services.
     */
    if (this.gear.autoRefuel) this.refuel();
    if (planet.shipyard) this.processEscortPending();
    // No disk write — shopping and mission acceptances stay RAM until takeoff.
    this.landedUi.show(planet, this.system);
  }

  /** True if any active mission currently wants the player to visit this planet. */
  private hasActiveMissionToPlanet(planetId: string): boolean {
    return this.player.activeMissions.some((active) => {
      const dest = active.travelDone
        ? active.returnSpobId
        : active.travelSpobId;
      return dest === planetId;
    });
  }

  /** called by the landed UI */
  depart(): void {
    // backing out of a gate chooser lets the ring shut again
    if (this.gateDocking) this.closeGate(this.gateDocking.id);
    // mission log can be open over the pad; don't leave it floating in flight
    this.infoUi.close();
    const planet = this.system.planets.find(
      (p) => p.id === this.player.landedOn,
    );
    if (planet) this.player.lastPad = planet.id;
    this.player.landedOn = null;
    // Landing consumes a day — the same unit hyperspace jumps cost.
    this.advanceDays(1);
    /*
     * Sole durable checkpoint. Everything bought, sold, accepted, or killed
     * since the previous takeoff is committed here; death before the next
     * leave discards the live session and reloads this file.
     */
    this.commitPilot();
    if (planet) {
      // You lift off from the pad you landed on, so you start on top of it and
      // fly clear under your own power — not already parked off to one side.
      this.ship.pos = { ...planet.pos };
      this.ship.vel = { x: 0, y: 0 };
    }
    this.mode = "flight";
    // Taking off puts a fresh system around you, the same way arriving from
    // hyperspace does: the traffic you left on the pad is gone and new ships
    // are flying. Without this the old NPCs sat frozen where you left them and
    // spawnEscorts() stacked a second copy of your wing on every takeoff.
    this.npcs = [];
    this.dockedNpcs = [];
    this.projectiles = [];
    this.beams = [];
    this.explosions = [];
    this.targetNpc = null;
    this.targetPlanet = null;
    this.populateNpcs();
    this.populateAsteroids();
    this.spawnMissionShips();
    this.spawnEscorts();
    this.landedUi.hide();
  }

  // ---------------- hyperjump ----------------

  setDestination(destId: string): void {
    if (destId === this.player.systemId) {
      this.route = [];
      this.routeDest = null;
      return;
    }
    const route = findRoute(this.player.systemId, destId);
    if (!route) {
      this.message("No hyperlane route to that system.");
      return;
    }
    this.route = route;
    this.routeDest = destId;
    const dest = getSystem(destId);
    this.message(
      `Course set for ${dest.name}: ${route.length} jump${route.length === 1 ? "" : "s"}.`,
    );
    // snd 152 — select-jump / course lock (same family as target select)
    playSnd(SND.TARGET, 0.45);
  }

  /**
   * The no-jump zone. The Bible mentions it once, in oütf ModType 23 —
   * "amount to increase or decrease the no-jump zone's radius by (the standard
   * radius is 1000)" — and the one outfit that uses it says where the zone
   * sits: the Horizontal Booster (ModVal -500) "allows you to enter hyperspace
   * from much closer to the system center". So it is a circle of radius 1000
   * about the origin, not a skirt around each stellar; 318 of Nova's 344
   * placed stellars sit inside it, which is why it reads from the cockpit as
   * being too close to the planet. Arrival is at 1700, safely outside.
   */
  get noJumpRadius(): number {
    return Math.max(0, 1000 + this.gear.jumpDist);
  }

  private insideNoJumpZone(): boolean {
    return Math.hypot(this.ship.pos.x, this.ship.pos.y) < this.noJumpRadius;
  }

  /** HUD: dim the hyperspace address while the jump is blocked (well or no fuel). */
  get inNoJumpZone(): boolean {
    return this.insideNoJumpZone() || this.player.fuelJumps < 1;
  }

  /**
   * shïp Flags 0x0001/0x0002/0x0004 are mutually exclusive "jumping speed"
   * multipliers in the Bible (75% / 125% / 150%). They scale the burn that
   * carries you into hyperspace, not the calendar day cost.
   */
  private jumpSpeedMult(): number {
    const flags = SHIPS[this.player.shipId]?.flags ?? 0;
    if (flags & 0x0004) return 1.5;
    if (flags & 0x0002) return 1.25;
    if (flags & 0x0001) return 0.75;
    return 1;
  }

  /**
   * Bible: oütf ModType 37 and shïp Flags2 0x0020 both mean the hull "can
   * jump without slowing down" — skip the retro burn and go straight to aim.
   */
  private canJumpWithoutSlowing(): boolean {
    if (this.gear.fastJump) return true;
    return ((SHIPS[this.player.shipId]?.flags2 ?? 0) & 0x0020) !== 0;
  }

  /**
   * Engage the hyperspace sequence toward the next plotted system.
   * `quiet` is for a held J: fail silently (no gravity-well spam) and only
   * speak up when the drive actually engages. A fresh press (`quiet = false`)
   * still explains every refusal.
   */
  private startJump(quiet = false): void {
    // already mid-sequence, mid-gate, or nothing to do
    if (this.jump || this.pendingGateDest) return;
    if (this.ship.disabled) {
      if (!quiet) {
        this.message("Your ship is disabled — the hyperdrive will not engage.");
        playSnd(SND.DENY, 0.5);
      }
      return;
    }
    if (this.route.length === 0) {
      if (!quiet) {
        this.message(
          `No hyperspace course set. Press ${formatChord(getBinding("cycleJumpDest"))} to pick a neighbour, or ${formatChord(getBinding("map"))} for the map.`,
        );
      }
      return;
    }
    if (this.insideNoJumpZone()) {
      if (!quiet) {
        this.message(
          "Too deep in the system's gravity well to jump. Head for open space.",
        );
        playSnd(SND.NO_JUMP, 0.55); // 153 — gravity well
      }
      return;
    }
    if (this.player.fuelJumps < 1) {
      if (!quiet) {
        this.message("Not enough hyperdrive fuel. Land somewhere and refuel.");
        playSnd(SND.DENY, 0.5); // 154
      }
      return;
    }
    if (this.ship.ionized) {
      if (!quiet) {
        this.message(
          "Your systems are ionized — the hyperdrive will not engage.",
        );
        playSnd(SND.DENY, 0.5); // 154
      }
      return;
    }
    const cur = this.system;
    const next = getSystem(this.route[0]);
    const dx = next.mapPos.x - cur.mapPos.x;
    const dy = next.mapPos.y - cur.mapPos.y;
    const mult = this.jumpSpeedMult();
    /*
     * Warp-up audio spans warm (hold still) + burn (streak). Stock shuttle
     * (mult 1): full sample — snd 128 ~6.08s at 1×, snd 129 ~4.21s at 2×.
     * Faster jumpers shorten both and pitch the sample up. Times are game-dt
     * (main multiplies dt by timeScale) so wall time matches sample / mult.
     */
    const clock2x = this.timeScale > 1;
    const warpSndId = clock2x ? SND.WARP_IN_BIG : SND.WARP_IN;
    const sampleSec = sndDuration(warpSndId, clock2x ? 3 : 6);
    const playbackRate = mult;
    const wallTotal = sampleSec / mult;
    // Hold still for a short spool before the streak — ~1.1s wall, or 22% of
    // the sample if that is shorter (fast jumpers).
    const wallWarm = Math.min(1.1, wallTotal * 0.22);
    const wallBurn = Math.max(0.35, wallTotal - wallWarm);
    const warmLeft = wallWarm * this.timeScale;
    const burnLeft = wallBurn * this.timeScale;
    const cruise = this.ship.stats.maxSpeed;
    const burnSpeed = Math.max(cruise * 4.5, 950) * mult;
    const burnAccel = Math.max(this.ship.stats.accel * 3.5, 600) * mult;
    // already crawling, inertialess, or flagged to skip the retro burn
    const skipBrake =
      this.canJumpWithoutSlowing() || this.inertialess || this.ship.speed < 45;
    this.jump = {
      phase: skipBrake ? "turning" : "braking",
      targetAngle: Math.atan2(dy, dx),
      warmLeft,
      burnLeft,
      burnTotal: burnLeft,
      burnSpeed,
      burnAccel,
      warpSndId,
      playbackRate,
    };
    this.message(
      skipBrake
        ? `Autopilot engaged: jumping to ${next.name}.`
        : `Autopilot engaged: braking for jump to ${next.name}.`,
    );

  }

  /**
   * Aligned and stopped: start the warp-up sample and hold station while it
   * spools. Motion begins only when warmLeft runs out (beginJumpBurn).
   */
  private beginJumpWarm(): void {
    const j = this.jump;
    if (!j || j.phase === "warming" || j.phase === "burning") return;
    j.phase = "warming";
    this.ship.vel = { x: 0, y: 0 };
    this.ship.thrusting = false;
    stopSustained(JUMP_SND_KEY);
    startSustained(
      JUMP_SND_KEY,
      j.warpSndId,
      false,
      0.5,
      j.playbackRate,
    );
    this.message("Hyperdrive spooling up...");
  }

  /** Leave the warm hold and streak into the jump (sound already running). */
  private beginJumpBurn(): void {
    const j = this.jump;
    if (!j || j.phase === "burning") return;
    j.phase = "burning";
    this.message("Hyperdrive engaged...");
  }

  /** Abort a hyperspace entry in progress (disabled hull, Esc to menu, …). */
  private cancelJumpSequence(): void {
    if (!this.jump) return;
    this.jump = null;
    stopSustained(JUMP_SND_KEY);
    this.jumpFlash = 0;
  }

  private updateJumpSequence(dt: number): void {
    const j = this.jump!;
    // Dead in space cannot finish align/burn — drop the sequence so Esc and
    // other controls are not locked behind a stuck jump.
    if (this.ship.disabled) {
      this.cancelJumpSequence();
      this.message("Jump aborted — your ship is disabled.");
      return;
    }
    if (j.phase === "braking") {
      // face reverse of current velocity and burn until nearly stopped
      if (this.ship.speed < 45) {
        j.phase = "turning";
        this.message("Aligning for hyperspace...");
      } else {
        const retro = Math.atan2(-this.ship.vel.y, -this.ship.vel.x);
        const facing = this.ship.steerToward(dt, retro);
        this.ship.update(dt, 0, facing);
      }
      return;
    }

    if (j.phase === "turning") {
      const facing = this.ship.steerToward(dt, j.targetAngle);
      // coast while the nose swings onto the jump heading
      this.ship.update(dt, 0, false);
      if (facing) this.beginJumpWarm();
      return;
    }

    if (j.phase === "warming") {
      // hold still — sound is already spooling
      this.ship.vel = { x: 0, y: 0 };
      this.ship.thrusting = false;
      this.ship.steerToward(dt, j.targetAngle);
      j.warmLeft -= dt;
      if (j.warmLeft <= 0) this.beginJumpBurn();
      return;
    }

    // burning: full throttle toward the destination, past normal cruise
    this.ship.steerToward(dt, j.targetAngle);
    const base = this.ship.stats;
    this.ship.stats = {
      ...base,
      maxSpeed: j.burnSpeed,
      accel: j.burnAccel,
    };
    this.ship.update(dt, 0, true);
    this.ship.stats = base;
    j.burnLeft -= dt;
    // white-out in the last ~12% of the burn (scales with slow/fast jumpers)
    const flashWindow = Math.max(0.2, j.burnTotal * 0.12);
    if (j.burnLeft < flashWindow) {
      this.jumpFlash = Math.max(
        this.jumpFlash,
        (flashWindow - j.burnLeft) / flashWindow,
      );
    }
    if (j.burnLeft <= 0) this.executeJump();
  }

  private executeJump(): void {
    const fromSys = this.system;
    const nextId = this.route.shift()!;
    const next = getSystem(nextId);
    this.player.fuelJumps -= 1;
    // One day per jump is Nova's baseline. A hyperspace speed mod (outfit
    // ModType 22) shifts it either way but, as the Bible puts it, "still can't
    // go below 1 day/jump" — so the floor is 1, not 0.
    this.advanceDays(Math.max(1, 1 + this.gear.hyperSpeed));
    // anyone you're escorting makes the jump with you
    for (const active of this.player.activeMissions) {
      const m = MISSIONS[String(active.misnId)];
      if (!m || m.shipGoal !== 3 || active.shipsDone) continue;
      if (
        this.npcs.some((n) => n.missionMisnId === active.misnId && n.escorting)
      ) {
        active.shipSystemId = nextId;
      }
    }
    this.player.systemId = nextId;
    this.markExplored(nextId);
    if (this.routeDest === nextId) this.routeDest = null;

    // arrive at the edge of the new system, on the side we came from, moving inward
    const dx = fromSys.mapPos.x - next.mapPos.x;
    const dy = fromSys.mapPos.y - next.mapPos.y;
    const len = Math.hypot(dx, dy) || 1;
    const ux = dx / len;
    const uy = dy / len;
    this.ship.pos = { x: ux * 1700, y: uy * 1700 };
    this.ship.angle = Math.atan2(-uy, -ux);
    const sp = this.ship.stats.maxSpeed;
    this.ship.vel = { x: -ux * sp, y: -uy * sp };

    this.jump = null;
    // Burn was timed to the warp-up sample; stop the slot (sample should be
    // ending anyway). Cancel paths also use JUMP_SND_KEY.
    stopSustained(JUMP_SND_KEY);
    this.jumpFlash = 0.5;
    /*
     * A system's Message names an entry in STR# 1000 — the message buoy text
     * that greets you on arrival. 72 systems carry one. The index is 1-based
     * in the resource, as buoy strings are numbered from 1 in the Bible.
     */
    if (next.message > 0) {
      const buoy = STR_LISTS["1000"]?.[next.message - 1];
      if (buoy) this.message(buoy);
    }
    this.gateAnim.clear(); // rings belong to the system you just left
    this.gateDocking = null;
    this.npcs = [];
    this.dockedNpcs = [];
    this.projectiles = [];
    this.beams = [];
    this.explosions = [];
    this.targetNpc = null;
    this.targetPlanet = null;
    this.populateNpcs();
    this.populateAsteroids();
    this.spawnMissionShips();
    this.spawnEscorts(); // your wing makes the jump with you
    playSnd(SND.WARP_OUT, 0.5); // dropping out of hyperspace
    this.message(
      `Arrived in the ${next.name} system. Fuel: ${this.player.fuelJumps}/${this.player.maxFuelJumps} jumps.`,
    );
    if (this.route.length > 0) {
      // Held J re-engages on the next flight frame; the hint is for a lifted key.
      const cont = getSystem(
        this.routeDest ?? this.route[this.route.length - 1],
      ).name;
      const jumpKey = formatChord(getBinding("jump"));
      this.message(
        actionDown(this.input, "jump")
          ? `Course continues to ${cont}.`
          : `Course continues to ${cont} — hold or press ${jumpKey} to continue.`,
      );
    }
  }

  // ---------------- economy (called by landed UI) ----------------

  cargoUsed(): number {
    return fleetCargoUsed(this.player);
  }

  /**
   * Hull plus whatever the wing can haul. Trader-AI escorts add their holds
   * to yours for commodities — see `cargo.ts` for the rule and its limits.
   */
  cargoCapacity(): number {
    return totalCargoCap(this.player);
  }

  /** What the escorts contribute, alone. Zero unless a trader flies with you. */
  fleetCapacity(): number {
    return fleetCargoCap(this.player);
  }

  /** Tons of commodities you could still buy, anywhere in the fleet. */
  cargoSpace(): number {
    return freeCommoditySpace(this.player);
  }

  /** Tons free in your own hull — all that mission freight may use. */
  holdSpace(): number {
    return freeHoldSpace(this.player);
  }

  /** How the commodity load is split between your hull and the wing. */
  cargoStowage(): { hull: number; fleet: number } {
    return stowage(this.player);
  }

  /**
   * Re-seat the manifest after the wing changes size. An escort that dies,
   * defects or is paid off takes its hold with it and the overflow is spaced;
   * `enforceCargoCapacity` decides what goes, this reports it.
   */
  private settleFleetCargo(): void {
    const lost = enforceCargoCapacity(this.player);
    if (lost.length === 0) return;
    const what = lost
      .map((l) => `${l.tons}t of ${cargoLabel(l.id)}`)
      .join(", ");
    this.message(`Your hold cannot take it all — you jettison ${what}.`);
  }

  // ---------------- missions ----------------

  private bitHandlers() {
    return {
      startMission: (misnId: number) => {
        const m = MISSIONS[String(misnId)];
        if (!m || this.player.activeMissions.some((a) => a.misnId === misnId))
          return;
        const here = this.player.landedOn ?? "128";
        const active = instantiateMission(m, here, this.player);
        this.player.activeMissions.push(active);
        applySet(m.onAccept, this.player.bits, this.bitHandlers());
        this.message(`New mission: ${missionDisplayName(m)}.`);
      },
      abortMission: (misnId: number) => {
        this.player.activeMissions = this.player.activeMissions.filter(
          (a) => a.misnId !== misnId,
        );
      },
      grantOutfit: (outfId: number) => {
        const key = String(outfId);
        if (OUTFITS[key]) {
          this.player.outfits[key] = (this.player.outfits[key] ?? 0) + 1;
          this.chartFromOutfit(key);
          this.recomputeLoadout();
        }
      },
      removeOutfit: (outfId: number) => {
        const key = String(outfId);
        const owned = this.player.outfits[key] ?? 0;
        if (owned > 1) this.player.outfits[key] = owned - 1;
        else delete this.player.outfits[key];
        this.recomputeLoadout();
      },
      failMission: (misnId: number) => {
        const active = this.player.activeMissions.find(
          (a) => a.misnId === misnId,
        );
        const m = MISSIONS[String(misnId)];
        if (!active || !m) return;
        applySet(m.onFailure, this.player.bits, this.bitHandlers());
        applyCompReward(this.player, m.compGovt, m.compReward, true);
        this.player.activeMissions = this.player.activeMissions.filter(
          (a) => a !== active,
        );
        if (!isSilentMission(m)) this.message(`Mission failed: ${active.name}.`);
      },
      moveToSystem: (systemId: number, keepPos: boolean) => {
        let sys;
        try {
          sys = getSystem(String(systemId));
        } catch {
          return;
        }
        this.player.systemId = sys.id;
        this.player.landedOn = null;
        if (!keepPos) {
          const first = sys.planets[0];
          this.ship.pos = first
            ? {
                x: first.pos.x + first.radius * 2,
                y: first.pos.y + first.radius,
              }
            : { x: 0, y: 0 };
        }
        this.ship.vel = { x: 0, y: 0 };
        this.npcs = [];
        this.dockedNpcs = [];
        this.projectiles = [];
        this.targetNpc = null;
        this.mode = "flight";
        this.landedUi.hide();
        this.populateNpcs();
        this.spawnMissionShips();
        this.jumpFlash = 0.5;
        this.message(`You find yourself in the ${sys.name} system.`);
      },
      changeShip: (
        shipId: number,
        keepOutfits: boolean,
        grantDefaults: boolean,
      ) => {
        const key = String(shipId);
        if (!SHIPS[key]) return;
        if (!keepOutfits) this.player.outfits = {};
        if (grantDefaults) grantHullOutfits(key, this.player.outfits);
        this.applyShipType(key);
        if (grantDefaults) {
          const stock = stockAmmo(key);
          for (const [weapId, count] of Object.entries(stock)) {
            this.player.ammo[weapId] = Math.max(
              this.player.ammo[weapId] ?? 0,
              count,
            );
          }
        }
        this.ship.shield = this.ship.maxShield;
        this.ship.armor = this.ship.maxArmor;
        this.message(`You are now flying a ${SHIPS[key].name.split(";")[0]}.`);
      },
      playSound: (sndId: number) => playSnd(sndId, 0.5),
      activateRank: (rankId: number) => this.grantRank(rankId),
      deactivateRank: (rankId: number) => this.revokeRank(rankId),
      showDesc: (descId: number) => {
        const text = descText(descId);
        if (text) this.pendingMissionEvents.push({ title: "", text });
      },
      destroyStellar: (spobId: number) => {
        const id = String(spobId);
        const entry = SPOBS.get(id);
        if (!entry) return;
        // strike it from its system so it can't be targeted or landed on again
        const sys = getSystem(entry.systemId);
        sys.planets = sys.planets.filter((p) => p.id !== id);
        if (this.targetPlanet?.id === id) this.targetPlanet = null;
        if (this.player.landedOn === id) this.player.landedOn = null;
        this.player.dominated = this.player.dominated.filter((d) => d !== id);
        this.message(`${entry.planet.name} has been destroyed.`);
      },
    };
  }

  acceptMission(
    m: MissionType,
    active: ActiveMission,
  ): {
    ok: boolean;
    reason?: string;
  } {
    /*
     * Mission freight goes in your own hull and nowhere else — the manual is
     * explicit that "no one else can be trusted with it" — so this is the
     * hull figure even when the wing has room to spare.
     */
    if (active.cargoLoaded && active.cargoQty > freeHoldSpace(this.player)) {
      return {
        ok: false,
        reason: "You don't have enough cargo space for this mission.",
      };
    }
    this.player.activeMissions.push(active);
    applySet(m.onAccept, this.player.bits, this.bitHandlers());
    return { ok: true };
  }

  refuseMission(m: MissionType): void {
    applySet(m.onRefuse, this.player.bits, this.bitHandlers());
  }

  abortMission(active: ActiveMission): void {
    const m = MISSIONS[String(active.misnId)];
    if (m) applySet(m.onAbort, this.player.bits, this.bitHandlers());
    this.player.activeMissions = this.player.activeMissions.filter(
      (a) => a !== active,
    );
  }

  /**
   * Advance mission state after landing on a planet.
   * Returns dialog texts (cargo pickups, completions, failures) to display.
   */
  collectLandingEvents(planetId: string): MissionEvent[] {
    const events: MissionEvent[] = [...this.pendingMissionEvents];
    this.pendingMissionEvents = [];
    this.collectTribute();
    this.collectSalary();
    this.payEscorts();
    const remaining: typeof this.player.activeMissions = [];
    for (const active of this.player.activeMissions) {
      const m = MISSIONS[String(active.misnId)];
      if (!m) continue;

      const silent = isSilentMission(m);

      // time limit
      if (
        active.timeLimit > 0 &&
        this.player.date - active.acceptedDay > active.timeLimit
      ) {
        applySet(m.onFailure, this.player.bits, this.bitHandlers());
        applyCompReward(this.player, m.compGovt, m.compReward, true);
        if (!silent) {
          const fail = descText(m.failText);
          events.push({
            title: `Mission failed: ${active.name}`,
            text: substituteTags(
              fail ?? "You have run out of time.",
              m,
              active,
              this.pilotName,
              this.rankTags(),
            ),
          });
        }
        continue;
      }

      // an escort contract is fulfilled by arriving with them still alive
      if (!active.shipsDone && m.shipGoal === 3) {
        const dest = active.returnSpobId ?? active.travelSpobId;
        if (dest === null || dest === planetId) {
          active.shipsDone = true;
          applySet(m.onShipDone, this.player.bits, this.bitHandlers());
          if (!silent) {
            const doneText = descText(m.shipDoneText);
            if (doneText) {
              events.push({
                title: active.name,
                text: substituteTags(
                  doneText,
                  m,
                  active,
                  this.pilotName,
                  this.rankTags(),
                ),
              });
            } else {
              this.message(`${active.name}: your charges are safely delivered.`);
            }
          }
        }
      }

      // travel leg
      if (!active.travelDone && active.travelSpobId === planetId) {
        active.travelDone = true;
        if (!active.cargoLoaded && active.cargoQty > 0) {
          active.cargoLoaded = true;
          if (!silent) {
            const load = descText(m.loadCargText);
            if (load) {
              events.push({
                title: active.name,
                text: substituteTags(
                  load,
                  m,
                  active,
                  this.pilotName,
                  this.rankTags(),
                ),
              });
            }
          }
        } else if (
          active.cargoLoaded &&
          active.returnSpobId &&
          m.dropOffMode === 0
        ) {
          /*
           * DropOffMode 0 leaves the cargo at TravelStel; mode 1 keeps it
           * aboard until the mission ends at ReturnStel, and -1 means the
           * mission has no scripted drop at all. This branch used to fire
           * regardless, so a mode-1 job unloaded a leg early.
           */
          active.cargoLoaded = false;
          if (!silent) {
            const drop = descText(m.dropCargText);
            if (drop) {
              events.push({
                title: active.name,
                text: substituteTags(
                  drop,
                  m,
                  active,
                  this.pilotName,
                  this.rankTags(),
                ),
              });
            }
          }
        }
      }

      // completion
      const finalSpob = active.returnSpobId ?? active.travelSpobId;
      if (
        active.travelDone &&
        active.shipsDone &&
        (finalSpob === null || finalSpob === planetId)
      ) {
        if (active.pay > 0) {
          this.player.credits += active.pay;
        } else if (active.pay < 0) {
          // Outfit grant: -(count * 10000 + outfitNovaId)
          const encoded = Math.abs(active.pay);
          const count = Math.floor(encoded / 10000);
          const outfitId = String(encoded % 10000);
          const qty = this.player.outfits[outfitId] ?? 0;
          this.player.outfits[outfitId] = qty + count;
          this.recomputeLoadout();
        }
        // DropOffMode 1 delivers at the end of the run rather than mid-way
        if (active.cargoLoaded && m.dropOffMode === 1) {
          active.cargoLoaded = false;
          if (!silent) {
            const drop = descText(m.dropCargText);
            if (drop) {
              events.push({
                title: active.name,
                text: substituteTags(
                  drop,
                  m,
                  active,
                  this.pilotName,
                  this.rankTags(),
                ),
              });
            }
          }
        }
        applySet(m.onSuccess, this.player.bits, this.bitHandlers());
        /*
         * DatePostInc: the job itself took time. 136 missions advance the
         * calendar on completion — an escort run costs three days, springing
         * a Vell-os captive eight — which matters because everything else
         * dated (salaries, crön events, mission time limits) moves with it.
         */
        if (m.datePostInc > 0) this.advanceDays(m.datePostInc);
        applyCompReward(this.player, m.compGovt, m.compReward, false);
        if (!silent) {
          const comp = descText(m.compText);
          events.push({
            title: `Mission complete: ${active.name}`,
            text:
              substituteTags(
                comp ?? "",
                m,
                active,
                this.pilotName,
                this.rankTags(),
              ) ||
              (active.pay > 0
                ? `You are paid ${active.pay.toLocaleString()} credits.`
                : "The job is done."),
          });
        }
        continue;
      }
      remaining.push(active);
    }
    this.player.activeMissions = remaining;
    return events;
  }

  buy(commodityId: string, qty: number, unitPrice: number): void {
    // commodities may ride in the wing, so this is the fleet-wide figure
    const space = freeCommoditySpace(this.player);
    const affordable = Math.floor(this.player.credits / unitPrice);
    const n = Math.min(qty, space, affordable);
    if (n <= 0) return;
    this.player.credits -= n * unitPrice;
    this.player.cargo[commodityId] = (this.player.cargo[commodityId] ?? 0) + n;
  }

  sell(commodityId: string, qty: number, unitPrice: number): void {
    const have = this.player.cargo[commodityId] ?? 0;
    const n = Math.min(qty, have);
    if (n <= 0) return;
    this.player.credits += n * unitPrice;
    this.player.cargo[commodityId] = have - n;
    if (this.player.cargo[commodityId] === 0)
      delete this.player.cargo[commodityId];
  }

  /** Ammo mods reference their weapon; values may or may not be pre-offset by 128. */
  private ammoWeaponId(modVal: number): string {
    return String(modVal >= 128 ? modVal : 128 + modVal);
  }

  /**
   * One GRN race. Four racers, one winner, so a correct call pays 3:1 against
   * the stake — the house edge is the other three-quarters of the field.
   */
  /**
   * The news wire for a world, as the Bible lays it out: every crön event
   * running right now offers a line. If one of its NewsGovt slots names the
   * local government (or an ally of it) that slot's GovtNewsStr is what gets
   * reported, and local news takes precedence over the independent wire;
   * otherwise the event's IndNewsStr is used. Events with neither stay quiet.
   */
  newsFor(govtId: number): string[] {
    const out: string[] = [];
    const pick = (id: number, salt: number): string | null => {
      const lines = STR_LISTS[String(id)];
      if (!lines?.length) return null;
      return lines[(this.player.date + salt) % lines.length];
    };
    for (const state of this.player.crons) {
      if (!state.started || this.player.date > state.endDay) continue;
      const cron = CRONS.find((c) => c.id === state.id);
      if (!cron) continue;
      let line: string | null = null;
      for (let i = 0; i < cron.newsGovts.length; i++) {
        const ng = cron.newsGovts[i];
        const str = cron.govtNewsStrs[i] ?? 0;
        if (ng < 128 || str <= 0) continue;
        if (govtId === ng || (govtId >= 128 && govtAllied(govtId, ng))) {
          line = pick(str, cron.id);
          break;
        }
      }
      if (!line && cron.indNewsStr > 0) line = pick(cron.indNewsStr, cron.id);
      if (line) out.push(line);
    }
    return out;
  }

  runRace(
    pick: number,
    stake: number,
  ): {
    winner: number;
    won: boolean;
    stake: number;
    payout: number;
  } {
    const bet = Math.max(0, Math.min(stake, this.player.credits));
    const winner = Math.floor(Math.random() * 4);
    const won = winner === pick;
    const payout = won ? bet * 3 : 0;
    this.player.credits += won ? payout : -bet;
    return { winner, won, stake: bet, payout };
  }

  buyOutfit(outfId: string): { ok: boolean; reason?: string } {
    const outf = OUTFITS[outfId];
    if (!outf) return { ok: false, reason: "Unknown outfit." };
    // Without the 0x4000 flag Nova lists an item whose Availability is false
    // rather than hiding it — but it still won't sell you one.
    if (!evalTest(outf.avail, this.player.bits, testContext(this.player))) {
      return { ok: false, reason: "That is not for sale here." };
    }
    const owned = this.player.outfits[outfId] ?? 0;
    const isMap = outf.mods.some((m) => m.type === 16);
    if (outf.max > 0 && owned >= outf.max && !isMap) {
      return {
        ok: false,
        reason: "You already have the maximum number of these.",
      };
    }
    if (this.player.credits < outf.cost) {
      return { ok: false, reason: "You cannot afford this outfit." };
    }
    if (outf.mass > 0 && this.freeMassLeft() < outf.mass) {
      return { ok: false, reason: "Your ship has no room for this outfit." };
    }
    const mount = this.mountBlock(outfId);
    if (mount) {
      return {
        ok: false,
        reason:
          mount === "gun"
            ? "Your ship has no free gun mounts."
            : "Your ship has no free turret mounts.",
      };
    }
    this.player.credits -= outf.cost;
    // oütf OnPurchase: buying can set bits, and for the shipyard upgrades it
    // is how a Chrome Valkyrie actually becomes one (its string reads "H165")
    if (outf.onPurchase)
      applySet(outf.onPurchase, this.player.bits, this.bitHandlers());
    const isAmmo = outf.mods.some((m) => m.type === 3);
    if (isAmmo) {
      // ammunition is consumed, not carried as an outfit
      for (const mod of outf.mods) {
        if (mod.type === 3) {
          const weapId = this.ammoWeaponId(mod.val);
          this.player.ammo[weapId] = (this.player.ammo[weapId] ?? 0) + 1;
        }
      }
    } else if (isMap) {
      // maps are consumed on purchase — chart the area, don't track in outfits
      this.chartFromOutfit(outfId);
    } else {
      this.player.outfits[outfId] = owned + 1;
      this.chartFromOutfit(outfId);
    }
    this.recomputeLoadout();
    return { ok: true };
  }

  sellOutfit(outfId: string): { ok: boolean; reason?: string } {
    const outf = OUTFITS[outfId];
    if (!outf) return { ok: false, reason: "You do not own this outfit." };
    // oütf Flags 0x0008: some items can never be sold back
    if ((outf.flags & 0x0008) !== 0) {
      return { ok: false, reason: "This item cannot be sold." };
    }
    const isAmmo = outf.mods.some((m) => m.type === 3);
    if (isAmmo) {
      // Ammo is stored in player.ammo, not player.outfits — sell one round back.
      const ammMod = outf.mods.find((m) => m.type === 3)!;
      const weapId = this.ammoWeaponId(ammMod.val);
      const rounds = this.player.ammo[weapId] ?? 0;
      if (rounds <= 0) return { ok: false, reason: "You do not own this outfit." };
      this.player.ammo[weapId] = rounds - 1;
      if (this.player.ammo[weapId] === 0) delete this.player.ammo[weapId];
      this.player.credits += Math.floor(outf.cost * 0.75);
      this.recomputeLoadout();
      return { ok: true };
    }
    const owned = this.player.outfits[outfId] ?? 0;
    if (owned <= 0)
      return { ok: false, reason: "You do not own this outfit." };
    this.player.outfits[outfId] = owned - 1;
    if (this.player.outfits[outfId] === 0) delete this.player.outfits[outfId];
    this.player.credits += Math.floor(outf.cost * 0.75);
    // OnSell runs the other way — the cheap reactors clear the bit that marks
    // you as carrying one
    if (outf.onSell)
      applySet(outf.onSell, this.player.bits, this.bitHandlers());
    this.recomputeLoadout();
    return { ok: true };
  }

  /**
   * Credits to fill the tanks here. 0 when full, free by rank, or when this
   * pad does not sell fuel (caller should still gate on canRefuel / uninhabited).
   */
  refuelCost(): number {
    const missing = this.player.maxFuelJumps - this.player.fuelJumps;
    if (missing <= 0) return 0;
    const planet = this.player.landedOn
      ? SPOBS.get(this.player.landedOn)?.planet
      : null;
    if (!planet || planet.uninhabited) return 0;
    const govtId = SPOB_GOVT.get(planet.id) ?? -1;
    // 0x0800: ships and worlds of that govt refuel you for nothing
    if (govtId >= 128 && this.rankFlag(govtId, 0x0800)) return 0;
    return Math.ceil(missing * REFUEL_COST_PER_JUMP);
  }

  /**
   * Whether the current pad can top up your tanks (inhabited world with room
   * in the tanks, and either free fuel or enough credits).
   */
  canRefuel(): boolean {
    const planet = this.player.landedOn
      ? SPOBS.get(this.player.landedOn)?.planet
      : null;
    if (!planet || planet.uninhabited) return false;
    if (this.player.fuelJumps >= this.player.maxFuelJumps) return false;
    const cost = this.refuelCost();
    return cost === 0 || this.player.credits >= cost;
  }

  /**
   * Buy a full tank from the current spaceport. No-op on uninhabited pads,
   * when already full, or when you cannot afford it. Used by the Refuel
   * button and by the Auto-recharger on land.
   */
  refuel(): void {
    if (!this.canRefuel()) return;
    const cost = this.refuelCost();
    this.player.credits -= cost;
    this.player.fuelJumps = this.player.maxFuelJumps;
  }

  // ---------------- NPCs ----------------

  private populateNpcs(): void {
    this.bribedPlanets.clear(); // planet bribes don't carry across system entry
    this.bribeState.clear();
    const n = Math.min(this.system.traffic, 2);
    for (let i = 0; i < n; i++) this.spawnNpc(true);
    this.placeLinkedPersons();
  }

  /** weighted pick from {prob} entries */
  private weightedPick<T extends { prob: number }>(entries: T[]): T | null {
    const total = entries.reduce((s, e) => s + e.prob, 0);
    if (total <= 0) return null;
    let roll = Math.random() * total;
    for (const e of entries) {
      roll -= e.prob;
      if (roll <= 0) return e;
    }
    return entries[entries.length - 1] ?? null;
  }

  /**
   * Is a govt's ship hostile to the player right now? Nova answers this from
   * the gövt's own Flags rather than from its name: 0x0040 never attacks,
   * 0x0004 always does, 0x0001 is xenophobic and attacks everyone but its
   * allies. Failing those it comes down to your record against that
   * government's CrimeTol — "the maximum amount of evilness the player can
   * accumulate before warships of this govt start to beat on him".
   *
   * Matching on the name used to get this wrong both ways: it missed the
   * Houseless Warriors, Spanner and Family Heraan, who are all flagged
   * xenophobic, and the three Bureau governments that always attack — while
   * wrongly treating the Wraith as hostile when they are merely silent.
   */
  private hostileToPlayer(govtId: number): boolean {
    if (govtId < 128) return false;
    const flags = GOVT_FLAGS[String(govtId)] ?? 0;
    if ((flags & 0x0040) !== 0) return false; // never attacks the player
    // a commission with them means their ships don't come after you
    if (this.rankFlag(govtId, 0x0100)) return false;
    if ((flags & 0x0004) !== 0) return true; // always attacks the player
    if ((flags & 0x0001) !== 0) return true; // xenophobic: everyone but allies
    return getRecord(this.player, govtId) < -crimeTolerance(govtId);
  }

  private spawnNpc(anywhere = false): void {
    const sys = this.system;
    // real traffic: the system's düde table decides who flies here
    let typeId: string | null = null;
    let govtId = -1;
    let aiType = 1;
    const dudeEntry = this.weightedPick(sys.dudes);
    const dude = dudeEntry ? DUDES[String(dudeEntry.id)] : null;
    let dudeId: number | null = null;
    if (dude) {
      dudeId = dude.id;
      govtId = dude.govt;
      aiType = dude.aiType;
      const shipEntry = this.weightedPick(dude.ships);
      if (shipEntry && SHIPS[String(shipEntry.id)])
        typeId = String(shipEntry.id);
    }
    if (!typeId) {
      // systems with no düde table get a wandering independent trader
      const fallback = Object.keys(SHIPS).filter((id) =>
        /shuttle|terrapin|argosy|valkyrie/i.test(SHIPS[id].name),
      );
      typeId = fallback[Math.floor(Math.random() * fallback.length)] ?? null;
    }
    const type = typeId ? SHIPS[typeId] : null;
    const npc = new NpcShip(
      type
        ? {
            turnRate: type.turnRate,
            accel: type.accel,
            maxSpeed: type.maxSpeed,
          }
        : undefined,
    );
    npc.typeId = typeId;
    // where the düde names no government, the hull's own inherent one stands in
    npc.govtId = govtId >= 128 ? govtId : inherentCombatGovt(typeId);
    npc.aiType = aiType;
    npc.dudeId = dudeId;
    if (type) {
      // shïp flag 0x10: tougher ships hold together to 10% armor
      npc.initDefense(
        type.shield,
        type.armor,
        type.shieldRechPerSec,
        (type.flags & 0x10) !== 0 ? 0.1 : 0.33,
      );
    }
    npc.sprite = typeId ? (SHIP_SPRITES[typeId] ?? null) : null;
    // a ship that spawns 1900 units out has a moment before it can shoot at
    // you — long enough to have its fire sound decoded and ready
    if (type)
      preloadSnds(type.stockWeapons.map((sw) => WEAPONS[String(sw.id)]?.sndId));
    if (npc.ally && govtId >= 128)
      preloadSnds(voiceBank(GOVT_VOICES[String(govtId)] ?? 0));
    // ships whose class has AI cloak flags will vanish when they run
    if (type && (type.flags2 & 0x0f00) !== 0) npc.canCloak = true;
    if (dude) {
      npc.bootyFlags = dude.booty;
      if ((dude.booty & 0x40) !== 0 && type) {
        /*
         * düde Flags 0x0040 is "carries money (amount depends on the ship's
         * purchase price)" and the Bible never says how much, so the rate is
         * ours: 4% of the hull's cost, which is what boarding a big warship
         * pays in the original as far as anyone remembers it. The spread is
         * the one number the doc does give for carried money — përs Credits'
         * "+/- 25%" — so a 12M Manticore hands over 360k-600k.
         */
        npc.booty = Math.round(type.cost * 0.04 * (0.75 + Math.random() * 0.5));
      }
    }
    // EV gives every new ship a small chance of being somebody in particular
    // (before hostility — a person may reassign govt / hold fire for a job)
    const bornHostile = !!type && this.hostileToPlayer(npc.govtId);
    if (!bornHostile || Math.random() < 0.5) this.maybeMakePerson(npc);
    if (!npc.ally && this.hostileToPlayer(npc.govtId)) {
      // leave peaceful captains who still have a LinkMission to offer
      const person =
        npc.personId !== null ? PERSONS[String(npc.personId)] : null;
      if (!(person && person.linkMission >= 128)) this.setNpcHostile(npc);
    }
    const ang = Math.random() * Math.PI * 2;
    if (anywhere) {
      const r = 400 + Math.random() * 1200;
      npc.pos = { x: Math.cos(ang) * r, y: Math.sin(ang) * r };
    } else {
      npc.pos = { x: Math.cos(ang) * 1900, y: Math.sin(ang) * 1900 };
    }
    this.setNpcErrand(npc, sys);
    npc.angle = Math.atan2(npc.target.y - npc.pos.y, npc.target.x - npc.pos.x);
    this.npcs.push(npc);
  }

  /** Ports an AI ship will consider setting down at. Gates are not ports. */
  private portsOf(sys: SystemDef): PlanetDef[] {
    return sys.planets.filter(
      (p) => p.landable && !p.isHypergate && !p.isWormhole,
    );
  }

  /**
   * gövt Flags2 travel preferences for leaving a system: don't use hypergates
   * (0x0020), prefer hypergates (0x0040), prefer wormholes (0x0080).
   */
  private npcLeaveViaGate(npc: NpcShip, sys: SystemDef): PlanetDef | null {
    const f2 = npc.govtId >= 128 ? (GOVT_FLAGS2[String(npc.govtId)] ?? 0) : 0;
    const noGates = (f2 & GOVT_NO_HYPERGATES) !== 0;
    const preferGates = (f2 & GOVT_PREFER_HYPERGATES) !== 0;
    const preferWh = (f2 & GOVT_PREFER_WORMHOLES) !== 0;
    if (!preferGates && !preferWh) return null;
    const gates = sys.planets.filter(
      (p) => p.isHypergate && this.gateIsWorking(p) && !noGates,
    );
    const holes = sys.planets.filter(
      (p) => p.isWormhole && this.gateIsWorking(p),
    );
    if (preferGates && gates.length) {
      return gates[Math.floor(Math.random() * gates.length)];
    }
    if (preferWh && holes.length) {
      return holes[Math.floor(Math.random() * holes.length)];
    }
    // prefer-gates with no working gate, but wormholes allowed
    if (preferGates && !noGates && holes.length && preferWh) {
      return holes[Math.floor(Math.random() * holes.length)];
    }
    return null;
  }

  /**
   * Give a ship the errand its düde AIType says it is on. The Bible is
   * specific about who goes where: only "1 - Wimpy Trader" and "2 - Brave
   * Trader" visit planets, "3 - Warship ... jumps out if there aren't any"
   * enemies, and "4 - Interceptor ... parks in orbit around a planet if he
   * can't find any". Every spawn used to roll a flat 70% chance of flying at a
   * random stellar whatever it was, so warships and interceptors made for the
   * nearest world and evaporated on touching it.
   *
   * When a ship is leaving, gövt Flags2 may send it at a hypergate or wormhole
   * instead of flying to the system edge.
   */
  private setNpcErrand(
    npc: NpcShip,
    sys: SystemDef,
    exclude?: string | null,
  ): void {
    const ports = this.portsOf(sys).filter((p) => p.id !== exclude);
    const pick =
      ports.length > 0 ? ports[Math.floor(Math.random() * ports.length)] : null;
    const visits = npc.aiType === 1 || npc.aiType === 2;
    if (pick && (visits || npc.aiType === 4)) {
      npc.phase = npc.aiType === 4 ? "orbit" : "toPlanet";
      npc.targetPlanetId = pick.id;
      npc.targetRadius = pick.radius;
      npc.target = { x: pick.pos.x, y: pick.pos.y };
      npc.orbitAngle = Math.atan2(
        npc.pos.y - pick.pos.y,
        npc.pos.x - pick.pos.x,
      );
      return;
    }
    const via = this.npcLeaveViaGate(npc, sys);
    if (via) {
      npc.phase = "toPlanet";
      npc.targetPlanetId = via.id;
      npc.targetRadius = via.radius;
      npc.target = { x: via.pos.x, y: via.pos.y };
      return;
    }
    const outAng =
      Math.atan2(npc.pos.y, npc.pos.x) + (Math.random() - 0.5) * Math.PI;
    npc.phase = "leaving";
    npc.targetPlanetId = null;
    npc.target = {
      x: npc.pos.x + Math.cos(outAng) * 5000,
      y: npc.pos.y + Math.sin(outAng) * 5000,
    };
  }

  /**
   * Ships on the ground. A trader that touches down comes off the board for a
   * while and then lifts off again — the Bible has traders *visiting* planets,
   * which is a round trip, and has folding hulls cycling their parts "upon
   * landing, taking off, and entering/exiting hyperspace", an animation a ship
   * that never takes off can only ever play half of.
   */
  private dockedNpcs: {
    npc: NpcShip;
    planetId: string;
    systemId: string;
    wait: number;
  }[] = [];

  /** Take a ship that has just set down off the board. */
  private dockNpc(npc: NpcShip, dt = 1 / 30): void {
    // a gate/wormhole transit: bleach white, then leave rather than berth
    const pad = this.system.planets.find((p) => p.id === npc.targetPlanetId);
    if (pad && (pad.isHypergate || pad.isWormhole)) {
      if (pad.isHypergate) {
        // hold on the pad until the ring is open, then vanish into it
        this.beginOpenGate(pad, true);
        const st = this.gateAnim.get(pad.id);
        const ready =
          pad.spriteFrames <= 1 ||
          st?.phase === "open" ||
          (st != null && st.frame >= this.gateOpenEnd(pad));
        if (!ready) {
          npc.vel = { x: 0, y: 0 };
          npc.landing = true;
          return;
        }
      }
      // same white-out the player gets, then drop them off the board
      npc.vel = { x: 0, y: 0 };
      npc.landing = true;
      npc.gateFlash = Math.min(1, npc.gateFlash + dt / GATE_ENTER_FLASH);
      if (npc.gateFlash < 1) return;
      if (pad.isHypergate && !this.playerUsingGate(pad.id)) {
        this.closeGate(pad.id);
      }
      npc.landing = false;
      npc.done = true;
      if (this.targetNpc === npc) this.targetNpc = null;
      return;
    }
    npc.landing = false;
    npc.done = true; // removed from this.npcs by the usual sweep
    if (this.targetNpc === npc) this.targetNpc = null;
    this.dockedNpcs.push({
      npc,
      planetId: npc.targetPlanetId ?? "",
      systemId: this.system.id,
      // long enough to read as business being done, short enough that a busy
      // world keeps a trickle of traffic lifting off
      wait: 6 + Math.random() * 14,
    });
  }

  /** Count the pads down and send anyone whose business is finished back up. */
  private updateDockedNpcs(dt: number): void {
    if (this.dockedNpcs.length === 0) return;
    const still: typeof this.dockedNpcs = [];
    for (const berth of this.dockedNpcs) {
      // a ship docked in another system stays there; you are not watching it
      if (berth.systemId !== this.system.id) continue;
      berth.wait -= dt;
      const pad = this.system.planets.find((p) => p.id === berth.planetId);
      if (berth.wait > 0 || !pad) {
        if (pad) still.push(berth);
        continue;
      }
      const npc = berth.npc;
      npc.done = false;
      // lift off from the pad and climb clear under its own power
      const ang = Math.random() * Math.PI * 2;
      npc.pos = {
        x: pad.pos.x + Math.cos(ang) * (pad.radius + 8),
        y: pad.pos.y + Math.sin(ang) * (pad.radius + 8),
      };
      npc.vel = { x: 0, y: 0 };
      npc.angle = ang;
      npc.shield = npc.maxShield;
      // it left the pad folded up; the parts come back out on the way clear
      npc.unfolding = true;
      this.setNpcErrand(npc, this.system, pad.id);
      this.npcs.push(npc);
    }
    this.dockedNpcs = still;
  }

  // ---------------- flight targeting under cursor ----------------

  /**
   * Select the ship or stellar under the pointer (keybind "selectUnderCursor",
   * Mouse Left in Classic). Empty space clears the selection. Uses the same
   * world point as aim-cursor so a keyboard bind works with the mouse still.
   */
  private selectUnderCursor(): void {
    if (this.mode !== "flight" || this.flightOverlayOpen()) return;
    const viewW = this.viewW - SIDEBAR_W;
    if (this.mouse.x > viewW) return; // the status bar has its own hit areas
    const aim = this.cursorWorldPoint();
    const wx = aim.x;
    const wy = aim.y;

    let bestPlanet: { planet: PlanetDef; d: number } | null = null;
    for (const p of this.system.planets) {
      const d = Math.hypot(p.pos.x - wx, p.pos.y - wy);
      // a generous margin so small stations and gates stay clickable
      if (
        d <= Math.max(p.radius, 18) + 8 &&
        (!bestPlanet || d < bestPlanet.d)
      ) {
        bestPlanet = { planet: p, d };
      }
    }
    if (bestPlanet) {
      this.setTargetPlanet(bestPlanet.planet);
      return;
    }

    let bestNpc: { npc: NpcShip; d: number } | null = null;
    for (const npc of this.npcs) {
      if (npc.done || npc.cloaked) continue;
      if (!this.canSee(npc)) continue;
      const d = Math.hypot(npc.pos.x - wx, npc.pos.y - wy);
      if (d <= 28 && (!bestNpc || d < bestNpc.d)) bestNpc = { npc, d };
    }
    if (bestNpc) {
      this.targetNpc = bestNpc.npc;
      this.targetPlanet = null;
      // same select click as R / cycle targets (Beep3)
      playSnd(SND.TARGET, 0.45);
      this.message(`Target: ${this.shipLabel(bestNpc.npc)}.`);
      return;
    }
    if (this.targetPlanet || this.targetNpc) {
      this.setTargetPlanet(null);
      this.targetNpc = null;
    }
  }

  // ---------------- map clicks ----------------

  private onClick(e: MouseEvent): void {
    // Flight targeting is the selectUnderCursor bind (not a free left-click).
    if (this.mode !== "map") return;
    if (this.lastDragMoved > 6) return; // was a pan, not a click
    const rect = this.canvas.getBoundingClientRect();
    const mx = e.clientX - rect.left;
    const my = e.clientY - rect.top;
    for (const b of this.mapButtons) {
      if (mx >= b.x && mx <= b.x + b.w && my >= b.y && my <= b.y + b.h) {
        this.onMapButton(b.id);
        return;
      }
    }
    let best: { id: string; d: number } | null = null;
    for (const node of this.mapNodes) {
      const d = Math.hypot(node.x - mx, node.y - my);
      if (d < 14 && (!best || d < best.d)) best = { id: node.id, d };
    }
    if (best) {
      if (this.gateChooser) {
        const allowed = this.gateChooserSystemIds();
        if (!allowed.includes(best.id)) {
          this.message("Only linked hypergate systems can be selected.");
          return;
        }
        if (this.mapSelected === best.id) {
          this.travelGateToSelected();
          return;
        }
        this.mapSelected = best.id;
        return;
      }
      this.mapSelected = best.id;
      this.setDestination(best.id);
    }
  }

  private onMapButton(id: string): void {
    switch (id) {
      case "travel":
        this.travelGateToSelected();
        break;
      case "cancel-gate":
        this.closeMap();
        break;
      case "borders":
        this.mapBorders = !this.mapBorders;
        break;
      case "clear":
        this.route = [];
        this.routeDest = null;
        break;
      case "find": {
        const q = prompt("Find system:");
        if (!q) break;
        const needle = q.trim().toLowerCase();
        const hit =
          this.allSystems().find((s) => s.name.toLowerCase() === needle) ??
          this.allSystems().find((s) =>
            s.name.toLowerCase().startsWith(needle),
          );
        if (hit) {
          this.mapCenter = { x: hit.mapPos.x, y: hit.mapPos.y };
          this.mapSelected = hit.id;
        } else {
          this.message(`No system called "${q}".`);
        }
        break;
      }
      case "zoomout":
        this.mapZoom = Math.max(0.7, this.mapZoom / 1.3);
        break;
      case "zoomin":
        this.mapZoom = Math.min(12, this.mapZoom * 1.3);
        break;
      case "done":
        this.closeMap();
        break;
    }
  }

  // ---------------- render ----------------

  render(): void {
    const ctx = this.ctx;
    const w = this.viewW;
    const h = this.viewH;

    ctx.fillStyle = "#000005";
    ctx.fillRect(0, 0, w, h);

    // the sidebar is DOM, so it is shown and hidden rather than not painted
    this.hudUi.setVisible(this.mode === "flight" || this.mode === "map");

    if (this.mode === "landed") return; // overlay covers screen

    if (this.mode === "menu") {
      // starfield + drifting traffic behind the title menu
      this.renderSpace(ctx, w, h);
      ctx.fillStyle = "rgba(0,0,8,0.45)";
      ctx.fillRect(0, 0, w, h);
      return;
    }

    this.renderSpace(ctx, w, h);
    /*
     * Murk is the system's haze, 0-100, and it dims everything in the system's
     * own background colour — the Bible promises 100 "will cause the player to
     * question their current glasses prescription". Capped well short of that
     * so the murkiest systems stay playable: Nova's worst is 50.
     */
    const murk = this.system.murk;
    if (murk > 0) {
      const tint = this.system.bkgndColor || "#000008";
      ctx.globalAlpha = Math.min(0.55, murk / 100);
      ctx.fillStyle = tint;
      ctx.fillRect(0, 0, w - SIDEBAR_W, h);
      ctx.globalAlpha = 1;
    }
    this.renderMessages(ctx, h);
    this.hudUi.update(this);

    if (this.jumpFlash > 0) {
      ctx.fillStyle = `rgba(200,220,255,${this.jumpFlash * 1.6})`;
      ctx.fillRect(0, 0, w, h);
    }

    // H overlay sits over flight only — never replaces it.
    if (this.floatingMapVisible()) this.renderFloatingMap(ctx, w, h);

    if (this.mode === "map") this.renderMap(ctx, w, h);
  }

  private renderSpace(
    ctx: CanvasRenderingContext2D,
    w: number,
    h: number,
  ): void {
    const cam = this.ship.pos;
    // the sidebar takes the right edge in play; the menu backdrop is full-width
    const viewW = this.mode === "menu" ? w : w - SIDEBAR_W;
    /*
     * BkgndColor washes the whole system in a tint — 53 systems carry one,
     * always dark (the brightest is Alphara's #191900). It goes under the
     * stars so they still read against it.
     */
    const sys = this.mode === "menu" ? null : this.system;
    if (sys && sys.bkgndColor) {
      ctx.fillStyle = sys.bkgndColor;
      ctx.fillRect(0, 0, w, h);
    }
    drawStarfield(ctx, cam.x, cam.y, w, h);

    ctx.save();
    ctx.translate(viewW / 2 - cam.x, h / 2 - cam.y);

    // draw big stellars first so stations and ring segments layer on top
    const drawOrder = [...this.system.planets].sort(
      (a, b) => b.radius - a.radius,
    );
    for (const p of drawOrder) {
      ctx.save();
      ctx.translate(p.pos.x, p.pos.y);
      drawPlanet(ctx, p, this.time, this.gateFrame(p));
      // name label
      ctx.fillStyle = "rgba(180,200,225,0.75)";
      ctx.font = "12px Helvetica, Arial, sans-serif";
      ctx.textAlign = "center";
      ctx.fillText(p.name, 0, p.radius + 18);
      ctx.restore();
    }

    for (const npc of this.npcs) {
      if (npc.cloaked) {
        // only a scanner with the on-screen bit paints a cloaked hull
        if ((this.gear.cloakScanner & 0x0002) === 0) continue;
        ctx.globalAlpha = 0.4;
      }
      this.drawShip(ctx, npc, false, npc.typeId);
      ctx.globalAlpha = 1;
    }

    // Nova's own target cursor (spïn 650) rides the selected ship; a selected
    // world gets the four blue corner marks the original drew.
    if (this.targetNpc) {
      this.drawNpcTargetMarks(ctx, this.targetNpc);
    }
    if (this.targetPlanet) {
      this.drawStellarMarks(
        ctx,
        this.targetPlanet.pos.x,
        this.targetPlanet.pos.y,
        this.targetPlanet.radius + 18,
      );
    }

    // asteroids
    for (const a of this.asteroids) {
      const sheet = this.roidSheet(a.typeId);
      if (sheet) {
        const frame =
          ((Math.floor(a.frame) % sheet.frames) + sheet.frames) % sheet.frames;
        drawSheetFrame(ctx, sheet, frame, a.x, a.y);
      } else {
        ctx.fillStyle = "#6b6155";
        ctx.beginPath();
        ctx.arc(a.x, a.y, 14, 0, Math.PI * 2);
        ctx.fill();
      }
    }

    // asteroid debris, in each rock type's own PartColor
    for (const p of this.particles) {
      ctx.globalAlpha = Math.min(1, p.ttl / p.life) * 0.9;
      ctx.fillStyle = p.color;
      ctx.fillRect(p.x - 1, p.y - 1, 2, 2);
    }
    ctx.globalAlpha = 1;

    // mineral boxes
    for (const m of this.minerals) {
      ctx.globalAlpha = m.ttl < 4 ? Math.max(0.15, m.ttl / 4) : 1;
      ctx.fillStyle = "#d8c98a";
      ctx.fillRect(m.x - 3, m.y - 3, 6, 6);
      ctx.strokeStyle = "#8d7f4f";
      ctx.strokeRect(m.x - 3.5, m.y - 3.5, 7, 7);
      ctx.globalAlpha = 1;
    }

    // beams: a translucent corona under a bright core, in the weapon's colours
    for (const b of this.beams) {
      const fade = Math.max(0.25, Math.min(1, b.ttl * 12));
      ctx.lineCap = "round";
      /*
       * LiDensity turns a straight beam into a lightning bolt, and states the
       * number of zig-zags per 100 pixels. Six of Nova's weapons use it, and
       * the three Wraith Graviton Beams step 4/8/12 across Child/Youth/Adult,
       * so the bolt visibly tightens as the creature grows.
       */
      const path = (): void => {
        ctx.beginPath();
        ctx.moveTo(b.x1, b.y1);
        const zig = b.weap.liDensity;
        if (zig <= 0) {
          ctx.lineTo(b.x2, b.y2);
          return;
        }
        const dx = b.x2 - b.x1;
        const dy = b.y2 - b.y1;
        const len = Math.hypot(dx, dy);
        const steps = Math.max(2, Math.round((len / 100) * zig));
        // offset perpendicular to the beam, alternating sides
        const px = -dy / (len || 1);
        const py = dx / (len || 1);
        const amp = Math.max(2, b.weap.beamWidth * 2);
        for (let i = 1; i < steps; i++) {
          const t = i / steps;
          const jitter = (Math.random() * 2 - 1) * amp;
          ctx.lineTo(b.x1 + dx * t + px * jitter, b.y1 + dy * t + py * jitter);
        }
        ctx.lineTo(b.x2, b.y2);
      };
      ctx.globalAlpha = fade * 0.4;
      ctx.strokeStyle = b.weap.coronaColor;
      ctx.lineWidth = b.weap.beamWidth * 3;
      path();
      ctx.stroke();
      ctx.globalAlpha = fade;
      ctx.strokeStyle = b.weap.beamColor;
      ctx.lineWidth = b.weap.beamWidth;
      path();
      ctx.stroke();
      ctx.globalAlpha = 1;
      ctx.lineCap = "butt";
    }

    // projectiles
    for (const p of this.projectiles) {
      // Flags3 0x0002: "Weapon's shots are translucent" — 27 weapons, the
      // blasters and railguns whose bolts read as energy rather than metal.
      const translucent = (p.weap.flags3 & W3_TRANSLUCENT) !== 0;
      if (translucent) ctx.globalAlpha = 0.55;
      const sheet =
        p.weap.spinId !== null
          ? WEAPON_SPRITES[String(p.weap.spinId)]
          : undefined;
      if (
        sheet &&
        drawSheetFrame(
          ctx,
          sheet,
          rotationFrame(sheet.frames, p.angle),
          p.x,
          p.y,
        )
      ) {
        ctx.globalAlpha = 1;
        continue;
      }
      ctx.fillStyle = p.fromPlayer ? "#ffd080" : "#ff8080";
      ctx.beginPath();
      ctx.arc(p.x, p.y, 2, 0, Math.PI * 2);
      ctx.fill();
      ctx.globalAlpha = 1;
    }

    // explosions
    for (const fx of this.explosions) {
      const sheet = BOOM_SPRITES[fx.boomId];
      if (sheet) {
        drawSheetFrame(
          ctx,
          sheet,
          Math.floor(fx.t * fx.fps),
          fx.x,
          fx.y,
          fx.scale,
        );
      }
    }

    // during the death sequence the hull is the fireball — don't paint the ship
    if (!this.playerDeath) {
      if (this.cloaked) ctx.globalAlpha = 0.35;
      this.drawShip(ctx, this.ship, true, this.player.shipId);
      ctx.globalAlpha = 1;
    }

    ctx.restore();
  }

  /**
   * Corner-mark target indicator for NPC ships, matching the stellar-mark
   * style but coloured by ship status:
   *   disabled → gray   hostile → red   ally → yellow   neutral → white
   */
  private drawNpcTargetMarks(
    ctx: CanvasRenderingContext2D,
    npc: NpcShip,
  ): void {
    const { x, y } = npc.pos;
    const r = npc.radius + 6;
    const arm = 9;
    const color = npc.ally
      ? "#40c060"
      : npc.disabled
        ? "#909090"
        : npc.hostile
          ? "#e04040"
          : "#e0c040";
    ctx.save();
    ctx.strokeStyle = color;
    ctx.lineWidth = 2;
    ctx.lineCap = "round";
    for (const [sx, sy] of [
      [-1, -1],
      [1, -1],
      [-1, 1],
      [1, 1],
    ] as const) {
      const cx = x + sx * r;
      const cy = y + sy * r;
      ctx.beginPath();
      ctx.moveTo(cx, cy + sy * -arm);
      ctx.lineTo(cx, cy);
      ctx.lineTo(cx + sx * -arm, cy);
      ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(cx, cy);
      ctx.lineTo(cx + sx * -arm * 0.55, cy + sy * -arm * 0.55);
      ctx.stroke();
    }
    ctx.restore();
  }

  /** The four blue corner marks EV Nova draws around a selected stellar. */
  private drawStellarMarks(
    ctx: CanvasRenderingContext2D,
    x: number,
    y: number,
    r: number,
  ): void {
    const arm = 9;
    ctx.save();
    ctx.strokeStyle = "#3a6ff0";
    ctx.fillStyle = "#3a6ff0";
    ctx.lineWidth = 2;
    ctx.lineCap = "round";
    for (const [sx, sy] of [
      [-1, -1],
      [1, -1],
      [-1, 1],
      [1, 1],
    ] as const) {
      const cx = x + sx * r;
      const cy = y + sy * r;
      // an L-shaped corner with a short diagonal tick pointing at the world
      ctx.beginPath();
      ctx.moveTo(cx, cy + sy * -arm);
      ctx.lineTo(cx, cy);
      ctx.lineTo(cx + sx * -arm, cy);
      ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(cx, cy);
      ctx.lineTo(cx + sx * -arm * 0.55, cy + sy * -arm * 0.55);
      ctx.stroke();
    }
    ctx.restore();
  }

  private drawShip(
    ctx: CanvasRenderingContext2D,
    ship: Ship,
    isPlayer: boolean,
    shipTypeId?: string | null,
  ): void {
    const { sprite, angle, thrusting } = ship;
    const set = ship.spriteSet;
    // the caller dims a cloaked ship; the additive layers have to fade with it
    const baseAlpha = ctx.globalAlpha;
    const flash = Math.min(1, Math.max(0, ship.gateFlash));
    ctx.save();
    ctx.translate(ship.pos.x, ship.pos.y);
    const glow = shipTypeId ? GLOW_SPRITES[shipTypeId] : undefined;
    const drewHull = !!(
      sprite && drawShipSprite(ctx, sprite, 0, 0, angle, set)
    );
    if (!drewHull) {
      ctx.save();
      ctx.rotate(angle);
      if (thrusting && flash < 0.85)
        drawThrustFlame(ctx, sprite ? sprite.w / 2 : 13);
      if (isPlayer) drawPlayerShip(ctx, false);
      else drawNpcShip(ctx, false);
      // flat white wash over the procedural stand-in hull
      if (flash > 0) {
        ctx.globalAlpha = baseAlpha * flash;
        ctx.fillStyle = "#ffffff";
        ctx.beginPath();
        ctx.arc(0, 0, 14, 0, Math.PI * 2);
        ctx.fill();
        ctx.globalAlpha = baseAlpha;
      }
      ctx.restore();
      ctx.restore();
      return;
    }

    // solid-white silhouette on top of the coloured hull (enter/exit gate flash)
    if (flash > 0 && sprite) {
      this.drawGateFlashOverlay(ctx, sprite, angle, set, baseAlpha * flash);
    }

    /*
     * Running lights (LightImageID) sit on top of the hull and blink to their
     * own BlinkMode pattern, independent of the engines. 92 of Nova's hulls
     * have one. Flags 0x0040 puts them out when the ship is disabled, which is
     * the visual cue that a hulk is dead rather than merely drifting.
     * Suppressed while fully bleached so the white silhouette stays clean.
     */
    const light = shipTypeId ? LIGHT_SPRITES[shipTypeId] : undefined;
    if (
      flash < 0.85 &&
      light &&
      sprite &&
      !(ship.disabled && sprite.flags & SHAN_HIDE_LIGHTS_DISABLED)
    ) {
      const intensity = blinkIntensity(sprite, this.time, shipTypeId ?? "");
      if (intensity > 0) {
        const prev = ctx.globalCompositeOperation;
        ctx.globalCompositeOperation = "lighter";
        ctx.globalAlpha = baseAlpha * intensity * (1 - flash);
        drawSheetFrame(
          ctx,
          light,
          spriteFrame(light.framesPer ?? 0, light.frames, angle, set),
          0,
          0,
        );
        ctx.globalAlpha = baseAlpha;
        ctx.globalCompositeOperation = prev;
      }
    }

    if (thrusting && flash < 0.85) {
      if (glow) {
        // Nova's own engine-glow sprite, additively blended over the hull
        const prev = ctx.globalCompositeOperation;
        ctx.globalCompositeOperation = "lighter";
        // the glow flickers between full and slightly dimmed, as in the original
        ctx.globalAlpha =
          baseAlpha * (0.75 + Math.random() * 0.25) * (1 - flash);
        drawSheetFrame(
          ctx,
          glow,
          spriteFrame(glow.framesPer ?? 0, glow.frames, angle, set),
          0,
          0,
        );
        ctx.globalAlpha = baseAlpha;
        ctx.globalCompositeOperation = prev;
      } else {
        ctx.save();
        ctx.rotate(angle);
        drawThrustFlame(ctx, sprite ? sprite.w / 2 : 13);
        ctx.restore();
      }
    }
    ctx.restore();
  }

  /**
   * Paint a solid-white copy of the hull sprite (alpha = how far into the
   * gate flash we are). Built via source-in on a small offscreen buffer so
   * only the opaque ship pixels bleach.
   */
  private drawGateFlashOverlay(
    ctx: CanvasRenderingContext2D,
    sprite: ShipSprite,
    angle: number,
    set: number,
    alpha: number,
  ): void {
    if (alpha <= 0) return;
    const w = sprite.w;
    const h = sprite.h;
    if (
      !this.gateFlashBuf ||
      !this.gateFlashCtx ||
      this.gateFlashBuf.width < w ||
      this.gateFlashBuf.height < h
    ) {
      this.gateFlashBuf = document.createElement("canvas");
      this.gateFlashBuf.width = Math.max(w, 64);
      this.gateFlashBuf.height = Math.max(h, 64);
      this.gateFlashCtx = this.gateFlashBuf.getContext("2d");
      if (!this.gateFlashCtx) return;
    }
    const fctx = this.gateFlashCtx;
    fctx.clearRect(0, 0, w, h);
    if (!drawShipSprite(fctx, sprite, w / 2, h / 2, angle, set)) return;
    fctx.globalCompositeOperation = "source-in";
    fctx.fillStyle = "#ffffff";
    fctx.fillRect(0, 0, w, h);
    fctx.globalCompositeOperation = "source-over";
    const prev = ctx.globalAlpha;
    ctx.globalAlpha = alpha;
    ctx.drawImage(this.gateFlashBuf, 0, 0, w, h, -w / 2, -h / 2, w, h);
    ctx.globalAlpha = prev;
  }

  // ---------------- HUD ----------------

  private renderMessages(ctx: CanvasRenderingContext2D, h: number): void {
    ctx.font = "13px Helvetica, Arial, sans-serif";
    ctx.textAlign = "left";
    let y = h - 18;
    for (let i = this.messages.length - 1; i >= 0; i--) {
      const m = this.messages[i];
      const age = this.time - m.time;
      if (age > 8) continue;
      const alpha = age > 6 ? 1 - (age - 6) / 2 : 1;
      ctx.fillStyle = `rgba(190,210,235,${alpha * 0.9})`;
      ctx.fillText(m.text, 16, y);
      y -= 20;
    }
  }

  // ---------------- galactic map ----------------

  /**
   * Nova's floating hyperspace map (H / hyper-select). A small chart of the
   * current system and its neighbourhood — plus any plotted route — drawn over
   * the playfield. Flight keeps running; this is not `mode === "map"`.
   *
   * cölr FloatingMap is the border colour Nova uses for this overlay (and the
   * escort menu). The full star map is a separate full-screen mode (M).
   */
  private renderFloatingMap(
    ctx: CanvasRenderingContext2D,
    w: number,
    h: number,
  ): void {
    const alpha = this.floatingMapAlpha();
    if (alpha <= 0.01) return;

    const playW = w - SIDEBAR_W;
    const boxW = Math.min(260, Math.max(180, playW * 0.28));
    const boxH = Math.min(220, Math.max(150, h * 0.28));
    const margin = 14;
    const bx = playW - boxW - margin;
    const by = margin;

    ctx.save();
    ctx.globalAlpha = alpha;

    // clip so labels / lanes never spill outside the plate (inner save
    // restores the clip only — alpha stays for border + caption)
    ctx.save();
    ctx.beginPath();
    ctx.rect(bx, by, boxW, boxH);
    ctx.clip();


    const here = this.system;
    // tight neighbourhood only: here + one-jump links. A long multi-hop plot
    // must not zoom the plate out — the overlay is for hyper-select, not M.
    const interest = new Set<string>([here.id, ...here.links]);

    // fit so every neighbour sits inside the plate, centred on the current system
    let maxR = 28; // minimum radius so a lone system isn't absurdly zoomed
    for (const id of here.links) {
      let sys;
      try {
        sys = getSystem(id);
      } catch {
        continue;
      }
      const dx = sys.mapPos.x - here.mapPos.x;
      const dy = sys.mapPos.y - here.mapPos.y;
      maxR = Math.max(maxR, Math.hypot(dx, dy));
    }
    // small margin so labels and rings clear the border
    maxR *= 1.18;

    const inset = 22;
    const s = Math.min(
      (boxW - inset * 2) / (maxR * 2),
      (boxH - inset * 2) / (maxR * 2),
    );
    const cx = here.mapPos.x;
    const cy = here.mapPos.y;
    const toScreen = (mx: number, my: number) => ({
      x: bx + boxW / 2 + (mx - cx) * s,
      y: by + boxH / 2 + (my - cy) * s,
    });

    // only here + neighbours (and anything that happens to sit in that circle)
    const visible = this.allSystems().filter((sys) => {
      if (!interest.has(sys.id)) {
        // drop anything outside the neighbourhood circle
        const d = Math.hypot(
          sys.mapPos.x - here.mapPos.x,
          sys.mapPos.y - here.mapPos.y,
        );
        if (d > maxR * 1.05) return false;
        if (!this.isExplored(sys.id) && !sys.links.some((l) => interest.has(l)))
          return false;
      }
      return true;
    });
    const visibleIds = new Set(visible.map((s) => s.id));

    // lanes between explored systems (and the next hop, so the route reads)
    ctx.strokeStyle = "rgba(90,120,160,0.45)";
    ctx.lineWidth = 1;
    const drawn = new Set<string>();
    ctx.beginPath();
    for (const sys of visible) {
      if (!this.isExplored(sys.id) && !interest.has(sys.id)) continue;
      const a = toScreen(sys.mapPos.x, sys.mapPos.y);
      for (const linkId of sys.links) {
        if (!visibleIds.has(linkId)) continue;
        const key = [sys.id, linkId].sort().join("|");
        if (drawn.has(key)) continue;
        drawn.add(key);
        const other = getSystem(linkId);
        const b = toScreen(other.mapPos.x, other.mapPos.y);
        ctx.moveTo(a.x, a.y);
        ctx.lineTo(b.x, b.y);
      }
    }
    ctx.stroke();

    // plotted course
    if (this.route.length > 0) {
      ctx.strokeStyle = "rgba(130,220,150,0.95)";
      ctx.lineWidth = 2.5;
      let prev = here;
      for (const id of this.route) {
        let next;
        try {
          next = getSystem(id);
        } catch {
          break;
        }
        const a = toScreen(prev.mapPos.x, prev.mapPos.y);
        const b = toScreen(next.mapPos.x, next.mapPos.y);
        ctx.beginPath();
        ctx.moveTo(a.x, a.y);
        ctx.lineTo(b.x, b.y);
        ctx.stroke();
        prev = next;
      }
    }

    ctx.textAlign = "center";
    for (const sys of visible) {
      const pt = toScreen(sys.mapPos.x, sys.mapPos.y);
      const explored = this.isExplored(sys.id);
      const isCurrent = sys.id === this.player.systemId;
      const isDest = sys.id === this.routeDest;
      const onRoute = this.route.includes(sys.id);
      const isNext = this.route.length > 0 && this.route[0] === sys.id;

      if (!explored && !isCurrent && !onRoute && !isDest) {
        ctx.fillStyle = "rgba(120,135,155,0.55)";
        ctx.beginPath();
        ctx.arc(pt.x, pt.y, 2.5, 0, Math.PI * 2);
        ctx.fill();
        continue;
      }

      const inhabited = sys.planets.some((p) => p.landable && !p.uninhabited);
      const welcome =
        inhabited &&
        sys.planets.some(
          (p) =>
            p.landable && !p.uninhabited && this.clearedToLand(p, sys.govtId),
        );
      const r = isCurrent || isNext ? 5.5 : inhabited ? 4 : 3;
      ctx.fillStyle = !inhabited
        ? "#4a5666"
        : welcome
          ? systemGovtColor(sys)
          : "#c85028";
      ctx.beginPath();
      ctx.arc(pt.x, pt.y, r, 0, Math.PI * 2);
      ctx.fill();

      if (isCurrent || isDest || isNext) {
        ctx.strokeStyle = isCurrent
          ? "#ffffff"
          : isNext
            ? "#ffe08a"
            : "#8be09b";
        ctx.lineWidth = 1.5;
        ctx.beginPath();
        ctx.arc(pt.x, pt.y, 9, 0, Math.PI * 2);
        ctx.stroke();
      }

      // label current, next hop, final dest, and immediate neighbours
      if (
        isCurrent ||
        isDest ||
        isNext ||
        here.links.includes(sys.id) ||
        interest.has(sys.id)
      ) {
        ctx.font =
          isCurrent || isNext
            ? "600 11px Helvetica, Arial, sans-serif"
            : "10px Helvetica, Arial, sans-serif";
        ctx.fillStyle = isCurrent
          ? "#ffffff"
          : isNext
            ? "#ffe08a"
            : isDest
              ? "#a8e0b2"
              : "rgba(190,205,225,0.88)";
        ctx.fillText(sys.name, pt.x, pt.y + 15);
      }
    }

    ctx.restore(); // end clip

    // border outside the clip so it stays sharp (still under alpha)
    if (COLR) {
      ctx.strokeStyle = COLR.floatingMap;
      ctx.lineWidth = 2;
      ctx.strokeRect(bx + 0.5, by + 0.5, boxW - 1, boxH - 1);
      ctx.lineWidth = 1;
    } else {
      ctx.strokeStyle = "rgba(120, 160, 210, 0.85)";
      ctx.strokeRect(bx + 0.5, by + 0.5, boxW - 1, boxH - 1);
    }

    ctx.restore(); // end alpha
  }

  private renderMap(
    ctx: CanvasRenderingContext2D,
    fullW: number,
    h: number,
  ): void {
    ctx.fillStyle = "rgba(2,5,12,0.92)";
    // the backdrop runs the whole width, so nothing of the flight scene shows
    // through beside the status bar
    ctx.fillRect(0, 0, fullW, h);
    /*
     * The chart itself lays out in the space *left* of the status bar. The
     * sidebar is an opaque DOM panel over the canvas and stays up under the
     * map, so drawing to the full canvas width put the right-hand readout —
     * government, standing, goods, services — underneath it: 176 of its 186
     * columns were hidden, which read as the map having no panel at all.
     */
    const w = fullW - SIDEBAR_W;
    // full-screen chart frame (not the H overlay — that uses FloatingMap above)
    ctx.strokeStyle = COLR?.floatingMap ?? "rgba(120, 160, 210, 0.6)";
    ctx.lineWidth = 2;
    ctx.strokeRect(1, 1, w - 2, h - 2);
    ctx.lineWidth = 1;

    // base scale fits the whole galaxy at zoom 1; user zoom/pan on top
    let minX = Infinity,
      maxX = -Infinity,
      minY = Infinity,
      maxY = -Infinity;
    for (const sys of this.allSystems()) {
      minX = Math.min(minX, sys.mapPos.x);
      maxX = Math.max(maxX, sys.mapPos.x);
      minY = Math.min(minY, sys.mapPos.y);
      maxY = Math.max(maxY, sys.mapPos.y);
    }
    const pad = 80;
    const baseScale = Math.min(
      (w - pad * 2) / Math.max(1, maxX - minX),
      (h - pad * 2) / Math.max(1, maxY - minY),
    );
    const s = baseScale * this.mapZoom;
    this.mapScale = s;
    const toScreen = (mx: number, my: number) => ({
      x: w / 2 + (mx - this.mapCenter.x) * s,
      y: h / 2 + (my - this.mapCenter.y) * s,
    });
    const onScreen = (pt: { x: number; y: number }) =>
      pt.x > -60 && pt.x < w + 60 && pt.y > -60 && pt.y < h + 60;

    // nëbu backdrops: purely decorative clouds behind the lanes. Their
    // rect is in normal-zoom map units, so it scales with everything else.
    for (const neb of NEBULAE) {
      if (
        neb.activeOn &&
        !evalTest(neb.activeOn, this.player.bits, {
          outfits: this.player.outfits,
          explored: this.player.explored,
          male: true,
        })
      )
        continue;
      const tl = toScreen(neb.x, neb.y);
      const pw = neb.w * s;
      const ph = neb.h * s;
      if (tl.x > w || tl.y > h || tl.x + pw < 0 || tl.y + ph < 0) continue;
      const pic = nebulaPict(neb.id, pw);
      if (!pic) continue;
      const img = getPict(pic.file);
      if (!img) continue;
      ctx.save();
      ctx.globalAlpha = 0.6;
      ctx.globalCompositeOperation = "lighter";
      ctx.drawImage(img, tl.x, tl.y, pw, ph);
      ctx.restore();
    }

    // Government space, Nova's "Show Borders": a soft halo of each govt's
    // colour around its systems, overlapping into continuous territory.
    if (this.mapBorders) {
      // Plain alpha, not additive: neighbouring systems of one government
      // should deepen into a single territory rather than blow out to white.
      ctx.save();
      const radius = Math.max(14, 22 * s);
      for (const sys of this.allSystems()) {
        if (sys.govtId < 128 || !this.isExplored(sys.id)) continue;
        const pt = toScreen(sys.mapPos.x, sys.mapPos.y);
        if (
          pt.x < -radius ||
          pt.y < -radius ||
          pt.x > w + radius ||
          pt.y > h + radius
        )
          continue;
        const grad = ctx.createRadialGradient(
          pt.x,
          pt.y,
          0,
          pt.x,
          pt.y,
          radius,
        );
        grad.addColorStop(0, govtHaze(sys.govtId, 0.3));
        grad.addColorStop(0.65, govtHaze(sys.govtId, 0.18));
        grad.addColorStop(1, govtHaze(sys.govtId, 0));
        ctx.fillStyle = grad;
        ctx.beginPath();
        ctx.arc(pt.x, pt.y, radius, 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.restore();
    }

    // links (normal hyperlanes) — still drawn under a gate chart so the map
    // reads like the real one; gate network lines are overlaid below
    ctx.strokeStyle = "rgba(90,120,160,0.38)";
    ctx.lineWidth = 1;
    const drawn = new Set<string>();
    ctx.beginPath();
    for (const sys of this.allSystems()) {
      if (!this.isExplored(sys.id)) continue; // uncharted space has no lanes drawn
      const a = toScreen(sys.mapPos.x, sys.mapPos.y);
      for (const linkId of sys.links) {
        const key = [sys.id, linkId].sort().join("|");
        if (drawn.has(key)) continue;
        drawn.add(key);
        const other = getSystem(linkId);
        const b = toScreen(other.mapPos.x, other.mapPos.y);
        if (!onScreen(a) && !onScreen(b)) continue;
        ctx.moveTo(a.x, a.y);
        ctx.lineTo(b.x, b.y);
      }
    }
    ctx.stroke();

    // hypergate network from the gate you're on (chooser only).
    // Tab cycles selection; the selected link is drawn brighter/thicker.
    const gateLinkIds = this.gateChooser
      ? this.gateChooserSystemIds()
      : ([] as string[]);
    if (this.gateChooser && gateLinkIds.length) {
      const here = toScreen(this.system.mapPos.x, this.system.mapPos.y);
      for (const id of gateLinkIds) {
        const other = getSystem(id);
        const b = toScreen(other.mapPos.x, other.mapPos.y);
        const sel = id === this.mapSelected;
        ctx.strokeStyle = sel
          ? "rgba(255, 230, 140, 0.98)"
          : "rgba(255, 200, 90, 0.4)";
        ctx.lineWidth = sel ? 3 : 1.5;
        ctx.setLineDash(sel ? [] : [5, 4]);
        ctx.beginPath();
        ctx.moveTo(here.x, here.y);
        ctx.lineTo(b.x, b.y);
        ctx.stroke();
      }
      ctx.setLineDash([]);
    }

    // route highlight (hyperspace plot only — not the gate chart)
    if (!this.gateChooser && this.route.length > 0) {
      ctx.strokeStyle = "rgba(130,220,150,0.9)";
      ctx.lineWidth = 2.5;
      let prev = this.system;
      for (const id of this.route) {
        const next = getSystem(id);
        const a = toScreen(prev.mapPos.x, prev.mapPos.y);
        const b = toScreen(next.mapPos.x, next.mapPos.y);
        ctx.beginPath();
        ctx.moveTo(a.x, a.y);
        ctx.lineTo(b.x, b.y);
        ctx.stroke();
        prev = next;
      }
    }

    /*
     * Mission markers. mïsn Flags settles what Nova draws: 0x0002 is "don't
     * show the red destination arrows on the map", 0x0100 "show green arrow on
     * map in initial briefing" and 0x0200 "show an additional arrow on the map
     * for the ShipSyst". So red is the ordinary destination arrow, green is
     * the one a briefing points with — which is why a mission previewed from
     * the board comes up green — and the system where the special ships wait
     * gets its own marker when the mission asks for it.
     */
    const missionSystems = new Map<string, string>();
    const mark = (systemId: string | undefined, color: string) => {
      if (systemId && !missionSystems.has(systemId))
        missionSystems.set(systemId, color);
    };
    for (const active of this.player.activeMissions) {
      const m = MISSIONS[String(active.misnId)];
      if (m && (m.flags & 0x0002) !== 0) continue;
      const dest = active.travelDone
        ? (active.returnSpobId ?? null)
        : active.travelSpobId;
      if (dest) mark(SPOB_INDEX.get(dest)?.systemId, MISSION_ARROW);
      if (m && (m.flags & 0x0200) !== 0)
        mark(active.shipSystemId ?? undefined, MISSION_ARROW);
    }
    // a posting being previewed from the board is the briefing's green arrow
    for (const systemId of this.mapPreview) mark(systemId, BRIEFING_ARROW);

    /*
     * Nova's mission marker: a small arrow standing over the destination
     * system, offset by the node's own radius so it sits the same distance
     * clear of a 2px uncharted dot and a 6px current-system disc. Drawn as a
     * tall isosceles triangle (not equilateral) so the tip is obviously the
     * end that points at the system.
     */
    const missionArrow = (
      pt: { x: number; y: number },
      r: number,
      color: string,
    ) => {
      // tip just above the node; short base higher up → clear down-point
      const tipY = pt.y - (r + 5);
      const baseY = tipY - 12;
      const halfBase = 3.5;
      ctx.fillStyle = color;
      ctx.beginPath();
      ctx.moveTo(pt.x, tipY);
      ctx.lineTo(pt.x - halfBase, baseY);
      ctx.lineTo(pt.x + halfBase, baseY);
      ctx.closePath();
      ctx.fill();
    };

    // nodes
    this.mapNodes = [];
    const labelAll = this.mapZoom >= 1.8;
    ctx.textAlign = "center";
    for (const sys of this.allSystems()) {
      const pt = toScreen(sys.mapPos.x, sys.mapPos.y);
      if (!onScreen(pt)) continue;
      const explored = this.isExplored(sys.id);
      // an unvisited neighbour of somewhere you've been shows as an unknown dot
      const adjacent = !explored && sys.links.some((l) => this.isExplored(l));
      /*
       * A mission destination is plotted however far out it lies: accepting a
       * job somewhere you have never been puts the dot and its arrow on the
       * chart, but none of that system's lanes, since the lane loop above
       * still only draws from explored systems. That is exactly what Nova
       * shows — a marked dot floating in uncharted space.
       */
      const isMission = missionSystems.get(sys.id);
      const isGateLinkEarly = gateLinkIds.includes(sys.id);
      // gate network posts its own ends: linked systems appear even uncharted
      if (!explored && !adjacent && !isMission && !isGateLinkEarly) continue;
      if (!explored && !isGateLinkEarly) {
        ctx.fillStyle = "rgba(120,135,155,0.5)";
        ctx.beginPath();
        ctx.arc(pt.x, pt.y, 2.5, 0, Math.PI * 2);
        ctx.fill();
        if (isMission) missionArrow(pt, 2.5, isMission);
        this.mapNodes.push({ id: sys.id, x: pt.x, y: pt.y });
        continue;
      }
      if (!explored && isGateLinkEarly) {
        // dim unvisited gate end, still selectable
        this.mapNodes.push({ id: sys.id, x: pt.x, y: pt.y });
        const isGateSel =
          this.gateChooser != null && sys.id === this.mapSelected;
        ctx.fillStyle = isGateSel ? "#ffd27a" : "rgba(224, 168, 74, 0.55)";
        ctx.beginPath();
        ctx.arc(pt.x, pt.y, isGateSel ? 5 : 3.5, 0, Math.PI * 2);
        ctx.fill();
        ctx.strokeStyle = isGateSel ? "#ffe6a8" : "rgba(255, 200, 90, 0.55)";
        ctx.lineWidth = 1.5;
        ctx.beginPath();
        ctx.arc(pt.x, pt.y, 10, 0, Math.PI * 2);
        ctx.stroke();
        if (isMission) missionArrow(pt, 3.5, isMission);
        ctx.font = isGateSel
          ? "600 12px Helvetica, Arial, sans-serif"
          : "11px Helvetica, Arial, sans-serif";
        ctx.fillStyle = isGateSel ? "#ffe6a8" : "rgba(255, 210, 122, 0.75)";
        ctx.fillText(sys.name, pt.x, pt.y + 18);
        continue;
      }
      this.mapNodes.push({ id: sys.id, x: pt.x, y: pt.y });
      const isCurrent = sys.id === this.player.systemId;
      const isDest = !this.gateChooser && sys.id === this.routeDest;
      const isGateLink = gateLinkIds.includes(sys.id);
      const isGateSel = this.gateChooser != null && sys.id === this.mapSelected;
      /*
       * Only an inhabited world counts as somewhere to land here. An
       * uninhabited rock ignores MinStatus and will always take you, but Nova
       * still draws its system as an empty one: Procyon and Capella hold
       * nothing but uninhabited stellars and are plain grey dots on the
       * original map, while Rigel is red on the strength of Rigel III alone.
       */
      const inhabited = sys.planets.some((p) => p.landable && !p.uninhabited);
      const r = isCurrent || isGateSel ? 6 : inhabited || isGateLink ? 4.5 : 3;
      /*
       * Nova's three map colours. A system with somewhere to land is painted
       * in its government's own gövt Color; one that will not clear you to
       * land anywhere — every landable stellar's spöb MinStatus above your
       * record here — turns red; one with nothing to land on is a bare grey
       * dot. That is what makes Rigel, Kerella and Lesten stand out red in
       * Federation blue for a pilot with no record: Rigel III wants 4,
       * Spacedock VI 2 and Menin 5.
       */
      const welcome =
        inhabited &&
        sys.planets.some(
          (p) =>
            p.landable && !p.uninhabited && this.clearedToLand(p, sys.govtId),
        );
      ctx.fillStyle = isGateLink
        ? isGateSel
          ? "#ffd27a"
          : "#e0a84a"
        : !inhabited
          ? "#4a5666"
          : welcome
            ? systemGovtColor(sys)
            : "#c85028";
      ctx.beginPath();
      ctx.arc(pt.x, pt.y, r, 0, Math.PI * 2);
      ctx.fill();
      if (isCurrent || isDest || isGateSel || isGateLink) {
        ctx.strokeStyle = isGateSel
          ? "#ffe6a8"
          : isGateLink
            ? "rgba(255, 200, 90, 0.7)"
            : isCurrent
              ? "#ffffff"
              : "#8be09b";
        ctx.lineWidth = isGateSel ? 2 : 1.5;
        ctx.beginPath();
        ctx.arc(pt.x, pt.y, isGateLink || isGateSel ? 11 : 10, 0, Math.PI * 2);
        ctx.stroke();
      }
      if (isMission) missionArrow(pt, r, isMission);
      const nearCursor =
        Math.hypot(pt.x - this.mouse.x, pt.y - this.mouse.y) < 42;
      if (
        labelAll ||
        isCurrent ||
        isDest ||
        isGateSel ||
        isGateLink ||
        nearCursor
      ) {
        ctx.font =
          isCurrent || isDest || isGateSel
            ? "600 12px Helvetica, Arial, sans-serif"
            : "11px Helvetica, Arial, sans-serif";
        ctx.fillStyle = isCurrent
          ? "#ffffff"
          : isGateSel
            ? "#ffe6a8"
            : isGateLink
              ? "#ffd27a"
              : isDest
                ? "#a8e0b2"
                : "rgba(190,205,225,0.82)";
        ctx.fillText(sys.name, pt.x, pt.y + 18);
      }
    }

    this.drawMapPanel(ctx, w, h);
  }

  /**
   * The map's right-hand readout and button bar. Nova puts the selected
   * system's government, your standing there, what it trades and what
   * services it offers here, with its ports and hazards along the bottom.
   */
  private drawMapPanel(
    ctx: CanvasRenderingContext2D,
    w: number,
    h: number,
  ): void {
    const panelW = 186;
    const px = w - panelW - 16;
    const barH = 34;
    const py = 16;
    const panelH = h - barH - 44;

    ctx.fillStyle = "rgba(7,13,24,0.86)";
    ctx.strokeStyle = "#2a3a52";
    roundRect(ctx, px, py, panelW, panelH, 5);
    ctx.fill();
    ctx.stroke();

    const sel = this.mapSelected ? getSystem(this.mapSelected) : this.system;
    let ty = py + 20;
    const label = (text: string) => {
      ctx.font = "10px Helvetica, Arial, sans-serif";
      ctx.fillStyle = "#7d90aa";
      ctx.textAlign = "left";
      ctx.fillText(text, px + 10, ty);
      ty += 13;
    };
    const value = (text: string, color = "#d6e2f0") => {
      ctx.font = "11.5px Helvetica, Arial, sans-serif";
      ctx.fillStyle = color;
      ctx.fillText(text, px + 10, ty);
      ty += 15;
    };

    if (this.gateChooser) {
      label("Hypergate:");
      value(this.gateChooser.name, "#ffd27a");
      ty += 4;
      label("From System:");
      value(this.system.name, "#e8eef6");
      ty += 6;
      label("Travel To:");
      const gateOk = this.gateChooserSystemIds().includes(sel.id);
      value(sel.name, gateOk ? "#ffe6a8" : "#8fa2ba");
      ty += 4;
      if (gateOk) {
        const dest = this.gateDestinations(this.gateChooser).find((d) => {
          const e = SPOBS.get(d.spobId);
          return e?.systemId === sel.id;
        });
        if (dest) {
          label("Far Gate:");
          value(dest.name);
        }
      } else {
        label("Status:");
        value("Not on this network", "#62748c");
      }
      ty += 8;
      label("Controls:");
      value("Tab cycle links", "#9fb0c6");
      value("Enter travel · Esc leave", "#9fb0c6");
    } else {
      label("Destination System:");
      value(sel.name, "#e8eef6");
      ty += 6;
      label("Government:");
      value(sel.govtName ?? "Independent");
      ty += 6;
      label("Legal Status:");
      const rec = getRecord(this.player, sel.govtId);
      value(
        rec === 0
          ? "No Record"
          : rec > 0
            ? `Good (${rec})`
            : `Criminal (${rec})`,
        rec < 0 ? "#e08a7a" : rec > 0 ? "#a8d9b0" : "#8fa2ba",
      );
      ty += 6;
    }

    const explored = this.isExplored(sel.id);
    const ports = sel.planets.filter((p) => p.landable);
    if (!this.gateChooser && explored && ports.length) {
      const goods = new Set<string>();
      const services = new Set<string>();
      for (const p of ports) {
        for (const c of COMMODITIES)
          if (p.prices[c.id] !== undefined) goods.add(c.name);
        if (p.exchange) services.add("Trading");
        if (p.outfitter) services.add("Outfitting");
        if (p.shipyard) services.add("Shipyard");
        if (p.bar) services.add("Bar");
      }
      label("Goods Traded:");
      if (goods.size === 0) value("None", "#62748c");
      for (const g of goods) value(g);
      ty += 6;
      label("Services:");
      if (services.size === 0) value("None", "#62748c");
      for (const sv of services) value(sv);
    } else if (!this.gateChooser && !explored) {
      label("Status:");
      value("Uncharted", "#62748c");
    }

    /*
     * The calendar closes the panel out, ruled off from the system's own
     * details above it. It is anchored to the foot of the box rather than
     * following `ty`, since how far the goods and services lists run is a
     * property of the system you happen to have selected.
     */
    const dateBase = py + panelH - 14;
    ctx.strokeStyle = "#22304a";
    ctx.beginPath();
    ctx.moveTo(px + 10, dateBase - 32);
    ctx.lineTo(px + panelW - 10, dateBase - 32);
    ctx.stroke();
    ty = dateBase - 13;
    label("Date:");
    ty = dateBase;
    value(formatDate(this.player.date));

    // ports and hazards along the bottom of the chart area
    ctx.font = "10.5px Helvetica, Arial, sans-serif";
    let fy = h - barH - 34;
    ctx.textAlign = "left";
    ctx.fillStyle = "#7d90aa";
    ctx.fillText("Ports:", 20, fy);
    ctx.fillStyle = "#b8c8dc";
    ctx.fillText(
      explored && ports.length ? ports.map((p) => p.name).join(", ") : "None",
      74,
      fy,
    );
    fy += 15;
    ctx.fillStyle = "#7d90aa";
    ctx.fillText("Navigation Hazards:", 20, fy);
    ctx.fillStyle = "#b8c8dc";
    const hazard =
      sel.asteroids >= 11
        ? "Heavy asteroid field"
        : sel.asteroids >= 5
          ? "Moderate asteroid field"
          : sel.asteroids > 0
            ? "Light asteroid field"
            : "None";
    ctx.fillText(hazard, 148, fy);

    // button bar
    this.mapButtons = [];
    const buttons: { id: string; label: string; w: number }[] = this.gateChooser
      ? [
          { id: "travel", label: "Travel", w: 80 },
          { id: "cancel-gate", label: "Leave Gate", w: 96 },
          { id: "zoomout", label: "–", w: 26 },
          { id: "zoomin", label: "+", w: 26 },
          {
            id: "borders",
            label: this.mapBorders ? "Hide Borders" : "Show Borders",
            w: 98,
          },
        ]
      : [
          {
            id: "borders",
            label: this.mapBorders ? "Hide Borders" : "Show Borders",
            w: 98,
          },
          { id: "clear", label: "Clear Route", w: 88 },
          { id: "find", label: "Find", w: 60 },
          { id: "zoomout", label: "–", w: 26 },
          { id: "zoomin", label: "+", w: 26 },
          { id: "done", label: "Done", w: 74 },
        ];
    const gap = 8;
    let bx = 20;
    const by = h - barH - 6;
    for (const b of buttons) {
      const canTravel =
        b.id !== "travel" ||
        (this.mapSelected != null &&
          this.gateChooserSystemIds().includes(this.mapSelected));
      const disabled =
        (b.id === "clear" && this.route.length === 0) ||
        (b.id === "travel" && !canTravel);
      ctx.fillStyle = disabled ? "#3a1010" : "#6e1010";
      ctx.strokeStyle = "#7d1a1a";
      roundRect(ctx, bx, by, b.w, 24, 11);
      ctx.fill();
      ctx.stroke();
      ctx.font = "600 11px Helvetica, Arial, sans-serif";
      ctx.fillStyle = disabled ? "#7a5a5a" : "#ffdede";
      ctx.textAlign = "center";
      ctx.fillText(b.label, bx + b.w / 2, by + 16);
      if (!disabled)
        this.mapButtons.push({ id: b.id, x: bx, y: by, w: b.w, h: 24 });
      bx += b.w + gap;
    }
    ctx.textAlign = "left";
  }

  private allSystems(): SystemDef[] {
    return SYSTEMS;
  }
}

/** Shorten `text` with an ellipsis until it fits `max` pixels at the current font. */

function roundRect(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  r: number,
): void {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}
