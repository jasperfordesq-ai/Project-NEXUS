<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

declare(strict_types=1);

namespace App\Services\CaringCommunity;

use App\Enums\GroupStatus;
use App\Support\Events\EventSearchVisibility;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Log;
use Illuminate\Support\Facades\Schema;

/**
 * AG90 — Personalised Civic Information Filter and Regional Digest.
 *
 * Read/composition layer that merges items from several existing tenant
 * content sources (project announcements, events, vol_organizations,
 * care providers, marketplace, safety alerts, help requests, feed posts)
 * into a single ranked feed for residents.
 *
 * Owns NO new content table. Tenant-level cadence and per-user preferences
 * are stored as JSON envelopes in `tenant_settings`.
 *
 * Every source query is Schema::hasTable-guarded so missing tables degrade
 * gracefully and don't break the digest.
 */
class CivicDigestService
{
    public const SETTING_TENANT_DEFAULT = 'caring.civic_digest.tenant_default_cadence';
    public const SETTING_USER_PREFIX    = 'caring.civic_digest.user_prefs.';
    public const DELIVERY_CLAIMS_TABLE  = 'civic_digest_delivery_claims';

    private const ALLOWED_CADENCES = ['off', 'daily', 'monthly'];
    private const CLAIM_STALE_AFTER_DAYS = 35;

    private const SOURCE_WEIGHTS = [
        'safety_alert'  => 10,
        'project'       => 3,
        'announcement'  => 2,
        'event'         => 1,
        'vol_org'       => 1,
        'care_provider' => 1,
        'marketplace'   => 1,
        'help_request'  => 1,
        'feed_post'     => 1,
    ];

    private const ALLOWED_SOURCES = [
        'announcement',
        'project',
        'event',
        'vol_org',
        'care_provider',
        'marketplace',
        'safety_alert',
        'help_request',
        'feed_post',
    ];

    /**
     * Build the personalised digest for the given member.
     *
     * @return list<array{
     *     id: string,
     *     source: string,
     *     title: string,
     *     summary: string,
     *     occurred_at: string|null,
     *     sub_region_id: int|null,
     *     audience_match_score: int,
     *     link_path: string|null,
     *     score_reasons: list<array{key: string, label_key: string, weight: int}>
     * }>
     */
    public function digestForMember(int $tenantId, int $userId, int $limit = 50): array
    {
        if ($tenantId <= 0 || $userId <= 0) {
            return [];
        }

        $prefs = $this->getUserPrefs($tenantId, $userId);
        $optOut = is_array($prefs['opt_out_sources'] ?? null) ? $prefs['opt_out_sources'] : [];

        $userSubRegionId = $this->resolveUserSubRegionId($tenantId, $userId, $prefs);
        $interests = $this->resolveUserInterests($tenantId, $userId);

        // Pull from each source — each call is fully Schema-guarded
        $items = [];
        $sourceFetchers = [
            'announcement'  => fn (): array => $this->fetchAnnouncements($tenantId),
            'project'       => fn (): array => $this->fetchProjects($tenantId),
            'event'         => fn (): array => $this->fetchEvents($tenantId, $userId),
            'vol_org'       => fn (): array => $this->fetchVolOrgs($tenantId),
            'care_provider' => fn (): array => $this->fetchCareProviders($tenantId),
            'marketplace'   => fn (): array => $this->fetchMarketplace($tenantId),
            'safety_alert'  => fn (): array => $this->fetchSafetyAlerts($tenantId, $userId),
            'help_request'  => fn (): array => $this->fetchHelpRequests($tenantId),
            'feed_post'     => fn (): array => $this->fetchFeedPosts($tenantId),
        ];

        foreach ($sourceFetchers as $sourceKey => $fetcher) {
            if (in_array($sourceKey, $optOut, true)) {
                continue;
            }
            try {
                foreach ($fetcher() as $row) {
                    $items[] = $row;
                }
            } catch (\Throwable $e) {
                // Source temporarily unavailable — skip silently
                continue;
            }
        }

        // Score, filter, and sort
        $scored = [];
        foreach ($items as $item) {
            $breakdown = $this->scoreItemWithReasons($item, $userSubRegionId, $interests);
            if ($breakdown['score'] < 1) {
                continue;
            }
            $item['audience_match_score'] = $breakdown['score'];
            $item['score_reasons']        = $breakdown['reasons'];
            $scored[] = $item;
        }

        usort($scored, function ($a, $b) {
            if ($a['audience_match_score'] !== $b['audience_match_score']) {
                return $b['audience_match_score'] <=> $a['audience_match_score'];
            }
            $aTime = $a['occurred_at'] ?? '';
            $bTime = $b['occurred_at'] ?? '';
            return strcmp((string) $bTime, (string) $aTime);
        });

        if ($limit < 1) {
            $limit = 50;
        }

        return array_slice($scored, 0, $limit);
    }

