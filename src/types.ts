export interface Vec2 {
  x: number;
  y: number;
}

export interface CommodityDef {
  id: string;
  name: string;
  basePrice: number;
}

export type PriceLevel = "low" | "med" | "high";

export interface PlanetDef {
  id: string;
  name: string;
  kind: "planet" | "station";
  desc: string;
  pos: Vec2;
  radius: number;
  color: string;
  /** extracted Nova stellar sprite, if available */
  spriteFile: string | null;
  /** one frame's size, and how many the sheet holds — gates animate */
  spriteW: number;
  spriteH: number;
  spriteFrames: number;
  landable: boolean;
  exchange: boolean;
  uninhabited: boolean;
  shipyard: boolean;
  outfitter: boolean;
  bar: boolean;
  techLevel: number;
  /**
   * spöb MinStatus: the legal record below which this world refuses you
   * landing clearance. -32767 is "ignored", 32767 "never landable", and the
   * field is ignored outright on an uninhabited stellar.
   */
  minStatus: number;
  /** spöb Govt: the government that owns this world, or -1 if independent */
  govtId: number;
  /** credits per day once dominated */
  tribute: number;
  /** düde id of the defence fleet, and its size code */
  defDude: number;
  defCount: number;
  onDominate: string;
  onRelease: string;
  /** exact-match tech levels also sold here (spöb SpecialTech) */
  specialTechs: number[];
  /** spöb CustSndID: ambience that plays on landing, or null for a quiet world */
  ambientSnd: number | null;
  /** spöb Flags2 0x0010: hold the ambience on a loop rather than playing it once */
  ambientLoop: boolean;
  /** extracted landing landscape image, if available */
  landingPictFile: string | null;
  /** spöb Flags2 0x1000 / 0x2000 */
  isHypergate: boolean;
  isWormhole: boolean;
  /**
   * spöb Flags2 0x0400: outfitter will buy anything from the player but
   * stocks nothing itself. Sirrusa (id 156) is the only shipped example;
   * desc 156 confirms: "they will take anything off your hands ... they do
   * not actually have anything to sell."
   */
  sellOnly: boolean;
  /** spob ids this gate connects to (empty wormhole list = random) */
  hyperLinks: string[];
  /**
   * CustSndID when this is a gate/wormhole: exit bearing in Nova degrees
   * (0 = up, clockwise, 0–359). null → stock default (~4:00 / 120°), which
   * matches the shared ring art; plug-ins can still pin any angle.
   */
  emergeAngle: number | null;
  /**
   * CustPicID transition frame between opening/closing and the "working"
   * loop on an animated hypergate. null → open through the last frame.
   */
  gateAnimSplit: number | null;
  /** price level per commodity id; missing means this commodity is not traded here */
  prices: Partial<Record<string, PriceLevel>>;
}

export interface SystemDef {
  id: string;
  name: string;
  mapPos: Vec2;
  links: string[];
  planets: PlanetDef[];
  /** how many NPC trader ships tend to be around */
  traffic: number;
  starColor: string;
  govtId: number;
  govtName: string | null;
  /** dude classes that spawn here, with weights */
  dudes: { id: number; prob: number }[];
  avgShips: number;
  /** how many asteroids drift here (0-16) and which röid types */
  asteroids: number;
  astTypes: number;
  /** sensor static, 0 (clear) to 100 (blackout) */
  interference: number;
  /** the system's background tint as a CSS colour, or "" for plain black */
  bkgndColor: string;
  /** haze thickness, 0-100 */
  murk: number;
  /** STR# 1000 entry shown by the system's message buoy, or 0 for none */
  message: number;
  /** the flët called in when this system's own side is losing */
  reinfFleet: number | null;
  /** seconds between the call going out and the fleet arriving */
  reinfDelay: number;
  /** days before the same system can call again */
  reinfInterval: number;
}

