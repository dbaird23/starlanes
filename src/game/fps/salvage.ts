/**
 * The salvage run: **five minutes of air, three breakers, then she is yours.**
 *
 * The whole design is one clock, one verb and one decision, and everything here
 * exists to keep it that way:
 *
 * - **One clock.** Air. It is the only resource, it only ever goes down, and
 *   nothing else is timed. There is no reactor gauge, no hull integrity, no
 *   ammo — a second number would turn a decision into arithmetic.
 * - **One verb.** Hold to use. Breakers and lockers are the same interaction
 *   with different payoffs, so there is nothing to learn between them and no
 *   second button to teach.
 * - **One decision.** A locker costs air at `LOOT_DRAIN` times normal, and the
 *   air it costs is air you needed for the breakers. That is the entire game:
 *   every locker you open is a bet that you can still finish.
 *
 * **Failure is soft.** Running out of air ends the run, and the run is a
 * diversion — `FpsOptions.onOutcome` is the only way a result leaves, and the
 * arcade entry point does not pass one. What a loss costs is the loot you were
 * carrying, which is the only thing that makes carrying it a decision.
 *
 * **Difficulty is layout and sequence, never new numbers.** A more valuable
 * hull gets its breakers further apart and behind each other, not a faster
 * clock or a tougher lock — the five minutes and the hold times are the same
 * on a Shuttle and on a Leviathan, and only the walk between them changes.
 */

import type { FpsLevel } from "./types";

/** Seconds in the tank at the airlock. */
export const AIR_FULL = 300;
/**
 * How much faster the tank empties while you are working a locker.
 *
 * This number *is* the decision. At 1 a locker is free and you open every one;
 * high enough and nobody ever opens one and the deck is a corridor with three
 * switches in it. At 4 a full locker costs about 24 seconds of the 300, so the
 * deck's eight lockers are three minutes of air against five minutes of run —
 * you can have most of them or all of the breakers comfortably, not both.
 */
export const LOOT_DRAIN = 4;
/** Below this, the HUD goes red and the breathing comes up. */
export const AIR_LOW = 60;

/** How close you have to stand, in cells. */
export const REACH = 1.15;
/** ...and how far off the station's own facing you may be, in radians. */
export const REACH_ARC = 1.1;

export type StationKind = "breaker" | "locker";

/** What a locker turns out to have held. Resolved by the caller, not here. */
export interface Salvaged {
  kind: "credits" | "cargo" | "outfit";
  amount: number;
  name: string;
}

export interface Station {
  kind: StationKind;
  /** where it stands, in cells — on the deck in front of the wall it is on */
  x: number;
  y: number;
  /** the direction it faces, i.e. out of its wall into the corridor */
  facing: number;
  /** which sector it powers. Breakers only; -1 on a locker. */
  sector: number;
  /** seconds of hold to finish it */
  hold: number;
  /** 0..1 */
  progress: number;
  done: boolean;
  /** what the HUD calls it */
  label: string;
  /** what came out of it, once it is open */
  loot?: Salvaged;
}

/**
 * The run's state. Deliberately a plain object rather than a class: `FpsWorld`
 * owns it, `index.ts` reads it to draw, and nothing else should be able to
 * reach into it and start a second clock.
 */
export interface SalvageRun {
  air: number;
  stations: Station[];
  /** which station the crosshair is on, or -1 */
  target: number;
  /** breakers thrown, of `breakersTotal` */
  breakers: number;
  breakersTotal: number;
  /** everything pulled out of a locker so far */
  haul: Salvaged[];
  /** set the frame the last breaker goes in, so the UI can say "get out" */
  powered: boolean;
  /**
   * Per-sector power, indexed as `FpsLevel.sectors` is. A breaker writes 1 into
   * its own sector and the renderer reads the table every frame, so throwing
   * one lights the compartment it belongs to — the payoff is the room coming
   * on around you, not a counter going up.
   */
  power: Float32Array;
  /** decays after a station completes, for the HUD flash */
  flash: number;
  /** what the last completed station was, for the line under the reticle */
  note: string;
  noteLeft: number;
}

export function newRun(level: FpsLevel, stations: Station[]): SalvageRun {
  return {
    air: AIR_FULL,
    stations,
    target: -1,
    breakers: 0,
    breakersTotal: stations.filter((s) => s.kind === "breaker").length,
    haul: [],
    powered: false,
    power: new Float32Array(level.sectors.length),
    flash: 0,
    note: "",
    noteLeft: 0,
  };
}

/**
 * Which station you are close enough to work, or -1.
 *
 * Both tests are needed and they are not the same test. Distance alone lets you
 * open a locker through the bulkhead it is bolted to; facing alone lets you
 * work one from across the corridor. Together they mean "standing at it".
 */
