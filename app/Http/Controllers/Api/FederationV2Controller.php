<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

declare(strict_types=1);

namespace App\Http\Controllers\Api;

use App\Services\FederationActivityService;
use App\Services\FederationEmailService;
use App\Services\FederationRealtimeService;
use App\Services\FederationUserService;
use App\Services\TranscriptionService;
use App\Services\TranslationConfigurationService;
use Illuminate\Http\JsonResponse;
use Illuminate\Support\Facades\DB;
use App\I18n\LocaleContext;
use App\Models\Notification;
use App\Services\FederatedConnectionService;
use App\Services\FederationAuditService;
use App\Services\FederationFeatureService;
use App\Services\FederationPartnershipService;
use App\Services\FederationSearchService;
use App\Services\MessageService;
use App\Services\SafeguardingInteractionPolicy;
use App\Support\UserDisplayName;

/**
 * FederationV2Controller -- Federation v2: cross-tenant discovery, messaging, connections.
 *
 * All methods migrated from delegation to direct service/DB calls.
 */
class FederationV2Controller extends BaseApiController
{
    protected bool $isV2Api = true;

    public function __construct(
        private readonly FederatedConnectionService $federatedConnectionService,
        private readonly FederationActivityService $federationActivityService,
        private readonly FederationAuditService $federationAuditService,
        private readonly FederationEmailService $federationEmailService,
        private readonly FederationFeatureService $federationFeatureService,
        private readonly FederationPartnershipService $federationPartnershipService,
        private readonly FederationRealtimeService $federationRealtimeService,
        private readonly FederationUserService $federationUserService,
    ) {}

    private const LEVEL_NAMES = [
        1 => 'Discovery',
        2 => 'Social',
        3 => 'Economic',
        4 => 'Integrated',
    ];

    /**
     * Parse the partner_id query parameter.
     *
     * Returns ['type' => 'external'|'internal', 'id' => int] or null if no filter.
     * External partners use composite IDs like "ext-7"; internal use plain integers.
     */
    private function parsePartnerFilter(): ?array
    {
        // Laravel returns an array for ?partner_id[]=1 — treat any non-scalar
        // value as "no filter" instead of letting str_starts_with() throw a
        // TypeError before the endpoint's try/catch (uncaught 500).
        $raw = $this->queryScalar('partner_id');
        if ($raw === '') {
            return null;
        }
        if (str_starts_with($raw, 'ext-')) {
            $id = (int) substr($raw, 4);
            return $id > 0 ? ['type' => 'external', 'id' => $id] : null;
        }
        $id = (int) $raw;
        return $id > 0 ? ['type' => 'internal', 'id' => $id] : null;
    }

    /**
     * Read a query parameter that must be a scalar string. Array-valued input
     * (?key[]=x) is coerced to the default rather than fataling downstream.
     */
    private function queryScalar(string $key, string $default = ''): string
    {
        $raw = $this->query($key, $default);
        return is_scalar($raw) ? (string) $raw : $default;
    }

    /**
     * Resolve a relative avatar/image URL from an external partner against their base_url.
     * Returns the URL unchanged if it's already absolute, or null if empty.
     */
    private static function resolveExternalUrl(?string $url, string $partnerBaseUrl): ?string
    {
        if (!$url || $url === '') return null;
        if (str_starts_with($url, 'http://') || str_starts_with($url, 'https://')) return $url;
        return $partnerBaseUrl . '/' . ltrim($url, '/');
    }

    /**
     * Get the base_url for an external partner (cached per request).
     */
    private function getPartnerBaseUrl(int $externalPartnerId): string
    {
        static $cache = [];
        if (!isset($cache[$externalPartnerId])) {
            $partner = \App\Services\FederationExternalPartnerService::getById($externalPartnerId, $this->getTenantId());
            $cache[$externalPartnerId] = rtrim($partner['base_url'] ?? '', '/');
        }
        return $cache[$externalPartnerId];
    }

    private function requireFederationOperation(string $operation): ?JsonResponse
    {
        $check = $this->federationFeatureService->isOperationAllowed($operation, $this->getTenantId());
        if ($check['allowed'] ?? false) {
            return null;
        }

        return $this->respondWithError('FORBIDDEN', __('api.federation.feature_disabled'), null, 403);
    }

    private function requireFederationOptIn(): ?JsonResponse
    {
        $userId = $this->getUserId();
        $tenantId = $this->getTenantId();

        if (FederationUserService::hasOptedIn($userId, $tenantId)) {
            return null;
        }

        return $this->respondWithError('FEDERATION_NOT_ENABLED', __('api.fed_must_opt_in_first'), null, 403);
    }

    private function getActiveExternalPartnerForOperation(int $externalPartnerId, int $tenantId, string $allowFlag): ?array
    {
        $partner = \App\Services\FederationExternalPartnerService::getById($externalPartnerId, $tenantId);
        if (!$partner || ($partner['status'] ?? '') !== 'active') {
            return null;
        }

        if (!($partner[$allowFlag] ?? false)) {
            return null;
        }

        return $partner;
    }

    private function payloadBool(array $data, string $key, bool $default): bool
    {
        if (!array_key_exists($key, $data)) {
            return $default;
        }

        $value = $data[$key];
        if (is_bool($value)) {
            return $value;
        }
        if (is_int($value)) {
            return $value === 1;
        }
        if (is_string($value)) {
            $normalized = filter_var($value, FILTER_VALIDATE_BOOLEAN, FILTER_NULL_ON_FAILURE);
            return $normalized ?? $default;
        }

        return $default;
    }

    private function parseExternalMemberIdentifier(string $memberId, int $expectedPartnerId): string
    {
        $memberId = trim($memberId);
        if ($memberId === '') {
            return '';
        }

        if (!str_starts_with($memberId, 'ext-')) {
            return $memberId;
        }

        $parts = explode('-', $memberId, 3);
        $partnerId = (int) ($parts[1] ?? 0);
        $remoteId = trim((string) ($parts[2] ?? ''));

        if ($partnerId !== $expectedPartnerId || $remoteId === '') {
            return '';
        }

        return $remoteId;
    }

    private function externalMemberNumericSurrogate(string $remoteId): int
    {
        if (ctype_digit($remoteId) && (int) $remoteId > 0) {
            return (int) $remoteId;
        }

        return max(1, (int) (crc32($remoteId) % 2147483647));
    }

    private function transactionsSupportFederationIdempotency(): bool
    {
        static $supports = null;

        if ($supports === null) {
            try {
                $supports = \Illuminate\Support\Facades\Schema::hasColumn('transactions', 'federation_idempotency_key');
            } catch (\Throwable $e) {
                $supports = false;
            }
        }

        return $supports;
    }

    private function transactionColumnExists(string $column): bool
    {
        static $columns = [];

        if (!array_key_exists($column, $columns)) {
            try {
                $columns[$column] = \Illuminate\Support\Facades\Schema::hasColumn('transactions', $column);
            } catch (\Throwable $e) {
                $columns[$column] = false;
            }
        }

        return $columns[$column];
    }

    private function federatedTransactionIdempotencyReplay(
        int $tenantId,
        int $userId,
        string $fingerprint,
        string $payloadHash
    ): ?JsonResponse {
        if (!$this->transactionsSupportFederationIdempotency()) {
            return null;
        }

        $row = DB::table('transactions')
            ->where('tenant_id', $tenantId)
            ->where('sender_id', $userId)
            ->where('is_federated', 1)
            ->where('federation_idempotency_key', $fingerprint)
            ->orderByDesc('id')
            ->first();

        if (!$row) {
            return null;
        }

        $storedPayloadHash = (string) ($row->federation_idempotency_payload_hash ?? '');
        if ($storedPayloadHash !== '' && !hash_equals($storedPayloadHash, $payloadHash)) {
            return $this->respondWithError('DUPLICATE_TRANSACTION', __('api.fed_transaction_failed'), null, 409);
        }

        $status = (string) ($row->status ?? 'pending');
        if ($status === 'cancelled') {
            return $this->respondWithError('EXTERNAL_TX_FAILED', __('api.fed_external_partner_rejected'), null, 422);
        }

        $partnerName = __('api.external_partner_fallback');
        $partnerId = (int) ($row->receiver_tenant_id ?? 0);
        if ($partnerId > 0) {
            $partnerName = (string) (DB::table('federation_external_partners')
                ->where('tenant_id', $tenantId)
                ->where('id', $partnerId)
                ->value('name') ?? $partnerName);
        }

        $payload = [
            'transaction_id' => (int) $row->id,
            'status' => $status === 'completed' ? 'completed' : 'pending',
            'amount' => (int) $row->amount,
            'is_external' => true,
            'external_partner' => $partnerName,
        ];

        return $this->respondWithData($payload, null, $status === 'completed' ? 201 : 202);
    }

    private function isDuplicateKeyException(\Throwable $e): bool
    {
        return str_contains((string) $e->getCode(), '23000')
            || str_contains($e->getMessage(), 'Duplicate entry')
            || str_contains($e->getMessage(), 'Integrity constraint violation');
    }

    private function claimTransactionIdempotency(
        int $tenantId,
        int $userId,
        string $receiverId,
        string $receiverTenantId,
        int $amount,
        string $description
    ): array {
        $explicitKey = trim((string) (request()->header('Idempotency-Key') ?? request()->input('idempotency_key', '')));
        $hasExplicitKey = $explicitKey !== '';
        $fingerprint = $hasExplicitKey
            ? sha1('key:' . $explicitKey)
            : sha1('content:' . $receiverId . '|' . $receiverTenantId . '|' . $amount . '|' . $description);
        $payloadHash = sha1($receiverId . '|' . $receiverTenantId . '|' . $amount . '|' . $description);
        $cacheKey = "fedtx:idem:{$tenantId}:{$userId}:{$fingerprint}";
        $ttl = $hasExplicitKey ? 86400 : 120;
        $partnerKey = "nexus-tx-{$tenantId}-{$userId}-{$fingerprint}";

        $durableReplay = $this->federatedTransactionIdempotencyReplay($tenantId, $userId, $fingerprint, $payloadHash);
        if ($durableReplay instanceof JsonResponse) {
            return [
                'cache_key' => $cacheKey,
                'ttl' => $ttl,
                'partner_key' => $partnerKey,
                'fingerprint' => $fingerprint,
                'payload_hash' => $payloadHash,
                'response' => $durableReplay,
            ];
        }

        try {
            $claimed = \Illuminate\Support\Facades\Cache::add($cacheKey, ['status' => 'pending'], $ttl);
        } catch (\Throwable $e) {
            return [
                'cache_key' => null,
                'ttl' => 0,
                'partner_key' => $partnerKey,
                'fingerprint' => $fingerprint,
                'payload_hash' => $payloadHash,
                'response' => null,
            ];
        }

        if (!$claimed) {
            $prior = null;
            try {
                $prior = \Illuminate\Support\Facades\Cache::get($cacheKey);
            } catch (\Throwable $e) {
                $prior = null;
            }

            if (is_array($prior) && isset($prior['transaction_id'])) {
                $status = (int) ($prior['http_status'] ?? 201);
                unset($prior['http_status']);

                return [
                    'cache_key' => $cacheKey,
                    'ttl' => $ttl,
                    'partner_key' => $partnerKey,
                    'fingerprint' => $fingerprint,
                    'payload_hash' => $payloadHash,
                    'response' => $this->respondWithData($prior, null, $status),
                ];
            }

            return [
                'cache_key' => $cacheKey,
                'ttl' => $ttl,
                'partner_key' => $partnerKey,
                'fingerprint' => $fingerprint,
                'payload_hash' => $payloadHash,
                'response' => $this->respondWithError('DUPLICATE_TRANSACTION', __('api.fed_transaction_failed'), null, 409),
            ];
        }

        return [
            'cache_key' => $cacheKey,
            'ttl' => $ttl,
            'partner_key' => $partnerKey,
            'fingerprint' => $fingerprint,
            'payload_hash' => $payloadHash,
            'response' => null,
        ];
    }

    private function rememberTransactionIdempotency(?string $cacheKey, int $ttl, array $payload, int $httpStatus): void
    {
        if ($cacheKey === null || $ttl <= 0) {
            return;
        }

        try {
            \Illuminate\Support\Facades\Cache::put($cacheKey, array_merge($payload, ['http_status' => $httpStatus]), $ttl);
        } catch (\Throwable $e) {
            // Best effort only; a cache outage must not block a completed transfer.
        }
    }

    private function forgetTransactionIdempotency(?string $cacheKey): void
    {
        if ($cacheKey === null) {
            return;
        }

        try {
            \Illuminate\Support\Facades\Cache::forget($cacheKey);
        } catch (\Throwable $e) {
            // Best effort only.
        }
    }

    // =====================================================================
    // STATUS & OPT-IN/OUT
    // =====================================================================

    /** GET /api/v2/federation/status */
    public function status(): JsonResponse
    {
        $userId = $this->getUserId();
        $tenantId = $this->getTenantId();

        $tenantFederationEnabled = $this->federationFeatureService->isGloballyEnabled()
            && $this->federationFeatureService->isTenantFederationEnabled($tenantId);

        $userSettings = $this->federationUserService->getUserSettings($userId);
        $userOptedIn = (bool) ($userSettings['federation_optin'] ?? false);

        $partnershipsCount = 0;
        try {
            $result = DB::selectOne(
                "SELECT COUNT(*) as cnt FROM federation_partnerships
                 WHERE (tenant_id = ? OR partner_tenant_id = ?) AND status = 'active'",
                [$tenantId, $tenantId]
            );
            $partnershipsCount = (int) ($result->cnt ?? 0);
        } catch (\Exception $e) {
            \Illuminate\Support\Facades\Log::warning("FederationV2Api::status partnerships count error: " . $e->getMessage());
        }

        // Get real message/transaction counts for the hub stats
        $messagesCount = 0;
        $transactionsCount = 0;
        if ($tenantFederationEnabled && $userOptedIn) {
            try {
                $msgResult = DB::selectOne(
                    "SELECT COUNT(*) as cnt FROM federation_messages
                     WHERE (
                        external_partner_id IS NULL
                        AND (
                            (direction = 'outbound' AND sender_user_id = ? AND sender_tenant_id = ?)
                            OR (direction = 'inbound' AND receiver_user_id = ? AND receiver_tenant_id = ?)
                        )
                     ) OR (
                        external_partner_id IS NOT NULL
                        AND (
                            (direction = 'outbound' AND sender_user_id = ? AND sender_tenant_id = ?)
                            OR (direction = 'inbound' AND receiver_user_id = ? AND receiver_tenant_id = ?)
                        )
                     )",
                    [$userId, $tenantId, $userId, $tenantId, $userId, $tenantId, $userId, $tenantId]
                );
                $messagesCount = (int) ($msgResult->cnt ?? 0);
            } catch (\Exception $e) {
                // federation_messages table may not exist yet
            }
            try {
                $txResult = DB::selectOne(
                    "SELECT COUNT(*) as cnt FROM transactions
                     WHERE is_federated = 1
                       AND (
                           (sender_id = ? AND sender_tenant_id = ?)
                           OR (receiver_id = ? AND receiver_tenant_id = ?)
                       )",
                    [$userId, $tenantId, $userId, $tenantId]
                );
                $transactionsCount = (int) ($txResult->cnt ?? 0);
            } catch (\Exception $e) {
                // ignore
            }
        }

        return $this->respondWithData([
            'enabled' => $tenantFederationEnabled && $userOptedIn,
            'tenant_federation_enabled' => $tenantFederationEnabled,
            'partnerships_count' => $partnershipsCount,
            'federation_optin' => $userOptedIn,
            'messages_count' => $messagesCount,
            'transactions_count' => $transactionsCount,
        ]);
    }

    /** POST /api/v2/federation/opt-in */
    public function optIn(): JsonResponse
    {
        $userId = $this->getUserId();
        $tenantId = $this->getTenantId();

        $tenantEnabled = $this->federationFeatureService->isGloballyEnabled()
            && $this->federationFeatureService->isTenantFederationEnabled($tenantId);

        if (!$tenantEnabled) {
            return $this->respondWithError('FEDERATION_NOT_AVAILABLE', __('api.fed_not_available'), null, 403);
        }

        $current = $this->federationUserService->getUserSettings($userId);

        if ($current['federation_optin']) {
            return $this->respondWithData(['success' => true, 'message' => __('api_controllers_1.federation.already_opted_in')]);
        }

        $settings = array_merge($current, [
            'federation_optin' => true,
            'profile_visible_federated' => true,
            'appear_in_federated_search' => true,
            'show_skills_federated' => true,
            'show_location_federated' => false,
            'show_reviews_federated' => true,
            'messaging_enabled_federated' => true,
            'transactions_enabled_federated' => true,
            'service_reach' => $current['service_reach'] ?? 'local_only',
            'travel_radius_km' => $current['travel_radius_km'] ?? 50,
        ]);

        $success = $this->federationUserService->updateSettings($userId, $settings);

        if ($success) {
            $this->federationAuditService->log('user_federation_optin', $tenantId, null, $userId, [], FederationAuditService::LEVEL_INFO);
            return $this->respondWithData(['success' => true, 'message' => __('api_controllers_1.federation.enabled_successfully')]);
        }

        return $this->respondWithError('OPT_IN_FAILED', __('api.fed_opt_in_failed'), null, 500);
    }

    /** POST /api/v2/federation/setup */
    public function setup(): JsonResponse
    {
        $userId = $this->getUserId();
        $tenantId = $this->getTenantId();

        $tenantEnabled = $this->federationFeatureService->isGloballyEnabled()
            && $this->federationFeatureService->isTenantFederationEnabled($tenantId);

        if (!$tenantEnabled) {
            return $this->respondWithError('FEDERATION_NOT_AVAILABLE', __('api.fed_not_available'), null, 403);
        }

        $data = $this->getAllInput();

        $settings = [
            'federation_optin' => true,
            'profile_visible_federated' => $this->payloadBool($data, 'profile_visible_federated', true),
            'appear_in_federated_search' => $this->payloadBool($data, 'appear_in_federated_search', true),
            'show_skills_federated' => $this->payloadBool($data, 'show_skills_federated', true),
            'show_location_federated' => $this->payloadBool($data, 'show_location_federated', false),
            'show_reviews_federated' => $this->payloadBool($data, 'show_reviews_federated', true),
            'messaging_enabled_federated' => $this->payloadBool($data, 'messaging_enabled_federated', true),
            'transactions_enabled_federated' => $this->payloadBool($data, 'transactions_enabled_federated', true),
            'email_notifications' => $this->payloadBool($data, 'email_notifications', true),
            'service_reach' => $data['service_reach'] ?? 'local_only',
            'travel_radius_km' => array_key_exists('travel_radius_km', $data) ? (int) $data['travel_radius_km'] : 25,
        ];

        $success = $this->federationUserService->updateSettings($userId, $settings);

        if ($success) {
            $this->federationAuditService->log('user_federation_optin', $tenantId, null, $userId, [], FederationAuditService::LEVEL_INFO);
            return $this->respondWithData(['success' => true, 'message' => __('api_controllers_1.federation.enabled_successfully')]);
        }

        return $this->respondWithError('SETUP_FAILED', __('api.fed_setup_failed'), null, 500);
    }

    /** POST /api/v2/federation/opt-out */
    public function optOut(): JsonResponse
    {
        $userId = $this->getUserId();
        $tenantId = $this->getTenantId();

        $success = $this->federationUserService->optOut($userId);

        if ($success) {
            $this->federationAuditService->log('user_federation_optout', $tenantId, null, $userId, [], FederationAuditService::LEVEL_INFO);
            // GDPR: propagate retraction to all federated partners asynchronously.
            \App\Events\UserFederatedOptOut::dispatch($userId, $tenantId, 'opt_out');
            return $this->respondWithData(['success' => true, 'message' => __('api_controllers_1.federation.disabled_successfully')]);
        }

        return $this->respondWithError('OPT_OUT_FAILED', __('api.fed_opt_out_failed'), null, 500);
    }

