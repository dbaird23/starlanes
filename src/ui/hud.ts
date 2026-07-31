import {
  COMMODITIES,
  INTERFACE,
  SHIPS,
  STR_LISTS,
  getSystem,
  junkFromCargoKey,
  systemGovtColor,
  targetPict,
} from "../data/universe";
import { formatDateShort } from "../game/calendar";
import { isSecondary } from "../game/combat";
import { getPict, tintedShipSilhouette } from "../engine/sprites";
import type { Game } from "../game/game";

/**
 * The flight status sidebar — design 2a, "Deep Glass · Orbital".
 *
 * This is DOM rather than part of the game canvas. The panel is layered
 * gradients, a dashed target frame, glow shadows and two webfonts, all of which
 * CSS does in a stylesheet and canvas 2D does in a few hundred fragile lines;
 * the landed screens are already HTML, so this matches the rest of the UI. The
 * one genuinely per-frame thing — the scanner's moving contacts — gets a small
 * nested <canvas> of its own.
 *
 * Everything positional used to come from the ïntf rects. Those describe Nova's
 * own 192-wide plate and cannot express this layout, so the arrangement is the
 * design's; the resource still supplies colours (shield/armor/fuel, the radar's
 * two contact colours) and the plate itself stays unread — see renderHud's note.
 */

/** Matches --hud-w in style.css; the game reserves this much of the canvas. */
export const HUD_W = 268;

/** Decorative starfield, fixed so it doesn't crawl between frames. */
const STARS: [number, number, number, string][] = [
  [0.14, 0.11, 2, "#dff2f7"],
  [0.28, 0.24, 1, "#a8c4cf"],
  [0.44, 0.08, 2, "#ffffff"],
  [0.63, 0.19, 1, "#c7d8de"],
  [0.82, 0.33, 2, "#eaf4f7"],
  [0.09, 0.46, 1, "#b9ccd4"],
  [0.36, 0.57, 2, "#f3fafc"],
  [0.71, 0.52, 1, "#a8c4cf"],
  [0.22, 0.71, 2, "#dff2f7"],
  [0.56, 0.78, 1, "#c7d8de"],
  [0.88, 0.69, 2, "#ffffff"],
  [0.48, 0.9, 1, "#a8c4cf"],
];

const RADAR_RANGE = 2400;
const CLOAK_VISIBLE_ON_RADAR = 0x0001;

/** One row of the ledger, reused so the DOM isn't rebuilt every frame. */
interface LedgerRow {
  el: HTMLElement;
  label: HTMLElement;
  value: HTMLElement;
}

export class HudUi {
  private root: HTMLElement;
  private scan!: HTMLCanvasElement;
  private scanCtx!: CanvasRenderingContext2D;
  private scanRange!: HTMLElement;
  private scanSys!: HTMLElement;
  private pilot!: HTMLElement;
  private govt!: HTMLElement;
  private gauges!: HTMLElement;
  private navBox!: HTMLElement;
  private navKind!: HTMLElement;
  private navValue!: HTMLElement;
  private weapons!: HTMLElement;
  private target!: HTMLElement;
  private ledger!: HTMLElement;
  private hints!: HTMLElement;
  private speedBadge!: HTMLElement;

  private ledgerRows: LedgerRow[] = [];
  private lastHints = "";

  constructor() {
    this.root = document.getElementById("hud-ui")!;
    this.build();
  }

  setVisible(on: boolean): void {
    this.root.classList.toggle("hidden", !on);
    // badge is a fixed child of #hud-ui; hide with the panel
    if (!on) this.speedBadge.classList.add("hidden");
  }

