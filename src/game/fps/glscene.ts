/**
 * The on-foot renderer: three.js over the level mesh.
 *
 * What this replaces is five rounds of a scanline raycaster. The last of them
 * had the octagonal section correct along a straight wall and could not make it
 * turn a corner without artifacts — the fold-as-heightfield march punched spikes
 * through the deck, scalloped the section into lobes around every bay rib, and
 * cost 1.6x the frame time to do it. Every one of those problems is a problem of
 * *deriving* a surface per pixel, and none of them exists once the surface is
 * triangles: see `mesh.ts`, which builds the whole deck once at level load.
 *
 * ## It still draws into the 2D canvas
 *
 * `Game` owns one 2D canvas and blits everything through it, and the HUD, the
 * viewmodel and the end cards are all canvas 2D. So the GL context lives on its
 * own offscreen canvas and the finished frame is `drawImage`d across — which the
 * browser keeps on the GPU — rather than the mini-game seizing the element and
 * having to reproduce the rest of the UI in WebGL.
 *
 * ## One shader, one light model
 *
 * Every wall, chamfer, deck and overhead in the level shares a single
 * `ShaderMaterial`; what differs between them arrives as four per-vertex floats
 * baked by `mesh.ts` (`aLight`, `aGain`, `aEmit`, `aStrip`), a texture, and a
 * handful of material uniforms out of `TILE_MAT`. So the whole deck is a dozen
 * draw calls and the section's brightness staircase — deck, lower chamfer, face,
 * upper chamfer, overhead — survives intact.
 *
 * **The model is lit, not tinted, and that is the whole of this pass.** What it
 * replaced multiplied an 8-bit sRGB texel by a scalar, which is a brightness
 * slider: the far wall came out as visible as the near one, the deck as bright
 * as the overhead, nothing could be brighter than its own texture, and the
 * result was uniform mid-grey at every distance in every compartment. The
 * reference for the resting state (`art-reference/damage/damage.png`) is the
 * opposite — near black, *one* source, and a handful of specular streaks well
 * past white on wet metal edges. Contrast does all the work there, and contrast
 * cannot come out of these tiles' albedo, which runs 194 mean against a 235 peak.
 * So:
 *
 * - **Linear light, tone mapped, encoded here.** Square on the way in, extended
 *   Reinhard, `sqrt` on the way out. Values above 1 mean something instead of
 *   clipping, which is what lets a hit on a frame read as a light source while
 *   the panel behind it stays black.
 * - **The suit lamp** is the mechanic and the only real source on a dead ship:
 *   inverse-square with a knee, a hard cutoff at `LAMP_RANGE`, a mild cone — and
 *   **off the eye**, on the chest, because a light at the eye has `L == V` and
 *   its specular lobe collapses onto `pow(ndl, n)`, which is a soft glow on
 *   whatever faces you and never an edge.
 * - **Real materials.** Roughness, metalness and a derivative-map bump per tile
 *   (`TILE_MAT`), so the tiles' greeble is *relief* rather than an invisible
 *   1.2:1 pattern, and so edges catch.
 * - **The sector term** is still Doom's: light belongs to an *area*, not a wall,
 *   so a dead section stays dead while the one you came from is lit. It is cool
 *   where the lamp is warm — the palette rule is cool ground, small warm accents
 *   — and it is the term fog attenuates.
 * - **Fittings are never fogged.** `aStrip` is an authored light (the bay ring's
 *   channel and the overhead's spine, built as geometry in `mesh.ts`); `aEmit`
 *   keys off the tile's own bright pixels, which is right for exactly one thing,
 *   the door's hazard band. Both scale with the sector — a dead ship's fittings
 *   are dead — but keep a small floor, because rule 6 is that a sightline
 *   terminates on a bulkhead and it cannot do that if the bulkhead is as black
 *   as the corridor.
 *
 * ## The projection is the art direction's, not three's default
 *
 * `PLANE` and `WALL_H` in the old renderer were 0.8 and 1.0 because a section
 * authored to the reference's fractions has to *be* those fractions on screen.
 * The same thing here is a 53.13 degree vertical FOV: `tan(fov/2) = 0.5`, so at
 * 16:10 the horizontal half-tangent is 0.8 and a world unit of height covers
 * exactly the pixels a world unit of width does.
 */

