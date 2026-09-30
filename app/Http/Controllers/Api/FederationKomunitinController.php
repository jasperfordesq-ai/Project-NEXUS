<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

declare(strict_types=1);

namespace App\Http\Controllers\Api;

use App\Core\FederationApiMiddleware;
use App\Core\TenantContext;
use App\Services\MessageService;
use App\Services\Protocols\KomunitinAdapter;
use App\Services\SafeguardingInteractionPolicy;
use App\Support\SecurityBounds;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Log;
use Illuminate\Support\Str;

/**
 * FederationKomunitinController — JSON:API-compatible endpoints matching the
 * Komunitin accounting API specification (OpenAPI 3.0).
 *
 * Spec: https://raw.githubusercontent.com/komunitin/komunitin/refs/heads/master/accounting/openapi/openapi_v3.json
 * Repo: https://github.com/community-exchange-network/komunitin
 *
 * These endpoints serve NEXUS data in JSON:API format (application/vnd.api+json)
 * so that Komunitin instances can query NEXUS as a compatible federation partner.
 *
 * Key spec details matched:
 *   - JSON:API resource format with type/id/attributes/relationships/links
 *   - Cursor-based pagination via page[size] and page[after]
 *   - Error format: {errors: [{status, code, title, detail}]}
 *   - Transfer states: committed, pending, rejected
 *   - Amount in minor currency units (scale-based)
 *   - Currency rate as {n, d} (numerator/denominator)
 *   - links.self on every resource
 *   - PATCH for state changes, DELETE for removal
 *
 * Authentication: via FederationApiMiddleware (API key, HMAC, JWT, or OAuth2).
 *
 * Endpoints:
 *   GET    /currencies                  — List currencies
 *   GET    /{code}/currency             — Single currency
 *   GET    /{code}/currency/settings    — Currency settings
 *   GET    /{code}/accounts             — List accounts
 *   GET    /{code}/accounts/{id}        — Single account
 *   GET    /{code}/transfers            — List transfers
 *   GET    /{code}/transfers/{id}       — Single transfer
 *   POST   /{code}/transfers            — Create transfer
 *   PATCH  /{code}/transfers/{id}       — Update transfer state
 *   DELETE /{code}/transfers/{id}       — Delete transfer
 */
class FederationKomunitinController extends BaseApiController
{
    protected bool $isV2Api = true;

    /**
     * Valid Komunitin transfer state transitions.
     *
     * Based on the Komunitin accounting spec:
     *   new       → pending   (submitted for processing)
     *   pending   → accepted  (manually or auto-accepted)
     *   pending   → rejected  (declined)
     *   accepted  → completed (funds settled)
     *   accepted  → failed    (settlement error)
     *   failed    → pending   (retry allowed)
     *   rejected, completed — terminal states, no further transitions
     */
    private const VALID_TRANSITIONS = [
        'new'       => ['pending', 'accepted', 'committed', 'completed', 'rejected', 'failed'],
        'pending'   => ['accepted', 'committed', 'completed', 'rejected', 'failed'],
        'accepted'  => ['committed', 'completed', 'failed'],
        'rejected'  => [],
        'completed' => [],
        'failed'    => ['pending'],
    ];

    // ─────────────────────────────────────────────────────────────────────────
    // Currencies
    // ─────────────────────────────────────────────────────────────────────────

    /**
     * GET /currencies — List available currencies.
     */
    public function currencies(Request $request): JsonResponse
    {
        $tenantId = TenantContext::getId();

        return $this->jsonApiResponse([
            $this->buildCurrencyResource($tenantId),
        ]);
    }

    /**
     * GET /{code}/currency — Single currency detail.
     */
    public function currency(Request $request, string $code): JsonResponse
    {
        $tenantId = TenantContext::getId();
        return $this->jsonApiResponse($this->buildCurrencyResource($tenantId), null, true);
    }

    /**
     * GET /{code}/currency/settings — Currency settings.
     */
    public function currencySettings(Request $request, string $code): JsonResponse
    {
        $tenantId = TenantContext::getId();

        return $this->jsonApiResponse([
            'type' => 'currency-settings',
            'id' => "hours-{$tenantId}-settings",
            'attributes' => [
                'defaultAllowPayments' => true,
                'enableExternalPayments' => true,
                'defaultAllowTagPayments' => false,
                'defaultInitialCreditLimit' => KomunitinAdapter::hoursToMinorUnits(0),
                'externalTraderCreditLimit' => KomunitinAdapter::hoursToMinorUnits(0),
                'defaultAcceptPaymentsAfter' => 0,
                'defaultAllowPaymentRequests' => true,
                'defaultOnPaymentCreditLimit' => KomunitinAdapter::hoursToMinorUnits(0),
                'defaultAllowExternalPayments' => true,
                'enableExternalPaymentRequests' => true,
                'defaultAcceptPaymentsWhitelist' => [],
                'defaultAllowTagPaymentRequests' => false,
                'defaultAcceptPaymentsAutomatically' => true,
                'defaultAllowExternalPaymentRequests' => true,
                'defaultAcceptExternalPaymentsAutomatically' => true,
            ],
        ], null, true);
    }

    /**
     * POST /currencies — Create a currency (stub).
     *
     * NEXUS timebanks use a fixed 'hours' currency. This endpoint accepts the
     * request for protocol compliance but returns the existing currency.
     */
    public function createCurrency(Request $request): JsonResponse
    {
        $tenantId = TenantContext::getId();

        // NEXUS doesn't support multiple currencies per tenant — return existing
        return $this->jsonApiResponse(
            $this->buildCurrencyResource($tenantId),
            null, true, 201
        );
    }

    /**
     * PATCH /{code}/currency — Update currency metadata.
     *
     * Accepts name/namePlural updates. Currency code is immutable per Komunitin spec.
     */
    public function updateCurrency(Request $request, string $code): JsonResponse
    {
        $tenantId = TenantContext::getId();
        $payload = $request->json()->all();
        $attrs = $payload['data']['attributes'] ?? [];

        // Reject currency code changes (Komunitin spec: "Can't change currency code")
        if (isset($attrs['code'])) {
            return $this->jsonApiError('BadRequest', 'Bad Request',
                "Can't change currency code", 400);
        }

        // NEXUS uses a fixed currency — accept the request but no-op
        return $this->jsonApiResponse(
            $this->buildCurrencyResource($tenantId),
            null, true
        );
    }