export function stationAt(run: SalvageRun, x: number, y: number, angle: number): number {
  let best = -1;
  let bestD = REACH;
  for (let i = 0; i < run.stations.length; i++) {
    const s = run.stations[i];
    if (s.done) continue;
    const d = Math.hypot(s.x - x, s.y - y);
    if (d > bestD) continue;
    // are we looking at it, and is it looking at us
    const toward = Math.atan2(s.y - y, s.x - x);
    if (Math.abs(wrapPi(toward - angle)) > REACH_ARC) continue;
    if (Math.abs(wrapPi(toward - s.facing + Math.PI)) > Math.PI / 2) continue;
    best = i;
    bestD = d;
  }
  return best;
}

function wrapPi(a: number): number {
  let r = a;
  while (r > Math.PI) r -= Math.PI * 2;
  while (r < -Math.PI) r += Math.PI * 2;
  return r;
}

/**
 * One tick of the run.
 *
 * `using` is the fire button, renamed because there is nothing to shoot: the
 * verb is the same input on the same finger, which is why the slice's controls
 * survived the change from shooter to salvage without a new key.
 *
 * Returns the station that completed this tick, or null.
 */
export function stepRun(
  run: SalvageRun,
  dt: number,
  x: number,
  y: number,
  angle: number,
  using: boolean,
): Station | null {
  run.flash = Math.max(0, run.flash - dt * 2);
  run.noteLeft = Math.max(0, run.noteLeft - dt);

  run.target = stationAt(run, x, y, angle);
  const st = run.target >= 0 ? run.stations[run.target] : null;
  const working = !!st && using;

  /*
   * The air. A locker drains at `LOOT_DRAIN`, and only while you are actually
   * working it — standing next to one costs nothing, so the decision is taken
   * at the moment you hold the button and not by walking past.
   */
  const drain = working && st!.kind === "locker" ? LOOT_DRAIN : 1;
  run.air = Math.max(0, run.air - dt * drain);

  let done: Station | null = null;
  if (working) {
    st!.progress = Math.min(1, st!.progress + dt / st!.hold);
    if (st!.progress >= 1) {
      st!.done = true;
      done = st!;
      run.flash = 1;
      if (st!.kind === "breaker") {
        run.breakers++;
        run.power[st!.sector] = 1;
        run.powered = run.breakers >= run.breakersTotal;
      }
    }
  } else if (st) {
    /*
     * Letting go **loses the progress**, and slowly rather than instantly. A
     * locker you half-opened and walked away from should not be waiting for you
     * at exactly where you left it — that turns the one decision into a free
     * option you can take in instalments — but snapping to zero reads as a bug
     * when you flinch off the button for a frame.
     */
    st.progress = Math.max(0, st.progress - dt * 0.5);
  }
  return done;
}

/** Whether the run is over, and which way. */
export function runOutcome(run: SalvageRun, atExit: boolean): "won" | "lost" | null {
  if (run.air <= 0) return "lost";
  if (run.powered && atExit) return "won";
  return null;
}

/** `m:ss`, for the tank readout. */
export function formatAir(sec: number): string {
  const s = Math.max(0, Math.ceil(sec));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}

/* ------------------------------------------------------------- placement */

/**
 * Where the stations go, derived from the deck rather than authored on it.
 *
 * Authoring them as glyphs would tie each deck's difficulty to whoever drew it,
 * and the design says difficulty is **layout and sequence** — which is a
 * property the deck already has. So a breaker goes in each powerable sector, at
 * the cell in that sector that is furthest from the airlock by walking distance,
 * and the sequence falls out: the nearest sector's breaker is a short trip and
 * the last one is the length of the ship. A bigger hull is a longer walk and
 * nothing else changes.
 *
 * Lockers fill the space between, spaced at least `LOCKER_SPACING` apart so they
 * read as finds rather than as a row of pickups.
 */
const LOCKER_SPACING = 3.5;
const BREAKER_HOLD = 2.6;
const LOCKER_HOLD = 6;

/** Breadth-first walking distance from the start, in cells. -1 where unreachable. */
function walkField(level: FpsLevel): Int32Array {
  const { w, h, cells } = level;
  const d = new Int32Array(w * h).fill(-1);
  const sx = Math.floor(level.start.x);
  const sy = Math.floor(level.start.y);
  if (sx < 0 || sy < 0 || sx >= w || sy >= h) return d;
  const q = [sy * w + sx];
  d[q[0]] = 0;
  for (let head = 0; head < q.length; head++) {
    const ci = q[head];
    const cx = ci % w;
    const cy = (ci / w) | 0;
    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]] as const) {
      const nx = cx + dx;
      const ny = cy + dy;
      if (nx < 0 || ny < 0 || nx >= w || ny >= h) continue;
      const ni = ny * w + nx;
      if (cells[ni] !== 0 || d[ni] >= 0) continue;
      d[ni] = d[ci] + 1;
      q.push(ni);
    }
  }
  return d;
}

/**
 * A cell's mounting face: the direction of a solid neighbour, as an angle
 * pointing *out* of that wall into the cell. Null if the cell is in the open,
 * which is where nothing gets mounted — a panel in the middle of a room is a
 * prop, and these are fittings.
 */
