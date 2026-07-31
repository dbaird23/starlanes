import { asset } from "../asset";
import {
  playMusic,
  playSnd,
  preloadCoreSnds,
  SND,
  stopMusic,
} from "../engine/audio";
import {
  COLR,
  MENU_SPRITES,
  SHIPS,
  UI_PICTS,
  getSystem,
  targetPict,
} from "../data/universe";
import { formatDate } from "../game/calendar";
import { ratingName } from "../game/reputation";
import {
  createPilot,
  deletePilot,
  exportPilot,
  importPilot,
  listPilots,
  loadPilot,
} from "../game/pilots";
import {
  capsLockFastWhen,
  setCapsLockFastWhen,
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

const INTRO_PAGES = ["8200", "8201", "8202"];

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
 */
const COLUMN: Overlay[] = [
  { pict: "8030", x: 343, y: 399, w: 338, h: 63, frames: 11 },
  { pict: "8031", x: 337, y: 462, w: 351, h: 64, frames: 10 },
  { pict: "8032", x: 337, y: 526, w: 351, h: 65, frames: 11 },
];

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
const REVEAL_FRAMES = Math.max(...COLUMN.map((c) => c.frames));

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
  { id: "new", sprite: "8050", x: 349, y: 400, emblem: 0, colr: 0 },
  { id: "enter", sprite: "8053", x: 555, y: 401, emblem: 3, colr: 3 },
  { id: "open", sprite: "8051", x: 344, y: 464, emblem: 1, colr: 1 },
  { id: "prefs", sprite: "8054", x: 581, y: 464, emblem: 4, colr: 4 },
  { id: "quit", sprite: "8052", x: 345, y: 528, emblem: 2, colr: 2 },
  { id: "about", sprite: "8055", x: 580, y: 528, emblem: 5, colr: 5 },
];

/** Title screen / pilot management, shown over the starfield. */
export class MainMenu {
  private root: HTMLElement;
  private onStart: (pilotId: string, strict?: boolean) => void;
  private selected: string | null = null;
  private timer: number | null = null;
  private frame = 0;
  /** how far through the one-shot plate reveal we are */
  private reveal = 0;

  constructor(onStart: (pilotId: string, strict?: boolean) => void) {
    this.root = document.getElementById("menu-ui")!;
    this.onStart = onStart;
  }

  show(): void {
    this.root.classList.remove("hidden");
    playMusic();
    preloadCoreSnds();
    const pilots = listPilots();
    if (!this.selected || !pilots.some((p) => p.id === this.selected)) {
      this.selected = pilots[0]?.id ?? null;
    }
    this.reveal = 0;
    this.render();
    // the logo's fire flicker runs at about 8fps; so does the plate reveal
    this.timer = window.setInterval(() => this.step(), 120);
  }

  hide(): void {
    if (this.timer !== null) {
      clearInterval(this.timer);
      this.timer = null;
    }
    this.root.classList.add("hidden");
    this.root.innerHTML = "";
    stopMusic();
  }

