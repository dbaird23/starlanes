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
