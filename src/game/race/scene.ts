/**
 * The race renderer: 24 hoops, a sky, and some billboards.
 *
 * Structurally this is `glscene.ts`'s contract — an offscreen `WebGLRenderer`
 * whose canvas the session `drawImage`s onto the game's 2D canvas, with the HUD
 * painted over the top in canvas 2D. What it is *not* is a reuse of `GlScene`:
 *
 * - **`SHARED_UNIFORMS` in `glscene.ts` is a module-level singleton.** Two live
 *   scenes would write each other's camera position and lamp every frame. So the
 *   billboard path is copied rather than imported, and this scene owns its own
 *   uniforms. Only the transfer function is shared, through `shader-common.ts`,
 *   because the two mini-games must agree about what a brightness means.
 * - **The camera frustum is nothing like the derelict's.** That one is
 *   `near 0.02 / far 40`, tuned for a corridor a metre wide. Here a gate is 48
 *   units across and they are 500 apart, so it is `near 2 / far 3000` — about
 *   six gates of sightline. Copying the FPS numbers gives a black screen, which
 *   reads as a scene-graph bug and is not one.
 *
 * ## Lighting is upside-down from the derelict's, on purpose
 *
 * The salvage run is a dead ship: black, with one lamp on your chest. The GRN
 * course is the opposite and the source movies are unambiguous about it — a huge
 * bright volumetric nebula fills every frame, and the hoops read as *dark
 * silhouettes against it*. So there is no lamp here at all. Ambient comes from
 * the sky, the rings are dark metal picking up a rim, and the only real emitters
 * are the next gate and the engine cones.
 */

import * as THREE from "three";
import { asset } from "../../asset";
import { TONEMAP } from "../fps/shader-common";
import { GATE_RADIUS, GATE_TUBE, type Course } from "./course";
import type { RaceSprite } from "./types";

/** `tan(fov/2) = 0.5` — the same projection the rest of the game is authored to. */
export const FOV_DEG = (2 * Math.atan(0.5) * 180) / Math.PI;
/** Widened under boost; the cheapest speed cue there is. */
export const FOV_BOOST = 62;

const NEAR = 2;
const FAR = 3000;

/** How many times the ring tile repeats around the hoop. See `RING_UV` below. */
const RING_REPEAT = 22;

/** The nebula's own colour — what fog fades to, and what ambient is. */
const SKY_LO = new THREE.Color(0.10, 0.12, 0.18);
const SKY_HI = new THREE.Color(0.62, 0.55, 0.52);

const FOG_K = 0.00055;

/** Stars painted into the sky sphere as a point cloud. */
const STAR_COUNT = 1400;

/**
 * Barely a tint at all, and deliberately so.
 *
 * This was 0.42/0.45/0.50 while the hoop wore a flat 0.55 grey stand-in, where
 * it was doing the work of *being* the material. `ring.png` is already dark
 * oxidised steel, so the same multiplier darkens it a second time and the tile's
 * rivet collars disappear into black — the texture loads, and you cannot tell.
 * Left near white the tile's own value carries, and the cool cast stays because
 * everything structural in this game leans cool.
 */
const GATE_TINT = new THREE.Color(0.88, 0.91, 1.0);

/**
 * How much of the nebula's light a hoop bounces — flat, and again along the rim.
 *
 * A hoop has no light on it but the sky, so this is the *only* thing deciding
 * whether the tile's rivet collars are visible or crushed to black. At the
 * original 0.55/0.9 a real dark-steel tile came out at about 27/255 against a
 * sky at 88 — legible as a silhouette and completely mute as a material, which
 * is the wrong half of the reference: the movies' hoops are dark *and* you can
 * read their construction.
 *
 * Measured against the stand-in sky at 120 units, reading the ring's own pixel
 * spread as the test of whether the tile is doing anything:
 *
 * | flat/rim  | ring | spread | sky  |
 * |-----------|------|--------|------|
 * | 0.55/0.9  | 37.7 | 1.31   | 77.5 |
 * | 1.6/2.0   | 50.9 | 2.16   | 77.6 |
 * | 2.4/2.6   | 56.3 | 2.12   | 77.8 |
 * | 3.4/3.4   | 58.9 | 3.42   | 78.9 |
 *
 * 1.6/2.0 recovers the material — spread 1.31 to 2.16, as much as 2.4 gets —
 * while leaving the hoop darker, and dark against bright is the reference.
 *
 * **These want a final pass once the authored nebula lands**, and so does
 * `uSky`: it is a *constant*, not sampled from the sky texture, so a brighter
 * authored nebula lifts the background without lifting the hoop. That happens to
 * push contrast the right way, but it is luck rather than design — when
 * `race/nebula.jpg` is final, average it and feed the result in here.
 * `setAmbient` exists to make that pass cheap.
 */
