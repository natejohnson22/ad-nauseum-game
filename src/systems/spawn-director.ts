import { ENEMIES, type EnemyId } from "../content/enemies";
import { phaseAt, progressIn } from "../content/phases";
import type {
  EnemyData,
  Phase,
  Ramp,
  SpawnEvent,
  SpawnTrack,
} from "../content/types";

/** One track's current rate, as the readout shows it (issue #30). */
export interface TrackReadout {
  readonly enemy: EnemyId;
  readonly displayName: string;
  /** Seconds between waves, at this instant on the ramp. */
  readonly interval: number;
  /** Enemies per wave, rounded as `spawnWave` rounds it. */
  readonly wave: number;
  /** Seconds until this track fires again. */
  readonly nextIn: number;
  /** How many of this archetype are alive right now. */
  readonly live: number;
  /** The track's concurrency cap, or `null` where it has none. */
  readonly max: number | null;
}

/** One event's cadence, as the readout shows it (issue #34). */
export interface EventReadout {
  readonly kind: SpawnEvent["kind"];
  /** Seconds between firings, at this instant on the ramp. */
  readonly interval: number;
  /** Seconds until this event fires again. */
  readonly nextIn: number;
}

/** What the director currently thinks it is doing — see `SpawnDirector.readout`. */
export interface DirectorReadout {
  readonly running: boolean;
  readonly phase: Phase;
  /** Where the run sits inside the phase, 0..1 — what every ramp lerps on. */
  readonly progress: number;
  readonly tracks: readonly TrackReadout[];
  /** The phase's hordes and rings, if any — empty in a steady-stream phase. */
  readonly events: readonly EventReadout[];
}

/**
 * Where a spawned enemy goes. The scene owns the pool, the player, and the
 * damage sink, and satisfies this with one closure at the composition root —
 * so the director never sees a `Pool<Enemy>` and this file imports no Phaser
 * (issue #29). Same trade `Progression` already makes with `SpeedTarget` and
 * `UpgradeTarget`: a narrow interface is both the test seam and the honest
 * statement of what the system may touch.
 */
export interface SpawnSink {
  spawn(data: EnemyData, x: number, y: number): void;
  /**
   * Put `data` at a world point after `delay` seconds, showing a telegraph
   * marker there until it lands — how an event's shaped burst arrives
   * (issue #34).
   *
   * Separate from `spawn` because an event forms *near the player* (a ring
   * closes in at 320px), where an enemy blinking into existence is unreadable,
   * while the ordinary stream arrives at the offscreen ring and needs no
   * warning. The division of labour is the same one `spawn` already draws: the
   * director decides the shape, the timing, and the delay; the sink owns how
   * the warning looks and the pool the enemy comes from.
   */
  telegraph(data: EnemyData, x: number, y: number, delay: number): void;
  /**
   * How many of this archetype are alive — what `SpawnTrack.max` is checked
   * against (issue #31), and the one thing the director needs to know about the
   * world it has already made.
   *
   * Counting is the sink's job because the pool is the sink's to hold; the
   * director tracking its own spawns would have to be told about every death,
   * and a director that can be wrong about what is on screen is worse than no
   * cap at all.
   */
  liveCount(data: EnemyData): number;
}

/** What the spawn ring is drawn around. `Player` satisfies it. */
export interface SpawnOrigin {
  readonly x: number;
  readonly y: number;
}

/**
 * Time-driven escalation — the port of `spawn_director.gd`, rebuilt in issue
 * #29 to read the phase table instead of its own constants.
 *
 * What it used to be: two cooldowns lerped against a `RUN_LENGTH = 300`, with
 * the ogre gated by a lone `OGRE_START_TIME` and wave size on a
 * `3 + floor(time / 45)` that had no ceiling. What it is now: a loop over the
 * current phase's tracks. Every number it uses lives in `phases.ts`, which is
 * the point — the seven tuning passes ahead of us edit a table, not this file.
 *
 * It also no longer keeps a clock. `tick` is handed the run's elapsed seconds,
 * so there is exactly one timeline in the game and starting a run part-way
 * through is `Run`'s problem alone.
 */
export class SpawnDirector {
  static readonly SPAWN_RADIUS = 640;

