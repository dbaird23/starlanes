/**
 * The corridor's materials.
 *
 * These used to be crops out of the status-bar plates in `public/hud/` — a
 * ready-made greeble, but a *sidebar*, drawn with its own lighting and its own
 * vertical rhythm, and it read as one. They are now the reference tiles under
 * `public/fps/`, cut from `art-reference/materials/` by `scripts/fps-tiles.mjs`.
 *
 * Three surfaces per wall id, because the wall is an octagon in section and
 * each band of it catches light differently (see `raycast.ts`).
 *
 * **The chamfers have their own tiles, and they are 3:1 rather than square.**
 * A chamfer band is roughly 28% of a wall column's height on screen, so a square
 * tile squashed into it loses all of its vertical structure and comes out as
 * lengthwise ribbons — the horizontal smearing that was visible down every wall
 * in round one. `chamfer-*.png` are full-width 341px bands cut out of the same
 * sources at the proportion the band is actually sampled at, so the panel runs
 * and conduit in them stay readable and the light fixture keeps its housing
 * edges instead of blurring into a white blob.
 *
 * `chamfer-trim.png` — the band with the lit channel in it — is deliberately
 * **only** on the bay frames and the doors. Putting it on every chamfer was the
 * obvious reading of the art direction and it was wrong: a light strip down
 * every wall is a strip down no wall in particular, and the bay rhythm, which is
 * the thing the references actually lead with, disappeared into it. One lit
 * frame every three cells reads as structure. The channel is *painted* light, so
 * the frames also get an additive strip over the top of it — see `GLOW_*` in
 * `raycast.ts`.
 *
 * As with the plates, these do not go through `getSprite`/`getPict` (both
 * hardcode the `nova/sprites/` and `nova/picts/` prefixes) but they do go
 * through `asset()`, or a bare `/fps/...` 404s on the sub-path Pages deploy.
 */

import { asset } from "../../asset";
import { WallBand, type DeckPixels } from "./types";

const FILES = [
  "wall-main.png",
  "wall-grimy.png",
  "trim-light-channel.png",
  "deck-plate.png",
  "door-face.png",
  "chamfer-main.png",
  "chamfer-grimy.png",
  "chamfer-trim.png",
] as const;

const images = new Map<string, HTMLImageElement>();

function tile(file: string): HTMLImageElement | null {
  let img = images.get(file);
  if (!img) {
    img = new Image();
    img.src = asset(`fps/${file}`);
    images.set(file, img);
  }
  return img.complete && img.naturalWidth > 0 ? img : null;
}

/**
 * Wall ids, as `level.ts` emits them.
 *
 * 3 is not authored: `parseLevel` promotes hull cells that fall on the bay
 * grid, so the structural rhythm is a property of the deck rather than
 * something every glyph has to spell out.
 */
export const WALL = {
  hull: 1,
  housing: 2,
  frame: 3,
  door: 4,
} as const;

/** One band's dressing: its tile, its brightness and how often it repeats. */
interface Band {
  file: string;
  /**
   * The tile used on some cells instead, to break the grid. `wall-main.png` has
   * a strong central motif, so the identical panel — same slot, same orange dot
   * in the same corner — recurred once per cell three or four times along a
   * single wall run, which reads as wallpaper rather than as a hull.
   */
  alt?: string;
  /** multiplier — the chamfers catch light the flat face does not */
  gain: number;
  /** horizontal repeats of the tile per cell of wall length */
  repeat: number;
}

interface Material {
  /** one per WallBand */
  band: [Band, Band, Band];
  /** how strongly this wall's chamfer channels emit, before sector light */
  glow: number;
  /**
   * Self-illumination floor, added to the lit factor and *not* multiplied by
   * the sector. Only the doors carry any: the art direction's rule 6 is that a
   * sightline terminates on a bulkhead, which it cannot do if the bulkhead is
   * as black as the corridor it caps.
   */
  emit: number;
  /**
   * How far this wall's plane steps in toward the corridor centre, in cells.
   *
   * Nonzero only on the bay frames, and it is what turns them from a brightness
   * patch on a smooth tube into a rib you can see the edge of. See
   * `castWalls`: the DDA's distance is a ray parameter, so stepping the plane
   * in is one subtraction, and the return face falls out of the same test.
   */
  inset: number;
}

const CHAM_MAIN = "chamfer-main.png";
const CHAM_GRIMY = "chamfer-grimy.png";
const CHAM_TRIM = "chamfer-trim.png";

