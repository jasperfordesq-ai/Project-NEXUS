<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

declare(strict_types=1);

namespace App\Services;

use App\Contracts\SearchDocumentIndexer;
use App\Support\UserDisplayName;
use Illuminate\Support\Facades\DB;

/**
 * Re-send one community's searchable entries to the search index.
 *
 * The five "select and index" loops of `scripts/sync_search_index.php`,
 * moved here (16 Nov 2026) so the platform team's "Rebuild search" job can run
 * them too. 🔴 The SQL, the row handling, the batch size and the per-row error
 * handling are the script's, unchanged: the script runs on every deployment
 * and is now a thin caller of this class. SearchReindexServiceTest pins the
 * rows against a verbatim copy of the old script's code.
 *
 * Every query is scoped by the community id passed in, exactly as the script
 * did. Nothing is removed from the index: entries for deleted things stay
 * until something removes them one by one.
 *
 * The caller sets the community context if it wants one (the script calls
 * TenantContext::setById() first, as it always did); this class does not.
 */
final class SearchReindexService
{
    /** Kinds of entry, in the order the script has always processed them. */
    public const TYPES = ['listing', 'user', 'event', 'group', 'marketplace'];

    /** Index name the script prints for each kind. */
    private const LABELS = [
        'listing' => 'listings',
        'user' => 'users',
        'event' => 'events',
        'group' => 'groups',
        'marketplace' => 'marketplace_listings',
    ];

    /** Kind name the script prints beside a row that failed. */
    private const ERROR_TYPES = [
        'listing' => 'listing',
        'user' => 'user',
        'event' => 'event',
        'group' => 'group',
        'marketplace' => 'marketplace_listing',
    ];

    private const BATCH = 100;

    private readonly SearchDocumentIndexer $indexer;

    public function __construct(?SearchDocumentIndexer $indexer = null)
    {
        $this->indexer = $indexer ?? new MeilisearchDocumentIndexer();
    }

    /**
     * @param string|null   $type     one of self::TYPES, or null for all five
     * @param bool          $dryRun   read and count only; send nothing
     * @param callable|null $progress fn(string $event, ...$args): events, in order:
     *                                'empty' (label) | 'start' (label, total) |
     *                                'batch' (label, done, total) |
     *                                'error' (script type name, row id, message) |
     *                                'done' (label, indexed, errors). A dry run
     *                                stops after 'start'.
     * @param int|null      $afterId    window mode: only rows whose id is above this
     * @param int|null      $limit      window mode: read at most this many rows per kind
     * @param callable|null $shouldStop window mode: fn(): bool, asked after each row
     *                                  but the window's last; true stops the kind
     *                                  there (so at least one row is always handled)
     * @return array<string, array{rows: int, indexed: int, errors: int, last_id?: int|null, finished?: bool}>
     *         keyed by the kinds processed. In window mode (any of the last
     *         three given) each kind also gives the id of the last row it
     *         handled (`last_id`, null if none) and whether that kind has no
     *         rows left after it (`finished`). Without them the statements
     *         and the result are the script's, unchanged.
     */
    public function reindexTenant(
        int $tenantId,
        ?string $type = null,
        bool $dryRun = false,
        ?callable $progress = null,
        ?int $afterId = null,
        ?int $limit = null,
        ?callable $shouldStop = null,
    ): array {
        if ($type !== null && !in_array($type, self::TYPES, true)) {
            throw new \InvalidArgumentException('Unknown search entry type: ' . $type);
        }

        $report = $progress ?? static function (): void {
        };
        $result = [];

        foreach (self::TYPES as $kind) {
            if ($type !== null && $type !== $kind) {
                continue;
            }
            if ($afterId === null && $limit === null && $shouldStop === null) {
                $result[$kind] = $this->indexRows($kind, $this->rows($kind, $tenantId), $dryRun, $report);
                continue;
            }
            $result[$kind] = $this->indexWindow($kind, $tenantId, max(0, (int) $afterId), $limit, $dryRun, $report, $shouldStop);
        }

        return $result;
    }

