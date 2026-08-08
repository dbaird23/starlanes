/**
 * Keyboard + mouse button state for flight controls.
 * Mouse buttons share the same code namespace as keys: Mouse0…Mouse4
 * (DOM button indices: 0 left, 1 middle, 2 right, 3 back, 4 forward).
 */
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

    window.addEventListener("mousedown", (e) => {
      if ((e.target as HTMLElement)?.tagName === "INPUT") return;
      const code = mouseButtonCode(e.button);
      this.pressed.add(code);
      this.keys.add(code);
      // Right button is a bindable flight control; don't let the browser
      // claim it (context menu / default actions).
      if (e.button === 2) e.preventDefault();
    });
    window.addEventListener("mouseup", (e) => {
      this.keys.delete(mouseButtonCode(e.button));
      if (e.button === 2) e.preventDefault();
    });
    /*
     * Suppress the browser context menu everywhere except text fields so
     * Mouse Right can be bound and held reliably (canvas, HUD, title, etc.).
     */
    window.addEventListener(
      "contextmenu",
      (e) => {
        const tag = (e.target as HTMLElement | null)?.tagName;
        if (tag === "INPUT" || tag === "TEXTAREA") return;
        e.preventDefault();
      },
      true,
    );
    // Lost buttons when the pointer leaves the window mid-drag
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

  /** true once per physical key / mouse-button press */
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

/** DOM MouseEvent.button → binding code. */
export function mouseButtonCode(button: number): string {
  return `Mouse${button}`;
}
