import { asset } from "../asset";
import { ui } from "../data/strings";
import {
  isTitleMusicEnabled,
  playMenuClose,
  playMenuOpen,
  playMusic,
  playSnd,
  playSndChain,
  preloadCoreSnds,
  setTitleMusicEnabled,
  SND,
  stopMusic,
  whenAudioRunning,
} from "../engine/audio";
import {
  COLR,
  MENU_SPRITES,
  SHIPS,
  STR_LISTS,
  UI_PICTS,
  targetPict,
} from "../data/universe";
import { formatDate } from "../game/calendar";
import {
  getSystemRecord,
  legalStatusName,
  ratingName,
} from "../game/reputation";
import {
  createPilot,
  deletePilot,
  describePilot,
  exportPilot,
  importPilot,
  isPilotDead,
  listPilots,
  loadPilot,
} from "../game/pilots";
import {
  ACTION_GROUPS,
  ACTION_IDS,
  bindingsForPreset,
  chordFromEvent,
  chordFromMouseEvent,
  chordsEqual,
  cloneBindings,
  customPresetLabel,
  CUSTOM_PRESET_VALUE,
  exportKeybindings,
  findCollisions,
  formatChord,
  KEYBINDING_PRESETS,
  matchPresetId,
  resolvePresetId,
  UNBOUND,
  type ActionId,
} from "../keybindings";
import {
  capsLockFastWhen,
  getKeybindingBasePreset,
  getKeybindings,
  setCapsLockFastWhen,
  setKeybindings,
  type CapsLockFastWhen,
} from "../settings";

/**
 * The title screen, rebuilt on Nova's own artwork. PICT 8000 is the 1024x768
 * cockpit backdrop; 8010 is a seven-frame flicker of the logo and 8030/8031/
 * 8032 stack into one animated column down the middle. Their positions were
 * recovered by correlating each frame against the backdrop, so everything
 * lines up the way the original composited it.
 */

const STAGE_W = 1024;
const STAGE_H = 768;

interface Overlay {
  pict: string;
  x: number;
  y: number;
  w: number;
  h: number;
  frames: number;
}

/*
 * Sizes and frame counts come from the sprites; every position on this screen
 * comes from cölr 128, which carries LogoX/Y, RolloverX/Y, the three Slide
 * positions and the six Button positions. These used to be read off that
 * resource by hand and typed in here; they are now taken from the data, so a
 * plug-in that moves the menu around works. The literals below are kept only
 * as the fallback for a scenario with no cölr.
 */
const LOGO: Overlay = {
  pict: "8010",
  x: 191,
  y: 162,
  w: 654,
  h: 209,
  frames: 7,
};

/**
 * The three pieces down the middle are not a loop: frame 0 has the buttons'
 * red backing plates retracted and the last frame has them fully out, so this
 * is a one-shot reveal. It plays once when the title screen opens, holds on
 * the last frame, and the buttons appear on the plates once it lands.
 *
 * Playback is time-based on rAF (not a stepped interval): with only ~10
 * source frames, discrete jumps look jerky on modern displays, so consecutive
 * frames are cross-faded and the whole motion is ease-out over REVEAL_MS.
 */
const COLUMN: Overlay[] = [
  { pict: "8030", x: 343, y: 399, w: 338, h: 63, frames: 11 },
  { pict: "8031", x: 337, y: 462, w: 351, h: 64, frames: 10 },
  { pict: "8032", x: 337, y: 526, w: 351, h: 65, frames: 11 },
];

/** Logo fire loop rate — a short cycle of similar frames, fine at low fps. */
const LOGO_MS_PER_FRAME = 125;
/** One-shot plate reveal duration (was ~11 × 120 ms of hard cuts). */
const REVEAL_MS = 560;

/** Overlay positions, overridden by cölr when the universe has loaded. */
function laidOut(
  o: Overlay,
  at: { x: number; y: number } | undefined,
): Overlay {
  return at ? { ...o, x: at.x, y: at.y } : o;
}
const logoOverlay = (): Overlay => laidOut(LOGO, COLR?.logo);
const columnOverlays = (): Overlay[] =>
  COLUMN.map((c, i) => laidOut(c, COLR?.slides[i]));
const emblemPos = (): { x: number; y: number } => COLR?.rollover ?? EMBLEM;
const buttonPos = (b: (typeof BUTTONS)[number]): { x: number; y: number } =>
  COLR?.buttons[b.colr] ?? b;

/**
 * The sphere in the middle of the emblem. rlëD 8020 is a seven-frame strip:
 * one icon per button, then the ATMOS glyphs as the resting frame. The frames
 * run in the buttons' own order — a figure in a pod (new pilot), transfer
 * arrows (open), an EXIT sign (quit), a figure boarding (enter ship), a form
 * (prefs), a question mark (about) — and the last frame is the ATMOS emblem.
 * The resource names confirm the slot: PICT 8020 is "Main menu rollover",
 * alongside 8050 "Main menu buttons".
 *
 * The position is Nova's own: cölr 128 carries RolloverX/Y, along with the six
 * button positions, the logo and the three sliding plates — every one of which
 * this file already matched exactly. This was the only one that didn't, and it
 * sat 14px low as a result.
 */
const EMBLEM = { x: 444, y: 465, w: 136, h: 98 };
const EMBLEM_SPRITE = "8020";
const EMBLEM_IDLE_FRAME = 6;

/**
 * The six buttons are rlëD 8050-8055 with their labels already painted on,
 * cut as angled slabs that nest against the emblem in the middle. Each row
 * has its own width and inset — they are not a uniform column — so these
 * positions were measured rather than guessed: the animated pieces 8030-8032
 * slide the buttons' red backing plates out, so differencing each piece's
 * first and last frame isolates exactly where a slab lands, and correlating
 * the sprite's alpha against that difference pins it down. All three rows
 * come out mirrored about x=512, the stage centre, which is the check that
 * the numbers are right.
 */
/*
 * `colr` indexes cölr's Button1-6, which run down the left column and then
 * down the right; this array is interleaved left/right because that is the
 * DOM order the buttons want. Mapping them positionally instead would put
 * "enter" where "open" belongs.
 */
