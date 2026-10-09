<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

declare(strict_types=1);

namespace App\Http\Controllers\Api;

use App\Models\ActivityLog;
use App\Services\AuditLogService;
use App\Services\MemberImport\InvitationOutbox;
use Illuminate\Http\JsonResponse;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Str;

/**
 * Welcome invitations from the admin member list (design:
 * .local-docs-archive/member-import-export/): "Send invitation" for the
 * selected members, and "Invite everyone who has never signed in". Both only
 * QUEUE rows in the invitation outbox; the scheduled sender emails them at a
 * steady pace and re-checks every member at send time.
 *
 * Admin only (route group and requireAdmin()): brokers do not invite in bulk.
 * Staff accounts are never bulk-invited — the outbox reports them as
 * `not_member`. Rate limits are per administrator, here rather than on the
 * route, for the reason AdminMemberImportController gives.
 */
class AdminMemberInvitationController extends BaseApiController
{
    protected bool $isV2Api = true;

    public const SELECTED_PER_MINUTE = 10;
    public const EVERYONE_PER_MINUTE = 5;
    public const COUNT_PER_MINUTE = 30;

    /** The same limit as the other member-list bulk actions. */
    private const BULK_MAX = 100;

    public const AUDIT_ACTION = 'member_invitations_queued';

    public function __construct(
        private readonly InvitationOutbox $outbox,
        private readonly AuditLogService $audit,
    ) {
    }

    /** POST /api/v2/admin/members/invitations — {user_ids: int[1..100]} */
    public function sendSelected(): JsonResponse
    {
        $adminId = $this->requireAdmin();
        $tenantId = $this->getTenantId();
        $this->rateLimit('admin_member_invitations', self::SELECTED_PER_MINUTE, 60);

        [$ids, $err] = $this->parseBulkIds('user_ids');
        if ($err !== null) {
            return $err;
        }

        $result = $this->outbox->enqueue($tenantId, $ids, InvitationOutbox::SOURCE_ADMIN_BULK, (string) Str::uuid(), $adminId);
        $this->record($tenantId, $adminId, 'selected', $result['queued'], $result['skipped']);

        return $this->respondWithData($result);
    }

    /** GET /api/v2/admin/members/invitations/never-signed-in-count */
    public function neverSignedInCount(): JsonResponse
    {
        $this->requireAdmin();
        $tenantId = $this->getTenantId();
        $this->rateLimit('admin_member_invitations_count', self::COUNT_PER_MINUTE, 60);

        $eligible = count($this->outbox->eligibility($tenantId, $this->neverSignedInCandidates($tenantId))['eligible']);
        $pending = $this->outbox->pendingCount($tenantId);

        return $this->respondWithData([
            'eligible' => $eligible,
            'pending' => $pending,
            // This community's queue, these members included. Other communities
            // share the sender's pace, so the real wait can be a little longer.
            'eta_minutes' => InvitationOutbox::minutesToSend($eligible + $pending),
        ]);
    }

    /**
     * POST /api/v2/admin/members/invitations/never-signed-in — {confirm_count}
     *
     * The admin confirms the number they were shown. If it is no longer the
     * number that would be queued (someone joined, signed in or was invited
     * meanwhile), nothing is queued and the browser asks again with the new one.
     */
    public function inviteEveryone(): JsonResponse
    {
        $adminId = $this->requireAdmin();
        $tenantId = $this->getTenantId();
        $this->rateLimit('admin_member_invitations_everyone', self::EVERYONE_PER_MINUTE, 60);

        $raw = request()->input('confirm_count');
        $confirm = is_int($raw) || is_string($raw)
            ? filter_var($raw, FILTER_VALIDATE_INT, ['options' => ['min_range' => 0]])
            : false;
        if ($confirm === false) {
            return $this->respondWithError('VALIDATION_ERROR', __('api.validation_failed'), 'confirm_count', 422);
        }

        $check = $this->outbox->eligibility($tenantId, $this->neverSignedInCandidates($tenantId));
        if (count($check['eligible']) !== $confirm) {
            return $this->respondWithError('COUNT_CHANGED', __('api.member_invitations_count_changed'), 'confirm_count', 409);
        }

        // enqueue() checks the eligible members again (in chunks) and reports
        // anyone who stopped being eligible in between; add the members already
        // ruled out above so the reasons cover everyone who never signed in.
        $result = $check['eligible'] === []
            ? ['queued' => 0, 'skipped' => array_fill_keys(InvitationOutbox::SKIP_REASONS, 0), 'eta_minutes' => 0]
            : $this->outbox->enqueue($tenantId, $check['eligible'], InvitationOutbox::SOURCE_ADMIN_BULK, (string) Str::uuid(), $adminId);
        foreach ($check['skipped'] as $reason => $ids) {
            $result['skipped'][$reason] = ($result['skipped'][$reason] ?? 0) + count($ids);
        }
        $this->record($tenantId, $adminId, 'never_signed_in', $result['queued'], $result['skipped']);

        return $this->respondWithData($result);
    }

    /**
     * Plain, active, approved members of this community who have never signed
     * in. eligibility() applies the full rules (staff flags, suppression,
     * already queued, invited in the last 24 hours) to this list.
     *
     * @return list<int>
     */
    private function neverSignedInCandidates(int $tenantId): array
    {
        return DB::table('users')
            ->where('tenant_id', $tenantId)
            ->where('role', 'member')
            ->where('status', 'active')
            ->where('is_approved', 1)
            ->whereNull('last_login_at')
            ->orderBy('id')
            ->pluck('id')
            ->map(static fn ($id): int => (int) $id)
            ->all();
    }

    /**
     * One activity-log line and one audit entry per request, with counts only
     * (no member ids or addresses).
     *
     * @param array<string, int> $skipped
     */
    private function record(int $tenantId, int $adminId, string $source, int $queued, array $skipped): void
    {
        $skipped = array_filter($skipped, static fn (int $n): bool => $n > 0);
        $skippedTotal = array_sum($skipped);

        ActivityLog::log(
            $adminId,
            'admin_member_invitations_queued',
            "Queued {$queued} welcome invitations ({$source}); skipped {$skippedTotal}"
        );
        $this->audit->logAction($tenantId, self::AUDIT_ACTION, $adminId, [
            'source' => $source,
            'queued' => $queued,
            'skipped' => $skipped,
        ]);
    }

    /**
     * The member-list bulk-action id rules, as AdminUsersController::parseBulkIds():
     * a non-empty array, positive whole numbers, duplicates collapsed, at most
     * BULK_MAX distinct ids.
     *
     * @return array{0: list<int>, 1: null}|array{0: null, 1: JsonResponse}
     */
    private function parseBulkIds(string $field): array
    {
        $raw = $this->input($field, []);
        $ids = [];
        if (is_array($raw)) {
            foreach ($raw as $v) {
                $id = (int) $v;
                if ($id > 0) {
                    $ids[$id] = true;
                }
            }
        }
        $ids = array_keys($ids);
        if ($ids === []) {
            return [null, $this->respondWithError('VALIDATION_FAILED', __('api.bulk_ids_required'), $field, 422)];
        }
        if (count($ids) > self::BULK_MAX) {
            return [null, $this->respondWithError('VALIDATION_FAILED', __('api.bulk_too_many', ['max' => self::BULK_MAX]), $field, 422)];
        }

        return [$ids, null];
    }
}
