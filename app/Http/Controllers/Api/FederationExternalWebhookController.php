<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford (via Claude Code)
// See NOTICE file for attribution and acknowledgements.

declare(strict_types=1);

namespace App\Http\Controllers\Api;

use App\Core\TenantContext;
use App\Events\FederatedCommunityEventReceived;
use App\Events\FederatedConnectionReceived;
use App\Events\FederatedGroupReceived;
use App\Events\FederatedListingReceived;
use App\Events\FederatedMemberUpdated;
use App\Events\FederatedReviewReceived;
use App\Events\FederatedVolunteeringReceived;
use App\I18n\LocaleContext;
use App\Models\Notification;
use App\Services\FederatedMessageService;
use App\Services\FederationEmailService;
use App\Services\FederationExternalApiClient;
use App\Services\FederationExternalPartnerService;
use App\Services\FederationFeatureService;
use App\Services\FederationLogRedactor;
use App\Services\MessageService;
use App\Services\SafeguardingInteractionPolicy;
use App\Support\SecurityBounds;
use Illuminate\Http\JsonResponse;
use Illuminate\Database\QueryException;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Log;
use Illuminate\Support\Facades\RateLimiter;
use Illuminate\Support\Facades\Schema;
use App\Support\UserDisplayName;

/**
 * FederationExternalWebhookController — Receives webhook events from
 * external federation partners (e.g., TimeOverflow).
 *
 * Public endpoint (no Sanctum auth). Authentication is via HMAC-SHA256
 * signature verification using the partner's signing_secret.
 *
 * POST /api/v2/federation/external/webhooks/receive
 *
 * Expected payload:
 *   {
 *     "event": "message.sent",
 *     "partner_id": 1,          // The SENDING partner's ID on their side (informational)
 *     "timestamp": "...",
 *     "data": { ... event-specific payload ... }
 *   }
 *
 * Headers:
 *   X-Webhook-Signature: HMAC-SHA256 hex digest of the raw body
 *   X-Webhook-Timestamp: Unix timestamp (for replay protection)
 *   X-Federation-Signature: Alternative header (Nexus format)
 *   X-Federation-Timestamp: Alternative header (Nexus format)
 */
class FederationExternalWebhookController extends BaseApiController
{
    protected bool $isV2Api = true;

    private bool $authenticatedWithHmac = false;

    /** Maximum age of a webhook timestamp before rejection (seconds) */
    private const TIMESTAMP_TOLERANCE = 300; // 5 minutes

    /** Rate limit: max webhooks per minute per IP */
    private const RATE_LIMIT_PER_MINUTE = 200;

    /**
     * F-406 — the most reviews one external partner may leave on one local
     * member inside 24 hours.
     *
     * The local path throttles an unattached review to one per (reviewer,
     * receiver) per day. Inbound, the reviewer identity is supplied by the
     * sender and so cannot be a throttle key; the authenticated partner row is
     * the only identity it cannot forge. A partner is one remote community, and
     * a community reviewing the same local member more often than this in a day
     * is review-bombing rather than feedback.
     */
    private const MAX_INBOUND_REVIEWS_PER_MEMBER_PER_DAY = 5;

    /**
     * F-407 — fallback monthly ceiling, in hours, on externally-originated
     * credit arriving at this community with no local debit.
     *
     * Mirrors FederationCreditCommonsController's constant of the same name,
     * introduced by F-345. `federation_credit_agreements.max_monthly_credits`
     * is nullable, and "no number recorded" must not mean "unlimited" — an
     * unbounded inbound credit is counterfeit currency inside the community. An
     * agreement that states a limit always wins over this value.
     */
    private const DEFAULT_MONTHLY_INBOUND_CREDIT_HOURS = 200.0;

    /**
     * POST /api/v2/federation/external/webhooks/receive
     */
    public function receive(Request $request): JsonResponse
    {
        $this->authenticatedWithHmac = false;

        // ---- Rate limit by IP ----
        $ip = $request->ip();
        $rateLimitKey = "federation_ext_webhook:{$ip}";
        if (RateLimiter::tooManyAttempts($rateLimitKey, self::RATE_LIMIT_PER_MINUTE)) {
            return response()->json([
                'errors' => [['code' => 'RATE_LIMITED', 'message' => __('api.federation.webhook_rate_limited')]],
            ], 429);
        }
        RateLimiter::hit($rateLimitKey, 60);

        // ---- Read raw body (needed for HMAC verification) ----
        $rawBody = $request->getContent();
        if (empty($rawBody)) {
            return $this->respondWithError('INVALID_REQUEST', __('api.federation.webhook_empty_body'), null, 400);
        }

        // ---- Authenticate BEFORE parsing or interpreting the body ----
        // Parsing first would leak the difference between "bad JSON", "missing event",
        // and "unknown event" to unauthenticated callers. Auth gates all payload
        // inspection behind a valid API key or HMAC signature.
        //
        // Two auth methods supported:
        //   1. API key via Authorization: Bearer {key} (simple, preferred)
        //   2. HMAC signature via X-Webhook-Signature header (webhook-style)
        $partner = $this->identifyPartnerByApiKey($request)
            ?? $this->identifyAndVerifyPartner($request, $rawBody);
        if (!$partner) {
            return $this->respondWithError('AUTH_FAILED', __('api.federation.webhook_auth_failed'), null, 401);
        }

        if ($partner->status !== 'active') {
            return $this->respondWithError('PARTNER_INACTIVE', __('api.federation.webhook_partner_inactive'), null, 403);
        }

        // ---- Replay protection via X-Federation-Nonce ----
        // Auth alone is not enough: a captured-but-still-fresh (<5 min) request
        // could be replayed. Every webhook — Bearer or HMAC — must carry a nonce;
        // duplicates are rejected scoped by (partner_id, nonce).
        $nonce = $request->header('X-Federation-Nonce');
        if (empty($nonce)) {
            return $this->respondWithError('INVALID_NONCE', __('api.federation.webhook_nonce_required'), null, 400);
        }
        if (!is_string($nonce) || strlen($nonce) < 8 || strlen($nonce) > 128) {
            return $this->respondWithError('INVALID_NONCE', __('api.federation.webhook_invalid_nonce'), null, 400);
        }
        try {
            // INSERT IGNORE — atomic "first-seen" claim.
            $inserted = DB::affectingStatement(
                "INSERT IGNORE INTO federation_webhook_nonces (partner_id, nonce, seen_at) VALUES (?, ?, NOW())",
                [$partner->id, $nonce]
            );
            if ($inserted === 0) {
                Log::warning('[FederationExternalWebhook] Rejecting replayed nonce', [
                    'partner_id' => $partner->id,
                    'nonce_prefix' => substr($nonce, 0, 8),
                ]);
                return $this->respondWithError('REPLAY_DETECTED', __('api.federation.webhook_replay_detected'), null, 409);
            }
        } catch (\Throwable $e) {
            // Nonce store unavailable — fail closed to preserve replay protection.
            // A temporarily unavailable DB is safer to reject than to silently
            // bypass the only defence against replayed signed requests.
            Log::error('[FederationExternalWebhook] Nonce store unavailable — rejecting request', ['error' => $e->getMessage()]);
            return response()->json(['error' => __('api_controllers_1.federation.webhook_service_unavailable')], 503);
        }

        // ---- Parse body (post-auth) ----
        $payload = json_decode($rawBody, true, 10);
        if (!is_array($payload)) {
            return $this->respondWithError('INVALID_REQUEST', __('api.federation.webhook_invalid_json'), null, 400);
        }

        $event = $payload['event'] ?? null;
        $data = $payload['data'] ?? [];

        if (empty($event)) {
            return $this->respondWithError('INVALID_REQUEST', __('api.federation.webhook_missing_event'), null, 400);
        }

        // ---- Normalize payload through protocol adapter ----
        // Different protocols structure their webhooks differently. The adapter
        // normalizes event names and data shapes into Nexus's expected format.
        $adapter = FederationExternalApiClient::resolveAdapter((array) $partner);
        $normalized = $adapter->normalizeWebhookPayload($payload);
        $event = $normalized['event'];
        $data = $normalized['data'];

        // ---- Set tenant context from partner ----
        if (!TenantContext::setById($partner->tenant_id)) {
            Log::error("[FederationExternalWebhook] Failed to set tenant context for partner #{$partner->id}, tenant #{$partner->tenant_id}");
            return $this->respondWithError('TENANT_ERROR', __('api.federation.webhook_tenant_error'), null, 500);
        }

        // ---- Log the webhook ----
        $logId = $this->logWebhook($partner, $event, $payload);

        // ---- Dispatch event ----
        try {
            $result = $this->handleEvent($event, $data, $partner);

            if (($result['success'] ?? true) === false
                && in_array(($result['error_code'] ?? null), [
                    'VETTING_REQUIRED',
                    'SAFEGUARDING_CONTACT_RESTRICTED',
                    'SAFEGUARDING_POLICY_UNAVAILABLE',
                ], true)) {
                $status = ($result['error_code'] ?? null) === 'SAFEGUARDING_POLICY_UNAVAILABLE' ? 503 : 403;
                DB::table('federation_external_partner_logs')
                    ->where('id', $logId)
                    ->update([
                        'response_code' => $status,
                        'success' => false,
                        'error_message' => (string) ($result['error_code'] ?? 'SAFEGUARDING_CONTACT_RESTRICTED'),
                    ]);

                return $this->respondWithError(
                    (string) ($result['error_code'] ?? 'SAFEGUARDING_CONTACT_RESTRICTED'),
                    (string) ($result['error'] ?? __('safeguarding.errors.contact_restricted')),
                    null,
                    $status,
                );
            }

            $this->assertWebhookResultCanBeAcknowledged($result);

            DB::table('federation_external_partner_logs')
                ->where('id', $logId)
                ->update(['response_code' => 200, 'success' => true]);

            return $this->respondWithData([
                'received' => true,
                'event' => $event,
                'result' => $result,
            ]);
        } catch (FederationUnavailableException $e) {
            DB::table('federation_external_partner_logs')
                ->where('id', $logId)
                ->update(['response_code' => 503, 'success' => false, 'error_message' => substr(FederationLogRedactor::redactText($e->getMessage()) ?? '', 0, 1000)]);
            return $this->respondWithError('FEDERATION_UNAVAILABLE', $e->getMessage(), null, 503);
        } catch (InboundValidationException $e) {
            DB::table('federation_external_partner_logs')
                ->where('id', $logId)
                ->update(['response_code' => 400, 'success' => false, 'error_message' => substr(FederationLogRedactor::redactText($e->getMessage()) ?? '', 0, 1000)]);
            return $this->respondWithError('INVALID_PAYLOAD', $e->getMessage(), $e->field, 400);
        } catch (\Throwable $e) {
            Log::error("[FederationExternalWebhook] Event processing failed: {$e->getMessage()}", [
                'event' => $event,
                'partner_id' => $partner->id,
                'trace' => $e->getTraceAsString(),
            ]);

            DB::table('federation_external_partner_logs')
                ->where('id', $logId)
                ->update(['response_code' => 500, 'success' => false, 'error_message' => substr(FederationLogRedactor::redactText($e->getMessage()) ?? '', 0, 1000)]);

            return $this->respondWithError('PROCESSING_FAILED', __('api.federation.webhook_processing_failed'), null, 500);
        }
    }

