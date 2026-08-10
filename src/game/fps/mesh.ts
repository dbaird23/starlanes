/**
 * The corridor, as real geometry.
 *
 * Five rounds of a scanline raycaster got the octagonal section right along a
 * straight wall and could never make it turn a corner. The last of them wrapped
 * the 45 degree fold as a heightfield over the deck — which was geometrically
 * correct and still punched spikes through the floor, scalloped the section into
 * lobes around every rib, and cost 1.6x the frame time. All of it is free as a
 * mesh, and this file is that mesh: built once at level load, never touched
 * again, and handed to `glscene.ts` as a handful of `BufferGeometry`.
 *
 * ## The section
 *
 * `art-reference/damage/damage.png` is the clearest statement of it — the
 * near-field frames are unlit and read as silhouette: deck, 45 degree lower
 * chamfer, vertical face, 45 degree upper chamfer, overhead. Those angles are
 * the **profile**, not floor-plan angles, so the plan stays a grid.
 *
 * Proportions from `corridor-lit.png`: deck ~45% of the corridor's width, a
 * chamfer of ~0.275 of the width each side, and a corridor that reads about as
 * wide as it is tall.
 *
 * ## Corners come out right because the geometry is real
 *
 * Every open cell face that abuts a solid emits the three profile strips. That
 * is all a straight run needs, and it is *nearly* all a corner needs:
 *
 * - **Inside (concave) corners mitre themselves.** Two perpendicular 45 degree
 *   ramps intersect exactly along the plan diagonal, and the eye is above both,
 *   so the depth buffer keeps the higher one — which is `max()`, which is the
 *   mitre. Emit both and do nothing else.
 * - **Outside (convex) corners need a fillet**, because the two ramps stop at
 *   the corner's quadrant and nothing covers it. The patch is the quarter-cone
 *   the distance field used to give for free: apex at the corner post at height
 *   `run`, falling to the deck at radius `run`, which meets each neighbouring
 *   ramp tangentially along the quadrant's edges.
 *
 * ## The run is continuous because it lives on the grid's corners
 *
 * `chamferRun` is a fraction of the space's *free span*, so it genuinely differs
 * across a deck — 0.275 in a one-cell passage, 0.5 in the two-cell spine. Read
 * per cell that is a step at every cell boundary, and a step in a mesh is a
 * hole. So the run and the overhead height are resolved onto the **grid's
 * corners** (`(w+1) x (h+1)`) and every strip interpolates between its two
 * corner values, which makes adjacent faces share their endpoints exactly.
 *
 * Per-cell runs are eroded (3x3 min) before that, and the erosion is what kills
 * the *doorway spike*: the one corridor cell a compartment opens off has seven
 * cells of vertical run through it, asks for the full 0.5 in a passage one cell
 * wide, and leaves no deck at all between the two folds.
 *
 * ## The bay rhythm is a rib, not paint
 *
 * The references' loudest cue that a corridor is not one endless tube is a
 * structural ring every few metres. `parseLevel` already promotes hull cells on
 * the bay grid to `WALL.frame`; here that becomes a **prism standing 0.15 of a
 * cell proud** of the wall — the same octagon profile pushed toward the corridor
 * centre, closed at both ends — and the ring is carried across the overhead by a
 * shallow beam over every open cell the frame faces. Brightness on a smooth tube
 * left the silhouette as two converging lines; the reference is nested octagons
 * receding, and their outlines are the depth cue.
 */

import * as THREE from "three";
import {
  CEIL_GAIN,
  CEIL_TINT,
  DECK_GAIN,
  DECK_TILE,
  WALL,
  dressOf,
} from "./textures";
import type { FpsLevel } from "./types";

/** The vertical face never gets thinner than this, in cells. */
const FACE_MIN = 0.18;
/** ...and the chamfer never gets thinner than this, so a fold stays a fold. */
const CHAM_MIN = 0.1;
/**
 * ...nor thicker.
 *
 * Without it a wide compartment under the reactor bay's 1.9 overhead asks for a
 * 0.86 chamfer and gets a 0.18 strip of vertical face — a cove, not a section.
 * The reference's rooms (`rooms/compartment.png`) keep a chamfer close to a
 * corridor's however wide the room is: the *shape* is one shape and only the
 * space around it changes.
 */
