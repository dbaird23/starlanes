import {
  resolveNovaText,
  COMMODITIES,
  OUTFIT_ORDER,
  SPOB_GOVT,
  DESCS,
  STR_LISTS,
  UI_PICTS,
  GOVT_NEWS_PICS,
  OUTFITS,
  outfitPict,
  priceAt,
  SHIP_ORDER,
  SHIP_SPRITES,
  SHIPS,
  shipyardPict,
  SPOB_INDEX,
} from "../data/universe";
import type { Game, GateDestination } from "../game/game";
import { MAX_ESCORTS, escortHireFee, escortWage } from "../game/game";
import { JUNKS, junkCargoKey } from "../data/universe";
import {
  availableMissions,
  offerText,
  substituteTags,
  descText,
  instantiateMission,
  testContext,
  type MissionEvent,
} from "../game/missions";
import { MISSIONS, WEAPONS, getSystem } from "../data/universe";
import { playAmbient, stopAmbient } from "../engine/audio";
import type { ActiveMission, MissionType, PlanetDef, SystemDef } from "../types";
import { oopsPriceDelta, oopsesAt } from "../game/oops";
import { evalTest } from "../game/bits";
import { formatDate } from "../game/calendar";

/**
 * Spaceport keyboard shortcuts. M is already the star map, so the mission BBS
 * takes N; the rest are the first letter of the counter. R refuels and I opens
 * the mission log, both handled alongside these.
 */
const PORT_KEYS: Record<string, View> = {
  KeyB: "bar",
  KeyN: "bbs",
  KeyT: "trade",
  KeyS: "shipyard",
  KeyO: "outfitter",
  KeyI: "log",
};

/**
 * Screens Esc backs out of. Each one already carries its own Back button, so
 * Esc presses that rather than setting the view itself — the bar's button
 * knows to return to the spaceport, and any screen with a different notion of
 * "back" keeps it. The spaceport and a gate are not in here: Esc leaves the
 * planet from those, which is Nova's own behaviour and predates this.
 */
const ESC_CLOSES = new Set<View>([
  "bar", "bbs", "trade", "outfitter", "shipyard", "log",
]);

/** The screens those keys work from: the counters, not the modal panels. */
const PORT_KEY_VIEWS = new Set<View>([
  "spaceport", "trade", "shipyard", "outfitter", "bar", "bbs", "log", "escorts",
]);

type View =
  | "spaceport"
  | "trade"
  | "shipyard"
  | "outfitter"
  | "bar"
  | "bbs"
  | "offer"
  | "log"
  | "events"
  | "gate"
  | "shipOffer"
  | "escorts"
  | "holovid"
  | "gamble";

/**
 * Nova's data holds several identically-named copies of many ships and outfits
 * (variants used by AI fleets and missions). A storefront should list each
 * product once — keep the first, which is the canonical low-id entry.
 */
/** The four GRN racers, in the order their PICTs run (8530-8533). */
const RACER_NAMES = ["Blue", "Green", "Yellow", "Red"];

/** Nova keeps its button captions in STR# 150; these are indices into it. */
function btnLabel(index: number, fallback: string): string {
  return STR_LISTS["150"]?.[index] ?? fallback;
}

/** Stable per-world number, so a day's news doesn't reshuffle on every redraw. */
function spobSeed(id: string): number {
  let h = 0;
  for (let i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) >>> 0;
  return h % 9973;
}

/** oütf Flags the outfitter acts on (Nova Bible). */
const OUTF_CANT_SELL = 0x0008;
const OUTF_HIDE_UNLESS_REQUIRE = 0x0100;
const OUTF_SUPPRESS_EQUAL_WEIGHT = 0x1000;
const OUTF_HIDE_UNLESS_AVAIL = 0x4000;

function safeSystemName(systemId: string): string {
  try {
    return getSystem(systemId).name;
  } catch {
    return "parts unknown";
  }
}

const BAR_LINES = [
  "The bar is loud tonight, full of dock workers arguing about freight rates.",
  "A tired-looking spacer nurses a drink in the corner, watching the door.",
  "The bartender polishes a glass and eyes you as you walk in.",
  "Two traders at a corner table are hunched over a star chart, talking in low voices.",
  "A news feed drones on above the bar, reporting on shipping lane closures.",
  "Somebody feeds the jukebox. It plays something old, from Earth.",
  "A knot of off-duty patrol pilots swaps stories near the dartboard.",
  "The place is nearly empty. Your footsteps echo off the deck plating.",
];

export class LandedUi {
  private root: HTMLElement;
  private game: Game;
  private planet: PlanetDef | null = null;
  private system: SystemDef | null = null;
  private view: View = "spaceport";
  private events: MissionEvent[] = [];
  private bbsMissions: MissionType[] = [];
  /** which posting the board is showing, and where the list was scrolled */
  private selectedMisn: number | null = null;
  private misnScroll = 0;
  /**
   * Destinations and cargo amounts are rolled when a job is posted, not when
   * it's read — so each listing keeps the same instance until you leave.
   */
  private offers = new Map<number, ActiveMission>();
  private selectedHire: string | null = null;
  private hireScroll = 0;
  private gamblePick: number | null = null;
  private gambleResult: { winner: number; won: boolean; stake: number; payout: number } | null = null;
  private barMissions: MissionType[] = [];
  private spaceportOffers: MissionType[] = [];
  private pendingOffer: { m: MissionType; active: ActiveMission; back: View } | null = null;
  private shipOfferFrom: string | null = null;

  constructor(game: Game) {
    this.game = game;
    this.root = document.getElementById("landed-ui")!;
    window.addEventListener("keydown", (e) => {
      if (this.root.classList.contains("hidden")) return;
      const typing = document.activeElement?.tagName === "INPUT";
      if (typing) return;
      // anything this handler acts on must not reach the game loop as well
      const handled = (): void => this.game.swallowKey(e.code);
      if (this.planet && e.code === "Escape" && ESC_CLOSES.has(this.view)) {
        e.preventDefault();
        handled();
        const back = this.root.querySelector<HTMLButtonElement>("#btn-back");
        if (back) back.click();
        else {
          this.view = "spaceport";
          this.render();
        }
        return;
      }
      if (
        this.planet &&
        (e.code === "KeyL" || e.code === "Escape") &&
        (this.view === "spaceport" || this.view === "gate")
      ) {
        handled();
        this.game.depart();
        return;
      }
      /*
       * The spaceport's own keys. Nova lets you reach every counter from the
       * keyboard rather than the buttons, and these work from any of the port
       * screens, so you can go straight from the outfitter to the shipyard
       * without stopping at the spaceport in between. M is the map, so the
       * mission BBS takes N.
       */
      if (this.planet && PORT_KEY_VIEWS.has(this.view)) {
        const target = PORT_KEYS[e.code];
        if (target) {
          e.preventDefault();
          handled();
          this.goToPort(target);
          return;
        }
        if (e.code === "KeyR") {
          e.preventDefault();
          handled();
          this.game.refuel();
          this.view = "spaceport";
          this.render();
          return;
        }
      }
      // M opens the map from a landed screen too, carrying the posting you
      // are reading so you can see where it would send you
      if (this.planet && e.code === "KeyM") {
        handled();
        const sel =
          this.view === "offer"
            ? this.pendingOffer?.m
            : this.view === "bbs"
              ? this.bbsMissions.find((m) => m.id === this.selectedMisn)
              : undefined;
        if (sel) this.showOnMap(sel);
        else this.game.openMap();
      }
    });
  }

  /**
   * Switch counters from the keyboard, refusing anything this world doesn't
   * have — a station with no shipyard simply says so rather than opening an
   * empty one.
   */
  private goToPort(view: View): void {
    const p = this.planet;
    if (!p) return;
    const missing =
      (view === "bar" && !p.bar) ||
      (view === "trade" && !p.exchange) ||
      (view === "shipyard" && !p.shipyard) ||
      (view === "outfitter" && !p.outfitter) ||
      (view === "bbs" && p.uninhabited) ||
      (view === "log" && this.game.player.activeMissions.length === 0);
    if (missing) return;
    this.view = view;
    this.render();
  }

  show(planet: PlanetDef, system: SystemDef): void {
    this.planet = planet;
    this.system = system;
    // spöb CustSndID: the world's own ambience — surf, jungle, station hum
    if (planet.ambientSnd !== null) {
      playAmbient(planet.ambientSnd, planet.ambientLoop);
    }

    // mission processing happens the moment you land
    this.events = this.game.collectLandingEvents(planet.id);
    this.game.save();
    this.offers.clear();
    this.bbsMissions = planet.uninhabited ? [] : availableMissions(planet, 0, this.game.player);
    this.barMissions = planet.bar ? availableMissions(planet, 1, this.game.player) : [];
    this.spaceportOffers = planet.uninhabited
      ? []
      : availableMissions(planet, 3, this.game.player);

    this.view = this.events.length > 0 ? "events" : "spaceport";
    this.root.classList.remove("hidden");
    if (this.view === "spaceport") this.maybeSpaceportOffer();
    this.render();
  }