    /**
     * A webhook can only be acknowledged once the handler has either fully
     * succeeded, cleanly rejected the partner payload, or identified a true
     * duplicate. Internal processing errors must stay retryable for the
     * sending partner instead of being hidden behind HTTP 200.
     *
     * @param array<string,mixed> $result
     */
    private function assertWebhookResultCanBeAcknowledged(array $result): void
    {
        if (($result['status'] ?? null) === 'error') {
            throw new \RuntimeException((string) ($result['reason'] ?? 'Federation webhook processing failed'));
        }

        if (($result['success'] ?? true) === false) {
            $message = (string) ($result['error'] ?? 'Federation webhook processing failed');
            if (($result['retryable'] ?? false) === true) {
                throw new \RuntimeException($message);
            }

            throw new InboundValidationException($message);
        }
    }

    // ----------------------------------------------------------------
    // Authentication: API key (simple) or HMAC signature (webhook)
    // ----------------------------------------------------------------

    /**
     * Decrypt a partner's signing_secret. Handles both encrypted (from service
     * layer) and plaintext (from direct DB insert) values gracefully.
     */
    private function decryptSecret(string $encrypted): ?string
    {
        if (!str_starts_with($encrypted, 'eyJpdiI6')) {
            return $encrypted;
        }

        try {
            return \Illuminate\Support\Facades\Crypt::decryptString($encrypted);
        } catch (\Illuminate\Contracts\Encryption\DecryptException $e) {
            // Ciphertext that won't decrypt is a real config error (usually an
            // APP_KEY rotation). Treat the secret as unavailable rather than
            // authenticating the partner against the raw ciphertext blob.
            Log::error('[FederationExternalWebhook] Partner signing secret decryption failed — check APP_KEY / APP_PREVIOUS_KEYS', [
                'error' => $e->getMessage(),
            ]);
            return null;
        } catch (\RuntimeException $e) {
            Log::warning('[FederationExternalWebhook] Unable to initialize encrypter while reading partner secret', [
                'error' => $e->getMessage(),
            ]);
            return null;
        }
    }

    /**
     * Identify partner by API key in Authorization: Bearer header.
     * The signing_secret doubles as the API key for simple auth.
     */
    private function identifyPartnerByApiKey(Request $request): ?object
    {
        $authHeader = $request->header('Authorization');
        if (empty($authHeader) || !str_starts_with($authHeader, 'Bearer ')) {
            return null;
        }

        $token = substr($authHeader, 7);
        if (empty($token)) {
            return null;
        }

        $partners = $this->candidatePartnersForRequest($request);
        if ($partners->isEmpty()) {
            return null;
        }

        $matches = [];
        foreach ($partners as $partner) {
            $decrypted = $this->decryptSecret($partner->signing_secret);
            if ($decrypted && hash_equals($decrypted, $token)) {
                $matches[] = $partner;
            }
        }

        return $this->singleMatchedPartner($matches, 'bearer');
    }

    /**
     * Identify the external partner by verifying the HMAC signature against
     * each partner's signing_secret. Returns the matched partner or null.
     */
    private function identifyAndVerifyPartner(Request $request, string $rawBody): ?object
    {
        $signature = $request->header('X-Webhook-Signature')
            ?? $request->header('X-Federation-Signature');

        if (empty($signature)) {
            return null;
        }

        $timestamp = $request->header('X-Webhook-Timestamp')
            ?? $request->header('X-Federation-Timestamp');

        if (empty($timestamp)) {
            return null;
        }

        $requestTime = is_numeric($timestamp) ? (int) $timestamp : strtotime((string) $timestamp);
        if ($requestTime === false || abs(time() - $requestTime) > self::TIMESTAMP_TOLERANCE) {
            Log::warning('[FederationExternalWebhook] Expired timestamp', [
                'timestamp' => $timestamp,
                'now' => time(),
            ]);
            return null;
        }

        $nonce = $request->header('X-Federation-Nonce');
        if (empty($nonce) || !is_string($nonce) || strlen($nonce) < 8 || strlen($nonce) > 128) {
            return null;
        }

        $partners = $this->candidatePartnersForRequest($request);
        if ($partners->isEmpty()) {
            return null;
        }

        $matches = [];
        foreach ($partners as $partner) {
            // Decrypt the secret (handles both encrypted and plaintext values)
            $secret = $this->decryptSecret($partner->signing_secret);
            if (!$secret) continue;

            $stringToSign = implode("\n", [
                strtoupper($request->method()),
                $request->getRequestUri(),
                (string) $timestamp,
                $nonce,
                $rawBody,
            ]);
            $expectedNexus = hash_hmac('sha256', $stringToSign, $secret);
            if (hash_equals($expectedNexus, $signature)) {
                $this->authenticatedWithHmac = true;
                $matches[] = $partner;
            }
        }

        return $this->singleMatchedPartner($matches, 'hmac');
    }

    private function candidatePartnersForRequest(Request $request): \Illuminate\Support\Collection
    {
        $query = DB::table('federation_external_partners')
            ->whereNotNull('signing_secret')
            ->where('signing_secret', '!=', '');

        $partnerId = $request->json('partner_id')
            ?? $request->header('X-Federation-Partner-ID')
            ?? $request->header('X-Webhook-Partner-ID');
        if (is_scalar($partnerId) && (int) $partnerId > 0) {
            $query->where('id', (int) $partnerId);
        }

        $tenantId = $request->json('tenant_id')
            ?? $request->header('X-Federation-Tenant-ID')
            ?? $request->header('X-Webhook-Tenant-ID');
        if (is_scalar($tenantId) && (int) $tenantId > 0) {
            $query->where('tenant_id', (int) $tenantId);
        }

        $platformId = $request->json('platform_id')
            ?? $request->json('partner.platform_id')
            ?? $request->header('X-Federation-Platform-ID')
            ?? $request->header('X-Webhook-Platform-ID');
        if (is_scalar($platformId) && trim((string) $platformId) !== ''
            && Schema::hasColumn('federation_external_partners', 'platform_id')) {
            $query->where('platform_id', trim((string) $platformId));
        }

        return $query->get();
    }

    /**
     * @param array<int,object> $matches
     */
    private function singleMatchedPartner(array $matches, string $authMethod): ?object
    {
        if (count($matches) === 1) {
            return $matches[0];
        }

        if (count($matches) > 1) {
            Log::warning('[FederationExternalWebhook] Ambiguous partner secret match rejected', [
                'auth_method' => $authMethod,
                'partner_ids' => array_map(static fn (object $partner): int => (int) $partner->id, $matches),
            ]);
        }

        return null;
    }

    // ----------------------------------------------------------------
    // Event routing
    // ----------------------------------------------------------------

    private function handleEvent(string $event, array $data, object $partner): array
    {
        // Kill-switch: inbound federation must honour the same global /
        // emergency-lockdown / whitelist / tenant gates as the outbound push
        // listeners. TenantContext is already set to the partner's (local)
        // tenant by both callers (receive() and processTrustedEvent()).
        // isTenantFederationEnabled() returns false under emergency lockdown, a
        // global disable, or a non-whitelisted tenant — so a partner cannot keep
        // pushing (and crediting balances) while an operator believes federation
        // is halted.
        $partnerTenantId = (int) $partner->tenant_id;
        if (! TenantContext::hasFeature('federation')
            || ! app(FederationFeatureService::class)->isTenantFederationEnabled($partnerTenantId)
        ) {
            throw new FederationUnavailableException(__('api.federation.feature_disabled'));
        }

        if (!$this->partnerAllowsEvent($event, $partner)) {
            return [
                'status' => 'rejected',
                'reason' => __('api.federation.permission_denied'),
                'event' => $event,
            ];
        }

        return match ($event) {
            'message.sent', 'message.received' => $this->handleInboundMessage($data, $partner),
            'transaction.completed' => $this->handleTransactionCompleted($data, $partner),
            'transaction.cancelled' => $this->handleTransactionCancelled($data, $partner),
            'transaction.requested' => $this->handleTransactionRequested($data, $partner),
            'partnership.activated', 'partnership.approved' => $this->handlePartnershipActivated($partner),
            'partnership.suspended' => $this->handlePartnershipSuspended($partner),
            'partnership.terminated' => $this->handlePartnershipTerminated($partner),
            'members.list' => $this->handleMembersList($data, $partner),
            'listings.list' => $this->handleListingsList($data, $partner),
            // New inbound PUSH handlers (partner-initiated create/update)
            'review.created' => $this->handleInboundReview($data, $partner),
            'listing.created', 'listing.updated' => $this->handleInboundListing($data, $partner),
            'event.created', 'event.updated' => $this->handleInboundCommunityEvent($data, $partner),
            'group.created', 'group.updated' => $this->handleInboundGroup($data, $partner),
            'group.member_joined' => $this->handleInboundGroupMembership($data, $partner),
            'connection.requested', 'connection.accepted' => $this->handleInboundConnection($data, $partner, $event),
            'volunteering.created', 'volunteering.updated' => $this->handleInboundVolunteering($data, $partner),
            'volunteering.deleted' => $this->handleInboundVolunteeringDeletion($data, $partner),
            'member.profile_updated' => $this->handleInboundMemberSync($data, $partner),
            'health_check' => ['status' => 'ok'],
            default => ['status' => 'unhandled', 'event' => $event],
        };
    }

    public function processTrustedEvent(string $event, array $data, object $partner): array
    {
        if (!TenantContext::setById((int) $partner->tenant_id)) {
            throw new \RuntimeException(__('api.federation.tenant_context_failed'));
        }

        return $this->handleEvent($event, $data, $partner);
    }

    private function partnerAllowsEvent(string $event, object $partner): bool
    {
        $flag = match ($event) {
            'message.sent', 'message.received' => 'allow_messaging',
            'transaction.completed', 'transaction.cancelled', 'transaction.requested' => 'allow_transactions',
            'members.list' => 'allow_member_search',
            'listings.list', 'listing.created', 'listing.updated' => 'allow_listing_search',
            'review.created', 'member.profile_updated' => 'allow_member_sync',
            'event.created', 'event.updated' => 'allow_events',
            'group.created', 'group.updated', 'group.member_joined' => 'allow_groups',
            'connection.requested', 'connection.accepted' => 'allow_connections',
            'volunteering.created', 'volunteering.updated', 'volunteering.deleted' => 'allow_volunteering',
            default => null,
        };

        if ($flag === null) {
            return true;
        }

        return !empty($partner->{$flag});
    }

    // ----------------------------------------------------------------
    // Inbound PUSH handlers (partner-initiated create/update)
    // ----------------------------------------------------------------

    /**
     * Require a string field from the payload, throwing InboundValidationException
     * if it is missing or empty.
     */
    private function requireString(array $data, string $field, int $max = 10000): string
    {
        $value = $data[$field] ?? null;
        if ($value === null || $value === '' || !is_scalar($value)) {
            throw new InboundValidationException("Missing required field: {$field}", $field);
        }
        $value = (string) $value;
        // E-062 F-327: callers pass the column width. The connection is
        // non-strict, so a longer value would be stored shortened and every
        // later update or retraction keyed on the full value would miss it.
        if (mb_strlen($value) > $max) {
            throw new InboundValidationException("Field '{$field}' exceeds maximum length", $field);
        }
        return $value;
    }