const RUN_MAX = 0.5;

/** How far a bay frame stands proud of the wall, in cells. */
const RIB = 0.15;

/** Segments in a convex corner's quarter-cone. Five is past the point of seeing it. */
const FILLET_SEGS = 5;

/**
 * The chamfer's run for a space of the given free span, under the given
 * overhead. `frac` is the sector's own ratio — the reference's 0.275.
 *
 * Two chamfers of run `c` eat `2c` of the overhead between them, so a wide space
 * under a low overhead cannot have the chamfer its width asks for. `FACE_MIN` is
 * the strip of vertical face that has to survive.
 */
function chamferRun(frac: number, span: number, height: number): number {
  const room = (height - FACE_MIN) / 2;
  let c = frac * span;
  if (c > RUN_MAX) c = RUN_MAX;
  if (c > room) c = room;
  return c < CHAM_MIN ? CHAM_MIN : c;
}

/* ------------------------------------------------------------------ buffers */

/**
 * One draw call's worth of triangles.
 *
 * The three per-vertex extras are what let a dozen materials share one shader:
 * `light` is the sector's own power (Doom's model — light belongs to an area,
 * not to a wall), `gain` the band's place in the section's brightness staircase,
 * and `emit` how hard this surface's own bright pixels burn through the fog.
 */
interface Build {
  pos: number[];
  nrm: number[];
  uv: number[];
  light: number[];
  gain: number[];
  emit: number[];
}

function newBuild(): Build {
  return { pos: [], nrm: [], uv: [], light: [], gain: [], emit: [] };
}

type Vec3 = [number, number, number];

function sub3(a: Vec3, b: Vec3): Vec3 {
  return [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
}

function cross3(a: Vec3, b: Vec3): Vec3 {
  return [
    a[1] * b[2] - a[2] * b[1],
    a[2] * b[0] - a[0] * b[2],
    a[0] * b[1] - a[1] * b[0],
  ];
}

function norm3(v: Vec3): Vec3 {
  const l = Math.hypot(v[0], v[1], v[2]) || 1;
  return [v[0] / l, v[1] / l, v[2] / l];
}

/** Attributes shared by every vertex of one primitive. */
interface Shade {
  light: number;
  gain: number;
  emit: number;
}

/**
 * ...plus a per-vertex occlusion multiplier on `gain`.
 *
 * There is no shadow of any kind in this renderer — one lamp at the eye, no
 * shadow map — and without *some* crease darkening a metal tube lit from its
 * own axis comes out as flawless plastic: every fold of the octagon reads as a
 * change of tone and nothing reads as an edge. Baking a corner term into the
 * gain attribute costs one number a vertex and no shader work at all, and it is
 * exactly what `damage/damage.png` is made of — near-black creases with the
 * light picking out the ribs between them.
 */
function tri(
  b: Build,
  p0: Vec3,
  p1: Vec3,
  p2: Vec3,
  uv0: [number, number],
  uv1: [number, number],
  uv2: [number, number],
  sh: Shade,
  ao: [number, number, number] = [1, 1, 1],
): void {
  const n = norm3(cross3(sub3(p1, p0), sub3(p2, p0)));
  const ps = [p0, p1, p2];
  const us = [uv0, uv1, uv2];
  for (let i = 0; i < 3; i++) {
    b.pos.push(ps[i][0], ps[i][1], ps[i][2]);
    b.nrm.push(n[0], n[1], n[2]);
    b.uv.push(us[i][0], us[i][1]);
    b.light.push(sh.light);
    b.gain.push(sh.gain * ao[i]);
    b.emit.push(sh.emit);
  }
}

/** Wound counter-clockwise seen from the front, so the normal falls out of it. */
function quad(
  b: Build,
  p0: Vec3,
  p1: Vec3,
  p2: Vec3,
  p3: Vec3,
  uv0: [number, number],
  uv1: [number, number],
  uv2: [number, number],
  uv3: [number, number],
  sh: Shade,
  ao: [number, number, number, number] = [1, 1, 1, 1],
): void {
  tri(b, p0, p1, p2, uv0, uv1, uv2, sh, [ao[0], ao[1], ao[2]]);
  tri(b, p0, p2, p3, uv0, uv2, uv3, sh, [ao[0], ao[2], ao[3]]);
}

/**
 * Occlusion at the four profile points, from the deck up.
 *
 * The octagon is a tube, so every one of its folds is concave seen from inside;
 * what differs is how much sky each one can see. The two creases against the
 * deck and the overhead are the tightest, the middle of the vertical face the
 * most open.
 */
const AO_PROFILE = [0.6, 0.9, 0.84, 0.52];

/** ...and how much a surface standing proud of the wall gets back. */
const AO_RIB_FRONT = 0.98;
const AO_RIB_RETURN = 0.55;

/* ------------------------------------------------------------------- output */

/** One texture's worth of the level, ready to become a `THREE.Mesh`. */
export interface MeshGroup {
  /** file under `public/fps/` */
  tile: string;
  /** flat multiplier on the sampled texel — the overhead is the deck, cooled */
  tint: [number, number, number];
  geometry: THREE.BufferGeometry;
}

export interface LevelMesh {
  groups: MeshGroup[];
  /** total triangles, for the record */
  tris: number;
}

/* ------------------------------------------------------------------ corners */

/** A 3x3 minimum over the cell grid, edges clamped. */
function erode(f: Float32Array, w: number, h: number): void {
  const src = f.slice();
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      let m = src[y * w + x];
      for (let dy = -1; dy <= 1; dy++) {
        const jy = y + dy;
        if (jy < 0 || jy >= h) continue;
        for (let dx = -1; dx <= 1; dx++) {
          const jx = x + dx;
          if (jx < 0 || jx >= w) continue;
          const v = src[jy * w + jx];
          if (v < m) m = v;
        }
      }
      f[y * w + x] = m;
    }
  }
}

