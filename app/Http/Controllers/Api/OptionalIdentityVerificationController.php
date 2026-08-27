<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

namespace App\Http\Controllers\Api;

use Illuminate\Http\JsonResponse;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Log;
use App\Core\TenantContext;
use App\Services\Identity\IdentityProviderRegistry;
use App\Services\Identity\IdentityVerificationSessionService;
use App\Services\Identity\IdentityVerificationEventService;
use App\Services\Identity\IdentityVerificationPaymentService;
use App\Services\Identity\TenantProviderCredentialService;
use App\Services\MemberVerificationBadgeService;
use App\Services\NotificationDispatcher;

/**
 * OptionalIdentityVerificationController — Voluntary ID verification for active users.
 *
 * Flow: DOB collection → Payment (€5, configurable) → Stripe Identity → Badge granted.
 * Payment is one-time per tenant — retries after failure skip payment.
 */
class OptionalIdentityVerificationController extends BaseApiController
{
    protected bool $isV2Api = true;

    public function __construct(
        private readonly MemberVerificationBadgeService $badgeService,
    ) {}

    /**
     * Optional identity verification is gated by the per-tenant
     * `identity_verification` feature flag (admin Module Configuration). When an
     * admin turns it off, members can no longer start or progress a new
     * verification. Read-only status (getStatus) stays available so existing
     * "ID Verified" badges keep rendering. Returns a 403 response when disabled,
     * or null when the feature is enabled.
     */
    private function guardFeatureEnabled(): ?JsonResponse
    {
        if (!TenantContext::hasFeature('identity_verification')) {
            return $this->respondWithError('FEATURE_DISABLED', __('api.service_unavailable'), null, 403);
        }
        return null;
    }

