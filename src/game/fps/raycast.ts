/**
 * The raycaster. Pure rendering — it knows about a grid, a camera and a list of
 * billboards, and nothing about the game.
 *
 * Wolf3D-style on purpose: the enemies are Nova's own hulls, which ship as
 * horizontal strips of 36 pre-rendered rotations, and that is the one thing a
 * DDA-plus-billboard renderer consumes and nothing else does.
 *
 * ## The corridor is an octagon in section
 *
 * `art-reference/damage/damage.png` and `corridors/corridor-lit.png` both show
 * the same cross-section: deck, 45 degree lower chamfer, vertical wall, 45
 * degree upper chamfer, overhead. Those angles are **not** floor-plan angles —
 * neither corridor bends. So the plan stays a grid and a wall column, which was
 * one vertical strip, becomes three bands.
 *
 * The band heights fall out of the distance the DDA already computes, with no
 * second trace. The chamfer is a plane sloping inward from the wall, so in plan
 * it occupies a strip `CHAMFER` cells wide in front of the wall — a strip the
 * ray crosses *before* it reaches the wall plane. The DDA's perpendicular
 * distance for a side-0 hit is `dx / rayX`, so shifting that plane inward by
 * `CHAMFER` shifts the distance by `CHAMFER * deltaX`, which is one multiply.
 * Project the deck at that nearer distance and the wall foot at the wall
 * distance and the lower chamfer is the span between them. Head-on that span is
 * short; looking down the length of a corridor `deltaX` is huge, the near
 * distance collapses toward the camera, and the chamfer sweeps down into the
 * bottom corners of the frame — which is what the references look like.
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
 * *from*, so the renderer takes the sector of the last open cell before the hit.
 *
 * That alone was the whole light model in round one, and it made a dead section
 * uniformly, evenly black — you navigated it by the minimap. Which is wrong at
 * the level of premise: you are carrying the only light on a dead ship, so dark
 * has to mean "you can see three metres", never "you can see nothing".
 *
 * So the second term is the **suit lamp**, and it is a function of real
 * distance, not a vignette painted over the frame. Every surface here already
 * knows how far away it is — the DDA's ray parameter for walls, the row
 * inversion for the deck and overhead, the camera-space depth for billboards —
 * so the same `lampAt()` falloff goes through all four and they agree about
 * where the light stops. A mild cone (`coneTable`) biases it toward the middle
 * of the view, because a helmet lamp is a cone; the requirement is the distance
 * falloff and the cone is a garnish on top of it.
 *
 * The sum is clamped, so a lit sector barely notices the lamp and a dead one is
 * carried entirely by it. `wallEmit` adds a third, tiny term for the doors
 * only: rule 6 of the art direction is that a sightline terminates on a
 * bulkhead, which it cannot do if the bulkhead is as black as the corridor.
 *
 * The chamfer trim carries a painted light channel, and on the bay frames it
 * also gets an additive strip that fog does not touch — emissive, per the art
 * direction, batched and flushed in one composite-op switch at the end of the
 * wall pass rather than 480 times.
 */

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
 * The deck. The camera eye sits at 0, so a standard 1-cell overhead puts the
 * ceiling at +0.5 and a wall is exactly `proj/dist` tall — which is what keeps
 * every billboard's `hover` reading in the same units it always did.
 *
 * The rest of the section — the chamfer's run and the height of the overhead —
 * is per sector, because both are stated in the art direction as fractions of
 * *corridor width* and only the sector knows how wide its corridors are.
 */
const DECK_Y = -0.5;

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
  /** the deck tile's pixels, or null to fall back to flat rows */
  deck: DeckPixels | null;
}

export interface SceneInput {
  level: FpsLevel;
  cam: RayCamera;
  sprites: RaySprite[];
  mat: RayMaterials;
}

/** One pending additive strip, collected during the wall pass. */
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
   * One projection constant for walls and billboards alike: a wall is exactly
   * PROJ/dist tall on screen, so a sprite of scale 1 is exactly deck-height and
   * `hover` reads in wall heights (0.5 being eye level).
   */
  const proj = H * WALL_H;

  drawBackdrop(ctx, W, H, proj, level, cam, dirX, dirY, planeX, planeY, mat.deck);
  castWalls(ctx, W, H, proj, level, cam, dirX, dirY, planeX, planeY, mat, depth);
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

