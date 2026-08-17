import { asset } from "../asset";
import { type Bits, evalTest } from "../game/bits";
import { setCalendar } from "../game/calendar";
import type {
  SheetSprite,
  ShipSprite,
  SpriteManifest,
  StellarSprite,
} from "../engine/sprites";
import type {
  ColrDef,
  CharTemplate,
  CommodityDef,
  CronType,
  FleetType,
  InterfaceDef,
  RankType,
  BoomType,
  OopsType,
  NebuType,
  RoidType,
  DudeType,
  PersonType,
  MissionType,
  OutfitType,
  PlanetDef,
  PriceLevel,
  ShipType,
  StockItem,
  StockWeapon,
  SystemDef,
  SystemVariant,
  WeaponType,
} from "../types";

/**
 * The galaxy is loaded at boot from public/nova/galaxy.json, which is extracted
 * from the player's own EV Nova data files by scripts/extract-nova.mjs.
 */

// EV Nova's six commodities. Price-level bits come from each spöb's flags field.
export const COMMODITIES: CommodityDef[] = [
  { id: "food", name: "Food", basePrice: 100 },
  { id: "industrial", name: "Industrial Goods", basePrice: 425 },
  { id: "medical", name: "Medical Supplies", basePrice: 650 },
  { id: "luxury", name: "Luxury Goods", basePrice: 900 },
  { id: "metal", name: "Metal", basePrice: 225 },
  { id: "equipment", name: "Equipment", basePrice: 750 },
];

// spöb flags: bits 28/24/20/16/12/8 hold low(1)/med(2)/high(4) per commodity (Nova Bible)
const COMMODITY_FLAG_SHIFT: Record<string, number> = {
  food: 28,
  industrial: 24,
  medical: 20,
  luxury: 16,
  metal: 12,
  equipment: 8,
};

export const PRICE_MULT: Record<PriceLevel, number> = {
  low: 0.8,
  med: 1.0,
  high: 1.25,
};

export function priceAt(commodityId: string, level: PriceLevel): number {
  const def = COMMODITIES.find((c) => c.id === commodityId)!;
  return Math.round(def.basePrice * PRICE_MULT[level]);
}

// spöb flag bits
const F_CAN_LAND = 0x1;
const F_EXCHANGE = 0x2;
const F_OUTFITTER = 0x4;
const F_SHIPYARD = 0x8;
const F_STATION = 0x10;
const F_UNINHABITED = 0x20;
const F_BAR = 0x40;

/**
 * Nova ship stat units → engine units (px/s, px/s², rad/s).
 * Nova Bible: Maneuver 10 ≈ 30°/sec; Speed/Accel 300 is "average".
 * Speed/accel factors are calibrated for playfeel at our world scale.
 */
export function convertShipStats(raw: {
  speed: number;
  accel: number;
  turn: number;
}): {
  maxSpeed: number;
  accel: number;
  turnRate: number;
} {
  return {
    maxSpeed: raw.speed * 0.6,
    accel: raw.accel * 0.25,
    turnRate: raw.turn * 3 * (Math.PI / 180),
  };
}

interface RawSystem {
  id: number;
  name: string;
  x: number;
  y: number;
  links: number[];
  spobs: number[];
  dudes: { id: number; prob: number }[];
  persons?: { id: number; prob: number }[];
  avgShips: number;
  govt: number;
  asteroids: number;
  astTypes: number;
  interference: number;
  bkgndColor: number;
  murk: number;
  message: number;
  reinfFleet: number;
  reinfTime: number;
  reinfInterval: number;
  /** sÿst Visibility for the story-gated systems; empty means always present */
  visibleIf?: string[];
  /** every variant's mutable content, when the name has more than one */
  variants?: RawSystemVariant[];
}

interface RawSystemVariant {
  id: number;
  visibility: string;
  links: number[];
  spobs: number[];
  dudes: { id: number; prob: number }[];
  persons?: { id: number; prob: number }[];
  avgShips: number;
  govt: number;
  asteroids: number;
  astTypes: number;
  interference: number;
  bkgndColor: number;
  murk: number;
  message: number;
  reinfFleet: number;
  reinfTime: number;
  reinfInterval: number;
}

interface RawColr {
  buttonUp: number;
  buttonDown: number;
  buttonGrey: number;
  menuFont: string;
  menuFontSize: number;
  menuBright: number;
  menuDim: number;
  gridLine: number;
  gridSelection: number;
  progressBar: { top: number; left: number; bottom: number; right: number };
  progBright: number;
  progDim: number;
  progOutline: number;
  buttons: { x: number; y: number }[];
  floatingMap: number;
  listText: number;
  listBkgnd: number;
  listHilite: number;
  escortHilite: number;
  buttonFont: string;
  buttonFontSize: number;
  logo: { x: number; y: number };
  rollover: { x: number; y: number };
  slides: { x: number; y: number }[];
}

interface RawRoid {
  id: number;
  name: string;
  strength: number;
  spinRate: number;
  yieldType: number;
  yieldQty: number;
  partCount: number;
  partColor: number;
  fragTypes: number[];
  fragCount: number;
  explodeType: number;
  mass: number;
}

interface RawSpob {
  id: number;
  name: string;
  x: number;
  y: number;
  graphic: number;
  flags: number;
  techLevel: number;
  specialTechs: number[];
  govt: number;
  minStatus: number;
  landingPict: number;
  ambientSnd: number | null;
  ambientLoop: boolean;
  flags2: number;
  hyperLinks: number[];
  /** CustSndID as emerge degrees when this is a gate; absent on older extracts */
  emergeAngle?: number | null;
  tribute: number;
  defDude: number;
  defCount: number;
  onDominate: string;
  onRelease: string;
}

interface RawShip {
  contribute?: [number, number];
  require?: [number, number];
  id: number;
  name: string;
  buyRandom: number;
  hireRandom: number;
  onCapture: string;
  onRetire: string;
  subtitle: string;
  flags3: number;
  upgradeTo: number;
  escUpgrdCost: number;
  escSellValue: number;
  escortType: number;
  shortName: string;
  longName: string;
  inherentAi: number;
  maxGuns: number;
  maxTurrets: number;
  length: number;
  cargo: number;
  shield: number;
  accel: number;
  speed: number;
  turn: number;
  fuel: number;
  freeMass: number;
  armor: number;
  shieldRech: number;
  techLevel: number;
  cost: number;
  mass: number;
  crew: number;
  strength: number;
  inherentGovt: { govt: number; combat: boolean; attributes: boolean } | null;
  flags: number;
  flags2: number;
  avail: string;
  desc: string;
  stockWeapons: StockWeapon[];
  defaultItems: StockItem[];
}

interface RawWeapon {
  id: number;
  name: string;
  explodType: number;
  reload: number;
  duration: number;
  armorDmg: number;
  shieldDmg: number;
  guidance: number;
  speed: number;
  ammoType: number;
  graphic: number;
  accuracy: number;
  sound: number;
  impact: number;
  proxRadius: number;
  blastRadius: number;
  flags: number;
  jamVuln: number[];
  ionization: number;
  exitType: number;
  seeker: number;
  guidedTurn: number;
  burstCount: number;
  burstReload: number;
  subCount: number;
  subType: number;
  subTheta: number;
  subLimit: number;
  proxSafety: number;
  maxAmmo: number;
  recoil: number;
  liDensity: number;
  durability: number;
  flags3: number;
  beamLength: number;
  beamWidth: number;
  beamColor: number;
  coronaColor: number;
}

interface RawOutfit {
  buyRandom: number;
  scanMask: number;
  itemClass: number;
  contribute?: [number, number];
  require?: [number, number];
  requireGovt?: number;
  id: number;
  name: string;
  displayWeight: number;
  mass: number;
  techLevel: number;
  max: number;
  cost: number;
  avail: string;
  onPurchase: string;
  onSell: string;
  flags: number;
  mods: [number, number][];
  desc: string;
}

