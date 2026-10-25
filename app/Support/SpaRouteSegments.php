<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

namespace App\Support;

/**
 * The first path segment of every React route (2026-10-23), so the server can
 * tell a crawler "this address never existed" (404) instead of handing it the
 * app shell with noindex.
 *
 * Copied from react-frontend/src/routes/*.tsx, src/admin/routes.tsx and
 * src/broker/routes.tsx because the API image ships no react-frontend/;
 * SpaRouteSegmentsTest fails when the React routes add a segment that is not
 * listed here (or this lists one React no longer has). Deliberately lenient:
 * nested admin segments are included, and any address whose first segment is
 * known counts as real (its own page decides between content and 404).
 */
final class SpaRouteSegments
{
    /** @var list<string> */
    public const KNOWN = [
        '404-errors', 'about', 'acceptable-use', 'accessibility', 'account-deletion', 'achievements',
        'activity', 'activity-log', 'admin', 'advertise', 'advertising', 'agents', 'ai', 'ai-settings',
        'algorithm-settings', 'analytics', 'archives', 'attributes', 'auth', 'billing', 'blog',
        'blog-restore', 'broker', 'campaigns', 'caring', 'caring-community', 'categories', 'certificates',
        'changelog', 'chat', 'child-safety', 'clubs', 'community-analytics', 'community-guidelines',
        'configuration', 'connections', 'contact', 'cookies', 'coupons', 'courses', 'crm', 'cron-jobs',
        'custom-badges', 'dashboard', 'deliverability', 'developers', 'development-status', 'donations',
        'email-deliverability', 'email-settings', 'enterprise', 'events', 'exchanges', 'explore', 'faq',
        'features', 'federation', 'feed', 'feed-algorithm', 'gamification', 'geocode-groups', 'goals',
        'group-bookings', 'group-exchanges', 'group-locations', 'group-ranking', 'group-types', 'groups',
        'help', 'ideation', 'image-settings', 'impact-report', 'impact-summary', 'install-app', 'insurance',
        'integrations', 'jobs', 'join', 'kb', 'landing-page', 'leaderboard', 'legal', 'legal-documents',
        'linked-accounts', 'listings', 'listings-digest', 'login', 'marketplace', 'match-approvals', 'match-debug', 'matches',
        'matching-diagnostic', 'me', 'member-premium', 'members', 'menus', 'messages', 'moderation',
        'module-configuration', 'monitoring', 'municipality-calendar', 'national', 'native-app', 'newsletter',
        'newsletters', 'nexus-score', 'notifications', 'onboarding', 'onboarding-settings', 'operations',
        'organisations', 'page', 'pages', 'partner', 'partner-analytics', 'partner-timebanks',
        'partner-venues', 'password', 'performance', 'pilot-apply', 'pilot-inquiry', 'plans', 'platform',
        'platform-capabilities', 'podcasts', 'polls', 'premium', 'pricing', 'privacy', 'profile',
        'provisioning-requests', 'qualifications', 'regional-analytics', 'regional-points', 'register',
        'reports', 'residency-verifications', 'resources', 'retention', 'reviews', 'risk-tags',
        'safeguarding', 'safeguarding-options', 'saved', 'search', 'search-analytics', 'seed-generator',
        'seo', 'settings', 'skills', 'smart-match-monitoring', 'smart-match-users', 'smart-matching',
        'social-prescribing', 'sso', 'strategic-plan', 'stripe-account', 'super', 'super-admin',
        'support-actions', 'support-reports', 'swaps', 'tenant-features', 'terms', 'tests', 'timebanking',
        'timebanking-guide', 'training', 'translation-config', 'trust-and-safety', 'users', 'venues',
        'verify-certificate', 'verify-email', 'verify-identity', 'verify-identity-optional', 'vetting',
        'volunteering', 'wallet', 'webp-converter', 'whats-on',
    ];

    public static function isKnown(string $segment): bool
    {
        return in_array($segment, self::KNOWN, true);
    }
}
