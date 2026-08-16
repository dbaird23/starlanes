import { asset } from "../asset";
import {
  GOVT_COMM_NAMES,
  SHIPS,
  personPict,
  shipyardPict,
  type PictInfo,
} from "../data/universe";
import { playMenuClose, playMenuOpen } from "../engine/audio";
import type { Game } from "../game/game";
import type { NpcShip } from "../game/ship";
import type { PlanetDef } from "../types";

export interface HailOption {
  label: string;
  /**
   * Return a string to update the reply and re-render.
   * Return null when the action already called showPlanet (negotiation steps)
   * so the handler neither closes nor double-renders.
   * Return void to close the channel.
   */
  action: () => string | null | void;
}

/**
 * Communications panel for a hailed ship or world. Opening it freezes the
 * flight sim (see Game.flightOverlayOpen) until the channel is closed.
 */
export class HailUi {
  private root: HTMLElement;
  private game: Game;
  private target: NpcShip | null = null;
  private planet: PlanetDef | null = null;
  private planetOptions: HailOption[] = [];
  /** Non-null while a ship-side negotiation (e.g. fuel barter) is in progress. */
  private shipNegOptions: HailOption[] | null = null;
  private currentOptions: HailOption[] = [];
  private reply = "";

  constructor(game: Game) {
    this.game = game;
    this.root = document.getElementById("hail-ui")!;
  }

  get open(): boolean {
    return this.target !== null || this.planet !== null;
  }

  show(target: NpcShip, greeting: string): void {
    const wasOpen = this.open;
    this.target = target;
    this.planet = null;
    this.shipNegOptions = null; // clear any stale negotiation state
    this.reply = greeting;
    this.root.classList.remove("hidden");
    if (!wasOpen) playMenuOpen();
    this.render();
  }

  /**
   * Switch the open ship hail into a negotiation sub-screen (e.g. fuel barter).
   * Uses the ship's own picture and class line but replaces the dynamic option
   * list with the supplied static options — same pattern as showPlanet.
   */
  showShipNegotiation(
    target: NpcShip,
    greeting: string,
    options: HailOption[],
  ): void {
    const wasOpen = this.open;
    this.target = target;
    this.planet = null;
    this.shipNegOptions = options;
    this.reply = greeting;
    this.root.classList.remove("hidden");
    if (!wasOpen) playMenuOpen();
    this.render();
  }

  /** Comms with a world's traffic control. */
  showPlanet(planet: PlanetDef, greeting: string, options: HailOption[]): void {
    const wasOpen = this.open;
    this.planet = planet;
    this.target = null;
    this.planetOptions = options;
    this.reply = greeting;
    this.root.classList.remove("hidden");
    if (!wasOpen) playMenuOpen();
    this.render();
  }

  close(): void {
    if (!this.open) return;
    this.target = null;
    this.planet = null;
    this.planetOptions = [];
    this.shipNegOptions = null;
    this.root.classList.add("hidden");
    this.root.innerHTML = "";
    playMenuClose();
  }

  handleKey(code: string): void {
    const letter = code.startsWith("Key") ? code.slice(3).toLowerCase() : null;
    if (!letter) return;
    const matches: Record<string, (label: string) => boolean> = {
      g: (l) => l.startsWith("g"),
      o: (l) => l.startsWith("o"),
      a: (l) => l.startsWith("a"),
      l: (l) => l.startsWith("l"),
      d: (l) => l.startsWith("d") || l.startsWith("release"),
    };
    const test = matches[letter];
    if (!test) return;
    const opt = this.currentOptions.find((o) => test(o.label.toLowerCase()));
    if (!opt) return;
    const result = opt.action();
    if (typeof result === "string") {
      this.reply = result;
      this.render();
    } else if (result !== null) {
      this.close();
    }
  }

  private render(): void {
    const t = this.target;
    const p = this.planet;
    if (!t && !p) return;

    // Nova's comms panel: the reply up top, a Class/Status readout beneath
    // it, the channel's options down the left, and a picture of whoever
    // you're talking to filling the right half.
    let className: string;
    let status: { text: string; tone: string };
    let pict: PictInfo | null = null;
    if (p) {
      className = `${p.name} (traffic control)`;
      status = {
        text: p.uninhabited ? "Unmanned" : "Standing by",
        tone: "plain",
      };
    } else {
      const type = t!.typeId ? SHIPS[t!.typeId] : undefined;
      const hull = type?.name.split(";")[0] ?? "Unknown ship";
      // gövt CommName is the short label Nova puts beside the hull here —
      // "Trader" for the Civvies, "Fed." for the Federation — not the full
      // government name the target display uses.
      const comm =
        t!.govtId >= 128 ? (GOVT_COMM_NAMES[String(t!.govtId)] ?? "") : "";
      const govt = comm || this.game.govtLabel(t!.govtId);
      className = govt ? `${hull} (${govt})` : hull;
      // a named captain's ship answers under its own name — the Night-Master
      // rather than "Lightning" — with the hull kept as the class line. A
      // mission ship's name is already the panel's title (there is no captain
      // above it), so prefixing it here would print it twice.
      if (t!.shipName && t!.personId !== null)
        className = `${t!.shipName} — ${className}`;
      status = this.game.hailStatus(t!);
      // a named captain with a portrait answers with their face, not their hull
      pict = personPict(t!.personId);
      if (!pict && t!.typeId) pict = shipyardPict(t!.typeId);
    }
    const title = p ? p.name : this.game.hailLabel(t!);
    const options = p
      ? this.planetOptions
      : this.shipNegOptions ?? this.game.hailOptions(t!);
    this.currentOptions = options;

    this.root.innerHTML = `
      <div class="comms">
        <div class="comms-left">
          <div class="comms-reply">${this.reply}</div>
          <div class="comms-info">
            <div><span>Class:</span><b>${escapeHtml(className)}</b></div>
            <div><span>Status:</span><b class="tone-${status.tone}">${status.text}</b></div>
          </div>
          <div class="comms-opts">
            ${options
              .map(
                (o, i) =>
                  `<button class="portbtn" data-opt="${i}">${o.label}</button>`,
              )
              .join("")}
            <button class="portbtn" id="hail-close">Close Channel</button>
          </div>
        </div>
        <div class="comms-pic">
          ${
            pict
              ? `<img src="${asset(`nova/picts/${pict.file}`)}" alt="${escapeHtml(title)}">`
              : `<div class="comms-noPic">${escapeHtml(title)}</div>`
          }
        </div>
      </div>`;

    this.root
      .querySelector("#hail-close")!
      .addEventListener("click", () => this.close());
    this.root.querySelectorAll("button[data-opt]").forEach((btn) => {
      btn.addEventListener("click", () => {
        const idx = parseInt((btn as HTMLButtonElement).dataset.opt!, 10);
        const result = options[idx]?.action();
        if (typeof result === "string") {
          this.reply = result;
          this.render();
        } else if (result !== null) {
          this.close();
        }
        // result === null: action called showPlanet itself; already rendered.
      });
    });
  }
}

/** Hull and world names come from the data files, not from us. */
function escapeHtml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}