    /**
     * @return array{
     *     enabled: bool,
     *     cadence: string,
     *     preferred_sub_region_id: int|null,
     *     opt_out_sources: list<string>,
     *     updated_at: int|null
     * }
     */
    public function getUserPrefs(int $tenantId, int $userId): array
    {
        $defaults = [
            'enabled' => true,
            'cadence' => $this->getTenantCadence($tenantId),
            'preferred_sub_region_id' => null,
            'opt_out_sources' => [],
            'updated_at' => null,
        ];

        if (!Schema::hasTable('tenant_settings')) {
            return $defaults;
        }

        $row = DB::table('tenant_settings')
            ->where('tenant_id', $tenantId)
            ->where('setting_key', self::SETTING_USER_PREFIX . $userId)
            ->first();

        if (!$row || !$row->setting_value) {
            return $defaults;
        }

        $decoded = json_decode((string) $row->setting_value, true);
        if (!is_array($decoded)) {
            return $defaults;
        }

        $cadence = isset($decoded['cadence']) && is_string($decoded['cadence'])
            ? $this->normalizeCadence($decoded['cadence'])
            : $defaults['cadence'];
        $cadence ??= $defaults['cadence'];

        $preferredSubRegion = isset($decoded['preferred_sub_region_id']) && is_numeric($decoded['preferred_sub_region_id'])
            ? (int) $decoded['preferred_sub_region_id']
            : null;

        $optOut = [];
        if (isset($decoded['opt_out_sources']) && is_array($decoded['opt_out_sources'])) {
            foreach ($decoded['opt_out_sources'] as $source) {
                if (is_string($source) && in_array($source, self::ALLOWED_SOURCES, true)) {
                    $optOut[] = $source;
                }
            }
        }

        return [
            'enabled' => isset($decoded['enabled']) ? (bool) $decoded['enabled'] : true,
            'cadence' => $cadence,
            'preferred_sub_region_id' => $preferredSubRegion,
            'opt_out_sources' => array_values(array_unique($optOut)),
            'updated_at' => isset($decoded['updated_at']) && is_numeric($decoded['updated_at'])
                ? (int) $decoded['updated_at']
                : null,
        ];
    }

    /**
     * @param array<string, mixed> $prefs
     * @return array{prefs?: array<string, mixed>, errors?: list<array{field: string, message: string}>}
     */
    public function setUserPrefs(int $tenantId, int $userId, array $prefs): array
    {
        $errors = [];

        $current = $this->getUserPrefs($tenantId, $userId);
        $merged = $current;

        if (array_key_exists('cadence', $prefs)) {
            if (!is_string($prefs['cadence']) || $this->normalizeCadence($prefs['cadence']) === null) {
                $errors[] = ['field' => 'cadence', 'message' => __('caring_community.civic_digest.cadence_invalid')];
            } else {
                $merged['cadence'] = $this->normalizeCadence($prefs['cadence']);
                $merged['enabled'] = $merged['cadence'] !== 'off';
            }
        }

        if (array_key_exists('preferred_sub_region_id', $prefs)) {
            if ($prefs['preferred_sub_region_id'] === null || $prefs['preferred_sub_region_id'] === '') {
                $merged['preferred_sub_region_id'] = null;
            } elseif (is_numeric($prefs['preferred_sub_region_id'])) {
                $merged['preferred_sub_region_id'] = (int) $prefs['preferred_sub_region_id'];
            } else {
                $errors[] = ['field' => 'preferred_sub_region_id', 'message' => __('caring_community.civic_digest.preferred_sub_region_invalid')];
            }
        }

        if (array_key_exists('opt_out_sources', $prefs)) {
            if (!is_array($prefs['opt_out_sources'])) {
                $errors[] = ['field' => 'opt_out_sources', 'message' => __('caring_community.civic_digest.opt_out_sources_invalid')];
            } else {
                $clean = [];
                foreach ($prefs['opt_out_sources'] as $src) {
                    if (is_string($src) && in_array($src, self::ALLOWED_SOURCES, true)) {
                        $clean[] = $src;
                    }
                }
                $merged['opt_out_sources'] = array_values(array_unique($clean));
            }
        }

        if ($errors !== []) {
            return ['errors' => $errors];
        }

        $merged['updated_at'] = time();

        if (!Schema::hasTable('tenant_settings')) {
            return ['prefs' => $merged];
        }

        $now = now();
        DB::table('tenant_settings')->updateOrInsert(
            [
                'tenant_id' => $tenantId,
                'setting_key' => self::SETTING_USER_PREFIX . $userId,
            ],
            [
                'setting_value' => json_encode($merged, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES),
                'setting_type' => 'json',
                'category' => 'caring_community',
                'description' => 'AG90 civic digest user preferences',
                'updated_at' => $now,
            ],
        );

        return ['prefs' => $merged];
    }

