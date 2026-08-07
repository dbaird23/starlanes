/**
 * Player preferences that live outside any pilot file — volume-style, global
 * to the browser. Keep this small; pilot-specific state still goes in
 * localStorage under the pilot keys.
 */

import {
  cloneBindings,
  DEFAULT_BINDINGS,
  normalizeBindings,
  setLiveBindings,
  type ActionId,
  type Chord,
} from "./keybindings";

const KEY = "starlanes.settings";

/** Hardware Caps Lock state that should run the sim at 2×. */
export type CapsLockFastWhen = "on" | "off";

export interface Settings {
  /**
   * Which Caps Lock state means "fast". Caps Lock always toggles speed; this
   * only picks the polarity. Default `"on"` is Nova's classic (lock on → 2×).
   * Choose `"off"` if you leave Caps Lock on for typing and want normal speed
   * while typing / double speed with Caps Lock released.
   */
  capsLockFastWhen: CapsLockFastWhen;
  /** Flight key chords; missing actions fall back to Nova defaults. */
  keybindings: Record<ActionId, Chord>;
}

const DEFAULTS: Settings = {
  capsLockFastWhen: "on",
  keybindings: cloneBindings(DEFAULT_BINDINGS),
};

function parseFastWhen(v: unknown): CapsLockFastWhen {
  return v === "off" ? "off" : "on";
}

function load(): Settings {
  try {
    const raw = JSON.parse(
      localStorage.getItem(KEY) ?? "null",
    ) as Partial<Settings> | null;
    if (!raw || typeof raw !== "object") return { ...DEFAULTS, keybindings: cloneBindings() };
    return {
      capsLockFastWhen: parseFastWhen(raw.capsLockFastWhen),
      keybindings: normalizeBindings(raw.keybindings),
    };
  } catch {
    return { ...DEFAULTS, keybindings: cloneBindings() };
  }
}

function persist(s: Settings): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(s));
  } catch {
    /* private mode: preference just won't survive a reload */
  }
}

let current = load();
setLiveBindings(current.keybindings);

export function getSettings(): Readonly<Settings> {
  return current;
}

/** Which Caps Lock hardware state should run the sim at 2×. */
export function capsLockFastWhen(): CapsLockFastWhen {
  return current.capsLockFastWhen;
}

export function setCapsLockFastWhen(when: CapsLockFastWhen): void {
  if (current.capsLockFastWhen === when) return;
  current = { ...current, capsLockFastWhen: when };
  persist(current);
}

/**
 * Given the current Caps Lock hardware state, should the sim run at 2×?
 * Always a function of Caps Lock; the preference only chooses polarity.
 */
export function simFastForCapsLock(capsOn: boolean): boolean {
  return current.capsLockFastWhen === "on" ? capsOn : !capsOn;
}

export function getKeybindings(): Readonly<Record<ActionId, Chord>> {
  return current.keybindings;
}

/** Replace all flight keybindings and persist. Caller must ensure no collisions. */
export function setKeybindings(bindings: Record<ActionId, Chord>): void {
  current = {
    ...current,
    keybindings: cloneBindings(bindings),
  };
  setLiveBindings(current.keybindings);
  persist(current);
}
