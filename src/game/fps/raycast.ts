/**
 * The raycaster. Pure rendering — it knows about a grid, a camera and a list of
 * billboards, and nothing about the game.
 *
 * Wolf3D-style on purpose: the enemies are Nova's own hulls, which ship as
 * horizontal strips of 36 pre-rendered rotations, and that is the one thing a
 * DDA-plus-billboard renderer consumes and nothing else does.
 *
 * ## The corridor is an octagon in section, and the chamfers are *surfaces*
 *
 * `art-reference/damage/damage.png` and `corridors/corridor-lit.png` both show
 * the same cross-section: deck, 45 degree lower chamfer, vertical wall, 45
 * degree upper chamfer, overhead. Those angles are **not** floor-plan angles —
 * neither corridor bends — so the plan stays a grid.
 *
 * The first cut of this drew each chamfer as a *band inside the wall column*: a
 * strip of texture between two projected boundary rows, its `v` stepping
 * linearly down the band. The boundary rows were right, and it still read as a
 * straight tube, for two reasons that only a cast surface fixes:
 *
 * - **A band has no perspective across its own slope.** The chamfer runs *back
 *   toward the camera* — at the bottom of the frame it is a few centimetres
 *   from your boot and at the top of the band it is at the wall — and `v`
 *   stepping linearly in screen rows is precisely the affine texture-warp
 *   artifact. Its panel runs did not converge with the corridor, so the eye
 *   read a wall, not a floor folding up.
 * - **The deck kept its own texture right up to the band.** Sharing a boundary
 *   row is not the same as one surface yielding footprint to another: both were
 *   drawn to the last pixel with the same plate and near enough the same
 *   brightness, and a fold you cannot see the brightness change across is not a
 *   fold.
 *
 * So the chamfer is now solved **per pixel, against its own sloped plane**,
 * exactly the way the deck is solved against the deck plane. `composeBackdrop`
 * owns four surfaces — overhead, upper chamfer, lower chamfer, deck — and every
 * one of them is a plane the ray is intersected with, textured at the world
 * point it actually lands on. The deck is genuinely narrower than the corridor
 * because the chamfer *takes* those pixels and shades them as its own surface;
 * the wall column left for `drawFaces` is the vertical face and nothing else.
 *
 * The solve is closed-form and costs one divide. For a wall the DDA has already
 * hit at perpendicular distance `dist`, with `delta` the ray parameter per cell
 * on the hit axis:
 *
 *     h = q * t                      (a screen row's height/depth ratio, q signed)
 *     h = hw + m * s                 (the chamfer plane; s is the inward run)
 *     s = D0 - t / delta             (how far in from the wall the ray has got)
 *  => t = (hw * delta + m * dist) / (q * delta + m)
 *
 * with `m` -1 for the lower chamfer (it falls away from the wall) and +1 for the
 * upper, and `hw` the plane's height *at the wall*. Substituting the band's own
 * end points back into it returns `dist` at the ridge and `dist - cham*delta` at
 * the deck edge, which is where the old band's two boundary rows came from — so
 * the silhouette is the same one it always computed, and what changed is that
 * every pixel between them now knows its own distance, its own world position
 * and its own light.
 *
 * Everything still goes through the one projection constant `proj`, so
 * billboards keep sharing the walls' scale exactly.
 *
 * ## ...and where the wall stops, the section terminates into a *frame*
 *
 * A chamfer is anchored to a wall plane. At a junction there is no near wall
 * for it to run against, so the section simply stopped: deck straight up to
 * ceiling, square corners, and since the derelict is a grid of crossing
 * corridors that is what the player was looking at most of the time. The whole
 * thing read as a square tube even where the spine's own section was right.
 *
 * A raycaster cannot wrap a 45 degree fold around a corner, and trying is the
 * wrong instinct anyway — real ships do not. They do what
 * `art-reference/airlock/airlock.png` does: terminate the run into a **flat
 * bulkhead with an octagonal hole in it**. That is a doorway, and a doorway is
 * something a DDA has always been able to do.
 *
 * So `level.ts` finds every interrupted wall run and hangs an `FpsPortal` in
 * it, and the DDA, on crossing one, asks where along the opening it crossed:
 *
 * - **Inside the aperture** — the ray carries on into the space beyond, and the
 *   column remembers the portal so the pixels above and below the hole can be
 *   drawn as plate. Up to `MAX_PORTALS` of these stack down one sightline,
 *   which is how a run of junctions comes out as nested rings receding.
 * - **On the frame** — the ray stops there. The column is a flat plate at that
 *   distance, deck to overhead, with no chamfer of its own, because a bulkhead
 *   is flat.
 *
 * The aperture is the corridor's own section scaled about its centre (see
 * `section.ts`), so the octagon runs continuously out of one space, through the
 * hole, and into the next; the frame is what is left over in the four corners.
 * `drawFaces` clips the vertical face to the apertures the column passed
 * through, since it paints after the backdrop and would otherwise cover them.
 *
 * ## Light — the sector, and the lamp you are carrying
 *
 * Two terms, added.
 *
 * The **sector** term is Doom's model: fog by distance times the light level of
 * an *area* (see `FpsSector`). A wall is lit by the sector you are looking at it
 * *from*, so the renderer takes the sector of the last open cell before the hit.
 *
 * That alone was the whole light model in round one, and it made a dead section
 * uniformly, evenly black — you navigated it by the minimap. Which is wrong at
 * the level of premise: you are carrying the only light on a dead ship, so dark
 * has to mean "you can see three metres", never "you can see nothing".
 *
 * So the second term is the **suit lamp**, and it is a function of real
 * distance, not a vignette painted over the frame. Every surface here already
 * knows how far away it is — the DDA's ray parameter for walls, the plane solve
 * for the deck, overhead and both chamfers, the camera-space depth for
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
 * the art direction. On the chamfers that is added straight into the pixel (we
 * own the byte, so a clamped add *is* `lighter`); on the vertical face, which is
 * still blitted with `drawImage`, it is batched and flushed in one composite-op
 * switch at the end of the face pass rather than 480 times.
 */