    /**
     * PATCH /{code}/currency/settings — Update currency settings.
     */
    public function updateCurrencySettings(Request $request, string $code): JsonResponse
    {
        $tenantId = TenantContext::getId();
        $payload = $request->json()->all();
        $attrs = $payload['data']['attributes'] ?? [];

        // NEXUS doesn't persist per-currency settings externally — accept and return current
        return $this->jsonApiResponse([
            'type' => 'currency-settings',
            'id' => "hours-{$tenantId}-settings",
            'attributes' => array_merge([
                'defaultAllowPayments' => true,
                'enableExternalPayments' => true,
                'defaultAllowTagPayments' => false,
                'defaultInitialCreditLimit' => KomunitinAdapter::hoursToMinorUnits(0),
                'externalTraderCreditLimit' => KomunitinAdapter::hoursToMinorUnits(0),
                'defaultAcceptPaymentsAfter' => 0,
                'defaultAllowPaymentRequests' => true,
                'defaultOnPaymentCreditLimit' => KomunitinAdapter::hoursToMinorUnits(0),
                'defaultAllowExternalPayments' => true,
                'enableExternalPaymentRequests' => true,
                'defaultAcceptPaymentsWhitelist' => [],
                'defaultAllowTagPaymentRequests' => false,
                'defaultAcceptPaymentsAutomatically' => true,
                'defaultAllowExternalPaymentRequests' => true,
                'defaultAcceptExternalPaymentsAutomatically' => true,
            ], $attrs),
        ], null, true);
    }

    // ─────────────────────────────────────────────────────────────────────────
    // Accounts
    // ─────────────────────────────────────────────────────────────────────────

    /**
     * GET /{code}/accounts — List accounts with cursor pagination.
     *
     * Pagination: page[size] (default 25), page[after] (cursor = last ID seen)
     * Filter: filter[code] for autocomplete search
     */
    public function accounts(Request $request, string $code): JsonResponse
    {
        $tenantId = TenantContext::getId();
        $pageSize = min((int) ($request->query('page')['size'] ?? $request->query('page_size', '25')), 100);
        $afterCursor = $request->query('page')['after'] ?? $request->query('page_after');
        $filterCode = $request->query('filter')['code'] ?? $request->query('filter_code');
        $filterTag = $request->query('filter')['tag'] ?? $request->query('filter_tag');
        $baseUrl = $request->getSchemeAndHttpHost();

        $query = $this->discoverableFederatedAccountQuery($tenantId);

        if ($filterCode) {
            $query->where(function ($q) use ($filterCode) {
                $q->where('users.username', 'LIKE', "%{$filterCode}%")
                    ->orWhere('users.name', 'LIKE', "%{$filterCode}%");
            });
        }

        if ($filterTag) {
            $query->where(function ($q) use ($filterTag) {
                $q->where('users.tags', 'LIKE', "%{$filterTag}%")
                    ->orWhere('users.skills', 'LIKE', "%{$filterTag}%");
            });
        }

        // Cursor pagination: decode opaque cursor
        $offset = $this->decodeOffsetCursor($afterCursor);

        $users = $query->orderBy('users.id')
            ->offset($offset)
            ->limit($pageSize + 1) // Fetch one extra to check for next page
            ->get([
                'users.id',
                'users.name',
                'users.username',
                'users.balance',
                'users.created_at',
                'users.updated_at',
            ]);

        $hasNext = $users->count() > $pageSize;
        if ($hasNext) {
            $users = $users->slice(0, $pageSize);
        }

        $resources = $users->map(function ($user) use ($tenantId, $code, $baseUrl) {
            return $this->buildAccountResource($user, $tenantId, $code, $baseUrl);
        })->values()->all();

        $nextOffset = $offset + $pageSize;
        $links = [
            'first' => $this->buildPaginationUrl($request, 0, $pageSize),
            'last' => null,
            'prev' => $offset > 0
                ? $this->buildPaginationUrl($request, max(0, $offset - $pageSize), $pageSize)
                : null,
            'next' => $hasNext
                ? $this->buildPaginationUrl($request, $nextOffset, $pageSize)
                : null,
        ];

        return $this->jsonApiResponse($resources, null, false, 200, $links);
    }

    /**
     * GET /{code}/accounts/{id} — Single account.
     */
    public function account(Request $request, string $code, string $id): JsonResponse
    {
        $tenantId = TenantContext::getId();
        $baseUrl = $request->getSchemeAndHttpHost();

        $user = $this->discoverableFederatedAccountQuery($tenantId)
            ->where('users.id', (int) $id)
            ->first([
                'users.id',
                'users.name',
                'users.username',
                'users.balance',
                'users.created_at',
                'users.updated_at',
            ]);

        if (!$user) {
            return $this->jsonApiError('NotFound', 'Not Found',
                "Account id {$id} not found in currency {$code}", 404);
        }

        return $this->jsonApiResponse(
            $this->buildAccountResource($user, $tenantId, $code, $baseUrl),
            null, true
        );
    }

    /**
     * POST /{code}/accounts — Create an account (external federation partner registering).
     *
     * Komunitin spec expects a user relationship in the payload.
     * NEXUS creates a federated placeholder user for the external account.
     */
    public function createAccount(Request $request, string $code): JsonResponse
    {
        $tenantId = TenantContext::getId();
        $baseUrl = $request->getSchemeAndHttpHost();
        $payload = $request->json()->all();

        $rels = $payload['data']['relationships'] ?? [];
        $userRef = $rels['users']['data'][0] ?? null;

        if (!$userRef || empty($userRef['id'])) {
            return $this->jsonApiError('BadRequest', 'Bad Request',
                'Missing users relationship in request body', 400);
        }

        // Check if this external user already has an account
        $externalUserId = $userRef['id'];
        $existing = DB::table('users')
            ->where('tenant_id', $tenantId)
            ->where('external_federation_id', $externalUserId)
            ->first();

        if ($existing) {
            return $this->jsonApiResponse(
                $this->buildAccountResource($existing, $tenantId, $code, $baseUrl),
                null, true, 200
            );
        }

        // NEXUS doesn't create real user accounts via federation API —
        // return 403 per Komunitin spec ("Insufficient Scope")
        return $this->jsonApiError('Forbidden', 'Forbidden',
            'Account creation via federation API is not supported. Users must register directly.', 403);
    }

