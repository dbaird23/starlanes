import {
  ALL_GOVT_IDS,
  GOVTS,
  OUTFITS,
  govtAllied,
  govtEnemy,
  junkFromCargoKey,
} from "../data/universe";
import type { PlayerState } from "../types";

/**
 * EV-style combat rating levels, thresholds in accumulated strength points.
 *
 * The Bible (Appendix I) lists thresholds of 0, 1, 100, 200 … 25600, but notes
 * they are multiplied by "some internal multiplier for adjustment". Ship
 * strengths (Viper=30, Thunderhead=120, Kestrel=400) are the raw resource
 * values; without a multiplier even one kill jumps several levels. The 10×
 * scale applied here puts a new pilot ~30 Viper kills from "Not a Threat" and
 * ~270 kills from "Dangerous", which matches the feel of the original.
 */
const RATING_LEVELS: [number, string][] = [
  [0, "Harmless"],
  [1, "Mostly Harmless"],
  [1000, "Not a Threat"],
  [2000, "Above Average"],
  [4000, "Respected"],
  [8000, "Dangerous"],
  [16000, "Deadly"],
  [32000, "Truly Fearsome"],
  [64000, "Feared"],
  [128000, "Ultimate Rating"],
];

export function ratingLevel(points: number): number {
  let level = 0;
  for (let i = 0; i < RATING_LEVELS.length; i++) {
    if (points >= RATING_LEVELS[i][0]) level = i;
  }
  return level;
}

export function ratingName(points: number): string {
  return RATING_LEVELS[ratingLevel(points)][1];
}

export function getRecord(player: PlayerState, govtId: number): number {
  if (govtId < 128) return 0;
  return player.records[String(govtId)] ?? 0;
}

function bumpRecord(player: PlayerState, govtId: number, delta: number): void {
  if (govtId < 128) return;
  const key = String(govtId);
  player.records[key] = (player.records[key] ?? 0) + delta;
}

/**
 * Nova's crime model. Each government states what it costs you to disable,
 * board or destroy one of its ships — DisabPenalty, BoardPenalty and
 * KillPenalty, in "evilness" points. Its allies take the same offence at half
 * weight and its enemies quietly approve, which is how the Bible puts it:
 * "doing evil deeds to one government will improve your rating with its
 * enemies, and vice versa."
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

export function applyCrime(player: PlayerState, victimGovt: number, crime: Crime): void {
  if (victimGovt < 128) return; // independents hold no grudges
  const penalty = penaltyFor(victimGovt, crime);
  if (penalty <= 0) return;
  bumpRecord(player, victimGovt, -penalty);
  for (const govtId of ALL_GOVT_IDS) {
    if (govtId === victimGovt) continue;
    if (govtAllied(victimGovt, govtId)) bumpRecord(player, govtId, -Math.ceil(penalty / 2));
    else if (govtEnemy(victimGovt, govtId)) bumpRecord(player, govtId, Math.ceil(penalty / 4));
  }
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
  return found;
}

/** Smuggling caught by a scan: gövt SmugPenalty, plus its ScanFine in credits. */
export function applySmuggling(player: PlayerState, govtId: number): number {
  const g = GOVTS[String(govtId)];
  if (!g) return 0;
  if (g.smugPenalty > 0) bumpRecord(player, govtId, -g.smugPenalty);
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
  bumpRecord(player, compGovt, failed ? -Math.floor(compReward / 2) : compReward);
}
