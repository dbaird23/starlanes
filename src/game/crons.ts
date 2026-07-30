import { CRONS } from "../data/universe";
import type { CronState, CronType, PlayerState } from "../types";
import { applySet, evalTest, type SetOpHandlers } from "./bits";
import { dateFromDays, withinWindow } from "./calendar";

/**
 * The crön engine: the galaxy's own clock. Each day that passes, eligible
 * events roll to activate, wait out their PreHoldoff, fire OnStart, run for
 * their Duration, fire OnEnd, then sit out their PostHoldoff before they can
 * happen again. Everything they do is expressed as control bits, so stories
 * advance whether or not the player is watching.
 */

const CRON_ITERATE_START = 0x0001;
const CRON_ITERATE_END = 0x0002;

function stateFor(player: PlayerState, id: number): CronState | undefined {
  return player.crons.find((c) => c.id === id);
}

/** Advance the calendar to `player.date`, firing anything due. */
export function runCrons(
  player: PlayerState,
  handlers: SetOpHandlers,
  ctx: { outfits?: Record<string, number>; explored?: string[]; male?: boolean },
  onEvent?: (cron: CronType, phase: "start" | "end") => void,
): void {
  const today = Math.floor(player.date);
  const date = dateFromDays(today);

  for (const cron of CRONS) {
    let st = stateFor(player, cron.id);

    // --- already running: has it started or ended? ---
    if (st) {
      if (!st.started && today >= st.startDay) {
        st.started = true;
        applySet(cron.onStart, player.bits, handlers);
        if (cron.flags & CRON_ITERATE_START) {
          // iterative entry: keep applying while it stays eligible
          let guard = 0;
          while (guard++ < 50 && evalTest(cron.enableOn, player.bits, ctx)) {
            applySet(cron.onStart, player.bits, handlers);
          }
        }
        onEvent?.(cron, "start");
      }
      if (st.started && !st.ended && today >= st.endDay) {
        st.ended = true;
        applySet(cron.onEnd, player.bits, handlers);
        if (cron.flags & CRON_ITERATE_END) {
          let guard = 0;
          while (guard++ < 50 && evalTest(cron.enableOn, player.bits, ctx)) {
            applySet(cron.onEnd, player.bits, handlers);
          }
        }
        onEvent?.(cron, "end");
      }
      // finished and past its holdoff: let it become eligible again
      if (st.ended && today >= st.readyDay) {
        player.crons = player.crons.filter((c) => c.id !== cron.id);
        st = undefined;
      }
      if (st) continue;
    }

    // --- not running: can it activate today? ---
    if (
      !withinWindow(
        date,
        { day: cron.firstDay, month: cron.firstMonth, year: cron.firstYear },
        { day: cron.lastDay, month: cron.lastMonth, year: cron.lastYear },
      )
    ) {
      continue;
    }
    if (!evalTest(cron.enableOn, player.bits, ctx)) continue;
    if (cron.random <= 0) continue;
    if (cron.random < 100 && Math.random() * 100 > cron.random) continue;

    const startDay = today + Math.max(0, cron.preHoldoff);
    const endDay = startDay + Math.max(0, cron.duration);
    player.crons.push({
      id: cron.id,
      startDay,
      endDay,
      readyDay: endDay + Math.max(0, cron.postHoldoff),
      started: false,
      ended: false,
    });
  }
}

/** Events currently between their start and end, for the news feed. */
export function activeCrons(player: PlayerState): CronType[] {
  const out: CronType[] = [];
  for (const st of player.crons) {
    if (!st.started || st.ended) continue;
    const cron = CRONS.find((c) => c.id === st.id);
    if (cron) out.push(cron);
  }
  return out;
}
