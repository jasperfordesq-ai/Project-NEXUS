<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

namespace App\I18n;

use App\Core\TenantContext;
use App\Services\TenantSettingsService;
use Carbon\Carbon;
use Illuminate\Support\Facades\DB;

/**
 * FormattingLocale — the language/region tag used to render dates and numbers.
 *
 * A language code on its own carries no region, and Carbon (like Intl) then
 * falls back to the language's default one. For English that is the United
 * States, so `Carbon::now()->locale('en')->isoFormat('LL')` renders
 * "August 17, 2026" — month first — in every email this platform sends, despite
 * its communities being in Ireland and the UK.
 *
 * The language still comes from the recipient: notification services wrap their
 * render in {@see LocaleContext::withLocale()}, so `App::getLocale()` is already
 * the recipient's `preferred_language` by the time this is called. This class
 * supplies only the missing half — the region — resolved as:
 *
 *   1. the tenant's `general.region` setting (an admin's explicit choice)
 *   2. the tenant's `country_code` column
 *   3. the platform default, `config('app.region')`
 *
 * A language tag that already carries a region ("pt-BR") is returned unchanged.
 *
 * Never derive the region from the server, the request, or the caller's own
 * locale: a cron worker in UTC sends mail to members in Ireland.
 */
final class FormattingLocale
{
    /** Fallback when no tenant and no configuration resolve a region. */
    public const DEFAULT_REGION = 'IE';

    /** Memoised per request: Carbon's locale list is a directory scan. */
    private static ?array $availableCarbonLocales = null;

    /** Memoised day-before-month probe results, keyed by Carbon locale. */
    private static array $dayFirstByLocale = [];

    /**
     * The BCP-47 tag for user-facing formatting, e.g. `en-IE`.
     *
     * @param string|null $language Defaults to the active application locale,
     *                              which inside a LocaleContext wrap is the
     *                              recipient's own language.
     * @param int|null    $tenantId Defaults to the active tenant.
     */
    public static function resolve(?string $language = null, ?int $tenantId = null): string
    {
        $language = trim((string) ($language ?? app()->getLocale()));
        if ($language === '') {
            $language = 'en';
        }

        // An explicit regional choice wins over the community default.
        if (str_contains($language, '-') || str_contains($language, '_')) {
            return str_replace('_', '-', $language);
        }

        return $language . '-' . self::region($tenantId);
    }

    /**
     * The same locale in Carbon's underscore form, e.g. `en_IE`.
     *
     * Falls back through `en_IE` → `en_GB` → `en` style degradation when Carbon
     * ships no data for the exact pair, so an unusual language/region
     * combination renders in the right language rather than throwing.
     */
    public static function carbon(?string $language = null, ?int $tenantId = null): string
    {
        $tag = str_replace('-', '_', self::resolve($language, $tenantId));
        $available = self::availableCarbonLocales();
        $parts = explode('_', $tag);
        $base = $parts[0];
        $region = $parts[1] ?? '';

        $resolved = in_array($tag, $available, true)
            ? $tag
            : self::firstAvailable(
                // Prefer another region of the same language before dropping the
                // region entirely — bare `en` is American, which is the bug this
                // class exists to prevent.
                [$base . '_GB', $base . '_IE', $base],
                $available,
            );

        // Carbon ships several English regional locales whose date patterns
        // inherit the American order — `en_DE` renders "August 17, 2026", as
        // does bare `en`. Measured, not assumed. So an English-speaking
        // community that picks a region with no English conventions of its own
        // would still get American dates, which is precisely what this class
        // exists to prevent. Fall back to a known day-first English locale.
        //
        // Deliberately English-only: the inheritance problem is English's, and
        // "month before day" is a false alarm for languages that lead with the
        // year, such as Japanese. An explicit US region is honoured — an
        // American community should get American dates.
        if ($base === 'en' && $region !== 'US' && !self::rendersDayBeforeMonth($resolved)) {
            return self::firstAvailable(['en_GB', 'en_IE'], $available) ?? $resolved;
        }

        return $resolved ?? 'en';
    }