export interface PlayerState {
  credits: number;
  fuelJumps: number;
  maxFuelJumps: number;
  cargo: Record<string, number>;
  cargoCap: number;
  systemId: string;
  landedOn: string | null;
  /**
   * Last pad the pilot lifted off from (or landed on). Saved on leave so a
   * reload spawns over that world in flight; `landedOn` is only set while
   * actually docked in a live session.
   */
  lastPad: string | null;
  /** shïp resource ID of the player's current ship */
  shipId: string;
  /** owned outfits: oütf resource ID -> count */
  outfits: Record<string, number>;
  /** ammo per weapon ID */
  ammo: Record<string, number>;
  /** control bits (ncb) set by missions */
  bits: Record<string, boolean>;
  /** game date, in days since start */
  date: number;
  activeMissions: ActiveMission[];
  /**
   * Legacy: legal record per government id. Superseded by systemRecords —
   * kept only so old saves can be migrated on load; nothing writes it.
   */
  records: Record<string, number>;
  /**
   * Legal record per system id, sparse — a missing entry reads as the owning
   * government's InitialRec. This is Nova's own model: the original pilot
   * file stores one int16 per sÿst.
   */
  systemRecords?: Record<string, number>;
  /** combat rating points (from destroyed ships' strength) */
  ratingPoints: number;
  /** strict mode: death is permanent */
  strict: boolean;
  /** normal: NPCs aim at current position; hard: NPCs lead the target */
  difficulty: "normal" | "hard";
  /** përs ids already killed — they never come back */
  personsKilled: number[];
  /** spob ids the player has dominated, and the day tribute was last paid */
  dominated: string[];
  tributeDay: number;
  /** per-planet reputation delta (combined with govt record for landing/hostility checks) */
  planetRecords?: Record<string, number>;
  /** system ids the player has visited or charted */
  explored: string[];
  /** running crön events */
  crons: CronState[];
  /** öops disasters currently in progress */
  oopses: OopsState[];
  /** ränk ids currently held */
  ranks: number[];
  /** day salaries were last paid */
  salaryDay: number;
  /** ships hired to fly with you, and the day their wages were last drawn */
  escorts: HiredEscort[];
  escortPayDay: number;
  /** set once the hull's stock weapons have been materialised as owned outfits */
  hullDefaults?: boolean;
  /** saved nav destination — route is recomputed from current system on load */
  routeDest?: string | null;
}

/**
 * A ship hired to fly with you. Escorts are stored on the pilot rather than as
 * live NpcShips so they survive jumps and landings; a fresh hull is spawned
 * beside you each time you launch, and struck from this list when it dies.
 */
export interface HiredEscort {
  /** shïp resource id */
  shipId: string;
  /** credits per day, drawn whenever the calendar advances */
  wage: number;
  /**
   * Taken as a prize rather than hired. A captured crew draws no wage, and the
   * ship is yours to sell — the Bible's EscSellValue is "the amount of cash
   * the player gets for selling off a captured escort of this type".
   */
  captured?: boolean;
  /** Sell this escort at the next shipyard landing. */
  pendingSell?: boolean;
  /** Upgrade this escort's hull at the next shipyard landing. */
  pendingUpgrade?: boolean;
}

/** A mission decoded from a mïsn resource. */
export interface MissionType {
  /** days the calendar jumps once the mission completes */
  datePostInc: number;
  id: number;
  name: string;
  availStel: number;
  availLoc: number;
  availRating: number;
  availRecord: number;
  availRandom: number;
  travelStel: number;
  returnStel: number;
  cargoType: number;
  cargoQty: number;
  pickupMode: number;
  dropOffMode: number;
  pay: number;
  shipCount: number;
  shipSyst: number;
  shipDude: number;
  shipGoal: number;
  briefText: number;
  quickBrief: number;
  loadCargText: number;
  dropCargText: number;
  compText: number;
  failText: number;
  timeLimit: number;
  canAbort: number;
  shipDoneText: number;
  shipBehav: number;
  compGovt: number;
  compReward: number;
  flags: number;
  /** Flags2: 0x0001 needs cargo room, 0x0002 pay on auto-abort, 0x0004 fail if disabled */
  flags2: number;
  /** 0/-1 ignored, 128-255 must fly this hull, 1128+ must not, 2128+/3128+ by govt */
  availShipType: number;
  availBits: string;
  onAccept: string;
  onRefuse: string;
  onSuccess: string;
  onFailure: string;
  onAbort: string;
  onShipDone: string;
}