    private function optionalString(array $data, string $field, int $max = 10000): ?string
    {
        $value = $data[$field] ?? null;
        if ($value === null || $value === '') {
            return null;
        }
        if (!is_scalar($value)) {
            return null;
        }
        $value = (string) $value;
        if (mb_strlen($value) > $max) {
            $value = mb_substr($value, 0, $max);
        }
        return $value;
    }

    private function parseDateTime(?string $value): ?string
    {
        if (!$value) {
            return null;
        }
        try {
            $dt = new \DateTimeImmutable($value);
            return $dt->format('Y-m-d H:i:s');
        } catch (\Throwable) {
            return null;
        }
    }

    private function handleInboundReview(array $data, object $partner): array
    {
        $externalId = $this->requireString($data, 'external_id', 128);
        $rating = (int) ($data['rating'] ?? 0);
        if ($rating < 1 || $rating > 5) {
            throw new InboundValidationException('rating must be between 1 and 5', 'rating');
        }
        $receiverId = (int) ($data['receiver_id'] ?? $data['local_member_id'] ?? 0);
        if ($receiverId <= 0) {
            throw new InboundValidationException('Missing required field: receiver_id', 'receiver_id');
        }

        $tenantId = (int) TenantContext::getId();

        // Validate the receiver belongs to this tenant
        $receiver = DB::table('users')
            ->where('id', $receiverId)
            ->where('tenant_id', $tenantId)
            ->where('status', 'active')
            ->first(['id']);
        if (!$receiver) {
            throw new InboundValidationException("Receiver user #{$receiverId} not found in this tenant", 'receiver_id');
        }

        // Dedup by durable external identity, so a partner retrying the same
        // event is answered 'duplicate' rather than writing twice. Older schemas
        // do not have these columns; the exchange binding below covers that case
        // and is not optional.
        $externalTxId = $this->optionalString($data, 'external_transaction_id', 128);
        $reviewerExternalId = (int) ($data['reviewer_external_id'] ?? $data['reviewer_id'] ?? 0);
        $reviewerTenantId = (int) ($data['reviewer_tenant_id'] ?? 0);

        $existing = null;
        $hasExternalIdentity = Schema::hasColumn('reviews', 'external_partner_id')
            && Schema::hasColumn('reviews', 'external_id');
        if ($hasExternalIdentity) {
            $existing = DB::table('reviews')
                ->where('tenant_id', $tenantId)
                ->where('external_partner_id', (int) $partner->id)
                ->where('external_id', $externalId)
                ->first(['id']);
        }

        if ($existing) {
            return ['status' => 'duplicate', 'local_id' => (int) $existing->id];
        }

        // 🔴 Ordering matters, and CI caught this. The safeguarding policy is
        // evaluated BEFORE the F-406 exchange check below, because
        // SAFEGUARDING_POLICY_UNAVAILABLE answers a retryable 503: while the
        // platform cannot evaluate its own safeguarding rules it must make NO
        // determination at all. Refusing first on a missing exchange would hand
        // the partner a definitive rejection during a safeguarding outage, which
        // it would treat as final and never retry.
        if ($blocked = $this->externalRecipientSafeguardingBlock(
            $receiverId,
            (int) $partner->id,
            $reviewerExternalId > 0 ? (string) $reviewerExternalId : $externalId,
            'external_federated_review',
        )) {
            return $blocked;
        }

        // F-406 (second half) — the member's own decision about federated
        // reviews, which the v1 partner API has always enforced here.
        //
        // The local path refuses a review where either party has blocked the
        // other (BlockUserService::assertNoBlockBetween). That control cannot be
        // carried across: a block is between two local `users` rows, the remote
        // reviewer has none, and every reviewer field in the payload is chosen
        // by the sender — which is why `reviewer_id` is written NULL below. A
        // check keyed on a sender-chosen identifier would look like protection
        // and be none.
        //
        // What the member CAN express, and what this platform already records,
        // is whether they accept federated reviews at all.
        // `FederationController::createReview()` reads exactly this pair before
        // writing an inbound federated review and answers REVIEWS_DISABLED,
        // "Reviewee does not accept federated reviews". The webhook route read
        // neither flag.
        //
        // 🔴 Still not expressible: refusing ONE remote reviewer while accepting
        // others. The levers today are all-or-nothing for the member, and
        // partner suspension for the operator.
        if (!$this->receiverAcceptsFederatedReviews($receiverId, $tenantId)) {
            return [
                'status' => 'rejected',
                'reason' => 'This member does not accept federated reviews',
            ];
        }

        // F-406 — an inbound review must describe a real exchange with THIS
        // member, recorded by THIS partner, and one exchange earns one review.
        //
        // The local path (ReviewService::create) already refuses a review
        // attached to a transaction the reviewer was not party to, and its own
        // comment says why: "fabricating reviews for exchanges they never took
        // part in, and bypassing the 24h no-transaction throttle below by
        // cycling through transaction ids (review-bombing)". This path had
        // neither control. `external_transaction_id` was optional and a miss was
        // ignored, so a partner planted approved, publicly counted, one-star
        // reviews carrying its own text on any local member it had never
        // exchanged with, at 200 requests a minute.
        //
        // This path cannot key its controls on the reviewer. The remote reviewer
        // is not a local `users` row and every reviewer field in the payload is
        // chosen by the sender, so `reviewer_id` is written NULL. (The dedup
        // that used to live here compared `reviews.reviewer_id` against the
        // partner-supplied reviewer id, which no inserted row can ever match, so
        // it never fired.) The authenticated partner row is the only identity
        // the sender cannot forge, so it is what both controls key on.
        $reviewedExchange = $this->federatedReviewExchange($externalTxId, $partner, $tenantId, $receiverId);
        if ($reviewedExchange === null) {
            return [
                'status' => 'rejected',
                'reason' => 'A federated review must reference a completed exchange recorded between this partner and this member',
            ];
        }

        $existingForExchange = DB::table('reviews')
            ->where('tenant_id', $tenantId)
            ->where('federation_transaction_id', $reviewedExchange)
            ->first(['id']);
        if ($existingForExchange) {
            return ['status' => 'duplicate', 'local_id' => (int) $existingForExchange->id];
        }

        // Defence in depth. A valid inbound credit may be as small as 0.01
        // hours, so the exchange requirement alone still leaves thousands of
        // reviewable exchanges inside the monthly credit ceiling (F-407). One
        // remote community reviewing one local member more often than this in a
        // day is not a pattern the platform needs to support; the local path's
        // equivalent bound is one review per reviewer per 24 hours.
        if ($this->recentInboundReviewCount($partner, $tenantId, $receiverId, $hasExternalIdentity)
            >= self::MAX_INBOUND_REVIEWS_PER_MEMBER_PER_DAY
        ) {
            Log::warning('[FederationExternalWebhook] Inbound review refused: daily cap reached', [
                'partner_id' => (int) $partner->id,
                'tenant_id' => $tenantId,
                'receiver_id' => $receiverId,
            ]);

            return [
                'status' => 'rejected',
                'reason' => 'This partner has already reached the daily limit of reviews for this member',
            ];
        }

        $comment = $this->optionalString($data, 'comment', 5000);

        $reviewRow = [
            'tenant_id'          => $tenantId,
            // Federated reviewer is remote — not a local users row — so reviewer_id
            // stays NULL (its origin is captured by reviewer_tenant_id +
            // external_partner_id). Avoids violating the reviewer_id -> users FK.
            'reviewer_id'        => null,
            'reviewer_tenant_id' => $reviewerTenantId ?: null,
            'receiver_id'        => $receiverId,
            'receiver_tenant_id' => $tenantId,
            // F-406: bind the review to the exchange it describes, so a second
            // review of the same exchange is refused whatever `external_id` the
            // partner picks.
            'federation_transaction_id' => $reviewedExchange,
            'rating'             => $rating,
            'comment'            => $comment,
            'status'             => 'approved',
            'review_type'        => 'federated',
            'show_cross_tenant'  => 1,
            'created_at'         => now(),
        ];

        if ($hasExternalIdentity) {
            $reviewRow['external_partner_id'] = (int) $partner->id;
            $reviewRow['external_id'] = $externalId;
        }

        try {
            $localId = DB::table('reviews')->insertGetId($reviewRow);
        } catch (QueryException $e) {
            if ($hasExternalIdentity && $this->isDuplicateKeyException($e)) {
                $duplicate = DB::table('reviews')
                    ->where('tenant_id', $tenantId)
                    ->where('external_partner_id', (int) $partner->id)
                    ->where('external_id', $externalId)
                    ->first(['id']);

                if ($duplicate) {
                    return ['status' => 'duplicate', 'local_id' => (int) $duplicate->id];
                }
            }

            throw $e;
        }

        $shadowRow = [
            'id' => $localId,
            'external_id' => $externalId,
            'external_partner_id' => $partner->id,
            'rating' => $rating,
            'receiver_id' => $receiverId,
            'reviewer_external_id' => $reviewerExternalId,
            'comment' => $comment,
        ];
        event(new FederatedReviewReceived($tenantId, (int) $partner->id, (int) $localId, $shadowRow));

        return ['status' => 'handled', 'local_id' => (int) $localId];
    }

    /**
     * F-406 — resolve the exchange an inbound review claims to describe.
     *
     * Returns the local `federation_transactions.id` when the reference names a
     * completed exchange that this partner recorded with this member in this
     * tenant, and null otherwise — which includes "no reference was sent at
     * all", "that reference is unknown", "that exchange belongs to another
     * member" and "that exchange belongs to another partner".
     *
     * Every `federation_transactions` row written by this controller carries
     * `sender_tenant_id = 0` and the local member in `receiver_user_id`, so
     * "involves this member" is exactly `receiver_user_id`. If a future outbound
     * path ever records the local member as the sender, that branch has to be
     * added here — and it must test `sender_tenant_id` too, because
     * `sender_user_id` holds a REMOTE id on every row this controller writes and
     * would otherwise match a local member by coincidence.
     */
    private function federatedReviewExchange(
        ?string $externalTxId,
        object $partner,
        int $tenantId,
        int $receiverId
    ): ?int {
        if ($externalTxId === null || trim($externalTxId) === '') {
            return null;
        }

        $tx = DB::table('federation_transactions')
            ->where('external_transaction_id', trim($externalTxId))
            ->where('external_partner_id', (int) $partner->id)
            ->where('receiver_tenant_id', $tenantId)
            ->where('receiver_user_id', $receiverId)
            ->where('status', 'completed')
            ->first(['id']);

        return $tx ? (int) $tx->id : null;
    }

    /**
     * F-406 (second half) — does this member accept federated reviews?
     *
     * The same pair of recorded decisions `FederationController::createReview()`
     * requires before writing an inbound federated review. The join is an inner
     * one, as it is there: `federation_optin` defaults to 0, so a member with no
     * settings row has recorded no consent and the absence is not permission.
     */
    private function receiverAcceptsFederatedReviews(int $userId, int $tenantId): bool
    {
        return DB::table('users')
            ->join('federation_user_settings as fus', 'fus.user_id', '=', 'users.id')
            ->where('users.id', $userId)
            ->where('users.tenant_id', $tenantId)
            ->where('fus.federation_optin', 1)
            ->where('fus.show_reviews_federated', 1)
            ->exists();
    }

