import {
  GOVTS,
  STR_LISTS,
  MISSIONS,
  OUTFITS,
  SYSTEMS,
  getSystem,
  govtAllied,
  junkFromCargoKey,
} from "../data/universe";
import type { PlayerState, SystemDef } from "../types";

/**
 * Combat-rating levels. The Bible (Appendix I) lists thresholds of 0, 1, 100,
 * 200 … 25600 "times some internal multiplier for adjustment", and that
 * multiplier is now **measured: 0.2**. A crafted pilot at rating 6 killed one
 * Valkyrie Class I — shïp Strength 200 — in the original and came out at 46,
 * so Nova banks a fifth of the destroyed hull's Strength. We keep the ledger
 * in raw Strength points, so the thresholds here are the Bible's × 5, and
 * `RATING_POINT_SCALE` converts a mïsn AvailRating (quoted on Nova's own
 * scale) into ours. An earlier guess of 10× put every rating gate in the game
 * at twice its true cost.
 *
 * The names come from STR# 138 "Combat Ratings", which holds exactly these
 * eleven, so a plug-in that renames them works.
 */
const RATING_THRESHOLDS = [
  0, 5, 500, 1000, 2000, 4000, 8000, 16000, 32000, 64000, 128000,
];
const RATING_FALLBACK_NAMES = [
  "No Ability",
  "Little Ability",
  "Fair Ability",
  "Average Ability",
  "Good Ability",
  "Competent",
  "Very Competent",
  "Worthy of Note",
  "Dangerous",
  "Deadly",
  "Frightening",
];

/**
 * Nova's internal multiplier, measured at 0.2 (see above): a mïsn AvailRating
 * of 5 is 25 raw Strength points here.
 */
export const RATING_POINT_SCALE = 5;

export function ratingLevel(points: number): number {
  let level = 0;
  for (let i = 0; i < RATING_THRESHOLDS.length; i++) {
    if (points >= RATING_THRESHOLDS[i]) level = i;
  }
  return level;
}

export function ratingName(points: number): string {
  const i = ratingLevel(points);
  return STR_LISTS["138"]?.[i] ?? RATING_FALLBACK_NAMES[i];
}

/**
 * The name Nova puts on a legal record, from STR# 134 "Legal Status".
 *
 * The bank holds 18 entries in three runs: a spare and the two clean states
 * (1-3 "No Record", "No Record", "No Convictions"), the evil ladder (4-10,
 * "Minor Offender" through "Public Enemy"), and the good one (11-16,
 * "Citizen" through "Virtuous Citizen"). 17-18 are "Military Dictator" and
 * "Military Governor", which belong to dominated worlds rather than to a
 * record, and are not used here.
 *
 * **The thresholds are ours.** The Bible says the scale is relative to the
 * system government's CrimeTol — "enough good or evil points to equal the
 * government's crime tolerance is given a value of 1" — but CrimeTol reads
 * **0 on all 68 shipped governments**, which makes that formula inoperative,
 * so the original must fall back on something it does not document. The one
 * measurement we have anchors the low end: a pilot at -6 in Altair showed
 * "No Convictions" in the original. These bands reproduce that and keep the
 * Bible's geometric ×4 shape above it.
 */
const STATUS_BANDS = [10, 40, 160, 640, 2560, 10240, 40960];

export function legalStatusName(record: number): string {
  const list = STR_LISTS["134"];
  const pick = (entry: number, fallback: string): string =>
    list?.[entry - 1] ?? fallback;
  if (record === 0) return pick(2, "No Record");
  const mag = Math.abs(record);
  let step = 0;
  while (step < STATUS_BANDS.length && mag >= STATUS_BANDS[step]) step++;
  if (record < 0) {
    // 3 "No Convictions", then 4..10 up to "Public Enemy"
    const evil = ["No Convictions", "Minor Offender", "Offender", "Criminal",
      "Wanted Criminal", "Fugitive", "Hunted Fugitive", "Public Enemy"];
    return pick(3 + step, evil[Math.min(step, evil.length - 1)]);
  }
  // the good ladder is one shorter: 11..16
  const good = ["Citizen", "Good Citizen", "Upstanding Citizen",
    "Leading Citizen", "Model Citizen", "Virtuous Citizen"];
  return pick(11 + Math.min(step, good.length - 1), good[Math.min(step, good.length - 1)]);
}