function mountFace(level: FpsLevel, cx: number, cy: number): number | null {
  const { w, h, cells } = level;
  const dirs: [number, number, number][] = [
    [1, 0, Math.PI],
    [-1, 0, 0],
    [0, 1, -Math.PI / 2],
    [0, -1, Math.PI / 2],
  ];
  for (const [dx, dy, facing] of dirs) {
    const nx = cx + dx;
    const ny = cy + dy;
    const solid = nx < 0 || ny < 0 || nx >= w || ny >= h || cells[ny * w + nx] !== 0;
    if (solid) return facing;
  }
  return null;
}

/** Stand-off from the wall, so you work a panel from in front of it. */
const MOUNT_OFF = 0.34;

function place(level: FpsLevel, ci: number, facing: number): { x: number; y: number } {
  const cx = (ci % level.w) + 0.5;
  const cy = ((ci / level.w) | 0) + 0.5;
  return {
    x: cx - Math.cos(facing) * MOUNT_OFF,
    y: cy - Math.sin(facing) * MOUNT_OFF,
  };
}

export function placeStations(level: FpsLevel, lockers = 8): Station[] {
  const dist = walkField(level);
  const out: Station[] = [];
  const taken: { x: number; y: number }[] = [];

  /*
   * One breaker per sector that has any darkness to fix. Sector 0 is the
   * level's default — the corridor you arrive in — and it is deliberately
   * skipped: the first thing you should see is the deck you came from staying
   * exactly as dead as it was.
   */
  const best = new Map<number, number>();
  for (let ci = 0; ci < dist.length; ci++) {
    if (dist[ci] < 0) continue;
    const sec = level.sectorOf[ci];
    if (sec === 0) continue;
    if (mountFace(level, ci % level.w, (ci / level.w) | 0) === null) continue;
    const cur = best.get(sec);
    if (cur === undefined || dist[ci] > dist[cur]) best.set(sec, ci);
  }
  const order = [...best.entries()].sort((a, b) => dist[a[1]] - dist[b[1]]);
  for (const [sec, ci] of order) {
    const facing = mountFace(level, ci % level.w, (ci / level.w) | 0)!;
    const p = place(level, ci, facing);
    out.push({
      kind: "breaker",
      ...p,
      facing,
      sector: sec,
      hold: BREAKER_HOLD,
      progress: 0,
      done: false,
      label: level.sectors[sec]?.name ?? "Breaker",
    });
    taken.push(p);
  }

  /*
   * ...and the lockers, taken furthest-first so they land deep in the ship
   * rather than clustering by the airlock where they would cost nothing to
   * detour to.
   */
  const cand = [...dist.keys()]
    .filter((ci) => dist[ci] > 2 && mountFace(level, ci % level.w, (ci / level.w) | 0) !== null)
    .sort((a, b) => dist[b] - dist[a]);
  for (const ci of cand) {
    if (out.length - order.length >= lockers) break;
    const facing = mountFace(level, ci % level.w, (ci / level.w) | 0)!;
    const p = place(level, ci, facing);
    if (taken.some((t) => Math.hypot(t.x - p.x, t.y - p.y) < LOCKER_SPACING)) continue;
    out.push({
      kind: "locker",
      ...p,
      facing,
      sector: -1,
      hold: LOCKER_HOLD,
      progress: 0,
      done: false,
      label: "Locker",
    });
    taken.push(p);
  }
  return out;
}

/* ------------------------------------------------------------------ loot */

/**
 * What is in a locker.
 *
 * Deliberately three shallow buckets and a name, resolved here rather than
 * against the pilot's universe, because the run is a diversion: a locker has to
 * produce something to *show* on the end card whether or not anything is wired
 * to receive it. When boarding is real, `onOutcome` hands the haul to the
 * caller and this is where the roll moves — the cargo names become jünk ids and
 * the outfit names oütf ids, gated on the boarded hull's own government.
 */
const CARGO_NAMES = [
  "Medical Supplies",
  "Industrial Equipment",
  "Food",
  "Metal",
  "Electronics",
  "Luxury Goods",
];
const OUTFIT_NAMES = [
  "Fuel Cell",
  "Shield Capacitor",
  "Afterburner Core",
  "Sensor Array",
];

export function rollLoot(): Salvaged {
  const r = Math.random();
  if (r < 0.55) {
    // credits, in the round numbers a strongbox holds
    const amount = 250 * (2 + Math.floor(Math.random() * 18));
    return { kind: "credits", amount, name: `${amount.toLocaleString()} credits` };
  }
  if (r < 0.9) {
    const name = CARGO_NAMES[Math.floor(Math.random() * CARGO_NAMES.length)];
    const amount = 1 + Math.floor(Math.random() * 5);
    return { kind: "cargo", amount, name: `${amount}t ${name}` };
  }
  const name = OUTFIT_NAMES[Math.floor(Math.random() * OUTFIT_NAMES.length)];
  return { kind: "outfit", amount: 1, name };
}
