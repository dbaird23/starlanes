#!/usr/bin/env node
/**
 * Extract EV Nova galaxy data from Windows-format .rez files into JSON.
 *
 * Usage: node scripts/extract-nova.mjs "<path to Nova Files dir>"
 * Writes: public/nova/galaxy.json
 *
 * .rez container format (little-endian header, big-endian resource map),
 * as documented by ResForge's RezFormat implementation.
 * Resource payloads are the original Mac big-endian structs, per the Nova Bible.
 */
import { readFileSync, writeFileSync, readdirSync, mkdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

// The container parser lives in rez.mjs and is shared by every extractor.
// This file used to keep its own byte-identical copy, which is exactly how the
// two drifted: a fix to one silently left the other reading the wrong entries.
import { cstr, parseRez } from "./rez.mjs";

const macRoman = new TextDecoder("macintosh");

// ---- Nova struct decoding (big-endian payloads) ----

function decodeSyst(res) {
  const d = res.data;
  const links = [];
  for (let i = 0; i < 16; i++) {
    const v = d.readInt16BE(4 + i * 2);
    if (v >= 128) links.push(v);
  }
  const spobs = [];
  for (let i = 0; i < 16; i++) {
    const v = d.readInt16BE(36 + i * 2);
    if (v >= 128) spobs.push(v);
  }
  // which dude classes spawn here, with probabilities
  const dudes = [];
  for (let i = 0; i < 8; i++) {
    const dude = d.readInt16BE(68 + i * 2);
    const prob = d.readInt16BE(84 + i * 2);
    if (dude >= 128 && prob > 0) dudes.push({ id: dude, prob });
  }
  return {
    id: res.id,
    name: res.name,
    x: d.readInt16BE(0),
    y: d.readInt16BE(2),
    links,
    spobs,
    dudes,
    avgShips: d.readInt16BE(100),
    govt: d.readInt16BE(102),
    // Asteroids @106 (0-16); AstTypes @148 is a 16-bit mask of röid types,
    // sitting just before the Visibility control-bit string at @150
    asteroids: d.readInt16BE(106),
    astTypes: d.readUInt16BE(148),
    // Visibility @150: the control-bit expression that decides whether this
    // version of the system is the live one. Empty means always.
    visibility: cstr(d, 150, 255),
    /*
     * Message @104, Interference @108. Both sit exactly where the Bible's
     * field order puts them, between the already-verified Govt @102 and
     * Asteroids @106 and just after: "Govt, Message, Asteroids, Interference".
     * Interference confirms itself on range — it is documented 0 (clear) to
     * 100 (sensor blackout) and the shipped systems span 0 to 80, with 139 of
     * the 545 nonzero.
     */
    message: d.readInt16BE(104),
    interference: d.readInt16BE(108),
    /*
     * BkgndColor @142 as a u32, then Murk @146 — the Bible's own order, which
     * is what an earlier pass got backwards while trying Murk first.
     *
     * The colour proves itself: the Bible has it "encoded the same as HTML
     * colors (RRGGBB)", i.e. 00RRGGBB, and byte 142 is zero on all 545
     * systems, which is exactly that leading 00. No channel anywhere exceeds
     * 0x7f, so every value is a dark tint of the sort a space backdrop wants,
     * topping out at Alphara's #191900. What looked like a struct mystery
     * before — bytes 143 and 144 holding the same value on the nebula systems
     * — is just R and G being equal in an olive-grey haze.
     *
     * Murk @146 then lands in 0..50 against a documented 0..100, on 187
     * systems, and every system with a tint also carries murk.
     */
    bkgndColor: d.readUInt32BE(142) & 0xffffff,
    murk: d.readInt16BE(146),
    /*
     * The reinforcement block sits after the 256-byte Visibility string, which
     * runs 150..405. Each field identifies itself:
     *   ReinfFleet @406   -1/0 or a real flët id, and nothing else.
     *   ReinfTime  @408   every value is a multiple of 30, which is the
     *                       Bible's own unit ("a value of 30 = one second").
     *   ReinfIntrval @410 0..9, the documented interval in days.
     */
    reinfFleet: d.readInt16BE(406),
    reinfTime: d.readInt16BE(408),
    reinfInterval: d.readInt16BE(410),
  };
}

/*
 * röid 128-143: the sixteen asteroid types. The struct follows the Bible's
 * field order exactly, and the already-verified FragType1 @14 anchors it.
 * Every remaining field confirms itself against the sixteen rocks:
 *
 *   PartCount @8    15-50, rising with size within each family (Crystal runs
 *                     25/35/40/50 from Small to Huge).
 *   PartColor @10   a u32 that reads as the rock it belongs to — Ice is
 *                     0xeeeeee white, Dust 0xbe844a tan, Crystal 0x0c0c3f
 *                     deep blue, Metal 0x32323d grey. Nothing but the
 *                     particle colour would land on those four values.
 *   FragType1/2     -1 or a real röid id, and they cascade downwards: Ice
 *     @14/@16         Huge breaks into Ice Big and Ice Medium.
 *   ExplodeType @20 0-2, rising with size.
 *   Mass @22        150-1200, rising with size.
 *
 * Bytes 24..39 are zero on all sixteen.
 */
function decodeRoid(res) {
  const d = res.data;
  return {
    id: res.id,
    name: res.name,
    strength: d.readInt16BE(0),
    spinRate: d.readInt16BE(2),
    yieldType: d.readInt16BE(4),
    yieldQty: d.readInt16BE(6),
    partCount: d.readInt16BE(8),
    partColor: d.readUInt32BE(10) & 0xffffff,
    // FragType1 and 2: Nova picks between them per sub-asteroid when both are set
    fragTypes: [d.readInt16BE(14), d.readInt16BE(16)].filter((v) => v >= 128),
    fragCount: d.readInt16BE(18),
    explodeType: d.readInt16BE(20),
    mass: d.readInt16BE(22),
  };
}

function decodeDude(res) {
  const d = res.data;
  const ships = [];
  for (let i = 0; i < 16; i++) {
    const ship = d.readInt16BE(8 + i * 2);
    const prob = d.readInt16BE(40 + i * 2);
    if (ship >= 128 && prob > 0) ships.push({ id: ship, prob });
  }
  return {
    id: res.id,
    name: res.name,
    aiType: d.readInt16BE(0),
    govt: d.readInt16BE(2),
    booty: d.readUInt16BE(4), // what you get for plundering one
    // InfoTypes @6: what this class talks about when you hail it —
    // 0x1000 good prices, 0x2000 disaster news, 0x4xxx a quote from
    // STR# (7500 + the low 12 bits), 0x8000 generic govt chatter.
    infoTypes: d.readUInt16BE(6),
    ships,
  };
}

/**
 * përs: a named AI captain. Field order per the Nova Bible; offsets verified
 * against the data (ShieldMod is 100 for most, CommQuote indexes STR# 7100).
 */
function decodePers(res) {
  const d = res.data;
  /*
   * The loadout arrays are x4, not the x8 the Bible prints — the already
   * verified Credits @36 leaves exactly 24 bytes after ShipType @10, which is
   * three arrays of four and not three of eight. (The Bible over-states array
   * widths elsewhere too: it says "SpecialTech (x8)" where the struct has 3.)
   *
   * WeapCount confirms the reading on its own semantics: it carries negative
   * values (-3..-1), and the Bible says a person removes a hull's standard
   * weapons "by entering their ID numbers in the WeapType fields and entering
   * the negative of their standard load" in WeapCount. Nothing but that field
   * would be signed this way, and every WeapType value is a real wëap id.
   */
  const loadout = [];
  for (let i = 0; i < 4; i++) {
    const weapId = d.readInt16BE(12 + i * 2);
    const count = d.readInt16BE(20 + i * 2);
    const ammo = d.readInt16BE(28 + i * 2);
    if (weapId >= 128 && count !== 0) loadout.push({ id: weapId, count, ammo: Math.max(0, ammo) });
  }
  return {
    id: res.id,
    name: res.name,
    linkSyst: d.readInt16BE(0),
    govt: d.readInt16BE(2),
    aiType: d.readInt16BE(4),
    aggress: d.readInt16BE(6),
    coward: d.readInt16BE(8),
    shipType: d.readInt16BE(10),
    loadout,
    credits: d.readInt32BE(36),
    shieldMod: d.readInt16BE(40),
    /*
     * HailPict @42: a PICT shown in the comms dialog instead of the ship's
     * usual portrait. It sits exactly where the Bible's order puts it, between
     * ShieldMod @40 and the verified CommQuote @44, and exactly one përs uses
     * it — 640 "Zero Wing", pointing at PICT 7800, which exists.
     */
    hailPict: d.readInt16BE(42),
    commQuote: d.readInt16BE(44), // index into STR# 7100
    hailQuote: d.readInt16BE(46), // index into STR# 7101
    linkMission: d.readInt16BE(48),
    flags: d.readUInt16BE(50),
    /*
     * ActiveOn @52: the control-bit expression gating whether this captain is
     * in play at all. Reads back as real ncb expressions on the 17 përs that
     * use one — Techerakh is "!b222", Jack Folstam "b0 & !b8".
     */
    activeOn: cstr(d, 52, 255),
    /*
     * GrantClass/GrantCount/GrantProb @308-312, the outfit a captain hands
     * over when boarded — note the last two are the REVERSE of the Bible's
     * stated order, which lists GrantProb first.
     *
     * Only one përs uses the block (162 "Dr Ralph", reading 25 / 1 / 50), so
     * the data alone cannot separate them; playing it settles it. The
     * matching outfit is "Dr Ralph's Exploration Map", a unique item. Read in
     * the Bible's order it is handed over in stacks of 25-50 at a 1% chance —
     * boarding him in-game duly produced 39 copies of a one-off map. Read
     * this way round it is a single map at a 50% chance, which is what a
     * story item should do.
     */
    grantClass: d.readInt16BE(308),
    grantCount: d.readInt16BE(310),
    grantProb: d.readInt16BE(312),
    /*
     * An undocumented trailing string @314 — the Bible's përs section ends
     * before it. 195 captains carry one and it is plainly the ship's name:
     * Jack Folstam flies the "Night-Master", and the anonymous Terrapin përs
     * all read "Standard".
     */
    shipName: cstr(d, 314, 63),
  };
}

/** Mac STR# list: u16 count, then Pascal strings. */
function decodeStrList(data) {
  const count = data.readUInt16BE(0);
  const out = [];
  let pos = 2;
  for (let i = 0; i < count && pos < data.length; i++) {
    const len = data[pos];
    out.push(macRoman.decode(data.subarray(pos + 1, pos + 1 + len)));
    pos += 1 + len;
  }
  return out;
}

function decodeSpob(res) {
  const d = res.data;
  const flags2 = d.readUInt16BE(32);
  // CustSndID @26 is the ambience that plays when you land here (snd 10000+
  // in the Nova scenario). On a hypergate or wormhole the same field means
  // something else entirely — the angle ships emerge at — so those are read
  // as no ambience. Every one of Nova's 59 gates confirms it: not one carries
  // a value in the sound range.
  const custSnd = d.readInt16BE(26);
  const isGate = (flags2 & 0x3000) !== 0;
  return {
    id: res.id,
    name: res.name,
    ambientSnd: !isGate && custSnd >= 128 ? custSnd : null,
    /** Flags2 0x0010: hold the ambience on a loop instead of playing it once. */
    ambientLoop: (flags2 & 0x0010) !== 0,
    x: d.readInt16BE(0),
    y: d.readInt16BE(2),
    graphic: d.readInt16BE(4),
    flags: d.readUInt32BE(6),
    tribute: d.readInt16BE(10),
    techLevel: d.readInt16BE(12),
    /*
     * SpecialTech: the Bible's "(x8)" is right after all — the struct just
     * splits them. Three sit inline at @14-18 (@20 is Govt), and the other
     * five were appended to the end of the record at @1092-1100 when it grew.
     * The two blocks draw from the same 6-133 band and share most of their
     * values, and 99 spöbs use the tail slots that were being thrown away —
     * Earth alone stocks three extra special tech levels (57, 80, 116).
     */
    specialTechs: [14, 16, 18, 1092, 1094, 1096, 1098, 1100]
      .map((o) => d.readInt16BE(o))
      .filter((v) => v > 0),
    /*
     * Fee @838, the landing fee, sits where the Bible's order puts it (right
     * after OnRelease, which runs 582..837) and reads 0 on all 411 stellars —
     * no shipped world charges one. Extracted so a plug-in's would work.
     */
    fee: d.readInt16BE(838),
    govt: d.readInt16BE(20),
    /*
     * MinStatus @22: "the point on your record in the current system that
     * you'll be denied landing clearance". It sits between Govt @20 and
     * CustPicID @24, both already confirmed, and the shipped values read as
     * a legal-record threshold and nothing else: 222 worlds ignore it with 0,
     * 113 take a negative (how evil you may be before they shun you, down to
     * -100), 49 want a positive record, and 19 read 32767 — never landable.
     * This is what colours Nova's map: Rigel III (4), Menin (5) and Spacedock
     * VI (2) are exactly the systems drawn in red for a fresh pilot.
     */
    minStatus: d.readInt16BE(22),
    landingPict: d.readInt16BE(24),
    // Flags2 @32: 0x1000 hypergate, 0x2000 wormhole; HyperLink1-8 @36
    flags2,
    hyperLinks: Array.from({ length: 8 }, (_, i) => d.readInt16BE(36 + i * 2)).filter(
      (v) => v >= 128,
    ),
    // planetary defenses, and the bits set when the player takes or frees it
    defDude: d.readInt16BE(28),
    defCount: d.readInt16BE(30),
    onDominate: cstr(d, 54, 255),
    onRelease: cstr(d, 582, 255),
  };
}

function decodeShip(res) {
  const d = res.data;
  const stockWeapons = [];
  for (let i = 0; i < 4; i++) {
    const weapId = d.readInt16BE(18 + i * 2);
    const count = d.readInt16BE(26 + i * 2);
    const ammo = d.readInt16BE(34 + i * 2);
    if (weapId >= 128 && count > 0) stockWeapons.push({ id: weapId, count, ammo: Math.max(0, ammo) });
  }
  // DefaultItems @1734 / ItemCount @1750: the oütf items a hull comes with when
  // you buy or capture one — reactors, expansions, escape pods and the like.
  // 28 of Nova's hulls carry them; the Aurora Carrier arrives with an escape
  // pod and a cargo expansion already fitted.
  const defaultItems = [];
  for (let i = 0; i < 8; i++) {
    const itemId = d.readInt16BE(1734 + i * 2);
    const count = d.readInt16BE(1750 + i * 2);
    if (itemId >= 128 && count > 0) defaultItems.push({ id: itemId, count });
  }
  return {
    id: res.id,
    name: res.name,
    cargo: Math.abs(d.readInt16BE(0)), // negative = no mass expansions allowed
    shield: d.readInt16BE(2),
    accel: d.readInt16BE(4),
    speed: d.readInt16BE(6),
    turn: d.readInt16BE(8),
    fuel: d.readInt16BE(10),
    freeMass: d.readInt16BE(12),
    armor: d.readInt16BE(14),
    shieldRech: d.readInt16BE(16),
    // MaxGun/MaxTur sit right after the 4 weapon slots (type/count/ammo x4,
    // @18-41). Confirmed against the shipyard screen: the Heavy Shuttle reads
    // 2 guns, 0 turrets, 12 m long.
    maxGuns: d.readInt16BE(42),
    maxTurrets: d.readInt16BE(44),
    techLevel: d.readInt16BE(46),
    cost: d.readInt32BE(48), // 32-bit: ships cost up to tens of millions
    mass: d.readInt16BE(62),
    length: d.readInt16BE(64), // metres; shown in the detailed ship info
    crew: d.readInt16BE(68), // defenders when the ship is boarded
    strength: d.readInt16BE(70), // combat-rating points awarded for a kill
    /*
     * InherentGovt @72: the government a hull belongs to by nature, which is
     * what decides whose status bar the player flies behind and which side an
     * AI ship is on before any mission touches it. Found by elimination — it
     * is the only field in the 1860-byte struct whose every value is either -1
     * or a real gövt id in one of the three bands the Bible defines — and
     * confirmed by adjacency, since the Bible puts InherentGovt immediately
     * before "some miscellaneous flags", and Flags is the already-verified @74.
     * The Cargo Drone reads govt 184, "Cargo Drone Robots".
     *
     * The bands split the two roles: 128-383 is both combat and attributes,
     * 1128-1383 attributes only, 2128-2383 combat only.
     */
    inherentGovt: (() => {
      const v = d.readInt16BE(72);
      if (v < 128) return null;
      if (v >= 2128) return { govt: v - 2000, combat: true, attributes: false };
      if (v >= 1128) return { govt: v - 1000, combat: false, attributes: true };
      return { govt: v, combat: true, attributes: true };
    })(),
    flags: d.readUInt16BE(74), // 0x40 = AI-only variant, hidden from shipyards
    flags2: d.readUInt16BE(98), // 0x0100-0x2000: AI cloaking behaviours
    // BuyRandom/HireRandom: percent chance per day of being offered for sale
    // or for hire. 0 means never — which is what filters Nova's 288 shïp
    // resources down to the ~88 that are actually player-purchasable, and
    // why the Cargo Drone and the AI-only Shuttle variants stay out of the
    // showroom.
    buyRandom: d.readInt16BE(904),
    hireRandom: d.readInt16BE(906),
    // ShortName is what the shipyard menu lists; a "\n" splits it onto a
    // second, grey line — that's where "- used -" comes from. LongName is
    // the full marque shown over the ship's picture.
    shortName: cstr(d, 1486, 63),
    longName: cstr(d, 1582, 183),
    avail: cstr(d, 108, 255), // shipyard availability ncb expression
    stockWeapons,
    defaultItems,
  };
}

function decodeWeap(res) {
  const d = res.data;
  return {
    id: res.id,
    name: res.name,
    reload: d.readInt16BE(0), // frames (30/s)
    duration: d.readInt16BE(2), // projectile lifetime, frames
    armorDmg: d.readInt16BE(4),
    shieldDmg: d.readInt16BE(6),
    guidance: d.readInt16BE(8), // -1 unguided, 0 beam, 1 homing, 4 turret, 5 freefall, 6 rocket...
    speed: d.readInt16BE(10),
    ammoType: d.readInt16BE(12),
    graphic: d.readInt16BE(14), // spïn 3000+graphic
    accuracy: d.readInt16BE(16), // inaccuracy, degrees
    sound: d.readInt16BE(18), // snd id = 200 + this, or -1
    impact: d.readInt16BE(20),
    // ExplodType: the bööm to spawn on impact, as an index (-1 = none).
    // Confirmed by name: bööm 132 "ship breakup" and 133 "ship exploding"
    // point at exactly the snd resources of those names.
    explodType: d.readInt16BE(22),
    proxRadius: d.readInt16BE(24),
    blastRadius: d.readInt16BE(26),
    flags: d.readUInt16BE(28),
    // beams (guidance 0/3): colors are 0x00RRGGBB — Nova stores alpha inverted
    beamLength: d.readInt16BE(48),
    beamWidth: d.readInt16BE(50),
    beamColor: d.readUInt32BE(54) & 0xffffff,
    coronaColor: d.readUInt32BE(58) & 0xffffff,
    // JamVuln1-4: vulnerability (0-100%) to each jamming type. Verified by
    // semantics — the IR Missile reads 100 against jam type 1, the Radar
    // Missile 100 against type 2.
    jamVuln: [94, 96, 98, 100].map((o) => d.readInt16BE(o)),
    /*
     * ExitType @88: which of the shän's four classes of weapon exit point this
     * weapon fires from — 0 gun, 1 turret, 2 guided, 3 beam, -1 ship centre.
     * @88 is the only field in the 134-byte struct whose values across all 81
     * weapons stay inside -1..3, and it lines up with Guidance exactly as the
     * Bible's description implies: all 16 beams read 3, 12 of 13 homing
     * missiles read 2, turrets read 1, and unguided cannon read 0.
     */
    exitType: d.readInt16BE(88),
    /*
     * The tail of the wëap struct, in the Bible's own order. Ionization @114
     * was already pinned, and it anchors everything back to ExitType @88:
     * the fields between them land on JamVuln1-4 @94-100 (already read) with
     * Burst before and the guided-weapon block after, exactly as documented.
     * Each one was then confirmed on its own semantics:
     *
     *   Seeker @30      nonzero only on guided weapons; the IR Missile reads
     *                     "decoyed by asteroids" and the Radar Missile adds
     *                     "confused by sensor interference".
     *   Sub* @62-68     "Polaron Multi-Torp." splits into 5 of wëap 148,
     *                     which is "Polaron Torp.", at 45 degrees of spread;
     *                     Nanites submunition into themselves, the recursive
     *                     case SubLimit exists for.
     *   Burst @90/92    set on exactly the rapid-fire weapons — both
     *                     chainguns, the Pulse Laser, the Quad Blaster Turret
     *                     and the Ion and Polaron Cannon.
     *   MaxAmmo @108    nonzero on exactly the 18 fighter bays, never without
     *                     an AmmoType.
     *   GuidedTurn @106 nonzero on all 13 guided weapons and nothing else.
     *   LiDensity @112  nonzero on exactly the 6 beams; the Wraith Graviton
     *                     Beams scale 4/8/12 across Child/Youth/Adult.
     *   Recoil @110     the heavy cannon and beams, scaling with size.
     */
    seeker: d.readUInt16BE(30),
    subCount: d.readInt16BE(62),
    subType: d.readInt16BE(64),
    subTheta: d.readInt16BE(66),
    subLimit: d.readInt16BE(68),
    proxSafety: d.readInt16BE(70),
    burstCount: d.readInt16BE(90),
    burstReload: d.readInt16BE(92),
    flags3: d.readUInt16BE(102),
    durability: d.readInt16BE(104),
    guidedTurn: d.readInt16BE(106),
    maxAmmo: d.readInt16BE(108),
    recoil: d.readInt16BE(110),
    liDensity: d.readInt16BE(112),
    // Ionization @114: the charge this weapon dumps into whatever it hits.
    // Nonzero exactly for Nova's system-killers (Ion Cannon, EMP Torp, EW
    // Missile, Nanites, Polaron).
    ionization: d.readInt16BE(114),
  };
}

/**
 * chär: the starting character template. Cash is a 32-bit field, then the
 * starting ship and up to four possible starting systems.
 */
/**
 * chär: a starting template. Offsets confirmed against the shipped ".Trader" —
 * 25,000 credits, a Shuttle, the four Fed starting systems, PICTs 8200-8202 at
 * 45 seconds each for the opening sequence, and a start date of 23 June 1177
 * with " NC" hung off the end of it.
 */
function decodeChar(res) {
  const d = res.data;
  const pair = (a, b) => {
    const out = [];
    for (let i = 0; i < 4; i++) {
      const govt = d.readInt16BE(a + i * 2);
      if (govt >= 128) out.push({ govt, status: d.readInt16BE(b + i * 2) });
    }
    return out;
  };
  return {
    id: res.id,
    name: res.name,
    cash: d.readInt32BE(0),
    shipType: d.readInt16BE(4),
    systems: [6, 8, 10, 12].map((o) => d.readInt16BE(o)).filter((v) => v >= 128),
    // Govt1-4 @14 with Status1-4 @22: the legal record this pilot opens with
    // in each government's space (and the negative of it in their enemies').
    records: pair(14, 22),
    kills: d.readInt16BE(30),
    // the opening sequence: up to four PICTs, each with its own dwell time
    introPicts: [32, 34, 36, 38].map((o) => d.readInt16BE(o)).filter((v) => v >= 128),
    pictDelays: [40, 42, 44, 46].map((o) => d.readInt16BE(o)).filter((v) => v > 0),
    introTextId: d.readInt16BE(48),
    /** control bits set the moment this pilot is created */
    onStart: cstr(d, 50, 255),
    flags: d.readUInt16BE(306),
    startDay: d.readInt16BE(308),
    startMonth: d.readInt16BE(310),
    startYear: d.readInt16BE(312),
    datePrefix: cstr(d, 314, 16),
    dateSuffix: cstr(d, 330, 16),
  };
}

/**
 * ïntf: the status-bar definition. Field order per the Nova Bible; verified
 * against the shipped interface (shield #bd0000, armor #a6a6a6, Geneva).
 */
function decodeIntf(res) {
  const d = res.data;
  const col = (o) => `#${(d.readUInt32BE(o) & 0xffffff).toString(16).padStart(6, "0")}`;
  // Each *Area is a Mac Rect: top, left, bottom, right as four int16. Nova's
  // own bars all sit inside x 8-184, i.e. a 192-wide panel with 8px margins.
  const rect = (o) => ({
    x: d.readInt16BE(o + 2),
    y: d.readInt16BE(o),
    w: d.readInt16BE(o + 6) - d.readInt16BE(o + 2),
    h: d.readInt16BE(o + 4) - d.readInt16BE(o),
  });
  return {
    id: res.id,
    name: res.name,
    brightText: col(0),
    dimText: col(4),
    radarArea: rect(8),
    brightRadar: col(16),
    dimRadar: col(20),
    shieldArea: rect(24),
    shieldColor: col(32),
    armorArea: rect(36),
    armorColor: col(44),
    fuelArea: rect(48),
    fuelFull: col(56),
    fuelPartial: col(60),
    navArea: rect(64),
    weapArea: rect(72),
    targArea: rect(80),
    cargoArea: rect(88),
    // StatusFont is a 64-byte C string, then the two sizes and the backdrop
    statusFont: cstr(d, 96, 64),
    statFontSize: d.readInt16BE(160),
    subtitleSize: d.readInt16BE(162),
    statusBkgnd: d.readInt16BE(164),
  };
}

/**
 * crön: a time-driven event. Dates, a percentage chance, a duration and two
 * holdoffs, then three ncb strings (EnableOn / OnStart / OnEnd) at 255-byte
 * strides. News fields sit in the tail and are mostly unused by Nova itself.
 */
/** bööm 128-191: how each explosion type animates and sounds. */
function decodeBoom(res) {
  const d = res.data;
  return {
    id: res.id,
    name: res.name,
    frameAdvance: d.readInt16BE(0),
    soundIndex: d.readInt16BE(2),
    graphicIndex: d.readInt16BE(4),
  };
}

/** öops: a commodity price disaster at a world. */
function decodeOops(res) {
  const d = res.data;
  return {
    id: res.id,
    name: res.name,
    stellar: d.readInt16BE(0),
    commodity: d.readInt16BE(2),
    priceDelta: d.readInt16BE(4),
    duration: d.readInt16BE(6),
    freq: d.readInt16BE(8),
    activateOn: cstr(d, 10, 255),
  };
}

/** nëbu: a background nebula on the star map. */
function decodeNebu(res) {
  const d = res.data;
  return {
    id: res.id,
    name: res.name,
    x: d.readInt16BE(0),
    y: d.readInt16BE(2),
    w: d.readInt16BE(4),
    h: d.readInt16BE(6),
    activeOn: cstr(d, 8, 255),
  };
}

/**
 * ränk: a commission or standing with a government. Offsets read off the
 * shipped data — Federation Commander carries weight 1, govt 128, PriceMod 85
 * and a 200cr/day salary, with its names at 24 and 88.
 */
function decodeRank(res) {
  const d = res.data;
  return {
    id: res.id,
    name: res.name.split(";")[0].trim(),
    weight: d.readInt16BE(0),
    govt: d.readInt16BE(2),
    priceMod: d.readInt16BE(4),
    salary: d.readInt16BE(8),
    flags: d.readUInt16BE(22),
    convName: cstr(d, 24, 63),
    shortName: cstr(d, 88, 63),
  };
}

/** flët: a flagship with escorts that appears together. */
function decodeFleet(res) {
  const d = res.data;
  const escorts = [];
  for (let i = 0; i < 4; i++) {
    const type = d.readInt16BE(2 + i * 2);
    const min = d.readInt16BE(10 + i * 2);
    const max = d.readInt16BE(18 + i * 2);
    if (type >= 128 && max > 0) escorts.push({ id: type, min: Math.max(0, min), max });
  }
  return {
    id: res.id,
    name: res.name,
    leadShip: d.readInt16BE(0),
    escorts,
    govt: d.readInt16BE(26),
    linkSyst: d.readInt16BE(28),
    appearOn: cstr(d, 32, 255),
  };
}

function decodeCron(res) {
  const d = res.data;
  return {
    id: res.id,
    name: res.name,
    firstDay: d.readInt16BE(0),
    firstMonth: d.readInt16BE(2),
    firstYear: d.readInt16BE(4),
    lastDay: d.readInt16BE(6),
    lastMonth: d.readInt16BE(8),
    lastYear: d.readInt16BE(10),
    random: d.readInt16BE(12),
    duration: d.readInt16BE(14),
    preHoldoff: d.readInt16BE(16),
    postHoldoff: d.readInt16BE(18),
    // IndNewsStr @20, Flags @22 — not the other way round. Flags only ever
    // reads 0, 1 or 2 (the two iterative bits) and @22 is the only offset in
    // range that holds nothing else, while @20 carries -1 or a STR# out of the
    // 15000 news bank. Reading @20 as Flags had 25 cröns claiming flags of
    // 15007 and up, which would have set both iterative bits.
    indNewsStr: d.readInt16BE(20),
    flags: d.readUInt16BE(22),
    enableOn: cstr(d, 24, 255),
    onStart: cstr(d, 279, 255),
    onEnd: cstr(d, 534, 255),
    // NewsGovt1-4 @806 with their GovtNewsStr1-4 @814: while the event runs,
    // worlds allied to one of those governments report that government's line
    // instead of the independent one.
    newsGovts: [806, 808, 810, 812].map((o) => d.readInt16BE(o)),
    govtNewsStrs: [814, 816, 818, 820].map((o) => d.readInt16BE(o)),
  };
}

function decodeMisn(res) {
  const d = res.data;
  const s = (off) => cstr(d, off, 255);
  return {
    id: res.id,
    name: res.name,
    availStel: d.readInt16BE(0),
    availLoc: d.readInt16BE(4),
    availRating: d.readInt16BE(6),
    availRecord: d.readInt16BE(8),
    availRandom: d.readInt16BE(10),
    travelStel: d.readInt16BE(12),
    returnStel: d.readInt16BE(14),
    cargoType: d.readInt16BE(16),
    cargoQty: d.readInt16BE(18),
    pickupMode: d.readInt16BE(20),
    dropOffMode: d.readInt16BE(22),
    pay: d.readInt32BE(28),
    shipCount: d.readInt16BE(32),
    shipSyst: d.readInt16BE(34),
    shipDude: d.readInt16BE(36),
    shipGoal: d.readInt16BE(38),
    briefText: d.readInt16BE(52),
    quickBrief: d.readInt16BE(54),
    loadCargText: d.readInt16BE(56),
    dropCargText: d.readInt16BE(58),
    compText: d.readInt16BE(60),
    failText: d.readInt16BE(62),
    timeLimit: d.readInt16BE(64),
    canAbort: d.readInt16BE(66),
    shipDoneText: d.readInt16BE(68),
    shipBehav: d.readInt16BE(40),
    compReward: d.readInt16BE(48),
    compGovt: d.readInt16BE(90),
    /*
     * DatePostInc @72: days the calendar jumps once the mission finishes.
     * It is the only unread field in the struct's scalar region whose values
     * look like day counts (0..50 across 136 missions, everything else there
     * being an already-verified field), and the missions that carry one are
     * exactly the sort that should consume time — "Escort Merchant" +3,
     * "Rebel Food Drop" +4, "Capture Vell-os" +8.
     */
    datePostInc: d.readInt16BE(72),
    flags: d.readUInt16BE(80),
    availBits: s(92),
    onAccept: s(347),
    onRefuse: s(602),
    onSuccess: s(857),
    onFailure: s(1112),
    onAbort: s(1367),
    onShipDone: s(1622),
  };
}

function decodeOutf(res) {
  const d = res.data;
  const mods = [];
  for (const pos of [6, 18, 22, 26]) {
    const modType = d.readInt16BE(pos);
    const modVal = d.readInt16BE(pos + 2);
    if (modType > 0) mods.push([modType, modVal]);
  }
  return {
    id: res.id,
    name: res.name,
    displayWeight: d.readInt16BE(0),
    mass: d.readInt16BE(2),
    techLevel: d.readInt16BE(4),
    max: d.readInt16BE(10),
    // Flags @12, between Max and Cost. Confirmed by correlation: all 149
    // outfits carrying 0x4000 ("hide unless Availability is true") have a
    // non-empty Availability string, and none without the flag do.
    flags: d.readUInt16BE(12),
    cost: d.readInt32BE(14),
    avail: cstr(d, 46, 255), // outfitter availability ncb expression
    // OnPurchase @301 and OnSell @556, each a 255-byte control-bit set string
    // behind Availability. One outfit's OnPurchase reads "H165" — the
    // change-ship operator — which is what marks these as set strings rather
    // than tests; in a set string "!bNNN" clears the bit instead of testing it.
    onPurchase: cstr(d, 301, 255),
    onSell: cstr(d, 556, 255),
    /*
     * The tail scalars sit after the three name strings — ShortName @811,
     * LCName @875 and LCPlural @939, each 64 bytes — not before them as the
     * Bible's field order implies.
     *
     * ItemClass @1004 is set on exactly one outfit, "Dr Ralph's Exploration
     * Map", with the value 25; the only përs carrying a GrantClass is "Dr
     * Ralph", also 25. Those two fields confirm each other outright.
     * ScanMask @1006 is a sparse 16-bit mask on the 56 contraband outfits,
     * and BuyRandom @1008 runs 0..100 in steps of 5.
     *
     * Contribute @1012 and Require @1020 fill the struct exactly to its 1028
     * bytes, and are zero on all 242 outfits — nothing in the shipped
     * scenario uses the Contribute/Require permit system at all.
     */
    itemClass: d.readInt16BE(1004),
    scanMask: d.readUInt16BE(1006),
    buyRandom: d.readInt16BE(1008),
    requireGovt: d.readInt16BE(1010),
    contribute: [d.readUInt32BE(1012), d.readUInt32BE(1016)],
    require: [d.readUInt32BE(1020), d.readUInt32BE(1024)],
    mods,
  };
}

// ---- main ----

const novaFilesDir = process.argv[2];
if (!novaFilesDir) {
  console.error('usage: node scripts/extract-nova.mjs "<Nova Files dir>"');
  process.exit(1);
}

const byTypeId = new Map(); // `${type}:${id}` -> resource (later files win)
// scan every .rez: galaxy/ship data live in Nova Data 1-6, but ship
// descriptions (dësc 13000+) ship alongside the sprites in Nova Ships 1-7
const dataFiles = readdirSync(novaFilesDir)
  .filter((f) => f.endsWith(".rez"))
  .sort();
if (dataFiles.length === 0) throw new Error("no .rez files found");

for (const f of dataFiles) {
  const buf = readFileSync(join(novaFilesDir, f));
  const resources = parseRez(buf);
  const counts = {};
  for (const r of resources) {
    counts[r.type] = (counts[r.type] ?? 0) + 1;
    byTypeId.set(`${r.type}:${r.id}`, r);
  }
  console.log(
    `${f}: ${resources.length} resources —`,
    Object.entries(counts)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 8)
      .map(([t, n]) => `${t}:${n}`)
      .join(" "),
  );
}

