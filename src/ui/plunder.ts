import { COMMODITIES } from "../data/universe";
import { playMenuClose, playMenuOpen } from "../engine/audio";

/**
 * Nova's plunder dialog. Boarding a crippled ship doesn't hand you the loot —
 * it opens a manifest and freezes the flight sim while you take one thing at a
 * time, with the odds of storming the ship printed alongside. Each button
 * greys out once that hold is empty or you have nowhere to put it.
 */

export interface PlunderHold {
  /** credits aboard */
  credits: number;
  /** commodity id -> tons in the hold */
  cargo: Record<string, number>;
  /** weapon id -> rounds you could carry off */
  ammo: Record<string, number>;
  /** jumps' worth of fuel in their tanks */
  energy: number;
}

/**
 * What happened when you sent the boarding party across. A prize taken is not
 * the end of it: Nova asks whether you want to fly her yourself or add her to
 * your wing, and the shïp resource carries both halves of that choice —
 * OnRetire fires "when you sell a ship of this type and/or replace it with a
 * captured ship", and EscSellValue is what "a captured escort" fetches later.
 */
export type CaptureResult =
  | { taken: false; note: string }
  | { taken: true; prize: string; yourShip: string; roomInWing: boolean };

export interface PlunderContext {
  shipName: string;
  hold: PlunderHold;
  /** 0-1, or null when this ship cannot be taken at all */
  captureOdds: number | null;
  /** free tons in your own hold */
  freeCargo: number;
  take: (what: "credits" | "cargo" | "ammo" | "energy") => { note: string; shipLost: boolean };
  capture: () => CaptureResult;
  /** settle a taken prize: fly her, or send her to the wing */
  claim: (choice: "flagship" | "escort") => void;
  close: () => void;
}

export class PlunderUi {
  private root: HTMLElement;
  private ctx: PlunderContext | null = null;
  private note = "";
  /** set once a prize is taken, while the player decides what to do with her */
  private prize: Extract<CaptureResult, { taken: true }> | null = null;

  constructor() {
    this.root = document.getElementById("plunder-ui")!;
  }

  get open(): boolean {
    return this.ctx !== null;
  }

  show(ctx: PlunderContext): void {
    const wasOpen = this.ctx !== null;
    this.ctx = ctx;
    this.note = "";
    this.prize = null;
    this.root.classList.remove("hidden");
    if (!wasOpen) playMenuOpen();
    this.render();
  }

  close(): void {
    if (this.ctx === null) return;
    this.ctx = null;
    this.prize = null;
    this.root.classList.add("hidden");
    this.root.innerHTML = "";
    playMenuClose();
  }

  /** Esc / abort: run the context close hook, then hide the panel. */
  dismiss(): void {
    if (this.ctx === null) return;
    const c = this.ctx;
    this.close();
    c.close();
  }

  private render(): void {
    const c = this.ctx;
    if (!c) return;
    if (this.prize) {
      this.renderPrize(c, this.prize);
      return;
    }
    const h = c.hold;

    const cargoTons = Object.values(h.cargo).reduce((a, b) => a + b, 0);
    const cargoLabel = cargoTons
      ? Object.entries(h.cargo)
          .map(
            ([id, t]) =>
              `${t}t ${COMMODITIES.find((c2) => c2.id === id)?.name ?? id}`,
          )
          .join(", ")
      : "None";
    const ammoRounds = Object.values(h.ammo).reduce((a, b) => a + b, 0);

    const odds =
      c.captureOdds === null
        ? '<span class="pl-dim">cannot be taken</span>'
        : `${Math.round(c.captureOdds * 100)}%`;

    const row = (label: string, value: string) =>
      `<div><span>${label}</span><b>${value}</b></div>`;

    this.root.innerHTML = `
      <div class="plunder">
        <div class="pl-head">Select what to plunder from this ship:</div>
        <div class="pl-manifest">
          ${row("Cargo:", cargoLabel)}
          ${row("Credits:", h.credits ? h.credits.toLocaleString() : "None")}
          ${row("Ammo:", ammoRounds ? String(ammoRounds) : "None")}
          ${row("Energy:", h.energy ? String(h.energy) : "None")}
          <div class="pl-odds"><span>Capture Odds:</span><b>${odds}</b></div>
        </div>
        ${this.note ? `<div class="pl-note">${this.note}</div>` : ""}
        <div class="pl-buttons">
          <button class="portbtn" data-take="energy" ${h.energy ? "" : "disabled"}>Energy</button>
          <button class="portbtn" data-take="cargo" ${
            cargoTons && c.freeCargo > 0 ? "" : "disabled"
          }>Cargo</button>
          <button class="portbtn" data-take="ammo" ${ammoRounds ? "" : "disabled"}>Ammo</button>
          <button class="portbtn" data-take="credits" ${h.credits ? "" : "disabled"}>Credits</button>
          <button class="portbtn" id="pl-capture" ${
            c.captureOdds === null ? "disabled" : ""
          }>Capture Ship</button>
          <button class="portbtn" id="pl-abort">Abort</button>
        </div>
      </div>`;

    this.root
      .querySelectorAll<HTMLButtonElement>("button[data-take]")
      .forEach((btn) => {
        btn.addEventListener("click", () => {
          const result = c.take(
            btn.dataset.take as "credits" | "cargo" | "ammo" | "energy",
          );
          if (result.shipLost) {
            c.close();
            this.close();
            return;
          }
          this.note = result.note;
          this.render();
        });
      });
    this.root.querySelector("#pl-capture")?.addEventListener("click", () => {
      const result = c.capture();
      if (!result.taken) {
        // Boarding is over (ejected or exploded) — close the panel.
        c.close();
        this.close();
        return;
      }
      this.prize = result;
      this.render();
    });
    this.root.querySelector("#pl-abort")!.addEventListener("click", () => {
      c.close();
      this.close();
    });
  }

  /** The prize is yours — fly her, or put her in the wing. */
  private renderPrize(
    c: PlunderContext,
    p: Extract<CaptureResult, { taken: true }>,
  ): void {
    this.root.innerHTML = `
      <div class="plunder">
        <div class="pl-head">Your boarding party has taken the ${escapeHtml(p.prize)}.</div>
        <div class="pl-manifest">
          <div><span>Prize:</span><b>${escapeHtml(p.prize)}</b></div>
          <div><span>Your ship:</span><b>${escapeHtml(p.yourShip)}</b></div>
        </div>
        <div class="pl-note">${
          p.roomInWing
            ? `Take the helm of the ${escapeHtml(p.prize)} and your ${escapeHtml(
                p.yourShip,
              )} will fly as your escort.`
            : `Your command is full, so taking the helm means abandoning your ${escapeHtml(
                p.yourShip,
              )}.`
        }</div>
        <div class="pl-buttons">
          <button class="portbtn" id="pl-flag">Make It My Ship</button>
          <button class="portbtn" id="pl-esc" ${p.roomInWing ? "" : "disabled"}>Add To My Fleet</button>
        </div>
      </div>`;
    this.root.querySelector("#pl-flag")!.addEventListener("click", () => {
      c.claim("flagship");
      this.close();
    });
    this.root.querySelector("#pl-esc")?.addEventListener("click", () => {
      c.claim("escort");
      this.close();
    });
  }
}

function escapeHtml(s: string): string {
  return s.replace(
    /[&<>"']/g,
    (ch) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        ch
      ] as string,
  );
}