import * as THREE from "three";
import { asset } from "../../asset";
import { buildLevelMesh, type LevelMesh } from "./mesh";
import { TILE_FILES, matOf } from "./textures";
import type { FpsLevel, FpsSprite } from "./types";

/** The eye, half a cell above the deck — what `hover` 0.5 means to a billboard. */
export const EYE = 0.5;

/** `tan(fov/2) = 0.5`; see the header. */
const FOV_DEG = (2 * Math.atan(0.5) * 180) / Math.PI;

/* ------------------------------------------------------------ the lighting */

/**
 * The whole model runs in **linear light and is tone mapped**, which the first
 * lit pass did not do and is most of why it looked like a turned-down brightness
 * slider. Multiplying 8-bit sRGB by a dim number moves everything toward the
 * same mid grey at the same rate: the far wall came out as visible as the near
 * one, the deck as bright as the overhead, and nothing anywhere could be
 * brighter than its own texture. `damage/damage.png` is the opposite — near
 * black, one source, and a few streaks well past white on the wet edges.
 *
 * So: linearise the texel (gamma 2, which is a multiply), light it, roll the
 * highlights off with an extended Reinhard curve, and encode back with a
 * `sqrt`. Values above 1 are then meaningful rather than clipped, which is what
 * lets a specular hit on a bay frame read as a *light source* while the panel
 * two metres behind it stays black.
 */
const WHITE = 1.9;

/**
 * The suit lamp: the mechanic, and the only real source on a dead ship.
 *
 * It is **not at the eye**. A light at the eye has `L == V`, so its specular
 * lobe collapses onto `pow(ndl, n)` — a soft glow on whatever faces you and
 * never an edge. Every highlight in the reference rakes across the metal from
 * off-axis. So the lamp sits on the chest: to the right, a little down, a little
 * forward. That offset is the entire reason edges catch at all, and it is also
 * why the deck lights first, which is what the reference README says the deck
 * should do.
 */
const LAMP_RIGHT = 0.17;
const LAMP_DOWN = 0.13;
const LAMP_FWD = 0.05;
/** Hard cutoff, in cells. Beyond this the ship is what the ship is putting out. */
const LAMP_RANGE = 6.5;
/** The inverse-square knee: the pool's own radius. */
const LAMP_HALF = 0.9;
/** Radiance at the knee, in linear light. */
const LAMP_POWER = 3.0;
/** How much survives at the edge of the view — a slight cone, not a spot. */
const LAMP_EDGE = 0.3;
/**
 * Wrap-around on the diffuse term. A helmet lamp inside a metal tube bounces,
 * and at zero the upper chamfer turns its face away and takes the top half of
 * the octagon's silhouette to black with it.
 */
const LAMP_WRAP = 0.22;
/** Slightly warm — the warm accent in a palette that is otherwise cool. */
const LAMP_COL = new THREE.Color(1.0, 0.93, 0.82);

/**
 * The sector term, which is Doom's: light belongs to an *area*. It is what the
 * *ship* is still putting out, it is the term fog eats, and it is cool, because
 * emergency lighting on a corpse is not the same colour as the thing on your
 * chest.
 */
const SECTOR_COL = new THREE.Color(0.62, 0.76, 1.0);
const SECTOR_POWER = 1.6;
const FOG_K = 0.16;
const FOG_MAX = 0.9;

/**
 * What a light fitting puts out: a floor that survives a dead sector, plus what
 * the sector is still able to feed it. `aStrip` says how much of a fitting a
 * surface is; this says how hard one burns.
 *
 * The floor is small and deliberately not zero. A fitting on a dead ship is
 * dead — `damage/damage.png` has no lit strip anywhere in it — but a sightline
 * ending in undifferentiated black is the other failure, and a trace along the
 * ring is what tells you at five metres that there is a bay there at all.
 */
