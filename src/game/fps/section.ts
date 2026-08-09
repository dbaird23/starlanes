/**
 * The octagonal cross-section, and the apertures cut into it.
 *
 * Two things in this build need to agree about the same shape and would drift
 * if either wrote it out for itself:
 *
 * - `raycast.ts` builds the section of every wall column — deck, 45 degree
 *   chamfer, vertical face, 45 degree chamfer, overhead.
 * - `level.ts` builds a **framed opening** wherever a corridor's wall run is
 *   interrupted, and the hole in that frame has to be the same octagon or the
 *   section visibly steps as you pass through it.
 *
 * So the profile lives here, once.
 *
 * ## The chamfer is a fraction of the span, not a measurement in cells
 *
 * `art-reference/corridors/corridor-lit.png` gives the deck as ~45% of the
 * corridor's width, which is a chamfer of ~0.275 of the width on each side.
 * That is a **ratio**, and reading it as an absolute number of cells (which the
 * first cut did) makes it wrong in both directions at once: the derelict's
 * two-cell spine came out with a deck 72.5% of its width, and a six-cell room
 * got a sliver of chamfer on a wall three metres tall and read as a plain box.
 *
 * The span a chamfer is measured against is the **free span of the space**, not
 * the width of one corridor — `min(horizontal run, vertical run)` through the
 * open cell the wall is seen from, which `level.ts` precomputes per cell. A
 * room 7x4 takes its chamfer from the 4, so the octagon is the same all the way
 * round the compartment rather than four different sizes on four walls.
 *
 * ## What stops it running away
 *
 * Two chamfers of run `c` eat `2c` of the overhead between them, so a wide
 * space under a low overhead cannot have the chamfer its width asks for — the
 * vertical face would go negative and the section would collapse into a cove.
 * `FACE_MIN` is the strip of vertical face that has to survive, and it is what
 * actually limits the derelict's spine (2 cells wide, 1.2 tall): the reference
 * fraction wants 0.55 and the overhead can only pay for 0.51.
 */

/**
 * The deck. The camera eye sits at 0, so the deck is half a cell below it and
 * a sector's `height` is measured up from the deck rather than from the eye.
 */
export const DECK_Y = -0.5;

/** The vertical face never gets thinner than this, in cells. */
const FACE_MIN = 0.18;

/** ...and the chamfer never gets thinner than this, so a fold stays a fold. */
const CHAM_MIN = 0.1;

/**
 * How much of an opening the aperture takes, leaving the rest as frame.
 *
 * It is a **scale about the opening's centre** rather than an inset, which
 * matters: an inset of a fixed number of cells eats the whole vertical face of
 * a wide, low section (0.18 of face minus two 0.12 insets is negative) and the
 * octagon degenerates. Scaling keeps the aperture the same shape as the
 * section it frames, whatever that section is, and puts a small coaming under
 * the hole for free.
 */
const APERTURE_SCALE = 0.86;

/**
 * The chamfer's run for a space of the given free span, under the given
 * overhead. `frac` is the sector's own ratio — the reference's 0.275.
 */
export function chamferRun(frac: number, span: number, height: number): number {
  const room = (height - FACE_MIN) / 2;
  const want = frac * span;
  const c = want < room ? want : room;
  return c < CHAM_MIN ? CHAM_MIN : c;
}

/**
 * An octagonal hole in a flat bulkhead, in the plane of that bulkhead.
 *
 * `hw` is measured from the opening's centre along the wall; `yb` and `yt` are
 * heights **above the deck**, so the caller adds `DECK_Y` in the same place it
 * adds it to everything else.
 */
export interface Aperture {
  hw: number;
  yb: number;
  yt: number;
  /** the 45 degree corner run, in cells */
  cham: number;
}

/**
 * The aperture for an opening `span` cells wide under an overhead `height`
 * cells up — the corridor's own section, shrunk to leave a frame band.
 */
export function apertureFor(span: number, height: number, frac: number): Aperture {
  const k = APERTURE_SCALE;
  const hw = (span / 2) * k;
  const yb = (height / 2) * (1 - k);
  const yt = (height / 2) * (1 + k);
  let cham = chamferRun(frac, span, height) * k;
  // an octagon has to have room for a corner at both ends of both axes
  const capW = hw * 0.98;
  const capH = ((yt - yb) / 2) * 0.98;
  if (cham > capW) cham = capW;
  if (cham > capH) cham = capH;
  return { hw, yb, yt, cham };
}
