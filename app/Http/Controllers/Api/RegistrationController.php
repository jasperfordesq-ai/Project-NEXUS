<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

namespace App\Http\Controllers\Api;

use App\Services\RegistrationService;
use Illuminate\Http\JsonResponse;

/**
 * RegistrationController — User registration, email verification.
 */
class RegistrationController extends BaseApiController
{
    protected bool $isV2Api = true;

    public function __construct(
        private readonly RegistrationService $registrationService,
    ) {}

    /**
     * POST /api/v2/register
     *
     * Register a new user account.
     * Body: name, email, password, password_confirmation, phone.
     */
    public function register(): JsonResponse
    {
        $this->rateLimit('registration', 3, 300);

        $data = $this->getAllInput();
        $tenantId = $this->getTenantId();

        // Bot honeypot — normalise both `website` (Blade-style) and
        // `honeypot` (explicit) into the same key the service checks.
        // A non-empty value silently 200s without creating a user.
        $data['honeypot'] = $data['honeypot'] ?? $data['website'] ?? null;

        // Cloudflare Turnstile token. Accept both the form field name
        // (`cf-turnstile-response`) and a JSON-friendly variant.
        $data['turnstile_token'] = $data['turnstile_token']
            ?? $data['cf-turnstile-response']
            ?? $data['cfTurnstileResponse']
            ?? null;

        $result = $this->registrationService->register($data, $tenantId);

        if (isset($result['error'])) {
            $status = (int) ($result['status'] ?? 422);

            // A validation failure carries EVERY failed input, each naming the
            // field it belongs to. Passing `null` as the field here is what
            // left the app with one unattributed banner across an eight-input
            // form; the service now supplies the list and the first entry
            // keeps the code the single-error response used to carry, so
            // clients reading errors[0] see no change.
            if (!empty($result['errors']) && is_array($result['errors'])) {
                return $this->respondWithErrors($result['errors'], $status);
            }

            // Surface specific failure codes from the service so the frontend
            // can distinguish Turnstile failures, validation errors, duplicate
            // accounts, and pwned-password rejections — instead of one
            // catch-all REGISTRATION_FAILED message.
            return $this->respondWithError(
                $result['code'] ?? 'REGISTRATION_FAILED',
                $result['error'],
                isset($result['field']) ? (string) $result['field'] : null,
                $status
            );
        }

        return $this->respondWithData($result, null, 201);
    }

    /**
     * POST /api/v2/register/verify
     *
     * Verify an email address using a verification token.
     * Body: token (required).
     */
    public function verify(): JsonResponse
    {
        $token = $this->requireInput('token');

        $result = $this->registrationService->verifyEmail($token);

        if (!$result) {
            return $this->respondWithError('VERIFICATION_FAILED', __('api.invalid_verification_token'), null, 400);
        }

        return $this->respondWithData(['message' => __('api_controllers_2.registration.email_verified')]);
    }

    /**
     * POST /api/v2/register/resend-verification
     *
     * Resend the verification email.
     * Body: email (required).
     */
    public function resendVerification(): JsonResponse
    {
        $this->rateLimit('resend_verification', 2, 300);

        $email = $this->requireInput('email');

        $this->registrationService->resendVerification($email, $this->getTenantId());

        return $this->respondWithData(['message' => __('api_controllers_2.registration.verification_sent')]);
    }
}
