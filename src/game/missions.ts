import {
  COMMODITIES,
  DESCS,
  DUDES,
  getSystem,
  govtAllied,
  govtClassmate,
  govtEnemy,
  JUNK_NAMES,
  MISSIONS,
  SHIPS,
  SPOB_GOVT,
  SPOB_INDEX,
  SPOBS_BY_ID,
  STR_LISTS,
  SYSTEMS,
} from "../data/universe";
import { freeHoldSpace } from "./cargo";
import { playerContribute, requireMet } from "./contribute";
import { RATING_POINT_SCALE, getSystemRecord } from "./reputation";
import type {
  ActiveMission,
  MissionType,
  PlanetDef,
  PlayerState,
} from "../types";
import { evalTest } from "./bits";

/** Result texts queued for display when landing. */
export interface MissionEvent {
  title: string;
  text: string;
}

export function missionDisplayName(m: MissionType): string {
  return m.name.split(";")[0].trim();
}

/**
 * "Silent" missions run in the background: their names start with "Silent"
 * (case-insensitive). They never appear in the mission log and don't generate
 * completion or progress popups.
 */
export function isSilentMission(m: MissionType): boolean {
  return m.name.toLowerCase().startsWith("silent");
}

/**
 * CargoType indexes STR# 4000, Nova's own list of the eighty things a mission
 * can ask you to carry. Its first six entries are the standard commodities, so
 * 0-5 still line up with the trade goods; beyond that it names the cargo the
 * storyline actually deals in — Passengers, Military Stores, Prisoners, a
 * Cunjo Head. Entries the list marks with a leading "*" are Nova's flag for
 * cargo that isn't ordinary freight; the marker isn't meant to be read out.
 */
function cargoName(cargoType: number): string | null {
  if (cargoType < 0) return null;
  if (cargoType === 1000) {
    // 1000 is the Bible's "random" marker, used by the generic delivery jobs
    const pick = COMMODITIES[Math.floor(Math.random() * COMMODITIES.length)];
    return pick.name;
  }
  const listed = STR_LISTS["4000"]?.[cargoType];
  if (listed) return listed.replace(/^\*/, "");
  if (cargoType >= 0 && cargoType <= 5) {
    const order = [
      "food",
      "industrial",
      "medical",
      "luxury",
      "metal",
      "equipment",
    ];
    const c = COMMODITIES.find((c) => c.id === order[cargoType]);
    return c ? c.name : "Cargo";
  }
  if (JUNK_NAMES[String(cargoType)]) return JUNK_NAMES[String(cargoType)];
  return "Cargo";
}

/**
 * Nova Bible CargoQty: -1 ignored (no cargo), 0+ exactly that many tons,
 * -2 and below abs(qty) tons ±50%.
 */
function rollCargoQty(cargoQty: number): number {
  if (cargoQty >= 0) return cargoQty;
  if (cargoQty === -1) return 0;
  const base = Math.abs(cargoQty);
  return Math.max(1, Math.round(base * (0.5 + Math.random())));
}

/** The least cargo this mission could demand, for space checks. */
function minCargoQty(cargoQty: number): number {
  if (cargoQty >= 0) return cargoQty;
  if (cargoQty === -1) return 0;
  return Math.max(1, Math.round(Math.abs(cargoQty) * 0.5));
}

/**
 * AvailShipType: "0 or -1 ignored, 128-255 must be flying a ship of this type,
 * 1128-1255 must not, 2128-2255 must be flying a ship of this inherent govt,
 * 3128-3255 must not". Every stock mission reads 0 — this is here for plug-ins,
 * and the bands are matched by their offset rather than the doc's caps, since
 * Nova's own ship ids already run past 255.
 */
function shipTypeAllowed(code: number, player: PlayerState): boolean {
  if (code <= 0) return true;
  const hull = SHIPS[player.shipId];
  const govt = hull?.inherentGovt?.govt ?? -1;
  if (code >= 3128) return govt !== code - 3000;
  if (code >= 2128) return govt === code - 2000;
  if (code >= 1128) return player.shipId !== String(code - 1000);
  return player.shipId === String(code);
}