    /**
     * F-406 — how many reviews this partner has already left on this member in
     * the last 24 hours.
     *
     * Older schemas have no `reviews.external_partner_id`; there the count falls
     * back to every federated review of this member in the window, which is
     * stricter rather than looser.
     */
    private function recentInboundReviewCount(
        object $partner,
        int $tenantId,
        int $receiverId,
        bool $hasExternalIdentity
    ): int {
        $query = DB::table('reviews')
            ->where('tenant_id', $tenantId)
            ->where('receiver_id', $receiverId)
            ->where('review_type', 'federated')
            ->where('created_at', '>=', now()->subDay());

        if ($hasExternalIdentity) {
            $query->where('external_partner_id', (int) $partner->id);
        }

        return (int) $query->count();
    }

    private function handleInboundListing(array $data, object $partner): array
    {
        $externalId = $this->requireString($data, 'external_id', 128);
        $title = $this->requireString($data, 'title', 500);
        $tenantId = (int) TenantContext::getId();

        $row = [
            'tenant_id' => $tenantId,
            'external_partner_id' => (int) $partner->id,
            'external_id' => $externalId,
            'title' => $title,
            'description' => $this->optionalString($data, 'description', 10000),
            'type' => $this->optionalString($data, 'type', 32),
            'category' => $this->optionalString($data, 'category', 128),
            'external_user_id' => $this->optionalString($data, 'external_user_id', 128)
                ?? $this->optionalString($data, 'user_id', 128),
            'external_user_name' => $this->optionalString($data, 'external_user_name', 255)
                ?? $this->optionalString($data, 'user', 255),
            'metadata' => isset($data['metadata']) && is_array($data['metadata'])
                ? json_encode($data['metadata'])
                : null,
            'updated_at' => now(),
        ];

        $existing = DB::table('federation_listings')
            ->where('tenant_id', $tenantId)
            ->where('external_partner_id', $partner->id)
            ->where('external_id', $externalId)
            ->first(['id']);

        if ($existing) {
            DB::table('federation_listings')->where('id', $existing->id)->update($row);
            $localId = (int) $existing->id;
        } else {
            $row['created_at'] = now();
            $localId = (int) DB::table('federation_listings')->insertGetId($row);
        }

        $row['id'] = $localId;
        event(new FederatedListingReceived($tenantId, (int) $partner->id, $localId, $row));

        return ['status' => 'handled', 'local_id' => $localId];
    }

    private function handleInboundCommunityEvent(array $data, object $partner): array
    {
        $externalId = $this->requireString($data, 'external_id', 128);
        $title = $this->requireString($data, 'title', 500);
        $tenantId = (int) TenantContext::getId();

        $row = [
            'tenant_id' => $tenantId,
            'external_partner_id' => (int) $partner->id,
            'external_id' => $externalId,
            'title' => $title,
            'description' => $this->optionalString($data, 'description', 10000),
            'starts_at' => $this->parseDateTime($this->optionalString($data, 'starts_at', 64)),
            'ends_at' => $this->parseDateTime($this->optionalString($data, 'ends_at', 64)),
            'location' => $this->optionalString($data, 'location', 500),
            'metadata' => isset($data['metadata']) && is_array($data['metadata'])
                ? json_encode($data['metadata'])
                : null,
            'updated_at' => now(),
        ];

        $existing = DB::table('federation_events')
            ->where('tenant_id', $tenantId)
            ->where('external_partner_id', $partner->id)
            ->where('external_id', $externalId)
            ->first(['id']);

        if ($existing) {
            DB::table('federation_events')->where('id', $existing->id)->update($row);
            $localId = (int) $existing->id;
        } else {
            $row['created_at'] = now();
            $localId = (int) DB::table('federation_events')->insertGetId($row);
        }

        $row['id'] = $localId;
        event(new FederatedCommunityEventReceived($tenantId, (int) $partner->id, $localId, $row));

        return ['status' => 'handled', 'local_id' => $localId];
    }

    private function handleInboundGroup(array $data, object $partner): array
    {
        $externalId = $this->requireString($data, 'external_id', 128);
        $name = $this->requireString($data, 'name', 500);
        $tenantId = (int) TenantContext::getId();

        $row = [
            'tenant_id' => $tenantId,
            'external_partner_id' => (int) $partner->id,
            'external_id' => $externalId,
            'name' => $name,
            'description' => $this->optionalString($data, 'description', 10000),
            'privacy' => $this->optionalString($data, 'privacy', 32) ?? 'public',
            'member_count' => max(0, (int) ($data['member_count'] ?? 0)),
            'metadata' => isset($data['metadata']) && is_array($data['metadata'])
                ? json_encode($data['metadata'])
                : null,
            'updated_at' => now(),
        ];

        $existing = DB::table('federation_groups')
            ->where('tenant_id', $tenantId)
            ->where('external_partner_id', $partner->id)
            ->where('external_id', $externalId)
            ->first(['id']);

        if ($existing) {
            DB::table('federation_groups')->where('id', $existing->id)->update($row);
            $localId = (int) $existing->id;
        } else {
            $row['created_at'] = now();
            $localId = (int) DB::table('federation_groups')->insertGetId($row);
        }

        $row['id'] = $localId;
        event(new FederatedGroupReceived($tenantId, (int) $partner->id, $localId, $row, 'group'));

        return ['status' => 'handled', 'local_id' => $localId];
    }

    private function handleInboundGroupMembership(array $data, object $partner): array
    {
        $externalId = $this->requireString($data, 'external_id', 128);
        $tenantId = (int) TenantContext::getId();

        // Increment the shadow group's member_count if we have it
        $existing = DB::table('federation_groups')
            ->where('tenant_id', $tenantId)
            ->where('external_partner_id', $partner->id)
            ->where('external_id', $externalId)
            ->first(['id', 'member_count']);

        if (!$existing) {
            throw new InboundValidationException("Unknown group external_id: {$externalId}", 'external_id');
        }

        $newCount = isset($data['member_count'])
            ? max(0, (int) $data['member_count'])
            : ((int) $existing->member_count + 1);

        DB::table('federation_groups')
            ->where('id', $existing->id)
            ->update([
                'member_count' => $newCount,
                'updated_at'   => now(),
            ]);

        $shadowRow = [
            'id' => (int) $existing->id,
            'external_partner_id' => (int) $partner->id,
            'external_id' => $externalId,
            'member_count' => $newCount,
            'external_user_id' => $this->optionalString($data, 'external_user_id', 128),
        ];
        event(new FederatedGroupReceived($tenantId, (int) $partner->id, (int) $existing->id, $shadowRow, 'member_joined'));

        return ['status' => 'handled', 'local_id' => (int) $existing->id];
    }

    private function handleInboundConnection(array $data, object $partner, string $event): array
    {
        $localUserId = (int) ($data['local_user_id'] ?? $data['recipient_id'] ?? 0);
        $externalUserId = $this->requireString($data, 'external_user_id');

        if ($localUserId <= 0) {
            throw new InboundValidationException('Missing required field: local_user_id', 'local_user_id');
        }

        $tenantId = (int) TenantContext::getId();

        // Verify local_user_id exists in THIS tenant
        $localUser = DB::table('users')
            ->where('id', $localUserId)
            ->where('tenant_id', $tenantId)
            ->where('status', 'active')
            ->first(['id']);
        if (!$localUser) {
            throw new InboundValidationException(
                "Local user #{$localUserId} not found in this tenant",
                'local_user_id'
            );
        }

        if ($blocked = $this->externalRecipientSafeguardingBlock(
            $localUserId,
            (int) $partner->id,
            $externalUserId,
            $event === 'connection.accepted'
                ? 'external_connection_accepted'
                : 'external_connection_requested',
        )) {
            return $blocked;
        }

        $status = $event === 'connection.accepted' ? 'accepted' : 'pending';
        $message = $this->optionalString($data, 'message', 1000);

        $existing = DB::table('federation_inbound_connections')
            ->where('tenant_id', $tenantId)
            ->where('external_partner_id', $partner->id)
            ->where('local_user_id', $localUserId)
            ->where('external_user_id', $externalUserId)
            ->first(['id', 'status', 'notification_sent_at', 'email_sent_at']);

        $row = [
            'tenant_id' => $tenantId,
            'external_partner_id' => (int) $partner->id,
            'local_user_id' => $localUserId,
            'external_user_id' => $externalUserId,
            'status' => $status,
            'message' => $message,
            'updated_at' => now(),
        ];
        $externalUserName = $this->optionalString($data, 'external_user_name', 255)
            ?? $this->optionalString($data, 'sender_name', 255)
            ?? $this->optionalString($data, 'name', 255);

        $shouldNotify = ! $existing
            || (string) $existing->status !== $status
            || empty($existing->notification_sent_at)
            || empty($existing->email_sent_at);

        if ($existing) {
            if ((string) $existing->status !== $status) {
                $row['notification_sent_at'] = null;
                $row['email_sent_at'] = null;
                $row['email_failed_at'] = null;
                $row['email_last_error'] = null;
            }
            DB::table('federation_inbound_connections')
                ->where('id', $existing->id)
                ->where('tenant_id', $tenantId)
                ->update($row);
            $localId = (int) $existing->id;
        } else {
            $row['created_at'] = now();
            $localId = (int) DB::table('federation_inbound_connections')->insertGetId($row);
        }

        $row['id'] = $localId;
        if ($externalUserName !== null) {
            $row['external_user_name'] = $externalUserName;
        }
        if ($shouldNotify) {
            event(new FederatedConnectionReceived($tenantId, (int) $partner->id, $localId, $row));
        }

        return ['status' => 'handled', 'local_id' => $localId];
    }

    private function handleInboundVolunteering(array $data, object $partner): array
    {
        $externalId = $this->requireString($data, 'external_id', 128);
        $title = $this->requireString($data, 'title', 500);
        $tenantId = (int) TenantContext::getId();

        $row = [
            'tenant_id' => $tenantId,
            'external_partner_id' => (int) $partner->id,
            'external_id' => $externalId,
            'title' => $title,
            'description' => $this->optionalString($data, 'description', 10000),
            'hours_requested' => isset($data['hours_requested']) && is_numeric($data['hours_requested'])
                ? (float) $data['hours_requested']
                : null,
            'location' => $this->optionalString($data, 'location', 500),
            'starts_at' => $this->parseDateTime($this->optionalString($data, 'starts_at', 64)),
            'metadata' => isset($data['metadata']) && is_array($data['metadata'])
                ? json_encode($data['metadata'])
                : null,
            'updated_at' => now(),
        ];

        $existing = DB::table('federation_volunteering')
            ->where('tenant_id', $tenantId)
            ->where('external_partner_id', $partner->id)
            ->where('external_id', $externalId)
            ->first(['id']);

        if ($existing) {
            DB::table('federation_volunteering')->where('id', $existing->id)->update($row);
            $localId = (int) $existing->id;
        } else {
            $row['created_at'] = now();
            $localId = (int) DB::table('federation_volunteering')->insertGetId($row);
        }

        $row['id'] = $localId;
        event(new FederatedVolunteeringReceived($tenantId, (int) $partner->id, $localId, $row));

        return ['status' => 'handled', 'local_id' => $localId];
    }