    /**
     * Mark the digest as sent for a given user — used by the dispatch command
     * for idempotency. Stored alongside user prefs as a `last_sent_at` field.
     */
    public function markSentNow(int $tenantId, int $userId): void
    {
        if ($tenantId <= 0 || $userId <= 0 || !Schema::hasTable('tenant_settings')) {
            return;
        }
        $current = $this->getUserPrefs($tenantId, $userId);
        $payload = [
            'enabled' => $current['enabled'],
            'cadence' => $current['cadence'],
            'preferred_sub_region_id' => $current['preferred_sub_region_id'],
            'opt_out_sources' => $current['opt_out_sources'],
            'updated_at' => $current['updated_at'],
            'last_sent_at' => time(),
        ];
        DB::table('tenant_settings')->updateOrInsert(
            [
                'tenant_id' => $tenantId,
                'setting_key' => self::SETTING_USER_PREFIX . $userId,
            ],
            [
                'setting_value' => json_encode($payload, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES),
                'setting_type' => 'json',
                'category' => 'caring_community',
                'description' => 'AG90 civic digest user preferences',
                'updated_at' => now(),
            ],
        );
    }

    public function deliveryWindowKey(string $cadence, ?int $timestamp = null): string
    {
        $timestamp ??= time();
        $cadence = $cadence === 'monthly' || $cadence === 'weekly' ? 'monthly' : 'daily';

        return $cadence === 'monthly'
            ? date('Y-m', $timestamp)
            : date('Y-m-d', $timestamp);
    }

    public function claimDelivery(int $tenantId, int $userId, string $cadence, string $windowKey): bool
    {
        if ($tenantId <= 0 || $userId <= 0 || $windowKey === '') {
            return false;
        }

        if (!Schema::hasTable(self::DELIVERY_CLAIMS_TABLE)) {
            return true;
        }

        $this->releaseStaleDeliveryClaims();

        try {
            $inserted = DB::table(self::DELIVERY_CLAIMS_TABLE)->insertOrIgnore([
                'tenant_id' => $tenantId,
                'user_id' => $userId,
                'cadence' => $cadence === 'monthly' || $cadence === 'weekly' ? 'monthly' : 'daily',
                'window_key' => $windowKey,
                'status' => 'claimed',
                'claimed_at' => now(),
                'created_at' => now(),
                'updated_at' => now(),
            ]);

            return (int) $inserted > 0;
        } catch (\Throwable $e) {
            Log::warning('[CivicDigestService] delivery claim failed', [
                'tenant_id' => $tenantId,
                'user_id' => $userId,
                'cadence' => $cadence,
                'window_key' => $windowKey,
                'error' => $e->getMessage(),
            ]);

            return false;
        }
    }

    public function releaseDeliveryClaim(int $tenantId, int $userId, string $cadence, string $windowKey): void
    {
        if (!Schema::hasTable(self::DELIVERY_CLAIMS_TABLE)) {
            return;
        }

        DB::table(self::DELIVERY_CLAIMS_TABLE)
            ->where('tenant_id', $tenantId)
            ->where('user_id', $userId)
            ->where('cadence', $cadence === 'monthly' || $cadence === 'weekly' ? 'monthly' : 'daily')
            ->where('window_key', $windowKey)
            ->whereNull('sent_at')
            ->delete();
    }

    /**
     * Reap only abandoned old-window claims. A claimed row in the active window
     * is a durable no-duplicate marker because a worker can crash after SMTP
     * acceptance but before it records sent_at.
     */
    public function releaseStaleDeliveryClaims(): int
    {
        if (!Schema::hasTable(self::DELIVERY_CLAIMS_TABLE)) {
            return 0;
        }

        return DB::table(self::DELIVERY_CLAIMS_TABLE)
            ->where('status', 'claimed')
            ->whereNull('sent_at')
            ->where('claimed_at', '<', now()->subDays(self::CLAIM_STALE_AFTER_DAYS))
            ->delete();
    }

    /**
     * @param array<string, mixed> $evidence
     */
    public function markDeliverySent(int $tenantId, int $userId, string $cadence, string $windowKey, array $evidence): bool
    {
        if (!Schema::hasTable(self::DELIVERY_CLAIMS_TABLE)) {
            $this->markSentNow($tenantId, $userId);
            return true;
        }

        $updated = DB::table(self::DELIVERY_CLAIMS_TABLE)
            ->where('tenant_id', $tenantId)
            ->where('user_id', $userId)
            ->where('cadence', $cadence === 'monthly' || $cadence === 'weekly' ? 'monthly' : 'daily')
            ->where('window_key', $windowKey)
            ->whereNull('sent_at')
            ->update([
                'status' => 'sent',
                'sent_at' => now(),
                'delivery_evidence' => json_encode($evidence, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES),
                'updated_at' => now(),
            ]);

        if ((int) $updated > 0) {
            $this->markSentNow($tenantId, $userId);
        }

        return (int) $updated > 0;
    }

    /**
     * @param array<string, mixed> $evidence
     */
    public function markDeliverySuppressed(int $tenantId, int $userId, string $cadence, string $windowKey, array $evidence): bool
    {
        if (!Schema::hasTable(self::DELIVERY_CLAIMS_TABLE)) {
            $this->markSentNow($tenantId, $userId);
            return true;
        }

        $updated = DB::table(self::DELIVERY_CLAIMS_TABLE)
            ->where('tenant_id', $tenantId)
            ->where('user_id', $userId)
            ->where('cadence', $cadence === 'monthly' || $cadence === 'weekly' ? 'monthly' : 'daily')
            ->where('window_key', $windowKey)
            ->whereNull('sent_at')
            ->update([
                'status' => 'suppressed',
                'sent_at' => now(),
                'delivery_evidence' => json_encode($evidence, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES),
                'updated_at' => now(),
            ]);

        if ((int) $updated > 0) {
            $this->markSentNow($tenantId, $userId);
        }

        return (int) $updated > 0;
    }

