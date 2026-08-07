/**
 * Flight-control keybindings. Each action is one chord (key + optional
 * Alt/Shift/Ctrl). Preferences edits a draft until Save; collisions block Save.
 */

import type { Input } from "./engine/input";

export interface Chord {
  /** KeyboardEvent.code, e.g. "KeyJ", "Space", "ArrowLeft". */
  code: string;
  alt?: boolean;
  shift?: boolean;
  ctrl?: boolean;
}

export type ActionId =
  | "turnLeft"
  | "turnRight"
  | "accelerate"
  | "reverse"
  | "aimAssist"
  | "afterburner"
  | "firePrimary"
  | "fireSecondary"
  | "selectSecondary"
  | "cycleTargets"
  | "targetClosest"
  | "land"
  | "jump"
  | "hyperSelect"
  | "cycleJumpDest"
  | "map"
  | "hail"
  | "board"
  | "cloak"
  | "recallFighters"
  | "autopilot"
  | "navOff"
  | "escortAttack"
  | "escortForm"
  | "escortHold"
  | "playerInfo"
  | "missionInfo"
  | "jettison"
  | "eject"
  | "selfDestruct";

export interface ActionDef {
  id: ActionId;
  label: string;
}

/** Display order in Preferences. */
export const ACTIONS: ActionDef[] = [
  { id: "turnLeft", label: "Turn left" },
  { id: "turnRight", label: "Turn right" },
  { id: "accelerate", label: "Accelerate" },
  { id: "reverse", label: "Reverse (turn about)" },
  { id: "aimAssist", label: "Aim toward target (hold)" },
  { id: "afterburner", label: "Afterburner" },
  { id: "firePrimary", label: "Fire primary" },
  { id: "fireSecondary", label: "Fire secondary" },
  { id: "selectSecondary", label: "Select secondary" },
  { id: "cycleTargets", label: "Cycle targets" },
  { id: "targetClosest", label: "Target nearest ship" },
  { id: "land", label: "Target / land / dock" },
  { id: "jump", label: "Hyperspace jump" },
  { id: "hyperSelect", label: "Hyper select (floating map)" },
  { id: "cycleJumpDest", label: "Select jump destination" },
  { id: "map", label: "Star map" },
  { id: "hail", label: "Communicate" },
  { id: "board", label: "Board disabled ship" },
  { id: "cloak", label: "Engage cloak" },
  { id: "recallFighters", label: "Recall fighters" },
  { id: "autopilot", label: "Autopilot" },
  { id: "navOff", label: "Nav system off" },
  { id: "escortAttack", label: "Escorts: attack my target" },
  { id: "escortForm", label: "Escorts: form up" },
  { id: "escortHold", label: "Escorts: hold position" },
  { id: "playerInfo", label: "Player info" },
  { id: "missionInfo", label: "Mission info" },
  { id: "jettison", label: "Jettison cargo" },
  { id: "eject", label: "Eject (escape pod)" },
  { id: "selfDestruct", label: "Self-destruct" },
];

export const ACTION_IDS: ActionId[] = ACTIONS.map((a) => a.id);

export const DEFAULT_BINDINGS: Record<ActionId, Chord> = {
  turnLeft: { code: "ArrowLeft" },
  turnRight: { code: "ArrowRight" },
  accelerate: { code: "ArrowUp" },
  reverse: { code: "ArrowDown" },
  aimAssist: { code: "KeyA" },
  afterburner: { code: "KeyZ" },
  firePrimary: { code: "Space" },
  fireSecondary: { code: "ControlLeft" },
  selectSecondary: { code: "KeyW" },
  cycleTargets: { code: "Backquote" },
  targetClosest: { code: "KeyR" },
  land: { code: "KeyL" },
  jump: { code: "KeyJ" },
  hyperSelect: { code: "KeyH" },
  cycleJumpDest: { code: "Backslash" },
  map: { code: "KeyM" },
  hail: { code: "KeyY" },
  board: { code: "KeyB" },
  cloak: { code: "KeyU" },
  recallFighters: { code: "KeyC", alt: true },
  autopilot: { code: "KeyQ" },
  navOff: { code: "KeyN" },
  escortAttack: { code: "KeyF" },
  escortForm: { code: "KeyC" },
  escortHold: { code: "KeyV" },
  playerInfo: { code: "KeyP" },
  missionInfo: { code: "KeyI" },
  jettison: { code: "KeyK", alt: true },
  eject: { code: "KeyX", alt: true },
  selfDestruct: { code: "KeyQ", shift: true },
};