    /**
     * DELETE /{code}/currency — Soft-delete the currency (mark inactive).
     *
     * NEXUS uses a fixed 'hours' currency per tenant, so this does not drop any
     * ledger rows. It flips a `federation.komunitin.currency_inactive` flag in
     * tenant_settings so subsequent GETs report status=inactive.
     *
     * Admin-only: requires 'admin' or '*' permission on the authenticated key.
     */
    public function deleteCurrency(Request $request, string $code): JsonResponse
    {
        if (!$this->requireAdminScope()) {
            return $this->jsonApiError('Forbidden', 'Forbidden',
                'Admin scope required for currency deletion', 403);
        }

        $tenantId = TenantContext::getId();

        DB::table('tenant_settings')->updateOrInsert(
            [
                'tenant_id' => $tenantId,
                'setting_key' => 'federation.komunitin.currency_inactive',
            ],
            [
                'setting_value' => '1',
                'updated_at' => now(),
            ]
        );

        Log::info('[FederationKomunitin] Currency soft-deleted', [
            'tenant_id' => $tenantId, 'code' => $code,
        ]);

        return response()->json(null, 204, [
            'Content-Type' => 'application/vnd.api+json',
        ]);
    }

    /**
     * DELETE /{code}/accounts/{id} — Deactivate an account (status=inactive).
     *
     * Balance and history are preserved per Komunitin spec.
     * Admin-only.
     */
    public function deleteAccount(Request $request, string $code, string $id): JsonResponse
    {
        if (!$this->requireAdminScope()) {
            return $this->jsonApiError('Forbidden', 'Forbidden',
                'Admin scope required for account deletion', 403);
        }

        $tenantId = TenantContext::getId();

        // F-331: a partner may only deactivate an account it can legitimately
        // see. Resolving on id + tenant_id alone let a partner switch off any
        // active member — including members who deliberately stayed out of
        // federation — over a walkable id range. The admin scope gate above is
        // a separate, correct control and is unchanged.
        $user = $this->discoverableFederatedAccountQuery($tenantId)
            ->where('users.id', (int) $id)
            ->first(['users.id', 'users.status']);

        if (!$user) {
            return $this->jsonApiError('NotFound', 'Not Found',
                "Account id {$id} not found in currency {$code}", 404);
        }

        DB::table('users')
            ->where('id', (int) $id)
            ->where('tenant_id', $tenantId)
            ->update([
                'status' => 'inactive',
                'updated_at' => now(),
            ]);

        Log::info('[FederationKomunitin] Account deactivated', [
            'tenant_id' => $tenantId, 'user_id' => $id,
        ]);

        return response()->json(null, 204, [
            'Content-Type' => 'application/vnd.api+json',
        ]);
    }

    /**
     * Check if the authenticated federation API key has admin scope.
     *
     * Returns true if the partner's permissions include '*' or 'admin',
     * or if no permissions column is enforced.
     */
    private function requireAdminScope(): bool
    {
        $partner = \App\Core\FederationApiMiddleware::getPartner();
        if (!$partner) {
            return false;
        }

        $perms = $partner['permissions'] ?? null;
        if ($perms === null) {
            // No permissions column — deny by default (null perms = no access)
            return false;
        }

        $permsArr = is_string($perms) ? (json_decode($perms, true) ?: []) : (array) $perms;
        return in_array('*', $permsArr, true) || in_array('admin', $permsArr, true);
    }

    /**
     * PATCH /{code}/accounts/{id} — Update account attributes (e.g., credit limit).
     */
    public function updateAccount(Request $request, string $code, string $id): JsonResponse
    {
        $tenantId = TenantContext::getId();
        $baseUrl = $request->getSchemeAndHttpHost();
        $payload = $request->json()->all();

        // F-330: this returns the full account resource — balance, credit limit,
        // account code — so it is a read as well as a write and carries the same
        // opt-in scope the GET on this object applies. Resolving on id +
        // tenant_id alone let a partner read any active member by using the
        // write verb.
        $user = $this->discoverableFederatedAccountQuery($tenantId)
            ->where('users.id', (int) $id)
            ->first([
                'users.id',
                'users.name',
                'users.username',
                'users.balance',
                'users.created_at',
                'users.updated_at',
            ]);

        if (!$user) {
            return $this->jsonApiError('NotFound', 'Not Found',
                "Account id {$id} not found in currency {$code}", 404);
        }

        $attrs = $payload['data']['attributes'] ?? [];

        // Komunitin allows updating creditLimit — NEXUS doesn't enforce per-user limits
        // via federation API, so we acknowledge the request but don't change state.
        // The balance field is read-only (managed by transfers).
        if (isset($attrs['balance'])) {
            return $this->jsonApiError('BadRequest', 'Bad Request',
                'Balance cannot be modified directly — use transfers', 400);
        }

        return $this->jsonApiResponse(
            $this->buildAccountResource($user, $tenantId, $code, $baseUrl),
            null, true
        );
    }

    // ─────────────────────────────────────────────────────────────────────────
    // Transfers
    // ─────────────────────────────────────────────────────────────────────────