const STRIP_FLOOR = 0.012;
const STRIP_SECTOR = 2.4;

/** Global scale on the per-tile bump strength; see `TileMat.bump`. */
const BUMP_K = 0.075;

/**
 * A material's specular colour: its own hue, at the reflectance a bare metal
 * actually has. See `uSpec` in the fragment shader for why this is not `base`.
 */
function specOf(m: { base: [number, number, number] }): THREE.Color {
  const k = 0.92 / Math.max(m.base[0], m.base[1], m.base[2], 1e-4);
  return new THREE.Color(m.base[0] * k, m.base[1] * k, m.base[2] * k);
}

/** A `THREE.Color` as a GLSL literal, so a constant can be edited in one place. */
function glslColor(c: THREE.Color): string {
  return `vec3(${c.r.toFixed(4)}, ${c.g.toFixed(4)}, ${c.b.toFixed(4)})`;
}

const SHARED_UNIFORMS = {
  uCam: { value: new THREE.Vector3() },
  uFwd: { value: new THREE.Vector3(1, 0, 0) },
  uLampPos: { value: new THREE.Vector3() },
  uTexMix: { value: 1 },
  uMinLight: { value: 0 },
};

const VERT = /* glsl */ `
attribute float aLight;
attribute float aGain;
attribute float aEmit;
attribute float aStrip;
varying vec2 vUv;
varying vec3 vWorld;
varying vec3 vNrm;
varying float vLight;
varying float vGain;
varying float vEmit;
varying float vStrip;
void main() {
  vUv = uv;
  vec4 wp = modelMatrix * vec4(position, 1.0);
  vWorld = wp.xyz;
  vNrm = mat3(modelMatrix) * normal;
  vLight = aLight;
  vGain = aGain;
  vEmit = aEmit;
  vStrip = aStrip;
  gl_Position = projectionMatrix * viewMatrix * wp;
}
`;

/**
 * The two halves of the pipeline, shared by the world and the billboards so
 * they cannot disagree about what a given brightness means.
 *
 * `sqrt` / square rather than 2.2 / 1/2.2: one instruction each, and the
 * difference between gamma 2 and gamma 2.2 is nothing next to the difference
 * between doing this and not doing it.
 */
const COMMON = /* glsl */ `
vec3 lin(vec3 c) { return c * c; }
vec3 encode(vec3 c) {
  c = max(c, vec3(0.0));
  // extended Reinhard: unity slope through the midtones, a soft shoulder, so a
  // specular streak stays a streak instead of clipping to a flat white blob
  c = c * (1.0 + c / ${(WHITE * WHITE).toFixed(2)}) / (1.0 + c);
  return sqrt(c);
}
/** Distance falloff for the suit lamp: inverse-square core, hard cutoff. */
float lampFall(float d) {
  float q = d / ${LAMP_HALF.toFixed(3)};
  float e = d / ${LAMP_RANGE.toFixed(1)};
  float e2 = e * e;
  return max(0.0, 1.0 - e2 * e2) / (1.0 + q * q);
}
`;