/** Tab still cycles targets as a classic dual-bind with Backquote. */
export const CYCLE_TARGETS_ALT_CODE = "Tab";

export function cloneBindings(
  src: Record<ActionId, Chord> = DEFAULT_BINDINGS,
): Record<ActionId, Chord> {
  const out = {} as Record<ActionId, Chord>;
  for (const id of ACTION_IDS) {
    out[id] = sanitizeChord(src[id] ?? DEFAULT_BINDINGS[id]);
  }
  return out;
}

export function sanitizeChord(c: Chord | null | undefined): Chord {
  if (!c || typeof c.code !== "string" || !c.code) {
    return { code: "Unidentified" };
  }
  const out: Chord = { code: c.code };
  if (c.alt) out.alt = true;
  if (c.shift) out.shift = true;
  if (c.ctrl) out.ctrl = true;
  return out;
}

export function normalizeBindings(
  raw: unknown,
): Record<ActionId, Chord> {
  const out = cloneBindings(DEFAULT_BINDINGS);
  if (!raw || typeof raw !== "object") return out;
  const obj = raw as Partial<Record<ActionId, Chord>>;
  for (const id of ACTION_IDS) {
    const c = obj[id];
    if (c && typeof c === "object" && typeof c.code === "string" && c.code) {
      out[id] = sanitizeChord(c);
    }
  }
  return out;
}

/** Canonical id for collision checks; L/R modifier keys collapse. */
export function chordId(c: Chord): string {
  let code = c.code;
  if (code === "ControlRight") code = "ControlLeft";
  if (code === "AltRight") code = "AltLeft";
  if (code === "ShiftRight") code = "ShiftLeft";
  return `${c.ctrl ? "C" : ""}${c.alt ? "A" : ""}${c.shift ? "S" : ""}+${code}`;
}

export function chordsEqual(a: Chord, b: Chord): boolean {
  return chordId(a) === chordId(b);
}

/** Action ids that share a chord with at least one other action. */
export function findCollisions(
  bindings: Record<ActionId, Chord>,
): Set<ActionId> {
  const by = new Map<string, ActionId[]>();
  for (const id of ACTION_IDS) {
    const k = chordId(bindings[id]);
    const list = by.get(k) ?? [];
    list.push(id);
    by.set(k, list);
  }
  const bad = new Set<ActionId>();
  for (const list of by.values()) {
    if (list.length < 2) continue;
    for (const id of list) bad.add(id);
  }
  return bad;
}

export function formatCode(code: string): string {
  const named: Record<string, string> = {
    ArrowLeft: "←",
    ArrowRight: "→",
    ArrowUp: "↑",
    ArrowDown: "↓",
    Space: "Space",
    Backquote: "`",
    Backslash: "\\",
    ControlLeft: "Left Ctrl",
    ControlRight: "Right Ctrl",
    AltLeft: "Left Opt",
    AltRight: "Right Opt",
    ShiftLeft: "Left Shift",
    ShiftRight: "Right Shift",
    Escape: "Esc",
    Minus: "−",
    Equal: "=",
    Enter: "Enter",
    NumpadEnter: "Num Enter",
    Tab: "Tab",
    BracketLeft: "[",
    BracketRight: "]",
    Semicolon: ";",
    Quote: "'",
    Comma: ",",
    Period: ".",
    Slash: "/",
  };
  if (named[code]) return named[code];
  if (code.startsWith("Key") && code.length === 4) return code.slice(3);
  if (code.startsWith("Digit") && code.length === 6) return code.slice(5);
  if (code.startsWith("Numpad")) return "Num" + code.slice(6);
  return code;
}

export function formatChord(c: Chord): string {
  const parts: string[] = [];
  if (c.ctrl) parts.push("Ctrl");
  if (c.alt) parts.push("Opt");
  if (c.shift) parts.push("Shift");
  parts.push(formatCode(c.code));
  return parts.join("-");
}

