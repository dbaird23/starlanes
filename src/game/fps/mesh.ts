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
 * ## The section is a moulding, not four planes
 *
 * `art-reference/damage/damage.png` is the clearest statement of it — the
 * near-field frames are unlit and read as silhouette. But what it shows is not
 * deck / ramp / wall / ramp / overhead as five flat surfaces. It shows a
 * **run of recessed bays between projecting structural frames**, and each of
 * those five surfaces has its own step in it:
 *
 * - the lower chamfer is a **bench**: a toe kick off the deck, a step back, the
 *   45 degree face proper, then a riser and a ledge where it meets the wall;
 * - the vertical face is a **recessed panel inside a raised border**, and the
 *   shadow line at that step is what says "panelling" rather than "picture";
 * - the upper chamfer is the bench mirrored — soffit ledge, riser, 45 degree
 *   face, return;
 * - the overhead is **coffered**, with a machinery/light run down its spine.
 *
 * So the profile is an eleven-segment polyline (`SECTION_*` below), not four
 * points, and three of those eleven segments are trays rather than planes. The
 * overall proportions are unchanged and are still the reference's: deck ~45% of
 * the corridor's width, chamfers at 45 degrees, a corridor about as wide as it
 * is tall. The relief lives *inside* those proportions.
 *
 * ## The bay frame is a ring, and it is a box section
 *
 * The single most characteristic thing in both references is a structural ring
 * every few metres that stands **proud into the corridor** — you see its return
 * face, and it occludes the panelling behind it as you walk past. `parseLevel`
 * promotes hull cells on the bay grid to `WALL.frame`; here that becomes the
 * whole eleven-segment profile pushed `RIB` toward the corridor centre, stepped
 * down to a half-depth collar at each end of the cell so the box has three
 * visible steps rather than one, and closed by returns at every step. The ring
 * is carried across the overhead by a beam (stepped the same way) and across the
 * deck by a threshold plate, so it is a *hoop* around the section rather than
 * two stripes on the side walls.
 *
 * ## Corners come out right because the geometry is real
 *
 * Every open cell face that abuts a solid emits the profile. That is all a
 * straight run needs, and it is *nearly* all a corner needs:
 *
 * - **Inside (concave) corners mitre themselves.** Two perpendicular profiles
 *   intersect, and the depth buffer keeps whichever is nearer — which is the
 *   mitre. Emit both and do nothing else.
 * - **Outside (convex) corners need a fillet**, because the two profiles stop at
 *   the corner's quadrant and nothing covers it. The patch is the **profile
 *   lathed about the corner post**: every point `(u, y)` swept through the
 *   quadrant at radius `u`. At 0 and 90 degrees that lands exactly on the two
 *   neighbouring strips' endpoints, so no seam is possible — and it is the
 *   generalisation of the quarter-cone this file used to emit, which was the
 *   lathe of a *straight* 45 degree line. The bench survives the corner because
 *   the corner is turned by the same moulding.
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
 */

import * as THREE from "three";
import {
  CEIL_GAIN,
  CEIL_TILE,
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

/** How far a bay frame's main face stands proud of the wall, in cells. */
const RIB = 0.15;
/** ...and its end collar, which is what gives the box its second step. */
const COLLAR = 0.45;
/** How much of each end of a frame cell the collar takes. */
const COLLAR_T = 0.16;

/** How far a recessed panel sits back from its border, in cells. */
const RECESS = 0.05;
/** The border around a recessed panel: across the cell, and along the profile. */
const TRAY_T = 0.11;
const TRAY_S = 0.14;

/** How far the overhead's coffer panels stand above the border, in cells. */
const COFFER = 0.055;
/** ...and how wide that border is. */
const COFFER_B = 0.17;
/** The machinery run down the middle of the overhead, as a share of the cell. */
const SPINE_W = 0.3;
/** A ring cell's deck threshold plate. */
const SILL = 0.035;

/** Steps in a convex corner's lathe. Six left the bench's rings visibly faceted. */
const FILLET_SEGS = 8;

/* ------------------------------------------------------- the light channel */

/**
 * The bay ring's light channel — the thing both references lead with.
 *
 * `corridors/corridor-lit.png` is read as four nested *octagons of light*
 * receding down the corridor, not as strips running the length of the walls:
 * every bay frame carries a channel that follows the section all the way round,
 * so what you see down a powered corridor is the cross-section repeated in
 * light. That is why this is geometry on the ring rather than a bright band in
 * a texture — the art direction's rule is that a strip on every chamfer is a
 * strip down no wall in particular, and the rhythm is the whole point.
 *
 * It runs from the bench's 45 degree face up over the vertical panel and back
 * down the upper chamfer's, stopping short of the deck and the overhead, and it
 * stands `STRIP_PROUD` off the ring's own face the way a diffuser sits in its
 * housing.
 */
const STRIP_W = 0.18;
const STRIP_PROUD = 0.012;
const STRIP_SEG0 = 2;
const STRIP_SEG1 = 8;
/**
 * How much of a light *fitting* each surface is: 1 for the ring's channel, less
 * for the overhead's spine, 0 for everything else.
 *
 * How hard one actually burns is deliberately not baked here — see
 * `STRIP_FLOOR` / `STRIP_SECTOR` in `glscene.ts`. Baked against the sector's own
 * light, a fitting could not respond to `uMinLight`, so the hook that raises the
 * whole ship to powered (`lightFloor`, and the reveal it stands in for)
 * brightened the walls and left every light strip in the level at its dead-ship
 * value. The rating is geometry; the wattage is lighting.
 */
const STRIP_MAT = "strip";
const STRIP_RATING = 1;
const SPINE_RATING = 0.55;

/* ------------------------------------------------------- the section profile */

/**
 * The bench's fractions, all measured against the chamfer's own run.
 *
 * `TOE_H === TOE_D` is not a coincidence and is worth keeping: it makes the
 * step above the toe kick land exactly where a 45 degree line from the foot
 * would have been, so the bench's slope is the reference's slope and the toe is
 * carved out of it rather than added on top.
 */
const TOE_H = 0.16;
const TOE_D = 0.16;
const LIP_W = 0.18;

/**
 * The octagon's profile at one grid corner, in `(u, y)` — `u` measured
 * **inward** from the wall plane, `y` up from the deck. Twelve points, eleven
 * segments, from the deck up:
 *
 * ```
 *  0-1 toe kick (vertical)      6-7  soffit ledge (faces down)
 *  1-2 toe top  (faces up)      7-8  riser
 *  2-3 bench, 45 degrees        8-9  45 degrees
 *  3-4 riser                    9-10 return (faces down)
 *  4-5 ledge    (faces up)     10-11 vertical
 *  5-6 the vertical face
 * ```
 *
 * `off` pushes the whole profile toward the corridor centre, which is how a bay
 * frame's ring is the same moulding 0.15 nearer.
 */
function section(c: number, ceil: number, off: number): [number, number][] {
  const top = Math.max(c + 0.02, ceil - c);
  const k = TOE_H * c;
  const s = TOE_D * c;
  const l = LIP_W * c;
  // the upper chamfer takes whatever height is actually left, which is `c`
  // everywhere `cornerFields` has done its job but need not be assumed
  const cu = ceil - top;
  const ku = TOE_H * cu;
  const su = TOE_D * cu;
  const lu = LIP_W * cu;
  return [
    [off + c, 0],
    [off + c, k],
    [off + c - s, k],
    [off + l, c - l],
    [off + l, c],
    [off, c],
    [off, top],
    [off + lu, top],
    [off + lu, top + lu],
    [off + cu - su, ceil - ku],
    [off + cu, ceil - ku],
    [off + cu, ceil],
  ];
}

/** Which band of the section a segment belongs to, and how it is lit. */
interface SegDef {
  /** 0 lower chamfer, 1 vertical face, 2 upper chamfer */
  band: 0 | 1 | 2;
  /** multiplier on the band's dress gain — the facets of the moulding */
  mul: number;
  /** a recessed panel inside a raised border, rather than a plane */
  tray: boolean;
}

const SEGS: SegDef[] = [
  { band: 0, mul: 0.86, tray: false },
  { band: 0, mul: 1.12, tray: false },
  { band: 0, mul: 1.0, tray: true },
  { band: 0, mul: 0.8, tray: false },
  { band: 0, mul: 1.08, tray: false },
  { band: 1, mul: 1.0, tray: true },
  { band: 2, mul: 0.7, tray: false },
  { band: 2, mul: 0.95, tray: false },
  { band: 2, mul: 1.0, tray: true },
  { band: 2, mul: 0.72, tray: false },
  { band: 2, mul: 1.18, tray: false },
];

/**
 * Per **segment**, the tile coordinate at each of its ends, as a fraction of
 * its band's own arc length — and the crease occlusion there.
 *
 * Per segment and not per point, because points 5 and 6 each belong to two
 * bands: point 5 is the top of the lower chamfer's tile *and* the bottom of the
 * wall's, and a table indexed by point can only hold one of the two. Held that
 * way it silently wrote 0 over the 1, the whole vertical face came out with a
 * constant `v`, and every wall in the level was one row of texels stretched
 * from deck to overhead.
 *
 * Every point of the profile is a fixed multiple of its band's run, so these
 * fractions are the same whatever the run is — which is what lets one table
 * serve both chamfers and every sector. They are computed rather than typed so
 * they cannot drift from `TOE_H`/`TOE_D`/`LIP_W`.
 *
 * The occlusion is the same story told once: the octagon is a tube, so every
 * one of its folds is concave seen from inside and what differs is how much sky
 * each one can see. The creases against the deck and the overhead are the
 * tightest, the middle of the vertical face the most open. There is no shadow of
 * any kind in this renderer — one lamp at the eye, no shadow map — and without
 * *some* crease darkening a metal tube lit from its own axis comes out as
 * flawless plastic.
 */
const { SEG_V0, SEG_V1, SEG_AO0, SEG_AO1 } = (() => {
  const p = section(1, 3, 0); // c = 1, top = 2, so cu = 1 as well
  const len = (i: number): number =>
    Math.hypot(p[i + 1][0] - p[i][0], p[i + 1][1] - p[i][1]);
  const v0 = new Array<number>(11).fill(0);
  const v1 = new Array<number>(11).fill(0);
  const ao0 = new Array<number>(11).fill(1);
  const ao1 = new Array<number>(11).fill(1);
  // deck crease, lower fold, upper fold, overhead crease
  const key = [0.6, 0.9, 0.84, 0.52];
  const bands: [number, number, number, number][] = [
    [0, 5, key[0], key[1]],
    [5, 6, key[1], key[2]],
    [6, 11, key[2], key[3]],
  ];
  for (const [a, b, aoA, aoB] of bands) {
    let total = 0;
    for (let i = a; i < b; i++) total += len(i);
    let run = 0;
    for (let i = a; i < b; i++) {
      v0[i] = run / (total || 1);
      run += len(i);
      v1[i] = run / (total || 1);
      ao0[i] = aoA + (aoB - aoA) * v0[i];
      ao1[i] = aoA + (aoB - aoA) * v1[i];
    }
  }
  return { SEG_V0: v0, SEG_V1: v1, SEG_AO0: ao0, SEG_AO1: ao1 };
})();

/** ...and how much a surface standing proud of the wall gets back. */
const AO_RIB_FRONT = 0.98;
const AO_RIB_RETURN = 0.55;
/** A step's own riser is the shadow line, and it wants to read as one. */
const AO_STEP = 0.5;

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
  strip: number[];
}