const FRAG = /* glsl */ `
uniform sampler2D map;
uniform vec3 uTint;
uniform vec3 uBase;
uniform vec3 uGlow;
uniform vec3 uSpec;
uniform vec3 uMat;      // x roughness, y metalness, z bump
uniform vec3 uCam;
uniform vec3 uFwd;
uniform vec3 uLampPos;
uniform float uTexMix;
uniform float uMinLight;
varying vec2 vUv;
varying vec3 vWorld;
varying vec3 vNrm;
varying float vLight;
varying float vGain;
varying float vEmit;
varying float vStrip;

${COMMON}

void main() {
  /*
   * **One texture read.** The tile is albedo, height, gloss and emissive key all
   * at once — there was a second, mip-biased read here for the last three, on
   * the theory that a filtered height is what stops the specular aliasing. It
   * is not (see Ns below), it cost about a fifth of the frame on the software
   * rasteriser, and dropping it changed the blown-pixel count by zero.
   */
  vec3 texel = mix(vec3(0.62), texture2D(map, vUv).rgb, uTexMix);
  float lum = dot(texel, vec3(0.299, 0.587, 0.114));

  /*
   * Albedo. uBase is what turns a photograph of a *white* corridor into a
   * derelict's grey steel, and it is where the palette lives: everything
   * structural leans cool, so the two warm things in the frame — the suit lamp
   * and the door's hazard band — are the accents.
   */
  vec3 alb = lin(texel) * uBase * uTint * vGain;

  vec3 V = normalize(uCam - vWorld);
  float dc = length(uCam - vWorld);

  /* ---- the suit lamp ---------------------------------------------------- */
  vec3 lv = uLampPos - vWorld;
  float dl = length(lv);
  vec3 L = lv / max(dl, 1e-4);
  float ca = max(dot(-L, uFwd), 0.0);
  float fall = lampFall(dl) * mix(${LAMP_EDGE.toFixed(3)}, 1.0, ca * ca);

  vec3 col = vec3(0.0);
  /*
   * Everything the lamp does is inside this branch, and the test is **exact**
   * rather than a threshold: lampFall cuts to zero at LAMP_RANGE, so past seven
   * metres there is nothing to compute and no edge where it stops. On a dead
   * ship that is most of the frame — the relief, the two normals and the
   * specular lobe below are the expensive part of this shader, and beyond the
   * lamp they are all multiplied by nothing.
   */
  if (fall > 0.0) {
    /*
     * Relief, from the tile's own luminance through screen-space derivatives
     * (Mikkelsen's derivative maps, so no tangent frame is needed).
     *
     * These tiles are photographic and packed with rivets, ribs and panel
     * lines, and as *albedo* none of it survives: wall-main.png runs 194 mean
     * against a 235 peak, a contrast ratio of 1.2:1, which is why the first lit
     * pass came out as one flat tone however it was lit. Read as *height* the
     * same detail is geometry, and a moving off-axis lamp makes it flare and go
     * out as you walk. That is most of the difference between this and a grey
     * box.
     */
    vec3 Ngeo = normalize(vNrm);
    vec3 N = Ngeo;
    if (uMat.z > 0.0 && uTexMix > 0.0) {
      vec3 dpx = dFdx(vWorld);
      vec3 dpy = dFdy(vWorld);
      vec3 r1 = cross(dpy, N);
      vec3 r2 = cross(N, dpx);
      float det = dot(dpx, r1);
      vec3 grad = sign(det) * (dFdx(lum) * r1 + dFdy(lum) * r2);
      /*
       * ...damped by distance, by grazing incidence, and above all by **how
       * much of the tile the pixel covers**.
       *
       * A derivative map is only meaningful while the texture is near
       * magnification. Once a pixel spans several texels the gradient is noise,
       * the perturbed normal is a different normal in every 2x2 quad, and a
       * sharp lobe over it fills the wall with isolated white dots.
       *
       * It has to be damped *here*, on the normal, and not by widening the
       * lobe: GPU derivatives are per-quad, so fwidth of a per-quad-constant
       * noise is **zero**, and every Toksvig-style measure of it reads the
       * surface as perfectly smooth. Measured: 90x on the lobe changed the
       * count of blown pixels by nothing at all. The footprint is the honest
       * signal, and 150 is roughly half strength at two texels to the pixel.
       */
      float bk = ${BUMP_K.toFixed(3)} * uMat.z / (1.0 + 0.3 * dc);
      bk /= 1.0 + 150.0 * length(fwidth(vUv));
      bk *= smoothstep(0.0, 0.4, dot(N, V));
      N = normalize(abs(det) * N - bk * grad);
    }

    /*
     * **The specular runs on a much flatter normal than the diffuse does**, and
     * that is the settlement between the two things the derivative map is being
     * asked for.
     *
     * As a diffuse term the relief is exactly right: ndl varies smoothly, the
     * rivets and panel lines shade, and the wall stops being one tone. As a
     * specular term it is a lottery — the lobe's peak scales with its own
     * exponent, so a normal that wanders a few degrees between neighbours turns
     * a wall into a field of isolated dots. Nothing filters that out from
     * inside the lobe (see above), and the reference's highlights are not on
     * the greeble anyway: in damage/damage.png they are on the frame edges and
     * the hanging cable, which here are real geometry with real normals. So the
     * lobe gets a third of the perturbation and the shading gets all of it.
     * With that one change the blown-pixel count fell from 645 to 48.
     */
    vec3 Ns = normalize(mix(Ngeo, N, 0.4));

    float ndl = dot(N, L);
    float diff = max(0.0, (ndl + ${LAMP_WRAP.toFixed(3)}) / ${(1 + LAMP_WRAP).toFixed(3)});

    /*
     * Specular. The materials had none at all, so no edge in the level could
     * ever catch — and in damage/damage.png the highlights on the frame edges
     * and the hanging cable are most of what you can see at all. Gloss rides
     * the tile's own brightness as well as the material's roughness, because on
     * these tiles the bright pixels *are* the bare machined metal and the dark
     * ones are the dirt; and it is roughened again by the UV footprint, which
     * is minification and grazing incidence in one number. Far metal is
     * filtered metal.
     */
    float gloss = clamp(1.0 - uMat.x * (1.35 - 0.5 * lum), 0.02, 0.95);
    gloss /= 1.0 + 60.0 * length(fwidth(vUv)) + 0.03 * dc;
    float shin = exp2(1.0 + 7.5 * gloss);
    vec3 H = normalize(L + V);
    float spec = pow(max(dot(Ns, H), 0.0), shin) * (shin + 8.0) * 0.034;
    spec *= step(0.0, ndl);

    // damped, because a full Schlick rim turns every receding wall in a
    // corridor into a bright edge and the corridor stops having a far end
    float g = 1.0 - max(dot(Ns, V), 0.0);
    float g2 = g * g;
    float fres = 0.65 * g2 * g2 * g;
    /*
     * uSpec is the material's own hue at full brightness, **not** its albedo.
     * Reflectance is not reflectivity: the albedo here has already been knocked
     * down twice — by the base tint that turns a white corridor into grey
     * steel, and by the section's band staircase — and feeding that to a
     * metal's F0 gave every metal in the level an F0 near 0.03, so the polished
     * trim and the deck plate, the two things that are supposed to throw the
     * reference's highlights, reflected less than the paint did.
     */
    vec3 F0 = mix(vec3(0.045), uSpec, uMat.y);
    vec3 F = F0 + (vec3(1.0) - F0) * fres;

    vec3 lampE = ${glslColor(LAMP_COL)} * (${LAMP_POWER.toFixed(2)} * fall);
    col = lampE * (alb * diff * (1.0 - 0.7 * uMat.y) + F * spec);
  }

  /* ---- ...and what the ship is still putting out ------------------------ */
  float sec = max(vLight, uMinLight);
  float fogKeep = max(1.0 - ${FOG_MAX.toFixed(3)}, exp(-dc * ${FOG_K.toFixed(4)}));
  col += alb * ${glslColor(SECTOR_COL)} * (sec * fogKeep * ${SECTOR_POWER.toFixed(3)});

  /*
   * ...and the fittings, which are never fogged.
   *
   * Two kinds. vStrip is an authored light — the bay ring's channel and the
   * overhead's spine, built as geometry in mesh.ts — and is uniform over its
   * own surface. vEmit is keyed off the tile's own bright pixels, which is
   * right for exactly one thing, the door's hazard band, and its threshold has
   * to sit high or a pale housing lights up instead of the fitting in it.
   *
   * The 0.3 on the keyed term is a floor, and it is rule 6 of the art
   * direction: a sightline terminates on a bulkhead, and it cannot do that if
   * the bulkhead is as black as the corridor it caps. Scaled by the sector
   * alone, the door's hazard band went out with everything else and the dead
   * third of the ship ended in undifferentiated black in every direction.
   */
  float fit = vStrip * (${STRIP_FLOOR.toFixed(3)} + ${STRIP_SECTOR.toFixed(2)} * sec);
  float key = smoothstep(0.80, 0.965, lum);
  // a hint of the tile's own structure through the diffuser, or a strip is a
  // rectangle of one flat value and reads as painted plastic rather than as lit
  col += uGlow * (fit * (0.72 + 0.56 * lum) + key * vEmit * (0.3 + sec));

  gl_FragColor = vec4(encode(col), 1.0);
}
`;