  /**
   * A mission offered ship-to-ship (a përs captain over the radio). Uses the
   * same offer panel as a spaceport, but returns to flight when dismissed.
   */
  showShipOffer(m: MissionType, fromName: string): void {
    const g = this.game;
    const here = g.player.landedOn ?? g.system.planets[0]?.id ?? "128";
    const active = instantiateMission(m, here, g.player);
    this.planet = this.planet ?? g.system.planets[0] ?? null;
    this.system = g.system;
    this.shipOfferFrom = fromName;
    this.pendingOffer = { m, active, back: "shipOffer" };
    this.view = "offer";
    this.root.classList.remove("hidden");
    this.render();
  }

  /** Hypergate / wormhole: a destination chooser, not a spaceport. */
  showGate(planet: PlanetDef, system: SystemDef): void {
    this.planet = planet;
    this.system = system;
    this.events = [];
    this.offers.clear();
    this.bbsMissions = [];
    this.barMissions = [];
    this.spaceportOffers = [];
    this.view = "gate";
    this.root.classList.remove("hidden");
    this.render();
  }

  private renderGate(): void {
    const p = this.planet!;
    const g = this.game;
    const dests = g.gateDestinations(p);
    const kind = p.isWormhole ? "Wormhole" : "Hypergate";
    const blurb = p.isWormhole
      ? "Space folds in on itself here. There is no telling exactly where you will surface — only that it will be a long way from here."
      : "The gate ring powers up as you approach, waiting for a destination lock. Transit is instantaneous and costs no fuel.";
    const rows = dests
      .map(
        (d, i) => `<div class="ship-card" data-row="${i}">
          <div class="ship-info">
            <div class="ship-name">${p.isWormhole ? "Somewhere far away" : escapeHtml(d.name)}</div>
            <div class="ship-stats">${p.isWormhole ? "Destination unknown" : `${escapeHtml(d.systemName)} system`}</div>
          </div>
          <div class="ship-buy"><button class="evbtn primary" data-gate="${i}">${p.isWormhole ? "Enter" : "Travel"}</button></div>
        </div>`,
      )
      .join("");

    this.root.innerHTML = `
      <div class="panel">
        <h1>${escapeHtml(p.name)}<span class="sys">${escapeHtml(this.system!.name)} system · ${kind}</span></h1>
        ${this.statusBar()}
        <p class="desc">${blurb}</p>
        ${gateMap(this.system!, dests, p.isWormhole)}
        <div class="ship-list">${rows || '<p class="menu-empty">This gate has no active connections.</p>'}</div>
        <div class="btnrow">
          <button class="evbtn" id="btn-leave-gate">Leave (L)</button>
        </div>
      </div>`;

    // hovering a row lights its star, and clicking the star travels there
    const rowEls = [...this.root.querySelectorAll<HTMLElement>(".ship-card[data-row]")];
    const starEls = [...this.root.querySelectorAll<SVGElement>("[data-star]")];
    const highlight = (i: number | null) => {
      rowEls.forEach((el, n) => el.classList.toggle("hot", n === i));
      starEls.forEach((el) => el.classList.toggle("hot", el.dataset.star === String(i)));
    };
    rowEls.forEach((el, i) => {
      el.addEventListener("mouseenter", () => highlight(i));
      el.addEventListener("mouseleave", () => highlight(null));
    });
    starEls.forEach((el) => {
      const i = parseInt(el.dataset.star!, 10);
      el.addEventListener("mouseenter", () => highlight(i));
      el.addEventListener("mouseleave", () => highlight(null));
      el.addEventListener("click", () => {
        const dest = dests[i];
        if (dest) this.game.useGate(dest.spobId);
      });
    });

    this.root.querySelector("#btn-leave-gate")!.addEventListener("click", () => this.game.depart());
    this.root.querySelectorAll("button[data-gate]").forEach((btn) => {
      btn.addEventListener("click", () => {
        const idx = parseInt((btn as HTMLButtonElement).dataset.gate!, 10);
        const dest = dests[idx];
        if (dest) this.game.useGate(dest.spobId);
      });
    });
  }

  /** Story missions offered right in the spaceport (AvailLoc 3) pop up on landing — one per visit. */
  private maybeSpaceportOffer(): void {
    const m = this.spaceportOffers.shift();
    this.spaceportOffers = [];
    if (m) this.openOffer(m, "spaceport");
  }

  private openOffer(m: MissionType, back: View): void {
    const active = this.offerFor(m);
    this.pendingOffer = { m, active, back };
    this.view = "offer";
  }

  hide(): void {
    this.planet = null;
    stopAmbient();
    this.root.classList.add("hidden");
    this.root.innerHTML = "";
  }

  /**
   * Step out of the way without ending the visit — the galaxy map opens over
   * the landed screen, and coming back has to land you on the same view with
   * the same posting selected, not re-run the arrival.
   */
  suspend(): void {
    this.root.classList.add("hidden");
    this.root.innerHTML = "";
  }

  /** Come back from the map to exactly the screen that opened it. */
  resume(): void {
    if (!this.planet || !this.system) return;
    this.root.classList.remove("hidden");
    this.render();
  }

  private render(): void {
    if (!this.planet || !this.system) return;
    if (this.view === "spaceport") this.renderSpaceport();
    else if (this.view === "trade") this.renderTrade();
    else if (this.view === "shipyard") this.renderShipyard();
    else if (this.view === "outfitter") this.renderOutfitter();
    else if (this.view === "bar") this.renderBar();
    else if (this.view === "bbs") this.renderBbs();
    else if (this.view === "offer") this.renderOffer();
    else if (this.view === "log") this.renderLog();
    else if (this.view === "gate") this.renderGate();
    else if (this.view === "escorts") this.renderEscorts();
    else if (this.view === "holovid") this.renderHolovid();
    else if (this.view === "gamble") this.renderGamble();
    else if (this.view === "shipOffer") this.renderEvents();
    else this.renderEvents();
  }

  // ---------------- missions ----------------

  private renderEvents(): void {
    const ev = this.events[0];
    if (!ev) {
      this.view = "spaceport";
      this.maybeSpaceportOffer();
      this.render();
      return;
    }
    this.root.innerHTML = `
      <div class="panel">
        <h1>${ev.title}</h1>
        ${this.statusBar()}
        <p class="desc">${ev.text.replace(/\n/g, "</p><p class='desc'>")}</p>
        <div class="btnrow">
          <button class="evbtn primary" id="btn-continue">Continue</button>
        </div>
      </div>`;
    this.root.querySelector("#btn-continue")!.addEventListener("click", () => {
      this.events.shift();
      this.render();
    });
  }

  private renderOffer(): void {
    const offer = this.pendingOffer;
    if (!offer) {
      this.view = "spaceport";
      this.render();
      return;
    }
    const { m, active, back } = offer;
    const text = substituteTags(offerText(m), m, active, this.game.pilotName, this.game.rankTags());
    const cantRefuse = (m.flags & 0x0004) !== 0;
    const freeSpace = this.game.player.cargoCap - this.game.cargoUsed();
    const fits = !active.cargoLoaded || active.cargoQty <= freeSpace;
    const noSpaceNote = fits
      ? ""
      : `<p class="hint warn">This job needs ${active.cargoQty} tons of free cargo space — you have ${Math.max(0, freeSpace)}. Sell some cargo or fly a bigger ship.</p>`;
    this.root.innerHTML = `
      <div class="panel">
        <h1>${escapeHtml(active.name)}<span class="sys">${this.shipOfferFrom ?? this.planet!.name}</span></h1>
        ${this.statusBar()}
        <p class="desc">${text.replace(/\n/g, "</p><p class='desc'>")}</p>
        ${active.cargoQty > 0 && active.cargoName ? `<p class="hint">Cargo: ${active.cargoQty}t of ${active.cargoName}${m.timeLimit > 0 ? ` · Time limit: ${m.timeLimit} days` : ""}</p>` : m.timeLimit > 0 ? `<p class="hint">Time limit: ${m.timeLimit} days</p>` : ""}
        ${noSpaceNote}
        <div class="btnrow">
          <button class="evbtn primary" id="btn-accept" ${fits ? "" : "disabled"}>Accept</button>
          ${!cantRefuse ? '<button class="evbtn" id="btn-refuse">Refuse</button>' : ""}
          ${cantRefuse && !fits ? '<button class="evbtn" id="btn-decline">Decline</button>' : ""}
          <button class="evbtn" id="btn-offer-map">Map</button>
        </div>
      </div>`;

    const done = () => {
      this.pendingOffer = null;
      if (back === "shipOffer") {
        // radio offers happen in flight: close the overlay entirely
        this.shipOfferFrom = null;
        this.view = "spaceport";
        this.root.classList.add("hidden");
        this.root.innerHTML = "";
        return;
      }
      this.view = back;
      if (back === "spaceport") this.maybeSpaceportOffer();
      this.render();
    };
    this.root.querySelector("#btn-accept")!.addEventListener("click", () => {
      const result = this.game.acceptMission(m, active);
      if (!result.ok) {
        if (result.reason) alert(result.reason);
        return;
      }
      this.bbsMissions = this.bbsMissions.filter((x) => x.id !== m.id);
      this.barMissions = this.barMissions.filter((x) => x.id !== m.id);
      this.offers.delete(m.id);
      const brief = descText(m.briefText);
      if (brief) {
        this.events.push({
          title: escapeHtml(active.name),
          text: substituteTags(brief, m, active, this.game.pilotName, this.game.rankTags()),
        });
        this.pendingOffer = null;
        this.view = "events";
        this.render();
        return;
      }
      done();
    });
    this.root.querySelector("#btn-refuse")?.addEventListener("click", () => {
      this.game.refuseMission(m);
      done();
    });
    // can't-refuse mission that doesn't fit: back out without OnRefuse
    // consequences, as if it had never been offered
    this.root.querySelector("#btn-decline")?.addEventListener("click", () => done());
    this.root.querySelector("#btn-offer-map")?.addEventListener("click", () => this.showOnMap(m));
  }