function newBuild(): Build {
  return { pos: [], nrm: [], uv: [], light: [], gain: [], emit: [], strip: [] };
}

type Vec3 = [number, number, number];
type Vec2 = [number, number];

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
  /**
   * An **authored** light fitting, as opposed to `emit`, which is keyed off
   * whichever pixels of the tile happen to be bright.
   *
   * Keying works for the door's hazard band, where the bright pixels genuinely
   * are the thing that should burn. It cannot state a light *strip*, because
   * every one of these tiles is a pale photograph and a threshold low enough to
   * find the fitting also finds the whole housing round it — the art direction's
   * "a strip down every wall is a strip down no wall in particular". So the
   * strips in `corridors/corridor-lit.png` are geometry (see the ring below),
   * and this says the surface *is* the light: uniform over its own quad,
   * unfogged, coloured by the material's own `glow`.
   */
  strip?: number;
}

function tri(
  b: Build,
  p0: Vec3,
  p1: Vec3,
  p2: Vec3,
  uv0: Vec2,
  uv1: Vec2,
  uv2: Vec2,
  sh: Shade,
  ao: [number, number, number] = [1, 1, 1],
): void {
  const c = cross3(sub3(p1, p0), sub3(p2, p0));
  // a moulding lathed about a corner post closes on itself, so its last ring is
  // a point and its last quad is a triangle; a zero-area triangle would take a
  // zero normal and paint a black crease exactly where the fold should be
  if (Math.hypot(c[0], c[1], c[2]) < 1e-9) return;
  const n = norm3(c);
  const ps = [p0, p1, p2];
  const us = [uv0, uv1, uv2];
  for (let i = 0; i < 3; i++) {
    b.pos.push(ps[i][0], ps[i][1], ps[i][2]);
    b.nrm.push(n[0], n[1], n[2]);
    b.uv.push(us[i][0], us[i][1]);
    b.light.push(sh.light);
    b.gain.push(sh.gain * ao[i]);
    b.emit.push(sh.emit);
    b.strip.push(sh.strip ?? 0);
  }
}

/** Wound counter-clockwise seen from the front, so the normal falls out of it. */
function quad(
  b: Build,
  p0: Vec3,
  p1: Vec3,
  p2: Vec3,
  p3: Vec3,
  uv0: Vec2,
  uv1: Vec2,
  uv2: Vec2,
  uv3: Vec2,
  sh: Shade,
  ao: [number, number, number, number] = [1, 1, 1, 1],
): void {
  tri(b, p0, p1, p2, uv0, uv1, uv2, sh, [ao[0], ao[1], ao[2]]);
  tri(b, p0, p2, p3, uv0, uv2, uv3, sh, [ao[0], ao[2], ao[3]]);
}

/**
 * ...or wound whichever way puts the normal on the side asked for.
 *
 * A moulding with steps in it emits a lot of little risers, and working out the
 * winding of each one by hand against the frame's handedness is how a face ends
 * up culled and a black slot appears in the middle of a wall. Every riser in
 * this file says which way it should face and lets the builder settle it.
 */
