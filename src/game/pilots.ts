import { getSystem, SHIPS } from "../data/universe";
import { grantHullOutfits } from "./combat";
import { migrateGovtRecords } from "./reputation";
import type { PlayerState } from "../types";

/** Multiple named pilot saves, EV-style, in localStorage. */

const INDEX_KEY = "starlanes-pilots";
const PILOT_PREFIX = "starlanes-pilot-";
const LEGACY_KEY = "starlanes-save-v1";

export interface PilotSummary {
  id: string;
  name: string;
  savedAt: number;
  /**
   * Strict-mode death: the pilot remains on the list (and can be deleted or
   * exported at their last leave-planet save) but cannot be flown again.
   */
  dead?: boolean;
}

interface PilotIndex {
  pilots: PilotSummary[];
}

function readIndex(): PilotIndex {
  try {
    const raw = localStorage.getItem(INDEX_KEY);
    if (raw) return JSON.parse(raw) as PilotIndex;
  } catch {
    // fall through
  }
  return { pilots: [] };
}

function writeIndex(index: PilotIndex): void {
  localStorage.setItem(INDEX_KEY, JSON.stringify(index));
}

/** One-time migration of the old single-save format into a named pilot. */
export function migrateLegacySave(): void {
  const raw = localStorage.getItem(LEGACY_KEY);
  if (!raw) return;
  try {
    const state = JSON.parse(raw) as PlayerState;
    const id = createPilot("Captain");
    savePilot(id, state);
  } catch {
    // corrupt legacy save; drop it
  }
  localStorage.removeItem(LEGACY_KEY);
}

export function listPilots(): PilotSummary[] {
  return readIndex().pilots.slice().sort((a, b) => b.savedAt - a.savedAt);
}

export function createPilot(name: string): string {
  const index = readIndex();
  const id = `p${Date.now().toString(36)}${Math.floor(Math.random() * 1e4).toString(36)}`;
  index.pilots.push({ id, name: name.trim() || "Captain", savedAt: Date.now() });
  writeIndex(index);
  return id;
}

export function savePilot(id: string, state: PlayerState): void {
  localStorage.setItem(PILOT_PREFIX + id, JSON.stringify(state));
  const index = readIndex();
  const entry = index.pilots.find((p) => p.id === id);
  if (entry) {
    entry.savedAt = Date.now();
    writeIndex(index);
  }
}

/** True when a strict pilot has died and may not be continued. */
export function isPilotDead(id: string): boolean {
  return !!readIndex().pilots.find((p) => p.id === id)?.dead;
}

/**
 * Mark a pilot deceased (strict death). Leaves their last leave-planet save on
 * disk for export / posterity; Continue refuses them.
 */
export function markPilotDead(id: string): void {
  const index = readIndex();
  const entry = index.pilots.find((p) => p.id === id);
  if (!entry || entry.dead) return;
  entry.dead = true;
  entry.savedAt = Date.now();
  writeIndex(index);
}

/**
 * Fill in fields a save predates. Pilots are long-lived and the engine keeps
 * growing new state, so anything the game iterates over has to exist even in a
 * save written before it did.
 */
function backfill(p: PlayerState): PlayerState {
  p.cargo ??= {};
  p.outfits ??= {};
  p.ammo ??= {};
  p.bits ??= {};
  p.records ??= {};
  // Saves written under the one-number-per-govt model: each system inherits
  // its owning government's old number where it differed from the seed.
  p.systemRecords ??= migrateGovtRecords(p.records);
  p.activeMissions ??= [];
  p.personsKilled ??= [];
  p.dominated ??= [];
  p.explored ??= [];
  p.crons ??= [];
  p.oopses ??= [];
  p.ranks ??= [];
  p.escorts ??= [];
  p.tributeDay ??= 0;
  p.salaryDay ??= 0;
  p.escortPayDay ??= 0;
  // Older saves only knew landedOn; use that pad as the lift-off reference.
  p.lastPad ??= p.landedOn ?? null;
  // Hulls used to carry their stock weapons implicitly, which meant the
  // Shuttle's Light Blaster could be flown but never sold. They are owned
  // outfits now, so a pilot saved before that has to be handed the ones their
  // current hull came with — otherwise the loadout code, which no longer looks
  // at the hull, would launch them unarmed.
  if (!p.hullDefaults) {
    grantHullOutfits(p.shipId, p.outfits);
    p.hullDefaults = true;
  }
  return p;
}

export function loadPilot(id: string): PlayerState | null {
  try {
    const raw = localStorage.getItem(PILOT_PREFIX + id);
    if (!raw) return null;
    const p = JSON.parse(raw) as PlayerState;
    getSystem(p.systemId); // validate against the loaded universe
    if (!SHIPS[p.shipId]) p.shipId = "128";
    return backfill(p);
  } catch {
    return null;
  }
}

export function deletePilot(id: string): void {
  localStorage.removeItem(PILOT_PREFIX + id);
  const index = readIndex();
  index.pilots = index.pilots.filter((p) => p.id !== id);
  writeIndex(index);
}

/** Serialise a pilot to a portable file payload. */
export function exportPilot(id: string): { filename: string; json: string } | null {
  const state = loadPilot(id);
  const summary = listPilots().find((p) => p.id === id);
  if (!state || !summary) return null;
  const safe = summary.name.replace(/[^\w.-]+/g, "_") || "pilot";
  return {
    filename: `starlanes-${safe}.json`,
    json: JSON.stringify({ format: "starlanes-pilot", version: 1, name: summary.name, state }, null, 2),
  };
}

/** Restore a pilot from an exported file. Returns the new pilot id. */
export function importPilot(json: string): { id: string; name: string } {
  const parsed = JSON.parse(json) as { format?: string; name?: string; state?: PlayerState };
  if (parsed.format !== "starlanes-pilot" || !parsed.state) {
    throw new Error("That file is not a Starlanes pilot.");
  }
  getSystem(parsed.state.systemId); // validate against the loaded universe
  const name = parsed.name?.trim() || "Imported pilot";
  const id = createPilot(name);
  savePilot(id, parsed.state);
  return { id, name };
}

/** Where/what a pilot is, for the menu list. */
export function describePilot(id: string): string {
  if (isPilotDead(id)) return "Deceased";
  const state = loadPilot(id);
  if (!state) return "new pilot";
  const ship = SHIPS[state.shipId]?.name.split(";")[0] ?? "ship";
  let place: string;
  try {
    place = getSystem(state.systemId).name;
  } catch {
    place = "deep space";
  }
  return `${ship} · ${place} · ${state.credits.toLocaleString()} cr`;
}