/**
 * The chamfer run and the overhead height at every grid **corner**.
 *
 * The run takes the minimum of the open cells touching the corner and the
 * overhead their mean. Those are not the same choice for a reason: a run that
 * overshoots eats the vertical face and collapses the section, so it wants the
 * tightest neighbour, while an overhead that steps between sectors (1.2 in the
 * corridors, 1.9 in the reactor bay) wants to ramp rather than jump — a jump in
 * a mesh is a hole, and the reactor's mouth is a good place for a slope anyway.
 */
function cornerFields(lvl: FpsLevel): { run: Float32Array; ceil: Float32Array } {
  const { w, h, cells, sectorOf, sectors, freeSpan } = lvl;
  const cellRun = new Float32Array(w * h);
  const cellCeil = new Float32Array(w * h);
  for (let i = 0; i < w * h; i++) {
    if (cells[i] !== 0) {
      cellRun[i] = Infinity;
      continue;
    }
    const s = sectors[sectorOf[i]];
    cellCeil[i] = s.height;
    cellRun[i] = chamferRun(s.chamfer, freeSpan[i] || 1, s.height);
  }
  // solids hold Infinity so the erosion ignores them, then the corner pass only
  // ever reads open cells anyway
  erode(cellRun, w, h);

  const cw = w + 1;
  const run = new Float32Array(cw * (h + 1));
  const ceil = new Float32Array(cw * (h + 1));
  for (let gy = 0; gy <= h; gy++) {
    for (let gx = 0; gx <= w; gx++) {
      let best = Infinity;
      let ceilSum = 0;
      let n = 0;
      for (let dy = -1; dy <= 0; dy++) {
        for (let dx = -1; dx <= 0; dx++) {
          const cx = gx + dx;
          const cy = gy + dy;
          if (cx < 0 || cy < 0 || cx >= w || cy >= h) continue;
          const i = cy * w + cx;
          if (cells[i] !== 0) continue;
          if (cellRun[i] < best) best = cellRun[i];
          ceilSum += cellCeil[i];
          n++;
        }
      }
      const o = gy * cw + gx;
      ceil[o] = n > 0 ? ceilSum / n : 1;
      run[o] = n > 0 ? best : CHAM_MIN;
      // a corner whose neighbours disagree can still ask for more than its own
      // overhead can pay for; the face has to survive whatever the blend does
      const room = (ceil[o] - FACE_MIN) / 2;
      if (run[o] > room) run[o] = room;
      if (run[o] < CHAM_MIN) run[o] = CHAM_MIN;
    }
  }
  return { run, ceil };
}

