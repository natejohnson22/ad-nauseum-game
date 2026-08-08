/**
 * Content types — the hand-written half of what `.tres` used to be.
 *
 * Issue #3: content is TS object literals checked with `satisfies`, ids are
 * record keys rather than fields, and the variant fields (`kind`, `behavior`)
 * are discriminated unions so every dispatch switch is exhaustive.
 *
 * Slice 5 added the second arm of both content unions — `ranged` weapons and
 * `telegraph_aoe` behaviour — and the bet paid: the compiler named every switch
 * that needed a case (`Enemy#tick`, `WeaponManager#fire`, `#modArc`,
 * `#modProjectiles`) rather than leaving them to be found by playing. Both
 * unions are now complete for Prototype 1.
 *
 * Issue #31 collects on the same bet a third time, at three times the size:
 * `EnemyBehavior` goes from two arms to four, and the six archetypes the PDF
 * asks for are built from them.
 */

import type { EnemyId } from "./enemies";
// Type-only, and deliberately circular: `phases.ts` imports `Phase` and friends
// from here, and `UpgradeData.unlockedFrom` names a phase back. Nothing is
// emitted for either edge, and the alternative — a third module holding
// `PhaseId` alone — separates the id from the table that defines it (issue #32).
import type { PhaseId } from "./phases";
import type { WeaponId } from "./weapons";

/** Strips `readonly` for the per-run copies upgrades mutate (WeaponManager). */
export type Mutable<T> = { -readonly [K in keyof T]: T[K] };

// ------------------------------------------------------------------ enemies

/**
 * Godot: `enemy_data.gd`'s `behavior` enum plus the fields each branch reads.
 *
 * The four `aoe_*` numbers live on the `telegraph_aoe` arm rather than on
 * `EnemyData`, which is what deletes them from the grunt: in the `.tres` files
 * the Popup Grunt carries a full set of ogre defaults it never reads.
 */
/**
 * What a `ranged_standoff` shot does on top of its damage (issue #31).
 *
 * This is where "advanced" lives for the ranged half of the roster. The
 * behaviour arm is shared by all three shooters — the Pixel, the Paywall, and
 * the boss — so if the difference between basic and advanced were expressed on
 * the arm it would be nothing but bigger numbers, which is the stat reskin the
 * roster ticket ruled out. Putting it on the projectile means the Paywall
 * differs from the Pixel in *what its shot does to you*, not in how it stands.
 */
export type EnemyShot =
  | { readonly kind: "bolt" }
  | {
      readonly kind: "lockout";
      /**
       * Seconds the player's weapons go quiet for. "Subscribe to continue."
       *
       * The only thing in the game that attacks the player's *output* rather
       * than their health — which is the point of it landing in Pro Struggle,
       * where a built-out player has damage upgrades that make HP damage
       * unfrightening. Kept short and its source kept rare on purpose: a
       * silence is the most resented effect in games when it is frequent, and
       * the shot that carries it is slow, telegraphed, and dodgeable.
       */
      readonly seconds: number;
    };

export type EnemyBehavior =
  | { readonly kind: "chase" }
  /**
   * Chases like a grunt and drags a slow field behind it — the Cookie Banner
   * (issue #31), and the roster's answer to "advanced melee".
   *
   * The player's only defence is movement, so an advanced enemy has to make
   * movement cost something; a bigger, angrier chaser is still solved by
   * walking away. This denies space without denying passage, which is the
   * difference between tension and a death sentence in an arena where nothing
   * is solid.
   *
   * An arm rather than an optional `aura` field on `EnemyData`, because an
   * optional field that one archetype in six reads is `target_weapon_id: &""`
   * returning — see the note above. The cost is that a *ranged* aura would want
   * a fifth arm rather than composing; that is a trade to revisit if auras ever
   * spread past this one enemy.
   */
  | {
      readonly kind: "chase_aura";
      /** How far the slow reaches from the enemy's centre. */
      readonly radius: number;
      /** What the player's speed is multiplied by inside it. */
      readonly speedMult: number;
    }
  | {
      readonly kind: "telegraph_aoe";
      /** Seconds between blasts, counted only while chasing. */
      readonly interval: number;
      /** Seconds the ring pulses before the blast lands — the player's cue. */
      readonly telegraph: number;
      readonly radius: number;
      readonly damage: number;
    }
  /**
   * Holds at range and fires aimed shots — the roster's whole ranged half
   * (issue #31): Tracking Pixel, Paywall, and The Algorithm on one arm.
   *
   * The inverse of every melee threat in the game. Melee says *don't stand
   * still*; a standoff shooter aims where you are at the instant it fires, so
   * it says *don't move predictably*, and it is what punishes the comfortable
   * kiting circle the Confidence phase lets the player settle into.
   *
   * Shots are **aimed, not homing** — dodged by moving, so movement stays the
   * answer to everything.
   */
  | {
      readonly kind: "ranged_standoff";
      /** Closes to this distance, then plants. */
      readonly range: number;
      /** Backs away inside this, so it never degenerates into a slow chaser. */
      readonly minRange: number;
      /** Seconds between shots, counted only while not winding up. */
      readonly interval: number;
      /** Seconds the muzzle flares before the shot leaves — the player's cue. */
      readonly telegraph: number;
      readonly damage: number;
      readonly projectileSpeed: number;
      /** How far a shot flies before it fizzles. */
      readonly travelDistance: number;
      readonly shot: EnemyShot;
    };

