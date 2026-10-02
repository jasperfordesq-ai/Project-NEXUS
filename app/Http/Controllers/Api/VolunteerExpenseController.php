<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

namespace App\Http\Controllers\Api;

use Illuminate\Http\JsonResponse;
use Illuminate\Http\Response;
use App\Http\Requests\Volunteering\SubmitExpenseRequest;
use App\Services\VolunteerExpenseService;
use App\Services\VolunteeringConfigurationService;
use App\Core\TenantContext;
use App\Support\CsvExportSanitizer;
use Illuminate\Database\QueryException;
use Illuminate\Support\Facades\Log;
use Illuminate\Support\Facades\Storage;

/**
 * VolunteerExpenseController -- Expense submissions, reviews, policies, and exports.
 */
class VolunteerExpenseController extends BaseApiController
{
    protected bool $isV2Api = true;

    public function __construct(
        private readonly VolunteerExpenseService $volunteerExpenseService,
    ) {}

    private function ensureFeature(): void
    {
        if (!TenantContext::hasFeature('volunteering')) {
            throw new \Illuminate\Http\Exceptions\HttpResponseException(
                $this->respondWithError('FEATURE_DISABLED', __('api.volunteering_feature_disabled'), null, 403)
            );
        }
        if (! VolunteeringConfigurationService::get(VolunteeringConfigurationService::CONFIG_EXPENSES_ENABLED, true)) {
            throw new \Illuminate\Http\Exceptions\HttpResponseException(
                $this->respondWithError('FEATURE_DISABLED', __('api.module_disabled_for_community'), null, 403)
            );
        }
    }

    private function getErrorStatus(array $errors): int
    {
        foreach ($errors as $error) {
            $code = $error['code'] ?? '';
            if ($code === 'NOT_FOUND') return 404;
            if ($code === 'FORBIDDEN') return 403;
            if ($code === 'ALREADY_EXISTS') return 409;
            if ($code === 'FEATURE_DISABLED') return 403;
        }
        return 400;
    }

    public function myExpenses(): JsonResponse
    {
        $this->ensureFeature();
        $userId = $this->getUserId();
        $this->rateLimit('vol_expenses_list', 30, 60);

        $filters = [
            'user_id' => $userId,
            'status' => $this->query('status'),
            'date_from' => $this->query('date_from'),
            'date_to' => $this->query('date_to'),
            'cursor' => $this->query('cursor'),
            'limit' => $this->queryInt('per_page', 20, 1, 50),
        ];

        $result = $this->volunteerExpenseService->getExpenses($filters);
        // Aggregate over the FULL user-scoped set, not just the current page — a
        // page-scoped reduce under-counts once there is more than one page.
        // getExpenseStats honours the same filters ($filters already carries the
        // current user_id) and is tenant-scoped via the VolExpense global scope.
        $stats = $this->volunteerExpenseService->getExpenseStats($filters);

        return $this->respondWithData([
            'expenses' => $result['items'],
            'items' => $result['items'],
            'stats' => $stats,
            'cursor' => $result['cursor'],
            'has_more' => $result['has_more'],
        ]);
    }