/** Compact label for the HUD hint strip. */
export function formatChordShort(c: Chord): string {
  const parts: string[] = [];
  if (c.ctrl) parts.push("⌃");
  if (c.alt) parts.push("⌥");
  if (c.shift) parts.push("⇧");
  parts.push(formatCode(c.code));
  return parts.join("");
}

/**
 * Build a chord from a keydown. Pure modifier presses bind that key alone
 * (so secondary fire can be Left Ctrl). Escape / Meta / CapsLock are reserved.
 */
export function chordFromEvent(e: KeyboardEvent): Chord | null {
  const code = e.code;
  if (
    code === "Escape" ||
    code === "MetaLeft" ||
    code === "MetaRight" ||
    code === "CapsLock" ||
    code === "ContextMenu"
  ) {
    return null;
  }
  const isCtrl = code === "ControlLeft" || code === "ControlRight";
  const isAlt = code === "AltLeft" || code === "AltRight";
  const isShift = code === "ShiftLeft" || code === "ShiftRight";
  if (isCtrl || isAlt || isShift) {
    return { code };
  }
  const out: Chord = { code };
  if (e.altKey) out.alt = true;
  if (e.shiftKey) out.shift = true;
  if (e.ctrlKey) out.ctrl = true;
  return out;
}

/** L/R sides of a modifier key are interchangeable when matching. */
function codesFor(c: Chord): string[] {
  if (c.code === "ControlLeft" || c.code === "ControlRight") {
    return ["ControlLeft", "ControlRight"];
  }
  if (c.code === "AltLeft" || c.code === "AltRight") {
    return ["AltLeft", "AltRight"];
  }
  if (c.code === "ShiftLeft" || c.code === "ShiftRight") {
    return ["ShiftLeft", "ShiftRight"];
  }
  return [c.code];
}

function modsMatch(
  input: Pick<Input, "altDown" | "shiftDown" | "ctrlDown">,
  c: Chord,
): boolean {
  const isCtrl = c.code === "ControlLeft" || c.code === "ControlRight";
  const isAlt = c.code === "AltLeft" || c.code === "AltRight";
  const isShift = c.code === "ShiftLeft" || c.code === "ShiftRight";
  if (!isAlt && !!c.alt !== input.altDown) return false;
  if (!isShift && !!c.shift !== input.shiftDown) return false;
  if (!isCtrl && !!c.ctrl !== input.ctrlDown) return false;
  return true;
}

/** Live binding lookup — set by settings.ts after load / save. */
let live: Record<ActionId, Chord> = cloneBindings(DEFAULT_BINDINGS);

export function setLiveBindings(b: Record<ActionId, Chord>): void {
  live = cloneBindings(b);
}

export function getBindings(): Readonly<Record<ActionId, Chord>> {
  return live;
}

export function getBinding(id: ActionId): Chord {
  return live[id] ?? DEFAULT_BINDINGS[id];
}

export function actionDown(input: Input, id: ActionId): boolean {
  const c = getBinding(id);
  if (!modsMatch(input, c)) return false;
  return codesFor(c).some((code) => input.isDown(code));
}

export function actionConsume(input: Input, id: ActionId): boolean {
  const c = getBinding(id);
  if (!modsMatch(input, c)) return false;
  for (const code of codesFor(c)) {
    if (input.consume(code)) return true;
  }
  return false;
}

/**
 * Cycle-targets also accepts Tab when the bound key is still Backquote
 * (Nova's dual classic binding). If the player rebinds cycleTargets away
 * from `, Tab is left free for the map's link cycle.
 */
export function consumeCycleTargets(input: Input): boolean {
  if (actionConsume(input, "cycleTargets")) return true;
  const primary = getBinding("cycleTargets");
  if (
    primary.code === "Backquote" &&
    !primary.alt &&
    !primary.shift &&
    !primary.ctrl &&
    !input.altDown &&
    !input.shiftDown &&
    !input.ctrlDown &&
    input.consume(CYCLE_TARGETS_ALT_CODE)
  ) {
    return true;
  }
  return false;
}