    /**
     * Same as the script's batchIndex(): one row at a time in batches of 100;
     * a row that throws is counted and the rest carry on.
     *
     * Window mode only: $shouldStop is asked before each row but the first;
     * when it says stop, the rows already handled are reported as the whole
     * and $handled says how many that was.
     *
     * @param list<array<string, mixed>> $rows
     * @return array{rows: int, indexed: int, errors: int}
     */
    private function indexRows(string $kind, array $rows, bool $dryRun, callable $report, ?callable $shouldStop = null, ?int &$handled = null): array
    {
        $label = self::LABELS[$kind];
        $total = count($rows);
        $handled = 0;

        if ($total === 0) {
            $report('empty', $label);

            return ['rows' => 0, 'indexed' => 0, 'errors' => 0];
        }

        $report('start', $label, $total);

        if ($dryRun) {
            $handled = $total;

            return ['rows' => $total, 'indexed' => 0, 'errors' => 0];
        }

        $indexed = 0;
        $errors = 0;

        foreach (array_chunk($rows, self::BATCH) as $batchIndex => $batch) {
            foreach ($batch as $row) {
                if ($handled > 0 && $shouldStop !== null && $shouldStop()) {
                    $report('done', $label, $indexed, $errors);

                    return ['rows' => $handled, 'indexed' => $indexed, 'errors' => $errors];
                }
                $handled++;
                try {
                    $this->indexer->index($kind, $row);
                    $indexed++;
                } catch (\Throwable $e) {
                    // A row the search server refused is a counted failure, not
                    // a silent success: the caller sees it in `errors`.
                    $report('error', self::ERROR_TYPES[$kind], $row['id'], $e->getMessage());
                    $errors++;
                }
            }

            $report('batch', $label, min(($batchIndex + 1) * self::BATCH, $total), $total);
        }

        $report('done', $label, $indexed, $errors);

        return ['rows' => $total, 'indexed' => $indexed, 'errors' => $errors];
    }

    /**
     * One window of one kind, for the platform team's rebuild, which runs as a
     * chain of short jobs: rows above $afterId, at most $limit of them, cut
     * short when $shouldStop says so. Row handling, per-row errors and
     * progress events are indexRows()'s.
     *
     * @return array{rows: int, indexed: int, errors: int, last_id: int|null, finished: bool}
     */
    private function indexWindow(string $kind, int $tenantId, int $afterId, ?int $limit, bool $dryRun, callable $report, ?callable $shouldStop): array
    {
        $limit = $limit !== null ? max(1, $limit) : null;
        $rows = $this->rows($kind, $tenantId, $afterId, $limit);
        $fetched = count($rows);

        // The stop is never asked before the first row, so a chain of windows
        // always moves on.
        $handled = 0;
        $counts = $this->indexRows($kind, $rows, $dryRun, $report, $shouldStop, $handled);
        $stopped = $handled < $fetched;

        return $counts + [
            'last_id' => $handled === 0 ? null : (int) $rows[$handled - 1]['id'],
            'finished' => !$stopped && ($limit === null || $fetched < $limit),
        ];
    }

    /** @return list<array<string, mixed>> */
    private function rows(string $kind, int $tenantId, ?int $afterId = null, ?int $limit = null): array
    {
        return match ($kind) {
            'listing' => $this->listingRows($tenantId, $afterId, $limit),
            'user' => $this->userRows($tenantId, $afterId, $limit),
            'event' => $this->eventRows($tenantId, $afterId, $limit),
            'group' => $this->groupRows($tenantId, $afterId, $limit),
            'marketplace' => $this->marketplaceRows($tenantId, $afterId, $limit),
        };
    }

    /**
     * Window mode only: "AND <id column> > ?" for the WHERE, " LIMIT n" for the
     * end, and the extra binding. All empty when no window is asked for, so
     * the script's statements go out exactly as before.
     *
     * @return array{0: string, 1: string, 2: list<int>}
     */
    private function window(string $idColumn, ?int $afterId, ?int $limit): array
    {
        $where = $afterId !== null ? "\n           AND {$idColumn} > ?" : '';
        $bindings = $afterId !== null ? [$afterId] : [];
        $tail = $limit !== null ? "\n         LIMIT " . max(1, $limit) : '';

        return [$where, $tail, $bindings];
    }

    /** All active listings. @return list<array<string, mixed>> */
    private function listingRows(int $tenantId, ?int $afterId = null, ?int $limit = null): array
    {
        [$after, $tail, $extra] = $this->window('l.id', $afterId, $limit);
        $rows = array_map(fn($r) => (array) $r, DB::select(
            "SELECT l.id, l.tenant_id, l.user_id, l.category_id, l.type,
                l.title, l.description, l.location, l.status,
                UNIX_TIMESTAMP(l.created_at) as created_at,
                " . UserDisplayName::sql('u', 'author_name') . ",
                COALESCE(c.name, '') as category_name,
                GROUP_CONCAT(lst.tag ORDER BY lst.tag SEPARATOR ',') as skill_tags_csv
         FROM listings l
         LEFT JOIN users u ON l.user_id = u.id
         LEFT JOIN categories c ON c.id = l.category_id
         LEFT JOIN listing_skill_tags lst ON lst.listing_id = l.id
         WHERE l.tenant_id = ? AND l.status = 'active'{$after}
         GROUP BY l.id, l.tenant_id, l.user_id, l.category_id, l.type,
                  l.title, l.description, l.location, l.status, l.created_at,
                  u.first_name, u.last_name, c.name
         ORDER BY l.id{$tail}",
            [$tenantId, ...$extra]
        ));

        // Convert skill_tags_csv string to array for Meilisearch
        return array_map(function (array $row): array {
            $row['skill_tags'] = array_values(array_filter(explode(',', $row['skill_tags_csv'] ?? '')));
            unset($row['skill_tags_csv']);
            return $row;
        }, $rows);
    }