export interface EnemyData {
  readonly displayName: string;
  readonly maxHp: number;
  readonly speed: number;
  /** Body size — drives both the placeholder circle and the contact reach. */
  readonly radius: number;
  /** XP dropped on death, as an Engagement pickup. */
  readonly engagementValue: number;
  readonly contactDamage: number;
  /** Seconds between contact damage ticks. */
  readonly contactInterval: number;
  readonly behavior: EnemyBehavior;
  /** 0xRRGGBB, fed straight to `setTint`. */
  readonly color: number;
}

// ------------------------------------------------------------------ weapons

interface WeaponBase {
  readonly displayName: string;
  readonly baseDamage: number;
  /** Seconds between auto-fires. */
  readonly cooldown: number;
  readonly knockback: number;
  readonly color: number;
}

export interface MeleeWeaponData extends WeaponBase {
  readonly kind: "melee";
  /** Radius of the cleave. */
  readonly reach: number;
  /** Width of the cleave arc, in degrees. */
  readonly arcDegrees: number;
}

export interface RangedWeaponData extends WeaponBase {
  readonly kind: "ranged";
  readonly projectileSpeed: number;
  /** How far a shot flies before it turns around (or expires — see `returns`). */
  readonly travelDistance: number;
  /** Shots per fire, fanned 16deg apart. Raised by the multi-track upgrade. */
  readonly projectileCount: number;
  /**
   * The `ranged` kind's two flavours on one entity (issue #44).
   *
   * `true` is the Do Not Track Boomerang: fly out to `travelDistance`, turn
   * around, home back to the player, damaging on both passes. `false` is the
   * pierce-ranged weapon the upgrade pool (#36) adds — the same projectile fired
   * in a **straight committed line** that expires at `travelDistance` rather than
   * returning. Both already tag every enemy along their path (the entity has no
   * pierce limit), so the difference is the *shape of the flight*, not a
   * per-shot hit cap — which is what keeps this one boolean and not new firing
   * code. Distinct from the boomerang's return arc, per the ticket.
   */
  readonly returns: boolean;
}

/**
 * A weapon that circles the player rather than firing at a target — the genre's
 * garlic / holy-book (issue #36), the pool's one brand-new `kind` (#44).
 *
 * It breaks the cooldown-and-aim model every other weapon shares: there is
 * nothing to aim and nothing to time, so `WeaponManager` special-cases it out of
 * the fire loop and instead keeps `orbiterCount` orbs revolving around the
 * player, each dealing contact damage on its own re-hit cooldown. `cooldown`
 * from `WeaponBase` is therefore carried but unread; `knockback` still lands on
 * every hit.
 */
export interface OrbitalWeaponData extends WeaponBase {
  readonly kind: "orbital";
  /** How far the orbs ride from the player's centre. */
  readonly orbitRadius: number;
  /** Revolutions expressed as radians/sec of the shared phase. */
  readonly angularSpeed: number;
  /** Orbs in the ring, spread evenly. Raised by the `+1 orbiter` upgrade. */
  readonly orbiterCount: number;
  /** Body size of one orb — its placeholder circle and its contact reach. */
  readonly orbiterRadius: number;
  /** Seconds before a given enemy may be hit again by the same orb. */
  readonly hitInterval: number;
}

export type WeaponData = MeleeWeaponData | RangedWeaponData | OrbitalWeaponData;

// ----------------------------------------------------------------- upgrades

/**
 * What a level-up pick changes — `upgrade_data.gd`'s `effect` enum, as a
 * discriminated union.
 *
 * This is where issue #3's `target_weapon_id: &""` dies: the two `player_*`
 * arms simply have no weapon field, so the empty StringName that used to stand
 * for "not applicable" is unrepresentable. The one `amount: float` that meant
 * three different things splits into `amount`, `degrees`, and `count` — and
 * `count` being a `number` used as an integer is what deletes `int(u.amount)`.
 *
 * **All six arms are declared, including the two no upgrade reaches yet** —
 * `weapon_cooldown_mult`, which `main.gd`'s pool never used either, and
 * `weapon_projectile_add`, which waits on slice 5's boomerang. That is a
 * deliberate departure from how `EnemyBehavior` and `WeaponData` are handled
 * above: those track *content that does not exist*, so leaving the variant out
 * makes the compiler point at the switches slice 5 must revisit. Effects are
 * not content — the full set is fixed by `upgrade_data.gd` today, and writing
 * every arm now means slice 5 adds a record, not a dispatch branch.
 */