/*
 * Nova stores one legal record per SYSTEM, not per government. The original
 * pilot file settles it: the Windows .plt holds an int16 per sÿst id, seeded
 * from the owning govt's InitialRec (Nil'kemorya systems -5, Family Dani +2,
 * Krypt +10, everything else 0) and moving only where something happens.
 * Records are stored sparsely: a system the ledger has never touched reads
 * its seed, so InitialRec needs no materialization at pilot creation.
 */
function systemById(systemId: string): SystemDef | null {
  try {
    return getSystem(systemId);
  } catch {
    return null;
  }
}

function seedRecord(systemId: string): number {
  const g = systemById(systemId)?.govtId ?? -1;
  return g >= 128 ? (GOVTS[String(g)]?.initialRec ?? 0) : 0;
}

export function getSystemRecord(player: PlayerState, systemId: string): number {
  const stored = player.systemRecords?.[systemId];
  return stored !== undefined ? stored : seedRecord(systemId);
}

function bumpSystemRecord(
  player: PlayerState,
  systemId: string,
  delta: number,
): void {
  player.systemRecords ??= {};
  player.systemRecords[systemId] = getSystemRecord(player, systemId) + delta;
}

/** Jump-distance from one system, memoised per origin. */
const hopCache = new Map<string, Map<string, number>>();
function hopsFrom(originId: string): Map<string, number> {
  const cached = hopCache.get(originId);
  if (cached) return cached;
  const dist = new Map<string, number>([[originId, 0]]);
  const queue = [originId];
  while (queue.length) {
    const cur = queue.shift()!;
    const sys = systemById(cur);
    for (const n of sys?.links ?? []) {
      if (!dist.has(n)) {
        dist.set(n, (dist.get(cur) ?? 0) + 1);
        queue.push(n);
      }
    }
  }
  hopCache.set(originId, dist);
  return dist;
}

/** How far news of a crime carries, in jumps. Measured; see below. */
const RECORD_REACH = 3;

/**
 * Land an act for (positive) or against (negative) a government, spreading
 * out from the system it happened in.
 *
 * **This is measured, and it fits exactly.** A Fed Destroyer (gövt 128,
 * DisabPenalty 1 + KillPenalty 5 = 6) was destroyed in Altair in the
 * original, from a crafted pilot whose ledger was zeroed first and who never
 * left the system. Every one of the seven systems that moved fits
 * `floor(penalty / (hops + 1))`:
 *
 *     Altair              h0  -6      6/1
 *     Kania, Tenetria,
 *       Galvan            h1  -3      6/2
 *     Tichel              h2  -2      6/3
 *     Sol, Fomalhaut      h3  -1      6/4 -> 1
 *
 * and the recipient set is just as sharp: those seven are **exactly the
 * Federation systems within three jumps**. Every independent, Auroran,
 * Rebellion and Pirate system inside the same radius took nothing, and the
 * 50 Federation systems at four jumps and beyond took nothing either — so
 * the reach is a flat three jumps rather than "wherever the arithmetic still
 * rounds to 1".
 *
 * Two further things hold across both experiments run against the original:
 * the crime site is charged **DisabPenalty + KillPenalty** together (1 + 5
 * here; 3 + 7 for a Pyrogenesis kill in Tichel, which came out -10 on the
 * nose), because you cripple a ship on the way to destroying it; and
 * **nothing ever goes up** — the victim's enemies sat well inside the radius
 * both times and were untouched, so the Bible's "doing evil deeds to one
 * government will improve your rating with its enemies" does not fire.
 *
 * The one thing the clean run could not test is allies: no allied-government
 * system happened to lie within three jumps of Altair. They are included here
 * on the Bible's word ("Allied governments also communicate your actions")
 * at the same falloff, and that part remains unverified.
 */