    /**
     * GET /api/v2/identity/status
     *
     * Returns verification status, badge state, DOB status, and fee info.
     */
    public function getStatus(): JsonResponse
    {
        $userId = $this->requireAuth();
        $tenantId = $this->getTenantId();

        // Check if user already has id_verified badge
        $badges = $this->badgeService->getUserBadges($userId);
        $hasIdBadge = collect($badges)->contains(fn($b) => $b['badge_type'] === 'id_verified');

        // Check user's DOB
        $user = DB::table('users')
            ->where('id', $userId)
            ->where('tenant_id', $tenantId)
            ->first(['date_of_birth']);
        $hasDob = !empty($user->date_of_birth);

        // Fee info
        $feeCents = IdentityVerificationPaymentService::getFeeCents($tenantId);
        $paymentCompleted = ($feeCents > 0)
            ? IdentityVerificationPaymentService::hasCompletedPayment($tenantId, $userId)
            : true; // No fee = considered paid

        // If payment is pending, check Stripe directly (webhook may be delayed)
        if (!$paymentCompleted && $feeCents > 0) {
            $pendingSession = DB::selectOne(
                "SELECT id, stripe_payment_intent_id FROM identity_verification_sessions
                 WHERE tenant_id = ? AND user_id = ? AND payment_status = 'pending' AND stripe_payment_intent_id IS NOT NULL
                 ORDER BY id DESC LIMIT 1",
                [$tenantId, $userId]
            );
            if ($pendingSession && $pendingSession->stripe_payment_intent_id) {
                try {
                    $client = \App\Services\StripeService::client();
                    $pi = $client->paymentIntents->retrieve($pendingSession->stripe_payment_intent_id);
                    if ($pi->status === 'succeeded') {
                        IdentityVerificationSessionService::updatePaymentStatus((int) $pendingSession->id, 'completed');
                        $paymentCompleted = true;
                    }
                } catch (\Throwable $e) {
                    Log::warning('Stripe payment status check failed', ['error' => $e->getMessage()]);
                }
            }
        }

        // Check for any active verification session
        $latestSession = IdentityVerificationSessionService::getLatestForUser($tenantId, $userId);

        // If there's an active session, poll Stripe directly (webhook may be delayed)
        if ($latestSession && in_array($latestSession['status'], ['created', 'started', 'processing'], true)) {
            $providerSessionId = $latestSession['provider_session_id'] ?? null;
            if ($providerSessionId) {
                try {
                    $provider = IdentityProviderRegistry::get('stripe_identity');
                    $stripeStatus = $provider->getSessionStatus($providerSessionId);
                    $mappedStatus = $stripeStatus['status'] ?? null;

                    if ($mappedStatus === 'passed' && $latestSession['status'] !== 'passed') {
                        // Verify name and DOB match the user's profile
                        $mismatch = self::checkNameDobMismatch($userId, $tenantId, $stripeStatus);

                        if ($mismatch) {
                            // Document verified but details don't match profile
                            IdentityVerificationSessionService::updateStatus(
                                (int) $latestSession['id'], 'failed', null, null, $mismatch
                            );
                            $latestSession['status'] = 'failed';
                            $latestSession['failure_reason'] = $mismatch;

                            try {
                                NotificationDispatcher::dispatchVerificationFailed($userId, $mismatch);
                                NotificationDispatcher::dispatchVerificationCompletedToAdmins($userId, 'failed');
                            } catch (\Throwable $e) {
                                Log::warning('[IdentityVerification] mismatch notification failed: ' . $e->getMessage());
                            }
                        } else {
                            IdentityVerificationSessionService::updateStatus(
                                (int) $latestSession['id'], 'passed', null, null, null
                            );
                            $latestSession['status'] = 'passed';

                            if (!$hasIdBadge) {
                                self::grantIdVerifiedBadge($userId, $tenantId);
                                $hasIdBadge = true;
                            }

                            try {
                                NotificationDispatcher::dispatchVerificationPassed($userId);
                                NotificationDispatcher::dispatchVerificationCompletedToAdmins($userId, 'passed');
                            } catch (\Throwable $e) {
                                Log::warning('[IdentityVerification] passed notification failed: ' . $e->getMessage());
                            }
                        }
                    } elseif ($mappedStatus === 'failed') {
                        $failureReason = $stripeStatus['failure_reason'] ?? 'Verification failed';
                        IdentityVerificationSessionService::updateStatus(
                            (int) $latestSession['id'], 'failed', null, null,
                            $failureReason
                        );
                        $latestSession['status'] = 'failed';
                        $latestSession['failure_reason'] = $failureReason;

                        try {
                            NotificationDispatcher::dispatchVerificationFailed($userId, $failureReason);
                            NotificationDispatcher::dispatchVerificationCompletedToAdmins($userId, 'failed');
                        } catch (\Throwable $e) {
                            Log::warning('[IdentityVerification] failed notification failed: ' . $e->getMessage());
                        }
                    }
                } catch (\Throwable $e) {
                    Log::warning('Stripe Identity status check failed', ['error' => $e->getMessage()]);
                }
            }
        }

        return $this->respondWithData([
            'has_id_verified_badge' => $hasIdBadge,
            'user_has_dob' => $hasDob,
            'fee_cents' => $feeCents,
            'fee_currency' => 'eur',
            'payment_completed' => $paymentCompleted,
            'verification_status' => $latestSession ? $latestSession['status'] : null,
            'latest_session' => $latestSession ? [
                'id' => $latestSession['id'],
                'status' => $latestSession['status'],
                'provider' => $latestSession['provider_slug'] ?? null,
                'created_at' => $latestSession['created_at'],
                'failure_reason' => $latestSession['failure_reason'] ?? null,
            ] : null,
        ]);
    }