    public function submitExpense(SubmitExpenseRequest $request): JsonResponse
    {
        $this->ensureFeature();
        $userId = $this->getUserId();
        $this->rateLimit('vol_expense_submit', 10, 3600);

        $data = $this->getAllInput();
        unset($data['receipt'], $data['receipt_path'], $data['receipt_filename']);
        $data['idempotency_key'] = $request->header('Idempotency-Key') ?? $this->input('idempotency_key');

        $storedReceiptPath = null;
        $receipt = request()->file('receipt');
        if ($receipt) {
            $tenantId = TenantContext::getId();
            $storedReceiptPath = $receipt->store("volunteer-expenses/{$tenantId}", 'local');
            $data['receipt_path'] = $storedReceiptPath;
            $data['receipt_filename'] = basename((string) $receipt->getClientOriginalName());
        }

        try {
            $result = $this->volunteerExpenseService->submitExpense($userId, $data);
            if ($storedReceiptPath !== null && ($result['receipt_path'] ?? null) !== $storedReceiptPath) {
                $this->deleteStoredReceipt($storedReceiptPath);
            }
        } catch (\InvalidArgumentException $e) {
            $this->deleteStoredReceipt($storedReceiptPath);
            return $this->respondWithError('VALIDATION_ERROR', $e->getMessage(), null, 422);
        } catch (QueryException $e) {
            // QueryException extends RuntimeException; left to the branch below it
            // answered 400 with the SQL statement and its bindings in the body (F-016).
            $this->deleteStoredReceipt($storedReceiptPath);
            Log::error('[VolunteerExpenseController] submitExpense database failure', ['error' => $e->getMessage()]);
            return $this->respondWithError('SERVER_ERROR', __('api.unexpected_error'), null, 500);
        } catch (\RuntimeException $e) {
            $this->deleteStoredReceipt($storedReceiptPath);
            $status = (int) $e->getCode();
            if (!in_array($status, [403, 404, 409, 429], true)) {
                $status = 400;
            }
            $code = match ($status) {
                403 => 'FORBIDDEN',
                404 => 'NOT_FOUND',
                409 => 'IDEMPOTENCY_CONFLICT',
                429 => 'TOO_MANY_ATTEMPTS',
                default => 'VALIDATION_ERROR',
            };
            return $this->respondWithError($code, $e->getMessage(), null, $status);
        }

        if (isset($result['error'])) {
            $this->deleteStoredReceipt($storedReceiptPath);
            return $this->respondWithError('VALIDATION_ERROR', $result['error'], null, 422);
        }

        return $this->respondWithData($result, null, 201);
    }

    private function deleteStoredReceipt(?string $path): void
    {
        if ($path) {
            Storage::disk('local')->delete($path);
        }
    }

    public function getExpense($id): JsonResponse
    {
        $this->ensureFeature();
        $userId = $this->getUserId();
        $this->rateLimit('vol_expense_get', 30, 60);

        $expense = $this->volunteerExpenseService->getExpense((int) $id);
        if (!$expense || (int) $expense['user_id'] !== $userId) {
            return $this->respondWithError('NOT_FOUND', __('api.expense_not_found'), null, 404);
        }

        return $this->respondWithData($expense);
    }

    public function adminExpenses(): JsonResponse
    {
        $this->ensureFeature();
        $this->requireAdmin();
        $this->rateLimit('vol_admin_expenses', 30, 60);

        $filters = [
            'status' => $this->query('status'),
            'user_id' => $this->query('user_id') ? (int) $this->query('user_id') : null,
            'organization_id' => $this->query('organization_id') ? (int) $this->query('organization_id') : null,
            'date_from' => $this->query('date_from'),
            'date_to' => $this->query('date_to'),
            'cursor' => $this->query('cursor'),
            'limit' => $this->queryInt('per_page', 20, 1, 50),
        ];

        $result = $this->volunteerExpenseService->getExpenses($filters);
        $stats = $this->volunteerExpenseService->getExpenseStats($filters);

        return $this->respondWithData([
            'items' => $result['items'],
            'stats' => $stats,
            'cursor' => $result['cursor'],
            'has_more' => $result['has_more'],
        ]);
    }

    /**
     * Stream a submitted expense receipt to a reviewing admin.
     *
     * Receipts live on the private 'local' disk under
     * volunteer-expenses/{tenantId}/... with no public URL, so the admin UI
     * previously linked to a path that always 404'd. This mirrors the credential
     * download: admin-gated, tenant-scoped, prefix- and traversal-checked.
     */
    public function downloadReceipt($id): \Symfony\Component\HttpFoundation\StreamedResponse|JsonResponse
    {
        $this->ensureFeature();
        $this->requireAdmin();
        $this->rateLimit('vol_expense_receipt_download', 30, 60);

        $tenantId = TenantContext::getId();
        $expense = \Illuminate\Support\Facades\DB::selectOne(
            "SELECT id, receipt_path, receipt_filename FROM vol_expenses WHERE id = ? AND tenant_id = ?",
            [(int) $id, $tenantId]
        );

        return $this->streamReceipt($expense, $tenantId);
    }