/** A mission the player has accepted, with destinations resolved. */
export interface ActiveMission {
  misnId: number;
  /** display name (before the ";" tag) */
  name: string;
  /** resolved spob ids (null = none) */
  travelSpobId: string | null;
  returnSpobId: string | null;
  travelDone: boolean;
  cargoName: string | null;
  cargoQty: number;
  cargoLoaded: boolean;
  acceptedDay: number;
  timeLimit: number;
  pay: number;
  /** special-ship goal tracking (shipGoal 0 = destroy) */
  shipsTotal: number;
  shipsKilled: number;
  shipsDone: boolean;
  shipDude: number;
  /** system where the mission ships appear */
  shipSystemId: string | null;
}

export interface StockWeapon {
  id: number;
  count: number;
  ammo: number;
  /** per-weapon fire cooldown used by NPC gunnery; undefined on static data */
  cooldown?: number;
}

/** A shïp DefaultItem: an oütf the hull arrives already carrying. */
export interface StockItem {
  id: number;
  count: number;
}

/** A weapon decoded from a wëap resource, in engine units. */
export interface WeaponType {
  id: string;
  name: string;
  /** seconds between shots */
  reloadSec: number;
  /** projectile lifetime in seconds */
  durationSec: number;
  armorDmg: number;
  shieldDmg: number;
  /** -1 unguided, 0 beam, 1 homing, 4 turret, 5 freefall, 6 rocket, 7/8 quadrant, 10 point defense */
  guidance: number;
  /** projectile speed, px/s */
  speed: number;
  ammoType: number;
  /** spïn id (3000 + graphic) or null */
  spinId: number | null;
  /** snd resource id for firing, or null */
  sndId: number | null;
  /** wëap Flags 0x0010: sustain the sound under fire instead of retriggering */
  sndLoop: boolean;
  /** wëap Flags 0x0040: every copy of this weapon fires at once */
  simultaneous: boolean;
  /** wëap Flags 0x0100 clears this: the blast spares the player */
  blastHurtsPlayer: boolean;
  /** wëap Flags 0x8000: the shot detonates when its life runs out (flak) */
  detonateOnExpiry: boolean;
  /** inaccuracy in degrees */
  accuracy: number;
  /** the shove a hit imparts — momentum transfer, not damage */
  impact: number;
  proxRadius: number;
  blastRadius: number;
  /** bööm resource id to spawn on impact, or null */
  explodBoom: number | null;
  /** vulnerability (0-100%) to each of the four jamming types */
  jamVuln: number[];
  /** ion charge dumped into whatever this hits */
  ionization: number;
  /** wëap Flags @72 bit 0x0200: firing this weapon flashes the hull's WeapImageID overlay */
  triggersWeapGlow: boolean;
  /** which shän exit point class this fires from: 0 gun, 1 turret, 2 guided, 3 beam, -1 centre */
  exitType: number;
  /** guided-weapon behaviour flags (Seeker): 0x0002 decoyed by asteroids,
   * 0x0008 confused by interference, 0x0020 can't fire while ionized,
   * 0x4000 loses lock unless the target is ahead */
  seeker: number;
  /** turn rate for guided shots, rad/s (0 for everything else) */
  guidedTurnRate: number;
  /** shots per burst before the longer BurstReload; 0 = no burst cycle */
  burstCount: number;
  /** seconds of reload imposed at the end of a burst */
  burstReloadSec: number;
  /** submunitions spawned when the shot dies: how many, of what, how wide */
  subCount: number;
  subType: number | null;
  subTheta: number;
  /** recursion cap for a weapon that submunitions into itself */
  subLimit: number;
  /** seconds before the proximity fuse arms */
  proxSafetySec: number;
  /** max ammo per instance of this weapon; 0 = governed by the outfit instead */
  maxAmmo: number;
  /** recoil impulse on the firing ship; positive shoves it backwards */
  recoil: number;
  /** >0 makes a beam a lightning bolt, in zig-zags per 100px */
  liDensity: number;
  /** point-defence hits a guided shot survives */
  durability: number;
  /** wëap Flags3: 0x0002 translucent shots, 0x0010 fire from nearest mount */
  flags3: number;
  /** beam weapons (guidance 0/3) */
  beamLength: number;
  beamWidth: number;
  beamColor: string;
  coronaColor: string;
}