export interface RawGovt {
  id: number;
  name: string;
  voiceType: number;
  flags: number;
  flags2: number;
  commName: string;
  /** Require: the Bible's travel-permit gate; zero on all 68 stock govts */
  require?: [number, number];
  /** InhJam1-4: inherent jamming percentage per missile guidance type */
  inhJam?: number[];
  mediumName?: string;
  newsPic: number;
  /** the ïntf this government's own ships fly behind */
  interfaceId: number;
  /** gövt Color: the theme colour, 00RRGGBB. 0 means "unused". */
  color: number;
  /** gövt ShipColor: hull tint, 0 on every shipped government */
  shipColor: number;
  /** the legal model: tolerance, fine, and the penalty for each kind of crime */
  crimeTol: number;
  scanFine: number;
  /** the 16-bit mask this government scans for */
  scanMask: number;
  smugPenalty: number;
  disabPenalty: number;
  boardPenalty: number;
  killPenalty: number;
  shootPenalty: number;
  initialRec: number;
  maxOdds: number;
  classes: number[];
  allies: number[];
  enemies: number[];
}

interface RawGalaxy {
  systems: RawSystem[];
  /** dropped story-variant sÿst id -> canonical id */
  systemAlias?: Record<string, number>;
  spobs: RawSpob[];
  govts: RawGovt[];
  descs: Record<string, string>;
  ships: RawShip[];
  weapons: RawWeapon[];
  outfits: RawOutfit[];
  missions: MissionType[];
  junks: JunkType[];
  dudes: DudeType[];
  persons: PersonType[];
  strLists: Record<string, string[]>;
  chars: CharTemplate[];
  roids: RawRoid[];
  interfaces: InterfaceDef[];
  colr: RawColr | null;
  crons: CronType[];
  fleets: FleetType[];
  ranks: RankType[];
  booms: BoomType[];
  oopses: OopsType[];
  nebulae: NebuType[];
}

export let SYSTEMS: SystemDef[] = [];
export let START_SYSTEM_ID = "";
/** the scenario's starting template (chär), if the data provides one */
export let START_TEMPLATE: CharTemplate | null = null;
export let SHIP_SPRITES: Record<string, ShipSprite> = {};
export let GLOW_SPRITES: Record<string, SheetSprite> = {};
/** running lights (shän LightImageID), drawn over the hull and blinked */
export let LIGHT_SPRITES: Record<string, SheetSprite> = {};
/** weapon-glow overlays (shän WeapImageID), drawn while the ship fires */
export let WEAP_GLOW_SPRITES: Record<string, SheetSprite> = {};
export let WEAPON_SPRITES: Record<string, SheetSprite> = {};
export let BOOM_SPRITES: Record<string, SheetSprite> = {};
export let SHIPS: Record<string, ShipType> = {};
/** ship ids sorted by cost, for shipyard listings */
export let SHIP_ORDER: string[] = [];
export let WEAPONS: Record<string, WeaponType> = {};
export let OUTFITS: Record<string, OutfitType> = {};
/** outfit ids in shop display order */
export let OUTFIT_ORDER: string[] = [];
export let MISSIONS: Record<string, MissionType> = {};
export let DUDES: Record<string, DudeType> = {};
export let PERSONS: Record<string, PersonType> = {};
/** STR# lists we use: 7100 comms quotes, 7101 radio quotes */
export let STR_LISTS: Record<string, string[]> = {};
export let ROIDS: Record<string, RoidType> = {};
export let CRONS: CronType[] = [];
export let FLEETS: FleetType[] = [];
export let RANKS: Record<string, RankType> = {};
export let BOOMS: Record<string, BoomType> = {};
export let OOPSES: OopsType[] = [];
export let NEBULAE: NebuType[] = [];
/** the shipped status-bar palette */
/** Fallback matching Nova's own ïntf 128, used until galaxy.json loads. */
/**
 * Every ïntf, and the one the status bar is currently drawn from. A hull with
 * an inherent government flies behind that government's own bar (gövt
 * Interface), which is why a captured Polaris ship changes the whole panel.
 */
export let ALL_INTERFACES: InterfaceDef[] = [];
let DEFAULT_INTERFACE: InterfaceDef | null = null;

/** Point the status bar at a government's ïntf, or back to the default. */
export function setInterfaceForGovt(govtId: number | null): void {
  const wanted =
    govtId !== null ? GOVTS[String(govtId)]?.interfaceId : undefined;
  const found =
    wanted !== undefined
      ? ALL_INTERFACES.find((i) => i.id === wanted)
      : undefined;
  if (found) INTERFACE = found;
  else if (DEFAULT_INTERFACE) INTERFACE = DEFAULT_INTERFACE;
  publishInterfaceVars();
}

/**
 * Publish the live ïntf as CSS variables. The flight sidebar is HTML (see
 * ui/hud.ts), so this is the only route by which StatusFont/StatFontSize/
 * SubtitleSize, BrightText/DimText and the three gauge colours reach it — and
 * it is why flying a Polaris hull restyles the whole plate rather than just
 * swapping a name. The stylesheet carries ïntf 128's own values as fallbacks,
 * so the panel is right before galaxy.json has loaded.
 */
export function publishInterfaceVars(): void {
  if (typeof document === "undefined") return;
  const css = document.documentElement.style;
  const i = INTERFACE;
  css.setProperty("--hud-font", `"${i.statusFont}"`);
  css.setProperty("--hud-size", `${i.statFontSize}px`);
  css.setProperty("--hud-sub-size", `${i.subtitleSize}px`);
  css.setProperty("--hud-bright", i.brightText);
  css.setProperty("--hud-dim", i.dimText);
  css.setProperty("--hud-shield", i.shieldColor);
  css.setProperty("--hud-armor", i.armorColor);
  css.setProperty("--hud-fuel", i.fuelFull);
  css.setProperty("--hud-fuel-part", i.fuelPartial);
}

/**
 * The cölr resource: interface colours, fonts and the main-menu layout. Null
 * until the universe loads, so callers fall back to their own defaults.
 */
export let COLR: ColrDef | null = null;

export let INTERFACE: InterfaceDef = {
  id: 128,
  name: "Default",
  brightText: "#ffffff",
  dimText: "#888888",
  radarArea: { x: 8, y: 8, w: 176, h: 176 },
  brightRadar: "#ffffff",
  dimRadar: "#808080",
  shieldArea: { x: 35, y: 199, w: 149, h: 7 },
  shieldColor: "#bd0000",
  armorArea: { x: 35, y: 216, w: 149, h: 7 },
  armorColor: "#a6a6a6",
  fuelArea: { x: 35, y: 234, w: 149, h: 7 },
  fuelFull: "#4c5c6f",
  fuelPartial: "#28333f",
  navArea: { x: 8, y: 254, w: 176, h: 32 },
  weapArea: { x: 8, y: 300, w: 176, h: 15 },
  targArea: { x: 8, y: 330, w: 176, h: 112 },
  cargoArea: { x: 8, y: 458, w: 176, h: 94 },
  statusFont: "Geneva",
  statFontSize: 12,
  subtitleSize: 10,
  statusBkgnd: 700,
};
export let ROID_SPRITES: Record<string, SheetSprite> = {};
/** EV Nova's own targeting reticle (spïn 650) */
export let MENU_SPRITES: Record<string, SheetSprite> = {};
export let CURSOR_SPRITE: SheetSprite | null = null;
export let DESCS: Record<string, string> = {};
export let JUNK_NAMES: Record<string, string> = {};

/**
 * A jünk: one of Nova's special commodities. Unlike the six exchange goods
 * these trade only at named worlds — `soldAt` lists the spöbs that stock it,
 * `boughtAt` the ones that will pay for it. Asteroids yield them too, which is
 * what röid YieldType's 1000+n encoding refers to.
 */
