/**
 * The in-flight information panels: Nova's player info (P), mission info (I)
 * and the jettison dialog (Alt-K). Opening any of them freezes the flight sim
 * (see Game.flightOverlayOpen); Esc or Close dismisses the panel.
 */

import { playMenuClose, playMenuOpen } from "../engine/audio";

export interface InfoRow {
  label: string;
  value: string;
}

export interface InfoSection {
  title: string;
  rows: InfoRow[];
  /** free text shown under the rows, already escaped */
  note?: string;
}

export interface JettisonEntry {
  id: string;
  name: string;
  tons: number;
}

export interface InfoContext {
  title: string;
  /**
   * Pass a function when the panel's own buttons change what it reports — the
   * jettison dialog's tonnage, for instance — so a re-render re-reads it
   * instead of showing the figures the panel opened with.
   */
  sections: InfoSection[] | (() => InfoSection[]);
  /**
   * When present, the hold is listed with Dump buttons. Re-read on every
   * render rather than passed as a snapshot, so tonnages fall as you dump.
   */
  jettison?: () => JettisonEntry[];
  onJettison?: (commodityId: string, qty: number) => void;
  close: () => void;
}

export class InfoUi {
  private root: HTMLElement;
  private ctx: InfoContext | null = null;

  constructor() {
    this.root = document.getElementById("info-ui")!;
  }

  get open(): boolean {
    return this.ctx !== null;
  }

  show(ctx: InfoContext): void {
    const wasOpen = this.ctx !== null;
    this.ctx = ctx;
    this.root.classList.remove("hidden");
    if (!wasOpen) playMenuOpen();
    this.render();
  }

  close(): void {
    if (this.ctx === null) return;
    this.ctx = null;
    this.root.classList.add("hidden");
    this.root.innerHTML = "";
    playMenuClose();
  }

  private render(): void {
    const c = this.ctx;
    if (!c) return;

    const sections = (
      typeof c.sections === "function" ? c.sections() : c.sections
    )
      .map(
        (s) => `
        <div class="if-section">
          <div class="if-title">${esc(s.title)}</div>
          ${s.rows
            .map(
              (r) =>
                `<div class="if-row"><span>${esc(r.label)}</span><b>${esc(r.value)}</b></div>`,
            )
            .join("")}
          ${s.note ? `<div class="if-note">${esc(s.note)}</div>` : ""}
        </div>`,
      )
      .join("");

    const hold = c.jettison?.() ?? null;
    const jettison = hold?.length
      ? `<div class="if-section">
          <div class="if-title">Jettison cargo</div>
          ${hold
            .map(
              (j) => `<div class="if-jrow">
                <span>${esc(j.name)}</span>
                <b>${j.tons}t</b>
                <button class="portbtn" data-dump="${esc(j.id)}" data-qty="1">Dump 1</button>
                <button class="portbtn" data-dump="${esc(j.id)}" data-qty="${j.tons}">All</button>
              </div>`,
            )
            .join("")}
        </div>`
      : hold
        ? '<div class="if-section"><div class="if-note">Your hold is empty.</div></div>'
        : "";

    this.root.innerHTML = `
      <div class="infopanel">
        <div class="if-head">${esc(c.title)}</div>
        ${sections}
        ${jettison}
        <div class="if-buttons"><button class="portbtn" id="if-close">Close</button></div>
      </div>`;

    this.root
      .querySelectorAll<HTMLButtonElement>("button[data-dump]")
      .forEach((btn) => {
        btn.addEventListener("click", () => {
          c.onJettison?.(btn.dataset.dump!, parseInt(btn.dataset.qty!, 10));
          this.render();
        });
      });
    this.root.querySelector("#if-close")!.addEventListener("click", () => {
      c.close();
      this.close();
    });
  }
}

/** Ship, outfit and world names come from the data files; never trust them. */
function esc(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}
