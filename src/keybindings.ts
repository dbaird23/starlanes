/**
 * Flight-control keybindings. Each action is one chord (key + optional
 * Alt/Shift/Ctrl). Preferences edits a draft until Save; collisions block Save.
 */

import type { Input } from "./engine/input";

export interface Chord {
  /**
   * KeyboardEvent.code (e.g. "KeyJ", "Space") or a mouse button code
   * ("Mouse0" left … "Mouse2" right … "Mouse4" forward).
   */
  code: string;
  alt?: boolean;
  shift?: boolean;
  ctrl?: boolean;
}

/** True for Mouse0… mouse-button binding codes. */
export function isMouseCode(code: string): boolean {
  return /^Mouse\d+$/.test(code);
}

export type ActionId =
  | "turnLeft"
  | "turnRight"
  | "accelerate"
  | "reverse"
  | "aimAssist"
  | "aimCursor"
  | "afterburner"
  | "firePrimary"
  | "fireSecondary"
  | "selectSecondary"
  | "cycleTargets"
  | "targetClosest"
  | "selectUnderCursor"
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
  { id: "aimCursor", label: "Aim toward cursor (hold)" },
  { id: "afterburner", label: "Afterburner" },
  { id: "firePrimary", label: "Fire primary" },
  { id: "fireSecondary", label: "Fire secondary" },
  { id: "selectSecondary", label: "Select secondary" },
  { id: "cycleTargets", label: "Cycle targets" },
  { id: "targetClosest", label: "Target nearest hostile" },
  { id: "selectUnderCursor", label: "Select item under cursor" },
  { id: "land", label: "Target / land / dock" },
  { id: "jump", label: "Hyperspace jump" },
  { id: "hyperSelect", label: "Display mini map" },
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

/**
 * A named full binding map. Add entries here to surface them in Preferences;
 * the select lists every preset, and choosing one loads it into the draft.
 */
export interface KeybindingPreset {
  id: string;
  /** Shown in the Preferences select. */
  name: string;
  bindings: Record<ActionId, Chord>;
}

/** Empty code = not bound; never fires and is excluded from collision checks. */
export const UNBOUND: Chord = { code: "" };

export function isUnbound(c: Chord | null | undefined): boolean {
  return !c || !c.code;
}

/** Nova defaults with arrow-key flight — the shipped baseline. */
const CLASSIC_BINDINGS: Record<ActionId, Chord> = {
  turnLeft: { code: "ArrowLeft" },
  turnRight: { code: "ArrowRight" },
  accelerate: { code: "ArrowUp" },
  reverse: { code: "ArrowDown" },
  aimAssist: { code: "KeyA" },
  // Mouse-aim is optional; leave free so classic stays pure keyboard.
  aimCursor: { ...UNBOUND },
  afterburner: { code: "KeyZ" },
  firePrimary: { code: "Space" },
  fireSecondary: { code: "ControlLeft" },
  selectSecondary: { code: "KeyW" },
  cycleTargets: { code: "Backquote" },
  targetClosest: { code: "KeyR" },
  selectUnderCursor: { code: "Mouse0" },
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

/**
 * WASD flight, mouse fire, Shift aim-at-cursor — layout inspired by
 * Starsector. Eject / self-destruct left unbound (bind deliberately).
 */
const STARSECTOR_BINDINGS: Record<ActionId, Chord> = {
  turnLeft: { code: "KeyA" },
  turnRight: { code: "KeyD" },
  accelerate: { code: "KeyW" },
  reverse: { code: "KeyS" },
  aimAssist: { code: "KeyX" },
  aimCursor: { code: "ShiftLeft" },
  afterburner: { code: "Space" },
  firePrimary: { code: "Mouse0" },
  fireSecondary: { code: "Mouse2" },
  selectSecondary: { code: "KeyQ" },
  cycleTargets: { code: "Backquote" },
  targetClosest: { code: "KeyR" },
  selectUnderCursor: { code: "KeyE" },
  land: { code: "KeyL" },
  jump: { code: "KeyZ" },
  hyperSelect: { code: "KeyH" },
  cycleJumpDest: { code: "KeyG" },
  map: { code: "Tab" },
  hail: { code: "KeyY" },
  board: { code: "KeyB" },
  cloak: { code: "KeyU" },
  recallFighters: { code: "KeyC", alt: true },
  autopilot: { code: "BracketRight" },
  navOff: { code: "KeyN" },
  escortAttack: { code: "KeyF" },
  escortForm: { code: "KeyC" },
  escortHold: { code: "KeyV" },
  playerInfo: { code: "KeyP" },
  missionInfo: { code: "KeyI" },
  jettison: { code: "KeyK", alt: true },
  eject: { ...UNBOUND },
  selfDestruct: { ...UNBOUND },
};

/**
 * Ordered list of built-in layouts. Append new presets here — Preferences
 * reads this array for the select options; no UI change required.
 */
export const KEYBINDING_PRESETS: readonly KeybindingPreset[] = [
  {
    id: "classic",
    name: "Classic",
    bindings: CLASSIC_BINDINGS,
  },
  {
    id: "starsector",
    name: "Starsector",
    bindings: STARSECTOR_BINDINGS,
  },
];

export const DEFAULT_PRESET_ID = KEYBINDING_PRESETS[0]!.id;

/** Alias for the first preset (Classic) — used as the factory default. */
export const DEFAULT_BINDINGS: Record<ActionId, Chord> =
  KEYBINDING_PRESETS[0]!.bindings;

/** Sentinel select value when the draft matches no named preset. */
export const CUSTOM_PRESET_VALUE = "__custom__";

export function getPreset(id: string): KeybindingPreset | undefined {
  return KEYBINDING_PRESETS.find((p) => p.id === id);
}

/** Known preset id, or Classic if the string is unknown / missing. */
export function resolvePresetId(id: string | null | undefined): string {
  if (id && getPreset(id)) return id;
  return DEFAULT_PRESET_ID;
}

/** Bindings for a preset id, or Classic if unknown. */
export function bindingsForPreset(id: string): Record<ActionId, Chord> {
  return getPreset(id)?.bindings ?? DEFAULT_BINDINGS;
}

/**
 * Which preset (if any) matches this map exactly. Null means a custom mix —
 * the select shows "Custom (…)" based on the last named preset they branched from.
 */
export function matchPresetId(
  bindings: Record<ActionId, Chord>,
): string | null {
  for (const preset of KEYBINDING_PRESETS) {
    if (
      ACTION_IDS.every((id) =>
        chordsEqual(bindings[id], preset.bindings[id]),
      )
    ) {
      return preset.id;
    }
  }
  return null;
}

/**
 * Label for a customized layout that started from `baseId`.
 * e.g. base "classic" → "Custom (Classic)".
 */
export function customPresetLabel(baseId: string | null | undefined): string {
  const preset = getPreset(resolvePresetId(baseId));
  return `Custom (${preset?.name ?? "Classic"})`;
}

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
    return { ...UNBOUND };
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
    // Empty code is a deliberate unbind; missing keys keep the preset default.
    if (c && typeof c === "object" && typeof c.code === "string") {
      out[id] = sanitizeChord(c);
    }
  }
  return out;
}

