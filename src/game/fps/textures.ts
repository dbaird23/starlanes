/**
 * The corridor's materials, as a table the mesh builder reads.
 *
 * These used to be crops out of the status-bar plates in `public/hud/` — a
 * ready-made greeble, but a *sidebar*, drawn with its own lighting and its own
 * vertical rhythm, and it read as one. They are now the reference tiles under
 * `public/fps/`, cut from `art-reference/materials/` by `scripts/fps-tiles.mjs`.
 *
 * Nothing here loads an image any more: the section is real geometry and the
 * tiles are GPU textures, so `glscene.ts` owns the loading. What is left is the
 * *dressing* — which tile goes on which band of the octagon, how bright each
 * band is, whether the wall stands proud of its neighbours, and whether it
 * emits.
 *
 * **The chamfers have their own tiles, and they are 3:1 rather than square.**
 * A chamfer band's slope run is about 0.39 of a cell against a cell of length,
 * so a square tile squashed onto it loses its vertical structure and comes out
 * as lengthwise ribbons. `chamfer-*.png` are 384x128 bands cut from the same
 * sources at the proportion the band is actually sampled at.
 *
 * **`trim-light-channel.png` goes on the bay frames and the doors only.** On
 * every chamfer it was a light strip down every wall, which is a strip down no
 * wall in particular, and the bay rhythm — the thing the references actually
 * lead with — disappeared into it.
 *
 * Paths go through `asset()` in `glscene.ts`, or a bare `/fps/...` 404s on the
 * sub-path Pages deploy.
 */

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

/** Every tile the mini-game ships, so they can all be started at once. */
export const TILE_FILES = [
  "wall-main.png",
  "wall-grimy.png",
  "trim-light-channel.png",
  "deck-plate.png",
  "door-face.png",
  "chamfer-main.png",
  "chamfer-grimy.png",
  "chamfer-trim.png",
] as const;

/**
 * How a wall id dresses the three bands of the octagon.
 *
 * `gain` is where most of the section comes from, and it is a *staircase*: the
 * lower chamfer is a bench facing up into the room and reads bright, the
 * vertical face reads mid, the upper chamfer turns its face away and reads
 * dark. Give all three the same value and the octagon collapses into a flat
 * strip however good the textures are. The deck and the overhead have their own
 * two steps (`DECK_GAIN`, `CEIL_GAIN`) so every fold in the section has a step
 * in brightness across it and not just a change of slope.
 */
export interface WallDress {
  /** the vertical face's tile, and the alternate that breaks the grid */
  face: string;
  faceAlt?: string;
  /** ...and the chamfers' */
  bevel: string;
  bevelAlt?: string;
  /** horizontal repeats of the face tile per cell of wall length */
  faceRepeat: number;
  gainLower: number;
  gainFace: number;
  gainUpper: number;
  /**
   * How far this wall stands **proud** of its neighbours, in cells, as real
   * geometry: a prism whose front is the same octagon profile pushed `rib`
   * toward the corridor centre, closed at both ends by a cap.
   *
   * Nonzero only on the bay frames. The references' single strongest cue that a
   * corridor is not one endless tube is a structural ring every few metres, and
   * with a mesh a ring can actually be a ring — brightness on a smooth tube left
   * the silhouette as two perfectly converging lines, where the reference is
   * nested octagons receding and their outlines are the depth cue.
   */
  rib: number;
  /** the tile on the rib's own faces; wrapped **around** the octagon (see mesh) */
  ribTile: string;
  /**
   * Self-illumination, keyed off the tile's own bright pixels: `emit` always,
   * plus `emitSector` scaled by how much power the sector still has.
   *
   * The split is the difference between a light and a lit thing. A bay frame's
   * channel is a *fitting* — dead ship, dead fitting — so it is nearly all
   * sector. A door carries a floor that no sector can take away, because rule 6
   * of the art direction is that a sightline terminates on a bulkhead, which it
   * cannot do if the bulkhead is as black as the corridor it caps.
   */
  emit: number;
  emitSector: number;
}

const CHAM_MAIN = "chamfer-main.png";
const CHAM_GRIMY = "chamfer-grimy.png";
const CHAM_TRIM = "chamfer-trim.png";
const TRIM = "trim-light-channel.png";

const HULL: WallDress = {
  face: "wall-main.png",
  faceAlt: "wall-grimy.png",
  bevel: CHAM_MAIN,
  bevelAlt: CHAM_GRIMY,
  faceRepeat: 2,
  gainLower: 1.0,
  gainFace: 0.68,
  gainUpper: 0.34,
  rib: 0,
  ribTile: TRIM,
  emit: 0,
  emitSector: 0,
};

export const DRESS: Record<number, WallDress> = {
  [WALL.hull]: HULL,
  [WALL.housing]: {
    ...HULL,
    face: "wall-grimy.png",
    faceAlt: undefined,
    bevel: CHAM_GRIMY,
    bevelAlt: undefined,
    gainLower: 0.92,
    gainFace: 0.6,
    gainUpper: 0.3,
  },
  /*
   * A frame is hull with a ring bolted onto it: the plain profile behind is
   * still `wall-main`, and everything that makes it a frame — the 0.15 it
   * stands proud, the trim on its faces, the channel that lights up when the
   * section has power — is on the prism.
   */
  [WALL.frame]: {
    ...HULL,
    rib: 0.15,
    ribTile: TRIM,
    emit: 0.05,
    emitSector: 0.62,
  },
  [WALL.door]: {
    ...HULL,
    face: "door-face.png",
    faceAlt: undefined,
    bevel: CHAM_TRIM,
    bevelAlt: undefined,
    faceRepeat: 1,
    gainLower: 0.97,
    gainFace: 0.95,
    gainUpper: 0.44,
    rib: 0,
    emit: 0.34,
    emitSector: 0.5,
  },
};

export function dressOf(id: number): WallDress {
  return DRESS[id] ?? HULL;
}

/**
 * The deck, and the overhead.
 *
 * There is still no *ceiling* art anywhere in `art-reference/`, so the overhead
 * borrows the deck plate knocked down and cooled; left flat it read as a void
 * hanging over the corridor. `deck-plate.png` is a diamond-tread plate with a
 * worn walkway down its middle, so one plate to the cell gives both the seams
 * and the centre runner the references have.
 */
export const DECK_TILE = "deck-plate.png";
export const DECK_GAIN = 0.72;
export const CEIL_GAIN = 0.3;
/** The overhead is the same plate, cooled — see `CEIL_*` in the old raycaster. */
export const CEIL_TINT: [number, number, number] = [0.5, 0.55, 0.66];