  /**
   * The logo keeps flickering; the plates run their reveal exactly once and
   * then stay put, at which point the buttons and emblem fade in.
   */
  private step(): void {
    this.frame++;
    const logo = this.root.querySelector<HTMLElement>(
      `[data-ov="${LOGO.pict}"]`,
    );
    if (logo)
      logo.style.backgroundPositionY = `${-(this.frame % LOGO.frames) * LOGO.h}px`;

    if (this.reveal >= REVEAL_FRAMES) return;
    this.reveal++;
    for (const ov of columnOverlays()) {
      const el = this.root.querySelector<HTMLElement>(`[data-ov="${ov.pict}"]`);
      if (el) {
        el.style.backgroundPositionY = `${-Math.min(this.reveal, ov.frames - 1) * ov.h}px`;
      }
    }
    if (this.reveal >= REVEAL_FRAMES) {
      this.root.querySelector(".ttl-stage")?.classList.add("ready");
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

  private overlayHtml(ov: Overlay): string {
    const pic = UI_PICTS[ov.pict];
    if (!pic) return "";
    return `<div class="menu-ov" data-ov="${ov.pict}" style="
      left:${ov.x}px; top:${ov.y}px; width:${ov.w}px; height:${ov.h}px;
      background-image:url('${asset(`nova/picts/${pic.file}`)}')"></div>`;
  }

  /** The red readout the original prints along the bottom of the title screen. */
  private pilotPanel(): string {
    const state = this.selected ? loadPilot(this.selected) : null;
    const summary = listPilots().find((p) => p.id === this.selected);
    const field = (label: string, value: string) =>
      `<div class="ttl-field"><span>${label}</span><b>${value}</b></div>`;

    if (!state || !summary) {
      return `<div class="ttl-info left">${field("Pilot Name:", "—")}</div>
        <div class="ttl-info right">${field("", "No pilot loaded")}</div>`;
    }
    let place = "deep space";
    try {
      place = getSystem(state.systemId).name;
    } catch {
      /* uncharted */
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
        ${field("Pilot Name:", summary.name)}
        ${field("Ship Class:", ship?.name.split(";")[0] ?? "—")}
        ${field("Credits:", state.credits.toLocaleString() + " cr")}
      </div>
      ${silhouette}
      <div class="ttl-info right">
        ${field("Current system:", place)}
        ${field("Combat Rating:", ratingName(state.ratingPoints ?? 0))}
        ${field("Current Date:", formatDate(state.date ?? 0))}
      </div>`;
  }

  private render(): void {
    const bg = UI_PICTS["8000"];
    // each button sheet is two frames wide: idle, then the lit rollover
    const buttons = BUTTONS.map((b) => {
      const spr = MENU_SPRITES[b.sprite];
      if (!spr) return "";
      const at = buttonPos(b);
      return `<button class="ttl-btn" data-menu="${b.id}" data-emblem="${b.emblem}" title="${b.id}" style="
        left:${at.x}px; top:${at.y}px; width:${spr.w}px; height:${spr.h}px;
        background-image:url('${asset(`nova/sprites/${spr.file}`)}');
        --hover-x:${-spr.w}px"></button>`;
    }).join("");

    this.root.innerHTML = `
      <div class="ttl-stage${this.reveal >= REVEAL_FRAMES ? " ready" : ""}"
        ${bg ? `style="background-image:url('${asset(`nova/picts/${bg.file}`)}')"` : ""}>
        ${this.overlayHtml(logoOverlay())}
        ${columnOverlays()
          .map((ov) => this.overlayHtml(ov))
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
        btn.addEventListener("pointerdown", () => playSnd(SND.MENU_DOWN, 0.5));
        btn.addEventListener("pointerup", () => playSnd(SND.MENU_UP, 0.5));
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
        if (this.selected) {
          this.hide();
          this.onStart(this.selected);
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
          "There's no quitting a browser tab from inside it — close the tab when you're done. Your pilot is already saved.",
        );
        break;
    }
  }

  private modal(html: string): HTMLElement {
    const m = this.root.querySelector<HTMLElement>("#ttl-modal")!;
    m.innerHTML = `<div class="ttl-dialog">${html}</div>`;
    m.classList.remove("hidden");
    m.querySelectorAll<HTMLButtonElement>("[data-close]").forEach((b) =>
      b.addEventListener("click", () => m.classList.add("hidden")),
    );
    return m;
  }

  private notice(title: string, body: string): void {
    this.modal(`<h2>${title}</h2><p>${body}</p>
      <div class="btnrow"><button class="evbtn primary" data-close>OK</button></div>`);
  }

  private newPilot(): void {
    const m = this.modal(`
      <h2>New Pilot</h2>
      <label class="ttl-label">Pilot name
        <input id="np-name" type="text" value="Captain" maxlength="32">
      </label>
      <label class="ttl-check"><input id="np-strict" type="checkbox"> Strict play —
        death is permanent and the pilot is deleted</label>
      <div class="btnrow">
        <button class="evbtn primary" id="np-go">Create</button>
        <button class="evbtn" data-close>Cancel</button>
      </div>`);
    const nameEl = m.querySelector<HTMLInputElement>("#np-name")!;
    nameEl.select();
    m.querySelector("#np-go")!.addEventListener("click", () => {
      const strict = m.querySelector<HTMLInputElement>("#np-strict")!.checked;
      const name = nameEl.value.trim() || "Captain";
      const id = createPilot(strict ? `${name} †` : name);
      this.playIntro(() => {
        this.hide();
        this.onStart(id, strict);
      });
    });
  }

  /**
   * Nova's preamble: three full-page spreads of history that play once, when
   * a pilot is created. They're PICT 8200-8202, complete composites — text,
   * screens and chrome all baked in — so they only need showing at the
   * original 1024x768 and scaling to fit.
   */
  private playIntro(done: () => void): void {
    const pages = INTRO_PAGES.map((id) => UI_PICTS[id]).filter(Boolean);
    if (pages.length === 0) {
      done();
      return;
    }
    let page = 0;

    const draw = () => {
      const pic = pages[page];
      this.root.innerHTML = `
        <div class="ttl-stage intro" style="background-image:url('${asset(`nova/picts/${pic.file}`)}')">
          <div class="intro-foot">
            <span>${page + 1} / ${pages.length}</span>
            <span class="intro-hint">click or press space to continue · esc to skip</span>
          </div>
        </div>`;
      this.fitStage();
      // Bind to the page element, not the root: the click that opened the
      // intro is still bubbling up through the root when we get here, and a
      // root listener would eat it and skip straight to page two.
      this.root
        .querySelector<HTMLElement>(".ttl-stage.intro")!
        .addEventListener("click", () => advance());
    };

    const finish = () => {
      window.removeEventListener("keydown", onKey, true);
      done();
    };
    const advance = () => {
      page++;
      if (page >= pages.length) finish();
      else draw();
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        finish();
      } else if (e.key === " " || e.key === "Enter" || e.key === "ArrowRight") {
        e.preventDefault();
        advance();
      }
    };

    // the intro owns the screen, so intercept keys before the flight loop
    window.addEventListener("keydown", onKey, true);
    draw();
  }

  private openPilot(): void {
    const pilots = listPilots();
    const rows = pilots
      .map(
        (
          p,
        ) => `<div class="pilot-row${p.id === this.selected ? " sel" : ""}" data-pick="${p.id}">
          <div class="pilot-info">
            <div class="pilot-name">${p.name}</div>
            <div class="pilot-desc">${describeShort(p.id)}</div>
          </div>
          <div class="pilot-actions">
            <button class="evbtn primary" data-start="${p.id}">Continue</button>
            <button class="evbtn" data-export="${p.id}">Export</button>
            <button class="evbtn" data-delete="${p.id}">Delete</button>
          </div>
        </div>`,
      )
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
        this.hide();
        this.onStart(btn.dataset.start!);
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
        if (this.selected === id) this.selected = listPilots()[0]?.id ?? null;
        this.render();
        this.openPilot();
      });
    });
  }

  private prefs(): void {
    const keys: [string, string][] = [
      ["Turn left / right", "← →"],
      ["Accelerate", "↑"],
      ["Reverse (turn about)", "↓"],
      ["Afterburner", "Z"],
      ["Fire primary", "Space"],
      ["Fire secondary", "Left Ctrl"],
      ["Select secondary", "W"],
      ["Cycle targets", "` or Tab"],
      ["Target nearest ship", "R"],
      ["Target / cycle worlds", "L"],
      ["Land / dock", "L (again, in range)"],
      ["Hyperspace jump", "J"],
      ["Hyper select (floating map)", "H"],
      ["Select jump destination", "H or \\"],
      ["Star map", "M"],
      ["Communicate", "Y"],
      ["Board disabled ship", "B"],
      ["Engage cloak", "U"],
      ["Recall fighters", "C"],
      ["Autopilot", "Q"],
      ["Nav system off", "N"],
      ["Escorts: attack my target", "E"],
      ["Escorts: form up", "F"],
      ["Escorts: hold position", "V"],
      ["Player info", "P"],
      ["Mission info", "I"],
      ["Jettison cargo", "Alt-K"],
      ["Eject (escape pod)", "Alt-X"],
      ["Self-destruct", "Shift-Q"],
      ["Return to title screen", "Esc"],
      ["Double game speed", "Caps Lock"],
    ];
    const fastWhen = capsLockFastWhen();
    const m = this.modal(`
      <h2>Preferences</h2>
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
      <p class="menu-hint">Nova's original bindings, with the arrow keys for flight.</p>
      <table class="keytable">${keys
        .map(([k, v]) => `<tr><td>${k}</td><td><kbd>${v}</kbd></td></tr>`)
        .join("")}</table>
      <div class="btnrow"><button class="evbtn primary" data-close>Done</button></div>`);
    for (const radio of m.querySelectorAll<HTMLInputElement>(
      'input[name="pref-caps-fast"]',
    )) {
      radio.addEventListener("change", () => {
        if (!radio.checked) return;
        const when = radio.value as CapsLockFastWhen;
        if (when === "on" || when === "off") setCapsLockFastWhen(when);
      });
    }
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

function describeShort(id: string): string {
  const state = loadPilot(id);
  if (!state) return "new pilot";
  const ship = SHIPS[state.shipId]?.name.split(";")[0] ?? "ship";
  let place: string;
  try {
    place = getSystem(state.systemId).name;
  } catch {
    place = "deep space";
  }
  return `${ship} · ${place} · ${state.credits.toLocaleString()} cr`;
}
