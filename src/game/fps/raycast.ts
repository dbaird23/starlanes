/**
 * The raycaster. Pure rendering — it knows about a grid, a camera and a list of
 * billboards, and nothing about the game.
 *
 * Wolf3D-style on purpose: the enemies are Nova's own hulls, which ship as
 * horizontal strips of 36 pre-rendered rotations, and that is the one thing a
 * DDA-plus-billboard renderer consumes and nothing else does.
 *
 * ## The corridor is an octagon in section, and the fold turns every corner
 *
 * `art-reference/damage/damage.png` and `corridors/corridor-lit.png` both show
 * the same cross-section: deck, 45 degree lower chamfer, vertical wall, 45
 * degree upper chamfer, overhead. Those angles are **not** floor-plan angles —
 * neither corridor bends — so the plan stays a grid.
 *
 * Two earlier cuts of this got the straight run right and the corners wrong,
 * and both were wrong for the same reason: they treated the fold as a property
 * of a **wall**.
 *
 * - Round one drew each chamfer as a *band inside the wall column*, a strip of
 *   texture between two projected rows with `v` stepping linearly down it. That
 *   is the affine texture-warp artifact: a band has no perspective across its
 *   own slope, so its panel runs never converged with the corridor and the deck
 *   never actually narrowed.
 * - Round two solved the chamfer per pixel against its own sloped plane, which
 *   fixed the straight run completely — the deck genuinely narrows, because the
 *   slope *takes* those pixels. But a plane anchored to a wall stops where that
 *   wall stops, so every junction, doorway and corner still ended in a square
 *   gap. It was patched by capping each opening with a flat bulkhead and an
 *   octagonal hole. That is a different building, not a fix, and it is gone.
 *
 * The fold is now a **heightfield over the deck** — see `BevelField`:
 *
 *     h(p) = max(0, chamferRun(p) - distanceToNearestSolid(p))
 *
 * Deck where the nearest solid is further than the run; rising at 45 degrees as
 * you approach anything solid; meeting the vertical face exactly where the run
 * reaches zero, which is the wall plane. Along a straight wall that is bit for
 * bit the plane round two solved, and it costs nothing to say so. At a corner
 * it is simply the truth about the plan: an outside corner's nearest solid is a
 * *point*, so the fold wraps it as a quarter-cone; an inside corner is the max
 * of two ramps, which mitres. **A distance field has no corners in it**, which
 * is the whole trick, and it makes convex and concave alike fall out with no
 * case analysis and nothing anchored to anything.
 *
 * ## Marching it
 *
 * A heightfield is not a plane, so a closed-form solve is out and the column is
 * marched — the Comanche/voxel-terrain method, front to back, with the two
 * economies that make it cheap:
 *
 * - **The deck is not marched.** `tEnv` is the first point where the ray comes
 *   within the chamfer run of anything, found once per column by sphere-tracing
 *   the field itself (the field is signed and unclamped precisely so that its
 *   value *is* a safe step). Everything nearer than that is flat deck, drawn by
 *   the exact per-row cast that was always here.
 * - **Rows share their march.** The hit distance is monotone up the column, so
 *   each row starts from the row below's answer and normally needs one or two
 *   samples. The step is secant-accelerated with a cap, and a crossing is
 *   refined by interpolation rather than by stepping finely all the way out.
 *
 * A sample is one bilinear read of one `Float32Array` — the run, the ceiling
 * and the distance are baked into the lattice together, so nothing in the inner
 * loop divides, and nothing looks up a wall.
 *
 * Everything still goes through the one projection constant `proj`, so
 * billboards keep sharing the walls' scale exactly.
 *
 * ## Light — the sector, and the lamp you are carrying
 *
 * Two terms, added.
 *
 * The **sector** term is Doom's model: fog by distance times the light level of
 * an *area* (see `FpsSector`). A wall is lit by the sector you are looking at it
 * *from*, so the renderer takes the sector of the last open cell before the hit;
 * a bevel pixel, which has a world position of its own, takes the sector it is
 * standing in.
 *
 * That alone was the whole light model in round one, and it made a dead section
 * uniformly, evenly black — you navigated it by the minimap. Which is wrong at
 * the level of premise: you are carrying the only light on a dead ship, so dark
 * has to mean "you can see three metres", never "you can see nothing".
 *
 * So the second term is the **suit lamp**, and it is a function of real
 * distance, not a vignette painted over the frame. Every surface here already
 * knows how far away it is — the DDA's ray parameter for walls, the plane solve
 * for the deck and overhead, the march for the bevel, the camera-space depth for
 * billboards — so the same `lampAt()` falloff goes through all of them and they
 * agree about where the light stops. A mild cone (`coneTable`) biases it toward
 * the middle of the view, because a helmet lamp is a cone; the requirement is
 * the distance falloff and the cone is a garnish on top of it.
 *
 * The sum is clamped, so a lit sector barely notices the lamp and a dead one is
 * carried entirely by it. `wallEmit` adds a third, tiny term for the doors
 * only: rule 6 of the art direction is that a sightline terminates on a
 * bulkhead, which it cannot do if the bulkhead is as black as the corridor.
 *
 * The chamfer trim carries a painted light channel; on the bay frames and the
 * doors it also gets an additive term that fog does not touch — emissive, per
 * the art direction. On the bevel that is added straight into the pixel (we own
 * the byte, so a clamped add *is* `lighter`); on the vertical face, which is
 * still blitted with `drawImage`, it is batched and flushed in one composite-op
 * switch at the end of the face pass rather than 480 times.
 */

import { DECK_Y } from "./section";
import { WallBand, type BevelField, type DeckPixels, type FpsLevel } from "./types";

/** Horizontal FOV, as the tangent of the half-angle: 2*atan(0.8) ≈ 77°. */
const PLANE = 0.8;

/**
 * Vertical scale, in the same units — a world unit of height is `H * WALL_H`
 * screen pixels at one cell's distance, and a world unit of width is
 * `W / (2 * PLANE)`.
 *
 * These two numbers set the section's proportions on screen, so they are the
 * art direction's problem and not just taste. At the previous 0.66 / 1.6 the
 * vertical FOV was 35 degrees against a 66 degree horizontal one: a world unit
 * of height covered 1.3x the pixels a world unit of width did, so a corridor
 * authored square read tall, and — worse — the whole octagon overflowed the
 * frame at anything under four cells. You could not see the shape.
 *
 * 0.8 / 1.0 is square at a 16:10 window (`H*WALL_H*2*PLANE/W` = 1.0), which
 * means a section authored to the reference's fractions of corridor width
 * *is* those fractions on screen. The vertical FOV comes out at 53 degrees,
 * between Wolf3D's 60 and Doom's 90 horizontally, and the full octagon now
 * fits from two cells out — one bay.
 *
 * WALL_H reaches the billboards too, through `proj`, so a Wraith's feet stay on
 * the deck. It also means everything is smaller than it was; the sector heights
 * in `level.ts` were raised to match, since a corridor is no longer one cell
 * tall.
 */
const WALL_H = 1.0;

/**
 * The deck's own brightness, against the bevel gains in `textures.ts`.
 *
 * This is the other half of making the fold read. A 45 degree bench turned up
 * into the room catches light the deck does not, and the wall face catches less
 * than either — so the section is a *staircase* of brightness, deck → bevel →
 * face, with a step at each fold. Left at 1.0 the deck was the brightest thing
 * in the frame and the lower bevel, however correctly it was cast, had nothing
 * to be brighter *than*.
 */
const DECK_GAIN = 0.72;

/**
 * The crease. One row of hard shadow in the inside corner where the bevel meets
 * the deck (and where it meets the overhead), because a real fold has a line in
 * it and a single dark pixel states an edge better than any amount of gradient.
 * Measured on the surface's own texture coordinate, so it follows the fold
 * round a corner instead of being a screen-space line.
 */
const CREASE_LOWER = 0.42;
const CREASE_UPPER = 0.55;

/**
 * Fog opacity by distance, sampled into a LUT so the inner loop has no exp().
 *
 * The lamp below shares this LUT's **index**, which is why it is 512 entries
 * over the fog's range rather than its own 128 over seven cells: `litAt` is the
 * single hottest function in the renderer — every bevel pixel, every wall
 * column and every billboard goes through it — and one clamped multiply
 * answering both terms is worth the extra two kilobytes.
 */
const FOG_STEPS = 512;
const FOG_RANGE = 22;
const FOG_MAX = 0.88;
const FOG_K = 0.135;
const FOG_SCALE = (FOG_STEPS - 1) / FOG_RANGE;
const FOG_LUT = new Float32Array(FOG_STEPS);
/** ...and `1 - fog`, which is what the light terms actually multiply by. */
const FOG_KEEP = new Float32Array(FOG_STEPS);
for (let i = 0; i < FOG_STEPS; i++) {
  const d = i / FOG_SCALE;
  FOG_LUT[i] = Math.min(FOG_MAX, 1 - Math.exp(-d * FOG_K));
  FOG_KEEP[i] = 1 - FOG_LUT[i];
}
function fogAt(dist: number): number {
  const i = Math.min(FOG_STEPS - 1, Math.max(0, (dist * FOG_SCALE) | 0));
  return FOG_LUT[i];
}