    /**
     * Read the last_sent_at timestamp for a user (epoch seconds), or null if
     * never sent.
     */
    public function getLastSentAt(int $tenantId, int $userId): ?int
    {
        if ($tenantId <= 0 || $userId <= 0) {
            return null;
        }

        if (Schema::hasTable(self::DELIVERY_CLAIMS_TABLE)) {
            $sentAt = DB::table(self::DELIVERY_CLAIMS_TABLE)
                ->where('tenant_id', $tenantId)
                ->where('user_id', $userId)
                ->whereNotNull('sent_at')
                ->max('sent_at');

            if (is_string($sentAt) && $sentAt !== '') {
                $timestamp = strtotime($sentAt);
                if ($timestamp !== false) {
                    return $timestamp;
                }
            }
        }

        if (!Schema::hasTable('tenant_settings')) {
            return null;
        }

        $row = DB::table('tenant_settings')
            ->where('tenant_id', $tenantId)
            ->where('setting_key', self::SETTING_USER_PREFIX . $userId)
            ->first();
        if (!$row || !$row->setting_value) {
            return null;
        }
        $decoded = json_decode((string) $row->setting_value, true);
        if (!is_array($decoded) || !isset($decoded['last_sent_at']) || !is_numeric($decoded['last_sent_at'])) {
            return null;
        }
        return (int) $decoded['last_sent_at'];
    }

    /**
     * Returns the count of allowed sources — used by the dispatch command to
     * detect "opted out of everything" (skip silently).
     */
    public function allowedSourceCount(): int
    {
        return count(self::ALLOWED_SOURCES);
    }

    public function getTenantCadence(int $tenantId): string
    {
        if (!Schema::hasTable('tenant_settings')) {
            return 'monthly';
        }

        $row = DB::table('tenant_settings')
            ->where('tenant_id', $tenantId)
            ->where('setting_key', self::SETTING_TENANT_DEFAULT)
            ->first();

        if (!$row || !$row->setting_value) {
            return 'monthly';
        }

        $value = trim((string) $row->setting_value, "\" \t\n\r\0\x0B");
        return $this->normalizeCadence($value) ?? 'monthly';
    }

    /**
     * @return array{cadence?: string, errors?: list<array{field: string, message: string}>}
     */
    public function setTenantCadence(int $tenantId, string $cadence): array
    {
        $cadence = $this->normalizeCadence($cadence);
        if ($cadence === null) {
            return [
                'errors' => [
                    ['field' => 'cadence', 'message' => __('caring_community.civic_digest.cadence_invalid')],
                ],
            ];
        }

        if (!Schema::hasTable('tenant_settings')) {
            return ['cadence' => $cadence];
        }

        $now = now();
        DB::table('tenant_settings')->updateOrInsert(
            [
                'tenant_id' => $tenantId,
                'setting_key' => self::SETTING_TENANT_DEFAULT,
            ],
            [
                'setting_value' => $cadence,
                'setting_type' => 'string',
                'category' => 'caring_community',
                'description' => 'AG90 civic digest tenant default cadence',
                'updated_at' => $now,
            ],
        );

        return ['cadence' => $cadence];
    }

    private function normalizeCadence(string $cadence): ?string
    {
        return match ($cadence) {
            'weekly' => 'monthly',
            'off', 'daily', 'monthly' => $cadence,
            default => null,
        };
    }

    // ─────────────────────────────────────────────────────────────────────
    // Source fetchers — each Schema::hasTable-guarded, tenant-scoped,
    // 30-day window unless source semantics dictate otherwise.
    // ─────────────────────────────────────────────────────────────────────

    /**
     * @return list<array<string, mixed>>
     */
    private function fetchAnnouncements(int $tenantId): array
    {
        // Re-uses caring_project_announcements rows whose status='draft' is excluded;
        // 'announcement' source represents short-lived published items vs 'project'
        // which represents long-running ones (status active/paused, with stages).
        if (!Schema::hasTable('caring_project_announcements')) {
            return [];
        }

        $cutoff = $this->cutoff30Days();
        $rows = DB::table('caring_project_announcements')
            ->where('tenant_id', $tenantId)
            ->whereIn('status', ['active', 'paused', 'completed'])
            ->where(function ($q) use ($cutoff) {
                $q->where('published_at', '>=', $cutoff)
                    ->orWhere('last_update_at', '>=', $cutoff);
            })
            ->where(function ($q) {
                $q->whereNull('current_stage')->orWhere('progress_percent', '>=', 100);
            })
            ->orderByDesc('last_update_at')
            ->limit(20)
            ->get();

        $items = [];
        foreach ($rows as $r) {
            $items[] = [
                'id' => 'announcement:' . (int) $r->id,
                'source' => 'announcement',
                'title' => (string) ($r->title ?? ''),
                'summary' => (string) ($r->summary ?? ''),
                'occurred_at' => isset($r->last_update_at) ? (string) $r->last_update_at : (isset($r->published_at) ? (string) $r->published_at : null),
                'sub_region_id' => null,
                'audience_match_score' => 0,
                'link_path' => '/caring-community/projects/' . (int) $r->id,
                'categories' => [],
            ];
        }
        return $items;
    }

