/**
 * The raycaster. Pure rendering — it knows about a grid, a camera and a list of
 * billboards, and nothing about the game.
 *
 * Wolf3D-style on purpose: the enemies are Nova's own hulls, which ship as
 * horizontal strips of 36 pre-rendered rotations, and that is the one thing a
 * DDA-plus-billboard renderer consumes and nothing else does. Doom-style
 * variable floor heights would cost a lot of maths to exploit floor textures
 * that do not exist anywhere in the extraction.
 *
 * Light is the whole aesthetic. There are no floor or ceiling textures, so
 * rather than fake them badly the deck and overhead are flat gradients and the
 * work is done by per-column distance fog, N/S-versus-E/W face shading and a
 * lamp vignette. That is also what makes a derelict feel like one.
 */

import type { FpsLevel } from "./types";

/** Horizontal FOV, as the tangent of the half-angle: 2*atan(0.66) ≈ 66°. */
const PLANE = 0.66;

/**
 * Deck height, in cells. Wolf3D's walls were exactly as tall as a cell is wide,
 * which works when you are never more than a cell or two from one; across a
 * hold six cells deep the far bulkhead reads as knee-height fencing. Taller
 * walls fix that, and the factor has to reach the billboards too or a Wraith's
 * feet lift off the deck — so both go through PROJ below.
 */
const WALL_H = 1.6;

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

export interface SceneInput {
  level: FpsLevel;
  cam: RayCamera;
  sprites: RaySprite[];
  /** wall id (1-based) → material, or null to fall back to flat shading */
  texture: (id: number) => CanvasImageSource | null;
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
  const { level, cam } = scene;
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

  drawBackdrop(ctx, W, H, proj);
  castWalls(ctx, W, H, proj, level, cam, dirX, dirY, planeX, planeY, scene.texture, depth);
  drawSprites(ctx, W, H, proj, cam, dirX, dirY, planeX, planeY, scene.sprites, depth);
  drawLamp(ctx, W, H);
}

/**
 * Overhead and deck.
 *
 * There is no floor or ceiling texture anywhere in Nova's art, so these are
 * flat colours — but *not* a flat gradient. Each screen row below the horizon
 * is a known distance away (a wall at distance d has its foot at
 * `half + proj/2d`, so a floor row at y is at `proj / 2(y - half)`), which
 * means the same fog the walls use can be applied per row. That is what makes
 * the deck read as lit at your boots and gone a few metres out, and it costs
 * one fillRect per row. Every whole cell of distance gets a darker seam, which
 * is the only floor detail available and enough to say the deck is plated.
 */
function drawBackdrop(
  ctx: CanvasRenderingContext2D,
  W: number,
  H: number,
  proj: number,
): void {
  const half = H / 2;
  ctx.fillStyle = "#000000";
  ctx.fillRect(0, 0, W, H);

  let lastCell = -1;
  for (let y = Math.ceil(half) + 1; y < H; y++) {
    const dist = proj / (2 * (y - half));
    const lit = 1 - fogAt(dist);
    const cell = Math.floor(dist);
    const seam = cell !== lastCell;
    lastCell = cell;
    const k = seam ? 0.45 : 1;
    ctx.fillStyle = `rgb(${Math.round(58 * lit * k)},${Math.round(53 * lit * k)},${Math.round(44 * lit * k)})`;
    ctx.fillRect(0, y, W, 1);
  }

  lastCell = -1;
  for (let y = Math.floor(half) - 1; y >= 0; y--) {
    const dist = proj / (2 * (half - y));
    const lit = 1 - fogAt(dist);
    const cell = Math.floor(dist);
    const seam = cell !== lastCell;
    lastCell = cell;
    const k = seam ? 0.5 : 1;
    ctx.fillStyle = `rgb(${Math.round(30 * lit * k)},${Math.round(34 * lit * k)},${Math.round(41 * lit * k)})`;
    ctx.fillRect(0, y, W, 1);
  }
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
  texture: (id: number) => CanvasImageSource | null,
  depth: Float32Array,
): void {
  const half = H / 2;
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
    // the level's border is solid, so this always terminates; the counter is
    // only a backstop against a malformed level
    for (let guard = 0; guard < 256; guard++) {
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
    const dist = Math.max(
      1e-4,
      side === 0 ? sideX - deltaX : sideY - deltaY,
    );
    depth[x] = dist;

    const lineH = proj / dist;
    const top = half - lineH / 2;

    const tex = texture(cell);
    if (tex) {
      let wallX = side === 0 ? cam.y + dist * rayY : cam.x + dist * rayX;
      wallX -= Math.floor(wallX);
      const texW = (tex as HTMLCanvasElement).width;
      const texH = (tex as HTMLCanvasElement).height;
      let texX = Math.floor(wallX * texW);
      // keep the texture's handedness consistent around a corner
      if ((side === 0 && rayX > 0) || (side === 1 && rayY < 0)) {
        texX = texW - texX - 1;
      }
      ctx.drawImage(tex, texX, 0, 1, texH, x, top, 1, lineH);
    } else {
      ctx.fillStyle = cell === 2 ? "#4a5058" : "#565c64";
      ctx.fillRect(x, top, 1, lineH);
    }

    /*
     * Shade the north/south faces against the east/west ones. It is the classic
     * Wolf3D cheat and it is doing real work here: with one material on every
     * wall it is the only thing giving a corner an edge.
     */
    let shade = fogAt(dist);
    if (side === 1) shade = shade + (1 - shade) * 0.28;
    if (shade > 0.002) {
      ctx.fillStyle = `rgba(0,0,0,${shade.toFixed(3)})`;
      ctx.fillRect(x, top, 1, lineH);
    }
  }
}

function drawSprites(
  ctx: CanvasRenderingContext2D,
  W: number,
  H: number,
  proj: number,
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
    const fog = fogAt(transformY);
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

/** A soft lamp falloff, so the edges of the view go to nothing. */
function drawLamp(ctx: CanvasRenderingContext2D, W: number, H: number): void {
  const g = ctx.createRadialGradient(
    W / 2,
    H / 2,
    Math.min(W, H) * 0.3,
    W / 2,
    H / 2,
    Math.max(W, H) * 0.78,
  );
  g.addColorStop(0, "rgba(0,0,0,0)");
  g.addColorStop(0.65, "rgba(0,0,0,0.1)");
  g.addColorStop(1, "rgba(0,0,0,0.5)");
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, W, H);
}