const RING_AMB = 1.6;
const RING_AMB_RIM = 2.0;
/** The next hoop's amber. Deliberately the one warm thing in a cool frame. */
const GATE_GLOW = new THREE.Color(1.0, 0.66, 0.22);

interface GateSlot {
  ring: THREE.Mesh;
  halo: THREE.Mesh;
  mat: THREE.ShaderMaterial;
  haloMat: THREE.ShaderMaterial;
}

interface SpriteSlot {
  mesh: THREE.Mesh;
  mat: THREE.ShaderMaterial;
}

const RING_VERT = /* glsl */ `
varying vec2 vUv;
varying vec3 vWorld;
varying vec3 vNrm;
void main() {
  vUv = uv;
  vec4 wp = modelMatrix * vec4(position, 1.0);
  vWorld = wp.xyz;
  vNrm = normalize(mat3(modelMatrix) * normal);
  gl_Position = projectionMatrix * viewMatrix * wp;
}
`;

/**
 * The hoop.
 *
 * `uEmit` is the whole 3D navigation UI: 1 on the gate you are being asked to
 * take, a little on the one after it, 0 on everything else. Only the next gate
 * departs from the movies' all-dark hoops, and that is a deliberate trade — at
 * 315 units/s with 1.6s between gates there is no time to work out which of six
 * visible silhouettes is yours.
 */
const RING_FRAG = /* glsl */ `
uniform sampler2D map;
uniform float uTexMix;
uniform vec3 uTint;
uniform vec3 uGlow;
uniform vec3 uCam;
uniform vec3 uSky;
uniform vec2 uAmb;      // x flat sky bounce, y extra along the rim
uniform float uEmit;
uniform float uPulse;
varying vec2 vUv;
varying vec3 vWorld;
varying vec3 vNrm;

${TONEMAP}

void main() {
  /*
   * **The tile's u wraps the tube and its v runs along the hoop.** three's own
   * TorusGeometry is the other way round (uv.x is the major angle), so the swap
   * is here and stated once. Mapped straight through, a band across the source
   * becomes a stripe running the whole way round the ring — the same
   * transposition that put pipe threading through the derelict's bay frames.
   */
  vec2 uv = vec2(vUv.y, vUv.x * ${RING_REPEAT.toFixed(1)});
  vec3 texel = mix(vec3(0.55), texture2D(map, uv).rgb, uTexMix);
  vec3 alb = lin(texel) * uTint;

  vec3 V = normalize(uCam - vWorld);
  float dc = length(uCam - vWorld);

  // a rim term, so the tube reads as a lit cylinder rather than a flat ribbon
  float rim = pow(1.0 - abs(dot(vNrm, V)), 2.0);

  vec3 col = alb * (uSky * (uAmb.x + uAmb.y * rim));
  // the amber core sits above 1.0 and is rolled off by the shoulder, which is
  // what keeps a lit hoop reading as a light instead of a white blob
  col += uGlow * uEmit * (1.5 + 0.5 * uPulse) * (0.35 + 0.65 * rim);

  float fogKeep = exp(-dc * ${FOG_K.toFixed(6)});
  col = mix(uSky * 0.5, col, fogKeep);

  gl_FragColor = vec4(encode(col), 1.0);
}
`;

/**
 * The halo: a soft annulus in the gate's own plane, additive and unfogged.
 *
 * It is *not* the answer to "where is the next gate" — a disc coplanar with the
 * hoop goes edge-on at exactly the same angle the hoop does, so it disappears
 * precisely when help is needed. What it does is give the ring a bloom so it
 * reads as a structure with light on it rather than a wireframe. Findability at
 * a bad angle is the camera-facing marker in `updateGates`, and the 2D chevron.
 */