    /**
     * GET /{code}/transfers — List transfers with cursor pagination.
     *
     * Pagination: page[size], page[after]
     * Sort: sort=-created (default descending by created)
     * Filter: filter[account], filter[state], filter[after], filter[before]
     */
    public function transfers(Request $request, string $code): JsonResponse
    {
        $tenantId = TenantContext::getId();
        $pageSize = min((int) ($request->query('page')['size'] ?? $request->query('page_size', '25')), 100);
        $afterCursor = $request->query('page')['after'] ?? $request->query('page_after');
        $sort = $request->query('sort', '-created');
        $baseUrl = $request->getSchemeAndHttpHost();

        $query = DB::table('transactions')
            ->where('tenant_id', $tenantId);

        // F-329: the collection is the paging form of the same disclosure the
        // single read had, so it carries the same boundary — a partner sees the
        // external transfers it is party to, never the community's own ledger.
        $this->scopeToPartnerOwnedTransfers($query, $tenantId);

        // Filters
        $filterAccount = $request->query('filter')['account'] ?? $request->query('filter_account');
        $filterState = $request->query('filter')['state'] ?? $request->query('filter_state');
        $filterAfter = $request->query('filter')['after'] ?? $request->query('filter_after');
        $filterBefore = $request->query('filter')['before'] ?? $request->query('filter_before');

        if ($filterAccount) {
            $query->where(function ($q) use ($filterAccount) {
                $q->where('sender_id', $filterAccount)
                    ->orWhere('receiver_id', $filterAccount);
            });
        }

        if ($filterState) {
            $nexusStatus = match ($filterState) {
                'committed', 'accepted' => 'completed',
                'pending' => 'pending',
                'rejected', 'deleted' => 'cancelled',
                default => null,
            };
            if ($nexusStatus) {
                $query->where('status', $nexusStatus);
            }
        }

        if ($filterAfter) {
            $query->where('created_at', '>=', $filterAfter);
        }
        if ($filterBefore) {
            $query->where('created_at', '<=', $filterBefore);
        }

        // Sort
        $sortDesc = str_starts_with($sort, '-');
        $sortField = ltrim($sort, '-+');
        $sortCol = match ($sortField) {
            'created' => 'created_at',
            'updated' => 'updated_at',
            'amount' => 'amount',
            default => 'created_at',
        };

        // Cursor pagination: decode opaque cursor
        $offset = $this->decodeOffsetCursor($afterCursor);

        $transactions = $query->orderBy($sortCol, $sortDesc ? 'desc' : 'asc')
            ->offset($offset)
            ->limit($pageSize + 1)
            ->get();

        $hasNext = $transactions->count() > $pageSize;
        if ($hasNext) {
            $transactions = $transactions->slice(0, $pageSize);
        }

        $resources = $transactions->map(function ($tx) use ($tenantId, $code, $baseUrl) {
            return $this->buildTransferResource($tx, $tenantId, $code, $baseUrl);
        })->values()->all();

        $nextOffset = $offset + $pageSize;
        $links = [
            'first' => $this->buildPaginationUrl($request, 0, $pageSize),
            'last' => null,
            'prev' => $offset > 0
                ? $this->buildPaginationUrl($request, max(0, $offset - $pageSize), $pageSize)
                : null,
            'next' => $hasNext
                ? $this->buildPaginationUrl($request, $nextOffset, $pageSize)
                : null,
        ];

        return $this->jsonApiResponse($resources, null, false, 200, $links);
    }

    /**
     * GET /{code}/transfers/{id} — Single transfer.
     */
    public function transfer(Request $request, string $code, string $id): JsonResponse
    {
        $tenantId = TenantContext::getId();
        $baseUrl = $request->getSchemeAndHttpHost();

        // F-329: scope the read exactly as updateTransfer()/deleteTransfer()
        // scope the writes on this same route pair. Resolving on id + tenant_id
        // alone published the whole community ledger — both parties, the amount
        // and the member-authored description — to any external partner,
        // including wholly internal exchanges between members who never opted
        // into federation.
        $tx = DB::table('transactions')
            ->where('id', (int) $id)
            ->where('tenant_id', $tenantId)
            ->first();

        if (!$tx || $tx->transaction_type !== 'komunitin_external'
            || !$this->partnerOwnsTransfer($tenantId, (int) $id)) {
            return $this->jsonApiError('NotFound', 'Not Found',
                "Transfer id {$id} not found in currency {$code}", 404);
        }

        return $this->jsonApiResponse(
            $this->buildTransferResource($tx, $tenantId, $code, $baseUrl),
            null, true
        );
    }