    /**
     * Stream a claim's receipt from the private disk, or a 404. Shared by the
     * admin and organisation routes so both keep the same prefix and traversal checks.
     */
    private function streamReceipt(?object $expense, int $tenantId): \Symfony\Component\HttpFoundation\StreamedResponse|JsonResponse
    {
        if (!$expense || empty($expense->receipt_path)) {
            return $this->respondWithError('NOT_FOUND', __('api.expense_not_found'), null, 404);
        }

        $path = (string) $expense->receipt_path;
        $expectedPrefix = "volunteer-expenses/{$tenantId}/";
        if (!str_starts_with($path, $expectedPrefix) || str_contains($path, '..')) {
            return $this->respondWithError('NOT_FOUND', __('api.expense_not_found'), null, 404);
        }
        if (!Storage::disk('local')->exists($path)) {
            return $this->respondWithError('NOT_FOUND', __('api.expense_not_found'), null, 404);
        }

        // Storage::download() is driver-agnostic (streams from any disk, incl. the
        // fake disk used in tests) and sets the Content-Disposition for us.
        return Storage::disk('local')->download(
            $path,
            basename((string) ($expense->receipt_filename ?: basename($path)))
        );
    }

    public function reviewExpense($id): JsonResponse
    {
        $this->ensureFeature();
        $adminId = $this->requireAdmin();
        $this->rateLimit('vol_expense_review', 30, 60);

        $data = $this->getAllInput();
        $status = $data['status'] ?? '';

        $allowedStatuses = ['approved', 'rejected', 'paid'];
        if (!in_array($status, $allowedStatuses, true)) {
            return $this->respondWithError('VALIDATION_ERROR', __('api.invalid_status_allowed', ['statuses' => implode(', ', $allowedStatuses)]), 'status', 422);
        }

        // Marking a claim paid belongs to the organisation that pays it (owner
        // decision, 2 October 2026). Community admins still approve and reject
        // here; payment is recorded from the organisation dashboard.
        if ($status === 'paid') {
            return $this->respondWithError('FORBIDDEN', __('api.vol_expense_paid_by_organisation'), 'status', 403);
        }

        try {
            $result = $this->volunteerExpenseService->reviewExpense((int) $id, $adminId, $status, $data['review_notes'] ?? null);
        } catch (\InvalidArgumentException $e) {
            return $this->respondWithError('FORBIDDEN', $e->getMessage(), null, 403);
        }

        if (!$result) {
            // The service refuses a transition from the wrong state (approve/reject
            // need 'pending', paid needs 'approved') the same way it refuses a
            // missing row. Only the missing row is a 404.
            if ($this->volunteerExpenseService->getExpense((int) $id) !== null) {
                $message = $status === 'paid'
                    ? __('api.vol_expense_not_approved')
                    : __('api.vol_expense_not_pending');
                return $this->respondWithError('INVALID_STATE', $message, 'status', 409);
            }
            return $this->respondWithError('NOT_FOUND', __('api.expense_not_found_or_invalid'), null, 404);
        }

        return $this->respondWithData(['success' => true]);
    }

    /**
     * The current user if they administer this organisation (creator, or an
     * active owner/admin member), otherwise null. Community administrators are
     * deliberately not included: they oversee claims from the admin screen.
     */
    private function organisationAdminId(int $orgId): ?int
    {
        $userId = $this->getUserId();

        return VolunteerExpenseService::isOrganisationAdmin(TenantContext::getId(), $userId, $orgId)
            ? $userId
            : null;
    }

