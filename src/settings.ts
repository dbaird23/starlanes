/**
 * Player preferences that live outside any pilot file — volume-style, global
 * to the browser. Keep this small; pilot-specific state still goes in
 * localStorage under the pilot keys.
 */

import {
  cloneBindings,
  DEFAULT_BINDINGS,
  DEFAULT_PRESET_ID,
  matchPresetId,
  normalizeBindings,
  resolvePresetId,
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
  /**
   * Last named preset the player loaded or matched. When keybindings diverge
   * from every preset, Preferences labels the select "Custom (…)" using this.
   */
  keybindingBasePreset: string;
}

const DEFAULTS: Settings = {
  capsLockFastWhen: "on",
  keybindings: cloneBindings(DEFAULT_BINDINGS),
  keybindingBasePreset: DEFAULT_PRESET_ID,
};

function parseFastWhen(v: unknown): CapsLockFastWhen {
  return v === "off" ? "off" : "on";
}

function load(): Settings {
  try {
    const raw = JSON.parse(
      localStorage.getItem(KEY) ?? "null",
    ) as Partial<Settings> | null;
    if (!raw || typeof raw !== "object") {
      return {
        ...DEFAULTS,
        keybindings: cloneBindings(),
      };
    }
    const keybindings = normalizeBindings(raw.keybindings);
    // Prefer an exact match; otherwise keep the stored branch parent.
    const matched = matchPresetId(keybindings);
    return {
      capsLockFastWhen: parseFastWhen(raw.capsLockFastWhen),
      keybindings,
      keybindingBasePreset: resolvePresetId(
        matched ?? raw.keybindingBasePreset ?? DEFAULT_PRESET_ID,
      ),
    };
  } catch {
    return {
      ...DEFAULTS,
      keybindings: cloneBindings(),
    };
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

export function getKeybindingBasePreset(): string {
  return current.keybindingBasePreset;
}

/**
 * Replace flight keybindings and remember which named preset they came from
 * (exact match, or the branch parent for a custom mix). Caller ensures no collisions.
 */
export function setKeybindings(
  bindings: Record<ActionId, Chord>,
  basePresetId?: string,
): void {
  const matched = matchPresetId(bindings);
  const base = resolvePresetId(
    matched ?? basePresetId ?? current.keybindingBasePreset,
  );
  current = {
    ...current,
    keybindings: cloneBindings(bindings),
    keybindingBasePreset: base,
  };
  setLiveBindings(current.keybindings);
  persist(current);
}