const all = [...byTypeId.values()];
const systs = all.filter((r) => r.type === "sÿst").map(decodeSyst);
const spobs = all.filter((r) => r.type === "spöb").map(decodeSpob);
const readGovtGroup = (d, base) =>
  [0, 2, 4, 6].map((o) => d.readInt16BE(base + o)).filter((v) => v !== -1);
const govts = all.filter((r) => r.type === "gövt").map((r) => ({
  id: r.id,
  name: r.name,
  // VoiceType @0: which bank of escort speech this govt's ships use (snd
  // 1000 + type*100). -1 is mute — which is exactly what the Wraith, Krypt
  // and Hyperioid read, none of them being things that talk. Values 1000-1007
  // and 2000-2007 force the odd or even half of a bank; Nova uses that to
  // pick the male or female takes.
  voiceType: r.data.readInt16BE(0),
  // Flags @2 / Flags2 @4. Confirmed on the comms rules: Flags2 0x0001 ("the
  // request assistance / beg for mercy button is disabled and the govt is not
  // talkative") and 0x0008 ("don't respond with greetings when hailed") are
  // set on exactly the Wraith and the Krypt, the two things in Nova that
  // famously never answer a hail.
  flags: r.data.readUInt16BE(2),
  flags2: r.data.readUInt16BE(4),
  /*
   * The legal model, in the Bible's own order behind Flags2. Every one lands
   * where it should: the penalties sit in a -1..40 band ("the amount of
   * evilness a player gains"), InitialRec in -5..10, MaxOdds up to 1000.
   */
  /*
   * ScanMask @50: the 16-bit mask a government scans for. It is the only
   * sparse bit field in the struct, and it interlocks with the identically
   * shaped masks on oütf and jünk to produce exactly the right contraband:
   * the Federation (0x8000) bans fighter bays and bio-weapons, the Auroran
   * Empire (0x4000) EMP torpedoes and Monkdillo Shells, the Polaris (0x2000)
   * adds the Wraith Cannon, the Krypt (0x0020) care only about the Ancient
   * Vell-os Sculpture, and the Pirates (0x0800) confiscate nearly every
   * valuable cargo in the game. 55 of the 68 governments scan for something.
   */
  scanMask: r.data.readUInt16BE(50),
  crimeTol: r.data.readInt16BE(6),
  scanFine: r.data.readInt16BE(8),
  smugPenalty: r.data.readInt16BE(10),
  disabPenalty: r.data.readInt16BE(12),
  boardPenalty: r.data.readInt16BE(14),
  killPenalty: r.data.readInt16BE(16),
  shootPenalty: r.data.readInt16BE(18),
  initialRec: r.data.readInt16BE(20),
  maxOdds: r.data.readInt16BE(22),
  // CommName @68: the short name Nova shows for this govt's ships in the
  // comms panel — "Fed." for the Federation, "Trader" for the Civvies.
  commName: cstr(r.data, 68, 64).trim(),
  classes: readGovtGroup(r.data, 24),
  allies: readGovtGroup(r.data, 32),
  enemies: readGovtGroup(r.data, 40),
  /*
   * Color @164 and ShipColor @168, both 00RRGGBB. The offset is confirmed by
   * the data naming itself: every one of the eight Federation resources reads
   * #2c2caf, all five Aurorans #cf0c0c, both Polaris #7c1c7c, the Vell-os
   * #c3c310 and the Rebellion #2baa2b — sixteen name-groups, each internally
   * identical, which no other 4-byte window in the struct manages. It also
   * lands immediately before Interface @172, already verified.
   * 16 governments read #000000, the Bible's "unused". ShipColor is 0 on all
   * 68, so it is recorded but nothing paints a hull with it.
   */
  color: r.data.readUInt32BE(164),
  shipColor: r.data.readUInt32BE(168),
  // Interface @172: the ïntf this government's own ships fly behind. Offset
  // found by elimination and unambiguous once read — Federation lands on 130
  // "Federation Status bar", Polaris on 129, Pirate on 133, Vell-os on 134,
  // and the Auroran families all share the Auroran bar. Under 128 means the
  // default. 48 of the 68 governments name one.
  interfaceId: Math.max(128, r.data.readInt16BE(172)),
  // NewsPic @174: the backdrop of the holovid news window on this govt's
  // worlds. Federation reads 9001 "Hyper News Network", Polaris 9002; under
  // 128 means the generic independent backdrop, PICT 9000.
  newsPic: (() => { const v = r.data.readInt16BE(174); return v >= 128 ? v : 9000; })(),
}));
// keep every dësc — missions reference IDs all over the 4000-30000 range
const descs = {};
for (const r of all) {
  if (r.type === "dësc") descs[r.id] = cstr(r.data, 0);
}
/**
 * jünk: Nova's special commodities — the goods that only change hands at named
 * worlds rather than on the six-commodity exchange. Two lists of eight spöb IDs
 * say where each one comes from and where it finds a buyer, and the price sits
 * between them. Verified by reading the lists back as names: Water is sold on
 * Europa, Haven and Tidal and bought on Arabus and Dani, and Opals come off
 * Gem and Thror. This is also what röid YieldType's 1000+n encoding points at.
 */