export interface OutfitMod {
  type: number;
  val: number;
}

/** An outfit decoded from an oütf resource. */
export interface OutfitType {
  /** percent chance of being in stock on a given day; 0 = never sold */
  buyRandom: number;
  /** which governments treat this outfit as contraband (16-bit mask) */
  scanMask: number;
  /** the përs GrantClass this outfit can be handed over as */
  itemClass: number;
  id: string;
  name: string;
  desc: string;
  cost: number;
  mass: number;
  techLevel: number;
  max: number;
  /** oütf DispWeight; higher sits nearer the top of the outfitter */
  displayWeight: number;
  /** outfitter availability ncb expression */
  avail: string;
  /** control bit set strings run when this item is bought or sold */
  onPurchase: string;
  onSell: string;
  /**
   * oütf Flags. The ones the outfitter cares about:
   * 0x0008 can't be sold, 0x0100 hide unless the Require bits are met,
   * 0x0800 sellable anywhere, 0x1000 suppress higher-numbered items of equal
   * DispWeight, 0x4000 hide unless Availability is true.
   */
  flags: number;
  mods: OutfitMod[];
}

/** A ship class decoded from a shïp resource, in engine units. */
export interface ShipType {
  id: string;
  name: string;
  desc: string;
  cost: number;
  cargo: number;
  fuelJumps: number;
  shield: number;
  armor: number;
  techLevel: number;
  mass: number;
  /** engine units: px/s, px/s², rad/s */
  maxSpeed: number;
  accel: number;
  turnRate: number;
  /** raw Nova stat units, so outfit bonuses add before conversion */
  rawSpeed: number;
  rawAccel: number;
  rawTurn: number;
  /** shield points recharged per second */
  shieldRechPerSec: number;
  /** tons available for outfits */
  freeMass: number;
  /** the hull's own limits on fixed guns and turrets */
  maxGuns: number;
  maxTurrets: number;
  /** hull length in metres, for the detailed ship info */
  length: number;
  /** percent chance per day of being offered for sale; 0 = never */
  buyRandom: number;
  /** the shipyard menu's own label; "\n" splits it onto a second grey line */
  shortName: string;
  /** the full marque shown over the ship's picture */
  longName: string;
  /** the Bible's four AI types: 1 wimpy trader, 2 brave trader, 3 warship, 4 interceptor */
  inherentAi: number;
  /** crew who defend the ship when it is boarded */
  crew: number;
  /** combat-rating points awarded for destroying this ship */
  strength: number;
  /** the government this hull belongs to by nature, if any */
  inherentGovt: { govt: number; combat: boolean; attributes: boolean } | null;
  /** shïp flags; 0x40 marks AI-only variants that never appear in shipyards */
  flags: number;
  /** shïp Flags2; 0x0100-0x2000 are the AI cloaking behaviours */
  flags2: number;
  /** shipyard availability ncb expression */
  avail: string;
  stockWeapons: StockWeapon[];
  defaultItems: StockItem[];
  /** shïp HireRandom: percent chance per day of being offered for hire in a bar */
  hireRandom: number;
  /** ncb set when you capture this hull, and when you sell or replace it */
  onCapture: string;
  onRetire: string;
  /** the target display's second line, e.g. the Starbridge's "Class A" */
  subtitle: string;
  /** shïp Flags3 */
  flags3: number;
  /** the hull an escort of this type upgrades into, or -1 */
  upgradeTo: number;
  escUpgrdCost: number;
  /**
   * What a captured escort of this type sells for. Zero on all 288 shipped
   * hulls, which the Bible says means "Nova will default to 10% of the ship's
   * original cost" — see escortSellValue().
   */
  escSellValue: number;
  /** 0 Fighter, 1 Medium Ship, 2 Warship, 3 Freighter */
  escortType: number;
}

