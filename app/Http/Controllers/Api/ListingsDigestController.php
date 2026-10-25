<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

namespace App\Http\Controllers\Api;

use App\Core\TenantContext;
use App\Jobs\SendListingsDigestNow;
use App\Services\AuditLogService;
use App\Services\ListingsDigestService;
use Illuminate\Http\JsonResponse;
use Illuminate\Support\Facades\Log;

/**
 * The offers & requests round-up email (App\Services\ListingsDigestService).
 *
 * Member:  GET/PUT /v2/users/me/listings-digest           — their own frequency
 * Admin:   GET/PUT /v2/admin/listings-digest              — community default + reach
 *          GET     /v2/admin/listings-digest/preview      — the email as the admin would get it
 *          POST    /v2/admin/listings-digest/send         — send every current offer and request now
 */
class ListingsDigestController extends BaseApiController
{
    protected bool $isV2Api = true;

    public function __construct(
        private readonly ListingsDigestService $digest,
    ) {}

    // ── Member ──────────────────────────────────────────────────────

    public function showMine(): JsonResponse
    {
        $userId = $this->requireAuth();

        return $this->respondWithData($this->digest->memberSettings($userId, TenantContext::getId()));
    }

    public function updateMine(): JsonResponse
    {
        $userId = $this->requireAuth();
        $this->rateLimit('listings_digest_member_update', 20, 60);

        $frequency = $this->getAllInput()['frequency'] ?? null;
        if (!is_string($frequency) || !in_array($frequency, ListingsDigestService::MEMBER_CHOICES, true)) {
            return $this->respondWithError('VALIDATION_ERROR', __('api_controllers_2.users.invalid_frequency'), 'frequency', 422);
        }

        return $this->respondWithData($this->digest->setMemberFrequency($userId, TenantContext::getId(), $frequency));
    }

    // ── Admin ───────────────────────────────────────────────────────

    public function adminShow(): JsonResponse
    {
        $this->requireAdmin();
        $tenantId = TenantContext::getId();

        return $this->respondWithData([
            'default_frequency' => $this->digest->communityDefault($tenantId),
            'recipient_count' => $this->digest->countRecipients($tenantId),
        ]);
    }

    public function adminUpdate(): JsonResponse
    {
        $adminId = $this->requireAdmin();
        $tenantId = TenantContext::getId();

        $frequency = $this->getAllInput()['default_frequency'] ?? null;
        if (!is_string($frequency) || !in_array($frequency, ListingsDigestService::COMMUNITY_CHOICES, true)) {
            return $this->respondWithError('VALIDATION_ERROR', __('api_controllers_2.users.invalid_frequency'), 'default_frequency', 422);
        }

        $previous = $this->digest->communityDefault($tenantId);
        $this->digest->setCommunityDefault($tenantId, $frequency);
        $this->audit($adminId, 'listings_digest_default_changed', ['from' => $previous, 'to' => $frequency]);

        return $this->respondWithData([
            'default_frequency' => $frequency,
            'recipient_count' => $this->digest->countRecipients($tenantId),
        ]);
    }

    public function adminPreview(): JsonResponse
    {
        $adminId = $this->requireAdmin();
        $mode = request()->query('mode') === 'new' ? 'new' : 'all';

        $html = $this->digest->preview(TenantContext::getId(), $adminId, $mode);
        if ($html === null) {
            return $this->respondWithError('NOT_FOUND', __('api.user_not_found'), null, 404);
        }

        return $this->respondWithData(['html' => $html]);
    }

    public function adminSend(): JsonResponse
    {
        $adminId = $this->requireAdmin();
        $this->rateLimit('admin_listings_digest_send', 2, 3600);
        $tenantId = TenantContext::getId();

        if (filter_var($this->getAllInput()['confirm'] ?? false, FILTER_VALIDATE_BOOL) !== true) {
            return $this->respondWithError('CONFIRMATION_REQUIRED', __('api_controllers_2.listings_digest.confirm_required'), 'confirm', 422);
        }

        $recipients = $this->digest->countRecipients($tenantId);
        try {
            SendListingsDigestNow::dispatch($tenantId, $adminId, 0, now()->toIso8601String());
        } catch (\Throwable $e) {
            Log::error('ListingsDigest: could not queue admin send', ['tenant_id' => $tenantId, 'error' => $e->getMessage()]);

            return $this->respondWithError('SEND_FAILED', __('api_controllers_2.listings_digest.send_failed'), null, 500);
        }

        $this->audit($adminId, 'listings_digest_send_started', ['recipient_count' => $recipients]);

        return $this->respondWithData(['queued' => true, 'recipient_count' => $recipients]);
    }

    /** @param array<string, mixed> $details */
    private function audit(int $adminId, string $action, array $details): void
    {
        try {
            app(AuditLogService::class)->logAdminAction($action, $adminId, null, $details);
        } catch (\Throwable $e) {
            Log::warning('ListingsDigest: audit log failed', ['action' => $action, 'error' => $e->getMessage()]);
        }
    }
}
