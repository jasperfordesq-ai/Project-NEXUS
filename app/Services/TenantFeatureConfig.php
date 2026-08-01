<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

namespace App\Services;

/**
 * TenantFeatureConfig — Self-contained feature/module defaults and merging.
 *
 */
class TenantFeatureConfig
{
    /**
     * All known optional features with their default enabled/disabled state.
     */
    public const FEATURE_DEFAULTS = [
        'events' => true,
        'groups' => true,
        'gamification' => true,
        'goals' => true,
        'blog' => true,
        'resources' => true,
        'caring_community' => false,
        'volunteering' => true,
        'exchange_workflow' => true,
        'organisations' => true,
        'federation' => true,
        'connections' => true,
        'reviews' => true,
        'polls' => true,
        'job_vacancies' => true,
        'ideation_challenges' => true,
        'direct_messaging' => true,
        'group_exchanges' => true,
        'search' => true,
        'ai_chat' => true,
        'marketplace' => false,
        'merchant_coupons' => false,
        'message_translation' => true,
        'member_premium' => false,
        'ai_agents' => false,
        'partner_api' => false,
        'fadp_compliance' => false,
        'local_advertising' => false,
        'regional_analytics' => false,
        'newsletter' => true,
        // TOTP's switch governs new enrolment only so existing second-factor
        // challenges remain usable. The biometric_login switch is the explicit
        // tenant-wide master gate for both passkey enrolment and authentication.
        'two_factor_authentication' => true,
        'biometric_login' => true,
        // Identity verification (Stripe Identity "ID Verified" badge). Default ON
        // so the member-facing "Verify Identity" affordance keeps showing where it
        // already does; admins can turn it off per tenant in Module Configuration.
        'identity_verification' => true,
        // Maps default OFF platform-wide: the map system has had display issues
        // (Google AdvancedMarkers need a Map ID, etc.), so maps are opt-in per
        // tenant via the admin "Maps & location" kill switch rather than on by
        // default. A tenant only shows maps when its features JSON explicitly
        // sets maps=true. Keeps behaviour uniform across every tenant.
        'maps' => false,
        // Courses (alpha) — opt-in per tenant. Ships marked stage:'alpha' in the
        // React module registry. Default OFF like marketplace / caring_community.
        'courses' => false,
        // Podcasts — opt-in per tenant. Member-created shows are controlled
        // separately by podcasts.allow_member_show_creation and default ON there.
        'podcasts' => false,
        // Partner venues — a tenant-managed directory of local partner premises
        // where a member's pass QR can be scanned to record engagement. Records
        // engagement only: no coupon is issued and no discount is applied by the
        // platform. Default OFF, opt-in per community.
        'partner_venues' => false,
        // Public events advertising — lets anonymous visitors browse and read
        // published events without an account. Registration still requires
        // login. Default OFF: a community opts in to putting its events on the
        // open web. Effective exposure requires `events` as well.
        'public_events' => false,
        // Attendance rewards — grants time credits to a member on VERIFIED
        // event check-in, minted against the community so hosting is never a
        // personal cost. Default OFF, and additionally requires
        // EVENTS_ATTENDANCE_CREDIT_MODE=treasury plus a per-event amount, so
        // this switch alone cannot move credits.
        'event_attendance_credits' => false,
        // Explore / Discover curated discovery page. Default ON so the navbar link
        // keeps showing where it already does; admins can turn it off per tenant in
        // Module Configuration, which hides the navbar link and blocks the route.
        'explore' => true,
    ];

    /**
     * All known core modules with their default enabled/disabled state.
     */
    public const MODULE_DEFAULTS = [
        'listings' => true,
        'wallet' => true,
        'messages' => true,
        'dashboard' => true,
        'feed' => true,
        'notifications' => true,
        'profile' => true,
        'settings' => true,
    ];

    public function __construct()
    {
    }

    /**
     * Merge DB feature flags with defaults.
     * DB values override defaults; unknown DB keys are preserved.
     */
    public static function mergeFeatures(?array $dbFeatures): array
    {
        $result = self::FEATURE_DEFAULTS;

        if ($dbFeatures === null) {
            return $result;
        }

        foreach ($dbFeatures as $key => $value) {
            $result[$key] = (bool) $value;
        }

        return $result;
    }

    /**
     * Merge DB modules with defaults, returning the full module set.
     */
    public static function mergeModules(?array $dbModules): array
    {
        $result = self::MODULE_DEFAULTS;

        if ($dbModules === null) {
            return $result;
        }

        foreach ($dbModules as $key => $value) {
            $result[$key] = (bool) $value;
        }

        return $result;
    }
}