    /**
     * A claim as an organisation admin sees it: no volunteer email, no internal
     * receipt path, no embedded user record.
     */
    private function organisationView(array $item): array
    {
        return [
            'id' => (int) $item['id'],
            'user_id' => (int) $item['user_id'],
            'volunteer_name' => $item['volunteer_name'] ?? '',
            'avatar_url' => $item['user']['avatar_url'] ?? null,
            'organization_id' => (int) $item['organization_id'],
            'opportunity_id' => isset($item['opportunity_id']) ? (int) $item['opportunity_id'] : null,
            'expense_type' => $item['expense_type'] ?? '',
            'amount' => (float) ($item['amount'] ?? 0),
            'currency' => $item['currency'] ?? '',
            'description' => $item['description'] ?? '',
            'status' => $item['status'] ?? '',
            'has_receipt' => !empty($item['receipt_path']),
            'submitted_at' => $item['submitted_at'] ?? null,
            'reviewed_by' => isset($item['reviewed_by']) ? (int) $item['reviewed_by'] : null,
            'reviewed_at' => $item['reviewed_at'] ?? null,
            'review_notes' => $item['review_notes'] ?? null,
            'paid_at' => $item['paid_at'] ?? null,
            'payment_reference' => $item['payment_reference'] ?? null,
        ];
    }

    /** GET /v2/volunteering/organisations/{id}/expenses — the organisation's claims. */
    public function orgExpenses($id): JsonResponse
    {
        $this->ensureFeature();
        $this->rateLimit('vol_org_expenses', 60, 60);
        $orgId = (int) $id;
        if ($this->organisationAdminId($orgId) === null) {
            return $this->respondWithError('FORBIDDEN', __('api_controllers_2.volunteer.access_denied'), null, 403);
        }

        $filters = [
            'organization_id' => $orgId,
            'status' => $this->query('status'),
            'cursor' => $this->query('cursor'),
            'limit' => $this->queryInt('per_page', 20, 1, 50),
        ];

        $result = $this->volunteerExpenseService->getExpenses($filters);
        $stats = $this->volunteerExpenseService->getExpenseStats($filters);

        return $this->respondWithData([
            'items' => array_map(fn (array $item) => $this->organisationView($item), $result['items']),
            'stats' => $stats,
            'cursor' => $result['cursor'],
            'has_more' => $result['has_more'],
        ]);
    }

    /**
     * PUT /v2/volunteering/organisations/{id}/expenses/{expenseId}
     * Approve or reject a pending claim, or mark an approved claim paid.
     */
    public function orgReviewExpense($id, $expenseId): JsonResponse
    {
        $this->ensureFeature();
        $this->rateLimit('vol_org_expense_review', 30, 60);
        $orgId = (int) $id;
        $expenseId = (int) $expenseId;
        $reviewerId = $this->organisationAdminId($orgId);
        if ($reviewerId === null) {
            return $this->respondWithError('FORBIDDEN', __('api_controllers_2.volunteer.access_denied'), null, 403);
        }

        $data = $this->getAllInput();
        $status = $data['status'] ?? '';
        $allowedStatuses = ['approved', 'rejected', 'paid'];
        if (!in_array($status, $allowedStatuses, true)) {
            return $this->respondWithError('VALIDATION_ERROR', __('api.invalid_status_allowed', ['statuses' => implode(', ', $allowedStatuses)]), 'status', 422);
        }

        // A claim made to a different organisation, or in a different community,
        // is "not found" from here — never "forbidden", which would confirm it exists.
        $expense = $this->volunteerExpenseService->getExpense($expenseId);
        if ($expense === null || (int) $expense['organization_id'] !== $orgId) {
            return $this->respondWithError('NOT_FOUND', __('api.expense_not_found'), null, 404);
        }

        try {
            $result = $status === 'paid'
                ? $this->volunteerExpenseService->markPaid($expenseId, $reviewerId, $data['payment_reference'] ?? null, $orgId)
                : $this->volunteerExpenseService->reviewExpense($expenseId, $reviewerId, $status, $data['review_notes'] ?? null, $orgId);
        } catch (\InvalidArgumentException $e) {
            return $this->respondWithError('FORBIDDEN', $e->getMessage(), null, 403);
        }

        if (!$result) {
            $message = $status === 'paid'
                ? __('api.vol_expense_not_approved')
                : __('api.vol_expense_not_pending');
            return $this->respondWithError('INVALID_STATE', $message, 'status', 409);
        }

        return $this->respondWithData(['success' => true]);
    }