export interface JunkType {
  /** which governments treat this cargo as contraband */
  scanMask: number;
  id: number;
  name: string;
  soldAt: number[];
  boughtAt: number[];
  price: number;
  /** control-bit expressions gating whether this can be bought / sold */
  buyOn: string;
  sellOn: string;
}

export let JUNKS: Record<string, JunkType> = {};

/** Cargo keys for jünk are namespaced so they can't collide with commodities. */
export const JUNK_CARGO_PREFIX = "junk:";

export function junkCargoKey(junkId: number): string {
  return `${JUNK_CARGO_PREFIX}${junkId}`;
}

export function junkFromCargoKey(key: string): JunkType | null {
  if (!key.startsWith(JUNK_CARGO_PREFIX)) return null;
  return JUNKS[key.slice(JUNK_CARGO_PREFIX.length)] ?? null;
}

/** wëap ExplodType -> bööm resource id, or null for no impact explosion. */
function boomFromExplodType(explodType: number): number | null {
  const index = explodType >= 1000 ? explodType - 1000 : explodType;
  return index >= 0 && index <= 14 ? 128 + index : null;
}

/** The röid YieldType encoding: 0-5 a commodity, 1000+n the nth jünk. */
export function roidYield(
  yieldType: number,
): { commodity: number } | { junk: JunkType } | null {
  if (yieldType >= 0 && yieldType <= 5) return { commodity: yieldType };
  if (yieldType >= 1000) {
    const junk = JUNKS[String(128 + (yieldType - 1000))];
    if (junk) return { junk };
  }
  return null;
}
/** spob id -> {planet, systemId} for every spob placed in the visible galaxy */
export let SPOB_INDEX = new Map<
  string,
  { planet: PlanetDef; systemId: string }
>();
/** spob govt ids (raw), for mission availability checks */
export let SPOB_GOVT = new Map<string, number>();
/**
 * Every stellar by id, **including the 68 that belong to no system** — the
 * alternate copies of a world that Nova's duplicate-stellar rule resolves by
 * name and coordinates. SPOB_INDEX holds only the placed ones, so mission
 * destinations naming a duplicate need this to find their twin.
 */
export let SPOBS_BY_ID = new Map<string, PlanetDef>();
export interface PictInfo {
  file: string;
  w: number;
  h: number;
  /** the Mac resource's own name, when the .rez carried one */
  name?: string;
}

let stellarSprites: Record<string, StellarSprite> = {};
let landingPicts: Record<string, PictInfo> = {};
export let SHIPYARD_PICTS: Record<string, PictInfo> = {};
export let OUTFIT_PICTS: Record<string, PictInfo> = {};
export let UI_PICTS: Record<string, PictInfo> = {};
export let TARGET_PICTS: Record<string, PictInfo> = {};
export let SHIPINFO_PICTS: Record<string, PictInfo> = {};
export let NEBU_PICTS: Record<string, PictInfo> = {};
let govtRelations = new Map<
  number,
  { classes: number[]; allies: number[]; enemies: number[] }
>();
export let ALL_GOVT_IDS: number[] = [];
export let GOVT_NAMES: Record<string, string> = {};
/** gövt Flags / Flags2, and the short CommName shown in the comms panel. */
export let GOVT_FLAGS: Record<string, number> = {};
export let GOVT_FLAGS2: Record<string, number> = {};
export let GOVT_COMM_NAMES: Record<string, string> = {};
/** gövt NewsPic: backdrop for the holovid news window (PICT 9000 = generic). */
export let GOVT_NEWS_PICS: Record<string, number> = {};
/** every gövt field, by id — the legal numbers live here */
export let GOVTS: Record<string, RawGovt> = {};
/** gövt VoiceType, by govt id — which bank of escort speech its ships use. */
export let GOVT_VOICES: Record<string, number> = {};
let systemsById = new Map<string, SystemDef>();
/** dropped story-variant sÿst id -> the canonical id that replaced it */
let SYSTEM_ALIAS = new Map<string, string>();

/**
 * The ship type whose picture stands for this one. Nova keeps one shipyard and
 * one target picture per distinct hull and reuses it "for all higher-numbered
 * ship types with the same base sprites" — so the picture belongs to the lowest
 * ship id drawing from the same rlëD, which the sprite manifest records as
 * baseId. Walking down ids instead, as this used to, crosses hull boundaries
 * freely: it put a Rebel Thunderhead in front of 95 unrelated ship types,
 * including every second-hand Valkyrie and Shuttle.
 */
function pictShipId(shipId: string): number {
  return SHIP_SPRITES[shipId]?.baseId ?? parseInt(shipId, 10);
}

/** Shipyard portrait for a ship type (PICT 5000 + id - 128). */
export function shipyardPict(shipId: string): PictInfo | null {
  return SHIPYARD_PICTS[String(5000 + pictShipId(shipId) - 128)] ?? null;
}

/** The red target-display silhouette for a ship (PICT 3000 + id - 128). */
export function targetPict(shipId: string): PictInfo | null {
  return TARGET_PICTS[String(3000 + pictShipId(shipId) - 128)] ?? null;
}

/**
 * Portraits for the përs captains Nova gives a face instead of a hull. This
 * used to be a hand-written map of the single case anyone had spotted; the
 * link is a real field, përs HailPict, and reading it finds exactly that one
 * captain — 640 "Zero Wing", pointing at PICT 7800, which is named "CATS"
 * after the villain who says his line. A plug-in's captains now work too.
 */
export function personPict(personId: number | null): PictInfo | null {
  if (personId === null) return null;
  const pictId = PERSONS[String(personId)]?.hailPict ?? 0;
  return pictId > 0 ? (UI_PICTS[String(pictId)] ?? null) : null;
}

/**
 * The full-bleed 600x400 hull render Nova puts behind the shipyard's Info
 * dialog: the same hull as the 5000-series showroom shot, but posed against a
 * planet or a nebula instead of a grey card. PICT 20000 + shipID, keyed on the
 * base hull for the same reason the showroom shot is — one picture per rlëD,
 * shared by every ship type drawing from it.
 *
 * Nova files one of the 63 wrongly. The Rebel IDA Frigate is ship 412, but its
 * picture — which names itself, and shows an IDA Frigate in rebel green — sits
 * at 20381, where ship 381 is a Vell-os Dart that already has its own at
 * 20173. A by-name fallback recovers it, the same trick outfitPict uses for
 * variants, and here it rescues exactly the three Rebel IDA Frigate hulls and
 * nothing else. The Kestrel and the Escape Pod have no picture at all; the
 * caller falls back to the showroom shot.
 */
export function shipInfoPict(shipId: string): PictInfo | null {
  const direct = SHIPINFO_PICTS[String(20000 + pictShipId(shipId))];
  if (direct) return direct;
  const name = SHIPS[shipId]?.name;
  if (!name) return null;
  return shipInfoPictsByName.get(normPictName(name)) ?? null;
}

/** Outfit pictures indexed by their own resource name, for the variant lookup. */
let outfitPictsByName = new Map<string, PictInfo>();
/** The same index over the info-dialog renders, for the misfiled one. */
let shipInfoPictsByName = new Map<string, PictInfo>();

function normPictName(name: string): string {
  return name
    .split(";")[0]
    .toLowerCase()
    .replace(/[^a-z0-9]/g, "");
}

/**
 * Outfitter picture for an outfit (PICT 6000 + id - 128). Every picture Nova
 * ships maps onto a real outfit this way, so the index itself is sound — but
 * fourteen outfits have none of their own, and a few of those are variants of
 * something that does: "Thorium Reactor - ionisation" beside "Thorium Reactor".
 * Those fall back to the base item's picture, matched on the name the picture
 * carries and only when it is a prefix of the variant's, so a fallback can
 * never wander onto an unrelated item. The rest keep the named placeholder.
 */
