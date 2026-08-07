/**
 * The chär opening sequence: the pictures and text a scenario shows when a
 * brand-new pilot is created.
 *
 * The Bible calls PictDelay "the maximum delay time to display each of the
 * four above pictures, in seconds" — a maximum, so a click or a key advances
 * early. IntroTextID is a dësc shown after the pictures; the shipped ".Trader"
 * template sets it to -1 and runs three PICTs at 45 seconds each.
 */
import { asset } from "../asset";
import { getPict } from "../engine/sprites";
import type { PictInfo } from "../data/universe";

export class IntroUi {
  private root: HTMLElement;
  private timer: number | null = null;
  private onDone: (() => void) | null = null;
  private queue: { pict?: PictInfo; text?: string; seconds: number }[] = [];
  /** page counter for the footer: how many items the sequence started with */
  private total = 0;
  private shown = 0;

  constructor() {
    this.root = document.getElementById("intro-ui")!;
    // any click advances; the sequence is a formality, not a puzzle
    this.root.addEventListener("click", () => this.advance());
    /*
     * Capture on `window`, so the key is swallowed before it reaches the
     * game: the sequence plays over a system that is already set up and
     * flying, and `Input` also listens on window. Stopping propagation here
     * keeps Space from firing a weapon behind the picture.
     */
    window.addEventListener(
      "keydown",
      (e) => {
        if (!this.active) return;
        e.preventDefault();
        e.stopPropagation();
        if (e.key === "Escape") this.finish();
        else this.advance();
      },
      true,
    );
  }

  get active(): boolean {
    return !this.root.classList.contains("hidden");
  }

  /** Play the sequence, then call `done`. Returns false if there is nothing to show. */
  show(
    picts: PictInfo[],
    delays: number[],
    introText: string,
    done: () => void,
  ): boolean {
    this.queue = picts.map((pict, i) => ({
      pict,
      // a missing or absurd delay still has to end; the Bible's own values are 45
      seconds: Math.max(1, Math.min(60, delays[i] ?? 5)),
    }));
    if (introText) this.queue.push({ text: introText, seconds: 60 });
    if (!this.queue.length) return false;
    this.total = this.queue.length;
    this.shown = 0;
    this.onDone = done;
    this.root.classList.remove("hidden");
    this.step();
    return true;
  }

  private step(): void {
    const item = this.queue.shift();
    if (!item) return this.finish();
    this.shown++;
    const body = item.pict
      ? `<img src="${asset(`nova/picts/${item.pict.file}`)}" alt="">`
      : `<div class="intro-text">${item
          .text!.split("\n")
          .map((line) => `<p>${line}</p>`)
          .join("")}</div>`;
    this.root.innerHTML = `<div class="intro-stage">${body}<div class="intro-foot">
        <span>${this.shown} / ${this.total}</span>
        <span class="intro-hint">click or press space to continue · esc to skip</span>
      </div></div>`;
    // preloading the next picture keeps the cut from flashing white
    if (this.queue[0]?.pict) getPict(this.queue[0].pict.file);
    this.clearTimer();
    this.timer = window.setTimeout(() => this.step(), item.seconds * 1000);
  }

  private advance(): void {
    if (!this.active) return;
    this.clearTimer();
    this.step();
  }

  private clearTimer(): void {
    if (this.timer !== null) window.clearTimeout(this.timer);
    this.timer = null;
  }

  private finish(): void {
    this.clearTimer();
    this.queue = [];
    this.root.classList.add("hidden");
    this.root.innerHTML = "";
    const done = this.onDone;
    this.onDone = null;
    done?.();
  }
}