    /**
     * POST /{code}/transfers — Create a new transfer.
     *
     * Expects Komunitin JSON:API format with payer/payee relationships
     * and amount in minor currency units.
     */
    public function createTransfer(Request $request, string $code): JsonResponse
    {
        if (!TenantContext::hasFeature('federation')) {
            return response()->json(['error' => __('api.federation.feature_disabled')], 403);
        }

        $tenantId = TenantContext::getId();
        $baseUrl = $request->getSchemeAndHttpHost();
        $payload = $request->json()->all();

        $data = $payload['data'] ?? [];
        $attrs = $data['attributes'] ?? [];
        $rels = $data['relationships'] ?? [];

        $amount = KomunitinAdapter::minorUnitsToHours((int) ($attrs['amount'] ?? 0));
        $description = $attrs['meta'] ?? $attrs['description'] ?? '';
        $state = $attrs['state'] ?? 'committed';
        $payerId = $rels['payer']['data']['id'] ?? null;
        $payeeId = $rels['payee']['data']['id'] ?? null;

        // A partner's requested state is not the payer's authorization.
        $statusMap = [
            'new'       => 'pending',
            'pending'   => 'pending',
            'accepted'  => 'pending',
            'committed' => 'pending',
            'completed' => 'pending',
            'rejected'  => 'cancelled',
            'failed'    => 'cancelled',
        ];
        $nexusStatus = $statusMap[$state] ?? 'pending';

        if (!$payerId || !$payeeId || $amount <= 0) {
            return $this->jsonApiError('BadRequest', 'Bad Request',
                'Missing required fields: payer, payee, and amount > 0', 400);
        }

        // Amount bounds validation
        if (!SecurityBounds::isAcceptableHourAmount($amount)) {
            return $this->jsonApiError('BadRequest', 'Bad Request',
                'Amount exceeds maximum allowed value', 400);
        }

        $partnerKeyId = (int) (FederationApiMiddleware::getPartner()['id'] ?? 0);
        $requestId = $request->header('Idempotency-Key') ?: ($data['id'] ?? null);
        if ($partnerKeyId <= 0 || !is_string($requestId) || strlen($requestId) > 100
            || !preg_match('/^[A-Za-z0-9._:-]+$/D', $requestId)) {
            return $this->jsonApiError('BadRequest', 'Bad Request',
                'A stable transfer id or Idempotency-Key is required', 400);
        }
        $requestHash = hash('sha256', json_encode([
            strtoupper($code), (int) $payerId, (int) $payeeId,
            number_format($amount, 4, '.', ''), (string) $description, $nexusStatus,
        ]));
        if ($replay = $this->replayTransfer($tenantId, $partnerKeyId, $requestId, $requestHash, $code, $baseUrl)) {
            return $replay;
        }

        // Validate accounts exist
        $payee = DB::table('users')
            ->where('id', (int) $payeeId)
            ->where('tenant_id', $tenantId)
            ->where('status', 'active')
            ->first();

        if (!$payee) {
            return $this->jsonApiError('NotFound', 'Not Found',
                "Payee account not found in currency {$code}", 404);
        }

        $payerExists = DB::table('users')
            ->where('id', (int) $payerId)
            ->where('tenant_id', $tenantId)
            ->where('status', 'active')
            ->exists();

        if (!$payerExists) {
            return $this->jsonApiError('NotFound', 'Not Found',
                "Payer account not found in currency {$code}", 404);
        }

        if (!$this->localAccountCanTransact((int) $payerId, $tenantId)) {
            return $this->jsonApiError('Forbidden', 'Forbidden',
                'Payer has not enabled federated transactions; their balance cannot be debited by a federated transfer', 403);
        }

        if (!$this->localAccountCanTransact((int) $payeeId, $tenantId)) {
            return $this->jsonApiError('Forbidden', 'Forbidden',
                'Payee does not accept federated transactions', 403);
        }

        if ($blocked = $this->safeguardingTransferBlock((int) $payerId, (int) $payeeId, $tenantId)) {
            return $blocked;
        }

        DB::beginTransaction();
        try {
            $txId = DB::table('transactions')->insertGetId([
                'tenant_id' => $tenantId,
                'sender_id' => (int) $payerId,
                'receiver_id' => (int) $payeeId,
                'amount' => $amount,
                'description' => $description,
                'status' => $nexusStatus,
                'transaction_type' => 'komunitin_external',
                'is_federated' => 1,
                'created_at' => now(),
                'updated_at' => now(),
            ]);

            $inserted = app(\App\Services\FederationDebitApprovalService::class)->request(
                $tenantId, 'komunitin', (string) $txId, (int) $payerId, (int) $payeeId,
                (string) ($payee->username ?? $payeeId), $amount, (string) $description,
                $partnerKeyId, $requestId, $requestHash
            );
            if (!$inserted) {
                DB::rollBack();
                return $this->replayTransfer($tenantId, $partnerKeyId, $requestId, $requestHash, $code, $baseUrl)
                    ?? $this->jsonApiError('Conflict', 'Conflict', 'Transfer identity is already in use', 409);
            }
            if ($nexusStatus !== 'pending') {
                DB::table('federation_debit_approvals')->where('tenant_id', $tenantId)
                    ->where('protocol', 'komunitin')->where('reference_id', (string) $txId)
                    ->update(['status' => 'rejected', 'decided_at' => now(), 'updated_at' => now()]);
            }

            DB::commit();
        } catch (\Throwable $e) {
            DB::rollBack();
            Log::error('[FederationKomunitin] Transfer failed', ['error' => $e->getMessage()]);
            return $this->jsonApiError('InternalError', 'Internal Server Error',
                'Transfer processing failed', 500);
        }

        $tx = DB::table('transactions')
            ->where('id', $txId)
            ->first();

        return $this->jsonApiResponse(
            $this->buildTransferResource($tx, $tenantId, $code, $baseUrl),
            null, true, 201
        );
    }