export function outfitPict(outfId: string): PictInfo | null {
  const direct = OUTFIT_PICTS[String(6000 + parseInt(outfId, 10) - 128)];
  if (direct) return direct;
  const name = OUTFITS[outfId]?.name;
  if (!name) return null;
  const want = normPictName(name);
  const exact = outfitPictsByName.get(want);
  if (exact) return exact;
  for (const [pictName, pic] of outfitPictsByName) {
    if (pictName.length > 4 && want.startsWith(pictName)) return pic;
  }
  return null;
}

/**
 * Best nebula image for a given on-screen size. Each nëbu owns seven PICT
 * slots starting at 9500 + (id - 128) * 7, sorted small to large; Nova picks
 * the closest and stretches it.
 */
export function nebulaPict(nebuId: number, wantW: number): PictInfo | null {
  const base = 9500 + (nebuId - 128) * 7;
  let best: PictInfo | null = null;
  let bestGap = Infinity;
  for (let i = 0; i < 7; i++) {
    const pic = NEBU_PICTS[String(base + i)];
    if (!pic) continue;
    const gap = Math.abs(pic.w - wantW);
    if (gap < bestGap) {
      bestGap = gap;
      best = pic;
    }
  }
  return best;
}

/** Is govtB an ally of govtA? (B's classes appear in A's ally-class list.) */
export function govtAllied(a: number, b: number): boolean {
  const ra = govtRelations.get(a);
  const rb = govtRelations.get(b);
  if (!ra || !rb) return false;
  return rb.classes.some((c) => ra.allies.includes(c));
}

/** Is govtB an enemy of govtA? */
export function govtEnemy(a: number, b: number): boolean {
  const ra = govtRelations.get(a);
  const rb = govtRelations.get(b);
  if (!ra || !rb) return false;
  return rb.classes.some((c) => ra.enemies.includes(c));
}

/** Same govt, or sharing any class. */
export function govtClassmate(a: number, b: number): boolean {
  if (a === b) return true;
  const ra = govtRelations.get(a);
  const rb = govtRelations.get(b);
  if (!ra || !rb) return false;
  return rb.classes.some((c) => ra.classes.includes(c));
}

const PLANET_PALETTE = [
  "#5f9e57",
  "#4b9db8",
  "#b06a44",
  "#7d8fd1",
  "#a89078",
  "#9aa7b8",
  "#c2a35a",
  "#6da58a",
  "#a06e9a",
  "#8fb0c9",
];

/** Unowned space, and governments that set no Color of their own. */
const NEUTRAL_GOVT_COLOR = "#8a97a8";

/** spöb MinStatus sentinels: no requirement at all, and never landable. */
export const MIN_STATUS_IGNORED = -32767;
export const MIN_STATUS_NEVER = 32767;

/**
 * Whose legal record a world's MinStatus is measured against.
 *
 * The Bible calls MinStatus "the point on your record in the current system",
 * which reads as the system's owner — but the field sits in the spöb's own
 * "governmental affiliation" pair, immediately behind Govt, and 18 of the 170
 * gated stellars belong to a different government than the system around them.
 * Spacedock V settles it: a Federation station (MinStatus 2) parked in
 * Roughnecks space, and the last two legs of the Federation Resupply chain
 * both touch it — Fed5 returns there and Fed6 is offered there — while the
 * chain pays only in Federation record (+2 a leg from Fed2 on). Measured
 * against the system's Roughnecks record, which nothing in that storyline ever
 * raises, the Federation storyline cannot be finished.
 *
 * The system is still the fallback: four gated stellars (Reflex-ion, Pan,
 * Beacon and Keystone, all MinStatus -5) are independent and have no
 * government of their own to have an opinion.
 */
export function landingGovtId(planet: PlanetDef, systemGovtId: number): number {
  return planet.govtId >= 128 ? planet.govtId : systemGovtId;
}

/**
 * Will this world clear you to land, given your legal record with the
 * government that gates it (see landingGovtId)? The Bible: MinStatus is "the
 * point on your record ... that you'll be denied landing clearance", and it is
 * ignored outright on an uninhabited stellar.
 */
export function landingAllowed(planet: PlanetDef, record: number): boolean {
  if (!planet.landable) return false;
  if (planet.uninhabited || planet.minStatus === MIN_STATUS_IGNORED)
    return true;
  if (planet.minStatus === MIN_STATUS_NEVER) return false;
  return record >= planet.minStatus;
}

/**
 * gövt Color @164 — the government's own theme colour, which is what Nova
 * paints the star map with. Sixteen of the 68 read #000000, the Bible's
 * "unused"; those and independent space fall back to a neutral grey.
 */
function govtRgb(govtId: number): number {
  if (govtId < 128) return 0;
  return GOVTS[String(govtId)]?.color ?? 0;
}

function rgbHex(n: number): string {
  return `#${(n & 0xffffff).toString(16).padStart(6, "0")}`;
}

function decodePrices(flags: number): Partial<Record<string, PriceLevel>> {
  const prices: Partial<Record<string, PriceLevel>> = {};
  for (const [commodity, shift] of Object.entries(COMMODITY_FLAG_SHIFT)) {
    const bits = (flags >>> shift) & 0x7;
    if (bits & 0x1) prices[commodity] = "low";
    else if (bits & 0x2) prices[commodity] = "med";
    else if (bits & 0x4) prices[commodity] = "high";
  }
  return prices;
}

function makePlanet(sp: RawSpob, descs: Record<string, string>): PlanetDef {
  const isStation = (sp.flags & F_STATION) !== 0;
  const stellar = stellarSprites[String(1000 + sp.graphic)];
  // custom landscape if set, else the default landscape for this stellar type
  const pict =
    (sp.landingPict >= 128
      ? landingPicts[String(sp.landingPict)]
      : undefined) ?? landingPicts[String(10000 + sp.graphic)];
  return {
    id: String(sp.id),
    name: sp.name,
    kind: isStation ? "station" : "planet",
    desc:
      descs[String(sp.id)] ??
      (sp.flags & F_UNINHABITED
        ? "No data available on this world."
        : "A quiet port with little to distinguish it."),
    pos: { x: sp.x, y: sp.y },
    radius: stellar ? Math.max(stellar.w, stellar.h) / 2 : isStation ? 36 : 60,
    color: PLANET_PALETTE[Math.abs(sp.graphic) % PLANET_PALETTE.length],
    spriteFile: stellar ? stellar.file : null,
    spriteW: stellar?.w ?? 0,
    spriteH: stellar?.h ?? 0,
    spriteFrames: stellar?.frames ?? 1,
    landable: (sp.flags & F_CAN_LAND) !== 0,
    exchange: (sp.flags & F_EXCHANGE) !== 0,
    uninhabited: (sp.flags & F_UNINHABITED) !== 0,
    shipyard: (sp.flags & F_SHIPYARD) !== 0,
    outfitter: (sp.flags & F_OUTFITTER) !== 0,
    bar: (sp.flags & F_BAR) !== 0,
    techLevel: sp.techLevel,
    minStatus: sp.minStatus ?? MIN_STATUS_IGNORED,
    govtId: sp.govt ?? -1,
    specialTechs: sp.specialTechs ?? [],
    landingPictFile: pict ? pict.file : null,
    ambientSnd: sp.ambientSnd ?? null,
    ambientLoop: sp.ambientLoop ?? false,
    tribute: sp.tribute ?? 0,
    defDude: sp.defDude ?? -1,
    defCount: sp.defCount ?? 0,
    onDominate: sp.onDominate ?? "",
    onRelease: sp.onRelease ?? "",
    isHypergate: ((sp.flags2 ?? 0) & 0x1000) !== 0,
    isWormhole: ((sp.flags2 ?? 0) & 0x2000) !== 0,
    sellOnly: ((sp.flags2 ?? 0) & 0x0400) !== 0,
    hyperLinks: (sp.hyperLinks ?? []).map(String),
    emergeAngle:
      typeof sp.emergeAngle === "number" &&
      sp.emergeAngle >= 0 &&
      sp.emergeAngle <= 359
        ? sp.emergeAngle
        : null,
    /*
     * Bible: CustPicID on animated hypergates is the open→working split.
     * 0 means halfway; stock working gates use 37 of 42 frames. Non-gates
     * and broken rings leave it null so the drawer holds the last frame.
     */
    gateAnimSplit: (() => {
      const isHg = ((sp.flags2 ?? 0) & 0x1000) !== 0;
      if (!isHg) return null;
      const pic = sp.landingPict;
      if (pic === 0) return 0; // "first half / second half" sentinel
      if (pic > 0 && pic < 128) return pic;
      return null;
    })(),
    prices: decodePrices(sp.flags),
  };
}

