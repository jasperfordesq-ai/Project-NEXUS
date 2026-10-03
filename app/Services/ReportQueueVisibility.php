<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

namespace App\Services;

use App\Support\FeedItemTables;
use Illuminate\Support\Facades\DB;

/**
 * Which member reports a broker or coordinator may see and handle.
 *
 * One rule, used by the report queue (AdminReportsController), its detail and
 * close routes, and the broker dashboard's open-reports count — so the queue's
 * rows, its total and the dashboard number can never disagree (F-549).
 *
 * A caller below admin tier is kept away from any report they have a personal
 * stake in: one they filed, one about them, or one about content they own (for
 * a review, the member it is about too). If the content's owner cannot be
 * established — the row was removed, or the type is not resolvable — only an
 * admin may handle it, or its former owner could remove it and bury the
 * complaint (F-218 for closing, F-454 for reading). Admin tiers are exempt;
 * callers decide that with `callerIsAdminTier()` before asking here.
 */
final class ReportQueueVisibility
{
    /**
     * Members with a personal stake in a report.
     *
     * @param array<string, array<string, mixed>>|null $targets Result of
     *        ReportTargetResolver::resolveMany() for a batch that includes this
     *        report; resolved here when not supplied.
     * @return list<int>|null Null when content ownership cannot be established.
     */
    public function parties(object $report, ?array $targets = null): ?array
    {
        $parties = [(int) $report->reporter_id];
        $type = $report->target_type ?? null;
        $targetId = (int) ($report->target_id ?? 0);

        if ($type === 'user') {
            $parties[] = $targetId;
            return $parties;
        }

        $targets ??= ReportTargetResolver::resolveMany([$report]);
        $authorId = $targets["{$type}:{$targetId}"]['target_author_id'] ?? null;
        if ($authorId === null && $targetId > 0 && is_string($type)) {
            // The report API accepts every reactable feed item, while the
            // display resolver covers only a subset. Resolve ownership for
            // the remaining types before a broker can see or close the report.
            $ownerColumn = match ($type) {
                'volunteer' => 'created_by',
                'blog' => 'author_id',
                'goal', 'poll', 'challenge', 'resource', 'job', 'discussion' => 'user_id',
                default => null,
            };
            $table = FeedItemTables::TABLES[$type] ?? null;
            if ($ownerColumn !== null && $table !== null) {
                $authorId = DB::table($table)
                    ->where('id', $targetId)
                    ->where('tenant_id', (int) $report->tenant_id)
                    ->value($ownerColumn);
            }
        }
        if ($authorId === null) {
            return null;
        }
        $parties[] = (int) $authorId;

        if ($type === 'review' && $targetId > 0) {
            $receiverId = DB::table('reviews')
                ->where('id', $targetId)
                ->where('tenant_id', (int) $report->tenant_id)
                ->value('receiver_id');
            if ($receiverId !== null) {
                $parties[] = (int) $receiverId;
            }
        }

        return $parties;
    }

    /** Whether a caller below admin tier may see and handle this report. */
    public function brokerMayHandle(object $report, int $callerId, ?array $targets = null): bool
    {
        $parties = $this->parties($report, $targets);

        return $parties !== null && !in_array($callerId, $parties, true);
    }

    /**
     * The reports a caller below admin tier may handle, from a batch, in order.
     *
     * @param list<object> $reports Rows carrying at least id, tenant_id,
     *        reporter_id, target_type and target_id.
     * @return list<object>
     */
    public function filterForBroker(array $reports, int $callerId): array
    {
        if ($reports === []) {
            return [];
        }
        $targets = ReportTargetResolver::resolveMany($reports);

        return array_values(array_filter(
            $reports,
            fn (object $report) => $this->brokerMayHandle($report, $callerId, $targets),
        ));
    }
}