const BUTTONS = [
  {
    id: "new",
    sprite: "8050",
    x: 349,
    y: 400,
    emblem: 0,
    colr: 0,
    key: "N",
  },
  {
    id: "enter",
    sprite: "8053",
    x: 555,
    y: 401,
    emblem: 3,
    colr: 3,
    key: "E",
  },
  {
    id: "open",
    sprite: "8051",
    x: 344,
    y: 464,
    emblem: 1,
    colr: 1,
    key: "O",
  },
  {
    id: "prefs",
    sprite: "8054",
    x: 581,
    y: 464,
    emblem: 4,
    colr: 4,
    key: "P",
  },
  {
    id: "quit",
    sprite: "8052",
    x: 345,
    y: 528,
    emblem: 2,
    colr: 2,
    key: "Q",
  },
  {
    id: "about",
    sprite: "8055",
    x: 580,
    y: 528,
    emblem: 5,
    colr: 5,
    key: "A",
  },
];

/** Quote a data-driven string safely into an HTML attribute. */
function escapeAttr(v: string): string {
  return v
    .replace(/&/g, "&amp;")
    .replace(/"/g, "&quot;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

export interface MainMenuHandlers {
  /** Title "Enter ship" — resume paused session if any, else load. */
  enterShip: (pilotId: string, strict?: boolean) => void;
  /** Open Pilot / New Pilot — always load from the saved pilot file. */
  loadPilot: (pilotId: string, strict?: boolean, difficulty?: "normal" | "hard") => void;
  /**
   * Write a newly created pilot's opening state. Nova's New Pilot flow ends
   * on the title screen, not in the cockpit — you pick Enter Ship yourself —
   * so creation has to persist without starting a session.
   */
  seedPilot: (
    pilotId: string,
    identity: {
      nickname: string;
      gender: "male" | "female";
      shipName: string;
    },
    strict: boolean,
    difficulty: "normal" | "hard",
  ) => void;
  /** Forget a paused session if that pilot file is deleted. */
  onDeletePilot?: (pilotId: string) => void;
}

/** Title screen / pilot management, shown over the starfield. */
export class MainMenu {
  private root: HTMLElement;
  private handlers: MainMenuHandlers;
  private selected: string | null = null;
  private animRaf: number | null = null;
  private animStart = 0;
  /** true once the plate reveal has finished (buttons may fade in) */
  private revealDone = false;
  /** plate whoosh (602+603) already fired for this open */
  private revealSfxPlayed = false;

  constructor(handlers: MainMenuHandlers) {
    this.root = document.getElementById("menu-ui")!;
    this.handlers = handlers;
    window.addEventListener("keydown", this.onTitleKey);
  }

  /**
   * @param preferPilotId when Esc pauses a live run, keep that pilot selected
   *   so Enter ship resumes it without hunting the list. Pass `null` after a
   *   death so the panel reads "No pilot loaded".
   */
  show(preferPilotId?: string | null): void {
    this.root.classList.remove("hidden");
    playMusic();
    preloadCoreSnds();
    const pilots = listPilots();
    if (preferPilotId === null) {
      // Death (or any explicit unload): nothing selected on the title screen.
      this.selected = null;
    } else if (
      preferPilotId &&
      pilots.some((p) => p.id === preferPilotId && !p.dead)
    ) {
      this.selected = preferPilotId;
    } else if (
      !this.selected ||
      !pilots.some((p) => p.id === this.selected && !p.dead)
    ) {
      this.selected = pilots.find((p) => !p.dead)?.id ?? null;
    }
    this.revealDone = false;
    this.revealSfxPlayed = false;
    this.animStart = performance.now();
    this.render();
    this.stopAnim();
    // snd 602+603 are one continuous plate cue, not two timed to the anim.
    // Chain them on the audio clock so there's no gap between the halves.
    this.playRevealSfx();
    const tick = (now: number) => {
      this.animRaf = requestAnimationFrame(tick);
      this.step(now);
    };
    this.animRaf = requestAnimationFrame(tick);
  }

  hide(): void {
    this.stopAnim();
    this.root.classList.add("hidden");
    this.root.innerHTML = "";
    stopMusic();
  }

  /**
   * Title-screen letter shortcuts (Nova-style). Only while the bare menu is
   * up — not over a modal, the intro, or a focused text field.
   * Esc closes simple modals (Open Pilot, About, New Pilot, notices).
   * Preferences installs its own capture-phase Esc handler for dirty confirm.
   */
  private onTitleKey = (e: KeyboardEvent): void => {
    if (this.root.classList.contains("hidden") || e.repeat) return;
    if (e.altKey || e.ctrlKey || e.metaKey) return;
    const modal = this.root.querySelector<HTMLElement>("#ttl-modal");
    if (modal && !modal.classList.contains("hidden")) {
      // Preferences owns Escape (rebind cancel + unsaved-discard confirm).
      if (modal.querySelector(".prefs-dialog")) return;
      if (e.code === "Escape") {
        e.preventDefault();
        modal.classList.add("hidden");
        playMenuClose();
        return;
      }
      // Keyboard nav for the Open Pilot list.
      if (modal.querySelector(".pilot-list")) {
        const pilots = listPilots();
        if (pilots.length > 0) {
          const idx = pilots.findIndex((p) => p.id === this.selected);
          if (e.code === "ArrowUp" || e.code === "ArrowDown") {
            e.preventDefault();
            const next =
              e.code === "ArrowUp"
                ? Math.max(0, idx - 1)
                : Math.min(pilots.length - 1, idx + 1);
            this.selected = pilots[next].id;
            this.render();
            this.openPilot();
            return;
          }
          if (e.code === "Enter" || e.code === "NumpadEnter") {
            e.preventDefault();
            if (this.selected && !isPilotDead(this.selected)) {
              this.hide();
              this.handlers.loadPilot(this.selected);
            }
            return;
          }
        }
      }
      return;
    }
    if (this.root.querySelector(".ttl-stage.intro")) return;
    const tag = (e.target as HTMLElement | null)?.tagName;
    if (tag === "INPUT" || tag === "TEXTAREA") return;

    const map: Record<string, string> = {
      KeyE: "enter",
      KeyO: "open",
      KeyP: "prefs",
      KeyN: "new",
      KeyA: "about",
      KeyQ: "quit",
    };
    const id = map[e.code];
    if (!id) return;
    e.preventDefault();
    this.onMenu(id);
  };

  /**
   * Plate whoosh: "Menu button start" then "Menu button end" abutted. Defers
   * via whenAudioRunning so a cold reload still gets it on first gesture.
   */
  private playRevealSfx(): void {
    whenAudioRunning(() => {
      if (this.root.classList.contains("hidden") || this.revealSfxPlayed)
        return;
      this.revealSfxPlayed = true;
      // mid-reveal: full chain. already landed (late unlock): land thud only.
      const elapsed = performance.now() - this.animStart;
      if (elapsed < REVEAL_MS) {
        playSndChain([SND.MENU_START, SND.MENU_END], 0.55);
      } else {
        playSnd(SND.MENU_END, 0.55);
      }
    });
  }

  private stopAnim(): void {
    if (this.animRaf !== null) {
      cancelAnimationFrame(this.animRaf);
      this.animRaf = null;
    }
  }

  /**
   * The logo keeps flickering; the plates run their reveal exactly once and
   * then stay put, at which point the buttons and emblem fade in.
   */
  private step(now: number): void {
    const elapsed = Math.max(0, now - this.animStart);

    const logo = this.root.querySelector<HTMLElement>(
      `[data-ov="${LOGO.pict}"]`,
    );
    if (logo) {
      const lf = Math.floor(elapsed / LOGO_MS_PER_FRAME) % logoOverlay().frames;
      const lo = logoOverlay();
      logo.style.backgroundPositionY = `${-(lf % lo.frames) * lo.h}px`;
    }

    if (this.revealDone) return;

    // ease-out cubic: snappy start, soft settle on the last frames
    const t = Math.min(1, elapsed / REVEAL_MS);
    const eased = 1 - (1 - t) ** 3;
    this.applyReveal(eased);

    if (t >= 1) {
      this.revealDone = true;
      this.applyReveal(1);
      this.root.querySelector(".ttl-stage")?.classList.add("ready");
    }
  }

  /**
   * Drive each sliding plate to a fractional frame index in [0, frames-1].
   * Two stacked layers cross-fade between floor/ceil so the motion isn't a
   * hard cut between the ~10 source frames.
   */
  private applyReveal(progress: number): void {
    for (const ov of columnOverlays()) {
      const el = this.root.querySelector<HTMLElement>(`[data-ov="${ov.pict}"]`);
      if (!el) continue;
      const maxF = ov.frames - 1;
      const pos = progress * maxF;
      const i0 = Math.floor(pos);
      const i1 = Math.min(i0 + 1, maxF);
      const frac = pos - i0;
      const a = el.querySelector<HTMLElement>('[data-layer="a"]');
      const b = el.querySelector<HTMLElement>('[data-layer="b"]');
      if (a && b) {
        a.style.backgroundPositionY = `${-i0 * ov.h}px`;
        b.style.backgroundPositionY = `${-i1 * ov.h}px`;
        b.style.opacity = String(frac);
      } else {
        // single-layer fallback
        el.style.backgroundPositionY = `${-Math.round(pos) * ov.h}px`;
      }
    }
  }

  /** The rollover strip in the sphere; the resting frame is the ATMOS glyphs. */
  private emblemHtml(): string {
    const spr = MENU_SPRITES[EMBLEM_SPRITE];
    if (!spr) return "";
    return `<div class="ttl-emblem" id="ttl-emblem" style="
      left:${emblemPos().x}px; top:${emblemPos().y}px; width:${spr.w}px; height:${spr.h}px;
      background-image:url('${asset(`nova/sprites/${spr.file}`)}');
      background-position-x:${-EMBLEM_IDLE_FRAME * spr.w}px"></div>`;
  }

  /** Swap the emblem to a button's icon, or back to the ATMOS glyphs. */
  private setEmblemFrame(frame: number): void {
    const spr = MENU_SPRITES[EMBLEM_SPRITE];
    const el = this.root.querySelector<HTMLElement>("#ttl-emblem");
    if (!spr || !el) return;
    el.style.backgroundPositionX = `${-Math.min(frame, spr.frames - 1) * spr.w}px`;
  }

  private overlayHtml(ov: Overlay, sliding = false): string {
    const pic = UI_PICTS[ov.pict];
    if (!pic) return "";
    const url = asset(`nova/picts/${pic.file}`);
    // sliding plates: two layers so consecutive frames can cross-fade
    if (sliding) {
      const last = this.revealDone ? ov.frames - 1 : 0;
      return `<div class="menu-ov menu-ov-slide" data-ov="${ov.pict}" style="
        left:${ov.x}px; top:${ov.y}px; width:${ov.w}px; height:${ov.h}px">
        <div class="menu-ov-layer" data-layer="a" style="
          background-image:url('${url}');
          background-position:0 ${-last * ov.h}px"></div>
        <div class="menu-ov-layer" data-layer="b" style="
          background-image:url('${url}');
          background-position:0 ${-last * ov.h}px; opacity:0"></div>
      </div>`;
    }
    return `<div class="menu-ov" data-ov="${ov.pict}" style="
      left:${ov.x}px; top:${ov.y}px; width:${ov.w}px; height:${ov.h}px;
      background-image:url('${url}')"></div>`;
  }

  /** The red readout the original prints along the bottom of the title screen. */
  private pilotPanel(): string {
    const state = this.selected ? loadPilot(this.selected) : null;
    const summary = listPilots().find((p) => p.id === this.selected);
    const field = (label: string, value: string) =>
      `<div class="ttl-field"><span>${label}</span><b>${value}</b></div>`;

    if (!state || !summary) {
      return `<div class="ttl-info left">${field(ui(251, "Pilot Name:"), "—")}</div>
        <div class="ttl-info right">${field("", ui(276, "No Pilot File Loaded"))}</div>`;
    }
    const ship = SHIPS[state.shipId];
    // the hull the pilot is flying, in the same red target silhouette the HUD
    // uses; variants without art of their own fall back to their base hull
    const tpic = targetPict(state.shipId);
    const silhouette = tpic
      ? `<div class="ttl-ship" style="
          background-image:url('${asset(`nova/picts/${tpic.file}`)}');
          width:${tpic.w}px; height:${tpic.h}px;
          margin-left:${-tpic.w / 2}px; margin-top:${-tpic.h / 2}px"></div>`
      : "";
    return `
      <div class="ttl-info left">
        ${field(ui(251, "Pilot Name:"), summary.name)}
        ${field(ui(255, "Ship Name:"), state.shipName || "—")}
        ${field(ui(256, "Ship Class:"), ship?.name.split(";")[0] ?? "—")}
      </div>
      ${silhouette}
      <div class="ttl-info right">
        ${field(`${ui(278, "Legal status in")} ${ui(279, "current system:")}`, legalStatusName(getSystemRecord(state, state.systemId)))}
        ${field(ui(254, "Combat Rating:"), ratingName(state.ratingPoints ?? 0))}
        ${field(ui(252, "Current Date:"), formatDate(state.date ?? 0))}
      </div>`;
  }

  private render(): void {
    const bg = UI_PICTS["8000"];
    // each button sheet is two frames wide: idle, then the lit rollover
    const buttons = BUTTONS.map((b) => {
      const spr = MENU_SPRITES[b.sprite];
      if (!spr) return "";
      const at = buttonPos(b);
      const label =
        b.id === "enter"
          ? "Enter ship"
          : b.id === "open"
            ? "Open pilot"
            : b.id === "prefs"
              ? "Set prefs"
              : b.id === "new"
                ? "New pilot"
                : b.id === "about"
                  ? "About"
                  : "Quit Nova";
      return `<button class="ttl-btn" data-menu="${b.id}" data-emblem="${b.emblem}" title="${label} (${b.key})" style="
        left:${at.x}px; top:${at.y}px; width:${spr.w}px; height:${spr.h}px;
        background-image:url('${asset(`nova/sprites/${spr.file}`)}');
        --hover-x:${-spr.w}px"></button>`;
    }).join("");

    this.root.innerHTML = `
      <div class="ttl-stage${this.revealDone ? " ready" : ""}"
        ${bg ? `style="background-image:url('${asset(`nova/picts/${bg.file}`)}')"` : ""}>
        ${this.overlayHtml(logoOverlay())}
        ${columnOverlays()
          .map((ov) => this.overlayHtml(ov, true))
          .join("")}
        ${this.emblemHtml()}
        ${buttons}
        ${this.pilotPanel()}
      </div>
      <div class="ttl-modal hidden" id="ttl-modal"></div>
      <input type="file" id="pilot-file" accept="application/json,.json" class="hidden">`;

    this.fitStage();
    window.addEventListener("resize", this.fitStage);

    this.root
      .querySelectorAll<HTMLButtonElement>("button[data-menu]")
      .forEach((btn) => {
        btn.addEventListener("click", () => this.onMenu(btn.dataset.menu!));
        // snd 600/601 are Nova's own "Menu button down"/"up" plate clicks
        // open/close cues (600/601) fire on the dialogs these buttons open
        // rolling over a button shows its icon in the middle of the emblem
        const frame = Number(btn.dataset.emblem);
        btn.addEventListener("mouseenter", () => this.setEmblemFrame(frame));
        btn.addEventListener("focus", () => this.setEmblemFrame(frame));
        btn.addEventListener("mouseleave", () =>
          this.setEmblemFrame(EMBLEM_IDLE_FRAME),
        );
        btn.addEventListener("blur", () =>
          this.setEmblemFrame(EMBLEM_IDLE_FRAME),
        );
      });
    this.root.querySelector("#pilot-file")!.addEventListener("change", (e) => {
      const file = (e.target as HTMLInputElement).files?.[0];
      if (!file) return;
      void file
        .text()
        .then((text) => {
          const { id } = importPilot(text);
          this.selected = id;
          this.render();
        })
        .catch((err: Error) => this.notice("Import failed", err.message));
    });
  }

  /** Scale the fixed 1024x768 stage to whatever the window gives us. */
  private fitStage = (): void => {
    const stage = this.root.querySelector<HTMLElement>(".ttl-stage");
    if (!stage) return;
    const k = Math.min(
      window.innerWidth / STAGE_W,
      window.innerHeight / STAGE_H,
    );
    stage.style.transform = `scale(${k})`;
  };

  private onMenu(id: string): void {
    switch (id) {
      case "new":
        this.newPilot();
        break;
      case "enter":
        if (this.selected && !isPilotDead(this.selected)) {
          this.hide();
          this.handlers.enterShip(this.selected);
        } else if (this.selected && isPilotDead(this.selected)) {
          this.notice(
            "Pilot deceased",
            "This pilot died in strict mode and cannot be flown again. Open Pilot to delete them, or start a new pilot.",
          );
        } else {
          this.newPilot();
        }
        break;
      case "open":
        this.openPilot();
        break;
      case "prefs":
        this.prefs();
        break;
      case "about":
        this.about();
        break;
      case "quit":
        this.notice(
          "Quit Nova",
          "There's no quitting a browser tab from inside it — close the tab when you're done. Progress is saved only when you leave a planet.",
        );
        break;
    }
  }

  private modal(html: string): HTMLElement {
    const m = this.root.querySelector<HTMLElement>("#ttl-modal")!;
    const wasOpen = !m.classList.contains("hidden");
    m.innerHTML = `<div class="ttl-dialog">${html}</div>`;
    m.classList.remove("hidden");
    if (!wasOpen) playMenuOpen();
    m.querySelectorAll<HTMLButtonElement>("[data-close]").forEach((b) =>
      b.addEventListener("click", () => {
        if (!m.classList.contains("hidden")) {
          m.classList.add("hidden");
          playMenuClose();
        }
      }),
    );
    return m;
  }

  /** Dismiss the open dialog without the close-click plumbing. */
  private closeModal(): void {
    const m = this.root.querySelector<HTMLElement>("#ttl-modal")!;
    if (!m.classList.contains("hidden")) m.classList.add("hidden");
  }

  private notice(title: string, body: string): void {
    this.modal(`<h2>${title}</h2><p>${body}</p>
      <div class="btnrow"><button class="evbtn primary" data-close>OK</button></div>`);
  }

  /**
   * Nova's New Pilot flow, in its own order: who you are (name, nickname,
   * gender), then the strict-play question on its own, then your ship's name
   * — and then it drops you back on the title screen to pick Enter Ship
   * yourself rather than launching you.
   *
   * The three fields open pre-filled from STR# 128 "Default Names", which
   * holds three suggestions of each in one flat list: 1-3 full names, 4-6
   * nicknames, 7-9 ship names. The grouping is not labelled in the resource
   * — it is confirmed by the original's own title screen, which shows a
   * fresh pilot flying the "Ring of Glory", entry 7.
   */
  private newPilot(): void {
    const names = STR_LISTS["128"] ?? [];
    const pick = (from: number, to: number, fallback: string): string => {
      const opts = names.slice(from, to).filter(Boolean);
      return opts.length
        ? opts[Math.floor(Math.random() * opts.length)]
        : fallback;
    };
    const suggested = {
      name: pick(0, 3, "Captain"),
      nickname: pick(3, 6, "Ace"),
      shipName: pick(6, 9, "Star Runner"),
    };

    const askShipName = (
      name: string,
      nickname: string,
      gender: "male" | "female",
      strict: boolean,
      difficulty: "normal" | "hard",
    ): void => {
      const m = this.modal(`
        <h2>Name Your Ship</h2>
        <p class="ttl-note">Every ship needs a name. This one is yours.</p>
        <label class="ttl-label">Ship name
          <input id="np-ship" type="text" value="${escapeAttr(suggested.shipName)}" maxlength="32">
        </label>
        <div class="btnrow">
          <button class="evbtn primary" id="np-done" data-modal-default>Create Pilot</button>
          <button class="evbtn" data-close data-modal-cancel>Cancel</button>
        </div>`);
      const shipEl = m.querySelector<HTMLInputElement>("#np-ship")!;
      shipEl.select();
      m.querySelector("#np-done")!.addEventListener("click", () => {
        const shipName = shipEl.value.trim() || suggested.shipName;
        const id = createPilot(strict ? `${name} †` : name);
        this.handlers.seedPilot(
          id,
          { nickname, gender, shipName },
          strict,
          difficulty,
        );
        /*
         * Back to the title screen with the new pilot selected, exactly as
         * the original leaves you: the chär intro sequence plays on Enter
         * Ship, from `Game.startPilot`, not here.
         */
        this.closeModal();
        this.show(id);
      });
    };

    const askStrict = (
      name: string,
      nickname: string,
      gender: "male" | "female",
    ): void => {
      const m = this.modal(`
        <h2>Strict Play</h2>
        <p class="ttl-note">In strict play a death is permanent — the pilot
          cannot be flown again. Otherwise you resume from the last world you
          left.</p>
        <fieldset class="ttl-fieldset">
          <legend>Difficulty</legend>
          <label class="ttl-check"><input type="radio" name="np-diff" value="normal" checked>
            Normal — enemies aim at your position</label>
          <label class="ttl-check"><input type="radio" name="np-diff" value="hard">
            Hard — enemies predict your movement</label>
        </fieldset>
        <div class="btnrow">
          <button class="evbtn" id="np-strict-yes">Strict play</button>
          <button class="evbtn primary" id="np-strict-no" data-modal-default>Normal play</button>
        </div>`);
      const diff = (): "normal" | "hard" =>
        (m.querySelector<HTMLInputElement>("input[name=np-diff]:checked")
          ?.value ?? "normal") as "normal" | "hard";
      m.querySelector("#np-strict-yes")!.addEventListener("click", () => {
        const d = diff();
        this.closeModal();
        askShipName(name, nickname, gender, true, d);
      });
      m.querySelector("#np-strict-no")!.addEventListener("click", () => {
        const d = diff();
        this.closeModal();
        askShipName(name, nickname, gender, false, d);
      });
    };

    const m = this.modal(`
      <h2>New Pilot</h2>
      <label class="ttl-label">Full name
        <input id="np-name" type="text" value="${escapeAttr(suggested.name)}" maxlength="32">
      </label>
      <label class="ttl-label">Nickname
        <input id="np-nick" type="text" value="${escapeAttr(suggested.nickname)}" maxlength="32">
      </label>
      <fieldset class="ttl-fieldset">
        <legend>Gender</legend>
        <label class="ttl-check"><input type="radio" name="np-gender" value="male" checked> Male</label>
        <label class="ttl-check"><input type="radio" name="np-gender" value="female"> Female</label>
      </fieldset>
      <div class="btnrow">
        <button class="evbtn primary" id="np-go" data-modal-default>Continue</button>
        <button class="evbtn" data-close data-modal-cancel>Cancel</button>
      </div>`);
    const nameEl = m.querySelector<HTMLInputElement>("#np-name")!;
    nameEl.select();
    m.querySelector("#np-go")!.addEventListener("click", () => {
      const name = nameEl.value.trim() || suggested.name;
      const nickname =
        m.querySelector<HTMLInputElement>("#np-nick")!.value.trim() || name;
      const gender = (m.querySelector<HTMLInputElement>(
        "input[name=np-gender]:checked",
      )?.value ?? "male") as "male" | "female";
      this.closeModal();
      askStrict(name, nickname, gender);
    });
  }

  private openPilot(): void {
    const pilots = listPilots();
    const rows = pilots
      .map((p) => {
        const dead = !!p.dead;
        return `<div class="pilot-row${p.id === this.selected ? " sel" : ""}${dead ? " dead" : ""}" data-pick="${p.id}">
          <div class="pilot-info">
            <div class="pilot-name">${p.name}${dead ? " †" : ""}</div>
            <div class="pilot-desc">${describePilot(p.id)}</div>
          </div>
          <div class="pilot-actions">
            <button class="evbtn primary" data-start="${p.id}" ${dead ? "disabled title=\"This pilot is deceased\"" : ""}>Continue</button>
            <button class="evbtn" data-export="${p.id}">Export</button>
            <button class="evbtn" data-delete="${p.id}">Delete</button>
          </div>
        </div>`;
      })
      .join("");

    const m = this.modal(`
      <h2>Open Pilot</h2>
      <div class="pilot-list">${rows || '<p class="menu-empty">No pilots yet.</p>'}</div>
      <div class="btnrow">
        <button class="evbtn" id="op-import">Import…</button>
        <button class="evbtn" data-close>Close</button>
      </div>`);

    m.querySelector("#op-import")!.addEventListener("click", () => {
      (this.root.querySelector("#pilot-file") as HTMLInputElement).click();
    });
    m.querySelectorAll<HTMLElement>("[data-pick]").forEach((row) => {
      row.addEventListener("click", () => {
        this.selected = row.dataset.pick!;
        this.render();
        this.openPilot();
      });
    });
    m.querySelectorAll<HTMLButtonElement>("[data-start]").forEach((btn) => {
      btn.addEventListener("click", (e) => {
        e.stopPropagation();
        const id = btn.dataset.start!;
        if (isPilotDead(id) || btn.disabled) return;
        this.hide();
        // Explicit load from the last leave-planet save (discards any paused RAM session).
        this.handlers.loadPilot(id);
      });
    });
    m.querySelectorAll<HTMLButtonElement>("[data-export]").forEach((btn) => {
      btn.addEventListener("click", (e) => {
        e.stopPropagation();
        const data = exportPilot(btn.dataset.export!);
        if (!data) return;
        const url = URL.createObjectURL(
          new Blob([data.json], { type: "application/json" }),
        );
        const a = document.createElement("a");
        a.href = url;
        a.download = data.filename;
        a.click();
        URL.revokeObjectURL(url);
      });
    });
    m.querySelectorAll<HTMLButtonElement>("[data-delete]").forEach((btn) => {
      btn.addEventListener("click", (e) => {
        e.stopPropagation();
        const id = btn.dataset.delete!;
        deletePilot(id);
        this.handlers.onDeletePilot?.(id);
        if (this.selected === id) this.selected = listPilots()[0]?.id ?? null;
        this.render();
        this.openPilot();
      });
    });
  }

  private prefs(): void {
    const fastWhen = capsLockFastWhen();
    const musicOn = isTitleMusicEnabled();
    const saved = cloneBindings(getKeybindings());
    let draft = cloneBindings(saved);
    /** Named preset this draft was last loaded from / matched (for "Custom (…)"). */
    let basePresetId = resolvePresetId(
      matchPresetId(draft) ?? getKeybindingBasePreset(),
    );
    let listening: ActionId | null = null;
    /** Pure modifier held while composing a chord; bound alone on release if unused. */
    let pendingModifier: string | null = null;
    let confirmOpen = false;

    const m = this.modal(`
      <div class="prefs-shell">
        <h2>Preferences</h2>
        <div class="prefs-body">
          <fieldset class="ttl-fieldset">
            <legend>Title music</legend>
            <p class="menu-hint">Theme that loops on this screen. Defaults off under a dev server, on in a production build; your choice is saved.</p>
            <label class="ttl-check"><input type="radio" name="pref-title-music" value="1"${
              musicOn ? " checked" : ""
            }> <strong>On</strong></label>
            <label class="ttl-check"><input type="radio" name="pref-title-music" value="0"${
              !musicOn ? " checked" : ""
            }> <strong>Off</strong></label>
          </fieldset>
          <fieldset class="ttl-fieldset">
            <legend>Caps Lock 2× speed</legend>
            <p class="menu-hint">Caps Lock always toggles double game speed. Choose which lock state is fast.</p>
            <label class="ttl-check"><input type="radio" name="pref-caps-fast" value="on"${
              fastWhen === "on" ? " checked" : ""
            }> Fast when Caps Lock is <strong>on</strong>
              <span class="menu-hint"> — Nova default</span></label>
            <label class="ttl-check"><input type="radio" name="pref-caps-fast" value="off"${
              fastWhen === "off" ? " checked" : ""
            }> Fast when Caps Lock is <strong>off</strong>
              <span class="menu-hint"> — if you leave Caps Lock on for typing</span></label>
          </fieldset>
          <fieldset class="ttl-fieldset">
            <legend>Keybindings</legend>
            <div class="pref-preset-row">
              <label class="pref-preset-label" for="pref-preset">Preset</label>
              <select id="pref-preset" class="pref-preset-select" title="Load a named layout into the draft">
                ${KEYBINDING_PRESETS.map(
                  (p) =>
                    `<option value="${p.id}">${p.name}</option>`,
                ).join("")}
                <option value="${CUSTOM_PRESET_VALUE}" disabled id="pref-preset-custom">${customPresetLabel(basePresetId)}</option>
              </select>
              <button class="evbtn" id="pref-export-keys" type="button" title="Download the current layout as a JSON file">Export…</button>
            </div>
            <p class="menu-hint">Choose a preset to load it, or click a binding and press a key or mouse button (with Opt / Shift / Ctrl for a chord). Delete clears a binding. A bare Shift/Opt/Ctrl key collides with any chord that uses that modifier — free it first, then holding the bare key will not block other binds. Esc and Caps Lock are fixed.</p>
            <div id="pref-bind-status" class="menu-hint pref-bind-status"></div>
            <div id="pref-keytable" class="keybind-columns"></div>
            <p class="menu-hint pref-fixed-keys">Also fixed: <kbd>Esc</kbd> menu · <kbd>Caps Lock</kbd> 2× speed · <kbd>−</kbd>/<kbd>=</kbd>/<kbd>0</kbd> volume</p>
          </fieldset>
        </div>
        <div class="btnrow prefs-actions">
          <button class="evbtn" id="pref-cancel" type="button">Cancel</button>
          <button class="evbtn primary" id="pref-save" type="button">Save</button>
        </div>
        <div class="pref-confirm hidden" id="pref-confirm" role="dialog" aria-label="Discard changes">
          <div class="pref-confirm-card">
            <p>You have unsaved keybinding changes. Discard them?</p>
            <div class="btnrow">
              <button class="evbtn primary" id="pref-discard" type="button">Discard</button>
              <button class="evbtn" id="pref-keep" type="button">Keep editing</button>
            </div>
          </div>
        </div>
      </div>`);

    // Mark the dialog shell so layout can pin the action row.
    m.querySelector(".ttl-dialog")?.classList.add("prefs-dialog");

    const table = m.querySelector<HTMLElement>("#pref-keytable")!;
    const status = m.querySelector<HTMLElement>("#pref-bind-status")!;
    const presetSelect = m.querySelector<HTMLSelectElement>("#pref-preset")!;
    const customOption = m.querySelector<HTMLOptionElement>(
      "#pref-preset-custom",
    )!;
    const saveBtn = m.querySelector<HTMLButtonElement>("#pref-save")!;
    const cancelBtn = m.querySelector<HTMLButtonElement>("#pref-cancel")!;
    const exportKeysBtn = m.querySelector<HTMLButtonElement>(
      "#pref-export-keys",
    )!;
    const confirmEl = m.querySelector<HTMLElement>("#pref-confirm")!;
    const discardBtn = m.querySelector<HTMLButtonElement>("#pref-discard")!;
    const keepBtn = m.querySelector<HTMLButtonElement>("#pref-keep")!;

    const isDirty = (): boolean =>
      ACTION_IDS.some((id) => !chordsEqual(draft[id], saved[id]));

    // Filled in after key/mouse listeners are declared (closePrefs runs later).
    let cleanup = (): void => {
      listening = null;
      pendingModifier = null;
      confirmOpen = false;
    };

    const closePrefs = (): void => {
      cleanup();
      if (!m.classList.contains("hidden")) {
        m.classList.add("hidden");
        playMenuClose();
      }
    };

    const hideConfirm = (): void => {
      confirmOpen = false;
      confirmEl.classList.add("hidden");
    };

    const showConfirm = (): void => {
      // Stop mid-rebind so Esc in the confirm means "keep editing".
      listening = null;
      pendingModifier = null;
      confirmOpen = true;
      confirmEl.classList.remove("hidden");
      paint();
      discardBtn.focus();
    };

    const requestCancel = (): void => {
      if (confirmOpen) {
        hideConfirm();
        return;
      }
      if (listening) {
        listening = null;
        pendingModifier = null;
        paint();
        return;
      }
      if (isDirty()) {
        showConfirm();
        return;
      }
      closePrefs();
    };

    const paint = (): void => {
      const collisions = findCollisions(draft);
      const renderGroups = (groups: typeof ACTION_GROUPS): string => {
        const rows = groups.flatMap(({ title, actions }) => {
          const header = `<tr class="keybind-group-header"><td colspan="2">${title}</td></tr>`;
          const actionRows = actions.map(({ id, label }) => {
            const chord = draft[id];
            const clash = collisions.has(id);
            const listen = listening === id;
            const kbdClass = [
              "keybind-kbd",
              clash ? "collision" : "",
              listen ? "listening" : "",
            ]
              .filter(Boolean)
              .join(" ");
            const titleAttr = listen
              ? "Press a key or mouse button… Esc/Delete unbind"
              : clash
                ? "Conflicts with another action"
                : "Click to rebind";
            return `<tr class="${clash ? "collision-row" : ""}${listen ? " listening-row" : ""}" data-action="${id}">
              <td>${label}</td>
              <td><button type="button" class="${kbdClass}" data-bind="${id}" title="${titleAttr}">${
                listen ? "…" : formatChord(chord)
              }</button></td>
            </tr>`;
          });
          return [header, ...actionRows];
        });
        return `<table class="keytable keytable-bind">${rows.join("")}</table>`;
      };
      // Left column: Flight + Combat; right column: Navigation + Escorts & comms + Info
      table.innerHTML =
        renderGroups(ACTION_GROUPS.slice(0, 2)) +
        renderGroups(ACTION_GROUPS.slice(2));
      if (listening) {
        status.textContent =
          "Press a key or mouse button · Esc / Delete / Backspace to unbind · click the slot again to cancel.";
        status.classList.remove("error");
      } else if (collisions.size > 0) {
        status.textContent = `${collisions.size} binding${
          collisions.size === 1 ? "" : "s"
        } conflict — resolve them before saving.`;
        status.classList.add("error");
      } else {
        status.textContent = "";
        status.classList.remove("error");
      }
      saveBtn.disabled =
        collisions.size > 0 || listening !== null || confirmOpen;

      // Named preset when exact; otherwise Custom (parent preset name).
      const matched = matchPresetId(draft);
      if (matched) basePresetId = matched;
      customOption.textContent = customPresetLabel(basePresetId);
      presetSelect.value = matched ?? CUSTOM_PRESET_VALUE;
      presetSelect.disabled = confirmOpen;

      table.querySelectorAll<HTMLButtonElement>("[data-bind]").forEach((btn) => {
        btn.addEventListener("click", (e) => {
          e.preventDefault();
          e.stopPropagation();
          if (confirmOpen) return;
          const id = btn.dataset.bind as ActionId;
          listening = listening === id ? null : id;
          pendingModifier = null;
          paint();
        });
      });
    };

    const isModCode = (code: string): boolean =>
      code === "ShiftLeft" ||
      code === "ShiftRight" ||
      code === "AltLeft" ||
      code === "AltRight" ||
      code === "ControlLeft" ||
      code === "ControlRight" ||
      code === "MetaLeft" ||
      code === "MetaRight";

    const onKeyDown = (e: KeyboardEvent): void => {
      if (m.classList.contains("hidden")) return;
      if (e.repeat) return;

      // Confirm overlay: Esc keeps editing; Enter discards.
      if (confirmOpen) {
        if (e.code === "Escape") {
          e.preventDefault();
          e.stopPropagation();
          hideConfirm();
          return;
        }
        if (e.code === "Enter" || e.code === "NumpadEnter") {
          e.preventDefault();
          e.stopPropagation();
          closePrefs();
          return;
        }
        return;
      }

      if (listening) {
        e.preventDefault();
        e.stopPropagation();
        // Esc / Delete / Backspace clear the binding (not dialog cancel).
        if (
          e.code === "Escape" ||
          e.code === "Backspace" ||
          e.code === "Delete"
        ) {
          draft = { ...draft, [listening]: { ...UNBOUND } };
          listening = null;
          pendingModifier = null;
          paint();
          return;
        }
        // Hold modifiers to build Opt/Shift/Ctrl chords; alone they bind on keyup.
        if (isModCode(e.code)) {
          if (e.code !== "MetaLeft" && e.code !== "MetaRight") {
            pendingModifier = e.code;
          }
          return;
        }
        pendingModifier = null;
        const chord = chordFromEvent(e);
        if (!chord) return;
        draft = { ...draft, [listening]: chord };
        listening = null;
        paint();
        return;
      }

      // Esc cancels the whole dialog (with dirty confirm when needed).
      if (e.code === "Escape") {
        e.preventDefault();
        e.stopPropagation();
        requestCancel();
      }
    };

    const onKeyUp = (e: KeyboardEvent): void => {
      if (!listening || !pendingModifier || confirmOpen) return;
      if (e.code !== pendingModifier) return;
      e.preventDefault();
      e.stopPropagation();
      // Modifier released without another key → bind that key alone (e.g. Left Ctrl).
      draft = { ...draft, [listening]: { code: e.code } };
      listening = null;
      pendingModifier = null;
      paint();
    };

    /**
     * Mouse buttons rebind while listening. Dialog chrome (Save, radios, other
     * bind rows) is ignored so the UI still works; the listening row itself
     * and empty dialog surface count as a mouse bind.
     */
    const onMouseDown = (e: MouseEvent): void => {
      if (!listening || confirmOpen || m.classList.contains("hidden")) return;
      const t = e.target as HTMLElement | null;
      const bindBtn = t?.closest("button[data-bind]") as HTMLElement | null;
      if (bindBtn && bindBtn.dataset.bind !== listening) return;
      if (
        !bindBtn &&
        t?.closest("button, select, input, a, label, textarea")
      ) {
        return;
      }
      e.preventDefault();
      e.stopPropagation();
      pendingModifier = null;
      draft = { ...draft, [listening]: chordFromMouseEvent(e) };
      listening = null;
      paint();
    };

    const onContextMenu = (e: MouseEvent): void => {
      if (!listening || confirmOpen) return;
      // Right-click is a valid bind; don't open the browser menu mid-rebind.
      e.preventDefault();
    };

    window.addEventListener("keydown", onKeyDown, true);
    window.addEventListener("keyup", onKeyUp, true);
    window.addEventListener("mousedown", onMouseDown, true);
    window.addEventListener("contextmenu", onContextMenu, true);

    cleanup = (): void => {
      window.removeEventListener("keydown", onKeyDown, true);
      window.removeEventListener("keyup", onKeyUp, true);
      window.removeEventListener("mousedown", onMouseDown, true);
      window.removeEventListener("contextmenu", onContextMenu, true);
      listening = null;
      pendingModifier = null;
      confirmOpen = false;
    };

    saveBtn.addEventListener("click", () => {
      if (findCollisions(draft).size > 0 || listening || confirmOpen) return;
      setKeybindings(draft, basePresetId);
      closePrefs();
    });
    cancelBtn.addEventListener("click", () => requestCancel());
    exportKeysBtn.addEventListener("click", () => {
      if (confirmOpen) return;
      // Export the draft on screen, including unsaved edits.
      const data = exportKeybindings(draft, basePresetId);
      const url = URL.createObjectURL(
        new Blob([data.json], { type: "application/json" }),
      );
      const a = document.createElement("a");
      a.href = url;
      a.download = data.filename;
      a.click();
      URL.revokeObjectURL(url);
    });
    presetSelect.addEventListener("change", () => {
      if (confirmOpen) return;
      const id = presetSelect.value;
      if (id === CUSTOM_PRESET_VALUE) return;
      basePresetId = resolvePresetId(id);
      draft = cloneBindings(bindingsForPreset(id));
      listening = null;
      pendingModifier = null;
      paint();
    });
    discardBtn.addEventListener("click", () => closePrefs());
    keepBtn.addEventListener("click", () => hideConfirm());

    for (const radio of m.querySelectorAll<HTMLInputElement>(
      'input[name="pref-caps-fast"]',
    )) {
      radio.addEventListener("change", () => {
        if (!radio.checked) return;
        const when = radio.value as CapsLockFastWhen;
        if (when === "on" || when === "off") setCapsLockFastWhen(when);
      });
    }
    for (const radio of m.querySelectorAll<HTMLInputElement>(
      'input[name="pref-title-music"]',
    )) {
      radio.addEventListener("change", () => {
        if (!radio.checked) return;
        setTitleMusicEnabled(radio.value === "1");
      });
    }

    paint();
  }

  private about(): void {
    const splash = UI_PICTS["131"];
    this.modal(`
      <h2>About</h2>
      ${splash ? `<img class="ttl-splash" src="${asset(`nova/picts/${splash.file}`)}" alt="Escape Velocity Nova">` : ""}
      <p>A clean-room engine that reads your own copy of EV Nova's data files —
        systems, ships, outfits, missions, sprites and sounds all come straight
        out of the <code>.rez</code> resources on disk. Nothing is bundled.</p>
      <p class="menu-hint">EV Nova is © Ambrosia Software / ATMOS. Built for personal use.</p>
      <div class="btnrow"><button class="evbtn primary" data-close>Close</button></div>`);
  }
}