/**
 * The suit lamp.
 *
 * An inverse-square core so the near field is properly hot, times a soft cutoff
 * so it reaches a hard zero instead of trailing a haze halfway down the ship —
 * "three metres" has to have an edge or a dead section stops being dead. At the
 * numbers below it is ~0.55 on your boots, 0.20 two cells out, 0.05 at four and
 * nothing past seven.
 *
 * `LAMP_MAX` deliberately does not reach 1. A lamp that lights a dead bulkhead
 * to white is not a lamp on a dead ship, it is the corridor being powered again
 * — the first tuning of this ran at 1.06 and every dark compartment came out
 * looking like the reference's *lit* corridor as soon as you stood near a wall.
 * The resting state is `art-reference/damage/damage.png`: near-black, with the
 * light picking out edges rather than filling surfaces.
 */
const LAMP_RANGE = 7;
const LAMP_HALF = 1.5;
const LAMP_MAX = 0.6;
/** How much of the lamp survives at the edge of the view — a cone, not a spot. */
const LAMP_EDGE = 0.55;
/** On the fog LUT's index; zero past `LAMP_RANGE`, so no branch is needed. */
const LAMP_LUT = new Float32Array(FOG_STEPS);
for (let i = 0; i < FOG_STEPS; i++) {
  const d = i / FOG_SCALE;
  if (d >= LAMP_RANGE) continue;
  const q = d / LAMP_HALF;
  const cut = Math.max(0, 1 - (d / LAMP_RANGE) * (d / LAMP_RANGE));
  LAMP_LUT[i] = (LAMP_MAX / (1 + q * q)) * cut;
}
function lampAt(dist: number): number {
  return LAMP_LUT[Math.min(FOG_STEPS - 1, Math.max(0, (dist * FOG_SCALE) | 0))];
}

/**
 * Per-column cone factor, cached for the one render width the session uses.
 * `cos^2` of the ray's angle off the view axis, lifted so the edges keep
 * `LAMP_EDGE` of the beam — a helmet lamp spills, it does not have a rim.
 */
let coneCache: Float32Array | null = null;
let coneCacheW = 0;
function coneTable(W: number): Float32Array {
  if (coneCache && coneCacheW === W) return coneCache;
  const t = new Float32Array(W);
  for (let x = 0; x < W; x++) {
    const cx = (2 * x) / W - 1;
    const c2 = 1 / (1 + PLANE * PLANE * cx * cx);
    t[x] = LAMP_EDGE + (1 - LAMP_EDGE) * c2;
  }
  coneCache = t;
  coneCacheW = W;
  return t;
}

/**
 * The two light terms, summed and clamped: what fraction of a surface's own
 * colour survives at this distance, before the surface's `gain`.
 */
function litAt(dist: number, light: number, cone: number): number {
  let i = (dist * FOG_SCALE) | 0;
  if (i < 0) i = 0;
  else if (i >= FOG_STEPS) i = FOG_STEPS - 1;
  const v = light * FOG_KEEP[i] + LAMP_LUT[i] * cone;
  return v > 1 ? 1 : v;
}

/** Shading on a north/south face relative to an east/west one — the Wolf3D cheat. */
const SIDE_SHADE = 0.74;

/**
 * Where the trim tile's lit channel sits, as a fraction across the bevel.
 * Measured off `chamfer-trim.png`, which is a 341px band of the 1024px source
 * centred on a fixture whose channel runs y 483..533 and whose housing runs
 * 455..567 — so the channel lands at 0.425..0.572 and the housing, which is
 * what the soft spill should reach, at 0.34..0.67.
 */
const GLOW_V0 = 0.425;
const GLOW_V1 = 0.572;
/** ...and the soft spill either side of it. */
const HALO_V0 = 0.34;
const HALO_V1 = 0.67;
/**
 * The same channel where it crosses the **vertical** face, which is drawn from
 * the square `trim-light-channel.png`: same source, so the same 483..533 out of
 * 1024. Lighting this as well as the bevels is what closes the light into a
 * continuous octagonal ring around the frame, which is the single loudest thing
 * in `corridors/corridor-lit.png`.
 */
const FACE_GLOW_V0 = 0.472;
const FACE_GLOW_V1 = 0.52;
const FACE_HALO_V0 = 0.444;
const FACE_HALO_V1 = 0.554;
const GLOW_RGB = "255,246,226";
const GLOW_R = 255;
const GLOW_G = 246;
const GLOW_B = 226;

/** The ridge between a bevel and the vertical face. */
const SEAM = "rgba(0,0,0,0.72)";

/**
 * The overhead has no art of its own — there is no ceiling texture anywhere in
 * Nova's extraction and none in the reference set either — so it borrows the
 * deck plate, knocked down and cooled. That is defensible rather than lazy: a
 * ship's overhead *is* plating, and left as a flat colour it read as a void
 * hanging over the corridor with no perspective in it at all.
 */
const CEIL_R = 0.5;
const CEIL_G = 0.55;
const CEIL_B = 0.66;

export interface RayCamera {
  x: number;
  y: number;
  angle: number;
}

export interface RaySprite {
  x: number;
  y: number;
  img: HTMLImageElement;
  /** side of one (square) frame in the sheet */
  frameSize: number;
  /** which of the sheet's frames to draw */
  frame: number;
  /** world height of the billboard, in cells */
  scale: number;
  /** height of the billboard's centre above the deck, in cells (0.5 = eye level) */
  hover: number;
  /** 0-1, for a death fade */
  alpha: number;
  /** extra additive flash, 0-1, for a hit flinch */
  flash: number;
  /**
   * Blend as light rather than as paint. Explosions want this: composited
   * normally, a bööm frame's dark smoke edges paste onto the bulkhead as a
   * flat decal instead of throwing light across it.
   */
  additive?: boolean;
}

/**
 * Scratch canvas for tinting one sprite frame before it is blitted. Fog has to
 * respect the sprite's own alpha, which `source-atop` does and a rect over the
 * scene does not — so each frame is composited here first. Sized once to the
 * largest frame we ship (48px).
 */
const scratch = document.createElement("canvas");
scratch.width = 64;
scratch.height = 64;
const scratchCtx = scratch.getContext("2d");

/** Everything the renderer needs to dress a surface, injected by the session. */
export interface RayMaterials {
  /**
   * wall id + band + per-cell variant → tile, or null to fall back to flat
   * shading. The variant is a hash of the cell's grid position and only the
   * vertical face uses it — see `cellVariant`.
   */
  texture: (id: number, band: WallBand, variant: number) => CanvasImageSource | null;
  /** wall id + band → brightness multiplier; this is most of the section read */
  gain: (id: number, band: WallBand) => number;
  /** wall id + band → tile repeats per cell of wall length */
  repeat: (id: number, band: WallBand) => number;
  /** wall id → emissive strength of its bevel channels, before sector light */
  glow: (id: number) => number;
  /** wall id → self-illumination added after fog and lamp; doors only */
  emit: (id: number) => number;
  /** wall id → how far its plane steps in toward the corridor centre, in cells */
  inset: (id: number) => number;
  /** the deck tile's pixels, or null to fall back to flat rows */
  deck: DeckPixels | null;
}

export interface SceneInput {
  level: FpsLevel;
  cam: RayCamera;
  sprites: RaySprite[];
  mat: RayMaterials;
}

/** One pending additive strip on the vertical face, collected during the face pass. */
interface Glow {
  x: number;
  y: number;
  h: number;
  a: number;
}

/**
 * Draw one frame into `ctx`, which is expected to be a low-resolution offscreen
 * buffer that the caller upscales with smoothing off. `depth` must be W long
 * and is filled with each column's perpendicular wall distance.
 */
export function renderScene(
  ctx: CanvasRenderingContext2D,
  W: number,
  H: number,
  scene: SceneInput,
  depth: Float32Array,
): void {
  const { level, cam, mat } = scene;
  const dirX = Math.cos(cam.angle);
  const dirY = Math.sin(cam.angle);
  // perpendicular to dir; with y down, +cameraX is the camera's right
  const planeX = -dirY * PLANE;
  const planeY = dirX * PLANE;

  /*
   * One projection constant for walls, the bevel, deck, overhead and billboards
   * alike: a wall is exactly PROJ/dist tall on screen, so a sprite of scale 1 is
   * exactly deck-height and `hover` reads in wall heights (0.5 being eye level).
   */
  const proj = H * WALL_H;

  const tab = materialTable(mat);
  const cols = castColumns(W, H, proj, level, cam, dirX, dirY, planeX, planeY, mat, depth);
  composeBackdrop(ctx, W, H, proj, level, cam, dirX, dirY, planeX, planeY, mat.deck, cols, tab);
  drawFaces(ctx, W, H, mat, cols);
  drawSprites(ctx, W, H, proj, level, cam, dirX, dirY, planeX, planeY, scene.sprites, depth);
}

/**
 * A hash of a cell's grid position, used to stop the wall tile from repeating.
 *
 * `wall-main.png` has a strong central motif, so an untreated run put the same
 * panel — same slot, same orange indicator in the same corner — in every cell,
 * three or four times along one wall. The low bits pick the alternate tile, a
 * quarter-tile u offset and a mirror; between them no two adjacent cells come
 * out the same. Deterministic, so a wall does not shimmer as you walk past it.
 */
function cellVariant(x: number, y: number): number {
  let h = Math.imul(x, 73856093) ^ Math.imul(y, 19349663);
  h ^= h >>> 13;
  return Math.imul(h, 1274126177) >>> 8;
}