function decodeJunk(res) {
  const d = res.data;
  const spobList = (start) => {
    const out = [];
    for (let i = 0; i < 8; i++) {
      const v = d.readInt16BE(start + i * 2);
      if (v > 0) out.push(v);
    }
    return out;
  };
  return {
    id: res.id,
    name: res.name,
    soldAt: spobList(0),
    boughtAt: spobList(16),
    price: d.readInt16BE(32),
    flags: d.readUInt16BE(34),
    // ScanMask @36: which governments treat this cargo as contraband
    scanMask: d.readUInt16BE(36),
    /*
     * The two string fields chain exactly to the end of the 676-byte record:
     * LCName @38 (64) -> Abbrev @102 (64) -> BuyOn @166 (256) -> SellOn @422
     * (254). Abbrev reading "Pelts" for the Ice Lizard Pelts fixes the start
     * of the chain, and BuyOn's one user reads "b43", a real control-bit
     * expression.
     */
    buyOn: cstr(d, 166, 255),
    sellOn: cstr(d, 422, 253),
  };
}

const junks = all.filter((r) => r.type === "jünk").map(decodeJunk);
const ships = all
  .filter((r) => r.type === "shïp")
  .map((r) => {
    const ship = decodeShip(r);
    // ship class descriptions: dësc 13000-13767, indexed by shïp ID - 128
    const desc = byTypeId.get(`dësc:${13000 + (r.id - 128)}`);
    ship.desc = desc ? cstr(desc.data, 0) : "";
    return ship;
  })
  .sort((a, b) => a.cost - b.cost);

