import { GLOW_SPRITES, loadUniverse, SHIPS } from "./data/universe";
import { Game } from "./game/game";
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
  const menu = new MainMenu((pilotId, strict) => game.startPilot(pilotId, strict));
  game.onMenu = () => menu.show();
  menu.show();

  // debug handles (harmless in production; useful for automated testing)
  (window as unknown as { game: Game }).game = game;
  (window as unknown as { SHIPS: typeof SHIPS }).SHIPS = SHIPS;
  (window as unknown as { GLOWS: typeof GLOW_SPRITES }).GLOWS = GLOW_SPRITES;

  let last = performance.now();
  function frame(now: number): void {
    const dt = Math.min((now - last) / 1000, 0.05);
    last = now;
    game.update(dt);
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