function quadFacing(
  b: Build,
  want: Vec3,
  p0: Vec3,
  p1: Vec3,
  p2: Vec3,
  p3: Vec3,
  uv0: Vec2,
  uv1: Vec2,
  uv2: Vec2,
  uv3: Vec2,
  sh: Shade,
  ao: [number, number, number, number] = [1, 1, 1, 1],
): void {
  /*
   * The facing is read off **both** triangles, not the first one.
   *
   * A moulding lathed about a corner post has rings of radius zero — the top
   * ledge starts *at* the post — so its first quad is a cone apex whose leading
   * triangle is degenerate and whose cross product is the zero vector. Tested
   * on that alone the dot product is 0, `d >= 0` keeps whatever winding it was
   * handed, and the one real triangle of the fan comes out inside-out: a
   * hairline wedge of clear colour at the top of every convex corner in the
   * level. Summing the two is the usual planar-quad normal and is nonzero
   * whenever either half has area.
   */
  const na = cross3(sub3(p1, p0), sub3(p2, p0));
  const nb = cross3(sub3(p2, p0), sub3(p3, p0));
  const n: Vec3 = [na[0] + nb[0], na[1] + nb[1], na[2] + nb[2]];
  const d = n[0] * want[0] + n[1] * want[1] + n[2] * want[2];
  if (d >= 0) quad(b, p0, p1, p2, p3, uv0, uv1, uv2, uv3, sh, ao);
  else {
    quad(b, p3, p2, p1, p0, uv3, uv2, uv1, uv0, sh, [ao[3], ao[2], ao[1], ao[0]]);
  }
}

/* ------------------------------------------------------------------- output */