  /**
   * Show where a posting would send you, without taking it. Nova puts a Map
   * button on the mission board for exactly this, and marks the destination
   * with the briefing's green arrow — which may well be a system you have
   * never charted, in which case the map shows the dot and nothing else.
   */
  private showOnMap(m: MissionType): void {
    const active = this.offerFor(m);
    const stops = [active.travelSpobId, active.returnSpobId].filter(
      (id): id is string => id !== null,
    );
    this.game.openMap(stops);
  }

  /** The rolled-up offer for a posting, created once and reused. */
  private offerFor(m: MissionType): ActiveMission {
    let active = this.offers.get(m.id);
    if (!active) {
      active = instantiateMission(m, this.planet!.id, this.game.player);
      this.offers.set(m.id, active);
    }
    return active;
  }

  private missionRow(m: MissionType, from: View): string {
    return `<div class="ship-card misn-row" data-misn="${m.id}" data-from="${from}">
      <div class="ship-info">
        <div class="ship-name">${escapeHtml(this.offerFor(m).name)}</div>
        <div class="ship-stats">${m.pay > 0 ? `Pay: ${m.pay.toLocaleString()} cr` : "Pay: —"}${m.timeLimit > 0 ? ` · ${m.timeLimit} day limit` : ""}</div>
      </div>
      <div class="ship-buy"><button class="evbtn" data-open="${m.id}">Details</button></div>
    </div>`;
  }

  private wireMissionRows(from: View, list: MissionType[]): void {
    this.root.querySelectorAll("button[data-open]").forEach((btn) => {
      btn.addEventListener("click", () => {
        const id = parseInt((btn as HTMLButtonElement).dataset.open!, 10);
        const m = list.find((x) => x.id === id);
        if (m) {
          this.openOffer(m, from);
          this.render();
        }
      });
    });
  }

  /**
   * The mission board, as Nova draws it: the list of postings on the left,
   * the selected job's briefing on the right, Accept and Leave underneath.
   * Selecting a posting is not a commitment — only Accept is.
   */
  private renderBbs(): void {
    const g = this.game;
    const list = this.bbsMissions;
    if (!list.some((m) => m.id === this.selectedMisn)) {
      this.selectedMisn = list[0]?.id ?? null;
    }
    const sel = list.find((m) => m.id === this.selectedMisn) ?? null;

    const rows = list
      .map(
        (m) => `<div class="misn-item${m.id === this.selectedMisn ? " sel" : ""}"
          data-misn="${m.id}">${escapeHtml(this.offerFor(m).name)}</div>`,
      )
      .join("");

    let detail = '<p class="desc">Nothing posted here right now.</p>';
    let accept = '<button class="evbtn" disabled>Accept</button>';
    if (sel) {
      const active = this.offerFor(sel);
      const text = substituteTags(
        offerText(sel), sel, active, g.pilotName, g.rankTags(),
      );
      const freeSpace = g.player.cargoCap - this.game.cargoUsed();
      const fits = !active.cargoLoaded || active.cargoQty <= freeSpace;
      const facts = [
        sel.pay > 0 ? `Pay: ${sel.pay.toLocaleString()} cr` : null,
        active.cargoQty > 0 && active.cargoName
          ? `Cargo: ${active.cargoQty}t of ${active.cargoName}`
          : null,
        sel.timeLimit > 0 ? `Time limit: ${sel.timeLimit} days` : null,
      ].filter(Boolean);
      detail = `
        <div class="misn-head">${escapeHtml(active.name)}</div>
        <div class="misn-text">
          <p>${text.replace(/\n/g, "</p><p>")}</p>
          ${facts.length ? `<p class="hint">${facts.join(" · ")}</p>` : ""}
          ${fits ? "" : `<p class="hint warn">Needs ${active.cargoQty} tons of free cargo space — you have ${Math.max(0, freeSpace)}.</p>`}
        </div>`;
      accept = `<button class="evbtn" id="btn-bbs-accept" ${fits ? "" : "disabled"}>Accept</button>
        <button class="evbtn" id="btn-bbs-map">Map</button>`;
    }

    this.root.innerHTML = `
      <div class="panel wide misn-board">
        <div class="misn-bar">
          <span>The following missions are available here:</span>
          <span class="misn-date">${formatDate(g.player.date)}</span>
        </div>
        <div class="misn-body">
          <div class="misn-list">${rows}</div>
          <div class="misn-detail">${detail}</div>
        </div>
        <div class="btnrow center">
          ${accept}
          <button class="evbtn primary" id="btn-back">Leave</button>
        </div>
      </div>`;

    const listEl = this.root.querySelector<HTMLElement>(".misn-list")!;
    listEl.scrollTop = this.misnScroll;
    this.root.querySelectorAll<HTMLElement>(".misn-item").forEach((row) => {
      row.addEventListener("click", () => {
        this.misnScroll = listEl.scrollTop;
        this.selectedMisn = parseInt(row.dataset.misn!, 10);
        this.render();
      });
    });
    this.root.querySelector("#btn-back")!.addEventListener("click", () => {
      this.view = "spaceport";
      this.misnScroll = 0;
      this.render();
    });
    this.root.querySelector("#btn-bbs-accept")?.addEventListener("click", () => {
      if (sel) this.takeMission(sel, "bbs");
    });
    this.root.querySelector("#btn-bbs-map")?.addEventListener("click", () => {
      if (sel) this.showOnMap(sel);
    });
  }

  /** Shared Accept path for the board and for offered missions. */
  private takeMission(m: MissionType, back: View): void {
    const active = this.offerFor(m);
    const result = this.game.acceptMission(m, active);
    if (!result.ok) {
      if (result.reason) alert(result.reason);
      return;
    }
    this.bbsMissions = this.bbsMissions.filter((x) => x.id !== m.id);
    this.barMissions = this.barMissions.filter((x) => x.id !== m.id);
    this.offers.delete(m.id);
    this.selectedMisn = null;
    const brief = descText(m.briefText);
    if (brief) {
      this.events.push({
        title: escapeHtml(active.name),
        text: substituteTags(brief, m, active, this.game.pilotName, this.game.rankTags()),
      });
      this.pendingOffer = null;
      this.view = "events";
    } else {
      this.view = back;
    }
    this.render();
  }

  private renderLog(): void {
    const g = this.game;
    const rows = g.player.activeMissions
      .map((a, i) => {
        const m = MISSIONS[String(a.misnId)];
        const dest = a.travelDone ? a.returnSpobId : a.travelSpobId;
        const entry = dest ? SPOB_INDEX.get(dest) : null;
        const destText = entry
          ? `${entry.planet.name}, ${safeSystemName(entry.systemId)}`
          : "wherever the job ends";
        const daysLeft =
          a.timeLimit > 0 ? `${Math.max(0, a.timeLimit - (g.player.date - a.acceptedDay))} days left` : "";
        /*
         * QuickBrief is the dësc Nova shows when you ask a mission for its
         * briefing — a one-line restatement of the job ("Take <CQ> tons of
         * <CT> to <RST>") as against the full offer text in BriefText. 687 of
         * the 791 missions carry one, and it is what belongs in the log.
         */
        const quick = m ? descText(m.quickBrief) : "";
        const brief = quick
          ? substituteTags(quick, m!, a, g.pilotName, g.rankTags())
          : "";
        return `<div class="ship-card">
          <div class="ship-info">
            <div class="ship-name">${a.name}</div>
            ${brief ? `<div class="ship-brief">${escapeHtml(brief)}</div>` : ""}
            <div class="ship-stats">Destination: ${destText}${a.cargoLoaded && a.cargoName ? ` · carrying ${a.cargoQty}t ${a.cargoName}` : ""}${daysLeft ? ` · ${daysLeft}` : ""}</div>
          </div>
          <div class="ship-buy">${m && m.canAbort ? `<button class="evbtn" data-abort="${i}">Abort</button>` : ""}</div>
        </div>`;
      })
      .join("");
    this.root.innerHTML = `
      <div class="panel">
        <h1>Mission Log</h1>
        ${this.statusBar()}
        <div class="ship-list">${rows || '<p class="desc">No active missions.</p>'}</div>
        <div class="btnrow">
          <button class="evbtn" id="btn-back">Back to Spaceport</button>
        </div>
      </div>`;
    this.root.querySelector("#btn-back")!.addEventListener("click", () => {
      this.view = "spaceport";
      this.render();
    });
    this.root.querySelectorAll("button[data-abort]").forEach((btn) => {
      btn.addEventListener("click", () => {
        const idx = parseInt((btn as HTMLButtonElement).dataset.abort!, 10);
        const active = this.game.player.activeMissions[idx];
        if (active && confirm(`Abort mission "${active.name}"?`)) {
          this.game.abortMission(active);
          this.render();
        }
      });
    });
  }

