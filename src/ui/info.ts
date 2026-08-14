/**
 * Information panels: Nova's player info (P), mission info (I) and the
 * jettison dialog (Alt-K). In flight they freeze the sim (see
 * Game.flightOverlayOpen). The mission log also opens while landed via the
 * same keybinding. Esc or Close dismisses the panel.
 */

import { playMenuClose, playMenuOpen } from "../engine/audio";

export interface InfoRow {
  label: string;
  value: string;
}

export interface InfoSection {
  title: string;
  rows: InfoRow[];
  /** free text shown under the rows (plain text; escaped on render) */
  note?: string;
}

/**
 * A mission-log row. The selected row expands in place to show rows/body;
 * nothing is selected on open unless there is only one mission.
 */
export interface InfoPickItem {
  id: string;
  /** Short label in the list */
  label: string;
  /**
   * Secondary line on the collapsed row (destination, time left, …).
   * Shown even when the mission is not expanded.
   */
  subtitle?: string;
  rows: InfoRow[];
  /** Mission briefing / description (plain text) */
  body?: string;
  /** When true, an Abort button is offered for this pick. */
  canAbort?: boolean;
}

export interface JettisonEntry {
  id: string;
  name: string;
  tons: number;
}

export interface InfoTab {
  id: string;
  label: string;
  sections: InfoSection[];
}

export interface InfoContext {
  title: string;
  /**
   * When present, the panel renders a tab bar and shows only the active tab's
   * sections. Mutually exclusive with pickList and jettison.
   */
  tabs?: InfoTab[];
  /**
   * Pass a function when the panel's own buttons change what it reports — the
   * jettison dialog's tonnage, for instance — so a re-render re-reads it
   * instead of showing the figures the panel opened with.
   */
  sections: InfoSection[] | (() => InfoSection[]);
  /**
   * When present, a list of expandable items (mission log). Prefer a function
   * so abort / dump updates re-read live state.
   */
  pickList?: InfoPickItem[] | (() => InfoPickItem[]);
  /**
   * When present, the hold is listed with Dump buttons. Re-read on every
   * render rather than passed as a snapshot, so tonnages fall as you dump.
   */
  jettison?: () => JettisonEntry[];
  onJettison?: (commodityId: string, qty: number) => void;
  /**
   * Mission log: called after the player confirms Abort on a pick. The panel
   * re-renders from pickList afterward.
   */
  onAbortPick?: (id: string) => void;
  close: () => void;
}

export class InfoUi {
  private root: HTMLElement;
  private ctx: InfoContext | null = null;
  /** Active tab id when the panel is in tabbed mode. */
  private activeTab: string | null = null;
  /**
   * Expanded mission id, or null when the list is collapsed. Reset on show;
   * a single-mission log opens already expanded.
   */
  private pickId: string | null = null;
  /**
   * Abort confirmation for the selected mission. Null when the list is free
   * to use; set to the pick id while the confirm overlay is up.
   */
  private abortConfirmId: string | null = null;

  constructor() {
    this.root = document.getElementById("info-ui")!;
  }

  get open(): boolean {
    return this.ctx !== null;
  }

  show(ctx: InfoContext): void {
    const wasOpen = this.ctx !== null;
    this.ctx = ctx;
    this.activeTab = ctx.tabs?.[0]?.id ?? null;
    this.pickId = null;
    this.abortConfirmId = null;
    const picks = this.resolvePicks();
    // One job: open already expanded. Several: none selected until click/arrow.
    if (picks?.length === 1) this.pickId = picks[0]!.id;
    this.root.classList.remove("hidden");
    if (!wasOpen) playMenuOpen();
    this.render();
  }

  close(): void {
    if (this.ctx === null) return;
    this.ctx = null;
    this.pickId = null;
    this.abortConfirmId = null;
    this.root.classList.add("hidden");
    this.root.innerHTML = "";
    playMenuClose();
  }

  /**
   * Esc while the panel is open. Dismisses an abort confirm first (panel stays
   * up); returns false when the caller should close the whole panel.
   */
  handleEscape(): boolean {
    if (this.abortConfirmId !== null) {
      this.abortConfirmId = null;
      this.render();
      return true;
    }
    return false;
  }

