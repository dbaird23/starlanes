/** Infinite deterministic parallax starfield, drawn per-cell so it works anywhere in space. */

function hash(x: number, y: number, seed: number): number {
  let h = (x * 374761393 + y * 668265263 + seed * 2246822519) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

interface Layer {
  parallax: number;
  cellSize: number;
  starsPerCell: number;
  maxSize: number;
  alpha: number;
}

const LAYERS: Layer[] = [
  { parallax: 0.15, cellSize: 260, starsPerCell: 5, maxSize: 1.2, alpha: 0.5 },
  { parallax: 0.4, cellSize: 300, starsPerCell: 4, maxSize: 1.8, alpha: 0.75 },
  { parallax: 0.8, cellSize: 380, starsPerCell: 3, maxSize: 2.4, alpha: 1.0 },
];

export function drawStarfield(
  ctx: CanvasRenderingContext2D,
  camX: number,
  camY: number,
  w: number,
  h: number,
): void {
  for (let li = 0; li < LAYERS.length; li++) {
    const layer = LAYERS[li];
    const ox = camX * layer.parallax;
    const oy = camY * layer.parallax;
    const cs = layer.cellSize;
    const x0 = Math.floor((ox - w / 2) / cs) - 1;
    const x1 = Math.floor((ox + w / 2) / cs) + 1;
    const y0 = Math.floor((oy - h / 2) / cs) - 1;
    const y1 = Math.floor((oy + h / 2) / cs) + 1;
    for (let cx = x0; cx <= x1; cx++) {
      for (let cy = y0; cy <= y1; cy++) {
        for (let i = 0; i < layer.starsPerCell; i++) {
          const rx = hash(cx, cy, li * 97 + i * 3);
          const ry = hash(cx, cy, li * 97 + i * 3 + 1);
          const rb = hash(cx, cy, li * 97 + i * 3 + 2);
          const sx = cx * cs + rx * cs - ox + w / 2;
          const sy = cy * cs + ry * cs - oy + h / 2;
          const size = 0.5 + rb * layer.maxSize;
          const tint = hash(cx, cy, li * 97 + i * 3 + 5);
          const b = Math.floor(180 + rb * 75);
          const r = tint > 0.8 ? b : Math.floor(b * 0.92);
          const bl = tint < 0.2 ? b : Math.floor(b * 0.95);
          ctx.globalAlpha = layer.alpha * (0.4 + rb * 0.6);
          ctx.fillStyle = `rgb(${r},${Math.floor(b * 0.95)},${bl})`;
          ctx.fillRect(sx, sy, size, size);
        }
      }
    }
  }
  ctx.globalAlpha = 1;
}
