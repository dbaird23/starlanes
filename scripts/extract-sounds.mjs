#!/usr/bin/env node
/**
 * Extract Mac 'snd ' resources to WAV + copy the soundtrack.
 *
 * Usage: node scripts/extract-sounds.mjs "<path to Nova Files dir>"
 * Writes: public/nova/sounds/snd-<id>.wav, public/nova/music.mp3,
 *         public/nova/sounds.json
 *
 * snd format (Sound Manager): format 1/2 header, one offset bufferCmd (81),
 * then a sample header — encoding 0 = 8-bit PCM, 0xfe = compressed (ima4).
 * Port of NovaJS's SndResource (MIT).
 */
import { readFileSync, writeFileSync, readdirSync, mkdirSync, copyFileSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { parseRez } from "./rez.mjs";

const IMA_INDEX = [-1, -1, -1, -1, 2, 4, 6, 8, -1, -1, -1, -1, 2, 4, 6, 8];
const IMA_STEP = [
  7, 8, 9, 10, 11, 12, 13, 14, 16, 17, 19, 21, 23, 25, 28, 31, 34, 37, 41, 45, 50, 55, 60,
  66, 73, 80, 88, 97, 107, 118, 130, 143, 157, 173, 190, 209, 230, 253, 279, 307, 337, 371,
  408, 449, 494, 544, 598, 658, 724, 796, 876, 963, 1060, 1166, 1282, 1411, 1552, 1707,
  1878, 2066, 2272, 2499, 2749, 3024, 3327, 3660, 4026, 4428, 4871, 5358, 5894, 6484, 7132,
  7845, 8630, 9493, 10442, 11487, 12635, 13899, 15289, 16818, 18500, 20350, 22385, 24623,
  27086, 29794, 32767,
];

function decodeIma4Block(buf, off, out) {
  const c = buf.readInt16BE(off);
  let si = c & 0x7f;
  let p = c - si;
  if (si > 88) si = 88;
  let step = IMA_STEP[si];
  for (let i = 0; i < 32; i++) {
    const b = buf[off + 2 + i];
    for (const v of [b & 0xf, b >> 4]) {
      si += IMA_INDEX[v];
      si = Math.max(0, Math.min(88, si));
      p += ((v >> 3 ? -1 : 1) * ((v & 7) + 0.5) * step) / 4;
      out.push(Math.max(-1, Math.min(1, p / 32768)));
      step = IMA_STEP[si];
    }
  }
  return off + 34;
}

function decodeSnd(buf) {
  let pos = 0;
  const format = buf.readUInt16BE(pos); pos += 2;
  if (format === 1) {
    const nFormats = buf.readUInt16BE(pos); pos += 2;
    if (nFormats !== 0) pos += 6; // data format id (2) + init options (4)
  } else if (format === 2) {
    pos += 2; // reference count
  } else {
    throw new Error(`unknown snd format ${format}`);
  }
  const numCommands = buf.readUInt16BE(pos); pos += 2;
  if (numCommands !== 1) throw new Error(`expected 1 command, got ${numCommands}`);
  let cmdId = buf.readUInt16BE(pos); pos += 2;
  pos += 2; // arg1
  const arg2 = buf.readUInt32BE(pos); pos += 4;
  const isOffset = (cmdId & 0x8000) !== 0;
  cmdId &= 0x7fff;
  if (cmdId !== 81 || !isOffset) throw new Error(`expected offset bufferCmd, got ${cmdId}`);

  // sample header at arg2
  let p = arg2;
  const ptr = buf.readUInt32BE(p); p += 4;
  if (ptr !== 0) throw new Error("non-immediate sample pointer");
  let length = buf.readUInt32BE(p); p += 4;
  const rate = buf.readUInt32BE(p) / (1 << 16); p += 4;
  p += 8; // loop points
  const encoding = buf[p]; p += 1;
  p += 1; // baseFreq

  const samples = [];
  if (encoding === 0) {
    for (let i = 0; i < length; i++) samples.push((buf[p + i] - 127.5) / 127.5);
  } else if (encoding === 0xfe) {
    // compressed header: nchannels was in `length`
    const frames = buf.readUInt32BE(p); p += 4;
    p += 10; // AIFF rate
    p += 4; // marker chunk
    const fmt = buf.toString("latin1", p, p + 4); p += 4;
    p += 4 + 4 + 4; // future2, statVars, leftOverSamples
    p += 2 + 2 + 2 + 2; // compressionID, packetSize, snthID, sampleSize
    if (fmt !== "ima4") throw new Error(`unsupported compression ${fmt}`);
    let off = p;
    for (let i = 0; i < frames; i++) off = decodeIma4Block(buf, off, samples);
  } else {
    throw new Error(`unsupported encoding 0x${encoding.toString(16)}`);
  }
  return { rate: Math.round(rate), samples };
}

function writeWav(path, rate, samples) {
  const dataLen = samples.length * 2;
  const wav = Buffer.alloc(44 + dataLen);
  wav.write("RIFF", 0);
  wav.writeUInt32LE(36 + dataLen, 4);
  wav.write("WAVE", 8);
  wav.write("fmt ", 12);
  wav.writeUInt32LE(16, 16);
  wav.writeUInt16LE(1, 20); // PCM
  wav.writeUInt16LE(1, 22); // mono
  wav.writeUInt32LE(rate, 24);
  wav.writeUInt32LE(rate * 2, 28);
  wav.writeUInt16LE(2, 32);
  wav.writeUInt16LE(16, 34);
  wav.write("data", 36);
  wav.writeUInt32LE(dataLen, 40);
  for (let i = 0; i < samples.length; i++) {
    wav.writeInt16LE(Math.round(Math.max(-1, Math.min(1, samples[i])) * 32767), 44 + i * 2);
  }
  writeFileSync(path, wav);
}

// ---- main ----

const novaFilesDir = process.argv[2];
if (!novaFilesDir) {
  console.error('usage: node scripts/extract-sounds.mjs "<Nova Files dir>"');
  process.exit(1);
}

const outDir = join(dirname(fileURLToPath(import.meta.url)), "..", "public", "nova", "sounds");
mkdirSync(outDir, { recursive: true });

const manifest = {};
let ok = 0;
let failed = 0;
for (const f of readdirSync(novaFilesDir).filter((f) => f.endsWith(".rez")).sort()) {
  for (const r of parseRez(readFileSync(join(novaFilesDir, f)))) {
    if (r.type !== "snd " || manifest[r.id]) continue;
    try {
      const { rate, samples } = decodeSnd(r.data);
      const file = `snd-${r.id}.wav`;
      writeWav(join(outDir, file), rate, samples);
      // keep the resource name: it is the only thing that says 380 is "Cloak
      // Off" and 130 is "Warp out", and without it call sites end up guessing
      manifest[r.id] = { file, name: r.name, seconds: +(samples.length / rate).toFixed(2) };
      ok++;
    } catch (e) {
      failed++;
      console.warn(`snd ${r.id} (${r.name}): ${e.message}`);
    }
  }
}
writeFileSync(join(outDir, "..", "sounds.json"), JSON.stringify(manifest));

const music = join(novaFilesDir, "Nova Music.mp3");
if (existsSync(music)) {
  copyFileSync(music, join(outDir, "..", "music.mp3"));
  console.log("copied Nova Music.mp3");
}
console.log(`Extracted ${ok} sounds (${failed} failures)`);
console.log("ids:", Object.keys(manifest).slice(0, 20).join(","), "...");