/** Sector index for a world position; anything off the grid falls back to 0. */
function sectorAt(level: FpsLevel, x: number, y: number): number {
  const cx = Math.floor(x);
  const cy = Math.floor(y);
  if (cx < 0 || cy < 0 || cx >= level.w || cy >= level.h) return 0;
  return level.sectorOf[cy * level.w + cx];
}

/* ------------------------------------------------------------------- texels */

/** A tile decoded to bytes, so a surface can be sampled per pixel. */
interface TexPixels {
  data: Uint8ClampedArray;
  w: number;
  h: number;
}

/**
 * A tile's pixels, rasterised once and kept.
 *
 * The vertical face is still blitted with `drawImage` — it is one plane at one
 * distance, so a stretched 1px column is exact and the browser does it for
 * free. The bevel is not: it is marched per pixel over a heightfield, which
 * needs the texels rather than an image. Keyed off the image object itself, so
 * a material swap costs one rasterise and no bookkeeping.
 */
const texPixCache = new WeakMap<object, TexPixels>();
let rasterCv: HTMLCanvasElement | null = null;

function texPixels(src: CanvasImageSource | null): TexPixels | null {
  if (!src) return null;
  const key = src as unknown as object;
  const hit = texPixCache.get(key);
  if (hit) return hit;
  const w = texW(src);
  const h = texHOf(src);
  if (!w || !h) return null;
  if (!rasterCv) rasterCv = document.createElement("canvas");
  rasterCv.width = w;
  rasterCv.height = h;
  const c = rasterCv.getContext("2d", { willReadFrequently: true });
  if (!c) return null;
  c.clearRect(0, 0, w, h);
  c.drawImage(src, 0, 0);
  const out: TexPixels = { data: c.getImageData(0, 0, w, h).data, w, h };
  texPixCache.set(key, out);
  return out;
}

/* --------------------------------------------------------- material table */

/**
 * The bevel is dressed by whichever solid is *nearest*, which the field records
 * per sample as a wall id — so the pixel loop needs the whole material set to
 * hand rather than the one cell a column's DDA happened to hit. There are only
 * ever a handful of ids, so it is a table, rebuilt once a frame (a tile that
 * has only just finished loading has to be able to appear).
 */
const MAT_IDS = 8;

interface MatTable {
  texLo: (TexPixels | null)[];
  texUp: (TexPixels | null)[];
  repLo: Float32Array;
  repUp: Float32Array;
  gainLo: Float32Array;
  gainUp: Float32Array;
  glow: Float32Array;
  emit: Float32Array;
}

let matTab: MatTable | null = null;

function materialTable(mat: RayMaterials): MatTable {
  const t: MatTable =
    matTab ??
    (matTab = {
      texLo: new Array<TexPixels | null>(MAT_IDS).fill(null),
      texUp: new Array<TexPixels | null>(MAT_IDS).fill(null),
      repLo: new Float32Array(MAT_IDS),
      repUp: new Float32Array(MAT_IDS),
      gainLo: new Float32Array(MAT_IDS),
      gainUp: new Float32Array(MAT_IDS),
      glow: new Float32Array(MAT_IDS),
      emit: new Float32Array(MAT_IDS),
    });
  for (let id = 0; id < MAT_IDS; id++) {
    t.texLo[id] = texPixels(mat.texture(id, WallBand.Lower, 0));
    t.texUp[id] = texPixels(mat.texture(id, WallBand.Upper, 0));
    t.repLo[id] = mat.repeat(id, WallBand.Lower);
    t.repUp[id] = mat.repeat(id, WallBand.Upper);
    t.gainLo[id] = mat.gain(id, WallBand.Lower);
    t.gainUp[id] = mat.gain(id, WallBand.Upper);
    t.glow[id] = mat.glow(id);
    t.emit[id] = mat.emit(id);
  }
  return t;
}

/* --------------------------------------------------------------- the field */

/*
 * Sampling the bevel heightfield.
 *
 * One bilinear read of one `Float32Array` — the chamfer run, the distance to
 * the nearest solid and the overhead are baked together into the lattice (see
 * `buildBevel`), so the march's inner loop never divides and never touches the
 * grid.
 *
 * It leaves its **lattice offset and the two fractions** behind in module
 * scratch, which is the thing that makes the pixel affordable: every other
 * quantity a bevel pixel wants — the run, the ceiling, the material, the sector
 * — lives on the same lattice, so once the march has landed they are three
 * lerps or one array read away and not a second search. Nothing here allocates
 * and nothing here is a closure; the march calls it a few hundred thousand
 * times a second.
 */
let sO = 0;
let sFx = 0;
let sFy = 0;
let sSub = 1;
let sGx = 0;
let sGy = 0;

function sampleField(
  f: Float32Array,
  sw: number,
  sub: number,
  um: number,
  vm: number,
  x: number,
  y: number,
): number {
  let u = x * sub;
  let v = y * sub;
  if (u < 0) u = 0;
  else if (u > um) u = um;
  if (v < 0) v = 0;
  else if (v > vm) v = vm;
  const i = u | 0;
  const j = v | 0;
  const fx = u - i;
  const fy = v - j;
  const o = j * sw + i;
  const p0 = f[o];
  const p1 = f[o + 1];
  const p2 = f[o + sw];
  const p3 = f[o + sw + 1];
  const dxa = p1 - p0;
  const dxb = p3 - p2;
  const a = p0 + dxa * fx;
  const b = p2 + dxb * fx;
  sO = o;
  sFx = fx;
  sFy = fy;
  sSub = sub;
  return a + (b - a) * fy;
}

/**
 * The gradient of the last-sampled field, at the point it landed on — which is
 * what tells a bevel pixel which way its surface faces.
 *
 * Deliberately *not* computed by `sampleField` itself. The march takes a
 * hundred and fifty thousand samples a frame and only sixty thousand of them
 * end up being a pixel, so the four corners are re-read for the ones that do
 * rather than a gradient being built for the ones that do not.
 */
function gradHere(f: Float32Array, sw: number): void {
  const o = sO;
  const p0 = f[o];
  const p2 = f[o + sw];
  const dxa = f[o + 1] - p0;
  const dxb = f[o + sw + 1] - p2;
  sGx = (dxa + (dxb - dxa) * sFy) * sSub;
  sGy = (p2 + dxb * sFx - (p0 + dxa * sFx)) * sSub;
}

/** A second field, read at the point the last `sampleField` landed on. */
function coSample(f: Float32Array, sw: number): number {
  const o = sO;
  const a = f[o] + (f[o + 1] - f[o]) * sFx;
  const b = f[o + sw] + (f[o + sw + 1] - f[o + sw]) * sFx;
  return a + (b - a) * sFy;
}

/** ...and a byte field, nearest, at the same point. */
function coNearest(f: Uint8Array, sw: number): number {
  return f[sO + (sFx >= 0.5 ? 1 : 0) + (sFy >= 0.5 ? sw : 0)];
}

/* ------------------------------------------------------------------ columns */

/**
 * Everything one screen column's DDA produced, in parallel typed arrays.
 *
 * Three passes read this — the flat backdrop, the bevel march and the face blit
 * — so the DDA runs once and they agree about where the section's boundaries
 * are, which is what keeps the deck edge, the fold and the wall foot from
 * drifting a row apart from each other.
 */
interface Cols {
  w: number;
  /** the camera this frame, so the later passes can re-derive a world point */
  camX: number;
  camY: number;
  /** perpendicular distance to the vertical face's plane (inset applied) */
  dist: Float32Array;
  rayX: Float32Array;
  rayY: Float32Array;
  cell: Int32Array;
  side: Uint8Array;
  faceFlip: Uint8Array;
  faceOff: Float32Array;
  variant: Int32Array;
  repScale: Float32Array;
  light: Float32Array;
  emit: Float32Array;
  glow: Float32Array;
  /** the vertical face's two screen rows */
  faceTopRow: Int32Array;
  faceBotRow: Int32Array;
  /**
   * The window the face is still allowed to paint in. A bevel nearer than the
   * wall can stand in front of the foot (or the head) of a far one — the ridge
   * of a corner silhouetted against the corridor beyond it — and the face pass
   * runs after the backdrop, so without this it would blit straight over it.
   */
  clipTop: Int32Array;
  clipBot: Int32Array;
}

let colCache: Cols | null = null;

function colsFor(W: number): Cols {
  if (colCache && colCache.w === W) return colCache;
  colCache = {
    w: W,
    camX: 0,
    camY: 0,
    dist: new Float32Array(W),
    rayX: new Float32Array(W),
    rayY: new Float32Array(W),
    cell: new Int32Array(W),
    side: new Uint8Array(W),
    faceFlip: new Uint8Array(W),
    faceOff: new Float32Array(W),
    variant: new Int32Array(W),
    repScale: new Float32Array(W),
    light: new Float32Array(W),
    emit: new Float32Array(W),
    glow: new Float32Array(W),
    faceTopRow: new Int32Array(W),
    faceBotRow: new Int32Array(W),
    clipTop: new Int32Array(W),
    clipBot: new Int32Array(W),
  };
  return colCache;
}