/* ------------------------------------------------------------------ profile */

/**
 * The octagon's four profile points at one grid corner, in `(u, y)` — `u`
 * measured **inward** from the wall plane, `y` up from the deck.
 *
 * `off` pushes the whole profile toward the corridor centre, which is how a bay
 * frame's rib is the same shape 0.15 nearer.
 */
function profile(run: number, ceil: number, off: number): [number, number][] {
  const top = Math.max(run + 0.02, ceil - run);
  return [
    [off + run, 0],
    [off, run],
    [off, top],
    [off + run, ceil],
  ];
}

/** Arc length along the profile, normalised — the rib's trim wraps on this. */
function profileArc(p: [number, number][]): number[] {
  const d: number[] = [0];
  for (let i = 1; i < p.length; i++) {
    d.push(d[i - 1] + Math.hypot(p[i][0] - p[i - 1][0], p[i][1] - p[i - 1][1]));
  }
  const t = d[d.length - 1] || 1;
  return d.map((v) => v / t);
}

/**
 * The frame of one cell face: the inward normal, the along-edge direction, the
 * edge's origin, and the two grid corners it runs between.
 *
 * `s = up x n` is chosen so that a quad wound `(A_low, B_low, B_high, A_high)`
 * has its normal at `n` — every strip in this file relies on that.
 */
interface Frame {
  n: Vec3;
  s: Vec3;
  o: Vec3;
  c0: number;
  c1: number;
}

/** dir: 0 = W neighbour, 1 = E, 2 = N (-y), 3 = S (+y). */
function faceFrame(cx: number, cy: number, dir: number, cw: number): Frame {
  switch (dir) {
    case 0:
      return {
        n: [1, 0, 0],
        s: [0, 0, -1],
        o: [cx, 0, cy + 1],
        c0: (cy + 1) * cw + cx,
        c1: cy * cw + cx,
      };
    case 1:
      return {
        n: [-1, 0, 0],
        s: [0, 0, 1],
        o: [cx + 1, 0, cy],
        c0: cy * cw + cx + 1,
        c1: (cy + 1) * cw + cx + 1,
      };
    case 2:
      return {
        n: [0, 0, 1],
        s: [1, 0, 0],
        o: [cx, 0, cy],
        c0: cy * cw + cx,
        c1: cy * cw + cx + 1,
      };
    default:
      return {
        n: [0, 0, -1],
        s: [-1, 0, 0],
        o: [cx + 1, 0, cy + 1],
        c0: (cy + 1) * cw + cx + 1,
        c1: (cy + 1) * cw + cx,
      };
  }
}

function at(f: Frame, t: number, u: number, y: number): Vec3 {
  return [
    f.o[0] + f.s[0] * t + f.n[0] * u,
    y,
    f.o[2] + f.s[2] * t + f.n[2] * u,
  ];
}

/* -------------------------------------------------------------------- build */

/**
 * Build the whole level's geometry, grouped by texture.
 *
 * Static: this runs once when the session opens, and the result is uploaded to
 * the GPU and left alone. A 24x24 deck comes out around ten thousand triangles
 * in nine draw calls.
 */