/* ------------------------------------------------------------------ backdrop */

/**
 * Overhead and deck.
 *
 * The overhead has no texture anywhere — Nova's art has no ceilings and the
 * reference's overhead is mostly hidden behind the upper chamfer in any case —
 * so it stays flat rows shaded by the row's own distance, with a darker seam
 * each whole cell. It takes the *camera's* sector light, which is a
 * simplification: an overhead is only ever a couple of cells away and the one
 * you are standing under is the one you see.
 *
 * The deck is cast per pixel against `deck-plate.png`. A row at screen y is a
 * known distance away (`proj / 2(y - half)`), the world span across that row is
 * linear in it, so one walk across each row lands every pixel on the tile. That
 * buys the two things the flat rows could not have: real plate seams that
 * converge with the corridor, and the worn centre runner both references put
 * down the middle of the walked route. Each sample takes its own cell's sector
 * light, so a dark section's deck goes dark with its walls.
 *
 * The whole backdrop is composed in one ImageData and put down in one call;
 * the wall pass then draws over it normally.
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
  return LITTLE_ENDIAN
    ? (0xff000000 | (b << 16) | (g << 8) | r) >>> 0
    : (((r << 24) | (g << 16) | (b << 8) | 0xff) >>> 0);
}

function drawBackdrop(
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

  for (let y = 0; y < H; y++) {
    const up = y < horizon;
    const rows = up ? half - y : y - half;
    // a plane `rise` above (or below) the eye reaches screen row `half ∓ rise *
    // proj / d`, so invert that for the row's own distance
    const rise = up ? ceilRise : 0.5;
    const dist = rows <= 0.5 ? FOG_RANGE : (rise * proj) / rows;
    const lit = 1 - fogAt(dist);
    /*
     * The lamp's contribution for this whole row. A row of deck is a constant
     * distance away, which is the same fact the shading has always used — so
     * the lamp costs one LUT read per row and one multiply-add per pixel, and
     * the deck under your boots comes up out of the dark exactly as far as the
     * walls beside them do.
     */
    const lampRow = lampAt(dist);
    let p = y * W;
    const end = p + W;

    if (!deck || lit <= 0.004) {
      // no tile yet (or nothing to see): flat rows with a seam every whole cell
      // of distance, so a missing PNG degrades to the old look, not to black
      const cell = Math.floor(dist);
      const k = cell !== lastCell ? 0.5 : 1;
      lastCell = cell;
      const f = Math.min(1, lit * camLight + lampRow) * k;
      const word = pack(
        ((up ? 30 : 58) * f) | 0,
        ((up ? 34 : 53) * f) | 0,
        ((up ? 41 : 44) * f) | 0,
      );
      px.fill(word, p, end);
      continue;
    }

    // world position of the leftmost pixel of this row, and the step across it
    let wx = cam.x + dist * (dirX - planeX);
    let wy = cam.y + dist * (dirY - planeY);
    const sx = (dist * 2 * planeX) / W;
    const sy = (dist * 2 * planeY) / W;

    const tw = deck.w;
    const th = deck.h;
    const td = deck.data;
    const kr = up ? CEIL_R : 1;
    const kg = up ? CEIL_G : 1;
    const kb = up ? CEIL_B : 1;
    /*
     * Sector light changes only when the walk crosses a cell boundary, which on
     * a near row is once or twice across the whole screen — so it is cached
     * rather than looked up per pixel. Cells outside the grid keep the camera's
     * light; those pixels are always overdrawn by the border wall anyway.
     */
    let cellX = 0x7fffffff;
    let cellY = 0x7fffffff;
    let sectorTerm = 0;
    let xi = 0;
    while (p < end) {
      const cx = Math.floor(wx);
      const cy = Math.floor(wy);
      if (cx !== cellX || cy !== cellY) {
        cellX = cx;
        cellY = cy;
        const light =
          cx < 0 || cy < 0 || cx >= lw || cy >= lh
            ? camLight
            : sectors[sectorOf[cy * lw + cx]].light;
        sectorTerm = lit * light;
      }
      // the sector term is cached per cell; the lamp is per pixel, because the
      // cone is, and it is the only thing lighting a dead compartment at all
      let f = sectorTerm + lampRow * cone[xi];
      if (f > 1) f = 1;
      const t = (((wy - cy) * th) & deck.maskY) * tw + (((wx - cx) * tw) & deck.maskX);
      const q = t << 2;
      px[p] = pack(
        (td[q] * f * kr) | 0,
        (td[q + 1] * f * kg) | 0,
        (td[q + 2] * f * kb) | 0,
      );
      p++;
      xi++;
      wx += sx;
      wy += sy;
    }
  }

  ctx.putImageData(backBuf, 0, 0);
}