/**
 * The material table.
 *
 * `gain` is where most of the octagon actually comes from. The lower chamfer
 * is a bench facing up into the room and reads bright; the upper one turns its
 * face away and reads dark. Give all three bands the same value and the
 * section collapses back into a flat strip no matter what the textures do.
 *
 * The three values on a wall are read against `DECK_GAIN` in `raycast.ts`,
 * because the fold that matters most is the one where the chamfer leaves the
 * deck and there is nothing on this side of it to state that. The section is a
 * staircase — deck 0.72, lower chamfer 1.0, vertical face 0.68, upper chamfer
 * 0.3, overhead cooler again — so every fold in the octagon has a step in
 * brightness across it and not just a change of slope.
 *
 * The chamfers repeat once per cell because their tiles are already 3:1 and a
 * chamfer's slope run is about 0.39 of a cell against a cell of length — so one
 * tile per cell is very close to sampling the art square.
 */
const MATERIALS: Record<number, Material> = {
  [WALL.hull]: {
    band: [
      { file: CHAM_MAIN, alt: CHAM_GRIMY, gain: 1.0, repeat: 1 },
      { file: "wall-main.png", alt: "wall-grimy.png", gain: 0.68, repeat: 2 },
      { file: CHAM_MAIN, alt: CHAM_GRIMY, gain: 0.3, repeat: 1 },
    ],
    glow: 0,
    emit: 0,
    inset: 0,
  },
  [WALL.housing]: {
    band: [
      { file: CHAM_GRIMY, gain: 0.92, repeat: 1 },
      { file: "wall-grimy.png", gain: 0.6, repeat: 2 },
      { file: CHAM_GRIMY, gain: 0.26, repeat: 1 },
    ],
    glow: 0,
    emit: 0,
    inset: 0,
  },
  [WALL.frame]: {
    band: [
      { file: CHAM_TRIM, gain: 1.0, repeat: 1 },
      { file: "trim-light-channel.png", gain: 0.72, repeat: 1 },
      { file: CHAM_TRIM, gain: 0.44, repeat: 1 },
    ],
    glow: 1,
    emit: 0.015,
    inset: 0.15,
  },
  [WALL.door]: {
    band: [
      { file: CHAM_TRIM, gain: 0.97, repeat: 1 },
      { file: "door-face.png", gain: 0.95, repeat: 1 },
      { file: CHAM_TRIM, gain: 0.4, repeat: 1 },
    ],
    glow: 0.7,
    emit: 0.13,
    inset: 0.06,
  },
};

function matOf(id: number): Material {
  return MATERIALS[id] ?? MATERIALS[WALL.hull];
}

/**
 * Material for one wall id and band, or null until its PNG has arrived.
 *
 * `variant` is a hash of the cell's grid position (see `cellVariant` in
 * `raycast.ts`); its low bit swaps in the alternate tile where a material has
 * one. The rest of the de-repetition is the u offset and the mirror flip, which
 * the renderer applies without needing anything from here.
 */
export function wallTexture(
  id: number,
  band: WallBand,
  variant: number,
): HTMLImageElement | null {
  const b = matOf(id).band[band];
  return tile(b.alt && (variant & 1) === 1 ? b.alt : b.file);
}

/** Brightness multiplier for one wall id and band. */
export function wallGain(id: number, band: WallBand): number {
  return matOf(id).band[band].gain;
}

/** Tile repeats per cell of wall length, so the tile is not stretched flat. */
export function wallRepeat(id: number, band: WallBand): number {
  return matOf(id).band[band].repeat;
}

/** How hard this wall's chamfer light channels burn, before sector light. */
export function wallGlow(id: number): number {
  return matOf(id).glow;
}

/** Self-illumination floor — the doors, so a sightline never ends in nothing. */
export function wallEmit(id: number): number {
  return matOf(id).emit;
}

/** How far this wall steps in toward the corridor centre, in cells. */
export function wallInset(id: number): number {
  return matOf(id).inset;
}

/**
 * The deck, as raw pixels.
 *
 * The floor is cast per pixel rather than shaded per row, which needs the
 * texels rather than an image — so the PNG is decoded into a canvas once and
 * kept as bytes. `deck-plate.png` is a diamond-tread plate with a worn walkway
 * down its middle, so tiling it one plate to the cell gives both the seams and
 * the centre runner the references have.
 */
let deckCache: DeckPixels | null = null;

export function deckPixels(): DeckPixels | null {
  if (deckCache) return deckCache;
  const img = tile("deck-plate.png");
  if (!img) return null;
  const w = img.naturalWidth;
  const h = img.naturalHeight;
  const cv = document.createElement("canvas");
  cv.width = w;
  cv.height = h;
  const c = cv.getContext("2d", { willReadFrequently: true });
  if (!c) return null;
  c.drawImage(img, 0, 0);
  deckCache = {
    data: c.getImageData(0, 0, w, h).data,
    w,
    h,
    maskX: w - 1,
    maskY: h - 1,
  };
  return deckCache;
}

/** Start every tile loading so the first frame in the level is already dressed. */
export function preloadMaterials(): void {
  for (const f of FILES) tile(f);
}