/** Does `spob` match a Nova stellar-availability code? */
function stelMatches(code: number, spob: PlanetDef): boolean {
  if (code === -1) return !spob.uninhabited && spob.landable;
  if (code >= 128 && code <= 2175) return spob.id === String(code);
  const govt = SPOB_GOVT.get(spob.id) ?? -1;
  if (code >= 9999 && code <= 10255)
    return govt === code - 9872 || (code === 9999 && govt < 128);
  if (code >= 15000 && code <= 15255) return govtAllied(code - 14872, govt);
  if (code >= 20000 && code <= 20255) return govt !== code - 19872;
  if (code >= 25000 && code <= 25255) return govtEnemy(code - 24872, govt);
  if (code >= 30000 && code <= 30255) return govtClassmate(code - 29872, govt);
  if (code >= 31000 && code <= 31255) return !govtClassmate(code - 30872, govt);
  // 5000-7047 (adjacent-system stellar) is not supported yet
  return false;
}

/**
 * Nova's duplicate-stellar rule, which the Bible states under TravelStel:
 * "the mission travel objectives will also be fulfilled when landing on a
 * duplicate stellar that has the identical name and coordinates to the
 * stellar you specify here".
 *
 * It matters because **68 of the shipped stellars belong to no system at
 * all** — they are alternate copies of a world, and 26 missions name one as
 * their destination. Without this they resolve to nothing and the mission can
 * never be completed: "Free Eiric" (mïsn 639) returns to spöb 506, a second
 * New Ireland, which dead-ends the whole Wild Geese a-path at its last leg.
 * The Auroran, Polaris and United Shipping chains each have their own.
 *
 * The match is name **and** coordinates, as documented; every duplicate in
 * the stock data agrees on both with its placed twin.
 */
function duplicateStelId(code: number): string | null {
  const orphan = SPOBS_BY_ID.get(String(code));
  if (!orphan) return null;
  for (const entry of SPOB_INDEX.values()) {
    const p = entry.planet;
    if (
      p.name === orphan.name &&
      p.pos.x === orphan.pos.x &&
      p.pos.y === orphan.pos.y
    )
      return p.id;
  }
  return null;
}

/** Pick a random landable spob matching a destination code, or a specific one. */
function resolveStel(
  code: number,
  currentSpobId: string | null,
): string | null {
  if (code === -1) return null;
  if (code === -4) return currentSpobId;
  const all = [...SPOB_INDEX.values()]
    .map((e) => e.planet)
    .filter((p) => p.landable);
  let candidates: PlanetDef[] = [];
  if (code === -2) candidates = all.filter((p) => !p.uninhabited);
  else if (code === -3) candidates = all.filter((p) => p.uninhabited);
  else if (code >= 128 && code <= 2175) {
    return SPOB_INDEX.has(String(code)) ? String(code) : duplicateStelId(code);
  } else {
    candidates = all.filter((p) => stelMatches(code, p) && !p.uninhabited);
    if (candidates.length === 0) candidates = all.filter((p) => !p.uninhabited);
  }
  candidates = candidates.filter((p) => p.id !== currentSpobId);
  if (candidates.length === 0) return null;
  return candidates[Math.floor(Math.random() * candidates.length)].id;
}

/**
 * Missions offerable at a spob location right now.
 * Only offers missions our engine can complete (no special-ship goals yet).
 */
