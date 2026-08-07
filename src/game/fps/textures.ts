/**
 * Bulkheads, cut out of the status-bar plates.
 *
 * `public/hud/statusbar-<govt>.jpg` is one tall image: instrument cut-outs down
 * to the end of the last opening, and below that a decorative "machinery tail"
 * of greebled panels, ribbed conduit, cable runs and rivets. The tail is a
 * ready-made sci-fi wall, so the crop starts where the openings stop.
 *
 * Note the coordinate space. `OPENINGS` in `ui/hud.ts` is measured in the art's
 * **481-wide** space and ends at 1649, but the files ship **384 wide** — so the
 * tail begins at `1649 * imgW/481` down the file, derived here rather than
 * hardcoded so a re-export at a different width still lands in the right place.
 *
 * These do not go through `getSprite`/`getPict`: both hardcode the
 * `nova/sprites/` and `nova/picts/` prefixes, and the plates live under
 * `public/hud/`. They still go through `asset()`, for the reason recorded in
 * `ui/hud.ts` — a bare `/hud/...` 404s on the sub-path GitHub Pages deploy.
 */

import { asset } from "../../asset";

/** End of the last instrument opening, in the art's own 481-wide space. */
const OPENINGS_END = 1649;
const PLATE_W = 481;

const images = new Map<string, HTMLImageElement>();
const built = new Map<string, HTMLCanvasElement>();

function plateImage(plateId: number): HTMLImageElement | null {
  const key = `statusbar-${plateId}`;
  let img = images.get(key);
  if (!img) {
    img = new Image();
    img.src = asset(`hud/${key}.jpg`);
    images.set(key, img);
  }
  return img.complete && img.naturalWidth > 0 ? img : null;
}

/**
 * One wall material. `variant` walks further down the tail so two wall ids off
 * the same plate are different stretches of machinery rather than the same
 * crop twice.
 *
 * Returns null until the JPEG has loaded; the renderer falls back to flat
 * shading, which is also the cut line if the crop ever looks wrong.
 */
export function wallTexture(
  plateId: number,
  variant = 0,
): HTMLCanvasElement | null {
  const key = `${plateId}:${variant}`;
  const done = built.get(key);
  if (done) return done;

  const img = plateImage(plateId);
  if (!img) return null;

  const size = img.naturalWidth;
  const tailTop = Math.round((size * OPENINGS_END) / PLATE_W);
  const avail = img.naturalHeight - tailTop;
  if (avail < 16) return null;
  // step down the tail per variant, wrapping inside whatever tail this plate has
  const span = Math.min(size, avail);
  const top = tailTop + ((variant * Math.round(span * 0.6)) % Math.max(1, avail - span));

  const cv = document.createElement("canvas");
  cv.width = size;
  cv.height = span;
  const c = cv.getContext("2d");
  if (!c) return null;
  c.drawImage(img, 0, top, size, span, 0, 0, size, span);

  /*
   * A gentle knock-down, and a slightly cooler one for the second material so
   * the two read apart. Only a stop: the darkness is the fog's job, and taking
   * it out of the texture as well leaves a near wall as black as a far one.
   */
  c.globalCompositeOperation = "multiply";
  c.fillStyle = variant === 0 ? "#d8dce2" : "#c2ccd8";
  c.fillRect(0, 0, size, span);
  c.globalCompositeOperation = "source-over";

  built.set(key, cv);
  return cv;
}

/** Start the plate loading so the first frame in the level is already textured. */
export function preloadPlate(plateId: number): void {
  plateImage(plateId);
}