/** A düde class: govt + AI + weighted ship types. */
export interface DudeType {
  id: number;
  name: string;
  aiType: number;
  govt: number;
  /** Booty flags: 0x01-0x20 cargo types, 0x40 carries money */
  booty: number;
  /**
   * InfoTypes: what this class talks about when hailed.
   * 0x1000 good prices, 0x2000 disaster news, 0x4xxx a quote from
   * STR# (7500 + low 12 bits), 0x8000 generic government chatter.
   */
  infoTypes: number;
  ships: { id: number; prob: number }[];
}

/** ränk: a commission with a government. */
export interface RankType {
  id: number;
  name: string;
  weight: number;
  govt: number;
  /** 100 = normal prices at that government's worlds */
  priceMod: number;
  /** credits per day */
  salary: number;
  flags: number;
  convName: string;
  shortName: string;
}

/** flët: a flagship and its escorts, appearing as one formation. */
export interface FleetType {
  id: number;
  name: string;
  leadShip: number;
  escorts: { id: number; min: number; max: number }[];
  govt: number;
  linkSyst: number;
  appearOn: string;
}

/** crön: a time-driven galaxy event. */
export interface CronType {
  id: number;
  name: string;
  firstDay: number;
  firstMonth: number;
  firstYear: number;
  lastDay: number;
  lastMonth: number;
  lastYear: number;
  random: number;
  duration: number;
  preHoldoff: number;
  postHoldoff: number;
  flags: number;
  enableOn: string;
  onStart: string;
  onEnd: string;
  /** IndNewsStr: STR# of the line this event puts on the general news wire */
  indNewsStr: number;
  /** NewsGovt1-4 and their GovtNewsStr1-4: local news for those governments */
  newsGovts: number[];
  govtNewsStrs: number[];
}

/** bööm: how one kind of explosion animates and sounds. */
export interface BoomType {
  id: number;
  name: string;
  /** frames advanced per game frame, x100 — 100 is one sprite frame per tick */
  frameAdvance: number;
  /** snd id = 300 + this */
  soundIndex: number;
  /** spïn id = 400 + this */
  graphicIndex: number;
}

/** öops: a commodity price disaster at one world. */
export interface OopsType {
  id: number;
  name: string;
  /** spöb id */
  stellar: number;
  /** 0 Food, 1 Industrial, 2 Medical, 3 Luxury, 4 Metal, 5 Equipment */
  commodity: number;
  /** percentage shift in that commodity's price while active */
  priceDelta: number;
  /** days it lasts */
  duration: number;
  /** roughly one chance in this many days of starting */
  freq: number;
  activateOn: string;
}

/** Live state for a disaster in progress. */
export interface OopsState {
  id: number;
  /** day it ends */
  endDay: number;
}

/** nëbu: a coloured cloud drawn behind a region of the galaxy. */
export interface NebuType {
  id: number;
  name: string;
  x: number;
  y: number;
  w: number;
  h: number;
  activeOn: string;
}

/** Live state for a cron the player's game has activated. */
export interface CronState {
  id: number;
  /** day the event starts (after PreHoldoff) */
  startDay: number;
  /** day it ends */
  endDay: number;
  /** day it may be considered again */
  readyDay: number;
  started: boolean;
  ended: boolean;
}

/** ïntf: the status bar's own colours. */
/**
 * One ïntf *Area, as panel-local pixels. Nova authors every status bar in a
 * 192-wide space, so these are scaled onto the real sidebar at draw time.
 * A zero-area rect means "don't draw this indicator at all" (Nova Bible).
 */