export function availableMissions(
  spob: PlanetDef,
  loc: number,
  player: PlayerState,
): MissionType[] {
  const activeIds = new Set(player.activeMissions.map((a) => a.misnId));
  // mïsn Require vs the ship/outfit/rank/crön Contribute pool — the Sigma
  // Bulk Delivery chain wants the bits only Sigma-built freighters carry.
  const contribPool = playerContribute(player);
  const out: MissionType[] = [];
  for (const m of Object.values(MISSIONS)) {
    if (m.availLoc !== loc) continue;
    if (activeIds.has(m.id)) continue;
    // destroy(0), disable(1), board(2), escort(3), observe(4) and rescue(5)
    // are all handled; chase-off(6) is the one goal we can't resolve.
    // ShipGoal -1 is the Bible's "no specific goal for the special ships" —
    // 243 of the 348 missions that carry special ships use it, and they are
    // completed by their cargo and destination alone, so they must not be
    // filtered out with goal 6.
    if (m.shipCount > 0 && m.shipGoal > 5) continue;
    // pay < 0 encodes an outfit grant: -(count * 10000 + outfitNovaId); handled at completion
    if (m.flags & 0x0400) continue; // invisible missions
    if (!requireMet(m.require, contribPool)) continue;
    // Bible: "your legal record in this system" — literally the per-system
    // ledger now, which is what the original pilot file stores.
    const systemId = SPOB_INDEX.get(spob.id)?.systemId;
    const record =
      systemId !== undefined
        ? getSystemRecord(player, String(systemId))
        : 0;
    // -32000 and below is Nova's sentinel for "only once you hold this world".
    // No mission in the stock scenario uses it, but plug-ins do.
    if (m.availRecord <= -32000 && !player.dominated.includes(spob.id))
      continue;
    if (m.availRecord > 0 && record < m.availRecord) continue;
    if (m.availRecord < 0 && record > m.availRecord) continue;
    // AvailRating is a threshold in combat-rating points (the STR# 138 scale:
    // 100 "Not a Threat" ... 12800 "Deadly"), not a level index — the bounty
    // chain asks for 5/100/200 points as the bounties grow and the late
    // Auroran missions for 12500. -1 is the documented "ignored". Our points
    // ledger runs on the same 10× internal multiplier as RATING_LEVELS.
    if (
      m.availRating > 0 &&
      player.ratingPoints < m.availRating * RATING_POINT_SCALE
    )
      continue;
    /*
     * Who fits aboard, and who won't be offered the job.
     *
     * Nova has no passenger berths: STR# 4000 entry 6 is "*Passengers" and the
     * 103 missions that ask for them carry them in CargoQty tons like any other
     * freight, so a hull's capacity for people is simply its free hold.
     *
     * Flags2 0x0001 is the gate — "don't offer the mission if the player
     * doesn't have enough cargo space to hold the mission cargo (even if the
     * mission cargo won't be picked up until later)". It is opt-in: 204 of the
     * 365 cargo missions set it. Without it the job is still offered to a full
     * hold, and the cargo simply doesn't load, so the check below only hides a
     * mission whose cargo would have to come aboard here and now.
     */
    const needAtAccept = minCargoAtAccept(m);
    // your own hull only — escorts may not carry mission freight (see cargo.ts)
    const free = freeHoldSpace(player);
    if ((m.flags2 & 0x0001) !== 0 && minCargoQty(m.cargoQty) > free) continue;
    if (needAtAccept > free) continue;
    /*
     * Flags 0x2000 / 0x4000 split the offer by what the player flies, using
     * the hull's own InherentAI: 1-2 are the cargo ships and 3-4 the warships.
     * Ten missions refuse a freighter pilot; none of the stock missions refuse
     * a warship, but plug-ins may.
     */
    const hull = SHIPS[player.shipId];
    const ai = hull?.inherentAi ?? 0;
    if ((m.flags & 0x2000) !== 0 && (ai === 1 || ai === 2)) continue;
    if ((m.flags & 0x4000) !== 0 && (ai === 3 || ai === 4)) continue;
    if (!shipTypeAllowed(m.availShipType, player)) continue;
    if (!stelMatches(m.availStel, spob)) continue;
    if (!evalTest(m.availBits, player.bits, testContext(player))) continue;
    // AvailRandom: 100 always, 1-99 that percentage of the time, 0 never
    if (m.availRandom <= 0) continue;
    if (m.availRandom < 100 && Math.random() * 100 > m.availRandom) continue;
    if (!DESCS[String(4000 + m.id - 128)] && m.availLoc !== 0) continue; // need offer text for dialogs
    out.push(m);
  }
  // mïsn DispWeight "controls the order that the mission is presented in the
  // bar and mission BBS list. Missions with higher DispWeight values are
  // presented first." 44 missions set one; the rest read 0 and keep their
  // resource order behind them.
  out.sort((a, b) => (b.dispWeight ?? 0) - (a.dispWeight ?? 0));
  // a modest board: don't flood the BBS
  return out.slice(0, 12);
}

/** State the ncb test expressions can inspect. */
export function testContext(player: PlayerState) {
  return { outfits: player.outfits, explored: player.explored, male: true };
}

/** The offer text for a mission (desc 4000 + id - 128). */
export function offerText(m: MissionType): string {
  return DESCS[String(4000 + m.id - 128)] ?? `${missionDisplayName(m)}.`;
}

export function descText(descId: number): string | null {
  if (descId < 128) return null;
  return DESCS[String(descId)] ?? null;
}