/**
 * Nova's inline text-selection tags, resolved at display time.
 *
 * The Bible gives three, all sharing one shape and all honouring a leading
 * "!": `{bXXX "if set" "if clear"}` on a control bit, `{G "male" "female"}` on
 * the pilot's gender, and `{P[days] "registered" "unregistered"}` on whether
 * the game is paid for. "Unlike the control bit test strings, you cannot
 * perform compound tests in a dësc resource", the second string is optional
 * ("if there is no second string, nothing will be substituted"), and a quote
 * inside an arm is C-escaped: `{b002 "Dave \"pipeline\" Williams"}`.
 *
 * The selector letter is matched case-insensitively because Nova's own data
 * is inconsistent about it — 207 `{G`, 7 `{g`, 114 `{bN`, 1 `{BN`.
 *
 * P is always true here: this engine reads the player's own data files and is
 * not a shareware build, the same answer `evalTest` gives the ncb Pxxx test.
 *
 * **This must happen at display time, not at load.** The same description
 * reads differently once the story moves on, and gender is per-pilot while the
 * dësc table is shared by every pilot. An earlier pass collapsed {G} and {P}
 * as the galaxy was parsed, always taking the first arm, which made every
 * description in the game male.
 */
export function resolveNovaText(
  s: string,
  bits: Record<string, boolean>,
  opts: { female?: boolean } = {},
): string {
  return s.replace(
    /\{(!?)([bB]\d+|[gG]|[pP]\d*)\s*"((?:[^"\\]|\\.)*)"(?:\s*"((?:[^"\\]|\\.)*)")?\}/g,
    (
      _m,
      neg: string,
      sel: string,
      yes: string,
      no: string | undefined,
    ) => {
      const kind = sel[0].toLowerCase();
      let value: boolean;
      if (kind === "b") value = bits[String(parseInt(sel.slice(1), 10))] === true;
      else if (kind === "g") value = !opts.female;
      else value = true;
      if (neg === "!") value = !value;
      return unescapeNova(value ? yes : (no ?? ""));
    },
  );
}

function unescapeNova(s: string): string {
  return s.replace(/\\(.)/g, "$1");
}