  private build(): void {
    this.root.innerHTML = `
      <div class="speed-badge hidden" title="Caps Lock — double game speed (polarity in Preferences)">2×</div>
      <div class="hud-card">
        <div class="hud-scan">
          <canvas class="hud-scan-c"></canvas>
          <div class="hud-scan-tag"><i></i><span class="hud-scan-range">SCAN</span></div>
          <div class="hud-scan-sys"></div>
        </div>

        <div class="hud-who">
          <span class="hud-pilot"></span>
          <span class="hud-govt"></span>
        </div>

        <div class="hud-gauges"></div>

        <div class="hud-nav">
          <span class="hud-nav-ring"></span>
          <div>
            <div class="hud-nav-kind"></div>
            <div class="hud-nav-value"></div>
          </div>
        </div>

        <div class="hud-weapons"></div>

        <div class="hud-target"></div>

        <div class="hud-ledger"></div>

        <div class="hud-hints"></div>
      </div>`;

    const q = <T extends HTMLElement>(sel: string) =>
      this.root.querySelector<T>(sel)!;
    this.scan = q<HTMLCanvasElement>(".hud-scan-c");
    this.scanCtx = this.scan.getContext("2d")!;
    this.scanRange = q(".hud-scan-range");
    this.scanSys = q(".hud-scan-sys");
    this.pilot = q(".hud-pilot");
    this.govt = q(".hud-govt");
    this.gauges = q(".hud-gauges");
    this.navBox = q(".hud-nav");
    this.navKind = q(".hud-nav-kind");
    this.navValue = q(".hud-nav-value");
    this.weapons = q(".hud-weapons");
    this.target = q(".hud-target");
    this.ledger = q(".hud-ledger");
    this.hints = q(".hud-hints");
    this.speedBadge = q(".speed-badge");
  }

  /** Called once a frame while in flight. */
  update(g: Game): void {
    this.speedBadge.classList.toggle("hidden", g.timeScale <= 1);
    this.drawScanner(g);
    this.drawIdentity(g);
    this.drawGauges(g);
    this.drawNav(g);
    this.drawWeapons(g);
    this.drawTarget(g);
    this.drawLedger(g);
    this.drawHints(g);
  }

  // ---------------- scanner ----------------

  private drawScanner(g: Game): void {
    const box = this.scan;
    const dpr = window.devicePixelRatio || 1;
    const w = box.clientWidth;
    const h = box.clientHeight;
    if (!w || !h) return;
    if (
      box.width !== Math.round(w * dpr) ||
      box.height !== Math.round(h * dpr)
    ) {
      box.width = Math.round(w * dpr);
      box.height = Math.round(h * dpr);
    }
    const ctx = this.scanCtx;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, w, h);

