<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

namespace App\Http\Controllers\Api;

use App\Core\EmailTemplateBuilder;
use App\Core\TenantContext;
use App\I18n\LocaleContext;
use App\Models\ActivityLog;
use App\Models\Notification;
use App\Services\EmailDispatchService;
use App\Services\InsuranceCertificateService;
use Illuminate\Http\JsonResponse;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Log;

/**
 * AdminInsuranceCertificateController -- Admin insurance certificate management.
 *
 * All methods require admin authentication.
 * Uses InsuranceCertificateService static methods for all operations.
 */
class AdminInsuranceCertificateController extends BaseApiController
{
    protected bool $isV2Api = true;

    public function __construct(
        private readonly InsuranceCertificateService $insuranceCertificateService,
    ) {}

    /** GET /api/v2/admin/insurance-certificates */
    public function list(): JsonResponse
    {
        $this->requireBrokerOrAdmin();

        try {
            $filters = [
                'status' => $this->query('status'),
                'insurance_type' => $this->query('insurance_type'),
                'search' => $this->query('search'),
                'expiring_soon' => $this->queryBool('expiring_soon'),
                'expired' => $this->queryBool('expired'),
                'page' => $this->queryInt('page', 1, 1),
                'per_page' => $this->queryInt('per_page', 25, 10, 100),
            ];

            $result = $this->insuranceCertificateService->getAll($filters);

            return $this->respondWithPaginatedCollection(
                $result['data'],
                $result['pagination']['total'],
                $result['pagination']['page'],
                $result['pagination']['per_page']
            );
        } catch (\Exception $e) {
            return $this->respondWithPaginatedCollection([], 0, 1, 25);
        }
    }

    /** GET /api/v2/admin/insurance-certificates/stats */
    public function stats(): JsonResponse
    {
        $this->requireBrokerOrAdmin();
        return $this->respondWithData($this->insuranceCertificateService->getStats());
    }

    /** GET /api/v2/admin/insurance-certificates/{id} */
    public function show(int $id): JsonResponse
    {
        $this->requireBrokerOrAdmin();

        try {
            $record = $this->insuranceCertificateService->getById($id);
            if (!$record) {
                return $this->respondWithError('NOT_FOUND', __('api.insurance_cert_not_found'), null, 404);
            }
            return $this->respondWithData($record);
        } catch (\Exception $e) {
            return $this->respondWithError('SERVER_ERROR', __('api.insurance_cert_fetch_failed'), null, 500);
        }
    }

    /** POST /api/v2/admin/insurance-certificates */
    public function store(): JsonResponse
    {
        $adminId = $this->requireBrokerOrAdmin();

        $userId = $this->inputInt('user_id');
        $insuranceType = $this->input('insurance_type');

        if (!$userId) {
            return $this->respondWithError('VALIDATION_ERROR', __('api.user_id_required'), 'user_id', 422);
        }

        // Tenant integrity: user_id MUST belong to the caller's tenant. Without
        // this check a broker could pass a user_id from another tenant and
        // create an insurance row whose tenant_id (TenantContext) doesn't match
        // the user's actual tenant — silent cross-tenant data leak. Same
        // pattern as AdminVettingController::store.
        $tenantId = TenantContext::getId();
        $userExists = DB::selectOne(
            "SELECT id FROM users WHERE id = ? AND tenant_id = ?",
            [$userId, $tenantId]
        );
        if (!$userExists) {
            return $this->respondWithError('NOT_FOUND', __('api.user_not_found'), 'user_id', 404);
        }

        $validTypes = ['public_liability', 'professional_indemnity', 'employers_liability',
                        'product_liability', 'personal_accident', 'other'];
        if ($insuranceType && !in_array($insuranceType, $validTypes, true)) {
            return $this->respondWithError('VALIDATION_ERROR', __('api.invalid_insurance_type'), 'insurance_type');
        }

        $validStatuses = ['pending', 'submitted', 'verified', 'expired', 'rejected', 'revoked'];
        $status = $this->input('status', 'pending');
        if (!in_array($status, $validStatuses, true)) {
            return $this->respondWithError('VALIDATION_ERROR', __('api.invalid_status'), 'status');
        }

        try {
            $data = [
                'user_id' => $userId,
                'insurance_type' => $insuranceType ?? 'public_liability',
                'status' => $status,
                'provider_name' => $this->input('provider_name'),
                'start_date' => $this->input('start_date'),
                'expiry_date' => $this->input('expiry_date'),
            ];

            $id = $this->insuranceCertificateService->create($data);
            $record = $this->insuranceCertificateService->getById($id);

            ActivityLog::log($adminId, 'insurance_cert_created', "Created insurance certificate #{$id} for user #{$userId} ({$data['insurance_type']})", false, null, 'admin', 'insurance_cert', $id);

            return $this->respondWithData($record, null, 201);
        } catch (\Exception $e) {
            return $this->respondWithError('SERVER_ERROR', __('api.insurance_cert_create_failed'), null, 500);
        }
    }

