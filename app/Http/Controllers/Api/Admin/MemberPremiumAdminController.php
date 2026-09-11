<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

declare(strict_types=1);

namespace App\Http\Controllers\Api\Admin;

use App\Core\TenantContext;
use App\Http\Controllers\Api\BaseApiController;
use App\Services\DonationOperationsService;
use App\Services\DonationStripeAccountService;
use App\Services\MemberPremiumService;
use App\Services\TenantSettingsService;
use Illuminate\Http\JsonResponse;

/**
 * AG58 — Admin CRUD for donation support levels + supporter view.
 */
class MemberPremiumAdminController extends BaseApiController
{
    protected bool $isV2Api = true;

    /**
     * GET /api/v2/admin/member-premium/settings
     */
    public function settings(): JsonResponse
    {
        $this->requireAdmin();
        $tenantId = TenantContext::getId();

        return $this->respondWithData([
            'settings' => DonationStripeAccountService::settingsPayloadForTenant($tenantId),
        ]);
    }

    /**
     * PUT /api/v2/admin/member-premium/settings
     */
    public function updateSettings(TenantSettingsService $settings): JsonResponse
    {
        $this->requireAdmin();
        $tenantId = TenantContext::getId();
        $accountId = trim((string) ($this->input('stripe_connect_account_id') ?? ''));

        if ($accountId !== '' && preg_match('/^acct_[A-Za-z0-9_]+$/', $accountId) !== 1) {
            return $this->respondWithError(
                'VALIDATION_ERROR',
                __('api.member_premium_connect_account_invalid'),
                'stripe_connect_account_id',
                422,
            );
        }

        $settings->set(
            $tenantId,
            DonationStripeAccountService::SETTING_CONNECT_ACCOUNT_ID,
            DonationStripeAccountService::normalizeAccountId($accountId) ?? '',
            'string',
        );

        return $this->respondWithData([
            'settings' => DonationStripeAccountService::settingsPayloadForTenant($tenantId),
        ]);
    }

    /**
     * POST /api/v2/admin/member-premium/connect/onboarding
     */
    public function createConnectOnboarding(): JsonResponse
    {
        $this->requireAdmin();
        $tenantId = TenantContext::getId();

        $returnUrl = MemberPremiumService::safeReturnUrl(
            (string) ($this->input('return_url') ?? ''),
            '/admin/member-premium?stripe_connect=return',
        );
        $refreshUrl = MemberPremiumService::safeReturnUrl(
            (string) ($this->input('refresh_url') ?? ''),
            '/admin/member-premium?stripe_connect=refresh',
        );

        try {
            $result = DonationStripeAccountService::createOrResumeOnboarding($tenantId, $returnUrl, $refreshUrl);
        } catch (\Throwable $e) {
            return $this->respondWithError('STRIPE_CONNECT_ONBOARDING_FAILED', $e->getMessage(), null, 500);
        }

        return $this->respondWithData([
            'settings' => DonationStripeAccountService::settingsPayloadForTenant($tenantId),
            'onboarding_url' => $result['onboarding_url'],
        ]);
    }

    /**
     * GET /api/v2/admin/member-premium/tiers
     */
    public function listTiers(): JsonResponse
    {
        $this->requireAdmin();
        $tenantId = TenantContext::getId();

        $tiers = MemberPremiumService::listTiers($tenantId, includeInactive: true);
        $counts = MemberPremiumService::subscriberCountsByTier($tenantId);

        $tiers = array_map(function ($t) use ($counts) {
            $t['active_subscriber_count'] = $counts[$t['id']] ?? 0;
            return $t;
        }, $tiers);

        return $this->respondWithData(['tiers' => $tiers]);
    }

    /**
     * GET /api/v2/admin/member-premium/tiers/{id}
     */
    public function showTier(int $id): JsonResponse
    {
        $this->requireAdmin();
        $tier = MemberPremiumService::getTier(TenantContext::getId(), $id);
        if (! $tier) {
            return $this->respondNotFound('TIER_NOT_FOUND', __('api.member_premium_tier_not_found'));
        }
        return $this->respondWithData(['tier' => $tier]);
    }

    /**
     * POST /api/v2/admin/member-premium/tiers
     */
    public function createTier(): JsonResponse
    {
        $this->requireAdmin();
        $tenantId = TenantContext::getId();

        $payload = $this->validateTierPayload();
        if ($payload instanceof JsonResponse) {
            return $payload;
        }

        try {
            $id = MemberPremiumService::createTier($tenantId, $payload);
        } catch (\Throwable $e) {
            return $this->respondWithError('CREATE_FAILED', $e->getMessage(), null, 400);
        }

        $tier = MemberPremiumService::getTier($tenantId, $id);
        return $this->respondWithData(['tier' => $tier], null, 201);
    }

