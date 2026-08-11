/**
 * Cut `art-reference/props/*.png` into individual objects with alpha.
 *
 * The three sheets are *reference sheets*, not tiles and not sprite sheets:
 * fourteen crates, four consoles and a run of conduit, each rendered on one flat
 * neutral grey. So they cannot be used the way the wall tiles are — they have to
 * be separated first, and the background has to become alpha or every prop wears
 * a grey card behind it.
 *
 * The separation is a flood fill from the border rather than a colour key.
 * A key on "close to grey" eats the props themselves, which are grey — the
 * crates' own mid tones sit within a few percent of the background. What
 * actually distinguishes background from object is **connectivity to the edge of
 * the sheet**: the field touches the border everywhere and no crate does.
 *
 *   node scripts/fps-props.mjs
 */

import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { PNG } from "pngjs";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const OUT = resolve(root, "public/fps/props");
mkdirSync(OUT, { recursive: true });

/**
 * How far from the sampled background colour still counts as background.
 *
 * **Low, and then blobs are merged.** At 26 the fill reached *into* the props —
 * their own mid greys sit within a few percent of the field — and a crate came
 * back as three unrelated pieces, so the sheet yielded 21 objects where it draws
 * 14. Tightening it leaves a thin grey halo, which is invisible at prop scale,
 * and any prop still split by a light face is put back together by the merge
 * below.
 */
const TOL = 10;
/** Objects smaller than this fraction of the sheet are noise, not props. */
const MIN_AREA = 0.0015;

const SHEETS = [
  ["crates.png", "crate"],
  ["consoles.png", "console"],
  ["conduit.png", "conduit"],
];

for (const [file, stem] of SHEETS) {
  const src = PNG.sync.read(readFileSync(resolve(root, "art-reference/props", file)));
  const { width: W, height: H } = src;
  const at = (x, y) => (y * W + x) << 2;

  /*
   * The background colour, taken from the four corners rather than assumed:
   * the sheets are not all the same grey and one of them is faintly vignetted.
   */
  const corners = [[0, 0], [W - 1, 0], [0, H - 1], [W - 1, H - 1]];
  const bg = [0, 0, 0];
  for (const [x, y] of corners) {
    const p = at(x, y);
    for (let c = 0; c < 3; c++) bg[c] += src.data[p + c] / 4;
  }

  // flood the background in from the border
  const isBg = new Uint8Array(W * H);
  const near = (p) =>
    Math.abs(src.data[p] - bg[0]) < TOL &&
    Math.abs(src.data[p + 1] - bg[1]) < TOL &&
    Math.abs(src.data[p + 2] - bg[2]) < TOL;
  const q = [];
  for (let x = 0; x < W; x++) {
    for (const y of [0, H - 1]) if (near(at(x, y))) { isBg[y * W + x] = 1; q.push(y * W + x); }
  }
  for (let y = 0; y < H; y++) {
    for (const x of [0, W - 1]) if (near(at(x, y))) { isBg[y * W + x] = 1; q.push(y * W + x); }
  }
  for (let h = 0; h < q.length; h++) {
    const i = q[h];
    const x = i % W;
    const y = (i / W) | 0;
    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const nx = x + dx;
      const ny = y + dy;
      if (nx < 0 || ny < 0 || nx >= W || ny >= H) continue;
      const j = ny * W + nx;
      if (isBg[j] || !near(at(nx, ny))) continue;
      isBg[j] = 1;
      q.push(j);
    }
  }

  // label what is left, and take each blob's bounding box
  const seen = new Uint8Array(W * H);
  const blobs = [];
  for (let i = 0; i < W * H; i++) {
    if (isBg[i] || seen[i]) continue;
    let x0 = W, y0 = H, x1 = 0, y1 = 0, n = 0;
    const s = [i];
    seen[i] = 1;
    for (let h = 0; h < s.length; h++) {
      const k = s[h];
      const x = k % W;
      const y = (k / W) | 0;
      if (x < x0) x0 = x;
      if (x > x1) x1 = x;
      if (y < y0) y0 = y;
      if (y > y1) y1 = y;
      n++;
      for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const nx = x + dx;
        const ny = y + dy;
        if (nx < 0 || ny < 0 || nx >= W || ny >= H) continue;
        const j = ny * W + nx;
        if (seen[j] || isBg[j]) continue;
        seen[j] = 1;
        s.push(j);
      }
    }
    if (n / (W * H) >= MIN_AREA) blobs.push({ x0, y0, x1, y1, n });
  }

  /*
   * Put back together anything the fill split. Two boxes that overlap, or sit
   * within a few pixels of each other, are one object seen as two — a crate
   * whose lid is a shade paler than its body, most often. Repeat until stable,
   * because merging two can bring a third into range.
   */
  for (let pass = 0; pass < 8; pass++) {
    let merged = false;
    for (let i = 0; i < blobs.length && !merged; i++) {
      for (let j = i + 1; j < blobs.length; j++) {
        const a = blobs[i];
        const b = blobs[j];
        const gap = 6;
        if (
          a.x0 - gap <= b.x1 && b.x0 - gap <= a.x1 &&
          a.y0 - gap <= b.y1 && b.y0 - gap <= a.y1
        ) {
          a.x0 = Math.min(a.x0, b.x0);
          a.y0 = Math.min(a.y0, b.y0);
          a.x1 = Math.max(a.x1, b.x1);
          a.y1 = Math.max(a.y1, b.y1);
          a.n += b.n;
          blobs.splice(j, 1);
          merged = true;
          break;
        }
      }
    }
    if (!merged) break;
  }

  // reading order, so the names are stable across re-runs
  blobs.sort((a, b) => (a.y0 === b.y0 ? a.x0 - b.x0 : a.y0 - b.y0));
  const rows = [];
  for (const b of blobs) {
    const r = rows.find((rw) => Math.abs(rw.y - b.y0) < H * 0.08);
    if (r) r.items.push(b);
    else rows.push({ y: b.y0, items: [b] });
  }
  let k = 0;
  const names = [];
  for (const r of rows) {
    r.items.sort((a, b) => a.x0 - b.x0);
    for (const b of r.items) {
      const w = b.x1 - b.x0 + 1;
      const h = b.y1 - b.y0 + 1;
      const out = new PNG({ width: w, height: h });
      for (let y = 0; y < h; y++) {
        for (let x = 0; x < w; x++) {
          const p = at(b.x0 + x, b.y0 + y);
          const o = (y * w + x) << 2;
          out.data[o] = src.data[p];
          out.data[o + 1] = src.data[p + 1];
          out.data[o + 2] = src.data[p + 2];
          out.data[o + 3] = isBg[(b.y0 + y) * W + (b.x0 + x)] ? 0 : 255;
        }
      }
      const name = `${stem}-${String(k++).padStart(2, "0")}.png`;
      writeFileSync(resolve(OUT, name), PNG.sync.write(out));
      names.push(`${name} ${w}x${h}`);
    }
  }
  console.log(`${file}: ${names.length} objects`);
  for (const n of names) console.log(`  ${n}`);
}
