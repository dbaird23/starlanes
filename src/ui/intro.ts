/**
 * The chär opening sequence: the pictures and text a scenario shows when a
 * brand-new pilot is created.
 *
 * The Bible calls PictDelay "the maximum delay time to display each of the
 * four above pictures, in seconds" — a maximum, so a click or a key advances
 * early. IntroTextID is a dësc shown after the pictures; the shipped ".Trader"
 * template sets it to -1 and runs three PICTs at 45 seconds each.
 */
import { getPict } from "../engine/sprites";
import type { PictInfo } from "../data/universe";

export class IntroUi {
  private root: HTMLElement;
  private timer: number | null = null;
  private onDone: (() => void) | null = null;
  private queue: { pict?: PictInfo; text?: string; seconds: number }[] = [];

  constructor() {
    this.root = document.getElementById("intro-ui")!;
    // any click advances; the sequence is a formality, not a puzzle
    this.root.addEventListener("click", () => this.advance());
    window.addEventListener("keydown", (e) => {
      if (!this.root.classList.contains("hidden")) {
        e.preventDefault();
        this.advance();
      }
    });
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
    this.onDone = done;
    this.root.classList.remove("hidden");
    this.step();
    return true;
  }

  private step(): void {
    const item = this.queue.shift();
    if (!item) return this.finish();
    this.root.innerHTML = item.pict
      ? `<div class="intro-stage"><img src="/nova/picts/${item.pict.file}" alt=""></div>`
      : `<div class="intro-stage"><div class="intro-text">${item.text!
          .split("\n")
          .map((line) => `<p>${line}</p>`)
          .join("")}</div></div>`;
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
    this.root.classList.add("hidden");
    this.root.innerHTML = "";
    const done = this.onDone;
    this.onDone = null;
    done?.();
  }
}