    /**
     * PUT /api/v2/admin/member-premium/tiers/{id}
     */
    public function updateTier(int $id): JsonResponse
    {
        $this->requireAdmin();
        $tenantId = TenantContext::getId();

        $existing = MemberPremiumService::getTier($tenantId, $id);
        if (! $existing) {
            return $this->respondNotFound('TIER_NOT_FOUND', __('api.member_premium_tier_not_found'));
        }

        $payload = $this->validateTierPayload(partial: true);
        if ($payload instanceof JsonResponse) {
            return $payload;
        }

        // If price changed, clear stale Stripe price IDs so admin re-syncs.
        if (
            (array_key_exists('monthly_price_cents', $payload) && (int) $payload['monthly_price_cents'] !== (int) $existing['monthly_price_cents'])
        ) {
            $payload['stripe_price_id_monthly'] = null;
            $payload['stripe_price_account_id'] = null;
        }
        if (
            (array_key_exists('yearly_price_cents', $payload) && (int) $payload['yearly_price_cents'] !== (int) $existing['yearly_price_cents'])
        ) {
            $payload['stripe_price_id_yearly'] = null;
            $payload['stripe_price_account_id'] = null;
        }

        // updateTier() in service ignores stripe_price_id_* fields, so clear them via direct DB update.
        if (array_key_exists('stripe_price_id_monthly', $payload) || array_key_exists('stripe_price_id_yearly', $payload) || array_key_exists('stripe_price_account_id', $payload)) {
            \Illuminate\Support\Facades\DB::table('member_premium_tiers')
                ->where('id', $id)->where('tenant_id', $tenantId)
                ->update(array_intersect_key($payload, ['stripe_price_id_monthly' => true, 'stripe_price_id_yearly' => true, 'stripe_price_account_id' => true]));
            unset($payload['stripe_price_id_monthly'], $payload['stripe_price_id_yearly'], $payload['stripe_price_account_id']);
        }

        MemberPremiumService::updateTier($tenantId, $id, $payload);
        $tier = MemberPremiumService::getTier($tenantId, $id);
        return $this->respondWithData(['tier' => $tier]);
    }

    /**
     * DELETE /api/v2/admin/member-premium/tiers/{id}
     */
    public function deleteTier(int $id): JsonResponse
    {
        $this->requireAdmin();
        try {
            MemberPremiumService::deleteTier(TenantContext::getId(), $id);
        } catch (\Throwable $e) {
            return $this->respondWithError('DELETE_FAILED', $e->getMessage(), null, 409);
        }
        return $this->respondWithData(['deleted' => true]);
    }

    /**
     * POST /api/v2/admin/member-premium/tiers/{id}/sync-stripe
     */
    public function syncStripe(int $id): JsonResponse
    {
        $this->requireAdmin();
        $tenantId = TenantContext::getId();
        try {
            $tier = MemberPremiumService::syncTierToStripe($tenantId, $id);
        } catch (\Throwable $e) {
            return $this->respondWithError('STRIPE_SYNC_FAILED', $e->getMessage(), null, 500);
        }
        return $this->respondWithData(['tier' => $tier]);
    }

    /**
     * GET /api/v2/admin/member-premium/subscribers
     */
    public function listSubscribers(): JsonResponse
    {
        $this->requireAdmin();
        $page = max(1, (int) ($this->inputInt('page') ?? 1));
        $perPage = max(1, min(100, (int) ($this->inputInt('per_page') ?? 25)));
        $statusFilter = $this->input('status') ?: null;

        $result = MemberPremiumService::listSubscribersForAdmin(
            TenantContext::getId(),
            $page,
            $perPage,
            is_string($statusFilter) ? $statusFilter : null
        );

        return $this->respondWithData($result);
    }

    /**
     * GET /api/v2/admin/member-premium/finance/overview
     */
    public function financeOverview(): JsonResponse
    {
        $this->requireAdmin();

        return $this->respondWithData([
            'overview' => DonationOperationsService::overview(TenantContext::getId()),
        ]);
    }

    /**
     * GET /api/v2/admin/member-premium/finance/disputes
     */
    public function financeDisputes(): JsonResponse
    {
        $this->requireAdmin();
        $limit = max(1, min(200, (int) ($this->inputInt('limit') ?? 50)));

        return $this->respondWithData([
            'items' => DonationOperationsService::disputes(TenantContext::getId(), $limit),
        ]);
    }

