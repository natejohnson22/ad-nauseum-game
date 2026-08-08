import { describe, expect, it } from "vitest";
import { ENEMIES } from "../content/enemies";
import { PHASES } from "../content/phases";
import type { EnemyData } from "../content/types";
import { SpawnDirector, type SpawnSink } from "./spawn-director";

/**
 * The director became testable the same way `Progression` did (issue #29): its
 * collaborators narrowed from `Pool<Enemy>` and `Player` to two plain
 * interfaces, so a test hands it objects rather than dragging a canvas in.
 *
 * What is worth asserting is the *timing* — which enemy, on which tick — and
 * above all the phase boundary, where a track carrying its cooldown and a track
 * seeding to zero sit one line apart and look alike.
 */
class FakeSink implements SpawnSink {
  readonly spawned: { name: string; x: number; y: number }[] = [];
  /**
   * What `liveCount` reports, keyed by display name — kept honest rather than
   * stubbed: a spawn raises it, and `kill` is the only thing that lowers it.
   * A fake that spawned without becoming live would let a `max: 1` track
   * produce a mini-boss every interval and still pass.
   */
  private readonly live = new Map<string, number>();

  /**
   * Telegraphed spawns — an event's shaped burst (issue #34). Kept apart from
   * `spawned` because a telegraph is a *committed but not yet landed* spawn, and
   * the director's `max`/`liveCount` bookkeeping deliberately never touches it:
   * an event has no cap. What is worth asserting is the shape and the timing,
   * which is what these fields carry.
   */
  readonly telegraphed: { name: string; x: number; y: number; delay: number }[] =
    [];

  spawn(data: EnemyData, x: number, y: number): void {
    this.spawned.push({ name: data.displayName, x, y });
    this.live.set(data.displayName, this.liveCountOf(data.displayName) + 1);
  }

  telegraph(data: EnemyData, x: number, y: number, delay: number): void {
    this.telegraphed.push({ name: data.displayName, x, y, delay });
  }

  liveCount(data: EnemyData): number {
    return this.liveCountOf(data.displayName);
  }

  /** Put `count` of `name` on the board without the director having spawned them. */
  seed(name: string, count: number): void {
    this.live.set(name, count);
  }

  kill(name: string, count = 1): void {
    this.live.set(name, Math.max(0, this.liveCountOf(name) - count));
  }

  private liveCountOf(name: string): number {
    return this.live.get(name) ?? 0;
  }

  /** How many of `name` have landed so far. */
  count(name: string): number {
    return this.spawned.filter((s) => s.name === name).length;
  }

  /** Forget the log **and** the board — a fresh arena, not just a fresh tally. */
  clear(): void {
    this.spawned.length = 0;
    this.telegraphed.length = 0;
    this.live.clear();
  }
}

const GRUNT = "Popup Grunt";
const OGRE = "Autoplay Video Ogre";
const BANNER = "Cookie Banner";

/** A director at the origin, spawning north — placement is not what is tested. */
function director(sink: SpawnSink): SpawnDirector {
  return new SpawnDirector(sink, { x: 0, y: 0 }, () => 0);
}

/** Tick `seconds` of run in 1/60s steps, starting from `from`. */
function play(d: SpawnDirector, from: number, seconds: number): void {
  const step = 1 / 60;
  for (let t = from; t < from + seconds; t += step) d.tick(step, t);
}