const weapons = all.filter((r) => r.type === "wëap").map(decodeWeap);

const missions = all.filter((r) => r.type === "mïsn").map(decodeMisn);

const dudes = all.filter((r) => r.type === "düde").map(decodeDude);

const persons = all.filter((r) => r.type === "përs").map(decodePers);

const chars = all.filter((r) => r.type === "chär").map(decodeChar);

const roids = all.filter((r) => r.type === "röid").map(decodeRoid);

const interfaces = all.filter((r) => r.type === "ïntf").map(decodeIntf);

const crons = all.filter((r) => r.type === "crön").map(decodeCron);

const fleets = all.filter((r) => r.type === "flët").map(decodeFleet);

const ranks = all.filter((r) => r.type === "ränk").map(decodeRank);

/*
 * cölr: the game-wide interface colours, fonts and main-menu layout. Only the
 * first cölr is loaded, per the Bible. The 244-byte struct packs gaplessly in
 * the Bible's field order, and every field is self-evident once laid out:
 * "Geneva" and "Charcoal" fall where the two font-name strings belong, the
 * progress bar reads as a 200x10 Rect centred on the window (top 280, left
 * -100, bottom 290, right 100), and Button1-6 come out at exactly the six
 * positions the main menu was already using — they had been read off this
 * resource by hand and typed into menu.ts, and now come from the data.
 */
