<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

declare(strict_types=1);

namespace App\Events;

use App\Models\Listing;
use App\Models\User;
use Illuminate\Foundation\Events\Dispatchable;

/**
 * Fired when an existing listing (offer or request) is updated.
 *
 * Triggers federation push so partner communities hold current listing data.
 */
class ListingUpdated
{
    use Dispatchable;

    public function __construct(
        public readonly Listing $listing,
        public readonly User $user,
        public readonly int $tenantId,
        /**
         * F-414: the listing's federated_visibility BEFORE this update, so the
         * federation push listener can detect a share -> un-share transition
         * and RETRACT the listing from partners that already hold it. Null when
         * the prior value is unknown or irrelevant. Mirrors
         * VolunteerOpportunityUpdated::$previousFederatedVisibility.
         */
        public readonly ?string $previousFederatedVisibility = null,
    ) {}
}