    /**
     * GET /api/v2/admin/member-premium/finance/gift-aid-export
     *
     * Exports every 'ready' gift-aid declaration and — unless ?preview=1 —
     * stamps the exported rows as claimed (gift_aid_claimed_at) so the same
     * declarations cannot be re-submitted to HMRC by a later export. Use
     * preview=1 to inspect the pending claim without committing it.
     */
    public function giftAidExport(): \Symfony\Component\HttpFoundation\StreamedResponse
    {
        $this->requireAdmin();
        $tenantId = TenantContext::getId();

        $rows = DonationOperationsService::giftAidExportRows($tenantId);

        $preview = filter_var($this->input('preview', false), FILTER_VALIDATE_BOOLEAN);
        if (!$preview && $rows !== []) {
            DonationOperationsService::markGiftAidRowsClaimed(
                $tenantId,
                array_map(static fn (array $row): int => (int) $row['donation_id'], $rows),
            );
        }

        return $this->csvResponse(
            $preview ? 'gift-aid-donations-preview.csv' : 'gift-aid-donations.csv',
            $rows,
        );
    }

    /**
     * GET /api/v2/admin/member-premium/finance/annual-receipts?year=YYYY
     */
    public function annualReceiptsExport(): \Symfony\Component\HttpFoundation\StreamedResponse
    {
        $this->requireAdmin();
        $year = (int) ($this->inputInt('year') ?? (int) date('Y'));
        if ($year < 2000 || $year > ((int) date('Y') + 1)) {
            $year = (int) date('Y');
        }

        return $this->csvResponse(
            'donation-annual-receipts-' . $year . '.csv',
            DonationOperationsService::annualReceiptRows(TenantContext::getId(), $year),
        );
    }

    /**
     * Validate and coerce the tier payload.
     *
     * @return array|JsonResponse
     */
    private function validateTierPayload(bool $partial = false)
    {
        $data = [];
        $required = $partial ? [] : ['slug', 'name'];

        foreach ($required as $field) {
            $val = trim((string) ($this->input($field) ?? ''));
            if ($val === '') {
                return $this->respondWithError('VALIDATION_ERROR', __('api.missing_required_field', ['field' => $field]), $field, 422);
            }
            $data[$field] = $val;
        }

        if (! $partial || $this->input('slug') !== null) {
            $slug = trim((string) ($this->input('slug') ?? ($data['slug'] ?? '')));
            if ($slug !== '') {
                if (! preg_match('/^[a-z0-9][a-z0-9-_]{0,79}$/', $slug)) {
                    return $this->respondWithError('VALIDATION_ERROR', __('api.member_premium_invalid_slug'), 'slug', 422);
                }
                $data['slug'] = $slug;
            }
        }

        if ($this->input('name') !== null) {
            $data['name'] = trim((string) $this->input('name'));
        }
        if ($this->input('description') !== null) {
            $desc = trim((string) $this->input('description'));
            $data['description'] = $desc !== '' ? $desc : null;
        }
        if ($this->input('monthly_price_cents') !== null) {
            $data['monthly_price_cents'] = max(0, (int) $this->input('monthly_price_cents'));
        }
        if ($this->input('yearly_price_cents') !== null) {
            $data['yearly_price_cents'] = max(0, (int) $this->input('yearly_price_cents'));
        }
        if ($this->input('sort_order') !== null) {
            $data['sort_order'] = (int) $this->input('sort_order');
        }
        if ($this->input('is_active') !== null) {
            $data['is_active'] = (bool) $this->input('is_active');
        }
        if ($this->input('features') !== null) {
            $features = $this->input('features');
            if (! is_array($features)) {
                return $this->respondWithError('VALIDATION_ERROR', __('api.member_premium_features_array'), 'features', 422);
            }
            $data['features'] = array_values(array_filter(array_map('strval', $features), fn ($f) => $f !== ''));
        }

        return $data;
    }

    /**
     * @param array<int, array<string, mixed>> $rows
     */
    private function csvResponse(string $filename, array $rows): \Symfony\Component\HttpFoundation\StreamedResponse
    {
        return response()->streamDownload(function () use ($rows): void {
            $out = fopen('php://output', 'w');
            if ($out === false) {
                return;
            }

            $headers = [];
            foreach ($rows as $row) {
                $headers = array_values(array_unique(array_merge($headers, array_keys($row))));
            }
            if ($headers === []) {
                $headers = ['empty'];
            }

            // Sanitise every cell against CSV formula injection: donor-controlled
            // strings (gift-aid declaration name, address lines, donor_name) that
            // begin with =, +, -, @ etc. would otherwise execute as formulas in a
            // spreadsheet. Mirrors the donation-export sanitisation.
            \App\Support\CsvExportSanitizer::put($out, \App\Support\CsvExportSanitizer::row($headers));
            foreach ($rows as $row) {
                \App\Support\CsvExportSanitizer::put($out, \App\Support\CsvExportSanitizer::row(array_map(
                    static fn (string $key): mixed => $row[$key] ?? '',
                    $headers,
                )));
            }
            fclose($out);
        }, $filename, [
            'Content-Type' => 'text/csv; charset=UTF-8',
        ]);
    }
}