/**
 * A random entry from a mïsn ShipNameID / ShipSubtitle bank. Both fields read
 * "-1 ignored, 128 and up pick a name from this STR# resource", and the banks
 * hold ten entries apiece — ten Auroran warship names for 25000, ten
 * identical "Prodigal Son"s for 25006 where the mission means one named ship.
 */
function pickFromBank(bankId: number): string | undefined {
  if (bankId < 128) return undefined;
  const list = (STR_LISTS[String(bankId)] ?? []).filter((s) => s.length > 0);
  if (!list.length) return undefined;
  return list[Math.floor(Math.random() * list.length)];
}

/**
 * The `<SN>` tag — "special ship name". Nova rolls it at accept time, which is
 * why the Bible warns it "will screw up" in an offer description; none of the
 * 43 shipped dëscs that use it is an offer text, so rolling it here (where the
 * offer is built) is indistinguishable in play and cannot leak a raw tag.
 *
 * Falling back to the **subtitle** bank is the reading Nova's own prose
 * demands: all three missions that use `<SN>` without a ShipNameID carry a
 * ShipSubtitle instead, and it is the subtitle that completes the sentence —
 * Rebel I21's "most of them have been named <SN>" against bank 25006
 * "Prodigal Son", and Auroran 028's "as she flies through the Wolf 359 system
 * in the <SN>" against 25024 "Krane". The hull name behind that is ours, so a
 * plug-in that names neither still reads as English rather than as markup.
 */
function specialShipName(m: MissionType): string | undefined {
  const named = pickFromBank(m.shipNameId) ?? pickFromBank(m.shipSubtitle);
  if (named) return named;
  const dude = DUDES[String(m.shipDude)];
  const best = dude?.ships.reduce(
    (a, b) => (b.prob > a.prob ? b : a),
    dude.ships[0],
  );
  return best ? SHIPS[String(best.id)]?.name.split(";")[0] : undefined;
}

/**
 * Missions accepted before the special ships had names: roll one now rather
 * than leave a live briefing reading "destroy the ship".
 */
export function backfillMissionShipNames(list: ActiveMission[]): void {
  for (const active of list) {
    const m = MISSIONS[String(active.misnId)];
    if (!m) continue;
    active.shipName ??= specialShipName(m);
    active.shipSubtitle ??= pickFromBank(m.shipSubtitle);
  }
}

/** Build the ActiveMission record (resolving random destinations). */
export function instantiateMission(
  m: MissionType,
  currentSpobId: string,
  player: PlayerState,
): ActiveMission {
  const travelSpobId = resolveStel(m.travelStel, currentSpobId);
  let returnSpobId =
    m.returnStel === -4
      ? currentSpobId
      : resolveStel(m.returnStel, currentSpobId);
  if (m.returnStel === -1) returnSpobId = null;
  const qty = rollCargoQty(m.cargoQty);
  /*
   * ShipCount ships fly for any goal we can resolve, and for the Bible's
   * "no specific goal" (-1) as well — those are the escorts and the ambushes,
   * placed by ShipBehav rather than by an objective. They are spawned exactly
   * like the rest and simply never gate completion, which is what shipsDone
   * being true from the outset says.
   */
  const shipsTotal = m.shipCount > 0 && m.shipGoal <= 5 ? m.shipCount : 0;
  const active: ActiveMission = {
    misnId: m.id,
    name: missionDisplayName(m),
    travelSpobId,
    returnSpobId,
    travelDone: travelSpobId === null,
    cargoName: qty > 0 ? cargoName(m.cargoType) : null,
    cargoQty: qty,
    cargoLoaded: qty > 0 && m.pickupMode !== 1, // mode 1 = pick up at travel stel
    acceptedDay: player.date,
    timeLimit: m.timeLimit > 0 ? m.timeLimit : 0,
    pay: m.pay,
    shipsTotal,
    shipsKilled: 0,
    shipsDone: shipsTotal === 0 || m.shipGoal < 0,
    shipDude: m.shipDude,
    shipSystemId:
      shipsTotal > 0
        ? resolveShipSystem(m, currentSpobId, travelSpobId, returnSpobId)
        : null,
    shipName: specialShipName(m),
    shipSubtitle: pickFromBank(m.shipSubtitle),
  };
  // the title carries <DST>/<RST> too, and only now do we know what they are
  active.name = substituteTags(active.name, m, active, "");
  return active;
}