    /**
     * Retract a previously-federated volunteering opportunity: remove the shadow
     * record and deactivate the mirrored vol_opportunities row so it drops out of
     * listings/search. Historical applications on the mirror are left intact.
     * Idempotent — a redelivered retraction affects zero rows the second time.
     */
    private function handleInboundVolunteeringDeletion(array $data, object $partner): array
    {
        // Accept either external_id or the sender's id — a retraction must key on
        // the same reference the original create used.
        $externalId = $this->optionalString($data, 'external_id', 191);
        if ($externalId === null || $externalId === '') {
            $externalId = isset($data['id']) ? (string) $data['id'] : '';
        }
        if ($externalId === '') {
            throw new InboundValidationException('external_id is required', 'external_id');
        }
        $tenantId = (int) TenantContext::getId();

        DB::table('federation_volunteering')
            ->where('tenant_id', $tenantId)
            ->where('external_partner_id', (int) $partner->id)
            ->where('external_id', $externalId)
            ->delete();

        if (Schema::hasColumn('vol_opportunities', 'external_id')) {
            DB::table('vol_opportunities')
                ->where('tenant_id', $tenantId)
                ->where('external_partner_id', (int) $partner->id)
                ->where('external_id', $externalId)
                ->update(['is_active' => 0, 'status' => 'closed', 'updated_at' => now()]);
        }

        return ['status' => 'retracted', 'external_id' => $externalId];
    }

    private function handleInboundMemberSync(array $data, object $partner): array
    {
        $externalId = $this->requireString($data, 'external_id', 128);
        $tenantId = (int) TenantContext::getId();

        $row = [
            'tenant_id' => $tenantId,
            'external_partner_id' => (int) $partner->id,
            'external_id' => $externalId,
            'username' => $this->optionalString($data, 'username', 255),
            'display_name' => $this->optionalString($data, 'display_name', 255),
            'bio' => $this->optionalString($data, 'bio', 5000),
            'location' => $this->optionalString($data, 'location', 255),
            'avatar_url' => $this->optionalString($data, 'avatar_url', 1000),
            'metadata' => isset($data['metadata']) && is_array($data['metadata'])
                ? json_encode($data['metadata'])
                : null,
            'profile_updated_at' => $this->parseDateTime($this->optionalString($data, 'profile_updated_at', 64))
                ?? now(),
            'updated_at' => now(),
        ];

        $existing = DB::table('federation_members')
            ->where('tenant_id', $tenantId)
            ->where('external_partner_id', $partner->id)
            ->where('external_id', $externalId)
            ->first(['id']);

        if ($existing) {
            DB::table('federation_members')->where('id', $existing->id)->update($row);
            $localId = (int) $existing->id;
        } else {
            $row['created_at'] = now();
            $localId = (int) DB::table('federation_members')->insertGetId($row);
        }

        $row['id'] = $localId;
        event(new FederatedMemberUpdated($tenantId, (int) $partner->id, $localId, $row));

        return ['status' => 'handled', 'local_id' => $localId];
    }

    // ----------------------------------------------------------------
    // Data browsing (members + listings)
    // ----------------------------------------------------------------

    private function handleMembersList(array $data, object $partner): array
    {
        // Respect the partner's member-search permission (mirrors handleListingsList).
        if (empty($partner->allow_member_search)) {
            return ['members' => [], 'count' => 0];
        }

        // Wallet balance is financial data and must NOT leak to a federation
        // partner by default (H7). Only include it when the partner is explicitly
        // permitted richer member sync; the member directory is for discoverability.
        $includeBalance = ! empty($partner->allow_member_sync);

        $columns = ['u.id', 'u.first_name', 'u.last_name'];
        if ($includeBalance) {
            $columns[] = 'u.balance';
        }

        $users = DB::table('users as u')
            ->join('federation_user_settings as fus', function ($join) {
                $join->on('fus.user_id', '=', 'u.id')
                     ->where('fus.federation_optin', '=', 1)
                     ->where('fus.profile_visible_federated', '=', 1)
                     ->where('fus.appear_in_federated_search', '=', 1);
            })
            ->where('u.tenant_id', TenantContext::getId())
            ->where('u.status', 'active')
            ->limit(100)
            ->get($columns);

        $members = [];
        foreach ($users as $user) {
            $member = [
                'id' => $user->id,
                'username' => UserDisplayName::resolve($user),
                'tags' => '',
            ];
            if ($includeBalance) {
                $member['balance'] = ($user->balance ?? 0) * 3600;
            }
            $members[] = $member;
        }

        return ['members' => $members, 'count' => count($members)];
    }

    private function handleListingsList(array $data, object $partner): array
    {
        if (empty($partner->allow_listing_search)) {
            return ['listings' => [], 'count' => 0];
        }

        $tenantId = TenantContext::getId();
        $typeFilter = $data['type'] ?? null;
        $searchFilter = $data['search'] ?? null;

        $query = DB::table('listings as l')
            ->join('federation_user_settings as fus', function ($join) {
                $join->on('fus.user_id', '=', 'l.user_id')
                    ->where('fus.federation_optin', '=', 1)
                    ->where('fus.profile_visible_federated', '=', 1);
            })
            ->where('l.tenant_id', $tenantId)
            ->where('l.status', 'active')
            ->whereNull('l.deleted_at');

        if ($typeFilter) {
            $query->where('l.type', $typeFilter);
        }

        if ($searchFilter) {
            $query->where(function ($q) use ($searchFilter) {
                $q->where('l.title', 'LIKE', "%{$searchFilter}%")
                  ->orWhere('l.description', 'LIKE', "%{$searchFilter}%");
            });
        }

        $rows = $query->limit(100)
            ->get(['l.id', 'l.title', 'l.description', 'l.type', 'l.category', 'l.user_id']);

        $listings = [];
        foreach ($rows as $row) {
            // Optionally check if the listing owner has opted-in to federation
            $user = DB::table('users')
                ->where('tenant_id', $tenantId)
                ->where('id', $row->user_id)
                ->first(['first_name', 'last_name', 'profile_type', 'organization_name']);
            $username = $user ? UserDisplayName::resolve($user) : null;

            $listings[] = [
                'id' => $row->id,
                'title' => $row->title,
                'description' => $row->description ? mb_substr($row->description, 0, 300) : null,
                'type' => $row->type,       // "offer" or "inquiry"
                'category' => $row->category,
                'user' => $username,
                'tags' => '',
            ];
        }

        return ['listings' => $listings, 'count' => count($listings)];
    }

    // ----------------------------------------------------------------
    // Message handling
    // ----------------------------------------------------------------

    private function handleInboundMessage(array $data, object $partner): array
    {
        if (!$partner->allow_messaging) {
            return ['status' => 'rejected', 'reason' => 'Messaging not enabled for this partner'];
        }

        // Map TimeOverflow webhook fields to Nexus fields.
        //
        // TimeOverflow webhook payload (data object):
        //   sender_id:            TimeOverflow member ID (integer, external to Nexus)
        //   sender_name:          TimeOverflow username (string)
        //   recipient_id:         The Nexus user ID that TimeOverflow is sending to
        //   subject:              Message subject (optional)
        //   body:                 Message body (required)
        //   external_message_id:  Unique ID from TimeOverflow (e.g., "to_msg_abc123")
        //   organization_id:      TimeOverflow org ID (informational)
        //   organization_name:    TimeOverflow org name (informational)
        //
        // IMPORTANT: recipient_id MUST be a valid Nexus user ID. TimeOverflow
        // obtains this when the Nexus user's ID is shared via the federation
        // member directory (e.g., when browsing partner members in the UI).
        $recipientId = $data['recipient_id'] ?? $data['local_member_id'] ?? null;
        $senderId = $data['sender_id'] ?? $data['remote_user_identifier'] ?? 0;
        $senderName = $data['sender_name'] ?? $data['remote_user_identifier'] ?? 'External User';
        $subject = $data['subject'] ?? '';
        $body = $data['body'] ?? $data['message'] ?? '';
        $externalMessageId = $data['external_message_id'] ?? $data['message_id'] ?? null;

        // Include the source organization for context in the sender name
        $orgName = $data['organization_name'] ?? null;
        if ($orgName && !str_contains($senderName, $orgName)) {
            $senderName .= " ({$orgName})";
        }

        if (empty($body)) {
            return ['status' => 'rejected', 'reason' => 'Message body is required'];
        }

        if (empty($recipientId)) {
            return ['status' => 'rejected', 'reason' => 'Recipient ID is required'];
        }

        $receiverUserId = (int) $recipientId;

        // Validate the receiver exists before calling storeExternalMessage
        $receiver = DB::table('users')
            ->where('id', $receiverUserId)
            ->where('tenant_id', TenantContext::getId())
            ->where('status', 'active')
            ->exists();

        if (!$receiver) {
            Log::warning('[FederationExternalWebhook] Recipient not found', [
                'recipient_id' => $recipientId,
                'partner' => $partner->name,
                'tenant_id' => TenantContext::getId(),
            ]);
            return ['status' => 'rejected', 'reason' => "Recipient user #{$recipientId} not found in this tenant"];
        }

        $result = FederatedMessageService::storeExternalMessage(
            receiverUserId: $receiverUserId,
            externalPartnerId: $partner->id,
            externalSenderId: is_numeric($senderId) ? (int) $senderId : 0,
            senderName: (string) $senderName,
            partnerName: $partner->name ?? 'External Partner',
            subject: (string) $subject,
            body: (string) $body,
            externalMessageId: $externalMessageId ? (string) $externalMessageId : null
        );

        if (($result['success'] ?? false) === false && ($result['retryable'] ?? false) === true) {
            throw new \RuntimeException((string) ($result['error'] ?? 'Federated message delivery failed'));
        }

        if (($result['success'] ?? false) === false) {
            return $result;
        }

        // Update last_message_at on the partner
        DB::table('federation_external_partners')
            ->where('id', $partner->id)
            ->where('tenant_id', $partner->tenant_id)
            ->update(['last_message_at' => now()]);

        return $result;
    }

    // ----------------------------------------------------------------
    // Transaction handling
    // ----------------------------------------------------------------