const SPRITE_VERT = /* glsl */ `
varying vec2 vUv;
varying vec3 vWorld;
void main() {
  vUv = uv;
  vec4 wp = modelMatrix * vec4(position, 1.0);
  vWorld = wp.xyz;
  gl_Position = projectionMatrix * viewMatrix * wp;
}
`;

/**
 * Billboards go through the same two light terms as the walls do.
 *
 * They have to: every surface in the frame already knows its own distance, and
 * if any one of them skipped the lamp they would disagree about how far away
 * things are — a Wraith lit differently from the deck it is standing on reads as
 * a decal, not a creature.
 */
const SPRITE_FRAG = /* glsl */ `
uniform sampler2D map;
uniform vec3 uCam;
uniform vec3 uFwd;
uniform vec3 uLampPos;
uniform vec2 uFrame;
uniform float uLight;
uniform float uMinLight;
uniform float uAlpha;
uniform float uFlash;
uniform float uUnlit;
varying vec2 vUv;
varying vec3 vWorld;

${COMMON}

void main() {
  vec4 t = texture2D(map, vec2(uFrame.x + vUv.x * uFrame.y, vUv.y));
  if (t.a < 0.35) discard;

  float dc = length(uCam - vWorld);
  float fogKeep = max(1.0 - ${FOG_MAX.toFixed(3)}, exp(-dc * ${FOG_K.toFixed(4)}));

  vec3 lv = uLampPos - vWorld;
  float dl = length(lv);
  float ca = max(dot(normalize(-lv), uFwd), 0.0);
  float cone = mix(${LAMP_EDGE.toFixed(3)}, 1.0, ca * ca);
  /*
   * A billboard has no usable normal, so it takes the lamp flat — but through
   * the *same* falloff and the same encode as everything else. If any surface
   * in the frame skipped either, they would disagree about how far away things
   * are, and a Wraith lit differently from the deck it hovers over reads as a
   * decal rather than a creature.
   */
  vec3 lampE = ${glslColor(LAMP_COL)} * (${(LAMP_POWER * 0.32).toFixed(3)} * lampFall(dl) * cone);
  vec3 amb = ${glslColor(SECTOR_COL)} * (max(uLight, uMinLight) * fogKeep * ${SECTOR_POWER.toFixed(3)});

  vec3 alb = lin(t.rgb);
  vec3 col = alb * (lampE + amb);
  // an explosion is light, not paint: it ignores every term above
  col = mix(col, alb * 3.0, uUnlit);
  col += vec3(uFlash) * t.a;
  gl_FragColor = vec4(encode(col), t.a * uAlpha);
}
`;