  /**
   * The hiring hall. Nova lets you take on escorts wherever there are pilots to
   * hire; the lot is drawn from the hulls this world's tech level supports, the
   * same daily roll the shipyard uses so the two agree with each other.
   */
  private renderEscorts(): void {
    const p = this.planet!;
    const g = this.game;

    // Who is on offer comes from the shïp HireRandom field — "percent chance
    // per day that this ship type will be available for hire in the bar", a
    // different roll from the shipyard's BuyRandom. Variants are kept rather
    // than folded together: Nova lists each hull on offer separately, which is
    // why two Shuttles show up, each with its own pilot and asking price.
    const forHire = SHIP_ORDER.filter((id) => {
      const s = SHIPS[id];
      const techOk =
        s.techLevel > 0 && (s.techLevel <= p.techLevel || p.specialTechs.includes(s.techLevel));
      if (!techOk || s.cost <= 0 || s.hireRandom <= 0) return false;
      return evalTest(s.avail, g.player.bits, testContext(g.player));
    });

    const full = g.player.escorts.length >= MAX_ESCORTS;
    if (!this.selectedHire || !forHire.includes(this.selectedHire)) {
      this.selectedHire = forHire[0] ?? null;
    }

    // Nova's hiring hall reads left to right: the hulls on offer, the pilot
    // standing beside the one you've picked, then its portrait and asking
    // price, with the buttons along the bottom.
    const cells = forHire
      .map((id) => {
        const s = SHIPS[id];
        const pic = shipyardPict(id);
        // ShortName carries Nova's "- used -" tag on a second line, but the
        // separator in the data is a literal backslash-n, not a newline
        const [, tag] = (s.shortName ?? "").split("\\n");
        return `<div class="oi-cell${id === this.selectedHire ? " sel" : ""}" data-id="${id}">
          <div class="oi-icon">${pic ? `<img src="/nova/picts/${pic.file}" alt="">` : ""}</div>
          <div class="oi-name">${escapeHtml(s.name.split(";")[0])}${
            tag ? `<span class="oi-sub">${escapeHtml(tag.trim())}</span>` : ""
          }</div>
        </div>`;
      })
      .join("");

    let desc = "";
    let side = "";
    let hireBtn = `<button class="evbtn" disabled>${btnLabel(12, "Hire Escort")}</button>`;
    if (this.selectedHire) {
      const s = SHIPS[this.selectedHire];
      const fee = escortHireFee(s.cost);
      const wage = escortWage(s.cost);
      const can = !full && g.player.credits >= fee;
      // dësc 14000 + shipID - 128 is the pilot standing beside the hull
      const pilot = DESCS[String(14000 + Number(this.selectedHire) - 128)];
      const pic = shipyardPict(this.selectedHire);
      desc = `<div class="oi-desc">${
        pilot ? resolveNovaText(pilot, g.player.bits) : escapeHtml(s.name.split(";")[0])
      }</div>`;
      side = `${
        pic
          ? `<div class="oi-hero"><img src="/nova/picts/${pic.file}" alt=""></div>`
          : '<div class="oi-hero placeholder"></div>'
      }
        <div class="oi-info">
          <div><span>Hiring Price:</span><b>${fee.toLocaleString()} cr</b></div>
          <div><span>You Have:</span><b>${g.player.credits.toLocaleString()} cr</b></div>
          <div class="gap"><span>Daily Wage:</span><b>${wage.toLocaleString()} cr</b></div>
        </div>`;
      hireBtn = `<button class="evbtn" id="btn-hire-sel" ${can ? "" : "disabled"}>${btnLabel(12, "Hire Escort")}</button>`;
    }

    const daily = g.player.escorts.reduce((sum, e) => sum + e.wage, 0);
    const hired = g.player.escorts
      .map((e, i) => {
        const s = SHIPS[e.shipId];
        return `<div class="ship-card">
          <div class="ship-info">
            <div class="ship-name">${escapeHtml(s?.name.split(";")[0] ?? "Ship")}</div>
            <div class="ship-stats">In your service · ${e.wage.toLocaleString()} cr/day</div>
          </div>
          <div class="ship-buy"><button class="evbtn" data-dismiss="${i}">Dismiss</button></div>
        </div>`;
      })
      .join("");

    this.root.innerHTML = `
      <div class="panel wide">
        <h1>Hire Escorts<span class="sys">${escapeHtml(p.name)}</span></h1>
        ${this.statusBar()}
        <div class="oi-body">
          <div class="oi-grid">${
            cells || '<p class="menu-empty">No pilots are looking for work today.</p>'
          }</div>
          ${desc}
          <div class="oi-side">${side}</div>
        </div>
        <div class="oi-bar">
          <button class="oi-arrow" id="oi-up">&#9650;</button>
          <button class="oi-arrow" id="oi-down">&#9660;</button>
          <span class="oi-spacer"></span>
          ${hireBtn}
          <button class="evbtn primary" id="btn-back">${btnLabel(4, "Done")}</button>
        </div>
        ${
          g.player.escorts.length
            ? `<h2 class="sub">Your wing${daily > 0 ? ` — ${daily.toLocaleString()} cr/day` : ""}${
                full ? " — your command is full" : ""
              }</h2>
               <div class="ship-list">${hired}</div>`
            : ""
        }
      </div>`;

    const grid = this.root.querySelector<HTMLElement>(".oi-grid")!;
    grid.scrollTop = this.hireScroll;
    this.root.querySelectorAll<HTMLElement>(".oi-cell").forEach((cell) => {
      cell.addEventListener("click", () => {
        this.hireScroll = grid.scrollTop;
        this.selectedHire = cell.dataset.id!;
        this.render();
      });
    });
    this.root.querySelector("#oi-up")?.addEventListener("click", () => {
      grid.scrollBy({ top: -84, behavior: "smooth" });
    });
    this.root.querySelector("#oi-down")?.addEventListener("click", () => {
      grid.scrollBy({ top: 84, behavior: "smooth" });
    });
    this.root.querySelector("#btn-hire-sel")?.addEventListener("click", () => {
      const res = this.game.hireEscort(this.selectedHire!);
      if (!res.ok && res.reason) alert(res.reason);
      this.render();
    });
    this.root.querySelector("#btn-back")!.addEventListener("click", () => {
      this.view = "bar";
      this.render();
    });
    this.root.querySelectorAll("button[data-dismiss]").forEach((btn) => {
      btn.addEventListener("click", () => {
        this.game.dismissEscort(parseInt((btn as HTMLButtonElement).dataset.dismiss!, 10));
        this.render();
      });
    });
  }

  /**
   * The bar. Nova puts the world's own bar copy here — dësc 10000 + spöbID -
   * 128, the text that names the place — over four buttons out of STR# 150:
   * Hire Escort, Gamble, Holovid and Leave. Missions flagged AvailLoc 1 are
   * offered here rather than on the Mission BBS, so they hang below.
   */
  private renderBar(): void {
    const p = this.planet!;
    const sys = this.system!;
    const spobId = Number(p.id);
    const barDesc = DESCS[String(10000 + spobId - 128)];
    const line = barDesc
      ? resolveNovaText(barDesc, this.game.player.bits)
      : BAR_LINES[Math.floor(Math.random() * BAR_LINES.length)];
    const govtLine = sys.govtName
      ? `Most of the patrons here fly under ${sys.govtName} colors.`
      : "Nobody here seems to fly under anyone's colors.";
    const hero = p.landingPictFile
      ? `<div class="land-hero dim" style="background-image:url('/nova/picts/${p.landingPictFile}')"></div>`
      : "";
    const missionRows = this.barMissions.map((m) => this.missionRow(m, "bar")).join("");
    this.root.innerHTML = `
      <div class="panel">
        ${hero}
        <h1>Bar<span class="sys">${p.name}</span></h1>
        ${this.statusBar()}
        <p class="desc">${line}</p>
        ${barDesc ? "" : `<p class="desc">${govtLine}</p>`}
        <div class="btnrow">
          <button class="evbtn" id="btn-hire">${btnLabel(12, "Hire Escort")}</button>
          <button class="evbtn" id="btn-gamble">${btnLabel(10, "Gamble")}</button>
          <button class="evbtn" id="btn-holovid">${btnLabel(11, "Holovid")}</button>
          <button class="evbtn" id="btn-back">${btnLabel(0, "Leave")}</button>
        </div>
        ${missionRows ? `<div class="ship-list">${missionRows}</div>` : ""}
      </div>`;
    const go = (id: string, view: View) =>
      this.root.querySelector(id)?.addEventListener("click", () => {
        this.view = view;
        this.render();
      });
    go("#btn-hire", "escorts");
    go("#btn-gamble", "gamble");
    go("#btn-holovid", "holovid");
    go("#btn-back", "spaceport");
    this.wireMissionRows("bar", this.barMissions);
  }

