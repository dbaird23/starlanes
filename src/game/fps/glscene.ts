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
 * `ShaderMaterial`; what differs between them arrives as three per-vertex
 * floats baked by `mesh.ts` (`aLight`, `aGain`, `aEmit`) and one texture. So the
 * whole deck is nine draw calls and the section's brightness staircase — deck,
 * lower chamfer, face, upper chamfer, overhead — survives intact.
 *
 * The light model is carried over from the raycaster unchanged, because it was
 * right and it is the mechanic:
 *
 * - **The sector term** is Doom's: light belongs to an *area*, not a wall, so a
 *   dead section stays dead while the one you came from is lit. It is the term
 *   fog attenuates.
 * - **The suit lamp** is a second term on real distance — inverse-square core,
 *   hard cutoff at seven cells, mild cone toward the view axis. It is what makes
 *   dark mean "you can see three metres" instead of "you can see nothing", and
 *   `LAMP_MAX` stays under 1 so a dead bulkhead never lights to white: at 1.06
 *   every dead compartment looked *powered* as soon as you stood near a wall.
 * - **Emission** is keyed off each tile's own bright pixels and is *not* fogged,
 *   which is the art direction's rule for the light strips. It is mostly scaled
 *   by the sector — a bay frame's channel is a fitting, and a dead ship's
 *   fittings are dead — but the doors keep a floor that no sector can take away,
 *   because rule 6 is that a sightline terminates on a bulkhead and it cannot do
 *   that if the bulkhead is as black as the corridor.
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
import { TILE_FILES } from "./textures";
import type { FpsLevel, FpsSprite } from "./types";

/** The eye, half a cell above the deck — what `hover` 0.5 means to a billboard. */
export const EYE = 0.5;

/** `tan(fov/2) = 0.5`; see the header. */
const FOV_DEG = (2 * Math.atan(0.5) * 180) / Math.PI;

/* --- the light model, ported from the raycaster unchanged ---------------- */
const FOG_K = 0.135;
const FOG_MAX = 0.88;
const LAMP_RANGE = 7;
const LAMP_HALF = 1.5;
const LAMP_MAX = 0.6;
/** How much of the lamp survives at the edge of the view — a cone, not a spot. */
const LAMP_EDGE = 0.55;
/**
 * How much of the lamp is ambient rather than Lambertian.
 *
 * Not zero: a helmet lamp inside a metal tube bounces, and at zero the upper
 * chamfer — which turns its face away from a lamp at eye height — went to black
 * and took the top half of the octagon's silhouette with it.
 */
const LAMP_DIFF = 0.38;
/** The channel's own colour, off `chamfer-trim.png`'s fixture. */
const GLOW_RGB = new THREE.Color(1.0, 0.965, 0.886);

const SHARED_UNIFORMS = {
  uCam: { value: new THREE.Vector3() },
  uFwd: { value: new THREE.Vector3(1, 0, 0) },
  uTexMix: { value: 1 },
  uMinLight: { value: 0 },
  uGlow: { value: GLOW_RGB },
};

const VERT = /* glsl */ `
attribute float aLight;
attribute float aGain;
attribute float aEmit;
varying vec2 vUv;
varying vec3 vWorld;
varying vec3 vNrm;
varying float vLight;
varying float vGain;
varying float vEmit;
void main() {
  vUv = uv;
  vec4 wp = modelMatrix * vec4(position, 1.0);
  vWorld = wp.xyz;
  vNrm = mat3(modelMatrix) * normal;
  vLight = aLight;
  vGain = aGain;
  vEmit = aEmit;
  gl_Position = projectionMatrix * viewMatrix * wp;
}
`;