interface SpriteSlot {
  mesh: THREE.Mesh;
  mat: THREE.ShaderMaterial;
}

export class GlScene {
  private readonly renderer: THREE.WebGLRenderer;
  private readonly scene = new THREE.Scene();
  private readonly camera: THREE.PerspectiveCamera;
  private readonly level: FpsLevel;
  private readonly mesh: LevelMesh;
  private readonly textures = new Map<string, THREE.Texture>();
  private readonly sheets = new Map<string, THREE.Texture>();
  private readonly slots: SpriteSlot[] = [];
  private readonly quad = new THREE.PlaneGeometry(1, 1);
  private w = 0;
  private h = 0;
  /** triangles in the static mesh, for the record */
  readonly tris: number;

  constructor(level: FpsLevel) {
    this.level = level;
    this.renderer = new THREE.WebGLRenderer({
      antialias: true,
      alpha: false,
      powerPreference: "high-performance",
    });
    this.renderer.setPixelRatio(1);
    this.renderer.setClearColor(0x000000, 1);
    /*
     * **The shader owns the transfer function, so three must not touch it.**
     *
     * The light model runs in linear light and does its own tone map and its
     * own encode (`encode()` in `COMMON`), because a dead ship is a high
     * dynamic range problem: near-black everywhere, and a handful of specular
     * hits well past white. Left at three's default the frame would be encoded
     * twice — every midtone lifts by around a third and a dead compartment
     * reads as half-lit, which is exactly the flat grey this pass exists to
     * fix. Tell the renderer the frame is already in the output space.
     */
    this.renderer.outputColorSpace = THREE.LinearSRGBColorSpace;
    this.camera = new THREE.PerspectiveCamera(FOV_DEG, 1.6, 0.02, 40);

    for (const f of TILE_FILES) this.tile(f);

    this.mesh = buildLevelMesh(level);
    this.tris = this.mesh.tris;
    for (const g of this.mesh.groups) {
      const tm = matOf(g.mat);
      const mat = new THREE.ShaderMaterial({
        uniforms: {
          ...SHARED_UNIFORMS,
          map: { value: this.tile(g.tile) },
          uTint: { value: new THREE.Color(g.tint[0], g.tint[1], g.tint[2]) },
          uBase: { value: new THREE.Color(tm.base[0], tm.base[1], tm.base[2]) },
          uGlow: { value: new THREE.Color(tm.glow[0], tm.glow[1], tm.glow[2]) },
          uSpec: { value: specOf(tm) },
          uMat: { value: new THREE.Vector3(tm.rough, tm.metal, tm.bump) },
        },
        vertexShader: VERT,
        fragmentShader: FRAG,
        side: THREE.FrontSide,
      });
      const m = new THREE.Mesh(g.geometry, mat);
      m.frustumCulled = true;
      this.scene.add(m);
    }
  }

