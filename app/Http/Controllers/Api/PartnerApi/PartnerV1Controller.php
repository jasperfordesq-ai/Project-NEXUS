<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

declare(strict_types=1);

namespace App\Http\Controllers\Api\PartnerApi;

use App\Core\TenantContext;
use App\Http\Controllers\Api\BaseApiController;
use App\Models\Notification;
use App\Services\NotificationDispatcher;
use App\Services\PartnerApi\PartnerWebhookDispatcher;
use App\Support\SecurityBounds;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;

/**
 * AG60 — Curated Partner API v1.
 *
 * Hand-picked endpoints exposed to external integrators. NOT a full mirror
 * of the platform API — only what banking / payment / municipal admin
 * partners actually need:
 *
 *   - users (list / show, public-safe fields)
 *   - listings (list)
 *   - wallet (read balance, credit time-credits via authorized integrations)
 *   - aggregates (bucketed community counts, no PII)
 *   - webhooks (subscription management)
 *
 * The middleware (`partner.api:<scope>`) enforces auth + scope + sandbox
 * before this controller runs. Tenant scope is set by the middleware.
 */
class PartnerV1Controller extends BaseApiController
{
    protected bool $isV2Api = true;

    /* ─── Users ─────────────────────────────────────────────────────────── */

    public function listUsers(Request $request): JsonResponse
    {
        $tenantId = TenantContext::getId();
        $page = max(1, (int) $request->query('page', 1));
        $perPage = min(100, max(1, (int) $request->query('per_page', 25)));
        $offset = ($page - 1) * $perPage;

        $hasPii = in_array('users.pii', $this->scopes($request), true);

        $columns = ['users.id', 'users.name', 'users.username', 'users.created_at', 'users.status'];
        if ($hasPii) {
            $columns[] = 'users.email';
        }

        $rows = DB::table('users')
            ->join('federation_user_settings as fus', 'fus.user_id', '=', 'users.id')
            ->where('users.tenant_id', $tenantId)
            ->where('users.status', 'active')
            ->where('users.onboarding_completed', 1)
            ->where('fus.federation_optin', 1)
            ->where('fus.profile_visible_federated', 1)
            ->where('fus.appear_in_federated_search', 1)
            ->select($columns)
            ->orderBy('users.id')
            ->offset($offset)
            ->limit($perPage)
            ->get()
            ->map(fn ($r) => (array) $r)
            ->all();

        $total = (int) DB::table('users')
            ->join('federation_user_settings as fus', 'fus.user_id', '=', 'users.id')
            ->where('users.tenant_id', $tenantId)
            ->where('users.status', 'active')
            ->where('users.onboarding_completed', 1)
            ->where('fus.federation_optin', 1)
            ->where('fus.profile_visible_federated', 1)
            ->where('fus.appear_in_federated_search', 1)
            ->count();

        return $this->respondWithPaginatedCollection($rows, $total, $page, $perPage);
    }

    public function showUser(Request $request, int $id): JsonResponse
    {
        $tenantId = TenantContext::getId();
        $hasPii = in_array('users.pii', $this->scopes($request), true);

        $columns = ['users.id', 'users.name', 'users.username', 'users.created_at', 'users.status'];
        if ($hasPii) {
            $columns[] = 'users.email';
        }

        $user = DB::table('users')
            ->join('federation_user_settings as fus', 'fus.user_id', '=', 'users.id')
            ->where('users.tenant_id', $tenantId)
            ->where('users.id', $id)
            ->where('users.status', 'active')
            ->where('users.onboarding_completed', 1)
            ->where('fus.federation_optin', 1)
            ->where('fus.profile_visible_federated', 1)
            ->where('fus.appear_in_federated_search', 1)
            ->select($columns)
            ->first();

        if (! $user) {
            return $this->respondNotFound(__('api.partner_api_user_not_found'), 'USER_NOT_FOUND');
        }

        return $this->respondWithData(['user' => (array) $user]);
    }

    /* ─── Listings ──────────────────────────────────────────────────────── */