export interface InterfaceRect {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface InterfaceDef {
  id: number;
  name: string;
  brightText: string;
  dimText: string;
  radarArea: InterfaceRect;
  brightRadar: string;
  dimRadar: string;
  shieldArea: InterfaceRect;
  shieldColor: string;
  armorArea: InterfaceRect;
  armorColor: string;
  fuelArea: InterfaceRect;
  fuelFull: string;
  fuelPartial: string;
  navArea: InterfaceRect;
  weapArea: InterfaceRect;
  targArea: InterfaceRect;
  cargoArea: InterfaceRect;
  statusFont: string;
  statFontSize: number;
  subtitleSize: number;
  statusBkgnd: number;
}

/** röid: one of the sixteen asteroid types. */
export interface RoidType {
  id: number;
  name: string;
  strength: number;
  spinRate: number;
  /** 0-5 standard cargo, 1000+ a jünk type */
  yieldType: number;
  yieldQty: number;
  /** how many particles this throws off when destroyed, and their colour */
  partCount: number;
  partColor: string;
  /** röid ids this breaks into; Nova picks between them per sub-asteroid */
  fragTypes: number[];
  /** average number of sub-asteroids, +/- 50% */
  fragCount: number;
  /** bööm index shown when it is destroyed, or null */
  explodeBoom: number | null;
  /** mass, for how hard a hit shoves the rock */
  mass: number;
}

/** chär: the scenario's starting character template. */
export interface CharTemplate {
  id: number;
  name: string;
  cash: number;
  shipType: number;
  systems: number[];
  /** Govt1-4 / Status1-4: the legal record this pilot opens with */
  records: { govt: number; status: number }[];
  kills: number;
  /** IntroPict1-4 and their PictDelay1-4 dwell times, in seconds */
  introPicts: number[];
  pictDelays: number[];
  /** dësc shown after the intro pictures, or -1 */
  introTextId: number;
  /** control bit set string run when the pilot is created */
  onStart: string;
  /** 0x0001 marks the default template */
  flags: number;
  startDay: number;
  startMonth: number;
  startYear: number;
  datePrefix: string;
  dateSuffix: string;
}

/** A përs: a named AI captain the player can meet. */
export interface PersonType {
  id: number;
  name: string;
  linkSyst: number;
  govt: number;
  aiType: number;
  aggress: number;
  coward: number;
  shipType: number;
  /**
   * Extra weapons this captain bolts on over the hull's standard load. A
   * negative count removes that many of a standard weapon instead.
   */
  loadout: StockWeapon[];
  /** the ship's own name — Jack Folstam flies the "Night-Master" */
  shipName: string;
  /** control-bit expression gating whether this captain is in play */
  activeOn: string;
  /** PICT shown in the comms panel instead of the ship's usual portrait */
  hailPict: number;
  /** the outfit class handed over when boarded, and the odds and how many */
  grantClass: number;
  grantProb: number;
  grantCount: number;
  credits: number;
  shieldMod: number;
  /** index into STR# 7100 (spoken in the comms panel) */
  commQuote: number;
  /** index into STR# 7101 (broadcast over the radio) */
  hailQuote: number;
  linkMission: number;
  flags: number;
}

/** cölr: game-wide interface colours, fonts and main-menu layout. */
export interface ColrDef {
  buttonUp: string;
  buttonDown: string;
  buttonGrey: string;
  menuFont: string;
  menuFontSize: number;
  menuBright: string;
  menuDim: string;
  /** the shipyard/outfit grid's lines, and its selection square */
  gridLine: string;
  gridSelection: string;
  progressBar: { top: number; left: number; bottom: number; right: number };
  progBright: string;
  progDim: string;
  progOutline: string;
  /** the six main-menu buttons, relative to a 1024x768 backdrop */
  buttons: { x: number; y: number }[];
  floatingMap: string;
  listText: string;
  listBkgnd: string;
  listHilite: string;
  escortHilite: string;
  buttonFont: string;
  buttonFontSize: number;
  logo: { x: number; y: number };
  rollover: { x: number; y: number };
  slides: { x: number; y: number }[];
}
