import { ENEMIES } from "./enemies";
import type { Phase } from "./types";

/**
 * The pacing table — the run's spine, and the one place its shape is tuned
 * (issue #29).
 *
 * `Ad Nauseum.pdf` describes the run as seven named phases, each with a roster,
 * a spawn pressure, and a level-up budget. Before this, none of that existed:
 * `SpawnDirector` was two cooldowns lerped against a 300-second run with the
 * ogre gated by a lone `OGRE_START_TIME`, and `Progression` had no notion of
 * time at all. Every downstream ticket is a play-and-adjust pass on one phase,
 * so the phases have to be a thing you can edit one row of.
 *
 * **The numbers here are provisional.** They are today's five-minute curve
 * stretched 6× and sliced at the phase boundaries — grunt interval 2.2→0.7 and
 * wave 3→9 spread over 1800s instead of 300s, ogre interval 11→5. Pressure per
 * minute is therefore identical to the tuned five-minute run, which makes this
 * a baseline to react to rather than a design, and sidesteps the wave-size
 * blow-up the old `3 + floor(t/45)` would have reached by 30:00 (~43 per wave).
 * What the middle of a 30-minute run should actually feel like is still open.
 *
 * **Issue #31 filled in the roster column.** The table was a grunt track with an
 * ogre bolted on; it is now the PDF's arrival schedule, each archetype joining
 * at its phase and persisting from there — the grunt never leaves, because it
 * is the run's texture and an arena with no chip damage feels empty. Two
 * consequences worth seeing in the numbers below:
 *
 * - The Ogre was promoted to mini-boss, so it now arrives at **15:00** rather
 *   than 10:00, and Struggle is carried by the Cookie Banner instead. That is
 *   the phase the PDF describes as hordes and traps, which is the Banner's job.
 * - Every heavy track carries a `max`. The Ogre's old interval ramp (11→9.5s,
 *   uncapped) would put ~35 of them on the board across a phase; capped at one,
 *   the interval means "how long after the last one dies", so it lengthened by
 *   roughly a factor of two. The two numbers are not comparable and the new one
 *   has never been played.
 *
 * The arrival *schedule* is the PDF's and is settled. Every rate below it is
 * provisional in exactly the sense the stretched grunt curve is.
 */
export const PHASES = [
  {
    id: "quick_start",
    displayName: "Quick Start",
    start: 0,
    end: 180,
    levelUps: [3, 3],
    tracks: [{ enemy: "popup_grunt", interval: [2.2, 2.05], wave: [3, 4] }],
  },
  {
    id: "slow_build",
    displayName: "Slow Build",
    start: 180,
    end: 300,
    levelUps: [3, 3],
    tracks: [{ enemy: "popup_grunt", interval: [2.05, 1.95], wave: [4, 4] }],
  },
  {
    id: "confidence",
    displayName: "Confidence",
    start: 300,
    end: 600,
    levelUps: [3, 4],
    tracks: [
      { enemy: "popup_grunt", interval: [1.95, 1.7], wave: [4, 5] },
      /* Basic ranged arrives. Capped low: the Pixel's whole job here is to
         interrupt a comfortable kiting circle, and six of them is not an
         interruption, it is a different phase. */
      { enemy: "tracking_pixel", interval: [8, 6], wave: [1, 2], max: 5 },
    ],
  },
  {
    id: "struggle",
    displayName: "Struggle",
    start: 600,
    end: 900,
    levelUps: [2, 3],
    tracks: [
      { enemy: "popup_grunt", interval: [1.7, 1.45], wave: [5, 6] },
      { enemy: "tracking_pixel", interval: [6, 5], wave: [2, 2], max: 8 },
      /* Advanced melee. Two converging fields read as fair; three merge into a
         wall you can't leave before the swarm lands (played, #39), so the cap
         holds convergence to two here and climbs only gently after. */
      { enemy: "cookie_banner", interval: [14, 11], wave: [1, 1], max: 2 },
    ],
    /* The phase the PDF names "hordes, rings that trap you" — the two events
       #34 built and Nate settled by play. A wall of grunts from one bearing,
       and a ring closing in with a gap to run for. Made of Popup Grunts, so
       they cost nothing new to balance. Rates are provisional in exactly the
       sense the ramps above are — the Struggle tuning pass owns them. */
    events: [
      { kind: "horde", enemy: "popup_grunt", interval: [18, 14], rows: 4, perRow: 7, arcDegrees: 48 },
      { kind: "ring", enemy: "popup_grunt", interval: [22, 16], count: 30, radius: 320, gapDegrees: 70 },
    ],
  },
  {
    id: "panic",
    displayName: "Panic",
    start: 900,
    end: 1200,
    levelUps: [2, 3],
    tracks: [
      { enemy: "popup_grunt", interval: [1.45, 1.2], wave: [6, 7] },
      { enemy: "tracking_pixel", interval: [5, 4.5], wave: [2, 3], max: 10 },
      { enemy: "cookie_banner", interval: [11, 9], wave: [1, 1], max: 3 },
      /* The mini-boss, and the phase's shock. `max: 1` is the whole of what
         makes it one — see the field's note in `types.ts`. */
      { enemy: "autoplay_ogre", interval: [22, 18], wave: [1, 1], max: 1 },
    ],
  },
  {
    id: "pro_struggle",
    displayName: "Pro Struggle",
    start: 1200,
    end: 1500,
    levelUps: [3, 4],
    tracks: [
      { enemy: "popup_grunt", interval: [1.2, 0.95], wave: [7, 8] },
      { enemy: "tracking_pixel", interval: [4.5, 4], wave: [3, 3], max: 12 },
      { enemy: "cookie_banner", interval: [9, 8], wave: [1, 2], max: 3 },
      { enemy: "autoplay_ogre", interval: [18, 15], wave: [1, 1], max: 1 },
      /* Advanced ranged, and the run's only threat that attacks the player's
         output rather than their health. Deliberately the rarest thing on the
         board — the lockout is only fair while it is an event. */
      { enemy: "paywall", interval: [24, 20], wave: [1, 1], max: 2 },
    ],
  },
  {
    id: "god_tier",
    displayName: "God-Tier Survival",
    start: 1500,
    end: 1800,
    /** No further upgrades — the PDF's last stand. */
    levelUps: [0, 0],
    tracks: [
      { enemy: "popup_grunt", interval: [0.95, 0.7], wave: [8, 9] },
      { enemy: "tracking_pixel", interval: [4, 3.5], wave: [3, 4], max: 14 },
      { enemy: "cookie_banner", interval: [8, 7], wave: [2, 2], max: 4 },
      { enemy: "autoplay_ogre", interval: [15, 12], wave: [1, 1], max: 1 },
      { enemy: "paywall", interval: [20, 16], wave: [1, 1], max: 3 },
      /* The final boss. A track like any other, `max: 1`, and a long interval
         so that killing it does not immediately hand you another — but a boss
         that respawns *at all* is wrong, and #37 owns the ending: killing this
         thing before 30:00 is the win condition, which the run does not yet
         know about. Until then it is a very large enemy in the last phase. */
      { enemy: "the_algorithm", interval: [90, 90], wave: [1, 1], max: 1 },
    ],
  },
] as const satisfies readonly Phase[];