    private function handleTransactionCompleted(array $data, object $partner): array
    {
        if (!$partner->allow_transactions) {
            return ['status' => 'rejected', 'reason' => 'Transactions not enabled for this partner'];
        }

        $externalTxId = $data['external_transaction_id'] ?? null;

        Log::info('[FederationExternalWebhook] Transaction completed', [
            'partner' => $partner->name,
            'external_transaction_id' => $externalTxId,
        ]);

        // Record the completed transaction in our federation_transactions table
        $recipientId = $data['recipient_id'] ?? $data['local_member_id'] ?? null;
        $senderId = $data['sender_id'] ?? 0;
        // Already normalized to HOURS by the protocol adapter (TimeOverflow
        // seconds are converted upstream in normalizeWebhookPayload).
        $amount = (float) ($data['amount'] ?? 0);
        $description = $data['description'] ?? '';

        if ($recipientId && $amount > 0) {
            if (!SecurityBounds::isAcceptableHourAmount($amount)) {
                return ['status' => 'rejected', 'reason' => 'Amount exceeds the permitted single-transfer limit'];
            }

            if (!is_string($externalTxId) || trim($externalTxId) === '') {
                return ['status' => 'rejected', 'reason' => 'Missing external_transaction_id'];
            }

            $receiverUserId = (int) $recipientId;

            // Validate receiver exists in this tenant
            $receiver = DB::table('users')
                ->where('id', $receiverUserId)
                ->where('tenant_id', TenantContext::getId())
                ->where('status', 'active')
                ->first();

            if (!$receiver) {
                return ['status' => 'rejected', 'reason' => "Recipient user #{$recipientId} not found in this tenant"];
            }

            if ($blocked = $this->externalRecipientSafeguardingBlock(
                $receiverUserId,
                (int) $partner->id,
                (string) $senderId,
                'external_transaction_completed',
            )) {
                return $blocked;
            }

            $idempotencyKey = $this->externalTransactionIdempotencyKey($partner, $externalTxId);
            $existingTransaction = $this->findExternalTransaction($partner, $externalTxId, $idempotencyKey);
            if ($existingTransaction) {
                $delivery = $this->ensureExternalTransactionDelivery(
                    $existingTransaction,
                    $receiver,
                    $partner,
                    (string) ($data['sender_name'] ?? __('api.external_user_fallback')),
                    (float) $existingTransaction->amount,
                    (string) ($existingTransaction->description ?? '')
                );

                return $this->withDeliveryOutcome(
                    ['status' => 'duplicate', 'reason' => 'Transaction already recorded'],
                    $delivery
                );
            }

            // F-484 — the member's own recorded federation choice, which every
            // other inbound credit protocol already reads. Deliberately after the
            // idempotency branch: this guards the act of crediting, so a replay of
            // a transfer we really did accept still gets its "duplicate" answer
            // rather than a false failure the partner would reissue.
            if (!$this->receiverAcceptsFederatedCredit($receiverUserId, (int) TenantContext::getId())) {
                return ['status' => 'rejected', 'reason' => 'Recipient has not enabled federated transactions'];
            }

            // Credit the receiver's balance and record the transaction
            DB::beginTransaction();
            try {
                // F-407 — inside the transaction, with the agreement row locked,
                // or two concurrent credits both pass the same stale total.
                if ($refusal = $this->inboundCreditCeilingRefusal((int) TenantContext::getId(), $amount)) {
                    DB::rollBack();

                    return $refusal;
                }

                $transactionRow = [
                    'sender_tenant_id'       => 0, // External origin
                    'sender_user_id'         => (int) $senderId,
                    'receiver_tenant_id'     => TenantContext::getId(),
                    'receiver_user_id'       => $receiverUserId,
                    'amount'                 => $amount,
                    'description'            => $description,
                    'status'                 => 'completed',
                    'completed_at'           => now(),
                    'external_partner_id'    => $partner->id,
                    'external_receiver_name' => $data['sender_name'] ?? 'External User',
                    'external_transaction_id' => $externalTxId,
                    'created_at'             => now(),
                ];

                if ($idempotencyKey !== null && $this->federationTransactionsSupportsIdempotencyKey()) {
                    $transactionRow['external_idempotency_key'] = $idempotencyKey;
                }

                DB::table('federation_transactions')->insert($transactionRow);

                DB::update("UPDATE users SET balance = balance + ? WHERE id = ? AND tenant_id = ?", [$amount, $receiverUserId, TenantContext::getId()]);

                DB::commit();
            } catch (QueryException $e) {
                DB::rollBack();
                if ($this->isDuplicateKeyException($e)) {
                    return ['status' => 'duplicate', 'reason' => 'Transaction already recorded'];
                }

                Log::error('[FederationExternalWebhook] Failed to record transaction', [
                    'error' => $e->getMessage(),
                    'partner' => $partner->name,
                    'external_transaction_id' => $externalTxId,
                ]);
                return ['status' => 'error', 'reason' => 'Failed to record transaction'];
            } catch (\Throwable $e) {
                DB::rollBack();
                Log::error('[FederationExternalWebhook] Failed to record transaction', [
                    'error' => $e->getMessage(),
                    'partner' => $partner->name,
                    'external_transaction_id' => $externalTxId,
                ]);
                return ['status' => 'error', 'reason' => 'Failed to record transaction'];
            }

            $transaction = $this->findExternalTransaction($partner, $externalTxId, $idempotencyKey);
            if (!$transaction) {
                throw new \RuntimeException('Federated transaction row missing after insert');
            }

            $delivery = $this->ensureExternalTransactionDelivery(
                $transaction,
                $receiver,
                $partner,
                (string) ($data['sender_name'] ?? __('api.external_user_fallback')),
                $amount,
                (string) $description
            );

            return $this->withDeliveryOutcome(['status' => 'acknowledged'], $delivery);
        }

        return ['status' => 'acknowledged'];
    }

    private function handleTransactionCancelled(array $data, object $partner): array
    {
        if (!$partner->allow_transactions) {
            return ['status' => 'rejected', 'reason' => 'Transactions not enabled for this partner'];
        }

        $externalTxId = $data['external_transaction_id'] ?? null;
        $reason = $data['reason'] ?? null;
        $tenantId = (int) TenantContext::getId();

        Log::info('[FederationExternalWebhook] Transaction cancelled', [
            'partner' => $partner->name,
            'external_transaction_id' => $externalTxId,
            'reason' => $reason,
            'tenant_id' => $tenantId,
        ]);

        // If we have a record of this transaction, mark it as cancelled and reverse the credit.
        // The state check must happen under the row lock: two valid partner deliveries may use
        // different nonces, so webhook replay protection alone cannot serialize this business
        // transition.
        if ($externalTxId) {
            try {
                return DB::transaction(function () use ($externalTxId, $partner, $tenantId, $reason): array {
                    $tx = DB::table('federation_transactions')
                        ->where('external_transaction_id', $externalTxId)
                        ->where('external_partner_id', $partner->id)
                        ->where('receiver_tenant_id', $tenantId)
                        ->lockForUpdate()
                        ->first();

                    if (!$tx || $tx->status !== 'completed') {
                        return ['status' => 'acknowledged'];
                    }

                    // Reverse the credit — include tenant_id from the original transaction record
                    // AND balance >= amount guard ensures we only succeed if the user still has
                    // the credits. If 0 rows are affected the user has already spent them.
                    $rowsAffected = DB::update(
                        "UPDATE users SET balance = balance - ? WHERE id = ? AND tenant_id = ? AND balance >= ?",
                        [$tx->amount, $tx->receiver_user_id, $tx->receiver_tenant_id, $tx->amount]
                    );

                    if ($rowsAffected === 0) {
                        // User has already spent the credits — mark as disputed instead
                        $transitioned = DB::table('federation_transactions')
                            ->where('id', $tx->id)
                            ->where('receiver_tenant_id', (int) $tx->receiver_tenant_id)
                            ->where('status', 'completed')
                            ->update([
                                'status'              => 'disputed',
                                'cancellation_reason' => 'reversal_failed: insufficient_balance',
                                'cancelled_at'        => now(),
                            ]);

                        if ($transitioned !== 1) {
                            throw new \RuntimeException('Federation transaction changed during cancellation reversal');
                        }

                        Log::warning('[FederationExternalWebhook] Transaction cancellation reversal failed — user balance insufficient, flagged as disputed', [
                            'transaction_id'   => $tx->id,
                            'receiver_user_id' => $tx->receiver_user_id,
                            'amount'           => $tx->amount,
                            'partner'          => $partner->name,
                        ]);

                        return ['status' => 'reversal_failed', 'reason' => 'User balance insufficient — transaction flagged as disputed'];
                    }

                    $transitioned = DB::table('federation_transactions')
                        ->where('id', $tx->id)
                        ->where('receiver_tenant_id', (int) $tx->receiver_tenant_id)
                        ->where('status', 'completed')
                        ->update([
                            'status'              => 'cancelled',
                            'cancelled_at'        => now(),
                            'cancellation_reason' => $reason,
                        ]);

                    if ($transitioned !== 1) {
                        throw new \RuntimeException('Federation transaction changed during cancellation reversal');
                    }

                    return ['status' => 'cancelled'];
                }, 3);
            } catch (\Throwable $e) {
                Log::error('[FederationExternalWebhook] Failed to cancel transaction', [
                    'error' => $e->getMessage(),
                    'external_transaction_id' => $externalTxId,
                    'external_partner_id' => $partner->id,
                    'receiver_tenant_id' => $tenantId,
                ]);
                return ['status' => 'error', 'reason' => 'Failed to cancel transaction'];
            }
        }

        return ['status' => 'acknowledged'];
    }

