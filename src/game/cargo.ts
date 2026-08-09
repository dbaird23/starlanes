import { SHIPS } from "../data/universe";
import type { PlayerState } from "../types";

/**
 * Where a fleet's cargo actually sits.
 *
 * The manual's *Escorts and Fighters* section states both halves of the rule
 * in one breath: escorts are worth having for "providing additional cargo
 * space on a profitable trade route", but "any special cargo you need for a
 * mission must always fit into your ship's own cargo hold; no one else can be
 * trusted with it". Commodities pool across the wing; mission freight does
 * not, and never has to be reasoned about beyond your own hull.
 *
 * The Bible narrows *which* escorts count. shïp InherentAI @66: "only ships
 * with inherent AI of 1 or 2 can be used to carry cargo when they are the
 * player's escorts" — the two trader AIs. A hired Manticore's 500 tons are
 * not yours to fill; a Sprite's 500 are. Of the 79 hireable hulls, 27 read 1
 * or 2, so most of a warship wing adds nothing to the hold.
 *
 * Neither document says how a load is *distributed* between your hull and the
 * wing, so we choose the arrangement that leaves the most of your own hold
 * free: commodities fill the escorts first and spill back into your hull.
 * That way a trader with room in the wing can still take a mission, which is
 * what makes the extra capacity an asset rather than a trap — the alternative
 * (fill your hull first) would have a full hold lock you out of mission cargo
 * while your escorts flew empty.
 *
 * The whole model is derived from the escort list on demand; there is no
 * per-escort stowage state to keep in sync, and nothing new in the pilot file.
 */

/** Trader AIs. The Bible's InherentAI 1 (wimpy) and 2 (brave) haul for you. */
function haulsForPlayer(shipId: string): boolean {
  const ai = SHIPS[shipId]?.inherentAi ?? 0;
  return ai === 1 || ai === 2;
}

/** Tons of commodities aboard the fleet, wherever they are stowed. */
export function commodityTons(player: PlayerState): number {
  return Object.values(player.cargo).reduce((a, b) => a + b, 0);
}

/** Tons of mission freight. Always in your own hold — see the note above. */
export function missionCargoUsed(player: PlayerState): number {
  return player.activeMissions.reduce(
    (sum, a) => sum + (a.cargoLoaded ? a.cargoQty : 0),
    0,
  );
}

/**
 * Tons one escort of this hull would add to your capacity — zero for the two
 * warship AIs however big the hold is, which is what the hiring hall needs to
 * say before you pay the fee.
 */
export function escortCargoCap(shipId: string): number {
  return haulsForPlayer(shipId) ? (SHIPS[shipId]?.cargo ?? 0) : 0;
}

/** What the wing adds. Trader-AI escorts only; a warship's hold is its own. */
export function fleetCargoCap(player: PlayerState): number {
  return player.escorts.reduce((sum, e) => sum + escortCargoCap(e.shipId), 0);
}

/** Hull plus wing: everything a commodity may be loaded into. */
export function totalCargoCap(player: PlayerState): number {
  return player.cargoCap + fleetCargoCap(player);
}

/** Everything aboard, for the "used / capacity" readouts. */
export function cargoUsed(player: PlayerState): number {
  return commodityTons(player) + missionCargoUsed(player);
}

/**
 * Commodities that would not fit in the wing and so ride in your own hold.
 * This is the term that makes trading eat into mission capacity only once
 * the escorts are full.
 */
export function hullCommodityTons(player: PlayerState): number {
  return Math.max(0, commodityTons(player) - fleetCargoCap(player));
}

/** Room in your own hold — the only space mission freight may use. */
export function freeHoldSpace(player: PlayerState): number {
  return player.cargoCap - missionCargoUsed(player) - hullCommodityTons(player);
}

/** Room for more commodities, across the whole fleet. */
export function freeCommoditySpace(player: PlayerState): number {
  return totalCargoCap(player) - cargoUsed(player);
}

/** How the current commodity load is split, for the cargo readouts. */
export function stowage(player: PlayerState): { hull: number; fleet: number } {
  const hull = hullCommodityTons(player);
  return { hull, fleet: commodityTons(player) - hull };
}

/**
 * Bring the manifest back inside capacity after the wing shrinks — an escort
 * that dies, defects or is paid off takes its hold with it, and neither the
 * Bible nor the manual says what becomes of what was in it. Losing the goods
 * is the only reading that makes the borrowed space a real risk rather than
 * free storage, so the overflow is spaced.
 *
 * Mission freight is never touched: it was in your own hull all along, so an
 * escort leaving cannot displace it. Only commodities can overflow, and they
 * go heaviest stack first — the same rule the plunder screen fills by.
 *
 * Returns what was lost, so the caller can say so.
 */
export function enforceCargoCapacity(
  player: PlayerState,
): { id: string; tons: number }[] {
  let excess = -freeCommoditySpace(player);
  if (excess <= 0) return [];
  const lost: { id: string; tons: number }[] = [];
  const stacks = Object.entries(player.cargo)
    .filter(([, tons]) => tons > 0)
    .sort((a, b) => b[1] - a[1]);
  for (const [id, tons] of stacks) {
    if (excess <= 0) break;
    const n = Math.min(excess, tons);
    if (n >= tons) delete player.cargo[id];
    else player.cargo[id] = tons - n;
    excess -= n;
    lost.push({ id, tons: n });
  }
  return lost;
}