  /** Seconds the telegraph marker shows before an event's enemies land — the
      warning window #34 settled on by play. */
  static readonly EVENT_TELEGRAPH = 1;
  /**
   * Seconds added to every ordinary track's cooldown when an event fires, so
   * the stream thins as the wall or ring lands (issue #34, Nate's note on
   * play). One skipped beat per event, not a lull: the player meets the shape,
   * not the shape on top of a full faucet.
   */
  static readonly EVENT_PAUSE = 1.5;
  /** Row-to-row spacing of a horde wall, stepping outward from the spawn ring. */
  private static readonly WALL_ROW_GAP = 34;

  private running = false;
  /**
   * Seconds until each track's next wave, keyed by enemy rather than by track,
   * because a track is a per-phase object and this has to survive the turnover.
   * A key **absent** here is a track that has not fired yet and therefore fires
   * on sight — which is what makes an arriving archetype announce itself at the
   * top of its phase. Same rule the earlier tuning pass applied to the ogre,
   * seeding `_ogre_cd` to zero so the first one lands at 1:30 rather than
   * Godot's accidental 3:00.
   */
  private readonly cooldowns = new Map<EnemyId, number>();
  /**
   * Seconds until each event's next firing, keyed by the event object itself —
   * the `PHASES` events are module singletons, so identity survives the ticks
   * within a phase, and the same phase-turnover cleanup the tracks get above
   * forgets an event that has left the roster. Unlike a track, a key **absent**
   * here seeds to a *full interval*, not zero: an event waits before its first
   * fire, so a ring never lands the instant a phase opens.
   */
  private readonly eventCooldowns = new Map<SpawnEvent, number>();

  constructor(
    private readonly sink: SpawnSink,
    private readonly origin: SpawnOrigin,
    /** Injected so placement is deterministic under test — as `Progression`. */
    private readonly random: () => number = Math.random,
  ) {}

  start(): void {
    this.running = true;
  }

  stop(): void {
    this.running = false;
  }

  /** `elapsed` is seconds into the run — see `Run.elapsed`. */
  tick(delta: number, elapsed: number): void {
    if (!this.running) return;

    const phase = phaseAt(elapsed);
    const t = progressIn(phase, elapsed);

    // A track that has left the roster forgets its cooldown, so an enemy that
    // returns in a later phase announces itself again rather than resuming
    // mid-count from whenever it was last seen.
    for (const enemy of this.cooldowns.keys())
      if (!phase.tracks.some((track) => track.enemy === enemy))
        this.cooldowns.delete(enemy);

    for (const track of phase.tracks) {
      const remaining = (this.cooldowns.get(track.enemy) ?? 0) - delta;
      if (remaining > 0) {
        this.cooldowns.set(track.enemy, remaining);
        continue;
      }
      this.spawnWave(track, t);
      this.cooldowns.set(track.enemy, lerp(track.interval, t));
    }

    // Events after tracks, so `fireEvent` pushes back cooldowns the tracks loop
    // has already set this frame (issue #34). An event that has left the roster
    // forgets its cooldown, exactly as a track does.
    const events = phase.events ?? [];
    for (const event of this.eventCooldowns.keys())
      if (!events.includes(event)) this.eventCooldowns.delete(event);

    for (const event of events) {
      // Absent -> a full interval, so an unseen event waits rather than firing
      // on sight — the opposite of a track's seed-to-zero.
      const remaining =
        (this.eventCooldowns.get(event) ?? lerp(event.interval, t)) - delta;
      if (remaining > 0) {
        this.eventCooldowns.set(event, remaining);
        continue;
      }
      this.fireEvent(event);
      this.eventCooldowns.set(event, lerp(event.interval, t));
    }
  }

  /**
   * The current rates, for the playtest harness's readout (issue #30).
   *
   * A method here rather than arithmetic in the harness: the readout's whole
   * job is to be believed while a phase is being tuned, and a second copy of
   * the phase lookup and the lerp would eventually disagree with the one that
   * actually spawns things. This reads exactly what `tick` reads.
   *
   * `elapsed` is passed in for the same reason `tick` takes it — there is one
   * clock in the game and it is not this object's.
   */
  readout(elapsed: number): DirectorReadout {
    const phase = phaseAt(elapsed);
    const t = progressIn(phase, elapsed);
    return {
      running: this.running,
      phase,
      progress: t,
      tracks: phase.tracks.map((track) => ({
        enemy: track.enemy,
        displayName: ENEMIES[track.enemy].displayName,
        interval: lerp(track.interval, t),
        wave: Math.round(lerp(track.wave, t)),
        nextIn: Math.max(0, this.cooldowns.get(track.enemy) ?? 0),
        live: this.sink.liveCount(ENEMIES[track.enemy]),
        max: track.max ?? null,
      })),
      events: (phase.events ?? []).map((event) => ({
        kind: event.kind,
        interval: lerp(event.interval, t),
        // An unseen event reads as a full interval away — what it will wait.
        nextIn: Math.max(
          0,
          this.eventCooldowns.get(event) ?? lerp(event.interval, t),
        ),
      })),
    };
  }