    public function listListings(Request $request): JsonResponse
    {
        $tenantId = TenantContext::getId();
        $page = max(1, (int) $request->query('page', 1));
        $perPage = min(100, max(1, (int) $request->query('per_page', 25)));
        $offset = ($page - 1) * $perPage;

        $rows = DB::table('listings as l')
            ->join('federation_user_settings as fus', 'fus.user_id', '=', 'l.user_id')
            ->where('l.tenant_id', $tenantId)
            ->where('l.status', 'active')
            ->whereIn('l.federated_visibility', ['listed', 'bookable'])
            ->where('fus.federation_optin', 1)
            ->where('fus.profile_visible_federated', 1)
            ->where('fus.appear_in_federated_search', 1)
            ->select(['l.id', 'l.user_id', 'l.title', 'l.type', 'l.created_at'])
            ->orderBy('l.id', 'desc')
            ->offset($offset)
            ->limit($perPage)
            ->get()
            ->map(fn ($r) => (array) $r)
            ->all();

        $total = (int) DB::table('listings as l')
            ->join('federation_user_settings as fus', 'fus.user_id', '=', 'l.user_id')
            ->where('l.tenant_id', $tenantId)
            ->where('l.status', 'active')
            ->whereIn('l.federated_visibility', ['listed', 'bookable'])
            ->where('fus.federation_optin', 1)
            ->where('fus.profile_visible_federated', 1)
            ->where('fus.appear_in_federated_search', 1)
            ->count();

        return $this->respondWithPaginatedCollection($rows, $total, $page, $perPage);
    }

    /* ─── Wallet ────────────────────────────────────────────────────────── */

    public function walletBalance(int $userId): JsonResponse
    {
        $tenantId = TenantContext::getId();
        $user = $this->findFederationWalletUser($tenantId, $userId);

        if (! $user) {
            return $this->respondNotFound(__('api.partner_api_user_not_found'), 'USER_NOT_FOUND');
        }

        return $this->respondWithData([
            'user_id' => $userId,
            'balance_hours' => round((float) ($user->balance ?? 0), 4),
            'currency' => 'time_credits',
        ]);
    }

