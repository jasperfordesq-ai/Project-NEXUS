<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

namespace App\Support;

use Illuminate\Support\Facades\DB;

/**
 * A community's default social sharing image (og:image) — ONE value, two
 * storage places kept identical.
 *
 * Two screens set it: the community's own SEO page (/admin/seo, the
 * `seo_og_image_url` tenant setting) and the super-admin tenant form
 * (`tenants.og_image_url`). Until 2026-10-23 each wrote only its own place
 * and read only its own place, so an image uploaded on one screen did not
 * show on the other (owner report, Timebanking UK, tenant 11), and which one
 * the public site used depended on precedence rules nobody could see.
 *
 * Now every write goes to both places, and every read (both screens and the
 * tenant bootstrap) uses the same precedence: the setting first, then the
 * column, for rows written before both were kept in step.
 */
final class TenantSharingImage
{
    public const SETTING_KEY = 'seo_og_image_url';

    /** The current image address ('' when none). */
    public static function read(int $tenantId, ?string $column = null): string
    {
        try {
            $setting = DB::table('tenant_settings')
                ->where('tenant_id', $tenantId)
                ->where('setting_key', self::SETTING_KEY)
                ->value('setting_value');
        } catch (\Throwable) {
            $setting = null;
        }

        $setting = trim((string) ($setting ?? ''));
        if ($setting !== '') {
            return $setting;
        }

        if ($column === null) {
            $column = (string) (DB::table('tenants')->where('id', $tenantId)->value('og_image_url') ?? '');
        }

        return trim($column);
    }

    /**
     * Store the setting half. Callers that update `tenants` themselves add
     * `og_image_url` to their own update; callers that do not use write().
     * Run inside the caller's transaction so both halves commit together.
     */
    public static function writeSetting(int $tenantId, string $url): void
    {
        DB::table('tenant_settings')->updateOrInsert(
            ['tenant_id' => $tenantId, 'setting_key' => self::SETTING_KEY],
            ['setting_value' => trim($url), 'setting_type' => 'string', 'updated_at' => now()]
        );
    }

    /** Store both halves. */
    public static function write(int $tenantId, string $url): void
    {
        self::writeSetting($tenantId, $url);
        DB::table('tenants')->where('id', $tenantId)->update(['og_image_url' => trim($url)]);
    }
}