/** Portable file format tag for exported keybinding configs. */
export const KEYBINDINGS_FILE_FORMAT = "starlanes-keybindings";

/**
 * Serialise a binding map to a downloadable JSON payload. `basePresetId` is
 * the named layout the mix branched from (for Custom (…) / future import).
 */
export function exportKeybindings(
  bindings: Record<ActionId, Chord>,
  basePresetId?: string,
): { filename: string; json: string } {
  const matched = matchPresetId(bindings);
  const base = resolvePresetId(
    matched ?? basePresetId ?? DEFAULT_PRESET_ID,
  );
  const slug = (matched ?? "custom").replace(/[^\w.-]+/g, "_") || "custom";
  return {
    filename: `starlanes-keybindings-${slug}.json`,
    json: JSON.stringify(
      {
        format: KEYBINDINGS_FILE_FORMAT,
        version: 1,
        basePreset: base,
        keybindings: cloneBindings(bindings),
      },
      null,
      2,
    ),
  };
}

/** Canonical id for collision checks; L/R modifier keys collapse. */
export function chordId(c: Chord): string {
  if (isUnbound(c)) return "";
  let code = c.code;
  if (code === "ControlRight") code = "ControlLeft";
  if (code === "AltRight") code = "AltLeft";
  if (code === "ShiftRight") code = "ShiftLeft";
  return `${c.ctrl ? "C" : ""}${c.alt ? "A" : ""}${c.shift ? "S" : ""}+${code}`;
}

export function chordsEqual(a: Chord, b: Chord): boolean {
  if (isUnbound(a) && isUnbound(b)) return true;
  if (isUnbound(a) || isUnbound(b)) return false;
  return chordId(a) === chordId(b);
}

type ModifierKind = "shift" | "alt" | "ctrl";

/** True when the chord is the bare modifier key itself (e.g. Left Shift alone). */
export function isBareModifierKey(
  c: Chord | null | undefined,
  kind?: ModifierKind,
): boolean {
  if (isUnbound(c) || !c) return false;
  const isShift = c.code === "ShiftLeft" || c.code === "ShiftRight";
  const isAlt = c.code === "AltLeft" || c.code === "AltRight";
  const isCtrl = c.code === "ControlLeft" || c.code === "ControlRight";
  if (!isShift && !isAlt && !isCtrl) return false;
  // Bare keys never carry chord flags of their own
  if (c.shift || c.alt || c.ctrl) return false;
  if (!kind) return true;
  if (kind === "shift") return isShift;
  if (kind === "alt") return isAlt;
  return isCtrl;
}