  /**
   * The holovid: Nova's news window. The backdrop is the local government's
   * NewsPic — the Federation's is PICT 9001, "Hyper News Network" — falling
   * back to the generic 9000 out in independent space. Below it run a local
   * commercial (STR# 8100) and the day's headlines (STR# 8101).
   */
  private renderHolovid(): void {
    const p = this.planet!;
    const govtId = SPOB_GOVT.get(p.id) ?? -1;
    const picId = govtId >= 128 ? (GOVT_NEWS_PICS[String(govtId)] ?? 9000) : 9000;
    const pic = UI_PICTS[String(picId)] ?? UI_PICTS["9000"];
    /*
     * A local advert (STR# 8100), then whatever the crön events running right
     * now have to say — those are the real headlines, and a world reports its
     * own government's version of a story where one exists. The generic wire
     * (STR# 8101) only fills in when nothing is happening.
     */
    const seed = this.game.player.date + spobSeed(p.id);
    const ads = STR_LISTS["8100"] ?? [];
    const items: string[] = [];
    if (ads.length) items.push(ads[seed % ads.length]);
    const cronNews = this.game.newsFor(govtId);
    if (cronNews.length) items.push(...cronNews.slice(0, 3));
    else {
      const news = STR_LISTS["8101"] ?? [];
      if (news.length) {
        items.push(news[seed % news.length]);
        if (news.length > 1) items.push(news[(seed * 7 + 3) % news.length]);
      }
    }
    this.root.innerHTML = `
      <div class="panel">
        <h1>Holovid<span class="sys">${p.name}</span></h1>
        ${this.statusBar()}
        ${pic ? `<div class="holovid-pic"><img src="/nova/picts/${pic.file}" alt=""></div>` : ""}
        <div class="holovid-feed">
          ${items.map((t) => `<p class="desc">${escapeHtml(t)}</p>`).join("")}
        </div>
        <div class="btnrow">
          <button class="evbtn" id="btn-back">${btnLabel(0, "Leave")}</button>
        </div>
      </div>`;
    this.root.querySelector("#btn-back")!.addEventListener("click", () => {
      this.view = "bar";
      this.render();
    });
  }

  /**
   * Gamble: Nova's Galaxy Racing Network. You back one of four racers, put
   * money on it and watch the result. The art is all shipped — PICT 8529 is
   * the backdrop and 8530-8533 / 8540-8543 / 8550-8553 / 8560-8563 are the
   * four racers in their unclicked, clicked, winning and disabled states.
   * Stakes come from STR# 150's own "Bet 1000" and "Bet 5000" captions.
   */
  private renderGamble(): void {
    const g = this.game;
    const p = this.planet!;
    const bg = UI_PICTS["8529"];
    const racer = (i: number, state: "idle" | "picked" | "won") => {
      const base = state === "won" ? 8550 : state === "picked" ? 8540 : 8530;
      return UI_PICTS[String(base + i)];
    };
    const picked = this.gamblePick;
    const result = this.gambleResult;
    const stakes = [1000, 5000].filter((v) => v <= g.player.credits);

    const cells = [0, 1, 2, 3]
      .map((i) => {
        const state = result ? (i === result.winner ? "won" : "idle") : i === picked ? "picked" : "idle";
        const pic = racer(i, state);
        return `<button class="race-cell${i === picked ? " sel" : ""}" data-racer="${i}" ${result ? "disabled" : ""}>
          ${pic ? `<img src="/nova/picts/${pic.file}" alt="${RACER_NAMES[i]}">` : RACER_NAMES[i]}
          <span>${RACER_NAMES[i]}</span>
        </button>`;
      })
      .join("");

    let banner: string;
    if (result) {
      banner = result.won
        ? `${btnLabel(369, "Your winnings")}: ${result.payout.toLocaleString()} cr — ${RACER_NAMES[result.winner]} takes it.`
        : `${RACER_NAMES[result.winner]} takes it. You lose ${result.stake.toLocaleString()} cr.`;
    } else if (picked === null) {
      banner = "You're tuned to GRN, Galaxy Racing Network! Choose your color for the next race.";
    } else if (!stakes.length) {
      banner = STR_LISTS["2002"]?.[360] ?? "Sorry, you don't have enough credits to bet today.";
    } else {
      banner = `${RACER_NAMES[picked]} it is. ${STR_LISTS["2002"]?.[371] ?? "Amount to bet:"}`;
    }

    const betRow = !result && picked !== null && stakes.length
      ? stakes
          .map((v) => `<button class="evbtn" data-bet="${v}">${btnLabel(v === 1000 ? 13 : 14, `Bet ${v}`)}</button>`)
          .join("")
      : "";

    this.root.innerHTML = `
      <div class="panel">
        <h1>Galaxy Racing Network<span class="sys">${p.name}</span></h1>
        ${this.statusBar()}
        <div class="race-stage"${bg ? ` style="background-image:url('/nova/picts/${bg.file}')"` : ""}>
          <p class="race-banner">${escapeHtml(banner)}</p>
          <div class="race-grid">${cells}</div>
        </div>
        <div class="btnrow">
          ${betRow}
          ${result ? `<button class="evbtn" id="btn-again">${btnLabel(58, "Bet")} again</button>` : ""}
          <button class="evbtn" id="btn-back">${btnLabel(0, "Leave")}</button>
        </div>
      </div>`;

    this.root.querySelectorAll("button[data-racer]").forEach((b) => {
      b.addEventListener("click", () => {
        this.gamblePick = Number((b as HTMLButtonElement).dataset.racer);
        this.gambleResult = null;
        this.render();
      });
    });
    this.root.querySelectorAll("button[data-bet]").forEach((b) => {
      b.addEventListener("click", () => {
        const stake = Number((b as HTMLButtonElement).dataset.bet);
        this.gambleResult = g.runRace(this.gamblePick!, stake);
        this.render();
      });
    });
    this.root.querySelector("#btn-again")?.addEventListener("click", () => {
      this.gamblePick = null;
      this.gambleResult = null;
      this.render();
    });
    this.root.querySelector("#btn-back")!.addEventListener("click", () => {
      this.gamblePick = null;
      this.gambleResult = null;
      this.view = "bar";
      this.render();
    });
  }

  private statusBar(): string {
    const g = this.game;
    return `<div class="statusbar">
      <span>Credits: <b>${g.player.credits.toLocaleString()} cr</b></span>
      <span>Cargo: <b>${g.cargoUsed()} / ${g.player.cargoCap} t</b></span>
      <span>Fuel: <b>${Math.round(g.player.fuelJumps * 10) / 10} / ${g.player.maxFuelJumps} jumps</b></span>
      <span>${formatDate(g.player.date)}</span>
    </div>`;
  }

  /** The commission you're known by here, if any. */
  private rankLine(): string {
    const govtId = SPOB_GOVT.get(this.planet!.id) ?? -1;
    const local = this.game.topRank(govtId);
    const best = this.game.topRank();
    const rank = local ?? best;
    if (!rank) return "";
    const mult = this.game.priceMultiplier(govtId);
    const note = local && mult !== 1
      ? ` — prices here at ${Math.round(mult * 100)}%`
      : "";
    return `<p class="hint">Known here as <b>${rank.convName || rank.name}</b>${note}.</p>`;
  }

  private renderSpaceport(): void {
    const p = this.planet!;
    const sys = this.system!;
    const g = this.game;
    const fuelCost = g.refuelCost();
    const canRefuel = fuelCost > 0 && g.player.credits >= fuelCost && !p.uninhabited;

    const govt = sys.govtName ? ` · ${sys.govtName}` : "";
    const refuelLabel = p.uninhabited
      ? "No services"
      : fuelCost === 0
        ? "Fuel tanks full"
        : `Refuel (${fuelCost.toLocaleString()} cr)`;

    const hero = p.landingPictFile
      ? `<div class="land-hero" style="background-image:url('/nova/picts/${p.landingPictFile}')"></div>`
      : "";
    // Nova puts the services down either side of the description: bar, board
    // and exchange on the left, the two shops on the right, Leave beneath.
    // each counter names its key in the tooltip; the handler is in the ctor
    const left = [
      p.bar ? '<button class="portbtn" id="btn-bar" title="Bar (B)">Bar</button>' : "",
      p.uninhabited
        ? ""
        : '<button class="portbtn" id="btn-bbs" title="Mission BBS (N)">Mission BBS</button>',
      p.exchange
        ? '<button class="portbtn" id="btn-trade" title="Trade Center (T)">Trade Center</button>'
        : "",
      g.player.activeMissions.length > 0
        ? '<button class="portbtn" id="btn-log" title="Mission Log (I)">Mission Log</button>'
        : "",
    ].join("");
    const right = [
      p.shipyard
        ? '<button class="portbtn" id="btn-shipyard" title="Shipyard (S)">Shipyard</button>'
        : "",
      p.outfitter
        ? '<button class="portbtn" id="btn-outfitter" title="Outfitter (O)">Outfitter</button>'
        : "",
      `<button class="portbtn" id="btn-refuel" title="Refuel (R)" ${canRefuel ? "" : "disabled"}>${refuelLabel}</button>`,
      '<span class="port-gap"></span>',
      '<button class="portbtn" id="btn-depart" title="Leave (L)">Leave</button>',
    ].join("");

    this.root.innerHTML = `
      <div class="panel wide spaceport">
        ${hero}
        <div class="port-name">${p.name}</div>
        <div class="port-sub">${sys.name} system · ${p.kind === "station" ? "Station" : "Planet"}${govt}</div>
        ${this.statusBar()}
        <div class="port-body">
          <div class="port-col">${left}</div>
          <div class="port-desc">${resolveNovaText(p.desc, this.game.player.bits)}</div>
          <div class="port-col">${right}</div>
        </div>
        ${this.rankLine()}
      </div>`;

    this.root.querySelector("#btn-trade")?.addEventListener("click", () => {
      this.view = "trade";
      this.render();
    });
    this.root.querySelector("#btn-shipyard")?.addEventListener("click", () => {
      this.view = "shipyard";
      this.render();
    });
    this.root.querySelector("#btn-outfitter")?.addEventListener("click", () => {
      this.view = "outfitter";
      this.render();
    });
    this.root.querySelector("#btn-bar")?.addEventListener("click", () => {
      this.view = "bar";
      this.render();
    });
    this.root.querySelector("#btn-bbs")?.addEventListener("click", () => {
      this.view = "bbs";
      this.render();
    });
    this.root.querySelector("#btn-log")?.addEventListener("click", () => {
      this.view = "log";
      this.render();
    });
    this.root.querySelector("#btn-escorts")?.addEventListener("click", () => {
      this.view = "escorts";
      this.render();
    });
    this.root.querySelector("#btn-refuel")!.addEventListener("click", () => {
      this.game.refuel();
      this.render();
    });
    this.root.querySelector("#btn-depart")!.addEventListener("click", () => this.game.depart());
  }