function decodeColr(res) {
  const d = res.data;
  const col = (o) => d.readUInt32BE(o) & 0xffffff;
  const pt = (o) => ({ x: d.readInt16BE(o), y: d.readInt16BE(o + 2) });
  return {
    buttonUp: col(0),
    buttonDown: col(4),
    buttonGrey: col(8),
    menuFont: cstr(d, 12, 63),
    menuFontSize: d.readInt16BE(76),
    menuBright: col(78),
    menuDim: col(82),
    /*
     * The Bible names these GridDim then GridBright, but the pair reads
     * #ff0000 then #404040 — so taken at face value the "bright" selection
     * square would be the duller of the two, and grey-on-black would barely
     * show. The neighbouring Prog triple (#ff0000 / #800000 / #404040) sets
     * the house style: red is the highlight, #404040 the structural line. So
     * they are named here by what they are for rather than by the doc's
     * order. Two colours, no third sample to settle it against.
     */
    gridLine: col(90),
    gridSelection: col(86),
    progressBar: {
      top: d.readInt16BE(94), left: d.readInt16BE(96),
      bottom: d.readInt16BE(98), right: d.readInt16BE(100),
    },
    progBright: col(102),
    progDim: col(106),
    progOutline: col(110),
    /** the six main-menu buttons, relative to a 1024x768 backdrop */
    buttons: Array.from({ length: 6 }, (_, k) => pt(114 + k * 4)),
    floatingMap: col(138),
    listText: col(142),
    listBkgnd: col(146),
    listHilite: col(150),
    escortHilite: col(154),
    buttonFont: cstr(d, 158, 63),
    buttonFontSize: d.readInt16BE(222),
    logo: pt(224),
    rollover: pt(228),
    slides: [pt(232), pt(236), pt(240)],
  };
}
const colrRes = all.find((r) => r.type === "cölr");
const colr = colrRes ? decodeColr(colrRes) : null;

