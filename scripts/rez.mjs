/**
 * Shared parser for EV Nova Windows-format .rez resource containers.
 * Header/offset table are little-endian; the resource map and all resource
 * payloads are big-endian (original Mac data).
 */
const macRoman = new TextDecoder("macintosh");

export function cstr(buf, start, maxLen) {
  let end = start;
  const limit = maxLen ? Math.min(start + maxLen, buf.length) : buf.length;
  while (end < limit && buf[end] !== 0) end++;
  return macRoman.decode(buf.subarray(start, end));
}

export function parseRez(buf) {
  if (buf.toString("latin1", 0, 4) !== "BRGR") throw new Error("not a rez file");
  /**
   * Entry indices in the resource map are numbered across the whole set of
   * .rez files, not from 1 within each one: "Nova Ships 1.rez" holds 96 entries
   * but numbers them 2293 upwards. The file's own base sits at offset 16, so
   * every lookup has to be relative to it. Assuming a base of 1 silently reads
   * nothing out of the twenty files that don't start there, and — worse —
   * reads the *wrong* payload out of any whose range happens to overlap.
   */
  const baseIndex = buf.readUInt32LE(16);
  const numEntries = buf.readUInt32LE(20);
  const entries = [];
  for (let i = 0; i < numEntries; i++) {
    const off = 24 + i * 12;
    entries.push({ offset: buf.readUInt32LE(off), size: buf.readUInt32LE(off + 4) });
  }

  const isMap = (e) => {
    if (!e || e.size < 8 || e.offset + e.size > buf.length) return false;
    const typeListOffset = buf.readUInt32BE(e.offset);
    const numTypes = buf.readUInt32BE(e.offset + 4);
    if (numTypes === 0 || numTypes > 256) return false;
    return typeListOffset + numTypes * 12 <= e.size + 12;
  };
  let map = null;
  for (const cand of [entries[0], entries[entries.length - 1]]) {
    if (isMap(cand)) {
      map = cand;
      break;
    }
  }
  if (!map) throw new Error("resource map not found");

  const m = map.offset;
  const typeListOffset = buf.readUInt32BE(m);
  const numTypes = buf.readUInt32BE(m + 4);
  const resources = [];
  for (let t = 0; t < numTypes; t++) {
    const to = m + typeListOffset + t * 12;
    const type = macRoman.decode(buf.subarray(to, to + 4));
    const resListOffset = buf.readUInt32BE(to + 4);
    const numRes = buf.readUInt32BE(to + 8);
    for (let r = 0; r < numRes; r++) {
      const ro = m + resListOffset + r * 266;
      const index = buf.readUInt32BE(ro);
      const id = buf.readInt16BE(ro + 8);
      const name = cstr(buf, ro + 10, 256);
      const entry = entries[index - baseIndex];
      if (!entry) continue;
      const data = buf.subarray(entry.offset, entry.offset + entry.size);
      resources.push({ type, id, name, data });
    }
  }
  return resources;
}

// CLI: node scripts/rez.mjs <file.rez> — print a type inventory
const { pathToFileURL } = await import("node:url");
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const { readFileSync } = await import("node:fs");
  const resources = parseRez(readFileSync(process.argv[2]));
  const byType = new Map();
  for (const r of resources) {
    if (!byType.has(r.type)) byType.set(r.type, []);
    byType.get(r.type).push(r.id);
  }
  for (const [type, ids] of [...byType.entries()].sort()) {
    ids.sort((a, b) => a - b);
    console.log(`${type}: ${ids.length} (ids ${ids[0]}..${ids[ids.length - 1]})`);
  }
}