describe("SpawnDirector", () => {
  it("spawns nothing until started", () => {
    const sink = new FakeSink();
    const d = director(sink);

    play(d, 0, 10);
    expect(sink.spawned).toHaveLength(0);
  });

  it("opens the run with a wave, rather than waiting one interval", () => {
    const sink = new FakeSink();
    const d = director(sink);
    d.start();

    d.tick(1 / 60, 0);
    expect(sink.count(GRUNT)).toBe(3);
  });

  it("stops on demand — a queued wave must not survive the ending", () => {
    const sink = new FakeSink();
    const d = director(sink);
    d.start();
    play(d, 0, 10);
    d.stop();
    sink.clear();

    play(d, 10, 60);
    expect(sink.spawned).toHaveLength(0);
  });

  it("spawns only the enemies in the current phase's roster", () => {
    const sink = new FakeSink();
    const d = director(sink);
    d.start();

    // Quick Start has one track. The ogre does not arrive until Panic.
    play(d, 0, 120);
    expect(sink.count(GRUNT)).toBeGreaterThan(0);
    expect(sink.count(OGRE)).toBe(0);
  });

  it("tightens the interval across a phase, as its ramp says", () => {
    const early = new FakeSink();
    const late = new FakeSink();
    const a = director(early);
    const b = director(late);
    a.start();
    b.start();

    // Same 60 seconds of run, at opposite ends of God-Tier: 0.95s between
    // waves at the open, 0.70s at the close.
    play(a, 1500, 60);
    play(b, 1740, 60);
    expect(late.count(GRUNT)).toBeGreaterThan(early.count(GRUNT));
  });

  it("grows the wave across a phase, as its ramp says", () => {
    // Struggle runs 5 -> 6 grunts per wave. Two directors rather than one:
    // a single one would still be counting down its first interval.
    const open = new FakeSink();
    const close = new FakeSink();
    const a = director(open);
    const b = director(close);
    a.start();
    b.start();

    a.tick(1 / 60, 600);
    b.tick(1 / 60, 899);
    expect(open.count(GRUNT)).toBe(5);
    expect(close.count(GRUNT)).toBe(6);
  });

  it("announces a newly-arriving track the moment its phase opens", () => {
    const sink = new FakeSink();
    const d = director(sink);
    d.start();

    // Ticked through Struggle, where there is no ogre track, then one tick
    // into Panic, where there is.
    play(d, 890, 10);
    expect(sink.count(OGRE)).toBe(0);

    d.tick(1 / 60, 900);
    expect(sink.count(OGRE)).toBe(1);
  });

  it("carries a continuing track's cooldown over the boundary", () => {
    const sink = new FakeSink();
    const d = director(sink);
    d.start();

    // The grunt track spans Panic and Pro Struggle. Land on the boundary with
    // a cooldown mid-flight: the turnover must not re-fire it.
    play(d, 1199, 1);
    const before = sink.count(GRUNT);

    d.tick(1 / 60, 1200);
    expect(sink.count(GRUNT)).toBe(before);
  });

  it("keeps spawning past the end of the table", () => {
    const sink = new FakeSink();
    const d = director(sink);
    d.start();

    play(d, 1800, 5);
    expect(sink.count(GRUNT)).toBeGreaterThan(0);
  });

  it("reports the rates it is actually spawning at", () => {
    // The playtest readout (issue #30) is only worth having if it agrees with
    // the spawner, so this asserts against the table rather than a snapshot.
    const sink = new FakeSink();
    const d = director(sink);
    d.start();

    // The open of Struggle: every track present, all at their `from` values.
    d.tick(1 / 60, 600);
    const view = d.readout(600);
    expect(view.running).toBe(true);
    expect(view.phase.id).toBe("struggle");
    expect(view.progress).toBeCloseTo(0);
    expect(view.tracks.map((t) => t.enemy)).toEqual([
      "popup_grunt",
      "tracking_pixel",
      "cookie_banner",
    ]);

    const grunt = view.tracks[0]!;
    expect(grunt.displayName).toBe(GRUNT);
    expect(grunt.wave).toBe(sink.count(GRUNT));
    expect(grunt.interval).toBeCloseTo(1.7);
    // Fired on that tick, so the cooldown it reports is a full interval.
    expect(grunt.nextIn).toBeCloseTo(1.7);
  });

  it("reports the ramp's far end at the close of a phase", () => {
    const d = director(new FakeSink());
    d.start();

    const grunt = d.readout(899.99).tracks[0]!;
    expect(grunt.interval).toBeCloseTo(1.45, 1);
    expect(grunt.wave).toBe(6);
  });

  /**
   * The cap is what a mini-boss *is* (issue #31), so these are the tests that
   * say so — there is no mini-boss object to assert about.
   */
  describe("a track's concurrency cap", () => {
    it("holds a full track at its ceiling", () => {
      const sink = new FakeSink();
      const d = director(sink);
      d.start();

      // Panic's ogre track is `max: 1`. One already alive means none arrive,
      // however long the director runs.
      sink.seed(OGRE, 1);
      play(d, 900, 120);
      expect(sink.count(OGRE)).toBe(0);
    });

    it("refills the slot once the standing one dies", () => {
      const sink = new FakeSink();
      const d = director(sink);
      d.start();

      sink.seed(OGRE, 1);
      play(d, 900, 60);
      expect(sink.count(OGRE)).toBe(0);

      // Killed. The next interval finds room — not the next frame, which is
      // what stops a mini-boss from being an instant treadmill.
      sink.kill(OGRE);
      play(d, 960, 30);
      expect(sink.count(OGRE)).toBe(1);
    });

    it("trims a wave to the room left rather than skipping it", () => {
      const sink = new FakeSink();
      const d = director(sink);
      d.start();

      // God-Tier opens the banner track at 2 per wave, capped at 4. With 3
      // alive there is room for exactly one.
      sink.seed(BANNER, 3);
      d.tick(1 / 60, 1500);
      expect(sink.count(BANNER)).toBe(1);
    });

    it("leaves an uncapped track alone however many are alive", () => {
      const sink = new FakeSink();
      const d = director(sink);
      d.start();

      sink.seed(GRUNT, 500);
      d.tick(1 / 60, 0);
      expect(sink.count(GRUNT)).toBe(3);
    });

    it("reports the cap and the live count in the readout", () => {
      const sink = new FakeSink();
      const d = director(sink);
      d.start();

      sink.seed(OGRE, 1);
      const tracks = d.readout(900).tracks;
      const ogre = tracks.find((t) => t.enemy === "autoplay_ogre")!;
      expect(ogre.max).toBe(1);
      expect(ogre.live).toBe(1);
      // The swarm has no ceiling, and the readout says so rather than guessing.
      expect(tracks.find((t) => t.enemy === "popup_grunt")!.max).toBeNull();
    });
  });

  it("places spawns on the ring around its origin", () => {
    const sink = new FakeSink();
    // `random` pinned to 0.25 -> a quarter turn: straight up from the origin.
    const d = new SpawnDirector(sink, { x: 100, y: -50 }, () => 0.25);
    d.start();

    d.tick(1 / 60, 0);
    const first = sink.spawned[0]!;
    expect(Math.hypot(first.x - 100, first.y - -50)).toBeCloseTo(
      SpawnDirector.SPAWN_RADIUS,
    );
  });

  /**
   * Hordes and trapping rings (issue #34): punctuation layered on the ordinary
   * stream. The scheduling is the director's; the geometry is asserted here
   * rather than left to play, because a ring with no gap and a ring with a gap
   * differ only in the angles and one is a death sentence.
   */
  describe("phase events", () => {
    it("holds an event back a full interval, rather than firing it on arrival", () => {
      const sink = new FakeSink();
      const d = director(sink);
      d.start();

      // One tick into Struggle, where the events live. The stream has fired on
      // sight; an event has not — it is the punctuation, not the sentence.
      d.tick(1 / 60, 600);
      expect(sink.spawned.length).toBeGreaterThan(0);
      expect(sink.telegraphed).toHaveLength(0);
    });

    it("fires no events in a phase the table gives none", () => {
      const sink = new FakeSink();
      const d = director(sink);
      d.start();

      // Quick Start is a steady stream — no hordes, no rings.
      play(d, 0, 120);
      expect(sink.telegraphed).toHaveLength(0);
    });

    it("telegraphs an event's enemies rather than dropping them blind", () => {
      const sink = new FakeSink();
      const d = director(sink);
      d.start();

      play(d, 600, 90);
      expect(sink.telegraphed.length).toBeGreaterThan(0);
      // Every one carries a warning — the whole point of an event near the
      // player, where a blink into existence is unreadable.
      expect(sink.telegraphed.every((t) => t.delay > 0)).toBe(true);
    });

    it("lays a ring at its radius with a gap to run through", () => {
      const sink = new FakeSink();
      // Origin at 0,0 and a pinned random, so the ring's radius and gap are
      // exact rather than sampled.
      const d = new SpawnDirector(sink, { x: 0, y: 0 }, () => 0.5);
      d.start();

      play(d, 600, 90);
      const ring = sink.telegraphed.filter(
        (t) => Math.abs(Math.hypot(t.x, t.y) - 320) < 1,
      );
      expect(ring.length).toBeGreaterThan(0);

      // The gap: the widest angular jump between neighbours is far more than the
      // even spacing would leave — a solid ring would have no such jump.
      const angles = [...new Set(ring.map((t) => Math.atan2(t.y, t.x)))].sort(
        (a, b) => a - b,
      );
      const step = angles
        .slice(1)
        .map((a, i) => a - angles[i]!)
        .concat(angles[0]! + Math.PI * 2 - angles[angles.length - 1]!);
      expect(Math.max(...step)).toBeGreaterThan((2 * Math.PI) / 30 * 3);
    });

    it("packs a horde into a wall past the spawn ring", () => {
      const sink = new FakeSink();
      const d = new SpawnDirector(sink, { x: 0, y: 0 }, () => 0);
      d.start();

      play(d, 600, 90);
      // The ring closes in at 320; the wall stands at the offscreen spawn ring
      // and beyond, so distance alone tells them apart.
      const wall = sink.telegraphed.filter(
        (t) => Math.hypot(t.x, t.y) >= SpawnDirector.SPAWN_RADIUS - 1,
      );
      expect(wall.length).toBeGreaterThan(0);
      // Depth: a wall is rows deep, not a single arc.
      const rows = new Set(wall.map((t) => Math.round(Math.hypot(t.x, t.y))));
      expect(rows.size).toBeGreaterThanOrEqual(2);
    });

    it("thins the ordinary stream as an event lands", () => {
      const sink = new FakeSink();
      const d = director(sink);
      d.start();

      const step = 1 / 60;
      let thinned = false;
      for (let t = 600; t < 690; t += step) {
        const before = sink.telegraphed.length;
        d.tick(step, t);
        if (sink.telegraphed.length > before) {
          // An event fired this tick. The grunt track's next wave was pushed
          // back a beat, so the shape lands into a lull.
          const grunt = d
            .readout(t)
            .tracks.find((x) => x.enemy === "popup_grunt")!;
          expect(grunt.nextIn).toBeGreaterThan(SpawnDirector.EVENT_PAUSE);
          thinned = true;
          break;
        }
      }
      expect(thinned).toBe(true);
    });
  });

  it("spawns exactly each phase's roster, no more and no less", () => {
    const sink = new FakeSink();
    const d = director(sink);
    d.start();

    for (const phase of PHASES) {
      sink.clear();
      // 30s clears the longest interval in the table (11s) several times over.
      play(d, phase.start, 30);
      const seen = new Set(sink.spawned.map((s) => s.name));
      const roster = new Set(
        phase.tracks.map((t) => ENEMIES[t.enemy].displayName),
      );
      expect(seen).toEqual(roster);
    }
  });
});