  /** The GL canvas, for the caller to blit. */
  get domElement(): HTMLCanvasElement {
    return this.renderer.domElement;
  }

  private tile(file: string): THREE.Texture {
    let t = this.textures.get(file);
    if (!t) {
      t = new THREE.TextureLoader().load(asset(`fps/${file}`));
      t.wrapS = THREE.RepeatWrapping;
      t.wrapT = THREE.RepeatWrapping;
      t.anisotropy = Math.min(4, this.renderer.capabilities.getMaxAnisotropy());
      this.textures.set(file, t);
    }
    return t;
  }

  /**
   * A Nova sprite sheet as a texture. `NearestFilter` on purpose: the sheets are
   * horizontal strips of 36 rotations, and any linear tap across a frame edge
   * bleeds the neighbouring rotation into the silhouette.
   */
  private sheet(img: HTMLImageElement): THREE.Texture {
    let t = this.sheets.get(img.src);
    if (!t) {
      t = new THREE.Texture(img);
      t.magFilter = THREE.NearestFilter;
      t.minFilter = THREE.NearestFilter;
      t.generateMipmaps = false;
      t.needsUpdate = true;
      this.sheets.set(img.src, t);
    }
    return t;
  }

  private slot(i: number): SpriteSlot {
    let s = this.slots[i];
    if (!s) {
      const mat = new THREE.ShaderMaterial({
        uniforms: {
          map: { value: null },
          uCam: SHARED_UNIFORMS.uCam,
          uFwd: SHARED_UNIFORMS.uFwd,
          uLampPos: SHARED_UNIFORMS.uLampPos,
          uFrame: { value: new THREE.Vector2(0, 1) },
          uLight: { value: 1 },
          uMinLight: SHARED_UNIFORMS.uMinLight,
          uAlpha: { value: 1 },
          uFlash: { value: 0 },
          uUnlit: { value: 0 },
        },
        vertexShader: SPRITE_VERT,
        fragmentShader: SPRITE_FRAG,
        transparent: true,
        side: THREE.DoubleSide,
      });
      const mesh = new THREE.Mesh(this.quad, mat);
      mesh.frustumCulled = false;
      mesh.visible = false;
      this.scene.add(mesh);
      s = { mesh, mat };
      this.slots[i] = s;
    }
    return s;
  }

