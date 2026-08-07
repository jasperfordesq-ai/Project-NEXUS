<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

declare(strict_types=1);

namespace App\Support\Safeguarding;

/**
 * SupportTiers — graduated support levels for linked accounts.
 *
 * Phase 2 of the guardian-module redesign (owner-approved 2026-08-06;
 * proposal in .local-docs-archive/guardian-three-tier-redesign-2026-08-06.md).
 * The tiers mirror Ireland's Assisted Decision-Making (Capacity) Act 2015,
 * which replaced all-or-nothing wardship with graduated arrangements:
 *
 * | Tier        | ADMCA 2015 analogue              | What the supporter can do          |
 * |-------------|----------------------------------|------------------------------------|
 * | none        | —                                | nothing for this capability        |
 * | assist      | decision-making assistant        | see, help prepare; never submit    |
 * | co_decide   | co-decision-maker                | prepare; supported member confirms |
 * | represent   | decision-making representative   | act alone (attributed + audited)   |
 *
 * Capacity is DECISION-SPECIFIC under the Act, so tiers are granted per
 * capability, never per person: a member may be fine deciding about listings
 * and want support only with credits.
 *
 * ## Storage
 *
 * Tiers live inside the existing `account_relationships.permissions` JSON
 * column as a `tiers` object: `{"tiers": {"activity": "assist", ...}}`.
 * The legacy boolean keys (`can_view_activity`, `can_manage_listings`,
 * `can_transact`) remain alongside, kept in sync via {@see toLegacyBooleans()},
 * so every existing reader — including both frontends until the tier UI ships —
 * keeps working unchanged. {@see resolve()} reads the `tiers` object first and
 * falls back to deriving tiers from the legacy booleans, so pre-tier rows need
 * no data migration and a rollback loses nothing.
 *
 * ## Deliberate boundaries
 *
 * - `messages` (owner decision 2026-08-07, reversing the earlier omission) is
 *   grantable at `assist` ONLY — see-only, no co_decide/represent semantics —
 *   and is TIER-OBJECT-ONLY: it takes effect exclusively through
 *   SubAccountService::applyConsentedMessageAccess() after the supported
 *   member's explicit consent (a support_pending_actions confirm), never from
 *   a supporter's own write. Counterparties in the member's conversations see
 *   a generic notice, and every supporter read is immutably audited.
 * - 🔴 The legacy `can_view_messages` boolean stays permanently DEAD: no
 *   LEGACY_MAP entry, and {@see toLegacyBooleans()} hard-writes it false.
 *   Historical rows stored `can_view_messages: true` from the years the
 *   switch saved-and-did-nothing; a legacy mapping would retroactively grant
 *   real access nobody consented to. See DEFAULT_PERMISSIONS in
 *   SubAccountService for the history.
 * - `co_decide` confers no direct action until the confirm loop (phase 3)
 *   exists. {@see atLeast()} treats each tier exactly; callers that perform an
 *   immediate action must require `represent`, never `co_decide`.
 * - Staff (brokers) are capped at `co_decide` — owner decision 2026-08-06 —
 *   and may not hold `messages` at all: staff message oversight is the
 *   broker-copy mechanism, not this. {@see MAX_STAFF_TIER};
 *   GuardianArrangementService::setTiers drops `messages` keys.
 */
final class SupportTiers
{
    public const NONE = 'none';
    public const ASSIST = 'assist';
    public const CO_DECIDE = 'co_decide';
    public const REPRESENT = 'represent';

    /** Ordered least → most power. */
    public const TIERS = [self::NONE, self::ASSIST, self::CO_DECIDE, self::REPRESENT];

    /**
     * Capabilities a tier can be granted for. `messages` joined 2026-08-07
     * (owner decision) with hard boundaries: `assist` only, consent-gated,
     * never derived from the dead legacy boolean — see the class docblock.
     */
    public const CAPABILITIES = ['activity', 'listings', 'credits', 'messages'];

    /**
     * Per-capability tier ceilings. `messages` has no co_decide/represent
     * semantics — reading someone's conversations is see-only by definition,
     * and anything above `assist` here would imply powers that do not exist.
     * {@see sanitizeTiers()} DROPS (not clamps) values above the ceiling:
     * silently clamping would record a different grant than was requested.
     *
     * @var array<string, string>
     */
    public const MAX_TIER_BY_CAPABILITY = ['messages' => self::ASSIST];