  /**
   * One wave, trimmed to whatever room the track's `max` leaves (issue #31).
   *
   * A full track still resets its cooldown and simply spawns nothing, so it
   * re-checks every interval — which is what makes a mini-boss respawn *some
   * time after* the last one dies rather than the instant the slot frees. A
   * partial trim is deliberate too: a wave of 3 against 1 slot left lands one
   * enemy, because the cap is a statement about how many may be on screen, not
   * about wave sizes.
   */
  private spawnWave(track: SpawnTrack, t: number): void {
    const data = ENEMIES[track.enemy];
    let count = Math.round(lerp(track.wave, t));
    if (track.max !== undefined)
      count = Math.min(count, track.max - this.sink.liveCount(data));
    for (let i = 0; i < count; i++) this.spawn(data);
  }

  /** Somewhere on the ring around the origin, at a uniform random angle. */
  private spawn(data: EnemyData): void {
    const angle = this.random() * Math.PI * 2;
    this.sink.spawn(
      data,
      this.origin.x + Math.cos(angle) * SpawnDirector.SPAWN_RADIUS,
      this.origin.y + Math.sin(angle) * SpawnDirector.SPAWN_RADIUS,
    );
  }

  /**
   * One horde or ring (issue #34): thin the ordinary stream, then telegraph a
   * shaped mass of enemies into place.
   *
   * The thinning is a beat added to every track mid-cooldown, so the shape
   * lands into a lull rather than on top of a full wave — the difference
   * between "a horde arrived" and "everything got busier". The shape itself is
   * pure geometry the sink never sees: a wall packed into rows from one random
   * bearing, or a circle around the player with one arc left open to run for.
   */
  private fireEvent(event: SpawnEvent): void {
    for (const [enemy, cd] of this.cooldowns)
      this.cooldowns.set(enemy, cd + SpawnDirector.EVENT_PAUSE);

    const data = ENEMIES[event.enemy];
    const delay = SpawnDirector.EVENT_TELEGRAPH;

    if (event.kind === "horde") {
      const bearing = this.random() * Math.PI * 2;
      const spread = degToRad(event.arcDegrees);
      for (let row = 0; row < event.rows; row++) {
        const dist =
          SpawnDirector.SPAWN_RADIUS + row * SpawnDirector.WALL_ROW_GAP;
        for (let col = 0; col < event.perRow; col++) {
          // Spread the row evenly across the arc, centred on the bearing; a
          // one-wide row would divide by zero, so it lands dead ahead.
          const offset = event.perRow === 1 ? 0 : col / (event.perRow - 1) - 0.5;
          this.telegraphAt(data, bearing + spread * offset, dist, delay);
        }
      }
      return;
    }

    const gapAt = this.random() * Math.PI * 2;
    const half = degToRad(event.gapDegrees) / 2;
    for (let i = 0; i < event.count; i++) {
      const angle = (i / event.count) * Math.PI * 2;
      // Leave the gap open — the fair way out that keeps the ring a threat
      // rather than a death sentence.
      if (Math.abs(wrapAngle(angle - gapAt)) <= half) continue;
      this.telegraphAt(data, angle, event.radius, delay);
    }
  }

  /** Telegraph one enemy at `dist` and `angle` from the origin (the player). */
  private telegraphAt(
    data: EnemyData,
    angle: number,
    dist: number,
    delay: number,
  ): void {
    this.sink.telegraph(
      data,
      this.origin.x + Math.cos(angle) * dist,
      this.origin.y + Math.sin(angle) * dist,
      delay,
    );
  }
}

/** `Phaser.Math.Linear`, inlined to keep this file Phaser-free. */
function lerp([from, to]: Ramp, t: number): number {
  return from + (to - from) * t;
}

/** Degrees to radians — `Phaser.Math.DegToRad`, inlined for the same reason. */
function degToRad(degrees: number): number {
  return (degrees * Math.PI) / 180;
}

/** Wrap to (-pi, pi], so the ring's gap test works across the 0/2pi seam. */
function wrapAngle(angle: number): number {
  return Math.atan2(Math.sin(angle), Math.cos(angle));
}