    /**
     * POST /api/v2/identity/save-dob
     *
     * Save user's date of birth (required before identity verification).
     */
    public function saveDob(): JsonResponse
    {
        $userId = $this->requireAuth();
        $tenantId = $this->getTenantId();

        if ($disabled = $this->guardFeatureEnabled()) {
            return $disabled;
        }

        // If already verified, DOB is locked
        $badges = $this->badgeService->getUserBadges($userId);
        $hasIdBadge = collect($badges)->contains(fn($b) => $b['badge_type'] === 'id_verified');
        if ($hasIdBadge) {
            return $this->respondWithError('FORBIDDEN', __('api_controllers_2.identity.dob_locked'), null, 403);
        }

        $input = $this->getAllInput();
        $dobRaw = $input['date_of_birth'] ?? '';

        if (empty($dobRaw)) {
            return $this->respondWithError('VALIDATION_REQUIRED_FIELD', __('api_controllers_2.identity.dob_required'), 'date_of_birth', 422);
        }

        $dob = date('Y-m-d', strtotime($dobRaw));
        if (!$dob || $dob === '1970-01-01') {
            return $this->respondWithError('VALIDATION_INVALID_FORMAT', __('api_controllers_2.identity.dob_invalid'), 'date_of_birth', 422);
        }

        // Must be in the past
        if (strtotime($dob) >= time()) {
            return $this->respondWithError('VALIDATION_INVALID_FORMAT', __('api_controllers_2.identity.dob_must_be_past'), 'date_of_birth', 422);
        }

        // Must be at least 16 years old
        $age = (int) date_diff(date_create($dob), date_create('today'))->y;
        if ($age < 16) {
            return $this->respondWithError('VALIDATION_INVALID_FORMAT', __('api_controllers_2.identity.must_be_16'), 'date_of_birth', 422);
        }

        DB::table('users')
            ->where('id', $userId)
            ->where('tenant_id', $tenantId)
            ->update(['date_of_birth' => $dob]);

        return $this->respondWithData([
            'success' => true,
            'date_of_birth' => $dob,
        ]);
    }

    /**
     * POST /api/v2/identity/create-payment
     *
     * Create a Stripe PaymentIntent for the identity verification fee.
     */
    public function createPaymentIntent(): JsonResponse
    {
        $userId = $this->requireAuth();
        $tenantId = $this->getTenantId();

        if ($disabled = $this->guardFeatureEnabled()) {
            return $disabled;
        }

        $feeCents = IdentityVerificationPaymentService::getFeeCents($tenantId);

        if ($feeCents <= 0) {
            return $this->respondWithData(['payment_required' => false, 'message' => __('api_controllers_2.identity.no_fee_required')]);
        }

        // Check if already paid
        if (IdentityVerificationPaymentService::hasCompletedPayment($tenantId, $userId)) {
            return $this->respondWithData(['payment_required' => false, 'already_paid' => true]);
        }

        try {
            $result = IdentityVerificationPaymentService::createPaymentIntent($userId, $tenantId, $feeCents);

            // Record payment in a session row (not an active verification session)
            DB::statement(
                "INSERT INTO identity_verification_sessions
                    (tenant_id, user_id, provider_slug, verification_level, status,
                     stripe_payment_intent_id, verification_fee_amount, payment_status)
                 VALUES (?, ?, 'stripe_identity', 'document_selfie', 'cancelled',
                         ?, ?, 'pending')",
                [$tenantId, $userId, $result['payment_intent_id'], $feeCents]
            );
            $sessionId = (int) DB::getPdo()->lastInsertId();

            return $this->respondWithData([
                'client_secret' => $result['client_secret'],
                'publishable_key' => (string) config('services.stripe.publishable', env('STRIPE_PUBLISHABLE_KEY', '')),
                'fee_cents' => $feeCents,
                'fee_currency' => 'eur',
            ]);
        } catch (\Throwable $e) {
            Log::error('Failed to create verification payment', ['user' => $userId, 'error' => $e->getMessage()]);
            return $this->respondWithError('SERVER_INTERNAL_ERROR', __('api_controllers_2.identity.payment_failed'), null, 503);
        }
    }