    /**
     * The highest tier a staff member (broker/coordinator) may ever hold for a
     * supported member. Owner decision 2026-08-06: staff prepare, the member
     * confirms; staff never act alone.
     */
    public const MAX_STAFF_TIER = self::CO_DECIDE;

    /** @var array<string, int> */
    private const RANK = [
        self::NONE => 0,
        self::ASSIST => 1,
        self::CO_DECIDE => 2,
        self::REPRESENT => 3,
    ];

    /**
     * Legacy boolean permission → [capability, tier it granted when true].
     *
     * The mapping preserves today's observable behaviour exactly:
     * `can_view_activity` let the supporter SEE (assist); the other two let the
     * supporter ACT ALONE (represent). `can_view_messages` is absent on
     * purpose — it never granted anything and must not start to.
     *
     * @var array<string, array{0: string, 1: string}>
     */
    private const LEGACY_MAP = [
        'can_view_activity' => ['activity', self::ASSIST],
        'can_manage_listings' => ['listings', self::REPRESENT],
        'can_transact' => ['credits', self::REPRESENT],
    ];

    private function __construct()
    {
    }

    /**
     * What a legacy boolean permission key actually requires, as
     * [capability, minimum tier] — or null for keys that confer nothing at any
     * tier (`can_view_messages`, unknown keys). This is the single translation
     * point for callers that still speak in boolean key names.
     *
     * @return array{0: string, 1: string}|null
     */
    public static function legacyRequirement(string $legacyKey): ?array
    {
        return self::LEGACY_MAP[$legacyKey] ?? null;
    }

    /**
     * Every capability at `none` — the starting point for a new relationship
     * until the supported member agrees to something.
     *
     * @return array<string, string>
     */
    public static function noneGranted(): array
    {
        return array_fill_keys(self::CAPABILITIES, self::NONE);
    }

    public static function rank(string $tier): int
    {
        return self::RANK[$tier] ?? 0;
    }

    public static function isValidTier(string $tier): bool
    {
        return array_key_exists($tier, self::RANK);
    }

    /**
     * Resolve the effective tier per capability from a permissions payload of
     * either shape (JSON-decoded `account_relationships.permissions`).
     *
     * A `tiers` object wins when present and valid; otherwise tiers derive from
     * the legacy booleans. Unknown capabilities and unknown tier values are
     * ignored, falling back to the legacy derivation for that capability —
     * a corrupted value must degrade toward LESS power, never more.
     *
     * @param mixed $permissions
     * @return array<string, string> capability => tier, every capability present
     */
    public static function resolve(mixed $permissions): array
    {
        $resolved = self::noneGranted();
        if (! is_array($permissions)) {
            return $resolved;
        }

        // Legacy booleans first, as the floor…
        foreach (self::LEGACY_MAP as $legacyKey => [$capability, $tier]) {
            if (! empty($permissions[$legacyKey])) {
                $resolved[$capability] = $tier;
            }
        }

        // …then the explicit tiers object overrides per capability.
        $tiers = $permissions['tiers'] ?? null;
        if (is_array($tiers)) {
            foreach (self::CAPABILITIES as $capability) {
                $value = $tiers[$capability] ?? null;
                if (! is_string($value) || ! self::isValidTier($value)) {
                    continue;
                }
                // A STORED value above the capability's ceiling is corruption
                // (nothing legitimate writes one): degrade toward LESS power —
                // ignore it entirely rather than clamp, same rule as an
                // unknown tier string. Matters most for `messages`, where an
                // out-of-range value would otherwise read as real access.
                $ceiling = self::MAX_TIER_BY_CAPABILITY[$capability] ?? null;
                if ($ceiling !== null && self::rank($value) > self::rank($ceiling)) {
                    continue;
                }
                $resolved[$capability] = $value;
            }
        }

        return $resolved;
    }

