import type { PlanetDef } from "../types";
import { getSprite } from "./sprites";

/** Engine flame drawn behind a ship; call with ctx rotated to the ship's heading. */
export function drawThrustFlame(ctx: CanvasRenderingContext2D, backOffset: number): void {
  const flicker = 0.7 + Math.random() * 0.3;
  const grad = ctx.createLinearGradient(-backOffset, 0, -backOffset - 20 * flicker, 0);
  grad.addColorStop(0, "rgba(255,190,80,0.85)");
  grad.addColorStop(1, "rgba(255,80,20,0)");
  ctx.fillStyle = grad;
  ctx.beginPath();
  ctx.moveTo(-backOffset, -3.5);
  ctx.lineTo(-backOffset - 20 * flicker, 0);
  ctx.lineTo(-backOffset, 3.5);
  ctx.closePath();
  ctx.fill();
}

/** Draw the player's ship (a small kite-shaped courier) at origin, facing +x. */
export function drawPlayerShip(ctx: CanvasRenderingContext2D, thrusting: boolean): void {
  if (thrusting) {
    const flicker = 0.7 + Math.random() * 0.3;
    const grad = ctx.createLinearGradient(-14, 0, -34 * flicker, 0);
    grad.addColorStop(0, "rgba(255,200,90,0.9)");
    grad.addColorStop(1, "rgba(255,80,20,0)");
    ctx.fillStyle = grad;
    ctx.beginPath();
    ctx.moveTo(-13, -4);
    ctx.lineTo(-34 * flicker, 0);
    ctx.lineTo(-13, 4);
    ctx.closePath();
    ctx.fill();
  }

  // hull
  ctx.fillStyle = "#b8c4d4";
  ctx.strokeStyle = "#5a6b80";
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(18, 0);
  ctx.lineTo(-8, -9);
  ctx.lineTo(-13, -4);
  ctx.lineTo(-13, 4);
  ctx.lineTo(-8, 9);
  ctx.closePath();
  ctx.fill();
  ctx.stroke();

  // cockpit
  ctx.fillStyle = "#4d7ea8";
  ctx.beginPath();
  ctx.ellipse(6, 0, 5, 3, 0, 0, Math.PI * 2);
  ctx.fill();

  // wing accents
  ctx.strokeStyle = "#8494a8";
  ctx.beginPath();
  ctx.moveTo(-2, -8);
  ctx.lineTo(10, -2);
  ctx.moveTo(-2, 8);
  ctx.lineTo(10, 2);
  ctx.stroke();
}

/** Draw an NPC freighter at origin, facing +x. */
export function drawNpcShip(ctx: CanvasRenderingContext2D, thrusting: boolean): void {
  if (thrusting) {
    const flicker = 0.7 + Math.random() * 0.3;
    const grad = ctx.createLinearGradient(-16, 0, -32 * flicker, 0);
    grad.addColorStop(0, "rgba(150,200,255,0.8)");
    grad.addColorStop(1, "rgba(60,120,255,0)");
    ctx.fillStyle = grad;
    ctx.fillRect(-30 * flicker, -3, 16, 6);
  }
  ctx.fillStyle = "#9a8f7a";
  ctx.strokeStyle = "#6a6250";
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(16, 0);
  ctx.lineTo(8, -7);
  ctx.lineTo(-14, -7);
  ctx.lineTo(-16, 0);
  ctx.lineTo(-14, 7);
  ctx.lineTo(8, 7);
  ctx.closePath();
  ctx.fill();
  ctx.stroke();
  ctx.fillStyle = "#5a6a50";
  ctx.fillRect(-10, -5, 12, 10);
}

/**
 * Draw a planet or station centered at (0,0). `frame` picks a frame out of an
 * animated stellar sheet — the caller owns the animation, because a hypergate's
 * 42 frames are a one-shot opening rather than a loop and only run when someone
 * is actually opening the gate.
 */
export function drawPlanet(
  ctx: CanvasRenderingContext2D,
  p: PlanetDef,
  time: number,
  frame = 0,
): void {
  if (p.spriteFile) {
    const img = getSprite(p.spriteFile);
    if (img) {
      if (p.spriteFrames > 1 && p.spriteW > 0) {
        const f = Math.max(0, Math.min(p.spriteFrames - 1, Math.floor(frame)));
        ctx.drawImage(
          img,
          f * p.spriteW, 0, p.spriteW, p.spriteH,
          -p.spriteW / 2, -p.spriteH / 2, p.spriteW, p.spriteH,
        );
      } else {
        ctx.drawImage(img, -img.naturalWidth / 2, -img.naturalHeight / 2);
      }
      return;
    }
  }
  if (p.kind === "planet") {
    const r = p.radius;
    const grad = ctx.createRadialGradient(-r * 0.35, -r * 0.35, r * 0.1, 0, 0, r);
    grad.addColorStop(0, lighten(p.color, 0.45));
    grad.addColorStop(0.6, p.color);
    grad.addColorStop(1, darken(p.color, 0.65));
    ctx.fillStyle = grad;
    ctx.beginPath();
    ctx.arc(0, 0, r, 0, Math.PI * 2);
    ctx.fill();
    // atmosphere rim
    ctx.strokeStyle = "rgba(160,200,255,0.18)";
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.arc(0, 0, r + 2, 0, Math.PI * 2);
    ctx.stroke();
  } else {
    // station: rotating hexagonal frame with a hub
    const r = p.radius;
    ctx.save();
    ctx.rotate(time * 0.15);
    ctx.strokeStyle = lighten(p.color, 0.2);
    ctx.lineWidth = 4;
    ctx.beginPath();
    for (let i = 0; i <= 6; i++) {
      const a = (i / 6) * Math.PI * 2;
      const x = Math.cos(a) * r;
      const y = Math.sin(a) * r;
      if (i === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    }
    ctx.stroke();
    // spokes
    ctx.lineWidth = 2;
    for (let i = 0; i < 3; i++) {
      const a = (i / 3) * Math.PI * 2;
      ctx.beginPath();
      ctx.moveTo(Math.cos(a) * r, Math.sin(a) * r);
      ctx.lineTo(Math.cos(a + Math.PI) * r, Math.sin(a + Math.PI) * r);
      ctx.stroke();
    }
    // hub
    ctx.fillStyle = lighten(p.color, 0.35);
    ctx.beginPath();
    ctx.arc(0, 0, r * 0.3, 0, Math.PI * 2);
    ctx.fill();
    // blinking nav light
    if (Math.floor(time * 2) % 2 === 0) {
      ctx.fillStyle = "#ff6060";
      ctx.beginPath();
      ctx.arc(r, 0, 3, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.restore();
  }
}

export function lighten(hex: string, amt: number): string {
  const { r, g, b } = parseHex(hex);
  return `rgb(${mix(r, 255, amt)},${mix(g, 255, amt)},${mix(b, 255, amt)})`;
}

export function darken(hex: string, amt: number): string {
  const { r, g, b } = parseHex(hex);
  return `rgb(${mix(r, 0, amt)},${mix(g, 0, amt)},${mix(b, 0, amt)})`;
}

function parseHex(hex: string): { r: number; g: number; b: number } {
  const n = parseInt(hex.slice(1), 16);
  return { r: (n >> 16) & 255, g: (n >> 8) & 255, b: n & 255 };
}

function mix(a: number, b: number, t: number): number {
  return Math.round(a + (b - a) * t);
}