/** One texture's worth of the level, ready to become a `THREE.Mesh`. */
export interface MeshGroup {
  /** file under `public/fps/` */
  tile: string;
  /** key into `TILE_MAT` — how it is *lit*, which is not always the tile */
  mat: string;
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

/* ------------------------------------------------------------------- frames */

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

function lerp2(a: Vec2, b: Vec2, k: number): Vec2 {
  return [a[0] + (b[0] - a[0]) * k, a[1] + (b[1] - a[1]) * k];
}

/**
 * The direction a profile segment faces, in the `(u, y)` plane, pointing into
 * the corridor. `(dy, -du)` because the profile is walked from the deck up and
 * the corridor is always on its left.
 */
function segNormal2(a: Vec2, b: Vec2): Vec2 {
  const du = b[0] - a[0];
  const dy = b[1] - a[1];
  const l = Math.hypot(du, dy) || 1;
  return [dy / l, -du / l];
}

/* -------------------------------------------------------------------- build */

/**
 * Build the whole level's geometry, grouped by texture.
 *
 * Static: this runs once when the session opens, and the result is uploaded to
 * the GPU and left alone. The derelict's 24x24 deck comes out around sixty
 * thousand triangles in nine draw calls, which for geometry that is never
 * touched again is nothing.
 */
export function buildLevelMesh(lvl: FpsLevel): LevelMesh {
  const { w, h, cells, sectorOf, sectors } = lvl;
  const cw = w + 1;
  const { run: cRun, ceil: cCeil } = cornerFields(lvl);

  const builds = new Map<string, Build>();
  const tints = new Map<string, [number, number, number]>();
  const mats = new Map<string, string>();
  /**
   * `mat` names the entry in `TILE_MAT` this group is lit as, and defaults to
   * the tile. It exists because two surfaces can share a texture and not share a
   * *material*: the ring's light channel is drawn on the trim tile, but the trim
   * is polished metal and a channel's diffuser is not — lit as metal, the strip
   * caught a specular lobe the size of itself and read as a flat grey band
   * rather than as a light that happens to be switched off.
   */
  const get = (
    tile: string,
    tint?: [number, number, number],
    mat?: string,
  ): Build => {
    const key = `${tile}|${tint ? tint.join(",") : ""}|${mat ?? ""}`;
    let b = builds.get(key);
    if (!b) {
      b = newBuild();
      builds.set(key, b);
      tints.set(key, tint ?? [1, 1, 1]);
      mats.set(key, mat ?? tile);
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
  /**
   * The overhead's structural height at a point inside a cell, bilinear over
   * the four grid corners. Restricted to a cell edge a bilinear patch is
   * *linear* in the two corners that edge runs between, and both cells sharing
   * that edge read the same two — which is what makes an overhead that ramps
   * from the corridors' 1.2 to the reactor bay's 1.9 watertight across it.
   */
  const ceilAt = (cx: number, cy: number, a: number, bq: number): number =>
    cCeil[cy * cw + cx] * (1 - a) * (1 - bq) +
    cCeil[cy * cw + cx + 1] * a * (1 - bq) +
    cCeil[(cy + 1) * cw + cx] * (1 - a) * bq +
    cCeil[(cy + 1) * cw + cx + 1] * a * bq;

  /*
   * Which way the space through each cell runs — the corridor's own axis.
   *
   * The overhead's machinery spine has to run *down* a corridor and not across
   * it, and a beam has to run across one and not down it. Both fall out of
   * whether the open run through the cell is longer in x or in z.
   */
  const alongX = new Uint8Array(w * h);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      if (cells[y * w + x] !== 0) continue;
      let rx = 1;
      for (let i = x - 1; i >= 0 && cells[y * w + i] === 0; i--) rx++;
      for (let i = x + 1; i < w && cells[y * w + i] === 0; i++) rx++;
      let rz = 1;
      for (let i = y - 1; i >= 0 && cells[i * w + x] === 0; i--) rz++;
      for (let i = y + 1; i < h && cells[i * w + x] === 0; i++) rz++;
      alongX[y * w + x] = rx >= rz ? 1 : 0;
    }
  }

  /*
   * The overhead's and the deck's share of the bay ring.
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

  /* ------------------------------------------------------- one wall section */

  /**
   * The eleven-segment moulding across one cell face.
   *
   * `off` is how far the whole profile stands proud (a bay frame's ring), and
   * `tray` says whether the three panelled segments get their recess. A frame's
   * ring is solid trim, so it does not.
   */
  const wallStrip = (
    f: Frame,
    pa: Vec2[],
    pb: Vec2[],
    t0: number,
    t1: number,
    tiles: { face: string; bevel: string; bench: string },
    dressGain: [number, number, number],
    faceRepeat: number,
    uOff: number,
    sh: { light: number; emit: number },
    trays: boolean,
    aoScale: number,
  ): void => {
    /*
     * How far the face tile runs vertically, so its texels come out square
     * against the `faceRepeat` it is already running at horizontally.
     */
    const faceArc =
      (Math.hypot(pa[6][0] - pa[5][0], pa[6][1] - pa[5][1]) +
        Math.hypot(pb[6][0] - pb[5][0], pb[6][1] - pb[5][1])) /
      2;
    /*
     * `u` runs `rep * (t1 - t0)` over `t1 - t0` cells of corridor, so world per
     * unit of u is `1 / rep` whatever span this strip covers — the ring's
     * collars included. Dividing by the span, which the first cut did, squared
     * the full-cell strips correctly and stretched every sub-span of a bay.
     */
    const faceV = Math.max(0.25, faceArc * faceRepeat);
    for (let i = 0; i < SEGS.length; i++) {
      const seg = SEGS[i];
      // band 0 is the bench, 1 the vertical face, 2 the soffit — three tiles,
      // because the bench carries services and the soffit above it cannot
      const tile = seg.band === 1 ? tiles.face : seg.band === 0 ? tiles.bench : tiles.bevel;
      const b = get(tile);
      const rep = seg.band === 1 ? faceRepeat : 1;
      const gain = dressGain[seg.band] * seg.mul;
      const shade: Shade = { light: sh.light, gain, emit: sh.emit };
      const ao0 = SEG_AO0[i] * aoScale;
      const ao1 = SEG_AO1[i] * aoScale;
      /*
       * **The vertical face's tile is squared up; the chamfers' are not, and
       * that asymmetry is deliberate.**
       *
       * Every band normalises `v` to 0..1 over its own arc, which fits the
       * tile to the band exactly and distorts it by whatever the band's aspect
       * happens to be. On the face that was measured at 1.8:1 — panels half
       * again as tall as they are wide, over the second largest textured
       * surface in the level — and `wall-main` is a seamless square tile, so
       * it can simply run past 1.0 and tile. The chamfer tiles cannot: they
       * are 3:1 *crops*, tiling left to right only, and their whole height is
       * meant to land across the slope. They measure 1.33:1 in texel terms
       * once the crop's own 3:1 is taken out, which is close enough to leave.
       */
      const v0 = SEG_V0[i];
      const v1 = seg.band === 1 ? SEG_V0[i] + (SEG_V1[i] - SEG_V0[i]) * faceV : SEG_V1[i];
      const uA = uOff + rep * t0;
      const uB = uOff + rep * t1;

      if (!trays || !seg.tray) {
        quad(
          b,
          at(f, t0, pa[i][0], pa[i][1]),
          at(f, t1, pb[i][0], pb[i][1]),
          at(f, t1, pb[i + 1][0], pb[i + 1][1]),
          at(f, t0, pa[i + 1][0], pa[i + 1][1]),
          [uA, v0],
          [uB, v0],
          [uB, v1],
          [uA, v1],
          shade,
          [ao0, ao0, ao1, ao1],
        );
        continue;
      }

      /*
       * A tray: a raised border with a recessed panel inside it.
       *
       * One step is enough — it is the shadow line at the step that does the
       * work, and the reference's panelling is exactly one step back from its
       * frame. The recess is taken along the *segment's own* normal rather than
       * along the wall's, so the bench's 45 degree face gets a panel that sinks
       * into the bench instead of sideways through it.
       */
      const nrmA = segNormal2(pa[i], pa[i + 1]);
      const nrmB = segNormal2(pb[i], pb[i + 1]);
      const P = (t: number, s: number, sink: number): Vec3 => {
        const a = lerp2(pa[i], pa[i + 1], s);
        const bp = lerp2(pb[i], pb[i + 1], s);
        const p = lerp2(a, bp, t);
        const nr = lerp2(nrmA, nrmB, t);
        return at(f, t0 + (t1 - t0) * t, p[0] - nr[0] * sink, p[1] - nr[1] * sink);
      };
      const UV = (t: number, s: number): Vec2 => [
        uA + (uB - uA) * t,
        v0 + (v1 - v0) * s,
      ];
      const A = (s: number): number => ao0 + (ao1 - ao0) * s;
      const t0b = TRAY_T;
      const t1b = 1 - TRAY_T;
      const s0b = TRAY_S;
      const s1b = 1 - TRAY_S;

      const plate = (
        ta: number,
        tb2: number,
        sa: number,
        sb2: number,
        sink: number,
      ): void => {
        quad(
          b,
          P(ta, sa, sink),
          P(tb2, sa, sink),
          P(tb2, sb2, sink),
          P(ta, sb2, sink),
          UV(ta, sa),
          UV(tb2, sa),
          UV(tb2, sb2),
          UV(ta, sb2),
          shade,
          [A(sa), A(sa), A(sb2), A(sb2)],
        );
      };
      // border, at the wall plane
      plate(0, 1, 0, s0b, 0);
      plate(0, 1, s1b, 1, 0);
      plate(0, t0b, s0b, s1b, 0);
      plate(t1b, 1, s0b, s1b, 0);
      // the panel, one step back
      plate(t0b, t1b, s0b, s1b, RECESS);

      // ...and the four risers between them, which are the shadow line
      const step: Shade = { ...shade, gain: shade.gain * AO_STEP };
      const tangent = norm3(sub3(P(0.5, 1, 0), P(0.5, 0, 0)));
      const sDir: Vec3 = [f.s[0], f.s[1], f.s[2]];
      const neg = (v: Vec3): Vec3 => [-v[0], -v[1], -v[2]];
      quadFacing(
        b, tangent,
        P(t0b, s0b, 0), P(t1b, s0b, 0), P(t1b, s0b, RECESS), P(t0b, s0b, RECESS),
        UV(t0b, s0b), UV(t1b, s0b), UV(t1b, s0b), UV(t0b, s0b), step,
      );
      quadFacing(
        b, neg(tangent),
        P(t0b, s1b, 0), P(t1b, s1b, 0), P(t1b, s1b, RECESS), P(t0b, s1b, RECESS),
        UV(t0b, s1b), UV(t1b, s1b), UV(t1b, s1b), UV(t0b, s1b), step,
      );
      quadFacing(
        b, sDir,
        P(t0b, s0b, 0), P(t0b, s1b, 0), P(t0b, s1b, RECESS), P(t0b, s0b, RECESS),
        UV(t0b, s0b), UV(t0b, s1b), UV(t0b, s1b), UV(t0b, s0b), step,
      );
      quadFacing(
        b, neg(sDir),
        P(t1b, s0b, 0), P(t1b, s1b, 0), P(t1b, s1b, RECESS), P(t1b, s0b, RECESS),
        UV(t1b, s0b), UV(t1b, s1b), UV(t1b, s1b), UV(t1b, s0b), step,
      );
    }
  };

  /* --------------------------------------------------------------- the deck */

  for (let cy = 0; cy < h; cy++) {
    for (let cx = 0; cx < w; cx++) {
      const ci = cy * w + cx;
      if (cells[ci] !== 0) continue;
      const sec = sectors[sectorOf[ci]];
      const light = sec.light;
      const frameDress = dressOf(WALL.frame);
      const ringEmit = frameDress.emit + frameDress.emitSector * light;

      const deckAo: [number, number, number, number] = [
        cornerAo(cx, cy, 0.1),
        cornerAo(cx, cy + 1, 0.1),
        cornerAo(cx + 1, cy + 1, 0.1),
        cornerAo(cx + 1, cy, 0.1),
      ];

      /*
       * **Which way round the deck and the overhead lie.**
       *
       * Both tiles have a feature with a direction in it — the deck a walkway
       * worn down its middle, the overhead a machinery spine — and laid down in
       * world space a direction runs along the corridor for half a deck and
       * straight across it for the other half, so half the level had a runner
       * you walked over rather than along. `alongX` already knows which way each
       * cell runs; the uv is turned to match.
       *
       * The two tiles are drawn with their runs on **opposite axes** (the
       * runner is a horizontal band, the spine a vertical one), so these two
       * mappers are each other's inverse and not the same swap.
       */
      const runX = alongX[ci] === 1;
      const deckUv = (a: number, b: number): Vec2 =>
        runX ? [cx + a, cy + b] : [cy + b, cx + a];
      const ceilUv = (a: number, b: number): Vec2 =>
        runX ? [cy + b, cx + a] : [cx + a, cy + b];

      /*
       * The deck: one plate to the cell, seams and centre runner included —
       * except under a bay ring, where a threshold plate stands slightly proud
       * and closes the hoop against the deck. The references put one under
       * every frame and it is what stops the ring reading as two stripes on the
       * side walls.
       */
      if (!ring[ci]) {
        quad(
          get(DECK_TILE),
          [cx, 0, cy],
          [cx, 0, cy + 1],
          [cx + 1, 0, cy + 1],
          [cx + 1, 0, cy],
          deckUv(0, 0),
          deckUv(0, 1),
          deckUv(1, 1),
          deckUv(1, 0),
          { light, gain: DECK_GAIN, emit: 0 },
          deckAo,
        );
      } else {
        // the sill runs across the corridor, so it steps along the corridor
        const stepX = ringAxis[ci] !== 1;
        const e = COLLAR_T;
        const bands: [number, number, number][] = [
          [0, e, 0],
          [e, 1 - e, SILL],
          [1 - e, 1, 0],
        ];
        const deckPt = (a: number, y: number, bnd: number): Vec3 =>
          stepX ? [cx + a, y, cy + bnd] : [cx + bnd, y, cy + a];
        for (const [a0, a1, rise] of bands) {
          quadFacing(
            get(DECK_TILE),
            [0, 1, 0],
            deckPt(a0, rise, 0),
            deckPt(a0, rise, 1),
            deckPt(a1, rise, 1),
            deckPt(a1, rise, 0),
            [cx + a0, cy],
            [cx + a0, cy + 1],
            [cx + a1, cy + 1],
            [cx + a1, cy],
            { light, gain: DECK_GAIN * (rise > 0 ? 1.06 : 0.9), emit: 0 },
            deckAo,
          );
        }
        const trimB = get(frameDress.ribTile);
        for (const [a, sgn] of [[e, -1], [1 - e, 1]] as const) {
          // each riser faces away from the raised centre of the sill
          const want: Vec3 = stepX ? [sgn, 0, 0] : [0, 0, sgn];
          quadFacing(
            trimB,
            want,
            deckPt(a, 0, 0),
            deckPt(a, 0, 1),
            deckPt(a, SILL, 1),
            deckPt(a, SILL, 0),
            [0, 0],
            [1, 0],
            [1, 1],
            [0, 1],
            { light, gain: DECK_GAIN * 0.7, emit: ringEmit * 0.35 },
          );
        }
      }

      /* ------------------------------------------------------ the overhead */

      /** bilinear overhead height, `a` across x, `bq` across z */
      const ceilAtCell = (a: number, bq: number): number => ceilAt(cx, cy, a, bq);
      const ceilAo: [number, number, number, number] = [
        cornerAo(cx, cy, 0.13),
        cornerAo(cx + 1, cy, 0.13),
        cornerAo(cx + 1, cy + 1, 0.13),
        cornerAo(cx, cy + 1, 0.13),
      ];
      const ceilTint = get(CEIL_TILE, CEIL_TINT);

      /** a horizontal patch of overhead at `drop` below the bilinear height */
      const soffit = (
        b: Build,
        a0: number,
        a1: number,
        b0: number,
        b1: number,
        drop: number,
        sh: Shade,
        uv?: [Vec2, Vec2, Vec2, Vec2],
      ): void => {
        const p = (a: number, bq: number): Vec3 => [
          cx + a,
          ceilAtCell(a, bq) - drop,
          cy + bq,
        ];
        quad(
          b,
          p(a0, b0),
          p(a1, b0),
          p(a1, b1),
          p(a0, b1),
          uv?.[0] ?? ceilUv(a0, b0),
          uv?.[1] ?? ceilUv(a1, b0),
          uv?.[2] ?? ceilUv(a1, b1),
          uv?.[3] ?? ceilUv(a0, b1),
          sh,
          ceilAo,
        );
      };
      /** ...and a riser between two of them */
      const riser = (
        b: Build,
        a0: number,
        b0: number,
        a1: number,
        b1: number,
        dropLo: number,
        dropHi: number,
        want: Vec3,
        sh: Shade,
      ): void => {
        const p = (a: number, bq: number, d: number): Vec3 => [
          cx + a,
          ceilAtCell(a, bq) - d,
          cy + bq,
        ];
        /*
         * Same rule as the ring's returns: a coffer riser is `COFFER` (0.055)
         * of a cell deep, and given `v` 0..1 it wore a whole ceiling tile
         * across that sliver — a p90 anisotropy of 12 on the one surface of
         * the overhead you see edge-on. The overhead runs at one tile to the
         * cell, so its uv *is* world distance and both extents can be taken
         * straight off the geometry.
         */
        const run = Math.hypot(a1 - a0, b1 - b0);
        const vExt = Math.abs(dropHi - dropLo);
        quadFacing(
          b,
          want,
          p(a0, b0, dropLo),
          p(a1, b1, dropLo),
          p(a1, b1, dropHi),
          p(a0, b0, dropHi),
          [0, 0],
          [run, 0],
          [run, vExt],
          [0, vExt],
          sh,
        );
      };

      if (ring[ci]) {
        /*
         * The ring's beam. It steps like the frame's box section does — a
         * half-depth collar at each end and the full drop between them — so the
         * hoop's silhouette is the same three steps overhead as it is on the
         * wall.
         */
        const trimB = get(frameDress.ribTile);
        const beamShade: Shade = {
          light,
          gain: CEIL_GAIN * 1.25,
          emit: ringEmit,
        };
        const stepX = ringAxis[ci] !== 1;
        const e = COLLAR_T;
        const spans: [number, number, number][] = [
          [0, e, RIB * COLLAR],
          [e, 1 - e, RIB],
          [1 - e, 1, RIB * COLLAR],
        ];
        for (const [a0, a1, drop] of spans) {
          const uv: [Vec2, Vec2, Vec2, Vec2] = stepX
            ? [[a0, 0], [a1, 0], [a1, 1], [a0, 1]]
            : [[0, a0], [0, a1], [1, a1], [1, a0]];
          if (stepX) soffit(trimB, a0, a1, 0, 1, drop, beamShade, uv);
          else soffit(trimB, 0, 1, a0, a1, drop, beamShade, uv);
        }
        for (const [a, sgn] of [[e, -1], [1 - e, 1]] as const) {
          // each riser faces away from the deep centre of the beam, exactly as
          // the sill's do — flipped, it is a hole in the overhead the size of a
          // bay, because a 0.08 step seen along the ceiling covers a lot of frame
          const want: Vec3 = stepX ? [sgn, 0, 0] : [0, 0, sgn];
          if (stepX) riser(trimB, a, 0, a, 1, RIB * COLLAR, RIB, want, {
            ...beamShade,
            gain: beamShade.gain * 0.72,
          });
          else riser(trimB, 0, a, 1, a, RIB * COLLAR, RIB, want, {
            ...beamShade,
            gain: beamShade.gain * 0.72,
          });
        }
        /*
         * ...and the hoop closes overhead: the same channel across the beam,
         * so a bay reads as a complete ring of light rather than as two bars on
         * the side walls with a gap where the ceiling is.
         */
        {
          const g0 = 0.5 - STRIP_W / 2;
          const g1 = 0.5 + STRIP_W / 2;
          const glow: Shade = {
            light,
            gain: CEIL_GAIN * 0.3,
            emit: 0,
            strip: STRIP_RATING,
          };
          const uv: [Vec2, Vec2, Vec2, Vec2] = stepX
            ? [[g0, 0], [g1, 0], [g1, 1], [g0, 1]]
            : [[0, g0], [0, g1], [1, g1], [1, g0]];
          const glowB = get(frameDress.stripTile, undefined, STRIP_MAT);
          if (stepX) soffit(glowB, g0, g1, 0, 1, RIB + STRIP_PROUD, glow, uv);
          else soffit(glowB, 0, 1, g0, g1, RIB + STRIP_PROUD, glow, uv);
        }
        /*
         * The beam's ends are closed by `stitchEdges` below rather than here.
         * A cap emitted from inside the cell can only state one depth across
         * the whole edge, and the beam's depth *varies* along two of its four
         * edges — so the old constant-`RIB * COLLAR` cap left an 0.083 slit
         * wherever the beam's deep centre met a neighbour, which is what you
         * could see the stars through when you looked up.
         */
      } else {
        /*
         * A coffered overhead: a border at the structural height, two raised
         * panels, and the machinery run down the middle at the border's own
         * height so it carries through from cell to cell.
         *
         * The references' ceilings are never a smooth plane — left flat this
         * read as a void hanging over the corridor even with the plate on it.
         */
        const bd = COFFER_B;
        const sp0 = 0.5 - SPINE_W / 2;
        const sp1 = 0.5 + SPINE_W / 2;
        /*
         * The overhead is the darkest surface in the section by design, so the
         * coffer has to state itself in the *ratio* between its border and its
         * panels rather than by lifting the whole ceiling: raise `CEIL_GAIN` far
         * enough to see the step and a dead compartment stops reading as dead.
         */
        const border: Shade = { light, gain: CEIL_GAIN * 0.82, emit: 0 };
        const panel: Shade = { light, gain: CEIL_GAIN * 1.55, emit: 0 };
        soffit(ceilTint, 0, 1, 0, bd, 0, border);
        soffit(ceilTint, 0, 1, 1 - bd, 1, 0, border);
        soffit(ceilTint, 0, bd, bd, 1 - bd, 0, border);
        soffit(ceilTint, 1 - bd, 1, bd, 1 - bd, 0, border);

        // the two coffer panels, either side of the spine
        const boxes: [number, number, number, number][] = runX
          ? [
              [bd, 1 - bd, bd, sp0],
              [bd, 1 - bd, sp1, 1 - bd],
            ]
          : [
              [bd, sp0, bd, 1 - bd],
              [sp1, 1 - bd, bd, 1 - bd],
            ];
        for (const [a0, a1, b0, b1] of boxes) {
          if (a1 - a0 < 1e-3 || b1 - b0 < 1e-3) continue;
          soffit(ceilTint, a0, a1, b0, b1, -COFFER, panel);
          const dim: Shade = { ...panel, gain: panel.gain * AO_STEP };
          /*
           * A coffer panel is `COFFER` **above** the border, so the box is a
           * recess up into the overhead and its four risers are that recess's
           * *inside* walls: each one faces in toward the panel above it, not out
           * toward the border. Wound the other way round — which is how they
           * shipped — every one of them is a backface, and a whole ceiling's
           * worth of them is the black slots that appeared in a lit overhead as
           * soon as `lightFloor` came up.
           */
          riser(ceilTint, a0, b0, a1, b0, 0, -COFFER, [0, 0, 1], dim);
          riser(ceilTint, a0, b1, a1, b1, 0, -COFFER, [0, 0, -1], dim);
          riser(ceilTint, a0, b0, a0, b1, 0, -COFFER, [1, 0, 0], dim);
          riser(ceilTint, a1, b0, a1, b1, 0, -COFFER, [-1, 0, 0], dim);
        }
        // the spine itself, on the trim so it can carry a light run
        /*
         * The navy reference's other light source: warm panels down the middle
         * of the overhead. Authored rather than keyed, for the same reason the
         * ring's channel is — and scaled almost entirely by the sector, because
         * a ceiling panel is a fitting and this ship's fittings are out.
         */
        const spineShade: Shade = {
          light,
          gain: CEIL_GAIN * 1.5,
          emit: 0,
          strip: SPINE_RATING,
        };
        const trimB = get(frameDress.stripTile, undefined, STRIP_MAT);
        if (runX) {
          soffit(trimB, bd, 1 - bd, sp0, sp1, 0, spineShade, [
            [bd, 0],
            [1 - bd, 0],
            [1 - bd, 1],
            [bd, 1],
          ]);
        } else {
          soffit(trimB, sp0, sp1, bd, 1 - bd, 0, spineShade, [
            [0, bd],
            [0, 1 - bd],
            [1, 1 - bd],
            [1, bd],
          ]);
        }
      }

      /* ---------------------------------------------- the four wall sections */
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
        const pa = section(runA, ceilA, 0);
        const pb = section(runB, ceilB2, 0);

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
        const faceTile = useAlt && dress.faceAlt ? dress.faceAlt : dress.face;
        const bevelTile = useAlt && dress.bevelAlt ? dress.bevelAlt : dress.bevel;
        const emit = dress.emit + dress.emitSector * light;
        /*
         * A frame's plain profile is the *recess* behind the ring and is dressed
         * as hull, so it must not carry the ring's emission — keyed off the
         * tile's own bright pixels, `wall-main` is bright everywhere and the
         * whole wall would light up at every bay.
         */
        const plainEmit = dress.rib > 0 ? 0 : emit;
        const uOff = (variant % 4) / 4;
        const gains: [number, number, number] = [
          dress.gainLower,
          dress.gainFace,
          dress.gainUpper,
        ];

        /*
         * A bay frame emits no plain profile at all.
         *
         * Its ring is the same moulding standing `RIB` nearer, spanning the
         * whole cell and capped at both ends, so from anywhere inside the
         * corridor it completely occludes the wall plane behind it. Emitting
         * both was a full cell of overdraw at every bay for a surface that
         * cannot be seen.
         */
        if (dress.rib === 0) {
          wallStrip(
            f,
            pa,
            pb,
            0,
            1,
            {
              face: faceTile,
              bevel: bevelTile,
              bench: useAlt && dress.benchAlt ? dress.benchAlt : dress.bench,
            },
            gains,
            dress.faceRepeat,
            uOff,
            { light, emit: plainEmit },
            true,
            1,
          );
        }

        /* ---- and the ring, if this wall is a bay frame */
        if (dress.rib > 0) {
          /*
           * A box section, in three steps.
           *
           * The reference's frames are not a single plane standing proud: there
           * is a collar at each end, then the frame proper, and you read the
           * depth off those two returns as you walk past. The ring gets a
           * *flatter* brightness staircase than the wall behind it — the
           * section's 1.0 / 0.68 / 0.34 applied to the ring broke it into three
           * unrelated bright patches, a lit bench and a black soffit rather than
           * one piece of structure hooping the corridor.
           */
          /*
           * Knocked down from 0.95 / 0.84 / 0.66. Under a real lamp the ring is
           * the nearest thing to it and the only metal in the section, so at the
           * old values the frames came out as the brightest surfaces in a *dead*
           * compartment — a corridor hooped in lit white bands, which reads as
           * powered. In damage/damage.png the frames are structure catching what
           * light there is, and the recesses behind them are darker still.
           */
          const ringGains: [number, number, number] = [0.78, 0.64, 0.48];
          // the ring is one material all the way round its own profile
          const trim = {
            face: dress.ribTile,
            bevel: dress.ribTile,
            bench: dress.ribTile,
          };
          const e = COLLAR_T;
          const depths: [number, number, number][] = [
            [0, e, RIB * COLLAR],
            [e, 1 - e, RIB],
            [1 - e, 1, RIB * COLLAR],
          ];
          const profs = new Map<number, [Vec2[], Vec2[]]>();
          for (const [, , d] of depths) {
            if (!profs.has(d)) {
              profs.set(d, [section(runA, ceilA, d), section(runB, ceilB2, d)]);
            }
          }
          profs.set(0, [pa, pb]);
          for (const [t0, t1, d] of depths) {
            const [qa, qb] = profs.get(d)!;
            /*
             * **Interpolated to this span's own ends, not the cell's.**
             *
             * `qa`/`qb` are the moulding at the face's two *grid corners*, and
             * the run differs between them wherever a neighbouring space is
             * narrower — which is most junctions. Handing them to a strip that
             * only covers `t0..t1` planted the far corner's profile at `t = e`,
             * so the collar and the frame proper described different octagons
             * and the step between them was open: a wedge of clear colour at
             * every bay of every wall whose two ends disagree. The returns
             * below already did this correctly, which is why the crack sat on
             * the collar line rather than at the frame's ends.
             */
            wallStrip(
              f,
              lerpProfile(qa, qb, t0),
              lerpProfile(qa, qb, t1),
              t0,
              t1,
              trim,
              ringGains,
              1,
              0,
              { light, emit },
              false,
              AO_RIB_FRONT,
            );
          }
          /*
           * ...the light channel, set into the middle of the ring's face and
           * following the section round. See `STRIP_*`: this is the reference's
           * octagon-of-light, and it is geometry because no threshold on a pale
           * photographic tile can pick a fitting out of its own housing.
           */
          {
            const sa = section(runA, ceilA, RIB + STRIP_PROUD);
            const sb = section(runB, ceilB2, RIB + STRIP_PROUD);
            const st0 = 0.5 - STRIP_W / 2;
            const st1 = 0.5 + STRIP_W / 2;
            const la = lerpProfile(sa, sb, st0);
            const lb = lerpProfile(sa, sb, st1);
            const glow: Shade = {
              light,
              // a diffuser is not metal: it barely takes the lamp at all, so
              // what you see of it is what it is putting out
              gain: 0.12,
              emit: 0,
              strip: STRIP_RATING,
            };
            const trimB2 = get(dress.stripTile, undefined, STRIP_MAT);
            for (let i = STRIP_SEG0; i <= STRIP_SEG1; i++) {
              quad(
                trimB2,
                at(f, st0, la[i][0], la[i][1]),
                at(f, st1, lb[i][0], lb[i][1]),
                at(f, st1, lb[i + 1][0], lb[i + 1][1]),
                at(f, st0, la[i + 1][0], la[i + 1][1]),
                [0, SEG_V0[i]],
                [1, SEG_V0[i]],
                [1, SEG_V1[i]],
                [0, SEG_V1[i]],
                glow,
              );
            }
          }

          /*
           * ...and the returns that make it a box you can see the edge of.
           * Four of them: out of the wall to the collar, up to the frame, back
           * down to the collar, and home.
           */
          const steps: [number, number, number, number][] = [
            [0, 0, RIB * COLLAR, -1],
            [e, RIB * COLLAR, RIB, -1],
            [1 - e, RIB, RIB * COLLAR, 1],
            [1, RIB * COLLAR, 0, 1],
          ];
          const trimB = get(dress.ribTile);
          for (const [t, dLo, dHi, sgn] of steps) {
            // each riser stands at one t, between two depths of the same
            // moulding, so both its edges are that moulding read at that t
            const lo = lerpProfile(profs.get(dLo)![0], profs.get(dLo)![1], t);
            const hi = lerpProfile(profs.get(dHi)![0], profs.get(dHi)![1], t);
            const want: Vec3 = [f.s[0] * sgn, f.s[1] * sgn, f.s[2] * sgn];
            for (let i = 0; i < SEGS.length; i++) {
              const seg = SEGS[i];
              const shade: Shade = {
                light,
                gain: ringGains[seg.band] * seg.mul * AO_RIB_RETURN,
                emit,
              };
              /*
               * **A return is 0.06 of a cell deep and used to be handed a
               * whole tile.** `v` ran 0..1 across it whatever its world size,
               * so the frame tile's bolt flanges were squeezed into a step
               * about fifteen times narrower than they are wide — measured at
               * a p90 anisotropy of 14.8 over the largest surface in the
               * level, and the single worst source of the smearing on a bay.
               *
               * The step's `v` now covers the world distance it actually
               * spans, at whatever density `u` is running at on this segment
               * of the profile, so a texel on the return is the same size and
               * shape as a texel on the moulding it steps off.
               */
              const arc = Math.hypot(
                lo[i + 1][0] - lo[i][0],
                lo[i + 1][1] - lo[i][1],
              );
              const du = SEG_V1[i] - SEG_V0[i];
              const wpu = du > 1e-6 ? arc / du : 1;
              const vExt = wpu > 1e-6 ? Math.abs(dHi - dLo) / wpu : 1;
              quadFacing(
                trimB,
                want,
                at(f, t, lo[i][0], lo[i][1]),
                at(f, t, lo[i + 1][0], lo[i + 1][1]),
                at(f, t, hi[i + 1][0], hi[i + 1][1]),
                at(f, t, hi[i][0], hi[i][1]),
                [SEG_V0[i], 0],
                [SEG_V1[i], 0],
                [SEG_V1[i], vExt],
                [SEG_V0[i], vExt],
                shade,
              );
            }
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
        const id = wallAt(cx + dx, cy + dy);
        const dress = dressOf(id);
        const emit = dress.rib > 0 ? 0 : dress.emit + dress.emitSector * light;
        const pts = section(cRun[ci2], cCeil[ci2], 0);
        latheCorner(
          get(dress.bevel),
          gx,
          gy,
          sx,
          sy,
          pts,
          [dress.gainLower, dress.gainFace, dress.gainUpper],
          { light, emit },
        );
      }
    }
  }

  /* ------------------------------------------- closing the ring at an edge */

  /*
   * Where two open cells meet, their overhead and their deck have to agree, and
   * a bay ring's beam and threshold sill are exactly where they do not.
   *
   * Both are stated as a *band* along one axis of the cell — collar, full
   * depth, collar — so a cell states one depth along the two edges the band
   * steps across and three along the two it runs down. That is fine while
   * neighbouring ring cells all run the same way, and a junction is precisely
   * where they do not: `ringAxis` is first-writer-wins, so a cell whose beam
   * runs east/west sits against one whose beam runs north/south, one presents
   * `RIB` where the other presents `RIB * COLLAR`, and the 0.083 of a cell
   * between them is a slit you can see the void through. The deck sill does
   * the same thing 0.035 tall, under your feet.
   *
   * Rather than special-case the junction, close *every* interior edge: sample
   * both sides' surfaces along it and drop a riser wherever they disagree.
   * Where they agree — which is almost everywhere — the quad is degenerate and
   * `tri` throws it away, so this costs nothing on a straight run and is
   * exhaustive by construction. It subsumes the beam end caps, which were the
   * same idea done from one side only and could not see the other side's band.
   */
  {
    /** which band of a ring cell's beam / sill a point falls in: 1 = the deep centre */
    const deepBand = (ci: number, a: number, bq: number): number => {
      if (!ring[ci]) return 0;
      const u = ringAxis[ci] !== 1 ? a : bq;
      return u > COLLAR_T && u < 1 - COLLAR_T ? 1 : 0;
    };
    const ceilDrop = (ci: number, a: number, bq: number): number =>
      !ring[ci] ? 0 : deepBand(ci, a, bq) ? RIB : RIB * COLLAR;
    const deckRise = (ci: number, a: number, bq: number): number =>
      !ring[ci] ? 0 : deepBand(ci, a, bq) ? SILL : 0;

    const dressFrame = dressOf(WALL.frame);
    const trimTile = dressFrame.ribTile;
    // the only places either surface steps; both sides break at the same two
    const breaks = [0, COLLAR_T, 1 - COLLAR_T, 1];

    for (let cy = 0; cy < h; cy++) {
      for (let cx = 0; cx < w; cx++) {
        const ci = cy * w + cx;
        if (cells[ci] !== 0) continue;
        for (const [dx, dz] of [[1, 0], [0, 1]] as const) {
          const nx = cx + dx;
          const nz = cy + dz;
          if (nx >= w || nz >= h) continue;
          const nj = nz * w + nx;
          if (cells[nj] !== 0) continue;
          if (!ring[ci] && !ring[nj]) continue;

          // `t` runs along the shared edge; each side reads its own cell there
          const edgeXZ = (t: number): [number, number] =>
            dx === 1 ? [cx + 1, cy + t] : [cx + t, cy + 1];
          const sideA = (t: number): [number, number] => (dx === 1 ? [1, t] : [t, 1]);
          const sideB = (t: number): [number, number] => (dx === 1 ? [0, t] : [t, 0]);
          const edgeCeil = (t: number): number => {
            const [a, bq] = sideA(t);
            return ceilAt(cx, cy, a, bq);
          };
          const away: Vec3 = [dx, 0, dz];
          const back: Vec3 = [-dx, 0, -dz];
          const secA = sectors[sectorOf[ci]];
          const secB = sectors[sectorOf[nj]];

          for (let k = 0; k + 1 < breaks.length; k++) {
            const t0 = breaks[k];
            const t1 = breaks[k + 1];
            const tm = (t0 + t1) / 2;
            const [aA, bA] = sideA(tm);
            const [aB, bB] = sideB(tm);

            /* the overhead: the deeper side's beam shows its flank */
            const dA = ceilDrop(ci, aA, bA);
            const dB = ceilDrop(nj, aB, bB);
            if (Math.abs(dA - dB) > 1e-6) {
              // the exposed flank belongs to the deeper cell and is seen from
              // the shallower one, so the normal points at the shallower side
              const deep = dA > dB ? ci : nj;
              const want = dA > dB ? away : back;
              const hi = Math.min(dA, dB);
              const lo = Math.max(dA, dB);
              const light = sectors[sectorOf[deep]].light;
              const p = (t: number, d: number): Vec3 => {
                const [wx, wz] = edgeXZ(t);
                return [wx, edgeCeil(t) - d, wz];
              };
              quadFacing(
                get(trimTile),
                want,
                p(t0, hi),
                p(t1, hi),
                p(t1, lo),
                p(t0, lo),
                [t0, 0],
                [t1, 0],
                [t1, 1],
                [t0, 1],
                {
                  light,
                  gain: CEIL_GAIN * 0.9,
                  emit: (dressFrame.emit + dressFrame.emitSector * light) * 0.6,
                },
              );
            }

            /* ...and the deck, where a threshold sill stands proud of it */
            const rA = deckRise(ci, aA, bA);
            const rB = deckRise(nj, aB, bB);
            if (Math.abs(rA - rB) > 1e-6) {
              const want = rA > rB ? away : back;
              const light = (rA > rB ? secA : secB).light;
              const p = (t: number, y: number): Vec3 => {
                const [wx, wz] = edgeXZ(t);
                return [wx, y, wz];
              };
              quadFacing(
                get(trimTile),
                want,
                p(t0, Math.min(rA, rB)),
                p(t1, Math.min(rA, rB)),
                p(t1, Math.max(rA, rB)),
                p(t0, Math.max(rA, rB)),
                [t0, 0],
                [t1, 0],
                [t1, 1],
                [t0, 1],
                { light, gain: DECK_GAIN * 0.7, emit: 0 },
              );
            }
          }
        }
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
    g.setAttribute("aStrip", new THREE.Float32BufferAttribute(b.strip, 1));
    g.computeBoundingSphere();
    tris += b.pos.length / 9;
    groups.push({
      tile: key.split("|")[0],
      mat: mats.get(key) ?? key.split("|")[0],
      tint: tints.get(key) ?? [1, 1, 1],
      geometry: g,
    });
  }
  return { groups, tris };
}

/** The profile a fraction `t` of the way from one grid corner to the other. */
function lerpProfile(a: Vec2[], b: Vec2[], t: number): Vec2[] {
  const out: Vec2[] = [];
  for (let i = 0; i < a.length; i++) out.push(lerp2(a[i], b[i], t));
  return out;
}

/**
 * A convex corner's fillet: the whole moulding **lathed about the corner post**.
 *
 * Every profile point `(u, y)` is swept through the quadrant at radius `u`, so
 * at 0 and 90 degrees it lands exactly on the two neighbouring strips' own
 * endpoints and no seam is possible. It generalises the quarter-cone this file
 * used to emit — that was the lathe of a straight 45 degree line — and it is
 * what lets the bench, the riser and the ledge all turn an outside corner
 * intact, which is where every earlier attempt at relief broke.
 *
 * The vertical face is skipped: it sits at `u = 0`, which is the post itself.
 */
function latheCorner(
  b: Build,
  gx: number,
  gy: number,
  sx: number,
  sy: number,
  pts: Vec2[],
  gains: [number, number, number],
  sh: { light: number; emit: number },
): void {
  const P = (i: number, th: number): Vec3 => [
    gx + sx * pts[i][0] * Math.cos(th),
    pts[i][1],
    gy + sy * pts[i][0] * Math.sin(th),
  ];
  for (let i = 0; i < SEGS.length; i++) {
    const seg = SEGS[i];
    if (seg.band === 1) continue;
    const shade: Shade = {
      light: sh.light,
      gain: gains[seg.band] * seg.mul,
      emit: sh.emit,
    };
    const ao0 = SEG_AO0[i];
    const ao1 = SEG_AO1[i];
    for (let k = 0; k < FILLET_SEGS; k++) {
      const t0 = (k / FILLET_SEGS) * (Math.PI / 2);
      const t1 = ((k + 1) / FILLET_SEGS) * (Math.PI / 2);
      const u0 = k / FILLET_SEGS;
      const u1 = (k + 1) / FILLET_SEGS;
      // the corridor is inside the lathe, so the winding that faces it is the
      // one whose normal points away from the post
      const mid: Vec3 = [
        gx + sx * 0.5 * (pts[i][0] + pts[i + 1][0]) * Math.cos((t0 + t1) / 2),
        0,
        gy + sy * 0.5 * (pts[i][0] + pts[i + 1][0]) * Math.sin((t0 + t1) / 2),
      ];
      const want: Vec3 = [mid[0] - gx, 0, mid[2] - gy];
      // ...except that the bench faces up and the soffit down, which the radial
      // direction alone cannot say; the profile's own normal supplies it
      const nr = segNormal2(pts[i], pts[i + 1]);
      const rad = Math.hypot(want[0], want[2]) || 1;
      const wantN: Vec3 = [
        (want[0] / rad) * nr[0],
        nr[1],
        (want[2] / rad) * nr[0],
      ];
      quadFacing(
        b,
        wantN,
        P(i, t0),
        P(i, t1),
        P(i + 1, t1),
        P(i + 1, t0),
        [u0, SEG_V0[i]],
        [u1, SEG_V0[i]],
        [u1, SEG_V1[i]],
        [u0, SEG_V1[i]],
        shade,
        [ao0, ao0, ao1, ao1],
      );
    }
  }
}