    private function handleTransactionRequested(array $data, object $partner): array
    {
        if (!$partner->allow_transactions) {
            return ['status' => 'rejected', 'reason' => 'Transactions not enabled for this partner'];
        }

        $externalTxId = $data['external_transaction_id'] ?? null;

        // Amount arrives already normalized to HOURS: the protocol adapter
        // (e.g. TimeOverflowAdapter::normalizeWebhookPayload) converts partner
        // units — TimeOverflow sends seconds — before this handler runs, and
        // native Nexus partners send hours directly. The old >100 magnitude
        // heuristic mis-converted small seconds and large hours alike.
        $amountInHours = (float) ($data['amount'] ?? 0);

        // Accept multiple field names for recipient — different platforms use different keys
        $recipientId = $data['recipient_id']
            ?? $data['remote_user_identifier']
            ?? $data['local_member_id']
            ?? null;

        Log::info('[FederationExternalWebhook] Transaction requested', [
            'partner' => $partner->name,
            'external_transaction_id' => $externalTxId,
            'amount_hours' => $amountInHours,
            'recipient_id' => $recipientId,
        ]);

        // Validate basic fields
        if (!$recipientId || $amountInHours <= 0) {
            return ['status' => 'rejected', 'reason' => 'Missing recipient_id or invalid amount'];
        }

        if (!is_string($externalTxId) || trim($externalTxId) === '') {
            return ['status' => 'rejected', 'reason' => 'Missing external_transaction_id'];
        }

        if (!SecurityBounds::isAcceptableHourAmount($amountInHours)) {
            return ['status' => 'rejected', 'reason' => 'Amount exceeds the permitted single-transfer limit'];
        }

        // Validate receiver exists
        $receiverUserId = (int) $recipientId;
        $receiver = DB::table('users')
            ->where('id', $receiverUserId)
            ->where('tenant_id', TenantContext::getId())
            ->where('status', 'active')
            ->first();

        if (!$receiver) {
            return ['status' => 'rejected', 'reason' => "Recipient user #{$recipientId} not found in this tenant"];
        }

        if ($blocked = $this->externalRecipientSafeguardingBlock(
            $receiverUserId,
            (int) $partner->id,
            (string) ($data['sender_id'] ?? 'unknown'),
            'external_transaction_requested',
        )) {
            return $blocked;
        }

        $idempotencyKey = $this->externalTransactionIdempotencyKey($partner, $externalTxId);
        $existingTransaction = $this->findExternalTransaction($partner, $externalTxId, $idempotencyKey);
        if ($existingTransaction) {
            $delivery = $this->ensureExternalTransactionDelivery(
                $existingTransaction,
                $receiver,
                $partner,
                (string) ($data['sender_name'] ?? $data['source_organization_name'] ?? __('api.external_user_fallback')),
                (float) $existingTransaction->amount,
                (string) ($existingTransaction->description ?? '')
            );

            return $this->withDeliveryOutcome(
                ['status' => 'duplicate', 'reason' => 'Transaction already recorded'],
                $delivery
            );
        }

        // F-484 — the member's own recorded federation choice, which every other
        // inbound credit protocol already reads. Deliberately after the
        // idempotency branch: this guards the act of crediting, so a replay of a
        // transfer we really did accept still gets its "duplicate" answer rather
        // than a false failure the partner would reissue.
        if (!$this->receiverAcceptsFederatedCredit($receiverUserId, (int) TenantContext::getId())) {
            return ['status' => 'rejected', 'reason' => 'Recipient has not enabled federated transactions'];
        }

        // Record the transaction AND credit the user immediately — atomically
        DB::beginTransaction();
        try {
            // F-407 — inside the transaction, with the agreement row locked, or
            // two concurrent credits both pass the same stale total.
            if ($refusal = $this->inboundCreditCeilingRefusal((int) TenantContext::getId(), $amountInHours)) {
                DB::rollBack();

                return $refusal;
            }

            $transactionRow = [
                'sender_tenant_id'        => 0,
                'sender_user_id'          => (int) ($data['sender_id'] ?? 0),
                'receiver_tenant_id'      => TenantContext::getId(),
                'receiver_user_id'        => $receiverUserId,
                'amount'                  => $amountInHours,
                'description'             => $data['reason'] ?? $data['description'] ?? '',
                'status'                  => 'completed',
                'external_partner_id'     => $partner->id,
                'external_receiver_name'  => $data['sender_name'] ?? $data['source_organization_name'] ?? 'External User',
                'external_transaction_id' => $externalTxId,
                'created_at'              => now(),
            ];

            if ($idempotencyKey !== null && $this->federationTransactionsSupportsIdempotencyKey()) {
                $transactionRow['external_idempotency_key'] = $idempotencyKey;
            }

            DB::table('federation_transactions')->insert($transactionRow);

            // Auto-credit the recipient's balance
            $creditedRows = DB::table('users')
                ->where('id', $receiverUserId)
                ->where('tenant_id', TenantContext::getId())
                ->increment('balance', $amountInHours);

            if ($creditedRows === 0) {
                throw new \RuntimeException('Receiver balance update failed');
            }

            DB::commit();
        } catch (QueryException $e) {
            DB::rollBack();
            if ($this->isDuplicateKeyException($e)) {
                return ['status' => 'duplicate', 'reason' => 'Transaction already recorded'];
            }

            Log::error('[FederationExternalWebhook] Failed to record transaction request', [
                'error' => $e->getMessage(),
                'partner' => $partner->name,
                'external_transaction_id' => $externalTxId,
            ]);
            return ['status' => 'error', 'reason' => 'Failed to record transaction'];
        } catch (\Throwable $e) {
            DB::rollBack();
            Log::error('[FederationExternalWebhook] Failed to record transaction request', [
                'error' => $e->getMessage(),
                'partner' => $partner->name,
                'external_transaction_id' => $externalTxId,
            ]);
            return ['status' => 'error', 'reason' => 'Failed to record transaction'];
        }

        Log::info('[FederationExternalWebhook] Auto-credited user', [
            'user_id' => $receiverUserId,
            'amount_hours' => $amountInHours,
            'new_balance' => DB::table('users')
                ->where('id', $receiverUserId)
                ->where('tenant_id', TenantContext::getId())
                ->value('balance'),
        ]);

        $transaction = $this->findExternalTransaction($partner, $externalTxId, $idempotencyKey);
        if (!$transaction) {
            throw new \RuntimeException('Federated transaction row missing after insert');
        }

        $delivery = $this->ensureExternalTransactionDelivery(
            $transaction,
            $receiver,
            $partner,
            (string) ($data['sender_name'] ?? $data['source_organization_name'] ?? __('api.external_user_fallback')),
            $amountInHours,
            (string) ($data['reason'] ?? $data['description'] ?? '')
        );

        return $this->withDeliveryOutcome([
            'status' => 'completed',
            'amount_credited' => $amountInHours,
            'recipient_id' => $receiverUserId,
        ], $delivery);
    }

    /**
     * F-422 — report a failed notification as a failed NOTIFICATION, never as a
     * failed transfer.
     *
     * The money is already committed by the time
     * `ensureExternalTransactionDelivery()` runs. A false return used to throw,
     * and `receive()`'s generic `\Throwable` arm answers HTTP 500
     * PROCESSING_FAILED — the response this controller's own docblock reserves
     * for internal errors that "must stay retryable for the sending partner".
     * So a partner that reads 500 as "this transfer did not happen" and reissues
     * under a fresh `external_transaction_id` double-credits the member, and by
     * F-407 only the community's monthly ceiling bounds the compounding.
     *
     * The delivery failure is not lost: `ensureExternalTransactionDelivery()`
     * has already stamped `email_failed_at` / `email_last_error` on the row and
     * logged it, `AdminEmailDeliverabilityController` reports those rows to an
     * operator, and a later replay of the same identifier still repairs the
     * notification. The partner is now told the transfer was accepted, with the
     * delivery problem reported alongside it.
     *
     * @param array<string,mixed> $result
     * @param array{success:bool,error?:string} $delivery
     * @return array<string,mixed>
     */
    private function withDeliveryOutcome(array $result, array $delivery): array
    {
        if (($delivery['success'] ?? false) === true) {
            return $result;
        }

        $result['delivery'] = 'failed';
        $result['delivery_error'] = (string) ($delivery['error'] ?? 'Federated transaction delivery failed');

        return $result;
    }

    /**
     * F-484 — does this member accept time credit arriving from outside?
     *
     * `federation_user_settings.federation_optin` and
     * `transactions_enabled_federated` are the member's own two recorded
     * decisions, and every other inbound credit protocol reads them before
     * moving money: Komunitin (`localAccountCanTransact()`), Credit Commons
     * (`payerMayBeDebited()`), the v1 partner API (TRANSACTIONS_DISABLED) and
     * the v2 member path. This protocol looked the receiver up on id, tenant and
     * `status = 'active'` only, so credit from an outside organisation landed in
     * the wallet of a member who had refused federation.
     *
     * The join is deliberately an inner one, matching the four surfaces above:
     * every flag in `federation_user_settings` defaults to 0, so a member with
     * no row has recorded no consent and the absence must not read as
     * permission.
     */
    private function receiverAcceptsFederatedCredit(int $userId, int $tenantId): bool
    {
        return DB::table('users')
            ->join('federation_user_settings as fus', 'fus.user_id', '=', 'users.id')
            ->where('users.id', $userId)
            ->where('users.tenant_id', $tenantId)
            ->where('fus.federation_optin', 1)
            ->where('fus.transactions_enabled_federated', 1)
            ->exists();
    }

    /**
     * F-407 — the aggregate ceiling on externally-originated credit arriving
     * through the external-webhook / native-ingest protocol.
     *
     * An inbound credit here creates spendable balance with no matching local
     * debit: `sender_tenant_id` is literally 0, so nothing on this installation
     * balances it. `SecurityBounds::MAX_SINGLE_EXTERNAL_CREDIT_HOURS` caps a
     * SINGLE transfer at 24 hours, and the only accumulation control was
     * idempotency on `external_transaction_id` — a string the sending partner
     * chooses freely, so repeating the call under a fresh identifier minted
     * without limit.
     *
     * This is F-345's defect in its fourth protocol. The bound is the same table
     * the other three already use: the v1 partner API refuses outright without
     * an active agreement (`FederationController::createTransaction`,
     * NO_CREDIT_AGREEMENT), Komunitin publishes its credit limit from
     * `max_monthly_credits`, and Credit Commons enforces it as a monthly total
     * (`FederationCreditCommonsController::inboundCreditCeilingRefusal`).
     *
     * Scope note: the ceiling is per community, not per partner, because the
     * agreement row is keyed on `to_tenant_id`. Every externally-originated
     * credit into this community counts against the one budget, so a second
     * partner does not double it. It counts this protocol's own ledger
     * (`federation_transactions`); Credit Commons counts its own rows in
     * `transactions`, so a community running both protocols has a budget under
     * each. Consolidating the two is a wider change than this fix.
     *
     * 🔴 Call with a database transaction already open. The agreement row is
     * locked so two concurrent inbound credits cannot both read the same
     * "already credited" total and both pass it.
     *
     * @return array<string,string>|null a refusal to return to the partner, or null to proceed
     */
    private function inboundCreditCeilingRefusal(int $tenantId, float $amountInHours): ?array
    {
        $agreement = DB::table('federation_credit_agreements')
            ->where('to_tenant_id', $tenantId)
            ->where('status', 'active')
            ->orderBy('id')
            ->lockForUpdate()
            ->first(['id', 'max_monthly_credits']);

        if (!$agreement) {
            Log::warning('[FederationExternalWebhook] Inbound credit refused: no active credit agreement', [
                'tenant_id' => $tenantId,
                'amount_hours' => $amountInHours,
            ]);

            return [
                'status' => 'rejected',
                'reason' => 'No active credit agreement authorises inbound credit to this community',
            ];
        }

        $ceiling = $agreement->max_monthly_credits === null
            ? self::DEFAULT_MONTHLY_INBOUND_CREDIT_HOURS
            : (float) $agreement->max_monthly_credits;

        // Every externally-originated credit this community has taken in this
        // month — the exact shape both money handlers below write.
        //
        // 🔴 F-428 — do NOT filter this by status. The first version of this
        // control summed only `status = 'completed'`, and the same authenticated
        // partner moves a row out of 'completed' whenever it likes:
        // handleTransactionCancelled() writes 'disputed' when the member has
        // already spent the credit (nothing is taken back) and 'cancelled' when
        // the reversal succeeds. Both dropped out of this sum, so every
        // cancellation handed the month's budget back — 72 hours were delivered
        // against a 30-hour agreement in three credit/spend/cancel rounds.
        //
        // Both credit paths insert 'completed' inside the same database
        // transaction as the balance change and roll back together, so every row
        // in this shape is a credit that really was delivered. An unfiltered sum
        // therefore means "every hour this community took from outside this
        // month", which is exactly what the agreement bounds. A cancellation is
        // not evidence the same credit came back either — the reversal only
        // checks `balance >= amount` on the receiving member, so it can take
        // hours that member earned locally. This matches the sound model this
        // control was copied from (FederationCreditCommonsController::
        // inboundCreditCeilingRefusal, which has never filtered) and the v1
        // partner API's F-440 fix. Consequence, deliberate: a partner that
        // cancels in good faith does not get that budget back until next month.
        $alreadyCredited = (float) DB::table('federation_transactions')
            ->where('receiver_tenant_id', $tenantId)
            ->where('sender_tenant_id', 0)
            ->whereNotNull('external_partner_id')
            ->where('created_at', '>=', now()->startOfMonth())
            ->sum('amount');

        if ($alreadyCredited + $amountInHours > $ceiling) {
            Log::warning('[FederationExternalWebhook] Inbound credit refused: monthly ceiling reached', [
                'tenant_id' => $tenantId,
                'agreement_id' => (int) $agreement->id,
                'ceiling_hours' => $ceiling,
                'already_credited_hours' => $alreadyCredited,
                'requested_hours' => $amountInHours,
            ]);

            return [
                'status' => 'rejected',
                'reason' => 'Inbound credit would exceed this community\'s monthly credit ceiling',
            ];
        }

        return null;
    }