    /**
     * @return list<array<string, mixed>>
     */
    private function fetchProjects(int $tenantId): array
    {
        if (!Schema::hasTable('caring_project_announcements')) {
            return [];
        }

        $cutoff = $this->cutoff30Days();
        $rows = DB::table('caring_project_announcements')
            ->where('tenant_id', $tenantId)
            ->whereIn('status', ['active', 'paused'])
            ->where('progress_percent', '<', 100)
            ->where(function ($q) use ($cutoff) {
                $q->where('published_at', '>=', $cutoff)
                    ->orWhere('last_update_at', '>=', $cutoff);
            })
            ->orderByDesc('last_update_at')
            ->limit(20)
            ->get();

        $items = [];
        foreach ($rows as $r) {
            $items[] = [
                'id' => 'project:' . (int) $r->id,
                'source' => 'project',
                'title' => (string) ($r->title ?? ''),
                'summary' => (string) ($r->summary ?? ''),
                'occurred_at' => isset($r->last_update_at) ? (string) $r->last_update_at : (isset($r->published_at) ? (string) $r->published_at : null),
                'sub_region_id' => null,
                'audience_match_score' => 0,
                'link_path' => '/caring-community/projects/' . (int) $r->id,
                'categories' => [],
            ];
        }
        return $items;
    }

    /**
     * @return list<array<string, mixed>>
     */
    private function fetchEvents(int $tenantId, int $viewerId): array
    {
        if (!Schema::hasTable('events')) {
            return [];
        }

        $cutoff = $this->cutoff30Days();
        $now = date('Y-m-d H:i:s');

        $query = DB::table('events')
            ->where('tenant_id', $tenantId)
            ->where('status', 'active');
        // F-129: canonical lifecycle boundary plus the same group-audience rule
        // EventService::applyDiscoveryVisibility() uses for member discovery.
        EventSearchVisibility::applyToQuery($query, $tenantId, 'events');
        $this->applyEventGroupAudience($query, $tenantId, $viewerId);

        $rows = $query
            ->where('start_time', '>=', $now)
            ->where('start_time', '<=', date('Y-m-d H:i:s', strtotime('+45 days')))
            ->where(function ($q) use ($cutoff) {
                $q->where('created_at', '>=', $cutoff)
                    ->orWhere('updated_at', '>=', $cutoff);
            })
            ->orderBy('start_time')
            ->limit(20)
            ->get();

        $items = [];
        foreach ($rows as $r) {
            $items[] = [
                'id' => 'event:' . (int) $r->id,
                'source' => 'event',
                'title' => (string) ($r->title ?? ''),
                'summary' => $this->shorten((string) ($r->description ?? '')),
                'occurred_at' => isset($r->start_time) ? (string) $r->start_time : null,
                'sub_region_id' => null,
                'audience_match_score' => 0,
                'link_path' => '/events/' . (int) $r->id,
                'categories' => [],
            ];
        }
        return $items;
    }

    /**
     * @return list<array<string, mixed>>
     */
    private function fetchVolOrgs(int $tenantId): array
    {
        if (!Schema::hasTable('vol_organizations')) {
            return [];
        }

        $cutoff = $this->cutoff30Days();
        $rows = DB::table('vol_organizations')
            ->where('tenant_id', $tenantId)
            ->where('status', 'active')
            ->where(function ($q) use ($cutoff) {
                $q->where('updated_at', '>=', $cutoff)
                    ->orWhere('created_at', '>=', $cutoff);
            })
            ->orderByDesc('updated_at')
            ->limit(15)
            ->get();

        $items = [];
        foreach ($rows as $r) {
            $items[] = [
                'id' => 'vol_org:' . (int) $r->id,
                'source' => 'vol_org',
                'title' => (string) ($r->name ?? ''),
                'summary' => $this->shorten((string) ($r->description ?? '')),
                'occurred_at' => isset($r->updated_at) ? (string) $r->updated_at : (isset($r->created_at) ? (string) $r->created_at : null),
                'sub_region_id' => null,
                'audience_match_score' => 0,
                'link_path' => '/organisations/' . (int) $r->id,
                'categories' => [],
            ];
        }
        return $items;
    }