export function buildLevelMesh(lvl: FpsLevel): LevelMesh {
  const { w, h, cells, sectorOf, sectors } = lvl;
  const cw = w + 1;
  const { run: cRun, ceil: cCeil } = cornerFields(lvl);

  const builds = new Map<string, Build>();
  const tints = new Map<string, [number, number, number]>();
  const get = (tile: string, tint?: [number, number, number]): Build => {
    const key = tint ? `${tile}|${tint.join(",")}` : tile;
    let b = builds.get(key);
    if (!b) {
      b = newBuild();
      builds.set(key, b);
      tints.set(key, tint ?? [1, 1, 1]);
    }
    return b;
  };
  const solid = (x: number, y: number): boolean =>
    x < 0 || y < 0 || x >= w || y >= h || cells[y * w + x] !== 0;
  /** How boxed-in a grid corner is: the four cells that meet at it. */
  const cornerAo = (gx: number, gy: number, k: number): number => {
    let n = 0;
    if (solid(gx - 1, gy - 1)) n++;
    if (solid(gx, gy - 1)) n++;
    if (solid(gx - 1, gy)) n++;
    if (solid(gx, gy)) n++;
    return 1 - k * n;
  };
  const wallAt = (x: number, y: number): number =>
    x < 0 || y < 0 || x >= w || y >= h ? WALL.hull : cells[y * w + x];

  /*
   * The overhead's share of the bay ring.
   *
   * A frame is a wall cell, so it only ever states the ring on the two sides of
   * the corridor. Walking out of each frame across the open cells it faces —
   * which is *across* the corridor, because a wall that faces east/west bounds a
   * passage running north/south — carries the ring over the deck as a beam and
   * closes the octagon overhead. In a wide compartment it reads as a structural
   * frame spanning the space, which is what it is.
   */
  const ring = new Uint8Array(w * h);
  /** 1 = the beam runs along x, 2 = along z. */
  const ringAxis = new Uint8Array(w * h);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      if (cells[y * w + x] !== WALL.frame) continue;
      const dirs: [number, number, number][] = [
        [-1, 0, 1],
        [1, 0, 1],
        [0, -1, 2],
        [0, 1, 2],
      ];
      for (const [dx, dy, axis] of dirs) {
        let nx = x + dx;
        let ny = y + dy;
        while (!solid(nx, ny)) {
          const i = ny * w + nx;
          ring[i] = 1;
          if (!ringAxis[i]) ringAxis[i] = axis;
          nx += dx;
          ny += dy;
        }
      }
    }
  }

  for (let cy = 0; cy < h; cy++) {
    for (let cx = 0; cx < w; cx++) {
      const ci = cy * w + cx;
      if (cells[ci] !== 0) continue;
      const sec = sectors[sectorOf[ci]];
      const light = sec.light;

      const c00 = cy * cw + cx;
      const c10 = cy * cw + cx + 1;
      const c01 = (cy + 1) * cw + cx;
      const c11 = (cy + 1) * cw + cx + 1;

      /* ---- deck: one plate to the cell, seams and centre runner included */
      quad(
        get(DECK_TILE),
        [cx, 0, cy],
        [cx, 0, cy + 1],
        [cx + 1, 0, cy + 1],
        [cx + 1, 0, cy],
        [cx, cy],
        [cx, cy + 1],
        [cx + 1, cy + 1],
        [cx + 1, cy],
        { light, gain: DECK_GAIN, emit: 0 },
        [
          cornerAo(cx, cy, 0.1),
          cornerAo(cx, cy + 1, 0.1),
          cornerAo(cx + 1, cy + 1, 0.1),
          cornerAo(cx + 1, cy, 0.1),
        ],
      );

      /* ---- overhead, at the corners' own heights so a sector step ramps */
      const drop = ring[ci] ? RIB : 0;
      const h00 = cCeil[c00] - drop;
      const h10 = cCeil[c10] - drop;
      const h01 = cCeil[c01] - drop;
      const h11 = cCeil[c11] - drop;
      const ceilAo: [number, number, number, number] = [
        cornerAo(cx, cy, 0.13),
        cornerAo(cx + 1, cy, 0.13),
        cornerAo(cx + 1, cy + 1, 0.13),
        cornerAo(cx, cy + 1, 0.13),
      ];
      const ceilB = get(DECK_TILE, CEIL_TINT);
      const ceilTile = ring[ci] ? get(dressOf(WALL.frame).ribTile) : ceilB;
      const ceilShade = {
        light,
        gain: CEIL_GAIN,
        emit: ring[ci] ? dressOf(WALL.frame).emit + dressOf(WALL.frame).emitSector * light : 0,
      };
      if (ring[ci]) {
        // the beam's soffit carries the ring's trim, wrapped across the span so
        // the channel lands square across the corridor rather than down it
        const alongX = ringAxis[ci] === 1;
        const u0: [number, number] = [0, 0];
        const u1: [number, number] = alongX ? [1, 0] : [0, 1];
        const u2: [number, number] = [1, 1];
        const u3: [number, number] = alongX ? [0, 1] : [1, 0];
        quad(
          ceilTile,
          [cx, h00, cy],
          [cx + 1, h10, cy],
          [cx + 1, h11, cy + 1],
          [cx, h01, cy + 1],
          u0,
          u1,
          u2,
          u3,
          ceilShade,
          ceilAo,
        );
      } else {
        quad(
          ceilB,
          [cx, h00, cy],
          [cx + 1, h10, cy],
          [cx + 1, h11, cy + 1],
          [cx, h01, cy + 1],
          [cx, cy],
          [cx + 1, cy],
          [cx + 1, cy + 1],
          [cx, cy + 1],
          ceilShade,
          ceilAo,
        );
      }

      /* ---- the beam's own sides, where it meets an unribbed neighbour */
      if (ring[ci]) {
        const trim = get(dressOf(WALL.frame).ribTile);
        const sh = {
          light,
          gain: CEIL_GAIN * 1.5,
          emit: dressOf(WALL.frame).emit + dressOf(WALL.frame).emitSector * light,
        };
        const nb: [number, number, number][] = [
          [-1, 0, 0],
          [1, 0, 1],
          [0, -1, 2],
          [0, 1, 3],
        ];
        for (const [dx, dy, dir] of nb) {
          const nx = cx + dx;
          const ny = cy + dy;
          if (solid(nx, ny) || ring[ny * w + nx]) continue;
          // the neighbour's own inward frame is this edge seen from outside
          const f = faceFrame(nx, ny, dir === 0 ? 1 : dir === 1 ? 0 : dir === 2 ? 3 : 2, cw);
          const a = cCeil[f.c0];
          const bb = cCeil[f.c1];
          quad(
            trim,
            at(f, 0, 0, a - RIB),
            at(f, 1, 0, bb - RIB),
            at(f, 1, 0, bb),
            at(f, 0, 0, a),
            [0, 0],
            [1, 0],
            [1, 1],
            [0, 1],
            sh,
          );
        }
      }

      /* ---- the four wall sections */
      for (let dir = 0; dir < 4; dir++) {
        const nx = cx + (dir === 0 ? -1 : dir === 1 ? 1 : 0);
        const ny = cy + (dir === 2 ? -1 : dir === 3 ? 1 : 0);
        if (!solid(nx, ny)) continue;
        const id = wallAt(nx, ny);
        const dress = dressOf(id);
        const f = faceFrame(cx, cy, dir, cw);
        const runA = cRun[f.c0];
        const runB = cRun[f.c1];
        const ceilA = cCeil[f.c0];
        const ceilB2 = cCeil[f.c1];
        const pa = profile(runA, ceilA, 0);
        const pb = profile(runB, ceilB2, 0);

        // one hash per cell breaks the tile's central motif recurring down a run
        const variant = ((cx * 73856093) ^ (cy * 19349663) ^ (dir * 83492791)) >>> 0;
        /*
         * One cell in eight, not one in two. `wall-grimy` is the same panel
         * oxidised and it is a good deal darker than `wall-main`, so swapped in
         * half the time it stops reading as weathering and starts reading as
         * *patches* — a chequerboard of tone down a wall that is supposed to be
         * one wall. Rarely, it is dirt.
         */
        const useAlt = (variant & 7) === 0;
        const faceTile =
          useAlt && dress.faceAlt ? dress.faceAlt : dress.face;
        const bevelTile =
          useAlt && dress.bevelAlt ? dress.bevelAlt : dress.bevel;
        const emit = dress.emit + dress.emitSector * light;
        /*
         * A frame's plain profile is the *recess* behind the rib and is dressed
         * as hull, so it must not carry the ring's emission — keyed off the
         * tile's own bright pixels, `wall-main` is bright everywhere and the
         * whole wall would light up at every bay.
         */
        const plainEmit = dress.rib > 0 ? 0 : emit;
        const uOff = (variant % 4) / 4;

        // lower chamfer
        quad(
          get(bevelTile),
          at(f, 0, pa[0][0], pa[0][1]),
          at(f, 1, pb[0][0], pb[0][1]),
          at(f, 1, pb[1][0], pb[1][1]),
          at(f, 0, pa[1][0], pa[1][1]),
          [uOff, 0],
          [uOff + 1, 0],
          [uOff + 1, 1],
          [uOff, 1],
          { light, gain: dress.gainLower, emit: plainEmit },
          [AO_PROFILE[0], AO_PROFILE[0], AO_PROFILE[1], AO_PROFILE[1]],
        );
        // vertical face
        const rep = dress.faceRepeat;
        quad(
          get(faceTile),
          at(f, 0, pa[1][0], pa[1][1]),
          at(f, 1, pb[1][0], pb[1][1]),
          at(f, 1, pb[2][0], pb[2][1]),
          at(f, 0, pa[2][0], pa[2][1]),
          [uOff, 0],
          [uOff + rep, 0],
          [uOff + rep, 1],
          [uOff, 1],
          { light, gain: dress.gainFace, emit: plainEmit },
          [AO_PROFILE[1], AO_PROFILE[1], AO_PROFILE[2], AO_PROFILE[2]],
        );
        // upper chamfer
        quad(
          get(bevelTile),
          at(f, 0, pa[2][0], pa[2][1]),
          at(f, 1, pb[2][0], pb[2][1]),
          at(f, 1, pb[3][0], pb[3][1]),
          at(f, 0, pa[3][0], pa[3][1]),
          [uOff, 0],
          [uOff + 1, 0],
          [uOff + 1, 1],
          [uOff, 1],
          { light, gain: dress.gainUpper, emit: plainEmit },
          [AO_PROFILE[2], AO_PROFILE[2], AO_PROFILE[3], AO_PROFILE[3]],
        );

        /* ---- and the rib, if this wall is a bay frame */
        if (dress.rib > 0) {
          const ra = profile(runA, ceilA, dress.rib);
          const rb = profile(runB, ceilB2, dress.rib);
          const arc = profileArc(ra);
          const trim = get(dress.ribTile);
          /*
           * The ring gets a *flatter* staircase than the wall behind it.
           *
           * The section's 1.0 / 0.68 / 0.34 is what makes the octagon read as an
           * octagon, and applied to the rib it broke the ring into three
           * unrelated bright patches with dark gaps between them — a lit bench,
           * a dim wall and a black soffit, rather than one piece of structure
           * hooping the corridor.
           */
          const gains = [0.95, 0.84, 0.66];
          for (let i = 0; i < 3; i++) {
            const sh = { light, gain: gains[i], emit };
            // the ring's front, with the trim wrapped **around** the octagon —
            // the tile's channel is a band across its own u, so it comes out as
            // one continuous strip round the section rather than down the wall
            quad(
              trim,
              at(f, 0, ra[i][0], ra[i][1]),
              at(f, 1, rb[i][0], rb[i][1]),
              at(f, 1, rb[i + 1][0], rb[i + 1][1]),
              at(f, 0, ra[i + 1][0], ra[i + 1][1]),
              [arc[i], 0],
              [arc[i], 1],
              [arc[i + 1], 1],
              [arc[i + 1], 0],
              sh,
              [AO_RIB_FRONT, AO_RIB_FRONT, AO_RIB_FRONT, AO_RIB_FRONT],
            );
            // the two returns that make it a rib you can see the edge of
            quad(
              trim,
              at(f, 0, pa[i][0], pa[i][1]),
              at(f, 0, ra[i][0], ra[i][1]),
              at(f, 0, ra[i + 1][0], ra[i + 1][1]),
              at(f, 0, pa[i + 1][0], pa[i + 1][1]),
              [arc[i], 0],
              [arc[i], 1],
              [arc[i + 1], 1],
              [arc[i + 1], 0],
              { ...sh, gain: sh.gain * AO_RIB_RETURN },
            );
            quad(
              trim,
              at(f, 1, pb[i + 1][0], pb[i + 1][1]),
              at(f, 1, rb[i + 1][0], rb[i + 1][1]),
              at(f, 1, rb[i][0], rb[i][1]),
              at(f, 1, pb[i][0], pb[i][1]),
              [arc[i + 1], 0],
              [arc[i + 1], 1],
              [arc[i], 1],
              [arc[i], 0],
              { ...sh, gain: sh.gain * AO_RIB_RETURN },
            );
          }
        }
      }

      /* ---- convex corner fillets */
      const corners: [number, number, number, number][] = [
        // [corner gx, corner gy, quadrant x sign, quadrant y sign]
        [cx, cy, 1, 1],
        [cx + 1, cy, -1, 1],
        [cx, cy + 1, 1, -1],
        [cx + 1, cy + 1, -1, -1],
      ];
      for (const [gx, gy, sx, sy] of corners) {
        const dx = -sx;
        const dy = -sy;
        // the diagonal is the post; the two orthogonals have to be open or this
        // is an ordinary wall junction and the strips already covered it
        if (!solid(cx + dx, cy + dy)) continue;
        if (solid(cx + dx, cy) || solid(cx, cy + dy)) continue;
        const ci2 = gy * cw + gx;
        const r = cRun[ci2];
        const ce = cCeil[ci2];
        const id = wallAt(cx + dx, cy + dy);
        const dress = dressOf(id);
        const emit = dress.rib > 0 ? 0 : dress.emit + dress.emitSector * light;
        const b = get(dress.bevel);
        fillet(b, gx, gy, sx, sy, r, 0, 1, { light, gain: dress.gainLower, emit });
        fillet(b, gx, gy, sx, sy, r, ce, -1, {
          light,
          gain: dress.gainUpper,
          emit,
        });
      }
    }
  }

  const groups: MeshGroup[] = [];
  let tris = 0;
  for (const [key, b] of builds) {
    if (b.pos.length === 0) continue;
    const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.Float32BufferAttribute(b.pos, 3));
    g.setAttribute("normal", new THREE.Float32BufferAttribute(b.nrm, 3));
    g.setAttribute("uv", new THREE.Float32BufferAttribute(b.uv, 2));
    g.setAttribute("aLight", new THREE.Float32BufferAttribute(b.light, 1));
    g.setAttribute("aGain", new THREE.Float32BufferAttribute(b.gain, 1));
    g.setAttribute("aEmit", new THREE.Float32BufferAttribute(b.emit, 1));
    g.computeBoundingSphere();
    tris += b.pos.length / 9;
    groups.push({
      tile: key.split("|")[0],
      tint: tints.get(key) ?? [1, 1, 1],
      geometry: g,
    });
  }
  return { groups, tris };
}