    /**
     * POST /api/partner/v1/wallet/credit
     *
     * Body: { user_id, hours, reference, note? }
     *
     * Used by bank integrations to credit time/cash from settled transfers.
     * Records a live `transactions` row and updates users.balance; the
     * partner/reference idempotency row is financial delivery evidence, not an
     * email-sent marker.
     */
    public function walletCredit(Request $request): JsonResponse
    {
        $tenantId = TenantContext::getId();
        $partner = $request->attributes->get('partner', []);
        $partnerId = (int) ($partner['id'] ?? 0);
        $partnerSlug = (string) ($partner['slug'] ?? 'partner');
        $partnerName = (string) ($partner['name'] ?? $partnerSlug);

        $userId = (int) $request->input('user_id', 0);
        $hours = (float) $request->input('hours', 0);
        $reference = trim((string) $request->input('reference', ''));
        $note = trim((string) $request->input('note', ''));

        if ($userId <= 0 || $hours <= 0 || $reference === '') {
            return $this->respondWithError('invalid_request', __('api.partner_wallet_credit_required'), null, 422);
        }

        if (!SecurityBounds::isAcceptableHourAmount($hours)) {
            return $this->respondWithError('invalid_request', __('api.invalid_amount'), null, 422);
        }

        if ($partnerId <= 0) {
            return $this->respondWithError('invalid_partner', __('api.partner_api_invalid_partner'), null, 403);
        }

        $user = $this->findFederationWalletUser($tenantId, $userId);
        if (! $user) {
            return $this->respondNotFound(__('api.partner_api_user_not_found'), 'USER_NOT_FOUND');
        }

        $createdCredit = false;

        try {
            $credit = DB::transaction(function () use ($tenantId, $partnerId, $partnerSlug, $userId, $hours, $reference, $note, &$createdCredit): object {
            DB::table('api_partner_wallet_credits')->insertOrIgnore([
                'tenant_id' => $tenantId,
                'partner_id' => $partnerId,
                'user_id' => $userId,
                'reference' => $reference,
                'hours' => round($hours, 2),
                'status' => 'processing',
                'created_at' => now(),
                'updated_at' => now(),
            ]);

            $credit = DB::table('api_partner_wallet_credits')
                ->where('tenant_id', $tenantId)
                ->where('partner_id', $partnerId)
                ->where('reference', $reference)
                ->lockForUpdate()
                ->first();

            if ($credit && $credit->transaction_id) {
                if (
                    (int) ($credit->user_id ?? 0) !== $userId
                    || (float) ($credit->hours ?? 0) !== round($hours, 2)
                ) {
                    throw new \InvalidArgumentException('partner_wallet_credit_reference_conflict');
                }

                return $credit;
            }

            if (
                (int) ($credit->user_id ?? 0) !== $userId
                || (float) ($credit->hours ?? 0) !== round($hours, 2)
            ) {
                throw new \InvalidArgumentException('partner_wallet_credit_reference_conflict');
            }

            DB::table('users')
                ->where('tenant_id', $tenantId)
                ->where('id', $userId)
                ->lockForUpdate()
                ->first();

            $description = __('api.partner_wallet_credit_description', [
                'partner' => $partnerSlug,
                'reference' => $reference,
                'note' => $note !== '' ? $note : __('api.partner_wallet_credit_default_note'),
            ]);

            $transactionId = (int) DB::table('transactions')->insertGetId([
                'tenant_id' => $tenantId,
                'sender_id' => 0,
                'receiver_id' => $userId,
                'amount' => round($hours, 2),
                'description' => $description,
                'status' => 'completed',
                'transaction_type' => 'other',
                'created_at' => now(),
                'updated_at' => now(),
            ]);

            DB::table('users')
                ->where('tenant_id', $tenantId)
                ->where('id', $userId)
                ->update([
                    'balance' => DB::raw('balance + ' . round($hours, 2)),
                    'updated_at' => now(),
                ]);

            DB::table('api_partner_wallet_credits')
                ->where('id', $credit->id)
                ->update([
                    'transaction_id' => $transactionId,
                    'hours' => round($hours, 2),
                    'status' => 'completed',
                    'completed_at' => now(),
                    'updated_at' => now(),
                ]);

            $createdCredit = true;
            return DB::table('api_partner_wallet_credits')->where('id', $credit->id)->first();
            });
        } catch (\InvalidArgumentException $e) {
            return $this->respondWithError('idempotency_conflict', __('api.partner_wallet_credit_reference_conflict'), null, 409);
        }

        $txId = (int) $credit->transaction_id;
        $isReplay = !$createdCredit;

        if ($createdCredit) {
            try {
                // Render the bell + push text in the RECIPIENT's preferred language —
                // this is a machine-to-machine partner call, so without this wrap the
                // notification resolves against the worker/default locale, not the user's.
                $recipientLocale = (string) (DB::table('users')
                    ->where('tenant_id', $tenantId)
                    ->where('id', $userId)
                    ->value('preferred_language') ?? '');

                \App\I18n\LocaleContext::withLocale($recipientLocale, function () use ($userId, $partnerName, $hours, $note, $tenantId): void {
                    Notification::createNotification(
                        $userId,
                        __('notifications.credit_received', ['name' => $partnerName, 'amount' => round($hours, 2)]),
                        '/wallet',
                        'transaction',
                        false,
                        $tenantId
                    );
                    \App\Services\NotificationDispatcher::fanOutPush((int) ($userId), 'transaction', __('notifications.credit_received', ['name' => $partnerName, 'amount' => round($hours, 2)]), '/wallet');
                    NotificationDispatcher::sendCreditEmail($userId, $partnerName, round($hours, 2), $note);
                });
            } catch (\Throwable $e) {
                \Illuminate\Support\Facades\Log::warning('Partner wallet credit notification failed', [
                    'tenant_id' => $tenantId,
                    'partner_id' => $partnerId,
                    'transaction_id' => $txId,
                    'error' => $e->getMessage(),
                ]);
            }

            PartnerWebhookDispatcher::dispatch('wallet.credited', [
                'transaction_id' => $txId,
                'user_id' => $userId,
                'hours' => round($hours, 2),
                'reference' => $reference,
            ], $partnerId);
        }

        return $this->respondWithData([
            'transaction_id' => $txId,
            'user_id' => $userId,
            'hours' => round($hours, 2),
            'reference' => $reference,
            'replayed' => $isReplay,
        ], null, $isReplay ? 200 : 201);
    }