export function applyGovtRecord(
  player: PlayerState,
  govtId: number,
  amount: number,
  originSystemId?: string,
): void {
  if (govtId < 128 || amount === 0) return;
  const mag = Math.abs(amount);
  const sign = Math.sign(amount);
  const dist = hopsFrom(originSystemId ?? player.systemId);
  for (const sys of SYSTEMS) {
    const g = sys.govtId;
    if (g < 128) continue;
    if (g !== govtId && !govtAllied(g, govtId)) continue;
    const hops = dist.get(String(sys.id));
    if (hops === undefined || hops > RECORD_REACH) continue;
    const delta = Math.floor(mag / (hops + 1));
    if (delta < 1) continue;
    bumpSystemRecord(player, String(sys.id), sign * delta);
  }
}

/**
 * A government's standing view of the player. Nova has no single per-govt
 * number, so a govt's ships judge you by the local ledger when they meet you
 * on their own or allied turf, and by their home systems' ledger elsewhere
 * (those all move in lockstep under applyGovtRecord, so any one of them is
 * the govt's own book).
 */
export function getGovtRecord(
  player: PlayerState,
  govtId: number,
  currentSystemId: string,
): number {
  if (govtId < 128) return 0;
  const cur = systemById(currentSystemId);
  if (
    cur &&
    cur.govtId >= 128 &&
    (cur.govtId === govtId || govtAllied(cur.govtId, govtId))
  )
    return getSystemRecord(player, currentSystemId);
  const home =
    SYSTEMS.find((s) => s.govtId === govtId) ??
    SYSTEMS.find((s) => s.govtId >= 128 && govtAllied(s.govtId, govtId));
  return home ? getSystemRecord(player, String(home.id)) : 0;
}

/**
 * One-time migration for saves written under the old one-number-per-govt
 * model: each system inherits its owning government's old number where that
 * differed from the InitialRec seed.
 */
export function migrateGovtRecords(
  old: Record<string, number>,
): Record<string, number> {
  const out: Record<string, number> = {};
  for (const sys of SYSTEMS) {
    const g = sys.govtId;
    if (g < 128) continue;
    const v = old[String(g)];
    if (v !== undefined && v !== (GOVTS[String(g)]?.initialRec ?? 0))
      out[String(sys.id)] = v;
  }
  return out;
}

/**
 * Nova's crime model. Each government states what it costs you to disable,
 * board or destroy one of its ships — DisabPenalty, BoardPenalty and
 * KillPenalty, in "evilness" points, spread from where it happened by
 * `applyGovtRecord` — see the measurements there. Destroying a ship charges
 * **both** DisabPenalty and KillPenalty, because you cripple it on the way;
 * the original's own ledger showed exactly their sum at the crime site.
 *
 * gövt **ShootPenalty is deliberately absent** from this union. The field is
 * real and is extracted, but the Bible annotates it "(currently ignored)" —
 * the original never charges it, so merely opening fire costs you nothing
 * until something is actually disabled, boarded or destroyed. Leaving it out
 * of `Crime` makes charging it a type error rather than a comment to be
 * overlooked; a pass that wired it up had shooting a Federation ship cost 5
 * evilness where Nova charges 0.
 */
export type Crime = "disable" | "board" | "kill";

function penaltyFor(govtId: number, crime: Crime): number {
  const g = GOVTS[String(govtId)];
  if (!g) return 0;
  const raw =
    crime === "kill" ? g.killPenalty
    : crime === "board" ? g.boardPenalty
    : g.disabPenalty;
  // -1 is Nova's "no penalty at all" for these fields
  return raw > 0 ? raw : 0;
}

