import { COMMODITIES } from "../data/universe";

/**
 * Nova's plunder dialog. Boarding a crippled ship doesn't hand you the loot —
 * it opens a manifest and lets you take one thing at a time, with the odds of
 * storming the ship outright printed alongside. Each button greys out once
 * that hold is empty or you have nowhere to put it.
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

export interface PlunderContext {
  shipName: string;
  hold: PlunderHold;
  /** 0-1, or null when this ship cannot be taken at all */
  captureOdds: number | null;
  /** free tons in your own hold */
  freeCargo: number;
  take: (what: "credits" | "cargo" | "ammo" | "energy") => string;
  capture: () => void;
  close: () => void;
}

export class PlunderUi {
  private root: HTMLElement;
  private ctx: PlunderContext | null = null;
  private note = "";

  constructor() {
    this.root = document.getElementById("plunder-ui")!;
  }

  get open(): boolean {
    return this.ctx !== null;
  }

  show(ctx: PlunderContext): void {
    this.ctx = ctx;
    this.note = "";
    this.root.classList.remove("hidden");
    this.render();
  }

  close(): void {
    this.ctx = null;
    this.root.classList.add("hidden");
    this.root.innerHTML = "";
  }

  private render(): void {
    const c = this.ctx;
    if (!c) return;
    const h = c.hold;

    const cargoTons = Object.values(h.cargo).reduce((a, b) => a + b, 0);
    const cargoLabel = cargoTons
      ? Object.entries(h.cargo)
          .map(([id, t]) => `${t}t ${COMMODITIES.find((c2) => c2.id === id)?.name ?? id}`)
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

    this.root.querySelectorAll<HTMLButtonElement>("button[data-take]").forEach((btn) => {
      btn.addEventListener("click", () => {
        this.note = c.take(btn.dataset.take as "credits" | "cargo" | "ammo" | "energy");
        this.render();
      });
    });
    this.root.querySelector("#pl-capture")?.addEventListener("click", () => {
      c.capture();
      this.close();
    });
    this.root.querySelector("#pl-abort")!.addEventListener("click", () => {
      c.close();
      this.close();
    });
  }
}
