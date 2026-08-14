#!/usr/bin/env node
/**
 * Extract EV Nova sprites (rlëD resources) into PNG spritesheets + manifest.
 *
 * Usage: node scripts/extract-sprites.mjs "<path to Nova Files dir>"
 * Writes: public/nova/sprites/ship-<shanId>.png   (one row of rotation frames)
 *         public/nova/sprites/stellar-<spinId>.png (first frame)
 *         public/nova/sprites.json
 *
 * rlëD format: u16BE width/height @0/@2, u16BE depth(16) @4, u16BE frames @8,
 * token stream from @16 of u32BE (opcode = top byte, count = low 24 bits):
 *   0 end of frame · 1 line start · 2 pixel data (count bytes of RGB555BE,
 *   pad to 4) · 3 transparent run (count bytes → count/2 px) · 4 pixel run
 *   (u32 with pixel doubled; count bytes → count/2 px)
 */
import { readFileSync, writeFileSync, readdirSync, mkdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { PNG } from "pngjs";
import { parseRez } from "./rez.mjs";

function decodeRled(data, frameHint) {
  const width = data.readUInt16BE(0);
  const height = data.readUInt16BE(2);
  const depth = data.readUInt16BE(4);
  // A few of the title-screen sprites carry 0 here; their spïn wrapper knows
  // the real count, so let the caller override it.
  const frameCount = frameHint ?? data.readUInt16BE(8);
  if (depth !== 16) throw new Error(`unsupported rlëD depth ${depth}`);

  // RGBA per frame
  const frames = [];
  let rgba = Buffer.alloc(width * height * 4);
  let p = 16;
  let line = -1;
  let col = 0;

  const putPixel = (pixel) => {
    let r = (pixel & 0x7c00) >> 10;
    let g = (pixel & 0x03e0) >> 5;
    let b = pixel & 0x001f;
    r = (r << 3) | (r >> 2);
    g = (g << 3) | (g >> 2);
    b = (b << 3) | (b >> 2);
    const off = (line * width + col) * 4;
    rgba[off] = r;
    rgba[off + 1] = g;
    rgba[off + 2] = b;
    rgba[off + 3] = 255;
    col++;
  };

  while (frames.length < frameCount) {
    const token = data.readUInt32BE(p);
    p += 4;
    const opcode = token >>> 24;
    const count = token & 0xffffff;
    switch (opcode) {
      case 0: // end of frame
        if (line !== height - 1) {
          throw new Error(`frame ended at line ${line}, expected ${height - 1}`);
        }
        frames.push(rgba);
        rgba = Buffer.alloc(width * height * 4);
        line = -1;
        break;
      case 1: // line start
        line++;
        col = 0;
        break;
      case 2: {
        // count bytes of 16-bit pixel data, padded to 4-byte boundary
        for (let i = 0; i < count; i += 2) {
          putPixel(data.readUInt16BE(p));
          p += 2;
        }
        if (count & 3) p += 4 - (count & 3);
        break;
      }
      case 3: // transparent run of count bytes (2 bytes per pixel)
        col += count >> 1;
        break;
      case 4: {
        // single pixel value repeated; count bytes worth (2 bytes per pixel)
        const run = data.readUInt32BE(p);
        p += 4;
        const pixel = run & 0xffff;
        for (let i = 0; i < count >> 1; i++) putPixel(pixel);
        break;
      }
      default:
        throw new Error(`unknown rlëD opcode ${opcode} at ${p - 4}`);
    }
  }
  return { width, height, frameCount, frames };
}

function writeSheet(path, decoded, frameLimit) {
  const n = Math.min(decoded.frameCount, frameLimit);
  const png = new PNG({ width: decoded.width * n, height: decoded.height });
  for (let f = 0; f < n; f++) {
    const frame = decoded.frames[f];
    for (let y = 0; y < decoded.height; y++) {
      const srcOff = y * decoded.width * 4;
      const dstOff = (y * png.width + f * decoded.width) * 4;
      frame.copy(png.data, dstOff, srcOff, srcOff + decoded.width * 4);
    }
  }
  writeFileSync(path, PNG.sync.write(png));
  return n;
}

/*
 * The shän record: 192 bytes, and the Bible's field list is not in struct
 * order — it prints the shield block between the weapon-glow block and Flags,
 * where the data actually carries Flags. The offsets below were read off the
 * shipped resources and cross-checked three ways:
 *
 *   · Flags@46 against BaseSetCount@4 — every one of the 116 hulls with the
 *     banking bit (0x0001) carries exactly 3 sprite sets (level/left/right),
 *     every hull with a sequence-animation bit (0x0002/0x0008) carries 6, and
 *     every hull with neither carries 1. A wrong Flags offset could not
 *     reproduce that correlation.
 *   · FramesPer@52 and BaseSetCount@4 against the images — for all 288 shän,
 *     the base rlëD's own frame count equals BaseSetCount * FramesPer exactly.
 *   · UpCompress@136 — the modal value across the fleet is (100, 70), i.e.
 *     cos(45°), which is the angle Nova's ship renders were lit and tilted at.
 *
 * The four exit-point classes are arrays of 4, not scalars: the Bible lists
 * "GunPosX" once but the struct holds four mounts per class, which is what
 * lets the Shuttle read GunPosX = {3,-3,3,-3} — a symmetric pair of wing guns.
 * The trailing 16 bytes (176..191) are zero in every shipped resource.
 */
const SHAN = {
  baseImage: 0, baseMask: 2, baseSets: 4, baseW: 6, baseH: 8, baseTransp: 10,
  altImage: 12, altMask: 14, altSets: 16, altW: 18, altH: 20,
  glowImage: 22, glowMask: 24, glowW: 26, glowH: 28,
  lightImage: 30, lightMask: 32, lightW: 34, lightH: 36,
  weapImage: 38, weapMask: 40, weapW: 42, weapH: 44,
  flags: 46, animDelay: 48, weapDecay: 50, framesPer: 52,
  blinkMode: 54, blinkA: 56, blinkB: 58, blinkC: 60, blinkD: 62,
  // No shipped hull uses the shield bubble (ShieldImageID is -1 in all 288),
  // so this block is identified by shape rather than by content: it is four
  // slots reading -1/-1/0/0, the same unused-image-block signature the weapon
  // glow block shows, sitting where the struct has room for it.
  shieldImage: 64, shieldMask: 66, shieldW: 68, shieldH: 70,
  gunX: 72, gunY: 80, turretX: 88, turretY: 96,
  guidedX: 104, guidedY: 112, beamX: 120, beamY: 128,
  upCompressX: 136, upCompressY: 138, dnCompressX: 140, dnCompressY: 142,
  gunZ: 144, turretZ: 152, guidedZ: 160, beamZ: 168,
};

/** Read one of the four-wide exit-point arrays. */
const mounts = (d, off) => Array.from({ length: 4 }, (_, i) => d.readInt16BE(off + i * 2));

function decodeShan(d) {
  return {
    flags: d.readUInt16BE(SHAN.flags),
    /** frames of one rotation; the rest of the sheet is further sprite sets */
    framesPer: d.readInt16BE(SHAN.framesPer) || 36,
    sets: Math.max(1, d.readInt16BE(SHAN.baseSets)),
    /** delay between animation frames, in 30ths of a second */
    animDelay: d.readInt16BE(SHAN.animDelay),
    blinkMode: d.readInt16BE(SHAN.blinkMode),
    blink: [SHAN.blinkA, SHAN.blinkB, SHAN.blinkC, SHAN.blinkD].map((o) => d.readInt16BE(o)),
    /*
     * The weapon-glow sprite that flares on the hull as it fires, and the rate
     * it fades at. 81 hulls carry one. Recorded but not yet drawn: the Bible
     * says only that WeapDecay is a "rate ... to transparency" where "50 is a
     * good median number", which does not pin down the units, and the shipped
     * values (3, 5, 10, 30, 50, 100) give wildly different lifetimes under the
     * plausible readings. Needs checking against a reference build first.
     */
    weapImage: d.readInt16BE(SHAN.weapImage),
    weapDecay: d.readInt16BE(SHAN.weapDecay),
    /*
     * Shield bubble. No shipped hull uses it — ShieldImageID is -1 in all 288
     * — so there is nothing to draw; kept so a plugin's hulls would carry it.
     */
    shieldImage: d.readInt16BE(SHAN.shieldImage),
    /*
     * Alternating sprites, cycled over the hull at AnimDelay. Exactly one of
     * the 288 hulls sets AltImageID, so this is recorded rather than drawn.
     */
    altImage: d.readInt16BE(SHAN.altImage),
    altSets: d.readInt16BE(SHAN.altSets),
    /*
     * Weapon exit points, in pixels from the hull's centre with the ship
     * pointing straight up. Indexed by the firing weapon's ExitType:
     * 0 gun, 1 turret, 2 guided, 3 beam.
     */
    exits: [
      { x: mounts(d, SHAN.gunX), y: mounts(d, SHAN.gunY), z: mounts(d, SHAN.gunZ) },
      { x: mounts(d, SHAN.turretX), y: mounts(d, SHAN.turretY), z: mounts(d, SHAN.turretZ) },
      { x: mounts(d, SHAN.guidedX), y: mounts(d, SHAN.guidedY), z: mounts(d, SHAN.guidedZ) },
      { x: mounts(d, SHAN.beamX), y: mounts(d, SHAN.beamY), z: mounts(d, SHAN.beamZ) },
    ],
    /*
     * Perspective correction for the exit points, as percentages. Nova's ship
     * art is rendered off-axis, so a mount that sits 20px "forward" on the
     * sprite is not 20px forward in the game's flat top-down space; these
     * scale the rotated offsets. Zero means 100 (no correction).
     */
    compress: {
      upX: d.readInt16BE(SHAN.upCompressX) || 100,
      upY: d.readInt16BE(SHAN.upCompressY) || 100,
      dnX: d.readInt16BE(SHAN.dnCompressX) || 100,
      dnY: d.readInt16BE(SHAN.dnCompressY) || 100,
    },
  };
}

// ---- main ----

const novaFilesDir = process.argv[2];
if (!novaFilesDir) {
  console.error('usage: node scripts/extract-sprites.mjs "<Nova Files dir>"');
  process.exit(1);
}

const pool = new Map(); // `${type}:${id}` -> resource
for (const f of readdirSync(novaFilesDir).filter((f) => f.endsWith(".rez")).sort()) {
  for (const r of parseRez(readFileSync(join(novaFilesDir, f)))) {
    const key = `${r.type}:${r.id}`;
    if (pool.has(key) && r.type === "rlëD") {
      console.warn(`warning: duplicate ${key} (keeping later file's copy)`);
    }
    pool.set(key, r);
  }
}

const outDir = join(dirname(fileURLToPath(import.meta.url)), "..", "public", "nova", "sprites");
mkdirSync(outDir, { recursive: true });

/*
 * Ship sheets are named for the rlëD they came from rather than for the shän
 * that referenced it, and written once. Nova's 288 ship types draw on only 65
 * hull images — every Valkyrie variant is the same picture — so naming them
 * per ship type wrote each sheet about four times over. That was tolerable
 * while we only kept one 36-frame rotation; now that the banking and animation
 * sets are kept too it is the difference between 137MB of sprites and 31MB.
 */
const written = new Map(); // file -> frames
function writeOnce(file, decoded) {
  const hit = written.get(file);
  if (hit !== undefined) return hit;
  const frames = writeSheet(join(outDir, file), decoded, decoded.frameCount);
  written.set(file, frames);
  return frames;
}

const manifest = {
  ships: {}, stellars: {}, weapons: {}, booms: {}, glows: {}, lights: {},
  weapGlows: {}, roids: {}, ui: {}, menu: {},
};
let shipCount = 0;
let glowCount = 0;
let lightCount = 0;
let weapGlowCount = 0;
let stellarCount = 0;
let weaponCount = 0;
let boomCount = 0;
let roidCount = 0;
let failed = 0;

// Ships: shän -> base rlëD, one row of framesPer rotation frames
for (const res of pool.values()) {
  if (res.type !== "shän") continue;
  const d = res.data;
  const baseImageId = d.readInt16BE(SHAN.baseImage);
  const shan = decodeShan(d);
  const rled = pool.get(`rlëD:${baseImageId}`);
  if (!rled) continue;
  try {
    const decoded = decodeRled(rled.data);
    /*
     * Write every sprite set, not just the first rotation. A banking hull
     * stores level flight, bank-left and bank-right as three consecutive
     * rotations in one image, and an animated one stores six; capping the
     * sheet at FramesPer threw all of that away and left every ship flying
     * flat. The sheet is laid out set-major, so set s frame f is at index
     * s * framesPer + f.
     */
    const frames = writeOnce(`ship-${baseImageId}.png`, decoded);
    manifest.ships[res.id] = {
      file: `ship-${baseImageId}.png`,
      name: res.name,
      w: decoded.width,
      h: decoded.height,
      frames,
      // the rlëD this hull draws from. Nova's 288 ship types share only 65
      // pictures between them, and this is what says which ones are the same
      // hull: every Valkyrie variant points at one sprite. Resolved into a
      // canonical ship id below.
      imageId: baseImageId,
      ...shan,
    };
    shipCount++;

    /*
     * Engine glow (GlowImageID) and running lights (LightImageID) are stored
     * frame-for-frame against the base image — the Bible warns that "you must
     * have the same number of engine glow and/or running light frames as base
     * frames (including banking frames!) or Nova will choke", and all 281 glow
     * and 107 light images in the shipped data do match. So they index with
     * the hull's own set and frame.
     */
    for (const [kind, off, bucket, counter] of [
      ["glow", SHAN.glowImage, manifest.glows, () => glowCount++],
      ["light", SHAN.lightImage, manifest.lights, () => lightCount++],
      /*
       * Weapon glow (WeapImageID) is the energy-flare sprite drawn on top of
       * the hull while the ship fires. Like engine glows and running lights it
       * matches the hull frame-for-frame. WeapDecay governs how fast it fades
       * after the ship stops firing; the extractor records the frames/size so
       * the renderer can index it the same way as the hull.
       */
      ["weapGlow", SHAN.weapImage, manifest.weapGlows, () => weapGlowCount++],
    ]) {
      const id = d.readInt16BE(off);
      const src = id > 0 ? pool.get(`rlëD:${id}`) : null;
      if (!src) continue;
      try {
        const dec = decodeRled(src.data);
        const file = `${kind}-${id}.png`;
        bucket[res.id] = {
          file,
          w: dec.width,
          h: dec.height,
          frames: writeOnce(file, dec),
          framesPer: shan.framesPer,
          sets: shan.sets,
        };
        counter();
      } catch (e) {
        console.warn(`${kind} for shän ${res.id}: ${e.message}`);
      }
    }
  } catch (e) {
    failed++;
    console.warn(`shän ${res.id} (${res.name}): ${e.message}`);
  }
}

// Stellars (spïn 1000-1255, first frame), weapons (spïn 3000-3255, all
// frames — rotation), explosions (spïn 400-463, all frames — animation)
for (const res of pool.values()) {
  if (res.type !== "spïn") continue;
  const kind =
    res.id >= 1000 && res.id <= 1255
      ? "stellar"
      : res.id >= 3000 && res.id <= 3255
        ? "weapon"
        : res.id >= 400 && res.id <= 463
          ? "boom"
          : res.id >= 800 && res.id <= 815
            ? "roid"
            : res.id === 650
              ? "cursor"
              : null;
  if (!kind) continue;
  const spriteId = res.data.readInt16BE(0);
  const rled = pool.get(`rlëD:${spriteId}`);
  if (!rled) continue;
  try {
    const decoded = decodeRled(rled.data);
    const file = `${kind}-${res.id}.png`;
    if (kind === "stellar") {
      // Two of the sixty-five stellar graphics animate: spïn 1001, the
      // hypergate, turns through 42 frames, and spïn 1059, the wormhole,
      // through 32. Every planet is a single frame. Writing one frame for all
      // of them, as this used to, froze both gates mid-cycle.
      const frames = writeSheet(join(outDir, file), decoded, decoded.frameCount);
      manifest.stellars[res.id] = { file, w: decoded.width, h: decoded.height, frames };
      stellarCount++;
    } else {
      const frames = writeSheet(join(outDir, file), decoded, decoded.frameCount);
      const entry = { file, w: decoded.width, h: decoded.height, frames };
      if (kind === "weapon") {
        manifest.weapons[res.id] = entry;
        weaponCount++;
      } else if (kind === "roid") {
        manifest.roids[res.id] = entry;
        roidCount++;
      } else if (kind === "cursor") {
        manifest.ui.cursor = entry;
      } else {
        manifest.booms[res.id] = entry;
        boomCount++;
      }
    }
  } catch (e) {
    failed++;
    console.warn(`spïn ${res.id}: ${e.message}`);
  }
}

// Main-menu chrome: spïn 600-610 wrap the title screen's rlëD sprites.
// Their trailing pair of fields is a tile grid (across x down), not a
// position — spïn 606 reads 1x7 and the logo really does have 7 frames — so
// it is the authoritative frame count. That is how we learn the six buttons
// carry 2 frames each: an idle plate and a lit rollover.
for (const res of pool.values()) {
  if (res.type !== "spïn") continue;
  if (res.id < 600 || res.id > 610) continue;
  const spriteId = res.data.readInt16BE(0);
  const rled = pool.get(`rlëD:${spriteId}`);
  if (!rled) continue;
  const tiles = Math.max(1, res.data.readInt16BE(8) * res.data.readInt16BE(10));
  try {
    const decoded = decodeRled(rled.data, tiles);
    const file = `menu-${spriteId}.png`;
    const frames = writeSheet(join(outDir, file), decoded, tiles);
    manifest.menu[spriteId] = {
      file,
      w: decoded.width,
      h: decoded.height,
      frames,
      // the spïn's own resource name says what the strip is for
      ...(res.name ? { name: res.name } : {}),
    };
  } catch (e) {
    console.warn(`spïn ${res.id} (rlëD ${spriteId}): ${e.message}`);
  }
}

/*
 * Collapse the ship types onto the hulls they actually depict. Nova stores one
 * shipyard and one target picture per distinct hull and, in the Bible's words,
 * "the engine will use it for all higher-numbered ship types with the same base
 * sprites" — so the canonical ship for a picture is the lowest id drawing from
 * a given rlëD. Every variant then points at it, which is how a second-hand
 * Valkyrie gets the Valkyrie's portrait instead of whatever id happens to sit
 * below it.
 */
const canonicalByImage = new Map();
for (const id of Object.keys(manifest.ships).map(Number).sort((a, b) => a - b)) {
  const img = manifest.ships[id].imageId;
  if (!canonicalByImage.has(img)) canonicalByImage.set(img, id);
}
for (const [id, entry] of Object.entries(manifest.ships)) {
  entry.baseId = canonicalByImage.get(entry.imageId) ?? Number(id);
}
console.log(
  `${Object.keys(manifest.ships).length} ship types share ${canonicalByImage.size} distinct hulls`,
);

writeFileSync(
  join(outDir, "..", "sprites.json"),
  JSON.stringify(manifest),
);
console.log(
  `Extracted ${shipCount} ship, ${glowCount} engine-glow, ${lightCount} running-light, ` +
    `${weapGlowCount} weapon-glow, ${stellarCount} stellar, ${weaponCount} weapon, ` +
    `${boomCount} explosion, ${roidCount} asteroid sprites (${failed} failures)`,
);
{
  const s = Object.values(manifest.ships);
  const bank = s.filter((e) => e.flags & 0x0001).length;
  const anim = s.filter((e) => e.flags & 0x000a).length;
  const blink = s.filter((e) => e.blinkMode > 0).length;
  console.log(`  ${bank} hulls bank, ${anim} animate, ${blink} have blinking running lights`);
}
const shuttle = manifest.ships[128];
console.log("Shuttle (shän 128):", JSON.stringify(shuttle));
