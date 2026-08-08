/**
 * Downsample the art-reference material tiles into `public/fps/`.
 *
 * `art-reference/` is documentation, not a served folder — Vite only publishes
 * `public/`. These are the working copies, cut to the size the raycaster
 * actually samples: the low-res buffer is 480 columns wide and a wall band is
 * at most a couple of hundred pixels tall, so 256 is already more texels than
 * any single frame can show. The sources are 1024, so every step here is an
 * exact box filter (1024 -> 256 is 4x4, -> 192 is not, and is handled by the
 * general area average below).
 *
 *   node scripts/fps-tiles.mjs
 */

import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { PNG } from "pngjs";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");

/** file, output size. */
const TILES = [
  ["materials/wall-main.png", "wall-main.png", 256],
  ["materials/wall-grimy.png", "wall-grimy.png", 256],
  ["materials/trim-light-channel.png", "trim-light-channel.png", 256],
  ["materials/deck-plate.png", "deck-plate.png", 256],
  ["materials/door-face.png", "door-face.png", 192],
];

/**
 * The chamfer tiles.
 *
 * A chamfer band is about 28% of a wall column's height on screen but runs a
 * whole cell along the corridor, so a *square* tile squashed into it collapses
 * into lengthwise ribbons — which is exactly what round one looked like. These
 * are 3:1 crops, sampled at the proportion the band actually occupies, so the
 * horizontal structure in the source (panel runs, conduit, the light fixture)
 * survives the squash instead of smearing.
 *
 * They are **full-width** crops of a tiling source, so they still tile
 * left-to-right; only the vertical extent is cut, and the band maps the tile's
 * whole height across the slope, so it never needs to tile vertically.
 *
 * `[source, out, y0, y1, w, h]` — the crop is `y0..y1` across the full width.
 *
 * The trim crop is centred on the light fixture: measured on the 1024px source
 * the lit channel runs y 483..533 and its recessed housing 455..567, so a 341px
 * band centred on 508 puts the channel at v 0.425..0.572 with the housing lips
 * at 0.34 and 0.67 — which is what `GLOW_*` and `HALO_*` in `raycast.ts` are
 * set to. Move this crop and those constants move with it.
 */
const CHAMFERS = [
  ["materials/trim-light-channel.png", "chamfer-trim.png", 338, 679, 384, 128],
  // the same tile's upper third: a panel run, a conduit run and a panel band,
  // no fixture — horizontal structure, which is what a bench-like chamfer wants
  ["materials/trim-light-channel.png", "chamfer-main.png", 0, 341, 384, 128],
  ["materials/wall-grimy.png", "chamfer-grimy.png", 600, 941, 384, 128],
];

/** Area average of a source rect into a `w`x`h` output. */
function boxDown(src, w, h, cropY0 = 0, cropY1 = src.height) {
  const out = new PNG({ width: w, height: h });
  const ch = cropY1 - cropY0;
  const sx = src.width / w;
  const sy = ch / h;
  for (let y = 0; y < h; y++) {
    const y0 = cropY0 + Math.floor(y * sy);
    const y1 = Math.max(y0 + 1, cropY0 + Math.floor((y + 1) * sy));
    for (let x = 0; x < w; x++) {
      const x0 = Math.floor(x * sx);
      const x1 = Math.max(x0 + 1, Math.floor((x + 1) * sx));
      let r = 0;
      let g = 0;
      let b = 0;
      let n = 0;
      for (let j = y0; j < y1; j++) {
        for (let i = x0; i < x1; i++) {
          const p = (j * src.width + i) << 2;
          r += src.data[p];
          g += src.data[p + 1];
          b += src.data[p + 2];
          n++;
        }
      }
      const q = (y * w + x) << 2;
      out.data[q] = Math.round(r / n);
      out.data[q + 1] = Math.round(g / n);
      out.data[q + 2] = Math.round(b / n);
      out.data[q + 3] = 255;
    }
  }
  return out;
}

mkdirSync(resolve(root, "public/fps"), { recursive: true });

function emit(to, out) {
  const buf = PNG.sync.write(out, { deflateLevel: 9, colorType: 2 });
  writeFileSync(resolve(root, "public/fps", to), buf);
  console.log(`${to}  ${out.width}x${out.height}  ${(buf.length / 1024).toFixed(0)} KB`);
}

for (const [from, to, size] of TILES) {
  const src = PNG.sync.read(readFileSync(resolve(root, "art-reference", from)));
  emit(to, boxDown(src, size, size));
}

for (const [from, to, y0, y1, w, h] of CHAMFERS) {
  const src = PNG.sync.read(readFileSync(resolve(root, "art-reference", from)));
  emit(to, boxDown(src, w, h, y0, y1));
}
