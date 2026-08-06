import Phaser from "phaser";
import type { Player } from "../entities/player";
import type { Run } from "../systems/run";
import type { SpawnDirector } from "../systems/spawn-director";
import { type DevConfig, isConfigured, parseDevConfig } from "./dev-config";

/**
 * The playtest harness — issue #30.
 *
 * The map's tuning bar is Nate playing a phase and saying yes, and nobody plays
 * eighteen minutes to find out whether Panic feels like panic. This is what
 * makes the other tuning tickets reachable: start the run anywhere in it, watch
 * it at a speed you choose, survive it, and see what the director thinks it is
 * doing while you do.
 *
 * **It is dev-only, structurally.** `GameScene` constructs it inside a single
 * `import.meta.env.DEV` branch; Vite replaces that constant with `false` in a
 * production build and Rollup then drops the branch and this module from the
 * bundle entirely. There is no runtime flag to leave on by accident.
 *
 * Which is also why the panel is styled inline here rather than from a `.css`
 * file next door, as `Overlay` is: Vite collects the CSS of any statically
 * imported module into the entry stylesheet *before* the JS is tree-shaken, so
 * a `dev-harness.css` would ship — inert, but shipped — in a build that
 * contains none of the code that uses it. One element's worth of `cssText` is
 * the cheaper honesty.
 *
 * **It is also outside the tested core.** The seek is `run.tick(startAt)` — the
 * ordinary method, called once with a large delta — so `Run` gains no debug
 * API and no debug branch, and the harness inherits #29's guarantee that there
 * is exactly one clock in the game. `SpawnDirector` likewise only gained a
 * `readout`, which is a pure read of what `tick` reads. The whole of the
 * harness's reach into the run is: one early `tick`, a multiplier on the delta,
 * and a boolean on `Player`.
 *
 * Where the settings come from is split deliberately — see the note in
 * `dev-config.ts`. The URL declares the run (`?at=panic&speed=4&invuln`); the
 * keys below nudge it while you watch.
 *
 * A caveat worth knowing before trusting what you see: time scale multiplies
 * the frame delta rather than substepping, so above ~4x movement and collision
 * are visibly coarser. It is a tool for watching *pressure*, not for measuring
 * damage.
 */
export class DevHarness {
  /** What `[` and `]` step through. Ends at 4x — see the caveat above. */
  private static readonly LADDER = [0.1, 0.25, 0.5, 1, 2, 4] as const;

  /** Seconds between readout rewrites — `HudScene.DAMAGE_REDRAW`'s reasoning. */
  private static readonly REDRAW = 0.1;

  /**
   * Pinned to the *viewport*, deliberately not to `Overlay`'s 1280x720 design
   * box: that box is scaled to the letterboxed canvas, which is right for the
   * modals and wrong for a debug readout, which wants to stay legible at a
   * phone-sized canvas. Bottom-left, because the HUD owns both top corners, and
   * `pointer-events: none` because the joystick is a pointer surface down here.
   */
  private static readonly PANEL_CSS = `
    position: fixed; left: 8px; bottom: 8px; z-index: 10;
    margin: 0; padding: 8px 10px; max-width: calc(100vw - 16px);
    overflow: hidden; pointer-events: none; user-select: none;
    font: 12px/1.45 ui-monospace, SFMono-Regular, Menlo, monospace;
    white-space: pre; color: #b6ffb6;
    background: rgba(0, 0, 0, 0.66);
    border: 1px solid rgba(182, 255, 182, 0.25); border-radius: 6px;
  `;

  timeScale: number;

  private readonly config: DevConfig;
  private readonly panel: HTMLPreElement;
  private readonly keys: Record<Binding, Phaser.Input.Keyboard.Key>;
  /** Consumed on the first frame; see `frame`. */
  private pendingSeek: number;
  private redrawIn = 0;

  private constructor(
    scene: Phaser.Scene,
    keyboard: Phaser.Input.Keyboard.KeyboardPlugin,
    private readonly targets: HarnessTargets,
    search: string,
  ) {
    this.config = parseDevConfig(search);
    this.timeScale = this.config.timeScale;
    this.pendingSeek = this.config.startAt;
    this.targets.player.invulnerable = this.config.invulnerable;

    /* Deliberately none of WASD, the arrows, or anything the joystick or the
       level-up modal reads. `true, false` matches `Controls`: capture the key
       so the browser does not act on it, and do not repeat while held. */
    const key = (code: number): Phaser.Input.Keyboard.Key =>
      keyboard.addKey(code, true, false);
    const codes = Phaser.Input.Keyboard.KeyCodes;
    this.keys = {
      slower: key(codes.OPEN_BRACKET),
      faster: key(codes.CLOSED_BRACKET),
      invuln: key(codes.I),
      panel: key(codes.BACKTICK),
    };

    this.panel = document.createElement("pre");
    this.panel.id = "dev-harness";
    this.panel.style.cssText = DevHarness.PANEL_CSS;
    document.body.appendChild(this.panel);
    this.draw();

    scene.events.once(Phaser.Scenes.Events.SHUTDOWN, () => this.destroy());
  }

  /**
   * Build one for this run, or `null` if the scene has no keyboard.
   *
   * Reads `location.search` here rather than taking it as an argument, so the
   * one call site in `GameScene` stays a single line and every other file stays
   * ignorant of the harness's grammar.
   */
  static attach(
    scene: Phaser.Scene,
    targets: HarnessTargets,
  ): DevHarness | null {
    const keyboard = scene.input.keyboard;
    if (keyboard === null) return null;
    return new DevHarness(scene, keyboard, targets, window.location.search);
  }