export function applyCrime(
  player: PlayerState,
  victimGovt: number,
  crime: Crime,
  originSystemId?: string,
): void {
  if (victimGovt < 128) return; // independents hold no grudges
  const penalty = penaltyFor(victimGovt, crime);
  if (penalty <= 0) return;
  applyGovtRecord(player, victimGovt, -penalty, originSystemId);
}

/**
 * What a government would find if it scanned this player: the contraband
 * outfits and cargo whose ScanMask shares a bit with the government's own.
 *
 * The three masks interlock across resources — the Federation's 0x8000 marks
 * fighter bays and bio-weapons, the Auroran Empire's 0x4000 EMP torpedoes and
 * Monkdillo Shells, the Pirates' 0x0800 nearly every cargo worth taking.
 */
export function contraband(
  player: PlayerState,
  govtId: number,
): { outfits: string[]; cargo: string[] } {
  const mask = GOVTS[String(govtId)]?.scanMask ?? 0;
  const found = { outfits: [] as string[], cargo: [] as string[] };
  if (!mask) return found;
  for (const [outfId, owned] of Object.entries(player.outfits)) {
    if (owned <= 0) continue;
    const outf = OUTFITS[outfId];
    if (outf && outf.scanMask & mask) found.outfits.push(outf.name.split(";")[0]);
  }
  for (const [key, qty] of Object.entries(player.cargo)) {
    if (qty <= 0) continue;
    const junk = junkFromCargoKey(key);
    if (junk && junk.scanMask & mask) found.cargo.push(junk.name);
  }
  /*
   * mïsn ScanMask @1630: a government whose own mask overlaps treats the
   * mission's cargo as contraband while it is aboard. Five stock missions
   * carry one — "Steal Hypergate Codes" reads 0xFFFF, illegal to everyone.
   */
  for (const am of player.activeMissions) {
    if (!am.cargoLoaded) continue;
    const m = MISSIONS[String(am.misnId)];
    if (m?.scanMask && (m.scanMask & mask) !== 0)
      found.cargo.push(am.cargoName ?? "Mission cargo");
  }
  return found;
}

/** Smuggling caught by a scan: gövt SmugPenalty, plus its ScanFine in credits. */
export function applySmuggling(player: PlayerState, govtId: number): number {
  const g = GOVTS[String(govtId)];
  if (!g) return 0;
  if (g.smugPenalty > 0) applyGovtRecord(player, govtId, -g.smugPenalty);
  // ScanFine: 1 and up is a flat fine, -1 and below is that percent of cash
  const fine = g.scanFine >= 1 ? g.scanFine
    : g.scanFine <= -1 ? Math.floor(player.credits * (-g.scanFine / 100))
    : 0;
  const paid = Math.min(fine, player.credits);
  player.credits -= paid;
  return paid;
}

/**
 * How far below zero a government lets you sink before its warships engage.
 * CrimeTol is "the maximum amount of evilness the player can accumulate before
 * warships of this govt start to beat on him".
 */
export function crimeTolerance(govtId: number): number {
  return GOVTS[String(govtId)]?.crimeTol ?? 0;
}

/** Mission CompGovt / CompReward on success (or half-reversed on failure). */
export function applyCompReward(
  player: PlayerState,
  compGovt: number,
  compReward: number,
  failed: boolean,
): void {
  if (compGovt < 128 || compReward === 0) return;
  /*
   * Rewards ride the same propagation as crimes. They have to: Spacedock V
   * (MinStatus 2) sits in Nesre Secundus, a Roughnecks system, and the
   * Federation Resupply chain pays only Federation CompRewards — it is the
   * Roughnecks' Ally classes (1 = the Federation's) that let those rewards
   * lift the system the storyline returns to.
   */
  applyGovtRecord(player, compGovt, failed ? -Math.floor(compReward / 2) : compReward);
}
