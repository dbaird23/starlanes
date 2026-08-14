import { asset } from "../asset";
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
  shipInfoPict,
  WEAPONS,
} from "../data/universe";
import type { Game, GateDestination } from "../game/game";
import {
  MAX_ESCORTS,
  escortHireFee,
  escortWage,
} from "../game/game";
import { escortCargoCap } from "../game/cargo";
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
import {
  playAmbient,
  playMenuClose,
  playMenuOpen,
  stopAmbient,
} from "../engine/audio";
import type {
  ActiveMission,
  MissionType,
  PlanetDef,
  SystemDef,
} from "../types";
import { oopsPriceDelta, oopsesAt } from "../game/oops";
import { evalTest } from "../game/bits";
import { formatDate } from "../game/calendar";
import { actionMatchesKeydown } from "../keybindings";

/**
 * Spaceport keyboard shortcuts. The star map uses the prefs `map` binding
 * (Classic M), so the mission BBS takes N; the rest are the first letter of
 * the counter. R refuels. Mission log is the missionInfo binding.
 */
const PORT_KEYS: Record<string, View> = {
  KeyB: "bar",
  KeyN: "bbs",
  KeyT: "trade",
  KeyS: "shipyard",
  KeyO: "outfitter",
};

/**
 * Screens Esc backs out of. Each one already carries its own Back button, so
 * Esc presses that rather than setting the view itself — hire escorts / holovid
 * / gamble return to the bar, and the bar returns to the spaceport. The
 * spaceport and a gate are not in here: Esc leaves the planet from those,
 * which is Nova's own behaviour and predates this.
 */
const ESC_CLOSES = new Set<View>([
  "bar",
  "bbs",
  "trade",
  "outfitter",
  "shipyard",
  "escorts",
  "holovid",
  "gamble",
]);

/** The screens those keys work from: the counters, not the modal panels. */
const PORT_KEY_VIEWS = new Set<View>([
  "spaceport",
  "trade",
  "shipyard",
  "outfitter",
  "bar",
  "bbs",
  "escorts",
]);

/**
 * Landing-event / mission-offer dialogs. Enter fires the affirmative (or the
 * sole) button; Esc fires the negative when there is one, otherwise the same
 * sole dismiss. The Bible never names these keys — it only paints button art —
 * but this is the classic Mac/EV dialog contract.
 */
const MODAL_VIEWS = new Set<View>(["events", "offer"]);