export type PhaseId = (typeof PHASES)[number]["id"];

/**
 * How long a run lasts, **derived** rather than declared: the last phase's
 * close. `Run.LENGTH` reads this, so the clock and the table cannot disagree
 * about when the run ends, and stretching the run is one file.
 */
export const RUN_LENGTH: number = PHASES[PHASES.length - 1]!.end;

/**
 * The phase containing `elapsed` seconds.
 *
 * Clamped at both ends: negative time reads as the opening phase, and anything
 * at or past `RUN_LENGTH` as the closing one. The run is over by then, but the
 * director may still be ticked on the frame the clock expires, and "off the end
 * of the table" is not a case worth making every caller handle.
 */
export function phaseAt(elapsed: number): Phase {
  for (const phase of PHASES) if (elapsed < phase.end) return phase;
  return PHASES[PHASES.length - 1]!;
}

/**
 * When `id` opens — what a phase-gated upgrade compares the clock against
 * (issue #32).
 *
 * The reason `unlockedFrom` is a `PhaseId` and not a number of seconds: seven
 * tuning passes are coming and any of them may move a boundary. A gate that
 * names its phase moves with the table; a gate that names 180 quietly stops
 * meaning "when Slow build opens" the first time Slow build doesn't open at
 * 3:00.
 */
export function startOf(id: PhaseId): number {
  return PHASES.find((phase) => phase.id === id)!.start;
}

/** The mean of a ramp — a track's average rate across its phase window. */
const meanOf = (ramp: readonly [number, number]): number => (ramp[0] + ramp[1]) / 2;

/**
 * How much Engagement a phase is expected to drop — the divisor the level-up
 * budget carves into `max` picks (issue #35).
 *
 * **Coarse on purpose.** Only the *uncapped* tracks are counted, each as
 * `(duration / mean interval) waves × mean wave size × engagementValue`. A
 * `max`-capped track is skipped: how many of it spawn over a phase depends on
 * how fast the player kills it — a circularity, and a small slice of the pool
 * besides, since the grunt swarm dwarfs the heavies by count. Events are skipped
 * for the same reason. The budget's floor guarantees `min` regardless, and the
 * threshold is `pool / max`, so an inexact pool only shifts how readily the
 * *earned extra* lands — never whether the phase stays in budget. That is what
 * lets this be a stretched-curve baseline the tuning passes react to rather than
 * a number that must be right.
 */
export function expectedPool(phase: Phase): number {
  const duration = phase.end - phase.start;
  let pool = 0;
  for (const track of phase.tracks) {
    if (track.max !== undefined) continue;
    const waves = duration / meanOf(track.interval);
    pool += waves * meanOf(track.wave) * ENEMIES[track.enemy].engagementValue;
  }
  return pool;
}

/** Where `elapsed` sits inside `phase`, as 0..1 — what every ramp lerps on. */
export function progressIn(phase: Phase, elapsed: number): number {
  const t = (elapsed - phase.start) / (phase.end - phase.start);
  return Math.min(1, Math.max(0, t));
}