export type UpgradeEffect =
  | { readonly kind: "weapon_damage_add"; readonly weapon: WeaponId; readonly amount: number }
  | { readonly kind: "weapon_cooldown_mult"; readonly weapon: WeaponId; readonly amount: number }
  | { readonly kind: "weapon_arc_add"; readonly weapon: WeaponId; readonly degrees: number }
  | { readonly kind: "weapon_projectile_add"; readonly weapon: WeaponId; readonly count: number }
  /**
   * The two new weapons' signature lines (issue #44). `weapon_reach_add` widens a
   * melee weapon's cleave radius — the spin-melee's growth axis, since its arc is
   * already 360° and cannot open further. `weapon_orbiter_add` puts another orb in
   * the orbital's ring. Both are weapon-gated exactly like the older weapon lines,
   * inferred from `weapon` (issue #32).
   */
  | { readonly kind: "weapon_reach_add"; readonly weapon: WeaponId; readonly amount: number }
  | { readonly kind: "weapon_orbiter_add"; readonly weapon: WeaponId; readonly count: number }
  | { readonly kind: "player_speed_mult"; readonly amount: number }
  | { readonly kind: "player_cooldown_mult"; readonly amount: number }
  /**
   * The run's first survivability axis (issue #43): the three arms below are the
   * only upgrades that touch how long the player lives rather than how hard they
   * hit. Each lands on a seam the player already had — `MAX_HP`, the never-called
   * `heal()`, and the single `takeDamage` choke — so none of them is new machinery.
   */
  | { readonly kind: "player_max_hp_add"; readonly amount: number }
  | { readonly kind: "player_regen_add"; readonly amount: number }
  /**
   * Multiplies incoming damage — so it **compounds** and can never reach immunity
   * (0.88 per stack, `maxStacks` capped: 0.88⁴ ≈ 0.6, a 40% floor). An additive
   * −12%/stack would hit zero at stack 9 and go negative past it; the multiplier
   * is the shape that makes the cap a comfort rather than a hard safety rail.
   */
  | { readonly kind: "player_damage_reduction_mult"; readonly amount: number }
  /**
   * Hands the player a weapon they do not have — how the boomerang arrives at
   * 3:00 (issue #32), and how every weapon after it will.
   *
   * The id and nothing else. `WeaponManager` resolves it against `WEAPONS`,
   * which is what keeps `Progression` importing content *types* and never
   * content *values*: a class that has no business knowing a boomerang's
   * projectile speed should not be handed one to pass along.
   */
  | { readonly kind: "grant_weapon"; readonly weapon: WeaponId };

export interface UpgradeData {
  readonly title: string;
  readonly description: string;
  readonly effect: UpgradeEffect;
  /** How many times this may be taken in one run — keeps the pool fresh. */
  readonly maxStacks: number;
  /**
   * The phase this may first be offered in; absent means from 0:00 (issue #32).
   *
   * One of the two gates on a pick. This one is **declared**, because "not
   * before Confidence" is a pacing decision that lives nowhere else. The other
   * — that a weapon's upgrades wait for the weapon — is **inferred** from
   * `effect.weapon` rather than written down, because the effect already says
   * which weapon it touches and a `requires` field would be that same fact
   * restated in a form that can drift.
   */
  readonly unlockedFrom?: PhaseId;
  /**
   * Occupies a slot in **every** roll from the moment its gate opens until it is
   * taken, ahead of the shuffle (issue #32).
   *
   * The boomerang's arrival cannot be a dice roll — every phase from Confidence
   * on is tuned assuming the player has a ranged weapon — but a timed grant
   * would take the run's biggest early moment out of the level-up modal, which
   * the map protects as the heart of the prototype. Guaranteeing the *offer*
   * and not the *pick* costs the player one of three slots and keeps the choice
   * theirs: declining is a decision, where never being offered is a dice roll.
   *
   * Deliberately a plain flag rather than a weapon special case — if two are
   * ever eligible at once they take two slots, with no rule to add.
   */
  readonly guaranteed?: boolean;
}

// ------------------------------------------------------------------- phases

/**
 * A value that moves across a phase's window, lerped on phase-local progress
 * (issue #29). Two numbers rather than a `{ from, to }` because the table is
 * read as a grid — seven rows of these, scanned down a column while tuning —
 * and the field names repeated 40 times are noise at that density.
 */