  /**
   * Enter while the panel is open. Confirms a pending abort; otherwise false
   * so the caller can ignore it.
   */
  handleEnter(): boolean {
    if (this.abortConfirmId === null) return false;
    this.root.querySelector<HTMLButtonElement>("#if-abort-ok")?.click();
    return true;
  }

  /**
   * Tab key shortcuts: first letter of each tab id (e.g. "g" → "general").
   * Returns true when the key switched a tab.
   */
  handleTabKey(letter: string): boolean {
    const tabs = this.ctx?.tabs;
    if (!tabs) return false;
    const lower = letter.toLowerCase();
    const tab = tabs.find((t) => t.id[0] === lower);
    if (!tab || tab.id === this.activeTab) return false;
    this.activeTab = tab.id;
    this.render();
    return true;
  }

  /**
   * A — abort the expanded mission when CanAbort allows it. Opens the confirm
   * overlay (same as the Abort button). If the confirm is already up, A
   * accepts it. Returns true when the key was consumed.
   */
  handleAbort(): boolean {
    if (!this.ctx) return false;
    if (this.abortConfirmId !== null) {
      this.root.querySelector<HTMLButtonElement>("#if-abort-ok")?.click();
      return true;
    }
    const btn = this.root.querySelector<HTMLButtonElement>("#if-abort");
    if (!btn) return false;
    btn.click();
    return true;
  }

  /**
   * ArrowUp / ArrowDown through the mission list. Wraps at the ends. When
   * nothing is expanded, Down opens the first and Up the last. Returns true
   * when the key was consumed.
   */
  handleArrow(delta: number): boolean {
    if (!this.ctx || this.abortConfirmId) return false;
    const picks = this.resolvePicks();
    if (!picks?.length) return false;

    let idx = this.pickId
      ? picks.findIndex((p) => p.id === this.pickId)
      : -1;
    if (idx < 0) {
      idx = delta > 0 ? 0 : picks.length - 1;
    } else {
      idx = (idx + delta + picks.length) % picks.length;
    }
    this.pickId = picks[idx]!.id;
    this.render();
    this.scrollPickIntoView(this.pickId);
    return true;
  }

  private resolvePicks(): InfoPickItem[] | null {
    const c = this.ctx;
    if (!c?.pickList) return null;
    return typeof c.pickList === "function" ? c.pickList() : c.pickList;
  }

  private scrollPickIntoView(id: string): void {
    const el = this.root.querySelector<HTMLElement>(
      `.if-pick-item[data-pick="${cssAttr(id)}"]`,
    );
    el?.scrollIntoView({ block: "nearest" });
  }