    /**
     * PATCH /{code}/transfers/{id} — Update transfer state.
     */
    public function updateTransfer(Request $request, string $code, string $id): JsonResponse
    {
        $tenantId = TenantContext::getId();
        $baseUrl = $request->getSchemeAndHttpHost();
        $payload = $request->json()->all();

        $tx = DB::table('transactions')
            ->where('id', (int) $id)
            ->where('tenant_id', $tenantId)
            ->first();

        if (!$tx || $tx->transaction_type !== 'komunitin_external'
            || !$this->partnerOwnsTransfer($tenantId, (int) $id)) {
            return $this->jsonApiError('NotFound', 'Not Found',
                "Transfer id {$id} not found in currency {$code}", 404);
        }

        $newState = $payload['data']['attributes']['state'] ?? null;
        if (!$newState) {
            return $this->jsonApiError('BadRequest', 'Bad Request',
                'Missing state in request body', 400);
        }

        // Map Nexus internal status back to Komunitin state for transition validation.
        // The transactions.status schema is pending/completed/cancelled; accepted
        // remains pending until committed/completed settles funds.
        $nexusToKomunitin = [
            'pending'    => 'pending',
            'processing' => 'accepted',
            'completed'  => 'completed',
            'cancelled'  => 'rejected',
            'failed'     => 'failed',
        ];
        $currentKomunitinState = $nexusToKomunitin[$tx->status] ?? 'new';

        $validNextStates = self::VALID_TRANSITIONS[$currentKomunitinState] ?? [];
        if (!in_array($newState, $validNextStates, true)) {
            return $this->jsonApiError('UnprocessableEntity', 'Unprocessable Entity',
                "Invalid state transition from {$currentKomunitinState} to {$newState}", 422);
        }

        $newNexusStatus = match ($newState) {
            'committed', 'completed' => 'completed',
            'accepted', 'pending', 'new' => 'pending',
            'rejected', 'failed' => 'cancelled',
            default => null,
        };

        if (!$newNexusStatus) {
            return $this->jsonApiError('BadRequest', 'Bad Request',
                "Invalid state: {$newState}", 400);
        }

        $shouldSettle = $newNexusStatus === 'completed' && ($tx->status ?? '') !== 'completed';

        if ($shouldSettle) {
            $payerId = (int) ($tx->sender_id ?? 0);
            $payeeId = (int) ($tx->receiver_id ?? 0);
            $amount = (float) ($tx->amount ?? 0);

            if (!$payerId || !$payeeId || $amount <= 0) {
                return $this->jsonApiError('BadRequest', 'Bad Request',
                    'Transfer is missing payer, payee, or amount', 400);
            }

            if (!SecurityBounds::isAcceptableHourAmount($amount)) {
                return $this->jsonApiError('BadRequest', 'Bad Request',
                    'Amount exceeds maximum allowed value', 400);
            }

            $payerExists = DB::table('users')
                ->where('id', $payerId)
                ->where('tenant_id', $tenantId)
                ->where('status', 'active')
                ->exists();

            if (!$payerExists) {
                return $this->jsonApiError('NotFound', 'Not Found',
                    "Payer account not found in currency {$code}", 404);
            }

            if (!$this->localAccountCanTransact($payerId, $tenantId)) {
                return $this->jsonApiError('Forbidden', 'Forbidden',
                    'Payer has not enabled federated transactions; their balance cannot be debited by a federated transfer', 403);
            }

            $payeeExists = DB::table('users')
                ->where('id', $payeeId)
                ->where('tenant_id', $tenantId)
                ->where('status', 'active')
                ->exists();

            if (!$payeeExists) {
                return $this->jsonApiError('NotFound', 'Not Found',
                    "Payee account not found in currency {$code}", 404);
            }

            if (!$this->localAccountCanTransact($payeeId, $tenantId)) {
                return $this->jsonApiError('Forbidden', 'Forbidden',
                    'Payee does not accept federated transactions', 403);
            }

            if ($blocked = $this->safeguardingTransferBlock($payerId, $payeeId, $tenantId)) {
                return $blocked;
            }
        }

        DB::beginTransaction();
        try {
            $claimed = DB::table('transactions')
                ->where('id', (int) $id)
                ->where('tenant_id', $tenantId)
                ->where('status', $tx->status)
                ->update([
                    'status' => $newNexusStatus,
                    'updated_at' => now(),
                ]);

            if ($claimed === 0) {
                DB::rollBack();
                return $this->jsonApiError('Conflict', 'Conflict',
                    'Transfer state changed while processing this update', 409);
            }

            if ($shouldSettle) {
                $amount = (float) $tx->amount;
                $payerId = (int) $tx->sender_id;
                $payeeId = (int) $tx->receiver_id;

                if ($blocked = $this->safeguardingTransferBlock($payerId, $payeeId, $tenantId, true)) {
                    DB::rollBack();
                    return $blocked;
                }

                $approval = DB::table('federation_debit_approvals')
                    ->where('tenant_id', $tenantId)->where('protocol', 'komunitin')
                    ->where('reference_id', (string) $id)->first();
                if (!$approval || !app(\App\Services\FederationDebitApprovalService::class)->consume(
                    $tenantId, 'komunitin', (string) $id, $payerId, $payeeId,
                    (string) $approval->payee_label, $amount, (string) $tx->description
                )) {
                    DB::rollBack();
                    return $this->jsonApiError('Forbidden', 'Forbidden',
                        'Payer approval is required for this transfer', 403);
                }

                $debited = DB::update(
                    "UPDATE users SET balance = balance - ? WHERE id = ? AND tenant_id = ? AND status = 'active' AND balance >= ?",
                    [$amount, $payerId, $tenantId, $amount]
                );

                if ($debited === 0) {
                    DB::rollBack();
                    return $this->jsonApiError('Forbidden', 'Forbidden',
                        'Insufficient balance for this transfer', 403);
                }

                $credited = DB::update(
                    "UPDATE users SET balance = balance + ? WHERE id = ? AND tenant_id = ? AND status = 'active'",
                    [$amount, $payeeId, $tenantId]
                );
                if ($credited !== 1) {
                    DB::rollBack();
                    return $this->jsonApiError('Forbidden', 'Forbidden', 'Payee is unavailable', 403);
                }
            }

            DB::commit();
        } catch (\Throwable $e) {
            DB::rollBack();
            Log::error('[FederationKomunitin] Transfer update failed', ['error' => $e->getMessage()]);
            return $this->jsonApiError('InternalError', 'Internal Server Error',
                'Transfer update failed', 500);
        }

        $tx = DB::table('transactions')
            ->where('id', (int) $id)
            ->where('tenant_id', $tenantId)
            ->first();

        return $this->jsonApiResponse(
            $this->buildTransferResource($tx, $tenantId, $code, $baseUrl),
            null, true
        );
    }

    /**
     * DELETE /{code}/transfers/{id} — Delete transfer.
     */
    public function deleteTransfer(Request $request, string $code, string $id): JsonResponse
    {
        $tenantId = TenantContext::getId();

        $tx = DB::table('transactions')
            ->where('id', (int) $id)
            ->where('tenant_id', $tenantId)
            ->first();

        if (!$tx || $tx->transaction_type !== 'komunitin_external'
            || !$this->partnerOwnsTransfer($tenantId, (int) $id)) {
            return $this->jsonApiError('NotFound', 'Not Found',
                "Transfer id {$id} not found in currency {$code}", 404);
        }

        // Only pending transfers can be deleted
        if (($tx->status ?? '') === 'completed') {
            return $this->jsonApiError('BadRequest', 'Bad Request',
                'Cannot delete a committed transfer', 400);
        }

        $deleted = DB::transaction(function () use ($id, $tenantId): bool {
            $current = DB::table('transactions')->where('id', (int) $id)
                ->where('tenant_id', $tenantId)->where('transaction_type', 'komunitin_external')
                ->lockForUpdate()->first();
            if (!$current || $current->status === 'completed') {
                return false;
            }

            $removed = DB::table('transactions')->where('id', (int) $id)
                ->where('tenant_id', $tenantId)->where('transaction_type', 'komunitin_external')
                ->where('status', $current->status)->delete();
            if ($removed !== 1) {
                return false;
            }

            DB::table('federation_debit_approvals')
                ->where('tenant_id', $tenantId)->where('protocol', 'komunitin')
                ->where('reference_id', (string) $id)
                ->whereIn('status', ['pending', 'approved'])
                ->update(['status' => 'rejected', 'decided_at' => now(), 'updated_at' => now()]);
            return true;
        });

        if (!$deleted) {
            return $this->jsonApiError('Conflict', 'Conflict',
                'Transfer state changed while processing this deletion', 409);
        }

        return response()->json(null, 204, [
            'Content-Type' => 'application/vnd.api+json',
        ]);
    }