    /**
     * @return list<array<string, mixed>>
     */
    private function fetchCareProviders(int $tenantId): array
    {
        if (!Schema::hasTable('caring_care_providers')) {
            return [];
        }

        $cutoff = $this->cutoff30Days();
        $rows = DB::table('caring_care_providers')
            ->where('tenant_id', $tenantId)
            ->where('status', 'active')
            ->where(function ($q) use ($cutoff) {
                $q->where('updated_at', '>=', $cutoff)
                    ->orWhere('created_at', '>=', $cutoff);
            })
            ->orderByDesc('updated_at')
            ->limit(15)
            ->get();

        $items = [];
        foreach ($rows as $r) {
            $cats = [];
            if (isset($r->categories) && is_string($r->categories)) {
                $decoded = json_decode($r->categories, true);
                if (is_array($decoded)) {
                    $cats = array_values(array_filter($decoded, 'is_string'));
                }
            }
            $items[] = [
                'id' => 'care_provider:' . (int) $r->id,
                'source' => 'care_provider',
                'title' => (string) ($r->name ?? ''),
                'summary' => $this->shorten((string) ($r->description ?? '')),
                'occurred_at' => isset($r->updated_at) ? (string) $r->updated_at : (isset($r->created_at) ? (string) $r->created_at : null),
                'sub_region_id' => isset($r->sub_region_id) && $r->sub_region_id !== null ? (int) $r->sub_region_id : null,
                'audience_match_score' => 0,
                'link_path' => '/caring-community/care-providers/' . (int) $r->id,
                'categories' => $cats,
            ];
        }
        return $items;
    }

    /**
     * @return list<array<string, mixed>>
     */
    private function fetchMarketplace(int $tenantId): array
    {
        if (!Schema::hasTable('marketplace_listings')) {
            return [];
        }

        $cutoff = $this->cutoff30Days();
        $rows = DB::table('marketplace_listings')
            ->where('tenant_id', $tenantId)
            ->where('status', 'active')
            ->where('moderation_status', 'approved')
            ->where(function ($q) use ($cutoff) {
                $q->where('updated_at', '>=', $cutoff)
                    ->orWhere('created_at', '>=', $cutoff);
            })
            ->orderByDesc('created_at')
            ->limit(15)
            ->get();

        $items = [];
        foreach ($rows as $r) {
            $items[] = [
                'id' => 'marketplace:' . (int) $r->id,
                'source' => 'marketplace',
                'title' => (string) ($r->title ?? ''),
                'summary' => $this->shorten((string) ($r->description ?? '')),
                'occurred_at' => isset($r->created_at) ? (string) $r->created_at : null,
                'sub_region_id' => null,
                'audience_match_score' => 0,
                'link_path' => '/marketplace/' . (int) $r->id,
                'categories' => [],
            ];
        }
        return $items;
    }

    /**
     * @return list<array<string, mixed>>
     */
    private function fetchSafetyAlerts(int $tenantId, int $viewerId): array
    {
        if (!Schema::hasTable('caring_emergency_alerts')) {
            return [];
        }

        $now = date('Y-m-d H:i:s');
        $cutoff = $this->cutoff30Days();
        $rows = DB::table('caring_emergency_alerts')
            ->where('tenant_id', $tenantId)
            ->where('is_active', 1)
            ->where(function ($q) use ($now) {
                $q->whereNull('expires_at')->orWhere('expires_at', '>=', $now);
            })
            ->where(function ($q) use ($cutoff) {
                $q->where('sent_at', '>=', $cutoff)
                    ->orWhere('created_at', '>=', $cutoff);
            })
            ->orderByDesc('sent_at')
            ->limit(50)
            ->get()
            // F-129: a targeted alert reaches only its targets — the same rule
            // the member alert banner applies (EmergencyAlertService). Filter
            // before trimming to 10 so other people's alerts cannot crowd out
            // the viewer's own.
            ->filter(fn ($r): bool => EmergencyAlertService::isTargetedAt($r->target_user_ids ?? null, $viewerId))
            ->take(10);

        $items = [];
        foreach ($rows as $r) {
            $items[] = [
                'id' => 'safety_alert:' . (int) $r->id,
                'source' => 'safety_alert',
                'title' => (string) ($r->title ?? ''),
                'summary' => $this->shorten((string) ($r->body ?? '')),
                'occurred_at' => isset($r->sent_at) ? (string) $r->sent_at : (isset($r->created_at) ? (string) $r->created_at : null),
                'sub_region_id' => null,
                'audience_match_score' => 0,
                'link_path' => '/caring-community/alerts/' . (int) $r->id,
                'categories' => [],
            ];
        }
        return $items;
    }

    /**
     * @return list<array<string, mixed>>
     */
    private function fetchHelpRequests(int $tenantId): array
    {
        if (!Schema::hasTable('caring_help_requests')) {
            return [];
        }

        // Help requests are coordinator-facing by default. Only include them in
        // member digests if a future schema adds an explicit public/consent flag.
        $publicColumn = null;
        foreach (['include_in_civic_digest', 'share_in_civic_digest', 'public_consent', 'is_public'] as $candidate) {
            if (Schema::hasColumn('caring_help_requests', $candidate)) {
                $publicColumn = $candidate;
                break;
            }
        }
        if ($publicColumn === null) {
            return [];
        }

        $cutoff = $this->cutoff30Days();
        $rows = DB::table('caring_help_requests')
            ->where('tenant_id', $tenantId)
            ->where('status', 'pending')
            ->where($publicColumn, 1)
            ->where(function ($q) use ($cutoff) {
                $q->where('created_at', '>=', $cutoff)
                    ->orWhere('updated_at', '>=', $cutoff);
            })
            ->orderByDesc('created_at')
            ->limit(15)
            ->get();

        $items = [];
        foreach ($rows as $r) {
            $items[] = [
                'id' => 'help_request:' . (int) $r->id,
                'source' => 'help_request',
                'title' => $this->shorten((string) ($r->what ?? ''), 80),
                'summary' => isset($r->when_needed) ? (string) $r->when_needed : '',
                'occurred_at' => isset($r->created_at) ? (string) $r->created_at : null,
                'sub_region_id' => null,
                'audience_match_score' => 0,
                'link_path' => '/caring-community/help-requests/' . (int) $r->id,
                'categories' => [],
            ];
        }
        return $items;
    }