export async function loadUniverse(): Promise<void> {
  const [resp, spriteResp, pictResp] = await Promise.all([
    fetch(asset("nova/galaxy.json")),
    fetch(asset("nova/sprites.json")),
    fetch(asset("nova/picts.json")),
  ]);
  if (!resp.ok) throw new Error(`failed to load galaxy.json: ${resp.status}`);
  const raw = (await resp.json()) as RawGalaxy;
  if (pictResp.ok) {
    const picts = (await pictResp.json()) as {
      land: Record<string, PictInfo>;
      shipyard: Record<string, PictInfo>;
      outfit: Record<string, PictInfo>;
      ui?: Record<string, PictInfo>;
      nebu?: Record<string, PictInfo>;
      target?: Record<string, PictInfo>;
      shipinfo?: Record<string, PictInfo>;
    };
    landingPicts = picts.land ?? {};
    SHIPYARD_PICTS = picts.shipyard ?? {};
    OUTFIT_PICTS = picts.outfit ?? {};
    // index by resource name once, for the variant fallback in outfitPict
    outfitPictsByName = new Map();
    for (const pic of Object.values(OUTFIT_PICTS)) {
      if (!pic.name) continue;
      const key = normPictName(pic.name);
      if (!outfitPictsByName.has(key)) outfitPictsByName.set(key, pic);
    }
    UI_PICTS = picts.ui ?? {};
    NEBU_PICTS = picts.nebu ?? {};
    TARGET_PICTS = picts.target ?? {};
    SHIPINFO_PICTS = picts.shipinfo ?? {};
    shipInfoPictsByName = new Map();
    for (const pic of Object.values(SHIPINFO_PICTS)) {
      if (!pic.name) continue;
      const key = normPictName(pic.name);
      if (!shipInfoPictsByName.has(key)) shipInfoPictsByName.set(key, pic);
    }
  }
  if (spriteResp.ok) {
    const manifest = (await spriteResp.json()) as SpriteManifest;
    SHIP_SPRITES = manifest.ships;
    stellarSprites = manifest.stellars;
    WEAPON_SPRITES = manifest.weapons ?? {};
    BOOM_SPRITES = manifest.booms ?? {};
    GLOW_SPRITES = manifest.glows ?? {};
    LIGHT_SPRITES = manifest.lights ?? {};
    WEAP_GLOW_SPRITES = manifest.weapGlows ?? {};
    ROID_SPRITES = manifest.roids ?? {};
    CURSOR_SPRITE = manifest.ui?.cursor ?? null;
    MENU_SPRITES = manifest.menu ?? {};
  }

  SHIPS = {};
  for (const s of raw.ships ?? []) {
    SHIPS[String(s.id)] = {
      id: String(s.id),
      name: s.name,
      desc: s.desc,
      cost: s.cost,
      cargo: s.cargo,
      fuelJumps: Math.max(1, Math.floor(s.fuel / 100)),
      shield: s.shield,
      armor: s.armor,
      techLevel: s.techLevel,
      mass: s.mass,
      inherentAi: s.inherentAi ?? 0,
      crew: s.crew ?? 0,
      strength: s.strength ?? 0,
      flags: s.flags ?? 0,
      flags2: s.flags2 ?? 0,
      avail: s.avail ?? "",
      // ShieldRech is points x1000 per frame at 30 fps
      shieldRechPerSec: (s.shieldRech / 1000) * 30,
      rawSpeed: s.speed,
      rawAccel: s.accel,
      rawTurn: s.turn,
      freeMass: s.freeMass,
      maxGuns: s.maxGuns ?? 0,
      maxTurrets: s.maxTurrets ?? 0,
      length: s.length ?? 0,
      buyRandom: s.buyRandom ?? 0,
      inherentGovt: s.inherentGovt ?? null,
      shortName: s.shortName || s.name.split(";")[0],
      longName: s.longName || s.name.split(";")[0],
      stockWeapons: s.stockWeapons ?? [],
      defaultItems: s.defaultItems ?? [],
      hireRandom: s.hireRandom ?? 0,
      onCapture: s.onCapture ?? "",
      onRetire: s.onRetire ?? "",
      subtitle: s.subtitle ?? "",
      flags3: s.flags3 ?? 0,
      upgradeTo: s.upgradeTo ?? -1,
      escUpgrdCost: s.escUpgrdCost ?? 0,
      escSellValue: s.escSellValue ?? 0,
      escortType: s.escortType ?? -1,
      contribute: (s.contribute ?? [0, 0]) as [number, number],
      require: (s.require ?? [0, 0]) as [number, number],
      ...convertShipStats(s),
    };
  }
  SHIP_ORDER = Object.keys(SHIPS).sort((a, b) => SHIPS[a].cost - SHIPS[b].cost);

  WEAPONS = {};
  for (const w of raw.weapons ?? []) {
    WEAPONS[String(w.id)] = {
      id: String(w.id),
      name: w.name,
      reloadSec: Math.max(w.reload, 1) / 30,
      durationSec: Math.max(w.duration, 1) / 30,
      armorDmg: w.armorDmg,
      shieldDmg: w.shieldDmg,
      guidance: w.guidance,
      // wëap Speed is "pixels per frame * 100" (Bible, wëap section).
      // At 30 fps: raw / 100 * 30 = raw * 0.3.  Ships use a different unit
      // (the Bible gives no formula for shïp Speed, just "300 is average"),
      // so the two scales are independent — and fast ships (Viper raw 525 →
      // 315 px/s) should outrun EMP Torps (raw 750 → 225 px/s), which is a
      // known Nova mechanic that the earlier * 0.6 factor broke.
      speed: w.speed * 0.3,
      ammoType: w.ammoType,
      spinId: w.graphic >= 0 ? 3000 + w.graphic : null,
      sndId: w.sound >= 0 ? 200 + w.sound : null,
      // wëap Flags 0x0010: hold the sound rather than retriggering it. Nova
      // sets it on the 17 continuous weapons — beams, the chainguns — whose
      // samples are built to run under sustained fire, not to be machine-gunned.
      sndLoop: (w.flags & 0x0010) !== 0,
      // Flags 0x0040: multiple weapons of this type fire simultaneously, which
      // also means a burst budget is not multiplied by how many are fitted.
      simultaneous: (w.flags & 0x0040) !== 0,
      // 0x0100: "Weapon's blast doesn't hurt the player"
      blastHurtsPlayer: (w.flags & 0x0100) === 0,
      // 0x8000: "Shot detonates at the end of its lifespan (useful for flak)"
      detonateOnExpiry: (w.flags & 0x8000) !== 0,
      accuracy: w.accuracy,
      impact: w.impact ?? 0,
      proxRadius: w.proxRadius,
      // ExplodType indexes the bööm list. Most weapons state it plainly, but a
      // few carry it offset by 1000 (the Hellhound Missile reads 1014), which
      // the old 0-14 guard rejected outright, leaving that missile with no
      // impact explosion at all.
      explodBoom: boomFromExplodType(w.explodType),
      blastRadius: w.blastRadius,
      jamVuln: w.jamVuln ?? [0, 0, 0, 0],
      ionization: w.ionization ?? 0,
      exitType: w.exitType ?? -1,
      seeker: w.seeker ?? 0,
      /*
       * GuidedTurn is in the same units as a hull's Turn field, which the
       * shipyard converts at 3 degrees per second per point; the fleet's
       * values (20-70) then bracket the 2.4 rad/s this used to hardcode for
       * every missile alike.
       */
      guidedTurnRate: (w.guidedTurn ?? 0) * 3 * (Math.PI / 180),
      burstCount: Math.max(0, w.burstCount ?? 0),
      burstReloadSec: Math.max(0, w.burstReload ?? 0) / 30,
      subCount: Math.max(0, w.subCount ?? 0),
      subType: (w.subType ?? -1) >= 128 ? w.subType : null,
      subTheta: w.subTheta ?? 0,
      subLimit: Math.max(0, w.subLimit ?? 0),
      proxSafetySec: Math.max(0, w.proxSafety ?? 0) / 30,
      maxAmmo: Math.max(0, w.maxAmmo ?? 0),
      recoil: w.recoil ?? 0,
      liDensity: Math.max(0, w.liDensity ?? 0),
      durability: Math.max(0, w.durability ?? 0),
      flags3: w.flags3 ?? 0,
      beamLength: w.beamLength ?? 0,
      beamWidth: Math.max(1, w.beamWidth ?? 1),
      beamColor: rgbHex(w.beamColor ?? 0xffffff),
      coronaColor: rgbHex(w.coronaColor ?? 0xffffff),
    };
  }

  OUTFITS = {};
  for (const o of raw.outfits ?? []) {
    OUTFITS[String(o.id)] = {
      buyRandom: o.buyRandom ?? 0,
      scanMask: o.scanMask ?? 0,
      itemClass: o.itemClass ?? 0,
      contribute: (o.contribute ?? [0, 0]) as [number, number],
      require: (o.require ?? [0, 0]) as [number, number],
      requireGovt: o.requireGovt ?? -1,
      id: String(o.id),
      name: o.name,
      desc: o.desc,
      cost: o.cost,
      mass: o.mass,
      techLevel: o.techLevel,
      max: o.max,
      avail: o.avail ?? "",
      onPurchase: o.onPurchase ?? "",
      onSell: o.onSell ?? "",
      flags: o.flags ?? 0,
      displayWeight: o.displayWeight ?? 0,
      mods: o.mods.map(([type, val]) => ({ type, val })),
    };
  }
  OUTFIT_ORDER = (raw.outfits ?? []).map((o) => String(o.id));

  const govtById = new Map(raw.govts.map((g) => [g.id, g.name]));
  /*
   * One PlanetDef per stellar, shared by SYSTEMS, SPOBS_BY_ID and every system
   * variant — a variant swap then re-points at objects that already exist, and
   * identity stays stable for anything holding a planet reference.
   */
  const planetById = new Map(
    raw.spobs.map((sp) => [String(sp.id), makePlanet(sp, raw.descs)]),
  );
  const planetsOf = (ids: number[]): PlanetDef[] =>
    ids.map((id) => planetById.get(String(id))).filter((p): p is PlanetDef => !!p);

  SYSTEMS = raw.systems.map((sys) => ({
    id: String(sys.id),
    name: sys.name,
    mapPos: { x: sys.x, y: sys.y },
    links: sys.links.map(String),
    planets: planetsOf(sys.spobs),
    traffic: Math.max(1, Math.min(6, sys.avgShips ?? 2)),
    starColor: "#fff4d6",
    dudes: sys.dudes ?? [],
    persons: sys.persons ?? [],
    avgShips: sys.avgShips ?? 2,
    asteroids: sys.asteroids ?? 0,
    astTypes: sys.astTypes ?? 0,
    interference: Math.max(0, Math.min(100, sys.interference ?? 0)),
    bkgndColor: sys.bkgndColor ? rgbHex(sys.bkgndColor) : "",
    murk: Math.max(0, Math.min(100, sys.murk ?? 0)),
    /*
     * Message indexes STR# 1000, 1-based. Every system reads -1 or 1..19
     * against that bank's 20 entries, bar one: Nil'kol carries 20003, which
     * matches no STR# entry and no dësc either. It is a slip in Nova's own
     * data, so it simply shows no buoy rather than being given a meaning.
     */
    message: (sys.message ?? -1) > 0 ? sys.message : 0,
    // ReinfFleet is 0 or -1 when the system never calls for help
    reinfFleet: (sys.reinfFleet ?? -1) >= 128 ? sys.reinfFleet : null,
    // ReinfTime is in frames at 30Hz, ReinfIntrval already in days
    reinfDelay: Math.max(0, sys.reinfTime ?? 0) / 30,
    reinfInterval: Math.max(0, sys.reinfInterval ?? 0),
    govtId: sys.govt,
    govtName: govtById.get(sys.govt) ?? null,
    visibleIf: sys.visibleIf ?? [],
    variants: (sys.variants ?? []).map((v) => ({
      id: String(v.id),
      visibility: v.visibility,
      links: v.links.map(String),
      planets: planetsOf(v.spobs),
      dudes: v.dudes ?? [],
      persons: v.persons ?? [],
      avgShips: v.avgShips ?? 2,
      traffic: Math.max(1, Math.min(6, v.avgShips ?? 2)),
      govtId: v.govt,
      govtName: govtById.get(v.govt) ?? null,
      asteroids: v.asteroids ?? 0,
      astTypes: v.astTypes ?? 0,
      interference: Math.max(0, Math.min(100, v.interference ?? 0)),
      bkgndColor: v.bkgndColor ? rgbHex(v.bkgndColor) : "",
      murk: Math.max(0, Math.min(100, v.murk ?? 0)),
      message: (v.message ?? -1) > 0 ? v.message : 0,
      reinfFleet: (v.reinfFleet ?? -1) >= 128 ? v.reinfFleet : null,
      reinfDelay: Math.max(0, v.reinfTime ?? 0) / 30,
      reinfInterval: Math.max(0, v.reinfInterval ?? 0),
    })),
  }));

  systemsById = new Map(SYSTEMS.map((s) => [s.id, s]));
  // Dropped story-variant ids still named elsewhere in the scenario — mïsn
  // 676's ShipSyst is 765, SPC-1421's b995 version of the kept 308.
  SYSTEM_ALIAS = new Map(
    Object.entries(raw.systemAlias ?? {}).map(([from, to]) => [
      from,
      String(to),
    ]),
  );

  SPOB_GOVT = new Map();
  for (const sp of raw.spobs) SPOB_GOVT.set(String(sp.id), sp.govt);
  SPOBS_BY_ID = planetById;
  // the top-level fields are the canonical variant, so record that as applied
  activeVariant.clear();
  for (const sys of SYSTEMS)
    if (sys.variants.length > 0) activeVariant.set(sys.id, sys.id);
  reindexSpobs();

  govtRelations = new Map();
  for (const g of raw.govts) {
    govtRelations.set(g.id, {
      classes: g.classes ?? [],
      allies: g.allies ?? [],
      enemies: g.enemies ?? [],
    });
  }
  ALL_GOVT_IDS = raw.govts.map((g) => g.id);
  GOVT_NAMES = {};
  GOVT_VOICES = {};
  GOVT_FLAGS = {};
  GOVT_FLAGS2 = {};
  GOVT_COMM_NAMES = {};
  GOVT_NEWS_PICS = {};
  GOVTS = {};
  for (const g of raw.govts) {
    GOVT_NAMES[String(g.id)] = g.name;
    GOVT_VOICES[String(g.id)] = g.voiceType ?? 0;
    GOVT_FLAGS[String(g.id)] = g.flags ?? 0;
    GOVT_FLAGS2[String(g.id)] = g.flags2 ?? 0;
    GOVT_COMM_NAMES[String(g.id)] = g.commName ?? "";
    GOVT_NEWS_PICS[String(g.id)] = g.newsPic ?? 9000;
    GOVTS[String(g.id)] = g;
  }

  MISSIONS = {};
  for (const m of raw.missions ?? []) MISSIONS[String(m.id)] = m;
  DUDES = {};
  for (const dd of raw.dudes ?? []) DUDES[String(dd.id)] = dd;
  PERSONS = {};
  for (const pp of raw.persons ?? []) PERSONS[String(pp.id)] = pp;
  STR_LISTS = raw.strLists ?? {};
  ROIDS = {};
  for (const rr of raw.roids ?? []) {
    ROIDS[String(rr.id)] = {
      ...rr,
      partColor: rgbHex(rr.partColor ?? 0xffffff),
      // ExplodeType indexes the bööm list the same way a weapon's does
      explodeBoom: boomFromExplodType(rr.explodeType ?? -1),
    };
  }
  if (raw.colr) {
    const c = raw.colr;
    COLR = {
      ...c,
      buttonUp: rgbHex(c.buttonUp),
      buttonDown: rgbHex(c.buttonDown),
      buttonGrey: rgbHex(c.buttonGrey),
      menuBright: rgbHex(c.menuBright),
      menuDim: rgbHex(c.menuDim),
      gridLine: rgbHex(c.gridLine),
      gridSelection: rgbHex(c.gridSelection),
      progBright: rgbHex(c.progBright),
      progDim: rgbHex(c.progDim),
      progOutline: rgbHex(c.progOutline),
      floatingMap: rgbHex(c.floatingMap),
      listText: rgbHex(c.listText),
      listBkgnd: rgbHex(c.listBkgnd),
      listHilite: rgbHex(c.listHilite),
      escortHilite: rgbHex(c.escortHilite),
    };
    /*
     * Publish the interface colours as CSS variables so the HTML screens draw
     * from the same cölr the canvas does. The stylesheet's own values stay as
     * the fallback for a scenario without a cölr resource.
     */
    const css = document.documentElement.style;
    css.setProperty("--ev-list-text", COLR.listText);
    css.setProperty("--ev-list-bkgnd", COLR.listBkgnd);
    css.setProperty("--ev-list-hilite", COLR.listHilite);
    css.setProperty("--ev-escort-hilite", COLR.escortHilite);
    css.setProperty("--ev-grid-line", COLR.gridLine);
    css.setProperty("--ev-grid-sel", COLR.gridSelection);
    css.setProperty("--ev-button-up", COLR.buttonUp);
    css.setProperty("--ev-button-grey", COLR.buttonGrey);
    css.setProperty("--ev-button-down", COLR.buttonDown);
    css.setProperty("--ev-menu-bright", COLR.menuBright);
    css.setProperty("--ev-menu-dim", COLR.menuDim);
    css.setProperty("--ev-floating-map", COLR.floatingMap);
    css.setProperty("--ev-menu-font-size", `${COLR.menuFontSize}px`);
    css.setProperty("--ev-button-font-size", `${COLR.buttonFontSize}px`);
    css.setProperty("--ev-menu-font", `"${COLR.menuFont}"`);
    css.setProperty("--ev-button-font", `"${COLR.buttonFont}"`);
  }
  if (raw.interfaces?.length) {
    ALL_INTERFACES = raw.interfaces;
    INTERFACE = raw.interfaces[0];
    DEFAULT_INTERFACE = raw.interfaces[0];
    publishInterfaceVars();
  }
  CRONS = raw.crons ?? [];
  FLEETS = raw.fleets ?? [];
  RANKS = {};
  for (const rk of raw.ranks ?? []) RANKS[String(rk.id)] = rk;
  BOOMS = {};
  for (const bm of raw.booms ?? []) BOOMS[String(bm.id)] = bm;
  OOPSES = raw.oopses ?? [];
  NEBULAE = raw.nebulae ?? [];
  // Kept verbatim: the {b}/{G}/{P} selection tags are resolved when the text
  // is shown, against the pilot reading it. See resolveNovaText.
  DESCS = { ...(raw.descs ?? {}) };
  JUNK_NAMES = {};
  JUNKS = {};
  for (const j of raw.junks ?? []) {
    JUNK_NAMES[String(j.id)] = j.name;
    JUNKS[String(j.id)] = j;
  }

  // Starting conditions come from the chär resource, not from a guess
  // chär Flags 0x0001 marks the default template; lowest ID wins a tie
  const templates = (raw.chars ?? []).slice().sort((a, b) => a.id - b.id);
  START_TEMPLATE =
    templates.find((c) => (c.flags & 0x0001) !== 0) ?? templates[0] ?? null;
  if (START_TEMPLATE) setCalendar(START_TEMPLATE);
  const startCandidates = (START_TEMPLATE?.systems ?? [])
    .map(String)
    .filter((id) => systemsById.has(id));
  START_SYSTEM_ID = startCandidates[0] ?? SYSTEMS[0].id;
}

