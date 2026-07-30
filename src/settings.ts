/**
 * Player preferences that live outside any pilot file — volume-style, global
 * to the browser. Keep this small; pilot-specific state still goes in
 * localStorage under the pilot keys.
 */

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
}

const DEFAULTS: Settings = {
  capsLockFastWhen: "on",
};

function parseFastWhen(v: unknown): CapsLockFastWhen {
  return v === "off" ? "off" : "on";
}

function load(): Settings {
  try {
    const raw = JSON.parse(
      localStorage.getItem(KEY) ?? "null",
    ) as Partial<Settings> | null;
    if (!raw || typeof raw !== "object") return { ...DEFAULTS };
    return {
      capsLockFastWhen: parseFastWhen(raw.capsLockFastWhen),
    };
  } catch {
    return { ...DEFAULTS };
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
