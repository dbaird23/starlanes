import {
  COMMODITIES,
  GOVT_COMM_NAMES,
  INTERFACE,
  SHIPS,
  STR_LISTS,
  getSystem,
  junkFromCargoKey,
  targetPict,
} from "../data/universe";
import { asset } from "../asset";
import { isSecondary } from "../game/combat";
import { getPict, tintedShipSilhouette } from "../engine/sprites";
import type { Game } from "../game/game";

/**
 * The flight status sidebar — design 3a, "Classic": Nova's own brushed-metal
 * plate rebuilt in CSS, chrome-bezelled wells and all.
 *
 * This is DOM rather than part of the game canvas. The panel is layered
 * gradients, inset bezels and engraved type, all of which CSS does in a
 * stylesheet and canvas 2D does in a few hundred fragile lines; the landed
 * screens are already HTML, so this matches the rest of the UI. The one
 * genuinely per-frame thing — the scanner's moving contacts — gets a small
 * nested <canvas> of its own.
 *
 * The ïntf rects still cannot *position* anything, because the design is
 * height-flexible and the rects are a fixed 192x~590 plate. What they do now is
 * set the width and the two horizontal measures, which the design happens to
 * agree with: radarArea is 176 square at x=8, so the plate is 8+176+8 = 192 and
 * the scanner is square; shieldArea starts at x=35, leaving a 27px gutter to
 * its left, which is exactly Nova's own column of gauge icons. Colours, font
 * and the two type sizes come from the live resource too — see
 * publishInterfaceVars in data/universe.ts. StatusBkgnd (PICT 700, the plate
 * artwork) stays deliberately undrawn; the metal here is the design's.
 */

/**
 * Matches --hud-w in style.css; the game reserves this much of the canvas.
 * ïntf 128's plate: radarArea.x * 2 + radarArea.w.
 */
export const HUD_W = 192;

/**
 * The status-bar plate artwork, in its own pixel space.
 *
 * ïntf **StatusBkgnd** finally names something: it is the PICT of the plate,
 * 700 for the default bar and 701-706 for the six government ones, and the art
 * is looked up by that id at `/hud/statusbar-<id>.jpg`. Nova's own 700-706 are
 * not extracted (no `status` category in picts.json), so these are hand-drawn
 * replacements; a government with no file falls back to the CSS metal, unless
 * a `.plate-<id>` rule draws it instead — which is how 706, Vell-os, works.
 *
 * JPEG, not PNG or AVIF, and the reason is worth keeping: the plates are
 * photographic metal, which PNG cannot compress (6.7 MB for the six at 384
 * wide against 1.5 MB of JPEG at the same 43-48 dB). AVIF was smaller again,
 * but `sips` encodes at least one of these six into a file that Chromium
 * fetches whole, reports the right dimensions for, and then decodes to solid
 * black — so a plate would silently vanish. If you re-encode these, check each
 * one actually paints rather than trusting the encoder's exit code.
 *
 * The plate is one tall image that is **never squashed** — it is drawn at
 * HUD_W wide, top-aligned, and a short window simply loses the bottom of it.
 * That makes the panel's geometry fixed rather than flexible, so the readouts
 * are positioned absolutely into the artwork's cut-outs instead of flowing.
 */

/**
 * The width the openings below were **measured** in, which is not the width the
 * files ship at: the art was drawn 481 wide and is exported at 384, twice the
 * 192 CSS px the panel occupies, so it is pin-sharp on a 2× display and no
 * larger than it has to be. Only the aspect ratio matters at runtime — CSS
 * scales whatever arrives to HUD_W — so this stays 481 and the coordinates
 * below stay in the space they were taken from. Re-exporting at another size
 * needs no change here; changing this number would move every readout.
 */
const PLATE_W = 481;
/** x extent of every opening, in the art's pixels */
const OPEN_X = 30;
const OPEN_R = 435;

/**
 * The eight openings, top to bottom, in the art's pixels.
 *
 * Measured off the artwork rather than eyeballed: the plate is built on a
 * regular grid whose frame ridges are all exactly 42px tall, and these are the
 * gaps between them. (Don't measure by looking for full-width black — each
 * opening has a soft lit reflection along its top and bottom inside edges, and
 * that test cuts every hole short.)
 *
 * **Every status-bar plate has to share this geometry.** Nothing reads the
 * openings out of the PNG at runtime; changing where a hole sits means
 * changing it here, for all seven governments at once.
 */
const OPENINGS = {
  scan: [21, 369],
  gauges: [412, 584],
  nav: [627, 705],
  pri: [748, 799],
  sec: [842, 893],
  target: [936, 1220],
  spare: [1263, 1352], // old cargo/credits hole — repurposed TBD
  ledger: [1395, 1649], 
} as const satisfies Record<string, readonly [number, number]>;