    /** PUT /api/v2/admin/insurance-certificates/{id} */
    public function update(int $id): JsonResponse
    {
        $adminId = $this->requireBrokerOrAdmin();

        try {
            $existing = $this->insuranceCertificateService->getById($id);
            if (!$existing) {
                return $this->respondWithError('NOT_FOUND', __('api.insurance_cert_not_found'), null, 404);
            }

            $allInput = $this->getAllInput();

            if (array_key_exists('insurance_type', $allInput) && $allInput['insurance_type'] !== null) {
                $validTypes = ['public_liability', 'professional_indemnity', 'employers_liability',
                                'product_liability', 'personal_accident', 'other'];
                if (!in_array($allInput['insurance_type'], $validTypes, true)) {
                    return $this->respondWithError('VALIDATION_ERROR', __('api.invalid_insurance_type'), 'insurance_type');
                }
            }

            if (array_key_exists('status', $allInput) && $allInput['status'] !== null) {
                $validStatuses = ['pending', 'submitted', 'verified', 'expired', 'rejected', 'revoked'];
                if (!in_array($allInput['status'], $validStatuses, true)) {
                    return $this->respondWithError('VALIDATION_ERROR', __('api.invalid_status'), 'status');
                }
            }

            $data = [];
            $allowed = ['insurance_type', 'provider_name', 'start_date', 'expiry_date', 'status'];
            foreach ($allowed as $field) {
                if (array_key_exists($field, $allInput)) {
                    $data[$field] = $allInput[$field];
                }
            }

            if (empty($data)) {
                return $this->respondWithError('VALIDATION_ERROR', __('api.no_valid_fields'));
            }

            $this->insuranceCertificateService->update($id, $data);
            $record = $this->insuranceCertificateService->getById($id);

            $changedFields = implode(',', array_keys($data));
            ActivityLog::log($adminId, 'insurance_cert_updated', "Updated insurance certificate #{$id} ({$changedFields})", false, null, 'admin', 'insurance_cert', $id);

            return $this->respondWithData($record);
        } catch (\Exception $e) {
            return $this->respondWithError('SERVER_ERROR', __('api.insurance_cert_update_failed'), null, 500);
        }
    }

    /** POST /api/v2/admin/insurance-certificates/{id}/verify */
    public function verify(int $id): JsonResponse
    {
        $adminId = $this->requireBrokerOrAdmin();

        try {
            $existing = $this->insuranceCertificateService->getById($id);
            if (!$existing) {
                return $this->respondWithError('NOT_FOUND', __('api.insurance_cert_not_found'), null, 404);
            }
            if ($existing['status'] === 'verified') {
                return $this->respondWithError('INVALID_STATUS', __('api.certificate_already_verified'));
            }

            $this->insuranceCertificateService->verify($id, $adminId);

            ActivityLog::log($adminId, 'insurance_cert_verified', "Verified insurance certificate #{$id} for user #{$existing['user_id']}", false, null, 'admin', 'insurance_cert', $id);

            // Notify the user that their insurance certificate was verified.
            // Wrapped in LocaleContext so the bell renders in the recipient's
            // preferred_language, not the broker's. See CLAUDE.md
            // "EMAIL & NOTIFICATION LOCALE — MUST WRAP IN LocaleContext".
            $emailSent = false;
            try {
                if (!empty($existing['user_id'])) {
                    $userId = (int) $existing['user_id'];
                    $recipient = DB::selectOne(
                        "SELECT id, email, first_name, name, preferred_language FROM users WHERE id = ? AND tenant_id = ?",
                        [$userId, TenantContext::getId()]
                    );
                    LocaleContext::withLocale($recipient, function () use ($userId) {
                        Notification::createNotification(
                            $userId,
                            __('api_controllers_3.admin_bells.insurance_verified'),
                            '/notifications',
                            'moderation',
                            true
                        );
                        \App\Services\NotificationDispatcher::fanOutPush((int) ($userId), 'moderation', __('api_controllers_3.admin_bells.insurance_verified'), '/notifications');
                    });
                    $emailSent = (bool) LocaleContext::withLocale(
                        $recipient,
                        fn () => $this->sendInsuranceDecisionEmail($recipient, $existing, 'verified')
                    );
                }
            } catch (\Throwable $e) {
                Log::warning("AdminInsuranceCertificateController::verify notification failed for cert #{$id}: " . $e->getMessage());
            }

            $record = $this->insuranceCertificateService->getById($id);

            $record['email_sent'] = $emailSent;
            return $this->respondWithData($record);
        } catch (\Exception $e) {
            return $this->respondWithError('SERVER_ERROR', __('api.insurance_cert_verify_failed'), null, 500);
        }
    }

