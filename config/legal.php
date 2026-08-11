<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

/**
 * Server-side legal-acceptance enforcement.
 *
 * Until this existed there was NO server-side enforcement anywhere: only the
 * React app gated, client-side, so any other client — the accessible frontend,
 * the mobile app, or a bare API caller with a valid token — could ignore a
 * pending acceptance entirely. Retiring the Blade accessible frontend in favour
 * of web-uk makes that hole permanent unless the gate lives in the API.
 *
 * 🔴 DEFAULT IS `write` — ENFORCED — on the owner's decision of 2026-08-11.
 *
 * The reasoning, so nobody "helpfully" softens it back: requiring members to
 * agree to the licensing terms before using the platform is a LEGAL obligation,
 * not a product preference. A default of `off` meant every new installation
 * silently failed that obligation until somebody remembered to set an environment
 * variable, and a missing setting is not a decision anybody made. Defaulting to
 * enforced makes the safe state the one you get by doing nothing.
 *
 * 🔴 Consequence to keep in mind: an installation that sets nothing will START
 * ENFORCING as soon as this code is deployed. That is intended. If a particular
 * installation wants to measure the impact first, it opts DOWN explicitly with
 * `LEGAL_ENFORCEMENT_MODE=report` — the burden of choosing the weaker setting sits
 * with whoever wants it, which is the right way round.
 *
 * 🔴 Enforcement is only as real as the documents behind it. A tenant with no row
 * in `legal_documents` — or whose documents have `requires_acceptance = 0`, or
 * `acceptance_required_for = 'none'` — has nothing pending, so NOBODY is blocked
 * whatever this is set to. As of 2026-08-11 nothing seeds a default document, so a
 * fresh installation enforces against an empty set. Setting this to `write` is
 * necessary for the legal position and not by itself sufficient; the documents have
 * to exist.
 *
 * The modes:
 *
 *   1. `off`    — nothing enforced. An installation must now opt into this
 *                 deliberately.
 *   2. `report` — never blocks. Logs `legal.gate.would_block` **at warning level**
 *                 with the calling client, and sets
 *                 `X-Legal-Acceptance-Pending: 1` on the response. Run this in
 *                 production for at least a week and read the logs: it tells you
 *                 how many members would be blocked and WHICH clients they are
 *                 using. A client with no acceptance screen turns a compliance
 *                 improvement into an outage for those members.
 *
 *                 🔴 The level matters. `config/logging.php` defaults every
 *                 channel to `env('LOG_LEVEL', 'warning')`, so an `info` line is
 *                 discarded on any environment that has not deliberately lowered
 *                 the threshold — production included. This mode was originally
 *                 written with `Log::info` and produced NO evidence at all while
 *                 still setting the response header, so it looked like it worked.
 *                 A test now pins the level.
 *   3. `write`  — THE DEFAULT. Refuses the routes the gate is attached to, which
 *                 are writes only: creating and changing things. Reading is
 *                 unaffected, and so is everything a member needs in order to
 *                 read the documents, accept them, or sign out.
 *   4. `all`    — reserved for a later decision; behaves as `write` today
 *                 because the gate is attached per-route, never to a group.
 *
 * Every client needs an acceptance screen for `write` to be humane rather than a
 * dead end. All three have one as of 2026-08-11: React, web-uk
 * (`/legal-acceptance`) and the mobile app (`app/(modals)/legal-acceptance.tsx`).
 * 🔴 Do not add a fourth client without one.
 */
return [
    /*
     * off | report | write | all
     *
     * 🔴 An unrecognised value falls back to the DEFAULT (`write`), not to `off`,
     * and logs a warning naming the bad value. This reversed on 2026-08-11 with the
     * default: while `off` was the default, the danger was a typo silently starting
     * to block members; now that enforcement is the legal baseline, the danger is a
     * typo silently STOPPING it. Failing toward the obligation is the safer error,
     * and the warning means the misconfiguration is not silent either way.
     */
    'enforcement_mode' => env('LEGAL_ENFORCEMENT_MODE', 'write'),

    /*
     * How long a per-user verdict is cached, in seconds.
     *
     * Short on purpose. The verdict key includes the tenant's revision token, so
     * publishing a new version invalidates every user at once with no fan-out;
     * this TTL only bounds how long a verdict survives something the revision
     * token cannot see.
     */
    'verdict_ttl' => (int) env('LEGAL_VERDICT_TTL', 300),

    /*
     * How long the tenant revision token lives, in seconds.
     *
     * 🔴 Must stay LONGER than `verdict_ttl`. The token expiring resets the
     * counter, and a reset could otherwise resurrect verdict keys written under
     * the same number earlier. With the token outliving every verdict derived
     * from it, those verdicts are always already gone.
     */
    'revision_ttl' => (int) env('LEGAL_REVISION_TTL', 3600),

    /*
     * Which `legal_documents.acceptance_required_for` values this gate enforces.
     *
     * The column has been written and validated since the feature was built and
     * read by nothing. `none` means the community explicitly does not want the
     * document gated, so it is never enforced. `registration` and `login` are
     * enforced because a member who never accepted at those points is exactly
     * who this gate is for. `first_use` is included for the same reason.
     */
    'enforced_acceptance_modes' => ['registration', 'login', 'first_use'],
];
