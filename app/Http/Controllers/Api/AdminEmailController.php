<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

namespace App\Http\Controllers\Api;

use Illuminate\Http\JsonResponse;
use Illuminate\Support\Facades\DB;
use App\Core\Mailer;
use App\Core\TenantContext;
use App\Services\EmailDispatchService;
use App\Models\EmailSettings;
use App\Services\EmailMonitorService;
use App\Services\RedisCache;
use App\Support\OutboundUrlGuard;

/**
 * AdminEmailController -- Email settings, provider config, test emails, and deliverability status.
 *
 * All methods require admin authentication.
 * Email-sending methods delegate to legacy for Mailer integration.
 */
class AdminEmailController extends BaseApiController
{
    protected bool $isV2Api = true;

    public function __construct(
        private readonly EmailMonitorService $emailMonitorService,
        private readonly RedisCache $redisCache,
    ) {}

    // =========================================================================
    // Settings
    // =========================================================================

    /** GET /api/v2/admin/email/settings */
    public function getSettings(): JsonResponse
    {
        $this->requireAdmin();
        $tenantId = $this->getTenantId();

        $settings = DB::select(
            "SELECT setting_key, setting_value FROM tenant_settings WHERE tenant_id = ? AND setting_key LIKE 'email_%'",
            [$tenantId]
        );

        $result = [];
        foreach ($settings as $s) {
            $result[$s->setting_key] = $s->setting_value;
        }

        return $this->respondWithData($result);
    }

    /** PUT /api/v2/admin/email/settings */
    public function updateSettings(): JsonResponse
    {
        $this->requireAdmin();
        $tenantId = $this->getTenantId();
        $data = $this->getAllInput();

        $allowed = ['email_from_name', 'email_from_address', 'email_reply_to', 'email_footer_text'];
        $updated = 0;

        foreach ($data as $key => $value) {
            if (!in_array($key, $allowed, true)) continue;
            DB::statement(
                'INSERT INTO tenant_settings (tenant_id, setting_key, setting_value) VALUES (?, ?, ?) ON DUPLICATE KEY UPDATE setting_value = VALUES(setting_value)',
                [$tenantId, $key, $value]
            );
            $updated++;
        }

        return $this->respondWithData(['updated' => $updated]);
    }

    // =========================================================================
    // Status & Config
    // =========================================================================

    /** GET /api/v2/admin/email/status */
    public function status(): JsonResponse
    {
        $this->requireAdmin();
        $tenantId = TenantContext::getId();
        $mailer = Mailer::forCurrentTenant();
        $providerType = $mailer->getProviderType();

        $response = [
            'provider' => $providerType,
            'health' => $this->emailMonitorService->getHealthSummary($tenantId),
            'redis' => $this->redisCache->getStats(),
        ];

        if ($providerType === 'gmail_api') {
            $circuitBreakerExpiry = $this->redisCache->get('gmail_oauth_circuit_breaker', null);
            $refreshAttempts = (int) $this->redisCache->get('gmail_oauth_refresh_attempts', null);
            $failureCount = (int) $this->redisCache->get('gmail_oauth_failure_count', null);
            $tokenExpiry = $this->redisCache->get('gmail_oauth_token_expiry', null);

            $response['gmail_api'] = [
                'token_cached' => $tokenExpiry !== null && $tokenExpiry > time(),
                'token_expires_in' => $tokenExpiry ? max(0, $tokenExpiry - time()) : null,
                'circuit_breaker_open' => $circuitBreakerExpiry && time() < $circuitBreakerExpiry,
                'circuit_breaker_expires_in' => $circuitBreakerExpiry ? max(0, $circuitBreakerExpiry - time()) : null,
                'refresh_attempts_this_hour' => $refreshAttempts,
                'failure_count' => $failureCount,
            ];
        }

        return $this->respondWithData($response);
    }

    /** GET /api/v2/admin/email/config */
    public function getConfig(): JsonResponse
    {
        $this->requireAdmin();
        $tenantId = TenantContext::getId();

        $settings = EmailSettings::getAllForTenant($tenantId);
        $platformMailer = new Mailer();
        $platformProvider = $platformMailer->getProviderType();

        $response = [
            'provider' => $settings['email_provider'] ?? 'platform_default',
            'smtp' => [
                'host' => $settings['smtp_host'] ?? '',
                'port' => $settings['smtp_port'] ?? '587',
                'user' => $settings['smtp_user'] ?? '',
                'password_set' => EmailSettings::has($tenantId, 'smtp_password'),
                'encryption' => $settings['smtp_encryption'] ?? 'tls',
                'from_email' => $settings['smtp_from_email'] ?? '',
                'from_name' => $settings['smtp_from_name'] ?? '',
            ],
            'gmail_api' => [
                'client_id' => $settings['gmail_client_id'] ?? '',
                'client_secret_set' => EmailSettings::has($tenantId, 'gmail_client_secret'),
                'refresh_token_set' => EmailSettings::has($tenantId, 'gmail_refresh_token'),
                'sender_email' => $settings['gmail_sender_email'] ?? '',
                'sender_name' => $settings['gmail_sender_name'] ?? '',
            ],
            'platform_default' => [
                'provider' => $platformProvider,
                'description_code' => 'platform_environment_configuration',
            ],
            'webhook_url' => rtrim($_ENV['APP_URL'] ?? 'https://api.project-nexus.ie', '/') . '/api/v2/webhooks/postmark',
        ];

        return $this->respondWithData($response);
    }