function chordUsesModifier(c: Chord, kind: ModifierKind): boolean {
  if (isUnbound(c)) return false;
  if (kind === "shift") return !!c.shift;
  if (kind === "alt") return !!c.alt;
  return !!c.ctrl;
}

/**
 * Action ids that share a chord, plus bare-modifier vs modifier-chord pairs.
 * Binding Left Shift alone collides with Shift-Q (self-destruct); it does not
 * block plain keys at runtime once that conflict is resolved.
 */
export function findCollisions(
  bindings: Record<ActionId, Chord>,
): Set<ActionId> {
  const by = new Map<string, ActionId[]>();
  for (const id of ACTION_IDS) {
    if (isUnbound(bindings[id])) continue; // many unbound slots are fine
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

  // Bare Shift/Opt/Ctrl cannot coexist with any chord that uses that modifier
  for (const kind of ["shift", "alt", "ctrl"] as const) {
    const bare: ActionId[] = [];
    const withMod: ActionId[] = [];
    for (const id of ACTION_IDS) {
      const c = bindings[id];
      if (isUnbound(c)) continue;
      if (isBareModifierKey(c, kind)) bare.push(id);
      else if (chordUsesModifier(c, kind)) withMod.push(id);
    }
    if (bare.length > 0 && withMod.length > 0) {
      for (const id of bare) bad.add(id);
      for (const id of withMod) bad.add(id);
    }
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
    Mouse0: "Mouse Left",
    Mouse1: "Mouse Middle",
    Mouse2: "Mouse Right",
    Mouse3: "Mouse Back",
    Mouse4: "Mouse Forward",
  };
  if (named[code]) return named[code];
  if (isMouseCode(code)) return `Mouse ${code.slice(5)}`;
  if (code.startsWith("Key") && code.length === 4) return code.slice(3);
  if (code.startsWith("Digit") && code.length === 6) return code.slice(5);
  if (code.startsWith("Numpad")) return "Num" + code.slice(6);
  return code;
}

export function formatChord(c: Chord): string {
  if (isUnbound(c)) return "—";
  const parts: string[] = [];
  if (c.ctrl) parts.push("Ctrl");
  if (c.alt) parts.push("Opt");
  if (c.shift) parts.push("Shift");
  parts.push(formatCode(c.code));
  return parts.join("-");
}

/** Compact label for the HUD hint strip. */
export function formatChordShort(c: Chord): string {
  if (isUnbound(c)) return "";
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

/**
 * Build a chord from a mouse button press. Modifiers held at click time are
 * part of the chord (Opt-Mouse Right, etc.), same as keyboard.
 */
export function chordFromMouseEvent(e: MouseEvent): Chord {
  const out: Chord = { code: `Mouse${e.button}` };
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

/**
 * Whether any live action is bound to the bare modifier key. When true, that
 * modifier is an action of its own (e.g. aim-cursor on Shift), so holding it
 * must not force every other binding into a "Shift+…" chord.
 */
function bareModifierBound(kind: ModifierKind): boolean {
  for (const id of ACTION_IDS) {
    if (isBareModifierKey(live[id], kind)) return true;
  }
  return false;
}

/**
 * Chord modifier gates. Plain KeyJ requires Shift up — unless bare Shift is
 * itself a binding, in which case Shift is free to be held for that action
 * while J, Space, etc. still fire. Chords that *require* Shift still need it.
 */
function modsMatch(
  input: Pick<Input, "altDown" | "shiftDown" | "ctrlDown">,
  c: Chord,
): boolean {
  const isCtrl = c.code === "ControlLeft" || c.code === "ControlRight";
  const isAlt = c.code === "AltLeft" || c.code === "AltRight";
  const isShift = c.code === "ShiftLeft" || c.code === "ShiftRight";

  if (!isAlt) {
    if (c.alt) {
      if (!input.altDown) return false;
    } else if (input.altDown && !bareModifierBound("alt")) {
      return false;
    }
  }
  if (!isShift) {
    if (c.shift) {
      if (!input.shiftDown) return false;
    } else if (input.shiftDown && !bareModifierBound("shift")) {
      return false;
    }
  }
  if (!isCtrl) {
    if (c.ctrl) {
      if (!input.ctrlDown) return false;
    } else if (input.ctrlDown && !bareModifierBound("ctrl")) {
      return false;
    }
  }
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

/** True when this action has a real key assigned (not Classic's empty slot). */
export function isActionBound(id: ActionId): boolean {
  return !isUnbound(getBinding(id));
}

export function actionDown(input: Input, id: ActionId): boolean {
  const c = getBinding(id);
  if (isUnbound(c)) return false;
  if (!modsMatch(input, c)) return false;
  return codesFor(c).some((code) => input.isDown(code));
}

export function actionConsume(input: Input, id: ActionId): boolean {
  const c = getBinding(id);
  if (isUnbound(c)) return false;
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

