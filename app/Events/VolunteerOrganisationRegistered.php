<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

declare(strict_types=1);

namespace App\Events;

use Illuminate\Foundation\Events\Dispatchable;

/**
 * Fired when a member registers a volunteering organisation.
 *
 * Registration leaves the organisation at `status = 'pending'` and invisible to
 * the community until an admin approves it. Until 2026-08-28 nothing was fired
 * here at all, so no admin was ever told a queue existed: two organisations sat
 * unapproved for seven weeks and one day respectively, and the members who
 * registered them heard nothing either.
 *
 * Carries the id rather than the model because the row is written through the
 * query builder (there is no Eloquent model for `vol_organizations`), and
 * because the listener must RE-READ the current status anyway — see
 * NotifyAdminOfNewVolunteerOrganisation, which skips an organisation that is no
 * longer pending so the admin-create path (which approves immediately) cannot
 * email admins about their own action.
 */
class VolunteerOrganisationRegistered
{
    use Dispatchable;

    public function __construct(
        public readonly int $organisationId,
        public readonly int $tenantId,
        public readonly int $registeredByUserId,
    ) {}
}