function castColumns(
  W: number,
  H: number,
  proj: number,
  level: FpsLevel,
  cam: RayCamera,
  dirX: number,
  dirY: number,
  planeX: number,
  planeY: number,
  mat: RayMaterials,
  depth: Float32Array,
): Cols {
  const c = colsFor(W);
  const half = H / 2;
  const bf = level.bevel;
  c.camX = cam.x;
  c.camY = cam.y;

  for (let x = 0; x < W; x++) {
    const cameraX = (2 * x) / W - 1;
    const rayX = dirX + planeX * cameraX;
    const rayY = dirY + planeY * cameraX;
    c.rayX[x] = rayX;
    c.rayY[x] = rayY;
    c.clipTop[x] = 0;
    c.clipBot[x] = H;

    let mapX = Math.floor(cam.x);
    let mapY = Math.floor(cam.y);
    const deltaX = rayX === 0 ? Infinity : Math.abs(1 / rayX);
    const deltaY = rayY === 0 ? Infinity : Math.abs(1 / rayY);

    let stepX: number;
    let stepY: number;
    let sideX: number;
    let sideY: number;
    if (rayX < 0) {
      stepX = -1;
      sideX = (cam.x - mapX) * deltaX;
    } else {
      stepX = 1;
      sideX = (mapX + 1 - cam.x) * deltaX;
    }
    if (rayY < 0) {
      stepY = -1;
      sideY = (cam.y - mapY) * deltaY;
    } else {
      stepY = 1;
      sideY = (mapY + 1 - cam.y) * deltaY;
    }

    let side = 0;
    let cell = 0;
    // the open cell the ray was in when it hit — the sector lighting this wall
    let fromX = mapX;
    let fromY = mapY;
    // the level's border is solid, so this always terminates; the counter is
    // only a backstop against a malformed level
    for (let guard = 0; guard < 256; guard++) {
      fromX = mapX;
      fromY = mapY;
      if (sideX < sideY) {
        sideX += deltaX;
        mapX += stepX;
        side = 0;
      } else {
        sideY += deltaY;
        mapY += stepY;
        side = 1;
      }
      if (mapX < 0 || mapY < 0 || mapX >= level.w || mapY >= level.h) break;
      cell = level.cells[mapY * level.w + mapX];
      if (cell > 0) break;
    }

    if (cell <= 0) {
      // No wall in this direction (a malformed level — the border is solid).
      // Collapse the face onto the horizon, which leaves the column as flat
      // overhead above and flat deck below with nothing between.
      depth[x] = Infinity;
      c.cell[x] = 0;
      c.dist[x] = Infinity;
      const mid = clampRow(Math.floor(half), H);
      c.faceTopRow[x] = mid;
      c.faceBotRow[x] = mid;
      continue;
    }

    // grid-boundary distance, not euclidean — this is what removes the fisheye
    let dist = Math.max(1e-4, side === 0 ? sideX - deltaX : sideY - deltaY);

    /*
     * The bay ribs, as geometry rather than as paint.
     *
     * A frame's wall plane stands `inset` cells proud of the bays either side,
     * which is what the references actually show: nested octagon ribs receding,
     * their silhouettes doing the work no amount of shading on a smooth tube can
     * do. A raycaster can have that for one subtraction, because the DDA's
     * `dist` is the ray parameter itself — a plane `inset` nearer is reached
     * `inset * delta` earlier along the ray. The bevel gets the rib for free:
     * `buildBevel` inflates the same cell in the distance field by the same
     * number, so the fold steps out around it too.
     *
     * The rib is a box, though, not an infinite plane: one cell along the wall
     * and `inset` deep. So the stepped-in plane is only the answer while the ray
     * is still inside the cell's span along the wall. `otherEnter` is the ray
     * parameter at which it entered that span, and if the stepped-in plane lies
     * behind it the ray comes in through the rib's **return face** instead —
     * the little strip of its own thickness, seen edge-on, on the other axis.
     * That is the piece that occludes, and it costs one comparison.
     *
     * Two details that are not optional:
     *
     * - The entry has to be **in front of the camera**. At a grazing angle
     *   `inset * delta` is enormous and the stepped-in plane lands behind you;
     *   without the test the column takes a distance of nearly zero and paints
     *   a black full-height slab down the frame. When neither face is in front,
     *   the ray has genuinely slipped past the rib and the recessed plane it
     *   already had is the right answer.
     * - The return face is only `inset` cells across, so the along-wall
     *   coordinate covers a fourteenth of what a full cell does and the tile
     *   comes out magnified into vertical smears. `repScale` puts the texel
     *   density back where the front face has it.
     */
    const inset = mat.inset(cell);
    let repScale = 1;
    if (inset > 0) {
      const front = dist - inset * (side === 0 ? deltaX : deltaY);
      const otherEnter = side === 0 ? sideY - deltaY : sideX - deltaX;
      if (front >= otherEnter) {
        if (front > 0.02) dist = front;
      } else if (otherEnter > 0.02 && otherEnter < dist) {
        dist = otherEnter;
        side = 1 - side;
        repScale = 1 / inset;
      }
    }
    depth[x] = dist;

    const sector =
      fromX < 0 || fromY < 0 || fromX >= level.w || fromY >= level.h
        ? level.sectors[0]
        : level.sectors[level.sectorOf[fromY * level.w + fromX]];

    /*
     * The section, in world units, read off the same two lattices the bevel
     * march reads and through the same sampler — so whatever smoothing they
     * carry, the fold arrives at the vertical face's foot exactly and not a
     * pixel short of it. The deck never moves; a sector's height lifts the
     * overhead and the upper fold with it, and nothing else.
     */
    const hitX = cam.x + dist * rayX;
    const hitY = cam.y + dist * rayY;
    const cham = sampleField(bf.cham, bf.sw, bf.sub, bf.sw - 1.0001, bf.sh - 1.0001, hitX, hitY);
    const ceilY = DECK_Y + coSample(bf.ceil, bf.sw);
    let faceBotY = DECK_Y + cham;
    let faceTopY = ceilY - cham;
    if (faceTopY < faceBotY) {
      // a crawlspace lower than two chamfers: the vertical face vanishes
      faceTopY = faceBotY = (DECK_Y + ceilY) / 2;
    }

    /*
     * Boundaries are snapped to whole rows. They have to be: a fold forty cells
     * down the corridor is a fraction of a pixel high, and against a near-black
     * derelict a sub-pixel boundary comes out as chains of white dots tracking
     * the fold's edges — the one artifact that reads instantly as broken.
     */
    const faceTopRow = clampRow(Math.round(half - (faceTopY * proj) / dist), H);
    const faceBotRow = clampRow(Math.round(half - (faceBotY * proj) / dist), H);

    /*
     * The per-cell variant. It is deliberately applied to the **vertical face
     * only**: that is where the repetition shows, and the bevel carries
     * continuous horizontal structure (a conduit run, a bench, a light channel)
     * that has to survive from one cell into the next — and now round the
     * corner into the next corridor — or the ship stops reading as one ship.
     */
    const hv = cellVariant(mapX, mapY);
    const flip = (side === 0 && rayX > 0) || (side === 1 && rayY < 0);
    // one cell in eight takes the alternate tile; the rest are offset and
    // mirrored, which is free and enough on its own to kill the grid
    const variant = (hv & 7) === 0 ? 1 : 0;

    c.dist[x] = dist;
    c.cell[x] = cell;
    c.side[x] = side;
    c.faceFlip[x] = (((hv >> 5) & 1) === 1 ? !flip : flip) ? 1 : 0;
    c.faceOff[x] = ((hv >> 3) & 3) * 0.25;
    c.variant[x] = variant;
    c.repScale[x] = repScale;
    c.light[x] = sector.light;
    c.emit[x] = mat.emit(cell);
    c.glow[x] = mat.glow(cell) * sector.light;
    c.faceTopRow[x] = faceTopRow;
    c.faceBotRow[x] = faceBotRow;
  }

  return c;
}

function clampRow(r: number, H: number): number {
  return r < 0 ? 0 : r > H ? H : r;
}

/* ------------------------------------------------------------------ backdrop */

/**
 * The backdrop, in two passes over one ImageData.
 *
 * **Row-major, first:** the flat deck and the flat overhead, which are single
 * planes and so are exact per row — a row at screen y is `rise * proj / |y -
 * half|` away and the world span across it is linear in that, one walk per row
 * landing every pixel on the tile. That is what gives the plate seams that
 * converge with the corridor and the worn centre runner. The rows the vertical
 * face will cover are filled flat and cheaply, since the face pass paints over
 * them anyway.
 *
 * **Column-major, second:** the bevel, marched over the heightfield (see the
 * file header, and `castBevel`). It overwrites whatever the flat pass put in
 * the rows it turns out to own, which is the natural way round: the fold is
 * always nearer than the deck it is taking pixels from.
 */
let backBuf: ImageData | null = null;
/** A 32-bit view onto `backBuf`, so a pixel is one store instead of four. */
let backWords: Uint32Array | null = null;
/**
 * Which way round to pack a pixel into that word. Detected once rather than
 * assumed: every machine this will ever run on is little-endian, and the one
 * that is not would get its reds and blues swapped silently.
 */
