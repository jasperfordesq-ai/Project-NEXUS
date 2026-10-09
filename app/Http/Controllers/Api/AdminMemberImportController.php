<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

declare(strict_types=1);

namespace App\Http\Controllers\Api;

use App\Models\ActivityLog;
use App\Services\AuditLogService;
use App\Services\Identity\AdminCreatedAccountAdmission;
use App\Services\MemberImport\InvitationOutbox;
use App\Services\MemberImport\MemberExportCsv;
use App\Services\MemberImport\MemberImportBusy;
use App\Services\MemberImport\MemberImportChecker;
use App\Services\MemberImport\MemberImportFile;
use App\Services\MemberImport\MemberImportNotFound;
use App\Services\MemberImport\MemberImportOutOfOrder;
use App\Services\MemberImport\MemberImportRunner;
use App\Services\MemberImport\MemberImportSession;
use App\Services\MemberImport\MemberImportUndo;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Response;
use Symfony\Component\HttpFoundation\StreamedResponse;

/**
 * Admin member import (design: .local-docs-archive/member-import-export/).
 * Check the whole file first; import only a file without a single problem,
 * in batches the browser paces. Replaces POST /v2/admin/users/import, whose
 * F-278 (members only, identity check) and F-558 (file limits) guarantees
 * carry over here: the file has no role column and is refused if it has one,
 * and size, type and row count are decided from the bytes by MemberImportFile.
 */
class AdminMemberImportController extends BaseApiController
{
    protected bool $isV2Api = true;

    public const CHECKS_PER_MINUTE = 10;
    public const EXPORTS_PER_WINDOW = 10;
    public const EXPORT_WINDOW_SECONDS = 300;

    public function __construct(
        private readonly MemberImportChecker $checker,
        private readonly MemberImportRunner $runner,
        private readonly AuditLogService $audit,
        private readonly MemberImportUndo $undo,
    ) {
    }

    /** POST /api/v2/admin/members/import/check */
    public function check(): JsonResponse
    {
        $adminId = $this->requireAdmin();
        $tenantId = $this->getTenantId();
        // Per administrator, here rather than on the route: a route throttle runs
        // before authentication and the second-factor check, so it would also
        // count requests those refuse. Each check can hold ~1 MB of rows in the
        // shared Redis.
        $this->rateLimit('member_import_check', self::CHECKS_PER_MINUTE, 60);

        $rawName = request()->input('file_name');
        $fileName = preg_replace('/[^A-Za-z0-9._ -]/', '_', basename(is_string($rawName) ? $rawName : '')) ?: 'members.csv';
        $fileName = mb_substr($fileName, 0, 255);

        $admission = AdminCreatedAccountAdmission::decide($tenantId, false);
        $admissionOut = ['requires_identity_check' => $admission['requires_identity_check']];

        $encoded = request()->input('content_base64');
        if (!is_string($encoded)) {
            return $this->respondWithError('VALIDATION_ERROR', __('api.csv_could_not_read'), 'content_base64', 422);
        }
        // Refuse an oversized file before decoding it (base64 is 4 bytes per 3).
        if (strlen($encoded) > (int) ceil(MemberImportFile::MAX_BYTES * 4 / 3) + 8) {
            return $this->respondWithData([
                'status' => 'file_error',
                'file_error' => ['code' => 'too_large', 'params' => ['max_mb' => intdiv(MemberImportFile::MAX_BYTES, 1024 * 1024)]],
                'admission' => $admissionOut,
            ]);
        }
        $bytes = base64_decode($encoded, true);
        if ($bytes === false) {
            return $this->respondWithError('VALIDATION_ERROR', __('api.csv_could_not_read'), 'content_base64', 422);
        }

        $result = $this->checker->check($tenantId, $bytes);
        $result['admission'] = $admissionOut;

        if ($result['status'] === 'ready') {
            $result['import_id'] = MemberImportSession::create($tenantId, $adminId, $result['rows'], $fileName, hash('sha256', $bytes));
            // How long the welcome invitations for this file would take at the sender's pace.
            $result['invitation_minutes'] = InvitationOutbox::minutesToSend(count($result['rows']));
        }
        // The browser never receives the normalised rows; the server holds them.
        unset($result['rows']);

        return $this->respondWithData($result);
    }