    private function externalTransactionIdempotencyKey(object $partner, mixed $externalTxId): ?string
    {
        if (!is_string($externalTxId) || trim($externalTxId) === '') {
            return null;
        }

        return 'external-partner:' . (int) $partner->id . ':transaction:' . trim($externalTxId);
    }

    private function externalTransactionAlreadyRecorded(object $partner, mixed $externalTxId, ?string $idempotencyKey): bool
    {
        return $this->findExternalTransaction($partner, $externalTxId, $idempotencyKey) !== null;
    }

    private function findExternalTransaction(object $partner, mixed $externalTxId, ?string $idempotencyKey): ?object
    {
        if ($idempotencyKey !== null && $this->federationTransactionsSupportsIdempotencyKey()) {
            return DB::table('federation_transactions')
                ->where('external_idempotency_key', $idempotencyKey)
                ->where('receiver_tenant_id', (int) $partner->tenant_id)
                ->first();
        }

        if (!is_string($externalTxId) || trim($externalTxId) === '') {
            return null;
        }

        return DB::table('federation_transactions')
            ->where('external_transaction_id', trim($externalTxId))
            ->where('external_partner_id', $partner->id)
            ->where('receiver_tenant_id', (int) $partner->tenant_id)
            ->first();
    }

    /**
     * @return array{success:bool,error?:string}
     */
    private function ensureExternalTransactionDelivery(object $transaction, object $receiver, object $partner, string $senderName, float $amount, string $description): array
    {
        try {
            $transactionId = (int) $transaction->id;
            $receiverUserId = (int) $transaction->receiver_user_id;
            $receiverTenantId = (int) $transaction->receiver_tenant_id;

            if (empty($transaction->notification_sent_at)) {
                LocaleContext::withLocale($receiver, function () use ($partner, $amount, $receiverUserId, $receiverTenantId, $senderName) {
                    $partnerName = $partner->name ?? __('api.external_partner_fallback');
                    $notifyMessage = __('svc_notifications.federation.transaction_received', [
                        'amount' => rtrim(rtrim(number_format($amount, 2), '0'), '.'),
                        'sender' => $senderName,
                        'partner' => $partnerName,
                    ]);
                    Notification::createNotification(
                        $receiverUserId,
                        $notifyMessage,
                        '/wallet',
                        'federation_transaction',
                        false,
                        $receiverTenantId
                    );
                    \App\Services\NotificationDispatcher::fanOutPush((int) ($receiverUserId), 'federation_transaction', $notifyMessage, '/wallet');
                });

                DB::table('federation_transactions')
                    ->where('id', $transactionId)
                    ->where('receiver_tenant_id', $receiverTenantId)
                    ->whereNull('notification_sent_at')
                    ->update(['notification_sent_at' => now()]);
            }

            if (!empty($transaction->email_sent_at)) {
                return ['success' => true];
            }

            $emailSent = FederationEmailService::sendExternalTransactionNotification(
                $receiverUserId,
                $receiverTenantId,
                $senderName,
                (string) ($partner->name ?? __('api.external_partner_fallback')),
                $amount,
                $description
            );

            DB::table('federation_transactions')
                ->where('id', $transactionId)
                ->where('receiver_tenant_id', $receiverTenantId)
                ->update([
                    'email_sent_at' => $emailSent ? now() : null,
                    'email_failed_at' => $emailSent ? null : now(),
                    'email_last_error' => $emailSent ? null : 'Email dispatch returned false',
                ]);

            if (!$emailSent) {
                Log::warning('[FederationExternalWebhook] External transaction email returned false', [
                    'receiver_user_id' => $receiverUserId,
                    'tenant_id' => $receiverTenantId,
                    'external_partner_id' => $partner->id,
                    'external_transaction_id' => $transaction->external_transaction_id ?? null,
                ]);

                return ['success' => false, 'error' => 'Email dispatch returned false'];
            }

            return ['success' => true];
        } catch (\Throwable $e) {
            Log::warning('Failed to dispatch federation transaction delivery side effects', ['error' => $e->getMessage()]);

            return ['success' => false, 'error' => $e->getMessage()];
        }
    }

    private function federationTransactionsSupportsIdempotencyKey(): bool
    {
        static $supports = null;

        if ($supports === null) {
            $supports = Schema::hasColumn('federation_transactions', 'external_idempotency_key');
        }

        return $supports;
    }

    private function isDuplicateKeyException(QueryException $e): bool
    {
        return $e->getCode() === '23000'
            || str_contains($e->getMessage(), '1062')
            || str_contains($e->getMessage(), 'Duplicate entry');
    }

    // ----------------------------------------------------------------
    // Partnership events
    // ----------------------------------------------------------------

    /**
     * Valid partnership status transitions.
     * Terminated partners cannot be reactivated — matches TimeOverflow's state machine.
     */
    private const VALID_TRANSITIONS = [
        'pending'   => ['active', 'suspended', 'failed'],
        'active'    => ['suspended', 'failed'],
        'suspended' => ['active', 'failed'],
        'failed'    => [], // Terminal state — no transitions allowed
    ];

    private function canTransition(string $from, string $to): bool
    {
        return in_array($to, self::VALID_TRANSITIONS[$from] ?? [], true);
    }

    private function handlePartnershipActivated(object $partner): array
    {
        // F-423: a SUSPENDED partner may not reinstate itself. VALID_TRANSITIONS
        // above describes which status changes the protocol's state machine
        // allows, not WHO may make them — and `suspended => active` is listed
        // there because lifting a suspension is a legitimate transition for an
        // OPERATOR to make from the federation admin. Suspension is the
        // operator's only lever against a partner that is misbehaving, so it
        // must never be liftable by a partner-initiated event.
        //
        // 🔴 This was latent, not live, and the reason must not be mistaken for
        // a reason to drop either half. Both HTTP entry points already refuse a
        // non-active partner before dispatch — receive() (:136-138) and
        // FederationNativeIngestController (:177-179) — and those refusals stay.
        // This check hardens the handler because processTrustedEvent() is
        // PUBLIC and its contract carries no status check: a third caller that
        // omitted that one line would hand a suspended partner its own
        // reinstatement. Same shape as F-173.
        if ((string) $partner->status === 'suspended') {
            Log::warning("[FederationExternalWebhook] Refused self-reinstatement of suspended partner #{$partner->id}");
            return ['status' => 'rejected', 'reason' => 'A suspended partner cannot reactivate itself'];
        }

        if (!$this->canTransition($partner->status, 'active')) {
            Log::warning("[FederationExternalWebhook] Rejected activation of {$partner->status} partner #{$partner->id}");
            return ['status' => 'rejected', 'reason' => "Cannot activate a {$partner->status} partner"];
        }

        // F-423: `error_count` and `last_error` are the OPERATOR's record of
        // what this partner did wrong. They are cleared by the operator
        // (AdminFederationExternalPartnersController :183, :191) and by a
        // successful run of SyncFederationPartners — never by the partner
        // itself. Clearing them here let a partner-initiated event erase the
        // evidence behind its own suspension.
        DB::table('federation_external_partners')
            ->where('id', $partner->id)
            ->where('tenant_id', $partner->tenant_id)
            ->update(['status' => 'active', 'verified_at' => now()]);
        return ['status' => 'activated'];
    }

    private function handlePartnershipSuspended(object $partner): array
    {
        if (!$this->canTransition($partner->status, 'suspended')) {
            return ['status' => 'rejected', 'reason' => "Cannot suspend a {$partner->status} partner"];
        }
        DB::table('federation_external_partners')
            ->where('id', $partner->id)
            ->where('tenant_id', $partner->tenant_id)
            ->update(['status' => 'suspended']);
        return ['status' => 'suspended'];
    }

    private function handlePartnershipTerminated(object $partner): array
    {
        if (!$this->canTransition($partner->status, 'failed')) {
            return ['status' => 'rejected', 'reason' => "Cannot terminate a {$partner->status} partner"];
        }
        DB::table('federation_external_partners')
            ->where('id', $partner->id)
            ->where('tenant_id', $partner->tenant_id)
            ->update(['status' => 'failed']);
        return ['status' => 'terminated'];
    }

    /**
     * External partners cannot provide a trusted local broker attestation. A
     * protected recipient therefore rejects the transaction before any credit,
     * row, description, email, or notification is delivered.
     *
     * @return array{status: string, reason: string, success: false, error: string, error_code: string, retryable: bool}|null
     */
    private function externalRecipientSafeguardingBlock(
        int $recipientId,
        int $partnerId,
        string $externalSenderId,
        string $channel,
    ): ?array {
        $decision = app(SafeguardingInteractionPolicy::class)->evaluateExternalContact(
            $recipientId,
            TenantContext::getId(),
            "partner:{$partnerId}:sender:{$externalSenderId}",
            $channel,
        );
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
        return [
            'status' => 'rejected',
            'reason' => (string) $error['message'],
            'success' => false,
            'error' => (string) $error['message'],
            'error_code' => $decision->code,
            'retryable' => $decision->isUnavailable(),
        ];
    }

    // ----------------------------------------------------------------
    // Logging
    // ----------------------------------------------------------------

    private function logWebhook(object $partner, string $event, array $payload): int
    {
        return DB::table('federation_external_partner_logs')->insertGetId([
            'partner_id' => $partner->id,
            'endpoint' => "/webhooks/receive [{$event}]",
            'method' => 'POST',
            'response_code' => 0,
            'success' => false,
            'request_body' => substr(FederationLogRedactor::redactJsonString(json_encode($payload) ?: '{"_encode_error": true}') ?? '', 0, 10000),
            'response_body' => null,
            'response_time_ms' => 0,
            'created_at' => now(),
        ]);
    }
}

/**
 * Internal exception thrown by inbound handlers when the incoming payload
 * is malformed or missing required fields. Caught in receive() and mapped
 * to a 400 response.
 */
final class InboundValidationException extends \RuntimeException
{
    public function __construct(string $message, public readonly ?string $field = null)
    {
        parent::__construct($message);
    }
}

/**
 * Thrown when inbound federation is gated off for the partner's tenant
 * (global disable, emergency lockdown, or tenant not whitelisted). Callers map
 * it to HTTP 503 so a well-behaved partner retries once the operator re-enables
 * federation — instead of the event being silently acknowledged or minting
 * balances during a lockdown.
 */
final class FederationUnavailableException extends \RuntimeException
{
}
