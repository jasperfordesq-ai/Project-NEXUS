<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

namespace App\Console\Commands;

use Illuminate\Console\Command;
use Illuminate\Support\Facades\DB;
use App\Core\TenantContext;
use App\Enums\GroupStatus;
use App\Services\GroupLifecycleService;

/**
 * Undo group status changes made by the automatic inactivity sweep.
 *
 * Written for the 2026-07-13 defect, where the sweep judged activity from
 * discussion threads alone and demoted 431 of one tenant's 434 groups in a
 * single run, including every geographic hub group the community is organised
 * around. GroupLifecycleService now refuses a sweep that size, but the rows it
 * already wrote have to be put back deliberately.
 *
 * Restores each group to the status it held BEFORE its first automatic change,
 * read from group_audit_log. Deliberately conservative:
 *
 *  - a group whose status was changed by anything other than the automatic
 *    sweep since is skipped, because that later change is somebody's decision
 *  - a group that no longer holds the status the sweep set is skipped, for the
 *    same reason
 *  - dry run is the default; writing requires --apply
 *
 * Not scheduled. Run by hand, per tenant.
 */
class RestoreAutoArchivedGroupsCommand extends Command
{
    protected $signature = 'groups:restore-auto-archived
        {--tenant= : Tenant ID to restore (required)}
        {--apply : Write the changes. Without this the command only reports.}
        {--limit=0 : Stop after this many groups (0 = no limit)}';

    protected $description = 'Undo status changes made by the automatic group inactivity sweep';

    /** Reason recorded against every restore, so a restore is never mistaken for a sweep. */
    private const RESTORE_REASON = 'Restore after automatic inactivity sweep defect';

    /** Audit reasons written by the automatic sweep. */
    private const AUTO_REASON_PREFIX = 'Automatic inactivity';

    public function handle(): int
    {
        $tenantId = (int) $this->option('tenant');
        if ($tenantId <= 0) {
            $this->error('--tenant is required. This command never runs platform-wide.');

            return Command::FAILURE;
        }

        $apply = (bool) $this->option('apply');
        $limit = (int) $this->option('limit');

        TenantContext::setById($tenantId);

        $candidates = $this->candidates($tenantId);
        if ($candidates === []) {
            $this->info("Tenant {$tenantId}: nothing to restore.");

            return Command::SUCCESS;
        }

        $restorable = [];
        $skipped = [];

        foreach ($candidates as $row) {
            $current = (string) $row->current_status;
            $setBySweep = (string) $row->sweep_set_status;
            $restoreTo = (string) $row->restore_to;

            if ($current !== $setBySweep) {
                $skipped[] = [$row->id, $row->name, $current, 'status changed since the sweep'];
                continue;
            }

            if ($row->manual_change_since > 0) {
                $skipped[] = [$row->id, $row->name, $current, 'a later change was made by hand'];
                continue;
            }

            if ($current === $restoreTo) {
                continue;
            }

            $restorable[] = [$row->id, $row->name, $current, $restoreTo];
        }

        if ($limit > 0 && count($restorable) > $limit) {
            $restorable = array_slice($restorable, 0, $limit);
        }

        $this->table(
            ['Group', 'Name', 'Now', 'Restore to'],
            array_map(static fn (array $r): array => [$r[0], mb_strimwidth((string) $r[1], 0, 40, '…'), $r[2], $r[3]], $restorable),
        );

        if ($skipped !== []) {
            $this->newLine();
            $this->warn('Left alone (' . count($skipped) . '):');
            $this->table(['Group', 'Name', 'Now', 'Why'], array_map(
                static fn (array $r): array => [$r[0], mb_strimwidth((string) $r[1], 0, 40, '…'), $r[2], $r[3]],
                $skipped,
            ));
        }

        $this->newLine();
        $this->info('Tenant ' . $tenantId . ': ' . count($restorable) . ' to restore, ' . count($skipped) . ' left alone.');

        if (! $apply) {
            $this->warn('Dry run — nothing was written. Re-run with --apply to make these changes.');

            return Command::SUCCESS;
        }

        $restored = 0;
        $failed = [];

        foreach ($restorable as [$groupId, $name, $current, $restoreTo]) {
            $ownerId = (int) DB::table('groups')
                ->where('tenant_id', $tenantId)
                ->where('id', $groupId)
                ->value('owner_id');

            if (GroupLifecycleService::transition((int) $groupId, $restoreTo, $ownerId, self::RESTORE_REASON)) {
                $restored++;
                continue;
            }

            $failed[] = $groupId;
        }

        $this->info("Tenant {$tenantId}: restored {$restored} group(s).");

        if ($failed !== []) {
            $this->error('Refused by the lifecycle rules (unchanged): ' . implode(', ', $failed));

            return Command::FAILURE;
        }

        return Command::SUCCESS;
    }

    /**
     * Groups this tenant's automatic sweep touched, with the status they held
     * before it ran and the status it left them in.
     *
     * @return list<object>
     */
    private function candidates(int $tenantId): array
    {
        $auto = self::AUTO_REASON_PREFIX . '%';

        return DB::table('groups as g')
            ->join('group_audit_log as first_auto', function ($join) use ($auto): void {
                $join->on('first_auto.group_id', '=', 'g.id')
                    ->on('first_auto.tenant_id', '=', 'g.tenant_id')
                    ->where('first_auto.action', '=', 'group_status_changed')
                    ->whereRaw("JSON_UNQUOTE(JSON_EXTRACT(first_auto.details, '$.reason')) LIKE ?", [$auto]);
            })
            ->where('g.tenant_id', $tenantId)
            ->whereRaw("first_auto.id = (
                SELECT MIN(a2.id) FROM group_audit_log a2
                WHERE a2.group_id = g.id AND a2.tenant_id = g.tenant_id
                  AND a2.action = 'group_status_changed'
                  AND JSON_UNQUOTE(JSON_EXTRACT(a2.details, '$.reason')) LIKE ?
            )", [$auto])
            ->selectRaw("g.id, g.name, g.status as current_status,
                JSON_UNQUOTE(JSON_EXTRACT(first_auto.details, '$.old_status')) as restore_to,
                (SELECT JSON_UNQUOTE(JSON_EXTRACT(a3.details, '$.new_status'))
                   FROM group_audit_log a3
                  WHERE a3.group_id = g.id AND a3.tenant_id = g.tenant_id
                    AND a3.action = 'group_status_changed'
                    AND JSON_UNQUOTE(JSON_EXTRACT(a3.details, '$.reason')) LIKE ?
                  ORDER BY a3.id DESC LIMIT 1) as sweep_set_status,
                (SELECT COUNT(*) FROM group_audit_log a4
                  WHERE a4.group_id = g.id AND a4.tenant_id = g.tenant_id
                    AND a4.action = 'group_status_changed'
                    AND a4.id > first_auto.id
                    AND (JSON_UNQUOTE(JSON_EXTRACT(a4.details, '$.reason')) NOT LIKE ?
                         OR JSON_EXTRACT(a4.details, '$.reason') IS NULL)) as manual_change_since", [$auto, $auto])
            ->orderBy('g.id')
            ->get()
            ->filter(static fn (object $row): bool => in_array((string) $row->restore_to, GroupStatus::values(), true))
            ->values()
            ->all();
    }
}