    /**
     * Does the grant meet an EXACT-or-higher tier requirement for a capability?
     *
     * 🔴 Callers performing an immediate action must pass `represent` as
     * $required. `co_decide` only ever gates the prepare-and-confirm path.
     */
    public static function atLeast(array $resolvedTiers, string $capability, string $required): bool
    {
        if (! in_array($capability, self::CAPABILITIES, true) || ! self::isValidTier($required)) {
            return false;
        }

        $held = $resolvedTiers[$capability] ?? self::NONE;

        return self::rank(is_string($held) ? $held : self::NONE) >= self::rank($required);
    }

    /**
     * Validate an incoming tiers payload from a grant/update request. Unknown
     * capabilities and invalid tier values are dropped, not defaulted — the
     * caller merges the result over the existing grant, so an absent key means
     * "unchanged", never "reset".
     *
     * @param mixed $input
     * @return array<string, string>
     */
    public static function sanitizeTiers(mixed $input): array
    {
        if (! is_array($input)) {
            return [];
        }

        $clean = [];
        foreach (self::CAPABILITIES as $capability) {
            $value = $input[$capability] ?? null;
            if (! is_string($value) || ! self::isValidTier($value)) {
                continue;
            }
            // Above a capability's ceiling → DROPPED, not clamped: a clamp
            // would record a different grant than the caller requested.
            $ceiling = self::MAX_TIER_BY_CAPABILITY[$capability] ?? null;
            if ($ceiling !== null && self::rank($value) > self::rank($ceiling)) {
                continue;
            }
            $clean[$capability] = $value;
        }

        return $clean;
    }

    /**
     * True when ANY capability's tier rank increases from $before to $after.
     * Expansion must re-trigger the supported member's consent and the
     * safeguarding contact re-check; shrinking never does — revocation stays a
     * safe, unilateral exit.
     */
    public static function isExpansion(array $before, array $after): bool
    {
        foreach (self::CAPABILITIES as $capability) {
            $b = $before[$capability] ?? self::NONE;
            $a = $after[$capability] ?? self::NONE;
            if (self::rank(is_string($a) ? $a : self::NONE) > self::rank(is_string($b) ? $b : self::NONE)) {
                return true;
            }
        }

        return false;
    }

    /**
     * Project resolved tiers back onto the legacy boolean keys so every
     * pre-tier reader keeps working. The projection matches LEGACY_MAP exactly:
     * a boolean is true only when the held tier actually confers what that
     * boolean always meant (see the class docblock table). `co_decide` on
     * listings/credits therefore projects to FALSE — the legacy booleans mean
     * "may act alone", and a co-decider may not.
     *
     * `can_view_messages` is always false. Always — INCLUDING now that a real
     * `messages` capability exists. The boolean is the fossil of a switch that
     * saved-and-did-nothing for years; letting it go true would make every
     * pre-tier reader (and any historical-row comparison) believe the old
     * switch had been working all along. The `messages` tier lives ONLY in
     * the tiers object.
     *
     * @return array<string, bool>
     */
    public static function toLegacyBooleans(array $resolvedTiers): array
    {
        $booleans = [];
        foreach (self::LEGACY_MAP as $legacyKey => [$capability, $tier]) {
            $booleans[$legacyKey] = self::atLeast($resolvedTiers, $capability, $tier);
        }
        $booleans['can_view_messages'] = false;

        return $booleans;
    }

    /**
     * Cap a tiers map at the staff ceiling. Used when the grantee is a broker
     * or coordinator acting in a staff capacity: `represent` requests clamp to
     * `co_decide` rather than erroring, so a staff grant flow can share the
     * member flow's code path.
     *
     * @param array<string, string> $tiers
     * @return array<string, string>
     */
    public static function capForStaff(array $tiers): array
    {
        $ceiling = self::rank(self::MAX_STAFF_TIER);
        $capped = [];
        foreach ($tiers as $capability => $tier) {
            // Staff may not hold `messages` at any tier: staff oversight of
            // conversations is the broker-copy mechanism with its own audit
            // trail, not the supporter grant. Dropped entirely, not clamped.
            if ($capability === 'messages') {
                continue;
            }
            $capped[$capability] = is_string($tier) && self::rank($tier) > $ceiling
                ? self::MAX_STAFF_TIER
                : $tier;
        }

        return $capped;
    }
}
