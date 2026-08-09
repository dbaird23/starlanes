/**
 * The octagonal cross-section: how big the 45 degree fold is for a given space.
 *
 * This is the *size* of the section only. Its **shape** — where the fold is on
 * the deck, and how it behaves at a corner — is not here and is not a property
 * of any wall: it is the heightfield in `BevelField`, built in `level.ts` and
 * marched in `raycast.ts`.
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
 * open cell, which `level.ts` precomputes per cell. A room 7x4 takes its
 * chamfer from the 4, so the octagon is the same all the way round the
 * compartment rather than four different sizes on four walls.
 *
 * ## What stops it running away
 *
 * Two chamfers of run `c` eat `2c` of the overhead between them, so a wide
 * space under a low overhead cannot have the chamfer its width asks for — the
 * vertical face would go negative and the section would collapse into a cove.
 * `FACE_MIN` is the strip of vertical face that has to survive, and it is what
 * actually limits the derelict's spine (2 cells wide, 1.2 tall): the reference
 * fraction wants 0.55 and the overhead can only pay for 0.51.
 *
 * Both limits are linear in their inputs, which matters more than it looks:
 * `level.ts` **averages and blurs** the per-cell runs so a narrow passage folds
 * smoothly into a wide one, and a blend of values that each satisfy
 * `c <= (height - FACE_MIN) / 2` still satisfies it.
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
 * The chamfer's run for a space of the given free span, under the given
 * overhead. `frac` is the sector's own ratio — the reference's 0.275.
 */
export function chamferRun(frac: number, span: number, height: number): number {
  const room = (height - FACE_MIN) / 2;
  const want = frac * span;
  const c = want < room ? want : room;
  return c < CHAM_MIN ? CHAM_MIN : c;
}