    /** POST /api/v2/admin/members/import/{importId}/batch */
    public function batch(string $importId): JsonResponse
    {
        $adminId = $this->requireAdmin();
        $tenantId = $this->getTenantId();

        $from = filter_var(request()->input('from'), FILTER_VALIDATE_INT, ['options' => ['min_range' => 0]]);
        $count = filter_var(request()->input('count'), FILTER_VALIDATE_INT, ['options' => ['min_range' => 1]]);
        if ($from === false) {
            return $this->respondWithError('VALIDATION_ERROR', __('api.validation_failed'), 'from', 422);
        }
        if ($count === false) {
            return $this->respondWithError('VALIDATION_ERROR', __('api.validation_failed'), 'count', 422);
        }
        $attested = request()->has(AdminCreatedAccountAdmission::ATTESTATION_FIELD)
            ? AdminCreatedAccountAdmission::attestationFromInput(request()->all())
            : null;
        // `stop: true` — the admin pressed Stop; the held rows are discarded now.
        $stop = request()->boolean('stop');
        // Like the attestation: read on the first batch only; absent means no invitations.
        $sendInvitations = request()->has('send_invitations')
            ? filter_var(request()->input('send_invitations'), FILTER_VALIDATE_BOOLEAN)
            : null;

        try {
            return $this->respondWithData($this->runner->runBatch($importId, $tenantId, $adminId, $from, $count, $attested, $stop, $sendInvitations));
        } catch (MemberImportBusy) {
            return $this->respondWithError('IMPORT_BUSY', __('api.member_import_busy'), null, 409);
        } catch (MemberImportOutOfOrder) {
            return $this->respondWithError('IMPORT_OUT_OF_ORDER', __('api.member_import_out_of_order'), 'from', 409);
        } catch (MemberImportNotFound) {
            return $this->respondWithError('IMPORT_NOT_FOUND', __('api.member_import_not_found'), null, 404);
        }
    }

    /**
     * POST /api/v2/admin/members/import/{importId}/undo — take the import back
     * (MemberImportUndo). Refused while the import is still running: press Stop
     * first, so no batch is writing members as they are removed.
     */
    public function undo(string $importId): JsonResponse
    {
        $adminId = $this->requireAdmin();
        $tenantId = $this->getTenantId();
        // The browser repeats this call until the undo says it is done (8 s of work a time).
        $this->rateLimit('member_import_undo', 60, 60);

        $lock = MemberImportSession::lock($importId);
        if (!$lock->get()) {
            return $this->respondWithError('IMPORT_BUSY', __('api.member_import_busy'), null, 409);
        }
        try {
            $session = MemberImportSession::load($importId, $tenantId, $adminId);
            if ($session !== null && $session['status'] === 'running') {
                return $this->respondWithError('IMPORT_BUSY', __('api.member_import_busy'), null, 409);
            }
            if ($session !== null) {
                // Whatever was left to import is not wanted any more.
                $session['status'] = 'stopped';
                MemberImportSession::save($session);
                MemberImportSession::discardRows($session);
            }

            return $this->respondWithData($this->undo->undo($importId, $tenantId, $adminId));
        } finally {
            $lock->release();
        }
    }

    /** GET /api/v2/admin/members/import/template — the header row only. */
    public function template(): Response
    {
        $this->requireAdmin();

        return response("\xEF\xBB\xBF" . implode(',', MemberImportFile::COLUMNS) . "\n", 200, [
            'Content-Type' => 'text/csv; charset=utf-8',
            'Content-Disposition' => 'attachment; filename="member_import_template.csv"',
        ]);
    }

    /**
     * GET /api/v2/admin/members/export — every member in the template's
     * columns, for importing into another community (MemberExportCsv).
     * Every member's email, phone and balance leave the platform, so the
     * export is recorded before a byte is sent; if it cannot be recorded,
     * nothing is sent.
     */
    public function export(): StreamedResponse
    {
        $adminId = $this->requireAdmin();
        $tenantId = $this->getTenantId();
        // Per administrator, like the other exports that stream a whole table.
        $this->rateLimit('member_export', self::EXPORTS_PER_WINDOW, self::EXPORT_WINDOW_SECONDS);

        $rows = MemberExportCsv::count($tenantId);
        ActivityLog::log($adminId, 'admin_member_export', "Exported {$rows} members in the import template's columns");
        $this->audit->logAction($tenantId, MemberExportCsv::AUDIT_ACTION, $adminId, ['rows' => $rows]);

        return response()->streamDownload(static function () use ($tenantId): void {
            $out = fopen('php://output', 'wb');
            MemberExportCsv::write($out, $tenantId);
            fclose($out);
        }, 'members-for-import-' . now()->format('Y-m-d') . '.csv', [
            'Content-Type' => 'text/csv; charset=utf-8',
        ]);
    }
}