const LITTLE_ENDIAN = (() => {
  const probe = new Uint32Array(1);
  new Uint8Array(probe.buffer)[0] = 0xff;
  return probe[0] === 0xff;
})();
function pack(r: number, g: number, b: number): number {
  const cr = r > 255 ? 255 : r < 0 ? 0 : r | 0;
  const cg = g > 255 ? 255 : g < 0 ? 0 : g | 0;
  const cb = b > 255 ? 255 : b < 0 ? 0 : b | 0;
  return LITTLE_ENDIAN
    ? (0xff000000 | (cb << 16) | (cg << 8) | cr) >>> 0
    : (((cr << 24) | (cg << 16) | (cb << 8) | 0xff) >>> 0);
}

/** What the face pass will overdraw anyway; only ever seen for one frame. */
const FACE_FILL = pack(30, 34, 40);

function composeBackdrop(
  ctx: CanvasRenderingContext2D,
  W: number,
  H: number,
  proj: number,
  level: FpsLevel,
  cam: RayCamera,
  dirX: number,
  dirY: number,
  planeX: number,
  planeY: number,
  deck: DeckPixels | null,
  cols: Cols,
  tab: MatTable,
): void {
  const half = H / 2;
  if (!backBuf || backWords === null || backBuf.width !== W || backBuf.height !== H) {
    backBuf = new ImageData(W, H);
    backWords = new Uint32Array(backBuf.data.buffer);
  }
  const px = backWords;

  const camSector = level.sectors[sectorAt(level, cam.x, cam.y)];
  const camLight = camSector.light;
  // an overhead at height h sits (h - 0.5) above the eye, so a row at y is
  // that much further out than the deck row the same distance below the horizon
  const ceilRise = Math.max(0.05, camSector.height - 0.5);

  const horizon = Math.min(H, Math.max(0, Math.floor(half)));
  const lw = level.w;
  const lh = level.h;
  const sectors = level.sectors;
  const sectorOf = level.sectorOf;
  const cone = coneTable(W);
  let lastCell = -1;

  const tw = deck ? deck.w : 1;
  const th = deck ? deck.h : 1;
  const tmx = deck ? deck.maskX : 0;
  const tmy = deck ? deck.maskY : 0;
  const td = deck ? deck.data : null;

  for (let y = 0; y < H; y++) {
    const up = y < horizon;
    const rows = up ? half - y : y - half;
    // a plane `rise` above (or below) the eye reaches screen row `half ∓ rise *
    // proj / d`, so invert that for the row's own distance
    const rise = up ? ceilRise : 0.5;
    const flatDist = rows <= 0.5 ? FOG_RANGE : (rise * proj) / rows;
    const flatLit = 1 - fogAt(flatDist);
    /*
     * The lamp's contribution for this whole row. A row of flat deck is a
     * constant distance away, which is the same fact the shading has always
     * used — so the lamp costs one LUT read per row and one multiply-add per
     * pixel, and the deck under your boots comes up out of the dark exactly as
     * far as the walls beside them do. The bevel cannot share it: every pixel
     * of it is at its own distance, which is what makes it read as a slope, so
     * it pays for its own LUT reads.
     */
    const flatLamp = lampAt(flatDist);

    const rowStart = y * W;

    // the flat surface's world walk across this row, advanced for every pixel
    // whether it is used or not — two adds is cheaper than re-deriving it
    let fwx = cam.x + flatDist * (dirX - planeX);
    let fwy = cam.y + flatDist * (dirY - planeY);
    const sx = (flatDist * 2 * planeX) / W;
    const sy = (flatDist * 2 * planeY) / W;

    const kr = up ? CEIL_R : DECK_GAIN;
    const kg = up ? CEIL_G : DECK_GAIN;
    const kb = up ? CEIL_B : DECK_GAIN;

    /*
     * Sector light on the flat surfaces changes only when the walk crosses a
     * cell boundary, which on a near row is once or twice across the whole
     * screen — so it is cached rather than looked up per pixel. Cells outside
     * the grid keep the camera's light; those pixels are always overdrawn by
     * the border wall anyway.
     */
    let cellX = 0x7fffffff;
    let cellY = 0x7fffffff;
    let sectorTerm = 0;

    // the flat fallback colour, for a row with no deck tile or nothing to see
    const flatCell = Math.floor(flatDist);
    const seamK = flatCell !== lastCell ? 0.5 : 1;
    lastCell = flatCell;
    const flatF = Math.min(1, flatLit * camLight + flatLamp) * seamK;
    const flatWord = pack(
      (up ? 30 : 58) * flatF,
      (up ? 34 : 53) * flatF,
      (up ? 41 : 44) * flatF,
    );
    const flatFaded = flatLit <= 0.004;

    for (let x = 0; x < W; x++) {
      const p = rowStart + x;
      const wx = fwx;
      const wy = fwy;
      fwx += sx;
      fwy += sy;

      // the strip the vertical face will blit over; no point casting it
      if (y >= cols.faceTopRow[x] && y < cols.faceBotRow[x]) {
        px[p] = FACE_FILL;
        continue;
      }

      if (!td || flatFaded) {
        px[p] = flatWord;
        continue;
      }
      const cx = Math.floor(wx);
      const cy = Math.floor(wy);
      if (cx !== cellX || cy !== cellY) {
        cellX = cx;
        cellY = cy;
        const light =
          cx < 0 || cy < 0 || cx >= lw || cy >= lh
            ? camLight
            : sectors[sectorOf[cy * lw + cx]].light;
        sectorTerm = flatLit * light;
      }
      // the sector term is cached per cell; the lamp is per pixel, because the
      // cone is, and it is the only thing lighting a dead compartment at all
      let f = sectorTerm + flatLamp * cone[x];
      if (f > 1) f = 1;
      const t = (((wy - cy) * th) & tmy) * tw + (((wx - cx) * tw) & tmx);
      const o = t << 2;
      px[p] = pack(td[o] * f * kr, td[o + 1] * f * kg, td[o + 2] * f * kb);
    }
  }

  castBevel(px, W, H, proj, level, cam, cols, tab, deck);

  ctx.putImageData(backBuf, 0, 0);
}

/* ---------------------------------------------------------------- the march */

/** Nothing past the fog's own range is worth marching for. */
const MARCH_MAX = FOG_RANGE;
/** How many samples one row is allowed before it gives up on itself. */
const MARCH_ITERS = 16;
/**
 * How far past the safe (never-overshoot) step the secant is allowed to reach.
 *
 * The safe step is `phi / (rayLen + |q|)`: the surface cannot rise faster than
 * 45 degrees, so nothing within that distance along the ray can be hit. Taken
 * literally it is a sphere trace, and a sphere trace creeps at grazing
 * incidence — which is the *common* case here, since the fold is a shallow ramp
 * seen almost end-on down a corridor. The secant knows the real slope and jumps
 * the whole way in one step; the cap is what keeps it from vaulting a bump it
 * has not sampled. Note that the cap is a multiple of a step that is itself
 * proportional to how far the ray is from the surface, so it stays small in
 * absolute terms exactly where a miss would matter; at four it was small enough
 * to stop a near-tangent row converging at all, and a row that runs out of
 * samples hangs its answer down the frame as a streak.
 */
const SECANT_CAP = 12;
/**
 * ...and a deliberate 6% overshoot on top of it.
 *
 * The secant lands *on* the surface, which means half the rows land a hair
 * outside it and have to take a second sample to bracket the crossing. Aiming
 * a little past it means almost every row brackets on its first try and the
 * crossing is interpolated from the two points in hand. It costs nothing to be
 * slightly wrong in that direction — the interpolation is what produces the
 * answer either way — and it took the march from 1.7 samples a row to 1.2.
 */
const SECANT_BIAS = 1.06;
/** ...and a floor on the step, so a tangent ray cannot stall the loop. */
const MIN_ADV = 0.002;
/** Below this the surface is flat: deck under you, plating over you. */
const FLAT_EPS = 0.004;
/** ...and this close to it, a row that has run out of samples has converged. */
const STALL_EPS = 0.01;
/**
 * Slack on the field's Lipschitz constant. `lo` is `chamferRun - distance`, and
 * the distance term has a unit gradient, so `|lo|` is a safe distance to step;
 * the run drifts a little from one space into the next, and this pays for it.
 */
const LIP = 1.35;

/**
 * Per-row constants, which are two divisions each and are the same for every
 * one of the 480 columns. `tDeck` depends only on the buffer height; `tCeil`
 * also on the camera's own overhead, so it is refilled when that changes.
 */
let rowQ: Float32Array | null = null;
let rowTDeck: Float32Array | null = null;
let rowTCeil: Float32Array | null = null;
let rowH = 0;
let rowRise = -1;
function rowTables(H: number, proj: number, ceilRise: number): void {
  if (!rowQ || rowH !== H) {
    rowQ = new Float32Array(H);
    rowTDeck = new Float32Array(H);
    rowTCeil = new Float32Array(H);
    rowH = H;
    rowRise = -1;
    const half = H / 2;
    for (let y = 0; y < H; y++) {
      const q = (half - y) / proj;
      rowQ[y] = q;
      rowTDeck[y] = q < -1e-6 ? 0.5 / -q : Infinity;
    }
  }
  if (rowRise !== ceilRise) {
    rowRise = ceilRise;
    for (let y = 0; y < H; y++) {
      const q = rowQ[y];
      rowTCeil![y] = q > 1e-6 ? ceilRise / q : Infinity;
    }
  }
}

