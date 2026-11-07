<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

declare(strict_types=1);

namespace App\Support;

use App\Http\Middleware\SetLocale;
use Illuminate\Support\Facades\DB;

/**
 * The language a member is saved with when nobody has asked them.
 *
 * `users.preferred_language` defaults to 'en' in the schema, so every account
 * created without naming a language used to be English whatever its community
 * spoke — imported members, members an administrator added, single-sign-on
 * members. The site, and every email, then reached them in English.
 */
final class CommunityLanguage
{
    /** The community's own language (tenants.configuration.default_language), else English. */
    public static function forTenant(int $tenantId): string
    {
        $raw = DB::table('tenants')->where('id', $tenantId)->value('configuration');
        $config = is_string($raw) ? json_decode($raw, true) : null;

        return self::supported(is_array($config) ? ($config['default_language'] ?? null) : null) ?? 'en';
    }

    /**
     * For a member signing themselves up: what they chose, else the language
     * their browser asks for, else their community's language.
     */
    public static function forNewMember(int $tenantId, ?string $explicit, ?string $acceptLanguage): string
    {
        $chosen = self::supported($explicit);
        if ($chosen !== null) {
            return $chosen;
        }

        foreach (explode(',', (string) $acceptLanguage) as $part) {
            $code = self::supported(explode(';', $part)[0]);
            if ($code !== null) {
                return $code;
            }
        }

        return self::forTenant($tenantId);
    }

    /** A supported two-letter code for $value ('fr-FR' -> 'fr'), or null. */
    public static function supported(mixed $value): ?string
    {
        if (!is_string($value)) {
            return null;
        }
        $code = strtolower(substr(trim($value), 0, 2));

        return in_array($code, SetLocale::SUPPORTED_LOCALES, true) ? $code : null;
    }
}
