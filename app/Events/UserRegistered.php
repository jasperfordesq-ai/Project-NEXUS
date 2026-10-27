<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

namespace App\Events;

use App\Models\User;
use Illuminate\Broadcasting\InteractsWithSockets;
use Illuminate\Foundation\Events\Dispatchable;

/**
 * Fired when a new user registers on the platform.
 *
 * IMPORTANT: this event intentionally does NOT use the SerializesModels trait.
 *
 * SerializesModels stores only the User's class+id in the queue payload and
 * re-fetches via User::findOrFail() at job-pickup time. Because the User model
 * uses HasTenantScope, that re-fetch is filtered by TenantContext::getId() —
 * and Horizon's long-lived worker processes can leak a stale TenantContext
 * between jobs. If the previous job left the context set to tenant 2 and the
 * current event is for a tenant-10 user, findOrFail() returns null → silent
 * ModelNotFoundException → the welcome / activation email is never sent.
 *
 * Default PHP serialization (used here) snapshots the full in-memory User
 * object at dispatch time. Listeners read its attributes from the payload
 * directly, with no DB round-trip, so no TenantScope filter can intervene.
 *
 * Slightly larger queue payload; eliminates an entire class of cross-tenant
 * delivery bugs. Do not re-add SerializesModels.
 */
class UserRegistered
{
    use Dispatchable, InteractsWithSockets;

    /**
     * @param string|null $returnTo Same-site page the member was on their way
     *                              to when they signed up (already checked with
     *                              AuthReturnPath::safe()); the verification
     *                              link carries it as ?next=.
     */
    public function __construct(
        public readonly User $user,
        public readonly int $tenantId,
        public readonly ?string $returnTo = null,
    ) {}
}