const booms = all.filter((r) => r.type === "bööm").map(decodeBoom);
const oopses = all.filter((r) => r.type === "öops").map(decodeOops);
const nebulae = all.filter((r) => r.type === "nëbu").map(decodeNebu);

// STR# lists we use: 7100/7101 are the things named captains say when you
// hail them; 134 legal-status titles, 138 combat ratings, 4000 cargo names
// and 4002 their abbreviations for the HUD readout.
const strLists = {};
// 7000-7042 are the per-government hail lines Nova reads for düde InfoTypes
// 0x8000, indexed STR# 7000 + govtID - 128 (Federation 128 -> 7000 "Federation",
// Wraith 138 -> 7010 "Wraith").
const govtHailLists = Array.from({ length: 43 }, (_, i) => 7000 + i);
// crön news banks: every STR# a NewsGovt or IndNewsStr field points at
const cronNewsLists = [...new Set(crons.flatMap((c) => [c.indNewsStr, ...c.govtNewsStrs]))].filter(
  (id) => id > 0,
);
// 1000 is the message-buoy bank a sÿst's Message field indexes into.
for (const id of [134, 138, 150, 1000, 4000, 4002, 7100, 7101, 8100, 8101, ...govtHailLists, ...cronNewsLists]) {
  const res = byTypeId.get(`STR#:${id}`);
  if (res) strLists[id] = decodeStrList(res.data);
}

