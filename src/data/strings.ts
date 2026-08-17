import { STR_LISTS } from "./universe";

/**
 * STR# 2002 "misc strings" — the 396 labels and messages Nova's engine
 * prints. Reading them from the resource rather than hardcoding English
 * means a plug-in that rewords the game works, and it keeps our wording
 * honest: several strings we had invented turned out to differ from the
 * original's ("Free:" vs "Cargo free", and so on).
 *
 * Entries are **1-based**, as the resource numbers them and as every other
 * STR# reference in this codebase does (sÿst Message, përs CommQuote…).
 * Every call passes the English fallback it replaces, so a missing or
 * short bank degrades to what we shipped before rather than to blanks.
 */
export function ui(index: number, fallback: string): string {
  const s = STR_LISTS["2002"]?.[index - 1];
  return s && s.length > 0 ? s : fallback;
}

/** Named entries used in more than one place, so the numbers stay in one file. */
export const UI = {
  /** 1/2: the mass unit, singular and plural. */
  ton: (n: number): string => (n === 1 ? ui(1, "ton") : ui(2, "tons")),
  /** 32/33/34: currency long and short. */
  credit: (n: number): string => (n === 1 ? ui(32, "credit") : ui(33, "credits")),
  cr: (): string => ui(34, "cr"),
} as const;

/**
 * STR# 3000 "Ship Comm Strings" and 3002 "Stellar Comm Strings" are laid out
 * in **groups of five**: Nova picks one at random from the group that fits
 * the situation, which is why both lists read as five ways of saying the same
 * thing. These name the groups by what they are for, so call sites read as
 * intent rather than arithmetic.
 *
 * `SHIP_COMM.channelOpen` is group 1 (entries 1-5), group N starting at
 * `5*(N-1)+1`. A couple of 3002's groups are short — 28-30 and 38-40 are the
 * literal placeholders "<dominated = TRUE>" / "<dominated = FALSE>", so those
 * groups hold two real lines — and `pickGroup` drops any entry that looks
 * like one of those markers rather than reading it out to the player.
 */
function pickGroup(bank: string, group: number, fallback: string): string {
  const list = STR_LISTS[bank];
  if (!list) return fallback;
  const start = (group - 1) * 5;
  const opts = list
    .slice(start, start + 5)
    .filter((t) => t && t.length > 0 && !t.startsWith("<"));
  return opts.length
    ? opts[Math.floor(Math.random() * opts.length)]
    : fallback;
}

/**
 * A random line from a whole STR# bank — what the Q and T ncb operators read.
 * Unlike the comm banks these are not grouped in fives: the operand names the
 * resource and Nova picks from all of it.
 */
export function pickStrLine(bank: number): string | null {
  const opts = (STR_LISTS[String(bank)] ?? []).filter((t) => t && t.length > 0);
  return opts.length ? opts[Math.floor(Math.random() * opts.length)] : null;
}

/** One of the five lines a ship uses for this situation. */
export const shipComm = (group: number, fallback: string): string =>
  pickGroup("3000", group, fallback);

/** One of the five lines a world's traffic control uses. */
export const stellarComm = (group: number, fallback: string): string =>
  pickGroup("3002", group, fallback);

/**
 * The tribute groups are **not** five interchangeable lines: their two real
 * entries are written for the two stellar kinds — "The planet agrees to pay
 * you tribute" against "…the station…" — exactly like the docking/landing
 * pair at STR# 2002 22/23. Picking at random makes a planet call itself a
 * station, so those groups are indexed by kind instead.
 */
export function stellarCommByKind(
  group: number,
  isStation: boolean,
  fallback: string,
): string {
  const list = STR_LISTS["3002"];
  const line = list?.[(group - 1) * 5 + (isStation ? 1 : 0)];
  return line && line.length > 0 && !line.startsWith("<") ? line : fallback;
}

/** Group numbers, named. See the dumps in the commit that added these. */
export const SHIP_COMM = {
  channelOpen: 1,
  noResponse: 2,
  hostileWhatDoYouWant: 3,
  hostileTaunt: 4,
  friendlyWhatCanIDo: 5,
  respectful: 6,
  escortGoAhead: 7,
  escortGladToFly: 8,
  escortGladToSee: 9,
  greeting: 10,
  dismissive: 11,
  insult: 12,
  cantAfford: 13,
  wastingMyTime: 14,
  notInTrouble: 15,
  willHelp: 16,
  tooBusy: 17,
  ratherNot: 18,
  payMeFirst: 19,
  noWay: 20,
  pleasureDoingBusiness: 21,
  takingOffence: 22,
  escortCantHelp: 23,
  goodMood: 24,
  badMoodCostsExtra: 25,
  cantDoThat: 26,
  confused: 27,
  leaveYouAlone: 28,
  helpForAPrice: 29,
  onMyWay: 30,
  bribeRefusedAttack: 31,
  bribeRefusedLaugh: 32,
  becauseILikeYou: 33,
  cantPayThatMuch: 34,
  grudginglyPays: 35,
  handsOverBribe: 36,
  holdOnComing: 37,
  farewell: 38,
} as const;

export const STELLAR_COMM = {
  channelOpenTo: 1,
  tributeRefused: 2,
  defenceFleet: 3,
  noNews: 4,
  wastingOurTime: 5,
  tributeAccepted: 6,
  bribeRefused: 7,
  releasedFromTribute: 8,
  bribeOffer: 9,
  insult: 10,
} as const;
