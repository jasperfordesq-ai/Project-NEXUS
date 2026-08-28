<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

namespace App\Http\Controllers\Api;

use App\Events\VolLogStatusChanged;
use App\Events\VolunteerOrganisationStatusChanged;
use App\Services\VolunteerService;
use App\Services\VolunteerReminderService;
use Illuminate\Http\JsonResponse;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Log;
use Illuminate\Support\Facades\Schema;
use App\Core\TenantContext;
use App\I18n\LocaleContext;
use App\Models\Notification;
use App\Services\NotificationDispatcher;

/**
 * AdminVolunteerController -- Admin volunteer management.
 *
 * Converted from legacy delegation to direct DB/service calls.
 */
class AdminVolunteerController extends BaseApiController
{
    protected bool $isV2Api = true;

    public function __construct(
        private readonly VolunteerService $volunteerService,
        private readonly VolunteerReminderService $volunteerReminderService,
    ) {}

    private const ALLOWED_TABLES = [
        'vol_opportunities', 'vol_applications', 'vol_shifts', 'vol_shift_signups',
        'vol_organizations', 'vol_logs', 'vol_shift_checkins', 'vol_mood_checkins',
        'vol_emergency_alerts', 'vol_org_transactions',
    ];

    private function tableExists(string $table): bool
    {
        if (!in_array($table, self::ALLOWED_TABLES, true)) {
            return false;
        }
        return Schema::hasTable($table);
    }

    private function columnExists(string $table, string $column): bool
    {
        $allowed = ['vol_opportunities' => ['created_by', 'user_id', 'is_active', 'status', 'title', 'created_at', 'tenant_id']];
        if (!isset($allowed[$table]) || !in_array($column, $allowed[$table], true)) {
            return false;
        }
        try {
            $result = DB::selectOne(
                "SELECT COUNT(*) as cnt FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ? AND COLUMN_NAME = ?",
                [$table, $column]
            );
            return ((int)($result->cnt ?? 0)) > 0;
        } catch (\Throwable $e) {
            return false;
        }
    }

    private function getOpportunityAuthorColumn(): ?string
    {
        if ($this->columnExists('vol_opportunities', 'created_by')) return 'created_by';
        if ($this->columnExists('vol_opportunities', 'user_id')) return 'user_id';
        return null;
    }

    /** GET /api/v2/admin/volunteering/opportunities */
    public function opportunities(): JsonResponse
    {
        $this->requireAdmin();
        if (!TenantContext::hasFeature('volunteering')) {
            return $this->respondWithError('FEATURE_DISABLED', __('api.service_unavailable'), null, 403);
        }
        $tenantId = $this->getTenantId();

        $perPage = $this->queryInt('per_page', 20, 1, 50);
        $search = $this->query('search');
        $status = $this->query('status');
        $cursor = $this->query('cursor');

        if (!$this->tableExists('vol_opportunities')) {
            return $this->respondWithCollection([], null, $perPage, false);
        }

        try {
            $sql = "SELECT opp.*, org.name as org_name, org.logo_url as org_logo,
                           org.status as org_status, cat.name as category_name
                    FROM vol_opportunities opp
                    LEFT JOIN vol_organizations org ON opp.organization_id = org.id AND org.tenant_id = ?
                    LEFT JOIN categories cat ON opp.category_id = cat.id
                    WHERE opp.tenant_id = ?";
            $params = [$tenantId, $tenantId];

            if ($status && in_array($status, ['open', 'active', 'closed', 'draft'], true)) {
                $sql .= " AND opp.status = ?";
                $params[] = $status;
            }

            if ($search) {
                $escapedSearch = addcslashes($search, '%_');
                $searchTerm = '%' . $escapedSearch . '%';
                $sql .= " AND (opp.title LIKE ? OR opp.description LIKE ?)";
                $params[] = $searchTerm;
                $params[] = $searchTerm;
            }

            if ($cursor) {
                $decoded = base64_decode($cursor, true);
                if ($decoded && is_numeric($decoded)) {
                    $sql .= " AND opp.id < ?";
                    $params[] = (int) $decoded;
                }
            }

            $sql .= " ORDER BY opp.created_at DESC, opp.id DESC LIMIT ?";
            $params[] = $perPage + 1;

            $results = DB::select($sql, $params);
            $rows = array_map(fn($r) => (array)$r, $results);

            $hasMore = count($rows) > $perPage;
            if ($hasMore) {
                array_pop($rows);
            }

            $nextCursor = null;
            if ($hasMore && !empty($rows)) {
                $lastRow = end($rows);
                $nextCursor = base64_encode((string) $lastRow['id']);
            }

            return $this->respondWithCollection($rows, $nextCursor, $perPage, $hasMore);
        } catch (\Exception $e) {
            return $this->respondWithCollection([], null, $perPage, false);
        }
    }

    /** GET /api/v2/admin/volunteering/applications */
    public function applications(): JsonResponse
    {
        $this->requireAdmin();
        if (!TenantContext::hasFeature('volunteering')) {
            return $this->respondWithError('FEATURE_DISABLED', __('api.service_unavailable'), null, 403);
        }
        $tenantId = $this->getTenantId();

        $perPage = $this->queryInt('per_page', 20, 1, 50);
        $status = $this->query('status');
        $cursor = $this->query('cursor');

        if (!$this->tableExists('vol_applications')) {
            return $this->respondWithCollection([], null, $perPage, false);
        }

        try {
            $sql = "SELECT a.*, u.first_name, u.last_name, u.email as user_email, u.avatar_url as user_avatar,
                           vo.title as opportunity_title
                    FROM vol_applications a
                    INNER JOIN vol_opportunities vo ON a.opportunity_id = vo.id
                    LEFT JOIN users u ON a.user_id = u.id AND u.tenant_id = ?
                    WHERE vo.tenant_id = ? AND a.tenant_id = ?";
            $params = [$tenantId, $tenantId, $tenantId];

            if ($status && in_array($status, ['pending', 'approved', 'declined', 'withdrawn'], true)) {
                $sql .= " AND a.status = ?";
                $params[] = $status;
            }

            if ($cursor) {
                $decoded = base64_decode($cursor, true);
                if ($decoded && is_numeric($decoded)) {
                    $sql .= " AND a.id < ?";
                    $params[] = (int) $decoded;
                }
            }

            $sql .= " ORDER BY a.created_at DESC, a.id DESC LIMIT ?";
            $params[] = $perPage + 1;

            $results = DB::select($sql, $params);
            $rows = array_map(fn($r) => (array)$r, $results);

            $hasMore = count($rows) > $perPage;
            if ($hasMore) {
                array_pop($rows);
            }

            $nextCursor = null;
            if ($hasMore && !empty($rows)) {
                $lastRow = end($rows);
                $nextCursor = base64_encode((string) $lastRow['id']);
            }

            return $this->respondWithCollection($rows, $nextCursor, $perPage, $hasMore);
        } catch (\Exception $e) {
            return $this->respondWithCollection([], null, $perPage, false);
        }
    }

