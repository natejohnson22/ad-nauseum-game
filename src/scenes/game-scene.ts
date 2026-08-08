import Phaser from "phaser";
import type { EnemyBehavior } from "../content/types";
import type { Upgrade } from "../content/upgrades";
import { UPGRADE_POOL } from "../content/upgrades";
import { WEAPONS } from "../content/weapons";
import { ENEMIES } from "../content/enemies";
import { Controls } from "../core/controls";
import { EventBus, type GameBus } from "../core/event-bus";
import { Pool } from "../core/pool";
import { DevHarness } from "../dev/dev-harness";
import { Boomerang } from "../entities/boomerang";
import { DamageNumber } from "../entities/damage-number";
import { Engagement } from "../entities/engagement";
import { Enemy } from "../entities/enemy";
import { EnemyProjectile } from "../entities/enemy-projectile";
import { Orbiter } from "../entities/orbiter";
import { Player } from "../entities/player";
import { SpawnTelegraph } from "../entities/spawn-telegraph";
import { SwordSwing } from "../entities/sword-swing";
import { Progression } from "../systems/progression";
import { Run, type RunOutcome } from "../systems/run";
import { SpawnDirector } from "../systems/spawn-director";
import { WeaponManager } from "../systems/weapon-manager";
import { AdBreak } from "../ui/ad-break";
import { LevelUpModal } from "../ui/level-up-modal";
import { Overlay } from "../ui/overlay";
import { WinScreen } from "../ui/win-screen";
import { HudScene } from "./hud-scene";

/**
 * The composition root — issue #7. Thin by design: it creates the systems, owns
 * the pools and the camera, and its `update` does nothing but tick the systems
 * in a fixed order. It also stands in for `main.gd`'s wiring, which is why the
 * three small sinks (`onEnemyDamaged`, `onEnemyDied`, `onEngagementCollected`)
 * live here.
 *
 * Slice 3 closes the run: the parallel `HudScene` draws the readouts, and both
 * endings land on a DOM screen whose button restarts this scene in place —
 * `reload_current_scene()`'s replacement, and the reason `create` builds every
 * per-run object (bus included) rather than reusing anything.
 */
export class GameScene extends Phaser.Scene {
  static readonly KEY = "GameScene";

  private bus!: GameBus;
  private controls!: Controls;
  private player!: Player;
  private enemies!: Pool<Enemy>;
  /** The orange dots an event telegraphs behind before its enemies land (#34). */
  private spawnTelegraphs!: Pool<SpawnTelegraph>;
  private enemyShots!: Pool<EnemyProjectile>;
  private swings!: Pool<SwordSwing>;
  private boomerangs!: Pool<Boomerang>;
  private orbiters!: Pool<Orbiter>;
  private drops!: Pool<Engagement>;
  private damageNumbers!: Pool<DamageNumber>;
  private director!: SpawnDirector;
  private weapons!: WeaponManager;
  private progression!: Progression;
  private run!: Run;
  private overlay!: Overlay;
  private levelUpModal!: LevelUpModal;
  private winScreen!: WinScreen;
  private adBreak!: AdBreak;
  /**
   * The playtest harness (issue #30) — `null` in a production build, where the
   * branch that builds it is compiled away along with the module itself.
   */
  private dev: DevHarness | null = null;

  constructor() {
    super(GameScene.KEY);
  }

