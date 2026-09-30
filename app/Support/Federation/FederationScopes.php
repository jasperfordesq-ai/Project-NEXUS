<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

namespace App\Support\Federation;

/**
 * The federation partner-key scope vocabulary — one source of truth.
 *
 * Two lists used to exist: the allow-list inside
 * `AdminFederationController::createApiKey()` (the only place a
 * `federation_api_keys` row is ever written) and, separately, the scopes the
 * routes actually enforce — `FederationController::fedAuth()` on the v1
 * partner API and `FederationApiAuth::requiredPermissionsForRequest()` on the
 * v2 protocol surfaces. They drifted, and six enforced scopes could not be
 * granted at all (E-073 finding F-451).
 *
 * Anything added to an enforcement site must be added here, and
 * `F451PartnerKeyScopeVocabularyIsOneSourceTest` fails if the two go out of
 * step in either direction.
 */
final class FederationScopes
{
    /**
     * Every scope a federation route enforces, and therefore every scope a
     * partner key may carry.
     *
     * @var array<int,string>
     */
    private const ISSUABLE = [
        'timebanks:read',
        'members:read',
        'members:write',
        'listings:read',
        'messages:read',
        'messages:write',
        'reviews:read',
        'reviews:write',
        'transactions:read',
        'transactions:write',
        'ingest:write',
        'admin',
    ];

    /**
     * Scopes only a PLATFORM super-admin may issue: a community admin must not
     * be able to self-mint a key that moves credits, writes on a member's
     * behalf, or reads private correspondence.
     *
     * @var array<int,string>
     */
    private const PRIVILEGED = [
        'members:write',
        'messages:read',
        'messages:write',
        'reviews:write',
        'transactions:write',
        'ingest:write',
        'admin',
    ];

    /**
     * @return array<int,string>
     */
    public static function issuable(): array
    {
        return self::ISSUABLE;
    }

    /**
     * @return array<int,string>
     */
    public static function privileged(): array
    {
        return self::PRIVILEGED;
    }
}
