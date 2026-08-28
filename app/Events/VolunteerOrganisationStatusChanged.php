<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

declare(strict_types=1);

namespace App\Events;

use Illuminate\Foundation\Events\Dispatchable;

/**
 * Fired when an admin changes a volunteering organisation's status.
 *
 * Covers the whole lifecycle an admin can drive: approve, decline, suspend and
 * reinstate. Only the decision transitions notify the registrant — see
 * NotifyOwnerOfVolunteerOrganisationDecision — but the event carries every
 * transition so an audit or digest listener can be added without touching the
 * controller again.
 *
 * `$previousStatus` is read BEFORE the update so a listener can tell an approval
 * of a brand-new organisation ('pending' to 'active') apart from reinstating a
 * suspended one ('suspended' to 'active'), which are very different messages to
 * receive.
 */
class VolunteerOrganisationStatusChanged
{
    use Dispatchable;

    public function __construct(
        public readonly int $organisationId,
        public readonly int $tenantId,
        public readonly string $previousStatus,
        public readonly string $newStatus,
        public readonly ?int $actorUserId = null,
        public readonly ?string $reason = null,
    ) {}
}