  create(): void {
    // One bus per run: a bus that outlives the run leaks listeners across the
    // restart boundary into the next one.
    this.bus = new EventBus();
    this.controls = new Controls(this.input);
    this.run = new Run(this.bus);

    this.enemies = new Pool(this, Enemy);
    this.spawnTelegraphs = new Pool(this, SpawnTelegraph);
    this.enemyShots = new Pool(this, EnemyProjectile);
    this.swings = new Pool(this, SwordSwing);
    this.boomerangs = new Pool(this, Boomerang);
    this.orbiters = new Pool(this, Orbiter);
    this.drops = new Pool(this, Engagement);
    this.damageNumbers = new Pool(this, DamageNumber);

    this.player = new Player(this, 0, 0, this.controls, this.bus);
    this.cameras.main.startFollow(this.player, false);

    this.weapons = new WeaponManager(
      this.player,
      this.controls,
      this.enemies,
      this.swings,
      this.boomerangs,
      this.orbiters,
    );
    // The sword alone. The boomerang used to be equipped on this next line and
    // is now a level-up pick gated to Slow build (issue #32), which is the whole
    // of the PDF's "single weak melee weapon" opening — the sword's own numbers
    // did not move, and losing half the opening's damage output *is* the nerf.
    this.weapons.addWeapon("adblock_sword", WEAPONS.adblock_sword);

    this.progression = new Progression(
      this.player,
      this.weapons,
      // `Run` is the clock the phase gates read. The same one the director
      // reads, so a gate and a spawn table can never disagree about the phase —
      // and the playtest harness's seek, being a plain `run.tick(startAt)`,
      // moves the gates with it for free.
      this.run,
      UPGRADE_POOL,
      this.bus,
    );

    // The sink is the whole of what the director knows about the world
    // (issue #29): it decides which archetype lands where, and this closure —
    // the only place that holds the pool, the player, and the damage sink at
    // once — turns that into an actual enemy.
    this.director = new SpawnDirector(
      {
        spawn: (data, x, y) =>
          this.enemies.obtain().spawn(data, x, y, this.player, this),
        // An event's telegraph (issue #34): show the marker, then spawn the
        // enemy the ordinary way when it lands. The scene owns both pools, so
        // it is the one place that can hold the marker and the spawn together.
        telegraph: (data, x, y, delay) =>
          this.spawnTelegraphs
            .obtain()
            .spawn(x, y, delay, () =>
              this.enemies.obtain().spawn(data, x, y, this.player, this),
            ),
        // Compared by reference, which is exactly right: `ENEMIES` records are
        // module singletons and `spawn` hands the same object to the enemy, so
        // identity *is* archetype identity — no id has to be carried around to
        // ask this question (issue #31).
        liveCount: (data) =>
          this.enemies.active().filter((e) => e.archetype === data).length,
      },
      this.player,
    );

    this.overlay = new Overlay(this.game);
    this.levelUpModal = new LevelUpModal(this.overlay);
    this.winScreen = new WinScreen(this.overlay);
    this.adBreak = new AdBreak(this.overlay);

    this.bus.on("leveledUp", (choices) => this.openLevelUp(choices));
    this.bus.on("playerDied", () => this.run.end("died"));
    this.bus.on("runEnded", (outcome) => this.endRun(outcome));

    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => {
      this.bus.destroy();
      this.levelUpModal.hide();
      this.winScreen.hide();
      // Also stops the countdown's interval, which nothing else would.
      this.adBreak.hide();
      this.overlay.destroy();
      this.scene.stop(HudScene.KEY);
    });

    // Queued, so the HUD's `create` runs a step after this one — see the note
    // there about why it seeds its own opening values.
    this.scene.launch(HudScene.KEY, { bus: this.bus, controls: this.controls });
    this.director.start();