    /**
     * POST /api/v2/identity/start
     *
     * Start Stripe Identity verification. Requires DOB and payment (if fee > 0).
     */
    public function startVerification(): JsonResponse
    {
        $userId = $this->requireAuth();
        $tenantId = $this->getTenantId();

        if ($disabled = $this->guardFeatureEnabled()) {
            return $disabled;
        }

        $this->rateLimit("optional_verify_{$userId}", 20, 3600);

        // Check if already verified
        $badges = $this->badgeService->getUserBadges($userId);
        $hasIdBadge = collect($badges)->contains(fn($b) => $b['badge_type'] === 'id_verified');
        if ($hasIdBadge) {
            return $this->respondWithData(['already_verified' => true]);
        }

        // Get user with DOB
        $user = DB::table('users')
            ->where('id', $userId)
            ->where('tenant_id', $tenantId)
            ->first(['id', 'first_name', 'last_name', 'profile_type', 'organization_name', 'date_of_birth']);

        if (!$user) {
            return $this->respondWithError('RESOURCE_NOT_FOUND', __('api_controllers_2.identity.user_not_found'), null, 404);
        }

        // Prerequisite: DOB must exist
        if (empty($user->date_of_birth)) {
            return $this->respondWithError('DOB_REQUIRED', __('api_controllers_2.identity.provide_dob_first'), null, 422);
        }

        // Prerequisite: Payment must be completed (if fee > 0)
        $feeCents = IdentityVerificationPaymentService::getFeeCents($tenantId);
        if ($feeCents > 0 && !IdentityVerificationPaymentService::hasCompletedPayment($tenantId, $userId)) {
            return $this->respondWithError('PAYMENT_REQUIRED', __('api_controllers_2.identity.complete_payment_first'), null, 422);
        }

        // Use Stripe Identity provider
        $providerSlug = 'stripe_identity';
        if (!IdentityProviderRegistry::has($providerSlug)) {
            return $this->respondWithError('SERVICE_UNAVAILABLE', __('api_controllers_2.identity.not_available'), null, 503);
        }

        $provider = IdentityProviderRegistry::get($providerSlug);
        if (!$provider->isAvailable($tenantId)) {
            return $this->respondWithError('SERVICE_UNAVAILABLE', __('api_controllers_2.identity.not_available'), null, 503);
        }

        // Load credentials + pass user email to Stripe (only email/phone accepted)
        // Name/DOB matching happens AFTER verification via verified_outputs comparison
        $providerConfig = TenantProviderCredentialService::get($tenantId, $providerSlug) ?? [];

        $userEmail = DB::table('users')->where('id', $userId)->where('tenant_id', $tenantId)->value('email');
        if ($userEmail) {
            $providerConfig['provided_details'] = ['email' => $userEmail];
        }

        try {
            $providerData = $provider->createSession($userId, $tenantId, 'document_selfie', $providerConfig);

            $sessionId = IdentityVerificationSessionService::create(
                $tenantId, $userId, $providerSlug, 'document_selfie', $providerData
            );

            // If there was a payment, mark the session as paid
            if ($feeCents > 0) {
                // Find the payment session and copy its payment status
                $paymentSession = DB::selectOne(
                    "SELECT stripe_payment_intent_id FROM identity_verification_sessions
                     WHERE tenant_id = ? AND user_id = ? AND payment_status = 'completed'
                     ORDER BY id DESC LIMIT 1",
                    [$tenantId, $userId]
                );
                if ($paymentSession) {
                    IdentityVerificationSessionService::updatePaymentStatus(
                        $sessionId, 'completed', $paymentSession->stripe_payment_intent_id
                    );
                    DB::statement(
                        "UPDATE identity_verification_sessions SET verification_fee_amount = ? WHERE id = ?",
                        [$feeCents, $sessionId]
                    );
                }
            }

            IdentityVerificationEventService::log(
                $tenantId, $userId,
                IdentityVerificationEventService::EVENT_VERIFICATION_CREATED,
                $sessionId, null,
                IdentityVerificationEventService::ACTOR_USER,
                ['provider' => $providerSlug, 'level' => 'document_selfie', 'flow' => 'optional']
            );

            // Send "verification started" instructions email
            try {
                NotificationDispatcher::dispatchVerificationStarted($userId);
            } catch (\Throwable $e) {
                Log::warning('[IdentityVerification] started email failed: ' . $e->getMessage());
            }

            return $this->respondWithData([
                'session_id' => $sessionId,
                'redirect_url' => $providerData['redirect_url'] ?? null,
                'client_token' => $providerData['client_token'] ?? null,
                'provider' => $providerSlug,
                'expires_at' => $providerData['expires_at'] ?? null,
                'status' => 'created',
            ]);
        } catch (\Throwable $e) {
            Log::error('Identity verification failed to start', ['user' => $userId, 'error' => $e->getMessage()]);
            return $this->respondWithError('SERVER_INTERNAL_ERROR', __('api_controllers_2.identity.start_failed'), null, 503);
        }
    }