  /**
   * The Trade Center, laid out as Nova does it: one list with a Commodity /
   * In Hold / Price header, the six standard goods always holding their own
   * row — blank where this world doesn't deal in them — and any jünk
   * specialities appended below. You pick a row and the Buy and Sell buttons
   * act on it, rather than every row carrying its own controls.
   */
  private renderTrade(): void {
    const p = this.planet!;
    const g = this.game;
    const spobId = Number(p.id);
    const space = g.player.cargoCap - g.cargoUsed();

    type Row = {
      key: string;
      name: string;
      level: string;
      levelClass: string;
      price: number;
      have: number;
      canBuy: boolean;
      canSell: boolean;
    } | null;

    // the six standard goods keep their slot whether or not they trade here
    const rows: Row[] = COMMODITIES.map((c) => {
      const level = p.prices[c.id];
      if (level === undefined) return null;
      const delta = oopsPriceDelta(g.player, p.id, c.id);
      const price = Math.max(1, priceAt(c.id, level) + delta);
      const have = g.player.cargo[c.id] ?? 0;
      return {
        key: c.id,
        name: c.name,
        level: level === "low" ? "Low" : level === "high" ? "High" : "Med",
        levelClass: `lvl-${level}`,
        price,
        have,
        canBuy: g.player.credits >= price && space >= 1,
        canSell: have >= 1,
      };
    });

    /*
     * Nova's special commodities. These never appear on the exchange board —
     * each jünk names the worlds that stock it and the worlds that will pay
     * for it, so a row shows up only when this world is one of them.
     */
    for (const j of Object.values(JUNKS)) {
      /*
       * BuyOn/SellOn gate each direction of the trade behind a control-bit
       * expression, so a commodity can open up as a story thread progresses.
       * Only two junks in the shipped data use them, and one of those --
       * SellOn "h33r" on the Ice Lizard Pelts -- is not a valid expression at
       * all, so an unparseable one is treated as no gate rather than silently
       * locking the trade.
       */
      const sells = j.soldAt.includes(spobId) && evalTest(j.buyOn, g.player.bits);
      const buys = j.boughtAt.includes(spobId) && evalTest(j.sellOn, g.player.bits);
      if (!sells && !buys) continue;
      const key = junkCargoKey(j.id);
      const have = g.player.cargo[key] ?? 0;
      const price = this.shopPrice(j.price);
      rows.push({
        key,
        name: j.name,
        level: sells ? "High" : "Wanted",
        levelClass: "lvl-high",
        price,
        have,
        canBuy: sells && g.player.credits >= price && space >= 1,
        canSell: buys && have >= 1,
      });
    }

    const live = rows.filter((r): r is NonNullable<Row> => r !== null);
    if (!this.selectedGood || !live.some((r) => r.key === this.selectedGood)) {
      this.selectedGood = live[0]?.key ?? null;
    }
    const sel = live.find((r) => r.key === this.selectedGood) ?? null;

    const list = rows
      .map((r) => {
        if (!r) return '<div class="tc-row blank"></div>';
        return `<div class="tc-row${r.key === this.selectedGood ? " sel" : ""}" data-id="${r.key}">
          <span class="tc-name">${escapeHtml(r.name)}</span>
          <span class="tc-held">${r.have || ""}</span>
          <span class="tc-level ${r.levelClass}">${r.level}</span>
          <span class="tc-price">${r.price.toLocaleString()}</span>
        </div>`;
      })
      .join("");

    // Nova prints the öops resource's own name so you know why prices moved
    const running = oopsesAt(g.player, p.id);
    const note = running.length ? running.map((o) => o.def.name).join(". ") + "." : "";

    this.root.innerHTML = `
      <div class="panel wide trade-center">
        <h1>Trade Center<span class="sys">${escapeHtml(p.name)}</span></h1>
        ${this.statusBar()}
        <div class="tc-head">
          <span class="tc-name">Commodity:</span>
          <span class="tc-held">In Hold:</span>
          <span class="tc-level"></span>
          <span class="tc-price">Price:</span>
        </div>
        <div class="tc-list">${list}</div>
        <div class="tc-info">Free cargo space: ${space} ton${space === 1 ? "" : "s"}</div>
        <div class="tc-note">${escapeHtml(this.tradeNote || note)}</div>
        <div class="oi-bar">
          <span class="oi-spacer"></span>
          <button class="evbtn" id="tc-buy" ${sel?.canBuy ? "" : "disabled"}>${btnLabel(1, "Buy")}</button>
          <button class="evbtn" id="tc-sell" ${sel?.canSell ? "" : "disabled"}>${btnLabel(2, "Sell")}</button>
          <button class="evbtn primary" id="btn-back">${btnLabel(4, "Done")}</button>
        </div>
      </div>`;

    this.root.querySelectorAll<HTMLElement>(".tc-row[data-id]").forEach((row) => {
      row.addEventListener("click", () => {
        this.selectedGood = row.dataset.id!;
        this.tradeNote = "";
        this.render();
      });
    });
    const trade = (dir: "buy" | "sell") => {
      if (!sel) return;
      const most = dir === "buy"
        ? Math.min(space, Math.floor(g.player.credits / sel.price))
        : sel.have;
      const asked = prompt(`${STR_LISTS["2002"]?.[370] ?? "Enter quantity:"} (max ${most})`, String(most));
      if (asked === null) return;
      const qty = Math.max(0, Math.min(most, parseInt(asked, 10) || 0));
      if (qty <= 0) return;
      const before = g.player.cargo[sel.key] ?? 0;
      if (dir === "buy") g.buy(sel.key, qty, sel.price);
      else g.sell(sel.key, qty, sel.price);
      const moved = Math.abs((g.player.cargo[sel.key] ?? 0) - before);
      this.tradeNote = moved
        ? `You ${dir === "buy" ? "bought" : "sold"} ${moved} ton${moved === 1 ? "" : "s"} of ${sel.name}.`
        : "";
      this.render();
    };
    this.root.querySelector("#tc-buy")?.addEventListener("click", () => trade("buy"));
    this.root.querySelector("#tc-sell")?.addEventListener("click", () => trade("sell"));
    this.root.querySelector("#btn-back")!.addEventListener("click", () => {
      this.tradeNote = "";
      this.view = "spaceport";
      this.render();
    });
  }

  private selectedGood: string | null = null;
  private tradeNote = "";
  private selectedShip: string | null = null;
  private selectedOutfit: string | null = null;
  /** keeps the shop list where the user left it across re-renders */
  private shopScroll = 0;

  /** Rank standing with this world's government can move prices. */
  private shopPrice(base: number): number {
    const govtId = SPOB_GOVT.get(this.planet!.id) ?? -1;
    return Math.round(base * this.game.priceMultiplier(govtId));
  }

  /**
   * Nova rates acceleration and turn rate in words rather than numbers. The
   * Bible anchors accel at "300 is considered an average value" and maneuver
   * at "10 ≈ 30°/sec"; these bands are scaled off those and calibrated so the
   * Heavy Shuttle (accel 485, turn 39) reads "Good" on both, as it does in
   * the original's shipyard.
   */
  private static rate(value: number, bands: number[]): string {
    const words = ["Poor", "Fair", "Average", "Good", "Excellent"];
    for (let i = 0; i < bands.length; i++) if (value < bands[i]) return words[i];
    return words[words.length - 1];
  }