/**
 * The bevel, marched per column over the heightfield.
 *
 * Front to back, once for the fold coming up off the deck and once for the one
 * hanging under the overhead, with four things doing all the work:
 *
 * - **A shared `t` down the column.** The first-hit distance is monotone as the
 *   ray flattens (a steeper ray is below a flatter one everywhere, so it can
 *   only hit sooner), which means the previous row's answer is a valid — and
 *   very close — starting point for this one. What is carried between rows is
 *   the bracket's *outside* end and the field value there: the surface does not
 *   depend on which row is asking, so the first sample of each row is free.
 * - **`tSafe`, which is what makes the deck cost nothing.** Every sample also
 *   yields a radius inside which there is provably no hit — `|lo|` where the
 *   fold does not exist at all, `phi / (rayLen + |q|)` where the ray is above
 *   it — and because rows further up the column are *higher*, a radius
 *   established for one row is still sound for every row after it. So a single
 *   sample near your boots typically answers the next twenty rows outright:
 *   they are deck, the flat cast has already drawn them, and the march skips
 *   them without touching the field.
 * - **A crossing is interpolated, not stepped onto.** The moment a sample comes
 *   out below the surface, the hit is the linear crossing between it and the
 *   last one above — exact wherever the fold is planar, which is everywhere
 *   except the cone at an outside corner.
 * - **The pixel reuses the crossing sample's lattice position** rather than
 *   looking anything up again. See `sampleField`.
 *
 * The loop ends the moment a row finds nothing before the wall: by monotonicity
 * every row above it is the vertical face or higher, and the DDA owns those.
 */
function castBevel(
  px: Uint32Array,
  W: number,
  H: number,
  proj: number,
  level: FpsLevel,
  cam: RayCamera,
  cols: Cols,
  tab: MatTable,
  deck: DeckPixels | null,
): void {
  const bf = level.bevel;
  const half = H / 2;
  const cone = coneTable(W);
  const camX = cam.x;
  const camY = cam.y;
  const lo = bf.lo;
  const upF = bf.up;
  const sw = bf.sw;
  const sub = bf.sub;
  const um = sw - 1.0001;
  const vm = bf.sh - 1.0001;
  const camSector = level.sectors[sectorAt(level, camX, camY)];
  const ceilRise = Math.max(0.05, camSector.height - 0.5);
  frLevel = level;
  frField = bf;
  frTab = tab;
  rowTables(H, proj, ceilRise);
  const qT = rowQ!;
  const deckT = rowTDeck!;
  const ceilT = rowTCeil!;

  for (let x = 0; x < W; x++) {
    const rayX = cols.rayX[x];
    const rayY = cols.rayY[x];
    const rayLen = Math.sqrt(rayX * rayX + rayY * rayY);
    const invLip = 1 / (LIP * rayLen);
    const wallT = cols.dist[x];
    const limit = wallT < MARCH_MAX ? wallT : MARCH_MAX;
    if (!(limit > 0.02)) continue;
    const coneK = cone[x];
    const faceTop = cols.faceTopRow[x];
    const faceBot = cols.faceBotRow[x];

    /* --- the fold coming up off the deck */
    let tPrev = 0.03;
    let sPrev = sampleField(lo, sw, sub, um, vm, camX + tPrev * rayX, camY + tPrev * rayY);
    let tSafe = sPrev < 0 ? tPrev - sPrev * invLip : tPrev;
    let den = 0;
    for (let y = H - 1; y >= 0; y--) {
      const q = qT[y];
      const tDeck = deckT[y];
      const tLimit = tDeck < limit ? tDeck : limit;
      if (tLimit <= tSafe) {
        // Provably nothing between the camera and the deck: the flat cast has
        // it. (Or nothing between here and the wall, which owns the rest.)
        //
        // And the *whole block* of rows nearer than the cleared radius goes at
        // once. `tDeck` is monotone in the row, so the first row that is not
        // already answered is one division away, and skipping to it is what
        // stops a column from paying three hundred loop iterations to be told
        // three hundred times that the deck under your boots is deck.
        if (tDeck > limit) break;
        const yJump = Math.ceil(half + (0.5 * proj) / tSafe);
        if (yJump > 0 && yJump <= y) y = yJump;
        continue;
      }
      if (tPrev > tLimit) {
        tPrev = tLimit;
        sPrev = sampleField(lo, sw, sub, um, vm, camX + tPrev * rayX, camY + tPrev * rayY);
      }
      const aq = q < 0 ? -q : q;

      let t = tPrev;
      let hraw = sPrev;
      let phi = 0.5 + q * t - (hraw > 0 ? hraw : 0);
      let found = -1;
      let stalled = false;
      let outside = t;
      let outsideH = hraw;
      if (phi <= 0) {
        // degenerate: the carried bracket is already under the surface
        sampleField(lo, sw, sub, um, vm, camX + t * rayX, camY + t * rayY);
        found = t;
      }

      for (let k = 0; found < 0 && k < MARCH_ITERS; k++) {
        const safe = phi / (rayLen + aq);
        let clear = t + safe;
        let adv: number;
        if (hraw <= 0) {
          // open deck here: step to the deck itself, or to the fold's envelope,
          // whichever comes first — both are exact and neither can overshoot
          const toDeck = q < -1e-6 ? phi / aq : Infinity;
          const toEnv = -hraw * invLip;
          adv = toDeck < toEnv ? toDeck : toEnv;
          if (t + toEnv > clear) clear = t + toEnv;
        } else {
          adv = den > 1e-4 ? phi * SECANT_BIAS / den : safe;
          if (adv > safe * SECANT_CAP) adv = safe * SECANT_CAP;
        }
        if (clear > tSafe) tSafe = clear;
        if (!(adv > MIN_ADV)) adv = MIN_ADV;
        let tn = t + adv;
        if (tn >= tLimit) tn = tLimit;

        const hn = sampleField(lo, sw, sub, um, vm, camX + tn * rayX, camY + tn * rayY);
        const phin = 0.5 + q * tn - (hn > 0 ? hn : 0);
        if (phin <= 0) {
          outside = t;
          outsideH = hraw;
          found = t + (tn - t) * (phi / (phi - phin));
          break;
        }
        den = (phi - phin) / (tn - t);
        t = tn;
        phi = phin;
        hraw = hn;
        if (tn >= tLimit || k === MARCH_ITERS - 1) {
          outside = t;
          outsideH = hraw;
          // out of samples but essentially on the surface: take it. Out of
          // samples with the surface still a way off means the row never
          // converged, and answering it with the distance it happened to reach
          // paints a streak; leave it to the flat cast instead.
          if (tn < tLimit && phi <= STALL_EPS) found = t;
          else if (tn < tLimit) stalled = true;
          break;
        }
      }

      if (found < 0) {
        tPrev = outside;
        sPrev = outsideH;
        if (stalled || tDeck <= limit) continue;
        break;
      }
      tPrev = outside;
      sPrev = outsideH;

      const hAbove = 0.5 + q * found;
      if (hAbove <= FLAT_EPS) continue; // it is the deck
      px[y * W + x] = bevelPixel(
        found, camX + found * rayX, camY + found * rayY,
        hAbove, coneK, false, cols.light[x],
      );
      if (y < faceBot && y >= faceTop && y < cols.clipBot[x]) cols.clipBot[x] = y;
    }

    /* --- and the one hanging under the overhead, the same march mirrored */
    tPrev = 0.03;
    sPrev = sampleField(upF, sw, sub, um, vm, camX + tPrev * rayX, camY + tPrev * rayY);
    tSafe = tPrev + (sPrev - 0.5) / (rayLen + 1);
    den = 0;
    for (let y = 0; y < H; y++) {
      const q = qT[y];
      const tCeil = ceilT[y];
      const tLimit = tCeil < limit ? tCeil : limit;
      if (tLimit <= tSafe) {
        if (tCeil > limit) break;
        const yJump = Math.floor(half - (ceilRise * proj) / tSafe);
        if (yJump < H && yJump >= y) y = yJump;
        continue;
      }
      if (tPrev > tLimit) {
        tPrev = tLimit;
        sPrev = sampleField(upF, sw, sub, um, vm, camX + tPrev * rayX, camY + tPrev * rayY);
      }

      let t = tPrev;
      let surf = sPrev;
      let phi = surf - (0.5 + q * t);
      let found = -1;
      let stalled = false;
      let outside = t;
      let outsideS = surf;
      if (phi <= 0) {
        sampleField(upF, sw, sub, um, vm, camX + t * rayX, camY + t * rayY);
        found = t;
      }

      for (let k = 0; found < 0 && k < MARCH_ITERS; k++) {
        const safe = phi / (rayLen + q);
        if (t + safe > tSafe) tSafe = t + safe;
        let adv = den > 1e-4 ? (phi * SECANT_BIAS) / den : safe;
        if (adv > safe * SECANT_CAP) adv = safe * SECANT_CAP;
        if (!(adv > MIN_ADV)) adv = MIN_ADV;
        let tn = t + adv;
        if (tn >= tLimit) tn = tLimit;

        const sn = sampleField(upF, sw, sub, um, vm, camX + tn * rayX, camY + tn * rayY);
        const phin = sn - (0.5 + q * tn);
        if (phin <= 0) {
          outside = t;
          outsideS = surf;
          found = t + (tn - t) * (phi / (phi - phin));
          break;
        }
        den = (phi - phin) / (tn - t);
        t = tn;
        phi = phin;
        surf = sn;
        if (tn >= tLimit || k === MARCH_ITERS - 1) {
          outside = t;
          outsideS = surf;
          if (tn < tLimit && phi <= STALL_EPS) found = t;
          else if (tn < tLimit) stalled = true;
          break;
        }
      }

      if (found < 0) {
        tPrev = outside;
        sPrev = outsideS;
        if (stalled || tCeil <= limit) continue;
        break;
      }
      tPrev = outside;
      sPrev = outsideS;

      const hAbove = 0.5 + q * found;
      const wx = camX + found * rayX;
      const wy = camY + found * rayY;
      // how far the fold has already come down off the overhead, here
      const drop = coSample(bf.ceil, sw) - hAbove;
      if (drop <= FLAT_EPS) {
        // flat plating rather than fold — but at *this* distance, which is not
        // the camera's if the space overhead has opened up
        px[y * W + x] = ceilPixel(level, deck, found, wx, wy, coneK);
        continue;
      }
      px[y * W + x] = bevelPixel(found, wx, wy, hAbove, coneK, true, cols.light[x]);
      if (y >= faceTop && y < faceBot && y + 1 > cols.clipTop[x]) cols.clipTop[x] = y + 1;
    }
  }
}