export function systemGovtColor(sys: SystemDef): string {
  /*
   * The shipped theme colours are chosen to sit behind the map as territory,
   * so several are very dark — the Auroran families run #4f4f4f and down, and
   * a dot that dark vanishes against space. Lift anything below half
   * brightness towards white until it reads, keeping the hue.
   */
  const raw = govtRgb(sys.govtId);
  if (raw === 0) return NEUTRAL_GOVT_COLOR;
  const r = (raw >> 16) & 0xff,
    g = (raw >> 8) & 0xff,
    b = raw & 0xff;
  const peak = Math.max(r, g, b);
  if (peak >= 128) return rgbHex(raw);
  const lift = 128 / Math.max(1, peak);
  return `rgb(${Math.round(r * lift)},${Math.round(g * lift)},${Math.round(b * lift)})`;
}

/** The same government colour, translucent, for the star map's territory haze. */
export function govtHaze(govtId: number, alpha: number): string {
  const raw = govtRgb(govtId);
  if (raw === 0) return `rgba(138,151,168,${alpha})`;
  return `rgba(${(raw >> 16) & 0xff},${(raw >> 8) & 0xff},${raw & 0xff},${alpha})`;
}

/**
 * shïp EscortType — "which of the four categories of escorts to put this ship
 * type into when organizing the escort control menu". The stock 288 hulls
 * partition cleanly (25 Fighters / 106 Medium / 106 Warships / 51
 * Freighters); -1 is the Bible's "have the game try to figure it out at
 * runtime", which no stock hull needs, so the fallback guesses off
 * InherentAI: traders read Freighter, interceptors Fighter, warships Warship.
 */
