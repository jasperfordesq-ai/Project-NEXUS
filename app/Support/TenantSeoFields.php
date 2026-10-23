<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

namespace App\Support;

/**
 * One set of rules for the community SEO fields stored on `tenants`, used by
 * both screens that write them (2026-10-23): the community admin's /admin/seo
 * (AdminConfigController::updateSeoConfig) and the super-admin tenant form
 * (AdminSuperController::tenantUpdate). Until then neither checked lengths
 * (a long value failed in the database and reached the admin as "refresh
 * failed") and the two choice fields accepted any text.
 */
final class TenantSeoFields
{
    /** Column => maximum characters (database/schema/mysql-schema.sql). */
    public const MAX_LENGTH = [
        'tagline' => 255,
        'meta_title' => 70,
        'meta_description' => 180,
        'h1_headline' => 100,
        'og_image_url' => 500,
        'social_facebook' => 255,
        'social_twitter' => 255,
        'social_instagram' => 255,
        'social_linkedin' => 255,
        'social_youtube' => 255,
    ];

    /**
     * Columns that hold a web address. Refused: any scheme other than http(s)
     * (javascript:, data: ...), protocol-relative "//host", and whitespace.
     * Deliberately lenient otherwise so a stored legacy value (a bare
     * "facebook.com/x", a site path "/uploads/...") never blocks a later save
     * of the whole super-admin form.
     */
    public const URL_COLUMNS = [
        'og_image_url', 'social_facebook', 'social_twitter', 'social_instagram', 'social_linkedin', 'social_youtube',
    ];

    /** The four choices both screens offer; '' means "not set" (index, follow). */
    public const ROBOTS = ['index, follow', 'noindex, follow', 'index, nofollow', 'noindex, nofollow'];

    /** Stored values; SeoHead maps them to schema.org types (NonprofitOrganization etc. → NGO). */
    public const ORGANIZATION_TYPES = [
        'NonprofitOrganization', 'LocalBusiness', 'CommunityOrganization', 'VolunteerOrganization', 'GovernmentOrganization',
    ];

    /**
     * The first problem in $values (keyed by tenants column), or null.
     *
     * @param array<string,mixed> $values
     * @return array{field:string, message:string}|null
     */
    public static function firstError(array $values): ?array
    {
        foreach (self::MAX_LENGTH as $column => $max) {
            if (array_key_exists($column, $values) && mb_strlen(trim((string) $values[$column])) > $max) {
                return ['field' => $column, 'message' => __('api.seo_field_too_long', ['max' => $max])];
            }
        }
        foreach (self::URL_COLUMNS as $column) {
            if (!array_key_exists($column, $values)) {
                continue;
            }
            $url = trim((string) $values[$column]);
            if ($url !== '' && !self::isWebAddress($url)) {
                return ['field' => $column, 'message' => __('api.invalid_url')];
            }
        }
        if (array_key_exists('robots_directive', $values)) {
            $v = trim((string) $values['robots_directive']);
            if ($v !== '' && !in_array($v, self::ROBOTS, true)) {
                return ['field' => 'robots_directive', 'message' => __('api.seo_robots_invalid')];
            }
        }
        if (array_key_exists('seo_organization_type', $values)) {
            $v = trim((string) $values['seo_organization_type']);
            if ($v !== '' && !in_array($v, self::ORGANIZATION_TYPES, true)) {
                return ['field' => 'seo_organization_type', 'message' => __('api.seo_organization_type_invalid')];
            }
        }
        return null;
    }

    public static function isWebAddress(string $url): bool
    {
        if (preg_match('#\s#', $url) || str_starts_with($url, '//')) {
            return false;
        }
        if (preg_match('#^([a-z][a-z0-9+.-]*):#i', $url, $m)) {
            return in_array(strtolower($m[1]), ['http', 'https'], true) && filter_var($url, FILTER_VALIDATE_URL) !== false;
        }
        return true; // a site path or a bare domain
    }
}