    /* ─── Aggregates ───────────────────────────────────────────────────── */

    public function communityAggregates(): JsonResponse
    {
        $tenantId = TenantContext::getId();

        $userCount = (int) DB::table('users')
            ->where('tenant_id', $tenantId)
            ->where('status', 'active')
            ->count();

        $listingCount = (int) DB::table('listings')
            ->where('tenant_id', $tenantId)
            ->where('status', 'active')
            ->count();

        // Bucket totals to avoid leaking exact-numbers signal at small N.
        $bucket = static function (int $n): int {
            if ($n < 10) return 0;
            if ($n < 100) return (int) (floor($n / 10) * 10);
            return (int) (floor($n / 100) * 100);
        };

        return $this->respondWithData([
            'tenant_id' => $tenantId,
            'active_members_bucket' => $bucket($userCount),
            'active_listings_bucket' => $bucket($listingCount),
            'generated_at' => now()->toIso8601String(),
        ]);
    }

    /* ─── Webhook subscriptions ────────────────────────────────────────── */

    public function listWebhookSubscriptions(Request $request): JsonResponse
    {
        $partner = $request->attributes->get('partner', []);
        return $this->respondWithData([
            'subscriptions' => PartnerWebhookDispatcher::listForPartner((int) $partner['id']),
        ]);
    }

    public function createWebhookSubscription(Request $request): JsonResponse
    {
        $partner = $request->attributes->get('partner', []);

        $events = $request->input('event_types', []);
        $targetUrl = trim((string) $request->input('target_url', ''));

        if (! is_array($events) || empty($events) || $targetUrl === '') {
            return $this->respondWithError('invalid_request',
                __('api.partner_webhook_event_types_and_target_required'), null, 422);
        }

        if (! filter_var($targetUrl, FILTER_VALIDATE_URL) || ! str_starts_with($targetUrl, 'https://')) {
            return $this->respondWithError('invalid_url',
                __('api.partner_webhook_target_https_required'), null, 422);
        }

        if (WebhookDispatchService::isPrivateUrl($targetUrl)) {
            return $this->respondWithError('private_url',
                __('api.partner_webhook_target_private_url'), null, 422);
        }

        try {
            $sub = PartnerWebhookDispatcher::createSubscription(
                (int) $partner['id'],
                array_values(array_map('strval', $events)),
                $targetUrl,
            );
        } catch (\InvalidArgumentException $e) {
            return $this->respondWithError('invalid_request', __('api.partner_webhook_subscription_invalid'), null, 422);
        }

        return $this->respondWithData(['subscription' => $sub], null, 201);
    }

    /* ─── Helpers ──────────────────────────────────────────────────────── */

    /** @return string[] */
    private function scopes(Request $request): array
    {
        $s = $request->attributes->get('partner_scopes', []);
        return is_array($s) ? $s : [];
    }

    private function findFederationWalletUser(int $tenantId, int $userId): ?object
    {
        return DB::table('users')
            ->join('federation_user_settings as fus', 'fus.user_id', '=', 'users.id')
            ->where('users.tenant_id', $tenantId)
            ->where('users.id', $userId)
            ->where('users.status', 'active')
            ->where('fus.federation_optin', 1)
            ->where('fus.profile_visible_federated', 1)
            ->where('fus.transactions_enabled_federated', 1)
            ->select('users.*')
            ->first();
    }
}