import { DECK_Y, chamferRun } from "./section";
import { WallBand, type DeckPixels, type FpsLevel } from "./types";

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
 * The deck's own brightness, against the chamfer gains in `textures.ts`.
 *
 * This is the other half of making the fold read. A 45 degree bench turned up
 * into the room catches light the deck does not, and the wall face catches less
 * than either — so the section is a *staircase* of brightness, deck → chamfer →
 * face, with a step at each fold. Left at 1.0 the deck was the brightest thing
 * in the frame and the lower chamfer, however correctly it was cast, had
 * nothing to be brighter *than*.
 */
const DECK_GAIN = 0.72;

/**
 * The crease. One row of hard shadow in the inside corner where the chamfer
 * meets the deck (and where it meets the overhead), because a real fold has a
 * line in it and a single dark pixel states an edge better than any amount of
 * gradient. Drawn on the chamfer's own last row so it moves with the surface.
 */
const CREASE_LOWER = 0.42;
const CREASE_UPPER = 0.55;

/** Fog opacity by distance, sampled into a LUT so the inner loop has no exp(). */
const FOG_STEPS = 128;
const FOG_RANGE = 22;
const FOG_MAX = 0.88;
const FOG_K = 0.135;
const FOG_LUT = new Float32Array(FOG_STEPS);
for (let i = 0; i < FOG_STEPS; i++) {
  const d = (i / (FOG_STEPS - 1)) * FOG_RANGE;
  FOG_LUT[i] = Math.min(FOG_MAX, 1 - Math.exp(-d * FOG_K));
}
function fogAt(dist: number): number {
  const i = Math.min(FOG_STEPS - 1, Math.max(0, ((dist / FOG_RANGE) * (FOG_STEPS - 1)) | 0));
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
const LAMP_STEPS = 128;
const LAMP_RANGE = 7;
const LAMP_HALF = 1.5;
const LAMP_MAX = 0.6;
/** How much of the lamp survives at the edge of the view — a cone, not a spot. */
const LAMP_EDGE = 0.55;
const LAMP_LUT = new Float32Array(LAMP_STEPS);
for (let i = 0; i < LAMP_STEPS; i++) {
  const d = (i / (LAMP_STEPS - 1)) * LAMP_RANGE;
  const q = d / LAMP_HALF;
  const cut = Math.max(0, 1 - (d / LAMP_RANGE) * (d / LAMP_RANGE));
  LAMP_LUT[i] = (LAMP_MAX / (1 + q * q)) * cut;
}
function lampAt(dist: number): number {
  if (dist >= LAMP_RANGE) return 0;
  const i = Math.max(0, ((dist / LAMP_RANGE) * (LAMP_STEPS - 1)) | 0);
  return LAMP_LUT[i];
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
  const v = light * (1 - fogAt(dist)) + lampAt(dist) * cone;
  return v > 1 ? 1 : v;
}

/** Shading on a north/south face relative to an east/west one — the Wolf3D cheat. */
const SIDE_SHADE = 0.74;

/**
 * Where the trim tile's lit channel sits, as a fraction across the chamfer.
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
 * 1024. Lighting this as well as the chamfers is what closes the light into a
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

/** The ridge between a chamfer and the vertical face. */
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
  /** wall id → emissive strength of its chamfer channels, before sector light */
  glow: (id: number) => number;
  /** wall id → self-illumination added after fog and lamp; doors only */
  emit: (id: number) => number;
  /** wall id → how far its plane steps in toward the corridor centre, in cells */
  inset: (id: number) => number;
  /**
   * The wall id to dress a framed opening's plate with. It is never a cell in
   * the grid — it is asked for by id so the renderer stays material-agnostic
   * and `textures.ts` keeps owning what a surface looks like.
   */
  frameId: number;
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
   * One projection constant for walls, chamfers, deck, overhead and billboards
   * alike: a wall is exactly PROJ/dist tall on screen, so a sprite of scale 1 is
   * exactly deck-height and `hover` reads in wall heights (0.5 being eye level).
   */
  const proj = H * WALL_H;

  const cols = castColumns(W, H, proj, level, cam, dirX, dirY, planeX, planeY, mat, depth);
  composeBackdrop(ctx, W, H, proj, level, cam, dirX, dirY, planeX, planeY, mat.deck, cols);
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
 * free. The chamfers are not: they are solved per pixel against their own
 * sloped plane, which needs the texels rather than an image. Keyed off the
 * image object itself, so a material swap costs one rasterise and no bookkeeping.
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

/* ------------------------------------------------------------------ columns */

/**
 * Everything one screen column's DDA produced, in parallel typed arrays.
 *
 * Two passes read this — the per-pixel backdrop and the face blit — so the DDA
 * runs once and both agree about where the section's boundaries are, which is
 * what keeps the deck edge, the chamfer and the wall foot from drifting a row
 * apart from each other.
 */
/**
 * How many framed openings one column can pass through before the renderer
 * stops counting. Four is a straight run of two junctions, which is as far as
 * the derelict's plan ever lets you see; past that the rings are a pixel high.
 */
const MAX_PORTALS = 4;

/** How far the lit rim tracing an aperture reaches onto the plate, in cells. */
const RIM = 0.04;
/** ...and how hard it burns, before the plate's own `glow`. */
const RIM_BURN = 74;

/**
 * How much of a frame plate's brightness survives at grazing incidence.
 *
 * `SIDE_SHADE` is Wolf3D's cheat — a flat discount for one of the two axes —
 * and it is enough for cell walls, which are only ever seen from the open side.
 * A plate is not: a portal in a corridor's *side* wall is crossed at a hand's
 * breadth off parallel by every ray going down that corridor, and at 0.92 gain
 * it came out as a bright full-height sliver standing in the wall. Shading it
 * by how square-on the ray meets the plane costs one divide per crossing (the
 * ray's length is constant down a column) and puts the sliver back into the
 * wall it belongs to.
 */
const PLATE_GRAZE = 0.34;

interface Cols {
  w: number;
  /** the camera this frame, so the two passes can re-derive a world point */
  camX: number;
  camY: number;
  /** perpendicular distance to the vertical face's plane (inset applied) */
  dist: Float32Array;
  /** ray parameter per cell on the axis that was hit — the chamfer solve needs it */
  delta: Float32Array;
  rayX: Float32Array;
  rayY: Float32Array;
  cell: Int32Array;
  side: Uint8Array;
  flip: Uint8Array;
  faceFlip: Uint8Array;
  faceOff: Float32Array;
  variant: Int32Array;
  repScale: Float32Array;
  light: Float32Array;
  emit: Float32Array;
  glow: Float32Array;
  cham: Float32Array;
  /** section heights, in world units, for this column's wall */
  faceBotY: Float32Array;
  faceTopY: Float32Array;
  ceilY: Float32Array;
  /** the four screen-row boundaries, top to bottom */
  ceilRow: Int32Array;
  faceTopRow: Int32Array;
  faceBotRow: Int32Array;
  deckRow: Int32Array;
  /** chamfer dressing, resolved once per column */
  texLo: (TexPixels | null)[];
  texUp: (TexPixels | null)[];
  repLo: Float32Array;
  repUp: Float32Array;
  gainLo: Float32Array;
  gainUp: Float32Array;
  /*
   * The framed openings this column passed through, near to far, `MAX_PORTALS`
   * slots per column. Everything about a plate is here rather than looked up
   * again in the pixel loop, because a portal's plane is at one distance and
   * one along-wall position for the whole column — only the height varies.
   */
  pCount: Int32Array;
  pDist: Float32Array;
  /** the along-wall world coordinate the ray crossed the plane at */
  pAlong: Float32Array;
  /** the aperture's open height range at that crossing, in world units */
  pLo: Float32Array;
  pHi: Float32Array;
  /** the plate's own top, in world units */
  pCeil: Float32Array;
  pLight: Float32Array;
  /** how square-on the ray met the plate, as a brightness multiplier */
  pFacing: Float32Array;
  pFlip: Uint8Array;
  /** 1 where the ray met plate rather than hole, so the trace stopped here */
  pSolid: Uint8Array;
  pCeilRow: Int32Array;
  pApTopRow: Int32Array;
  pApBotRow: Int32Array;
  pDeckRow: Int32Array;
  /** the vertical face's visible window: every aperture the column crossed */
  clipTop: Int32Array;
  clipBot: Int32Array;
  /** the plate's dressing, resolved once per frame */
  frameTex: TexPixels | null;
  frameGain: number;
  frameRep: number;
  frameGlow: number;
}

let colCache: Cols | null = null;

function colsFor(W: number): Cols {
  if (colCache && colCache.w === W) return colCache;
  colCache = {
    w: W,
    camX: 0,
    camY: 0,
    dist: new Float32Array(W),
    delta: new Float32Array(W),
    rayX: new Float32Array(W),
    rayY: new Float32Array(W),
    cell: new Int32Array(W),
    side: new Uint8Array(W),
    flip: new Uint8Array(W),
    faceFlip: new Uint8Array(W),
    faceOff: new Float32Array(W),
    variant: new Int32Array(W),
    repScale: new Float32Array(W),
    light: new Float32Array(W),
    emit: new Float32Array(W),
    glow: new Float32Array(W),
    cham: new Float32Array(W),
    faceBotY: new Float32Array(W),
    faceTopY: new Float32Array(W),
    ceilY: new Float32Array(W),
    ceilRow: new Int32Array(W),
    faceTopRow: new Int32Array(W),
    faceBotRow: new Int32Array(W),
    deckRow: new Int32Array(W),
    texLo: new Array<TexPixels | null>(W).fill(null),
    texUp: new Array<TexPixels | null>(W).fill(null),
    repLo: new Float32Array(W),
    repUp: new Float32Array(W),
    gainLo: new Float32Array(W),
    gainUp: new Float32Array(W),
    pCount: new Int32Array(W),
    pDist: new Float32Array(W * MAX_PORTALS),
    pAlong: new Float32Array(W * MAX_PORTALS),
    pLo: new Float32Array(W * MAX_PORTALS),
    pHi: new Float32Array(W * MAX_PORTALS),
    pCeil: new Float32Array(W * MAX_PORTALS),
    pLight: new Float32Array(W * MAX_PORTALS),
    pFacing: new Float32Array(W * MAX_PORTALS),
    pFlip: new Uint8Array(W * MAX_PORTALS),
    pSolid: new Uint8Array(W * MAX_PORTALS),
    pCeilRow: new Int32Array(W * MAX_PORTALS),
    pApTopRow: new Int32Array(W * MAX_PORTALS),
    pApBotRow: new Int32Array(W * MAX_PORTALS),
    pDeckRow: new Int32Array(W * MAX_PORTALS),
    clipTop: new Int32Array(W),
    clipBot: new Int32Array(W),
    frameTex: null,
    frameGain: 0.9,
    frameRep: 2,
    frameGlow: 0.85,
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
  c.camX = cam.x;
  c.camY = cam.y;
  // one plate material for the whole frame — every framed opening wears it
  c.frameTex = texPixels(mat.texture(mat.frameId, WallBand.Main, 0));
  c.frameGain = mat.gain(mat.frameId, WallBand.Main);
  c.frameRep = mat.repeat(mat.frameId, WallBand.Main);
  c.frameGlow = mat.glow(mat.frameId);

  for (let x = 0; x < W; x++) {
    const cameraX = (2 * x) / W - 1;
    const rayX = dirX + planeX * cameraX;
    const rayY = dirY + planeY * cameraX;
    c.rayX[x] = rayX;
    c.rayY[x] = rayY;
    // constant down the column, and only the plates need it
    const rayLen = Math.sqrt(rayX * rayX + rayY * rayY);

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
    let pCount = 0;
    /** slot of the portal the ray met plate on, if it stopped on one */
    let blocked = -1;
    const pBase = x * MAX_PORTALS;
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

      /*
       * Still open deck — but the face just crossed may be a framed opening.
       * The plane crossed is the one *behind* the step just taken, and the ray
       * parameter there is `side - delta`, which is the same expression the
       * wall distance below uses.
       */
      if (pCount >= MAX_PORTALS) continue;
      const pid =
        side === 0
          ? level.portalEW[mapY * (level.w + 1) + (stepX > 0 ? mapX : mapX + 1)]
          : level.portalNS[(stepY > 0 ? mapY : mapY + 1) * level.w + mapX];
      if (pid === 0) continue;
      const tc = side === 0 ? sideX - deltaX : sideY - deltaY;
      if (tc <= 0.02) continue;

      const P = level.portals[pid - 1];
      const along = side === 0 ? cam.y + tc * rayY : cam.x + tc * rayX;
      let off = along - (P.a0 + P.a1) / 2;
      if (off < 0) off = -off;
      /*
       * The aperture's open height range at this offset. Outside the corner
       * runs it is the full hole; inside one, the 45 degree cut takes the same
       * amount off the top and the bottom — which is the octagon, and it is
       * the corridor's own section stood up in the wall plane.
       */
      const inFromEdge = P.hw - off;
      let lo = DECK_Y + P.yb;
      let hi = DECK_Y + P.yt;
      if (inFromEdge < P.cham) {
        const cut = P.cham - inFromEdge;
        lo += cut;
        hi -= cut;
      }
      const solid = inFromEdge <= 0 || hi <= lo;
      if (solid) lo = hi = (lo + hi) / 2;

      const psec = level.sectors[P.sector];
      const b = pBase + pCount;
      c.pDist[b] = tc;
      c.pAlong[b] = along;
      c.pLo[b] = lo;
      c.pHi[b] = hi;
      c.pCeil[b] = DECK_Y + P.ceil;
      c.pLight[b] = psec.light;
      const n = side === 0 ? (rayX < 0 ? -rayX : rayX) : rayY < 0 ? -rayY : rayY;
      c.pFacing[b] = PLATE_GRAZE + (1 - PLATE_GRAZE) * (n / rayLen);
      c.pFlip[b] = (side === 0 && rayX > 0) || (side === 1 && rayY < 0) ? 1 : 0;
      c.pSolid[b] = solid ? 1 : 0;
      pCount++;
      if (solid) {
        blocked = pCount - 1;
        break;
      }
    }

    /*
     * The plates' screen rows, and the window they leave the vertical face.
     * Snapped to whole rows for the same reason the section's own boundaries
     * are: a ring four bays down is a fraction of a pixel and a sub-pixel edge
     * against a near-black derelict reads as a chain of white dots.
     */
    let clipT = 0;
    let clipB = H;
    for (let k = 0; k < pCount; k++) {
      const b = pBase + k;
      const t = c.pDist[b];
      const at = clampRow(Math.round(half - (c.pHi[b] * proj) / t), H);
      const ab = clampRow(Math.round(half - (c.pLo[b] * proj) / t), H);
      c.pCeilRow[b] = clampRow(Math.round(half - (c.pCeil[b] * proj) / t), H);
      c.pApTopRow[b] = at;
      c.pApBotRow[b] = ab;
      c.pDeckRow[b] = clampRow(Math.round(half - (DECK_Y * proj) / t), H);
      if (at > clipT) clipT = at;
      if (ab < clipB) clipB = ab;
    }
    c.pCount[x] = pCount;
    c.clipTop[x] = clipT;
    c.clipBot[x] = clipB;

    if (blocked >= 0) {
      /*
       * The ray met plate rather than hole. A bulkhead is flat, so there is no
       * wall column here at all and no chamfer either: the portal band owns
       * every row between the plate's overhead and its deck, and the four
       * section boundaries collapse onto the horizon so nothing else claims one.
       */
      const t = c.pDist[pBase + blocked];
      depth[x] = t;
      c.cell[x] = 0;
      c.dist[x] = t;
      const mid = clampRow(Math.floor(half), H);
      c.ceilRow[x] = mid;
      c.faceTopRow[x] = mid;
      c.faceBotRow[x] = mid;
      c.deckRow[x] = mid;
      continue;
    }

    if (cell <= 0) {
      // No wall in this direction (a malformed level — the border is solid).
      // Collapse all four boundaries onto the horizon, which leaves the column
      // as flat overhead above and flat deck below with nothing between.
      depth[x] = Infinity;
      c.cell[x] = 0;
      c.dist[x] = Infinity;
      const mid = clampRow(Math.floor(half), H);
      c.ceilRow[x] = mid;
      c.faceTopRow[x] = mid;
      c.faceBotRow[x] = mid;
      c.deckRow[x] = mid;
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
     * `inset * delta` earlier along the ray.
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

    // taken *after* the inset may have flipped the side, so the chamfer solve
    // uses the axis the ray actually came in on
    const delta = side === 0 ? deltaX : deltaY;

    const sector =
      fromX < 0 || fromY < 0 || fromX >= level.w || fromY >= level.h
        ? level.sectors[0]
        : level.sectors[level.sectorOf[fromY * level.w + fromX]];

    /*
     * The section, in world units. The deck never moves — a sector's height
     * lifts the overhead and the upper chamfer with it, and nothing else.
     *
     * The chamfer's run is the sector's *fraction* taken against how wide the
     * space actually is at the point the wall is being seen from, so the same
     * 0.275 gives a one-cell passage a 45% deck and a compartment a fold you
     * can see. `section.ts` owns that, because the frames in the openings have
     * to come out the same shape or the octagon steps as you walk through one.
     */
    const span =
      fromX < 0 || fromY < 0 || fromX >= level.w || fromY >= level.h
        ? 1
        : level.freeSpan[fromY * level.w + fromX] || 1;
    const cham = chamferRun(sector.chamfer, span, sector.height);
    const ceilY = DECK_Y + sector.height;
    let faceBotY = DECK_Y + cham;
    let faceTopY = ceilY - cham;
    if (faceTopY < faceBotY) {
      // a crawlspace lower than two chamfers: the vertical face vanishes
      faceTopY = faceBotY = (DECK_Y + ceilY) / 2;
    }

    /*
     * Where the chamfer planes reach the deck and the overhead. Shifting the
     * wall plane inward by `cham` shifts the DDA's distance by `cham * delta`,
     * which is one multiply and no second trace — and substituting that back
     * into the per-pixel solve below returns exactly these rows, so the surface
     * and its own boundary agree to the pixel.
     */
    const near = Math.max(0.02, dist - cham * delta);

    /*
     * Boundaries are snapped to whole rows. They have to be: a chamfer forty
     * cells down the corridor is a fraction of a pixel high, and against a
     * near-black derelict a sub-pixel boundary comes out as chains of white
     * dots tracking the chamfer edges — the one artifact that reads instantly
     * as broken. Every surface rounds the same float for a shared boundary, so
     * they meet exactly and nothing shows through the join.
     */
    const ceilRow = clampRow(Math.round(half - (ceilY * proj) / near), H);
    const faceTopRow = clampRow(Math.round(half - (faceTopY * proj) / dist), H);
    const faceBotRow = clampRow(Math.round(half - (faceBotY * proj) / dist), H);
    const deckRow = clampRow(Math.round(half - (DECK_Y * proj) / near), H);

    const flip = (side === 0 && rayX > 0) || (side === 1 && rayY < 0);
    /*
     * The per-cell variant. It is deliberately applied to the **vertical face
     * only**: that is where the repetition shows, and the chamfers carry
     * continuous horizontal structure (a conduit run, a bench, a light channel)
     * that has to survive from one cell into the next or the corridor stops
     * reading as one corridor.
     */
    const hv = cellVariant(mapX, mapY);
    // one cell in eight takes the alternate tile; the rest are offset and
    // mirrored, which is free and enough on its own to kill the grid
    const variant = (hv & 7) === 0 ? 1 : 0;
    const sideK = side === 1 ? SIDE_SHADE : 1;

    c.dist[x] = dist;
    c.delta[x] = delta;
    c.cell[x] = cell;
    c.side[x] = side;
    c.flip[x] = flip ? 1 : 0;
    c.faceFlip[x] = (((hv >> 5) & 1) === 1 ? !flip : flip) ? 1 : 0;
    c.faceOff[x] = ((hv >> 3) & 3) * 0.25;
    c.variant[x] = variant;
    c.repScale[x] = repScale;
    c.light[x] = sector.light;
    c.emit[x] = mat.emit(cell);
    c.glow[x] = mat.glow(cell) * sector.light;
    c.cham[x] = cham;
    c.faceBotY[x] = faceBotY;
    c.faceTopY[x] = faceTopY;
    c.ceilY[x] = ceilY;
    c.ceilRow[x] = ceilRow;
    c.faceTopRow[x] = faceTopRow;
    c.faceBotRow[x] = faceBotRow;
    c.deckRow[x] = deckRow;
    c.texLo[x] = texPixels(mat.texture(cell, WallBand.Lower, 0));
    c.texUp[x] = texPixels(mat.texture(cell, WallBand.Upper, 0));
    c.repLo[x] = mat.repeat(cell, WallBand.Lower) * repScale;
    c.repUp[x] = mat.repeat(cell, WallBand.Upper) * repScale;
    c.gainLo[x] = mat.gain(cell, WallBand.Lower) * sideK;
    c.gainUp[x] = mat.gain(cell, WallBand.Upper) * sideK;
  }

  return c;
}

function clampRow(r: number, H: number): number {
  return r < 0 ? 0 : r > H ? H : r;
}

/* ------------------------------------------------------------------ backdrop */

/**
 * The four cast surfaces: overhead, upper chamfer, lower chamfer, deck.
 *
 * All of them are planes the ray is intersected with, so all of them are
 * textured at the world point they land on and lit by their own distance. The
 * deck's solve is the classic floor cast — a row at screen y is `proj / 2(y -
 * half)` away and the world span across it is linear in that — and the
 * chamfers' is the same idea against a plane tilted 45 degrees, closed form,
 * one divide per pixel (see the header).
 *
 * That is the whole point of the rewrite. A chamfer drawn as a *band* between
 * two rows shares a boundary with the deck but never takes the deck's
 * footprint: both surfaces run their own texture to the last pixel and the
 * silhouette stays a rectangular tube. Cast as a surface, the deck is genuinely
 * narrower than the corridor's widest point, the slope between them carries a
 * perspective that converges with the corridor, and the wall column left for
 * `drawFaces` is the vertical face only.
 *
 * The whole backdrop is composed in one ImageData and put down in one call; the
 * face pass then draws over the strip between `faceTopRow` and `faceBotRow`.
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
     * far as the walls beside them do. The chamfers cannot share it: every
     * pixel of a chamfer is at its own distance, which is what makes it read as
     * a slope, so they pay for their own LUT reads.
     */
    const flatLamp = lampAt(flatDist);
    /** height over depth for this screen row: positive above the horizon. */
    const q = (half - y) / proj;

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

      /*
       * The framed openings first, near to far — they stand in front of
       * everything the wall column produced. Each one owns the rows between
       * its overhead and the top of its hole, and between the bottom of its
       * hole and its deck; the rows inside the hole belong to whatever is
       * beyond, so the walk carries on to the next plate and finally to the
       * wall. Above the nearest plate's overhead and below its deck the
       * surfaces are the near sector's own, which the flat cast below already
       * draws — so those cases fall straight out of the loop.
       */
      const pc = cols.pCount[x];
      /*
       * ...and off the plate's own silhouette, everything beyond it is hidden.
       * That is not automatic: a wall's chamfer reaches its deck edge `cham *
       * delta` nearer than the wall itself, which at a grazing angle can be
       * further forward than the plate, and it leaked out under the bottom of
       * every doorway as a pair of legs down the deck. Above and below a plate
       * the surfaces are the near sector's, which is what the flat cast draws.
       */
      let occluded = false;
      if (pc > 0) {
        let plate = false;
        for (let k = 0; k < pc; k++) {
          const b = x * MAX_PORTALS + k;
          if (y < cols.pCeilRow[b] || y >= cols.pDeckRow[b]) {
            occluded = true;
            break;
          }
          if (y < cols.pApTopRow[b] || y >= cols.pApBotRow[b]) {
            px[p] = framePixel(b, q, cone[x], cols);
            plate = true;
            break;
          }
        }
        if (plate) continue;
      }

      /*
       * Which of the five spans owns this pixel. The four boundaries are
       * monotonic down the column by construction — the two chamfer edges are
       * projected at `near` and the two ridges at `dist`, and `near < dist` —
       * so this is one ordered chain and not a set of independent tests. It is
       * deliberately *not* branched on `up`: a sector low enough to swallow its
       * own vertical face would otherwise leave the rows between the collapsed
       * ridge and the horizon owned by nothing.
       */
      if (!occluded && y >= cols.ceilRow[x]) {
        if (y < cols.faceTopRow[x]) {
          px[p] = chamferPixel(x, q, cone[x], true, cols);
          continue;
        }
        if (y < cols.faceBotRow[x]) {
          px[p] = FACE_FILL;
          continue;
        }
        if (y < cols.deckRow[x]) {
          px[p] = chamferPixel(x, q, cone[x], false, cols);
          continue;
        }
      }

      // --- flat deck or overhead
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

  ctx.putImageData(backBuf, 0, 0);
}

/**
 * One chamfer pixel, solved against its own 45 degree plane.
 *
 *     h = q * t                  the screen row, as height over depth
 *     h = hw + m * s             the plane; s is how far in from the wall
 *     s = D0 - t / delta         and D0 * delta is the DDA's own `dist`
 *  => t = (hw * delta + m * dist) / (q * delta + m)
 *
 * `m` is -1 for the lower chamfer, which falls away from the wall toward the
 * deck, and +1 for the upper, which rises away from it toward the overhead.
 * Both denominators are bounded away from zero over the rows the surface
 * actually covers — below the horizon `q` is negative so the lower one is
 * `q*delta - 1 <= -1`, and above it the upper one is `q*delta + 1 >= 1` — but a
 * degenerate sector could hand us a chamfer that straddles the horizon, so it
 * is guarded rather than assumed.
 *
 * `v` runs 0..1 across the slope in the same direction the old band's texture
 * did (from the wall down for the lower chamfer, from the overhead in for the
 * upper), which is what keeps the trim tile's lit channel where it was measured.
 */
function chamferPixel(
  x: number,
  q: number,
  cone: number,
  upper: boolean,
  cols: Cols,
): number {
  const delta = cols.delta[x];
  const dist = cols.dist[x];
  const hw = upper ? cols.faceTopY[x] : cols.faceBotY[x];
  const den = upper ? q * delta + 1 : q * delta - 1;
  if (den > -1e-3 && den < 1e-3) return FACE_FILL;
  const t = (hw * delta + (upper ? dist : -dist)) / den;
  if (!(t > 0.01) || t > 1e5) return FACE_FILL;

  const cham = cols.cham[x];
  const h = q * t;
  const hTop = upper ? cols.ceilY[x] : cols.faceBotY[x];
  let v = (hTop - h) / cham;
  if (v < 0) v = 0;
  else if (v > 0.9999) v = 0.9999;

  const tex = upper ? cols.texUp[x] : cols.texLo[x];
  const gain = upper ? cols.gainUp[x] : cols.gainLo[x];

  let lit = litAt(t, cols.light[x], cone) * gain + cols.emit[x];
  // the crease: one row of hard shadow in the inside corner, so the fold has a
  // line in it rather than only a change of slope
  if (upper ? v <= 0.015 : v >= 0.985) lit *= upper ? CREASE_UPPER : CREASE_LOWER;

  let r: number;
  let g: number;
  let b: number;
  if (tex) {
    const along = cols.side[x] === 0 ? cols.rayY[x] : cols.rayX[x];
    const base = cols.side[x] === 0 ? cols.camY : cols.camX;
    let u = (base + t * along) * (upper ? cols.repUp[x] : cols.repLo[x]);
    u -= Math.floor(u);
    let tu = (u * tex.w) | 0;
    if (tu >= tex.w) tu = tex.w - 1;
    // keep the texture's handedness consistent around a corner
    if (cols.flip[x]) tu = tex.w - 1 - tu;
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
  const glow = cols.glow[x];
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
 * One pixel of a framed opening's plate.
 *
 * The easy surface in the whole renderer: a bulkhead is a flat vertical plane
 * at one distance, so the column already knows its depth, its along-wall
 * position and its light, and only the height varies down it. `u` therefore
 * does not move at all within a column and `v` is linear in world height.
 *
 * The rim is what makes the hole read as a hole. It is a lit line just outside
 * the aperture's edge, and because `lo` and `hi` are recomputed per column
 * against the octagon it traces the corner cuts as well as the top and bottom —
 * so the eight-sided silhouette is drawn in light on the plate, which is what
 * `airlock.png` does with a machined edge and a fixture above it. Columns that
 * met plate rather than hole have no aperture to trace and are skipped.
 */
function framePixel(b: number, q: number, cone: number, cols: Cols): number {
  const t = cols.pDist[b];
  const h = q * t;
  const ceil = cols.pCeil[b];
  const lit = litAt(t, cols.pLight[b], cone) * cols.frameGain * cols.pFacing[b];

  let r: number;
  let g: number;
  let bl: number;
  const tex = cols.frameTex;
  if (tex) {
    let u = cols.pAlong[b] * cols.frameRep;
    u -= Math.floor(u);
    let tu = (u * tex.w) | 0;
    if (tu >= tex.w) tu = tex.w - 1;
    if (cols.pFlip[b]) tu = tex.w - 1 - tu;
    let v = (ceil - h) / (ceil - DECK_Y);
    if (v < 0) v = 0;
    else if (v > 0.9999) v = 0.9999;
    let tv = (v * tex.h) | 0;
    if (tv >= tex.h) tv = tex.h - 1;
    const o = (tv * tex.w + tu) << 2;
    r = tex.data[o] * lit;
    g = tex.data[o + 1] * lit;
    bl = tex.data[o + 2] * lit;
  } else {
    r = 74 * lit;
    g = 80 * lit;
    bl = 88 * lit;
  }

  if (!cols.pSolid[b]) {
    const hi = cols.pHi[b];
    const d = h > hi ? h - hi : cols.pLo[b] - h;
    if (d < RIM) {
      // squared, so the line has an edge on it rather than a wide soft halo
      const f = 1 - d / RIM;
      const k = cols.frameGlow * f * f * (1 - fogAt(t) * 0.55) * RIM_BURN;
      r += (GLOW_R / 255) * k;
      g += (GLOW_G / 255) * k;
      bl += (GLOW_B / 255) * k;
    }
  }

  return pack(r, g, bl);
}

/* --------------------------------------------------------------------- faces */

/**
 * The vertical faces, and the ridge either side of them.
 *
 * This is all that is left of the old wall pass: one plane at one perpendicular
 * distance, which means one fog value is exact and a 1px `drawImage` column is
 * the right tool. The column is also **shorter than it used to be** — it starts
 * at the vertical face and stops there, with the chamfers above and below it
 * now belonging to the cast surfaces in `composeBackdrop`.
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
     * This pass paints after the backdrop, so a face seen *through* a framed
     * opening has to be clipped to the hole or the blit covers the plate the
     * backdrop just drew. `clipTop`/`clipBot` are the intersection of every
     * aperture the column passed through, and the source rectangle is cut by
     * the same fraction so the tile does not slide inside the strip.
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
     * The ridge where a chamfer meets the face. In the references that is a
     * physical edge with the light dying across it, and one dark pixel is
     * enough to state it — without it the three surfaces blend and the section
     * reads as one flat wall however differently they are shaded. Only drawn on
     * an end the aperture did not already cut off; a ridge inside a doorway is
     * a line across the hole.
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
 * surface at that surface's real distance, and every one of walls, chamfers,
 * deck, overhead and billboards goes through it — which is what makes them
 * agree about how far away they are.
 */