    /**
     * Auto-grant the id_verified badge when verification passes.
     */
    public static function grantIdVerifiedBadge(int $userId, int $tenantId): void
    {
        $badgeService = app(MemberVerificationBadgeService::class);

        if (TenantContext::getId() !== $tenantId) {
            TenantContext::set($tenantId);
        }

        $badgeService->grantBadge(
            $userId, 'id_verified', $userId,
            'Automatically granted via Stripe Identity verification',
            null
        );

        Log::info("ID Verified badge granted to user {$userId} in tenant {$tenantId}");
    }

    /**
     * Compare Stripe's verified_outputs (name/DOB from document) against the user's profile.
     * Returns a mismatch reason string, or null if everything matches.
     *
     * Public + the single source of truth for the name/DOB gate so the webhook,
     * poll, and cron verification paths can't drift (H4) — a passed document must
     * never grant the ID-Verified badge if the identity doesn't match the profile.
     */
    public static function checkNameDobMismatch(int $userId, int $tenantId, array $stripeStatus): ?string
    {
        $user = DB::table('users')
            ->where('id', $userId)
            ->where('tenant_id', $tenantId)
            ->first(['first_name', 'last_name', 'profile_type', 'organization_name', 'date_of_birth']);

        if (!$user) {
            return null; // Can't check — allow through
        }

        $mismatches = [];

        // Compare first name. A document's first-name field carries the FULL
        // given names ("SARAH JANE"), while a profile usually stores only the
        // first ("Sarah") - Stripe Identity has no separate middle-name field.
        // Match tolerantly (extra given/middle names and honorifics allowed on
        // either side) instead of demanding exact string equality, which
        // rejected every member whose ID lists a middle name. See namesMatch().
        $docFirstName = $stripeStatus['verified_first_name'] ?? null;
        if (self::namesMatch($docFirstName, $user->first_name) === false) {
            $mismatches[] = 'first name';
        }

        // Compare last name (same tolerant match - also covers hyphenated /
        // multi-part surnames and a provider mis-splitting a middle name into
        // the last-name field).
        $docLastName = $stripeStatus['verified_last_name'] ?? null;
        if (self::namesMatch($docLastName, $user->last_name) === false) {
            $mismatches[] = 'last name';
        }

        // Compare DOB
        $docDob = $stripeStatus['verified_dob'] ?? null;
        if ($docDob && $user->date_of_birth) {
            // Stripe returns DOB as { year, month, day }
            if (is_array($docDob)) {
                $docDobStr = sprintf('%04d-%02d-%02d', $docDob['year'] ?? 0, $docDob['month'] ?? 0, $docDob['day'] ?? 0);
            } else {
                $docDobStr = (string) $docDob;
            }
            $userDobStr = date('Y-m-d', strtotime($user->date_of_birth));

            if ($docDobStr !== $userDobStr) {
                $mismatches[] = 'date of birth';
            }
        }

        if (!empty($mismatches)) {
            $fields = implode(' and ', $mismatches);
            Log::warning("Identity verification name/DOB mismatch for user {$userId}", [
                'mismatched_fields' => $mismatches,
                'doc_first_name' => $docFirstName,
                'doc_last_name' => $docLastName,
                'profile_first_name' => $user->first_name,
                'profile_last_name' => $user->last_name,
            ]);
            return "The {$fields} on your ID document does not match your profile. Please update your profile details and try again.";
        }

        return null; // All matches
    }