const outfits = all
  .filter((r) => r.type === "oütf")
  .map((r) => {
    const outf = decodeOutf(r);
    // outfit descriptions: dësc 3000-3511, indexed by oütf ID - 128
    const desc = byTypeId.get(`dësc:${3000 + (r.id - 128)}`);
    outf.desc = desc ? cstr(desc.data, 0) : "";
    return outf;
  })
  // "Items with a higher display weight are shown closer to the top of the
  // outfit dialog" — sorting the other way opened every outfitter on licences
  // instead of on the Light Blaster.
  .sort((a, b) => b.displayWeight - a.displayWeight);

/**
 * Evaluate a Nova control-bit expression with every bit clear — the state a
 * fresh pilot starts in. Grammar is b<N> literals, ! & | and parentheses.
 * Anything unparseable is treated as "not gated" so a system never vanishes.
 */
function visibleAtStart(expr) {
  if (!expr) return true;
  const tokens = expr.match(/b\d+|[!&|()]/gi);
  if (!tokens) return true;
  let i = 0;
  const peek = () => tokens[i];
  const parseOr = () => {
    let v = parseAnd();
    while (peek() === "|") { i++; v = parseAnd() || v; }
    return v;
  };
  const parseAnd = () => {
    let v = parseUnary();
    while (peek() === "&") { i++; v = parseUnary() && v; }
    return v;
  };
  const parseUnary = () => {
    if (peek() === "!") { i++; return !parseUnary(); }
    if (peek() === "(") { i++; const v = parseOr(); if (peek() === ")") i++; return v; }
    i++;
    return false; // every control bit is clear at the start of a new game
  };
  try {
    const v = parseOr();
    return i === tokens.length ? v : true;
  } catch {
    return true;
  }
}