/** Resolve a mission's ShipSyst code to a system id. */
function resolveShipSystem(
  m: MissionType,
  currentSpobId: string,
  travelSpobId: string | null,
  returnSpobId: string | null,
): string | null {
  const sysOfSpob = (id: string | null) =>
    id ? (SPOB_INDEX.get(id)?.systemId ?? null) : null;
  const current = sysOfSpob(currentSpobId);
  const code = m.shipSyst;
  if (code === -3) return sysOfSpob(travelSpobId) ?? current;
  if (code === -4) return sysOfSpob(returnSpobId) ?? current;
  if (code >= 128 && code <= 2175) {
    try {
      return getSystem(String(code)).id;
    } catch {
      return current;
    }
  }
  if (code >= 9999 && code <= 10255) {
    const govt = code - 9872;
    const matches = SYSTEMS.filter((s) => s.govtId === govt);
    if (matches.length)
      return matches[Math.floor(Math.random() * matches.length)].id;
  }
  // -1 (mission system), -2/-5/-6 (adjacent/other) and remaining codes: use the
  // system where the mission was accepted
  return current;
}

/** Fill EV Nova's <wildcard> tags in mission text. */
/*
 * Who the player is, for the desc tags. Kept module-scoped and set by
 * `Game.startPilot` rather than threaded through all 18 substituteTags call
 * sites — the same shape as `setInterfaceForGovt` in data/universe.
 */
let PLAYER_IDENTITY: {
  nickname: string;
  gender: "male" | "female";
  shipName: string;
} = { nickname: "", gender: "male", shipName: "" };

export function setPlayerIdentity(id: {
  nickname?: string;
  gender?: "male" | "female";
  shipName?: string;
}): void {
  PLAYER_IDENTITY = {
    nickname: id.nickname ?? "",
    gender: id.gender ?? "male",
    shipName: id.shipName ?? "",
  };
}

export function substituteTags(
  text: string,
  _m: MissionType,
  active: Partial<ActiveMission>,
  playerName: string,
  ranks?: { conv: string; short: string },
): string {
  const spobName = (id: string | null | undefined) =>
    id
      ? (SPOB_INDEX.get(id)?.planet.name ?? "an unknown world")
      : "an unknown world";
  const sysName = (id: string | null | undefined) => {
    const entry = id ? SPOB_INDEX.get(id) : undefined;
    if (!entry) return "an unknown system";
    return systemNameOf(entry.systemId);
  };
  return (
    text
      /*
       * {G "male text" "female text"} — the Bible's gender substitution.
       * This used to always take the first string; it now reads the pilot's
       * own gender, which is asked for at creation.
       */
      .replace(/\{G\s*"([^"]*)"\s*"([^"]*)"\}/g, (_all, male, female) =>
        PLAYER_IDENTITY.gender === "female" ? female : male,
      )
      .replace(/<CT>/g, active.cargoName ?? "cargo")
      .replace(/<CQ>/g, String(active.cargoQty ?? ""))
      .replace(/<DST>/g, spobName(active.travelSpobId))
      .replace(/<DSY>/g, sysName(active.travelSpobId))
      .replace(/<RST>/g, spobName(active.returnSpobId))
      .replace(/<RSY>/g, sysName(active.returnSpobId))
      // <SN> is the special ships' own name, rolled when the mission is built
      .replace(/<SN>/g, active.shipName ?? "ship")
      .replace(/<PN>/g, playerName)
      // <PNN> is the nickname, and the Bible is explicit that it falls back
      // to the full name; <PSN> is the ship's name, not the pilot's — an
      // earlier pass had it echoing the player name.
      .replace(/<PNN>/g, PLAYER_IDENTITY.nickname || playerName)
      .replace(/<PSN>/g, PLAYER_IDENTITY.shipName || "my ship")
      // <PRK>/<SRK>/<PSR>: your commission, or plain "captain" if you hold none
      .replace(/<PRK>/g, ranks?.conv || "captain")
      .replace(/<SRK>/g, ranks?.short || "captain")
      .replace(/<PSR>/g, ranks?.short || "captain")
  );
}

function systemNameOf(systemId: string): string {
  try {
    return getSystem(systemId).name;
  } catch {
    return "an unknown system";
  }
}

/** Minimum tons a mission will demand at accept time (random quantities roll ≥ 1). */
export function minCargoAtAccept(m: MissionType): number {
  if (m.pickupMode === 1) return 0; // picked up later, at the travel stellar
  return minCargoQty(m.cargoQty);
}
