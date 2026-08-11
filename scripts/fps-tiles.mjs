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

/** file, output size, and whether to transpose it on the way out. */
const TILES = [
  ["materials/wall-main.png", "wall-main.png", 256],
  ["materials/wall-grimy.png", "wall-grimy.png", 256],
  ["materials/trim-light-channel.png", "trim-light-channel.png", 256],
  ["materials/deck-plate.png", "deck-plate.png", 256],
  ["materials/door-face.png", "door-face.png", 192],
  ["materials/overhead.png", "overhead.png", 256],
  ["materials/deck-runner.png", "deck-runner.png", 256],
  /*
   * **The frame tile ships transposed**, and that is not a preference.
   *
   * On a rib the tile wraps *around* the octagon — `u` is normalised arc along
   * the profile, `v` is position along the corridor — and the source draws its
   * bolted stiles as columns, i.e. at constant x. Mapped straight through, a
   * line of bolts is a line of constant `u`: a stripe running lengthwise down a
   * band that is only one cell long, which reads as pipes threaded through the
   * frame. Transposed, the same line is constant `v` and varies through `u`, so
   * it hoops the corridor — which is what a bolted flange on a ring is.
   */
  ["materials/frame-rib.png", "frame-rib.png", 256, true],
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
  /*
   * The bench's own band. `bench-conduit.png` draws two full stories of
   * services over its 1024 — a clipped pipe rail, a row of inspection plates,
   * a bundled cable run, then the step — so a third of the source is one
   * story, and 240..581 is the one that puts the plates high on the bench, the
   * cable run through its middle and the step down by the toe.
   */
  ["materials/bench-conduit.png", "bench-conduit.png", 240, 581, 384, 128],
  ["materials/trim-light-channel.png", "chamfer-trim.png", 338, 679, 384, 128],
  // the same tile's upper third: a panel run, a conduit run and a panel band,
  // no fixture — horizontal structure, which is what a bench-like chamfer wants
  ["materials/trim-light-channel.png", "chamfer-main.png", 0, 341, 384, 128],
  ["materials/wall-grimy.png", "chamfer-grimy.png", 600, 941, 384, 128],
];