    private function safeguardingTransferBlock(int $payerId, int $payeeId, int $tenantId, bool $locked = false): ?JsonResponse
    {
        $policy = app(SafeguardingInteractionPolicy::class);
        $decision = $locked
            ? $policy->evaluateLockedLocalContact($payerId, $payeeId, $tenantId, 'komunitin_transfer')
            : $policy->evaluateLocalContact($payerId, $payeeId, $tenantId, 'komunitin_transfer');
        if ($decision->isAllowed()) {
            return null;
        }

        $error = MessageService::buildSafeguardingError([
            'status' => $decision->status,
            'code' => $decision->code,
            'required_vetting_types' => $decision->requiredAttestationCodes,
            'required_vetting_labels' => $decision->requiredAttestationLabels,
            'can_request_coordinator' => $decision->canRequestCoordinator,
        ]);

        return $this->jsonApiError(
            $decision->code,
            (string) ($error['title'] ?? $error['message']),
            (string) $error['message'],
            $decision->isUnavailable() ? 503 : 403,
        );
    }

    private function replayTransfer(
        int $tenantId,
        int $partnerKeyId,
        string $requestId,
        string $requestHash,
        string $code,
        string $baseUrl,
    ): ?JsonResponse {
        $approval = DB::table('federation_debit_approvals')
            ->where('tenant_id', $tenantId)->where('protocol', 'komunitin')
            ->where('partner_key_id', $partnerKeyId)->where('partner_request_id', $requestId)->first();
        if (!$approval) {
            return null;
        }
        if (!hash_equals((string) $approval->request_hash, $requestHash)) {
            return $this->jsonApiError('Conflict', 'Conflict', 'Transfer identity has different terms', 409);
        }
        $tx = DB::table('transactions')->where('id', (int) $approval->reference_id)
            ->where('tenant_id', $tenantId)->where('transaction_type', 'komunitin_external')->first();
        return $tx
            ? $this->jsonApiResponse($this->buildTransferResource($tx, $tenantId, $code, $baseUrl), null, true, 200)
            : $this->jsonApiError('Conflict', 'Conflict', 'Transfer is no longer available', 409);
    }

    private function partnerOwnsTransfer(int $tenantId, int $transferId): bool
    {
        $partnerKeyId = (int) (FederationApiMiddleware::getPartner()['id'] ?? 0);
        return $partnerKeyId > 0 && DB::table('federation_debit_approvals')
            ->where('tenant_id', $tenantId)->where('protocol', 'komunitin')
            ->where('reference_id', (string) $transferId)->where('partner_key_id', $partnerKeyId)
            ->exists();
    }

    /**
     * F-329 — the collection form of partnerOwnsTransfer().
     *
     * Restricts a `transactions` query to the external transfers the calling
     * partner is party to: the row must be a komunitin transfer AND carry a
     * debit-approval record naming this partner key. An unauthenticated or
     * unrecognised caller has partner key id 0, which matches no approval row,
     * so the query yields nothing — it fails closed.
     */
    private function scopeToPartnerOwnedTransfers(\Illuminate\Database\Query\Builder $query, int $tenantId): void
    {
        $partnerKeyId = (int) (FederationApiMiddleware::getPartner()['id'] ?? 0);

        $query->where('transactions.transaction_type', 'komunitin_external')
            ->whereExists(function ($sub) use ($tenantId, $partnerKeyId) {
                $sub->from('federation_debit_approvals as fda')
                    ->whereColumn('fda.reference_id', 'transactions.id')
                    ->where('fda.tenant_id', $tenantId)
                    ->where('fda.protocol', 'komunitin')
                    ->where('fda.partner_key_id', $partnerKeyId);
            });
    }

    // ─────────────────────────────────────────────────────────────────────────
    // Resource builders
    // ─────────────────────────────────────────────────────────────────────────

    private function buildCurrencyResource(int $tenantId): array
    {
        $tenant = DB::table('tenants')->where('id', $tenantId)->first(['slug', 'name']);
        $currencyCode = strtoupper($tenant->slug ?? 'HOURS');

        $inactive = false;
        try {
            $inactive = (bool) DB::table('tenant_settings')
                ->where('tenant_id', $tenantId)
                ->where('setting_key', 'federation.komunitin.currency_inactive')
                ->value('setting_value');
        } catch (\Throwable $e) {
            // tenant_settings table may be missing in minimal test schemas
        }

        return [
            'type' => 'currencies',
            'id' => "hours-{$tenantId}",
            'attributes' => [
                'code' => $currencyCode,
                'status' => $inactive ? 'inactive' : 'active',
                'name' => 'Hours',
                'namePlural' => 'Hours',
                'symbol' => 'h',
                'decimals' => 2,
                'scale' => KomunitinAdapter::MINOR_UNITS_PER_HOUR,
                'rate' => ['n' => 1, 'd' => 1],
                'created' => $tenant->created_at ?? now()->toIso8601String(),
                'updated' => now()->toIso8601String(),
            ],
            'links' => [
                'self' => "/api/v2/federation/komunitin/{$currencyCode}/currency",
            ],
        ];
    }

    private function buildAccountResource(object $user, int $tenantId, string $code, string $baseUrl): array
    {
        $accountCode = strtoupper($code) . str_pad((string) $user->id, 4, '0', STR_PAD_LEFT);

        // Resolve credit limit: prefer tenant setting, fall back to credit agreement max, then -100h default.
        $creditLimitHours = null;
        try {
            $settingVal = DB::table('tenant_settings')
                ->where('tenant_id', $tenantId)
                ->where('setting_key', 'federation.komunitin.default_credit_limit')
                ->value('setting_value');
            if ($settingVal !== null) {
                $creditLimitHours = (float) $settingVal;
            }
        } catch (\Throwable $e) {
            // table may not exist in minimal test schemas
        }

        if ($creditLimitHours === null) {
            try {
                $maxMonthly = DB::table('federation_credit_agreements')
                    ->where('to_tenant_id', $tenantId)
                    ->where('status', 'active')
                    ->value('max_monthly_credits');
                if ($maxMonthly !== null) {
                    // Negate: credit limit is expressed as negative in Komunitin spec
                    $creditLimitHours = -(float) $maxMonthly;
                }
            } catch (\Throwable $e) {
                // table may not exist
            }
        }

        if ($creditLimitHours === null) {
            $creditLimitHours = -100.0;
        }

        return [
            'type' => 'accounts',
            'id' => (string) $user->id,
            'attributes' => [
                'code' => $accountCode,
                'balance' => KomunitinAdapter::hoursToMinorUnits((float) $user->balance),
                'creditLimit' => KomunitinAdapter::hoursToMinorUnits($creditLimitHours),
                'debitLimit' => KomunitinAdapter::hoursToMinorUnits(0.0),
                'created' => $user->created_at,
                'updated' => $user->updated_at ?? $user->created_at,
            ],
            'relationships' => [
                'currency' => [
                    'data' => ['type' => 'currencies', 'id' => "hours-{$tenantId}"],
                ],
                'users' => [
                    'data' => [
                        [
                            'type' => 'users',
                            'id' => (string) $user->id,
                            'meta' => ['external' => false, 'href' => null],
                        ],
                    ],
                ],
            ],
            'links' => [
                'self' => "{$baseUrl}/api/v2/federation/komunitin/{$code}/accounts/{$user->id}",
            ],
        ];
    }