    for (const [sx, sy, r, col] of STARS) {
      ctx.fillStyle = col;
      ctx.globalAlpha = 0.85;
      ctx.beginPath();
      ctx.arc(sx * w, sy * h, r / 2, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.globalAlpha = 1;

    const cx = w / 2;
    const cy = h / 2;
    // scale off the smaller half-dimension so a letterboxed scope stays
    // circular — the scanner gives up height first on a short window
    const k = Math.min(w, h) / 2 / RADAR_RANGE;
    const to = (wx: number, wy: number) => ({
      x: cx + (wx - g.ship.pos.x) * k,
      y: cy + (wy - g.ship.pos.y) * k,
    });

    ctx.save();
    ctx.beginPath();
    ctx.rect(0, 0, w, h);
    ctx.clip();

    for (const p of g.system.planets) {
      const pt = to(p.pos.x, p.pos.y);
      ctx.fillStyle = "#8fb4d4";
      ctx.shadowColor = "rgba(143,180,212,.5)";
      ctx.shadowBlur = 7;
      ctx.beginPath();
      ctx.arc(pt.x, pt.y, 3.5, 0, Math.PI * 2);
      ctx.fill();
      ctx.shadowBlur = 0;
    }

    if (g.hasDensityScanner) {
      for (const a of g.asteroids) {
        const pt = to(a.x, a.y);
        ctx.fillStyle = "rgba(150,140,120,0.55)";
        ctx.fillRect(pt.x - 1, pt.y - 1, 2, 2);
      }
    }

    /*
     * Interference is the system's sensor static, 0 clear to 100 blackout: it
     * scatters contacts and, past a point, drops them. The jitter is keyed to
     * the contact so a blip wobbles in place rather than strobing across the
     * scope every frame.
     */
    const murk = g.system.interference / 100;
    for (const npc of g.npcs) {
      if (npc.cloaked && (g.cloakBits & CLOAK_VISIBLE_ON_RADAR) === 0) continue;
      if (murk > 0) {
        const blink = Math.sin(g.hudClock * 3 + npc.pos.x * 0.01) * 0.5 + 0.5;
        if (blink < murk * 0.8) continue;
      }
      const pt = to(npc.pos.x, npc.pos.y);
      if (murk > 0) {
        pt.x += Math.sin(g.hudClock + npc.pos.y * 0.02) * murk * 6;
        pt.y += Math.cos(g.hudClock + npc.pos.x * 0.02) * murk * 6;
      }
      // ïntf BrightRadar/DimRadar; without an IFF unit every contact is the
      // same anonymous dot, and a derelict reads dim whatever it is
      ctx.fillStyle = !g.hasIff
        ? INTERFACE.brightRadar
        : npc.ally
          ? "#6fce8a"
          : npc.hostile
            ? "#e06a5a"
            : "#e8eef1";
      if (npc.disabled) ctx.fillStyle = INTERFACE.dimRadar;
      ctx.beginPath();
      ctx.arc(pt.x, pt.y, 1.5, 0, Math.PI * 2);
      ctx.fill();
      if (npc === g.targetNpc) {
        ctx.strokeStyle = "#ffffff";
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.arc(pt.x, pt.y, 4.5, 0, Math.PI * 2);
        ctx.stroke();
      }
    }

    if (!g.cloaked || (g.cloakBits & CLOAK_VISIBLE_ON_RADAR) !== 0) {
      ctx.fillStyle = g.cloaked ? "#7fa0c8" : "#9df0f7";
      ctx.shadowColor = "#5fd4e0";
      ctx.shadowBlur = 9;
      ctx.beginPath();
      ctx.arc(cx, cy, 2, 0, Math.PI * 2);
      ctx.fill();
      ctx.shadowBlur = 0;
    }
    ctx.restore();

    setText(this.scanRange, `SCAN ${RADAR_RANGE}`);
    setText(this.scanSys, `${g.system.name.toUpperCase()} SYS`);
  }

  // ---------------- identity ----------------

  private drawIdentity(g: Game): void {
    setText(this.pilot, g.pilotName);
    const name = g.system.govtName ?? "Independent";
    setText(this.govt, name);
    // gövt Color, the government's own theme colour, rather than a flat accent
    const want = g.system.govtId >= 128 ? systemGovtColor(g.system) : "#5fd4e0";
    if (this.govt.style.color !== want) this.govt.style.color = want;
  }

  // ---------------- gauges ----------------

  private drawGauges(g: Game): void {
    const rows: string[] = [];
    rows.push(
      barRow(
        "SHIELD",
        pct(g.ship.maxShield ? g.ship.shield / g.ship.maxShield : 0),
        "hud-bar-shield",
        g.ship.maxShield ? g.ship.shield / g.ship.maxShield : 0,
      ),
    );
    rows.push(
      barRow(
        "ARMOR",
        pct(g.ship.maxArmor ? g.ship.armor / g.ship.maxArmor : 0),
        "hud-bar-armor",
        g.ship.maxArmor ? g.ship.armor / g.ship.maxArmor : 0,
      ),
    );

    /*
     * Fuel is segmented because Nova counts it in whole jumps: ïntf
     * FuelFull/FuelPartial fill to the last complete jump in the bright colour
     * and show the remainder dim, so you can tell at a glance whether there is
     * actually a jump in the tank.
     */
    const max = Math.max(1, Math.min(20, g.player.maxFuelJumps));
    const whole = Math.floor(g.player.fuelJumps);
    const part = g.player.fuelJumps - whole;
    const segs: string[] = [];
    for (let i = 0; i < max; i++) {
      const cls =
        i < whole
          ? g.isAfterburning
            ? "on burn"
            : "on"
          : i === whole && part > 0.02
            ? "part"
            : "";
      segs.push(`<i class="${cls}"></i>`);
    }
    rows.push(
      `<div class="hud-gauge">
        <div class="hud-gauge-head"><span>FUEL</span><span>${whole} JUMP${whole === 1 ? "" : "S"}</span></div>
        <div class="hud-fuel">${segs.join("")}</div>
      </div>`,
    );

    if (g.ship.ion > 0) {
      const f = g.ship.ion / g.ship.maxIon;
      rows.push(
        barRow(
          "ION",
          pct(f),
          g.ship.ionized ? "hud-bar-ionized" : "hud-bar-ion",
          f,
        ),
      );
    }

    setHtml(this.gauges, rows.join(""));
  }

  // ---------------- nav ----------------

  private drawNav(g: Game): void {
    const dest = g.routeDest ? getSystem(g.routeDest).name : null;
    const kind = dest
      ? "HYPERSPACE"
      : g.targetPlanet
        ? "STELLAR NAV"
        : "NAV SYSTEM";
    const value = dest ?? g.targetPlanet?.name ?? "Offline";
    this.navBox.classList.toggle("off", !dest && !g.targetPlanet);
    setText(this.navKind, kind);
    setText(this.navValue, value);
  }

  // ---------------- weapons ----------------

  private drawWeapons(g: Game): void {
    const rows: string[] = [];
    let hasSecondary = false;
    for (const slot of g.weaponSlots.slice(0, 4)) {
      const sec = isSecondary(slot.weap);
      if (sec) hasSecondary = true;
      const ammo = sec ? ` ×${g.player.ammo[slot.weap.id] ?? 0}` : "";
      const count = slot.count > 1 ? ` ×${slot.count}` : "";
      const name = `${slot.weap.name.split(";")[0]}${count}${ammo}`;
      rows.push(
        `<div class="hud-weap${slot.cooldown > 0 ? " cooling" : ""}">
          <span class="hud-weap-name">${esc(name)}</span>
          <span class="hud-pill${sec ? " sec" : ""}">${sec ? "SEC" : "PRI"}</span>
        </div>`,
      );
    }
    if (!hasSecondary) {
      rows.push(
        `<div class="hud-weap empty">
          <span class="hud-weap-name">No Secondary Weapon</span>
          <span class="hud-pill dim">SEC</span>
        </div>`,
      );
    }
    setHtml(this.weapons, rows.join(""));
  }

  // ---------------- target ----------------

  private drawTarget(g: Game): void {
    const t = g.targetNpc;
    if (!t) {
      this.target.classList.add("empty");
      setHtml(
        this.target,
        `<div class="hud-targ-ring"><i></i></div><span class="hud-targ-none">No Target</span>`,
      );
      return;
    }
    this.target.classList.remove("empty");
    const type = t.typeId ? SHIPS[t.typeId] : undefined;
    const [, subtitle] = (type?.name ?? "").split(";");
    const tone = t.hostile ? "hostile" : t.personId !== null ? "named" : "";
    const status = t.disabled
      ? "Disabled"
      : `Shield ${Math.round(100 * (t.maxShield ? t.shield / t.maxShield : 0))}%`;
    const affil =
      t.disabled && t.boarded
        ? "Plundered"
        : t.disabled
          ? "Derelict"
          : g.govtLabel(t.govtId);

    setHtml(
      this.target,
      `<div class="hud-targ-head ${tone}">${esc(g.hailLabel(t))}</div>
       ${subtitle ? `<div class="hud-targ-sub">${esc(subtitle.trim())}</div>` : ""}
       <div class="hud-targ-art"></div>
       <div class="hud-targ-foot">
         <span class="${t.disabled ? "bad" : ""}">${esc(status)}</span>
         <span class="${t.hostile ? "bad" : ""}">${esc(affil)}</span>
       </div>`,
    );

    /*
     * Nova ships a red silhouette per hull as PICT 3000 + id - 128; only fall
     * back to tinting the sprite when a hull has none.
     */
    const art = this.target.querySelector<HTMLElement>(".hud-targ-art")!;
    const tpic = t.typeId ? targetPict(t.typeId) : null;
    const img = tpic ? getPict(tpic.file) : null;
    if (img && tpic) {
      art.style.backgroundImage = `url('/nova/picts/${tpic.file}')`;
      art.style.backgroundSize = "contain";
    } else if (t.sprite) {
      const sil = tintedShipSilhouette(t.sprite, "#c02020", 180, 90);
      if (sil) {
        art.style.backgroundImage = `url('${sil.toDataURL()}')`;
        art.style.backgroundSize = "contain";
      }
    }
  }

  // ---------------- ledger ----------------

  private drawLedger(g: Game): void {
    // STR# 4002 is Nova's own cargo-abbreviation list
    const abbrev = STR_LISTS["4002"] ?? [];
    const rows: [string, string, string][] = [];
    for (const [i, c] of COMMODITIES.entries()) {
      const held = g.player.cargo[c.id] ?? 0;
      if (held > 0) rows.push([abbrev[i] ?? c.name, String(held), ""]);
    }
    // jünk goods have no abbreviation of their own, so they go by name
    for (const [key, held] of Object.entries(g.player.cargo)) {
      const junk = junkFromCargoKey(key);
      if (junk && held > 0) rows.push([junk.name, String(held), ""]);
    }
    rows.push([
      "FREE",
      String(Math.max(0, g.player.cargoCap - g.cargoUsed())),
      "",
    ]);
    const special = g.player.activeMissions.find(
      (a) => a.cargoLoaded && a.cargoName,
    );
    if (special) rows.push(["SPECIAL", special.cargoName!, "special"]);
    rows.push(["CREDITS", g.player.credits.toLocaleString(), "credits"]);
    rows.push(["DATE", formatDateShort(g.player.date), "date"]);

    // reuse the row elements: the list is stable frame to frame, so only the
    // text changes and the browser never reflows the whole panel
    while (this.ledgerRows.length > rows.length) {
      this.ledgerRows.pop()!.el.remove();
    }
    while (this.ledgerRows.length < rows.length) {
      const el = document.createElement("div");
      el.className = "hud-led-row";
      const label = document.createElement("span");
      label.className = "hud-led-k";
      const value = document.createElement("span");
      value.className = "hud-led-v";
      el.append(label, value);
      this.ledger.append(el);
      this.ledgerRows.push({ el, label, value });
    }
    rows.forEach(([k, v, cls], i) => {
      const row = this.ledgerRows[i];
      setText(row.label, k);
      setText(row.value, v);
      const want = `hud-led-v ${cls}`.trim();
      if (row.value.className !== want) row.value.className = want;
    });
  }

  // ---------------- hints ----------------

  private drawHints(g: Game): void {
    const keys: [string, string][] = [
      ["↑↓←→ fly", g.afterburnerFuel > 0 ? "Z burn" : ""],
      ["Space fire", "^Ctrl secondary"],
      ["` target", "R closest"],
      ["Y hail", "B board"],
      ["L land", g.cloakBits > 0 ? "U cloak" : "C recall"],
      ["J jump", "H course"],
      ["M map", "W select"],
      ["Esc menu", "Caps 2×"],
    ];
    const html = keys
      .map(([a, b]) => `<span>${a}</span><span>${b}</span>`)
      .join("");
    if (html !== this.lastHints) {
      this.lastHints = html;
      this.hints.innerHTML = html;
    }
  }
}

// ---------------- helpers ----------------

function pct(f: number): string {
  return `${Math.round(Math.max(0, Math.min(1, f)) * 100)}%`;
}

function barRow(
  label: string,
  right: string,
  cls: string,
  frac: number,
): string {
  const w = `${Math.max(0, Math.min(1, frac)) * 100}%`;
  return `<div class="hud-gauge">
    <div class="hud-gauge-head"><span>${label}</span><span>${right}</span></div>
    <div class="hud-bar"><div class="${cls}" style="width:${w}"></div></div>
  </div>`;
}

/** Only touch the DOM when the value actually changed — this runs at 60fps. */
function setText(el: HTMLElement, text: string): void {
  if (el.textContent !== text) el.textContent = text;
}

function setHtml(el: HTMLElement, html: string): void {
  if (el.innerHTML !== html) el.innerHTML = html;
}

function esc(s: string): string {
  return s.replace(
    /[&<>"']/g,
    (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        c
      ] as string,
  );
}
