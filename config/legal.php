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
 * 🔴 DEFAULT IS `off`. Turning this on can stop members using the platform, so
 * it is not something to enable as a side effect of deploying the code. The
 * intended sequence:
 *
 *   1. `off`    — code deployed, nothing enforced. (Today.)
 *   2. `report` — never blocks. Logs `legal.gate.would_block` with the calling
 *                 client and sets `X-Legal-Acceptance-Pending: 1` on the
 *                 response. Run this in production for at least a week and read
 *                 the logs: it tells you how many members would be blocked and
 *                 WHICH clients they are using. A client with no acceptance
 *                 screen turns a compliance improvement into an outage for
 *                 those members.
 *   3. `write`  — blocks the routes the gate is attached to (writes only).
 *   4. `all`    — reserved for a later decision; behaves as `write` today
 *                 because the gate is attached per-route, never to a group.
 *
 * Every client needs an acceptance screen before step 3. As of 2026-08-11 React
 * has one, web-uk has one, and the mobile app does not yet.
 */
return [
    /*
     * off | report | write | all
     *
     * Anything unrecognised is treated as `off` — a typo in an env var must not
     * silently start blocking members.
     */
    'enforcement_mode' => env('LEGAL_ENFORCEMENT_MODE', 'off'),

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