    /**
     * Normalise a name into lowercase, accent-folded word tokens for tolerant
     * matching. Leading honorifics (Mr/Mrs/Ms/Miss/...) are dropped and every
     * non-letter (hyphen, apostrophe, dot) is treated as a word separator, so
     * "Mrs Sarah-Jane O'Brien" becomes ['sarah', 'jane', 'o', 'brien'].
     *
     * @return list<string> Ordered name tokens (possibly empty for non-Latin scripts).
     */
    private static function normaliseNameTokens(?string $name): array
    {
        if ($name === null) {
            return [];
        }

        // Lowercase (multibyte-safe), then fold common Latin diacritics so
        // "Jose" matches "Jose\u{0301}" and "Muller" matches "Mu\u{0308}ller".
        // Keys use \u escapes to keep this source ASCII-only.
        $lower = mb_strtolower(trim($name), 'UTF-8');
        $lower = strtr($lower, [
            "\u{00E1}" => 'a', "\u{00E0}" => 'a', "\u{00E2}" => 'a', "\u{00E4}" => 'a', "\u{00E3}" => 'a', "\u{00E5}" => 'a', "\u{0101}" => 'a',
            "\u{00E9}" => 'e', "\u{00E8}" => 'e', "\u{00EA}" => 'e', "\u{00EB}" => 'e', "\u{0113}" => 'e',
            "\u{00ED}" => 'i', "\u{00EC}" => 'i', "\u{00EE}" => 'i', "\u{00EF}" => 'i', "\u{012B}" => 'i',
            "\u{00F3}" => 'o', "\u{00F2}" => 'o', "\u{00F4}" => 'o', "\u{00F6}" => 'o', "\u{00F5}" => 'o', "\u{00F8}" => 'o', "\u{014D}" => 'o',
            "\u{00FA}" => 'u', "\u{00F9}" => 'u', "\u{00FB}" => 'u', "\u{00FC}" => 'u', "\u{016B}" => 'u',
            "\u{00F1}" => 'n', "\u{00E7}" => 'c', "\u{00DF}" => 'ss', "\u{00FD}" => 'y', "\u{00FF}" => 'y',
        ]);

        // Any non-letter becomes a separator; collapse to single-space tokens.
        $lower = preg_replace('/[^a-z]+/', ' ', $lower) ?? '';
        $tokens = array_values(array_filter(
            explode(' ', trim($lower)),
            static fn (string $t): bool => $t !== ''
        ));

        // Drop leading honorific titles ("mrs sarah jane" -> "sarah jane").
        static $titles = [
            'mr', 'mrs', 'ms', 'miss', 'mx', 'dr', 'prof',
            'sir', 'dame', 'lady', 'lord', 'rev', 'fr', 'mstr',
        ];
        while (isset($tokens[0]) && in_array($tokens[0], $titles, true)) {
            array_shift($tokens);
        }

        return array_values($tokens);
    }

    /**
     * Tolerant identity name match. Returns true when the document and profile
     * names plausibly refer to the same person (allowing extra given/middle
     * names or an honorific on either side), false on a genuine mismatch, and
     * null when either side is empty - the caller treats null as "no mismatch",
     * preserving the pre-existing skip-when-absent behaviour.
     *
     * The match succeeds when one side's token set is fully contained in the
     * other's (order-independent). It deliberately does NOT fuzzy-match typos or
     * alternative spellings - only additional or omitted name parts are
     * tolerated, so a genuinely different name (e.g. "Mallory" vs "Alice") still
     * fails. For non-Latin scripts that tokenise to nothing it falls back to the
     * original strict case-insensitive comparison rather than skipping the gate.
     */
    private static function namesMatch(?string $docName, ?string $profileName): ?bool
    {
        $docRaw     = $docName !== null ? trim($docName) : '';
        $profileRaw = $profileName !== null ? trim($profileName) : '';

        if ($docRaw === '' || $profileRaw === '') {
            return null; // Missing on one side - cannot compare.
        }

        $doc     = self::normaliseNameTokens($docName);
        $profile = self::normaliseNameTokens($profileName);

        // Untokenisable (e.g. non-Latin) on either side: fall back to a strict
        // case-insensitive comparison of the raw values rather than skipping.
        if (empty($doc) || empty($profile)) {
            return mb_strtolower($docRaw, 'UTF-8') === mb_strtolower($profileRaw, 'UTF-8');
        }

        if ($doc === $profile) {
            return true;
        }

        $docSet     = array_values(array_unique($doc));
        $profileSet = array_values(array_unique($profile));

        // profile subset of doc -> document carries extra given/middle names.
        // doc subset of profile -> profile carries extra names the document omits.
        $profileInDoc = array_diff($profileSet, $docSet) === [];
        $docInProfile = array_diff($docSet, $profileSet) === [];

        return $profileInDoc || $docInProfile;
    }
}
