/**
 * The transfer function, shared by every renderer in the game.
 *
 * The on-foot scene and the race scene are separate three.js renderers with
 * separate materials, but they must agree about what a given brightness *means*
 * or the two mini-games look like they were lit by different studios. So the
 * linearise / tone map / encode triple lives here and is imported by both.
 *
 * `sqrt` / square rather than 2.2 / 1/2.2: one instruction each, and the
 * difference between gamma 2 and gamma 2.2 is nothing next to the difference
 * between doing this and not doing it.
 *
 * Both renderers set `outputColorSpace = LinearSRGBColorSpace` precisely because
 * the shader owns this step — left at three's default the frame is encoded
 * twice, every midtone lifts by about a third, and a dead compartment reads as
 * half-lit.
 */

/** The white point of the extended Reinhard shoulder. */
export const WHITE = 1.9;

/**
 * `lin()` and `encode()`, as GLSL.
 *
 * The shoulder has unity slope through the midtones, so a specular streak stays
 * a streak instead of clipping to a flat white blob — which is what lets a value
 * above 1.0 be *meaningful* rather than clamped. Both scenes need that: the
 * derelict for a specular hit on a bay frame, the race for a gate's emissive
 * core against a bright nebula.
 */
export const TONEMAP = /* glsl */ `
vec3 lin(vec3 c) { return c * c; }
vec3 encode(vec3 c) {
  c = max(c, vec3(0.0));
  c = c * (1.0 + c / ${(WHITE * WHITE).toFixed(2)}) / (1.0 + c);
  return sqrt(c);
}
`;
