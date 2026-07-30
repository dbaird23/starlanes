#!/usr/bin/env node
/**
 * Extract EV Nova landing-landscape PICT resources into PNGs.
 *
 * Usage: node scripts/extract-picts.mjs "<path to Nova Files dir>"
 * Writes: public/nova/picts/land-<id>.png + public/nova/picts.json
 *
 * QuickDraw PICT v2 subset decoder (directBitsRect / packbits), ported from
 * NovaJS's PICTParse (MIT, Tom Hancocks / Matthew Soulanille lineage).
 * Landing pictures: PICT 10000-10059 (default landscapes, keyed by stellar
 * graphic) and 11000-11084 (custom landscapes referenced by spöb resources).
 */
import { readFileSync, writeFileSync, readdirSync, mkdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { PNG } from "pngjs";
import { parseRez } from "./rez.mjs";

const OP_NOOP = 0x0000;
const OP_CLIP = 0x0001;
const OP_DIRECT_BITS_RECT = 0x009a;
const OP_EOF = 0x00ff;
const OP_HILITE = 0x001e;
const OP_LONG_COMMENT = 0x00a1;
const OP_EXT_HEADER = 0x0c00;

class PictDecoder {
  constructor(buf) {
    this.d = buf;
    this.pos = 2; // first two bytes unused
    this.readRect(); // frame
    const version = this.readU32();
    if (version !== 0x1102ff) throw new Error("not a PICT v2");
    if (this.readOpcode() !== OP_EXT_HEADER) throw new Error("no extended header");
    const headerVersion = this.readU32();
    if (headerVersion >>> 16 !== 0xfffe) {
      this.pos += 16; // fixed-point resolution + source rect
    } else {
      this.pos += 8;
      this.readRect();
    }
  }

  decode() {
    for (;;) {
      if (this.pos >= this.d.length) throw new Error("no bitmap found");
      const op = this.readOpcode();
      if (op === OP_EOF) throw new Error("no bitmap found");
      if (op === OP_DIRECT_BITS_RECT) return this.directBitsRect();
      if (op === OP_CLIP) this.skipRegion();
      else if (op === OP_LONG_COMMENT) this.skipComment();
      else if (op === OP_NOOP || op === OP_HILITE || op === OP_EXT_HEADER) continue;
      else throw new Error(`unsupported opcode 0x${op.toString(16)} at ${this.pos}`);
    }
  }

  directBitsRect() {
    const px = {
      baseAddress: this.readU32(),
      rowBytes: this.readU16() & 0x7fff,
      bounds: this.readWHRect(),
      pmVersion: this.readU16(),
      packType: this.readU16(),
      packSize: this.readU32(),
      hRes: this.readU32(),
      vRes: this.readU32(),
      pixelType: this.readU16(),
      pixelSize: this.readU16(),
      cmpCount: this.readU16(),
      cmpSize: this.readU16(),
      planeBytes: this.readU32(),
      pmTable: this.readU32(),
      pmReserved: this.readU32(),
    };
    const src = this.readWHRect();
    this.readWHRect(); // destination
    this.pos += 2; // transfer mode

    if (px.packType !== 3 && px.packType !== 4) {
      throw new Error(`unsupported packType ${px.packType}`);
    }

    const png = new PNG({ width: src.width, height: src.height });
    for (let line = 0; line < src.height; line++) {
      let raw;
      if (px.rowBytes < 8) {
        raw = this.readBytes(px.rowBytes);
      } else {
        const packed = px.rowBytes > 250 ? this.readU16() : this.readU8();
        raw = this.unpackBits(this.readBytes(packed), px.packType === 3 ? 2 : 1);
      }
      for (let x = 0; x < src.width; x++) {
        const idx = (line * src.width + x) * 4;
        if (px.packType === 3) {
          // RGB555 big-endian
          const v = ((raw[2 * x] & 0xff) << 8) | (raw[2 * x + 1] & 0xff);
          png.data[idx] = ((v & 0x7c00) >>> 10) << 3;
          png.data[idx + 1] = ((v & 0x03e0) >>> 5) << 3;
          png.data[idx + 2] = (v & 0x001f) << 3;
          png.data[idx + 3] = 255;
        } else if (px.cmpCount === 3) {
          // planar RGB
          png.data[idx] = raw[x] & 0xff;
          png.data[idx + 1] = raw[px.bounds.width + x] & 0xff;
          png.data[idx + 2] = raw[2 * px.bounds.width + x] & 0xff;
          png.data[idx + 3] = 255;
        } else {
          // planar ARGB
          png.data[idx] = raw[px.bounds.width + x] & 0xff;
          png.data[idx + 1] = raw[2 * px.bounds.width + x] & 0xff;
          png.data[idx + 2] = raw[3 * px.bounds.width + x] & 0xff;
          png.data[idx + 3] = raw[x] & 0xff;
        }
      }
    }
    return png;
  }

  unpackBits(data, valueSize) {
    const out = [];
    let pos = 0;
    while (pos < data.length) {
      const count = data[pos++];
      if (count < 128) {
        const run = (1 + count) * valueSize;
        for (let i = 0; i < run; i++) out.push(data[pos + i]);
        pos += run;
      } else {
        const run = 256 - count;
        const val = data.subarray(pos, pos + valueSize);
        pos += valueSize;
        for (let i = 0; i <= run; i++) for (const v of val) out.push(v);
      }
    }
    return out;
  }

  readBytes(n) {
    const b = this.d.subarray(this.pos, this.pos + n);
    this.pos += n;
    return b;
  }
  readU8() {
    return this.d[this.pos++];
  }
  readU16() {
    const v = this.d.readUInt16BE(this.pos);
    this.pos += 2;
    return v;
  }
  readU32() {
    const v = this.d.readUInt32BE(this.pos);
    this.pos += 4;
    return v;
  }
  readOpcode() {
    this.pos += this.pos % 2;
    return this.readU16();
  }
  readRect() {
    const r = {
      y1: this.readU16(),
      x1: this.readU16(),
      y2: this.readU16(),
      x2: this.readU16(),
    };
    return r;
  }
  readWHRect() {
    const r = this.readRect();
    return { x: r.x1, y: r.y1, width: r.x2 - r.x1, height: r.y2 - r.y1 };
  }
  skipRegion() {
    const size = this.readU16();
    this.pos += size - 2;
  }
  skipComment() {
    this.readU16(); // kind
    const len = this.readU16();
    this.pos += len;
  }
}

// ---- main ----

const novaFilesDir = process.argv[2];
if (!novaFilesDir) {
  console.error('usage: node scripts/extract-picts.mjs "<Nova Files dir>"');
  process.exit(1);
}

// landing landscapes, shipyard pictures (5000 + ship - 128), outfit pictures
// (6000 + outfit - 128)
const kindOf = (id) => {
  if ((id >= 10000 && id <= 10059) || (id >= 11000 && id <= 11084)) return "land";
  if (id >= 5000 && id <= 5299) return "shipyard";
  // PICT 3000 + shipID - 128: the red target-display silhouettes
  if (id >= 3000 && id <= 3299) return "target";
  if (id >= 6000 && id <= 6299) return "outfit";
  if (id === 131 || (id >= 700 && id <= 706)) return "ui";
  if (id >= 7500 && id <= 9008) return "ui";
  if (id >= 9500 && id <= 9724) return "nebu";
  return null;
};

const outDir = join(dirname(fileURLToPath(import.meta.url)), "..", "public", "nova", "picts");
mkdirSync(outDir, { recursive: true });

const manifest = { land: {}, shipyard: {}, outfit: {}, ui: {}, nebu: {}, target: {} };
let ok = 0;
let failed = 0;
for (const f of readdirSync(novaFilesDir).filter((f) => f.endsWith(".rez")).sort()) {
  for (const r of parseRez(readFileSync(join(novaFilesDir, f)))) {
    if (r.type !== "PICT") continue;
    const kind = kindOf(r.id);
    if (!kind || manifest[kind][r.id]) continue;
    try {
      const png = new PictDecoder(r.data).decode();
      const file = `${kind}-${r.id}.png`;
      writeFileSync(join(outDir, file), PNG.sync.write(png));
      // Keep the Mac resource name. Nova labels most of its art ("Atmos/
      // ambrosia", "Independent News Corp"), which is the only thing that says
      // outright what an otherwise anonymous interface PICT is for.
      const entry = { file, w: png.width, h: png.height };
      if (r.name) entry.name = r.name;
      manifest[kind][r.id] = entry;
      ok++;
    } catch (e) {
      failed++;
      console.warn(`PICT ${r.id}: ${e.message}`);
    }
  }
}

writeFileSync(join(outDir, "..", "picts.json"), JSON.stringify(manifest));
console.log(
  `Extracted ${ok} pictures (${failed} failures): ` +
    `${Object.keys(manifest.land).length} landing, ` +
    `${Object.keys(manifest.shipyard).length} shipyard, ` +
    `${Object.keys(manifest.outfit).length} outfit`,
);