    /** @param list<string> $candidates @param list<string> $available */
    private static function firstAvailable(array $candidates, array $available): ?string
    {
        foreach ($candidates as $candidate) {
            if (in_array($candidate, $available, true)) {
                return $candidate;
            }
        }

        return null;
    }

    /**
     * Does this locale put the day before the month? Probed once per locale
     * rather than hardcoded, so it stays true if Carbon's data changes.
     */
    private static function rendersDayBeforeMonth(?string $locale): bool
    {
        if ($locale === null) {
            return false;
        }
        if (isset(self::$dayFirstByLocale[$locale])) {
            return self::$dayFirstByLocale[$locale];
        }

        try {
            // "17 August 2026" vs "August 17, 2026": whichever of the day
            // number and the first letter of the month name comes first.
            // Both offsets are byte offsets, so they compare directly.
            $rendered = (string) Carbon::create(2026, 8, 17, 12, 0, 0)->locale($locale)->isoFormat('LL');
            $dayPosition = strpos($rendered, '17');
            $monthPosition = preg_match('/\p{L}/u', $rendered, $match, PREG_OFFSET_CAPTURE) === 1
                ? $match[0][1]
                : null;

            $dayFirst = $dayPosition !== false
                && $monthPosition !== null
                && $dayPosition < $monthPosition;
        } catch (\Throwable) {
            $dayFirst = false;
        }

        return self::$dayFirstByLocale[$locale] = $dayFirst;
    }

    /** Two-letter region for the given (or active) tenant. */
    public static function region(?int $tenantId = null): string
    {
        $tenantId ??= self::currentTenantId();

        if ($tenantId !== null) {
            $configured = self::normaliseRegion(self::tenantSetting($tenantId, 'general.region'));
            if ($configured !== null) {
                return $configured;
            }

            $country = self::normaliseRegion(self::tenantCountryCode($tenantId));
            if ($country !== null) {
                return $country;
            }
        }

        return self::normaliseRegion(config('app.region')) ?? self::DEFAULT_REGION;
    }

    /** Clear memoised state. Test seam. */
    public static function flush(): void
    {
        self::$availableCarbonLocales = null;
        self::$dayFirstByLocale = [];
    }

    /** ISO 3166-1 alpha-2, upper-cased; null for anything else. */
    private static function normaliseRegion(mixed $value): ?string
    {
        if (!is_string($value)) {
            return null;
        }
        $trimmed = strtoupper(trim($value));

        return preg_match('/^[A-Z]{2}$/', $trimmed) === 1 ? $trimmed : null;
    }

    private static function currentTenantId(): ?int
    {
        try {
            $id = TenantContext::getId();

            return is_numeric($id) ? (int) $id : null;
        } catch (\Throwable) {
            // No tenant resolved (console command, early boot). The platform
            // default applies — this is a lookup miss, not a failure to report.
            return null;
        }
    }

    private static function tenantSetting(int $tenantId, string $key): ?string
    {
        try {
            $value = app(TenantSettingsService::class)->get($tenantId, $key);

            return is_string($value) ? $value : null;
        } catch (\Throwable) {
            return null;
        }
    }

    private static function tenantCountryCode(int $tenantId): ?string
    {
        try {
            $value = DB::table('tenants')->where('id', $tenantId)->value('country_code');

            return is_string($value) ? $value : null;
        } catch (\Throwable) {
            return null;
        }
    }

    /** @return list<string> */
    private static function availableCarbonLocales(): array
    {
        if (self::$availableCarbonLocales === null) {
            try {
                self::$availableCarbonLocales = Carbon::getAvailableLocales();
            } catch (\Throwable) {
                self::$availableCarbonLocales = ['en'];
            }
        }

        return self::$availableCarbonLocales;
    }
}