export function escortClassName(shipId: string): string {
  const s = SHIPS[shipId];
  if (!s) return "Escort";
  const names = ["Fighter", "Medium Ship", "Warship", "Freighter"];
  if (s.escortType >= 0 && s.escortType <= 3) return names[s.escortType];
  const ai = s.inherentAi;
  return ai === 1 || ai === 2 ? "Freighter" : ai === 4 ? "Fighter" : "Warship";
}

export function getSystem(id: string): SystemDef {
  const s = systemsById.get(id) ?? systemsById.get(SYSTEM_ALIAS.get(id) ?? "");
  if (!s) throw new Error(`unknown system: ${id}`);
  return s;
}

/**
 * The live pilot's control bits, so system visibility can be asked anywhere
 * without threading them through. `player.bits` is mutated in place, so
 * holding the reference keeps the answer current; `Game.startPilot` re-points
 * it because loading a pilot builds a fresh object.
 */
let visibilityBits: Bits = {};
export function setVisibilityBits(bits: Bits): void {
  visibilityBits = bits;
  syncSystemVariants();
}

/**
 * Is this system off the chart right now? Only the five story-gated groups can
 * answer yes — see SystemDef.visibleIf. A hidden system is left out of the map,
 * of route finding, of bulk charting and of random destination draws, but it
 * still exists: the ncb move operator can put you in it (which is the whole
 * point of S7evyn), and it simply appears the moment its bits turn true.
 */
export function systemHidden(sys: SystemDef): boolean {
  if (sys.visibleIf.length === 0) return false;
  return !sys.visibleIf.some((expr) => evalTest(expr, visibilityBits));
}

/**
 * SPOB_INDEX follows whichever variant of each system is live. Rebuilt **in
 * place** rather than reassigned: a variant swap can happen at any arrival, and
 * anything holding the map — including the debug handles — must not be left
 * looking at a galaxy that has moved on.
 */
function reindexSpobs(): void {
  SPOB_INDEX.clear();
  for (const sys of SYSTEMS) {
    for (const planet of sys.planets) {
      SPOB_INDEX.set(planet.id, { planet, systemId: sys.id });
    }
  }
}

/**
 * Put one of a system's states into effect. The fields are written **in place**
 * so that SYSTEMS, systemsById and anything else holding the SystemDef keeps
 * seeing the live galaxy; only `id`, `name` and `mapPos` are fixed, which is
 * what keeps a saved pilot's explored list and per-system ledger valid.
 */
function applySystemVariant(sys: SystemDef, v: SystemVariant): void {
  sys.links = v.links;
  sys.planets = v.planets;
  sys.dudes = v.dudes;
  sys.persons = v.persons;
  sys.avgShips = v.avgShips;
  sys.traffic = v.traffic;
  sys.govtId = v.govtId;
  sys.govtName = v.govtName;
  sys.asteroids = v.asteroids;
  sys.astTypes = v.astTypes;
  sys.interference = v.interference;
  sys.bkgndColor = v.bkgndColor;
  sys.murk = v.murk;
  sys.message = v.message;
  sys.reinfFleet = v.reinfFleet;
  sys.reinfDelay = v.reinfDelay;
  sys.reinfInterval = v.reinfInterval;
}

/** which variant id each multi-variant system is currently showing */
const activeVariant = new Map<string, string>();

/**
 * Re-derive every multi-variant system from the live bits. Nova switches a
 * system's *contents*, not just its name — Procyon's five states walk UHP-1002
 * through three rebuilds and finally into **Nirvana**, which is where the last
 * two Terraforming legs deliver their colonists, and 37 of the 128 groups
 * differ in their stellars this way.
 *
 * Cheap enough to call on every arrival: 128 systems, one short expression
 * each, and the work below only runs when something actually moved. A group
 * with no true variant keeps whatever it is showing — `visibleIf` decides
 * whether it is on the chart at all, and the two questions are separate.
 */
export function syncSystemVariants(): void {
  let changed = false;
  for (const sys of SYSTEMS) {
    if (sys.variants.length === 0) continue;
    /*
     * **The last true variant wins.** At game start exactly one is ever true —
     * measured across all 128 groups — so this only decides mid-game overlaps,
     * and Nova's own data has them: Glimmer's default reads
     * `!(b6300 | b6302)` and forgets to exclude b6301, so once the Sigma
     * thread sets that bit both it and "b6301 & b130" are true at once. The
     * variants are authored in ascending story order (677 then 678, 759 then
     * 760 then 761), the canonical is first and so acts as the default, and
     * taking the last match is what lets Brass actually become Nova. The Bible
     * does not state a rule; the mutually-exclusive groups — Sol, Procyon and
     * most of the rest — do not care either way.
     */
    let live: SystemVariant | undefined;
    for (const v of sys.variants)
      if (evalTest(v.visibility, visibilityBits)) live = v;
    if (!live) continue;
    if (activeVariant.get(sys.id) === live.id) continue;
    activeVariant.set(sys.id, live.id);
    applySystemVariant(sys, live);
    changed = true;
  }
  if (changed) reindexSpobs();
}

/** Every system currently on the chart. */
export function chartedSystems(): SystemDef[] {
  return SYSTEMS.filter((s) => !systemHidden(s));
}

/** A random one of the scenario's starting systems, as EV Nova does. */
export function pickStartSystemId(): string {
  const candidates = (START_TEMPLATE?.systems ?? [])
    .map(String)
    .filter((id) => systemsById.has(id));
  if (candidates.length === 0) return START_SYSTEM_ID;
  return candidates[Math.floor(Math.random() * candidates.length)];
}

/** BFS shortest route between systems; returns list of system ids after `from`, or null. */
export function findRoute(fromId: string, toId: string): string[] | null {
  if (fromId === toId) return [];
  const prev = new Map<string, string>();
  const queue = [fromId];
  const seen = new Set([fromId]);
  while (queue.length) {
    const cur = queue.shift()!;
    for (const next of getSystem(cur).links) {
      if (seen.has(next)) continue;
      // a story-gated system is not on the chart yet, so no lane runs to it —
      // not as a waypoint and not as a destination
      if (systemHidden(getSystem(next))) continue;
      seen.add(next);
      prev.set(next, cur);
      if (next === toId) {
        const path: string[] = [toId];
        let p = toId;
        while (prev.has(p)) {
          p = prev.get(p)!;
          if (p !== fromId) path.unshift(p);
        }
        return path;
      }
      queue.push(next);
    }
  }
  return null;
}