    /** POST /api/v2/admin/insurance-certificates/{id}/reject */
    public function reject(int $id): JsonResponse
    {
        $adminId = $this->requireBrokerOrAdmin();
        $reason = $this->input('reason', '');

        if (empty($reason)) {
            return $this->respondWithError('VALIDATION_ERROR', __('api.reason_required_reject_cert'), 'reason', 422);
        }

        try {
            $existing = $this->insuranceCertificateService->getById($id);
            if (!$existing) {
                return $this->respondWithError('NOT_FOUND', __('api.insurance_cert_not_found'), null, 404);
            }

            $this->insuranceCertificateService->reject($id, $adminId, $reason);

            ActivityLog::log($adminId, 'insurance_cert_rejected', "Rejected insurance certificate #{$id}: {$reason}", false, null, 'admin', 'insurance_cert', $id);

            // Notify the user that their insurance certificate was not
            // approved — wrapped in LocaleContext so the bell renders in
            // the recipient's preferred_language.
            $emailSent = false;
            try {
                if (!empty($existing['user_id'])) {
                    $userId = (int) $existing['user_id'];
                    $recipient = DB::selectOne(
                        "SELECT id, email, first_name, name, preferred_language FROM users WHERE id = ? AND tenant_id = ?",
                        [$userId, TenantContext::getId()]
                    );
                    LocaleContext::withLocale($recipient, function () use ($userId) {
                        Notification::createNotification(
                            $userId,
                            __('api_controllers_3.admin_bells.insurance_rejected'),
                            '/notifications',
                            'moderation',
                            true
                        );
                        \App\Services\NotificationDispatcher::fanOutPush((int) ($userId), 'moderation', __('api_controllers_3.admin_bells.insurance_rejected'), '/notifications');
                    });
                    $emailSent = (bool) LocaleContext::withLocale(
                        $recipient,
                        fn () => $this->sendInsuranceDecisionEmail($recipient, $existing, 'rejected', $reason)
                    );
                }
            } catch (\Throwable $e) {
                Log::warning("AdminInsuranceCertificateController::reject notification failed for cert #{$id}: " . $e->getMessage());
            }

            $record = $this->insuranceCertificateService->getById($id);

            $record['email_sent'] = $emailSent;
            return $this->respondWithData($record);
        } catch (\Exception $e) {
            return $this->respondWithError('SERVER_ERROR', __('api.insurance_cert_reject_failed'), null, 500);
        }
    }

    /** DELETE /api/v2/admin/insurance-certificates/{id} */
    public function destroy(int $id): JsonResponse
    {
        $adminId = $this->requireBrokerOrAdmin();

        try {
            $existing = $this->insuranceCertificateService->getById($id);
            if (!$existing) {
                return $this->respondWithError('NOT_FOUND', __('api.insurance_cert_not_found'), null, 404);
            }

            $this->insuranceCertificateService->delete($id);

            $type = $existing['insurance_type'] ?? 'unknown';
            ActivityLog::log($adminId, 'insurance_cert_deleted', "Deleted insurance certificate #{$id} ({$type})", false, null, 'admin', 'insurance_cert', $id);

            return $this->respondWithData(['deleted' => true]);
        } catch (\Exception $e) {
            return $this->respondWithError('SERVER_ERROR', __('api.insurance_cert_delete_failed'), null, 500);
        }
    }

    /** GET /api/v2/admin/insurance/user/{userId} */
    public function getUserCertificates(int $userId): JsonResponse
    {
        $this->requireBrokerOrAdmin();

        try {
            $records = $this->insuranceCertificateService->getUserCertificates($userId);
            return $this->respondWithData($records);
        } catch (\Exception $e) {
            return $this->respondWithData([]);
        }
    }

    private function sendInsuranceDecisionEmail(?object $recipient, array $certificate, string $decision, ?string $reason = null): bool
    {
        if (!$recipient || empty($recipient->email)) {
            return false;
        }

        $tenantId = TenantContext::getId();
        $community = TenantContext::getName();
        $firstName = $recipient->first_name ?? $recipient->name ?? __('emails.common.fallback_name');
        $type = (string) ($certificate['insurance_type'] ?? 'other');
        $typeLabel = __("emails_misc.insurance.type.{$type}");
        if ($typeLabel === "emails_misc.insurance.type.{$type}") {
            $typeLabel = __('emails_misc.insurance.type.other');
        }

        $builder = EmailTemplateBuilder::make()
            ->theme($decision === 'verified' ? 'success' : 'warning')
            ->title(__("emails_misc.insurance.{$decision}_title"))
            ->previewText(__("emails_misc.insurance.{$decision}_preview", ['type' => $typeLabel, 'community' => $community]))
            ->greeting($firstName)
            ->paragraph(__("emails_misc.insurance.{$decision}_body", ['type' => $typeLabel, 'community' => $community]));

        if ($decision === 'rejected' && $reason !== null && $reason !== '') {
            $builder->paragraph('<strong>' . __('emails_misc.insurance.reason_label') . ':</strong> ' . htmlspecialchars($reason, ENT_QUOTES, 'UTF-8'));
        }

        $html = $builder
            ->button(__('emails_misc.insurance.cta'), TenantContext::getFrontendUrl() . TenantContext::getSlugPrefix() . '/dashboard')
            ->render();

        return EmailDispatchService::sendRaw(
            (string) $recipient->email,
            __("emails_misc.insurance.{$decision}_subject", ['type' => $typeLabel, 'community' => $community]),
            $html,
            null,
            null,
            null,
            'insurance_certificate',
            ['tenant_id' => $tenantId]
        );
    }
}