  /**
   * Call at the top of `GameScene.update`, with the clamped real delta in
   * seconds. Returns the delta the run should actually advance by.
   *
   * The seek lands here rather than in `create` for a reason that is only
   * visible on screen: `scene.launch` is queued, so `HudScene` has not
   * subscribed to the bus yet while `create` is running, and a seek there would
   * emit its `timeChanged` into nothing — the clock would read 30:00 for up to
   * a second before correcting itself. By the first `update` the HUD is
   * listening.
   */
  frame(delta: number): number {
    this.pollKeys();

    if (this.pendingSeek > 0) {
      this.targets.run.tick(this.pendingSeek);
      this.pendingSeek = 0;
    }

    this.redrawIn -= delta;
    if (this.redrawIn <= 0) {
      this.redrawIn = DevHarness.REDRAW;
      this.draw();
    }

    return delta * this.timeScale;
  }

  private pollKeys(): void {
    const pressed = Phaser.Input.Keyboard.JustDown;
    if (pressed(this.keys.slower)) this.step(-1);
    if (pressed(this.keys.faster)) this.step(1);
    if (pressed(this.keys.invuln)) {
      this.targets.player.invulnerable = !this.targets.player.invulnerable;
      this.draw();
    }
    // Hidden rather than destroyed — for the screenshots where it is in the way.
    if (pressed(this.keys.panel))
      this.panel.style.display = this.panel.style.display === "none" ? "" : "none";
  }

  /**
   * Move one rung along the ladder. Snaps from wherever a `?speed=` left us to
   * the nearest rung first, so `?speed=3` then `]` gives 4 rather than 3.
   */
  private step(direction: number): void {
    const rungs = DevHarness.LADDER;
    const nearest = rungs.reduce((best, rung) =>
      Math.abs(rung - this.timeScale) < Math.abs(best - this.timeScale)
        ? rung
        : best,
    );
    const index = rungs.indexOf(nearest) + direction;
    this.timeScale = rungs[Math.min(rungs.length - 1, Math.max(0, index))]!;
    this.draw();
  }

  private draw(): void {
    const { run, director, player, liveEnemies } = this.targets;
    const elapsed = run.elapsed;
    const view = director.readout(elapsed);

    const lines = [
      `DEV   ${clock(elapsed)} elapsed   ${clock(run.timeLeft)} left`,
      `phase ${view.phase.displayName} (${view.phase.id})  ` +
        `${Math.round(view.progress * 100)}%  ` +
        `lvl-ups ${view.phase.levelUps.join("-")}` +
        (view.running ? "" : "  [director stopped]"),
      /* The cap column earns its width (issue #31): a capped track that has
         hit its ceiling looks identical to a broken one — nothing spawns, the
         countdown keeps resetting — and "4/4" is the difference between tuning
         the number and hunting a bug. */
      ...view.tracks.map(
        (track) =>
          `  ${track.displayName.padEnd(20)}` +
          `x${String(track.wave).padEnd(3)}` +
          `every ${track.interval.toFixed(2)}s   ` +
          `next ${track.nextIn.toFixed(2)}s   ` +
          `live ${track.live}${track.max === null ? "" : `/${track.max}`}`,
      ),
      // Hordes and rings, when the phase has them (issue #34) — the Struggle
      // tuning pass wants their cadence on screen as much as a track's.
      ...view.events.map(
        (event) =>
          `  ${`event ${event.kind}`.padEnd(20)}` +
          `every ${event.interval.toFixed(2)}s   ` +
          `next ${event.nextIn.toFixed(2)}s`,
      ),
      `live  ${liveEnemies()} enemies   ` +
        `hp ${player.hp}${player.invulnerable ? " (INVULN)" : ""}`,
      `keys  [ ] speed ${this.timeScale}x    i invuln    \` hide`,
    ];

    if (this.config.problems.length > 0)
      lines.push(...this.config.problems.map((p) => `!!    ${p}`));
    else if (!isConfigured(this.config))
      lines.push(`url   ?at=${view.phase.id}&speed=4&invuln`);

    this.panel.textContent = lines.join("\n");
  }

  /* The keys are not removed here, for the reason `Controls` does not remove
     its own: a scene's `KeyboardPlugin` clears its keys on shutdown, and the
     harness is rebuilt from scratch by the next `create` along with everything
     else the restart boundary discards. */
  private destroy(): void {
    this.panel.remove();
  }
}

/** What the harness reaches into. Everything else about the run is off-limits. */
export interface HarnessTargets {
  readonly run: Run;
  readonly director: SpawnDirector;
  readonly player: Player;
  /** The pool's live count — the harness never holds the pool itself. */
  readonly liveEnemies: () => number;
}

type Binding = "slower" | "faster" | "invuln" | "panel";

/** `HudScene`'s `formatClock`, duplicated rather than exported: this one shows
    a run that is 30 minutes long, and it is dev-only code that must not become
    a reason to widen a shipping module's surface. */
function clock(seconds: number): string {
  const whole = Math.max(0, Math.floor(seconds));
  return `${Math.floor(whole / 60)}:${String(whole % 60).padStart(2, "0")}`;
}