    // =====================================================================
    // PARTNERS
    // =====================================================================

    /** GET /api/v2/federation/partners */
    public function partners(): JsonResponse
    {
        if ($blocked = $this->requireFederationOperation('profiles')) {
            return $blocked;
        }

        $this->getUserId();
        $tenantId = $this->getTenantId();

        try {
            $partnershipResults = DB::select("
                SELECT
                    fp.id as partnership_id, fp.federation_level,
                    fp.created_at as partnership_since,
                    fp.profiles_enabled, fp.messaging_enabled, fp.transactions_enabled,
                    fp.listings_enabled, fp.events_enabled, fp.groups_enabled,
                    CASE WHEN fp.tenant_id = ? THEN fp.partner_tenant_id ELSE fp.tenant_id END as partner_tenant_id,
                    CASE WHEN fp.tenant_id = ? THEN t2.name ELSE t1.name END as partner_name,
                    CASE WHEN fp.tenant_id = ? THEN t2.tagline ELSE t1.tagline END as partner_tagline,
                    CASE WHEN fp.tenant_id = ? THEN t2.location_name ELSE t1.location_name END as partner_location,
                    CASE WHEN fp.tenant_id = ? THEN t2.country_code ELSE t1.country_code END as partner_country,
                    CASE WHEN fp.tenant_id = ? THEN dp2.logo_url ELSE dp1.logo_url END as partner_logo,
                    (SELECT COUNT(*) FROM users u
                     JOIN federation_user_settings fus2 ON fus2.user_id = u.id AND fus2.federation_optin = 1
                     WHERE u.tenant_id = CASE WHEN fp.tenant_id = ? THEN fp.partner_tenant_id ELSE fp.tenant_id END
                       AND u.status = 'active') as partner_member_count,
                    (SELECT COUNT(*) FROM listings li
                     JOIN federation_user_settings fusl ON fusl.user_id = li.user_id
                     WHERE li.tenant_id = CASE WHEN fp.tenant_id = ? THEN fp.partner_tenant_id ELSE fp.tenant_id END
                       AND li.status = 'active'
                       AND li.federated_visibility IN ('listed', 'bookable')
                       AND fusl.federation_optin = 1
                       AND fusl.profile_visible_federated = 1
                       AND fusl.appear_in_federated_search = 1) as partner_listing_count
                FROM federation_partnerships fp
                LEFT JOIN tenants t1 ON fp.tenant_id = t1.id
                LEFT JOIN tenants t2 ON fp.partner_tenant_id = t2.id
                LEFT JOIN federation_directory_profiles dp1 ON dp1.tenant_id = fp.tenant_id
                LEFT JOIN federation_directory_profiles dp2 ON dp2.tenant_id = fp.partner_tenant_id
                WHERE (fp.tenant_id = ? OR fp.partner_tenant_id = ?) AND fp.status = 'active'
                ORDER BY partner_name ASC
            ", [$tenantId, $tenantId, $tenantId, $tenantId, $tenantId, $tenantId, $tenantId, $tenantId, $tenantId, $tenantId]);
            $partnerships = array_map(fn($r) => (array)$r, $partnershipResults);

            $formatted = array_map(function ($p) {
                $level = (int) ($p['federation_level'] ?? 1);
                $permissions = [];
                if ($p['profiles_enabled']) $permissions[] = 'profiles';
                if ($p['messaging_enabled']) $permissions[] = 'messaging';
                if ($p['transactions_enabled']) $permissions[] = 'transactions';
                if ($p['listings_enabled']) $permissions[] = 'listings';
                if ($p['events_enabled']) $permissions[] = 'events';
                if ($p['groups_enabled']) $permissions[] = 'groups';

                return [
                    'id' => (int) $p['partner_tenant_id'],
                    'name' => $p['partner_name'] ?? __('api.unknown_user'),
                    'logo' => $p['partner_logo'] ?: null,
                    'tagline' => $p['partner_tagline'] ?? '',
                    'location' => $p['partner_location'] ?? '',
                    'country' => $p['partner_country'] ?? '',
                    'member_count' => (int) ($p['partner_member_count'] ?? 0),
                    'listing_count' => (int) ($p['partner_listing_count'] ?? 0),
                    'federation_level' => $level,
                    'federation_level_name' => self::LEVEL_NAMES[$level] ?? 'Discovery',
                    'permissions' => $permissions,
                    'partnership_since' => $p['partnership_since'] ?? null,
                ];
            }, $partnerships);

            // Also include active external partners
            $externalPartners = $this->getExternalPartnersForDisplay($tenantId);
            $formatted = array_merge($formatted, $externalPartners);

            return $this->respondWithData($formatted);
        } catch (\Exception $e) {
            \Illuminate\Support\Facades\Log::warning("FederationV2Api::partners error: " . $e->getMessage());
            return $this->respondWithData([]);
        }
    }

    /**
     * Fetch active external partners formatted for the Partner Communities page.
     */
    private function getExternalPartnersForDisplay(int $tenantId): array
    {
        try {
            $externalPartners = \App\Services\FederationExternalPartnerService::getActivePartners($tenantId);

            return array_map(function ($ep) {
                $permissions = [];
                if ($ep['allow_member_search'] ?? false) $permissions[] = 'profiles';
                if ($ep['allow_messaging'] ?? false) $permissions[] = 'messaging';
                if ($ep['allow_transactions'] ?? false) $permissions[] = 'transactions';
                if ($ep['allow_listing_search'] ?? false) $permissions[] = 'listings';
                if ($ep['allow_events'] ?? false) $permissions[] = 'events';
                if ($ep['allow_groups'] ?? false) $permissions[] = 'groups';

                return [
                    'id' => 'ext-' . $ep['id'],
                    'name' => $ep['name'],
                    'logo' => null,
                    'tagline' => $ep['description'] ?? '',
                    'location' => '',
                    'country' => '',
                    'member_count' => (int) ($ep['partner_member_count'] ?? 0),
                    'federation_level' => 1,
                    'federation_level_name' => 'External',
                    'permissions' => $permissions,
                    'partnership_since' => $ep['created_at'] ?? null,
                    'is_external' => true,
                    'base_url' => $ep['base_url'] ?? null,
                    'status' => $ep['status'] ?? 'active',
                ];
            }, $externalPartners);
        } catch (\Throwable $e) {
            \Illuminate\Support\Facades\Log::warning("FederationV2Api::getExternalPartnersForDisplay error: " . $e->getMessage());
            return [];
        }
    }

    /** GET /api/v2/federation/partners/{id} */
    public function partnerDetail(string $id): JsonResponse
    {
        if ($blocked = $this->requireFederationOperation('profiles')) {
            return $blocked;
        }

        $this->getUserId();
        $tenantId = $this->getTenantId();

        try {
            // Check for external partner (ext-N format)
            if (str_starts_with($id, 'ext-')) {
                $extId = (int) substr($id, 4);
                $ep = \App\Services\FederationExternalPartnerService::getById($extId, $tenantId);
                if (!$ep || ($ep['status'] ?? '') !== 'active') {
                    return response()->json(['success' => false, 'error' => __('api.federation.partner_not_found')], 404);
                }
                $permissions = [];
                if ($ep['allow_member_search'] ?? false) $permissions[] = 'profiles';
                if ($ep['allow_messaging'] ?? false) $permissions[] = 'messaging';
                if ($ep['allow_transactions'] ?? false) $permissions[] = 'transactions';
                if ($ep['allow_listing_search'] ?? false) $permissions[] = 'listings';
                if ($ep['allow_events'] ?? false) $permissions[] = 'events';
                if ($ep['allow_groups'] ?? false) $permissions[] = 'groups';

                return $this->respondWithData([
                    'id' => 'ext-' . $ep['id'],
                    'name' => $ep['name'],
                    'logo' => null,
                    'tagline' => $ep['description'] ?? '',
                    'location' => '',
                    'country' => '',
                    'member_count' => (int) ($ep['partner_member_count'] ?? 0),
                    'federation_level' => 1,
                    'federation_level_name' => 'External',
                    'permissions' => $permissions,
                    'partnership_since' => $ep['created_at'] ?? null,
                    'is_external' => true,
                    'base_url' => $ep['base_url'] ?? null,
                    'status' => $ep['status'] ?? 'active',
                ]);
            }

            // Internal partner — find the partnership
            $partnerId = (int) $id;
            $row = DB::selectOne("
                SELECT
                    fp.id as partnership_id, fp.federation_level,
                    fp.created_at as partnership_since,
                    fp.profiles_enabled, fp.messaging_enabled, fp.transactions_enabled,
                    fp.listings_enabled, fp.events_enabled, fp.groups_enabled,
                    CASE WHEN fp.tenant_id = ? THEN fp.partner_tenant_id ELSE fp.tenant_id END as partner_tenant_id,
                    CASE WHEN fp.tenant_id = ? THEN t2.name ELSE t1.name END as partner_name,
                    CASE WHEN fp.tenant_id = ? THEN t2.tagline ELSE t1.tagline END as partner_tagline,
                    CASE WHEN fp.tenant_id = ? THEN t2.location_name ELSE t1.location_name END as partner_location,
                    CASE WHEN fp.tenant_id = ? THEN t2.country_code ELSE t1.country_code END as partner_country,
                    CASE WHEN fp.tenant_id = ? THEN dp2.logo_url ELSE dp1.logo_url END as partner_logo,
                    (SELECT COUNT(*) FROM users u
                     JOIN federation_user_settings fus2 ON fus2.user_id = u.id AND fus2.federation_optin = 1
                     WHERE u.tenant_id = CASE WHEN fp.tenant_id = ? THEN fp.partner_tenant_id ELSE fp.tenant_id END
                       AND u.status = 'active') as partner_member_count,
                    (SELECT COUNT(*) FROM listings li
                     JOIN federation_user_settings fusl ON fusl.user_id = li.user_id
                     WHERE li.tenant_id = CASE WHEN fp.tenant_id = ? THEN fp.partner_tenant_id ELSE fp.tenant_id END
                       AND li.status = 'active'
                       AND li.federated_visibility IN ('listed', 'bookable')
                       AND fusl.federation_optin = 1
                       AND fusl.profile_visible_federated = 1
                       AND fusl.appear_in_federated_search = 1) as partner_listing_count
                FROM federation_partnerships fp
                LEFT JOIN tenants t1 ON fp.tenant_id = t1.id
                LEFT JOIN tenants t2 ON fp.partner_tenant_id = t2.id
                LEFT JOIN federation_directory_profiles dp1 ON dp1.tenant_id = fp.tenant_id
                LEFT JOIN federation_directory_profiles dp2 ON dp2.tenant_id = fp.partner_tenant_id
                WHERE (fp.tenant_id = ? OR fp.partner_tenant_id = ?) AND fp.status = 'active'
                  AND CASE WHEN fp.tenant_id = ? THEN fp.partner_tenant_id ELSE fp.tenant_id END = ?
                LIMIT 1
            ", [$tenantId, $tenantId, $tenantId, $tenantId, $tenantId, $tenantId, $tenantId, $tenantId, $tenantId, $tenantId, $tenantId, $partnerId]);

            if (!$row) {
                return response()->json(['success' => false, 'error' => __('api.federation.partner_not_found')], 404);
            }

            $p = (array) $row;
            $level = (int) ($p['federation_level'] ?? 1);
            $permissions = [];
            if ($p['profiles_enabled']) $permissions[] = 'profiles';
            if ($p['messaging_enabled']) $permissions[] = 'messaging';
            if ($p['transactions_enabled']) $permissions[] = 'transactions';
            if ($p['listings_enabled']) $permissions[] = 'listings';
            if ($p['events_enabled']) $permissions[] = 'events';
            if ($p['groups_enabled']) $permissions[] = 'groups';

            return $this->respondWithData([
                'id' => (int) $p['partner_tenant_id'],
                'name' => $p['partner_name'] ?? __('api.unknown_user'),
                'logo' => $p['partner_logo'] ?: null,
                'tagline' => $p['partner_tagline'] ?? '',
                'location' => $p['partner_location'] ?? '',
                'country' => $p['partner_country'] ?? '',
                'member_count' => (int) ($p['partner_member_count'] ?? 0),
                'listing_count' => (int) ($p['partner_listing_count'] ?? 0),
                'federation_level' => $level,
                'federation_level_name' => self::LEVEL_NAMES[$level] ?? 'Discovery',
                'permissions' => $permissions,
                'partnership_since' => $p['partnership_since'] ?? null,
            ]);
        } catch (\Exception $e) {
            \Illuminate\Support\Facades\Log::warning("FederationV2Api::partnerDetail error: " . $e->getMessage());
            return response()->json(['success' => false, 'error' => __('errors.admin.federation.failed_to_load_partner')], 500);
        }
    }

    // =====================================================================
    // ACTIVITY
    // =====================================================================

    /** GET /api/v2/federation/activity */
    public function activity(): JsonResponse
    {
        if ($blocked = $this->requireFederationOperation('profiles')) {
            return $blocked;
        }

        $userId = $this->getUserId();
        $tenantId = $this->getTenantId();

        $tenantEnabled = $this->federationFeatureService->isGloballyEnabled()
            && $this->federationFeatureService->isTenantFederationEnabled($tenantId);
        if (!$tenantEnabled) {
            return $this->respondWithError('FEDERATION_NOT_AVAILABLE', __('api.fed_not_available'), null, 403);
        }

        if (!\App\Services\FederationUserService::hasOptedIn($userId, $tenantId)) {
            return $this->respondWithError('FEDERATION_NOT_ENABLED', __('api.fed_sender_not_opted_in'), null, 403);
        }

        try {
            $rawActivity = $this->federationActivityService->getActivityFeed($userId, 20);

            // Mark activity as read now that the user has viewed the feed
            $this->federationActivityService->markAllRead($userId);

            $formatted = [];
            $id = 1;
            foreach ($rawActivity as $item) {
                $type = $this->mapActivityType($item['type'] ?? 'message');
                $formatted[] = [
                    'id' => $id++,
                    'type' => $type,
                    'title' => $item['title'] ?? '',
                    'description' => $item['description'] ?? ($item['preview'] ?? ''),
                    'created_at' => $item['timestamp'] ?? date('Y-m-d H:i:s'),
                    'actor' => [
                        'name' => $item['subtitle'] ?? __('api.federation_network_name'),
                        'avatar' => null,
                        'tenant_name' => $item['subtitle'] ?? null,
                    ],
                ];
            }

            return $this->respondWithData($formatted);
        } catch (\Exception $e) {
            \Illuminate\Support\Facades\Log::warning("FederationV2Api::activity error: " . $e->getMessage());
            return $this->respondWithData([]);
        }
    }

    // =====================================================================
    // FEDERATED EVENTS
    // =====================================================================

    /** GET /api/v2/federation/events */
    public function events(): JsonResponse
    {
        if ($blocked = $this->requireFederationOperation('events')) {
            return $blocked;
        }
        if ($blocked = $this->requireFederationOptIn()) {
            return $blocked;
        }

        $tenantId = $this->getTenantId();

        $q = $this->queryScalar('q');
        $partnerFilter = $this->parsePartnerFilter();
        $upcoming = $this->queryBool('upcoming', false);
        $perPage = $this->queryInt('per_page', 20, 1, 100);
        $cursorParam = $this->query('cursor');
        $cursorId = $cursorParam ? $this->decodeCursor($cursorParam) : null;

        // External partners don't have a federation events API — return empty
        if ($partnerFilter && $partnerFilter['type'] === 'external') {
            return $this->respondWithCollection([], null, $perPage, false);
        }

        $partnerId = $partnerFilter ? $partnerFilter['id'] : 0;

        try {
            $sql = "
                SELECT e.id, e.title, e.description, e.start_time as start_date, e.end_time as end_date,
                    e.location, e.allow_remote_attendance as is_online, e.cover_image, e.max_attendees,
                    e.user_id, e.tenant_id, u.first_name, u.last_name, u.avatar_url, t.name as tenant_name,
                    (SELECT COUNT(*) FROM event_rsvps er WHERE er.event_id = e.id AND er.status = 'going') as attendees_count
                FROM events e
                JOIN users u ON u.id = e.user_id AND u.tenant_id = e.tenant_id
                JOIN tenants t ON t.id = e.tenant_id
                JOIN federation_partnerships fp ON (
                    (fp.tenant_id = :tid1 AND fp.partner_tenant_id = e.tenant_id)
                    OR (fp.partner_tenant_id = :tid2 AND fp.tenant_id = e.tenant_id)
                )
                JOIN federation_user_settings fus ON fus.user_id = e.user_id AND fus.federation_optin = 1 AND fus.profile_visible_federated = 1 AND fus.appear_in_federated_search = 1
                WHERE fp.status = 'active' AND fp.events_enabled = 1
                AND e.tenant_id != :tid3 AND e.status = 'active'
                AND e.federated_visibility IN ('listed', 'joinable')
            ";
            $params = [':tid1' => $tenantId, ':tid2' => $tenantId, ':tid3' => $tenantId];

            if ($upcoming) {
                $sql .= " AND e.start_time >= NOW()";
            }
            if (!empty($q)) {
                $sql .= " AND (e.title LIKE :q1 OR e.description LIKE :q2)";
                $params[':q1'] = "%{$q}%";
                $params[':q2'] = "%{$q}%";
            }
            if ($partnerId) {
                $sql .= " AND e.tenant_id = :partner_id";
                $params[':partner_id'] = $partnerId;
            }
            if ($cursorId) {
                $sql .= " AND e.id < :cursor_id";
                $params[':cursor_id'] = (int) $cursorId;
            }

            $sql .= " ORDER BY e.id DESC LIMIT :limit";
            $params[':limit'] = $perPage + 1;

            $stmt = DB::getPdo()->prepare($sql);
            foreach ($params as $key => $value) {
                $stmt->bindValue($key, $value, is_int($value) ? \PDO::PARAM_INT : \PDO::PARAM_STR);
            }
            $stmt->execute();
            $rows = $stmt->fetchAll(\PDO::FETCH_ASSOC);

            $hasMore = count($rows) > $perPage;
            if ($hasMore) {
                $rows = array_slice($rows, 0, $perPage);
            }

            $formatted = array_map(function ($e) {
                return [
                    'id' => (int) $e['id'],
                    'title' => $e['title'],
                    'description' => $e['description'] ?? '',
                    'start_date' => $e['start_date'],
                    'end_date' => $e['end_date'],
                    'location' => $e['location'],
                    'is_online' => (bool) ($e['is_online'] ?? false),
                    'cover_image' => $e['cover_image'] ?: null,
                    'attendees_count' => (int) ($e['attendees_count'] ?? 0),
                    'max_attendees' => $e['max_attendees'] ? (int) $e['max_attendees'] : null,
                    'organizer' => [
                        'id' => (int) $e['user_id'],
                        'name' => UserDisplayName::resolve($e),
                        'avatar' => $e['avatar_url'] ?: null,
                    ],
                    'timebank' => [
                        'id' => (int) $e['tenant_id'],
                        'name' => $e['tenant_name'],
                    ],
                    'created_at' => $e['start_date'],
                ];
            }, $rows);

            $nextCursor = null;
            if ($hasMore && !empty($rows)) {
                $lastRow = end($rows);
                $nextCursor = $this->encodeCursor($lastRow['id']);
            }

            return $this->respondWithCollection($formatted, $nextCursor, $perPage, $hasMore);
        } catch (\Exception $e) {
            \Illuminate\Support\Facades\Log::warning("FederationV2Api::events error: " . $e->getMessage());
            return $this->respondWithCollection([], null, $perPage, false);
        }
    }

    // =====================================================================
    // FEDERATED GROUPS
    // =====================================================================

    /** GET /api/v2/federation/groups */
    public function groups(): JsonResponse
    {
        if ($blocked = $this->requireFederationOperation('groups')) {
            return $blocked;
        }
        if ($blocked = $this->requireFederationOptIn()) {
            return $blocked;
        }

        $tenantId = $this->getTenantId();

        $q = $this->queryScalar('q');
        $partnerFilter = $this->parsePartnerFilter();
        $perPage = $this->queryInt('per_page', 20, 1, 100);
        $cursorParam = $this->query('cursor');
        $cursorId = $cursorParam ? $this->decodeCursor($cursorParam) : null;

        if ($partnerFilter && $partnerFilter['type'] === 'external') {
            $external = $this->fetchExternalGroupsFromCache($partnerFilter['id'], $q, $perPage);
            return $this->respondWithCollection($external, null, $perPage, false);
        }

        $partnerId = $partnerFilter ? $partnerFilter['id'] : 0;

        try {
            $sql = "
                SELECT
                    g.id, g.name, g.description, g.visibility,
                    COALESCE(g.cover_image_url, g.image_url) AS cover_image,
                    g.cached_member_count AS member_count,
                    g.tenant_id, g.created_at, t.name AS tenant_name
                FROM `groups` g
                JOIN tenants t ON t.id = g.tenant_id
                JOIN federation_user_settings fus_owner ON fus_owner.user_id = g.owner_id
                JOIN federation_partnerships fp ON (
                    (fp.tenant_id = :tid1 AND fp.partner_tenant_id = g.tenant_id)
                    OR (fp.partner_tenant_id = :tid2 AND fp.tenant_id = g.tenant_id)
                )
                WHERE fp.status = 'active'
                  AND fp.groups_enabled = 1
                  AND g.tenant_id != :tid3
                  AND g.status = 'active'
                  AND fus_owner.federation_optin = 1
                  AND fus_owner.profile_visible_federated = 1
                  AND fus_owner.appear_in_federated_search = 1
                  AND (g.federated_visibility IN ('listed', 'joinable') OR g.allow_federated_members = 1)
            ";
            $params = [':tid1' => $tenantId, ':tid2' => $tenantId, ':tid3' => $tenantId];

            if (!empty($q)) {
                $sql .= " AND (g.name LIKE :q1 OR g.description LIKE :q2)";
                $params[':q1'] = "%{$q}%";
                $params[':q2'] = "%{$q}%";
            }
            if ($partnerId) {
                $sql .= " AND g.tenant_id = :partner_id";
                $params[':partner_id'] = $partnerId;
            }
            if ($cursorId) {
                $sql .= " AND g.id < :cursor_id";
                $params[':cursor_id'] = (int) $cursorId;
            }

            $sql .= " ORDER BY g.id DESC LIMIT :limit";
            $params[':limit'] = $perPage + 1;

            $stmt = DB::getPdo()->prepare($sql);
            foreach ($params as $key => $value) {
                $stmt->bindValue($key, $value, is_int($value) ? \PDO::PARAM_INT : \PDO::PARAM_STR);
            }
            $stmt->execute();
            $rows = $stmt->fetchAll(\PDO::FETCH_ASSOC);

            $hasMore = count($rows) > $perPage;
            if ($hasMore) {
                $rows = array_slice($rows, 0, $perPage);
            }

            $formatted = array_map(fn (array $group): array => [
                'id' => (int) $group['id'],
                'name' => $group['name'],
                'description' => $group['description'] ?? '',
                'privacy' => $group['visibility'] ?? null,
                'member_count' => (int) ($group['member_count'] ?? 0),
                'cover_image' => $group['cover_image'] ?: null,
                'timebank' => [
                    'id' => (int) $group['tenant_id'],
                    'name' => $group['tenant_name'],
                ],
                'created_at' => $group['created_at'],
            ], $rows);

            $nextCursor = null;
            if ($hasMore && !empty($rows)) {
                $lastRow = end($rows);
                $nextCursor = $this->encodeCursor($lastRow['id']);
            }

            if (!$cursorId && !$partnerId) {
                $formatted = array_merge(
                    $formatted,
                    $this->fetchExternalGroupsFromCache(null, $q, $perPage)
                );
            }

            return $this->respondWithCollection($formatted, $nextCursor, $perPage, $hasMore);
        } catch (\Throwable $e) {
            \Illuminate\Support\Facades\Log::warning("FederationV2Api::groups error: " . $e->getMessage());
            return $this->respondWithCollection([], null, $perPage, false);
        }
    }

    private function fetchExternalGroupsFromCache(?int $externalPartnerId, string $q, int $limit): array
    {
        try {
            $query = DB::table('federation_groups as fg')
                ->join('federation_external_partners as ep', function ($join): void {
                    $join->on('ep.id', '=', 'fg.external_partner_id')
                        ->on('ep.tenant_id', '=', 'fg.tenant_id');
                })
                ->where('fg.tenant_id', $this->getTenantId())
                ->where('ep.status', 'active')
                ->where('ep.allow_groups', 1);

            if ($externalPartnerId !== null) {
                $query->where('fg.external_partner_id', $externalPartnerId);
            }
            if ($q !== '') {
                $query->where(function ($where) use ($q): void {
                    $where->where('fg.name', 'like', "%{$q}%")
                        ->orWhere('fg.description', 'like', "%{$q}%");
                });
            }

            return $query
                ->select([
                    'fg.id',
                    'fg.external_partner_id',
                    'fg.external_id',
                    'fg.name',
                    'fg.description',
                    'fg.privacy',
                    'fg.member_count',
                    'fg.created_at',
                    'ep.name as partner_name',
                ])
                ->orderByDesc('fg.id')
                ->limit($limit)
                ->get()
                ->map(fn ($group): array => [
                    'id' => 'ext-' . (int) $group->external_partner_id . '-' . ($group->external_id ?? $group->id),
                    'name' => $group->name,
                    'description' => $group->description ?? '',
                    'privacy' => $group->privacy ?? null,
                    'member_count' => (int) ($group->member_count ?? 0),
                    'cover_image' => null,
                    'timebank' => [
                        'id' => 'ext-' . (int) $group->external_partner_id,
                        'name' => $group->partner_name ?? __('api.external_partner_fallback'),
                    ],
                    'created_at' => $group->created_at,
                    'external_partner_id' => (int) $group->external_partner_id,
                    'partner_name' => $group->partner_name ?? __('api.external_partner_fallback'),
                ])
                ->all();
        } catch (\Throwable $e) {
            \Illuminate\Support\Facades\Log::warning("FederationV2Api::fetchExternalGroupsFromCache error: " . $e->getMessage());
            return [];
        }
    }

    // =====================================================================
    // FEDERATED LISTINGS
    // =====================================================================

    /** GET /api/v2/federation/listings */
    public function listings(): JsonResponse
    {
        if ($blocked = $this->requireFederationOperation('listings')) {
            return $blocked;
        }
        if ($blocked = $this->requireFederationOptIn()) {
            return $blocked;
        }

        $tenantId = $this->getTenantId();

        $q = $this->queryScalar('q');
        $type = $this->queryScalar('type');
        $partnerFilter = $this->parsePartnerFilter();
        $perPage = $this->queryInt('per_page', 20, 1, 100);
        $cursorParam = $this->query('cursor');
        $cursorId = $cursorParam ? $this->decodeCursor($cursorParam) : null;

        // If filtering by a specific external partner, return only that partner's data
        if ($partnerFilter && $partnerFilter['type'] === 'external') {
            $partner = \App\Services\FederationExternalPartnerService::getById($partnerFilter['id'], $tenantId);
            if (!$partner || ($partner['status'] ?? '') !== 'active') {
                return $this->respondWithError('PARTNER_NOT_FOUND', __('api.external_partner_not_found'), null, 404);
            }
            if (!($partner['allow_listing_search'] ?? false)) {
                return $this->respondWithError('LISTINGS_NOT_ALLOWED', __('api.federation.feature_disabled'), null, 403);
            }
            $external = $this->fetchExternalListingsFromPartner($partnerFilter['id'], $q, $type);
            return $this->respondWithCollection($external, null, $perPage, false, [
                'pagination_scope' => 'external_partner',
                'cursor_scope' => 'external_partner',
                'load_more_scope' => 'none',
                'external_pagination_scope' => 'single_partner_result_set',
                'external_results_paginated' => false,
                'total_items' => count($external),
                'source_counts' => [
                    'internal_returned' => 0,
                    'internal_total_items' => 0,
                    'external_returned' => count($external),
                    'returned_total' => count($external),
                ],
            ]);
        }

        $partnerId = $partnerFilter ? $partnerFilter['id'] : 0;

        try {
            $fromWhere = "
                FROM listings l
                JOIN users u ON u.id = l.user_id AND u.tenant_id = l.tenant_id
                JOIN tenants t ON t.id = l.tenant_id
                LEFT JOIN categories c ON c.id = l.category_id
                JOIN federation_partnerships fp ON (
                    (fp.tenant_id = :tid1 AND fp.partner_tenant_id = l.tenant_id)
                    OR (fp.partner_tenant_id = :tid2 AND fp.tenant_id = l.tenant_id)
                )
                JOIN federation_user_settings fus ON fus.user_id = l.user_id
                WHERE fp.status = 'active' AND fp.listings_enabled = 1
                AND l.status = 'active' AND l.tenant_id != :tid3
                AND l.federated_visibility IN ('listed', 'bookable')
                AND fus.federation_optin = 1 AND fus.profile_visible_federated = 1 AND fus.appear_in_federated_search = 1
            ";
            $params = [':tid1' => $tenantId, ':tid2' => $tenantId, ':tid3' => $tenantId];

            if (!empty($q)) {
                $fromWhere .= " AND (l.title LIKE :q1 OR l.description LIKE :q2)";
                $params[':q1'] = "%{$q}%";
                $params[':q2'] = "%{$q}%";
            }
            if (!empty($type) && in_array($type, ['offer', 'request'])) {
                $fromWhere .= " AND l.type = :type";
                $params[':type'] = $type;
            }
            if ($partnerId) {
                $fromWhere .= " AND l.tenant_id = :partner_id";
                $params[':partner_id'] = $partnerId;
            }

            $totalItems = 0;
            if ($cursorId === null) {
                $countStmt = DB::getPdo()->prepare("SELECT COUNT(*) " . $fromWhere);
                foreach ($params as $key => $value) {
                    $countStmt->bindValue($key, $value, is_int($value) ? \PDO::PARAM_INT : \PDO::PARAM_STR);
                }
                $countStmt->execute();
                $totalItems = (int) ($countStmt->fetchColumn() ?: 0);
            }

            $sql = "
                SELECT l.id, l.title, l.description, l.type, c.name as category_name,
                    l.image_url, l.price as estimated_hours, l.location,
                    l.user_id, l.tenant_id, l.created_at,
                    u.first_name, u.last_name, u.avatar_url, t.name as tenant_name
                " . $fromWhere;
            if ($cursorId) {
                $sql .= " AND l.id < :cursor_id";
                $params[':cursor_id'] = (int) $cursorId;
            }

            $sql .= " ORDER BY l.id DESC LIMIT :limit";
            $params[':limit'] = $perPage + 1;

            $stmt = DB::getPdo()->prepare($sql);
            foreach ($params as $key => $value) {
                $stmt->bindValue($key, $value, is_int($value) ? \PDO::PARAM_INT : \PDO::PARAM_STR);
            }
            $stmt->execute();
            $rows = $stmt->fetchAll(\PDO::FETCH_ASSOC);

            $hasMore = count($rows) > $perPage;
            if ($hasMore) {
                $rows = array_slice($rows, 0, $perPage);
            }

            $formatted = array_map(function ($l) {
                return [
                    'id' => (int) $l['id'],
                    'title' => $l['title'],
                    'description' => $l['description'] ?? '',
                    'type' => $l['type'],
                    'category_name' => $l['category_name'] ?? null,
                    'image_url' => $l['image_url'] ?: null,
                    'estimated_hours' => $l['estimated_hours'] ? (float) $l['estimated_hours'] : null,
                    'location' => $l['location'] ?? null,
                    'author' => [
                        'id' => (int) $l['user_id'],
                        'name' => UserDisplayName::resolve($l),
                        'avatar' => $l['avatar_url'] ?: null,
                    ],
                    'timebank' => [
                        'id' => (int) $l['tenant_id'],
                        'name' => $l['tenant_name'],
                    ],
                    'created_at' => $l['created_at'],
                ];
            }, $rows);

            $nextCursor = null;
            if ($hasMore && !empty($rows)) {
                $lastRow = end($rows);
                $nextCursor = $this->encodeCursor($lastRow['id']);
            }

            $internalReturned = count($formatted);
            $externalCount = 0;

            // Merge external partner listings (only on first page, and only when NOT filtering by internal partner)
            if (!$cursorId && !$partnerId) {
                $external = $this->fetchExternalListings($tenantId, $q, $type);
                $externalCount = count($external);
                if (!empty($external)) {
                    $formatted = array_merge($formatted, $external);
                }
            }

            return $this->respondWithCollection($formatted, $nextCursor, $perPage, $hasMore, [
                'total_items' => $totalItems,
                'pagination_scope' => 'internal_partners',
                'cursor_scope' => 'internal_partners',
                'load_more_scope' => $hasMore ? 'internal_partners' : 'none',
                'external_pagination_scope' => $externalCount > 0 ? 'first_page_enrichment' : 'none',
                'external_results_paginated' => false,
                'external_results_included' => $externalCount > 0,
                'source_counts' => [
                    'internal_returned' => $internalReturned,
                    'internal_total_items' => $totalItems,
                    'external_returned' => $externalCount,
                    'returned_total' => count($formatted),
                ],
            ]);
        } catch (\Exception $e) {
            \Illuminate\Support\Facades\Log::warning("FederationV2Api::listings error: " . $e->getMessage());
            return $this->respondWithCollection([], null, $perPage, false);
        }
    }

    /**
     * Fetch listings from a SINGLE external partner by ID.
     */
    private function fetchExternalListingsFromPartner(int $externalPartnerId, string $q, string $type): array
    {
        try {
            $partner = $this->getActiveExternalPartnerForOperation($externalPartnerId, $this->getTenantId(), 'allow_listing_search');
            if (!$partner) {
                return [];
            }

            $filters = [];
            if (!empty($q)) $filters['q'] = $q;
            if (!empty($type)) $filters['type'] = $type;

            $result = \App\Services\FederationExternalApiClient::fetchListings($externalPartnerId, $filters);

            if (!($result['success'] ?? false) || empty($result['data'])) {
                return [];
            }

            $partnerName = $partner['name'] ?? __('api.external_partner_fallback');
            $partnerBaseUrl = rtrim($partner['base_url'] ?? '', '/');

            return array_map(function ($l) use ($externalPartnerId, $partnerName, $partnerBaseUrl) {
                // v1 API returns 'owner', not 'author'
                $owner = $l['owner'] ?? $l['author'] ?? [];
                $avatar = self::resolveExternalUrl($owner['avatar'] ?? null, $partnerBaseUrl);

                return [
                    'id' => 'ext-' . $externalPartnerId . '-' . ($l['id'] ?? 0),
                    'title' => $l['title'] ?? '',
                    'description' => $l['description'] ?? '',
                    'type' => $l['type'] ?? 'offer',
                    'category_name' => $l['category_name'] ?? $l['category'] ?? null,
                    'image_url' => self::resolveExternalUrl($l['image_url'] ?? null, $partnerBaseUrl),
                    'estimated_hours' => isset($l['rate']) ? (float) $l['rate'] : (isset($l['estimated_hours']) ? (float) $l['estimated_hours'] : null),
                    'location' => $l['location'] ?? null,
                    'author' => [
                        'id' => (string) ($owner['id'] ?? ''),
                        'name' => $owner['name'] ?? UserDisplayName::resolve($l),
                        'avatar' => $avatar,
                    ],
                    'timebank' => [
                        'id' => 'ext-' . $externalPartnerId,
                        'name' => $l['timebank']['name'] ?? $partnerName,
                    ],
                    'created_at' => $l['created_at'] ?? null,
                    'is_external' => true,
                    'external_partner_id' => $externalPartnerId,
                    'partner_name' => $partnerName,
                ];
            }, $result['data']);
        } catch (\Throwable $e) {
            \Illuminate\Support\Facades\Log::warning("FederationV2Api::fetchExternalListingsFromPartner error: " . $e->getMessage());
            return [];
        }
    }

    /**
     * Fetch listings from ALL external federation partners and normalize to the same shape.
     */
    private function fetchExternalListings(int $tenantId, string $q, string $type): array
    {
        try {
            $searchService = app(FederationSearchService::class);
            $filters = [];
            if (!empty($q)) $filters['q'] = $q;
            if (!empty($type)) $filters['type'] = $type;

            $result = $searchService->searchExternalListings($tenantId, $filters);

            return array_map(function ($l) {
                // v1 API returns 'owner', not 'author'
                $owner = $l['owner'] ?? $l['author'] ?? [];
                $partnerId = $l['partner_id'] ?? 0;
                $baseUrl = $partnerId ? $this->getPartnerBaseUrl((int) $partnerId) : '';
                return [
                    'id' => 'ext-' . $partnerId . '-' . ($l['id'] ?? 0),
                    'title' => $l['title'] ?? '',
                    'description' => $l['description'] ?? '',
                    'type' => $l['type'] ?? 'offer',
                    'category_name' => $l['category_name'] ?? $l['category'] ?? null,
                    'image_url' => self::resolveExternalUrl($l['image_url'] ?? null, $baseUrl),
                    'estimated_hours' => isset($l['rate']) ? (float) $l['rate'] : (isset($l['estimated_hours']) ? (float) $l['estimated_hours'] : null),
                    'location' => $l['location'] ?? null,
                    'author' => [
                        'id' => (string) ($owner['id'] ?? ''),
                        'name' => $owner['name'] ?? UserDisplayName::resolve($l),
                        'avatar' => self::resolveExternalUrl($owner['avatar'] ?? null, $baseUrl),
                    ],
                    'timebank' => [
                        'id' => 'ext-' . (int) $partnerId,
                        'name' => $l['timebank']['name'] ?? $l['partner_name'] ?? __('api.external_partner_fallback'),
                    ],
                    'created_at' => $l['created_at'] ?? null,
                    'is_external' => true,
                    'external_partner_id' => (int) $partnerId,
                    'partner_name' => $l['partner_name'] ?? null,
                ];
            }, $result['listings'] ?? []);
        } catch (\Throwable $e) {
            \Illuminate\Support\Facades\Log::warning("FederationV2Api::fetchExternalListings error: " . $e->getMessage());
            return [];
        }
    }

    // =====================================================================
    // FEDERATED MEMBERS
    // =====================================================================

    /** GET /api/v2/federation/members */
    public function members(): JsonResponse
    {
        if ($blocked = $this->requireFederationOperation('profiles')) {
            return $blocked;
        }
        if ($blocked = $this->requireFederationOptIn()) {
            return $blocked;
        }

        $tenantId = $this->getTenantId();

        $q = $this->queryScalar('q');
        $partnerFilter = $this->parsePartnerFilter();
        $serviceReach = $this->queryScalar('service_reach');
        $skills = $this->queryScalar('skills');
        $perPage = $this->queryInt('per_page', 20, 1, 100);
        $limit = $this->queryInt('limit');
        if ($limit && $limit < $perPage) {
            $perPage = $limit;
        }
        $cursorParam = $this->query('cursor');
        $cursorId = $cursorParam ? $this->decodeCursor($cursorParam) : null;

        // If filtering by a specific external partner, return only that partner's data
        if ($partnerFilter && $partnerFilter['type'] === 'external') {
            $partner = \App\Services\FederationExternalPartnerService::getById($partnerFilter['id'], $tenantId);
            if (!$partner || ($partner['status'] ?? '') !== 'active') {
                return $this->respondWithError('PARTNER_NOT_FOUND', __('api.external_partner_not_found'), null, 404);
            }
            if (!($partner['allow_member_search'] ?? false)) {
                return $this->respondWithError('MEMBERS_NOT_ALLOWED', __('api.federation.feature_disabled'), null, 403);
            }
            $external = $this->fetchExternalMembersFromPartner($partnerFilter['id'], $q, $skills);
            return $this->respondWithCollection($external, null, $perPage, false, [
                'total_items' => count($external),
                'pagination_scope' => 'external_partner',
                'cursor_scope' => 'external_partner',
                'load_more_scope' => 'none',
                'external_pagination_scope' => 'single_partner_result_set',
                'external_results_paginated' => false,
                'source_counts' => [
                    'internal_returned' => 0,
                    'internal_total_items' => 0,
                    'external_returned' => count($external),
                    'returned_total' => count($external),
                ],
            ]);
        }

        $partnerId = $partnerFilter ? $partnerFilter['id'] : 0;

        try {
            $fromWhere = "
                FROM users u
                JOIN federation_user_settings fus ON fus.user_id = u.id
                JOIN tenants t ON t.id = u.tenant_id
                JOIN federation_partnerships fp ON (
                    (fp.tenant_id = :tid1 AND fp.partner_tenant_id = u.tenant_id)
                    OR (fp.partner_tenant_id = :tid2 AND fp.tenant_id = u.tenant_id)
                )
                WHERE fp.status = 'active' AND fp.profiles_enabled = 1
                AND fus.federation_optin = 1 AND fus.profile_visible_federated = 1 AND fus.appear_in_federated_search = 1
                AND u.status = 'active' AND u.tenant_id != :tid3
            ";
            $filterParams = [':tid1' => $tenantId, ':tid2' => $tenantId, ':tid3' => $tenantId];

            if (!empty($q)) {
                $fromWhere .= " AND (u.first_name LIKE :q1 OR u.last_name LIKE :q2 OR (fus.show_skills_federated = 1 AND u.skills LIKE :q3) OR u.bio LIKE :q4)";
                $searchTerm = "%{$q}%";
                $filterParams[':q1'] = $searchTerm;
                $filterParams[':q2'] = $searchTerm;
                $filterParams[':q3'] = $searchTerm;
                $filterParams[':q4'] = $searchTerm;
            }
            if ($partnerId) {
                $fromWhere .= " AND u.tenant_id = :partner_id";
                $filterParams[':partner_id'] = $partnerId;
            }
            if (!empty($serviceReach) && in_array($serviceReach, ['local_only', 'remote_ok', 'travel_ok'])) {
                if ($serviceReach === 'remote_ok') {
                    $fromWhere .= " AND fus.service_reach IN ('remote_ok', 'travel_ok')";
                } else {
                    $fromWhere .= " AND fus.service_reach = :service_reach";
                    $filterParams[':service_reach'] = $serviceReach;
                }
            }
            if (!empty($skills)) {
                $fromWhere .= " AND fus.show_skills_federated = 1";
                $skillList = array_map('trim', explode(',', $skills));
                $skillList = array_slice($skillList, 0, 10); // cap at 10 skills
                $skillIdx = 0;
                foreach ($skillList as $skill) {
                    if (!empty($skill)) {
                        $paramName = ":skill{$skillIdx}";
                        $fromWhere .= " AND u.skills LIKE {$paramName}";
                        $filterParams[$paramName] = "%{$skill}%";
                        $skillIdx++;
                    }
                }
            }

            // Count query (without cursor) for total_items — only run on the first page
            // to avoid an expensive double COUNT on every "Load More" paginated request.
            if ($cursorId === null) {
                $countStmt = DB::getPdo()->prepare("SELECT COUNT(*) " . $fromWhere);
                foreach ($filterParams as $key => $value) {
                    $countStmt->bindValue($key, $value, is_int($value) ? \PDO::PARAM_INT : \PDO::PARAM_STR);
                }
                $countStmt->execute();
                $totalItems = (int) ($countStmt->fetchColumn() ?: 0);
            } else {
                $totalItems = 0; // Total not recomputed on paginated pages
            }

            // Data query with cursor and limit
            $params = $filterParams;
            $sql = "SELECT u.id, u.first_name, u.last_name, u.avatar_url, u.bio, u.skills,
                    u.location, u.tenant_id, t.name as tenant_name,
                    fus.service_reach, fus.messaging_enabled_federated,
                    fus.transactions_enabled_federated,
                    fus.show_skills_federated, fus.show_location_federated " . $fromWhere;
            if ($cursorId) {
                $sql .= " AND u.id < :cursor_id";
                $params[':cursor_id'] = (int) $cursorId;
            }
            $sql .= " ORDER BY u.id DESC LIMIT :limit";
            $params[':limit'] = $perPage + 1;

            $stmt = DB::getPdo()->prepare($sql);
            foreach ($params as $key => $value) {
                $stmt->bindValue($key, $value, is_int($value) ? \PDO::PARAM_INT : \PDO::PARAM_STR);
            }
            $stmt->execute();
            $rows = $stmt->fetchAll(\PDO::FETCH_ASSOC);

            $hasMore = count($rows) > $perPage;
            if ($hasMore) {
                $rows = array_slice($rows, 0, $perPage);
            }

            $formatted = array_map(function ($m) {
                return [
                    'id' => (int) $m['id'],
                    'name' => UserDisplayName::resolve($m),
                    'first_name' => $m['first_name'] ?? '',
                    'last_name' => $m['last_name'] ?? '',
                    'avatar' => $m['avatar_url'] ?: null,
                    'bio' => $m['bio'] ?? '',
                    'skills' => ($m['show_skills_federated'] && !empty($m['skills'])) ? array_map('trim', explode(',', $m['skills'])) : [],
                    'location' => $m['show_location_federated'] ? ($m['location'] ?? null) : null,
                    'service_reach' => $m['service_reach'] ?? 'local_only',
                    'messaging_enabled' => (bool) ($m['messaging_enabled_federated'] ?? false),
                    'transactions_enabled' => (bool) ($m['transactions_enabled_federated'] ?? false),
                    'tenant_id' => (int) $m['tenant_id'],
                    'tenant_name' => $m['tenant_name'] ?? '',
                    'timebank' => [
                        'id' => (int) $m['tenant_id'],
                        'name' => $m['tenant_name'],
                    ],
                ];
            }, $rows);

            $nextCursor = null;
            if ($hasMore && !empty($rows)) {
                $lastRow = end($rows);
                $nextCursor = $this->encodeCursor($lastRow['id']);
            }

            $internalReturned = count($formatted);
            $externalCount = 0;

            // Merge external partner members (only on first page, and only when NOT filtering by internal partner)
            if (!$cursorId && !$partnerId) {
                $external = $this->fetchExternalMembers($tenantId, $q, $skills);
                $externalCount = count($external);
                if (!empty($external)) {
                    $formatted = array_merge($formatted, $external);
                }
            }

            return $this->respondWithCollection($formatted, $nextCursor, $perPage, $hasMore, [
                'total_items' => $totalItems,
                'pagination_scope' => 'internal_partners',
                'cursor_scope' => 'internal_partners',
                'load_more_scope' => $hasMore ? 'internal_partners' : 'none',
                'external_pagination_scope' => $externalCount > 0 ? 'first_page_enrichment' : 'none',
                'external_results_paginated' => false,
                'external_results_included' => $externalCount > 0,
                'source_counts' => [
                    'internal_returned' => $internalReturned,
                    'internal_total_items' => $totalItems,
                    'external_returned' => $externalCount,
                    'returned_total' => count($formatted),
                ],
            ]);
        } catch (\Exception $e) {
            \Illuminate\Support\Facades\Log::warning("FederationV2Api::members error: " . $e->getMessage());
            return $this->respondWithCollection([], null, $perPage, false, ['total_items' => 0]);
        }
    }

    /**
     * Fetch members from a SINGLE external partner by ID.
     */
    private function fetchExternalMembersFromPartner(int $externalPartnerId, string $q, string $skills): array
    {
        try {
            $partner = $this->getActiveExternalPartnerForOperation($externalPartnerId, $this->getTenantId(), 'allow_member_search');
            if (!$partner) {
                return [];
            }

            $filters = [];
            if (!empty($q)) $filters['q'] = $q;
            if (!empty($skills)) $filters['skills'] = $skills;

            $result = \App\Services\FederationExternalApiClient::fetchMembers($externalPartnerId, $filters);

            if (!($result['success'] ?? false) || empty($result['data'])) {
                return [];
            }

            $partnerName = $partner['name'] ?? __('api.external_partner_fallback');
            $partnerBaseUrl = rtrim($partner['base_url'] ?? '', '/');

            return array_map(function ($m) use ($externalPartnerId, $partnerName, $partnerBaseUrl) {
                return [
                    'id' => 'ext-' . $externalPartnerId . '-' . ($m['id'] ?? 0),
                    'name' => $m['name'] ?? UserDisplayName::resolve($m),
                    'first_name' => $m['first_name'] ?? '',
                    'last_name' => $m['last_name'] ?? '',
                    'avatar' => self::resolveExternalUrl($m['avatar'] ?? null, $partnerBaseUrl),
                    'bio' => $m['bio'] ?? '',
                    'skills' => is_array($m['skills'] ?? null) ? $m['skills'] : (is_string($m['skills'] ?? null) ? array_map('trim', explode(',', $m['skills'])) : []),
                    'location' => $m['location'] ?? null,
                    'service_reach' => $m['service_reach'] ?? 'local_only',
                    'messaging_enabled' => (bool) ($m['accepts_messages'] ?? $m['messaging_enabled'] ?? false),
                    'transactions_enabled' => (bool) ($m['accepts_transactions'] ?? $m['transactions_enabled'] ?? false),
                    'tenant_id' => 'ext-' . $externalPartnerId,
                    'tenant_name' => $m['timebank']['name'] ?? $partnerName,
                    'timebank' => [
                        'id' => 'ext-' . $externalPartnerId,
                        'name' => $m['timebank']['name'] ?? $partnerName,
                    ],
                    'is_external' => true,
                    'partner_name' => $partnerName,
                ];
            }, $result['data']);
        } catch (\Throwable $e) {
            \Illuminate\Support\Facades\Log::warning("FederationV2Api::fetchExternalMembersFromPartner error: " . $e->getMessage());
            return [];
        }
    }

    /**
     * Fetch members from ALL external federation partners and normalize to the same shape.
     */
    private function fetchExternalMembers(int $tenantId, string $q, string $skills): array
    {
        try {
            $searchService = app(FederationSearchService::class);
            $filters = [];
            if (!empty($q)) $filters['q'] = $q;
            if (!empty($skills)) $filters['skills'] = $skills;

            $result = $searchService->searchExternalMembers($tenantId, $filters);

            return array_map(function ($m) {
                $partnerId = $m['partner_id'] ?? 0;
                $baseUrl = $partnerId ? $this->getPartnerBaseUrl((int) $partnerId) : '';
                return [
                    'id' => 'ext-' . $partnerId . '-' . ($m['id'] ?? 0),
                    'name' => $m['name'] ?? UserDisplayName::resolve($m),
                    'first_name' => $m['first_name'] ?? '',
                    'last_name' => $m['last_name'] ?? '',
                    'avatar' => self::resolveExternalUrl($m['avatar'] ?? null, $baseUrl),
                    'bio' => $m['bio'] ?? '',
                    'skills' => is_array($m['skills'] ?? null) ? $m['skills'] : (is_string($m['skills'] ?? null) ? array_map('trim', explode(',', $m['skills'])) : []),
                    'location' => $m['location'] ?? null,
                    'service_reach' => $m['service_reach'] ?? 'local_only',
                    'messaging_enabled' => (bool) ($m['accepts_messages'] ?? $m['messaging_enabled'] ?? false),
                    'transactions_enabled' => (bool) ($m['accepts_transactions'] ?? $m['transactions_enabled'] ?? false),
                    'tenant_id' => 'ext-' . $partnerId,
                    'tenant_name' => $m['timebank']['name'] ?? $m['partner_name'] ?? __('api.external_partner_fallback'),
                    'timebank' => [
                        'id' => 'ext-' . $partnerId,
                        'name' => $m['timebank']['name'] ?? $m['partner_name'] ?? __('api.external_partner_fallback'),
                    ],
                    'is_external' => true,
                    'partner_name' => $m['partner_name'] ?? null,
                ];
            }, $result['members'] ?? []);
        } catch (\Throwable $e) {
            \Illuminate\Support\Facades\Log::warning("FederationV2Api::fetchExternalMembers error: " . $e->getMessage());
            return [];
        }
    }

    /** GET /api/v2/federation/members/{id} */
    public function member(string $id): JsonResponse
    {
        if ($blocked = $this->requireFederationOperation('profiles')) {
            return $blocked;
        }
        if ($blocked = $this->requireFederationOptIn()) {
            return $blocked;
        }

        $tenantId = $this->getTenantId();
        $memberTenantId = $this->queryInt('tenant_id');

        if (str_starts_with($id, 'ext-')) {
            return $this->externalMemberDetail($id, $tenantId);
        }

        $memberId = (int) $id;
        if ($memberId <= 0) {
            return $this->respondWithError('MEMBER_NOT_FOUND', __('api.fed_member_not_found'), null, 404);
        }

        try {
            $sql = "
                SELECT u.id, u.first_name, u.last_name, u.avatar_url, u.bio, u.skills,
                    u.location, u.tenant_id, t.name as tenant_name,
                    fus.service_reach, fus.messaging_enabled_federated,
                    fus.transactions_enabled_federated, fus.show_skills_federated,
                    fus.show_location_federated, fus.show_reviews_federated,
                    fp.listings_enabled
                FROM users u
                JOIN federation_user_settings fus ON fus.user_id = u.id
                JOIN tenants t ON t.id = u.tenant_id
                JOIN federation_partnerships fp ON (
                    (fp.tenant_id = :tid1 AND fp.partner_tenant_id = u.tenant_id)
                    OR (fp.partner_tenant_id = :tid2 AND fp.tenant_id = u.tenant_id)
                )
                WHERE u.id = :user_id AND fp.status = 'active' AND fp.profiles_enabled = 1
                AND fus.federation_optin = 1 AND fus.profile_visible_federated = 1
                AND u.status = 'active'
            ";
            $params = [':tid1' => $tenantId, ':tid2' => $tenantId, ':user_id' => $memberId];

            if ($memberTenantId) {
                $sql .= " AND u.tenant_id = :member_tenant_id";
                $params[':member_tenant_id'] = $memberTenantId;
            }

            $sql .= " LIMIT 1";

            $stmt = DB::getPdo()->prepare($sql);
            foreach ($params as $key => $value) {
                $stmt->bindValue($key, $value, is_int($value) ? \PDO::PARAM_INT : \PDO::PARAM_STR);
            }
            $stmt->execute();
            $m = $stmt->fetch(\PDO::FETCH_ASSOC);

            if (!$m) {
                return $this->respondWithError('MEMBER_NOT_FOUND', __('api.fed_member_not_found'), null, 404);
            }

            $member = [
                'id' => (int) $m['id'],
                'name' => UserDisplayName::resolve($m),
                'first_name' => $m['first_name'] ?? '',
                'last_name' => $m['last_name'] ?? '',
                'avatar' => $m['avatar_url'] ?: null,
                'bio' => $m['bio'] ?? '',
                'skills' => ($m['show_skills_federated'] && !empty($m['skills']))
                    ? array_map('trim', explode(',', $m['skills']))
                    : [],
                'location' => $m['show_location_federated'] ? ($m['location'] ?? null) : null,
                'service_reach' => $m['service_reach'] ?? 'local_only',
                'messaging_enabled' => (bool) ($m['messaging_enabled_federated'] ?? false),
                'transactions_enabled' => (bool) ($m['transactions_enabled_federated'] ?? false),
                'tenant_id' => (int) $m['tenant_id'],
                'tenant_name' => $m['tenant_name'] ?? '',
                'timebank' => [
                    'id' => (int) $m['tenant_id'],
                    'name' => $m['tenant_name'],
                ],
            ];

            // Add trust score / reviews if the member allows it
            if ($m['show_reviews_federated']) {
                $member['trust_score'] = FederationUserService::getTrustScore((int) $m['id'], (int) $m['tenant_id']);

                // Reputation score/count for the federated trust badge (averaged across
                // local + cross-tenant reviews so reputation follows the user).
                $aggregate = DB::table('reviews')
                    ->where('receiver_id', (int) $m['id'])
                    ->where(function ($q) use ($m) {
                        // Same predicate as memberReviews(): home-tenant rows,
                        // including legacy rows where receiver_tenant_id is null.
                        $q->where('receiver_tenant_id', (int) $m['tenant_id'])
                          ->orWhere(function ($q2) use ($m) {
                              $q2->where('tenant_id', (int) $m['tenant_id'])
                                 ->whereNull('receiver_tenant_id');
                          });
                    })
                    ->where(function ($q) {
                        $q->whereNull('status')->orWhereIn('status', ['active', 'approved']);
                    })
                    ->selectRaw('COUNT(*) as cnt, AVG(rating) as avg_rating')
                    ->first();
                $count = (int) ($aggregate->cnt ?? 0);
                $avg = $aggregate->avg_rating !== null ? round((float) $aggregate->avg_rating, 2) : 0;
                $member['reputation_score'] = $avg;
                $member['reputation_count'] = $count;
            }

            // Add connection status with current user
            $currentUserId = $this->getUserId();
            $member['connection_status'] = $this->federatedConnectionService->getStatus(
                $currentUserId, (int) $m['id'], (int) $m['tenant_id']
            );

            // Add member's active listings (if partnership allows listings)
            if (!empty($m['listings_enabled'])) {
                $memberListings = DB::select(
                    "SELECT l.id, l.title, l.type, l.description, c.name as category_name, l.created_at
                     FROM listings l
                     LEFT JOIN categories c ON c.id = l.category_id
                     WHERE l.user_id = ? AND l.tenant_id = ? AND l.status = 'active'
                       AND l.federated_visibility IN ('listed', 'bookable')
                     ORDER BY l.created_at DESC LIMIT 10",
                    [(int) $m['id'], (int) $m['tenant_id']]
                );
                $member['listings'] = array_map(fn ($l) => (array) $l, $memberListings);
            } else {
                $member['listings'] = [];
            }

            return $this->respondWithData($member);
        } catch (\Exception $e) {
            \Illuminate\Support\Facades\Log::warning("FederationV2Api::member error: " . $e->getMessage());
            return $this->respondWithError('INTERNAL_ERROR', __('api.fed_member_profile_failed'), null, 500);
        }
    }

    private function externalMemberDetail(string $id, int $tenantId): JsonResponse
    {
        $rest = substr($id, 4);
        $dashPos = strpos($rest, '-');
        if ($dashPos === false) {
            return $this->respondWithError('MEMBER_NOT_FOUND', __('api.fed_member_not_found'), null, 404);
        }

        $externalPartnerId = (int) substr($rest, 0, $dashPos);
        $remoteId = $this->parseExternalMemberIdentifier($id, $externalPartnerId);
        if ($externalPartnerId <= 0 || $remoteId === '') {
            return $this->respondWithError('MEMBER_NOT_FOUND', __('api.fed_member_not_found'), null, 404);
        }

        $partner = \App\Services\FederationExternalPartnerService::getById($externalPartnerId, $tenantId);
        if (!$partner || ($partner['status'] ?? '') !== 'active') {
            return $this->respondWithError('PARTNER_NOT_FOUND', __('api.external_partner_not_found'), null, 404);
        }
        if (!($partner['allow_member_search'] ?? false)) {
            return $this->respondWithError('MEMBERS_NOT_ALLOWED', __('api.federation.feature_disabled'), null, 403);
        }

        try {
            $member = \App\Services\FederationExternalApiClient::fetchMember($externalPartnerId, $remoteId);
            if (!$member) {
                return $this->respondWithError('MEMBER_NOT_FOUND', __('api.fed_member_not_found'), null, 404);
            }

            $partnerName = $partner['name'] ?? __('api.external_partner_fallback');
            $partnerBaseUrl = rtrim($partner['base_url'] ?? '', '/');
            $name = $member['name'] ?? UserDisplayName::resolve($member);

            return $this->respondWithData([
                'id' => 'ext-' . $externalPartnerId . '-' . ($member['id'] ?? $remoteId),
                'external_id' => (string) ($member['id'] ?? $remoteId),
                'external_partner_id' => $externalPartnerId,
                'name' => $name,
                'first_name' => $member['first_name'] ?? '',
                'last_name' => $member['last_name'] ?? '',
                'avatar' => self::resolveExternalUrl($member['avatar'] ?? $member['avatar_url'] ?? null, $partnerBaseUrl),
                'bio' => $member['bio'] ?? '',
                'skills' => is_array($member['skills'] ?? null)
                    ? $member['skills']
                    : (is_string($member['skills'] ?? null) ? array_map('trim', explode(',', $member['skills'])) : []),
                'location' => $member['location'] ?? null,
                'service_reach' => $member['service_reach'] ?? 'local_only',
                'messaging_enabled' => (bool) ($member['accepts_messages'] ?? $member['messaging_enabled'] ?? false),
                'transactions_enabled' => (bool) ($member['accepts_transactions'] ?? $member['transactions_enabled'] ?? false),
                'tenant_id' => 'ext-' . $externalPartnerId,
                'tenant_name' => $member['timebank']['name'] ?? $partnerName,
                'timebank' => [
                    'id' => 'ext-' . $externalPartnerId,
                    'name' => $member['timebank']['name'] ?? $partnerName,
                ],
                'is_external' => true,
                'partner_name' => $partnerName,
                'listings' => [],
            ]);
        } catch (\Throwable $e) {
            \Illuminate\Support\Facades\Log::warning("FederationV2Api::externalMemberDetail error: " . $e->getMessage());
            return $this->respondWithError('INTERNAL_ERROR', __('api.fed_member_profile_failed'), null, 500);
        }
    }

    /**
     * GET /api/v2/federation/members/{id}/reviews
     *
     * Returns the merged review list for a federated member. Supports two id
     * forms:
     *   - plain integer → local user in the current tenant (scoped).
     *   - `ext-{partnerId}-{externalId}` → fetches reviews from the external
     *     Komunitin/federation partner for that member.
     *
     * Response shape (matches FederationReviewsPanel.tsx contract):
     *   { success: true, data: FederationReviewItem[] }
     */
    public function memberReviews(string $id): JsonResponse
    {
        // Feature gate — federation feature must be enabled for tenant.
        if ($blocked = $this->requireFederationOperation('profiles')) {
            return $blocked;
        }
        if ($blocked = $this->requireFederationOptIn()) {
            return $blocked;
        }

        $tenantId = $this->getTenantId();

        // External member path: ext-{partnerId}-{externalId}
        if (str_starts_with($id, 'ext-')) {
            $rest = substr($id, 4);
            $dashPos = strpos($rest, '-');
            if ($dashPos === false) {
                return $this->respondWithData([]);
            }
            $partnerId = (int) substr($rest, 0, $dashPos);
            $externalMemberId = substr($rest, $dashPos + 1);
            if ($partnerId <= 0 || $externalMemberId === '') {
                return $this->respondWithData([]);
            }

            try {
                $partner = \App\Services\FederationExternalPartnerService::getById($partnerId, $tenantId);
                if (!$partner || ($partner['status'] ?? '') !== 'active') {
                    return $this->respondWithError('PARTNER_NOT_FOUND', __('api.external_partner_not_found'), null, 404);
                }
                if (!($partner['allow_member_search'] ?? false)) {
                    return $this->respondWithError('MEMBERS_NOT_ALLOWED', __('api.federation.feature_disabled'), null, 403);
                }

                $result = \App\Services\FederationExternalApiClient::fetchMemberReviews(
                    $partnerId,
                    $externalMemberId
                );

                if (empty($result['success']) || empty($result['data']) || !is_array($result['data'])) {
                    return $this->respondWithData([]);
                }

                $partnerName = $partner['name'] ?? __('api.external_partner_fallback');
                $partnerSlug = $partner['slug'] ?? null;
                $baseUrl = rtrim($partner['base_url'] ?? '', '/');

                $formatted = array_map(function ($r) use ($partnerId, $partnerName, $partnerSlug, $baseUrl) {
                    $reviewer = is_array($r['reviewer'] ?? null) ? $r['reviewer'] : [];
                    $reviewerName = $reviewer['name']
                        ?? UserDisplayName::resolve($reviewer);
                    $avatar = $reviewer['avatar'] ?? $reviewer['avatar_url'] ?? null;
                    if ($avatar && !str_starts_with((string) $avatar, 'http')) {
                        $avatar = $baseUrl . '/' . ltrim((string) $avatar, '/');
                    }
                    return [
                        'id'         => $r['id'] ?? uniqid('ext-rev-', true),
                        'rating'     => (int) ($r['rating'] ?? 0),
                        'comment'    => $r['comment'] ?? null,
                        'created_at' => $r['created_at'] ?? null,
                        'reviewer'   => [
                            'name'   => $reviewerName,
                            'avatar' => $avatar,
                        ],
                        'partner'    => [
                            'id'   => $partnerId,
                            'name' => $partnerName,
                            'slug' => $partnerSlug,
                        ],
                        'verified'   => (bool) ($r['verified'] ?? true),
                    ];
                }, $result['data']);

                return $this->respondWithData(array_values($formatted));
            } catch (\Throwable $e) {
                \Illuminate\Support\Facades\Log::warning('FederationV2Api::memberReviews external error: ' . $e->getMessage());
                return $this->respondWithData([]);
            }
        }

        // Local member path — numeric id
        $userId = (int) $id;
        if ($userId <= 0) {
            return $this->respondWithData([]);
        }
        $memberTenantId = $this->queryInt('tenant_id') ?: $tenantId;

        try {
            $visibleMember = DB::selectOne("
                SELECT fus.show_reviews_federated
                FROM users u
                JOIN federation_user_settings fus ON fus.user_id = u.id
                JOIN federation_partnerships fp ON (
                    (fp.tenant_id = ? AND fp.partner_tenant_id = u.tenant_id)
                    OR (fp.partner_tenant_id = ? AND fp.tenant_id = u.tenant_id)
                )
                WHERE u.id = ? AND u.tenant_id = ? AND u.status = 'active'
                  AND fus.federation_optin = 1
                  AND fus.profile_visible_federated = 1
                  AND fp.status = 'active'
                  AND fp.profiles_enabled = 1
                LIMIT 1
            ", [$tenantId, $tenantId, $userId, $memberTenantId]);

            if (!$visibleMember || empty($visibleMember->show_reviews_federated)) {
                return $this->respondWithData([]);
            }

            // Resolve partner metadata lazily — most reviews are local, and
            // the reviewer_tenant_id column identifies cross-tenant origin.
            $partnerCache = [];
            $resolvePartner = function (?int $reviewerTenantId) use (&$partnerCache, $tenantId): ?array {
                if (!$reviewerTenantId || $reviewerTenantId === $tenantId) {
                    return null;
                }
                if (!array_key_exists($reviewerTenantId, $partnerCache)) {
                    $row = DB::table('tenants')
                        ->where('id', $reviewerTenantId)
                        ->first(['id', 'name', 'slug']);
                    $partnerCache[$reviewerTenantId] = $row ? [
                        'id'   => (int) $row->id,
                        'name' => $row->name,
                        'slug' => $row->slug ?? null,
                    ] : null;
                }
                return $partnerCache[$reviewerTenantId];
            };

            // Re-query raw review rows to pick up reviewer_tenant_id + review_type
            // (getForUser returns a formatted projection without those fields).
            $rawRows = \App\Models\Review::query()
                ->withoutGlobalScope(\App\Scopes\TenantScope::class)
                ->with(['reviewer:id,first_name,last_name,avatar_url,organization_name,profile_type'])
                ->where('receiver_id', $userId)
                ->where(function ($q) use ($memberTenantId) {
                    $q->where('receiver_tenant_id', $memberTenantId)
                      ->orWhere(function ($q2) use ($memberTenantId) {
                          $q2->where('tenant_id', $memberTenantId)
                             ->whereNull('receiver_tenant_id');
                      });
                })
                ->where(function ($q) {
                    $q->whereNull('status')->orWhereIn('status', ['active', 'approved']);
                })
                ->orderByDesc('id')
                ->limit(100)
                ->get();

            $formatted = $rawRows->map(function (\App\Models\Review $r) use ($resolvePartner) {
                $reviewer = $r->reviewer;
                $isAnon = (bool) ($r->is_anonymous ?? false);
                $reviewerName = UserDisplayName::resolve($reviewer);
                $reviewerTenantId = (int) ($r->reviewer_tenant_id ?? 0) ?: null;
                $partner = $resolvePartner($reviewerTenantId);

                return [
                    'id'         => (int) $r->id,
                    'rating'     => (int) $r->rating,
                    'comment'    => $r->comment,
                    'created_at' => $r->created_at?->toIso8601String(),
                    'reviewer'   => [
                        'id'     => $isAnon ? null : ($reviewer?->id ?? null),
                        'name'   => $isAnon ? __('api.fed_review_anonymous') : $reviewerName,
                        'avatar' => $isAnon ? null : ($reviewer?->avatar_url ?? null),
                    ],
                    'partner'    => $partner,
                    'verified'   => ($r->review_type ?? 'local') === 'federated',
                ];
            })->all();

            return $this->respondWithData(array_values($formatted));
        } catch (\Throwable $e) {
            \Illuminate\Support\Facades\Log::warning('FederationV2Api::memberReviews local error: ' . $e->getMessage());
            return $this->respondWithData([]);
        }
    }

    // =====================================================================
    // FEDERATED MESSAGES
    // =====================================================================

    /** GET /api/v2/federation/messages */
    public function messages(): JsonResponse
    {
        if ($blocked = $this->requireFederationOperation('messaging')) {
            return $blocked;
        }
        if ($blocked = $this->requireFederationOptIn()) {
            return $blocked;
        }

        $userId = $this->getUserId();
        $tenantId = $this->getTenantId();

        try {
            $rowResults = DB::select("
                SELECT fm.id, fm.subject, fm.body, fm.direction, fm.status, fm.read_at,
                    fm.created_at, fm.sender_tenant_id, fm.sender_user_id,
                    fm.receiver_tenant_id, fm.receiver_user_id, fm.reference_message_id,
                    fm.external_partner_id, fm.external_receiver_name, fm.external_message_id,
                    COALESCE(su.first_name, '') as sender_first_name,
                    COALESCE(su.last_name, '') as sender_last_name,
                    su.profile_type as sender_profile_type,
                    su.organization_name as sender_organization_name,
                    su.avatar_url as sender_avatar, st.name as sender_tenant_name,
                    COALESCE(ru.first_name, '') as receiver_first_name,
                    COALESCE(ru.last_name, '') as receiver_last_name,
                    ru.profile_type as receiver_profile_type,
                    ru.organization_name as receiver_organization_name,
                    ru.avatar_url as receiver_avatar, rt.name as receiver_tenant_name,
                    ep.name as external_partner_name
                FROM federation_messages fm
                LEFT JOIN users su ON su.id = fm.sender_user_id AND su.tenant_id = fm.sender_tenant_id
                LEFT JOIN tenants st ON st.id = fm.sender_tenant_id
                LEFT JOIN users ru ON ru.id = fm.receiver_user_id AND ru.tenant_id = fm.receiver_tenant_id
                LEFT JOIN tenants rt ON rt.id = fm.receiver_tenant_id
                LEFT JOIN federation_external_partners ep ON ep.id = fm.external_partner_id
                WHERE (
                    fm.external_partner_id IS NULL
                    AND (
                        (fm.direction = 'outbound' AND fm.sender_tenant_id = ? AND fm.sender_user_id = ?)
                        OR (fm.direction = 'inbound' AND fm.receiver_tenant_id = ? AND fm.receiver_user_id = ?)
                    )
                ) OR (
                    fm.external_partner_id IS NOT NULL
                    AND (
                        (fm.direction = 'outbound' AND fm.sender_user_id = ? AND fm.sender_tenant_id = ?)
                        OR (fm.direction = 'inbound' AND fm.receiver_user_id = ? AND fm.receiver_tenant_id = ?)
                    )
                )
                ORDER BY fm.created_at DESC LIMIT 200
            ", [$tenantId, $userId, $tenantId, $userId, $userId, $tenantId, $userId, $tenantId]);
            $rows = array_map(fn($r) => (array)$r, $rowResults);

            $formatted = array_map(function ($msg) {
                $isExternal = !empty($msg['external_partner_id']);
                $extPartnerId = $isExternal ? (int) $msg['external_partner_id'] : null;
                $direction = $msg['direction'] === 'outbound' ? 'outbound' : 'inbound';
                $externalName = !empty($msg['external_receiver_name']) ? $msg['external_receiver_name'] : __('api.external_user_fallback');
                $partnerName = !empty($msg['external_partner_name']) ? $msg['external_partner_name'] : __('api.external_partner_fallback');

                if ($isExternal && $direction === 'outbound') {
                    // Outbound to external: sender is local, receiver is external
                    $senderInfo = [
                        'id' => (int) $msg['sender_user_id'],
                        'name' => UserDisplayName::resolvePrefixed($msg, 'sender_'),
                        'avatar' => $msg['sender_avatar'] ?: null,
                        'tenant_id' => (int) $msg['sender_tenant_id'],
                        'tenant_name' => $msg['sender_tenant_name'] ?? '',
                    ];
                    $receiverInfo = [
                        'id' => (int) $msg['receiver_user_id'],
                        'name' => $externalName,
                        'avatar' => null,
                        'tenant_id' => 'ext-' . $extPartnerId,
                        'tenant_name' => $partnerName,
                    ];
                } elseif ($isExternal && $direction === 'inbound') {
                    // Inbound from external: sender is external, receiver is local
                    $senderInfo = [
                        'id' => (int) $msg['sender_user_id'],
                        'name' => $externalName,
                        'avatar' => null,
                        'tenant_id' => 'ext-' . $extPartnerId,
                        'tenant_name' => $partnerName,
                    ];
                    $receiverInfo = [
                        'id' => (int) $msg['receiver_user_id'],
                        'name' => UserDisplayName::resolvePrefixed($msg, 'receiver_'),
                        'avatar' => $msg['receiver_avatar'] ?: null,
                        'tenant_id' => (int) $msg['receiver_tenant_id'],
                        'tenant_name' => $msg['receiver_tenant_name'] ?? '',
                    ];
                } else {
                    // Internal message
                    $senderInfo = [
                        'id' => (int) $msg['sender_user_id'],
                        'name' => UserDisplayName::resolvePrefixed($msg, 'sender_'),
                        'avatar' => $msg['sender_avatar'] ?: null,
                        'tenant_id' => (int) $msg['sender_tenant_id'],
                        'tenant_name' => $msg['sender_tenant_name'] ?? '',
                    ];
                    $receiverInfo = [
                        'id' => (int) $msg['receiver_user_id'],
                        'name' => UserDisplayName::resolvePrefixed($msg, 'receiver_'),
                        'avatar' => $msg['receiver_avatar'] ?: null,
                        'tenant_id' => (int) $msg['receiver_tenant_id'],
                        'tenant_name' => $msg['receiver_tenant_name'] ?? '',
                    ];
                }

                $formatted = [
                    'id' => (int) $msg['id'],
                    'subject' => $msg['subject'] ?? '',
                    'body' => $msg['body'],
                    'direction' => $direction,
                    'status' => $this->mapMessageStatus($msg['status'] ?? 'delivered'),
                    'read_at' => $msg['read_at'] ?: null,
                    'created_at' => $msg['created_at'],
                    'sender' => $senderInfo,
                    'receiver' => $receiverInfo,
                    'reference_message_id' => $msg['reference_message_id'] ? (int) $msg['reference_message_id'] : null,
                ];

                if ($isExternal) {
                    $formatted['is_external'] = true;
                    $formatted['external_partner_id'] = $extPartnerId;
                }

                return $formatted;
            }, $rows);

            return $this->respondWithData($formatted);
        } catch (\Exception $e) {
            \Illuminate\Support\Facades\Log::warning("FederationV2Api::messages error: " . $e->getMessage());
            return $this->respondWithData([]);
        }
    }

    /**
     * POST /api/v2/federation/messages
     *
     * Send a cross-tenant federated message. Inserts outbound + inbound copies,
     * then dispatches email, realtime, and in-app notifications (non-blocking).
     */
    public function sendMessage(): JsonResponse
    {
        $userId = $this->getUserId();
        $tenantId = $this->getTenantId();

        if ($blocked = $this->requireFederationOperation('messaging')) {
            return $blocked;
        }

        $input = request()->all();
        $receiverId = $input['receiver_id'] ?? null;
        $receiverTenantId = $input['receiver_tenant_id'] ?? null;
        $subject = $input['subject'] ?? '';
        $body = $input['body'] ?? '';
        $referenceMessageId = $input['reference_message_id'] ?? null;

        // Verify sender is opted in and has messaging enabled
        $senderSettings = $this->federationUserService->getUserSettings($userId);
        if (!($senderSettings['federation_optin'] ?? false)) {
            return $this->respondWithError('SENDER_NOT_OPTED_IN', __('api.fed_sender_not_opted_in'), null, 403);
        }
        if (!($senderSettings['messaging_enabled_federated'] ?? false)) {
            return $this->respondWithError('SENDER_MESSAGING_DISABLED', __('api.fed_sender_messaging_disabled'), null, 403);
        }

        // Validate required fields
        $errors = [];
        if (empty($receiverId)) {
            $errors[] = ['code' => 'VALIDATION_ERROR', 'message' => __('api_controllers_1.federation_v2.receiver_id_required'), 'field' => 'receiver_id'];
        }
        if (empty($receiverTenantId)) {
            $errors[] = ['code' => 'VALIDATION_ERROR', 'message' => __('api_controllers_1.federation_v2.receiver_tenant_id_required'), 'field' => 'receiver_tenant_id'];
        }
        if (empty($body)) {
            $errors[] = ['code' => 'VALIDATION_ERROR', 'message' => __('api_controllers_1.federation_v2.message_body_required'), 'field' => 'body'];
        }
        if (mb_strlen($subject) > 255) {
            $errors[] = ['code' => 'VALIDATION_ERROR', 'message' => __('api_controllers_1.federation_v2.subject_max_length'), 'field' => 'subject'];
        }
        if (mb_strlen($body) > 10000) {
            $errors[] = ['code' => 'VALIDATION_ERROR', 'message' => __('api_controllers_1.federation_v2.body_max_length'), 'field' => 'body'];
        }
        if (!empty($errors)) {
            return $this->respondWithErrors($errors);
        }

        // Store plain text; output and email rendering escape for their context.
        $subject = mb_substr(trim((string) $subject), 0, 255);
        $body = trim((string) $body);
        if ($body === '') {
            return $this->respondWithErrors([['code' => 'VALIDATION_ERROR', 'message' => __('api_controllers_1.federation_v2.message_body_required'), 'field' => 'body']]);
        }

        // ── External partner message routing ──
        // If receiver_tenant_id starts with "ext-", route via FederationExternalApiClient
        $receiverTenantStr = (string) $receiverTenantId;
        if (str_starts_with($receiverTenantStr, 'ext-')) {
            return $this->sendExternalMessage(
                $userId, $tenantId, $receiverTenantStr, (string) $receiverId,
                $subject, $body, $referenceMessageId
            );
        }

        try {
            // Verify the receiver exists and accepts federated messages
            $receiverRow = DB::selectOne("
                SELECT u.id, u.first_name, u.last_name, u.avatar_url, u.tenant_id, u.preferred_language,
                       fus.messaging_enabled_federated, fus.federation_optin,
                       t.name as tenant_name
                FROM users u
                JOIN federation_user_settings fus ON fus.user_id = u.id
                JOIN tenants t ON t.id = u.tenant_id
                WHERE u.id = ? AND u.tenant_id = ? AND u.status = 'active'
            ", [(int)$receiverId, (int)$receiverTenantId]);
            $receiver = $receiverRow ? (array)$receiverRow : null;

            if (!$receiver) {
                return $this->respondWithError('RECIPIENT_NOT_FOUND', __('api.fed_recipient_not_found'), null, 404);
            }

            if (!$receiver['federation_optin'] || !$receiver['messaging_enabled_federated']) {
                return $this->respondWithError('MESSAGING_DISABLED', __('api.fed_messaging_disabled'), null, 403);
            }

            // Verify an active partnership exists between the two tenants
            $partnership = $this->federationPartnershipService->getPartnership($tenantId, (int)$receiverTenantId);
            if (!$partnership || $partnership['status'] !== 'active') {
                return $this->respondWithError('NO_PARTNERSHIP', __('api.fed_no_partnership'), null, 403);
            }

            if (!($partnership['messaging_enabled'] ?? false)) {
                return $this->respondWithError('MESSAGING_NOT_ALLOWED', __('api.fed_messaging_not_allowed'), null, 403);
            }

            // The recipient tenant is authoritative for safeguarding. Until a
            // signed cross-tenant attestation contract exists, protected
            // recipients are routed to coordinator handling rather than being
            // reachable through federation.
            $safeguardingDecision = app(SafeguardingInteractionPolicy::class)->evaluateCrossTenantContact(
                $userId,
                $tenantId,
                (int) $receiverId,
                (int) $receiverTenantId,
                'federated_message',
            );
            if (! $safeguardingDecision->isAllowed()) {
                $error = MessageService::buildSafeguardingError([
                    'code' => $safeguardingDecision->code,
                    'required_vetting_types' => $safeguardingDecision->requiredAttestationCodes,
                    'required_vetting_labels' => $safeguardingDecision->requiredAttestationLabels,
                ]);

                return $this->respondWithError(
                    $safeguardingDecision->code,
                    (string) $error['message'],
                    null,
                    $safeguardingDecision->isUnavailable() ? 503 : 403,
                );
            }

            // Get sender info
            $senderRow = DB::selectOne("
                SELECT u.first_name, u.last_name, u.avatar_url, t.name as tenant_name
                FROM users u
                JOIN tenants t ON t.id = u.tenant_id
                WHERE u.id = ? AND u.tenant_id = ?
            ", [$userId, $tenantId]);
            $sender = $senderRow ? (array)$senderRow : [];

            $senderName = UserDisplayName::resolve($sender);

            [$outboundId, $inboundId] = DB::transaction(function () use (
                $tenantId,
                $userId,
                $receiverTenantId,
                $receiverId,
                $subject,
                $body,
                $referenceMessageId
            ): array {
                // Insert outbound message (sender's copy)
                DB::insert("
                    INSERT INTO federation_messages
                    (sender_tenant_id, sender_user_id, receiver_tenant_id, receiver_user_id,
                     subject, body, direction, status, reference_message_id, created_at)
                    VALUES (?, ?, ?, ?, ?, ?, 'outbound', 'delivered', ?, NOW())
                ", [
                    $tenantId, $userId,
                    (int)$receiverTenantId, (int)$receiverId,
                    $subject, $body,
                    $referenceMessageId ? (int)$referenceMessageId : null,
                ]);
                $outboundId = (int)DB::getPdo()->lastInsertId();

                // Insert inbound message (receiver's copy)
                DB::insert("
                    INSERT INTO federation_messages
                    (sender_tenant_id, sender_user_id, receiver_tenant_id, receiver_user_id,
                     subject, body, direction, status, reference_message_id, created_at)
                    VALUES (?, ?, ?, ?, ?, ?, 'inbound', 'unread', ?, NOW())
                ", [
                    $tenantId, $userId,
                    (int)$receiverTenantId, (int)$receiverId,
                    $subject, $body,
                    $referenceMessageId ? (int)$referenceMessageId : null,
                ]);
                $inboundId = (int)DB::getPdo()->lastInsertId();

                // Audit log
                $this->federationAuditService->log(
                    'cross_tenant_message',
                    $tenantId,
                    (int)$receiverTenantId,
                    $userId,
                    ['message_id' => $outboundId, 'receiver_id' => (int)$receiverId],
                    FederationAuditService::LEVEL_INFO
                );

                return [$outboundId, $inboundId];
            });

            // ── Notification dispatch (email + realtime + in-app + push) ──
            // These are async/non-blocking: failures are logged but don't affect the response.

            $senderTenantName = $sender['tenant_name'] ?? '';

            // 1. Email notification to recipient
            try {
                $emailSent = $this->federationEmailService->sendNewMessageNotification(
                    (int)$receiverId,
                    $userId,
                    $tenantId,
                    substr($body, 0, 200),
                    (int)$receiverTenantId
                );

                DB::update(
                    "UPDATE federation_messages
                        SET email_sent_at = ?,
                            email_failed_at = ?,
                            email_last_error = ?
                      WHERE id = ? AND receiver_tenant_id = ?",
                    [
                        $emailSent ? now() : null,
                        $emailSent ? null : now(),
                        $emailSent ? null : 'Federation message email returned false',
                        $inboundId,
                        (int)$receiverTenantId,
                    ]
                );
            } catch (\Exception $e) {
                \Illuminate\Support\Facades\Log::warning("FederationV2: Failed to send federation message email: " . $e->getMessage());
                DB::update(
                    "UPDATE federation_messages
                        SET email_sent_at = NULL,
                            email_failed_at = NOW(),
                            email_last_error = ?
                      WHERE id = ? AND receiver_tenant_id = ?",
                    [$e->getMessage(), $inboundId, (int)$receiverTenantId]
                );
            }

            // 2. Real-time notification via Pusher
            try {
                $this->federationRealtimeService->broadcastNewMessage(
                    $userId,
                    $tenantId,
                    (int)$receiverId,
                    (int)$receiverTenantId,
                    [
                        'message_id' => $inboundId,
                        'outbound_message_id' => $outboundId,
                        'sender_name' => $senderName,
                        'sender_tenant_name' => $senderTenantName,
                        'subject' => $subject,
                        'body' => $body,
                    ]
                );
            } catch (\Exception $e) {
                \Illuminate\Support\Facades\Log::warning("FederationV2: Failed to send federation message realtime: " . $e->getMessage());
            }

            // 3. In-app notification + push notification
            try {
                LocaleContext::withLocale($receiver['preferred_language'] ?? null, function () use ($receiverId, $receiverTenantId, $senderName, $senderTenantName, $subject) {
                    $subjectPreview = mb_substr($subject ?: __('api.federation_no_subject'), 0, 50);
                    if (mb_strlen($subject) > 50) {
                        $subjectPreview .= '...';
                    }
                    $notifMessage = __('api.federation_new_message_notif', [
                        'sender' => $senderName,
                        'community' => $senderTenantName,
                        'subject' => $subjectPreview,
                    ]);

                    Notification::createNotification(
                        (int)$receiverId,
                        $notifMessage,
                        '/federation/messages',
                        'federation_message',
                        true,
                        (int)$receiverTenantId  // Receiver's tenant, not sender's
                    );
                    \App\Services\NotificationDispatcher::fanOutPush((int) $receiverId, 'federation_message', $notifMessage, '/federation/messages');
                });

                DB::update(
                    "UPDATE federation_messages
                        SET notification_sent_at = NOW()
                      WHERE id = ? AND receiver_tenant_id = ? AND notification_sent_at IS NULL",
                    [$inboundId, (int)$receiverTenantId]
                );
            } catch (\Exception $e) {
                \Illuminate\Support\Facades\Log::warning("FederationV2: Failed to send federation message in-app notification: " . $e->getMessage());
            }

            // Return the outbound message in the expected format
            return $this->respondWithData([
                'id' => $outboundId,
                'subject' => $subject,
                'body' => $body,
                'direction' => 'outbound',
                'status' => 'delivered',
                'read_at' => null,
                'created_at' => date('Y-m-d H:i:s'),
                'sender' => [
                    'id' => $userId,
                    'name' => $senderName,
                    'avatar' => $sender['avatar_url'] ?? null,
                    'tenant_id' => $tenantId,
                    'tenant_name' => $sender['tenant_name'] ?? '',
                ],
                'receiver' => [
                    'id' => (int)$receiverId,
                    'name' => UserDisplayName::resolve($receiver),
                    'avatar' => $receiver['avatar_url'] ?: null,
                    'tenant_id' => (int)$receiverTenantId,
                    'tenant_name' => $receiver['tenant_name'] ?? '',
                ],
                'reference_message_id' => $referenceMessageId ? (int)$referenceMessageId : null,
            ], null, 201);
        } catch (\Exception $e) {
            \Illuminate\Support\Facades\Log::warning("FederationV2Api::sendMessage error: " . $e->getMessage());
            return $this->respondWithError('SEND_FAILED', __('api.fed_send_failed'), null, 500);
        }
    }

    /**
     * Send a message to an external partner via their federation API.
     *
     * Called when receiver_tenant_id starts with "ext-". Routes through
     * FederationExternalApiClient and stores a local outbound copy.
     */
    private function sendExternalMessage(
        int $userId, int $tenantId, string $receiverTenantStr, string $receiverIdStr,
        string $subject, string $body, $referenceMessageId
    ): JsonResponse {
        // Parse partner ID from "ext-3"
        $externalPartnerId = (int) substr($receiverTenantStr, 4);
        if ($externalPartnerId <= 0) {
            return $this->respondWithError('INVALID_PARTNER', __('api.invalid_external_partner_id'), null, 400);
        }

        // Keep remote IDs opaque for protocols that use UUIDs or account paths.
        $realReceiverId = $this->parseExternalMemberIdentifier($receiverIdStr, $externalPartnerId);
        if ($realReceiverId === '') {
            return $this->respondWithError('INVALID_RECEIVER', __('api.invalid_external_receiver_id'), null, 400);
        }
        $receiverUserIdForLocalRecord = $this->externalMemberNumericSurrogate($realReceiverId);

        // Load and validate external partner
        $partner = \App\Services\FederationExternalPartnerService::getById($externalPartnerId, $tenantId);
        if (!$partner || $partner['status'] !== 'active') {
            return $this->respondWithError('PARTNER_NOT_FOUND', __('api.external_partner_not_found'), null, 404);
        }
        if (!($partner['allow_messaging'] ?? false)) {
            return $this->respondWithError('MESSAGING_NOT_ALLOWED', __('api.external_partner_messaging_disabled'), null, 403);
        }

        // Get sender info for the outbound call and local record
        $senderRow = DB::selectOne(
            "SELECT u.first_name, u.last_name, u.avatar_url, t.name as tenant_name FROM users u JOIN tenants t ON t.id = u.tenant_id WHERE u.id = ? AND u.tenant_id = ?",
            [$userId, $tenantId]
        );
        $sender = $senderRow ? (array) $senderRow : [];
        $senderName = UserDisplayName::resolve($sender);

        // Send via external API
        try {
            $result = \App\Services\FederationExternalApiClient::sendMessage($externalPartnerId, [
                'sender_id' => $userId,
                'sender_name' => $senderName,
                'recipient_id' => $realReceiverId,
                'subject' => $subject,
                'body' => $body,
            ]);
        } catch (\Throwable $e) {
            \Illuminate\Support\Facades\Log::warning("FederationV2::sendExternalMessage API error: " . $e->getMessage());
            return $this->respondWithError('EXTERNAL_API_FAILED', __('api.external_partner_api_failed'), null, 502);
        }

        if (!($result['success'] ?? false)) {
            $remoteStatus = (int) ($result['status_code'] ?? 0);
            if ($remoteStatus === 403) {
                return $this->respondWithError(
                    'SAFEGUARDING_CONTACT_RESTRICTED',
                    __('safeguarding.errors.contact_restricted'),
                    null,
                    403,
                );
            }
            if ($remoteStatus === 503) {
                return $this->respondWithError(
                    'SAFEGUARDING_POLICY_UNAVAILABLE',
                    __('safeguarding.errors.policy_unavailable'),
                    null,
                    503,
                );
            }

            \Illuminate\Support\Facades\Log::warning('FederationV2::sendExternalMessage rejected by partner', [
                'partner_id' => $externalPartnerId,
                'status_code' => $result['status_code'] ?? null,
                'error' => $result['error'] ?? null,
            ]);
            return $this->respondWithError('EXTERNAL_SEND_FAILED', __('api.fed_external_partner_message_rejected'), null, 422);
        }

        // TimeOverflow returns { id, message_id, ... } — try both field names
        $externalMessageId = $result['data']['message_id'] ?? $result['data']['id'] ?? null;
        $rawReceiverName = $result['data']['receiver_name'] ?? $result['data']['remote_user_identifier'] ?? '';
        $receiverName = mb_substr(
            trim((string) (!empty($rawReceiverName) ? $rawReceiverName : __('api.external_user_fallback') . ' #' . $realReceiverId)),
            0,
            255
        );

        // Store local outbound copy so it appears in sender's thread list.
        // receiver_user_id is an integer legacy column, so opaque remote IDs use
        // a stable numeric surrogate for local thread grouping.
        // receiver_tenant_id = 0 signals this is external (external_partner_id is authoritative).
        DB::insert("
            INSERT INTO federation_messages
            (sender_tenant_id, sender_user_id, receiver_tenant_id, receiver_user_id,
             subject, body, direction, status, reference_message_id,
             external_partner_id, external_receiver_name, external_message_id, created_at)
            VALUES (?, ?, 0, ?, ?, ?, 'outbound', 'delivered', ?, ?, ?, ?, NOW())
        ", [
            $tenantId, $userId,
            $receiverUserIdForLocalRecord,
            $subject, $body,
            $referenceMessageId ? (int) $referenceMessageId : null,
            $externalPartnerId,
            $receiverName,
            $externalMessageId,
        ]);
        $outboundId = (int) DB::getPdo()->lastInsertId();

        // Audit log
        $this->federationAuditService->log(
            'external_message_sent',
            $tenantId, null, $userId,
            ['message_id' => $outboundId, 'partner_id' => $externalPartnerId, 'receiver_id' => $realReceiverId],
            FederationAuditService::LEVEL_INFO
        );

        return $this->respondWithData([
            'id' => $outboundId,
            'subject' => $subject,
            'body' => $body,
            'direction' => 'outbound',
            'status' => 'delivered',
            'read_at' => null,
            'created_at' => date('Y-m-d H:i:s'),
            'sender' => [
                'id' => $userId,
                'name' => $senderName,
                'avatar' => $sender['avatar_url'] ?? null,
                'tenant_id' => $tenantId,
                'tenant_name' => $sender['tenant_name'] ?? '',
            ],
            'receiver' => [
                'id' => $realReceiverId,
                'name' => $receiverName,
                'avatar' => null,
                'tenant_id' => $receiverTenantStr,
                'tenant_name' => $partner['name'] ?? __('api.external_partner_fallback'),
            ],
            'reference_message_id' => $referenceMessageId ? (int) $referenceMessageId : null,
            'is_external' => true,
            'external_partner_id' => $externalPartnerId,
        ], null, 201);
    }

    /** POST /api/v2/federation/messages/{id}/read */
    public function markMessageRead(int $id): JsonResponse
    {
        if ($blocked = $this->requireFederationOperation('messaging')) {
            return $blocked;
        }

        $userId = $this->getUserId();
        $tenantId = $this->getTenantId();

        try {
            $messageRow = DB::selectOne("
                SELECT id, status, sender_user_id, sender_tenant_id FROM federation_messages
                WHERE id = ? AND receiver_tenant_id = ? AND receiver_user_id = ?
                AND direction = 'inbound'
            ", [$id, $tenantId, $userId]);
            $message = $messageRow ? (array)$messageRow : null;

            if (!$message) {
                return $this->respondWithError('MESSAGE_NOT_FOUND', __('api.fed_message_not_found'), null, 404);
            }

            if ($message['status'] !== 'read') {
                DB::update(
                    "UPDATE federation_messages SET status = 'read', read_at = NOW() WHERE id = ? AND receiver_tenant_id = ? AND receiver_user_id = ?",
                    [$id, $tenantId, $userId]
                );

                // Notify the original sender in real-time that their message was read
                if (!empty($message['sender_user_id']) && !empty($message['sender_tenant_id'])) {
                    \App\Services\FederationRealtimeService::broadcastMessageRead(
                        $userId,
                        $tenantId,
                        (int) $message['sender_user_id'],
                        (int) $message['sender_tenant_id']
                    );
                }
            }

            return $this->respondWithData(['success' => true]);
        } catch (\Exception $e) {
            \Illuminate\Support\Facades\Log::warning("FederationV2Api::markMessageRead error: " . $e->getMessage());
            return $this->respondWithError('INTERNAL_ERROR', __('api.fed_mark_read_failed'), null, 500);
        }
    }

    /** POST /api/v2/federation/messages/mark-read-batch */
    public function markMessagesReadBatch(): JsonResponse
    {
        if ($blocked = $this->requireFederationOperation('messaging')) {
            return $blocked;
        }

        $userId = $this->getUserId();
        $tenantId = $this->getTenantId();

        $ids = request()->input('ids', []);
        if (!is_array($ids) || empty($ids)) {
            return $this->respondWithData(['updated' => 0]);
        }

        // Sanitize IDs and cap at 100 per batch
        $ids = array_map('intval', array_slice($ids, 0, 100));
        $ids = array_filter($ids, fn ($id) => $id > 0);
        if (empty($ids)) {
            return $this->respondWithData(['updated' => 0]);
        }

        try {
            $placeholders = implode(',', array_fill(0, count($ids), '?'));
            $params = array_merge($ids, [$tenantId, $userId]);

            $messages = DB::select(
                "SELECT id, sender_user_id, sender_tenant_id
                 FROM federation_messages
                 WHERE id IN ({$placeholders}) AND receiver_tenant_id = ? AND receiver_user_id = ?
                 AND direction = 'inbound' AND status != 'read'",
                $params
            );

            $updated = DB::update(
                "UPDATE federation_messages SET status = 'read', read_at = NOW()
                 WHERE id IN ({$placeholders}) AND receiver_tenant_id = ? AND receiver_user_id = ?
                 AND direction = 'inbound' AND status != 'read'",
                $params
            );

            if ($updated > 0) {
                foreach ($messages as $message) {
                    if (!empty($message->sender_user_id) && !empty($message->sender_tenant_id)) {
                        FederationRealtimeService::broadcastMessageRead(
                            $userId,
                            $tenantId,
                            (int) $message->sender_user_id,
                            (int) $message->sender_tenant_id
                        );
                    }
                }
            }

            return $this->respondWithData(['updated' => $updated]);
        } catch (\Exception $e) {
            \Illuminate\Support\Facades\Log::warning("FederationV2Api::markMessagesReadBatch error: " . $e->getMessage());
            return $this->respondWithError('INTERNAL_ERROR', __('api.fed_mark_read_failed'), null, 500);
        }
    }

    /** POST /api/v2/federation/messages/{id}/translate */
    public function translateMessage(int $id): JsonResponse
    {
        if ($blocked = $this->requireFederationOperation('messaging')) {
            return $blocked;
        }

        $userId = $this->getUserId();
        $tenantId = $this->getTenantId();

        if (!\App\Core\TenantContext::hasFeature('message_translation')) {
            return $this->respondWithError('FEATURE_DISABLED', __('api.feature_disabled'), null, 403);
        }

        $this->rateLimit('federation_messages_translate', 20, 60);

        $targetLanguage = trim(request()->input('target_language', ''));
        if (empty($targetLanguage)) {
            return $this->respondWithError('VALIDATION_ERROR', __('api.message_target_language_required'), 'target_language', 400);
        }
        if (strlen($targetLanguage) > 10 || !preg_match('/^[a-z]{2,3}(-[A-Za-z]{2,4})?$/', $targetLanguage)) {
            return $this->respondWithError('VALIDATION_ERROR', __('api.message_target_language_required'), 'target_language', 400);
        }

        // Fetch the message — user must be sender or receiver
        // Handles both internal federation and external partner messages
        $message = DB::selectOne("
            SELECT id, body, sender_tenant_id, sender_user_id,
                   receiver_tenant_id, receiver_user_id,
                   external_partner_id, direction
            FROM federation_messages
            WHERE id = ?
              AND (
                (
                    external_partner_id IS NULL
                    AND (
                        (direction = 'outbound' AND sender_tenant_id = ? AND sender_user_id = ?)
                        OR (direction = 'inbound' AND receiver_tenant_id = ? AND receiver_user_id = ?)
                    )
                )
                OR (
                    external_partner_id IS NOT NULL
                    AND (
                        (direction = 'outbound' AND sender_user_id = ? AND sender_tenant_id = ?)
                        OR (direction = 'inbound' AND receiver_user_id = ? AND receiver_tenant_id = ?)
                    )
                )
              )
        ", [$id, $tenantId, $userId, $tenantId, $userId, $userId, $tenantId, $userId, $tenantId]);

        if (!$message) {
            return $this->respondWithError('NOT_FOUND', __('api.fed_message_not_found'), null, 404);
        }

        $sourceText = $message->body ?? '';
        if (empty(trim($sourceText))) {
            return $this->respondWithError('NO_CONTENT', __('api.message_no_translatable_content'), null, 422);
        }

        // Same reasoning as MessagesController::translate(): a missing provider
        // key is a permanent condition, not a failure to retry. Answer
        // "unavailable" rather than a 500 that says "please try again".
        if (! TranscriptionService::isConfigured()) {
            return $this->respondWithError(
                'TRANSLATION_UNAVAILABLE',
                __('api.message_translation_unavailable'),
                null,
                503,
            );
        }

        // INT7: Fetch conversation context for better disambiguation
        $conversationContext = [];
        $translationConfig = TranslationConfigurationService::getAll();
        if (!empty($translationConfig['translation.context_aware'])) {
            $contextLimit = (int) ($translationConfig['translation.context_messages'] ?? 5);

            // Get the two participants of this thread
            $sTenant = (int) $message->sender_tenant_id;
            $sUser   = (int) $message->sender_user_id;
            $rTenant = (int) $message->receiver_tenant_id;
            $rUser   = (int) $message->receiver_user_id;
            $externalPartnerId = $message->external_partner_id !== null
                ? (int) $message->external_partner_id
                : null;

            $contextRows = DB::select("
                SELECT body FROM federation_messages
                WHERE id < ?
                  AND ((? IS NULL AND external_partner_id IS NULL) OR external_partner_id = ?)
                  AND (
                    (sender_tenant_id = ? AND sender_user_id = ? AND receiver_tenant_id = ? AND receiver_user_id = ?)
                    OR (sender_tenant_id = ? AND sender_user_id = ? AND receiver_tenant_id = ? AND receiver_user_id = ?)
                  )
                ORDER BY id DESC LIMIT ?
            ", [$id, $externalPartnerId, $externalPartnerId, $sTenant, $sUser, $rTenant, $rUser, $rTenant, $rUser, $sTenant, $sUser, $contextLimit]);

            $conversationContext = array_filter(
                array_reverse(array_map(fn ($r) => $r->body, $contextRows)),
                fn ($b) => !empty($b)
            );
            $conversationContext = array_values($conversationContext);
        }

        // INT10: Load glossary terms for the target language
        $glossary = [];
        if (!empty($translationConfig['translation.glossary_enabled'])
            && DB::getSchemaBuilder()->hasTable('translation_glossaries')
        ) {
            $glossaryRows = DB::table('translation_glossaries')
                ->where('tenant_id', $tenantId)
                ->where('target_language', $targetLanguage)
                ->where('is_active', true)
                ->limit(50)
                ->get(['source_term', 'target_term']);
            foreach ($glossaryRows as $row) {
                $glossary[$row->source_term] = $row->target_term;
            }
        }

        $translatedText = TranscriptionService::translate($sourceText, 'auto', $targetLanguage, $conversationContext, $glossary);

        if ($translatedText === null) {
            return $this->respondWithError('TRANSLATION_FAILED', __('api.message_translation_failed'), null, 500);
        }

        return $this->respondWithData([
            'translated_text' => $translatedText,
            'source_type'     => 'body',
            'context_used'    => !empty($conversationContext),
        ]);
    }

    // =====================================================================
    // SETTINGS
    // =====================================================================

    /** GET /api/v2/federation/settings */
    public function getSettings(): JsonResponse
    {
        if ($blocked = $this->requireFederationOperation('profiles')) {
            return $blocked;
        }

        $userId = $this->getUserId();

        $userSettings = $this->federationUserService->getUserSettings($userId);

        return $this->respondWithData([
            'enabled' => (bool) ($userSettings['federation_optin'] ?? false),
            'settings' => [
                'profile_visible_federated' => (bool) ($userSettings['profile_visible_federated'] ?? false),
                'appear_in_federated_search' => (bool) ($userSettings['appear_in_federated_search'] ?? false),
                'show_skills_federated' => (bool) ($userSettings['show_skills_federated'] ?? false),
                'show_location_federated' => (bool) ($userSettings['show_location_federated'] ?? false),
                'show_reviews_federated' => (bool) ($userSettings['show_reviews_federated'] ?? false),
                'messaging_enabled_federated' => (bool) ($userSettings['messaging_enabled_federated'] ?? false),
                'transactions_enabled_federated' => (bool) ($userSettings['transactions_enabled_federated'] ?? false),
                'email_notifications' => (bool) ($userSettings['email_notifications'] ?? true),
                'service_reach' => $userSettings['service_reach'] ?? 'local_only',
                'travel_radius_km' => $userSettings['travel_radius_km'] ? (int) $userSettings['travel_radius_km'] : null,
                'federation_optin' => (bool) ($userSettings['federation_optin'] ?? false),
            ],
        ]);
    }

    /** PUT /api/v2/federation/settings */
    public function updateSettings(): JsonResponse
    {
        if ($blocked = $this->requireFederationOperation('profiles')) {
            return $blocked;
        }

        $userId = $this->getUserId();

        $data = $this->getAllInput();

        $current = $this->federationUserService->getUserSettings($userId);
        $settings = [
            'federation_optin' => $current['federation_optin'],
            'profile_visible_federated' => $this->payloadBool($data, 'profile_visible_federated', (bool) $current['profile_visible_federated']),
            'appear_in_federated_search' => $this->payloadBool($data, 'appear_in_federated_search', (bool) $current['appear_in_federated_search']),
            'show_skills_federated' => $this->payloadBool($data, 'show_skills_federated', (bool) $current['show_skills_federated']),
            'show_location_federated' => $this->payloadBool($data, 'show_location_federated', (bool) $current['show_location_federated']),
            'show_reviews_federated' => $this->payloadBool($data, 'show_reviews_federated', (bool) $current['show_reviews_federated']),
            'messaging_enabled_federated' => $this->payloadBool($data, 'messaging_enabled_federated', (bool) $current['messaging_enabled_federated']),
            'transactions_enabled_federated' => $this->payloadBool($data, 'transactions_enabled_federated', (bool) $current['transactions_enabled_federated']),
            'email_notifications' => $this->payloadBool($data, 'email_notifications', (bool) ($current['email_notifications'] ?? true)),
            'service_reach' => $data['service_reach'] ?? $current['service_reach'],
            'travel_radius_km' => array_key_exists('travel_radius_km', $data) ? $data['travel_radius_km'] : $current['travel_radius_km'],
        ];

        $success = $this->federationUserService->updateSettings($userId, $settings);

        if ($success) {
            return $this->respondWithData(['success' => true, 'message' => __('api_controllers_1.federation.settings_updated')]);
        }

        return $this->respondWithError('UPDATE_FAILED', __('api.fed_settings_update_failed'), null, 500);
    }

    // =====================================================================
    // CONNECTIONS
    // =====================================================================

    /** GET /api/v2/federation/connections */
    public function connections(): JsonResponse
    {
        if ($blocked = $this->requireFederationOperation('profiles')) {
            return $blocked;
        }
        if ($blocked = $this->requireFederationOptIn()) {
            return $blocked;
        }

        $userId = $this->getUserId();
        $status = $this->input('status', 'accepted');
        $limit = min($this->queryInt('limit', 50, 1, 100), 100);
        $offset = max($this->queryInt('offset', 0, 0), 0);

        $connections = $this->federatedConnectionService->getConnections($userId, $status, $limit, $offset);

        return $this->respondWithData($connections);
    }

    /** POST /api/v2/federation/connections */
    public function sendConnectionRequest(): JsonResponse
    {
        if ($blocked = $this->requireFederationOperation('profiles')) {
            return $blocked;
        }

        $userId = $this->getUserId();
        $receiverId = (int) $this->input('receiver_id');
        $receiverTenantId = (int) $this->input('receiver_tenant_id');
        $message = $this->input('message');

        if (!$receiverId || !$receiverTenantId) {
            return $this->respondWithError('VALIDATION_ERROR', __('api.fed_receiver_ids_required'), null, 400);
        }

        $result = $this->federatedConnectionService->sendRequest($userId, $receiverId, $receiverTenantId, $message);

        if (!$result['success']) {
            $code = (string) ($result['error_code'] ?? 'CONNECTION_ERROR');
            $status = $code === 'SAFEGUARDING_POLICY_UNAVAILABLE'
                ? 503
                : (in_array($code, ['VETTING_REQUIRED', 'SAFEGUARDING_CONTACT_RESTRICTED'], true) ? 403 : 400);

            return $this->respondWithError($code, $result['error'], null, $status);
        }

        return $this->respondWithData($result, null, 201);
    }

    /** POST /api/v2/federation/connections/{id}/accept */
    public function acceptConnection(int $id): JsonResponse
    {
        if ($blocked = $this->requireFederationOperation('profiles')) {
            return $blocked;
        }

        $userId = $this->getUserId();
        $result = $this->federatedConnectionService->acceptRequest($id, $userId);

        if (!$result['success']) {
            $code = (string) ($result['error_code'] ?? 'CONNECTION_ERROR');
            $status = $code === 'SAFEGUARDING_POLICY_UNAVAILABLE'
                ? 503
                : (in_array($code, ['VETTING_REQUIRED', 'SAFEGUARDING_CONTACT_RESTRICTED'], true) ? 403 : 400);

            return $this->respondWithError($code, $result['error'], null, $status);
        }

        return $this->respondWithData($result);
    }

    /** POST /api/v2/federation/connections/{id}/reject */
    public function rejectConnection(int $id): JsonResponse
    {
        if ($blocked = $this->requireFederationOperation('profiles')) {
            return $blocked;
        }

        $userId = $this->getUserId();
        $result = $this->federatedConnectionService->rejectRequest($id, $userId);

        if (!$result['success']) {
            return $this->respondWithError('CONNECTION_ERROR', $result['error'], null, 400);
        }

        return $this->respondWithData($result);
    }

    /** DELETE /api/v2/federation/connections/{id} */
    public function removeConnection(int $id): JsonResponse
    {
        if ($blocked = $this->requireFederationOperation('profiles')) {
            return $blocked;
        }

        $userId = $this->getUserId();
        $result = $this->federatedConnectionService->removeConnection($id, $userId);

        if (!$result['success']) {
            return $this->respondWithError('CONNECTION_ERROR', $result['error'], null, 404);
        }

        return $this->respondWithData($result);
    }

    /** GET /api/v2/federation/connections/status/{userId}/{tenantId} */
    public function connectionStatus(int $userId, int $tenantId): JsonResponse
    {
        if ($blocked = $this->requireFederationOperation('profiles')) {
            return $blocked;
        }

        $currentUserId = $this->getUserId();
        $status = $this->federatedConnectionService->getStatus($currentUserId, $userId, $tenantId);
        return $this->respondWithData($status);
    }

    // =====================================================================
    // PRIVATE HELPERS
    // =====================================================================

    private function mapActivityType(string $rawType): string
    {
        $map = [
            'message' => 'message_received',
            'transaction' => 'transaction_received',
            'new_partner' => 'partnership_approved',
        ];
        return $map[$rawType] ?? 'member_joined';
    }

    private function mapMessageStatus(string $dbStatus): string
    {
        $map = [
            'pending' => 'delivered',
            'delivered' => 'delivered',
            'unread' => 'unread',
            'read' => 'read',
            'failed' => 'failed',
        ];
        return $map[$dbStatus] ?? 'delivered';
    }

    // =====================================================================
    // FEDERATED TRANSACTIONS
    // =====================================================================

    /** POST /api/v2/federation/transactions */
    public function sendTransaction(): JsonResponse
    {
        $userId = $this->getUserId();
        $tenantId = $this->getTenantId();

        if ($blocked = $this->requireFederationOperation('transactions')) {
            return $blocked;
        }

        $input = request()->all();
        $receiverId = $input['receiver_id'] ?? null;
        $receiverTenantId = $input['receiver_tenant_id'] ?? null;
        $amount = $input['amount'] ?? null;
        $description = $input['description'] ?? '';

        // Validate sender settings
        $senderSettings = $this->federationUserService->getUserSettings($userId);
        if (!($senderSettings['federation_optin'] ?? false)) {
            return $this->respondWithError('SENDER_NOT_OPTED_IN', __('api.fed_must_opt_in_first'), null, 403);
        }
        if (!($senderSettings['transactions_enabled_federated'] ?? false)) {
            return $this->respondWithError('SENDER_TRANSACTIONS_DISABLED', __('api.fed_transactions_not_enabled'), null, 403);
        }

        // Validate required fields
        $errors = [];
        if (empty($receiverId)) $errors[] = ['code' => 'VALIDATION_ERROR', 'message' => __('api.fed_receiver_id_required'), 'field' => 'receiver_id'];
        if (empty($receiverTenantId)) $errors[] = ['code' => 'VALIDATION_ERROR', 'message' => __('api.fed_receiver_tenant_required'), 'field' => 'receiver_tenant_id'];
        if ($amount === null || $amount === '') $errors[] = ['code' => 'VALIDATION_ERROR', 'message' => __('api.fed_amount_required'), 'field' => 'amount'];
        if (empty($description)) $errors[] = ['code' => 'VALIDATION_ERROR', 'message' => __('api.fed_description_required'), 'field' => 'description'];
        if (!empty($errors)) return $this->respondWithErrors($errors);

        // Whole hours only: a fractional amount like "5.9" must be rejected,
        // not silently truncated to 5 (which rounds in the sender's favor).
        if (!is_numeric($amount) || (float) $amount !== floor((float) $amount)) {
            return $this->respondWithErrors([['code' => 'VALIDATION_ERROR', 'message' => __('api.fed_amount_range'), 'field' => 'amount']]);
        }
        $amount = (int) $amount;
        if ($amount < 1 || $amount > 100) {
            return $this->respondWithError('INVALID_AMOUNT', __('api.fed_amount_range'), null, 400);
        }

        $description = trim((string) $description);
        if ($description === '') {
            return $this->respondWithErrors([['code' => 'VALIDATION_ERROR', 'message' => __('api.fed_description_required'), 'field' => 'description']]);
        }

        $receiverTenantStr = (string) $receiverTenantId;
        $isExternal = str_starts_with($receiverTenantStr, 'ext-');

        if ($isExternal) {
            return $this->sendExternalTransaction($userId, $tenantId, $receiverTenantStr, (string) $receiverId, $amount, $description);
        }

        // ── Internal transaction ──
        $idemCacheKey = null;
        $idemTtl = 0;
        try {
            $receiverTenantIdInt = (int) $receiverTenantId;
            $receiverIdInt = (int) $receiverId;

            // Prevent self-transactions
            if ($receiverIdInt === $userId && $receiverTenantIdInt === $tenantId) {
                return $this->respondWithError('SELF_TRANSACTION', __('api.fed_no_self_transaction'), null, 400);
            }

            // Verify receiver exists, opted in, and accepts federated transactions
            $receiver = DB::selectOne(
                "SELECT u.id, u.tenant_id, u.preferred_language, t.name as tenant_name, fus.transactions_enabled_federated
                 FROM users u JOIN tenants t ON t.id = u.tenant_id
                 JOIN federation_user_settings fus ON fus.user_id = u.id
                 WHERE u.id = ? AND u.tenant_id = ? AND u.status = 'active' AND fus.federation_optin = 1",
                [$receiverIdInt, $receiverTenantIdInt]
            );
            if (!$receiver) return $this->respondWithError('RECIPIENT_NOT_FOUND', __('api.fed_recipient_not_found'), null, 404);
            if (!$receiver->transactions_enabled_federated) {
                return $this->respondWithError('RECIPIENT_TRANSACTIONS_DISABLED', __('api.fed_recipient_transactions_disabled'), null, 403);
            }

            // Partnership check
            $partnership = $this->federationPartnershipService->getPartnership($tenantId, $receiverTenantIdInt);
            if (!$partnership || $partnership['status'] !== 'active' || !($partnership['transactions_enabled'] ?? false)) {
                return $this->respondWithError('TRANSACTIONS_NOT_ALLOWED', __('api.fed_partnership_no_transactions'), null, 403);
            }

            $safeguardingDecision = app(SafeguardingInteractionPolicy::class)->evaluateCrossTenantContact(
                $userId,
                $tenantId,
                $receiverIdInt,
                $receiverTenantIdInt,
                'federated_transaction',
            );
            if (! $safeguardingDecision->isAllowed()) {
                $error = MessageService::buildSafeguardingError([
                    'status' => $safeguardingDecision->status,
                    'code' => $safeguardingDecision->code,
                    'required_vetting_types' => $safeguardingDecision->requiredAttestationCodes,
                    'required_vetting_labels' => $safeguardingDecision->requiredAttestationLabels,
                    'can_request_coordinator' => $safeguardingDecision->canRequestCoordinator,
                ]);

                return $this->respondWithError(
                    $safeguardingDecision->code,
                    (string) $error['message'],
                    null,
                    $safeguardingDecision->isUnavailable() ? 503 : 403,
                );
            }

            // Idempotency / anti-double-submit guard (H6): a client double-submit
            // (or network retry) would otherwise create TWO real debits. Prefer an
            // explicit Idempotency-Key; otherwise fall back to a short-window
            // content fingerprint so an accidental double-click is still caught
            // without a client key. Fail OPEN on a cache hiccup — never block a
            // legitimate transfer on infrastructure flakiness.
            $explicitKey = trim((string) (request()->header('Idempotency-Key') ?? ($input['idempotency_key'] ?? '')));
            $hasExplicitKey = $explicitKey !== '';
            $fingerprint = $hasExplicitKey
                ? sha1('key:' . $explicitKey)
                : sha1('content:' . $receiverIdInt . '|' . $receiverTenantIdInt . '|' . $amount . '|' . $description);
            $idemCacheKey = "fedtx:idem:{$tenantId}:{$userId}:{$fingerprint}";
            $idemTtl = $hasExplicitKey ? 86400 : 120;

            $claimed = true;
            try {
                $claimed = \Illuminate\Support\Facades\Cache::add($idemCacheKey, ['status' => 'pending'], $idemTtl);
            } catch (\Throwable $cacheEx) {
                $claimed = true;        // cache unavailable → do not block the transfer
                $idemCacheKey = null;   // and don't try to forget/store later
            }
            if (! $claimed) {
                $prior = null;
                try { $prior = \Illuminate\Support\Facades\Cache::get($idemCacheKey); } catch (\Throwable $e) {}
                if (is_array($prior) && isset($prior['transaction_id'])) {
                    // Idempotent replay — return the original committed result, no second debit.
                    return $this->respondWithData($prior, null, 201);
                }
                // A concurrent in-flight duplicate inside the window.
                return $this->respondWithError('DUPLICATE_TRANSACTION', __('api.fed_transaction_failed'), null, 409);
            }

            DB::beginTransaction();
            $deducted = DB::update("UPDATE users SET balance = balance - ? WHERE id = ? AND tenant_id = ? AND balance >= ?", [$amount, $userId, $tenantId, $amount]);
            if ($deducted === 0) {
                DB::rollBack();
                if ($idemCacheKey !== null) {
                    try { \Illuminate\Support\Facades\Cache::forget($idemCacheKey); } catch (\Throwable $e) {}
                }
                return $this->respondWithError('INSUFFICIENT_BALANCE', __('api.fed_insufficient_balance'), null, 400);
            }

            // Guard the credit like the debit above: if the receiver row vanished
            // between the SELECT and this UPDATE, roll back rather than debiting
            // the sender with no matching credit.
            $credited = DB::update("UPDATE users SET balance = balance + ? WHERE id = ? AND tenant_id = ?", [$amount, $receiverIdInt, $receiverTenantIdInt]);
            if ($credited === 0) {
                DB::rollBack();
                if ($idemCacheKey !== null) {
                    try { \Illuminate\Support\Facades\Cache::forget($idemCacheKey); } catch (\Throwable $e) {}
                }
                return $this->respondWithError('RECIPIENT_NOT_FOUND', __('api.fed_recipient_not_found'), null, 404);
            }

            DB::insert(
                "INSERT INTO transactions (tenant_id, sender_id, receiver_id, amount, description, status, is_federated, sender_tenant_id, receiver_tenant_id, created_at)
                 VALUES (?, ?, ?, ?, ?, 'completed', 1, ?, ?, NOW())",
                [$tenantId, $userId, $receiverIdInt, $amount, $description, $tenantId, $receiverTenantIdInt]
            );
            $txId = (int) DB::getPdo()->lastInsertId();
            DB::commit();

            // Record the committed result against the idempotency key so a replay
            // returns the SAME transaction instead of debiting again.
            if ($idemCacheKey !== null) {
                try {
                    \Illuminate\Support\Facades\Cache::put(
                        $idemCacheKey,
                        ['transaction_id' => $txId, 'status' => 'completed', 'amount' => $amount],
                        $idemTtl
                    );
                } catch (\Throwable $e) { /* best-effort */ }
            }

            $this->federationAuditService->log('federation_transaction', $tenantId, $receiverTenantIdInt, $userId,
                ['transaction_id' => $txId, 'amount' => $amount, 'receiver_id' => $receiverIdInt]);

            // In-app bell to the recipient: the credit has now committed, so the
            // recipient's wallet actually changed. Mirror the EXTERNAL inbound bell
            // (FederationExternalWebhookController::ensureExternalTransactionDelivery)
            // which is the only federation transaction path that previously bell'd
            // the receiver. Wrapped in try/catch so a bell failure can never undo
            // or break the already-committed financial transaction.
            try {
                $senderInfo = DB::selectOne(
                    "SELECT TRIM(CONCAT(COALESCE(u.first_name, ''), ' ', COALESCE(u.last_name, ''))) AS sender_name,
                            t.name AS sender_tenant_name
                     FROM users u JOIN tenants t ON t.id = u.tenant_id
                     WHERE u.id = ? AND u.tenant_id = ?",
                    [$userId, $tenantId]
                );
                $senderName = trim((string) ($senderInfo->sender_name ?? '')) !== ''
                    ? (string) $senderInfo->sender_name
                    : __('api.external_user_fallback');
                $sourceCommunity = (string) ($senderInfo->sender_tenant_name ?? __('api.external_partner_fallback'));

                // Render the bell text in the RECIPIENT's preferred_language, not
                // the sending caller's locale. $receiver carries preferred_language.
                LocaleContext::withLocale($receiver, function () use ($receiverIdInt, $receiverTenantIdInt, $amount, $senderName, $sourceCommunity) {
                    $notifyMessage = __('svc_notifications.federation.transaction_received', [
                        'amount' => (string) $amount,
                        'sender' => $senderName,
                        'partner' => $sourceCommunity,
                    ]);
                    Notification::createNotification(
                        $receiverIdInt,
                        $notifyMessage,
                        '/wallet',
                        'federation_transaction',
                        false,
                        $receiverTenantIdInt
                    );
                    \App\Services\NotificationDispatcher::fanOutPush((int) $receiverIdInt, 'federation_transaction', $notifyMessage, '/wallet');
                });
            } catch (\Throwable $bellEx) {
                \Illuminate\Support\Facades\Log::warning('FederationV2::sendTransaction in-app bell failed', [
                    'transaction_id' => $txId,
                    'receiver_id' => $receiverIdInt,
                    'receiver_tenant_id' => $receiverTenantIdInt,
                    'error' => $bellEx->getMessage(),
                ]);
            }

            try {
                FederationEmailService::sendTransactionNotification(
                    $receiverIdInt,
                    $userId,
                    $tenantId,
                    (float) $amount,
                    $description,
                    $receiverTenantIdInt
                );

                $senderBalance = DB::table('users')
                    ->where('id', $userId)
                    ->where('tenant_id', $tenantId)
                    ->value('balance');

                FederationEmailService::sendTransactionConfirmation(
                    $userId,
                    $receiverIdInt,
                    $receiverTenantIdInt,
                    (float) $amount,
                    $description,
                    (float) ($senderBalance ?? 0)
                );
            } catch (\Throwable $emailEx) {
                \Illuminate\Support\Facades\Log::warning('FederationV2::sendTransaction email notification failed', [
                    'transaction_id' => $txId,
                    'sender_tenant_id' => $tenantId,
                    'receiver_tenant_id' => $receiverTenantIdInt,
                    'error' => $emailEx->getMessage(),
                ]);
            }

            return $this->respondWithData(['transaction_id' => $txId, 'status' => 'completed', 'amount' => $amount], null, 201);
        } catch (\Throwable $e) {
            DB::rollBack();
            // Release the idempotency claim so a legitimate retry of a transfer
            // that failed mid-flight is not wrongly treated as a duplicate.
            if (! empty($idemCacheKey)) {
                try { \Illuminate\Support\Facades\Cache::forget($idemCacheKey); } catch (\Throwable $ex) {}
            }
            \Illuminate\Support\Facades\Log::warning("FederationV2::sendTransaction internal error: " . $e->getMessage());
            return $this->respondWithError('TRANSACTION_FAILED', __('api.fed_transaction_failed'), null, 500);
        }
    }

    /**
     * Send a transaction to an external partner via their federation API.
     */
    private function sendExternalTransaction(
        int $userId, int $tenantId, string $receiverTenantStr, string $receiverIdStr,
        int $amount, string $description
    ): JsonResponse {
        $externalPartnerId = (int) substr($receiverTenantStr, 4);
        if ($externalPartnerId <= 0) {
            return $this->respondWithError('INVALID_PARTNER', __('api.invalid_external_partner_id'), null, 400);
        }

        $realReceiverId = $this->parseExternalMemberIdentifier($receiverIdStr, $externalPartnerId);
        if ($realReceiverId === '') {
            return $this->respondWithError('INVALID_RECEIVER', __('api.invalid_external_receiver_id'), null, 400);
        }
        $receiverUserIdForLocalRecord = $this->externalMemberNumericSurrogate($realReceiverId);

        $partner = \App\Services\FederationExternalPartnerService::getById($externalPartnerId, $tenantId);
        if (!$partner || $partner['status'] !== 'active') {
            return $this->respondWithError('PARTNER_NOT_FOUND', __('api.external_partner_not_found'), null, 404);
        }
        if (!($partner['allow_transactions'] ?? false)) {
            return $this->respondWithError('TRANSACTIONS_NOT_ALLOWED', __('api.fed_partner_no_transactions'), null, 403);
        }

        // A remote recipient's community is authoritative for its contact
        // policy. Until the partner supplies a signed, supported safeguarding
        // trust contract, do not send a member identity and free-text transfer
        // description to an unverifiable recipient.
        if (! ($partner['safeguarding_attestation_contract'] ?? false)) {
            return $this->respondWithError(
                'SAFEGUARDING_POLICY_UNAVAILABLE',
                __('safeguarding.errors.policy_unavailable'),
                null,
                503,
            );
        }

        $idem = $this->claimTransactionIdempotency($tenantId, $userId, $realReceiverId, $receiverTenantStr, $amount, $description);
        if ($idem['response'] instanceof JsonResponse) {
            return $idem['response'];
        }
        $idemCacheKey = $idem['cache_key'] ?? null;
        $idemTtl = (int) ($idem['ttl'] ?? 0);
        $partnerIdempotencyKey = (string) ($idem['partner_key'] ?? ('nexus-tx-' . $tenantId . '-' . $userId . '-' . sha1($realReceiverId . '|' . $amount . '|' . $description)));
        $idempotencyFingerprint = (string) ($idem['fingerprint'] ?? '');
        $idempotencyPayloadHash = (string) ($idem['payload_hash'] ?? '');

        // Saga pattern:
        //   1. Atomically debit local balance + insert pending tx record (committed).
        //   2. Call external API with the client/content idempotency key.
        //   3. On success, mark tx 'completed'.
        //   4. On definitive failure, refund and mark tx 'failed' (compensating action).
        //   5. On unknown / network error, leave tx 'pending' for reconciliation.
        // This prevents the prior asymmetry where external success could orphan
        // remote state if a later local DB write failed.

        $txId = null;
        DB::beginTransaction();
        try {
            // Atomic conditional debit — only deducts if balance >= amount.
            $deducted = DB::update(
                "UPDATE users SET balance = balance - ? WHERE id = ? AND tenant_id = ? AND balance >= ?",
                [$amount, $userId, $tenantId, $amount]
            );
            if ($deducted === 0) {
                DB::rollBack();
                $this->forgetTransactionIdempotency($idemCacheKey);
                return $this->respondWithError('INSUFFICIENT_BALANCE', __('api.fed_insufficient_balance'), null, 400);
            }

            $columns = [
                'tenant_id',
                'sender_id',
                'receiver_id',
                'amount',
                'description',
                'status',
                'is_federated',
                'sender_tenant_id',
                'receiver_tenant_id',
                'created_at',
            ];
            $values = ['?', '?', '?', '?', '?', "'pending'", '1', '?', '?', 'NOW()'];
            $params = [$tenantId, $userId, $receiverUserIdForLocalRecord, $amount, $description, $tenantId, $externalPartnerId];

            if ($this->transactionColumnExists('federation_idempotency_key') && $idempotencyFingerprint !== '') {
                $columns[] = 'federation_idempotency_key';
                $values[] = '?';
                $params[] = $idempotencyFingerprint;
            }
            if ($this->transactionColumnExists('federation_idempotency_payload_hash') && $idempotencyPayloadHash !== '') {
                $columns[] = 'federation_idempotency_payload_hash';
                $values[] = '?';
                $params[] = $idempotencyPayloadHash;
            }
            if ($this->transactionColumnExists('federation_partner_idempotency_key')) {
                $columns[] = 'federation_partner_idempotency_key';
                $values[] = '?';
                $params[] = $partnerIdempotencyKey;
            }

            DB::insert(
                'INSERT INTO transactions (' . implode(', ', $columns) . ') VALUES (' . implode(', ', $values) . ')',
                $params
            );
            $txId = (int) DB::getPdo()->lastInsertId();
            DB::commit();
        } catch (\Throwable $e) {
            DB::rollBack();
            if ($this->isDuplicateKeyException($e) && $idempotencyFingerprint !== '' && $idempotencyPayloadHash !== '') {
                $replay = $this->federatedTransactionIdempotencyReplay(
                    $tenantId,
                    $userId,
                    $idempotencyFingerprint,
                    $idempotencyPayloadHash
                );
                if ($replay instanceof JsonResponse) {
                    return $replay;
                }
            }
            $this->forgetTransactionIdempotency($idemCacheKey);
            \Illuminate\Support\Facades\Log::warning("FederationV2::sendExternalTransaction local-stage error: " . $e->getMessage());
            return $this->respondWithError('TRANSACTION_FAILED', __('api.fed_transaction_failed'), null, 500);
        }

        // Local debit committed — now call external partner.
        try {
            $result = \App\Services\FederationExternalApiClient::createTransaction($externalPartnerId, [
                'sender_id' => $userId,
                'recipient_id' => $realReceiverId,
                'amount' => $amount,
                'description' => $description,
                'idempotency_key' => $partnerIdempotencyKey,
            ]);
        } catch (\Throwable $e) {
            // Unknown state — partner may or may not have processed the tx.
            // Leave row 'pending' for the reconciliation job to resolve.
            \Illuminate\Support\Facades\Log::warning(
                "FederationV2::sendExternalTransaction unknown-state for tx {$txId}: " . $e->getMessage()
            );
            $this->federationAuditService->log('external_transaction_pending', $tenantId, null, $userId,
                ['transaction_id' => $txId, 'partner_id' => $externalPartnerId, 'amount' => $amount, 'reason' => 'network_error']);
            $pendingPayload = [
                'transaction_id' => $txId,
                'status' => 'pending',
                'amount' => $amount,
                'is_external' => true,
                'external_partner' => $partner['name'] ?? __('api.external_partner_fallback'),
            ];
            $this->rememberTransactionIdempotency($idemCacheKey, $idemTtl, $pendingPayload, 202);
            return $this->respondWithData($pendingPayload, null, 202);
        }

        if (!($result['success'] ?? false)) {
            // Definitive partner rejection — issue compensating refund. The
            // failed external transfer is recorded as 'cancelled' (the
            // transactions.status enum has no 'failed' value).
            $refundOk = false;
            try {
                DB::transaction(function () use ($userId, $tenantId, $amount, $txId) {
                    DB::update(
                        "UPDATE users SET balance = balance + ? WHERE id = ? AND tenant_id = ?",
                        [$amount, $userId, $tenantId]
                    );
                    DB::update(
                        "UPDATE transactions SET status = 'cancelled' WHERE id = ? AND tenant_id = ? AND sender_id = ?",
                        [$txId, $tenantId, $userId]
                    );
                });
                $refundOk = true;
            } catch (\Throwable $e) {
                // Money is now stuck: local debit is committed, partner did not
                // accept, refund failed. Log critical + audit + alert ops via
                // a dedicated audit-event so the reconciliation queue picks it
                // up. The user response still surfaces the partner rejection,
                // but the recorded tx remains 'pending' for manual recovery.
                \Illuminate\Support\Facades\Log::critical(
                    "FederationV2 compensating-refund FAILED for tx {$txId}; manual reconciliation required",
                    [
                        'transaction_id' => $txId,
                        'tenant_id' => $tenantId,
                        'user_id' => $userId,
                        'amount' => $amount,
                        'partner_id' => $externalPartnerId,
                        'refund_error' => $e->getMessage(),
                    ]
                );
                $this->federationAuditService->log('external_transaction_refund_failed', $tenantId, null, $userId,
                    ['transaction_id' => $txId, 'partner_id' => $externalPartnerId, 'amount' => $amount, 'error' => $e->getMessage()]);
            }

            if ($refundOk) {
                $this->federationAuditService->log('external_transaction_refunded', $tenantId, null, $userId,
                    ['transaction_id' => $txId, 'partner_id' => $externalPartnerId, 'amount' => $amount]);
                $this->forgetTransactionIdempotency($idemCacheKey);
            } else {
                $this->rememberTransactionIdempotency($idemCacheKey, $idemTtl, [
                    'transaction_id' => $txId,
                    'status' => 'pending',
                    'amount' => $amount,
                    'is_external' => true,
                    'external_partner' => $partner['name'] ?? __('api.external_partner_fallback'),
                ], 202);
            }

            \Illuminate\Support\Facades\Log::warning('FederationV2::sendExternalTransaction rejected by partner', [
                'transaction_id' => $txId,
                'partner_id' => $externalPartnerId,
                'status_code' => $result['status_code'] ?? null,
                'error' => $result['error'] ?? null,
            ]);
            return $this->respondWithError('EXTERNAL_TX_FAILED', __('api.fed_external_partner_rejected'), null, 422);
        }

        // Partner accepted — finalise local record.
        $externalTxId = $result['data']['transaction_id'] ?? null;
        $localFinalized = false;
        try {
            if ($this->transactionColumnExists('external_transaction_id')) {
                DB::update(
                    "UPDATE transactions SET status = 'completed', external_transaction_id = ? WHERE id = ? AND tenant_id = ? AND sender_id = ?",
                    [$externalTxId, $txId, $tenantId, $userId]
                );
            } else {
                DB::update(
                    "UPDATE transactions SET status = 'completed' WHERE id = ? AND tenant_id = ? AND sender_id = ?",
                    [$txId, $tenantId, $userId]
                );
            }
            $localFinalized = true;
        } catch (\Throwable $e) {
            // Local debit committed and partner accepted, but we couldn't flip
            // the local row to 'completed'. The reconciliation safety-net job
            // will pick this up via the 'pending' status. Log loudly + audit.
            \Illuminate\Support\Facades\Log::critical(
                "FederationV2 success-finalisation FAILED for tx {$txId}; partner accepted but local status not updated",
                [
                    'transaction_id' => $txId,
                    'tenant_id' => $tenantId,
                    'user_id' => $userId,
                    'amount' => $amount,
                    'partner_id' => $externalPartnerId,
                    'external_tx_id' => $externalTxId,
                    'error' => $e->getMessage(),
                ]
            );
            $this->federationAuditService->log('external_transaction_completion_failed', $tenantId, null, $userId,
                ['transaction_id' => $txId, 'external_tx_id' => $externalTxId, 'partner_id' => $externalPartnerId, 'amount' => $amount, 'error' => $e->getMessage()]);
        }

        $this->federationAuditService->log('external_transaction_sent', $tenantId, null, $userId,
            ['transaction_id' => $txId, 'external_tx_id' => $externalTxId, 'partner_id' => $externalPartnerId, 'amount' => $amount]);

        $responsePayload = [
            'transaction_id' => $txId,
            'status' => $localFinalized ? 'completed' : 'pending',
            'amount' => $amount,
            'is_external' => true,
            'external_partner' => $partner['name'] ?? __('api.external_partner_fallback'),
        ];
        $httpStatus = $localFinalized ? 201 : 202;
        $this->rememberTransactionIdempotency($idemCacheKey, $idemTtl, $responsePayload, $httpStatus);

        return $this->respondWithData($responsePayload, null, $httpStatus);
    }
}