    /* Issue #30. `import.meta.env.DEV` is a literal after Vite's substitution,
       so a production build drops this branch and, with it, the only import of
       the harness — the same trick `main.ts` uses for its console handle. The
       harness reaches the run through the four things named here and nothing
       else; the seek it performs is an ordinary `run.tick`. */
    if (import.meta.env.DEV) {
      this.dev = DevHarness.attach(this, {
        run: this.run,
        director: this.director,
        player: this.player,
        liveEnemies: () => this.enemies.active().length,
      });
    }
  }

  override update(_time: number, delta: number): void {
    // Clamped: one frame with a multi-second delta — a resumed tab, or the
    // level-up modal below — would teleport every enemy onto the player.
    const frame = Math.min(delta, 100) / 1000;
    // The harness scales the frame *after* the clamp, so its 4x is four times a
    // normal frame rather than four times a stall. It is also where a seek
    // lands — see `DevHarness.frame`. `null` in production: `dt` is `frame`.
    const dt = this.dev?.frame(frame) ?? frame;

    this.run.tick(dt);
    this.player.tick(dt);
    // After `run.tick`, so the director reads this frame's elapsed time.
    this.director.tick(dt, this.run.elapsed);
    // Also after `run.tick`: the level-up budget's floor and its phase turnover
    // read the same freshly-advanced clock (issue #35).
    this.progression.tick();
    // After the director, so a marker queued this frame counts down from its
    // full delay; when one lands it spawns an enemy the loop below then ticks,
    // exactly as an ordinary spawn is (issue #34).
    this.spawnTelegraphs.each((telegraph) => telegraph.tick(dt));
    this.enemies.each((enemy) => enemy.tick(dt));
    // After the enemies that fire them, so a shot spawned this frame does not
    // also travel this frame — it would otherwise leave the muzzle already a
    // step out, which is exactly the distance the telegraph promised.
    this.enemyShots.each((shot) => shot.tick(dt));
    this.weapons.tick(dt);
    this.swings.each((swing) => swing.tick(dt));
    this.boomerangs.each((boomerang) => boomerang.tick(dt));
    this.drops.each((drop) => drop.tick(dt));
    this.damageNumbers.each((number) => number.tick(dt));
  }

  /**
   * Every weapon hit lands here (issue #25): bank it on the run, and pop the
   * number above the enemy that took it.
   *
   * Guarded on `isOver` for the same reason `onEngagementCollected` is — a
   * boomerang still in flight when the clock expires must not move the final
   * tally the win screen is about to show. `Run.recordDamage` guards itself
   * too; the floater is what needs the guard here, since a number rising over
   * the frozen world behind the win screen would be a ghost.
   */
  onEnemyDamaged(enemy: Enemy, amount: number): void {
    if (this.run.isOver) return;
    this.run.recordDamage(amount);
    this.damageNumbers
      .obtain()
      .spawn(amount, enemy.x, enemy.y, enemy.archetype.radius);
  }

  /**
   * A standoff enemy's wind-up finished — put a projectile in the world
   * (issue #31).
   *
   * The third of the small sinks that live here for the same reason as the
   * other two: this is the only object that holds both the pool and the player,
   * and an enemy that could reach a pool itself would be a second place
   * spawning happens.
   */
  onEnemyFired(
    enemy: Enemy,
    behavior: Extract<EnemyBehavior, { kind: "ranged_standoff" }>,
    dir: Phaser.Math.Vector2,
  ): void {
    this.enemyShots
      .obtain()
      .spawn(behavior, enemy.x, enemy.y, dir, this.player);
  }

  /** `main.gd`'s `_on_enemy_died`: count the kill, drop the engagement. */
  onEnemyDied(enemy: Enemy): void {
    this.run.recordKill();
    this.drops
      .obtain()
      .spawn(
        enemy.archetype.engagementValue,
        enemy.x,
        enemy.y,
        this.player,
        this,
      );
    // Killing The Algorithm is the win (issue #37). Identity is archetype
    // identity here — the same reference check `liveCount` makes — so the boss
    // needs no id or flag carried around. The dropped engagement above is
    // deliberately still spawned: the tally is banked before the run latches
    // over, and it does no harm on the frame the world stops.
    if (enemy.archetype === ENEMIES.the_algorithm) this.run.defeatBoss();
  }

  onEngagementCollected(value: number): void {
    if (this.run.isOver) return;
    this.progression.addEngagement(value);
  }

  /**
   * Pause and hand over to the modal — issue #7's `scene.pause('GameScene')`,
   * triggered by `GameScene` subscribing to the bus rather than by anything
   * reaching in from outside.
   *
   * Resuming is the modal's click handler, which is a DOM event and therefore
   * still fires with this scene stopped. That is the half of issue #8's
   * decision that matters here: a canvas modal would need something still
   * running to be clickable at all.
   *
   * `inputEnabled` is `_joystick.reset()`: a thumb held down when the level-up
   * fires must not leave the player drifting on resume (slice 4).
   */
  private openLevelUp(choices: readonly Upgrade[]): void {
    if (choices.length === 0 || this.run.isOver) return;
    this.scene.pause();
    this.bus.emit("inputEnabled", false);
    this.levelUpModal.show(choices, (upgrade) => {
      this.progression.applyUpgrade(upgrade);
      this.levelUpModal.hide();
      this.bus.emit("inputEnabled", true);
      this.scene.resume();
    });
  }

  /**
   * Both endings, in `main.gd`'s order: stop the world, then put a screen over
   * it. Stopping the director matters beyond tidiness — the scene is paused, so
   * a wave queued for this frame would otherwise be waiting on the far side of
   * a restart that never happens.
   */
  private endRun(outcome: RunOutcome): void {
    this.director.stop();
    // A level-up and the last hit can land on the same frame.
    this.levelUpModal.hide();
    this.scene.pause();
    this.bus.emit("inputEnabled", false);

    const restart = (): void => this.restart();
    // Two losses, two sets of copy (issue #37): the ad break reads the outcome
    // to tell "you died" from "the boss outlasted you." The win screen is now
    // an actual victory — you killed the thing.
    if (outcome === "won") this.winScreen.show(this.run.stats, restart);
    else this.adBreak.show(outcome, this.run.stats, restart);
  }

  /**
   * `_restart`, without `reload_current_scene()`. Phaser has no direct
   * equivalent, but it does not need one: restarting this scene tears it down
   * through `SHUTDOWN` and runs `create` again, and every per-run object —
   * bus, controls, pools, systems, overlay — is built there. Nothing survives
   * the boundary, which is the property `reload_current_scene()` was bought for.
   *
   * `resume` first because a stopped-while-paused scene starts back up paused.
   */
  private restart(): void {
    this.scene.resume();
    this.scene.restart();
  }
}