/**
 * One pixel of the fold.
 *
 * Everything it needs it already has: the distance (so its own fog and its own
 * lamp), the world point, the ray's own height there — which **is** the height
 * of the surface, since that is what the march solved for, and dividing it by
 * the chamfer run gives the texture coordinate across the slope with no
 * projection and no per-column boundary to measure against. The run, the
 * ceiling, the material and the sector all come off the lattice position the
 * march left behind, which is why this is affordable at 40% of the frame.
 *
 * The two things that come out of the gradient are which way the fold faces —
 * it points at whatever solid is nearest, so its dominant axis is the wall's
 * normal — and, from that, which world axis runs *along* the surface and
 * therefore carries `u`. Round a convex corner that choice swaps at the 45
 * degree diagonal, which is exactly where mitred trim changes direction on a
 * real bulkhead; the geometry does not change there, only the grain.
 *
 * `fallbackLight` is the column's own sector, for a point that has ended up off
 * the grid entirely.
 */
let frLevel: FpsLevel | null = null;
let frField: BevelField | null = null;
let frTab: MatTable | null = null;

function bevelPixel(
  t: number,
  wx: number,
  wy: number,
  hAbove: number,
  cone: number,
  upper: boolean,
  fallbackLight: number,
): number {
  const level = frLevel!;
  const bf = frField!;
  const tab = frTab!;
  const sw = bf.sw;
  // the surface's normal, from the same four corners the march interpolated
  gradHere(bf.lo, sw);
  const gx = upper ? -sGx : sGx;
  const gy = upper ? -sGy : sGy;
  const ax = gx < 0 ? -gx : gx;
  const ay = gy < 0 ? -gy : gy;
  const axisX = ax > ay;

  const id = coNearest(bf.id, sw);
  const cham = coSample(bf.cham, sw);
  let v = cham > 1e-4 ? (upper ? coSample(bf.ceil, sw) - hAbove : hAbove) / cham : 1;
  if (!upper) v = 1 - v;
  if (v < 0) v = 0;
  else if (v > 0.9999) v = 0.9999;

  const sec = level.sectors[coNearest(bf.sec, sw)];
  const light = sec === undefined ? fallbackLight : sec.light;

  const gain = upper ? tab.gainUp[id] : tab.gainLo[id];
  /*
   * Wolf3D's per-axis discount, but **interpolated by the surface's own
   * normal** rather than switched on it. Taken as a branch it is a 26% step in
   * brightness at every point where the fold's dominant axis changes — which
   * on a field is not a wall corner but a *cone*, so every bay rib and every
   * outside corner grew a hard V of shadow across a surface that is physically
   * continuous. The interpolation costs one divide and there is no seam left.
   */
  const sideK = SIDE_SHADE + (1 - SIDE_SHADE) * (ax / (ax + ay + 1e-6));
  let lit = litAt(t, light, cone) * gain * sideK + tab.emit[id];
  /*
   * Past the lamp and into the fog there is nothing left to see of the tile: a
   * `lit` of 0.02 is five values out of 255 whatever the texel says. This is
   * the difference between the fold's shading being paid for over the whole
   * frame and being paid for over the part of the frame you can actually make
   * out — which on a dead ship is most of it, since a sector's own light is
   * 0.03 forward and the lamp reaches seven cells.
   */
  if (lit < 0.02 && tab.glow[id] < 0.01) return pack(74 * lit, 80 * lit, 88 * lit);
  // the crease: one row of hard shadow in the inside corner, so the fold has a
  // line in it rather than only a change of slope
  if (upper ? v <= 0.02 : v >= 0.98) lit *= upper ? CREASE_UPPER : CREASE_LOWER;

  let r: number;
  let g: number;
  let b: number;
  const tex = upper ? tab.texUp[id] : tab.texLo[id];
  if (tex) {
    let u = (axisX ? wy : wx) * (upper ? tab.repUp[id] : tab.repLo[id]);
    u -= Math.floor(u);
    let tu = (u * tex.w) | 0;
    if (tu >= tex.w) tu = tex.w - 1;
    // keep the texture's handedness consistent around a corner
    if (axisX ? gx > 0 : gy < 0) tu = tex.w - 1 - tu;
    let tv = (v * tex.h) | 0;
    if (tv >= tex.h) tv = tex.h - 1;
    const o = (tv * tex.w + tu) << 2;
    r = tex.data[o] * lit;
    g = tex.data[o + 1] * lit;
    b = tex.data[o + 2] * lit;
  } else {
    r = 74 * lit;
    g = 80 * lit;
    b = 88 * lit;
  }

  /*
   * The painted light channel, as light. Emissive, so it is not fogged — light
   * gets fainter with distance, it does not get black paint over it — and added
   * straight into the byte, which is what `lighter` would have done anyway now
   * that the surface owns its own pixels.
   */
  const glow = tab.glow[id] * light;
  if (glow > 0.01) {
    let a = 0;
    if (v >= GLOW_V0 && v < GLOW_V1) a = 0.5;
    else if (v >= HALO_V0 && v < HALO_V1) a = 0.17;
    if (a > 0) {
      const k = glow * a * (1 - fogAt(t) * 0.55) * 255;
      r += (GLOW_R / 255) * k;
      g += (GLOW_G / 255) * k;
      b += (GLOW_B / 255) * k;
    }
  }

  return pack(r, g, b);
}

/**
 * A pixel of flat overhead found by the upper march rather than by the row
 * cast: same plating, but at the distance a *locally* taller space puts it,
 * which is the only way a two-deck compartment reads as two decks from the
 * corridor outside it.
 */
function ceilPixel(
  level: FpsLevel,
  deck: DeckPixels | null,
  t: number,
  wx: number,
  wy: number,
  cone: number,
): number {
  const light = level.sectors[sectorAt(level, wx, wy)].light;
  const f = litAt(t, light, cone);
  if (!deck) return pack(30 * f, 34 * f, 41 * f);
  const cx = Math.floor(wx);
  const cy = Math.floor(wy);
  const o =
    ((((wy - cy) * deck.h) & deck.maskY) * deck.w + (((wx - cx) * deck.w) & deck.maskX)) << 2;
  return pack(
    deck.data[o] * f * CEIL_R,
    deck.data[o + 1] * f * CEIL_G,
    deck.data[o + 2] * f * CEIL_B,
  );
}

/* --------------------------------------------------------------------- faces */

/**
 * The vertical faces, and the ridge either side of them.
 *
 * This is all that is left of the old wall pass: one plane at one perpendicular
 * distance, which means one fog value is exact and a 1px `drawImage` column is
 * the right tool. The column is also **shorter than it used to be** — it starts
 * at the vertical face and stops there, with the folds above and below it
 * belonging to the marched heightfield in `castBevel`.
 */
