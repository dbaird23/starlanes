import {
  ALT_SPRITES,
  GLOW_SPRITES,
  loadUniverse,
  MISSIONS,
  SHIPS,
  SPOB_INDEX,
  SYSTEMS,
} from "./data/universe";
import { Game } from "./game/game";
import { grantHullOutfits, stockAmmo } from "./game/combat";
import {
  availableMissions,
  instantiateMission,
  substituteTags,
} from "./game/missions";
import { migrateLegacySave } from "./game/pilots";
import { MainMenu } from "./ui/menu";

const canvas = document.getElementById("game") as HTMLCanvasElement;

async function boot(): Promise<void> {
  const ctx = canvas.getContext("2d")!;
  canvas.width = window.innerWidth;
  canvas.height = window.innerHeight;
  ctx.fillStyle = "#9fb2c8";
  ctx.font = "16px Helvetica, Arial, sans-serif";
  ctx.textAlign = "center";
  ctx.fillText("Loading galaxy...", canvas.width / 2, canvas.height / 2);

  await loadUniverse();
  migrateLegacySave();

  const game = new Game(canvas);
  const menu = new MainMenu({
    // Enter ship resumes a session paused with Esc when the same pilot is up.
    enterShip: (pilotId, strict) => game.enterShip(pilotId, strict),
    // Open Pilot / New Pilot load from disk (last leave-planet save only).
    loadPilot: (pilotId, strict, difficulty) => game.startPilot(pilotId, strict, difficulty),
    seedPilot: (pilotId, identity, strict, difficulty) =>
      game.seedPilot(pilotId, identity, strict, difficulty),
    onDeletePilot: (pilotId) => game.clearPausedSession(pilotId),
  });
  game.onMenu = () => menu.show(game.pilotId);
  menu.show();

  // debug handles (harmless in production; useful for automated testing)
  (window as unknown as { game: Game }).game = game;
  (window as unknown as { SHIPS: typeof SHIPS }).SHIPS = SHIPS;
  (window as unknown as { GLOWS: typeof GLOW_SPRITES }).GLOWS = GLOW_SPRITES;
  (window as unknown as { ALTS: typeof ALT_SPRITES }).ALTS = ALT_SPRITES;
  // the mission table and the offer filter, so a storyline can be walked from
  // the console (a dynamic import would get a separate, empty module instance)
  (window as unknown as { MISSIONS: typeof MISSIONS }).MISSIONS = MISSIONS;
  (
    window as unknown as { availableMissions: typeof availableMissions }
  ).availableMissions = availableMissions;
  // the roll that turns a posting into an accepted mission, so a briefing can
  // be read without walking to the bar, and the tag substituter beside it, so
  // a probe string can exercise every <TAG> at once
  (
    window as unknown as { instantiateMission: typeof instantiateMission }
  ).instantiateMission = instantiateMission;
  (
    window as unknown as { substituteTags: typeof substituteTags }
  ).substituteTags = substituteTags;
  // where every placed stellar lives, and the system table behind it, so a
  // walkthrough can jump to a mission's AvailStel without hunting for it
  (window as unknown as { SPOB_INDEX: typeof SPOB_INDEX }).SPOB_INDEX =
    SPOB_INDEX;
  (window as unknown as { SYSTEMS: typeof SYSTEMS }).SYSTEMS = SYSTEMS;

  // TEMPORARY: reset player to stock Unrelenting (ship 374) — remove once
  // the ionization loadout fix has been verified on a live save.
  (window as unknown as { resetToUnrelenting: () => void }).resetToUnrelenting =
    () => {
      const shipId = "374";
      const g = game as unknown as {
        keepPilotOutfits(): void;
        applyShipType(id: string): void;
      };
      g.keepPilotOutfits();
      grantHullOutfits(shipId, game.player.outfits);
      g.applyShipType(shipId);
      game.player.fuelJumps = game.player.maxFuelJumps;
      const ammo = stockAmmo(shipId);
      for (const [weapId, count] of Object.entries(ammo)) {
        game.player.ammo[weapId] = count;
      }
      console.log("Reset to stock Unrelenting (ship 374).");
    };

  let last = performance.now();
  function frame(now: number): void {
    // Cap the wall-clock step first so a hitch can't blow physics, then apply
    // Nova's Caps Lock 2× clock (game.timeScale) so the sim races while the
    // display still paints once per real frame.
    const raw = Math.min((now - last) / 1000, 0.05);
    last = now;
    game.update(raw * game.timeScale);
    game.render();
    requestAnimationFrame(frame);
  }
  requestAnimationFrame(frame);
}

boot().catch((err) => {
  document.body.innerHTML = `<div style="color:#e88; font: 14px sans-serif; padding: 40px">
    Failed to load galaxy data: ${err}.<br><br>
    Run <code>node scripts/extract-nova.mjs "&lt;path to Nova Files&gt;"</code> to generate public/nova/galaxy.json.
  </div>`;
});