/**
 * A convex corner's quarter-cone: apex on the corner post at height `run`,
 * falling to the deck at radius `run`.
 *
 * This is the one patch real geometry does not give away, and it is the same
 * surface the distance field used to produce — `h = run - distanceToPost` — so
 * it meets each neighbouring 45 degree ramp tangentially along the quadrant's
 * two edges and no seam is possible.
 *
 * `dirY` is +1 for the deck's fold and -1 for the overhead's, which is the same
 * cone mirrored down from `base`.
 */
function fillet(
  b: Build,
  gx: number,
  gy: number,
  sx: number,
  sy: number,
  run: number,
  base: number,
  dirY: number,
  sh: Shade,
): void {
  const apex: Vec3 = [gx, base + run * dirY, gy];
  for (let k = 0; k < FILLET_SEGS; k++) {
    const t0 = (k / FILLET_SEGS) * (Math.PI / 2);
    const t1 = ((k + 1) / FILLET_SEGS) * (Math.PI / 2);
    const p0: Vec3 = [gx + sx * run * Math.cos(t0), base, gy + sy * run * Math.sin(t0)];
    const p1: Vec3 = [gx + sx * run * Math.cos(t1), base, gy + sy * run * Math.sin(t1)];
    // winding depends on the quadrant and on which way the cone points, so it
    // is settled by asking which way the normal came out rather than by cases
    const n = cross3(sub3(p0, apex), sub3(p1, apex));
    const uv0: [number, number] = [t0 / (Math.PI / 2), 0];
    const uv1: [number, number] = [t1 / (Math.PI / 2), 0];
    const uvA: [number, number] = [(t0 + t1) / Math.PI, 1];
    const ao: [number, number, number] = [AO_PROFILE[1], AO_PROFILE[0], AO_PROFILE[0]];
    if (n[1] * dirY > 0) tri(b, apex, p0, p1, uvA, uv0, uv1, sh, ao);
    else tri(b, apex, p1, p0, uvA, uv1, uv0, sh, ao);
  }
}