/*
 * Deduplicate story-state variants. Nova ships several sÿst resources per
 * system name, each gated by a Visibility control-bit expression, and picks
 * whichever one is currently true. Taking the lowest ID outright picked
 * story-state variants that should still be dormant: Pentori, Willon, Chicea
 * and Varden all read "!b330 & b9500", the post-invasion version, which is
 * why Krypt Pods were flying around four systems that should have none.
 *
 * So: prefer the variants that are live at game start, lowest ID among those,
 * and only fall back to the lowest ID overall if a name has nothing active
 * (S7evyn is gated on b9995 and has no ungated version at all).
 */
systs.sort((a, b) => a.id - b.id);
const keptByName = new Map();
const alias = new Map(); // dropped id -> kept id
const hidden = [];
for (const s of systs) {
  if (!keptByName.has(s.name)) keptByName.set(s.name, []);
  keptByName.get(s.name).push(s);
}
for (const [name, variants] of keptByName) {
  const live = variants.filter((s) => visibleAtStart(s.visibility));
  if (live.length === 0) {
    // Every version of this system is gated behind story bits, so at the start
    // of a new game it simply isn't there. Pentori, Willon, Chicea and Varden
    // all read b9500 either way round — they are Krypt space that appears once
    // that thread opens, not systems a new pilot should be able to fly into.
    hidden.push(`${name} (${variants.map((v) => v.id).join(",")})`);
    keptByName.delete(name);
    continue;
  }
  keptByName.set(name, live[0]);
  for (const s of variants) if (s.id !== live[0].id) alias.set(s.id, live[0].id);
}
const systems = [...keptByName.values()];
const systemIds = new Set(systems.map((s) => s.id));
if (hidden.length) console.log(`Hidden at game start (story-gated): ${hidden.join("; ")}`);
for (const s of systems) {
  s.links = [...new Set(s.links.map((l) => alias.get(l) ?? l))].filter((l) =>
    systemIds.has(l),
  );
}

const galaxy = {
  colr,
  systems, spobs, govts, descs, ships, weapons, outfits, missions, junks, dudes,
  persons, strLists, chars, roids, interfaces, crons, fleets, ranks,
  booms, oopses, nebulae,
};
const outDir = join(dirname(fileURLToPath(import.meta.url)), "..", "public", "nova");
mkdirSync(outDir, { recursive: true });
writeFileSync(join(outDir, "galaxy.json"), JSON.stringify(galaxy));

console.log(
  `\nExtracted: ${systems.length} systems (${systs.length} raw), ${spobs.length} spobs, ` +
    `${govts.length} govts, ${Object.keys(descs).length} landing descriptions, ${ships.length} ships`,
);
console.log(
  `Weapons: ${weapons.length}, Outfits: ${outfits.length}, Missions: ${missions.length}, ` +
    `Descs: ${Object.keys(descs).length}, Persons: ${persons.length}, ` +
    `Quotes: ${(strLists[7100] ?? []).length}/${(strLists[7101] ?? []).length}`,
);
console.log("Sample person:", JSON.stringify(persons.find((p) => p.linkMission >= 128)));
console.log("Start template:", JSON.stringify(chars[0]));
console.log("Interface:", JSON.stringify(interfaces[0]));
console.log(`Crons: ${crons.length}; sample:`, JSON.stringify(crons[0]));
console.log(`Fleets: ${fleets.length}; sample:`, JSON.stringify(fleets[0]));
console.log(`Ranks: ${ranks.length}; sample:`, JSON.stringify(ranks[0]));
console.log(`Booms: ${booms.length};`, JSON.stringify(booms[0]));
console.log(`Oops: ${oopses.length};`, JSON.stringify(oopses[0]));
console.log(`Nebulae: ${nebulae.length};`, JSON.stringify(nebulae[0]));
console.log(`Booms: ${booms.length};`, JSON.stringify(booms[0]));
console.log(`Oops: ${oopses.length};`, JSON.stringify(oopses[0]));
console.log(`Nebulae: ${nebulae.length};`, JSON.stringify(nebulae[0]));
console.log(`Asteroid types: ${roids.length}; systems with fields: ${systems.filter((s) => s.asteroids > 0).length}`);
const m129 = missions.find((m) => m.id === 129);
console.log("misn 129 onAccept (expect b511):", JSON.stringify(m129?.onAccept));
const delivery = missions.find((m) => m.id === 128);
console.log("misn 128:", JSON.stringify({ availStel: delivery.availStel, loc: delivery.availLoc, pay: delivery.pay, cargo: [delivery.cargoType, delivery.cargoQty], travel: delivery.travelStel, ret: delivery.returnStel }));
const shuttleShip = ships.find((s) => s.id === 128);
console.log("Shuttle stock weapons:", JSON.stringify(shuttleShip.stockWeapons));
console.log(
  "Sample weapon:",
  JSON.stringify(weapons.find((w) => w.id === shuttleShip.stockWeapons[0]?.id) ?? weapons[0]),
);
console.log("Sample systems:", systems.slice(0, 8).map((s) => s.name).join(", "));
const earth = spobs.find((p) => p.name === "Earth");
console.log("Earth:", JSON.stringify(earth));
if (earth) console.log("Earth desc:", (descs[earth.id] ?? "").slice(0, 120));