    private function buildTransferResource(object $tx, int $tenantId, string $code, string $baseUrl): array
    {
        // Generate a hash for the transfer (matching Komunitin spec)
        $hash = hash('sha256', "{$tx->id}|{$tx->sender_id}|{$tx->receiver_id}|{$tx->amount}|{$tx->created_at}");

        return [
            'type' => 'transfers',
            'id' => (string) $tx->id,
            'attributes' => [
                'amount' => KomunitinAdapter::hoursToMinorUnits((float) $tx->amount),
                'meta' => $tx->description ?? '',
                'state' => match ($tx->status ?? 'pending') {
                    'completed' => 'committed',
                    'pending' => 'pending',
                    'cancelled' => 'rejected',
                    default => 'pending',
                },
                'created' => $tx->created_at,
                'updated' => $tx->updated_at ?? $tx->created_at,
                'hash' => $hash,
            ],
            'relationships' => [
                'payer' => [
                    'data' => ['type' => 'accounts', 'id' => (string) $tx->sender_id],
                ],
                'payee' => [
                    'data' => ['type' => 'accounts', 'id' => (string) $tx->receiver_id],
                ],
                'currency' => [
                    'data' => ['type' => 'currencies', 'id' => "hours-{$tenantId}"],
                ],
            ],
            'links' => [
                'self' => "{$baseUrl}/api/v2/federation/komunitin/{$code}/transfers/{$tx->id}",
            ],
        ];
    }

    private function discoverableFederatedAccountQuery(int $tenantId): \Illuminate\Database\Query\Builder
    {
        return DB::table('users')
            ->join('federation_user_settings as fus', 'fus.user_id', '=', 'users.id')
            ->where('users.tenant_id', $tenantId)
            ->where('users.status', 'active')
            ->where('fus.federation_optin', 1)
            ->where('fus.profile_visible_federated', 1)
            ->where('fus.appear_in_federated_search', 1)
            ->where('fus.transactions_enabled_federated', 1);
    }

    private function localAccountCanTransact(int $userId, int $tenantId): bool
    {
        return DB::table('users')
            ->join('federation_user_settings as fus', 'fus.user_id', '=', 'users.id')
            ->where('users.id', $userId)
            ->where('users.tenant_id', $tenantId)
            ->where('users.status', 'active')
            ->where('fus.federation_optin', 1)
            ->where('fus.transactions_enabled_federated', 1)
            ->exists();
    }

    // ─────────────────────────────────────────────────────────────────────────
    // JSON:API response helpers
    // ─────────────────────────────────────────────────────────────────────────

    /**
     * Build a JSON:API-compliant response matching the Komunitin spec.
     */
    private function jsonApiResponse(
        array $data,
        ?array $meta = null,
        bool $isSingle = false,
        int $status = 200,
        ?array $links = null
    ): JsonResponse {
        $response = [
            '@context' => 'https://komunitin.org/ns',
            'data' => $isSingle ? $data : array_values($data),
        ];

        if ($links) {
            $response['links'] = $links;
        }

        if ($meta) {
            $response['meta'] = $meta;
        }

        // JSON:API spec: include empty included array for collections
        if (!$isSingle) {
            $response['included'] = [];
        }

        return response()->json($response, $status, [
            'Content-Type' => 'application/vnd.api+json',
            'API-Version' => '2.0',
        ]);
    }

    /**
     * Build a JSON:API-compliant error response matching the Komunitin spec.
     *
     * Format: {errors: [{status, code, title, detail}]}
     */
    private function jsonApiError(string $code, string $title, string $detail, int $status = 400): JsonResponse
    {
        return response()->json([
            'errors' => [
                [
                    'status' => (string) $status,
                    'code' => $code,
                    'title' => $title,
                    'detail' => $detail,
                ],
            ],
        ], $status, [
            'Content-Type' => 'application/vnd.api+json',
        ]);
    }

    /**
     * Build a pagination URL with page[size] and page[after] parameters.
     *
     * The cursor is base64-encoded JSON so it is opaque to clients.
     */
    private function buildPaginationUrl(Request $request, int $offset, int $pageSize): string
    {
        $baseUrl = $request->url();
        $params = $request->query();

        // Remove existing pagination params
        unset($params['page']);
        unset($params['page_size']);
        unset($params['page_after']);

        $params['page[size]'] = $pageSize;
        $params['page[after]'] = base64_encode(json_encode(['offset' => $offset]));

        return $baseUrl . '?' . http_build_query($params);
    }

    /**
     * Decode an opaque cursor string into a numeric OFFSET for
     * Federation pagination. Distinct from BaseApiController::decodeCursor,
     * which decodes a base64 cursor into a string ID.
     *
     * Accepts both the new base64-JSON format and legacy raw integers
     * for backwards compatibility.
     */
    protected function decodeOffsetCursor(?string $cursor): int
    {
        if ($cursor === null || $cursor === '') {
            return 0;
        }
        // Try new opaque base64-JSON format first
        $decoded = base64_decode($cursor, true);
        if ($decoded !== false) {
            $parsed = json_decode($decoded, true);
            if (is_array($parsed) && isset($parsed['offset'])) {
                return max(0, (int) $parsed['offset']);
            }
        }
        // Fall back to legacy raw integer cursor
        return max(0, (int) $cursor);
    }
}