  private render(): void {
    const c = this.ctx;
    if (!c) return;

    const picks = this.resolvePicks();

    // Drop a stale selection / confirm if that mission left the list.
    if (this.pickId && (!picks || !picks.some((p) => p.id === this.pickId))) {
      this.pickId = null;
    }
    if (
      this.abortConfirmId &&
      (!picks || !picks.some((p) => p.id === this.abortConfirmId))
    ) {
      this.abortConfirmId = null;
    }

    let sectionsHtml = "";
    let pickHtml = "";

    if (c.tabs?.length) {
      const activeId = this.activeTab ?? c.tabs[0]!.id;
      const activeTab = c.tabs.find((t) => t.id === activeId) ?? c.tabs[0]!;
      const tabBar = `<div class="if-tabs">${c.tabs
        .map((t) => {
          const label = esc(t.label);
          const hint = `<u>${label[0]}</u>${label.slice(1)}`;
          return `<button class="if-tab-btn${t.id === activeId ? " active" : ""}" data-tab="${esc(t.id)}">${hint}</button>`;
        })
        .join("")}</div>`;
      const tabSections = activeTab.sections
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
      sectionsHtml = tabBar + tabSections;
    } else if (picks && picks.length > 0) {
      pickHtml = `
        <div class="if-pick-list" role="listbox" aria-label="Missions">
          ${picks
            .map((p) => {
              const open = p.id === this.pickId;
              const detail = open
                ? `<div class="if-pick-body">
                    ${p.rows
                      .map(
                        (r) =>
                          `<div class="if-row"><span>${esc(r.label)}</span><b>${esc(r.value)}</b></div>`,
                      )
                      .join("")}
                    ${
                      p.body
                        ? `<div class="if-note if-body">${esc(p.body)}</div>`
                        : `<div class="if-note">No briefing on file for this job.</div>`
                    }
                  </div>`
                : "";
              const sub = p.subtitle
                ? `<span class="if-pick-sub">${esc(p.subtitle)}</span>`
                : "";
              return `<div class="if-pick-item${open ? " open" : ""}" data-pick="${esc(p.id)}" role="option" aria-selected="${open ? "true" : "false"}">
                <button type="button" class="if-pick-head">
                  <span class="if-pick-name">${esc(p.label)}</span>
                  ${sub}
                </button>
                ${detail}
              </div>`;
            })
            .join("")}
        </div>`;
    } else {
      sectionsHtml = (
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
    }

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

    const sel =
      picks && this.pickId
        ? (picks.find((p) => p.id === this.pickId) ?? null)
        : null;
    const showAbort = !!(sel?.canAbort && c.onAbortPick);
    const abortConfirm =
      this.abortConfirmId && sel
        ? `
      <div class="if-abort-back" role="dialog" aria-label="Abort mission">
        <div class="if-abort-card">
          <p>Abort mission &ldquo;${esc(sel.label)}&rdquo;?</p>
          <div class="if-abort-btns">
            <button type="button" class="portbtn" id="if-abort-cancel">Cancel</button>
            <button type="button" class="portbtn primary" id="if-abort-ok">Abort</button>
          </div>
        </div>
      </div>`
        : "";

    this.root.innerHTML = `
      <div class="infopanel${picks && picks.length ? " if-has-picks" : ""}">
        <div class="if-head">${esc(c.title)}</div>
        ${pickHtml}
        ${sectionsHtml}
        ${jettison}
        <div class="if-buttons">
          ${showAbort ? `<button type="button" class="portbtn" id="if-abort">Abort</button>` : ""}
          <button class="portbtn" id="if-close">Close</button>
        </div>
        ${abortConfirm}
      </div>`;

    this.root.querySelectorAll<HTMLButtonElement>(".if-tab-btn").forEach((btn) => {
      btn.addEventListener("click", () => {
        this.activeTab = btn.dataset.tab ?? null;
        this.render();
      });
    });
    this.root.querySelectorAll<HTMLElement>(".if-pick-item").forEach((item) => {
      const id = item.dataset.pick ?? null;
      item
        .querySelector<HTMLButtonElement>(".if-pick-head")
        ?.addEventListener("click", () => {
          if (this.abortConfirmId) return;
          // Toggle: click the open mission to collapse it again.
          this.pickId = this.pickId === id ? null : id;
          this.render();
          if (this.pickId) this.scrollPickIntoView(this.pickId);
        });
    });
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
    this.root.querySelector("#if-abort")?.addEventListener("click", () => {
      if (!sel) return;
      this.abortConfirmId = sel.id;
      this.render();
    });
    this.root.querySelector("#if-abort-cancel")?.addEventListener("click", () => {
      this.abortConfirmId = null;
      this.render();
    });
    this.root.querySelector("#if-abort-ok")?.addEventListener("click", () => {
      const id = this.abortConfirmId;
      this.abortConfirmId = null;
      if (id) {
        c.onAbortPick?.(id);
        if (this.pickId === id) this.pickId = null;
      }
      this.render();
    });
    if (this.abortConfirmId) {
      requestAnimationFrame(() => {
        this.root.querySelector<HTMLButtonElement>("#if-abort-ok")?.focus();
      });
    }
  }
}

/** Ship, outfit and world names come from the data files; never trust them. */
function esc(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/** Escape a value for use inside a CSS attribute selector. */
function cssAttr(s: string): string {
  return s.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
}
