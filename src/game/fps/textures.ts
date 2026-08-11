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
  "overhead.png",
  "deck-runner.png",
  "frame-rib.png",
  "bench-conduit.png",
  "breaker-dead.png",
  "breaker-live.png",
  "breaker-glow.png",
  "locker-closed.png",
  "locker-open.png",
  "bench-end-lo.png",
  "bench-end-hi.png",
  "soffit-end-lo.png",
  "soffit-end-hi.png",
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
  /**
   * ...and the chamfers'.
   *
   * The two chamfers do not share a tile, because they are not the same thing.
   * The lower one is a **bench** — a horizontal surface at knee height that a
   * ship runs its services along, and `bench-conduit.png` draws exactly that.
   * The upper one is a soffit: nothing is bolted to it, nothing is reachable on
   * it, and the same pipes on it would read as a ceiling that had been built
   * upside down.
   */
  bench: string;
  benchAlt?: string;
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
   * ...and the tile on the light channel set *into* it, which is a different
   * object. The ring is bolted steel and the channel is a fitting in a housing;
   * they were one tile only while the ring had no art of its own, and sharing
   * `ribTile` put the rib's bolt flanges on the light run.
   */
  stripTile: string;
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
const BENCH = "bench-conduit.png";
const TRIM = "trim-light-channel.png";
const RIB = "frame-rib.png";