/** Area average of a source rect into a `w`x`h` output. */
function boxDown(src, w, h, cropY0 = 0, cropY1 = src.height, cropX0 = 0, cropX1 = src.width) {
  const out = new PNG({ width: w, height: h });
  const ch = cropY1 - cropY0;
  const cw = cropX1 - cropX0;
  const sx = cw / w;
  const sy = ch / h;
  for (let y = 0; y < h; y++) {
    const y0 = cropY0 + Math.floor(y * sy);
    const y1 = Math.max(y0 + 1, cropY0 + Math.floor((y + 1) * sy));
    for (let x = 0; x < w; x++) {
      const x0 = cropX0 + Math.floor(x * sx);
      const x1 = Math.max(x0 + 1, cropX0 + Math.floor((x + 1) * sx));
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

/** Swap the two axes of a square tile. */
function transpose(img) {
  const out = new PNG({ width: img.height, height: img.width });
  for (let y = 0; y < img.height; y++) {
    for (let x = 0; x < img.width; x++) {
      const p = (y * img.width + x) << 2;
      const q = (x * img.height + y) << 2;
      out.data[q] = img.data[p];
      out.data[q + 1] = img.data[p + 1];
      out.data[q + 2] = img.data[p + 2];
      out.data[q + 3] = 255;
    }
  }
  return out;
}

for (const [from, to, size, flip] of TILES) {
  const src = PNG.sync.read(readFileSync(resolve(root, "art-reference", from)));
  const out = boxDown(src, size, size);
  emit(to, flip ? transpose(out) : out);
}

for (const [from, to, y0, y1, w, h] of CHAMFERS) {
  const src = PNG.sync.read(readFileSync(resolve(root, "art-reference", from)));
  emit(to, boxDown(src, w, h, y0, y1));
}

/* ------------------------------------------------------------- the panels */

/**
 * The breaker and the locker, from `art-reference/panels/`.
 *
 * Two things are different about these and both come from what they are *for*.
 *
 * **They are cropped to the fitting**, not used whole. Each source draws the
 * panel *and* the bulkhead plating around it, which is right for a reference
 * sheet and wrong on a quad bolted to a wall — mapped whole you get a picture of
 * a wall hanging on a wall, at a different tile scale from the wall behind it.
 * The crops are the enclosure and the locker door respectively, measured off the
 * sources, and the same rect is used for both states of each so they register
 * exactly when one swaps for the other.
 *
 * **They are not square, and the geometry follows them.** A breaker enclosure is
 * landscape and a locker door portrait; forcing either into a square tile is the
 * same aspect distortion `scratch/stretch.mjs` exists to catch, so the output
 * sizes here and the quad dimensions in `glscene.ts` are one measurement stated
 * twice. Change a crop and the quad changes with it.
 *
 * `[source, out, w, h, y0, y1, x0, x1]`
 */
const PANELS = [
  ["panels/breaker-dead.png", "breaker-dead.png", 256, 184, 175, 835, 60, 975],
  ["panels/breaker-live.png", "breaker-live.png", 256, 184, 175, 835, 60, 975],
  ["panels/locker-closed.png", "locker-closed.png", 192, 268, 40, 975, 180, 850],
  ["panels/locker-open.png", "locker-open.png", 192, 268, 40, 975, 180, 850],
];

for (const [from, to, w, h, y0, y1, x0, x1] of PANELS) {
  const src = PNG.sync.read(readFileSync(resolve(root, "art-reference", from)));
  emit(to, boxDown(src, w, h, y0, y1, x0, x1));
}

/**
 * ...and the breaker's **glow layer, by subtraction**.
 *
 * `breaker-live` is `breaker-dead` with the lamps on and nothing else changed,
 * so `live - dead` isolates exactly the amber and leaves the pale grey housing
 * at zero. That matters because the housing's own luminance is around 0.78 —
 * high enough that the shader's keyed-emission threshold cannot separate the
 * fitting from the panel it is set in, which is the same failure the art
 * direction records for the light channel ("a strip down every wall is a strip
 * down no wall in particular"). Subtraction has no threshold to get wrong.
 *
 * The result is RGBA: `live`'s colour, with alpha carrying how much of the
 * pixel is glow. `glscene.ts` draws it unlit and additive over the lit panel,
 * with its opacity following the hold — so the lamps come up as you throw it.
 */
{
  const live = PNG.sync.read(readFileSync(resolve(root, "art-reference", "panels/breaker-live.png")));
  const dead = PNG.sync.read(readFileSync(resolve(root, "art-reference", "panels/breaker-dead.png")));
  const g = new PNG({ width: live.width, height: live.height });
  for (let i = 0; i < live.width * live.height; i++) {
    const o = i << 2;
    // the largest per-channel rise, which is what "lit up" means on amber over
    // grey: the blue channel barely moves and averaging would halve the signal
    let d = 0;
    for (let c = 0; c < 3; c++) d = Math.max(d, live.data[o + c] - dead.data[o + c]);
    g.data[o] = live.data[o];
    g.data[o + 1] = live.data[o + 1];
    g.data[o + 2] = live.data[o + 2];
    g.data[o + 3] = Math.max(0, Math.min(255, Math.round(d * 1.6)));
  }
  const out = boxDown4(g, 256, 184, 175, 835, 60, 975);
  const buf = PNG.sync.write(out, { deflateLevel: 9 });
  writeFileSync(resolve(root, "public/fps", "breaker-glow.png"), buf);
  let lit = 0;
  for (let i = 0; i < out.width * out.height; i++) if (out.data[(i << 2) + 3] > 8) lit++;
  console.log(
    `breaker-glow.png  ${out.width}x${out.height}  ${(buf.length / 1024).toFixed(0)} KB` +
      `  (${((100 * lit) / (out.width * out.height)).toFixed(1)}% of the panel is glow)`,
  );
}

/** `boxDown`, but carrying alpha through. */
function boxDown4(src, w, h, cropY0, cropY1, cropX0, cropX1) {
  const out = new PNG({ width: w, height: h });
  const sx = (cropX1 - cropX0) / w;
  const sy = (cropY1 - cropY0) / h;
  for (let y = 0; y < h; y++) {
    const y0 = cropY0 + Math.floor(y * sy);
    const y1 = Math.max(y0 + 1, cropY0 + Math.floor((y + 1) * sy));
    for (let x = 0; x < w; x++) {
      const x0 = cropX0 + Math.floor(x * sx);
      const x1 = Math.max(x0 + 1, cropX0 + Math.floor((x + 1) * sx));
      const acc = [0, 0, 0, 0];
      let n = 0;
      for (let j = y0; j < y1; j++) {
        for (let i = x0; i < x1; i++) {
          const p = (j * src.width + i) << 2;
          for (let c = 0; c < 4; c++) acc[c] += src.data[p + c];
          n++;
        }
      }
      const q = (y * w + x) << 2;
      for (let c = 0; c < 4; c++) out.data[q + c] = Math.round(acc[c] / n);
    }
  }
  return out;
}