/* --------------------------------------------------------------------- walls */

/**
 * How many distance-shaded slices a chamfer band is cut into.
 *
 * The vertical face needs none — it is a plane at a single perpendicular
 * distance, so one fog value is exact. A chamfer is not: it spans from the wall
 * back toward the camera, and at a grazing angle that span is most of the room.
 * Slicing it is the difference between a lit bench and a flat wedge. Near
 * chamfers are big and few, far ones small and many, so the count follows the
 * band's height on screen and the cost stays roughly flat.
 */
function slicesFor(h: number): number {
  return h < 8 ? 1 : h < 34 ? 2 : 4;
}

function castWalls(
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
  mat: RayMaterials,
  depth: Float32Array,
): void {
  const half = H / 2;
  const glows: Glow[] = [];
  const cone = coneTable(W);

  for (let x = 0; x < W; x++) {
    const cameraX = (2 * x) / W - 1;
    const rayX = dirX + planeX * cameraX;
    const rayY = dirY + planeY * cameraX;

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
      depth[x] = Infinity;
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

    const sector =
      fromX < 0 || fromY < 0 || fromX >= level.w || fromY >= level.h
        ? level.sectors[0]
        : level.sectors[level.sectorOf[fromY * level.w + fromX]];
    const light = sector.light;
    const coneK = cone[x];
    const emit = mat.emit(cell);

    /*
     * The section, in world units. The deck never moves — a sector's height
     * lifts the overhead and the upper chamfer with it, and nothing else.
     */
    const cham = sector.chamfer;
    const ceilY = DECK_Y + sector.height;
    let faceBotY = DECK_Y + cham;
    let faceTopY = ceilY - cham;
    if (faceTopY < faceBotY) {
      // a crawlspace lower than two chamfers: the vertical face vanishes
      faceTopY = faceBotY = (DECK_Y + ceilY) / 2;
    }

    /*
     * The distance at which the ray entered the chamfer strip. Shifting the
     * wall plane inward by CHAMFER shifts the DDA's distance by CHAMFER times
     * that axis's delta — one multiply, no second trace. Clamped off zero
     * because looking straight down a wall the strip reaches the camera.
     */
    const near = Math.max(0.02, dist - cham * (side === 0 ? deltaX : deltaY));

    /*
     * Band boundaries are snapped to whole rows.
     *
     * They have to be. A chamfer forty cells down the corridor is a fraction of
     * a pixel high, and `drawImage` into a sub-pixel destination blends the
     * brightest texel it can find into that row — against a near-black derelict
     * that came out as chains of white dots tracking the chamfer edges, which is
     * the one artifact that reads instantly as broken. Rounding costs a row of
     * jitter as you walk, which is what a chunky low-res renderer looks like
     * anyway, and it also gives the ridge between the bands a hard edge.
     *
     * Both bands round the same float for their shared boundary, so they meet
     * exactly and no backdrop shows through the join.
     */
    const yFaceBot = Math.round(half - (faceBotY * proj) / dist);
    const yFaceTop = Math.round(half - (faceTopY * proj) / dist);

    /*
     * The along-the-wall coordinate, as a function of perpendicular distance.
     * The DDA's `dist` is the ray parameter itself, so the point the ray is at
     * is simply `cam + d * ray` — which means a chamfer slice can be textured
     * at its **own** distance instead of borrowing the wall's. That matters:
     * looking down a corridor the chamfer runs from the wall right back to your
     * boots, and one u for the whole band smears the tile into long streaks
     * down the length of the frame.
     */
    const alongBase = side === 0 ? cam.y : cam.x;
    const alongRay = side === 0 ? rayY : rayX;
    const flip = (side === 0 && rayX > 0) || (side === 1 && rayY < 0);
    const col: Column = {
      x,
      half,
      proj,
      alongBase,
      alongRay,
      flip,
      light,
      cone: coneK,
      emit,
    };

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
    const faceOff = ((hv >> 3) & 3) * 0.25;
    const faceFlip = ((hv >> 5) & 1) === 1 ? !flip : flip;

    const tex = mat.texture(cell, WallBand.Main, variant);
    const sideK = side === 1 ? SIDE_SHADE : 1;

    // --- the vertical face: one plane, one distance, one light value
    if (yFaceBot > yFaceTop) {
      const litFace =
        litAt(dist, light, coneK) * mat.gain(cell, WallBand.Main) * sideK + emit;
      if (tex) {
        ctx.drawImage(
          tex,
          texAt(col, tex, dist, mat.repeat(cell, WallBand.Main) * repScale, faceOff, faceFlip),
          0,
          1,
          texHOf(tex),
          x,
          yFaceTop,
          1,
          yFaceBot - yFaceTop,
        );
      } else {
        ctx.fillStyle = "#565c64";
        ctx.fillRect(x, yFaceTop, 1, yFaceBot - yFaceTop);
      }
      shade(ctx, x, yFaceTop, yFaceBot - yFaceTop, litFace);
    }

    const glowK = mat.glow(cell) * light;

    // --- the channel where it crosses the vertical face, closing the ring.
    // The face is one plane at one distance, so v maps linearly onto rows.
    if (glowK > 0.01 && yFaceBot > yFaceTop) {
      const span = yFaceBot - yFaceTop;
      const fade = 1 - fogAt(dist) * 0.55;
      const strip = (v0: number, v1: number, a: number): void => {
        const r0 = Math.round(yFaceTop + span * v0);
        const r1 = Math.round(yFaceTop + span * v1);
        if (r1 - r0 >= 1) glows.push({ x, y: r0, h: r1 - r0, a: glowK * fade * a });
      };
      strip(FACE_HALO_V0, FACE_HALO_V1, 0.17);
      strip(FACE_GLOW_V0, FACE_GLOW_V1, 0.5);
    }

    // --- the two chamfers, each sliced so the light follows them back to the camera
    band(
      ctx,
      col,
      faceBotY,
      dist,
      DECK_Y,
      near,
      mat.texture(cell, WallBand.Lower, 0),
      mat.repeat(cell, WallBand.Lower) * repScale,
      mat.gain(cell, WallBand.Lower) * sideK,
      glowK,
      glows,
    );
    band(
      ctx,
      col,
      ceilY,
      near,
      faceTopY,
      dist,
      mat.texture(cell, WallBand.Upper, 0),
      mat.repeat(cell, WallBand.Upper) * repScale,
      mat.gain(cell, WallBand.Upper) * sideK,
      glowK,
      glows,
    );

    /*
     * The ridge where a chamfer meets the face. In the references that is a
     * physical edge with the light dying across it, and one dark pixel is
     * enough to state it — without it the three bands blend and the section
     * reads as one flat wall however differently they are shaded.
     */
    if (yFaceBot > yFaceTop) {
      ctx.fillStyle = SEAM;
      if (yFaceTop > 0) ctx.fillRect(x, yFaceTop, 1, 1);
      if (yFaceBot < H) ctx.fillRect(x, yFaceBot - 1, 1, 1);
    }
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

/** Everything about one screen column that a band needs to texture and light itself. */
interface Column {
  x: number;
  half: number;
  proj: number;
  alongBase: number;
  alongRay: number;
  flip: boolean;
  /** the sector this wall is being looked at from */
  light: number;
  /** this column's share of the lamp cone */
  cone: number;
  /** self-illumination of the material, added after everything else */
  emit: number;
}

function texW(tex: CanvasImageSource): number {
  return (tex as HTMLImageElement).naturalWidth || (tex as HTMLCanvasElement).width;
}
function texHOf(tex: CanvasImageSource): number {
  return (tex as HTMLImageElement).naturalHeight || (tex as HTMLCanvasElement).height;
}

/**
 * Texel column for this ray at perpendicular distance `d`.
 *
 * `off` shifts the tile along the wall and `flip` mirrors it — both per cell,
 * both part of breaking the repetition; `off` is added *after* the repeat
 * multiply so a quarter is a quarter of a tile rather than a quarter of a cell.
 */
function texAt(
  col: Column,
  tex: CanvasImageSource,
  d: number,
  rep: number,
  off: number,
  flip: boolean,
): number {
  const w = texW(tex);
  let u = (col.alongBase + d * col.alongRay) * rep + off;
  u -= Math.floor(u);
  const t = Math.min(w - 1, Math.floor(u * w));
  // keep the texture's handedness consistent around a corner
  return flip ? w - t - 1 : t;
}

/**
 * One chamfer band, from world height `y0` at distance `d0` to `y1` at `d1`,
 * cut into slices so each carries its own distance and its own texel column.
 * `v` runs 0..1 down the band, which is also the texture's own axis across the
 * slope — so the trim tile's lit channel lands at a fixed place across the
 * chamfer however the band is foreshortened.
 */
function band(
  ctx: CanvasRenderingContext2D,
  col: Column,
  y0: number,
  d0: number,
  y1: number,
  d1: number,
  tex: CanvasImageSource | null,
  rep: number,
  gain: number,
  glow: number,
  glows: Glow[],
): void {
  const { x, half, proj } = col;
  const row0 = Math.round(half - (y0 * proj) / d0);
  const row1 = Math.round(half - (y1 * proj) / d1);
  const height = row1 - row0;
  if (height < 1) return;

  const n = Math.min(slicesFor(height), height);
  const texH = tex ? texHOf(tex) : 0;
  let prevRow = row0;
  for (let i = 1; i <= n; i++) {
    const t = i / n;
    // the chamfer is a straight edge in space, so both height and distance
    // interpolate linearly along it; the screen row does not, which is exactly
    // why the slices are taken in world space rather than in pixels
    const y = y0 + (y1 - y0) * t;
    const d = d0 + (d1 - d0) * t;
    const row = i === n ? row1 : Math.round(half - (y * proj) / d);
    const h = row - prevRow;
    if (h >= 1) {
      const dMid = d0 + (d1 - d0) * (t - 0.5 / n);
      if (tex) {
        const v0 = ((i - 1) / n) * texH;
        ctx.drawImage(
          tex,
          texAt(col, tex, dMid, rep, 0, col.flip),
          v0,
          1,
          texH / n,
          x,
          prevRow,
          1,
          h,
        );
      } else {
        ctx.fillStyle = "#4a5058";
        ctx.fillRect(x, prevRow, 1, h);
      }
      // the slice's own distance, so the near end of a chamfer running back to
      // your boots is lamp-lit and the far end of it is not
      shade(ctx, x, prevRow, h, litAt(dMid, col.light, col.cone) * gain + col.emit);
    }
    prevRow = row;
  }

  if (glow > 0.01) {
    // emissive: placed by fraction across the band, and *not* fogged — light
    // gets fainter with distance, it does not get black paint over it
    const at = (v: number): number => {
      const y = y0 + (y1 - y0) * v;
      const d = d0 + (d1 - d0) * v;
      return Math.round(half - (y * proj) / d);
    };
    const dMid = (d0 + d1) / 2;
    const fade = 1 - fogAt(dMid) * 0.55;
    const h0 = at(HALO_V0);
    const h1 = at(HALO_V1);
    if (h1 - h0 >= 1) glows.push({ x, y: h0, h: h1 - h0, a: glow * fade * 0.17 });
    const g0 = at(GLOW_V0);
    const g1 = at(GLOW_V1);
    if (g1 - g0 >= 1) glows.push({ x, y: g0, h: g1 - g0, a: glow * fade * 0.5 });
  }
}

/**
 * Paint the missing light onto a strip. `lit` of 1 leaves it alone.
 *
 * The alpha is quantised into a table of ready-made colour strings. A frame
 * shades a few thousand strips — one face plus up to eight chamfer slices per
 * column — and building `rgba(0,0,0,0.123)` for each of them was the single
 * most expensive thing in the wall pass. 48 steps is finer than an 8-bit
 * channel resolves over a 1px strip.
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
