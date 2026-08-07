/**
 * The one hand-authored deck, and the creatures on it.
 *
 * Levels are ASCII so a second one is data rather than code. `parseLevel`
 * turns the glyphs into a flat `Uint8Array` of wall ids — `0` is deck, and
 * anything else indexes a wall material — plus the player start, the extract
 * point and the spawn list.
 */

import type { FpsEnemyDef, FpsLevel, FpsSpawn } from "./types";

/**
 * Wraith Adult / Youth / Child. Nova draws all three from their own rlëD at 36
 * rotations per set, which is exactly the billboard format a raycaster wants —
 * so the tiers cost nothing but these numbers.
 *
 * They are the right monster for this in a way a ship would not be: the sprites
 * are lit from above and drawn from above, which reads as wrong on anything
 * that walks and reads as fine on something that hovers.
 */
export const ENEMY_DEFS: Record<string, FpsEnemyDef> = {
  adult: {
    kind: "adult",
    name: "Wraith",
    sheet: "ship-1080.png",
    frameSize: 48,
    frames: 36,
    health: 90,
    speed: 1.5,
    reach: 0.9,
    damage: 18,
    attackGap: 1.1,
    senseRange: 11,
    scale: 0.72,
    hover: 0.46,
    boomId: 402,
    deathSnd: 302,
  },
  youth: {
    kind: "youth",
    name: "Wraith youth",
    sheet: "ship-1082.png",
    frameSize: 40,
    frames: 36,
    health: 50,
    speed: 2.1,
    reach: 0.8,
    damage: 11,
    attackGap: 0.9,
    senseRange: 10,
    scale: 0.55,
    hover: 0.48,
    boomId: 401,
    deathSnd: 301,
  },
  child: {
    kind: "child",
    name: "Wraith child",
    sheet: "ship-1084.png",
    frameSize: 32,
    frames: 36,
    health: 26,
    speed: 2.7,
    reach: 0.7,
    damage: 6,
    attackGap: 0.7,
    senseRange: 9,
    scale: 0.38,
    hover: 0.52,
    boomId: 400,
    deathSnd: 301,
  },
};

/**
 * A derelict freighter's main deck. South (the bottom) is the airlock you came
 * in by and the one you have to get back to; north is the reactor bay.
 *
 * `#` bulkhead · `=` inner housing · `.` deck · `@` start · `X` extract
 * `A`/`Y`/`C` Wraith adult / youth / child.
 */
const DECK = [
  "########################",
  "#......................#",
  "#.####.####..####.####.#",
  "#.#...A...#..#.......#.#",
  "#.#...=...#..#...=...#.#",
  "#.#.......#..#...A...#.#",
  "#.#########..#########.#",
  "#......................#",
  "#.###.#####..#####.###.#",
  "#.#.......#..#.....Y.#.#",
  "#.#.......#Y.#.......#.#",
  "#.#..=.=..#..#..=.=..#.#",
  "#.#.Y.....#..#.......#C#",
  "#.#.......#..#.......#.#",
  "#.######.##..#########.#",
  "#......................#",
  "#.###.#####..#####.###.#",
  "#.#.......#..#.......#.#",
  "#.#.......#..#..C....#.#",
  "#.#..C....#..#.......#.#",
  "#.#.......#..#.......#.#",
  "#.#########..######.##.#",
  "#.@X...................#",
  "########################",
];

const WALL_GLYPHS: Record<string, number> = { "#": 1, "=": 2 };

export function parseLevel(name: string, rows: string[]): FpsLevel {
  const h = rows.length;
  const w = rows[0].length;
  for (const [i, r] of rows.entries()) {
    if (r.length !== w) {
      throw new Error(`level "${name}" row ${i} is ${r.length} wide, not ${w}`);
    }
  }

  const cells = new Uint8Array(w * h);
  const spawns: FpsSpawn[] = [];
  let start = { x: 1.5, y: 1.5, angle: 0 };
  let exit = { x: 1.5, y: 1.5 };

  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const ch = rows[y][x];
      const wall = WALL_GLYPHS[ch];
      if (wall !== undefined) {
        cells[y * w + x] = wall;
        continue;
      }
      const cx = x + 0.5;
      const cy = y + 0.5;
      switch (ch) {
        // the deck runs north, so you come aboard facing up the hull
        case "@":
          start = { x: cx, y: cy, angle: -Math.PI / 2 };
          break;
        case "X":
          exit = { x: cx, y: cy };
          break;
        case "A":
          spawns.push({ kind: "adult", x: cx, y: cy });
          break;
        case "Y":
          spawns.push({ kind: "youth", x: cx, y: cy });
          break;
        case "C":
          spawns.push({ kind: "child", x: cx, y: cy });
          break;
      }
    }
  }

  return { name, w, h, cells, start, exit, spawns };
}

export const DERELICT = parseLevel("Derelict", DECK);
