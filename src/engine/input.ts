export class Input {
  private keys = new Set<string>();
  private pressed = new Set<string>();

  constructor() {
    window.addEventListener("keydown", (e) => {
      // Don't steal keys while typing in the landed UI (no inputs yet, but safe)
      if ((e.target as HTMLElement)?.tagName === "INPUT") return;
      if (!e.repeat) this.pressed.add(e.code);
      this.keys.add(e.code);
      // stop the browser acting on the keys the game uses
      if (
        [
          "ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight",
          "Space", "Tab", "Backquote", "ControlLeft", "ControlRight",
          "Backslash",
        ].includes(e.code)
      ) {
        e.preventDefault();
      }
    });
    window.addEventListener("keyup", (e) => this.keys.delete(e.code));
    window.addEventListener("blur", () => {
      this.keys.clear();
      this.pressed.clear();
    });
  }

  isDown(code: string): boolean {
    return this.keys.has(code);
  }

  /** Either Alt/Option key, for Nova's Alt-modified commands. */
  get altDown(): boolean {
    return this.keys.has("AltLeft") || this.keys.has("AltRight");
  }

  /** Either Shift key. */
  get shiftDown(): boolean {
    return this.keys.has("ShiftLeft") || this.keys.has("ShiftRight");
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
