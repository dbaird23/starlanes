/** Lazy-loading cache for extracted Nova sprite PNGs. */

import { asset } from "../asset";

const cache = new Map<string, HTMLImageElement>();

/** Returns the image if loaded, else kicks off loading and returns null. */
export function getSprite(file: string): HTMLImageElement | null {
  let img = cache.get(file);
  if (!img) {
    img = new Image();
    img.src = asset(`nova/sprites/${file}`);
    cache.set(file, img);
  }
  return img.complete && img.naturalWidth > 0 ? img : null;
}

/** Same lazy cache for the extracted PICT images. */
export function getPict(file: string): HTMLImageElement | null {
  const key = `picts/${file}`;
  let img = cache.get(key);
  if (!img) {
    img = new Image();
    img.src = asset(`nova/picts/${file}`);
    cache.set(key, img);
  }
  return img.complete && img.naturalWidth > 0 ? img : null;
}

/** One class of weapon mount: four exit points, in sprite pixels. */
export interface ExitPoints {
  x: number[];
  y: number[];
  z: number[];
}

/** shän Flags. The first four are mutually exclusive (Bible). */
export const SHAN_BANKS = 0x0001;
export const SHAN_ANIM_PARTS = 0x0002;
export const SHAN_KEY_CARRIED = 0x0004;
export const SHAN_ANIM_SEQUENCE = 0x0008;
export const SHAN_STOP_ANIM_DISABLED = 0x0010;
export const SHAN_HIDE_ALT_DISABLED = 0x0020;
export const SHAN_HIDE_LIGHTS_DISABLED = 0x0040;
export const SHAN_UNFOLD_FIRING = 0x0080;

export interface ShipSprite {
  file: string;
  name: string;
  w: number;
  h: number;
  /** total frames in the sheet — framesPer * sets */
  frames: number;
  /** frames in one full rotation; the rotation divisor */
  framesPer: number;
  /** sprite sets stacked in the sheet: 1, 3 (banking) or 6 (animation) */
  sets: number;
  /** shän Flags — what the extra sets are for, and when to hide things */
  flags: number;
  /** delay between animation frames, in 30ths of a second */
  animDelay: number;
  /** running-light blink pattern: 1 square wave, 2 triangle, 3 random */
  blinkMode: number;
  /** the four BlinkVal fields; their meaning depends on blinkMode */
  blink: number[];
  /** weapon exit points by wëap ExitType: 0 gun, 1 turret, 2 guided, 3 beam */
  exits: ExitPoints[];
  /** perspective correction for the exit points, as percentages */
  compress: { upX: number; upY: number; dnX: number; dnY: number };
  /** weapon-glow sprite and its fade rate — extracted, not yet drawn */
  weapImage?: number;
  weapDecay?: number;
  /** shield bubble; unused by every shipped hull */
  shieldImage?: number;
  /** alternating overlay sprites; used by one shipped hull */
  altImage?: number;
  altSets?: number;
  /** the rlëD this hull draws from; variants of one hull share it */
  imageId?: number;
  /** lowest ship id sharing that rlëD — the hull its pictures belong to */
  baseId?: number;
}

export interface StellarSprite {
  file: string;
  w: number;
  h: number;
  /** frames in the sheet; 1 for every planet, 42 for the hypergate ring */
  frames?: number;
}

export interface SheetSprite {
  file: string;
  w: number;
  h: number;
  frames: number;
  /**
   * Engine glows and running lights are stored frame-for-frame against the
   * hull, so they carry the hull's rotation length and set count and are
   * indexed with the same (set, frame) the hull is drawn at.
   */
  framesPer?: number;
  sets?: number;
}

export interface SpriteManifest {
  ships: Record<string, ShipSprite>;
  stellars: Record<string, StellarSprite>;
  weapons: Record<string, SheetSprite>;
  booms: Record<string, SheetSprite>;
  glows: Record<string, SheetSprite>;
  lights: Record<string, SheetSprite>;
  weapGlows: Record<string, SheetSprite>;
  roids: Record<string, SheetSprite>;
  ui: { cursor?: SheetSprite };
  menu: Record<string, SheetSprite>;
}

