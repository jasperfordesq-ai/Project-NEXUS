<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

declare(strict_types=1);

namespace Tests\Laravel\Feature\Security\PlatformTeamLocks;

/**
 * The platform's fallback translation key. One key for the whole
 * installation: the page moved to the Platform team panel in phase 2.
 * Saving and deleting are refusal-only here: their success path replaces or
 * removes the stored key.
 */
final class SuperTranslationKeyControllerPlatformTeamLockTest extends PlatformTeamLockTestCase
{
    public static function locked(): array
    {
        return [
            'key status' => ['GET', '/v2/admin/super/translation/google-key'],
            'save the key' => ['PUT', '/v2/admin/super/translation/google-key', 'refusal-only'],
            'delete the key' => ['DELETE', '/v2/admin/super/translation/google-key', 'refusal-only'],
        ];
    }
}