    /** GET /api/v2/admin/volunteering/hours */
    public function listHours(): JsonResponse
    {
        $this->requireAdmin();
        if (!TenantContext::hasFeature('volunteering')) {
            return $this->respondWithError('FEATURE_DISABLED', __('api.service_unavailable'), null, 403);
        }
        $tenantId = $this->getTenantId();

        $perPage = $this->queryInt('per_page', 20, 1, 50);
        $status = $this->query('status');
        $cursor = $this->query('cursor');

        if (!$this->tableExists('vol_logs')) {
            return $this->respondWithCollection([], null, $perPage, false);
        }

        try {
            // Hour payments live in vol_org_transactions (type=volunteer_payment,
            // one row per vol_log_id) — vol_logs has no paid/paid_amount columns.
            $hasPayments = $this->tableExists('vol_org_transactions');

            $totalPaidSelect = $hasPayments
                ? "(SELECT COALESCE(SUM(ABS(amount)), 0) FROM vol_org_transactions
                     WHERE tenant_id = ? AND type = 'volunteer_payment' AND vol_log_id IS NOT NULL)"
                : '0';
            $statsParams = $hasPayments ? [$tenantId, $tenantId] : [$tenantId];

            $statsRow = DB::selectOne(
                "SELECT
                    COALESCE(SUM(hours), 0) as total_hours,
                    COALESCE(SUM(CASE WHEN status = 'approved' THEN hours ELSE 0 END), 0) as approved_hours,
                    COALESCE(SUM(CASE WHEN status = 'pending' THEN hours ELSE 0 END), 0) as pending_hours,
                    {$totalPaidSelect} as total_paid
                 FROM vol_logs WHERE tenant_id = ?",
                $statsParams
            );

            $paidCols = $hasPayments
                ? ', CASE WHEN vt.id IS NOT NULL THEN 1 ELSE 0 END as paid, COALESCE(ABS(vt.amount), 0) as paid_amount'
                : ', 0 as paid, 0 as paid_amount';
            $paymentJoin = $hasPayments
                ? " LEFT JOIN vol_org_transactions vt ON vt.vol_log_id = vl.id
                        AND vt.tenant_id = vl.tenant_id AND vt.type = 'volunteer_payment'"
                : '';
            $sql = "SELECT vl.id, vl.hours, vl.status, vl.created_at{$paidCols},
                           u.first_name, u.last_name,
                           vo.name as org_name
                    FROM vol_logs vl
                    LEFT JOIN users u ON vl.user_id = u.id AND u.tenant_id = ?
                    LEFT JOIN vol_organizations vo ON vl.organization_id = vo.id AND vo.tenant_id = ?{$paymentJoin}
                    WHERE vl.tenant_id = ?";
            $params = [$tenantId, $tenantId, $tenantId];

            if ($status && in_array($status, ['pending', 'approved', 'declined'], true)) {
                $sql .= " AND vl.status = ?";
                $params[] = $status;
            }

            if ($cursor) {
                $decoded = base64_decode($cursor, true);
                if ($decoded && is_numeric($decoded)) {
                    $sql .= " AND vl.id < ?";
                    $params[] = (int) $decoded;
                }
            }

            $sql .= " ORDER BY vl.created_at DESC, vl.id DESC LIMIT ?";
            $params[] = $perPage + 1;

            $results = DB::select($sql, $params);
            $rows = array_map(fn($r) => (array)$r, $results);

            $hasMore = count($rows) > $perPage;
            if ($hasMore) {
                array_pop($rows);
            }

            $nextCursor = null;
            if ($hasMore && !empty($rows)) {
                $lastRow = end($rows);
                $nextCursor = base64_encode((string) $lastRow['id']);
            }

            $stats = [
                'total_hours' => round((float) ($statsRow->total_hours ?? 0), 1),
                'approved_hours' => round((float) ($statsRow->approved_hours ?? 0), 1),
                'pending_hours' => round((float) ($statsRow->pending_hours ?? 0), 1),
                'total_paid' => round((float) ($statsRow->total_paid ?? 0), 2),
            ];
            $meta = [
                'per_page' => $perPage,
                'has_more' => $hasMore,
                'next_cursor' => $nextCursor,
            ];

            return $this->respondWithData([
                'items' => $rows,
                'stats' => $stats,
                'meta' => $meta,
            ], $meta);
        } catch (\Exception $e) {
            Log::error("AdminVolunteerController::listHours error: " . $e->getMessage());
            return $this->respondWithData([
                'items' => [],
                'stats' => ['total_hours' => 0, 'approved_hours' => 0, 'pending_hours' => 0, 'total_paid' => 0],
                'meta' => ['per_page' => $perPage, 'has_more' => false, 'next_cursor' => null],
            ], ['per_page' => $perPage, 'has_more' => false, 'next_cursor' => null]);
        }
    }

    /** POST /api/v2/admin/volunteering/hours/{id}/verify */
    public function verifyHours(int $id): JsonResponse
    {
        $adminId = $this->requireAdmin();
        if (!TenantContext::hasFeature('volunteering')) {
            return $this->respondWithError('FEATURE_DISABLED', __('api.service_unavailable'), null, 403);
        }
        $tenantId = $this->getTenantId();

        $action = $this->input('action');
        if (!$action || !in_array($action, ['approve', 'decline'], true)) {
            return $this->respondWithError('VALIDATION_ERROR', __('api.decision_required'), 'action', 400);
        }

        if (!$this->tableExists('vol_logs')) {
            return $this->respondWithError('NOT_FOUND', __('api.log_not_found'), null, 404);
        }

        try {
            $log = DB::selectOne(
                "SELECT id, user_id, organization_id, hours, status FROM vol_logs WHERE id = ? AND tenant_id = ?",
                [$id, $tenantId]
            );

            if (!$log) {
                return $this->respondWithError('NOT_FOUND', __('api.log_not_found'), null, 404);
            }

            if ($log->status !== 'pending') {
                return $this->respondWithError('VALIDATION_ERROR', __('api.only_pending_can_be_verified'), null, 422);
            }

            // Separation of duties: admins cannot verify their own volunteer hours
            // (approving would mint themselves time credits). Mirrors the guard in
            // VolunteerService::verifyHours(), which blocks self-verification for
            // org owners/admins — the admin path must not be exempt.
            if ((int) $log->user_id === $adminId) {
                return $this->respondWithError('FORBIDDEN', __('api.volunteer_verify_own_hours_forbidden'), null, 403);
            }

            $newStatus = $action === 'approve' ? 'approved' : 'declined';
            $paymentOutcome = null; // null | 'paid' | 'no_whole_hours' | 'already_paid' | 'no_org'
            $alreadyProcessed = false;

            DB::transaction(function () use ($id, $tenantId, $newStatus, $action, $log, &$paymentOutcome, &$alreadyProcessed) {
                // Flip status conditional on the log still being pending. The status
                // pre-check above runs OUTSIDE this transaction, so two concurrent
                // approvals can both pass it. The row lock taken by this UPDATE
                // serialises them; the second finds 0 rows affected and aborts
                // before re-entering the payout branch, preventing a double mint.
                // Mirrors the idempotency gate in VolunteerService::verifyHours().
                $affected = DB::update(
                    "UPDATE vol_logs SET status = ?, updated_at = NOW() WHERE id = ? AND tenant_id = ? AND status = 'pending'",
                    [$newStatus, $id, $tenantId]
                );
                if ($affected === 0) {
                    $alreadyProcessed = true;
                    return;
                }

                if ($action !== 'approve') {
                    return;
                }

                $orgId = (int) ($log->organization_id ?? 0);
                $volunteerId = (int) ($log->user_id ?? 0);
                $hours = (float) ($log->hours ?? 0);

                if ($orgId <= 0 || $volunteerId <= 0 || $hours <= 0) {
                    $paymentOutcome = 'no_org';
                    return;
                }

                // Idempotency: don't re-pay if a payment already exists for this vol_log
                $existingPayment = DB::selectOne(
                    "SELECT id FROM vol_org_transactions
                     WHERE tenant_id = ? AND vol_organization_id = ? AND vol_log_id = ? AND type = 'volunteer_payment'
                     LIMIT 1",
                    [$tenantId, $orgId, $id]
                );
                if ($existingPayment) {
                    $paymentOutcome = 'already_paid';
                    return;
                }

                // Lock the volunteer's USER row FIRST, then the org row —
                // VolOrgWalletService::depositFromUser() locks user -> org, so
                // locking org -> user here is a lock-order inversion deadlock
                // when a deposit and a payout race (the exact inversion
                // documented in VolOrgWalletService::payVolunteer()).
                DB::selectOne(
                    "SELECT id FROM users WHERE id = ? AND tenant_id = ? FOR UPDATE",
                    [$volunteerId, $tenantId]
                );

                // Then lock the org row (serialises concurrent payouts). Approval
                // ALWAYS mints credits — classic timebanking. Credits are minted on
                // confirmation and are never gated by the org wallet balance or the
                // auto_pay flag; the org wallet is a reconciliation figure (it may go
                // negative), not a spending limit. Mirrors VolunteerService::verifyHours().
                $org = DB::selectOne(
                    "SELECT id, balance, user_id FROM vol_organizations WHERE id = ? AND tenant_id = ? FOR UPDATE",
                    [$orgId, $tenantId]
                );
                if (!$org) {
                    $paymentOutcome = 'no_org';
                    return;
                }

                // users.balance stores whole hours; mint the integer-floor portion
                // and retain any fractional remainder in the org wallet.
                $intHours = (int) floor($hours);
                if ($intHours <= 0) {
                    $paymentOutcome = 'no_whole_hours';
                    return;
                }
                $orgDebit = (float) $intHours;

                // Debit the org wallet unconditionally — allow it to go NEGATIVE.
                DB::update(
                    "UPDATE vol_organizations SET balance = balance - ? WHERE id = ? AND tenant_id = ?",
                    [$orgDebit, $orgId, $tenantId]
                );
                $newOrgBalance = (float) $org->balance - $orgDebit; // may be negative

                // Credit (mint) to volunteer
                DB::update(
                    "UPDATE users SET balance = balance + ? WHERE id = ? AND tenant_id = ?",
                    [$intHours, $volunteerId, $tenantId]
                );

                // Record in vol_org_transactions (balance_after may be negative)
                $description = __('api.volunteer_auto_payment_description', ['hours' => $intHours]);
                DB::insert("
                    INSERT INTO vol_org_transactions (tenant_id, vol_organization_id, user_id, vol_log_id, type, amount, balance_after, description, created_at)
                    VALUES (?, ?, ?, ?, 'volunteer_payment', ?, ?, ?, NOW())
                ", [$tenantId, $orgId, $volunteerId, $id, -$orgDebit, $newOrgBalance, $description]);

                // Record in main transactions table
                DB::insert("
                    INSERT INTO transactions (tenant_id, sender_id, receiver_id, amount, description, transaction_type, status, created_at, updated_at)
                    VALUES (?, ?, ?, ?, ?, 'volunteer', 'completed', NOW(), NOW())
                ", [$tenantId, (int) $org->user_id, $volunteerId, $intHours, $description]);

                $paymentOutcome = 'paid';
            });

            // A concurrent/retried request already verified this log between our
            // pre-check and UPDATE — report the same conflict the pre-check returns,
            // without minting again or sending a duplicate notification.
            if ($alreadyProcessed) {
                return $this->respondWithError('VALIDATION_ERROR', __('api.only_pending_can_be_verified'), null, 422);
            }

            // Notify the reward/feed/regional-points cascade of the status change.
            // Mirrors VolunteerService::verifyHours() so admin-panel approvals award
            // XP and volunteering badges and post feed activity just like the member
            // self-verify path (previously they did neither).
            try {
                VolLogStatusChanged::dispatch($tenantId, (int) $id, 'pending', $newStatus);
            } catch (\Throwable $e) {
                // Event dispatch failure must not break the parent flow.
                Log::warning('AdminVolunteerController: VolLogStatusChanged dispatch failed: ' . $e->getMessage());
            }

            // Send hours approved/declined notification after the data mutation.
            // The minting happens inline above (mirrors VolunteerService::verifyHours),
            // so this is the single place that notifies the volunteer of the outcome.
            try {
                $volDetail = DB::selectOne(
                    "SELECT u.id as user_id, u.email, u.first_name, u.name, u.preferred_language, vl.hours, vo.title as opportunity_title, org.name as organization_name
                     FROM vol_logs vl
                     LEFT JOIN users u ON vl.user_id = u.id AND u.tenant_id = ?
                     LEFT JOIN vol_opportunities vo ON vl.opportunity_id = vo.id AND vo.tenant_id = vl.tenant_id
                     LEFT JOIN vol_organizations org ON vl.organization_id = org.id AND org.tenant_id = vl.tenant_id
                     WHERE vl.id = ? AND vl.tenant_id = ?",
                    [$tenantId, $id, $tenantId]
                );

                if ($volDetail && !empty($volDetail->user_id)) {
                    LocaleContext::withLocale($volDetail, function () use ($volDetail, $newStatus, $paymentOutcome, $tenantId) {
                        $userId = (int) $volDetail->user_id;
                        $hours = (float) ($volDetail->hours ?? 0);
                        $orgName = (string) ($volDetail->organization_name ?? __('emails.common.fallback_organization'));

                        if ($newStatus === 'approved' && $paymentOutcome === 'paid') {
                            NotificationDispatcher::dispatch(
                                $userId,
                                'global',
                                0,
                                'vol_hours_approved',
                                __('notifications.vol_hours_approved_paid_body', ['hours' => $hours]),
                                '/wallet',
                                NotificationDispatcher::buildVolHoursApprovedPaidEmail($hours, $orgName)
                            );
                            return;
                        }

                        if ($newStatus === 'approved') {
                            NotificationDispatcher::dispatch(
                                $userId,
                                'global',
                                0,
                                'vol_hours_approved',
                                __('notifications.vol_hours_approved_body', ['hours' => $hours]),
                                '/volunteering?tab=hours',
                                NotificationDispatcher::buildVolHoursApprovedEmail($hours, $orgName)
                            );
                            return;
                        }

                        NotificationDispatcher::dispatch(
                            $userId,
                            'global',
                            0,
                            'vol_hours_declined',
                            __('notifications.vol_hours_declined_body', ['hours' => $hours]),
                            '/volunteering?tab=hours',
                            NotificationDispatcher::buildVolHoursDeclinedEmail($hours, $orgName)
                        );
                    });
                }
            } catch (\Throwable $emailEx) {
                Log::warning('AdminVolunteerController: hours status notification failed: ' . $emailEx->getMessage());
            }

            return $this->respondWithData([
                'id' => $id,
                'status' => $newStatus,
                'paid' => $paymentOutcome === 'paid',
                'payment_outcome' => $paymentOutcome,
            ]);
        } catch (\Exception $e) {
            Log::error("AdminVolunteerController::verifyHours error: " . $e->getMessage());
            return $this->respondWithError('SERVER_ERROR', __('api.update_failed', ['resource' => 'hours verification']), null, 500);
        }
    }

    /** GET /api/v2/admin/volunteering */
    public function index(): JsonResponse
    {
        $this->requireAdmin();
        if (!TenantContext::hasFeature('volunteering')) {
            return $this->respondWithError('FEATURE_DISABLED', __('api.service_unavailable'), null, 403);
        }
        $tenantId = TenantContext::getId();

        $data = [
            'stats' => [
                'total_opportunities' => 0, 'active_opportunities' => 0,
                'total_applications' => 0, 'pending_applications' => 0,
                'total_hours_logged' => 0, 'active_volunteers' => 0,
            ],
            'recent_opportunities' => [],
        ];

        if (!$this->tableExists('vol_opportunities')) {
            return $this->respondWithData($data);
        }

        try {
            $row = DB::selectOne(
                "SELECT COUNT(*) as total,
                        SUM(CASE WHEN status IN ('open', 'active') AND is_active=1 THEN 1 ELSE 0 END) as active_count
                 FROM vol_opportunities WHERE tenant_id = ?",
                [$tenantId]
            );
            $data['stats']['total_opportunities'] = (int) ($row->total ?? 0);
            $data['stats']['active_opportunities'] = (int) ($row->active_count ?? 0);
        } catch (\Exception $e) { Log::warning('Stats query failed in ' . __METHOD__, ['error' => $e->getMessage()]); }

        if ($this->tableExists('vol_applications')) {
            try {
                $row = DB::selectOne(
                    "SELECT COUNT(*) as total, SUM(CASE WHEN va.status='pending' THEN 1 ELSE 0 END) as pending
                     FROM vol_applications va WHERE va.tenant_id = ?",
                    [$tenantId]
                );
                $data['stats']['total_applications'] = (int) ($row->total ?? 0);
                $data['stats']['pending_applications'] = (int) ($row->pending ?? 0);
            } catch (\Exception $e) { Log::warning('Stats query failed in ' . __METHOD__, ['error' => $e->getMessage()]); }
        }

        if ($this->tableExists('vol_logs')) {
            try {
                $row = DB::selectOne(
                    "SELECT COALESCE(SUM(vl.hours), 0) as total_hours, COUNT(DISTINCT vl.user_id) as volunteers
                     FROM vol_logs vl WHERE vl.tenant_id = ?",
                    [$tenantId]
                );
                $data['stats']['total_hours_logged'] = round((float) ($row->total_hours ?? 0), 1);
                $data['stats']['active_volunteers'] = (int) ($row->volunteers ?? 0);
            } catch (\Exception $e) { Log::warning('Stats query failed in ' . __METHOD__, ['error' => $e->getMessage()]); }
        }

        try {
            $authorColumn = $this->getOpportunityAuthorColumn();
            if ($authorColumn !== null) {
                $results = DB::select(
                    "SELECT vo.id, vo.title, vo.status, vo.is_active, vo.created_at,
                            CASE WHEN vo.is_active = 1 AND (vo.status = 'open' OR vo.status = 'active') THEN 'active' ELSE vo.status END as ui_status,
                            u.first_name, u.last_name
                     FROM vol_opportunities vo LEFT JOIN users u ON vo.{$authorColumn} = u.id
                     WHERE vo.tenant_id = ? ORDER BY vo.created_at DESC LIMIT 10",
                    [$tenantId]
                );
            } else {
                $results = DB::select(
                    "SELECT vo.id, vo.title, vo.status, vo.is_active, vo.created_at,
                            CASE WHEN vo.is_active = 1 AND (vo.status = 'open' OR vo.status = 'active') THEN 'active' ELSE vo.status END as ui_status,
                            NULL as first_name, NULL as last_name
                     FROM vol_opportunities vo WHERE vo.tenant_id = ? ORDER BY vo.created_at DESC LIMIT 10",
                    [$tenantId]
                );
            }
            $rows = array_map(fn($r) => (array)$r, $results);
            $data['recent_opportunities'] = array_map(static function (array $row): array {
                $row['status'] = $row['ui_status'] ?? $row['status'];
                unset($row['ui_status']);
                return $row;
            }, $rows);
        } catch (\Exception $e) { Log::warning('Stats query failed in ' . __METHOD__, ['error' => $e->getMessage()]); }

        return $this->respondWithData($data);
    }

    /** GET /api/v2/admin/volunteering/approvals */
    public function approvals(): JsonResponse
    {
        $this->requireAdmin();
        if (!TenantContext::hasFeature('volunteering')) {
            return $this->respondWithError('FEATURE_DISABLED', __('api.service_unavailable'), null, 403);
        }
        $tenantId = TenantContext::getId();

        if (!$this->tableExists('vol_applications')) {
            return $this->respondWithData([]);
        }

        try {
            // The admin UI splits this one response into pending/approved/declined
            // tabs client-side — returning only 'pending' left the other two tabs
            // permanently empty. Pending rows sort first so they are never crowded
            // out by recent decisions.
            $results = DB::select(
                "SELECT va.*, u.first_name, u.last_name, u.email, vo.title as opportunity_title
                 FROM vol_applications va
                 INNER JOIN vol_opportunities vo ON va.opportunity_id = vo.id
                 LEFT JOIN users u ON va.user_id = u.id AND u.tenant_id = ?
                 WHERE vo.tenant_id = ? AND va.tenant_id = ?
                 ORDER BY (va.status = 'pending') DESC, va.created_at DESC LIMIT 150",
                [$tenantId, $tenantId, $tenantId]
            );
            return $this->respondWithData(array_map(fn($r) => (array)$r, $results));
        } catch (\Exception $e) {
            return $this->respondWithData([]);
        }
    }

    /** GET /api/v2/admin/volunteering/organizations */
    public function organizations(): JsonResponse
    {
        $this->requireAdmin();
        if (!TenantContext::hasFeature('volunteering')) {
            return $this->respondWithError('FEATURE_DISABLED', __('api.service_unavailable'), null, 403);
        }
        $tenantId = TenantContext::getId();

        if ($this->tableExists('vol_organizations')) {
            try {
                // Single query: LEFT JOIN grouped aggregates per org instead of per-row correlated subqueries
                $results = DB::select(
                    "SELECT vo.id, vo.id as org_id, vo.name as org_name, vo.description,
                            vo.contact_email, vo.website, vo.org_type, vo.meeting_schedule,
                            vo.status, vo.created_at, vo.balance,
                            COALESCE(mc.member_count, 0) as member_count,
                            COALESCE(oc.opportunity_count, 0) as opportunity_count,
                            COALESCE(hc.total_hours, 0) as total_hours,
                            COALESCE(tx.total_in, 0) as total_in,
                            COALESCE(tx.total_out, 0) as total_out
                     FROM vol_organizations vo
                     LEFT JOIN (
                         SELECT organization_id, COUNT(*) as member_count
                         FROM org_members
                         WHERE tenant_id = ? AND org_type = 'volunteer' AND status = 'active'
                         GROUP BY organization_id
                     ) mc ON mc.organization_id = vo.id
                     LEFT JOIN (
                         SELECT organization_id, COUNT(*) as opportunity_count
                         FROM vol_opportunities
                         WHERE tenant_id = ? AND is_active = 1
                         GROUP BY organization_id
                     ) oc ON oc.organization_id = vo.id
                     LEFT JOIN (
                         SELECT organization_id, SUM(hours) as total_hours
                         FROM vol_logs
                         WHERE tenant_id = ? AND status = 'approved'
                         GROUP BY organization_id
                     ) hc ON hc.organization_id = vo.id
                     LEFT JOIN (
                         SELECT vol_organization_id,
                                SUM(CASE WHEN amount > 0 THEN amount ELSE 0 END) as total_in,
                                SUM(CASE WHEN amount < 0 THEN ABS(amount) ELSE 0 END) as total_out
                         FROM vol_org_transactions
                         WHERE tenant_id = ?
                         GROUP BY vol_organization_id
                     ) tx ON tx.vol_organization_id = vo.id
                     WHERE vo.tenant_id = ?
                     ORDER BY vo.name ASC
                     LIMIT 100",
                    [$tenantId, $tenantId, $tenantId, $tenantId, $tenantId]
                );
                return $this->respondWithData(array_map(fn($r) => (array)$r, $results));
            } catch (\Throwable $e) { Log::warning('Stats query failed in ' . __METHOD__, ['error' => $e->getMessage()]); }
        }

        try {
            $results = DB::select(
                "SELECT ow.*, o.name as org_name FROM org_wallets ow LEFT JOIN organizations o ON ow.organization_id = o.id
                 WHERE ow.tenant_id = ? ORDER BY o.name ASC LIMIT 50",
                [$tenantId]
            );
            return $this->respondWithData(array_map(fn($r) => (array)$r, $results));
        } catch (\Exception $e) {
            return $this->respondWithData([]);
        }
    }

    private function ensureFeature(): void
    {
        if (!TenantContext::hasFeature('volunteering')) {
            throw new \Illuminate\Http\Exceptions\HttpResponseException(
                $this->respondWithError('FEATURE_DISABLED', __('api.volunteering_feature_disabled'), null, 403)
            );
        }
    }

    /** POST /api/v2/admin/volunteering/organizations */
    public function createOrganization(): JsonResponse
    {
        $this->requireAdmin();
        if (!TenantContext::hasFeature('volunteering')) {
            return $this->respondWithError('FEATURE_DISABLED', __('api.service_unavailable'), null, 403);
        }

        // notifyAdmins: false -- an admin creating an organisation here approves
        // it on the next statement, so an "awaiting approval" email to every
        // admin would be noise about their own action.
        $orgId = $this->volunteerService->createOrganization($this->getUserId(), [
            'name' => trim((string) $this->input('name', '')),
            'description' => trim((string) $this->input('description', '')),
            'contact_email' => trim((string) $this->input('contact_email', '')),
            'website' => trim((string) $this->input('website', '')),
        ], false);

        if ($orgId === null) {
            return $this->respondWithErrors($this->volunteerService->getErrors(), 422);
        }

        $tenantId = $this->getTenantId();
        $updates = ['status = ?'];
        $params = ['active'];
        foreach (['org_type', 'meeting_schedule'] as $field) {
            if (Schema::hasColumn('vol_organizations', $field) && $this->input($field) !== null) {
                $updates[] = "{$field} = ?";
                $params[] = trim((string) $this->input($field));
            }
        }
        $params[] = $orgId;
        $params[] = $tenantId;

        DB::update(
            "UPDATE vol_organizations SET " . implode(', ', $updates) . ", updated_at = NOW() WHERE id = ? AND tenant_id = ?",
            $params
        );
        app(\App\Services\PrerenderContentInvalidator::class)
            ->refreshVolunteerOrganisation((int) $tenantId, (int) $orgId);

        return $this->respondWithData($this->volunteerService->getOrganizationById($orgId, true), null, 201);
    }

    /** PUT /api/v2/admin/volunteering/organizations/{id} */
    public function updateOrganization(int $id): JsonResponse
    {
        $this->requireAdmin();
        if (!TenantContext::hasFeature('volunteering')) {
            return $this->respondWithError('FEATURE_DISABLED', __('api.service_unavailable'), null, 403);
        }

        $tenantId = $this->getTenantId();
        if (!DB::selectOne("SELECT id FROM vol_organizations WHERE id = ? AND tenant_id = ?", [$id, $tenantId])) {
            return $this->respondWithError('NOT_FOUND', __('api.organization_not_found'), null, 404);
        }

        $updates = [];
        $params = [];
        foreach (['name', 'description', 'contact_email', 'website'] as $field) {
            if ($this->input($field) !== null) {
                $value = trim((string) $this->input($field));
                if ($field === 'contact_email' && $value !== '' && !filter_var($value, FILTER_VALIDATE_EMAIL)) {
                    return $this->respondWithError('VALIDATION_ERROR', __('api.valid_email_address_required'), $field, 422);
                }
                if ($field === 'website' && $value !== '') {
                    // http/https only — the value renders as a public <a href>.
                    $scheme = strtolower((string) parse_url($value, PHP_URL_SCHEME));
                    if (!filter_var($value, FILTER_VALIDATE_URL) || !in_array($scheme, ['http', 'https'], true)) {
                        return $this->respondWithError('VALIDATION_ERROR', __('api.valid_url_required'), $field, 422);
                    }
                }
                $updates[] = "{$field} = ?";
                $params[] = $value === '' ? null : $value;
            }
        }

        foreach (['org_type', 'meeting_schedule'] as $field) {
            if (Schema::hasColumn('vol_organizations', $field) && $this->input($field) !== null) {
                $updates[] = "{$field} = ?";
                $value = trim((string) $this->input($field));
                $params[] = $value === '' ? null : $value;
            }
        }

        if (empty($updates)) {
            return $this->respondWithError('VALIDATION_ERROR', __('api.no_fields_to_update'), null, 400);
        }

        $params[] = $id;
        $params[] = $tenantId;
        DB::update(
            "UPDATE vol_organizations SET " . implode(', ', $updates) . ", updated_at = NOW() WHERE id = ? AND tenant_id = ?",
            $params
        );
        app(\App\Services\PrerenderContentInvalidator::class)
            ->refreshVolunteerOrganisation((int) $tenantId, (int) $id);

        return $this->respondWithData($this->volunteerService->getOrganizationById($id, true));
    }

    /** GET /api/v2/admin/volunteering/organizations/{id}/members */
    public function organizationMembers(int $id): JsonResponse
    {
        $this->requireAdmin();
        if (!TenantContext::hasFeature('volunteering')) {
            return $this->respondWithError('FEATURE_DISABLED', __('api.service_unavailable'), null, 403);
        }

        $tenantId = $this->getTenantId();
        if (!DB::selectOne("SELECT id FROM vol_organizations WHERE id = ? AND tenant_id = ?", [$id, $tenantId])) {
            return $this->respondWithError('NOT_FOUND', __('api.organization_not_found'), null, 404);
        }

        $rows = DB::select(
            "SELECT om.id, om.user_id,
                    COALESCE(u.first_name, SUBSTRING_INDEX(u.name, ' ', 1), '') as first_name,
                    COALESCE(u.last_name, TRIM(SUBSTRING(u.name, LENGTH(SUBSTRING_INDEX(u.name, ' ', 1)) + 1)), '') as last_name,
                    u.profile_type,
                    u.organization_name,
                    om.role,
                    COALESCE(SUM(CASE WHEN vl.status = 'approved' THEN vl.hours ELSE 0 END), 0) as total_hours
             FROM org_members om
             INNER JOIN users u ON u.id = om.user_id AND u.tenant_id = om.tenant_id
             LEFT JOIN vol_logs vl ON vl.user_id = om.user_id
                AND vl.organization_id = om.organization_id
                AND vl.tenant_id = om.tenant_id
             WHERE om.organization_id = ? AND om.org_type = 'volunteer' AND om.tenant_id = ? AND om.status = 'active'
             GROUP BY om.id, om.user_id, u.first_name, u.last_name, u.name, om.role
             ORDER BY om.id DESC
             LIMIT 100",
            [$id, $tenantId]
        );

        return $this->respondWithData(array_map(fn ($row) => (array) $row, $rows));
    }

    /** POST /api/v2/admin/volunteering/applications/{id}/approve */
    public function approveApplication($id): JsonResponse
    {
        $this->requireAdmin();
        if (!TenantContext::hasFeature('volunteering')) {
            return $this->respondWithError('FEATURE_DISABLED', __('api.service_unavailable'), null, 403);
        }
        $tenantId = TenantContext::getId();
        $id = (int) $id;

        if (!$id || !$this->tableExists('vol_applications')) {
            return $this->respondWithError('NOT_FOUND', __('api.not_found', ['model' => 'Application']), null, 404);
        }

        try {
            $app = DB::selectOne(
                "SELECT va.id, va.status, va.user_id, va.shift_id, vo.title as opportunity_title
                 FROM vol_applications va INNER JOIN vol_opportunities vo ON va.opportunity_id = vo.id
                 WHERE va.id = ? AND va.tenant_id = ? AND vo.tenant_id = ?",
                [$id, $tenantId, $tenantId]
            );

            if (!$app) {
                return $this->respondWithError('NOT_FOUND', __('api.not_found', ['model' => 'Application']), null, 404);
            }

            if ($app->status !== 'pending') {
                return $this->respondWithError('VALIDATION_ERROR', __('api.only_pending_can_be_approved', ['status' => 'pending']), null, 422);
            }

            $alreadyDecided = false;

            DB::transaction(function () use ($id, $tenantId, $app, &$alreadyDecided) {
                if (!empty($app->shift_id)) {
                    $shift = DB::selectOne(
                        "SELECT id, capacity FROM vol_shifts WHERE id = ? AND tenant_id = ? FOR UPDATE",
                        [(int) $app->shift_id, $tenantId]
                    );

                    if (!$shift) {
                        throw new \DomainException(__('api.volunteer_shift_not_found'));
                    }

                    if (!empty($shift->capacity)) {
                        // Count approved signups AND active group-reservation slots
                        // (via the shared capacity service) — counting approved
                        // applications alone let an admin approve past capacity when
                        // group reservations held the remaining slots.
                        $used = \App\Services\VolunteerShiftCapacityService::usedSlots(
                            (int) $app->shift_id,
                            $tenantId
                        );

                        if ($used >= (int) $shift->capacity) {
                            throw new \DomainException(__('api.volunteer_shift_at_capacity'));
                        }
                    }
                }

                // Conditional status guard: the pre-check above runs OUTSIDE this
                // transaction, so a concurrent decision can slip between it and
                // this UPDATE. 0 rows affected means the application was already
                // decided — report the same conflict the pre-check returns and
                // do NOT send a duplicate decision notification.
                $affected = DB::update(
                    "UPDATE vol_applications SET status = 'approved', updated_at = NOW() WHERE id = ? AND tenant_id = ? AND status = 'pending'",
                    [$id, $tenantId]
                );
                if ($affected === 0) {
                    $alreadyDecided = true;
                }
            });

            if ($alreadyDecided) {
                return $this->respondWithError('VALIDATION_ERROR', __('api.only_pending_can_be_approved', ['status' => 'pending']), null, 422);
            }

            // Load applicant once with preferred_language for both notifications and email
            $applicant = DB::table('users')
                ->where('id', (int) $app->user_id)
                ->where('tenant_id', $tenantId)
                ->select(['email', 'first_name', 'name', 'preferred_language'])
                ->first();

            // Notify the applicant (in-app bell)
            try {
                $applicantId = (int) $app->user_id;

                if ($applicantId) {
                    LocaleContext::withLocale($applicant, function () use ($applicantId, $tenantId) {
                        Notification::createNotification(
                            $applicantId,
                            __('api_controllers_3.admin_bells.volunteer_approved'),
                            '/volunteering',
                            'moderation',
                            true,
                            $tenantId
                        );
                        \App\Services\NotificationDispatcher::fanOutPush((int) $applicantId, 'moderation', __('api_controllers_3.admin_bells.volunteer_approved'), '/volunteering');
                    });
                }
            } catch (\Throwable $e) {
                Log::warning("AdminVolunteerController::approveApplication notification failed: " . $e->getMessage());
            }

            // Send approval email to the applicant
            try {
                $oppTitle = htmlspecialchars($app->opportunity_title ?? 'the opportunity', ENT_QUOTES, 'UTF-8');

                if ($applicant && !empty($applicant->email)) {
                    LocaleContext::withLocale($applicant, function () use ($applicant, $oppTitle, $tenantId, $id) {
                        $firstName = $applicant->first_name ?? $applicant->name ?? __('emails.common.fallback_name');
                        $url = TenantContext::getFrontendUrl() . TenantContext::getSlugPrefix() . '/volunteering';

                        $html = \App\Core\EmailTemplateBuilder::make()
                            ->theme('success')
                            ->title(__('emails.volunteer_approval.application_approved_title'))
                            ->previewText(__('emails.volunteer_approval.application_approved_preview', ['opportunity' => $oppTitle]))
                            ->greeting($firstName)
                            ->paragraph(__('emails.volunteer_approval.application_approved_body', ['opportunity' => $oppTitle]))
                            ->button(__('emails.volunteer_approval.application_approved_cta'), $url)
                            ->render();

                        if (!\App\Services\EmailDispatchService::sendRaw(
                            $applicant->email,
                            __('emails.volunteer_approval.application_approved_subject'),
                            $html,
                            null,
                            null,
                            null,
                            'volunteering',
                            ['tenant_id' => $tenantId]
                        )) {
                            Log::warning('AdminVolunteerController: approval email returned false', [
                                'application_id' => $id,
                            ]);
                        }
                    });
                }
            } catch (\Throwable $emailEx) {
                Log::warning('AdminVolunteerController: approval email failed: ' . $emailEx->getMessage());
            }

            return $this->respondWithData(['message' => __('api_controllers_1.admin_volunteer.application_approved')]);
        } catch (\DomainException $e) {
            return $this->respondWithError('VALIDATION_ERROR', $e->getMessage(), 'shift_id', 422);
        } catch (\Exception $e) {
            return $this->respondWithError('SERVER_ERROR', __('api.approve_failed', ['resource' => 'application']), null, 500);
        }
    }

    /** POST /api/v2/admin/volunteering/applications/{id}/decline */
    public function declineApplication($id): JsonResponse
    {
        $this->requireAdmin();
        if (!TenantContext::hasFeature('volunteering')) {
            return $this->respondWithError('FEATURE_DISABLED', __('api.service_unavailable'), null, 403);
        }
        $tenantId = TenantContext::getId();
        $id = (int) $id;

        if (!$id || !$this->tableExists('vol_applications')) {
            return $this->respondWithError('NOT_FOUND', __('api.not_found', ['model' => 'Application']), null, 404);
        }

        try {
            $app = DB::selectOne(
                "SELECT va.id, va.status, va.user_id FROM vol_applications va INNER JOIN vol_opportunities vo ON va.opportunity_id = vo.id
                 WHERE va.id = ? AND va.tenant_id = ? AND vo.tenant_id = ?",
                [$id, $tenantId, $tenantId]
            );

            if (!$app) {
                return $this->respondWithError('NOT_FOUND', __('api.not_found', ['model' => 'Application']), null, 404);
            }

            if ($app->status !== 'pending') {
                return $this->respondWithError('VALIDATION_ERROR', __('api.only_pending_can_be_rejected', ['status' => 'pending']), null, 422);
            }

            // Conditional status guard: the pre-check above is not transactional,
            // so a concurrent decision can slip in. 0 rows affected means the
            // application was already decided — report the same conflict the
            // pre-check returns, without a duplicate decision notification.
            $affected = DB::update(
                "UPDATE vol_applications SET status = 'declined', updated_at = NOW() WHERE id = ? AND tenant_id = ? AND status = 'pending'",
                [$id, $tenantId]
            );
            if ($affected === 0) {
                return $this->respondWithError('VALIDATION_ERROR', __('api.only_pending_can_be_rejected', ['status' => 'pending']), null, 422);
            }

            // Notify the applicant
            try {
                $applicantId = (int) $app->user_id;

                if ($applicantId) {
                    $applicant = DB::table('users')
                        ->where('id', $applicantId)
                        ->where('tenant_id', $tenantId)
                        ->select(['preferred_language'])
                        ->first();
                    LocaleContext::withLocale($applicant, function () use ($applicantId, $tenantId) {
                        Notification::createNotification(
                            $applicantId,
                            __('api_controllers_3.admin_bells.volunteer_declined'),
                            null,
                            'moderation',
                            true,
                            $tenantId
                        );
                        \App\Services\NotificationDispatcher::fanOutPush((int) $applicantId, 'moderation', __('api_controllers_3.admin_bells.volunteer_declined'), null);
                    });
                }
            } catch (\Throwable $e) {
                Log::warning("AdminVolunteerController::declineApplication notification failed: " . $e->getMessage());
            }

            return $this->respondWithData(['message' => __('api_controllers_1.admin_volunteer.application_declined')]);
        } catch (\Exception $e) {
            return $this->respondWithError('SERVER_ERROR', __('api.reject_failed', ['resource' => 'application']), null, 500);
        }
    }

    /** POST /api/v2/admin/volunteering/send-shift-reminders -- delegates to service (email sending) */
    public function sendShiftReminders(): JsonResponse
    {
        // Tenant-scoped action exposed to all admins in the admin UI — a
        // super-admin gate here just 403'd every legitimate use.
        $this->requireAdmin();
        $this->ensureFeature();

        $tenantId = TenantContext::getId();

        // Send reminders for all active opportunities in this tenant
        $opportunityIds = DB::table('vol_opportunities')
            ->where('tenant_id', $tenantId)
            ->where('is_active', 1)
            ->whereIn('status', ['open', 'active'])
            ->pluck('id');

        $sent = 0;
        foreach ($opportunityIds as $oppId) {
            $sent += VolunteerReminderService::sendReminders($tenantId, (int) $oppId);
        }

        return $this->respondWithData(['reminders_sent' => $sent]);
    }

    /**
     * Admin: adjust a volunteer organization's wallet balance (top-up or deduct).
     */
    public function adjustOrgWallet(int $id): JsonResponse
    {
        // Tenant-scoped action exposed to all admins in the admin UI.
        $this->requireAdmin();
        $this->ensureFeature();
        // Defence-in-depth: even super-admin adjustments should be rate-limited
        // so an accidental loop or compromised session cannot drain/inflate a
        // vol org wallet in seconds.
        $this->rateLimit('vol_org_admin_adjust', 20, 60);

        $amount = (float) $this->input('amount', 0);
        $reason = trim((string) $this->input('reason', ''));

        if ($amount == 0) {
            return $this->respondWithError('VALIDATION_ERROR', __('api_controllers_1.admin_volunteer.amount_cannot_be_zero'), 'amount', 400);
        }
        if (empty($reason)) {
            return $this->respondWithError('VALIDATION_ERROR', __('api_controllers_1.admin_volunteer.reason_required'), 'reason', 400);
        }

        $adminId = $this->getUserId();
        $result = \App\Services\VolOrgWalletService::adminAdjustment($id, $amount, $adminId, $reason);

        if (!$result['success']) {
            return $this->respondWithError('VALIDATION_ERROR', $result['message'], null, 400);
        }

        return $this->respondWithData([
            'message' => $result['message'],
            'new_balance' => $result['new_balance'],
        ]);
    }

    /** PUT /api/v2/admin/volunteering/organizations/{id}/status */
    public function updateOrgStatus(int $id): JsonResponse
    {
        $this->requireAdmin();
        if (!TenantContext::hasFeature('volunteering')) {
            return $this->respondWithError('FEATURE_DISABLED', __('api.service_unavailable'), null, 403);
        }
        $tenantId = TenantContext::getId();

        // 'declined' joined the accepted set on 2026-08-28 so a pending
        // organisation can actually be REFUSED. Until then the only options were
        // active/suspended, which left an admin with no way to say no -- and the
        // registrant with no way to find out. 'approved' is accepted as a synonym
        // of 'active' because both count as publicly visible
        // (VolunteerService::PUBLIC_ORGANIZATION_STATUSES) and the two spellings
        // are already mixed in the data.
        $status = $this->input('status');
        if (!$status || !in_array($status, ['active', 'approved', 'suspended', 'declined'], true)) {
            return $this->respondWithError('VALIDATION_ERROR', __('api_controllers_1.admin_volunteer.status_invalid'), 'status', 400);
        }

        // Optional, and only meaningful for a refusal or a suspension: it is
        // passed to the registrant so "no" does not arrive unexplained.
        $reason = trim((string) ($this->input('reason') ?? ''));
        if ($reason !== '' && mb_strlen($reason) > 500) {
            $reason = mb_substr($reason, 0, 500);
        }

        if (!$this->tableExists('vol_organizations')) {
            return $this->respondWithError('NOT_FOUND', __('api_controllers_1.admin_volunteer.organization_not_found'), null, 404);
        }

        try {
            $org = DB::selectOne(
                "SELECT id, status FROM vol_organizations WHERE id = ? AND tenant_id = ?",
                [$id, $tenantId]
            );

            if (!$org) {
                return $this->respondWithError('NOT_FOUND', __('api_controllers_1.admin_volunteer.organization_not_found'), null, 404);
            }

            $previousStatus = (string) ($org->status ?? '');

            DB::update(
                "UPDATE vol_organizations SET status = ?, updated_at = NOW() WHERE id = ? AND tenant_id = ?",
                [$status, $id, $tenantId]
            );
            app(\App\Services\PrerenderContentInvalidator::class)
                ->refreshVolunteerOrganisation((int) $tenantId, (int) $id);

            // Tell the person who registered it what was decided. This was
            // silent before 2026-08-28: the status flipped and the member who
            // had been waiting was never told, in either direction.
            if ($previousStatus !== $status) {
                try {
                    VolunteerOrganisationStatusChanged::dispatch(
                        (int) $id,
                        (int) $tenantId,
                        $previousStatus,
                        (string) $status,
                        $this->getUserId(),
                        $reason !== '' ? $reason : null,
                    );
                } catch (\Throwable $e) {
                    // The decision itself is already saved; failing to announce
                    // it must not fail the admin's request.
                    Log::warning('Failed to dispatch VolunteerOrganisationStatusChanged', [
                        'organisation_id' => $id,
                        'tenant_id'       => $tenantId,
                        'error'           => $e->getMessage(),
                    ]);
                }
            }

            return $this->respondWithData([
                'id' => $id,
                'status' => $status,
                'previous_status' => $previousStatus,
                'message' => __('api_controllers_1.admin_volunteer.org_status_updated', ['status' => $status]),
            ]);
        } catch (\Exception $e) {
            return $this->respondWithError('SERVER_ERROR', __('api_controllers_1.admin_volunteer.org_status_update_failed'), null, 500);
        }
    }

    /**
     * Admin: get transaction history for a volunteer organization's wallet.
     */
    public function orgWalletTransactions(int $id): JsonResponse
    {
        // Tenant-scoped read exposed to all admins in the admin UI.
        $this->requireAdmin();
        $this->ensureFeature();

        $filters = [
            'limit' => $this->queryInt('per_page', 20, 1, 50),
            'cursor' => $this->query('cursor'),
        ];

        $result = \App\Services\VolOrgWalletService::getTransactions($id, $filters);
        return $this->respondWithCollection($result['items'], $result['cursor'], $filters['limit'], $result['has_more']);
    }

    // ========================================
    // TRENDS & ANALYTICS
    // ========================================

    /** GET /api/v2/admin/volunteering/trends */
    public function trends(): JsonResponse
    {
        $this->requireAdmin();
        $this->ensureFeature();
        $tenantId = TenantContext::getId();
        $period = $this->query('period', 'week');
        $format = $period === 'month' ? '%Y-%m' : '%Y-%u';
        $labelFormat = $period === 'month' ? '%Y-%m' : '%Y-W%u';
        $days = $period === 'month' ? 365 : 90;

        try {
            $hoursByPeriod = DB::select("
                SELECT DATE_FORMAT(created_at, ?) as period_key,
                       DATE_FORMAT(created_at, ?) as period_label,
                       ROUND(COALESCE(SUM(hours), 0), 1) as hours,
                       COUNT(*) as count
                FROM vol_logs
                WHERE tenant_id = ? AND created_at >= DATE_SUB(NOW(), INTERVAL ? DAY)
                GROUP BY period_key, period_label ORDER BY period_key ASC
            ", [$format, $labelFormat, $tenantId, $days]);

            $applicationsByPeriod = DB::select("
                SELECT DATE_FORMAT(va.created_at, ?) as period_key,
                       DATE_FORMAT(va.created_at, ?) as period_label,
                       COUNT(*) as count,
                       SUM(CASE WHEN va.status = 'approved' THEN 1 ELSE 0 END) as approved
                FROM vol_applications va
                JOIN vol_opportunities vo ON va.opportunity_id = vo.id
                WHERE va.tenant_id = ? AND va.created_at >= DATE_SUB(NOW(), INTERVAL ? DAY)
                GROUP BY period_key, period_label ORDER BY period_key ASC
            ", [$format, $labelFormat, $tenantId, $days]);

            $volunteersByPeriod = DB::select("
                SELECT DATE_FORMAT(created_at, ?) as period_key,
                       DATE_FORMAT(created_at, ?) as period_label,
                       COUNT(DISTINCT user_id) as count
                FROM vol_logs
                WHERE tenant_id = ? AND created_at >= DATE_SUB(NOW(), INTERVAL ? DAY)
                GROUP BY period_key, period_label ORDER BY period_key ASC
            ", [$format, $labelFormat, $tenantId, $days]);

            return $this->respondWithData([
                'period' => $period,
                'hours_by_period' => array_map(fn($r) => ['period' => $r->period_label, 'hours' => (float) $r->hours, 'count' => (int) $r->count], $hoursByPeriod),
                'applications_by_period' => array_map(fn($r) => ['period' => $r->period_label, 'count' => (int) $r->count, 'approved' => (int) $r->approved], $applicationsByPeriod),
                'volunteers_by_period' => array_map(fn($r) => ['period' => $r->period_label, 'count' => (int) $r->count], $volunteersByPeriod),
            ]);
        } catch (\Exception $e) {
            Log::error("AdminVolunteerController::trends error: " . $e->getMessage());
            return $this->respondWithData(['period' => $period, 'hours_by_period' => [], 'applications_by_period' => [], 'volunteers_by_period' => []]);
        }
    }

    /** GET /api/v2/admin/volunteering/reminder-logs */
    public function reminderLogs(): JsonResponse
    {
        $this->requireAdmin();
        $this->ensureFeature();
        $tenantId = TenantContext::getId();
        $perPage = $this->queryInt('per_page', 20, 1, 50);
        $cursor = $this->query('cursor');
        $type = $this->query('type');
        $channel = $this->query('channel');

        try {
            // Stats
            $stats = DB::selectOne("
                SELECT COUNT(*) as total_sent,
                       SUM(CASE WHEN channel = 'email' THEN 1 ELSE 0 END) as email_count,
                       SUM(CASE WHEN channel = 'push' THEN 1 ELSE 0 END) as push_count,
                       SUM(CASE WHEN channel = 'sms' THEN 1 ELSE 0 END) as sms_count
                FROM vol_reminders_sent WHERE tenant_id = ?
            ", [$tenantId]);

            $typeStats = DB::select("
                SELECT reminder_type, COUNT(*) as count
                FROM vol_reminders_sent WHERE tenant_id = ?
                GROUP BY reminder_type
            ", [$tenantId]);

            // Paginated logs
            $sql = "SELECT vrs.*, u.name as user_name, u.avatar_url
                    FROM vol_reminders_sent vrs
                    LEFT JOIN users u ON vrs.user_id = u.id
                    WHERE vrs.tenant_id = ?";
            $params = [$tenantId];

            if ($type) { $sql .= " AND vrs.reminder_type = ?"; $params[] = $type; }
            if ($channel) { $sql .= " AND vrs.channel = ?"; $params[] = $channel; }
            if ($cursor) {
                $decoded = base64_decode($cursor, true);
                if ($decoded && is_numeric($decoded)) { $sql .= " AND vrs.id < ?"; $params[] = (int) $decoded; }
            }

            $sql .= " ORDER BY vrs.sent_at DESC, vrs.id DESC LIMIT ?";
            $params[] = $perPage + 1;

            $rows = DB::select($sql, $params);
            $hasMore = count($rows) > $perPage;
            if ($hasMore) array_pop($rows);

            $items = array_map(fn($r) => [
                'id' => (int) $r->id,
                'user_id' => (int) $r->user_id,
                'user_name' => $r->user_name ?? 'Unknown',
                'user_avatar' => $r->avatar_url,
                'reminder_type' => $r->reminder_type,
                'channel' => $r->channel,
                'reference_id' => $r->reference_id ? (int) $r->reference_id : null,
                'sent_at' => $r->sent_at,
            ], $rows);

            $lastItem = end($items);
            $nextCursor = ($hasMore && $lastItem) ? base64_encode((string) $lastItem['id']) : null;

            $byType = [];
            foreach ($typeStats as $ts) { $byType[$ts->reminder_type] = (int) $ts->count; }

            return $this->respondWithData($items, [
                'stats' => [
                    'total_sent' => (int) ($stats->total_sent ?? 0),
                    'by_channel' => ['email' => (int) ($stats->email_count ?? 0), 'push' => (int) ($stats->push_count ?? 0), 'sms' => (int) ($stats->sms_count ?? 0)],
                    'by_type' => $byType,
                ],
                'per_page' => $perPage,
                'has_more' => $hasMore,
                'cursor' => $nextCursor,
            ]);
        } catch (\Exception $e) {
            Log::error("AdminVolunteerController::reminderLogs error: " . $e->getMessage());
            return $this->respondWithData([], [
                'stats' => ['total_sent' => 0, 'by_channel' => ['email' => 0, 'push' => 0, 'sms' => 0], 'by_type' => []],
                'per_page' => $perPage,
                'has_more' => false,
                'cursor' => null,
            ]);
        }
    }

    /** POST /api/v2/admin/volunteering/custom-fields/reorder */
    public function reorderCustomFields(): JsonResponse
    {
        $this->requireAdmin();
        $this->ensureFeature();
        $tenantId = TenantContext::getId();
        $fieldIds = $this->input('field_ids');

        if (!is_array($fieldIds) || empty($fieldIds)) {
            return $this->respondWithError('VALIDATION_ERROR', __('api.field_ids_required'), 'field_ids', 400);
        }
        if (count($fieldIds) > 100) {
            return $this->respondWithError('VALIDATION_ERROR', __('api.too_many_fields', ['max' => 100]), 'field_ids', 400);
        }

        try {
            $updated = 0;
            foreach ($fieldIds as $order => $fieldId) {
                $affected = DB::update(
                    "UPDATE vol_custom_fields SET display_order = ? WHERE id = ? AND tenant_id = ?",
                    [$order, (int) $fieldId, $tenantId]
                );
                $updated += $affected;
            }
            return $this->respondWithData(['success' => true, 'updated_count' => $updated]);
        } catch (\Exception $e) {
            Log::error("AdminVolunteerController::reorderCustomFields error: " . $e->getMessage());
            return $this->respondWithError('SERVER_ERROR', __('api.failed_reorder_fields'), null, 500);
        }
    }

    /** GET /api/v2/admin/volunteering/giving-days/{id}/donors */
    public function givingDayDonors(int $id): JsonResponse
    {
        $this->requireAdmin();
        $this->ensureFeature();
        $tenantId = TenantContext::getId();

        // Verify giving day belongs to this tenant
        $givingDay = DB::selectOne("SELECT id FROM vol_giving_days WHERE id = ? AND tenant_id = ?", [$id, $tenantId]);
        if (!$givingDay) {
            return $this->respondWithError('NOT_FOUND', __('api.giving_day_not_found'), null, 404);
        }

        $perPage = $this->queryInt('per_page', 20, 1, 50);
        $cursor = $this->query('cursor');

        try {
            // Stats
            $stats = DB::selectOne("
                SELECT COUNT(DISTINCT COALESCE(user_id, id)) as total_donors,
                       SUM(CASE WHEN is_anonymous = 1 THEN 1 ELSE 0 END) as anonymous_count,
                       COALESCE(SUM(amount), 0) as total_raised
                FROM vol_donations
                WHERE giving_day_id = ? AND tenant_id = ? AND status = 'completed'
            ", [$id, $tenantId]);

            // Paginated donor list
            $sql = "SELECT vd.id, vd.user_id, vd.amount, vd.is_anonymous, vd.created_at as donated_at,
                           u.name as user_name, u.email as user_email, u.avatar_url
                    FROM vol_donations vd
                    LEFT JOIN users u ON vd.user_id = u.id AND u.tenant_id = vd.tenant_id
                    WHERE vd.giving_day_id = ? AND vd.tenant_id = ? AND vd.status = 'completed'";
            $params = [$id, $tenantId];

            if ($cursor) {
                $decoded = base64_decode($cursor, true);
                if ($decoded && is_numeric($decoded)) { $sql .= " AND vd.id < ?"; $params[] = (int) $decoded; }
            }

            $sql .= " ORDER BY vd.created_at DESC, vd.id DESC LIMIT ?";
            $params[] = $perPage + 1;

            $rows = DB::select($sql, $params);
            $hasMore = count($rows) > $perPage;
            if ($hasMore) array_pop($rows);

            $items = array_map(fn($r) => [
                'id' => (int) $r->id,
                'user_id' => $r->user_id ? (int) $r->user_id : null,
                'name' => $r->is_anonymous ? null : ($r->user_name ?? null),
                'email' => $r->is_anonymous ? null : $r->user_email,
                'avatar_url' => $r->is_anonymous ? null : $r->avatar_url,
                'amount' => (float) $r->amount,
                'is_anonymous' => (bool) $r->is_anonymous,
                'donated_at' => $r->donated_at,
            ], $rows);

            $lastItem = end($items);
            $nextCursor = ($hasMore && $lastItem) ? base64_encode((string) $lastItem['id']) : null;

            return $this->respondWithData($items, [
                'stats' => [
                    'total_donors' => (int) ($stats->total_donors ?? 0),
                    'anonymous_count' => (int) ($stats->anonymous_count ?? 0),
                    'total_raised' => (float) ($stats->total_raised ?? 0),
                ],
                'per_page' => $perPage,
                'has_more' => $hasMore,
                'cursor' => $nextCursor,
            ]);
        } catch (\Exception $e) {
            Log::error("AdminVolunteerController::givingDayDonors error: " . $e->getMessage());
            return $this->respondWithData([], [
                'per_page' => $perPage,
                'has_more' => false,
                'cursor' => null,
                'stats' => ['total_donors' => 0, 'anonymous_count' => 0, 'total_raised' => 0],
            ]);
        }
    }

    /** GET /api/v2/admin/volunteering/activity-feed */
    public function activityFeed(): JsonResponse
    {
        $this->requireAdmin();
        $this->ensureFeature();
        $tenantId = TenantContext::getId();
        $limit = $this->queryInt('limit', 50, 1, 100);
        $days = $this->queryInt('days', 30, 1, 365);

        try {
            // UNION of recent volunteering activities from multiple tables.
            // Descriptions are rendered in PHP with __() (the requesting
            // admin's locale) — never concatenate English fragments in SQL.
            $activities = DB::select("
                (SELECT 'hours_logged' as type, vl.created_at as timestamp,
                        u.name as user_name, u.avatar_url,
                        vl.hours as detail_hours, NULL as detail_status, NULL as detail_title,
                        NULL as detail_amount, NULL as detail_donor_name,
                        'vol_logs' as entity_type, vl.id as entity_id
                 FROM vol_logs vl JOIN users u ON vl.user_id = u.id
                 WHERE vl.tenant_id = ? AND vl.created_at >= DATE_SUB(NOW(), INTERVAL ? DAY))
                UNION ALL
                (SELECT CONCAT('application_', va.status) as type, va.created_at as timestamp,
                        u.name as user_name, u.avatar_url,
                        NULL as detail_hours, va.status as detail_status, vo.title as detail_title,
                        NULL as detail_amount, NULL as detail_donor_name,
                        'vol_applications' as entity_type, va.id as entity_id
                 FROM vol_applications va
                 JOIN users u ON va.user_id = u.id
                 JOIN vol_opportunities vo ON va.opportunity_id = vo.id
                 WHERE va.tenant_id = ? AND va.created_at >= DATE_SUB(NOW(), INTERVAL ? DAY))
                UNION ALL
                (SELECT 'donation' as type, vd.created_at as timestamp,
                        u.name as user_name, u.avatar_url,
                        NULL as detail_hours, NULL as detail_status, NULL as detail_title,
                        vd.amount as detail_amount, vd.donor_name as detail_donor_name,
                        'vol_donations' as entity_type, vd.id as entity_id
                 FROM vol_donations vd
                 LEFT JOIN users u ON vd.user_id = u.id
                 WHERE vd.tenant_id = ? AND vd.created_at >= DATE_SUB(NOW(), INTERVAL ? DAY) AND vd.status = 'completed')
                ORDER BY timestamp DESC LIMIT ?
            ", [$tenantId, $days, $tenantId, $days, $tenantId, $days, $limit]);

            $items = array_map(function ($r) {
                $donorName = $r->user_name ?? $r->detail_donor_name ?? __('api.vol_activity_donor_anonymous');

                $description = match (true) {
                    $r->type === 'hours_logged' => __('api.vol_activity_hours_logged', [
                        'name' => $r->user_name,
                        'hours' => $r->detail_hours,
                    ]),
                    $r->type === 'donation' => __('api.vol_activity_donation', [
                        'name' => $donorName,
                        'amount' => $r->detail_amount,
                    ]),
                    $r->entity_type === 'vol_applications' => __(
                        in_array($r->detail_status, ['pending', 'approved', 'declined'], true)
                            ? 'api.vol_activity_application_' . $r->detail_status
                            : 'api.vol_activity_application_updated',
                        ['name' => $r->user_name, 'title' => $r->detail_title]
                    ),
                    default => (string) $r->user_name,
                };

                return [
                    'type' => $r->type,
                    'timestamp' => $r->timestamp,
                    'user_name' => $r->type === 'donation' ? $donorName : $r->user_name,
                    'avatar_url' => $r->avatar_url,
                    'description' => $description,
                    'entity_type' => $r->entity_type,
                    'entity_id' => (int) $r->entity_id,
                ];
            }, $activities);

            return $this->respondWithData(['activities' => $items]);
        } catch (\Exception $e) {
            Log::error("AdminVolunteerController::activityFeed error: " . $e->getMessage());
            return $this->respondWithData(['activities' => []]);
        }
    }

    /** GET /api/v2/admin/volunteering/giving-days/{id}/trends */
    public function givingDayTrends(int $id): JsonResponse
    {
        $this->requireAdmin();
        $this->ensureFeature();
        $tenantId = TenantContext::getId();

        // Verify giving day belongs to this tenant
        $givingDay = DB::selectOne("SELECT id FROM vol_giving_days WHERE id = ? AND tenant_id = ?", [$id, $tenantId]);
        if (!$givingDay) {
            return $this->respondWithError('NOT_FOUND', __('api.giving_day_not_found'), null, 404);
        }

        $granularity = $this->query('granularity', 'day');
        $format = $granularity === 'week' ? '%Y-W%u' : '%Y-%m-%d';

        try {
            $rows = DB::select("
                SELECT DATE_FORMAT(created_at, ?) as period,
                       COUNT(DISTINCT COALESCE(user_id, id)) as donors,
                       COALESCE(SUM(amount), 0) as amount
                FROM vol_donations
                WHERE giving_day_id = ? AND tenant_id = ? AND status = 'completed'
                GROUP BY period ORDER BY period ASC
            ", [$format, $id, $tenantId]);

            $cumulative = 0;
            $trends = array_map(function ($r) use (&$cumulative) {
                $cumulative += (float) $r->amount;
                return [
                    'period' => $r->period,
                    'donors' => (int) $r->donors,
                    'amount' => (float) $r->amount,
                    'cumulative' => round($cumulative, 2),
                ];
            }, $rows);

            return $this->respondWithData(['trends' => $trends]);
        } catch (\Exception $e) {
            Log::error("AdminVolunteerController::givingDayTrends error: " . $e->getMessage());
            return $this->respondWithData(['trends' => []]);
        }
    }
}