/**
 * There is no EJECT button. The plate is all instrument holes and decorative
 * tail with nowhere to put one, and pulling the pod's handle is Alt-X — the
 * key hints in the controls hole say so. `playerDestroyed(deliberate)` and
 * oütf ModType 20's auto-eject are unaffected.
 */

/** art pixels → panel pixels */
const K = HUD_W / PLATE_W;

/** Absolute placement for one opening, as an inline style. */
function boxStyle([y0, y1]: readonly [number, number]): string {
  return (
    `left:${(OPEN_X * K).toFixed(1)}px;` +
    `width:${((OPEN_R - OPEN_X) * K).toFixed(1)}px;` +
    `top:${(y0 * K).toFixed(1)}px;` +
    `height:${((y1 - y0 + 1) * K).toFixed(1)}px`
  );
}

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
  private plate!: HTMLElement;
  private scan!: HTMLCanvasElement;
  private scanCtx!: CanvasRenderingContext2D;
  private gauges!: HTMLElement;
  private navBox!: HTMLElement;
  private navKind!: HTMLElement;
  private navValue!: HTMLElement;
  private weapPri!: HTMLElement;
  private weapSec!: HTMLElement;
  private target!: HTMLElement;
  private ledger!: HTMLElement;
  private speedBadge!: HTMLElement;

  private ledgerRows: LedgerRow[] = [];
  /** StatusBkgnd id the plate art is currently showing, so it loads once */
  private plateArtId = -1;

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
      <div class="hud-plate">
        <div class="hud-machinery" aria-hidden="true">
          <span class="hud-mach-rail"></span>
          <span class="hud-mach-vent"></span>
          <span class="hud-mach-pipe"></span>
          <span class="hud-mach-lip"></span>
        </div>

        <div class="hud-well hud-scan" style="${boxStyle(OPENINGS.scan)}">
          <canvas class="hud-scan-c"></canvas>
        </div>

        <div class="hud-well hud-gauges" style="${boxStyle(OPENINGS.gauges)}"></div>

        <div class="hud-well hud-nav" style="${boxStyle(OPENINGS.nav)}">
          <div class="hud-nav-kind"></div>
          <div class="hud-nav-value"></div>
        </div>

        <div class="hud-well hud-weap hud-weap-pri" style="${boxStyle(OPENINGS.pri)}"></div>
        <div class="hud-well hud-weap hud-weap-sec" style="${boxStyle(OPENINGS.sec)}"></div>

        <div class="hud-well hud-target" style="${boxStyle(OPENINGS.target)}"></div>

        <div class="hud-well hud-spare" style="${boxStyle(OPENINGS.spare)}"></div>

        <div class="hud-well hud-ledger" style="${boxStyle(OPENINGS.ledger)}"></div>
      </div>`;

    const q = <T extends HTMLElement>(sel: string) =>
      this.root.querySelector<T>(sel)!;
    this.scan = q<HTMLCanvasElement>(".hud-scan-c");
    this.scanCtx = this.scan.getContext("2d")!;
    this.gauges = q(".hud-gauges");
    this.navBox = q(".hud-nav");
    this.navKind = q(".hud-nav-kind");
    this.navValue = q(".hud-nav-value");
    this.plate = q(".hud-plate");
    this.weapPri = q(".hud-weap-pri");
    this.weapSec = q(".hud-weap-sec");
    this.target = q(".hud-target");
    this.ledger = q(".hud-ledger");
    this.speedBadge = q(".speed-badge");
  }

  /**
   * Point the plate at the current ïntf's StatusBkgnd art, or drop back to the
   * CSS metal when that government has no PNG yet. Cheap to call every frame —
   * the id only changes when the player's ship does.
   */
  private applyPlateArt(): void {
    const want = INTERFACE.statusBkgnd;
    if (want === this.plateArtId) return;
    /*
     * The id also goes on as a class, so a plate can be *drawn* instead of
     * photographed. Vell-os (706) is: Nova's is black with cyan light piped
     * around each opening and down both edges, which is gradients and glows —
     * a few lines of CSS rather than 250 KB of JPEG of a gradient.
     */
    if (this.plateArtId >= 0) {
      this.plate.classList.remove(`plate-${this.plateArtId}`);
    }
    this.plate.classList.add(`plate-${want}`);
    this.plateArtId = want;
    // through asset() so the path survives a non-root deploy (GH Pages
    // serves under /starlanes/, where a bare /hud/... 404s and every plate
    // silently fell back to the CSS metal)
    const url = asset(`hud/statusbar-${want}.jpg`);
    const probe = new Image();
    probe.onload = () => {
      // a later ship change may have moved on while this was loading
      if (this.plateArtId !== want) return;
      this.plate.style.backgroundImage = `url('${url}')`;
      this.plate.classList.add("has-art");
    };
    probe.onerror = () => {
      if (this.plateArtId !== want) return;
      this.plate.style.backgroundImage = "";
      this.plate.classList.remove("has-art");
    };
    probe.src = url;
  }

  /** Called once a frame while in flight. */
  update(g: Game): void {
    this.applyPlateArt();
    this.speedBadge.classList.toggle("hidden", g.timeScale <= 1);
    this.drawScanner(g);
    this.drawGauges(g);
    this.drawNav(g);
    this.drawWeapons(g);
    this.drawTarget(g);
    this.drawLedger(g);
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
      ctx.fillStyle = g.cloaked ? INTERFACE.dimRadar : INTERFACE.brightRadar;
      ctx.shadowColor = INTERFACE.brightRadar;
      ctx.shadowBlur = 7;
      ctx.beginPath();
      ctx.arc(cx, cy, 2, 0, Math.PI * 2);
      ctx.fill();
      ctx.shadowBlur = 0;
    }
    ctx.restore();
  }

  // ---------------- gauges ----------------

  private drawGauges(g: Game): void {
    const rows: string[] = [];
    const sh = g.ship.maxShield ? g.ship.shield / g.ship.maxShield : 0;
    const ar = g.ship.maxArmor ? g.ship.armor / g.ship.maxArmor : 0;
    rows.push(barRow("shield", "var(--hud-shield)", sh, pct(sh)));
    rows.push(barRow("armor", "var(--hud-armor)", ar, pct(ar)));

    /*
     * Fuel is one continuous bar. Nova counts it in whole jumps, so an earlier
     * pass drew a segment per jump with the count printed beside it; 3a's plate
     * has neither, and the ïntf's two fuel colours survive the change — FuelFull
     * is the fill and FuelPartial the empty run behind it. Afterburning takes
     * the bar gold, which is the one thing here that is not the resource's.
     */
    const fuel = g.player.maxFuelJumps
      ? g.player.fuelJumps / g.player.maxFuelJumps
      : 0;
    rows.push(
      barRow(
        "fuel",
        g.isAfterburning ? "var(--hud-gold)" : "var(--hud-fuel)",
        fuel,
        "",
      ),
    );

    // ion has no ïntf colour of its own — the resource names three gauges
    if (g.ship.ion > 0) {
      const f = g.ship.ion / g.ship.maxIon;
      rows.push(barRow("ion", g.ship.ionized ? "#d8c840" : "#8a7fd0", f, pct(f)));
    }

    setHtml(this.gauges, rows.join(""));
  }

  // ---------------- nav ----------------

  private drawNav(g: Game): void {
    // Nova's own wording for the nav box, which names the kind of destination
    const nextId = g.route[0] ?? g.routeDest;
    const dest = nextId ? getSystem(nextId).name : null;
    const kind = dest
      ? "Hyperspace"
      : g.targetPlanet
        ? "Stellar Navigation"
        : "Navigation";
    const value = dest ?? g.targetPlanet?.name ?? "Offline";
    this.navBox.classList.toggle("off", !dest && !g.targetPlanet);
    // Course set but the no-jump well is still holding you — dim the address
    // so the HUD shows why J is not engaging.
    this.navBox.classList.toggle("nojump", !!(dest && g.inNoJumpZone));
    setText(this.navKind, kind);
    setText(this.navValue, value);
  }

  // ---------------- weapons ----------------

  /**
   * The plate has one hole for the primaries and one for the secondary, so a
   * hull with four primary slots has to say so on a single line — the first
   * weapon's name, then "+N" for the rest. They all fire together on Space, so
   * there is nothing to choose between them; Nova prints no primary line at
   * all for exactly that reason.
   */
  private drawWeapons(g: Game): void {
    const pri = g.weaponSlots.filter((s) => !isSecondary(s.weap));
    const sec = g.weaponSlots.filter((s) => isSecondary(s.weap));

    const label = (
      slot: (typeof g.weaponSlots)[number],
      extra: number,
      ammo: boolean,
    ): string => {
      const count = slot.count > 1 ? ` ×${slot.count}` : "";
      const rounds = ammo ? ` ×${g.player.ammo[slot.weap.id] ?? 0}` : "";
      const more = extra > 0 ? ` +${extra}` : "";
      return `${slot.weap.name.split(";")[0]}${count}${rounds}${more}`;
    };

    weapLine(
      this.weapPri,
      pri.length ? label(pri[0], pri.length - 1, false) : "No Primary Weapon",
      !pri.length,
      pri.some((s) => s.cooldown > 0),
    );
    weapLine(
      this.weapSec,
      sec.length ? label(sec[0], sec.length - 1, true) : "No Secondary Weapon",
      !sec.length,
      sec.some((s) => s.cooldown > 0),
    );
  }

  // ---------------- target ----------------

  private drawTarget(g: Game): void {
    const t = g.targetNpc;
    if (!t) {
      this.target.classList.add("empty");
      setHtml(this.target, `<span class="hud-targ-none">No Target</span>`);
      return;
    }
    this.target.classList.remove("empty");
    const type = t.typeId ? SHIPS[t.typeId] : undefined;
    const typeName = (type?.name ?? "").split(";")[0];
    const isNamed = t.personId !== null;
    // Named captains: head shows their personal name, so show the hull type +
    // subtitle below (e.g. "Pirate Starbridge Class B"). Unnamed contacts: head
    // already shows the hull class, so show only the subtitle (e.g. "Class B").
    const hullVariant = type?.subtitle?.trim() || undefined;
    const variant: string | undefined = isNamed
      ? [typeName, hullVariant].filter(Boolean).join(" ") || undefined
      : hullVariant;
    const tone = t.hostile ? "hostile" : isNamed ? "named" : "";
    const status = t.disabled
      ? "Disabled"
      : t.shield >= t.maxShield * 0.01 || !t.maxShield
        ? `Shield ${Math.round(100 * (t.maxShield ? t.shield / t.maxShield : 0))}%`
        : `Armor ${Math.round(100 * (t.maxArmor ? t.armor / t.maxArmor : 0))}%`;
    const affil =
      t.disabled && t.boarded
        ? "Plundered"
        : t.disabled
          ? "Derelict"
          : t.govtId >= 128
            ? (GOVT_COMM_NAMES[String(t.govtId)] || g.govtLabel(t.govtId))
            : "Independent";

    setHtml(
      this.target,
      `<div class="hud-targ-head ${tone}">${esc(g.hailLabel(t))}</div>
       ${variant ? `<div class="hud-targ-sub">${esc(variant)}</div>` : ""}
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
    /*
     * The artwork's hole is three lines tall and the rest is clipped, so the
     * two the opening is named for go first. Nova's own plate prints only
     * these; the per-commodity manifest below them is ours, and is what a
     * loaded hold loses. The date used to sit here as a third line and now
     * lives on the map screen, which buys the manifest a line back.
     */
    const rows: [string, string, string][] = [
      // fleet-wide: FREE is what you could still buy, and trader escorts count
      ["FREE", String(Math.max(0, g.cargoSpace())), ""],
      ["CREDITS", g.player.credits.toLocaleString(), "credits"],
    ];
    const special = g.player.activeMissions.find(
      (a) => a.cargoLoaded && a.cargoName,
    );
    if (special) rows.push(["SPECIAL", special.cargoName!, "special"]);
    for (const [i, c] of COMMODITIES.entries()) {
      const held = g.player.cargo[c.id] ?? 0;
      if (held > 0) rows.push([abbrev[i] ?? c.name, String(held), ""]);
    }
    // jünk goods have no abbreviation of their own, so they go by name
    for (const [key, held] of Object.entries(g.player.cargo)) {
      const junk = junkFromCargoKey(key);
      if (junk && held > 0) rows.push([junk.name, String(held), ""]);
    }

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
}

// ---------------- helpers ----------------

function pct(f: number): string {
  return `${Math.round(Math.max(0, Math.min(1, f)) * 100)}%`;
}

/**
 * One gauge: Nova's round icon in the 27px gutter ïntf leaves to the left of
 * the bars, then the inset trough. The fill takes the resource's own colour as
 * a background-*colour* so the trough's gloss layer survives on top of it. A
 * readout rides inside the trough where one is passed — the original prints no
 * number, but the panel has nowhere else 192px wide to put one.
 */
function barRow(
  icon: string,
  color: string,
  frac: number,
  readout: string,
): string {
  const w = `${Math.max(0, Math.min(1, frac)) * 100}%`;
  return `<div class="hud-gauge">
    <span class="hud-gicon ${icon}"></span>
    <span class="hud-trough hud-trough-${icon}"><i style="width:${w};background-color:${color}"></i>${
      readout ? `<b>${readout}</b>` : ""
    }</span>
  </div>`;
}

/** One of the two weapon holes. */
function weapLine(
  el: HTMLElement,
  name: string,
  empty: boolean,
  cooling: boolean,
): void {
  setText(el, name);
  el.classList.toggle("empty", empty);
  el.classList.toggle("cooling", cooling);
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