export type Ramp = readonly [from: number, to: number];

/** The PDF's `3–4`: a level-up budget with the brief's slack kept. */
export type Budget = readonly [min: number, max: number];

/**
 * One enemy's arrival rate inside one phase.
 *
 * Tracks are **restated in full by every phase** — nothing is inherited from
 * the phase above, even though the PDF writes its rosters cumulatively
 * ("+ Basic ranged"). The point is that a phase's real pressure is legible in
 * its own row: seven tuning passes are coming, and each must be able to move
 * its phase without reading the six before it.
 */
export interface SpawnTrack {
  readonly enemy: EnemyId;
  /** Seconds between waves. */
  readonly interval: Ramp;
  /** Enemies per wave; lerped, then rounded at spawn time. */
  readonly wave: Ramp;
  /**
   * At most this many of this archetype alive at once. Absent is uncapped,
   * which is what every ordinary swarm track wants.
   *
   * This is the whole of what a **mini-boss** is in this game (issue #31):
   * a track with `max: 1`. There is no mini-boss concept in the code, no
   * separate scheduler, and no clock-time appointment — the Ogre respawns some
   * interval after the last one dies, so its arrival is unpredictable in
   * timing. If a mini-boss ever needs to be an *announced* moment, that is the
   * event scheduler the hordes-and-rings ticket (#34) has to invent anyway,
   * and this field should not grow into half of it.
   *
   * It usefully caps the merely-heavy too: an uncapped Cookie Banner track
   * carpets the arena in slow fields, since nothing but the player's damage
   * removes one.
   */
  readonly max?: number;
}

/**
 * A telegraphed burst layered on a phase's ordinary `tracks` — the Struggle
 * phase's "hordes" and "rings that trap you" (issue #34).
 *
 * A track is a faucet: a steady rate the player learns to swim in. An event is
 * punctuation — it fires on its own interval, telegraphs for a beat, and drops
 * a *shaped* mass of enemies at once, then the director thins the faucet as it
 * lands so the player meets the shape rather than the shape plus the stream.
 *
 * Both arms name an `enemy` and Struggle points both at the Popup Grunt, so an
 * event is "more of the texture already here, arranged to threaten" rather than
 * a new archetype to balance. **Settled by play in #34**: a wall from one
 * bearing read as a horde where a sustained stream read as noise, and a ring
 * with a gap was a fair "get out now" where a solid ring was a death sentence —
 * so `horde` is a wall and every `ring` keeps a gap.
 *
 * This is the event scheduler the mini-boss note in `SpawnTrack` foresaw: an
 * *announced*, shaped arrival, which `max: 1` deliberately was not.
 */
export type SpawnEvent =
  | {
      readonly kind: "horde";
      readonly enemy: EnemyId;
      /** Seconds between firings; lerped on phase progress, like a track. */
      readonly interval: Ramp;
      /** How many concentric rows deep the wall packs — its depth. */
      readonly rows: number;
      /** How many enemies across each row — its width. */
      readonly perRow: number;
      /** The arc the wall spans from a single random bearing, in degrees. */
      readonly arcDegrees: number;
    }
  | {
      readonly kind: "ring";
      readonly enemy: EnemyId;
      readonly interval: Ramp;
      /** Enemies evenly spaced around the circle, minus those the gap omits. */
      readonly count: number;
      /** How far from the player the ring forms — its trap radius. */
      readonly radius: number;
      /**
       * The escape gap, in degrees. Never zero: a closed ring is the death
       * sentence #34 rejected, since the player's only defence is movement, so
       * the gap is the thing that makes the trap fair rather than fatal.
       */
      readonly gapDegrees: number;
    };

/**
 * One row of the pacing table — the spine every time-driven system reads
 * (issue #29).
 *
 * `levelUps` is declared but nothing reads it yet: the budget ticket is blocked
 * on this table precisely because a per-phase budget needs a phase to hang off,
 * and this field is that attachment point. It decides the mechanism.
 */
export interface Phase {
  readonly id: string;
  /** For readouts and the playtest harness's phase picker. */
  readonly displayName: string;
  /** Seconds elapsed when this phase opens. */
  readonly start: number;
  /** Seconds elapsed when it closes — the next phase's `start`. */
  readonly end: number;
  readonly levelUps: Budget;
  readonly tracks: readonly SpawnTrack[];
  /**
   * Hordes and trapping rings on top of `tracks` (issue #34). Absent in the
   * phases the PDF describes as a steady stream; present in Struggle, whose
   * whole brief is "hordes, rings that trap you".
   */
  readonly events?: readonly SpawnEvent[];
}