const FRAG = /* glsl */ `
uniform sampler2D map;
uniform vec3 uTint;
uniform vec3 uCam;
uniform vec3 uFwd;
uniform vec3 uGlow;
uniform float uTexMix;
uniform float uMinLight;
varying vec2 vUv;
varying vec3 vWorld;
varying vec3 vNrm;
varying float vLight;
varying float vGain;
varying float vEmit;

void main() {
  vec3 tex = mix(vec3(0.62), texture2D(map, vUv).rgb, uTexMix) * uTint;

  vec3 toCam = uCam - vWorld;
  float d = length(toCam);
  vec3 L = toCam / max(d, 1e-4);
  float ndl = max(dot(normalize(vNrm), L), 0.0);

  // fog eats the sector's light and nothing else
  float fogKeep = max(1.0 - ${FOG_MAX.toFixed(3)}, exp(-d * ${FOG_K.toFixed(4)}));

  // the suit lamp: inverse-square core, hard cutoff, cone toward the view axis
  float q = d / ${LAMP_HALF.toFixed(3)};
  float cut = max(0.0, 1.0 - (d / ${LAMP_RANGE.toFixed(1)}) * (d / ${LAMP_RANGE.toFixed(1)}));
  float lamp = (${LAMP_MAX.toFixed(3)} / (1.0 + q * q)) * cut;
  float ca = max(dot(-L, uFwd), 0.0);
  float cone = ${LAMP_EDGE.toFixed(3)} + ${(1 - LAMP_EDGE).toFixed(3)} * ca * ca;
  lamp *= cone * (${LAMP_DIFF.toFixed(3)} + ${(1 - LAMP_DIFF).toFixed(3)} * ndl);

  float sec = max(vLight, uMinLight);
  float lit = min(1.0, sec * fogKeep + lamp);

  /*
   * Emission is keyed off the tile's own bright pixels and is never fogged.
   *
   * The threshold has to sit high. trim-light-channel.png is a lit channel set
   * into a *pale* housing and wall-main.png is pale everywhere, so keyed from
   * mid-grey the whole bay lights up rather than the fitting in it — the exact
   * failure the art direction warns about, a light strip down every wall being a
   * strip down no wall in particular.
   */
  float lum = dot(tex, vec3(0.299, 0.587, 0.114));
  float key = smoothstep(0.80, 0.965, lum);

  vec3 col = tex * (lit * vGain) + uGlow * (key * vEmit * (0.08 + sec));
  gl_FragColor = vec4(col, 1.0);
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
uniform vec2 uFrame;
uniform float uLight;
uniform float uMinLight;
uniform float uAlpha;
uniform float uFlash;
uniform float uUnlit;
varying vec2 vUv;
varying vec3 vWorld;

void main() {
  vec4 t = texture2D(map, vec2(uFrame.x + vUv.x * uFrame.y, vUv.y));
  if (t.a < 0.35) discard;

  float d = length(uCam - vWorld);
  float fogKeep = max(1.0 - ${FOG_MAX.toFixed(3)}, exp(-d * ${FOG_K.toFixed(4)}));
  float q = d / ${LAMP_HALF.toFixed(3)};
  float cut = max(0.0, 1.0 - (d / ${LAMP_RANGE.toFixed(1)}) * (d / ${LAMP_RANGE.toFixed(1)}));
  float lamp = (${LAMP_MAX.toFixed(3)} / (1.0 + q * q)) * cut;
  vec3 L = normalize(vWorld - uCam);
  float ca = max(dot(L, uFwd), 0.0);
  lamp *= ${LAMP_EDGE.toFixed(3)} + ${(1 - LAMP_EDGE).toFixed(3)} * ca * ca;

  float lit = min(1.0, max(uLight, uMinLight) * fogKeep + lamp);
  lit = mix(lit, 1.0, uUnlit);
  vec3 col = t.rgb * lit + vec3(uFlash) * t.a;
  gl_FragColor = vec4(col, t.a * uAlpha);
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
     * **No colour management, on purpose.**
     *
     * The whole light model below — the fog curve, the lamp's inverse square,
     * `LAMP_MAX`, and every sector level in `level.ts` — was tuned against a
     * canvas 2D renderer that multiplied 8-bit sRGB bytes. Left at three's
     * default the same numbers come out through a linear-to-sRGB encode and
     * every midtone lifts by around a third: a dead compartment reads as
     * half-lit and the airlock blows out to white. Tell the renderer the frame
     * is already in the output space and the tuning carries over exactly.
     */
    this.renderer.outputColorSpace = THREE.LinearSRGBColorSpace;
    this.camera = new THREE.PerspectiveCamera(FOV_DEG, 1.6, 0.02, 40);

    for (const f of TILE_FILES) this.tile(f);

    this.mesh = buildLevelMesh(level);
    this.tris = this.mesh.tris;
    for (const g of this.mesh.groups) {
      const mat = new THREE.ShaderMaterial({
        uniforms: {
          ...SHARED_UNIFORMS,
          map: { value: this.tile(g.tile) },
          uTint: { value: new THREE.Color(g.tint[0], g.tint[1], g.tint[2]) },
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