    /** All active members. @return list<array<string, mixed>> */
    private function userRows(int $tenantId, ?int $afterId = null, ?int $limit = null): array
    {
        [$after, $tail, $extra] = $this->window('id', $afterId, $limit);

        return array_map(fn($r) => (array) $r, DB::select(
            "SELECT id, tenant_id, first_name, last_name, organization_name,
                profile_type, bio, skills, location, avatar_url, status,
                UNIX_TIMESTAMP(created_at) as created_at
         FROM users
         WHERE tenant_id = ? AND status = 'active'{$after}
         ORDER BY id{$tail}",
            [$tenantId, ...$extra]
        ));
    }

    /** All upcoming events. @return list<array<string, mixed>> */
    private function eventRows(int $tenantId, ?int $afterId = null, ?int $limit = null): array
    {
        [$after, $tail, $extra] = $this->window('e.id', $afterId, $limit);

        return array_map(fn($r) => (array) $r, DB::select(
            "SELECT e.id, e.tenant_id, e.title, e.description, e.location,
                COALESCE(e.status, 'active') as status,
                e.publication_status,
                e.operational_status,
                e.is_recurring_template,
                e.allow_remote_attendance as is_online,
                UNIX_TIMESTAMP(COALESCE(e.start_time, e.start_date)) as start_time,
                UNIX_TIMESTAMP(e.created_at) as created_at,
                " . UserDisplayName::sql('u', 'organizer_name') . "
         FROM events e
         LEFT JOIN users u ON e.user_id = u.id AND e.tenant_id = u.tenant_id
         WHERE e.tenant_id = ?
           AND COALESCE(e.start_time, e.start_date) >= NOW()
           AND COALESCE(e.is_recurring_template, 0) = 0
           AND (
               (
                   COALESCE(e.status, 'active') = 'active'
                   AND (e.publication_status IS NULL OR e.publication_status = 'published')
                   AND (e.operational_status IS NULL OR e.operational_status = 'scheduled')
               )
               OR (
                   e.status = 'cancelled'
                   AND (e.publication_status IS NULL OR e.publication_status = 'published')
                   AND e.operational_status = 'postponed'
               )
           ){$after}
         ORDER BY e.id{$tail}",
            [$tenantId, ...$extra]
        ));
    }

    /** All active groups. @return list<array<string, mixed>> */
    private function groupRows(int $tenantId, ?int $afterId = null, ?int $limit = null): array
    {
        [$after, $tail, $extra] = $this->window('g.id', $afterId, $limit);

        return array_map(fn($r) => (array) $r, DB::select(
            "SELECT g.id, g.tenant_id, g.name, g.description,
                IF(g.is_active, 'active', 'inactive') as status,
                g.visibility as privacy,
                COALESCE(g.cached_member_count, 0) as members_count,
                UNIX_TIMESTAMP(g.created_at) as created_at
         FROM `groups` g
         WHERE g.tenant_id = ? AND g.is_active = 1{$after}
         ORDER BY g.id{$tail}",
            [$tenantId, ...$extra]
        ));
    }

    /** All active, approved marketplace listings. @return list<array<string, mixed>> */
    private function marketplaceRows(int $tenantId, ?int $afterId = null, ?int $limit = null): array
    {
        [$after, $tail, $extra] = $this->window('ml.id', $afterId, $limit);
        $rows = array_map(fn($r) => (array) $r, DB::select(
            "SELECT ml.id, ml.tenant_id, ml.category_id,
                ml.title, ml.description, ml.tagline, ml.location,
                ml.price, ml.price_type, ml.`condition`, ml.seller_type,
                ml.delivery_method, ml.status, ml.moderation_status,
                UNIX_TIMESTAMP(ml.created_at) as created_at
         FROM marketplace_listings ml
         WHERE ml.tenant_id = ?
           AND ml.status = 'active'
           AND ml.moderation_status = 'approved'{$after}
         ORDER BY ml.id{$tail}",
            [$tenantId, ...$extra]
        ));

        // Ensure numeric types for Meilisearch filterable attributes
        return array_map(function (array $row): array {
            $row['price'] = (float) ($row['price'] ?? 0);
            $row['category_id'] = $row['category_id'] ? (int) $row['category_id'] : null;
            return $row;
        }, $rows);
    }
}