const HALO_FRAG = /* glsl */ `
uniform vec3 uGlow;
uniform float uEmit;
uniform float uPulse;
varying vec2 vUv;
void main() {
  vec2 d = vUv * 2.0 - 1.0;
  float r = length(d);
  /*
   * Peak on the hoop itself, falling off both ways — and **tight**. The first
   * cut used a wide band at full strength, which put a soft amber disc the size
   * of the gate over the gate: the ring vanished inside its own bloom, so the
   * one thing the glow exists to make findable was the thing it hid. The halo's
   * job is to say "there is something lit here", and the hoop's own emissive
   * core says what shape it is.
   */
  float band = exp(-pow((r - 0.625) * 16.0, 2.0));
  float a = band * uEmit * (0.30 + 0.22 * uPulse);
  if (a < 0.004) discard;
  gl_FragColor = vec4(uGlow * a, a);
}
`;

const SKY_FRAG = /* glsl */ `
uniform vec3 uLo;
uniform vec3 uHi;
uniform sampler2D map;
uniform float uTexMix;
varying vec3 vDir;

${TONEMAP}

void main() {
  vec3 d = normalize(vDir);
  vec3 col;
  if (uTexMix > 0.5) {
    // equirectangular lookup, so the authored nebula wraps the whole sky
    float u = atan(d.z, d.x) / 6.2831853 + 0.5;
    float v = asin(clamp(d.y, -1.0, 1.0)) / 3.14159265 + 0.5;
    col = lin(texture2D(map, vec2(u, v)).rgb);
  } else {
    /*
     * The stand-in until race/nebula.jpg lands. (No backticks in here: this is
     * a JS template literal, so one would end the shader mid-comment.)
     *
     * Three octaves rather than one, and gamma'd toward the dark end. A single
     * sinusoid gives a flat mid-tone wash with no dust lanes, and against that
     * a dark hoop has nothing to be a silhouette *against* — which is the one
     * job the backdrop has to do before the art exists. The movies are bright
     * cloud with deep dark lanes cut through it, so the contrast is the point,
     * not the colour.
     */
    float n = 0.55 * sin(d.y * 3.1 + d.x * 1.7)
            + 0.30 * sin(d.y * 7.3 - d.z * 4.1 + 1.7)
            + 0.15 * sin(d.x * 11.0 + d.z * 9.0 + 3.1);
    float b = clamp(n * 0.5 + 0.5, 0.0, 1.0);
    col = mix(lin(uLo), lin(uHi), pow(b, 2.2));
  }
  gl_FragColor = vec4(encode(col), 1.0);
}
`;

const SKY_VERT = /* glsl */ `
varying vec3 vDir;
void main() {
  vDir = position;
  gl_Position = projectionMatrix * viewMatrix * modelMatrix * vec4(position, 1.0);
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

const SPRITE_FRAG = /* glsl */ `
uniform sampler2D map;
uniform vec3 uCam;
uniform vec3 uSky;
uniform vec3 uTint;
uniform vec2 uFrame;
uniform float uAlpha;
uniform float uUnlit;
varying vec2 vUv;
varying vec3 vWorld;

${TONEMAP}

