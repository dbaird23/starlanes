import {
  BOOM_SPRITES,
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
  CURSOR_SPRITE,
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
import { drawNpcShip, drawPlanet, drawPlayerShip, drawThrustFlame } from "../engine/draw";
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
} from "../engine/sprites";
import { applySet, evalTest } from "./bits";
import { formatDate } from "./calendar";
import { runCrons } from "./crons";
import { runOopses } from "./oops";
import {
  descText,
  instantiateMission,
  missionCargoUsed,
  missionDisplayName,
  substituteTags,
  testContext,
  type MissionEvent,
} from "./missions";
import { deletePilot, listPilots, loadPilot, savePilot } from "./pilots";
import {
  applyCompReward,
  applyCrime,
  applySmuggling,
  contraband,
  crimeTolerance,
  getRecord,
  ratingName,
} from "./reputation";
import {
  getVolume,
  playSnd,
  playSndAt,
  preloadCoreSnds,
  preloadSnds,
  setVolume,
  SND,
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
  W3_AMMO_AT_BURST_END,
  W3_TRANSLUCENT,
  fireWeapon,
  isBeam,
  isFighterBay,
  isPointDefense,
  isPrimary,
  isSecondary,
  isTurret,
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
import { InfoUi, type InfoRow } from "../ui/info";
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
import { HailUi } from "../ui/hail";
import { PlunderUi } from "../ui/plunder";
import { HUD_W, HudUi } from "../ui/hud";
import type { CaptureResult, PlunderHold } from "../ui/plunder";
import { LandedUi } from "../ui/landed";
import { NpcShip, SPARROW, Ship, type EscortOrder } from "./ship";

type Mode = "menu" | "flight" | "map" | "landed";

interface JumpSequence {
  phase: "turning" | "charging";
  chargeLeft: number;
  targetAngle: number;
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

const LAND_DIST = 2.4; // multiples of planet radius (from surface-ish)
const LAND_SPEED = 130;
const REFUEL_COST_PER_JUMP = 150;


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
      if (other === govt || govtAllied(govt, other)) out[String(other)] = status;
      else if (govtEnemy(govt, other)) out[String(other)] = -status;
    }
  }
  return out;
}
function defaultPlayer(): PlayerState {
  // the scenario's own starting template decides ship, cash and where you begin
  const tmpl = START_TEMPLATE;
  const startShip = tmpl && SHIPS[String(tmpl.shipType)] ? String(tmpl.shipType) : "128";
  return {
    credits: tmpl?.cash ?? 10000,
    fuelJumps: 3,
    maxFuelJumps: 3,
    cargo: {},
    cargoCap: 10,
    systemId: pickStartSystemId(),
    landedOn: null,
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
    personsKilled: [],
    dominated: [],
    tributeDay: 0,
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
  return type.escSellValue > 0 ? type.escSellValue : Math.round(type.cost * 0.1);
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
  /** set by main.ts to reopen the title menu */
  onMenu: (() => void) | null = null;
  ship = new Ship(SPARROW);
  npcs: NpcShip[] = [];
  private npcSpawnTimer = 3;
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
    escapePod: false, densityScanner: false, iff: false, autoRefuel: false,
    fastJump: false, inertialDamper: false, hyperSpeed: 0, jumpDist: 0, marines: 0,
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
  /** the autopilot has the stick (Q) */
  private autopilot = false;
  /**
   * Hypergate rings, by spöb id. A gate sits closed and only runs its 42-frame
   * sequence when someone opens it, holding on the last frame until it is used
   * or the pilot backs out.
   */
  private gateAnim = new Map<string, { phase: GatePhase; frame: number }>();
  /** the gate the player is currently opening, if any */
  private gateDocking: PlanetDef | null = null;
  private jump: JumpSequence | null = null;
  private jumpFlash = 0;

  private messages: Message[] = [];
  private pendingMissionEvents: MissionEvent[] = [];
  private time = 0;
  private mapNodes: { id: string; x: number; y: number }[] = [];
  /** clickable rects for the map's own button bar */
  private mapButtons: { id: string; x: number; y: number; w: number; h: number }[] = [];
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
      if (this.mode === "map") this.drag = { x: e.clientX, y: e.clientY, moved: 0 };
    });
    window.addEventListener("mouseup", () => {
      this.lastDragMoved = this.drag?.moved ?? 0;
      this.drag = null;
    });
    canvas.addEventListener("mousemove", (e) => {
      const rect = canvas.getBoundingClientRect();
      this.mouse = { x: e.clientX - rect.left, y: e.clientY - rect.top };
      if (this.drag && this.mode === "map") {
        this.mapCenter.x -= (e.movementX ?? 0) / this.mapScale;
        this.mapCenter.y -= (e.movementY ?? 0) / this.mapScale;
        this.drag.moved += Math.abs(e.movementX ?? 0) + Math.abs(e.movementY ?? 0);
      }
    });

    // park the camera over the start system for the menu backdrop
    const home = this.system.planets[0];
    if (home) {
      this.ship.pos = { x: home.pos.x + home.radius * 2.2, y: home.pos.y + home.radius * 1.4 };
    }
    this.populateNpcs();
  }

  /** Begin playing as a pilot (new or loaded). Called from the main menu. */
  startPilot(pilotId: string, strict?: boolean): void {
    preloadCoreSnds();
    this.pilotId = pilotId;
    this.pilotName = listPilots().find((p) => p.id === pilotId)?.name ?? "Captain";
    const saved = loadPilot(pilotId);
    this.player = { ...defaultPlayer(), ...(saved ?? {}) };
    if (strict !== undefined) this.player.strict = strict;
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
    this.jump = null;
    stopSustained(JUMP_SND_KEY); // a pilot switch mid-charge leaves nothing humming
    this.projectiles = [];
    this.explosions = [];
    this.targetNpc = null;
    this.messages = [];

    const sys = this.system;
    const home = this.player.landedOn
      ? sys.planets.find((p) => p.id === this.player.landedOn)
      : sys.planets[0];
    if (home) {
      this.ship.pos = { x: home.pos.x + home.radius * 2.2, y: home.pos.y + home.radius * 1.4 };
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
      this.message(`Welcome to the ${sys.name} system. Press M for the map, L to land.`);
    }
    this.save();
  }

  /**
   * Destinations reachable from a gate: explicit links, or any far wormhole.
   * Each carries its system's map position so the gate panel can plot the
   * network rather than just list it.
   */
  gateDestinations(gate: PlanetDef): GateDestination[] {
    const describe = (spobId: string): GateDestination | null => {
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
      return { spobId, name: entry.planet.name, systemName, mapPos, explored };
    };
    if (gate.hyperLinks.length > 0) {
      return gate.hyperLinks
        .map(describe)
        .filter((d): d is GateDestination => d !== null);
    }
    if (gate.isWormhole) {
      // an unlinked wormhole dumps you at another unlinked wormhole
      const others = [...SPOBS.values()].filter(
        (e) => e.planet.isWormhole && e.planet.hyperLinks.length === 0 && e.planet.id !== gate.id,
      );
      if (others.length === 0) return [];
      const pick = others[Math.floor(Math.random() * others.length)];
      const d = describe(pick.planet.id);
      return d ? [d] : [];
    }
    return [];
  }

  /**
   * Whether this gate will answer at all. The data splits them cleanly: the 19
   * working gates carry Nova's can-land bit and belong to govt 183, "Hypergate";
   * the 16 dead ones drop that bit, have no government, and wear a different
   * sprite the resources call "Broken Hypergate". Only the working ones open.
   */
  gateIsWorking(gate: PlanetDef): boolean {
    return gate.isWormhole || gate.landable;
  }

  /**
   * Which frame of an animated stellar to draw. The two behave differently and
   * the sheets say so: the hypergate's 42 frames climb from a dark closed ring
   * to a bright open one and stay there, so it is a one-shot driven by whoever
   * opened it; the wormhole's 32 loop seamlessly — flat brightness, last frame
   * identical to the first — so it simply turns, always.
   */
  gateFrame(planet: PlanetDef): number {
    if (planet.spriteFrames <= 1) return 0;
    if (planet.isWormhole) {
      return Math.floor(this.time * STELLAR_FPS) % planet.spriteFrames;
    }
    return this.gateAnim.get(planet.id)?.frame ?? 0;
  }

  /** Begin the opening sequence. The chooser waits until the ring is fully open. */
  private openGate(gate: PlanetDef): void {
    this.gateDocking = gate;
    const state = this.gateAnim.get(gate.id);
    // if it is already open, don't replay the sequence
    if (state?.phase === "open") {
      this.showGatePanel(gate);
      return;
    }
    this.gateAnim.set(gate.id, { phase: "opening", frame: state?.frame ?? 0 });
    playSnd(153, 0.35);
    this.message(`${gate.name} acknowledges. The ring is powering up...`);
  }

  /** Let the ring shut again — the pilot backed out, or has gone through. */
  private closeGate(gateId: string): void {
    const state = this.gateAnim.get(gateId);
    if (state) state.phase = "closing";
    if (this.gateDocking?.id === gateId) this.gateDocking = null;
  }

  private showGatePanel(gate: PlanetDef): void {
    this.mode = "landed";
    this.projectiles = [];
    this.targetNpc = null;
    this.landedUi.showGate(gate, this.system);
  }

  /** Run the gate rings forward, and hand over to the chooser once one is open. */
  private updateGates(dt: number): void {
    const step = STELLAR_FPS * dt;
    for (const [id, state] of [...this.gateAnim]) {
      const planet = this.system.planets.find((p) => p.id === id);
      const last = (planet?.spriteFrames ?? 1) - 1;
      if (state.phase === "opening") {
        state.frame = Math.min(last, state.frame + step);
        if (state.frame >= last) {
          state.phase = "open";
          // the ring is open: now show the pilot where it goes
          if (this.gateDocking?.id === id && this.mode === "flight") {
            this.showGatePanel(this.gateDocking);
          }
        }
      } else if (state.phase === "closing") {
        state.frame -= step;
        if (state.frame <= 0) this.gateAnim.delete(id);
      }
    }
    // fly away from a gate you were opening and it loses interest
    if (this.gateDocking && this.mode === "flight") {
      const d = Math.hypot(
        this.gateDocking.pos.x - this.ship.pos.x,
        this.gateDocking.pos.y - this.ship.pos.y,
      );
      if (d > this.gateDocking.radius * LAND_DIST + 260) {
        this.message(`${this.gateDocking.name} powers down.`);
        this.closeGate(this.gateDocking.id);
      }
    }
  }

  /** Travel through a gate to the far end. Costs no fuel — that's the point. */
  useGate(destSpobId: string): void {
    const entry = SPOBS.get(destSpobId);
    if (!entry) {
      this.message("The gate hums, then falls silent. Nothing happens.");
      return;
    }
    this.player.systemId = entry.systemId;
    this.markExplored(entry.systemId);
    this.advanceDays(1);
    this.player.landedOn = null;
    const dest = entry.planet;
    // emerge alongside the far gate, drifting clear of it
    const ang = Math.random() * Math.PI * 2;
    const r = dest.radius + 120;
    this.ship.pos = { x: dest.pos.x + Math.cos(ang) * r, y: dest.pos.y + Math.sin(ang) * r };
    this.ship.angle = ang;
    this.ship.vel = { x: Math.cos(ang) * 60, y: Math.sin(ang) * 60 };
    this.mode = "flight";
    this.landedUi.hide();
    this.npcs = [];
    this.dockedNpcs = [];
    this.projectiles = [];
    this.explosions = [];
    this.targetNpc = null;
    this.route = [];
    this.routeDest = null;
    // the gate you left is a system behind you; the one you came out of shuts
    this.gateAnim.clear();
    this.gateDocking = null;
    this.gateAnim.set(dest.id, {
      phase: "closing",
      frame: Math.max(0, (dest.spriteFrames || 1) - 1),
    });
    this.populateNpcs();
    this.spawnMissionShips();
    this.jumpFlash = 0.5;
    playSnd(153, 0.5);
    this.save();
    this.message(`You emerge from ${dest.name} in the ${getSystem(entry.systemId).name} system.`);
  }

  /** Save and return to the title menu. */
  exitToMenu(): void {
    this.save();
    this.landedUi.hide();
    this.hailUi.close();
    // a jump abandoned mid-charge must not go on spooling over the menu
    this.jump = null;
    stopSustained(JUMP_SND_KEY);
    this.mode = "menu";
    this.pilotId = null;
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
  get hasDensityScanner(): boolean {
    return this.gear.densityScanner;
  }
  get hasIff(): boolean {
    return this.gear.iff;
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
      { outfits: this.player.outfits, explored: this.player.explored, male: true },
      (cron, phase) => {
        if (phase === "start") this.message(`News: ${cron.name}.`);
      },
    );
    runOopses(
      this.player,
      { outfits: this.player.outfits, explored: this.player.explored, male: true },
      days,
    );
  }

  /** Note the current system as charted. */
  private markExplored(systemId = this.player.systemId): void {
    if (!this.player.explored.includes(systemId)) this.player.explored.push(systemId);
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
    this.mapReturn = this.mode === "map" ? this.mapReturn : this.mode;
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
      this.message(`Chart updated: ${gained} new system${gained === 1 ? "" : "s"}.`);
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
        if (sys.planets.some((p) => p.landable && !p.uninhabited)) this.markExplored(sys.id);
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

  save(): void {
    if (this.pilotId) savePilot(this.pilotId, this.player);
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
    this.player.fuelJumps = Math.min(this.player.fuelJumps, this.player.maxFuelJumps);
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
    this.inertialess = bonus.inertialDamper || (SHIPS[this.player.shipId]?.flags2 & 0x0040) !== 0;
    this.gear = {
      escapePod: bonus.escapePod,
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
    if (bonus.repairSystem) this.ship.armorRechPerSec = Math.max(this.ship.armorRechPerSec, 0.5);
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
      if (kind === "turret" && fitted.turrets >= limits.turrets) return "turret";
    }
    return null;
  }

  /** Fitted vs available mounts, for the outfitter's readout. */
  mountStatus(): { guns: number; turrets: number; maxGuns: number; maxTurrets: number } {
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
    return type.freeMass + hullOutfitMass(this.player.shipId)
      - outfitBonuses(this.player.outfits).mass;
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
    if (this.cargoUsed() > type.cargo) {
      return { ok: false, reason: "Your cargo will not fit in this ship's hold." };
    }
    this.player.credits -= price;
    grantHullOutfits(shipId, this.player.outfits);
    this.applyShipType(shipId);
    this.player.fuelJumps = type.fuelJumps; // delivered fully fueled
    const stock = stockAmmo(shipId);
    for (const [weapId, count] of Object.entries(stock)) {
      this.player.ammo[weapId] = ammoCapped(weapId, Math.max(this.player.ammo[weapId] ?? 0, count));
    }
    this.save();
    return { ok: true };
  }

  // ---------------- update ----------------

  update(dt: number): void {
    this.time += dt;
    // held weapon sounds are driven from here, not from the firing branch, so
    // that landing, jumping or dying with the trigger down still cuts them off
    this.updateFiringLoops();

    if (this.mode === "menu") {
      // living backdrop: traffic keeps drifting behind the title. Nobody comes
      // back from a landing here — the title screen is not a live system.
      for (const npc of this.npcs) {
        npc.updateAi(dt);
        if (npc.landing) npc.done = true;
      }
      this.npcs = this.npcs.filter((n) => !n.done);
      if (this.npcs.length < 2) this.spawnNpc();
      this.input.endFrame();
      return;
    }

    if (this.mode === "landed") {
      // a gate ring stays open behind the chooser while you pick a destination
      this.updateGates(dt);
      this.input.endFrame();
      return; // DOM UI handles everything
    }

    if (this.mode === "flight" && this.input.consume("Escape") && !this.jump) {
      // an open info panel takes Esc first, before it means "leave the game"
      if (this.infoUi.open) {
        this.infoUi.close();
        this.input.endFrame();
        return;
      }
      this.exitToMenu();
      this.input.endFrame();
      return;
    }

    if (this.input.consume("KeyM")) {
      if (this.mode === "map") this.closeMap();
      else this.openMap();
    }
    if (this.mode === "map" && this.input.consume("Escape")) {
      this.closeMap();
    }

    // flight controls (also run under the map, EV-style time keeps passing? No — pause under map)
    if (this.mode === "flight") {
      this.updateFlight(dt);
    }

    this.input.endFrame();
  }

  private updateFlight(dt: number): void {
    const sys = this.system;

    if (this.jump) {
      // autopilot: face the jump vector, then charge at full burn
      const facing = this.ship.steerToward(dt, this.jump.targetAngle);
      if (this.jump.phase === "turning" && facing) {
        this.jump.phase = "charging";
        this.message("Hyperdrive charging...");
      }
      this.ship.update(dt, 0, this.jump.phase === "charging");
      if (this.jump.phase === "charging") {
        this.jump.chargeLeft -= dt;
        if (this.jump.chargeLeft <= 0) this.executeJump();
      }
    } else {
      let turn = (this.input.isDown("ArrowLeft") ? -1 : 0) + (this.input.isDown("ArrowRight") ? 1 : 0);
      const thrust = this.input.isDown("ArrowUp");
      // Down swings the nose onto the reverse of your course, so a burn slows
      // you; inertialess hulls simply stop instead
      const braking = this.input.isDown("ArrowDown");
      // touching the controls takes the ship back off the autopilot
      if (this.autopilot && (turn !== 0 || thrust || braking)) {
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
      }
      // afterburner: hold Z to trade fuel for speed (100 units = 1 jump)
      this.afterburning =
        this.afterburnerBurn > 0 &&
        thrust &&
        this.input.isDown("KeyZ") &&
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
        this.player.fuelJumps = Math.max(0, this.player.fuelJumps - (this.afterburnerBurn / 100) * dt);
        const boost = 1.5;
        const base = this.ship.stats;
        this.ship.stats = {
          ...base,
          maxSpeed: base.maxSpeed * boost,
          accel: base.accel * boost,
        };
        this.ship.update(dt, turn as -1 | 0 | 1, thrust);
        this.ship.stats = base;
      } else {
        this.ship.update(dt, turn as -1 | 0 | 1, thrust);
      }
      }

      // EV Nova's own bindings, with the arrow keys flying the ship
      if (this.input.consume("KeyL")) this.selectOrLand();
      if (this.input.consume("KeyJ")) this.startJump();
      if (this.input.consume("Backquote") || this.input.consume("Tab")) this.cycleTarget();
      if (this.input.consume("KeyR")) this.targetClosest();
      if (this.input.consume("KeyY")) this.hailTarget();
      if (this.input.consume("KeyB")) this.tryBoard();
      if (this.input.consume("KeyU")) this.toggleCloak();
      // audio: - / = ride the master gain, 0 mutes
      if (this.input.consume("Minus")) this.nudgeVolume(-0.1);
      if (this.input.consume("Equal")) this.nudgeVolume(0.1);
      if (this.input.consume("Digit0")) {
        this.message(toggleMuted() ? "Sound muted." : "Sound unmuted.");
      }
      if (this.input.consume("KeyW")) this.cycleSecondary();
      if (this.input.consume("KeyC")) this.recallFighters();
      // escort orders
      if (this.input.consume("KeyE")) this.orderEscorts("attack");
      if (this.input.consume("KeyF")) this.orderEscorts("defend");
      if (this.input.consume("KeyV")) this.orderEscorts("hold");
      // navigation
      if (this.input.consume("KeyQ")) {
        if (this.input.shiftDown) this.selfDestruct();
        else this.toggleAutopilot();
      }
      if (this.input.consume("Backslash")) this.cycleJumpDestination();
      if (this.input.consume("KeyN")) this.navOff();
      if (this.input.consume("KeyX") && this.input.altDown) this.ejectFromShip();
      // information panels
      if (this.input.consume("KeyP")) this.openPlayerInfo();
      if (this.input.consume("KeyI")) this.openMissionInfo();
      if (this.input.consume("KeyK") && this.input.altDown) this.openJettison();
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
        ? this.input.isDown("Space") && !this.ship.ionized
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
    if (this.fuelScoopRate > 0 && this.player.fuelJumps < this.player.maxFuelJumps) {
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
        if (this.npcs.length < sys.traffic - 1 && Math.random() < 0.15) this.spawnFleet();
        else this.spawnNpc();
      }
    }
    for (const npc of this.npcs) {
      npc.rechargeShields(dt);
      if (npc.escorting && !npc.disabled && !npc.hostile) {
        // the ship you're escorting flies with you
        this.updateEscorteeAi(npc, dt);
      } else if (npc.ionized && !npc.disabled) {
        // ionized: barely under control
        npc.pos.x += npc.vel.x * dt * 0.3;
        npc.pos.y += npc.vel.y * dt * 0.3;
      } else if (npc.disabled) {
        // dead in space: drifting, no thrust, no guns
        npc.thrusting = false;
        npc.pos.x += npc.vel.x * dt;
        npc.pos.y += npc.vel.y * dt;
        npc.vel.x *= 1 - 0.15 * dt;
        npc.vel.y *= 1 - 0.15 * dt;
        npc.angle += 0.25 * dt;
      } else if (npc.ally) this.updateAllyAi(npc, dt);
      else if (npc.hostile) this.updateHostileAi(npc, dt);
      else if (npc.aiType === 3 || npc.aiType === 4) this.updateWarshipAi(npc, dt);
      else npc.updateAi(dt);
      if (npc.landing) this.dockNpc(npc);
    }
    this.updateDockedNpcs(dt);
    this.npcs = this.npcs.filter((n) => !n.done);
    if (this.targetNpc && (this.targetNpc.done || !this.npcs.includes(this.targetNpc))) {
      this.targetNpc = null;
    }

    this.updateAsteroids(dt);
    this.updateMissionWatch(dt);
    this.updateProjectiles(dt);
    this.updatePointDefense(dt);
    this.updateBeams(dt);
    for (const fx of this.explosions) fx.t += dt;
    this.explosions = this.explosions.filter((fx) => {
      const sheet = BOOM_SPRITES[fx.boomId];
      return sheet ? fx.t * fx.fps < sheet.frames : fx.t < 0.5;
    });
  }

  // ---------------- combat ----------------

  /** Cloaked ships hide from targeting unless your scanner can see them. */
  private canSee(npc: NpcShip): boolean {
    if (!npc.cloaked) return true;
    return (this.gear.cloakScanner & 0x000f) !== 0;
  }

  private cycleTarget(): void {
    const visible = this.npcs.filter((n) => this.canSee(n));
    if (visible.length === 0) {
      this.targetNpc = null;
      this.message("No contacts on sensors.");
      return;
    }
    const idx = this.targetNpc ? visible.indexOf(this.targetNpc) : -1;
    this.targetNpc = visible[(idx + 1) % visible.length];
    this.targetPlanet = null;
  }

  govtLabel(govtId: number): string {
    return govtId >= 128 ? (GOVT_NAMES[String(govtId)] ?? "Unaffiliated") : "Independent";
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
    if (this.cloaked && (this.cloakFlags & CLOAK_DROPS_SHIELDS) !== 0) this.ship.shield = 0;
    playSnd(this.cloaked ? SND.CLOAK_ON : SND.CLOAK_OFF, 0.4);
    this.message(this.cloaked ? "Cloaking device engaged." : "Cloaking device disengaged.");
  }

  /** Cloaks burn fuel and/or shields, and collapse when the tank runs dry. */
  private updateCloak(dt: number): void {
    if (!this.cloaked) return;
    const fuelDrain = cloakFuelDrain(this.cloakFlags);
    const shieldDrain = cloakShieldDrain(this.cloakFlags);
    if (fuelDrain > 0) {
      this.player.fuelJumps = Math.max(0, this.player.fuelJumps - (fuelDrain / 100) * dt);
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
  private defenceFleetSize(planet: PlanetDef): { total: number; perWave: number } {
    const raw = planet.defCount;
    if (raw <= 0) return { total: 0, perWave: 0 };
    if (raw <= 1000) return { total: raw, perWave: Math.min(raw, 4) };
    const perWave = raw % 10;
    const total = Math.floor(raw / 10) - 100;
    return { total: Math.max(0, total), perWave: Math.max(1, perWave) };
  }

  /** Provoke a world's defenders, or claim it once they're gone. */
  private tryDominate(planet: PlanetDef): void {
    const dist = Math.hypot(planet.pos.x - this.ship.pos.x, planet.pos.y - this.ship.pos.y);
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
      this.player.dominated = this.player.dominated.filter((id) => id !== planet.id);
      applySet(planet.onRelease, this.player.bits, this.bitHandlers());
      this.message(`You release ${planet.name} from tribute.`);
      this.save();
      return;
    }

    const fleet = this.defenceFleetSize(planet);
    const remaining = this.domination.get(planet.id) ?? fleet.total;
    if (fleet.total === 0) {
      this.completeDomination(planet);
      return;
    }
    const alive = this.npcs.filter((n) => n.defenderOf === planet.id && !n.done).length;
    if (remaining <= 0) {
      this.completeDomination(planet);
      return;
    }
    if (alive > 0) {
      this.message(`${planet.name}'s defenders are still up: ${remaining} left.`);
      return;
    }
    this.launchDefenders(planet, fleet.perWave, remaining);
  }

  private launchDefenders(planet: PlanetDef, perWave: number, remaining: number): void {
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
      const npc = new NpcShip({ turnRate: type.turnRate, accel: type.accel, maxSpeed: type.maxSpeed });
      npc.typeId = typeId;
      npc.govtId = dude.govt >= 128 ? dude.govt : inherentCombatGovt(typeId);
      npc.hostile = true;
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
    this.message(`${planet.name} launches its defence fleet — ${remaining} ships remain.`);
  }

  private completeDomination(planet: PlanetDef): void {
    this.player.dominated.push(planet.id);
    this.domination.delete(planet.id);
    applySet(planet.onDominate, this.player.bits, this.bitHandlers());
    const daily = planet.tribute > 0 ? planet.tribute : planet.techLevel * 1000;
    this.message(`${planet.name} submits. Tribute: ${daily.toLocaleString()} cr per day.`);
    playSnd(152, 0.5);
    this.save();
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
    const govtId = landingGovtId(planet, systemGovtId);
    if (govtId >= 128 && this.rankFlag(govtId, 0x0200)) return true;
    return landingAllowed(planet, getRecord(this.player, govtId));
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
        if ((rank.flags & 0x0010) !== 0 && other.weight > rank.weight) return true;
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
    const days = Math.floor(this.player.date) - Math.floor(this.player.salaryDay);
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
    const days = Math.floor(this.player.date) - Math.floor(this.player.tributeDay);
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
      this.message("No target selected. Press Tab to select a ship.");
      return;
    }
    if (!t.disabled) {
      this.message(`${this.shipLabel(t)} is not disabled — you cannot board it.`);
      return;
    }
    const dist = Math.hypot(t.pos.x - this.ship.pos.x, t.pos.y - this.ship.pos.y);
    if (dist > t.radius + this.ship.radius + 60) {
      this.message("Too far away to board. Get closer.");
      return;
    }
    const rel = Math.hypot(t.vel.x - this.ship.vel.x, t.vel.y - this.ship.vel.y);
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
      const carried = (t.typeId ? SHIPS[t.typeId]?.stockWeapons : undefined) ?? [];
      if (carried.some((w) => String(w.id) === slot.weap.id)) {
        hold.ammo[slot.weap.id] = 2 + Math.floor(Math.random() * 6);
      }
    }

    const crew = Math.max(1, (t.typeId ? SHIPS[t.typeId]?.crew : 0) || 10);
    // Without a marine platoon you can still rush them with your own crew, but
    // spacers are not soldiers: they count for a quarter of what marines do,
    // and a hull with no crew of its own musters a token party of two.
    const myCrew = Math.max(2, SHIPS[this.player.shipId]?.crew ?? 0);
    const boarders = this.gear.marines > 0 ? this.gear.marines : myCrew * 0.25;
    const withMarines = this.gear.marines > 0;
    const odds = t.typeId && !t.ally ? boarders / (boarders + crew) : null;

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
      const pool = Object.values(OUTFITS).filter((o) => o.itemClass === person.grantClass);
      if (!pool.length) return null;
      const pick = pool[Math.floor(Math.random() * pool.length)];
      const max = Math.max(1, person.grantCount);
      const qty = Math.max(1, Math.floor(max / 2 + Math.random() * (max / 2 + 1)));
      this.player.outfits[pick.id] = (this.player.outfits[pick.id] ?? 0) + qty;
      this.recomputeLoadout();
      return qty > 1 ? `${qty} x ${pick.name.split(";")[0]}` : pick.name.split(";")[0];
    };

    const strip = () => {
      t.boarded = true;
      const granted = grantLoot();
      if (granted) this.message(`They hand over ${granted}.`);
      // piracy is a crime, and the victim's government notices
      if (t.govtId >= 128) applyCrime(this.player, t.govtId, "kill");
      this.save();
    };

    this.plunderUi.show({
      shipName: this.shipLabel(t),
      hold,
      captureOdds: odds,
      freeCargo: this.player.cargoCap - this.cargoUsed(),
      take: (what) => {
        if (what === "credits") {
          this.player.credits += hold.credits;
          const note = `Took ${hold.credits.toLocaleString()} credits.`;
          hold.credits = 0;
          strip();
          return note;
        }
        if (what === "energy") {
          this.player.fuelJumps = this.player.maxFuelJumps;
          hold.energy = 0;
          strip();
          return "You filled your reactors with energy from this ship.";
        }
        if (what === "ammo") {
          const taken: string[] = [];
          for (const [wid, rounds] of Object.entries(hold.ammo)) {
            this.player.ammo[wid] = ammoCapped(wid, (this.player.ammo[wid] ?? 0) + rounds);
            taken.push(`${rounds} ${WEAPONS[wid]?.name.split(";")[0] ?? "rounds"}`);
            delete hold.ammo[wid];
          }
          strip();
          return taken.length ? `Took ${taken.join(", ")}.` : "Nothing to take.";
        }
        // cargo: fill what space you have, heaviest hold first
        let space = this.player.cargoCap - this.cargoUsed();
        const taken: string[] = [];
        for (const [id, tons] of Object.entries(hold.cargo)) {
          if (space <= 0) break;
          const n = Math.min(space, tons);
          this.player.cargo[id] = (this.player.cargo[id] ?? 0) + n;
          space -= n;
          if (n >= tons) delete hold.cargo[id];
          else hold.cargo[id] = tons - n;
          taken.push(`${n}t ${COMMODITIES.find((c) => c.id === id)?.name ?? id}`);
        }
        strip();
        return taken.length ? `Took ${taken.join(", ")}.` : "No room in your hold.";
      },
      capture: (): CaptureResult => {
        if (odds === null || !t.typeId) return { taken: false, note: "" };
        if (Math.random() < odds) {
          const captured = t.typeId;
          t.done = true;
          if (this.targetNpc === t) this.targetNpc = null;
          this.pendingPrize = captured;
          this.message(
            withMarines
              ? `Your marines take the ${this.hullName(captured)}!`
              : `Your crew storms the ${this.hullName(captured)} and takes her!`,
          );
          this.save();
          return {
            taken: true,
            prize: this.hullName(captured),
            yourShip: this.hullName(this.player.shipId),
            roomInWing: this.player.escorts.length < MAX_ESCORTS,
          };
        }
        let note: string;
        if (withMarines) {
          // a failed assault costs you the boarding party
          const lost = Math.ceil(this.gear.marines / 2);
          note = `The assault is thrown back — you lose ${lost} marines.`;
          for (const [outfId, owned] of Object.entries(this.player.outfits)) {
            const outf = OUTFITS[outfId];
            if (outf?.mods.some((m) => m.type === 25) && owned > 0) {
              this.player.outfits[outfId] = owned - 1;
              if (this.player.outfits[outfId] === 0) delete this.player.outfits[outfId];
              break;
            }
          }
          this.recomputeLoadout();
        } else {
          // no platoon to lose: the crew is beaten back bloodied instead
          this.ship.armor = Math.max(1, this.ship.armor - this.ship.maxArmor * 0.15);
          note = "Your crew is thrown back off the boarding tube, bloodied.";
        }
        this.message(note);
        this.save();
        return { taken: false, note };
      },
      claim: (choice) => this.claimPrize(choice),
      close: () => {
        this.claimPrize("escort"); // walking away still leaves the prize taken
        this.save();
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
      if (keepOld) this.player.escorts.push({ shipId: old, wage: 0, captured: true });
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
      this.message(`Your command is full — the ${this.hullName(prize)} is cut loose.`);
      this.pendingPrize = null;
      this.save();
      return;
    }
    // shïp OnCapture: 171 hulls set a bit when taken
    const onCapture = SHIPS[prize]?.onCapture;
    if (onCapture) applySet(onCapture, this.player.bits, this.bitHandlers());
    this.save();
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
      x: this.ship.pos.x + Math.cos(this.ship.angle + (Math.PI / 2) * side) * off,
      y: this.ship.pos.y + Math.sin(this.ship.angle + (Math.PI / 2) * side) * off,
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
    if (t.phase === "leaving") return { text: "Outbound", tone: "plain" };
    return { text: "Neutral", tone: "plain" };
  }

  private shipLabel(t: NpcShip): string {
    if (t.personId !== null) {
      const p = PERSONS[String(t.personId)];
      if (p) return p.name;
    }
    return t.typeId ? (SHIPS[t.typeId]?.name.split(";")[0] ?? "The ship") : "The ship";
  }

  /** Missions whose goal was to disable/board/rescue these ships. */
  private creditBoardGoal(t: NpcShip): void {
    if (t.missionMisnId === null) return;
    const active = this.player.activeMissions.find((a) => a.misnId === t.missionMisnId);
    const m = MISSIONS[String(t.missionMisnId)];
    if (!active || !m || active.shipsDone) return;
    if (m.shipGoal !== 2 && m.shipGoal !== 5) return; // board / rescue
    active.shipsKilled += 1;
    if (active.shipsKilled >= active.shipsTotal) {
      active.shipsDone = true;
      applySet(m.onShipDone, this.player.bits, this.bitHandlers());
      this.message(`Objective complete: ${active.name}.`);
      const doneText = descText(m.shipDoneText);
      if (doneText) {
        this.pendingMissionEvents.push({
          title: active.name,
          text: substituteTags(doneText, m, active, this.pilotName, this.rankTags()),
        });
      }
    }
    this.save();
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
      this.message("No target selected. Press Tab for ships, L for worlds.");
      return;
    }
    const dist = Math.hypot(t.pos.x - this.ship.pos.x, t.pos.y - this.ship.pos.y);
    if (dist > 2400) {
      this.message("Target out of communications range.");
      return;
    }
    playSnd(151, 0.4);
    this.hailUi.show(t, this.hailGreeting(t));
  }

  /** Call a world's traffic control. */
  private hailPlanet(p: PlanetDef): void {
    const govtId = SPOB_GOVT.get(p.id) ?? -1;
    const record = getRecord(this.player, govtId);
    const govt = this.govtLabel(govtId);
    playSnd(151, 0.4);

    if (p.uninhabited || !p.landable) {
      this.hailUi.showPlanet(p, `Static. There is nobody on ${p.name} to answer.`, []);
      return;
    }
    const greeting =
      record < -20
        ? `"${p.name} traffic control. Your record here is a disgrace, Captain. Keep your distance."`
        : record > 20
          ? `"${p.name} control. Always a pleasure — the pads are clear whenever you want them."`
          : `"${p.name} traffic control, go ahead."`;

    const opts: { label: string; action: () => string | void }[] = [
      {
        label: "Request landing clearance",
        action: () => {
          const dist = Math.hypot(p.pos.x - this.ship.pos.x, p.pos.y - this.ship.pos.y);
          if (dist > p.radius * LAND_DIST + 60) return `"You're not close enough to dock. Come on in."`;
          this.hailUi.close();
          this.tryLand(p);
          return;
        },
      },
      {
        label: "Ask about the world",
        action: () => {
          const trades = Object.keys(p.prices).length;
          const bits: string[] = [];
          if (p.shipyard) bits.push("a shipyard");
          if (p.outfitter) bits.push("an outfitter");
          if (p.bar) bits.push("a bar");
          if (trades > 0) bits.push(`${trades} commodities on the exchange`);
          return bits.length
            ? `"${p.name} is ${govt} space, tech level ${p.techLevel}. We've got ${bits.join(", ")}."`
            : `"Not much here, Captain. ${govt} space, tech level ${p.techLevel}."`;
        },
      },
    ];
    if (!p.uninhabited && p.landable) {
      const held = this.player.dominated.includes(p.id);
      opts.push({
        label: held ? "Release from tribute" : "Demand tribute",
        action: () => {
          this.hailUi.close();
          this.tryDominate(p);
        },
      });
    }
    if (record < 0) {
      const bribe = Math.min(this.player.credits, 5000);
      opts.push({
        label: `Bribe traffic control (${bribe.toLocaleString()} cr)`,
        action: () => {
          if (this.player.credits < bribe || bribe <= 0) return `"Don't waste our time."`;
          this.player.credits -= bribe;
          const key = String(govtId);
          this.player.records[key] = (this.player.records[key] ?? 0) + 10;
          this.save();
          return `"...The paperwork does seem to have a few errors. Welcome to ${p.name}."`;
        },
      });
    }
    this.hailUi.showPlanet(p, greeting, opts);
  }

  private hailGreeting(t: NpcShip): string {
    if (t.personId !== null) {
      const person = PERSONS[String(t.personId)];
      // CommQuote/HailQuote index their STR# from 1, so the array index is one
      // lower. Reading them straight gave every captain the next one's line —
      // Zero Wing answered with the greeting that follows "All your base are
      // belong to us" instead of the line itself. The lists confirm it: the
      // highest CommQuote in the data is 44 and STR# 7100 holds exactly 44.
      const quote = person ? STR_LISTS["7100"]?.[person.commQuote - 1] : undefined;
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
    return `"This is the ${govt} vessel ${SHIPS[t.typeId ?? ""]?.name.split(";")[0] ?? "underway"}. Go ahead."`;
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
    const pick = <T,>(a: T[]): T | null => (a.length ? a[Math.floor(Math.random() * a.length)] : null);

    if ((info & 0x1000) !== 0) {
      // a world they have been to lately, and what was cheap or dear there
      const worlds = this.system.planets.filter((p) => p.exchange && Object.keys(p.prices).length);
      const world = pick(worlds);
      if (world) {
        const entries = Object.entries(world.prices).filter(([, lvl]) => lvl !== "med");
        const entry = pick(entries);
        if (entry) {
          const [id, level] = entry;
          const name = COMMODITIES.find((c) => c.id === id)?.name.toLowerCase() ?? id;
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
        if (type) return `"Word is there's trouble out at ${type.name}. Steer clear if you can."`;
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

  /**
   * The comms panel's options, as Nova defines them: Greetings, Request
   * Assistance, Offer Bribe and Beg For Mercy, with Close Channel added by the
   * panel itself. Two gövt Flags2 bits decide which of them a government will
   * entertain — 0x0001 makes it untalkative and kills assistance and mercy,
   * 0x0008 stops it answering greetings at all. That pair is set on the Wraith
   * and the Krypt, which is why neither ever replies.
   */
  hailOptions(t: NpcShip): { label: string; action: () => string | void }[] {
    const opts: { label: string; action: () => string | void }[] = [];
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
      const bribe = Math.min(this.player.credits, 2000 + Math.floor(this.player.credits * 0.1));
      if (bribe > 0) {
        opts.push({
          label: this.btnLabel(23, "Offer Bribe"),
          action: () => {
            if (this.player.credits < bribe) return `"Your account's as empty as your threats."`;
            this.player.credits -= bribe;
            t.hostile = false;
            t.phase = "leaving";
            const ang = Math.random() * Math.PI * 2;
            t.target = { x: Math.cos(ang) * 2400, y: Math.sin(ang) * 2400 };
            this.save();
            return `"${bribe.toLocaleString()} credits. Pleasure doing business — we were never here."`;
          },
        });
      }
      if (!untalkative) {
        opts.push({
          label: this.btnLabel(24, "Beg For Mercy"),
          action: () => {
            // the badly damaged and the barely-provoked can be talked down
            const merciful = t.armor < t.maxArmor * 0.4 || record > -10;
            if (merciful) {
              t.hostile = false;
              t.phase = "leaving";
              const ang = Math.random() * Math.PI * 2;
              t.target = { x: Math.cos(ang) * 2400, y: Math.sin(ang) * 2400 };
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
      opts.push({ label: this.btnLabel(21, "Greetings"), action: () => this.greetingInfo(t) });
    }
    if (!untalkative) {
      opts.push({
        label: this.btnLabel(22, "Request Assistance"),
        action: () => {
          if (!roadsideAssistance && record < -10) {
            return `"We don't help ships with your reputation. Good luck out there."`;
          }
          const needFuel = this.player.fuelJumps < this.player.maxFuelJumps;
          const hurt = this.ship.armor < this.ship.maxArmor;
          if (!needFuel && !hurt) return `"You look in good shape to us, Captain. Safe flying."`;
          if (needFuel) {
            this.player.fuelJumps = Math.min(this.player.maxFuelJumps, this.player.fuelJumps + 1);
          }
          // 0x0010 is Nova's "Roadside Assistance" — these govts patch you up too
          if (hurt && roadsideAssistance) this.ship.armor = this.ship.maxArmor;
          this.save();
          return roadsideAssistance && hurt
            ? `"Hold position — transferring fuel and sealing that hull for you."`
            : `"Transferring a jump's worth of fuel now. Safe travels, Captain."`;
        },
      });
    }
    return opts;
  }

  /**
   * Beams and chainguns carry wëap flag 0x0010: their sound is held for as
   * long as you hold the trigger, not restarted on every tick of the reload.
   * Keyed per weapon so a ship mounting two of them hums once, not twice.
   */
  private updateFiringLoops(): void {
    const firing =
      this.mode === "flight" &&
      this.jump === null &&
      this.input.isDown("Space") &&
      !this.ship.ionized;
    for (const slot of this.weaponSlots) {
      if (!slot.weap.sndLoop || !slot.weap.sndId || !isPrimary(slot.weap)) continue;
      const key = `weap:${slot.weap.id}`;
      if (firing) startSustained(key, slot.weap.sndId, true, 0.35);
      else stopSustained(key);
    }
  }

  private updateWeapons(dt: number): void {
    for (const slot of this.weaponSlots) {
      slot.cooldown = Math.max(0, slot.cooldown - dt);
    }
    if (this.input.isDown("Space") && !this.ship.ionized) {
      for (const slot of this.weaponSlots) {
        if (!isPrimary(slot.weap) || slot.cooldown > 0) continue;
        applyReload(slot);
        // looped weapons are held by updateFiringLoops instead
        if (slot.weap.sndId && !slot.weap.sndLoop) playSnd(slot.weap.sndId, 0.35);
        // turrets swivel onto the selected target; everything else fires ahead
        const aim =
          isTurret(slot.weap) && this.targetNpc
            ? Math.atan2(
                this.targetNpc.pos.y - this.ship.pos.y,
                this.targetNpc.pos.x - this.ship.pos.x,
              )
            : undefined;
        if (isBeam(slot.weap)) {
          this.fireBeam(this.ship, slot.weap, slot.count, true, aim);
        } else {
          this.projectiles.push(
            ...fireWeapon(this.ship, slot.weap, slot.count, true, this.targetNpc, aim),
          );
        }
      }
    }
    // Left Control fires whichever secondary is selected — missiles launch,
    // fighter bays scramble, exactly as EV treats bays as secondary weapons
    if (this.input.consume("ControlLeft") || this.input.consume("ControlRight")) {
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
          if (ammoLeft <= 0) this.message(`No ammunition for ${slot.weap.name}.`);
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
            const spends =
              !(slot.weap.flags3 & W3_AMMO_AT_BURST_END) || slot.burstLeft <= 0;
            if (spends) this.player.ammo[slot.weap.id] = ammoLeft - 1;
            this.projectiles.push(...fireWeapon(this.ship, slot.weap, 1, true, this.targetNpc));
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
    return this.weaponSlots.filter((s) => isSecondary(s.weap) || isFighterBay(s.weap));
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
    this.message(`Secondary: ${list[this.secondaryIdx].weap.name.split(";")[0]}.`);
  }

  /** Call every launched fighter home. */
  private recallFighters(): void {
    const out = this.npcs.filter((n) => n.ally);
    if (out.length === 0) {
      this.message("No fighters to recall.");
      return;
    }
    for (const f of out) f.recalling = true;
    this.message(`Recalling ${out.length} fighter${out.length === 1 ? "" : "s"}.`);
  }

  /** Target the nearest ship (EV's "closest target" key). */
  private targetClosest(): void {
    let best: NpcShip | null = null;
    let bestD = Infinity;
    for (const n of this.npcs) {
      if (!this.canSee(n)) continue;
      const d = Math.hypot(n.pos.x - this.ship.pos.x, n.pos.y - this.ship.pos.y);
      if (d < bestD) {
        bestD = d;
        best = n;
      }
    }
    if (!best) {
      this.message("No contacts on sensors.");
      return;
    }
    this.targetNpc = best;
    this.targetPlanet = null;
  }

  /** A recalled fighter flies home and stows itself in its bay. */
  private dockFighter(f: NpcShip): void {
    f.done = true;
    if (this.targetNpc === f) this.targetNpc = null;
    if (f.bayWeapId) {
      this.player.ammo[f.bayWeapId] = (this.player.ammo[f.bayWeapId] ?? 0) + 1;
    }
    playSnd(150, 0.3);
    this.save();
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
      const ox = owner.pos.x + (exit.x || exit.y ? exit.x : Math.cos(angle) * owner.radius);
      const oy = owner.pos.y + (exit.x || exit.y ? exit.y : Math.sin(angle) * owner.radius);
      b.x1 = ox;
      b.y1 = oy;
      b.x2 = ox + Math.cos(angle) * reach;
      b.y2 = oy + Math.sin(angle) * reach;
    }
    this.beams = this.beams.filter((b) => b.ttl > 0);
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
    const targets: Ship[] = fromPlayer
      ? this.npcs.filter((n) => !n.ally)
      : [this.ship, ...this.npcs.filter((n) => n.ally)];
    // Beams leave from the hull's BeamPos mounts, same as shots leave the guns
    const exit = weaponExitPoint(shooter.sprite, weap.exitType, 0, shooter.angle);
    const ox =
      shooter.pos.x + (exit.x || exit.y ? exit.x : Math.cos(angle) * shooter.radius);
    const oy =
      shooter.pos.y + (exit.x || exit.y ? exit.y : Math.sin(angle) * shooter.radius);
    const hit = beamHit(ox, oy, angle, length, targets.filter((s) => s !== shooter));
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
        x1: ox, y1: oy,
        x2: ox + Math.cos(angle) * rockHit.dist,
        y2: oy + Math.sin(angle) * rockHit.dist,
        weap, ttl: Math.max(0.06, weap.durationSec),
        owner: shooter, exitType: weap.exitType, relAngle: angle - shooter.angle,
        target: null, reach: rockHit.dist,
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
    // multiple emitters of the same beam stack their damage
    const shots = Math.max(1, Math.min(count, 4));
    hit.ship.takeHit(weap.shieldDmg * shots, weap.armorDmg * shots);
    if (fromPlayer) {
      const npc = hit.ship as NpcShip;
      if (this.npcs.includes(npc)) {
        if (!npc.hostile) this.provoke(npc);
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
      if (victim.destroyed && this.npcs.includes(victim)) this.destroyNpc(victim, victim.ally);
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
      x: this.ship.pos.x + Math.cos(this.ship.angle + (Math.PI / 2) * side) * off,
      y: this.ship.pos.y + Math.sin(this.ship.angle + (Math.PI / 2) * side) * off,
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
        x: this.ship.pos.x + Math.cos(this.ship.angle + (Math.PI / 2) * side) * off,
        y: this.ship.pos.y + Math.sin(this.ship.angle + (Math.PI / 2) * side) * off,
      };
      npc.angle = this.ship.angle;
      npc.vel = { ...this.ship.vel };
      this.npcs.push(npc);
    }
  }

  /** Hired crews draw their wages as the days pass; broke pilots lose them. */
  private payEscorts(): void {
    if (this.player.escorts.length === 0) return;
    const days = Math.floor(this.player.date) - Math.floor(this.player.escortPayDay);
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
    this.message("You could not make payroll. Your escorts have left your service.");
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
    this.save();
    return { ok: true };
  }

  /** Release an escort from service. */
  dismissEscort(index: number): void {
    const hire = this.player.escorts[index];
    if (!hire) return;
    this.player.escorts.splice(index, 1);
    const npc = this.npcs.find((n) => n.hired && n.typeId === hire.shipId);
    if (npc) npc.done = true;
    // a prize is property, not a contract: paying her off puts cash in hand
    if (hire.captured) {
      const paid = escortSellValue(hire.shipId);
      this.player.credits += paid;
      this.message(`You sell the ${this.hullName(hire.shipId)} for ${paid.toLocaleString()} cr.`);
    }
    this.save();
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
    const voiceType = npc.govtId >= 128 ? (GOVT_VOICES[String(npc.govtId)] ?? 0) : 0;
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
    const anchor = npc.order === "hold" && npc.holdAt ? npc.holdAt : this.ship.pos;
    const reach = npc.order === "hold" ? 700 : 1400;
    let prey: Ship | null = null;
    let best = reach;
    for (const other of this.npcs) {
      if (!other.hostile || other === npc) continue;
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
  private stationKeep(npc: NpcShip, dt: number, anchor: Vec2, slack: number): void {
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
      const range = isBeam(slot.weap) ? Math.max(120, slot.weap.beamLength) : 400;
      // incoming missiles first — that is what point defense is for
      const incoming = this.projectiles.find(
        (p) =>
          !p.fromPlayer &&
          p.weap.guidance === 1 &&
          Math.hypot(p.x - this.ship.pos.x, p.y - this.ship.pos.y) < range,
      );
      if (!incoming) continue;
      applyReload(slot);
      const angle = Math.atan2(incoming.y - this.ship.pos.y, incoming.x - this.ship.pos.x);
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
          reach: Math.hypot(incoming.x - this.ship.pos.x, incoming.y - this.ship.pos.y),
        });
      } else {
        this.projectiles.push(
          ...fireWeapon(this.ship, slot.weap, 1, true, null, angle),
        );
      }
      this.spawnExplosion(incoming.x, incoming.y, 0.5, incoming.weap.explodBoom ?? 128);
    }
  }

  private updateHostileAi(npc: NpcShip, dt: number): void {
    if (this.cloaked) {
      // they've lost you: carry on about their business
      npc.updateAi(dt);
      return;
    }
    this.attackAi(npc, dt, this.ship);
  }

  /** System-govt warships hunt hostiles; otherwise they go about their business. */
  private updateWarshipAi(npc: NpcShip, dt: number): void {
    let prey: Ship | null = null;
    let best = 1600;
    for (const other of this.npcs) {
      if (!other.hostile || other === npc) continue;
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
    if ((target as NpcShip).disabled) {
      npc.updateAi(dt);
      return;
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
    const desired = fleeing ? Math.atan2(-dy, -dx) : Math.atan2(dy, dx);
    const facing = npc.steerToward(dt, desired);
    const thrust = fleeing ? facing : facing && dist > 180;
    npc.update(dt, 0, thrust);
    if (fleeing && dist > 2400) npc.done = true; // escaped

    npc.fireCooldown = Math.max(0, npc.fireCooldown - dt);
    /*
     * Aggress is "how close ships have to be before the person will attack
     * them, on a scale of 1 (close) to 3 (far)"; everything else keeps the
     * engine's standing 700px engagement range.
     */
    const reach = person && person.aggress > 0 ? 350 + person.aggress * 350 : 700;
    if (!fleeing && npc.typeId && npc.fireCooldown <= 0 && dist < reach) {
      let diff = desired - npc.angle;
      while (diff > Math.PI) diff -= Math.PI * 2;
      while (diff < -Math.PI) diff += Math.PI * 2;
      if (Math.abs(diff) < 0.2) {
        const type = SHIPS[npc.typeId];
        // a named captain flies their own loadout, not the hull's stock one
        const armament = npc.weapons ?? type?.stockWeapons;
        const stock = armament?.find((sw) => {
          const w = WEAPONS[String(sw.id)];
          return w && isPrimary(w);
        });
        const weap = stock ? WEAPONS[String(stock.id)] : null;
        if (weap && stock) {
          npc.fireCooldown = weap.reloadSec;
          if (weap.sndId) {
            playSndAt(weap.sndId, 0.35, npc.pos.x - this.ship.pos.x, npc.pos.y - this.ship.pos.y);
          }
          if (isBeam(weap)) {
            const aim = Math.atan2(target.pos.y - npc.pos.y, target.pos.x - npc.pos.x);
            this.fireBeamFromNpc(npc, weap, stock.count, target, aim);
          } else {
            this.projectiles.push(...fireWeapon(npc, weap, stock.count, false, target));
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
        if (pathHitsCircle(x0, y0, p.x, p.y, a.x, a.y, this.asteroidRadius(a))) {
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
        Math.random() < interferenceBreaksLock(p.weap, this.system.interference) * dt
      ) {
        // the system's own static does the jammers' work for them
        p.target = null;
      }
      for (const npc of this.npcs) {
        if ((npc as Ship) === p.owner) continue;
        // your own shots pass through your fighters, and theirs through you
        if (p.fromPlayer && npc.ally) continue;
        if (!p.fromPlayer && !npc.ally && !(p.owner as NpcShip).ally) continue;
        // ProxSafety keeps a just-launched shot from detonating on its own ship
        const r = npc.radius + (p.armTime > 0 ? 4 : Math.max(4, p.weap.proxRadius));
        if (pathHitsCircle(x0, y0, p.x, p.y, npc.pos.x, npc.pos.y, r)) {
          npc.takeHit(p.weap.shieldDmg, p.weap.armorDmg);
          if (p.weap.ionization > 0) {
            npc.ion = Math.min(npc.maxIon, npc.ion + p.weap.ionization);
          }
          p.ttl = 0;
          p.directHit = npc;
          this.detonated.push(p);
          if (p.weap.explodBoom !== null) {
            this.spawnExplosion(p.x, p.y, 1, p.weap.explodBoom);
          }
          if (p.fromPlayer && !npc.hostile) this.provoke(npc);
          if (npc.destroyed) {
            const owner = p.fromPlayer ? null : (p.owner as NpcShip);
            this.destroyNpc(npc, p.fromPlayer || !!owner?.ally, owner?.ally ? owner : null);
          }
          break;
        }
      }
      if (p.ttl > 0 && !p.fromPlayer && !(p.owner as NpcShip).ally) {
        const r = this.ship.radius + (p.armTime > 0 ? 4 : Math.max(4, p.weap.proxRadius));
        if (pathHitsCircle(x0, y0, p.x, p.y, this.ship.pos.x, this.ship.pos.y, r)) {
          this.ship.takeHit(p.weap.shieldDmg, p.weap.armorDmg);
          if (p.weap.ionization > 0) {
            this.ship.ion = Math.min(this.ship.maxIon, this.ship.ion + p.weap.ionization);
            if (this.ship.ionized) this.message("Your systems are ionized!");
          }
          p.ttl = 0;
          p.directHit = this.ship;
          this.detonated.push(p);
          if (p.weap.explodBoom !== null) {
            this.spawnExplosion(p.x, p.y, 1, p.weap.explodBoom);
          }
          if (this.cloaked && (this.cloakFlags & CLOAK_BREAKS_ON_DAMAGE) !== 0) {
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
        if (p.weap.ionization > 0) s.ion = Math.min(s.maxIon, s.ion + p.weap.ionization);
      };
      for (const npc of this.npcs) {
        if ((npc as Ship) === p.owner) continue;
        const before = npc.armor + npc.shield;
        hurt(npc);
        // a blast that catches a bystander provokes them the same as a direct hit
        if (p.fromPlayer && npc.armor + npc.shield < before) this.provoke(npc);
        if (npc.destroyed) {
          const owner = p.fromPlayer ? null : (p.owner as NpcShip);
          this.destroyNpc(npc, p.fromPlayer || !!owner?.ally, owner?.ally ? owner : null);
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
        if (p.weap.explodBoom !== null) this.spawnExplosion(p.x, p.y, 1, p.weap.explodBoom);
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
  private provoke(npc: NpcShip): void {
    if (npc.ally || npc.hostile) return; // your own escorts, and anyone already fighting
    /*
     * gövt ShootPenalty, "the amount of evilness a player gains for shooting a
     * ship of this govt" — charged once per victim rather than once per round,
     * so a burst of chaingun fire is one offence. Only "kill" was ever being
     * charged, so shooting up a government's traffic cost you nothing until
     * something actually blew up.
     */
    if (npc.govtId >= 128) applyCrime(this.player, npc.govtId, "shoot");
    if (npc.aiType === 1) {
      if (npc.phase !== "leaving") {
        npc.phase = "leaving";
        const ang = Math.random() * Math.PI * 2;
        npc.target = { x: Math.cos(ang) * 2400, y: Math.sin(ang) * 2400 };
      }
      return;
    }
    // updateHostileAi flies them at the player; phase is a trader's waypoint
    npc.hostile = true;
    /*
     * The interceptor is also Nova's "piracy police", which the Bible has
     * "attacking any ship that fires on or attempts to board another,
     * non-enemy ship while the interceptor is watching". Watching means in
     * sensor range of the ship that was hit.
     */
    for (const other of this.npcs) {
      if (other === npc || other.aiType !== 4 || other.hostile || other.ally) continue;
      if (Math.hypot(other.pos.x - npc.pos.x, other.pos.y - npc.pos.y) > 1600) continue;
      if (govtEnemy(other.govtId, npc.govtId)) continue; // they were enemies anyway
      other.hostile = true;
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
      this.message(`Objective complete: ${active.name}.`);
      const doneText = descText(m.shipDoneText);
      if (doneText) {
        this.pendingMissionEvents.push({
          title: active.name,
          text: substituteTags(doneText, m, active, this.pilotName, this.rankTags()),
        });
      }
      this.save();
    }
  }

  private destroyNpc(npc: NpcShip, byPlayer: boolean, killer: NpcShip | null = null): void {
    npc.done = true;
    if (this.targetNpc === npc) this.targetNpc = null;
    // the escort that made the kill crows about it
    if (killer && !killer.done) this.speak(killer, VOICE.VICTORY);
    this.spawnExplosion(
      npc.pos.x, npc.pos.y, Math.max(1, npc.radius / 24),
      npc.radius > 40 ? 133 : 132,
    );
    const shipName = npc.typeId ? (SHIPS[npc.typeId]?.name.split(";")[0] ?? "Ship") : "Ship";
    this.message(npc.ally ? `Your ${shipName} was destroyed.` : `${shipName} destroyed.`);

    // an escort that dies on your watch is a failed contract
    if (npc.missionMisnId !== null) {
      const active = this.player.activeMissions.find((a) => a.misnId === npc.missionMisnId);
      const m = active ? MISSIONS[String(active.misnId)] : null;
      if (active && m && m.shipGoal === 3 && !active.shipsDone) {
        applySet(m.onFailure, this.player.bits, this.bitHandlers());
        applyCompReward(this.player, m.compGovt, m.compReward, true);
        this.player.activeMissions = this.player.activeMissions.filter((a) => a !== active);
        this.message(`Mission failed: ${active.name} — the ship you were escorting was destroyed.`);
        const failText = descText(m.failText);
        if (failText) {
          this.pendingMissionEvents.push({
            title: `Mission failed: ${active.name}`,
            text: substituteTags(failText, m, active, this.pilotName, this.rankTags()),
          });
        }
        this.save();
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
        this.save();
      }
    }
    if (npc.personId !== null && !this.player.personsKilled.includes(npc.personId)) {
      this.player.personsKilled.push(npc.personId); // they don't come back
    }
    if (!byPlayer || npc.ally) return;
    // combat rating + legal record
    if (npc.typeId) this.player.ratingPoints += Math.max(0, SHIPS[npc.typeId]?.strength ?? 0);
    if (npc.govtId >= 128) applyCrime(this.player, npc.govtId, "kill");
    // mission special-ship goals
    if (npc.missionMisnId !== null) {
      const active = this.player.activeMissions.find((a) => a.misnId === npc.missionMisnId);
      const m = MISSIONS[String(npc.missionMisnId)];
      if (active && m && !active.shipsDone) {
        active.shipsKilled += 1;
        if (active.shipsKilled >= active.shipsTotal) {
          active.shipsDone = true;
          applySet(m.onShipDone, this.player.bits, this.bitHandlers());
          this.message(`Objective complete: ${active.name}.`);
          const doneText = descText(m.shipDoneText);
          if (doneText) {
            this.pendingMissionEvents.push({
              title: active.name,
              text: substituteTags(doneText, m, active, this.pilotName, this.rankTags()),
            });
          }
        } else {
          this.message(`${active.name}: ${active.shipsKilled}/${active.shipsTotal} destroyed.`);
        }
        this.save();
      }
    }
  }

  /** Spawn special ships for active destroy-goal missions set in this system. */
  private spawnMissionShips(): void {
    for (const active of this.player.activeMissions) {
      if (active.shipsDone || active.shipsTotal <= 0) continue;
      if (active.shipSystemId !== this.player.systemId) continue;
      const remaining = active.shipsTotal - active.shipsKilled;
      const dude = DUDES[String(active.shipDude)];
      for (let i = 0; i < remaining; i++) {
        const shipEntry = dude ? this.weightedPick(dude.ships) : null;
        const typeId = shipEntry && SHIPS[String(shipEntry.id)] ? String(shipEntry.id) : null;
        if (!typeId) continue;
        const type = SHIPS[typeId];
        const npc = new NpcShip({ turnRate: type.turnRate, accel: type.accel, maxSpeed: type.maxSpeed });
        npc.typeId = typeId;
        npc.govtId = (dude?.govt ?? -1) >= 128 ? dude!.govt : inherentCombatGovt(typeId);
        const mDef = MISSIONS[String(active.misnId)];
        const goal = mDef?.shipGoal ?? 0;
        // you only shoot the ones you were sent to kill or cripple
        npc.hostile = goal === 0 || goal === 1;
        /*
         * ShipBehav overrides that when the mission says so: 0 makes the
         * special ships always attack the player and 1 makes them protect
         * them, whatever the goal implies. 208 missions set 0 and 40 set 1.
         */
        if (mDef?.shipBehav === 0) npc.hostile = true;
        else if (mDef?.shipBehav === 1) {
          npc.hostile = false;
          npc.ally = true;
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
      if (remaining > 0) this.message(`Hostile contacts: ${active.name}.`);
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
            Math.hypot(n.pos.x - this.ship.pos.x, n.pos.y - this.ship.pos.y) < 2000,
        );
        if (seen) {
          active.shipsDone = true;
          applySet(m.onShipDone, this.player.bits, this.bitHandlers());
          this.message(`Observation complete: ${active.name}.`);
          const doneText = descText(m.shipDoneText);
          if (doneText) {
            this.pendingMissionEvents.push({
              title: active.name,
              text: substituteTags(doneText, m, active, this.pilotName, this.rankTags()),
            });
          }
          this.save();
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
      this.asteroids.push(this.makeAsteroid(types[Math.floor(Math.random() * types.length)]));
    }
  }

  private makeAsteroid(typeId: string, at?: { x: number; y: number }): Asteroid {
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
      spin: ((roid?.spinRate ?? 50) / 100) * 30 * (Math.random() < 0.5 ? -1 : 1),
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
    if (this.particles.length) this.particles = this.particles.filter((p) => p.ttl > 0);
  }

  private collectMineral(m: Mineral): void {
    const space = this.player.cargoCap - this.cargoUsed();
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
    if (this.gear.reinfInhibit.some((v) => v === -1 || govtClassmate(govtId, v))) return;
    this.reinforceTimer -= dt;
    if (this.reinforceTimer > 0) return;
    /*
     * The system names the formation that answers the call (ReinfFleet) and how
     * long it takes to arrive (ReinfTime, in frames), rather than us improvising
     * one from whatever düde happens to spawn here. 291 of the 398 systems name
     * a fleet — Sol calls flët 145, Kania flët 129 after 30 seconds.
     */
    const sys = this.system;
    const fleet = sys.reinfFleet !== null ? FLEETS.find((f) => f.id === sys.reinfFleet) : null;
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
    this.message(`${label} patrol detects ${caught[0]}${caught.length > 1 ? ` and ${caught.length - 1} more` : ""}!`);
    if (paid > 0) this.message(`You are fined ${paid.toLocaleString()} credits.`);
    // being caught turns the patrol on you, as any crime does
    this.provoke(scanner);
    scanner.hostile = true;
    this.save();
  }

  /** The called-for fleet drops out of hyperspace once ReinfTime has elapsed. */
  private updatePendingReinforcement(): void {
    const call = this.pendingReinforcement;
    if (!call || this.time < call.at) return;
    this.pendingReinforcement = null;
    const before = this.npcs.length;
    this.spawnFleetOf(call.fleet, true);
    if (this.npcs.length > before) {
      this.message(`${this.govtLabel(call.fleet.govt)} reinforcements have arrived.`);
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
    if (roid?.explodeBoom != null) this.spawnExplosion(a.x, a.y, 0.7, roid.explodeBoom);
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
    const qty = roid && roid.yieldQty > 0
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
      const n = Math.max(1, Math.round(roid!.fragCount * (0.5 + Math.random())));
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
      if (f.appearOn && !evalTest(f.appearOn, this.player.bits, {
        outfits: this.player.outfits, explored: this.player.explored, male: true,
      })) return false;
      const link = f.linkSyst;
      if (link === -1) return true;
      if (link >= 128 && link <= 2175) return link === sysId;
      if (link >= 10000 && link <= 10255) return govtId === link - 9872;
      if (link >= 15000 && link <= 15255) return govtAllied(link - 14872, govtId);
      if (link >= 20000 && link <= 20255) return govtId !== link - 19872;
      if (link >= 25000 && link <= 25255) return govtEnemy(link - 24872, govtId);
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
      const npc = new NpcShip({ turnRate: type.turnRate, accel: type.accel, maxSpeed: type.maxSpeed });
      npc.typeId = typeId;
      npc.govtId = fleet.govt;
      npc.aiType = 3; // fleets fly as warships
      npc.hostile = hostile;
      npc.initDefense(type.shield, type.armor, type.shieldRechPerSec,
        (type.flags & 0x10) !== 0 ? 0.1 : 0.33);
      npc.sprite = SHIP_SPRITES[typeId] ?? null;
      // stagger them into a loose formation behind the flagship
      const row = Math.floor(slot / 3);
      const col = (slot % 3) - 1;
      npc.pos = {
        x: originX + Math.cos(ang) * row * 70 + Math.cos(ang + Math.PI / 2) * col * 70,
        y: originY + Math.sin(ang) * row * 70 + Math.sin(ang + Math.PI / 2) * col * 70,
      };
      npc.angle = ang + Math.PI;
      const dest = this.system.planets[0];
      npc.phase = dest ? "toPlanet" : "leaving";
      npc.target = dest ? { x: dest.pos.x, y: dest.pos.y } : { x: -originX, y: -originY };
      return npc;
    };

    let slot = 0;
    const lead = makeShip(String(fleet.leadShip), slot++);
    if (!lead) return;
    this.npcs.push(lead);
    for (const esc of fleet.escorts) {
      const n = esc.min + Math.floor(Math.random() * Math.max(1, esc.max - esc.min + 1));
      for (let i = 0; i < Math.min(n, 4); i++) {
        const ship = makeShip(String(esc.id), slot++);
        if (ship) this.npcs.push(ship);
      }
    }
    if (!asReinforcement) this.message(`${fleet.name} enters the system.`);
  }

  /** 5% of ships are a named captain, per the Nova Bible. */
  private maybeMakePerson(npc: NpcShip): void {
    if (Math.random() > 0.05) return;
    const sysId = parseInt(this.player.systemId, 10);
    const govtId = this.system.govtId;
    const killed = new Set(this.player.personsKilled);
    const candidates = Object.values(PERSONS).filter((p) => {
      if (killed.has(p.id)) return false;
      if (!SHIPS[String(p.shipType)]) return false;
      // ActiveOn gates whether this captain is in play at all
      if (p.activeOn && !evalTest(p.activeOn, this.player.bits)) return false;
      const link = p.linkSyst;
      if (link === -1) return true;
      if (link >= 128 && link <= 2175) return link === sysId;
      if (link >= 9999 && link <= 10255) return govtId === link - 9872;
      if (link >= 20000 && link <= 20255) return govtId !== link - 19872;
      return false;
    });
    if (candidates.length === 0) return;
    const person = candidates[Math.floor(Math.random() * candidates.length)];
    const type = SHIPS[String(person.shipType)];
    npc.personId = person.id;
    npc.typeId = String(person.shipType);
    npc.govtId = person.govt;
    npc.aiType = person.aiType;
    npc.sprite = SHIP_SPRITES[npc.typeId] ?? null;
    npc.stats = { turnRate: type.turnRate, accel: type.accel, maxSpeed: type.maxSpeed };
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
  private spawnExplosion(x: number, y: number, scale: number, boomType = 133): void {
    const boom = BOOMS[String(boomType)] ?? BOOMS["133"];
    if (!boom) return;
    const boomId = String(400 + boom.graphicIndex);
    if (!BOOM_SPRITES[boomId]) return;
    // SoundIndex -1 is a silent explosion (Nova Bible); without the guard that
    // asked for snd 299. No stock bööm uses it, but a plug-in easily could.
    if (boom.soundIndex >= 0) {
      playSndAt(300 + boom.soundIndex, 0.45, x - this.ship.pos.x, y - this.ship.pos.y);
    }
    this.explosions.push({
      x, y, boomId, t: 0, scale,
      fps: (30 * Math.max(10, boom.frameAdvance)) / 100,
    });
  }

  private playerDestroyed(): void {
    this.spawnExplosion(this.ship.pos.x, this.ship.pos.y, 1.6, 133);
    this.projectiles = [];
    // dying mid-charge cuts the hyperdrive with everything else
    this.jump = null;
    stopSustained(JUMP_SND_KEY);
    if (this.gear.escapePod && !this.player.strict) {
      this.ship.shield = this.ship.maxShield;
      this.ship.armor = this.ship.maxArmor;
      const haven =
        this.system.planets.find((p) => p.landable) ??
        getSystem(START_SYSTEM_ID).planets.find((p) => p.landable);
      if (haven) {
        this.ship.pos = { x: haven.pos.x + haven.radius * 2, y: haven.pos.y + haven.radius };
      }
      this.ship.vel = { x: 0, y: 0 };
      this.message("You eject in your escape pod and are picked up — the ship is lost, but you live.");
      this.save();
      return;
    }
    if (this.player.strict) {
      // strict play: death is death
      const id = this.pilotId;
      this.pilotId = null; // don't autosave the corpse
      if (id) deletePilot(id);
      alert(`${this.pilotName} died in the ${this.system.name} system. Strict mode: this pilot is gone.`);
      this.landedUi.hide();
      this.mode = "menu";
      this.onMenu?.();
      return;
    }
    const cost = Math.floor(this.player.credits * 0.1);
    this.player.credits -= cost;
    const haven =
      this.system.planets.find((p) => p.landable) ??
      getSystem(START_SYSTEM_ID).planets.find((p) => p.landable);
    this.ship.shield = this.ship.maxShield;
    this.ship.armor = this.ship.maxArmor;
    if (haven) {
      this.ship.pos = { x: haven.pos.x + haven.radius * 2, y: haven.pos.y + haven.radius };
      this.ship.vel = { x: 0, y: 0 };
      this.message(
        `Your ship was disabled. A tug hauled you to ${haven.name} — repairs cost ${cost.toLocaleString()} cr.`,
      );
    } else {
      this.ship.vel = { x: 0, y: 0 };
      this.message(`Emergency repairs cost ${cost.toLocaleString()} cr.`);
    }
    this.save();
  }

  // ---------------- landing ----------------

  private nearestPlanet(): { planet: PlanetDef; dist: number } | null {
    let best: { planet: PlanetDef; dist: number } | null = null;
    for (const p of this.system.planets) {
      const d = Math.hypot(p.pos.x - this.ship.pos.x, p.pos.y - this.ship.pos.y);
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
      this.message("Autopilot needs a destination — target a world (L) or plot a course (M).");
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
      const closing = (this.ship.vel.x * dx + this.ship.vel.y * dy) / (dist || 1);
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

  /** Nova's \: step the plotted course through this system's neighbours. */
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

  /** Nova's N: forget the course and take back the stick. */
  private navOff(): void {
    this.route = [];
    this.routeDest = null;
    this.autopilot = false;
    this.message("Navigation computer cleared.");
  }

  /** Nova's Alt-X: leave in the pod while the ship is still flying. */
  private ejectFromShip(): void {
    if (!this.gear.escapePod) {
      this.message("You have no escape pod fitted.");
      return;
    }
    if (!confirm("Abandon ship? Your ship, outfits and cargo will be lost.")) return;
    playSnd(SND.EJECT, 0.6); // snd 372, named for exactly this
    this.player.cargo = {};
    this.playerDestroyed();
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
      .map(([id, n]) => `${n > 1 ? `${n} × ` : ""}${OUTFITS[id]?.name.split(";")[0] ?? id}`)
      .sort();
    const wing = this.player.escorts
      .map((e) => SHIPS[e.shipId]?.name.split(";")[0] ?? "Ship")
      .sort();

    this.infoUi.show({
      title: this.pilotName,
      sections: [
        {
          title: "Ship",
          rows: [
            { label: "Class", value: type?.name.split(";")[0] ?? "Unknown" },
            { label: "Shields", value: `${Math.round(this.ship.shield)} / ${Math.round(this.ship.maxShield)}` },
            { label: "Armor", value: `${Math.round(this.ship.armor)} / ${Math.round(this.ship.maxArmor)}` },
            { label: "Fuel", value: `${Math.floor(this.player.fuelJumps)} / ${this.player.maxFuelJumps} jumps` },
            { label: "Cargo", value: `${this.cargoUsed()} / ${this.player.cargoCap} tons` },
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
            { label: "Credits", value: `${this.player.credits.toLocaleString()} cr` },
            { label: "Combat rating", value: rating },
            { label: "Date", value: formatDate(this.player.date) },
            { label: "Systems charted", value: String(this.player.explored.length) },
          ],
        },
        {
          title: "Outfits",
          rows: [],
          note: outfits.length ? outfits.join(", ") : "Nothing fitted.",
        },
        ...(wing.length
          ? [{ title: "Escorts", rows: [], note: wing.join(", ") }]
          : []),
      ],
      close: () => undefined,
    });
  }

  /** Nova's I: the jobs you are carrying, and how long you have. */
  private openMissionInfo(): void {
    if (this.infoUi.open) {
      this.infoUi.close();
      return;
    }
    const sections = this.player.activeMissions.map((a) => {
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
        rows.push({ label: "Carrying", value: `${a.cargoQty}t ${a.cargoName}` });
      }
      if (a.timeLimit > 0) {
        const left = Math.max(0, a.timeLimit - (this.player.date - a.acceptedDay));
        rows.push({ label: "Time left", value: `${Math.ceil(left)} days` });
      }
      return { title: a.name, rows };
    });

    this.infoUi.show({
      title: "Mission Log",
      sections: sections.length
        ? sections
        : [{ title: "No active missions", rows: [], note: "Look for work at a spaceport BBS or bar." }],
      close: () => undefined,
    });
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
      sections: () => [
        {
          title: "Hold",
          rows: [
            { label: "Used", value: `${this.cargoUsed()} / ${this.player.cargoCap} tons` },
          ],
        },
      ],
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
    this.save();
    this.message(`Jettisoned ${dumped}t of ${cargoLabel(commodityId)}.`);
  }

  private selectOrLand(): void {
    const landables = this.system.planets;
    if (landables.length === 0) {
      this.message("There is nothing to land on in this system.");
      return;
    }
    if (this.targetPlanet) {
      const near = Math.hypot(
        this.targetPlanet.pos.x - this.ship.pos.x,
        this.targetPlanet.pos.y - this.ship.pos.y,
      );
      if (near <= this.targetPlanet.radius * LAND_DIST + 60) {
        this.tryLand(this.targetPlanet);
        return;
      }
    }
    // cycle by distance, nearest first
    const byDist = [...landables].sort(
      (a, b) =>
        Math.hypot(a.pos.x - this.ship.pos.x, a.pos.y - this.ship.pos.y) -
        Math.hypot(b.pos.x - this.ship.pos.x, b.pos.y - this.ship.pos.y),
    );
    const idx = this.targetPlanet ? byDist.indexOf(this.targetPlanet) : -1;
    this.targetPlanet = byDist[(idx + 1) % byDist.length];
    this.targetNpc = null;
    const dist = Math.round(
      Math.hypot(
        this.targetPlanet.pos.x - this.ship.pos.x,
        this.targetPlanet.pos.y - this.ship.pos.y,
      ),
    );
    this.message(`Target: ${this.targetPlanet.name} (${dist} away).`);
  }

  private tryLand(chosen?: PlanetDef): void {
    const near = chosen
      ? {
          planet: chosen,
          dist: Math.hypot(chosen.pos.x - this.ship.pos.x, chosen.pos.y - this.ship.pos.y),
        }
      : this.nearestPlanet();
    if (!near) {
      this.message("There is nowhere to land in this system.");
      return;
    }
    const { planet, dist } = near;
    if (dist > planet.radius * LAND_DIST + 60) {
      this.message(`Too far from ${planet.name} to land.`);
      return;
    }
    const isGate = planet.isHypergate || planet.isWormhole;
    if (isGate && !this.gateIsWorking(planet)) {
      // a dead gate: its ring stays dark however long you sit in front of it
      this.message(`${planet.name} is derelict. The ring is dark and will not answer.`);
      return;
    }
    if (!planet.landable && !isGate) {
      this.message(`You cannot land on ${planet.name}.`);
      return;
    }
    if (this.ship.speed > LAND_SPEED) {
      this.message("You are moving too fast to land.");
      return;
    }
    /*
     * spöb MinStatus: "the point on your record in the current system that
     * you'll be denied landing clearance on this stellar", ignored outright on
     * an uninhabited one. 32767 is a world that never clears anybody — the
     * Bible's "player can never land" — and 19 stellars read it, so those get
     * a flat refusal rather than an invitation to improve your standing.
     */
    if (
      /*
       * Gates are not ports and MinStatus does not apply to them: all 19 of
       * the stellars reading 32767 are hypergates, which is Nova's way of
       * saying "you cannot land on this, you fly through it".
       */
      !isGate &&
      !this.clearedToLand(planet, this.system.govtId)
    ) {
      this.message(
        planet.minStatus === MIN_STATUS_NEVER
          ? `${planet.name} refuses all traffic. You are not getting down there.`
          : `${planet.name} denies you landing clearance. They want a better record than yours.`,
      );
      playSnd(SND.BEEP3, 0.5);
      return;
    }
    this.ship.vel = { x: 0, y: 0 };
    this.hailUi.close();
    if (isGate) {
      // gates aren't ports. A hypergate's ring has to open first; a wormhole is
      // a hole in space that is always open, so you just fly into it.
      if (planet.isWormhole) this.showGatePanel(planet);
      else this.openGate(planet);
      return;
    }
    this.player.landedOn = planet.id;
    // Landing does not move the calendar. Nova advances the date on hyperspace
    // jumps (and on missions that set DatePostInc), and nowhere else — there is
    // no landing rule in the Bible, and putting one here made a shopping run
    // through four worlds cost four days.
    this.mode = "landed";
    this.projectiles = [];
    this.targetNpc = null;
    this.ship.shield = this.ship.maxShield;
    this.ship.armor = this.ship.maxArmor; // free repairs while docked, EV-style
    if (this.gear.autoRefuel) this.player.fuelJumps = this.player.maxFuelJumps;
    this.save();
    this.landedUi.show(planet, this.system);
  }

  /** called by the landed UI */
  depart(): void {
    // backing out of a gate chooser lets the ring shut again
    if (this.gateDocking) this.closeGate(this.gateDocking.id);
    const planet = this.system.planets.find((p) => p.id === this.player.landedOn);
    this.player.landedOn = null;
    this.save();
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

  private startJump(): void {
    if (this.route.length === 0) {
      this.message("No hyperspace course set. Press M to open the map.");
      return;
    }
    if (this.insideNoJumpZone()) {
      this.message("Too deep in the system's gravity well to jump. Head for open space.");
      playSnd(SND.BEEP3, 0.5);
      return;
    }
    if (this.player.fuelJumps < 1) {
      this.message("Not enough hyperdrive fuel. Land somewhere and refuel.");
      return;
    }
    if (this.ship.ionized) {
      this.message("Your systems are ionized — the hyperdrive will not engage.");
      return;
    }
    const cur = this.system;
    const next = getSystem(this.route[0]);
    const dx = next.mapPos.x - cur.mapPos.x;
    const dy = next.mapPos.y - cur.mapPos.y;
    this.jump = {
      phase: "turning",
      chargeLeft: this.gear.fastJump ? 0.8 : 2.2,
      targetAngle: Math.atan2(dy, dx),
    };
    /*
     * The spool-up sample ("Warp up") runs 6.08s but the charge takes 2.2s —
     * 0.8s with a fast jump — so played as a one-shot it was still going long
     * after arrival and read as the sound restarting in the new system. Held
     * on a key instead so the jump itself can cut it off.
     */
    startSustained(JUMP_SND_KEY, SND.WARP_IN, false, 0.5);
    this.message(`Autopilot engaged: jumping to ${next.name}.`);
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
      if (this.npcs.some((n) => n.missionMisnId === active.misnId && n.escorting)) {
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
    stopSustained(JUMP_SND_KEY); // the spool-up ends when the drive fires
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
    this.save();
    this.message(
      `Arrived in the ${next.name} system. Fuel: ${this.player.fuelJumps}/${this.player.maxFuelJumps} jumps.`,
    );
    if (this.route.length > 0) {
      this.message(`Course continues to ${getSystem(this.routeDest ?? this.route[this.route.length - 1]).name} — press J to continue.`);
    }
  }

  // ---------------- economy (called by landed UI) ----------------

  cargoUsed(): number {
    return (
      Object.values(this.player.cargo).reduce((a, b) => a + b, 0) +
      missionCargoUsed(this.player)
    );
  }

  // ---------------- missions ----------------

  private bitHandlers() {
    return {
      startMission: (misnId: number) => {
        const m = MISSIONS[String(misnId)];
        if (!m || this.player.activeMissions.some((a) => a.misnId === misnId)) return;
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
        const active = this.player.activeMissions.find((a) => a.misnId === misnId);
        const m = MISSIONS[String(misnId)];
        if (!active || !m) return;
        applySet(m.onFailure, this.player.bits, this.bitHandlers());
        applyCompReward(this.player, m.compGovt, m.compReward, true);
        this.player.activeMissions = this.player.activeMissions.filter((a) => a !== active);
        this.message(`Mission failed: ${active.name}.`);
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
            ? { x: first.pos.x + first.radius * 2, y: first.pos.y + first.radius }
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
      changeShip: (shipId: number, keepOutfits: boolean, grantDefaults: boolean) => {
        const key = String(shipId);
        if (!SHIPS[key]) return;
        if (!keepOutfits) this.player.outfits = {};
        if (grantDefaults) grantHullOutfits(key, this.player.outfits);
        this.applyShipType(key);
        if (grantDefaults) {
          const stock = stockAmmo(key);
          for (const [weapId, count] of Object.entries(stock)) {
            this.player.ammo[weapId] = Math.max(this.player.ammo[weapId] ?? 0, count);
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

  acceptMission(m: MissionType, active: ActiveMission): {
    ok: boolean;
    reason?: string;
  } {
    if (active.cargoLoaded && active.cargoQty > this.player.cargoCap - this.cargoUsed()) {
      return { ok: false, reason: "You don't have enough cargo space for this mission." };
    }
    this.player.activeMissions.push(active);
    applySet(m.onAccept, this.player.bits, this.bitHandlers());
    this.save();
    return { ok: true };
  }

  refuseMission(m: MissionType): void {
    applySet(m.onRefuse, this.player.bits, this.bitHandlers());
    this.save();
  }

  abortMission(active: ActiveMission): void {
    const m = MISSIONS[String(active.misnId)];
    if (m) applySet(m.onAbort, this.player.bits, this.bitHandlers());
    this.player.activeMissions = this.player.activeMissions.filter((a) => a !== active);
    this.save();
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

      // time limit
      if (active.timeLimit > 0 && this.player.date - active.acceptedDay > active.timeLimit) {
        applySet(m.onFailure, this.player.bits, this.bitHandlers());
        applyCompReward(this.player, m.compGovt, m.compReward, true);
        const fail = descText(m.failText);
        events.push({
          title: `Mission failed: ${active.name}`,
          text: substituteTags(fail ?? "You have run out of time.", m, active, this.pilotName, this.rankTags()),
        });
        continue;
      }

      // an escort contract is fulfilled by arriving with them still alive
      if (!active.shipsDone && m.shipGoal === 3) {
        const dest = active.returnSpobId ?? active.travelSpobId;
        if (dest === null || dest === planetId) {
          active.shipsDone = true;
          applySet(m.onShipDone, this.player.bits, this.bitHandlers());
          const doneText = descText(m.shipDoneText);
          if (doneText) {
            events.push({
              title: active.name,
              text: substituteTags(doneText, m, active, this.pilotName, this.rankTags()),
            });
          } else {
            this.message(`${active.name}: your charges are safely delivered.`);
          }
        }
      }

      // travel leg
      if (!active.travelDone && active.travelSpobId === planetId) {
        active.travelDone = true;
        if (!active.cargoLoaded && active.cargoQty > 0) {
          active.cargoLoaded = true;
          const load = descText(m.loadCargText);
          if (load) {
            events.push({
              title: active.name,
              text: substituteTags(load, m, active, this.pilotName, this.rankTags()),
            });
          }
        } else if (active.cargoLoaded && active.returnSpobId && m.dropOffMode === 0) {
          /*
           * DropOffMode 0 leaves the cargo at TravelStel; mode 1 keeps it
           * aboard until the mission ends at ReturnStel, and -1 means the
           * mission has no scripted drop at all. This branch used to fire
           * regardless, so a mode-1 job unloaded a leg early.
           */
          active.cargoLoaded = false;
          const drop = descText(m.dropCargText);
          if (drop) {
            events.push({
              title: active.name,
              text: substituteTags(drop, m, active, this.pilotName, this.rankTags()),
            });
          }
        }
      }

      // completion
      const finalSpob = active.returnSpobId ?? active.travelSpobId;
      if (active.travelDone && active.shipsDone && (finalSpob === null || finalSpob === planetId)) {
        this.player.credits += Math.max(0, active.pay);
        // DropOffMode 1 delivers at the end of the run rather than mid-way
        if (active.cargoLoaded && m.dropOffMode === 1) {
          active.cargoLoaded = false;
          const drop = descText(m.dropCargText);
          if (drop) {
            events.push({
              title: active.name,
              text: substituteTags(drop, m, active, this.pilotName, this.rankTags()),
            });
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
        const comp = descText(m.compText);
        events.push({
          title: `Mission complete: ${active.name}`,
          text:
            substituteTags(comp ?? "", m, active, this.pilotName, this.rankTags()) ||
            (active.pay > 0
              ? `You are paid ${active.pay.toLocaleString()} credits.`
              : "The job is done."),
        });
        continue;
      }
      remaining.push(active);
    }
    this.player.activeMissions = remaining;
    return events;
  }

  buy(commodityId: string, qty: number, unitPrice: number): void {
    const space = this.player.cargoCap - this.cargoUsed();
    const affordable = Math.floor(this.player.credits / unitPrice);
    const n = Math.min(qty, space, affordable);
    if (n <= 0) return;
    this.player.credits -= n * unitPrice;
    this.player.cargo[commodityId] = (this.player.cargo[commodityId] ?? 0) + n;
    this.save();
  }

  sell(commodityId: string, qty: number, unitPrice: number): void {
    const have = this.player.cargo[commodityId] ?? 0;
    const n = Math.min(qty, have);
    if (n <= 0) return;
    this.player.credits += n * unitPrice;
    this.player.cargo[commodityId] = have - n;
    if (this.player.cargo[commodityId] === 0) delete this.player.cargo[commodityId];
    this.save();
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

  runRace(pick: number, stake: number): {
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
    this.save();
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
    if (outf.max > 0 && owned >= outf.max) {
      return { ok: false, reason: "You already have the maximum number of these." };
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
    if (outf.onPurchase) applySet(outf.onPurchase, this.player.bits, this.bitHandlers());
    const isAmmo = outf.mods.some((m) => m.type === 3);
    if (isAmmo) {
      // ammunition is consumed, not carried as an outfit
      for (const mod of outf.mods) {
        if (mod.type === 3) {
          const weapId = this.ammoWeaponId(mod.val);
          this.player.ammo[weapId] = (this.player.ammo[weapId] ?? 0) + 1;
        }
      }
    } else {
      this.player.outfits[outfId] = owned + 1;
      this.chartFromOutfit(outfId);
    }
    this.recomputeLoadout();
    this.save();
    return { ok: true };
  }

  sellOutfit(outfId: string): { ok: boolean; reason?: string } {
    const outf = OUTFITS[outfId];
    const owned = this.player.outfits[outfId] ?? 0;
    if (!outf || owned <= 0) return { ok: false, reason: "You do not own this outfit." };
    // oütf Flags 0x0008: some items can never be sold back
    if ((outf.flags & 0x0008) !== 0) {
      return { ok: false, reason: "This item cannot be sold." };
    }
    this.player.outfits[outfId] = owned - 1;
    if (this.player.outfits[outfId] === 0) delete this.player.outfits[outfId];
    this.player.credits += Math.floor(outf.cost * 0.75);
    // OnSell runs the other way — the cheap reactors clear the bit that marks
    // you as carrying one
    if (outf.onSell) applySet(outf.onSell, this.player.bits, this.bitHandlers());
    this.recomputeLoadout();
    this.save();
    return { ok: true };
  }

  refuelCost(): number {
    const missing = this.player.maxFuelJumps - this.player.fuelJumps;
    const planet = this.player.landedOn ? SPOBS.get(this.player.landedOn) : null;
    const govtId = planet ? (SPOB_GOVT.get(planet.planet.id) ?? -1) : -1;
    // 0x0800: ships and worlds of that govt refuel you for nothing
    if (govtId >= 128 && this.rankFlag(govtId, 0x0800)) return 0;
    return Math.ceil(missing * REFUEL_COST_PER_JUMP);
  }

  refuel(): void {
    const cost = this.refuelCost();
    if (cost === 0 || this.player.credits < cost) return;
    this.player.credits -= cost;
    this.player.fuelJumps = this.player.maxFuelJumps;
    this.save();
  }

  // ---------------- NPCs ----------------

  private populateNpcs(): void {
    const n = Math.min(this.system.traffic, 2);
    for (let i = 0; i < n; i++) this.spawnNpc(true);
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
      if (shipEntry && SHIPS[String(shipEntry.id)]) typeId = String(shipEntry.id);
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
      type ? { turnRate: type.turnRate, accel: type.accel, maxSpeed: type.maxSpeed } : undefined,
    );
    npc.typeId = typeId;
    // where the düde names no government, the hull's own inherent one stands in
    npc.govtId = govtId >= 128 ? govtId : inherentCombatGovt(typeId);
    npc.aiType = aiType;
    npc.dudeId = dudeId;
    npc.hostile = !!type && this.hostileToPlayer(npc.govtId);
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
    if (type) preloadSnds(type.stockWeapons.map((sw) => WEAPONS[String(sw.id)]?.sndId));
    if (npc.ally && govtId >= 128) preloadSnds(voiceBank(GOVT_VOICES[String(govtId)] ?? 0));
    // ships whose class has AI cloak flags will vanish when they run
    if (type && (type.flags2 & 0x0f00) !== 0) npc.canCloak = true;
    if (dude) {
      npc.bootyFlags = dude.booty;
      if ((dude.booty & 0x40) !== 0 && type) {
        // money aboard scales with the hull's value, as the Bible describes —
        // a fraction of a percent, so piracy pays without breaking the economy
        npc.booty = Math.round(type.cost * 0.002 * (0.5 + Math.random()));
      }
    }
    // EV gives every new ship a small chance of being somebody in particular
    if (!npc.hostile || Math.random() < 0.5) this.maybeMakePerson(npc);
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
    return sys.planets.filter((p) => p.landable && !p.isHypergate && !p.isWormhole);
  }

  /**
   * Give a ship the errand its düde AIType says it is on. The Bible is
   * specific about who goes where: only "1 - Wimpy Trader" and "2 - Brave
   * Trader" visit planets, "3 - Warship ... jumps out if there aren't any"
   * enemies, and "4 - Interceptor ... parks in orbit around a planet if he
   * can't find any". Every spawn used to roll a flat 70% chance of flying at a
   * random stellar whatever it was, so warships and interceptors made for the
   * nearest world and evaporated on touching it.
   */
  private setNpcErrand(npc: NpcShip, sys: SystemDef, exclude?: string | null): void {
    const ports = this.portsOf(sys).filter((p) => p.id !== exclude);
    const pick = ports.length > 0 ? ports[Math.floor(Math.random() * ports.length)] : null;
    const visits = npc.aiType === 1 || npc.aiType === 2;
    if (pick && (visits || npc.aiType === 4)) {
      npc.phase = npc.aiType === 4 ? "orbit" : "toPlanet";
      npc.targetPlanetId = pick.id;
      npc.targetRadius = pick.radius;
      npc.target = { x: pick.pos.x, y: pick.pos.y };
      npc.orbitAngle = Math.atan2(npc.pos.y - pick.pos.y, npc.pos.x - pick.pos.x);
      return;
    }
    const outAng = Math.random() * Math.PI * 2;
    npc.phase = "leaving";
    npc.targetPlanetId = null;
    npc.target = { x: Math.cos(outAng) * 2100, y: Math.sin(outAng) * 2100 };
  }

  /**
   * Ships on the ground. A trader that touches down comes off the board for a
   * while and then lifts off again — the Bible has traders *visiting* planets,
   * which is a round trip, and has folding hulls cycling their parts "upon
   * landing, taking off, and entering/exiting hyperspace", an animation a ship
   * that never takes off can only ever play half of.
   */
  private dockedNpcs: { npc: NpcShip; planetId: string; systemId: string; wait: number }[] = [];

  /** Take a ship that has just set down off the board. */
  private dockNpc(npc: NpcShip): void {
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
      npc.pos = { x: pad.pos.x + Math.cos(ang) * (pad.radius + 8), y: pad.pos.y + Math.sin(ang) * (pad.radius + 8) };
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

  // ---------------- flight clicks ----------------

  /**
   * Click a stellar to make it the one you are flying to. Landing already
   * cycles targets with L, but with five worlds in Sol that is a lot of
   * presses to reach the one you want, and the same click is what picks a
   * destination in Nova. Clicking a ship targets it instead, and clicking
   * empty space clears the selection.
   */
  private onFlightClick(e: MouseEvent): void {
    if (this.lastDragMoved > 6) return;
    const rect = this.canvas.getBoundingClientRect();
    const mx = e.clientX - rect.left;
    const my = e.clientY - rect.top;
    const viewW = this.viewW - SIDEBAR_W;
    if (mx > viewW) return; // the status bar has its own hit areas
    // undo the camera transform renderSpace applies
    const wx = mx - viewW / 2 + this.ship.pos.x;
    const wy = my - this.viewH / 2 + this.ship.pos.y;

    let bestPlanet: { planet: PlanetDef; d: number } | null = null;
    for (const p of this.system.planets) {
      const d = Math.hypot(p.pos.x - wx, p.pos.y - wy);
      // a generous margin so small stations and gates stay clickable
      if (d <= Math.max(p.radius, 18) + 8 && (!bestPlanet || d < bestPlanet.d)) {
        bestPlanet = { planet: p, d };
      }
    }
    if (bestPlanet) {
      this.targetPlanet = bestPlanet.planet;
      this.targetNpc = null;
      const dist = Math.round(
        Math.hypot(
          bestPlanet.planet.pos.x - this.ship.pos.x,
          bestPlanet.planet.pos.y - this.ship.pos.y,
        ),
      );
      this.message(`Target: ${bestPlanet.planet.name} (${dist} away).`);
      return;
    }

    let bestNpc: { npc: NpcShip; d: number } | null = null;
    for (const npc of this.npcs) {
      if (npc.done || npc.cloaked) continue;
      const d = Math.hypot(npc.pos.x - wx, npc.pos.y - wy);
      if (d <= 28 && (!bestNpc || d < bestNpc.d)) bestNpc = { npc, d };
    }
    if (bestNpc) {
      this.targetNpc = bestNpc.npc;
      this.targetPlanet = null;
      this.message(`Target: ${this.shipLabel(bestNpc.npc)}.`);
      return;
    }
    if (this.targetPlanet || this.targetNpc) {
      this.targetPlanet = null;
      this.targetNpc = null;
    }
  }

  // ---------------- map clicks ----------------

  private onClick(e: MouseEvent): void {
    if (this.mode === "flight") {
      this.onFlightClick(e);
      return;
    }
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
      this.mapSelected = best.id;
      this.setDestination(best.id);
    }
  }

  private onMapButton(id: string): void {
    switch (id) {
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
          this.allSystems().find((s) => s.name.toLowerCase().startsWith(needle));
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

    if (this.mode === "map") this.renderMap(ctx, w, h);
  }

  private renderSpace(ctx: CanvasRenderingContext2D, w: number, h: number): void {
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
    const drawOrder = [...this.system.planets].sort((a, b) => b.radius - a.radius);
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
      this.drawReticle(ctx, this.targetNpc.pos.x, this.targetNpc.pos.y, this.targetNpc.radius);
    }
    if (this.targetPlanet) {
      this.drawStellarMarks(ctx, this.targetPlanet.pos.x, this.targetPlanet.pos.y, this.targetPlanet.radius + 18);
    }

    // asteroids
    for (const a of this.asteroids) {
      const sheet = this.roidSheet(a.typeId);
      if (sheet) {
        const frame = ((Math.floor(a.frame) % sheet.frames) + sheet.frames) % sheet.frames;
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
      const sheet = p.weap.spinId !== null ? WEAPON_SPRITES[String(p.weap.spinId)] : undefined;
      if (sheet && drawSheetFrame(ctx, sheet, rotationFrame(sheet.frames, p.angle), p.x, p.y)) {
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
        drawSheetFrame(ctx, sheet, Math.floor(fx.t * fx.fps), fx.x, fx.y, fx.scale);
      }
    }

    if (this.cloaked) ctx.globalAlpha = 0.35;
    this.drawShip(ctx, this.ship, true, this.player.shipId);
    ctx.globalAlpha = 1;

    ctx.restore();
  }

  /** The four blue corner marks EV Nova draws around a selected stellar. */
  private drawStellarMarks(ctx: CanvasRenderingContext2D, x: number, y: number, r: number): void {
    const arm = 9;
    ctx.save();
    ctx.strokeStyle = "#3a6ff0";
    ctx.fillStyle = "#3a6ff0";
    ctx.lineWidth = 2;
    ctx.lineCap = "round";
    for (const [sx, sy] of [[-1, -1], [1, -1], [-1, 1], [1, 1]] as const) {
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

  /** Nova's target cursor (spïn 650), animated and centred on the target. */
  /**
   * Nova's target cursor (spïn 650) is a 23px crosshair whose arrowheads sit on
   * the edges of its own frame — drawn at native size it disappears into
   * anything bigger than a shuttle, which is what a Pirate Enterprise did to
   * it. Scaling it to the target's own radius puts the arrowheads back on the
   * hull's edge where they read as a lock, whatever you have selected.
   */
  private drawReticle(ctx: CanvasRenderingContext2D, x: number, y: number, radius: number): void {
    const sheet = CURSOR_SPRITE;
    if (!sheet) return;
    // Scaled to the hull so it frames the target, but capped: blown up to a
    // capital ship's full width the crosshair's arrowheads turn into slabs of
    // red that hide the thing you're aiming at.
    const scale = Math.max(1, Math.min(3, (radius * 2 + 20) / sheet.w));
    ctx.globalAlpha = 0.9;
    drawSheetFrame(ctx, sheet, Math.floor(this.time * 12) % sheet.frames, x, y, scale);
    ctx.globalAlpha = 1;
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
    ctx.save();
    ctx.translate(ship.pos.x, ship.pos.y);
    const glow = shipTypeId ? GLOW_SPRITES[shipTypeId] : undefined;
    const drewHull = !!(sprite && drawShipSprite(ctx, sprite, 0, 0, angle, set));
    if (!drewHull) {
      ctx.save();
      ctx.rotate(angle);
      if (thrusting) drawThrustFlame(ctx, sprite ? sprite.w / 2 : 13);
      if (isPlayer) drawPlayerShip(ctx, false);
      else drawNpcShip(ctx, false);
      ctx.restore();
      ctx.restore();
      return;
    }

    /*
     * Running lights (LightImageID) sit on top of the hull and blink to their
     * own BlinkMode pattern, independent of the engines. 92 of Nova's hulls
     * have one. Flags 0x0040 puts them out when the ship is disabled, which is
     * the visual cue that a hulk is dead rather than merely drifting.
     */
    const light = shipTypeId ? LIGHT_SPRITES[shipTypeId] : undefined;
    if (light && sprite && !(ship.disabled && sprite.flags & SHAN_HIDE_LIGHTS_DISABLED)) {
      const intensity = blinkIntensity(sprite, this.time, shipTypeId ?? "");
      if (intensity > 0) {
        const prev = ctx.globalCompositeOperation;
        ctx.globalCompositeOperation = "lighter";
        ctx.globalAlpha = baseAlpha * intensity;
        drawSheetFrame(ctx, light, spriteFrame(light.framesPer ?? 0, light.frames, angle, set), 0, 0);
        ctx.globalAlpha = baseAlpha;
        ctx.globalCompositeOperation = prev;
      }
    }

    if (thrusting) {
      if (glow) {
        // Nova's own engine-glow sprite, additively blended over the hull
        const prev = ctx.globalCompositeOperation;
        ctx.globalCompositeOperation = "lighter";
        // the glow flickers between full and slightly dimmed, as in the original
        ctx.globalAlpha = baseAlpha * (0.75 + Math.random() * 0.25);
        drawSheetFrame(ctx, glow, spriteFrame(glow.framesPer ?? 0, glow.frames, angle, set), 0, 0);
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

  private renderMap(ctx: CanvasRenderingContext2D, w: number, h: number): void {
    ctx.fillStyle = "rgba(2,5,12,0.92)";
    ctx.fillRect(0, 0, w, h);
    /*
     * cölr FloatingMap is the border colour Nova draws around the floating
     * hyperspace map and the escort menu. Reading it means a scenario that
     * restyles its interface restyles this too.
     */
    if (COLR) {
      ctx.strokeStyle = COLR.floatingMap;
      ctx.lineWidth = 2;
      ctx.strokeRect(1, 1, w - 2, h - 2);
      ctx.lineWidth = 1;
    }

    // base scale fits the whole galaxy at zoom 1; user zoom/pan on top
    let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
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
      ) continue;
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
        if (pt.x < -radius || pt.y < -radius || pt.x > w + radius || pt.y > h + radius) continue;
        const grad = ctx.createRadialGradient(pt.x, pt.y, 0, pt.x, pt.y, radius);
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

    // links
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

    // route highlight
    if (this.route.length > 0) {
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
      if (systemId && !missionSystems.has(systemId)) missionSystems.set(systemId, color);
    };
    for (const active of this.player.activeMissions) {
      const m = MISSIONS[String(active.misnId)];
      if (m && (m.flags & 0x0002) !== 0) continue;
      const dest = active.travelDone ? (active.returnSpobId ?? null) : active.travelSpobId;
      if (dest) mark(SPOB_INDEX.get(dest)?.systemId, MISSION_ARROW);
      if (m && (m.flags & 0x0200) !== 0) mark(active.shipSystemId ?? undefined, MISSION_ARROW);
    }
    // a posting being previewed from the board is the briefing's green arrow
    for (const systemId of this.mapPreview) mark(systemId, BRIEFING_ARROW);

    /*
     * Nova's mission marker: a small green arrow standing over the destination
     * system, offset by the node's own radius so it sits the same distance
     * clear of a 2px uncharted dot and a 6px current-system disc.
     */
    const missionArrow = (pt: { x: number; y: number }, r: number, color: string) => {
      ctx.fillStyle = color;
      ctx.beginPath();
      ctx.moveTo(pt.x, pt.y - (r + 7));
      ctx.lineTo(pt.x - 5, pt.y - (r + 15));
      ctx.lineTo(pt.x + 5, pt.y - (r + 15));
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
      const adjacent =
        !explored && sys.links.some((l) => this.isExplored(l));
      /*
       * A mission destination is plotted however far out it lies: accepting a
       * job somewhere you have never been puts the dot and its arrow on the
       * chart, but none of that system's lanes, since the lane loop above
       * still only draws from explored systems. That is exactly what Nova
       * shows — a marked dot floating in uncharted space.
       */
      const isMission = missionSystems.get(sys.id);
      if (!explored && !adjacent && !isMission) continue;
      if (!explored) {
        ctx.fillStyle = "rgba(120,135,155,0.5)";
        ctx.beginPath();
        ctx.arc(pt.x, pt.y, 2.5, 0, Math.PI * 2);
        ctx.fill();
        if (isMission) missionArrow(pt, 2.5, isMission);
        this.mapNodes.push({ id: sys.id, x: pt.x, y: pt.y });
        continue;
      }
      this.mapNodes.push({ id: sys.id, x: pt.x, y: pt.y });
      const isCurrent = sys.id === this.player.systemId;
      const isDest = sys.id === this.routeDest;
      /*
       * Only an inhabited world counts as somewhere to land here. An
       * uninhabited rock ignores MinStatus and will always take you, but Nova
       * still draws its system as an empty one: Procyon and Capella hold
       * nothing but uninhabited stellars and are plain grey dots on the
       * original map, while Rigel is red on the strength of Rigel III alone.
       */
      const inhabited = sys.planets.some((p) => p.landable && !p.uninhabited);
      const r = isCurrent ? 6 : inhabited ? 4.5 : 3;
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
          (p) => p.landable && !p.uninhabited && this.clearedToLand(p, sys.govtId),
        );
      ctx.fillStyle = !inhabited ? "#4a5666" : welcome ? systemGovtColor(sys) : "#c85028";
      ctx.beginPath();
      ctx.arc(pt.x, pt.y, r, 0, Math.PI * 2);
      ctx.fill();
      if (isCurrent || isDest) {
        ctx.strokeStyle = isCurrent ? "#ffffff" : "#8be09b";
        ctx.lineWidth = 1.5;
        ctx.beginPath();
        ctx.arc(pt.x, pt.y, 10, 0, Math.PI * 2);
        ctx.stroke();
      }
      if (isMission) missionArrow(pt, r, isMission);
      const nearCursor = Math.hypot(pt.x - this.mouse.x, pt.y - this.mouse.y) < 42;
      if (labelAll || isCurrent || isDest || nearCursor) {
        ctx.font = isCurrent || isDest ? "600 12px Helvetica, Arial, sans-serif" : "11px Helvetica, Arial, sans-serif";
        ctx.fillStyle = isCurrent ? "#ffffff" : isDest ? "#a8e0b2" : "rgba(190,205,225,0.82)";
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
  private drawMapPanel(ctx: CanvasRenderingContext2D, w: number, h: number): void {
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

    label("Destination System:");
    value(sel.name, "#e8eef6");
    ty += 6;
    label("Government:");
    value(sel.govtName ?? "Independent");
    ty += 6;
    label("Legal Status:");
    const rec = getRecord(this.player, sel.govtId);
    value(
      rec === 0 ? "No Record" : rec > 0 ? `Good (${rec})` : `Criminal (${rec})`,
      rec < 0 ? "#e08a7a" : rec > 0 ? "#a8d9b0" : "#8fa2ba",
    );
    ty += 6;

    const explored = this.isExplored(sel.id);
    const ports = sel.planets.filter((p) => p.landable);
    if (explored && ports.length) {
      const goods = new Set<string>();
      const services = new Set<string>();
      for (const p of ports) {
        for (const c of COMMODITIES) if (p.prices[c.id] !== undefined) goods.add(c.name);
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
    } else if (!explored) {
      label("Status:");
      value("Uncharted", "#62748c");
    }

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
    ctx.textAlign = "right";
    ctx.fillStyle = "#62748c";
    ctx.fillText(formatDate(this.player.date), px - 12, fy);
    ctx.textAlign = "left";

    // button bar
    this.mapButtons = [];
    const buttons: { id: string; label: string; w: number }[] = [
      { id: "borders", label: this.mapBorders ? "Hide Borders" : "Show Borders", w: 98 },
      { id: "clear", label: "Clear Route", w: 88 },
      { id: "find", label: "Find", w: 60 },
      { id: "zoomout", label: "–", w: 26 },
      { id: "zoomin", label: "+", w: 26 },
      { id: "done", label: "Done", w: 74 },
    ];
    const gap = 8;
    const totalW = buttons.reduce((a, b) => a + b.w + gap, -gap);
    let bx = 20;
    const by = h - barH - 6;
    void totalW;
    for (const b of buttons) {
      const disabled = b.id === "clear" && this.route.length === 0;
      ctx.fillStyle = disabled ? "#3a1010" : "#6e1010";
      ctx.strokeStyle = "#7d1a1a";
      roundRect(ctx, bx, by, b.w, 24, 11);
      ctx.fill();
      ctx.stroke();
      ctx.font = "600 11px Helvetica, Arial, sans-serif";
      ctx.fillStyle = disabled ? "#7a5a5a" : "#ffdede";
      ctx.textAlign = "center";
      ctx.fillText(b.label, bx + b.w / 2, by + 16);
      if (!disabled) this.mapButtons.push({ id: b.id, x: bx, y: by, w: b.w, h: 24 });
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
