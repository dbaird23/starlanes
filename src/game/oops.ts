import { COMMODITIES, OOPSES } from "../data/universe";
import type { OopsState, OopsType, PlayerState } from "../types";
import { evalTest } from "./bits";

/**
 * öops resources are Nova's "planetary disasters" — a misnomer the Bible owns
 * up to, since a good harvest is just as likely as a drought. Each one shifts
 * one commodity's price at one world by a flat number of credits for a set
 * number of days, and the Trade Center prints the resource's name so you know
 * why Georgia is suddenly dumping industrial goods.
 */

export interface ActiveOops {
  def: OopsType;
  state: OopsState;
}

/** Roll every disaster forward to `player.date`, expiring and starting them. */
export function runOopses(
  player: PlayerState,
  ctx: { outfits?: Record<string, number>; explored?: string[]; male?: boolean },
  elapsedDays: number,
): void {
  const today = Math.floor(player.date);
  player.oopses = player.oopses.filter((s) => today < s.endDay);

  // Freq is a percent chance per day; a jump that eats several days gets
  // several rolls, so long hauls can arrive to news already in progress.
  const rolls = Math.min(30, Math.max(1, Math.round(elapsedDays)));
  for (const def of OOPSES) {
    // -1 strikes every world at once and -2 is news with no price effect;
    // both still run, they just resolve differently in oopsesAt below. The
    // stock scenario uses neither, but plug-ins do.
    if (def.stellar < -2) continue;
    if (def.freq <= 0 || def.duration <= 0) continue;
    if (player.oopses.some((s) => s.id === def.id)) continue;
    if (def.activateOn && !evalTest(def.activateOn, player.bits, ctx)) continue;
    let hit = false;
    for (let i = 0; i < rolls && !hit; i++) hit = Math.random() * 100 < def.freq;
    if (!hit) continue;
    player.oopses.push({ id: def.id, endDay: today + def.duration });
  }
}

/**
 * Disasters running right now at one world. A stellar of -1 is galaxy-wide, so
 * it shows up everywhere; -2 is a news item only and never reaches a world.
 */
export function oopsesAt(player: PlayerState, spobId: string): ActiveOops[] {
  const out: ActiveOops[] = [];
  for (const state of player.oopses) {
    const def = OOPSES.find((o) => o.id === state.id);
    if (!def) continue;
    if (def.stellar === -1 || String(def.stellar) === spobId) out.push({ def, state });
  }
  return out;
}

/** Everything running right now, including the news-only entries. */
export function oopsesRunning(player: PlayerState): ActiveOops[] {
  const out: ActiveOops[] = [];
  for (const state of player.oopses) {
    const def = OOPSES.find((o) => o.id === state.id);
    if (def) out.push({ def, state });
  }
  return out;
}

/** Credits to add to one commodity's price at this world. */
export function oopsPriceDelta(
  player: PlayerState,
  spobId: string,
  commodityId: string,
): number {
  const index = COMMODITIES.findIndex((c) => c.id === commodityId);
  if (index < 0) return 0;
  let delta = 0;
  for (const { def } of oopsesAt(player, spobId)) {
    if (def.commodity === index) delta += def.priceDelta;
  }
  return delta;
}