function drawFaces(
  ctx: CanvasRenderingContext2D,
  W: number,
  H: number,
  mat: RayMaterials,
  cols: Cols,
): void {
  const glows: Glow[] = [];
  const cone = coneTable(W);

  for (let x = 0; x < W; x++) {
    const cell = cols.cell[x];
    if (cell <= 0) continue;
    const fullTop = cols.faceTopRow[x];
    const fullBot = cols.faceBotRow[x];
    if (fullBot <= fullTop) continue;
    /*
     * This pass paints after the backdrop, so where a nearer fold has already
     * claimed rows inside this column's face band — a corner's ridge standing
     * in front of the wall behind it — the blit has to be cut to what is left.
     * The source rectangle is cut by the same fraction so the tile does not
     * slide inside the strip.
     */
    const yTop = fullTop > cols.clipTop[x] ? fullTop : cols.clipTop[x];
    const yBot = fullBot < cols.clipBot[x] ? fullBot : cols.clipBot[x];
    if (yBot <= yTop) continue;
    const span = fullBot - fullTop;
    const v0 = (yTop - fullTop) / span;
    const v1 = (yBot - fullTop) / span;

    const dist = cols.dist[x];
    const light = cols.light[x];
    const coneK = cone[x];
    const emit = cols.emit[x];
    const sideK = cols.side[x] === 1 ? SIDE_SHADE : 1;
    const tex = mat.texture(cell, WallBand.Main, cols.variant[x]);

    const litFace = litAt(dist, light, coneK) * mat.gain(cell, WallBand.Main) * sideK + emit;
    if (tex) {
      const rep = mat.repeat(cell, WallBand.Main) * cols.repScale[x];
      const along = cols.side[x] === 0 ? cols.camY : cols.camX;
      const ray = cols.side[x] === 0 ? cols.rayY[x] : cols.rayX[x];
      const w = texW(tex);
      const th = texHOf(tex);
      let u = (along + dist * ray) * rep + cols.faceOff[x];
      u -= Math.floor(u);
      let t = Math.min(w - 1, Math.floor(u * w));
      if (cols.faceFlip[x]) t = w - t - 1;
      ctx.drawImage(
        tex,
        t,
        th * v0,
        1,
        Math.max(0.01, th * (v1 - v0)),
        x,
        yTop,
        1,
        yBot - yTop,
      );
    } else {
      ctx.fillStyle = "#565c64";
      ctx.fillRect(x, yTop, 1, yBot - yTop);
    }
    shade(ctx, x, yTop, yBot - yTop, litFace);

    // --- the channel where it crosses the vertical face, closing the ring.
    // The face is one plane at one distance, so v maps linearly onto rows.
    const glowK = cols.glow[x];
    if (glowK > 0.01) {
      const fade = 1 - fogAt(dist) * 0.55;
      // measured against the *unclipped* face, then trimmed to what is visible
      const strip = (a0: number, a1: number, a: number): void => {
        let r0 = Math.round(fullTop + span * a0);
        let r1 = Math.round(fullTop + span * a1);
        if (r0 < yTop) r0 = yTop;
        if (r1 > yBot) r1 = yBot;
        if (r1 - r0 >= 1) glows.push({ x, y: r0, h: r1 - r0, a: glowK * fade * a });
      };
      strip(FACE_HALO_V0, FACE_HALO_V1, 0.17);
      strip(FACE_GLOW_V0, FACE_GLOW_V1, 0.5);
    }

    /*
     * The ridge where the fold meets the face. In the references that is a
     * physical edge with the light dying across it, and one dark pixel is
     * enough to state it — without it the three surfaces blend and the section
     * reads as one flat wall however differently they are shaded. Only drawn on
     * an end a nearer fold has not already taken.
     */
    ctx.fillStyle = SEAM;
    if (yTop > 0 && yTop === fullTop) ctx.fillRect(x, yTop, 1, 1);
    if (yBot < H && yBot === fullBot) ctx.fillRect(x, yBot - 1, 1, 1);
  }

  // one composite-op switch for every emissive strip in the frame
  if (glows.length) {
    ctx.globalCompositeOperation = "lighter";
    for (const g of glows) {
      ctx.fillStyle = glowStyle(g.a);
      ctx.fillRect(g.x, g.y, 1, g.h);
    }
    ctx.globalCompositeOperation = "source-over";
  }
}

function texW(tex: CanvasImageSource): number {
  return (tex as HTMLImageElement).naturalWidth || (tex as HTMLCanvasElement).width;
}
function texHOf(tex: CanvasImageSource): number {
  return (tex as HTMLImageElement).naturalHeight || (tex as HTMLCanvasElement).height;
}

/**
 * Paint the missing light onto a strip. `lit` of 1 leaves it alone.
 *
 * The alpha is quantised into a table of ready-made colour strings. A frame
 * shades one strip per column and building `rgba(0,0,0,0.123)` for each of them
 * was measurable. 48 steps is finer than an 8-bit channel resolves over a 1px
 * strip.
 */
const SHADE_STEPS = 48;
const SHADE_STR: string[] = [];
for (let i = 0; i < SHADE_STEPS; i++) {
  SHADE_STR.push(`rgba(0,0,0,${(i / (SHADE_STEPS - 1)).toFixed(3)})`);
}

function shade(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  h: number,
  lit: number,
): void {
  const a = 1 - lit;
  if (a <= 0.01) return;
  const i = a >= 1 ? SHADE_STEPS - 1 : ((a * (SHADE_STEPS - 1) + 0.5) | 0);
  ctx.fillStyle = SHADE_STR[i];
  ctx.fillRect(x, y, 1, h);
}

/** The same trick for the emissive strips, which are one colour at many alphas. */
const GLOW_STEPS = 32;
const GLOW_STR: string[] = [];
for (let i = 0; i < GLOW_STEPS; i++) {
  GLOW_STR.push(`rgba(${GLOW_RGB},${(i / (GLOW_STEPS - 1)).toFixed(3)})`);
}
function glowStyle(a: number): string {
  const i = a >= 1 ? GLOW_STEPS - 1 : ((a * (GLOW_STEPS - 1) + 0.5) | 0);
  return GLOW_STR[i];
}

/* ------------------------------------------------------------------- sprites */

function drawSprites(
  ctx: CanvasRenderingContext2D,
  W: number,
  H: number,
  proj: number,
  level: FpsLevel,
  cam: RayCamera,
  dirX: number,
  dirY: number,
  planeX: number,
  planeY: number,
  sprites: RaySprite[],
  depth: Float32Array,
): void {
  if (!sprites.length || !scratchCtx) return;
  const half = H / 2;
  const cone = coneTable(W);
  const invDet = 1 / (planeX * dirY - dirX * planeY);

  // back to front, so overlapping billboards stack correctly
  const order = sprites
    .map((s, i) => ({
      i,
      d: (s.x - cam.x) * (s.x - cam.x) + (s.y - cam.y) * (s.y - cam.y),
    }))
    .sort((a, b) => b.d - a.d);

  for (const { i } of order) {
    const s = sprites[i];
    if (s.alpha <= 0.01) continue;
    const relX = s.x - cam.x;
    const relY = s.y - cam.y;
    const transformX = invDet * (dirY * relX - dirX * relY);
    const transformY = invDet * (-planeY * relX + planeX * relY);
    if (transformY <= 0.05) continue;

    const screenX = (W / 2) * (1 + transformX / transformY);
    const sh = (proj / transformY) * s.scale;
    const sw = sh; // Nova's frames are square
    // camera sits at mid-wall (0.5); hover is the billboard centre above the
    // deck, in wall heights, so it shares the wall's projection exactly
    const centreY = half + ((0.5 - s.hover) * proj) / transformY;
    const topY = centreY - sh / 2;

    const left = screenX - sw / 2;
    const first = Math.max(0, Math.floor(left));
    const last = Math.min(W, Math.ceil(left + sw));
    if (last <= first) continue;

    // tint the frame first: fog has to respect the sprite's own alpha, which a
    // rect drawn over the scene would not
    const fs = s.frameSize;
    /*
     * A thing standing in a dead section is as dark as the section — but it is
     * also in the lamp, and through exactly the same falloff the walls use, or
     * a Wraith three cells away would be invisible against a bulkhead you can
     * see perfectly well. The cone is sampled at the billboard's own column.
     */
    const light = level.sectors[sectorAt(level, s.x, s.y)].light;
    const coneK = cone[Math.min(W - 1, Math.max(0, screenX | 0))];
    const fog = 1 - litAt(transformY, light, coneK);
    scratchCtx.clearRect(0, 0, scratch.width, scratch.height);
    scratchCtx.drawImage(s.img, s.frame * fs, 0, fs, fs, 0, 0, fs, fs);
    scratchCtx.globalCompositeOperation = "source-atop";
    // light does not get fogged the way a surface does — it just gets fainter,
    // which is the alpha below rather than black painted over it
    if (!s.additive && fog > 0.002) {
      scratchCtx.fillStyle = `rgba(0,0,0,${fog.toFixed(3)})`;
      scratchCtx.fillRect(0, 0, fs, fs);
    }
    if (s.flash > 0.002) {
      scratchCtx.fillStyle = `rgba(255,210,190,${Math.min(0.85, s.flash).toFixed(3)})`;
      scratchCtx.fillRect(0, 0, fs, fs);
    }
    scratchCtx.globalCompositeOperation = "source-over";

    if (s.additive) {
      ctx.globalCompositeOperation = "lighter";
      ctx.globalAlpha = s.alpha * (1 - fog * 0.7);
    } else {
      ctx.globalAlpha = s.alpha;
    }
    // batch contiguous unoccluded columns into one blit each
    let runStart = -1;
    const flush = (endExcl: number): void => {
      if (runStart < 0) return;
      const sx0 = ((runStart - left) * fs) / sw;
      const sx1 = ((endExcl - left) * fs) / sw;
      ctx.drawImage(
        scratch,
        sx0,
        0,
        Math.max(0.01, sx1 - sx0),
        fs,
        runStart,
        topY,
        endExcl - runStart,
        sh,
      );
      runStart = -1;
    };
    for (let stripe = first; stripe < last; stripe++) {
      if (transformY < depth[stripe]) {
        if (runStart < 0) runStart = stripe;
      } else {
        flush(stripe);
      }
    }
    flush(last);
    ctx.globalAlpha = 1;
    ctx.globalCompositeOperation = "source-over";
  }
}

/*
 * There was a `drawLamp()` here — a radial gradient over the finished frame.
 * It is gone on purpose. A screen-space vignette darkens the *frame*, which
 * moves with the camera and not with the ship, so it never reads as a light you
 * are carrying; it reads as a smudged lens. The lamp is `lampAt()`, applied per
 * surface at that surface's real distance, and every one of walls, the fold,
 * deck, overhead and billboards goes through it — which is what makes them
 * agree about how far away things are.
 */
