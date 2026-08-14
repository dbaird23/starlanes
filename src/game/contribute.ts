import { GOVTS, OUTFITS, RANKS, SHIPS, govtAllied } from "../data/universe";
import { activeCrons } from "./crons";
import type { PlayerState } from "../types";

/**
 * Nova's Contribute/Require system: every ship, outfit, active crön and held
 * ränk contributes bits to one 64-bit pool, and a resource whose Require bits
 * are not all present in the pool is withheld. The stock scenario runs its
 * whole licensing economy on it — the Heavy Weapons / Missile / Fighter Bay /
 * Protective Technologies / Capital Ships / Capital Warships licenses
 * contribute the bits the weapons, armor and capital hulls require, the
 * Federation Naval Rank of Commander contributes 0x7B (five licenses in one
 * stroke), the Sigma Bulk Delivery missions require the bits only Sigma-built
 * hulls contribute, and the hull-specific upgrade outfits require the
 * Valkyrie and Starbridge family bits.
 *
 * Masks are carried as two u32 halves in resource byte order.
 */
export type Bits64 = readonly [number, number];

export function playerContribute(player: PlayerState): [number, number] {
  let a = 0;
  let b = 0;
  const add = (pair?: Bits64): void => {
    if (!pair) return;
    a = (a | pair[0]) >>> 0;
    b = (b | pair[1]) >>> 0;
  };
  add(SHIPS[player.shipId]?.contribute);
  for (const [id, count] of Object.entries(player.outfits)) {
    if (count > 0) add(OUTFITS[id]?.contribute);
  }
  for (const rankId of player.ranks) add(RANKS[String(rankId)]?.contribute);
  for (const cron of activeCrons(player)) add(cron.contribute);
  return [a, b];
}

/** Every 1 bit in `req` must be present in `pool`. Empty Require always passes. */
export function requireMet(
  req: Bits64 | undefined | null,
  pool: Bits64,
): boolean {
  if (!req) return true;
  return (
    ((req[0] & ~pool[0]) >>> 0) === 0 && ((req[1] & ~pool[1]) >>> 0) === 0
  );
}

/**
 * oütf RequireGovt: which shops enforce an outfit's Require bits. The Bible's
 * encoding — under 128 everywhere; 128-383 only on stellars of that govt or
 * its allies; +1000 also on independents; +2000 everywhere except those;
 * +3000 everywhere except those or independents. The stock licensed weapons
 * read 128: the Federation checks papers, the pirate outfitters do not.
 */
export function outfitRequireApplies(
  requireGovt: number,
  stellarGovt: number,
): boolean {
  if (requireGovt < 128) return true;
  const mode = Math.floor((requireGovt - 128) / 1000);
  const base = 128 + ((requireGovt - 128) % 1000);
  const indep = stellarGovt < 128 || !GOVTS[String(stellarGovt)];
  const related =
    !indep && (stellarGovt === base || govtAllied(base, stellarGovt));
  switch (mode) {
    case 0:
      return related;
    case 1:
      return indep || related;
    case 2:
      return !related;
    case 3:
      return !indep && !related;
    default:
      return true;
  }
}