    /**
     * @return list<array<string, mixed>>
     */
    private function fetchFeedPosts(int $tenantId): array
    {
        if (!Schema::hasTable('posts')) {
            return [];
        }

        $cutoff = $this->cutoff30Days();
        $rows = DB::table('posts')
            ->where('tenant_id', $tenantId)
            ->where('status', 'published')
            ->where(function ($q) use ($cutoff) {
                $q->where('updated_at', '>=', $cutoff)
                    ->orWhere('created_at', '>=', $cutoff);
            })
            ->orderByDesc('created_at')
            ->limit(15)
            ->get();

        $items = [];
        foreach ($rows as $r) {
            $items[] = [
                'id' => 'feed_post:' . (int) $r->id,
                'source' => 'feed_post',
                'title' => (string) ($r->title ?? ''),
                'summary' => $this->shorten((string) ($r->excerpt ?? '')),
                'occurred_at' => isset($r->created_at) ? (string) $r->created_at : null,
                'sub_region_id' => null,
                'audience_match_score' => 0,
                'link_path' => '/blog/' . (string) ($r->slug ?? (int) $r->id),
                'categories' => [],
            ];
        }
        return $items;
    }

    // ─────────────────────────────────────────────────────────────────────
    // Internals
    // ─────────────────────────────────────────────────────────────────────

    /**
     * @param array<string, mixed> $prefs
     */
    private function resolveUserSubRegionId(int $tenantId, int $userId, array $prefs): ?int
    {
        // 1. Explicit per-user preference wins
        $preferred = $prefs['preferred_sub_region_id'] ?? null;
        if (is_int($preferred) && $preferred > 0) {
            return $preferred;
        }

        // 2. Try users.sub_region_id if column exists
        if (Schema::hasTable('users') && Schema::hasColumn('users', 'sub_region_id')) {
            try {
                $row = DB::table('users')
                    ->where('id', $userId)
                    ->where('tenant_id', $tenantId)
                    ->first(['sub_region_id']);
                if ($row && isset($row->sub_region_id) && $row->sub_region_id !== null) {
                    return (int) $row->sub_region_id;
                }
            } catch (\Throwable $e) {
                Log::warning('CivicDigestService: failed to resolve user sub_region_id', [
                    'exception' => $e->getMessage(),
                    'tenant_id' => $tenantId,
                    'user_id' => $userId,
                ]);
            }
        }

        return null;
    }

    /**
     * @return list<string>
     */
    private function resolveUserInterests(int $tenantId, int $userId): array
    {
        $interests = [];

        if (Schema::hasTable('users') && Schema::hasColumn('users', 'skills')) {
            try {
                $row = DB::table('users')
                    ->where('id', $userId)
                    ->where('tenant_id', $tenantId)
                    ->first(['skills']);
                if ($row && isset($row->skills) && is_string($row->skills) && $row->skills !== '') {
                    foreach (explode(',', $row->skills) as $s) {
                        $s = trim($s);
                        if ($s !== '') {
                            $interests[] = mb_strtolower($s);
                        }
                    }
                }
            } catch (\Throwable $e) {
                Log::warning('CivicDigestService: failed to read users.skills for interests', [
                    'exception' => $e->getMessage(),
                    'tenant_id' => $tenantId,
                    'user_id' => $userId,
                ]);
            }
        }

        if (Schema::hasTable('user_skills')) {
            try {
                $rows = DB::table('user_skills')
                    ->where('user_id', $userId)
                    ->where('tenant_id', $tenantId)
                    ->limit(40)
                    ->get(['skill_name']);
                foreach ($rows as $r) {
                    if (isset($r->skill_name) && is_string($r->skill_name) && $r->skill_name !== '') {
                        $interests[] = mb_strtolower(trim($r->skill_name));
                    }
                }
            } catch (\Throwable $e) {
                Log::warning('CivicDigestService: failed to read user_skills for interests', [
                    'exception' => $e->getMessage(),
                    'tenant_id' => $tenantId,
                    'user_id' => $userId,
                ]);
            }
        }

        return array_values(array_unique(array_filter($interests, fn ($s) => $s !== '')));
    }