  private renderShipyard(): void {
    const p = this.planet!;
    const g = this.game;
    const current = SHIPS[g.player.shipId];
    const tradeIn = current ? Math.floor(current.cost * 0.25) : 0;

    // BuyRandom is the percent chance this hull is on the lot on a given
    // day; 0 means never, which is what keeps Nova's AI-only variants and
    // things like the Cargo Drone out of the showroom. The roll is keyed on
    // the day and the world so the lot holds still while you're docked but
    // turns over as time passes.
    const day = Math.floor(g.player.date);
    const available = SHIP_ORDER.filter((id) => {
      const s = SHIPS[id];
      const techOk =
        s.techLevel > 0 && (s.techLevel <= p.techLevel || p.specialTechs.includes(s.techLevel));
      if (!techOk || s.cost <= 0 || s.buyRandom <= 0) return false;
      if (!evalTest(s.avail, g.player.bits, testContext(g.player))) return false;
      if (id === g.player.shipId) return true; // your own hull is always listed
      return dailyRoll(`${p.id}|${id}|${day}`) * 100 < s.buyRandom;
    });
    if (!this.selectedShip || !available.includes(this.selectedShip)) {
      this.selectedShip = available[0] ?? null;
    }

    const cells = available
      .map((id) => {
        const s = SHIPS[id];
        const price = Math.max(0, this.shopPrice(s.cost) - tradeIn);
        const pict = shipyardPict(id);
        // ShortName splits on "\n"; Nova draws a line starting with a
        // non-alphanumeric character in grey, which is how "- used -" reads
        const lines = s.shortName.split(/\\n|\n/);
        const label = lines
          .map(
            (t) =>
              `<div class="${/^[a-z0-9]/i.test(t.trim()) ? "" : "oi-sub"}">${escapeHtml(t.trim())}</div>`,
          )
          .join("");
        return `<div class="oi-cell${id === this.selectedShip ? " sel" : ""}" data-id="${id}">
          <div class="oi-icon">${
            pict ? `<img src="/nova/picts/${pict.file}" alt="">` : ""
          }</div>
          <div class="oi-name">${label}</div>
          <div class="oi-price">${
            id === g.player.shipId ? "your ship" : `${price.toLocaleString()} cr`
          }</div>
        </div>`;
      })
      .join("");

    let desc = '<p class="menu-empty">Nothing for sale here.</p>';
    let side = "";
    let buy = '<button class="evbtn" disabled>Buy</button>';
    if (this.selectedShip) {
      const s = SHIPS[this.selectedShip];
      const pict = shipyardPict(this.selectedShip);
      const sprite = SHIP_SPRITES[this.selectedShip];
      const price = Math.max(0, this.shopPrice(s.cost) - tradeIn);
      const isCurrent = this.selectedShip === g.player.shipId;
      const canBuy = !isCurrent && g.player.credits >= price;
      const [name] = s.name.split(";");
      const fullName = s.longName || name;

      const hero = pict
        ? `<img class="sy-hero" src="/nova/picts/${pict.file}" alt="${name}">`
        : sprite
          ? `<div class="sy-hero sprite" style="background-image:url('/nova/sprites/${sprite.file}');
              background-size:${sprite.frames * 100}% 100%"></div>`
          : '<div class="sy-hero placeholder"></div>';

      const weapons = s.stockWeapons.length
        ? s.stockWeapons
            .map((w) => {
              const wp = WEAPONS[String(w.id)];
              return `${w.count} ${wp ? wp.name.split(";")[0] : `Weapon ${w.id}`}`;
            })
            .join("<br>")
        : "None";

      const col = (rows: [string, string][]) =>
        rows.map(([k, v]) => `<div><span>${k}</span><b>${v}</b></div>`).join("");

      side = `
        ${hero}
        <div class="sy-fullname">${escapeHtml(fullName)}</div>
        <div class="sy-stats">
          <div class="sy-col">${col([
            ["Speed:", String(s.rawSpeed)],
            ["Accel:", LandedUi.rate(s.rawAccel, [150, 300, 450, 700])],
            ["Turn:", LandedUi.rate(s.rawTurn, [15, 25, 35, 55])],
            ["Shields:", String(s.shield)],
            ["Armor:", String(s.armor)],
            ["Guns:", s.maxGuns > 0 ? `Maximum of ${s.maxGuns}` : "None"],
            ["Turrets:", s.maxTurrets > 0 ? `Maximum of ${s.maxTurrets}` : "None"],
          ])}</div>
          <div class="sy-col">${col([
            ["Space:", `${s.freeMass} tons`],
            ["Cargo:", `${s.cargo} tons`],
            ["Energy:", `${s.fuelJumps} jumps`],
            ["Length:", `${s.length} m`],
            ["Mass:", `${s.mass} tons`],
            ["Crew:", String(s.crew)],
          ])}</div>
          <div class="sy-col wide">
            <div class="sy-weap-head">Standard Weapons:</div>
            <div class="sy-weap">${weapons}</div>
          </div>
        </div>`;
      desc = `<div class="oi-desc">${resolveNovaText(s.desc, g.player.bits)}</div>`;
      buy = `<button class="evbtn" id="btn-buy-ship" ${canBuy ? "" : "disabled"}>${
        isCurrent ? "Your ship" : `Buy — ${price.toLocaleString()} cr`
      }</button>`;
    }

    this.root.innerHTML = `
      <div class="panel wide shipyard">
        <h1>Shipyard<span class="sys">${p.name} · Tech ${p.techLevel}</span></h1>
        ${this.statusBar()}
        <div class="oi-body">
          <div class="oi-grid">${cells}</div>
          ${desc}
          <div class="oi-side">${side}</div>
        </div>
        <div class="oi-bar">
          <button class="oi-arrow" id="oi-up">&#9650;</button>
          <button class="oi-arrow" id="oi-down">&#9660;</button>
          <span class="oi-spacer"></span>
          ${buy}
          <button class="evbtn primary" id="btn-back">${btnLabel(4, "Done")}</button>
        </div>
      </div>`;

    const list = this.root.querySelector<HTMLElement>(".oi-grid")!;
    list.scrollTop = this.shopScroll;
    this.root.querySelectorAll<HTMLElement>(".oi-cell").forEach((cell) => {
      cell.addEventListener("click", () => {
        this.shopScroll = list.scrollTop;
        this.selectedShip = cell.dataset.id!;
        this.render();
      });
    });
    this.root.querySelector("#oi-up")?.addEventListener("click", () => {
      list.scrollBy({ top: -84, behavior: "smooth" });
    });
    this.root.querySelector("#oi-down")?.addEventListener("click", () => {
      list.scrollBy({ top: 84, behavior: "smooth" });
    });
    this.root.querySelector("#btn-back")!.addEventListener("click", () => {
      this.view = "spaceport";
      this.shopScroll = 0;
      this.render();
    });
    this.root.querySelector("#btn-buy-ship")?.addEventListener("click", () => {
      const result = this.game.buyShip(this.selectedShip!);
      if (!result.ok && result.reason) alert(result.reason);
      this.render();
    });
  }

