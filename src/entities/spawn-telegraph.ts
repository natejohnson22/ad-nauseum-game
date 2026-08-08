import type Phaser from "phaser";
import { PooledSprite } from "../core/pool";
import { circleTexture } from "../core/textures";

/**
 * The warning dot an event spawns behind — a horde or a trapping ring
 * telegraphing where its enemies will land (issue #34).
 *
 * The director decides the shape and hands the scene one `telegraph(data, x, y,
 * delay)` per enemy; the scene turns each into one of these. It pulses at the
 * spawn point for `delay` seconds and then, in the same breath, releases itself
 * and runs the callback that drops the actual enemy — so the marker and the
 * spawn are one object's lifetime, and nothing outside has to remember to fire
 * the enemy when the countdown ends.
 *
 * Pooled like everything else, so `spawn` resets every field. Drawn in
 * danger-orange at depth 2.6 — above the swarm, matching the grammar the AoE
 * telegraph already set: a warning buried under grunts is not a warning.
 */
export class SpawnTelegraph extends PooledSprite {
  /** `Enemy.TELEGRAPH_COLOR` — the game's one danger colour. */
  private static readonly COLOR = 0xff591a;
  /** Baked once at this radius; `spawn` scales it up as the spawn nears. */
  private static readonly RADIUS = 8;

  private life = 0;
  private remaining = 0;
  /** Drops the enemy when the countdown ends; nulled the instant it is used. */
  private onLand: (() => void) | null = null;

  constructor(scene: Phaser.Scene) {
    super(scene, 0, 0, circleTexture(scene, SpawnTelegraph.RADIUS));
    this.setTint(SpawnTelegraph.COLOR).setDepth(2.6);
  }

  spawn(x: number, y: number, delay: number, onLand: () => void): void {
    this.setPosition(x, y);
    this.life = delay;
    this.remaining = delay;
    this.onLand = onLand;
    this.setScale(0.5).setAlpha(0.4);
  }

  tick(delta: number): void {
    this.remaining -= delta;
    if (this.remaining <= 0) {
      const land = this.onLand;
      // Released and cleared before the enemy lands, so a marker recycled into
      // the very enemy it spawned cannot fire twice — the pooling hazard.
      this.onLand = null;
      this.release();
      land?.();
      return;
    }
    // Swell and brighten as the spawn approaches, so a wall of dots reads as
    // imminent rather than ambient.
    const t = 1 - this.remaining / this.life;
    this.setScale(0.5 + 0.8 * t).setAlpha(0.35 + 0.45 * t);
  }
}