    /**
     * Score an item and return both the total score and a list of contributing
     * reasons (top factors with their weights). Reasons are sorted by weight
     * descending so the UI can show "top 2-3" easily.
     *
     * @param array<string, mixed> $item
     * @param list<string> $interests
     * @return array{score: int, reasons: list<array{key: string, label_key: string, weight: int}>}
     */
    private function scoreItemWithReasons(array $item, ?int $userSubRegionId, array $interests): array
    {
        $score = 0;
        $reasons = [];

        // Source weight — surfaces high-priority sources (safety/announcement/project)
        $source = (string) ($item['source'] ?? '');
        $sourceWeight = self::SOURCE_WEIGHTS[$source] ?? 0;
        if ($sourceWeight > 0) {
            $score += $sourceWeight;
            if ($source === 'safety_alert') {
                $reasons[] = [
                    'key'       => 'safety',
                    'label_key' => 'civic_digest.transparency.reason_safety',
                    'weight'    => $sourceWeight,
                ];
            } elseif ($source === 'announcement') {
                $reasons[] = [
                    'key'       => 'announcement',
                    'label_key' => 'civic_digest.transparency.reason_announcement',
                    'weight'    => $sourceWeight,
                ];
            } elseif ($source === 'project') {
                $reasons[] = [
                    'key'       => 'priority',
                    'label_key' => 'civic_digest.transparency.reason_priority',
                    'weight'    => $sourceWeight,
                ];
            }
        }

        // Recency boost (0..5 based on how recent within 30 days)
        $occurredAt = $item['occurred_at'] ?? null;
        if (is_string($occurredAt) && $occurredAt !== '') {
            $ts = strtotime($occurredAt);
            if ($ts !== false) {
                $ageDays = max(0, (time() - $ts) / 86400);
                if ($ageDays <= 30) {
                    $recencyBoost = (int) round(5 * (1 - ($ageDays / 30)));
                    if ($recencyBoost > 0) {
                        $score += $recencyBoost;
                        $reasons[] = [
                            'key'       => 'recency',
                            'label_key' => 'civic_digest.transparency.reason_recency',
                            'weight'    => $recencyBoost,
                        ];
                    }
                }
            }
        }

        // Sub-region match
        if ($userSubRegionId !== null
            && isset($item['sub_region_id'])
            && is_int($item['sub_region_id'])
            && $item['sub_region_id'] === $userSubRegionId
        ) {
            $score += 5;
            $reasons[] = [
                'key'       => 'sub_region_match',
                'label_key' => 'civic_digest.transparency.reason_sub_region',
                'weight'    => 5,
            ];
        }

        // Interest match
        if ($interests !== [] && isset($item['categories']) && is_array($item['categories']) && $item['categories'] !== []) {
            $itemCats = array_map(fn ($c) => is_string($c) ? mb_strtolower($c) : '', $item['categories']);
            $overlap = array_intersect($interests, $itemCats);
            if ($overlap !== []) {
                $score += 3;
                $reasons[] = [
                    'key'       => 'category_match',
                    'label_key' => 'civic_digest.transparency.reason_category_match',
                    'weight'    => 3,
                ];
            }
        }

        // Sort reasons by weight desc and keep top 3
        usort($reasons, static fn ($a, $b) => $b['weight'] <=> $a['weight']);
        $reasons = array_slice($reasons, 0, 3);

        return ['score' => $score, 'reasons' => $reasons];
    }

    /**
     * F-129: an event is digest-visible when it belongs to no group, or to an
     * active group that is public or that the viewer owns or actively belongs
     * to. Mirrors EventService::applyDiscoveryVisibility() for a non-admin
     * viewer (the digest is a member surface, so no admin widening).
     */
    private function applyEventGroupAudience(\Illuminate\Database\Query\Builder $query, int $tenantId, int $viewerId): void
    {
        $query->where(function ($visibility) use ($tenantId, $viewerId): void {
            $visibility->whereNull('events.group_id')
                ->orWhereExists(function ($group) use ($tenantId, $viewerId): void {
                    $group->selectRaw('1')
                        ->from('groups as digest_groups')
                        ->whereColumn('digest_groups.id', 'events.group_id')
                        ->where('digest_groups.tenant_id', $tenantId)
                        ->where('digest_groups.status', GroupStatus::Active->value)
                        ->where(function ($audience) use ($tenantId, $viewerId): void {
                            $audience->whereNull('digest_groups.visibility')
                                ->orWhere('digest_groups.visibility', 'public')
                                ->orWhere('digest_groups.owner_id', $viewerId)
                                ->orWhereExists(function ($membership) use ($tenantId, $viewerId): void {
                                    $membership->selectRaw('1')
                                        ->from('group_members as digest_group_members')
                                        ->whereColumn('digest_group_members.group_id', 'digest_groups.id')
                                        ->where('digest_group_members.tenant_id', $tenantId)
                                        ->where('digest_group_members.user_id', $viewerId)
                                        ->where('digest_group_members.status', 'active');
                                });
                        });
                });
        });
    }

    private function cutoff30Days(): string
    {
        return date('Y-m-d H:i:s', strtotime('-30 days'));
    }

    private function shorten(string $text, int $max = 240): string
    {
        $text = trim(strip_tags($text));
        if ($text === '') {
            return '';
        }
        if (mb_strlen($text) <= $max) {
            return $text;
        }
        return mb_substr($text, 0, $max - 1) . '…';
    }
}