  /**
   * The outfitter, laid out the way Nova does it: a four-across grid of item
   * pictures with an owned-count in the corner, the description beside it,
   * a full-size picture of the selection and a price/mass block underneath.
   */
  private renderOutfitter(): void {
    const p = this.planet!;
    const g = this.game;

    /*
     * What a spaceport stocks, per the Bible: everything at or below the
     * stellar's TechLevel, plus anything whose TechLevel exactly matches one of
     * its SpecialTech entries. Nova leans on the second rule heavily — no
     * stellar has a base tech above 7, so most of the catalogue is reachable
     * only through a special.
     */
    const outfitDay = Math.floor(g.player.date);
    const inStock = OUTFIT_ORDER.filter((id) => {
      const o = OUTFITS[id];
      const techOk =
        o.techLevel > 0 && (o.techLevel <= p.techLevel || p.specialTechs.includes(o.techLevel));
      if (!techOk || o.cost <= 0) return false;
      const owned = (g.player.outfits[id] ?? 0) > 0;
      const availOk = evalTest(o.avail, g.player.bits, testContext(g.player));
      // 0x4000 hides an item until its Availability comes true; without that
      // flag Nova still lists it, just refuses to sell it (handled at buy time).
      if ((o.flags & OUTF_HIDE_UNLESS_AVAIL) !== 0 && !availOk && !owned) return false;
      // 0x0100 does the same against the Require bits, which we don't model —
      // so those items stay hidden unless already owned.
      if ((o.flags & OUTF_HIDE_UNLESS_REQUIRE) !== 0 && !owned) return false;
      /*
       * BuyRandom is the percent chance the item is on the shelf on a given
       * day, exactly as for hulls. Zero means never, which is what keeps the
       * 51 story-granted items — the Vell-os mind powers, the Bureau Bomb —
       * out of the shops entirely; the other 155 turn over as time passes.
       * Anything already owned stays listed so it can still be sold.
       */
      if (owned) return true;
      if (o.buyRandom <= 0) return false;
      return dailyRoll(`${p.id}|o${id}|${outfitDay}`) * 100 < o.buyRandom;
    });
    /*
     * 0x1000: "When this item is available for sale, it prevents all
     * higher-numbered items with equal DispWeight from being made available at
     * the same time." That is how Nova collapses variant chains — the four
     * fire-whilst-cloaked Polaron tubes each mask the plain version behind
     * them. This used to be approximated by de-duplicating on name.
     */
    const maskedWeights = new Set(
      inStock
        .filter((id) => (OUTFITS[id].flags & OUTF_SUPPRESS_EQUAL_WEIGHT) !== 0)
        .map((id) => `${OUTFITS[id].displayWeight}:${id}`),
    );
    const available = inStock.filter((id) => {
      const o = OUTFITS[id];
      for (const key of maskedWeights) {
        const [w, maskerId] = key.split(":");
        if (Number(w) === o.displayWeight && Number(id) > Number(maskerId)) return false;
      }
      return true;
    });
    if (!this.selectedOutfit || !available.includes(this.selectedOutfit)) {
      this.selectedOutfit = available[0] ?? null;
    }

    const cells = available
      .map((id) => {
        const o = OUTFITS[id];
        const owned = g.player.outfits[id] ?? 0;
        const [name] = o.name.split(";");
        const pict = outfitPict(id);
        return `<div class="oi-cell${id === this.selectedOutfit ? " sel" : ""}" data-id="${id}">
          ${owned > 0 ? `<span class="oi-qty">${owned}</span>` : ""}
          <div class="oi-icon">${
            pict ? `<img src="/nova/picts/${pict.file}" alt="">` : ""
          }</div>
          <div class="oi-name">${name}</div>
        </div>`;
      })
      .join("");

    let desc = "";
    let hero = "";
    let info = "";
    let buttons = `<button class="evbtn" disabled>Buy</button>
      <button class="evbtn" disabled>Sell</button>`;

    if (this.selectedOutfit) {
      const id = this.selectedOutfit;
      const o = OUTFITS[id];
      const owned = g.player.outfits[id] ?? 0;
      const isAmmo = o.mods.some((m) => m.type === 3);
      const price = this.shopPrice(o.cost);
      const free = g.freeMassLeft();
      const atMax = o.max > 0 && owned >= o.max && !isAmmo;
      const tooHeavy = o.mass > 0 && free < o.mass;
      const tooPoor = g.player.credits < price;
      const noMount = g.mountBlock(id);
      const canBuy = !atMax && !tooHeavy && !tooPoor && !noMount;
      const canSell = owned > 0 && (o.flags & OUTF_CANT_SELL) === 0;
      const pict = outfitPict(id);
      const [name, subtitle] = o.name.split(";");

      desc = `<div class="oi-desc">${resolveNovaText(o.desc, g.player.bits)}</div>`;
      hero = pict
        ? `<img class="oi-hero" src="/nova/picts/${pict.file}" alt="${name}">`
        : `<div class="oi-hero placeholder">${name}</div>`;

      // Nova's own wording for why a purchase is blocked
      const status = atMax
        ? "Can't have any more!"
        : noMount === "gun"
          ? "No free gun mounts!"
          : noMount === "turret"
            ? "No free turret mounts!"
            : tooHeavy
              ? "Not enough free space!"
              : tooPoor
                ? "You can't afford this!"
                : subtitle
                  ? subtitle.trim()
                  : "";

      info = `
        <div class="oi-info">
          <div><span>Item Price:</span><b>${price.toLocaleString()} cr</b></div>
          <div><span>You Have:</span><b>${g.player.credits.toLocaleString()} cr</b></div>
          <div class="gap"><span>Item Mass:</span><b>${o.mass} tons</b></div>
          <div><span>Available:</span><b>${free} tons</b></div>
          ${mountRow(g)}
          <div class="oi-status">${status}</div>
        </div>`;

      buttons = `<button class="evbtn" id="btn-buy-outfit" ${canBuy ? "" : "disabled"}>Buy</button>
        <button class="evbtn" id="btn-sell-outfit" ${canSell ? "" : "disabled"}>Sell</button>`;
    }

    this.root.innerHTML = `
      <div class="panel wide outfitter">
        <h1>Outfitter<span class="sys">${p.name} · Tech ${p.techLevel}</span></h1>
        ${this.statusBar()}
        <div class="oi-body">
          <div class="oi-grid">${cells || '<p class="menu-empty">Nothing available.</p>'}</div>
          ${desc}
          <div class="oi-side">${hero}${info}</div>
        </div>
        <div class="oi-bar">
          <button class="oi-arrow" id="oi-up">&#9650;</button>
          <button class="oi-arrow" id="oi-down">&#9660;</button>
          <span class="oi-spacer"></span>
          ${buttons}
          <button class="evbtn primary" id="btn-back">Done</button>
        </div>
      </div>`;

    const grid = this.root.querySelector<HTMLElement>(".oi-grid")!;
    grid.scrollTop = this.shopScroll;
    this.root.querySelectorAll<HTMLElement>(".oi-cell").forEach((cell) => {
      cell.addEventListener("click", () => {
        this.shopScroll = grid.scrollTop;
        this.selectedOutfit = cell.dataset.id!;
        this.render();
      });
    });
    this.root.querySelector("#oi-up")!.addEventListener("click", () => {
      grid.scrollBy({ top: -84, behavior: "smooth" });
    });
    this.root.querySelector("#oi-down")!.addEventListener("click", () => {
      grid.scrollBy({ top: 84, behavior: "smooth" });
    });
    this.root.querySelector("#btn-back")!.addEventListener("click", () => {
      this.view = "spaceport";
      this.shopScroll = 0;
      this.render();
    });
    this.root.querySelector("#btn-buy-outfit")?.addEventListener("click", () => {
      this.shopScroll = grid.scrollTop;
      const result = this.game.buyOutfit(this.selectedOutfit!);
      if (!result.ok && result.reason) alert(result.reason);
      this.render();
    });
    this.root.querySelector("#btn-sell-outfit")?.addEventListener("click", () => {
      this.shopScroll = grid.scrollTop;
      this.game.sellOutfit(this.selectedOutfit!);
      this.render();
    });
  }
}

/**
 * The hull's gun and turret mounts. A hull that came with more weapons than its
 * limits allow reads as full rather than negative, so the row never shows
 * something like "8/4".
 */
function mountRow(g: Game): string {
  const m = g.mountStatus();
  const cell = (used: number, max: number) =>
    max > 0 ? `${Math.min(used, max)}/${max}` : "None";
  if (m.maxGuns <= 0 && m.maxTurrets <= 0) return "";
  return `
    <div class="gap"><span>Gun mounts:</span><b>${cell(m.guns, m.maxGuns)}</b></div>
    <div><span>Turret mounts:</span><b>${cell(m.turrets, m.maxTurrets)}</b></div>`;
}

/**
 * The gate network, drawn rather than listed. Nova ships no artwork for a gate
 * dialog — the interface pictures name a Spaceport, a Bar, a Map and so on, but
 * nothing for a gate — so this plots the destinations on their real galaxy-map
 * positions and draws a line to each. A wormhole gets a blank chart instead:
 * you are not told where it goes until you have been.
 */
function gateMap(here: SystemDef, dests: GateDestination[], wormhole: boolean): string {
  const points = dests.filter((d) => d.mapPos !== null);
  if (wormhole || points.length === 0) {
    return `<div class="gatemap empty">${
      wormhole ? "No destination lock. The far end is anyone's guess." : "No charted connections."
    }</div>`;
  }

  const W = 620;
  const H = 200;
  const PAD = 26;
  const xs = [here.mapPos.x, ...points.map((d) => d.mapPos!.x)];
  const ys = [here.mapPos.y, ...points.map((d) => d.mapPos!.y)];
  const minX = Math.min(...xs);
  const maxX = Math.max(...xs);
  const minY = Math.min(...ys);
  const maxY = Math.max(...ys);
  // keep the galaxy's aspect ratio so the network isn't stretched into nonsense
  const scale = Math.min((W - PAD * 2) / Math.max(1, maxX - minX), (H - PAD * 2) / Math.max(1, maxY - minY));
  const cx = (x: number) => W / 2 + (x - (minX + maxX) / 2) * scale;
  const cy = (y: number) => H / 2 + (y - (minY + maxY) / 2) * scale;

  const hx = cx(here.mapPos.x);
  const hy = cy(here.mapPos.y);
  const lines = points
    .map((d) => `<line x1="${hx}" y1="${hy}" x2="${cx(d.mapPos!.x)}" y2="${cy(d.mapPos!.y)}" class="gm-link"/>`)
    .join("");
  const stars = points
    .map((d) => {
      const i = dests.indexOf(d);
      const x = cx(d.mapPos!.x);
      const y = cy(d.mapPos!.y);
      // A hypergate posts its own network, so every end is named here even if
      // you have never flown there — the list below says the same. Ends you
      // haven't visited are simply drawn dimmer.
      return `<g class="gm-star${d.explored ? "" : " unvisited"}" data-star="${i}">
        <circle cx="${x}" cy="${y}" r="11" class="gm-hit"/>
        <circle cx="${x}" cy="${y}" r="4" class="gm-dot"/>
        <text x="${x}" y="${y - 11}" class="gm-label">${escapeHtml(d.systemName)}</text>
      </g>`;
    })
    .join("");

  return `<div class="gatemap">
    <svg viewBox="0 0 ${W} ${H}" preserveAspectRatio="xMidYMid meet">
      ${lines}
      <g class="gm-here">
        <circle cx="${hx}" cy="${hy}" r="5" class="gm-dot"/>
        <text x="${hx}" y="${hy + 20}" class="gm-label">${escapeHtml(here.name)}</text>
      </g>
      ${stars}
    </svg>
  </div>`;
}

/** Mission and world names come from the data files; never trust them as markup. */
function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

/**
 * A stable pseudo-random number in [0,1) for a key. Nova rolls each hull's
 * BuyRandom once a day; hashing the key rather than calling Math.random keeps
 * the lot from reshuffling on every re-render.
 */
function dailyRoll(key: string): number {
  let h = 2166136261;
  for (let i = 0; i < key.length; i++) {
    h ^= key.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return ((h >>> 0) % 100000) / 100000;
}