void main() {
  vec4 t = texture2D(map, vec2(uFrame.x + vUv.x * uFrame.y, vUv.y));
  if (t.a < 0.35) discard;
  float dc = length(uCam - vWorld);
  float fogKeep = exp(-dc * ${FOG_K.toFixed(6)});
  vec3 alb = lin(t.rgb) * uTint;
  vec3 col = mix(uSky * 0.5, alb * uSky * 1.5, fogKeep);
  // an engine cone is light, not paint: unfogged, and well past white
  col = mix(col, alb * 3.0, uUnlit);
  gl_FragColor = vec4(encode(col), t.a * uAlpha);
}
`;

export interface RaceCam {
  pos: THREE.Vector3;
  quat: THREE.Quaternion;
  fov: number;
}

export class RaceScene {
  private readonly renderer: THREE.WebGLRenderer;
  private readonly scene = new THREE.Scene();
  private readonly camera: THREE.PerspectiveCamera;
  private readonly course: Course;
  private readonly gateSlots: GateSlot[] = [];
  private readonly spriteSlots: SpriteSlot[] = [];
  private readonly quad = new THREE.PlaneGeometry(1, 1);
  private readonly sheets = new Map<string, THREE.Texture>();
  private readonly ringGeo: THREE.TorusGeometry;
  private readonly haloGeo: THREE.PlaneGeometry;
  private readonly ringTex: THREE.Texture;
  private readonly skyMat: THREE.ShaderMaterial;
  private readonly skyCol = new THREE.Color();
  private sky!: THREE.Mesh;
  private starField!: THREE.Points;
  private w = 0;
  private h = 0;
  private fov = FOV_DEG;

  readonly tris: number;

  constructor(course: Course) {
    this.course = course;
    this.renderer = new THREE.WebGLRenderer({
      antialias: true,
      alpha: false,
      powerPreference: "high-performance",
    });
    this.renderer.setPixelRatio(1);
    this.renderer.setClearColor(0x05070a, 1);
    // the shader owns the transfer function — see shader-common.ts
    this.renderer.outputColorSpace = THREE.LinearSRGBColorSpace;
    this.camera = new THREE.PerspectiveCamera(FOV_DEG, 1.6, NEAR, FAR);

    this.skyCol.copy(SKY_LO).lerp(SKY_HI, 0.5);

    /* ---- sky ------------------------------------------------------------- */
    this.skyMat = new THREE.ShaderMaterial({
      uniforms: {
        uLo: { value: SKY_LO.clone() },
        uHi: { value: SKY_HI.clone() },
        map: { value: null },
        uTexMix: { value: 0 },
      },
      vertexShader: SKY_VERT,
      fragmentShader: SKY_FRAG,
      side: THREE.BackSide,
      depthWrite: false,
    });
    this.sky = new THREE.Mesh(new THREE.SphereGeometry(FAR * 0.92, 32, 20), this.skyMat);
    this.sky.frustumCulled = false;
    this.sky.renderOrder = -1;
    this.scene.add(this.sky);
    this.loadSky();
    this.starField = this.stars();
    this.scene.add(this.starField);

    /* ---- gates ----------------------------------------------------------- */
    this.ringTex = new THREE.Texture();
    this.ringGeo = new THREE.TorusGeometry(GATE_RADIUS, GATE_TUBE, 8, 48);
    this.haloGeo = new THREE.PlaneGeometry(GATE_RADIUS * 3.2, GATE_RADIUS * 3.2);
    this.loadRing();

    let tris = 0;
    for (const g of course.gates) {
      const mat = new THREE.ShaderMaterial({
        uniforms: {
          map: { value: this.ringTex },
          uTexMix: { value: 0 },
          uTint: { value: GATE_TINT.clone() },
          uGlow: { value: GATE_GLOW.clone() },
          uCam: { value: new THREE.Vector3() },
          uSky: { value: this.skyCol.clone() },
          uAmb: { value: new THREE.Vector2(RING_AMB, RING_AMB_RIM) },
          uEmit: { value: 0 },
          uPulse: { value: 0 },
        },
        vertexShader: RING_VERT,
        fragmentShader: RING_FRAG,
        side: THREE.FrontSide,
      });
      const ring = new THREE.Mesh(this.ringGeo, mat);

      const haloMat = new THREE.ShaderMaterial({
        uniforms: {
          uGlow: { value: GATE_GLOW.clone() },
          uEmit: { value: 0 },
          uPulse: { value: 0 },
        },
        vertexShader: SPRITE_VERT,
        fragmentShader: HALO_FRAG,
        transparent: true,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
        side: THREE.DoubleSide,
      });
      const halo = new THREE.Mesh(this.haloGeo, haloMat);

      /*
       * A torus lies in its own XY plane with its axis on +Z, so the gate's
       * basis is (right, up, normal) and `right = up x normal` — get that cross
       * product the other way round and every hoop on the course is mirrored,
       * which is invisible on a symmetric ring and very visible once it wears a
       * banked, textured rim.
       */
      const right = new THREE.Vector3().crossVectors(g.up, g.normal).normalize();
      const basis = new THREE.Matrix4().makeBasis(right, g.up, g.normal);
      ring.quaternion.setFromRotationMatrix(basis);
      halo.quaternion.copy(ring.quaternion);
      ring.position.copy(g.pos);
      halo.position.copy(g.pos);

      this.scene.add(ring);
      this.scene.add(halo);
      this.gateSlots.push({ ring, halo, mat, haloMat });
      tris += this.ringGeo.index ? this.ringGeo.index.count / 3 : 0;
    }
    this.tris = tris;
  }

  /** The GL canvas, for the caller to blit. */
  get domElement(): HTMLCanvasElement {
    return this.renderer.domElement;
  }

  /**
   * Retune how much sky a hoop bounces, live. A probe hook for the art pass —
   * the right values are a ratio against the nebula's own brightness, so they
   * cannot be settled until the authored sky is in.
   */
  setAmbient(flat: number, rim: number): void {
    for (const s of this.gateSlots) {
      (s.mat.uniforms.uAmb.value as THREE.Vector2).set(flat, rim);
    }
  }

  /**
   * Both textures are loaded optimistically and the scene works without them.
   * `uTexMix` stays 0 until a load actually succeeds, so a missing file is a
   * flat-shaded hoop rather than a black one or a console full of 404s that
   * stops the mini-game being playable before the art exists.
   */
  private loadRing(): void {
    new THREE.TextureLoader().load(
      asset("race/ring.png"),
      (t) => {
        t.wrapS = THREE.RepeatWrapping;
        t.wrapT = THREE.RepeatWrapping;
        t.anisotropy = Math.min(16, this.renderer.capabilities.getMaxAnisotropy());
        for (const s of this.gateSlots) {
          s.mat.uniforms.map.value = t;
          s.mat.uniforms.uTexMix.value = 1;
        }
      },
      undefined,
      () => {},
    );
  }

  private loadSky(): void {
    new THREE.TextureLoader().load(
      asset("race/nebula.jpg"),
      (t) => {
        t.wrapS = THREE.RepeatWrapping;
        t.wrapT = THREE.ClampToEdgeWrapping;
        this.skyMat.uniforms.map.value = t;
        this.skyMat.uniforms.uTexMix.value = 1;
      },
      undefined,
      () => {},
    );
  }

  /** A deterministic point cloud, from the course's own seed. */
  private stars(): THREE.Points {
    const pos = new Float32Array(STAR_COUNT * 3);
    const seed = this.course.seed;
    for (let i = 0; i < STAR_COUNT; i++) {
      const a = h01(seed, i * 3) * Math.PI * 2;
      const z = h01(seed, i * 3 + 1) * 2 - 1;
      const r = Math.sqrt(1 - z * z);
      const d = FAR * 0.88;
      pos[i * 3] = Math.cos(a) * r * d;
      pos[i * 3 + 1] = z * d;
      pos[i * 3 + 2] = Math.sin(a) * r * d;
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.BufferAttribute(pos, 3));
    const p = new THREE.Points(
      g,
      new THREE.PointsMaterial({ color: 0xd8e0f0, size: 2, sizeAttenuation: false }),
    );
    p.frustumCulled = false;
    return p;
  }

  /**
   * Tell the gates which one is next.
   *
   * `nextGate` is bright and pulsing, the one after it is a quarter as bright so
   * the course reads as a *sequence* rather than a single target, and everything
   * else is a dark silhouette exactly as the movies have them.
   */
  updateGates(nextGate: number, time: number): void {
    const n = this.gateSlots.length;
    const pulse = Math.sin(time * 4.2) * 0.5 + 0.5;
    for (let i = 0; i < n; i++) {
      const ahead = (i - nextGate + n) % n;
      const emit = ahead === 0 ? 1 : ahead === 1 ? 0.25 : 0;
      const s = this.gateSlots[i];
      s.mat.uniforms.uEmit.value = emit;
      s.mat.uniforms.uPulse.value = ahead === 0 ? pulse : 0;
      s.haloMat.uniforms.uEmit.value = emit;
      s.haloMat.uniforms.uPulse.value = ahead === 0 ? pulse : 0;
    }
  }

  private slot(i: number): SpriteSlot {
    let s = this.spriteSlots[i];
    if (!s) {
      const mat = new THREE.ShaderMaterial({
        uniforms: {
          map: { value: null },
          uCam: { value: new THREE.Vector3() },
          uSky: { value: this.skyCol.clone() },
          uTint: { value: new THREE.Color(1, 1, 1) },
          uFrame: { value: new THREE.Vector2(0, 1) },
          uAlpha: { value: 1 },
          uUnlit: { value: 0 },
        },
        vertexShader: SPRITE_VERT,
        fragmentShader: SPRITE_FRAG,
        transparent: true,
        side: THREE.DoubleSide,
      });
      const mesh = new THREE.Mesh(this.quad, mat);
      mesh.frustumCulled = false;
      this.scene.add(mesh);
      s = { mesh, mat };
      this.spriteSlots[i] = s;
    }
    return s;
  }

  /** A Nova sheet as a texture. `NearestFilter`: see `glscene.ts`. */
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

  /**
   * World point → canvas pixels, so the 2D layer never re-derives camera maths.
   * `behind` is what the next-gate chevron needs: a point behind the camera
   * projects to a *mirrored* on-screen position, so without the flag the arrow
   * points confidently in exactly the wrong direction.
   */
  project(p: THREE.Vector3, w: number, h: number): { x: number; y: number; behind: boolean } {
    const v = p.clone().project(this.camera);
    const behind = v.z > 1;
    return {
      x: (v.x * 0.5 + 0.5) * w,
      y: (-v.y * 0.5 + 0.5) * h,
      behind,
    };
  }

  render(cam: RaceCam, sprites: RaceSprite[], w: number, h: number): HTMLCanvasElement {
    if (this.w !== w || this.h !== h || this.fov !== cam.fov) {
      this.w = w;
      this.h = h;
      this.fov = cam.fov;
      this.renderer.setSize(w, h, false);
      this.camera.aspect = w / Math.max(1, h);
      this.camera.fov = cam.fov;
      this.camera.updateProjectionMatrix();
    }

    this.camera.position.copy(cam.pos);
    this.camera.quaternion.copy(cam.quat);
    this.camera.updateMatrixWorld();

    /*
     * **The sky and the stars ride with the camera.** They are a backdrop at
     * infinity, not scenery at the origin — and a BackSide sphere centred on the
     * origin simply *vanishes* the moment you fly outside its radius, taking the
     * whole nebula with it and leaving a black frame that reads as a dead
     * renderer. The course itself reaches ~2,500 units from the origin against a
     * sky radius of 2,760, so this was not a corner case: it would have failed
     * on the outside of every lap.
     */
    this.sky.position.copy(cam.pos);
    this.starField.position.copy(cam.pos);

    for (const s of this.gateSlots) s.mat.uniforms.uCam.value.copy(cam.pos);

    let n = 0;
    for (const s of sprites) {
      const cols = Math.max(1, Math.round(s.img.naturalWidth / s.frameSize));
      const slot = this.slot(n++);
      slot.mesh.visible = true;
      slot.mesh.position.copy(s.pos);
      slot.mesh.scale.set(s.scale, s.scale, 1);
      // camera-facing, full orientation — unlike the derelict's yaw-only
      // billboards, because here you genuinely do look at things from above and
      // below and a yaw-only quad shears as you roll
      slot.mesh.quaternion.copy(cam.quat);
      slot.mesh.renderOrder = s.additive ? 2 : 1;
      const u = slot.mat.uniforms;
      u.map.value = this.sheet(s.img);
      (u.uFrame.value as THREE.Vector2).set(s.frame / cols, 1 / cols);
      (u.uCam.value as THREE.Vector3).copy(cam.pos);
      u.uAlpha.value = s.alpha;
      u.uUnlit.value = s.additive ? 1 : 0;
      const t = s.tint ?? [1, 1, 1];
      (u.uTint.value as THREE.Color).setRGB(t[0], t[1], t[2]);
      slot.mat.blending = s.additive ? THREE.AdditiveBlending : THREE.NormalBlending;
      slot.mat.depthWrite = !s.additive;
    }
    for (let i = n; i < this.spriteSlots.length; i++) {
      this.spriteSlots[i].mesh.visible = false;
    }

    this.renderer.render(this.scene, this.camera);
    return this.renderer.domElement;
  }

  dispose(): void {
    this.ringGeo.dispose();
    this.haloGeo.dispose();
    this.quad.dispose();
    this.ringTex.dispose();
    for (const t of this.sheets.values()) t.dispose();
    this.scene.traverse((o) => {
      const m = (o as THREE.Mesh).material;
      if (m) (Array.isArray(m) ? m : [m]).forEach((x) => x.dispose());
      const g = (o as THREE.Mesh).geometry;
      if (g) g.dispose();
    });
    this.renderer.dispose();
  }
}

/** The starfield hash again, for the point cloud. */
function h01(seed: number, i: number): number {
  let h = (i * 374761393 + (i * 7 + 11) * 668265263 + seed * 2246822519) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}