    /** GET /v2/volunteering/organisations/{id}/expenses/{expenseId}/receipt */
    public function orgDownloadReceipt($id, $expenseId): \Symfony\Component\HttpFoundation\StreamedResponse|JsonResponse
    {
        $this->ensureFeature();
        $this->rateLimit('vol_org_expense_receipt', 30, 60);
        $orgId = (int) $id;
        if ($this->organisationAdminId($orgId) === null) {
            return $this->respondWithError('FORBIDDEN', __('api_controllers_2.volunteer.access_denied'), null, 403);
        }

        $tenantId = TenantContext::getId();
        $expense = \Illuminate\Support\Facades\DB::selectOne(
            "SELECT id, receipt_path, receipt_filename FROM vol_expenses WHERE id = ? AND tenant_id = ? AND organization_id = ?",
            [(int) $expenseId, $tenantId, $orgId]
        );

        return $this->streamReceipt($expense, $tenantId);
    }

    /** Returns raw CSV for expense export */
    public function exportExpenses(): Response
    {
        $this->ensureFeature();
        $this->requireAdmin();

        $filters = [
            'status' => $this->query('status'),
            'date_from' => $this->query('date_from'),
            'date_to' => $this->query('date_to'),
        ];

        $rows = $this->volunteerExpenseService->exportExpenses(TenantContext::getId(), $filters);
        $handle = fopen('php://temp', 'r+');
        if (!empty($rows)) {
            \App\Support\CsvExportSanitizer::put($handle, array_keys((array) $rows[0]));
            foreach ($rows as $row) {
                \App\Support\CsvExportSanitizer::put($handle, CsvExportSanitizer::row(array_values((array) $row)));
            }
        }
        rewind($handle);
        $csv = stream_get_contents($handle);
        fclose($handle);

        return response($csv, 200)
            ->header('Content-Type', 'text/csv')
            ->header('Content-Disposition', 'attachment; filename="volunteer_expenses_' . date('Y-m-d') . '.csv"');
    }

    public function getExpensePolicies(): JsonResponse
    {
        $this->ensureFeature();
        $this->requireAdmin();

        $policies = $this->volunteerExpenseService->getPolicies(TenantContext::getId());
        return $this->respondWithData($policies);
    }

    public function updateExpensePolicy(): JsonResponse
    {
        $this->ensureFeature();
        $this->requireAdmin();
        $this->rateLimit('vol_expense_policy_update', 10, 60);

        $data = $this->getAllInput();
        if (empty($data['expense_type']) && !empty($data['type'])) {
            $data['expense_type'] = $data['type'];
        }
        // Receipt requirements are threshold-based (requires_receipt_above:
        // 0 = never required, >0 = required above that amount — see the
        // !empty() check in VolunteerExpenseService::validate). The old
        // boolean requires_receipt alias mapped true to 0, which the
        // validation reads as "never required" — a silent no-op. Nothing in
        // the codebase sends it; reject rather than mis-apply it.
        if (array_key_exists('requires_receipt', $data) && !array_key_exists('requires_receipt_above', $data)) {
            return $this->respondWithError('VALIDATION_ERROR', __('api.missing_required_field', ['field' => 'requires_receipt_above']), 'requires_receipt_above', 422);
        }

        if (empty($data['expense_type'])) {
            return $this->respondWithError('VALIDATION_ERROR', __('api.missing_required_field', ['field' => 'expense_type']), 'expense_type', 422);
        }

        $policyFields = ['max_amount', 'max_monthly', 'requires_receipt_above', 'requires_approval'];
        $hasPolicyField = false;
        foreach ($policyFields as $field) {
            if (array_key_exists($field, $data)) {
                $hasPolicyField = true;
                break;
            }
        }
        if (!$hasPolicyField) {
            return $this->respondWithError('VALIDATION_ERROR', __('api.at_least_one_policy_field_required'), null, 422);
        }

        $result = $this->volunteerExpenseService->updatePolicy((int)($data['id'] ?? 0), $data, TenantContext::getId());
        if (!$result) {
            // A 200 with {success:false} reads as success to the admin UI's
            // envelope check — failures must be real error responses.
            return $this->respondWithError('NOT_FOUND', __('api.vol_expense_policy_not_found'), null, 404);
        }
        return $this->respondWithData(['success' => true]);
    }
}