    /** PUT /api/v2/admin/email/config */
    public function updateConfig(): JsonResponse
    {
        $this->requireAdmin();
        $tenantId = TenantContext::getId();
        $input = $this->getAllInput();

        // Accept 'provider' as alias for 'email_provider'
        if (isset($input['provider']) && !isset($input['email_provider'])) {
            $input['email_provider'] = $input['provider'];
            unset($input['provider']);
        }

        if (isset($input['email_provider'])) {
            $validProviders = ['platform_default', 'gmail_api', 'smtp'];
            if (!in_array($input['email_provider'], $validProviders, true)) {
                return $this->respondWithError('VALIDATION_ERROR', __('api.invalid_email_provider'), null, 422);
            }
        }

        $allowedKeys = [
            'email_provider',
            'smtp_host', 'smtp_port', 'smtp_user', 'smtp_password', 'smtp_encryption', 'smtp_from_email', 'smtp_from_name',
            'gmail_client_id', 'gmail_client_secret', 'gmail_refresh_token', 'gmail_sender_email', 'gmail_sender_name',
        ];

        $toSave = [];
        foreach ($input as $key => $value) {
            if (!in_array($key, $allowedKeys, true)) continue;
            if (is_string($value) && preg_match('/^\*+.{0,4}$/', $value)) continue;
            $toSave[$key] = $value === null ? null : (string) $value;
        }

        if (empty($toSave)) {
            return $this->respondWithError('VALIDATION_ERROR', __('api.no_valid_settings'), null, 422);
        }

        // F-062: a community's SMTP server must be a public mail host. Refuse a
        // host that is, or resolves to, a private, loopback, link-local or
        // reserved address so the platform cannot be used to probe its own
        // network. Mailer re-checks (and pins the address) at connect time.
        if (isset($toSave['smtp_host']) && trim($toSave['smtp_host']) !== '') {
            $toSave['smtp_host'] = trim($toSave['smtp_host']);
            if (OutboundUrlGuard::publicAddressesForHost($toSave['smtp_host']) === []) {
                return $this->respondWithError('VALIDATION_ERROR', __('api.smtp_host_not_allowed'), 'smtp_host', 422);
            }
        }

        EmailSettings::setMultiple($tenantId, $toSave);

        return $this->respondWithData(['success' => true, 'saved_keys' => array_keys($toSave)]);
    }

    // =========================================================================
    // Test Emails
    // =========================================================================

    /** POST /api/v2/admin/email/test */
    public function test(): JsonResponse
    {
        $this->requireAdmin();
        $tenantId = TenantContext::getId();
        $to = $this->input('to', '');

        if (empty($to) || !filter_var($to, FILTER_VALIDATE_EMAIL)) {
            return $this->respondWithError('VALIDATION_ERROR', __('api.valid_email_address_required'), 'to', 400);
        }

        // Use forCurrentTenant() so the test respects the admin's tenant
        // email_settings (matches testProvider() below). The previous
        // `new Mailer()` ignored per-tenant overrides and only loaded the
        // platform .env — fine for platform admins, misleading for tenant
        // admins on tenants with their own SMTP config.
        $mailer = Mailer::forCurrentTenant();
        $provider = $mailer->getProviderType();

        $result = EmailDispatchService::sendRaw(
            $to,
            __('api_controllers_2.email_test.subject'),
            '<h2>' . __('api_controllers_2.email_test.heading') . '</h2>' .
            '<p>' . __('api_controllers_2.email_test.body_provider', ['provider' => strtoupper($provider), 'time' => date('Y-m-d H:i:s')]) . '</p>' .
            '<p>' . __('api_controllers_2.email_test.body_success') . '</p>',
            null,
            null,
            null,
            'email_test',
            ['tenant_id' => $tenantId]
        );

        if ($result) {
            return $this->respondWithData(['success' => true, 'provider' => $provider, 'to' => $to]);
        }

        return $this->respondWithError('SERVER_ERROR', __('api.failed_send_test_email'), null, 500);
    }

    /** POST /api/v2/admin/email/test (v1 wrapper) */
    public function testEmail(): JsonResponse
    {
        return $this->test();
    }

    /** POST /api/v2/admin/email/test-gmail */
    public function testGmail(): JsonResponse
    {
        $this->requireAdmin();
        $result = Mailer::testGmailConnection();
        return $this->respondWithData($result);
    }

    /** POST /api/v2/admin/email/test-provider */
    public function testProvider(): JsonResponse
    {
        $this->requireAdmin();
        $tenantId = TenantContext::getId();
        $to = $this->input('to', '');

        if (empty($to) || !filter_var($to, FILTER_VALIDATE_EMAIL)) {
            return $this->respondWithError('VALIDATION_ERROR', __('api.valid_email_address_required'), 'to', 400);
        }

        $mailer = Mailer::forCurrentTenant();
        $provider = $mailer->getProviderType();

        $result = EmailDispatchService::sendRaw(
            $to,
            __('api_controllers_2.email_test.provider_subject'),
            '<h2>' . __('api_controllers_2.email_test.provider_heading') . '</h2>' .
            '<p>' . __('api_controllers_2.email_test.body_provider', ['provider' => htmlspecialchars(strtoupper($provider)), 'time' => date('Y-m-d H:i:s')]) . '</p>' .
            '<p>' . __('api_controllers_2.email_test.body_tenant_ok') . '</p>',
            null,
            null,
            null,
            'email_test',
            ['tenant_id' => $tenantId]
        );

        if ($result) {
            return $this->respondWithData(['success' => true, 'provider' => $provider, 'to' => $to]);
        }

        return $this->respondWithError('SERVER_ERROR', __('api.failed_send_test_via', ['provider' => $provider]), null, 500);
    }
}