const HULL: WallDress = {
  face: "wall-main.png",
  faceAlt: "wall-grimy.png",
  bench: BENCH,
  bevel: CHAM_MAIN,
  bevelAlt: CHAM_GRIMY,
  faceRepeat: 2,
  gainLower: 1.0,
  gainFace: 0.68,
  gainUpper: 0.34,
  rib: 0,
  ribTile: RIB,
  stripTile: TRIM,
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
    benchAlt: undefined,
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
    emit: 0.02,
    emitSector: 0.2,
  },
  [WALL.door]: {
    ...HULL,
    face: "door-face.png",
    faceAlt: undefined,
    // a bulkhead cap carries no services across it — the section closes here
    bench: CHAM_TRIM,
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

/* --------------------------------------------------------------- materials */

/**
 * What a tile is *made of*, as the light model needs it.
 *
 * The tiles are the white industrial corridor: `wall-main.png` has a mean
 * luminance of 194/255 and a peak of 235, which is a contrast ratio of 1.2:1.
 * Multiply that by a dim light and you get exactly what the first lit pass
 * produced — a flat mid-grey with no edge anywhere in it, a turned-down
 * brightness slider rather than a dark ship. The reference (`damage/damage.png`)
 * is near-black with a handful of blazing specular streaks: *contrast* is doing
 * all the work, and contrast has to come from the lighting, because there is
 * none in the albedo.
 *
 * So the texel is not the pixel any more. It is split three ways:
 *
 * - `base` scales and **cools** it into a plausible diffuse albedo. A derelict's
 *   bulkhead is not white; it is grey steel with the paint gone, and the
 *   reference's palette rule is cool ground with small warm accents. The warm
 *   accents are the suit lamp and the door's hazard band, so everything
 *   structural leans blue.
 * - `rough` / `metal` give it a specular lobe. This is the term that was missing
 *   entirely: nothing in the frame could catch a highlight, so no edge ever read
 *   as an edge. Trim and deck plate are the polished things.
 * - `bump` turns the tile's own luminance into surface relief through screen
 *   space derivatives (see `glscene.ts`). The tiles are photographic and full of
 *   high-frequency greeble that the albedo cannot show at 1.2:1 — as *height* it
 *   is rivets, ribs and panel lines that flare as the lamp sweeps across them.
 */
export interface TileMat {
  base: [number, number, number];
  rough: number;
  metal: number;
  bump: number;
  /** the colour this material's own bright pixels burn at */
  glow: [number, number, number];
}

/** Cool white, off `chamfer-trim.png`'s fixture, pulled toward the navy reference. */
const GLOW_COOL: [number, number, number] = [0.78, 0.92, 1.0];
/** ...and the warm accent, which is the door's hazard band and nothing else. */
const GLOW_WARM: [number, number, number] = [1.0, 0.72, 0.34];

const DEFAULT_MAT: TileMat = {
  base: [0.117, 0.125, 0.144],
  rough: 0.5,
  metal: 0.3,
  bump: 0.5,
  glow: GLOW_COOL,
};

export const TILE_MAT: Record<string, TileMat> = {
  // painted bulkhead: the palest tile, so it takes the hardest knock-down
  "wall-main.png": { base: [0.102, 0.109, 0.129], rough: 0.46, metal: 0.3, bump: 0.62, glow: GLOW_COOL },
  // the same panel oxidised — darker, rougher, and it catches almost nothing
  "wall-grimy.png": { base: [0.086, 0.089, 0.098], rough: 0.74, metal: 0.18, bump: 0.7, glow: GLOW_COOL },
  "chamfer-main.png": { base: [0.105, 0.113, 0.133], rough: 0.42, metal: 0.34, bump: 0.6, glow: GLOW_COOL },
  "chamfer-grimy.png": { base: [0.089, 0.093, 0.105], rough: 0.72, metal: 0.2, bump: 0.68, glow: GLOW_COOL },
  // trim is the polished thing: machined edges are where the reference's
  // highlights live, so this is the one material that reads as wet metal
  "chamfer-trim.png": { base: [0.107, 0.118, 0.14], rough: 0.5, metal: 0.45, bump: 0.5, glow: GLOW_COOL },
  "trim-light-channel.png": { base: [0.107, 0.118, 0.14], rough: 0.5, metal: 0.45, bump: 0.48, glow: GLOW_COOL },
  // "the deck is the brightest surface in frame because it catches what little
  // light there is" — art-reference/README.md, on damage.png
  "deck-plate.png": { base: [0.105, 0.113, 0.129], rough: 0.36, metal: 0.55, bump: 0.85, glow: GLOW_COOL },
  "door-face.png": { base: [0.113, 0.117, 0.125], rough: 0.4, metal: 0.42, bump: 0.55, glow: GLOW_WARM },
  /*
   * The ring's light channel and the overhead's spine, which are *diffusers*.
   * They share the trim's texture and share none of its material: a diffuser is
   * matte, it is not metal, and its own surface is nearly black — what you see
   * of it is what it is putting out, which is `aStrip`. Lit as trim, the strip
   * caught a specular lobe the size of itself and read as a grey plastic band
   * hooping the corridor whether the ship had power or not.
   */
  strip: { base: [0.05, 0.055, 0.065], rough: 0.95, metal: 0.0, bump: 0.0, glow: GLOW_COOL },
  /*
   * The overhead, which until now borrowed `deck-plate.png` and with it the
   * most polished material in the level (rough 0.36, metal 0.55 — a deck is
   * what boots have burnished). A ceiling is the opposite: painted, dusty and
   * touched by nothing. It is also the surface the suit lamp rakes most nearly
   * *along*, so a tight lobe on it spread a sheet of highlight across the whole
   * coffer and the overhead read as wet.
   */
  "overhead.png": { base: [0.086, 0.093, 0.109], rough: 0.78, metal: 0.16, bump: 0.6, glow: GLOW_COOL },
  /*
   * The deck keeps the polish — "the deck is the brightest surface in frame
   * because it catches what little light there is" (art-reference/README.md, on
   * damage.png) — and `deck-runner.png` splits it: diamond tread either side of
   * a strip worn smooth. The tread carries the bump and the runner the lobe,
   * and both come out of the one tile's own luminance.
   */
  "deck-runner.png": { base: [0.109, 0.117, 0.134], rough: 0.34, metal: 0.55, bump: 0.85, glow: GLOW_COOL },
  /*
   * The bay ring: painted structural steel, not the trim's machined housing.
   * It keeps a tighter lobe than the wall behind it on purpose — in
   * `damage/damage.png` the highlights are on the frame edges, and the ring is
   * where those edges are.
   */
  "frame-rib.png": { base: [0.101, 0.109, 0.128], rough: 0.5, metal: 0.32, bump: 0.6, glow: GLOW_COOL },
  /*
   * The bench, which is mostly pipe. Pipe is the one round thing in a level
   * built entirely of flats, so it wants a tight enough lobe to run a highlight
   * down its length as the lamp passes — that streak is the only curvature cue
   * the section has.
   */
  "bench-conduit.png": { base: [0.104, 0.112, 0.132], rough: 0.4, metal: 0.4, bump: 0.7, glow: GLOW_COOL },
  // the end pieces are the same material as the run they terminate; only the
  // picture differs, so a cap must not read as a different metal from its middle
  "bench-end-lo.png": { base: [0.104, 0.112, 0.132], rough: 0.4, metal: 0.4, bump: 0.7, glow: GLOW_COOL },
  "bench-end-hi.png": { base: [0.104, 0.112, 0.132], rough: 0.4, metal: 0.4, bump: 0.7, glow: GLOW_COOL },
  /*
   * The two fittings. They are the only surfaces in the level a player walks up
   * to and stands at, so they take the least knock-down of anything here — a
   * bulkhead is scenery at three metres and a breaker is read at arm's length —
   * and they keep a tighter lobe, because a machined enclosure full of switches
   * and dial glass is the one genuinely polished object on a derelict.
   */
  "breaker-dead.png": { base: [0.128, 0.135, 0.152], rough: 0.38, metal: 0.42, bump: 0.72, glow: GLOW_WARM },
  "breaker-live.png": { base: [0.128, 0.135, 0.152], rough: 0.38, metal: 0.42, bump: 0.72, glow: GLOW_WARM },
  "locker-closed.png": { base: [0.122, 0.129, 0.146], rough: 0.42, metal: 0.4, bump: 0.66, glow: GLOW_COOL },
  "locker-open.png": { base: [0.122, 0.129, 0.146], rough: 0.42, metal: 0.4, bump: 0.66, glow: GLOW_COOL },
};

export function matOf(tile: string): TileMat {
  return TILE_MAT[tile] ?? DEFAULT_MAT;
}

/**
 * The deck, and the overhead.
 *
 * **Both are drawn one tile to the cell and oriented along the corridor**, not
 * in world space, and that is the whole reason they are separate tiles rather
 * than one plate used twice. Each has a feature with a *direction* in it —
 * `deck-runner.png` a walkway worn down its middle, `overhead.png` a machinery
 * spine — and a direction laid down in world space runs along the corridor for
 * half the deck and straight across it for the other half. `mesh.ts` has
 * `alongX` per cell already; the uv is turned to match it there.
 *
 * The two tiles are drawn with their runs on opposite axes, so the swap is not
 * the same swap for both: the deck's runner is a horizontal band and the
 * overhead's spine a vertical one.
 */
export const DECK_TILE = "deck-runner.png";
export const CEIL_TILE = "overhead.png";
export const DECK_GAIN = 0.72;
export const CEIL_GAIN = 0.3;
/**
 * The overhead is cooled, which is now a tint on its own art rather than the
 * hard knock-down it needed while it was wearing the deck's. The palette rule
 * is a cool ground with small warm accents, and `overhead.png` is warm grey.
 */
export const CEIL_TINT: [number, number, number] = [0.84, 0.9, 1.0];