type View =
  | "spaceport"
  | "trade"
  | "shipyard"
  | "outfitter"
  | "bar"
  | "bbs"
  | "offer"
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
const OUTF_SELL_ANYWHERE = 0x0800;
const OUTF_SUPPRESS_EQUAL_WEIGHT = 0x1000;
const OUTF_HIDE_UNLESS_AVAIL = 0x4000;

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
  private gambleResult: {
    winner: number;
    won: boolean;
    stake: number;
    payout: number;
  } | null = null;
  private barMissions: MissionType[] = [];
  /** Where to go when the events queue drains (default: spaceport). */
  private afterEventsView: View = "spaceport";
  private spaceportOffers: MissionType[] = [];
  /**
   * mïsn AvailLoc 4/5/6 — jobs handed over at the trade, shipyard and outfit
   * dialogs rather than the concourse or the board. Nova raises these as you
   * walk up to the counter, so they are keyed by the view that owns them and
   * popped on entry.
   */
  private counterOffers = new Map<View, MissionType[]>();
  private pendingOffer: {
    m: MissionType;
    active: ActiveMission;
    back: View;
  } | null = null;
  private shipOfferFrom: string | null = null;
  /** focused spaceport service button id (e.g. "btn-bar") for arrow-key nav */
  private selectedPort: string | null = null;
  /** focused hypergate destination index */
  private selectedGate = 0;
  /** focused bar action button id */
  private selectedBar: string | null = null;

  private toastEl = document.getElementById("landed-toast")!;
  private toastTimer = 0;

  private toast(msg: string): void {
    this.toastEl.textContent = msg;
    this.toastEl.classList.remove("hidden", "fading");
    clearTimeout(this.toastTimer);
    this.toastTimer = window.setTimeout(() => {
      this.toastEl.classList.add("fading");
      this.toastTimer = window.setTimeout(
        () => this.toastEl.classList.add("hidden"),
        400,
      );
    }, 2600);
  }

  constructor(game: Game) {
    this.game = game;
    this.root = document.getElementById("landed-ui")!;
    window.addEventListener("keydown", (e) => {
      if (this.root.classList.contains("hidden")) return;
      const typing = document.activeElement?.tagName === "INPUT";
      // anything this handler acts on must not reach the game loop as well
      const handled = (): void => this.game.swallowKey(e.code);
      /*
       * Mission log (I) is the shared InfoUi panel — not a landed counter.
       * When it is up, Esc / I / Enter go there; every other key is blocked so
       * port shortcuts cannot fire underneath. When it is closed, the
       * missionInfo binding opens it from any counter (not over a focused
       * text field).
       */
      if (this.game.infoOpen) {
        if (e.code === "Escape") {
          e.preventDefault();
          handled();
          this.game.escapeInfo();
          return;
        }
        if (actionMatchesKeydown(e, "missionInfo")) {
          e.preventDefault();
          handled();
          this.game.openMissionInfo();
          return;
        }
        if (e.code === "Enter" || e.code === "NumpadEnter") {
          e.preventDefault();
          handled();
          // abort confirm accepts Enter; otherwise inert
          this.game.enterInfo();
          return;
        }
        if (e.code === "KeyA" && !e.altKey && !e.ctrlKey && !e.metaKey) {
          e.preventDefault();
          handled();
          this.game.abortInfo();
          return;
        }
        if (e.code === "ArrowDown") {
          e.preventDefault();
          handled();
          this.game.arrowInfo(1);
          return;
        }
        if (e.code === "ArrowUp") {
          e.preventDefault();
          handled();
          this.game.arrowInfo(-1);
          return;
        }
        if (
          e.code.startsWith("Key") ||
          e.code.startsWith("Arrow") ||
          e.code === "Tab"
        ) {
          e.preventDefault();
          handled();
        }
        return;
      }
      if (!typing && actionMatchesKeydown(e, "missionInfo")) {
        e.preventDefault();
        handled();
        this.game.openMissionInfo();
        return;
      }
      /*
       * Trade quantity dialog is modal over the exchange. Esc cancels; Enter
       * confirms even while the number field is focused. Other keys still
       * type into the input when it has focus; they are otherwise swallowed
       * so B/S/T cannot re-fire under the overlay.
       */
      if (this.tradeQty) {
        if (e.code === "Escape") {
          e.preventDefault();
          handled();
          this.tradeQty = null;
          this.render();
          return;
        }
        if (e.code === "Enter" || e.code === "NumpadEnter") {
          e.preventDefault();
          handled();
          this.root.querySelector<HTMLButtonElement>("#tc-qty-ok")?.click();
          return;
        }
        if (typing) return;
        // block port / list keys under the overlay
        if (
          e.code.startsWith("Key") ||
          e.code.startsWith("Arrow") ||
          e.code === "Tab"
        ) {
          e.preventDefault();
          handled();
        }
        return;
      }
      if (typing) return;
      /*
       * The shipyard's Info dialog is modal: Esc closes it, and nothing else
       * reaches the counter underneath — otherwise Esc would leave the
       * shipyard from behind an open dialog, and S/O/T would switch counters
       * while it was still up. It sits over the shipyard, so it is checked
       * ahead of the mission dialogs and of the arrow-key list navigation.
       */
      if (this.shipInfoOpen) {
        if (e.code === "Escape" || e.code === "Enter") {
          e.preventDefault();
          handled();
          this.shipInfoOpen = false;
          this.render();
        }
        return;
      }
      // mission / landing dialogs take Enter and Esc before counter shortcuts
      if (this.handleModalKeys(e.code)) {
        e.preventDefault();
        handled();
        return;
      }
      if (this.planet && e.code === "Escape" && ESC_CLOSES.has(this.view)) {
        e.preventDefault();
        handled();
        const back = this.root.querySelector<HTMLButtonElement>("#btn-back");
        if (back) back.click();
        else {
          this.setView("spaceport");
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
       * Trade / outfitter / shipyard: B buys and S sells the focused item.
       * These take priority over the port-letter shortcuts (B → bar, S →
       * shipyard) while you are already at the counter — otherwise B would
       * leave for the bar mid-purchase. Shipyard has no Sell button, so S is
       * inert there.
       */
      if (
        this.planet &&
        (this.view === "trade" ||
          this.view === "outfitter" ||
          this.view === "shipyard") &&
        (e.code === "KeyB" || e.code === "KeyS")
      ) {
        e.preventDefault();
        handled();
        const buySel =
          this.view === "trade"
            ? "#tc-buy"
            : this.view === "outfitter"
              ? "#btn-buy-outfit"
              : "#btn-buy-ship";
        const sellSel =
          this.view === "trade"
            ? "#tc-sell"
            : this.view === "outfitter"
              ? "#btn-sell-outfit"
              : null;
        const sel = e.code === "KeyB" ? buySel : sellSel;
        if (sel) {
          const btn = this.root.querySelector<HTMLButtonElement>(sel);
          if (btn && !btn.disabled) btn.click();
        }
        return;
      }
      // Mission BBS: A accepts the selected posting (Enter does not).
      if (
        this.planet &&
        this.view === "bbs" &&
        e.code === "KeyA" &&
        !e.altKey &&
        !e.ctrlKey &&
        !e.metaKey
      ) {
        e.preventDefault();
        handled();
        const btn =
          this.root.querySelector<HTMLButtonElement>("#btn-bbs-accept");
        if (btn && !btn.disabled) btn.click();
        return;
      }
      /*
       * The spaceport's own keys. Nova lets you reach every counter from the
       * keyboard rather than the buttons, and these work from any of the port
       * screens, so you can go straight from the outfitter to the shipyard
       * without stopping at the spaceport in between. The map binding is
       * owned by prefs (not a PORT_KEYS letter), so the mission BBS takes N.
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
          this.setView("spaceport");
          return;
        }
      }
      // Map binding from prefs — same action as in flight. On the board or a
      // mission offer, preview that job's destination.
      if (this.planet && actionMatchesKeydown(e, "map")) {
        e.preventDefault();
        handled();
        const sel =
          this.view === "offer"
            ? this.pendingOffer?.m
            : this.view === "bbs"
              ? this.bbsMissions.find((m) => m.id === this.selectedMisn)
              : undefined;
        if (sel) this.showOnMap(sel);
        else this.game.openMap();
        return;
      }
      // Arrow keys step through the current menu's list or grid; Enter acts on
      // the selection (Accept / Buy / Hire / open the focused port button, …).
      if (this.planet && this.handleMenuNav(e.code)) {
        e.preventDefault();
        handled();
      }
    });
  }

  /**
   * Enter / Esc on landing-event and mission-offer dialogs. Marks and clicks
   * the buttons tagged in the markup (`data-modal-default` / `data-modal-cancel`).
   */
  private handleModalKeys(code: string): boolean {
    if (!MODAL_VIEWS.has(this.view)) return false;
    if (code !== "Enter" && code !== "Escape") return false;

    const def = this.modalDefaultButton();
    const cancel = this.modalCancelButton();

    if (code === "Enter") {
      // only the affirmative — never fire Decline via Enter (Esc is for that)
      if (def && !def.disabled) {
        def.click();
        return true;
      }
      return false;
    }

    // Escape: negative when present, else the same button as Enter (Continue)
    const esc = cancel ?? def;
    if (esc && !esc.disabled) {
      esc.click();
      return true;
    }
    return false;
  }

  /** Affirmative / sole action: Accept, Continue, … */
  private modalDefaultButton(): HTMLButtonElement | null {
    return this.root.querySelector<HTMLButtonElement>("[data-modal-default]");
  }

  /**
   * Negative action: Refuse / Decline. Absent on one-button dialogs and on
   * can't-refuse offers that still fit (Esc then does nothing harmful — it
   * will not Accept).
   */
  private modalCancelButton(): HTMLButtonElement | null {
    return this.root.querySelector<HTMLButtonElement>("[data-modal-cancel]");
  }

  /**
   * Paint keyboard focus on the dialog's default button. If Accept is disabled
   * (cargo won't fit) but Decline is present, highlight Decline so Esc's target
   * is visible — Enter still will not fire it.
   */
  private markModalFocus(): void {
    this.root
      .querySelectorAll(".evbtn.sel")
      .forEach((b) => b.classList.remove("sel"));
    const def = this.modalDefaultButton();
    const cancel = this.modalCancelButton();
    const focus = def && !def.disabled ? def : (cancel ?? def);
    focus?.classList.add("sel");
  }

  /**
   * Keyboard navigation for landed menus. Lists answer Up/Down; icon grids
   * also take Left/Right so you move cell-by-cell the way the mouse does.
   * Movement wraps at the ends (top↔bottom, first↔last cell in a row/column).
   * Returns true when the key was consumed so the browser does not scroll.
   */
  private handleMenuNav(code: string): boolean {
    const up = code === "ArrowUp";
    const down = code === "ArrowDown";
    const left = code === "ArrowLeft";
    const right = code === "ArrowRight";
    const enter = code === "Enter";
    if (!up && !down && !left && !right && !enter) return false;

    if (enter) return this.activateSelection();

    const dy = up ? -1 : down ? 1 : 0;
    const dx = left ? -1 : right ? 1 : 0;

    switch (this.view) {
      case "trade": {
        if (dx !== 0) return false;
        const ids = [
          ...this.root.querySelectorAll<HTMLElement>(".tc-row[data-id]"),
        ].map((el) => el.dataset.id!);
        return this.stepLinear(
          ids,
          this.selectedGood,
          (id) => {
            this.selectedGood = id;
            this.tradeNote = "";
          },
          dy,
        );
      }
      case "bbs": {
        if (dx !== 0) return false;
        const ids = this.bbsMissions.map((m) => String(m.id));
        const cur =
          this.selectedMisn != null ? String(this.selectedMisn) : null;
        return this.stepLinear(
          ids,
          cur,
          (id) => {
            const list = this.root.querySelector<HTMLElement>(".misn-list");
            if (list) this.misnScroll = list.scrollTop;
            this.selectedMisn = parseInt(id, 10);
          },
          dy,
          () =>
            this.scrollSelInto(".misn-list", ".misn-item.sel", (t) => {
              this.misnScroll = t;
            }),
        );
      }
      case "shipyard": {
        const ids = [
          ...this.root.querySelectorAll<HTMLElement>(".oi-cell[data-id]"),
        ].map((el) => el.dataset.id!);
        return this.stepGrid(
          ids,
          this.selectedShip,
          (id) => {
            this.selectedShip = id;
          },
          3,
          dx,
          dy,
          "shop",
        );
      }
      case "outfitter": {
        const ids = [
          ...this.root.querySelectorAll<HTMLElement>(".oi-cell[data-id]"),
        ].map((el) => el.dataset.id!);
        return this.stepGrid(
          ids,
          this.selectedOutfit,
          (id) => {
            this.selectedOutfit = id;
          },
          4,
          dx,
          dy,
          "shop",
        );
      }
      case "escorts": {
        const ids = [
          ...this.root.querySelectorAll<HTMLElement>(".oi-cell[data-id]"),
        ].map((el) => el.dataset.id!);
        return this.stepGrid(
          ids,
          this.selectedHire,
          (id) => {
            this.selectedHire = id;
          },
          4,
          dx,
          dy,
          "hire",
        );
      }
      case "spaceport": {
        const ids = this.portButtonIds();
        if (!ids.length) return false;
        // two columns of services — Up/Down move within a column, Left/Right
        // hop to the same slot on the other side
        const leftIds = ids.filter((id) =>
          ["btn-bar", "btn-bbs", "btn-trade"].includes(id),
        );
        const rightIds = ids.filter((id) =>
          [
            "btn-shipyard",
            "btn-outfitter",
            "btn-refuel",
            "btn-depart",
          ].includes(id),
        );
        const inLeft = leftIds.indexOf(this.selectedPort ?? "");
        const inRight = rightIds.indexOf(this.selectedPort ?? "");
        if (dy !== 0) {
          const col = inLeft >= 0 ? leftIds : inRight >= 0 ? rightIds : leftIds;
          const idx = inLeft >= 0 ? inLeft : inRight >= 0 ? inRight : 0;
          return this.stepLinear(
            col,
            col[idx] ?? null,
            (id) => {
              this.selectedPort = id;
            },
            dy,
          );
        }
        if (dx !== 0) {
          // hop columns; wrap so Left on the left column (and Right on the
          // right) still crosses, matching vertical list wrap
          if (inLeft >= 0 && rightIds.length) {
            this.selectedPort = rightIds[Math.min(inLeft, rightIds.length - 1)];
            this.render();
            return true;
          }
          if (inRight >= 0 && leftIds.length) {
            this.selectedPort = leftIds[Math.min(inRight, leftIds.length - 1)];
            this.render();
            return true;
          }
          return true;
        }
        return false;
      }
      case "gate": {
        if (dx !== 0) return false;
        const n = this.root.querySelectorAll(".ship-card[data-row]").length;
        if (n === 0) return false;
        const next = (((this.selectedGate + dy) % n) + n) % n;
        if (next === this.selectedGate) return true;
        this.selectedGate = next;
        this.render();
        return true;
      }
      case "gamble": {
        if (this.gambleResult || dy !== 0) return false;
        const cur = this.gamblePick ?? 0;
        const next = (((cur + dx) % 4) + 4) % 4;
        if (this.gamblePick === next && this.gamblePick !== null) return true;
        this.gamblePick = next;
        this.gambleResult = null;
        this.render();
        return true;
      }
      case "bar": {
        if (dy !== 0) return false;
        const ids = [
          "btn-hire",
          "btn-gamble",
          "btn-holovid",
          "btn-back",
        ].filter((id) => this.root.querySelector(`#${id}`));
        return this.stepLinear(
          ids,
          this.selectedBar,
          (id) => {
            this.selectedBar = id;
          },
          dx,
        );
      }
      default:
        return false;
    }
  }

  /**
   * Enter on the focused item. Spaceport / bar / gate act on the selection.
   * Shop counters do not buy on Enter (B / S); the mission BBS does not
   * accept on Enter (A does).
   */
  private activateSelection(): boolean {
    switch (this.view) {
      // BBS accept is A only — Enter must not take a job by accident.
      case "bbs":
      // Trade / outfitter / shipyard: never buy on Enter (use B / S).
      case "trade":
      case "outfitter":
      case "shipyard":
        return false;
      case "escorts": {
        const btn = this.root.querySelector<HTMLButtonElement>("#btn-hire-sel");
        if (btn && !btn.disabled) {
          btn.click();
          return true;
        }
        return false;
      }
      case "spaceport": {
        if (!this.selectedPort) return false;
        const btn = this.root.querySelector<HTMLButtonElement>(
          `#${this.selectedPort}`,
        );
        if (btn && !btn.disabled) {
          btn.click();
          return true;
        }
        return false;
      }
      case "gate": {
        const btn = this.root.querySelector<HTMLButtonElement>(
          `button[data-gate="${this.selectedGate}"]`,
        );
        if (btn) {
          btn.click();
          return true;
        }
        return false;
      }
      case "bar": {
        if (!this.selectedBar) return false;
        const btn = this.root.querySelector<HTMLButtonElement>(
          `#${this.selectedBar}`,
        );
        if (btn) {
          btn.click();
          return true;
        }
        return false;
      }
      default:
        return false;
    }
  }

  private portButtonIds(): string[] {
    return [
      ...this.root.querySelectorAll<HTMLButtonElement>(
        ".portbtn:not(:disabled)",
      ),
    ]
      .map((b) => b.id)
      .filter(Boolean);
  }

  private stepLinear(
    ids: string[],
    current: string | null,
    apply: (id: string) => void,
    delta: number,
    after?: () => void,
  ): boolean {
    if (!ids.length || delta === 0) return false;
    let idx = current != null ? ids.indexOf(current) : 0;
    if (idx < 0) idx = 0;
    // wrap: Up on the first item lands on the last, Down on the last → first
    const next = (((idx + delta) % ids.length) + ids.length) % ids.length;
    if (ids[next] === current) return true;
    apply(ids[next]);
    this.render();
    after?.();
    return true;
  }

  private stepGrid(
    ids: string[],
    current: string | null,
    apply: (id: string) => void,
    cols: number,
    dx: number,
    dy: number,
    scroll: "shop" | "hire",
  ): boolean {
    if (!ids.length || (dx === 0 && dy === 0)) return false;
    let idx = current != null ? ids.indexOf(current) : 0;
    if (idx < 0) idx = 0;
    const col = idx % cols;
    const row = Math.floor(idx / cols);
    let next = idx;
    if (dx !== 0) {
      // wrap within this row (last row may be shorter than cols)
      const rowStart = row * cols;
      const rowLen = Math.min(cols, ids.length - rowStart);
      const colInRow = idx - rowStart;
      const nextCol = (((colInRow + dx) % rowLen) + rowLen) % rowLen;
      next = rowStart + nextCol;
    } else {
      // wrap within this column top↔bottom
      const colItems: number[] = [];
      for (let i = col; i < ids.length; i += cols) colItems.push(i);
      let pos = colItems.indexOf(idx);
      if (pos < 0) pos = 0;
      const nextPos =
        (((pos + dy) % colItems.length) + colItems.length) % colItems.length;
      next = colItems[nextPos];
    }
    if (ids[next] === current) return true;
    // keep the grid scrolled where the player left it before we rebuild HTML
    const gridNow = this.root.querySelector<HTMLElement>(".oi-grid");
    if (gridNow) {
      if (scroll === "shop") this.shopScroll = gridNow.scrollTop;
      else this.hireScroll = gridNow.scrollTop;
    }
    apply(ids[next]);
    this.render();
    this.scrollSelInto(".oi-grid", ".oi-cell.sel", (t) => {
      if (scroll === "shop") this.shopScroll = t;
      else this.hireScroll = t;
    });
    return true;
  }

  private scrollSelInto(
    containerSel: string,
    itemSel: string,
    store: (scrollTop: number) => void,
  ): void {
    const container = this.root.querySelector<HTMLElement>(containerSel);
    const item = this.root.querySelector<HTMLElement>(itemSel);
    if (!container || !item) return;
    item.scrollIntoView({ block: "nearest" });
    store(container.scrollTop);
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
      (view === "bbs" && p.uninhabited);
    if (missing) return;
    this.setView(view);
  }

  /**
   * Switch landed screens with menu open/close cues (snd 600 / 601).
   * Returning to the spaceport is a close; leaving it (or swapping counters)
   * is an open.
   */
  private setView(view: View): void {
    if (this.view === view) {
      this.render();
      return;
    }
    if (view === "spaceport") playMenuClose();
    else playMenuOpen();
    // Opening the bar focuses Leave so Enter gets you out without an arrow hop.
    if (view === "bar") this.selectedBar = "btn-back";
    this.view = view;
    this.render();
    this.maybeCounterOffer(view);
    if (view === "bar") this.maybeBarOffer();
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
    this.offers.clear();
    this.bbsMissions = planet.uninhabited
      ? []
      : availableMissions(planet, 0, this.game.player);
    this.barMissions = planet.bar
      ? availableMissions(planet, 1, this.game.player)
      : [];
    this.spaceportOffers = planet.uninhabited
      ? []
      : availableMissions(planet, 3, this.game.player);
    this.mapsBoughtThisLanding.clear();
    // AvailLoc 4/5/6 hang off the three storefronts rather than the concourse
    this.counterOffers.clear();
    if (planet.exchange)
      this.counterOffers.set(
        "trade",
        availableMissions(planet, 4, this.game.player),
      );
    if (planet.shipyard)
      this.counterOffers.set(
        "shipyard",
        availableMissions(planet, 5, this.game.player),
      );
    if (planet.outfitter)
      this.counterOffers.set(
        "outfitter",
        availableMissions(planet, 6, this.game.player),
      );

    this.view = this.events.length > 0 ? "events" : "spaceport";
    // Fresh landings focus Leave so Enter gets you back in the air quickly.
    this.selectedPort = "btn-depart";
    this.root.classList.remove("hidden");
    playMenuOpen();
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
    playMenuOpen();
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
    this.counterOffers.clear();
    this.selectedGate = 0;
    this.view = "gate";
    this.root.classList.remove("hidden");
    playMenuOpen();
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
    if (this.selectedGate >= dests.length)
      this.selectedGate = Math.max(0, dests.length - 1);
    const rows = dests
      .map(
        (
          d,
          i,
        ) => `<div class="ship-card${i === this.selectedGate ? " hot" : ""}" data-row="${i}">
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

    // keyboard selection and hover light the matching star on the mini-map
    const rowEls = [
      ...this.root.querySelectorAll<HTMLElement>(".ship-card[data-row]"),
    ];
    const starEls = [...this.root.querySelectorAll<SVGElement>("[data-star]")];
    const highlight = (i: number) => {
      rowEls.forEach((el, n) => el.classList.toggle("hot", n === i));
      starEls.forEach((el) =>
        el.classList.toggle("hot", el.dataset.star === String(i)),
      );
    };
    highlight(this.selectedGate);
    rowEls.forEach((el, i) => {
      el.addEventListener("mouseenter", () => {
        this.selectedGate = i;
        highlight(i);
      });
    });
    starEls.forEach((el) => {
      const i = parseInt(el.dataset.star!, 10);
      el.addEventListener("mouseenter", () => {
        this.selectedGate = i;
        highlight(i);
      });
      el.addEventListener("click", () => {
        const dest = dests[i];
        if (dest) this.game.useGate(dest.spobId);
      });
    });

    this.root
      .querySelector("#btn-leave-gate")!
      .addEventListener("click", () => this.game.depart());
    this.root.querySelectorAll("button[data-gate]").forEach((btn) => {
      btn.addEventListener("click", () => {
        const idx = parseInt((btn as HTMLButtonElement).dataset.gate!, 10);
        const dest = dests[idx];
        if (dest) this.game.useGate(dest.spobId);
      });
    });
  }

  /**
   * Bar missions (AvailLoc 1) pop up automatically when entering the bar,
   * one at a time, rather than appearing as a list to click through.
   * Shifts from barMissions so each is offered exactly once per landing.
   */
  private maybeBarOffer(): void {
    const m = this.barMissions.shift();
    if (m) this.openOffer(m, "bar");
  }

  /** Story missions offered right in the spaceport (AvailLoc 3) pop up on landing — one per visit. */
  private maybeSpaceportOffer(): void {
    const m = this.spaceportOffers.shift();
    this.spaceportOffers = [];
    if (m) this.openOffer(m, "spaceport");
  }

  /**
   * A storefront mission (AvailLoc 4/5/6) raised on stepping up to the
   * counter, and returning to it when the offer is answered. One per landing,
   * as at the spaceport — otherwise refusing would immediately raise the next.
   */
  private maybeCounterOffer(view: View): void {
    const queued = this.counterOffers.get(view);
    if (!queued || queued.length === 0) return;
    const m = queued[0];
    this.counterOffers.set(view, []);
    this.openOffer(m, view);
  }

  private openOffer(m: MissionType, back: View): void {
    const active = this.offerFor(m);
    this.pendingOffer = { m, active, back };
    this.setView("offer");
  }

  hide(): void {
    if (this.planet) playMenuClose();
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
    // the Info dialog belongs to the shipyard; anything that leaves closes it
    if (this.view !== "shipyard") this.shipInfoOpen = false;
    // quantity chooser is trade-only
    if (this.view !== "trade") this.tradeQty = null;
    if (this.view === "spaceport") this.renderSpaceport();
    else if (this.view === "trade") this.renderTrade();
    else if (this.view === "shipyard") this.renderShipyard();
    else if (this.view === "outfitter") this.renderOutfitter();
    else if (this.view === "bar") this.renderBar();
    else if (this.view === "bbs") this.renderBbs();
    else if (this.view === "offer") this.renderOffer();
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
      const target = this.afterEventsView;
      this.afterEventsView = "spaceport";
      this.setView(target);
      if (target === "spaceport") this.maybeSpaceportOffer();
      return;
    }
    this.root.innerHTML = `
      <div class="panel">
        <h1>${ev.title}</h1>
        ${this.statusBar()}
        <p class="desc">${ev.text.replace(/\n/g, "</p><p class='desc'>")}</p>
        <div class="btnrow">
          <button class="evbtn primary" id="btn-continue" data-modal-default>Continue</button>
        </div>
      </div>`;
    this.markModalFocus();
    this.root.querySelector("#btn-continue")!.addEventListener("click", () => {
      this.events.shift();
      this.render();
    });
  }

  private renderOffer(): void {
    const offer = this.pendingOffer;
    if (!offer) {
      this.setView("spaceport");
      return;
    }
    const { m, active, back } = offer;
    const text = substituteTags(
      offerText(m),
      m,
      active,
      this.game.pilotName,
      this.game.rankTags(),
    );
    const cantRefuse = (m.flags & 0x0004) !== 0;
    // mission freight rides in your own hull, so escort holds don't count
    const freeSpace = this.game.holdSpace();
    const fits = !active.cargoLoaded || active.cargoQty <= freeSpace;
    const noSpaceNote = fits
      ? ""
      : `<p class="hint warn">This job needs ${active.cargoQty} tons free <em>in your own hold</em> — you have ${Math.max(0, freeSpace)}. Your escorts cannot carry it. Sell some cargo or fly a bigger ship.</p>`;
    this.root.innerHTML = `
      <div class="panel">
        <h1>${escapeHtml(active.name)}<span class="sys">${this.shipOfferFrom ?? this.planet!.name}</span></h1>
        ${this.statusBar()}
        <p class="desc">${text.replace(/\n/g, "</p><p class='desc'>")}</p>
        ${active.cargoQty > 0 && active.cargoName ? `<p class="hint">Cargo: ${active.cargoQty}t of ${active.cargoName}${m.timeLimit > 0 ? ` · Time limit: ${m.timeLimit} days` : ""}</p>` : m.timeLimit > 0 ? `<p class="hint">Time limit: ${m.timeLimit} days</p>` : ""}
        ${noSpaceNote}
        <div class="btnrow">
          ${cantRefuse && back === "shipOffer"
            ? '<button class="evbtn primary" id="btn-accept" data-modal-default>Okay</button>'
            : `<button class="evbtn primary" id="btn-accept" data-modal-default ${fits ? "" : "disabled"}>Accept</button>
          ${!cantRefuse ? '<button class="evbtn" id="btn-refuse" data-modal-cancel>Refuse</button>' : ""}
          ${cantRefuse && !fits ? '<button class="evbtn" id="btn-decline" data-modal-cancel>Decline</button>' : ""}
          <button class="evbtn" id="btn-offer-map">Map</button>`}
        </div>
      </div>`;
    this.markModalFocus();

    const done = () => {
      this.pendingOffer = null;
      if (back === "shipOffer") {
        // radio offers happen in flight: close the overlay entirely
        this.shipOfferFrom = null;
        this.view = "spaceport";
        this.root.classList.add("hidden");
        this.root.innerHTML = "";
        playMenuClose();
        return;
      }
      this.setView(back);
      if (back === "spaceport") this.maybeSpaceportOffer();
    };
    this.root.querySelector("#btn-accept")!.addEventListener("click", () => {
      const result = this.game.acceptMission(m, active);
      if (!result.ok) {
        if (result.reason) this.toast(result.reason);
        return;
      }
      this.bbsMissions = this.bbsMissions.filter((x) => x.id !== m.id);
      this.barMissions = this.barMissions.filter((x) => x.id !== m.id);
      this.offers.delete(m.id);
      const brief = descText(m.briefText);
      if (brief) {
        this.events.push({
          title: escapeHtml(active.name),
          text: substituteTags(
            brief,
            m,
            active,
            this.game.pilotName,
            this.game.rankTags(),
          ),
        });
        this.pendingOffer = null;
        if (back === "bar") this.afterEventsView = "bar";
        this.setView("events");
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
    this.root
      .querySelector("#btn-decline")
      ?.addEventListener("click", () => done());
    this.root
      .querySelector("#btn-offer-map")
      ?.addEventListener("click", () => this.showOnMap(m));
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
        (
          m,
        ) => `<div class="misn-item${m.id === this.selectedMisn ? " sel" : ""}"
          data-misn="${m.id}">${escapeHtml(this.offerFor(m).name)}</div>`,
      )
      .join("");

    let detail = '<p class="desc">Nothing posted here right now.</p>';
    let accept = '<button class="evbtn" disabled>Accept</button>';
    if (sel) {
      const active = this.offerFor(sel);
      const text = substituteTags(
        offerText(sel),
        sel,
        active,
        g.pilotName,
        g.rankTags(),
      );
      const freeSpace = g.holdSpace(); // own hull only — escorts can't take it
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
          ${fits ? "" : `<p class="hint warn">Needs ${active.cargoQty} tons free in your own hold — you have ${Math.max(0, freeSpace)}.</p>`}
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
      this.misnScroll = 0;
      this.setView("spaceport");
    });
    this.root
      .querySelector("#btn-bbs-accept")
      ?.addEventListener("click", () => {
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
      if (result.reason) this.toast(result.reason);
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
        text: substituteTags(
          brief,
          m,
          active,
          this.game.pilotName,
          this.game.rankTags(),
        ),
      });
      this.pendingOffer = null;
      this.setView("events");
    } else {
      this.setView(back);
    }
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
        s.techLevel > 0 &&
        (s.techLevel <= p.techLevel || p.specialTechs.includes(s.techLevel));
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
          <div class="oi-icon">${pic ? `<img src="${asset(`nova/picts/${pic.file}`)}" alt="">` : ""}</div>
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
      // the Bible lets only the two trader AIs haul for you — see cargo.ts
      const hauls = escortCargoCap(this.selectedHire);
      const can = !full && g.player.credits >= fee;
      // dësc 14000 + shipID - 128 is the pilot standing beside the hull
      const pilot = DESCS[String(14000 + Number(this.selectedHire) - 128)];
      const pic = shipyardPict(this.selectedHire);
      desc = `<div class="oi-desc">${
        pilot
          ? resolveNovaText(pilot, g.player.bits)
          : escapeHtml(s.name.split(";")[0])
      }</div>`;
      side = `${
        pic
          ? `<div class="oi-hero"><img src="${asset(`nova/picts/${pic.file}`)}" alt=""></div>`
          : '<div class="oi-hero placeholder"></div>'
      }
        <div class="oi-info">
          <div><span>Hiring Price:</span><b>${fee.toLocaleString()} cr</b></div>
          <div><span>You Have:</span><b>${g.player.credits.toLocaleString()} cr</b></div>
          <div class="gap"><span>Daily Wage:</span><b>${wage.toLocaleString()} cr</b></div>
          <div><span>Carries For You:</span><b>${
            hauls
              ? `${hauls} t`
              : `None <small>(${s.cargo} t, warship crew)</small>`
          }</b></div>
        </div>`;
      hireBtn = `<button class="evbtn" id="btn-hire-sel" ${can ? "" : "disabled"}>${btnLabel(12, "Hire Escort")}</button>`;
    }

    const daily = g.player.escorts.reduce((sum, e) => sum + e.wage, 0);
    const hired = g.player.escorts
      .map((e) => {
        const s = SHIPS[e.shipId];
        const hauls = escortCargoCap(e.shipId);
        const status = e.captured
          ? `Captured prize`
          : `In your service · ${e.wage.toLocaleString()} cr/day`;
        const pending = e.pendingSell
          ? ` · <em>pending sale</em>`
          : e.pendingUpgrade
            ? ` · <em>pending upgrade</em>`
            : "";
        return `<div class="ship-card">
          <div class="ship-info">
            <div class="ship-name">${escapeHtml(s?.name.split(";")[0] ?? "Ship")}</div>
            <div class="ship-stats">${status}${hauls ? ` · carries ${hauls} t` : ""}${pending}</div>
          </div>
        </div>`;
      })
      .join("");

    this.root.innerHTML = `
      <div class="panel wide">
        <h1>Hire Escorts<span class="sys">${escapeHtml(p.name)}</span></h1>
        ${this.statusBar()}
        <div class="oi-body">
          <div class="oi-grid">${
            cells ||
            '<p class="menu-empty">No pilots are looking for work today.</p>'
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
                g.fleetCapacity() > 0 ? ` — ${g.fleetCapacity()} t of hold` : ""
              }${full ? " — your command is full" : ""}</h2>
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
      if (!res.ok && res.reason) this.toast(res.reason);
      this.render();
    });
    this.root.querySelector("#btn-back")!.addEventListener("click", () => {
      this.setView("bar");
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
      ? `<div class="land-hero dim" style="background-image:url('${asset(`nova/picts/${p.landingPictFile}`)}')"></div>`
      : "";
    const missionRows = this.barMissions
      .map((m) => this.missionRow(m, "bar"))
      .join("");
    const barBtns: [string, string][] = [
      ["btn-hire", btnLabel(12, "Hire Escort")],
      ["btn-gamble", btnLabel(10, "Gamble")],
      ["btn-holovid", btnLabel(11, "Holovid")],
      ["btn-back", btnLabel(0, "Leave")],
    ];
    if (!this.selectedBar || !barBtns.some(([id]) => id === this.selectedBar)) {
      this.selectedBar = "btn-back";
    }
    const barBtnHtml = barBtns
      .map(
        ([id, label]) =>
          `<button class="evbtn${id === this.selectedBar ? " sel" : ""}" id="${id}">${label}</button>`,
      )
      .join("");
    this.root.innerHTML = `
      <div class="panel">
        ${hero}
        <h1>Bar<span class="sys">${p.name}</span></h1>
        ${this.statusBar()}
        <p class="desc">${line}</p>
        ${barDesc ? "" : `<p class="desc">${govtLine}</p>`}
        <div class="btnrow">
          ${barBtnHtml}
        </div>
        ${missionRows ? `<div class="ship-list">${missionRows}</div>` : ""}
      </div>`;
    const go = (id: string, view: View) =>
      this.root
        .querySelector(id)
        ?.addEventListener("click", () => this.setView(view));
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
    const picId =
      govtId >= 128 ? (GOVT_NEWS_PICS[String(govtId)] ?? 9000) : 9000;
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
        ${pic ? `<div class="holovid-pic"><img src="${asset(`nova/picts/${pic.file}`)}" alt=""></div>` : ""}
        <div class="holovid-feed">
          ${items.map((t) => `<p class="desc">${escapeHtml(t)}</p>`).join("")}
        </div>
        <div class="btnrow">
          <button class="evbtn" id="btn-back">${btnLabel(0, "Leave")}</button>
        </div>
      </div>`;
    this.root.querySelector("#btn-back")!.addEventListener("click", () => {
      this.setView("bar");
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
        const state = result
          ? i === result.winner
            ? "won"
            : "idle"
          : i === picked
            ? "picked"
            : "idle";
        const pic = racer(i, state);
        return `<button class="race-cell${i === picked ? " sel" : ""}" data-racer="${i}" ${result ? "disabled" : ""}>
          ${pic ? `<img src="${asset(`nova/picts/${pic.file}`)}" alt="${RACER_NAMES[i]}">` : RACER_NAMES[i]}
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
      banner =
        "You're tuned to GRN, Galaxy Racing Network! Choose your color for the next race.";
    } else if (!stakes.length) {
      banner =
        STR_LISTS["2002"]?.[360] ??
        "Sorry, you don't have enough credits to bet today.";
    } else {
      banner = `${RACER_NAMES[picked]} it is. ${STR_LISTS["2002"]?.[371] ?? "Amount to bet:"}`;
    }

    const betRow =
      !result && picked !== null && stakes.length
        ? stakes
            .map(
              (v) =>
                `<button class="evbtn" data-bet="${v}">${btnLabel(v === 1000 ? 13 : 14, `Bet ${v}`)}</button>`,
            )
            .join("")
        : "";

    this.root.innerHTML = `
      <div class="panel">
        <h1>Galaxy Racing Network<span class="sys">${p.name}</span></h1>
        ${this.statusBar()}
        <div class="race-stage"${bg ? ` style="background-image:url('${asset(`nova/picts/${bg.file}`)}')"` : ""}>
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
      this.setView("bar");
    });
  }

  private statusBar(): string {
    const g = this.game;
    // the fleet figure, with the escorts' share called out where there is one
    const fleet = g.fleetCapacity();
    const cargo = `${g.cargoUsed()} / ${g.cargoCapacity()} t`;
    return `<div class="statusbar">
      <span>Credits: <b>${g.player.credits.toLocaleString()} cr</b></span>
      <span>Cargo: <b>${cargo}</b>${fleet ? ` <small>(${fleet}t in escorts)</small>` : ""}</span>
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
    const note =
      local && mult !== 1 ? ` — prices here at ${Math.round(mult * 100)}%` : "";
    return `<p class="hint">Known here as <b>${rank.convName || rank.name}</b>${note}.</p>`;
  }

  private renderSpaceport(): void {
    const p = this.planet!;
    const sys = this.system!;
    const g = this.game;
    const fuelCost = g.refuelCost();
    const tanksFull = g.player.fuelJumps >= g.player.maxFuelJumps;
    const canRefuel = g.canRefuel();

    const govt = sys.govtName ? ` · ${sys.govtName}` : "";
    const refuelLabel = p.uninhabited
      ? "No services"
      : tanksFull
        ? "Fuel tanks full"
        : fuelCost === 0
          ? "Refuel (free)"
          : g.player.credits < fuelCost
            ? `Need ${fuelCost.toLocaleString()} cr`
            : `Refuel (${fuelCost.toLocaleString()} cr)`;

    const hero = p.landingPictFile
      ? `<div class="land-hero" style="background-image:url('${asset(`nova/picts/${p.landingPictFile}`)}')"></div>`
      : "";
    // Nova puts the services down either side of the description: bar, board
    // and exchange on the left, the two shops on the right, Leave beneath.
    // each counter names its key in the tooltip; the handler is in the ctor
    const portBtn = (
      id: string,
      title: string,
      label: string,
      disabled = false,
    ) =>
      `<button class="portbtn${this.selectedPort === id ? " sel" : ""}" id="${id}" title="${title}"${
        disabled ? " disabled" : ""
      }>${label}</button>`;
    const left = [
      p.bar ? portBtn("btn-bar", "Bar (B)", "Bar") : "",
      p.uninhabited ? "" : portBtn("btn-bbs", "Mission BBS (N)", "Mission BBS"),
      p.exchange
        ? portBtn("btn-trade", "Trade Center (T)", "Trade Center")
        : "",
    ].join("");
    const right = [
      p.shipyard ? portBtn("btn-shipyard", "Shipyard (S)", "Shipyard") : "",
      p.outfitter ? portBtn("btn-outfitter", "Outfitter (O)", "Outfitter") : "",
      portBtn("btn-refuel", "Refuel (R)", refuelLabel, !canRefuel),
      '<span class="port-gap"></span>',
      portBtn("btn-depart", "Leave (L)", "Leave"),
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

    // keep arrow focus on a live button after refuel or when a service is missing
    const live = this.portButtonIds();
    if (!this.selectedPort || !live.includes(this.selectedPort)) {
      this.selectedPort = live.includes("btn-depart")
        ? "btn-depart"
        : (live[0] ?? null);
      if (this.selectedPort) {
        this.root.querySelectorAll(".portbtn").forEach((b) => {
          b.classList.toggle("sel", b.id === this.selectedPort);
        });
      }
    }

    this.root
      .querySelector("#btn-trade")
      ?.addEventListener("click", () => this.setView("trade"));
    this.root
      .querySelector("#btn-shipyard")
      ?.addEventListener("click", () => this.setView("shipyard"));
    this.root
      .querySelector("#btn-outfitter")
      ?.addEventListener("click", () => this.setView("outfitter"));
    this.root
      .querySelector("#btn-bar")
      ?.addEventListener("click", () => this.setView("bar"));
    this.root
      .querySelector("#btn-bbs")
      ?.addEventListener("click", () => this.setView("bbs"));
    this.root
      .querySelector("#btn-escorts")
      ?.addEventListener("click", () => this.setView("escorts"));
    this.root.querySelector("#btn-refuel")!.addEventListener("click", () => {
      this.game.refuel();
      this.render();
    });
    this.root
      .querySelector("#btn-depart")!
      .addEventListener("click", () => this.game.depart());
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
    // commodities pool across the wing; trader escorts widen this
    const space = g.cargoSpace();

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
      const sells =
        j.soldAt.includes(spobId) && evalTest(j.buyOn, g.player.bits);
      const buys =
        j.boughtAt.includes(spobId) && evalTest(j.sellOn, g.player.bits);
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
    const note = running.length
      ? running.map((o) => o.def.name).join(". ") + "."
      : "";

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
      </div>
      ${this.tradeQtyDialog()}`;

    this.root
      .querySelectorAll<HTMLElement>(".tc-row[data-id]")
      .forEach((row) => {
        row.addEventListener("click", () => {
          if (this.tradeQty) return;
          this.selectedGood = row.dataset.id!;
          this.tradeNote = "";
          this.render();
        });
      });
    const openQty = (dir: "buy" | "sell") => {
      if (!sel) return;
      const most =
        dir === "buy"
          ? Math.min(space, Math.floor(g.player.credits / sel.price))
          : sel.have;
      if (most <= 0) return;
      this.tradeQty = {
        dir,
        key: sel.key,
        name: sel.name,
        price: sel.price,
        max: most,
      };
      this.render();
    };
    this.root
      .querySelector("#tc-buy")
      ?.addEventListener("click", () => openQty("buy"));
    this.root
      .querySelector("#tc-sell")
      ?.addEventListener("click", () => openQty("sell"));
    this.root.querySelector("#btn-back")!.addEventListener("click", () => {
      this.tradeNote = "";
      this.tradeQty = null;
      this.setView("spaceport");
    });
    this.bindTradeQtyDialog();
  }

  /**
   * Quantity chooser for Buy / Sell — replaces the browser `prompt`. Mirrors
   * Nova's "Enter quantity" line (STR# 2002/370) inside the landed UI chrome.
   */
  private tradeQtyDialog(): string {
    const q = this.tradeQty;
    if (!q) return "";
    const verb = q.dir === "buy" ? "Buy" : "Sell";
    const prompt =
      STR_LISTS["2002"]?.[370] ?? "Enter quantity:";
    const total = q.price * q.max;
    return `
      <div class="tc-qty-back" role="dialog" aria-label="${escapeHtml(prompt)}">
        <div class="panel tc-qty">
          <h2>${verb} ${escapeHtml(q.name)}</h2>
          <p class="menu-hint">${q.price.toLocaleString()} cr each · max ${q.max.toLocaleString()} ton${q.max === 1 ? "" : "s"}</p>
          <label class="tc-qty-label" for="tc-qty-input">${escapeHtml(prompt)}</label>
          <div class="tc-qty-row">
            <input id="tc-qty-input" type="number" min="1" max="${q.max}" value="${q.max}" inputmode="numeric">
            <button class="evbtn" type="button" id="tc-qty-max">Max</button>
          </div>
          <p class="tc-qty-total" id="tc-qty-total">${verb === "Buy" ? "Cost" : "Proceeds"}: ${total.toLocaleString()} cr</p>
          <div class="btnrow">
            <button class="evbtn" type="button" id="tc-qty-cancel">Cancel</button>
            <button class="evbtn primary" type="button" id="tc-qty-ok">${verb}</button>
          </div>
        </div>
      </div>`;
  }

  private bindTradeQtyDialog(): void {
    const q = this.tradeQty;
    if (!q) return;
    const input = this.root.querySelector<HTMLInputElement>("#tc-qty-input");
    const totalEl = this.root.querySelector<HTMLElement>("#tc-qty-total");
    if (!input || !totalEl) return;

    const clamp = (): number => {
      const raw = parseInt(input.value, 10);
      if (!Number.isFinite(raw)) return 0;
      return Math.max(0, Math.min(q.max, raw));
    };
    const paintTotal = (): void => {
      const n = clamp();
      const verb = q.dir === "buy" ? "Cost" : "Proceeds";
      totalEl.textContent = `${verb}: ${(n * q.price).toLocaleString()} cr`;
    };
    input.addEventListener("input", paintTotal);
    input.addEventListener("change", () => {
      const n = clamp();
      input.value = n > 0 ? String(n) : "";
      paintTotal();
    });
    this.root.querySelector("#tc-qty-max")!.addEventListener("click", () => {
      input.value = String(q.max);
      paintTotal();
      input.focus();
      input.select();
    });
    this.root.querySelector("#tc-qty-cancel")!.addEventListener("click", () => {
      this.tradeQty = null;
      this.render();
    });
    this.root.querySelector("#tc-qty-ok")!.addEventListener("click", () => {
      const qty = clamp();
      if (qty <= 0) {
        input.focus();
        input.select();
        return;
      }
      const g = this.game;
      const before = g.player.cargo[q.key] ?? 0;
      if (q.dir === "buy") g.buy(q.key, qty, q.price);
      else g.sell(q.key, qty, q.price);
      const moved = Math.abs((g.player.cargo[q.key] ?? 0) - before);
      this.tradeNote = moved
        ? `You ${q.dir === "buy" ? "bought" : "sold"} ${moved} ton${moved === 1 ? "" : "s"} of ${q.name}.`
        : "";
      this.tradeQty = null;
      this.render();
    });
    // Focus after the DOM is live so Enter confirms without an extra click.
    requestAnimationFrame(() => {
      input.focus();
      input.select();
    });
  }

  private selectedGood: string | null = null;
  private tradeNote = "";
  /**
   * Open quantity dialog for a Buy/Sell. Null when the exchange list is free
   * to use. Cleared when leaving the trade centre or cancelling.
   */
  private tradeQty: {
    dir: "buy" | "sell";
    key: string;
    name: string;
    price: number;
    max: number;
  } | null = null;
  private selectedShip: string | null = null;
  /** whether the shipyard's Info dialog is up over the showroom */
  private shipInfoOpen = false;
  private selectedOutfit: string | null = null;
  /** keeps the shop list where the user left it across re-renders */
  private shopScroll = 0;
  /** map outfits (mod type 16) bought during this landing; cleared on show(). */
  private mapsBoughtThisLanding = new Set<string>();

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
    for (let i = 0; i < bands.length; i++)
      if (value < bands[i]) return words[i];
    return words[words.length - 1];
  }

  private renderShipyard(): void {
    const p = this.planet!;
    const g = this.game;
    const current = SHIPS[g.player.shipId];
    const tradeIn = current ? Math.floor(current.cost * 0.25) : 0;
    /*
     * Trading down pays out. A hull worth less than a quarter of the one you
     * are flying would read a flat "0 cr", which looks like broken data when
     * most of the lot says it at once — a captured Leviathan does that to 69
     * of the 85 purchasable hulls. Show the change instead.
     */
    const netLabel = (net: number) =>
      net > 0
        ? `${net.toLocaleString()} cr`
        : net < 0
          ? `${(-net).toLocaleString()} cr back`
          : "free";

    // BuyRandom is the percent chance this hull is on the lot on a given
    // day; 0 means never, which is what keeps Nova's AI-only variants and
    // things like the Cargo Drone out of the showroom. The roll is keyed on
    // the day and the world so the lot holds still while you're docked but
    // turns over as time passes.
    const day = Math.floor(g.player.date);
    const available = SHIP_ORDER.filter((id) => {
      const s = SHIPS[id];
      const techOk =
        s.techLevel > 0 &&
        (s.techLevel <= p.techLevel || p.specialTechs.includes(s.techLevel));
      if (!techOk || s.cost <= 0 || s.buyRandom <= 0) return false;
      if (!evalTest(s.avail, g.player.bits, testContext(g.player)))
        return false;
      if (id === g.player.shipId) return true; // your own hull is always listed
      return dailyRoll(`${p.id}|${id}|${day}`) * 100 < s.buyRandom;
    });
    if (!this.selectedShip || !available.includes(this.selectedShip)) {
      this.selectedShip = available[0] ?? null;
    }

    const cells = available
      .map((id) => {
        const s = SHIPS[id];
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
            pict ? `<img src="${asset(`nova/picts/${pict.file}`)}" alt="">` : ""
          }</div>
          <div class="oi-name">${label}</div>
        </div>`;
      })
      .join("");

    let desc = '<p class="menu-empty">Nothing for sale here.</p>';
    let side = "";
    let buy = '<button class="evbtn" disabled>Buy</button>';
    let info = '<button class="evbtn" disabled>Info</button>';
    if (this.selectedShip) {
      const s = SHIPS[this.selectedShip];
      const pict = shipyardPict(this.selectedShip);
      const sprite = SHIP_SPRITES[this.selectedShip];
      const listPrice = this.shopPrice(s.cost);
      const price = listPrice - tradeIn;
      const isCurrent = this.selectedShip === g.player.shipId;
      const canBuy = !isCurrent && g.player.credits >= price;
      const [name] = s.name.split(";");
      const fullName = s.longName || name;

      const hero = pict
        ? `<img class="sy-hero" src="${asset(`nova/picts/${pict.file}`)}" alt="${name}">`
        : sprite
          ? `<div class="sy-hero sprite" style="background-image:url('${asset(`nova/sprites/${sprite.file}`)}');
              background-size:${sprite.frames * 100}% 100%"></div>`
          : '<div class="sy-hero placeholder"></div>';

      /*
       * Nova's own price block, in Nova's own order: what the hull lists at,
       * what your current one is worth against it, the difference, and what
       * you are carrying. It sits under the picture on the right rather than
       * being repeated in every grid cell. The stat block this replaced now
       * lives in shipInfoDialog(), behind the Info button.
       */
      side = `
        ${hero}
        <div class="sy-fullname">${escapeHtml(fullName)}</div>
        <div class="sy-prices">
          <div><span>Ship Price:</span><b>${listPrice.toLocaleString()} cr</b></div>
          <div><span>Trade-In:</span><b>${tradeIn.toLocaleString()} cr</b></div>
          <div class="gap"><span>Final Price:</span><b>${
            isCurrent ? "&mdash;" : netLabel(price)
          }</b></div>
          <div class="gap"><span>You Have:</span><b>${g.player.credits.toLocaleString()} cr</b></div>
        </div>`;
      desc = `<div class="oi-desc">${resolveNovaText(s.desc, g.player.bits)}</div>`;
      buy = `<button class="evbtn" id="btn-buy-ship" ${canBuy ? "" : "disabled"}>${
        isCurrent
          ? "Your ship"
          : price < 0
            ? `Trade — ${(-price).toLocaleString()} cr back`
            : `Buy — ${price.toLocaleString()} cr`
      }</button>`;
      info = '<button class="evbtn" id="btn-ship-info">Info</button>';
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
          ${info}
          ${buy}
          <button class="evbtn primary" id="btn-back">${btnLabel(4, "Done")}</button>
        </div>
      </div>
      ${this.shipInfoDialog()}`;

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
      this.shopScroll = 0;
      this.setView("spaceport");
    });
    this.root.querySelector("#btn-buy-ship")?.addEventListener("click", () => {
      const result = this.game.buyShip(this.selectedShip!);
      if (!result.ok && result.reason) this.toast(result.reason);
      this.render();
    });
    this.root.querySelector("#btn-ship-info")?.addEventListener("click", () => {
      this.shopScroll = list.scrollTop;
      this.shipInfoOpen = true;
      this.render();
    });
    this.root.querySelector("#sy-info-done")?.addEventListener("click", () => {
      this.shipInfoOpen = false;
      this.render();
    });
  }

  /**
   * The shipyard's Info dialog. Nova puts the hull's full specification behind
   * an Info button rather than crowding it into the showroom, and backs it with
   * a 600x400 render of the ship in space (PICT 20000 + shipID) instead of the
   * grey-card shot the lot uses. Returns "" unless the dialog is open, so the
   * shipyard's own markup carries it and one render() draws both.
   */
  private shipInfoDialog(): string {
    if (!this.shipInfoOpen || !this.selectedShip) return "";
    const s = SHIPS[this.selectedShip];
    const [name] = s.name.split(";");
    const fullName = s.longName || name;

    // The Kestrel and the Escape Pod have no 20000-series render; they fall
    // back to the showroom shot rather than showing an empty frame.
    const pict =
      shipInfoPict(this.selectedShip) ?? shipyardPict(this.selectedShip);
    const hero = pict
      ? `<img class="sy-info-hero" src="${asset(`nova/picts/${pict.file}`)}" alt="${escapeHtml(name)}">`
      : '<div class="sy-info-hero placeholder"></div>';

    const weapons = s.stockWeapons.length
      ? s.stockWeapons
          .map((w) => {
            const wp = WEAPONS[String(w.id)];
            return escapeHtml(
              `${w.count} ${wp ? wp.name.split(";")[0] : `Weapon ${w.id}`}`,
            );
          })
          .join("<br>")
      : "None";

    const col = (rows: [string, string][]) =>
      rows.map(([k, v]) => `<div><span>${k}</span><b>${v}</b></div>`).join("");

    // shïp Subtitle — "Class A" on a Starbridge; empty on most hulls
    const subtitle = s.subtitle?.trim();

    return `
      <div class="sy-info-back">
        <div class="panel sy-info">
          ${hero}
          <div class="sy-info-name">${escapeHtml(fullName)}${
            subtitle
              ? `<span class="sy-info-sub">${escapeHtml(subtitle)}</span>`
              : ""
          }</div>
          <div class="sy-stats">
            <div class="sy-col">${col([
              ["Speed:", String(s.rawSpeed)],
              ["Accel:", LandedUi.rate(s.rawAccel, [150, 300, 450, 700])],
              ["Turn:", LandedUi.rate(s.rawTurn, [15, 25, 35, 55])],
              ["Shields:", String(s.shield)],
              ["Armor:", String(s.armor)],
              ["Guns:", s.maxGuns > 0 ? `Maximum of ${s.maxGuns}` : "None"],
              [
                "Turrets:",
                s.maxTurrets > 0 ? `Maximum of ${s.maxTurrets}` : "None",
              ],
            ])}</div>
            <div class="sy-col">${col([
              ["Space:", `${s.freeMass} tons`],
              ["Cargo:", `${s.cargo} tons`],
              ["Energy:", `${s.fuelJumps} jumps`],
              ["Length:", `${s.length} m`],
              ["Mass:", `${s.mass} tons`],
              ["Crew:", String(s.crew)],
            ])}</div>
            <div class="sy-col">
              <div class="sy-weap-head">Standard Weapons:</div>
              <div class="sy-weap">${weapons}</div>
            </div>
          </div>
          <div class="btnrow">
            <button class="evbtn primary" id="sy-info-done">${btnLabel(4, "Done")}</button>
          </div>
        </div>
      </div>`;
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
    /** Is this world actually trading in the item today? */
    const tradedHere = (id: string): boolean => {
      const o = OUTFITS[id];
      const techOk =
        o.techLevel > 0 &&
        (o.techLevel <= p.techLevel || p.specialTechs.includes(o.techLevel));
      if (!techOk || o.cost <= 0) return false;
      const availOk = evalTest(o.avail, g.player.bits, testContext(g.player));
      // 0x4000 hides an item until its Availability comes true; without that
      // flag Nova still lists it, just refuses to sell it (handled at buy time).
      if ((o.flags & OUTF_HIDE_UNLESS_AVAIL) !== 0 && !availOk) return false;
      // 0x0100 does the same against the Require bits, which we don't model —
      // so those items stay hidden unless already owned.
      if ((o.flags & OUTF_HIDE_UNLESS_REQUIRE) !== 0) return false;
      /*
       * BuyRandom is the percent chance the item is on the shelf on a given
       * day, exactly as for hulls. Zero means never, which is what keeps the
       * 51 story-granted items — the Vell-os mind powers, the Bureau Bomb —
       * out of the shops entirely; the other 155 turn over as time passes.
       */
      if (o.buyRandom <= 0) return false;
      return dailyRoll(`${p.id}|o${id}|${outfitDay}`) * 100 < o.buyRandom;
    };
    /*
     * The shelf is what this world trades. Items the player owns but that
     * aren't stocked here do not appear. Flags 0x0800 "can be sold anywhere,
     * regardless of tech level" is still honoured at buy/sell time for items
     * that happen to appear via the tech filter.
     */
    const inStock = OUTFIT_ORDER.filter((id) => tradedHere(id));
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
        if (Number(w) === o.displayWeight && Number(id) > Number(maskerId))
          return false;
      }
      return true;
    });
    /*
     * spöb Flags2 0x0400 (sellOnly): the outfitter will buy anything the
     * player owns but stocks nothing itself. Sirrusa is the only shipped
     * example. Owned items are added to the grid so you can select and sell
     * them; buy is still disabled because none of them are stocked.
     */
    const ownedIds = p.sellOnly
      ? new Set(OUTFIT_ORDER.filter((id) => ownedCount(id) > 0))
      : new Set<string>();
    const shown = p.sellOnly
      ? OUTFIT_ORDER.filter((id) => available.includes(id) || ownedIds.has(id))
      : available;
    if (!this.selectedOutfit || !shown.includes(this.selectedOutfit)) {
      this.selectedOutfit = shown[0] ?? null;
    }

    /** How many of an outfit the player owns (ammo reads from player.ammo; maps show 0). */
    const ownedCount = (id: string): number => {
      const o = OUTFITS[id];
      const ammMod = o.mods.find((m) => m.type === 3);
      if (ammMod) {
        const weapId = String(ammMod.val >= 128 ? ammMod.val : 128 + ammMod.val);
        return g.player.ammo[weapId] ?? 0;
      }
      // Maps (mod type 16) are consumed on purchase; don't show a quantity badge.
      if (o.mods.some((m) => m.type === 16)) return 0;
      return g.player.outfits[id] ?? 0;
    };

    const cells = shown
      .map((id) => {
        const o = OUTFITS[id];
        const owned = ownedCount(id);
        const [name] = o.name.split(";");
        const pict = outfitPict(id);
        return `<div class="oi-cell${id === this.selectedOutfit ? " sel" : ""}" data-id="${id}">
          ${owned > 0 ? `<span class="oi-qty">${owned}</span>` : ""}
          <div class="oi-icon">${
            pict ? `<img src="${asset(`nova/picts/${pict.file}`)}" alt="">` : ""
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
      const owned = ownedCount(id);
      const isAmmo = o.mods.some((m) => m.type === 3);
      const isMap = o.mods.some((m) => m.type === 16);
      const price = this.shopPrice(o.cost);
      const free = g.freeMassLeft();
      const atMax = o.max > 0 && owned >= o.max && !isAmmo && !isMap;
      const tooHeavy = o.mass > 0 && free < o.mass;
      const tooPoor = g.player.credits < price;
      const noMount = g.mountBlock(id);
      const stocked = tradedHere(id);
      const alreadyMapped = isMap && this.mapsBoughtThisLanding.has(id);
      const canBuy = stocked && !atMax && !tooHeavy && !tooPoor && !noMount && !alreadyMapped;
      const sellsHere =
        p.sellOnly || stocked || (o.flags & OUTF_SELL_ANYWHERE) !== 0;
      const canSell =
        owned > 0 && sellsHere && (o.flags & OUTF_CANT_SELL) === 0;
      const pict = outfitPict(id);
      const [name, subtitle] = o.name.split(";");

      desc = `<div class="oi-desc">${resolveNovaText(o.desc, g.player.bits)}</div>`;
      hero = pict
        ? `<img class="oi-hero" src="${asset(`nova/picts/${pict.file}`)}" alt="${name}">`
        : `<div class="oi-hero placeholder">${name}</div>`;

      // Nova's own wording for why a purchase is blocked
      const status = !stocked
        ? sellsHere
          ? "Not sold here."
          : "Not traded here."
        : atMax
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
      this.shopScroll = 0;
      this.setView("spaceport");
    });
    this.root
      .querySelector("#btn-buy-outfit")
      ?.addEventListener("click", () => {
        this.shopScroll = grid.scrollTop;
        const outfId = this.selectedOutfit!;
        const result = this.game.buyOutfit(outfId);
        if (!result.ok && result.reason) this.toast(result.reason);
        if (result.ok && OUTFITS[outfId]?.mods.some((m) => m.type === 16)) {
          this.mapsBoughtThisLanding.add(outfId);
        }
        this.render();
      });
    this.root
      .querySelector("#btn-sell-outfit")
      ?.addEventListener("click", () => {
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
function gateMap(
  here: SystemDef,
  dests: GateDestination[],
  wormhole: boolean,
): string {
  const points = dests.filter((d) => d.mapPos !== null);
  if (wormhole || points.length === 0) {
    return `<div class="gatemap empty">${
      wormhole
        ? "No destination lock. The far end is anyone's guess."
        : "No charted connections."
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
  const scale = Math.min(
    (W - PAD * 2) / Math.max(1, maxX - minX),
    (H - PAD * 2) / Math.max(1, maxY - minY),
  );
  const cx = (x: number) => W / 2 + (x - (minX + maxX) / 2) * scale;
  const cy = (y: number) => H / 2 + (y - (minY + maxY) / 2) * scale;

  const hx = cx(here.mapPos.x);
  const hy = cy(here.mapPos.y);
  const lines = points
    .map(
      (d) =>
        `<line x1="${hx}" y1="${hy}" x2="${cx(d.mapPos!.x)}" y2="${cy(d.mapPos!.y)}" class="gm-link"/>`,
    )
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
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
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
