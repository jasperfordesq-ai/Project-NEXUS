<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

declare(strict_types=1);

namespace App\Services\PlatformTeam;

use App\Contracts\SearchDocumentIndexer;
use App\Core\ClientIp;
use App\Services\MeilisearchDocumentIndexer;
use Illuminate\Support\Facades\Cache;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Log;

/**
 * Platform team panel → Rebuild search (idea 31): the page's list, and the
 * record of each community's last rebuild started from it.
 *
 * The record lives in the cache under `search_rebuild:<community id>` for 7
 * days: state (queued | running | done | failed), started_at, finished_at,
 * counts per kind, errors, and an internal `updated_at` the job refreshes as
 * it goes. A waiting or running record that has not been refreshed for 30
 * minutes no longer blocks a new start and is shown as failed: the job
 * stopped reporting (a worker was stopped, the server restarted).
 *
 * 🔴 Cross-community on purpose: the list covers every community, read with
 * the query builder (no community scope). It sends each community's id, name,
 * slug and whether it is switched on, nothing about any member.
 */
final class SearchRebuildService
{
    public const STALE_AFTER_MINUTES = 30;

    public const KEEP_DAYS = 7;

    private readonly SearchDocumentIndexer $indexer;

    /** No container binding: a test binds a fake, everything else gets the real one. */
    public function __construct(?SearchDocumentIndexer $indexer = null)
    {
        $this->indexer = $indexer ?? new MeilisearchDocumentIndexer();
    }

    public static function cacheKey(int $tenantId): string
    {
        return 'search_rebuild:' . $tenantId;
    }

    /** @return array{search_available: bool, communities: list<array<string, mixed>>} */
    public function overview(): array
    {
        $communities = DB::table('tenants')
            ->select(['id', 'name', 'slug', 'is_active'])
            ->orderBy('id')
            ->get()
            ->map(fn (object $t): array => [
                'id' => (int) $t->id,
                'name' => (string) $t->name,
                'slug' => (string) $t->slug,
                'is_active' => (bool) $t->is_active,
                'last' => $this->lastFor((int) $t->id),
            ])
            ->all();

        return [
            'search_available' => $this->indexer->reachable(),
            'communities' => $communities,
        ];
    }

    public function reachable(): bool
    {
        return $this->indexer->reachable();
    }

    public function communityExists(int $tenantId): bool
    {
        return $tenantId > 0 && DB::table('tenants')->where('id', $tenantId)->exists();
    }

    /** Is a rebuild for this community waiting or running, and still reporting? */
    public function isBusy(int $tenantId): bool
    {
        $state = $this->read($tenantId);

        return $state !== null
            && in_array($state['state'] ?? null, ['queued', 'running'], true)
            && !$this->isStale($state);
    }

    public function markQueued(int $tenantId): void
    {
        $this->write($tenantId, [
            'state' => 'queued',
            'started_at' => null,
            'finished_at' => null,
            'counts' => null,
            'errors' => 0,
        ]);
    }

    /** @return array<string, mixed>|null */
    public function read(int $tenantId): ?array
    {
        $state = Cache::get(self::cacheKey($tenantId));

        return is_array($state) ? $state : null;
    }

    /** @param array<string, mixed> $state */
    public function write(int $tenantId, array $state): void
    {
        $state['updated_at'] = now()->toIso8601String();
        Cache::put(self::cacheKey($tenantId), $state, now()->addDays(self::KEEP_DAYS));
    }

    /** @param array<string, mixed> $state */
    public function isStale(array $state): bool
    {
        $updated = isset($state['updated_at']) ? strtotime((string) $state['updated_at']) : false;

        return $updated === false || $updated < now()->subMinutes(self::STALE_AFTER_MINUTES)->getTimestamp();
    }

    /**
     * Who started a rebuild, for which community. Platform-wide act, so the
     * row is written here with tenant_id NULL (ActivityLog::log() would stamp
     * the caller's own community). The community is the entity.
     */
    public function record(int $actorId, int $tenantId): void
    {
        try {
            DB::table('activity_log')->insert([
                'tenant_id' => null,
                'user_id' => $actorId > 0 ? $actorId : null,
                'action' => 'platform_team_search_rebuild',
                'details' => "Search rebuild for community #{$tenantId}",
                'is_public' => 0,
                'ip_address' => ClientIp::get(),
                'action_type' => 'admin',
                'entity_type' => 'tenant',
                'entity_id' => $tenantId,
                'created_at' => now(),
            ]);
        } catch (\Throwable $e) {
            Log::error('Search rebuild: the activity log entry could not be written', [
                'tenant_id' => $tenantId,
                'user_id' => $actorId,
                'exception' => $e::class,
                'message' => $e->getMessage(),
            ]);
        }
    }

    /** @return array{state: string, started_at: ?string, finished_at: ?string, counts: ?array, errors: int}|null */
    private function lastFor(int $tenantId): ?array
    {
        $state = $this->read($tenantId);
        if ($state === null) {
            return null;
        }

        $current = (string) ($state['state'] ?? 'failed');
        if (in_array($current, ['queued', 'running'], true) && $this->isStale($state)) {
            $current = 'failed';
        }
        if (!in_array($current, ['queued', 'running', 'done', 'failed'], true)) {
            $current = 'failed';
        }

        return [
            'state' => $current,
            'started_at' => $state['started_at'] ?? null,
            'finished_at' => $state['finished_at'] ?? null,
            'counts' => is_array($state['counts'] ?? null) ? $state['counts'] : null,
            'errors' => (int) ($state['errors'] ?? 0),
        ];
    }
}
