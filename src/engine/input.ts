export class Input {
  private keys = new Set<string>();
  private pressed = new Set<string>();
  /**
   * Nova's Caps Lock 2× clock. Browsers only expose the lock via
   * `getModifierState` on keyboard events, so we refresh on every key
   * event (including CapsLock itself).
   */
  private capsLockOn = false;

  constructor() {
    const trackLock = (e: KeyboardEvent) => {
      try {
        this.capsLockOn = e.getModifierState("CapsLock");
      } catch {
        // some synthetic events lack getModifierState
      }
    };
    window.addEventListener("keydown", (e) => {
      trackLock(e);
      // Don't steal keys while typing in the landed UI (no inputs yet, but safe)
      if ((e.target as HTMLElement)?.tagName === "INPUT") return;
      if (!e.repeat) this.pressed.add(e.code);
      this.keys.add(e.code);
      // stop the browser acting on the keys the game uses
      if (
        [
          "ArrowUp",
          "ArrowDown",
          "ArrowLeft",
          "ArrowRight",
          "Space",
          "Tab",
          "Backquote",
          "ControlLeft",
          "ControlRight",
          "Backslash",
        ].includes(e.code)
      ) {
        e.preventDefault();
      }
    });
    window.addEventListener("keyup", (e) => {
      trackLock(e);
      this.keys.delete(e.code);
    });
    window.addEventListener("blur", () => {
      this.keys.clear();
      this.pressed.clear();
      // leave capsLockOn as last known — still correct until the next key
    });
  }

  isDown(code: string): boolean {
    return this.keys.has(code);
  }

  /** Caps Lock engaged — Nova runs the sim at double speed while this is on. */
  get capsLock(): boolean {
    return this.capsLockOn;
  }

  /** Either Alt/Option key, for Nova's Alt-modified commands. */
  get altDown(): boolean {
    return this.keys.has("AltLeft") || this.keys.has("AltRight");
  }

  /** Either Shift key. */
  get shiftDown(): boolean {
    return this.keys.has("ShiftLeft") || this.keys.has("ShiftRight");
  }

  /** Either Control key (secondary fire, and chord modifiers). */
  get ctrlDown(): boolean {
    return this.keys.has("ControlLeft") || this.keys.has("ControlRight");
  }

  /** true once per physical key press */
  consume(code: string): boolean {
    if (this.pressed.has(code)) {
      this.pressed.delete(code);
      return true;
    }
    return false;
  }

  endFrame(): void {
    this.pressed.clear();
  }
}