  /** The sector standing at a world point — what lights a billboard. */
  private lightAt(x: number, y: number): number {
    const gx = Math.floor(x);
    const gy = Math.floor(y);
    const { w, h } = this.level;
    if (gx < 0 || gy < 0 || gx >= w || gy >= h) return 0;
    return this.level.sectors[this.level.sectorOf[gy * w + gx]].light;
  }

  /**
   * Draw one frame.
   *
   * `noTextures` is the probe hook the art direction pass uses: drop every tile
   * so the frame is flat-shaded surfaces only. What is being judged then is the
   * section's silhouette — where the fold leaves the deck, and how it turns a
   * corner — and greebled photographic metal hides it completely.
   */
  render(
    cam: { x: number; y: number; angle: number },
    sprites: FpsSprite[],
    w: number,
    h: number,
    noTextures = false,
    minLight = 0,
  ): HTMLCanvasElement {
    if (this.w !== w || this.h !== h) {
      this.w = w;
      this.h = h;
      this.renderer.setSize(w, h, false);
      this.camera.aspect = w / Math.max(1, h);
      this.camera.updateProjectionMatrix();
    }

    const fx = Math.cos(cam.angle);
    const fy = Math.sin(cam.angle);
    this.camera.position.set(cam.x, EYE, cam.y);
    this.camera.lookAt(cam.x + fx, EYE, cam.y + fy);
    SHARED_UNIFORMS.uCam.value.set(cam.x, EYE, cam.y);
    SHARED_UNIFORMS.uFwd.value.set(fx, 0, fy);
    // the lamp is on the chest, not in the eye — see LAMP_RIGHT above; without
    // the offset every specular lobe collapses onto the view axis and no edge
    // in the level can catch a highlight
    SHARED_UNIFORMS.uLampPos.value.set(
      cam.x + -fy * LAMP_RIGHT + fx * LAMP_FWD,
      EYE - LAMP_DOWN,
      cam.y + fx * LAMP_RIGHT + fy * LAMP_FWD,
    );
    SHARED_UNIFORMS.uTexMix.value = noTextures ? 0 : 1;
    SHARED_UNIFORMS.uMinLight.value = minLight;

    // billboards: yaw-only, so the 36 pre-rendered rotations do the turning
    const yaw = Math.atan2(-fx, -fy);
    let n = 0;
    for (const s of sprites) {
      const tex = this.sheet(s.img);
      const cols = Math.max(1, Math.round(s.img.naturalWidth / s.frameSize));
      const slot = this.slot(n++);
      slot.mesh.visible = true;
      slot.mesh.position.set(s.x, s.hover, s.y);
      slot.mesh.scale.set(s.scale, s.scale, 1);
      slot.mesh.rotation.set(0, yaw, 0);
      slot.mesh.renderOrder = s.additive ? 2 : 1;
      const u = slot.mat.uniforms;
      u.map.value = tex;
      (u.uFrame.value as THREE.Vector2).set(s.frame / cols, 1 / cols);
      u.uLight.value = this.lightAt(s.x, s.y);
      u.uAlpha.value = s.alpha;
      u.uFlash.value = s.flash * 0.7;
      // an explosion is light, not paint: unfogged and blended additively, or a
      // bööm frame's dark smoke edges paste onto the bulkhead as a flat decal
      u.uUnlit.value = s.additive ? 1 : 0;
      slot.mat.blending = s.additive ? THREE.AdditiveBlending : THREE.NormalBlending;
      slot.mat.depthWrite = !s.additive;
    }
    for (let i = n; i < this.slots.length; i++) this.slots[i].mesh.visible = false;

    this.renderer.render(this.scene, this.camera);
    return this.renderer.domElement;
  }

  dispose(): void {
    for (const g of this.mesh.groups) g.geometry.dispose();
    for (const t of this.textures.values()) t.dispose();
    for (const t of this.sheets.values()) t.dispose();
    this.scene.traverse((o) => {
      const m = (o as THREE.Mesh).material;
      if (m) (Array.isArray(m) ? m : [m]).forEach((x) => x.dispose());
    });
    this.quad.dispose();
    this.renderer.dispose();
  }
}