/** Draw one frame of a horizontal spritesheet centered at (x, y). */
export function drawSheetFrame(
  ctx: CanvasRenderingContext2D,
  sheet: SheetSprite,
  frame: number,
  x: number,
  y: number,
  scale = 1,
): boolean {
  const img = getSprite(sheet.file);
  if (!img) return false;
  const f = Math.max(0, Math.min(sheet.frames - 1, frame));
  ctx.drawImage(
    img,
    f * sheet.w,
    0,
    sheet.w,
    sheet.h,
    x - (sheet.w * scale) / 2,
    y - (sheet.h * scale) / 2,
    sheet.w * scale,
    sheet.h * scale,
  );
  return true;
}

/** Frame index for a pre-rotated sprite: frame 0 faces up, clockwise. */
export function rotationFrame(frames: number, angle: number): number {
  const deg = ((angle * 180) / Math.PI + 90 + 720) % 360;
  return Math.round(deg / (360 / frames)) % frames;
}

/**
 * Draw a pre-rotated Nova ship sprite. Frame 0 faces up (-y); frames advance
 * clockwise. `angle` is our convention: 0 = +x, increasing clockwise.
 *
 * `set` selects which sprite set to draw from — the sheet is set-major, so
 * a banking hull's bank-left rotation is set 1 and bank-right is set 2.
 */
export function drawShipSprite(
  ctx: CanvasRenderingContext2D,
  sprite: ShipSprite,
  x: number,
  y: number,
  angle: number,
  set = 0,
): boolean {
  const img = getSprite(sprite.file);
  if (!img) return false;
  const idx = spriteFrame(sprite.framesPer, sprite.frames, angle, set);
  ctx.drawImage(
    img,
    idx * sprite.w,
    0,
    sprite.w,
    sprite.h,
    x - sprite.w / 2,
    y - sprite.h / 2,
    sprite.w,
    sprite.h,
  );
  return true;
}

/**
 * Index into a set-major rotation sheet, clamped to the frames that are
 * actually there — a glow or light image with fewer sets than the hull would
 * otherwise read off the end of its own sheet.
 */
export function spriteFrame(
  framesPer: number,
  total: number,
  angle: number,
  set: number,
): number {
  const n = framesPer || total;
  const idx = set * n + rotationFrame(n, angle);
  return idx < total ? idx : rotationFrame(n, angle);
}

/**
 * Brightness of a hull's running lights at time `t`, 0..1.
 *
 * BlinkMode picks the pattern and reinterprets the four BlinkVal fields:
 *   1  square wave — A on-time, B gap, C blinks per group, D gap between groups
 *   2  triangle    — A min intensity, B rise per frame x100, C max, D fall x100
 *   3  random      — A min intensity, B max, C delay between changes
 * Intensities are on Nova's 1-32 scale and the times are in frames at 30Hz.
 * Mode 0 or -1 means the lights simply stay on, which is what 196 of the 288
 * hulls do.
 *
 * `seed` desynchronises mode 3 between ships so a squadron doesn't flicker in
 * lockstep, and keeps each ship's own flicker stable frame to frame.
 */
export function blinkIntensity(
  sprite: ShipSprite,
  t: number,
  seed: string,
): number {
  const [a, b, c, d] = sprite.blink;
  const f = t * 30; // BlinkVals are counted in frames
  switch (sprite.blinkMode) {
    case 1: {
      const on = Math.max(1, a);
      const gap = Math.max(0, b);
      const per = on + gap;
      const group = Math.max(1, c);
      const cycle = per * group + Math.max(0, d);
      const at = f % cycle;
      return at < per * group && at % per < on ? 1 : 0;
    }
    case 2: {
      // Ramp up at B/100 per frame and back down at D/100, between A and C.
      const min = Math.max(1, a);
      const max = Math.max(min + 1, c);
      const span = max - min;
      const upF = span / Math.max(0.01, b / 100);
      const dnF = span / Math.max(0.01, d / 100);
      const at = f % (upF + dnF);
      const level =
        at < upF ? min + at * (b / 100) : max - (at - upF) * (d / 100);
      return level / 32;
    }
    case 3: {
      const min = Math.max(1, a);
      const max = Math.max(min, b);
      const step = Math.floor(f / Math.max(1, c));
      let h = step * 2654435761;
      for (let i = 0; i < seed.length; i++)
        h = (h ^ seed.charCodeAt(i)) * 16777619;
      const r = ((h >>> 8) & 0xffff) / 0xffff;
      return (min + r * (max - min)) / 32;
    }
    default:
      return 1;
  }
}

/**
 * Where a weapon leaves the hull, in world pixels relative to the ship's
 * centre. Nova stores the mount on the sprite with the ship pointing straight
 * up, then rotates it with the ship — but its ship art is rendered off-axis,
 * so the rotated offset has to be squashed by the hull's compression factors
 * before it lands where the gun visually is. UpCompress applies when the ship
 * points generally "up" (heading 0-90 or 270-359), DnCompress otherwise, and
 * the Z offset is added afterwards, unscaled, straight up the screen.
 *
 * `angle` is our convention (0 = +x, clockwise); the sprite's own "up" is -y.
 */
export function weaponExitPoint(
  sprite: ShipSprite | null,
  exitType: number,
  mount: number,
  angle: number,
): { x: number; y: number } {
  // ExitType -1 means the weapon fires from the centre of the ship.
  if (!sprite || exitType < 0 || exitType >= sprite.exits.length)
    return { x: 0, y: 0 };
  const e = sprite.exits[exitType];
  const i = mount % 4;
  // Sprite space: +x right, +y "forward" (towards the nose). Our world has +y
  // down, so forward at angle 0 is -y before rotation.
  const sx = e.x[i];
  const sy = e.y[i];
  if (sx === 0 && sy === 0 && e.z[i] === 0) return { x: 0, y: 0 };

  // Heading in Nova's degrees: 0 = straight up, increasing clockwise.
  const deg = ((angle * 180) / Math.PI + 90 + 720) % 360;
  const up = deg <= 90 || deg >= 270;
  const cx = (up ? sprite.compress.upX : sprite.compress.dnX) / 100;
  const cy = (up ? sprite.compress.upY : sprite.compress.dnY) / 100;

  // Rotate the mount with the hull, then apply the perspective squash.
  const c = Math.cos(angle);
  const s = Math.sin(angle);
  const fx = sy; // along the nose
  const fy = sx; // across the hull
  return {
    x: (fx * c - fy * s) * cx,
    y: (fx * s + fy * c) * cy - e.z[i],
  };
}

/**
 * Nova's target display shows the ship as a flat red silhouette rather than
 * its actual sprite. Build one by masking a solid fill through the sprite's
 * own alpha, and cache it — the target rarely changes between frames.
 */
const tintCache = new Map<string, HTMLCanvasElement>();

export function tintedShipSilhouette(
  sprite: ShipSprite,
  color: string,
  maxW: number,
  maxH: number,
): HTMLCanvasElement | null {
  const key = `${sprite.file}|${color}|${maxW}x${maxH}`;
  const hit = tintCache.get(key);
  if (hit) return hit;
  const img = getSprite(sprite.file);
  if (!img) return null;

  // frame 0 faces up, which is how the original draws the target
  const scale = Math.min(maxW / sprite.w, maxH / sprite.h, 1.6);
  const w = Math.max(1, Math.round(sprite.w * scale));
  const h = Math.max(1, Math.round(sprite.h * scale));
  const c = document.createElement("canvas");
  c.width = w;
  c.height = h;
  const g = c.getContext("2d")!;
  g.drawImage(img, 0, 0, sprite.w, sprite.h, 0, 0, w, h);
  g.globalCompositeOperation = "source-in";
  g.fillStyle = color;
  g.fillRect(0, 0, w, h);
  tintCache.set(key, c);
  return c;
}
