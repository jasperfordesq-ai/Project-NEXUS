<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

namespace App\Core;

use App\Models\EmailSettings;
use Illuminate\Support\Facades\Cache;

/**
 * Email sending with multi-provider support (SMTP, Gmail API, Postmark).
 */
class Mailer
{
    private $host;
    private $port;
    private $username;
    private $password;
    private $encryption;
    private $fromEmail;
    private $fromName;
    private $socket;

    /**
     * Seconds to wait for the SMTP host — for the initial connect AND for each
     * reply once connected.
     *
     * This matters more than it looks: these emails are sent SYNCHRONOUSLY
     * inside member-facing write requests (creating a listing, for one), so a
     * mail server that is slow or silent delays, and can outright fail, an
     * action the member has already completed. Measured 2026-08-24: with an
     * unreachable host, creating a listing took 9.6s and the accessible
     * frontend gave up at its 15s budget and showed a failure — for a listing
     * that HAD been created.
     *
     * Tune with SMTP_TIMEOUT; `config/mail.php` holds the default.
     */
    private $timeout = 5;

    // Gmail API settings
    private $useGmailApi;
    private $gmailClientId;
    private $gmailClientSecret;
    private $gmailRefreshToken;

    /**
     * Most recent provider message id (Postmark MessageID). Captured inside
     * sendViaPostmark() on success and read by send() so the email_log row
     * records the id — the Postmark webhook later updates the same row when
     * it reports delivery / bounce / open.
     */
    private ?string $lastMessageId = null;

    // Driver: 'smtp', 'gmail_api', or 'postmark'
    private string $driver = 'smtp';

    // Tenant context
    private ?int $tenantId = null;

    // -------------------------------------------------------------------------
    // Email category constants — used as From-address prefixes on the verified
    // project-nexus.net sending domain (e.g. notifications@project-nexus.net),
    // via Postmark. These match the audit category strings from EmailDispatchService.
    // -------------------------------------------------------------------------
    public const CATEGORY_NOTIFICATIONS = 'notifications';
    public const CATEGORY_NEWSLETTERS   = 'newsletters';
    public const CATEGORY_MESSAGES      = 'messages';
    public const CATEGORY_NOREPLY       = 'noreply';
    public const CATEGORY_ADMIN         = 'admin';
    public const CATEGORY_EVENTS        = 'events';
    public const CATEGORY_SAFEGUARDING  = 'safeguarding';
    public const CATEGORY_BILLING       = 'billing';

    /** Optional platform Reply-To (Postmark). */
    private ?string $platformReplyTo = null;

    // -------------------------------------------------------------------------
    // Postmark settings (custom Email API path; active when the platform
    // provider is 'postmark'). Postmark separates transactional and bulk mail
    // into independent message streams, each with its own IP reputation.
    // -------------------------------------------------------------------------
    private ?string $postmarkToken = null;
    private bool $isPlatformPostmark = false;
    private string $postmarkFromDomain = 'project-nexus.net';
    private string $postmarkStreamTransactional = 'outbound';
    private string $postmarkStreamBroadcast = 'broadcast';

    // Redis cache key suffixes (tenant-scoped via cacheKey())
    private const CACHE_KEY_ACCESS_TOKEN = 'gmail_oauth_access_token';
    private const CACHE_KEY_TOKEN_EXPIRY = 'gmail_oauth_token_expiry';
    private const CACHE_KEY_REFRESH_ATTEMPTS = 'gmail_oauth_refresh_attempts';
    private const CACHE_KEY_CIRCUIT_BREAKER = 'gmail_oauth_circuit_breaker';
    private const CACHE_KEY_FAILURE_COUNT = 'gmail_oauth_failure_count';

    /**
     * Generate a tenant-scoped cache key to prevent cross-tenant token sharing.
     */
    private function cacheKey(string $suffix): string
    {
        $prefix = $this->tenantId ? "mail:{$this->tenantId}:" : 'mail:platform:';
        return $prefix . $suffix;
    }

    // Rate limiting & circuit breaker constants
    private const MAX_REFRESH_ATTEMPTS_PER_HOUR = 10;
    private const CIRCUIT_BREAKER_THRESHOLD = 3;
    private const CIRCUIT_BREAKER_TIMEOUT = 300;
    private const TOKEN_TTL = 3000;

    /**
     * @param int|null $tenantId When provided, loads per-tenant email config.
     *                           When null, uses platform-wide .env config.
     */
    public function __construct(?int $tenantId = null)
    {
        $this->tenantId = $tenantId;

        // Always load .env values as the base/fallback config
        $envValues = $this->loadEnvValues();

        // Check if Gmail API is enabled (from .env)
        $useGmailApiRaw = $envValues['USE_GMAIL_API'] ?? 'false';
        $this->useGmailApi = strtolower($useGmailApiRaw) === 'true';

        if ($this->useGmailApi) {
            $this->gmailClientId = $envValues['GMAIL_CLIENT_ID'] ?? '';
            $this->gmailClientSecret = $envValues['GMAIL_CLIENT_SECRET'] ?? '';
            $this->gmailRefreshToken = $envValues['GMAIL_REFRESH_TOKEN'] ?? '';
            $this->fromEmail = $envValues['GMAIL_SENDER_EMAIL'] ?? $envValues['SMTP_FROM_EMAIL'] ?? '';
            $this->fromName = $envValues['GMAIL_SENDER_NAME'] ?? $envValues['SMTP_FROM_NAME'] ?? 'Project NEXUS';
            $this->driver = 'gmail_api';
        }

        // Always load SMTP credentials (used as primary when Gmail is disabled, or as fallback)
        $this->host = $envValues['SMTP_HOST'] ?? '';
        $this->port = $envValues['SMTP_PORT'] ?? 587;
        $this->timeout = max(1, (int) ($envValues['SMTP_TIMEOUT'] ?? 5));
        $this->username = $envValues['SMTP_USER'] ?? '';
        $this->password = $envValues['SMTP_PASS'] ?? '';
        $this->encryption = $envValues['SMTP_ENCRYPTION'] ?? 'tls';

        if (!$this->useGmailApi) {
            $this->fromEmail = $envValues['SMTP_FROM_EMAIL'] ?? '';
            $this->fromName = $envValues['SMTP_FROM_NAME'] ?? 'Project NEXUS';
        }

        // Platform-wide Postmark config — active when the platform provider is
        // 'postmark' (the default). A Postmark send failure falls back to SMTP.
        $platformProvider = strtolower(trim((string) ($envValues['MAIL_PLATFORM_PROVIDER'] ?? 'postmark')));
        $envPostmarkToken = $envValues['POSTMARK_SERVER_TOKEN'] ?? '';
        if ($platformProvider === 'postmark' && !empty($envPostmarkToken) && !$this->useGmailApi) {
            $this->postmarkToken = $envPostmarkToken;
            if (!empty($envValues['POSTMARK_FROM_DOMAIN'])) {
                $this->postmarkFromDomain = $envValues['POSTMARK_FROM_DOMAIN'];
            }
            if (!empty($envValues['POSTMARK_STREAM_TRANSACTIONAL'])) {
                $this->postmarkStreamTransactional = $envValues['POSTMARK_STREAM_TRANSACTIONAL'];
            }
            if (!empty($envValues['POSTMARK_STREAM_BROADCAST'])) {
                $this->postmarkStreamBroadcast = $envValues['POSTMARK_STREAM_BROADCAST'];
            }
            if (!empty($envValues['POSTMARK_FROM_EMAIL'])) {
                $this->fromEmail = $envValues['POSTMARK_FROM_EMAIL'];
            }
            if (!empty($envValues['POSTMARK_FROM_NAME'])) {
                $this->fromName = $envValues['POSTMARK_FROM_NAME'];
            }
            if (!empty($envValues['POSTMARK_REPLY_TO'])) {
                $this->platformReplyTo = $envValues['POSTMARK_REPLY_TO'];
            }
            $this->driver = 'postmark';
            $this->isPlatformPostmark = true;
        }

        // Per-tenant override
        if ($tenantId !== null) {
            $this->loadTenantConfig($tenantId);
        }
    }

    /**
     * Factory: create a Mailer configured for the current tenant context.
     */
    public static function forCurrentTenant(): self
    {
        $tenantId = TenantContext::currentId();
        if ($tenantId === null) {
            \Illuminate\Support\Facades\Log::warning('Mailer::forCurrentTenant() called with no tenant context; using platform SMTP without resolving a fallback tenant', [
                'trace' => debug_backtrace(DEBUG_BACKTRACE_IGNORE_ARGS, 5),
            ]);
        }
        return new self($tenantId);
    }

    /**
     * Resolve the From-address prefix for a given audit category string when
     * routing via the platform sending domain (project-nexus.net, Postmark).
     *
     * Maps the fine-grained EmailDispatchService audit categories (e.g.
     * 'newsletter', 'password_reset', 'marketplace_payment') to one of the
     * eight recognised From-address buckets.
     */
    private function resolveFromPrefix(?string $category): string
    {
        if ($category === null || $category === '') {
            return self::CATEGORY_NOTIFICATIONS;
        }

        // Newsletter-type bulk mail
        if (in_array($category, ['newsletter', 'newsletter_test', 'federation_digest', 'group_digest', 'notification_digest', 'gamification_digest'], true)) {
            return self::CATEGORY_NEWSLETTERS;
        }

        // Direct messages / cross-community invitations
        if (in_array($category, ['message', 'federation_message', 'verein_federation'], true)) {
            return self::CATEGORY_MESSAGES;
        }

        // System-only / no-reply transactional
        if (in_array($category, ['password_reset', 'email_verification', 'security_alert', 'activation', 'welcome', 'tenant_provisioning'], true)) {
            return self::CATEGORY_NOREPLY;
        }

        // Admin-triggered (moderation, bans, vetting, admin test)
        if (str_starts_with($category, 'admin_') || in_array($category, ['listing_moderation', 'vetting'], true)) {
            return self::CATEGORY_ADMIN;
        }

        // Event notifications
        if ($category === 'event_notification' || str_starts_with($category, 'event_')) {
            return self::CATEGORY_EVENTS;
        }

        // Safeguarding alerts
        if ($category === 'safeguarding') {
            return self::CATEGORY_SAFEGUARDING;
        }

        // Billing / payments / marketplace
        if (
            str_starts_with($category, 'marketplace_') ||
            in_array($category, ['billing', 'donation', 'identity_payment', 'verein_dues', 'vol_org_wallet'], true)
        ) {
            return self::CATEGORY_BILLING;
        }

        return self::CATEGORY_NOTIFICATIONS;
    }

    /**
     * Load per-tenant email provider config from the email_settings table.
     */
    private function loadTenantConfig(int $tenantId): void
    {
        try {
            // Always derive From name from the tenant's name — no admin config needed.
            $tenantName = TenantContext::getSetting('site_name');
            if (empty($tenantName)) {
                $tenantName = \Illuminate\Support\Facades\DB::table('tenants')
                    ->where('id', $tenantId)
                    ->value('name');
            }
            if (!empty($tenantName)) {
                $this->fromName = $tenantName;
            }

            if (!class_exists(EmailSettings::class)) { return; }
            $provider = EmailSettings::get($tenantId, 'email_provider');

            if (!$provider || $provider === 'platform_default') {
                return;
            }

            switch ($provider) {
                // A legacy tenant setting of 'sendgrid' intentionally has no case:
                // SendGrid has been retired, so it falls through to the platform
                // provider (Postmark/SMTP) rather than activating a dead driver.
                case 'gmail_api':
                    $clientId = EmailSettings::get($tenantId, 'gmail_client_id');
                    $clientSecret = EmailSettings::get($tenantId, 'gmail_client_secret');
                    $refreshToken = EmailSettings::get($tenantId, 'gmail_refresh_token');
                    if (!empty($clientId) && !empty($clientSecret) && !empty($refreshToken)) {
                        $this->gmailClientId = $clientId;
                        $this->gmailClientSecret = $clientSecret;
                        $this->gmailRefreshToken = $refreshToken;
                        $this->useGmailApi = true;
                        $this->driver = 'gmail_api';
                        $senderEmail = EmailSettings::get($tenantId, 'gmail_sender_email');
                        $senderName = EmailSettings::get($tenantId, 'gmail_sender_name');
                        if (!empty($senderEmail)) $this->fromEmail = $senderEmail;
                        if (!empty($senderName)) $this->fromName = $senderName;
                    }
                    break;

                case 'smtp':
                    $smtpHost = EmailSettings::get($tenantId, 'smtp_host');
                    if (!empty($smtpHost)) {
                        $this->host = $smtpHost;
                        $this->port = EmailSettings::get($tenantId, 'smtp_port') ?? 587;
                        $this->username = EmailSettings::get($tenantId, 'smtp_user') ?? '';
                        $this->password = EmailSettings::get($tenantId, 'smtp_password') ?? '';
                        $this->encryption = EmailSettings::get($tenantId, 'smtp_encryption') ?? 'tls';
                        $this->driver = 'smtp';
                        $this->useGmailApi = false;
                        $fromEmail = EmailSettings::get($tenantId, 'smtp_from_email');
                        $fromName = EmailSettings::get($tenantId, 'smtp_from_name');
                        if (!empty($fromEmail)) $this->fromEmail = $fromEmail;
                        if (!empty($fromName)) $this->fromName = $fromName;
                    }
                    break;
            }
        } catch (\Throwable $e) {
            \Illuminate\Support\Facades\Log::warning("Mailer: Failed to load tenant config for tenant {$tenantId}: " . $e->getMessage());
        }
    }

    /**
     * Load mail configuration values via Laravel's config() helper.
     *
     * Credentials are pulled from config/mail.php (smtp + gmail_api + postmark)
     * at call time rather than read directly from the environment. This keeps
     * secrets out of long-lived object properties in downstream callers and
     * routes all mail credential access through a single auditable surface.
     */
    private function loadEnvValues(): array
    {
        return [
            'USE_GMAIL_API'       => config('mail.gmail_api.enabled') ? 'true' : 'false',
            'GMAIL_CLIENT_ID'     => (string) (config('mail.gmail_api.client_id') ?? ''),
            'GMAIL_CLIENT_SECRET' => (string) (config('mail.gmail_api.client_secret') ?? ''),
            'GMAIL_REFRESH_TOKEN' => (string) (config('mail.gmail_api.refresh_token') ?? ''),
            'GMAIL_SENDER_EMAIL'  => (string) (config('mail.gmail_api.sender_email') ?? ''),
            'GMAIL_SENDER_NAME'   => (string) (config('mail.gmail_api.sender_name') ?? ''),
            'SMTP_HOST'           => (string) (config('mail.mailers.smtp.host') ?? ''),
            'SMTP_PORT'           => config('mail.mailers.smtp.port') ?? 587,
            'SMTP_USER'           => (string) (config('mail.mailers.smtp.username') ?? ''),
            'SMTP_PASS'           => (string) (config('mail.mailers.smtp.password') ?? ''),
            'SMTP_ENCRYPTION'     => (string) (config('mail.mailers.smtp.encryption') ?? 'tls'),
            'SMTP_TIMEOUT'        => (int) (config('mail.mailers.smtp.timeout') ?? 5),
            'SMTP_FROM_EMAIL'     => (string) (config('mail.from.address') ?? ''),
            'SMTP_FROM_NAME'      => (string) (config('mail.from.name') ?? 'Project NEXUS'),
            'MAIL_PLATFORM_PROVIDER'        => (string) (config('mail.platform_provider') ?? 'postmark'),
            'POSTMARK_SERVER_TOKEN'         => (string) (config('mail.postmark.server_token') ?? ''),
            'POSTMARK_FROM_EMAIL'           => (string) (config('mail.postmark.from_email') ?? ''),
            'POSTMARK_FROM_NAME'            => (string) (config('mail.postmark.from_name') ?? ''),
            'POSTMARK_REPLY_TO'             => (string) (config('mail.postmark.reply_to') ?? ''),
            'POSTMARK_FROM_DOMAIN'          => (string) (config('mail.postmark.from_domain') ?? 'project-nexus.net'),
            'POSTMARK_STREAM_TRANSACTIONAL' => (string) (config('mail.postmark.stream_transactional') ?? 'outbound'),
            'POSTMARK_STREAM_BROADCAST'     => (string) (config('mail.postmark.stream_broadcast') ?? 'broadcast'),
        ];
    }

    /**
     * Per-recipient hourly rate limit. Each call increments a Redis counter
     * keyed on the lowercased recipient address; if it exceeds the cap we
     * refuse to send. Counter expires after 1 hour so the limit is a true
     * rolling window.
     *
     * Cap is configurable via env `MAILER_PER_RECIPIENT_HOURLY_LIMIT`
     * (default 30). A value of 0 disables the check.
     *
     * Returns true if the send is permitted, false if rate-limited.
     */
    private static function checkRateLimit(string $email): bool
    {
        $limit = (int) (env('MAILER_PER_RECIPIENT_HOURLY_LIMIT', 30));
        if ($limit <= 0) {
            return true;
        }
        try {
            $key = 'mailer:rate:' . strtolower($email);
            $cache = \Illuminate\Support\Facades\Cache::store(
                config('cache.default', 'redis')
            );
            $count = (int) $cache->get($key, 0);
            if ($count >= $limit) {
                return false;
            }
            // Use put() with a 1-hour TTL on first increment so we don't
            // double-increment via increment() before set() establishes the
            // key (a known race in some cache drivers).
            if ($count === 0) {
                $cache->put($key, 1, now()->addHour());
            } else {
                $cache->increment($key);
            }
            return true;
        } catch (\Throwable $e) {
            // Cache failure should never block the email path.
            \Illuminate\Support\Facades\Log::debug('Mailer::checkRateLimit failed: ' . $e->getMessage());
            return true;
        }
    }

    /**
     * Check if an address is on the local suppression cache. Hydrated from the
     * provider event webhook (Postmark) that records bounces / spam complaints.
     * Safe to call before the table exists (defaults to "not suppressed").
     *
     * Public so retrying senders (e.g. VolunteerReminderService) can treat a
     * suppressed recipient as a permanent failure instead of retrying forever.
     */
    public static function isSuppressed(string $email): bool
    {
        try {
            if (!\Illuminate\Support\Facades\Schema::hasTable('email_suppression')) {
                return false;
            }
            return \Illuminate\Support\Facades\DB::table('email_suppression')
                ->where('email', $email)
                ->exists();
        } catch (\Throwable $e) {
            return false;
        }
    }

    /**
     * Append a row to email_log capturing the outcome of a send attempt.
     * Best-effort — never throws, never blocks the email itself.
     */
    private static function logEmail(string $to, string $subject, string $status, ?string $messageId = null, ?string $error = null, ?int $tenantIdOverride = null, ?string $category = null, ?string $provider = null, ?array $metadata = null): void
    {
        try {
            if (!\Illuminate\Support\Facades\Schema::hasTable('email_log')) {
                return;
            }
            $tenantId = $tenantIdOverride ?? TenantContext::currentId();
            $metadata = self::normalizeEmailMetadata($metadata);
            $sensitiveExternal = $metadata['sensitive_external'];
            $userId = null;
            try {
                if ($tenantId !== null && ! $sensitiveExternal) {
                    $userId = \Illuminate\Support\Facades\DB::table('users')
                        ->where('email', $to)
                        ->where('tenant_id', $tenantId)
                        ->whereNull('deleted_at')
                        ->value('id');
                }
            } catch (\Throwable $e) {
                // ignore — user lookup is best-effort
            }
            $row = [
                'tenant_id'           => $tenantId,
                'user_id'             => $userId,
                'recipient_email'     => $sensitiveExternal
                    ? 'external:' . ($metadata['recipient_hash'] ?? 'redacted')
                    : $to,
                'category'            => $category !== null ? mb_substr($category, 0, 64) : null,
                'subject'             => mb_substr($subject, 0, 255),
                'provider'            => $provider,
                'status'              => $status,
                'provider_message_id' => $messageId,
                'error'               => $error,
                'sent_at'             => in_array($status, ['sent', 'delivered'], true) ? now() : null,
                'created_at'          => now(),
                'updated_at'          => now(),
            ];

            if (\Illuminate\Support\Facades\Schema::hasColumn('email_log', 'source')) {
                $row['source'] = $metadata['source'];
            }
            if (\Illuminate\Support\Facades\Schema::hasColumn('email_log', 'idempotency_key')) {
                $row['idempotency_key'] = $metadata['idempotency_key'];
            }
            if (\Illuminate\Support\Facades\Schema::hasColumn('email_log', 'dispatch_id')) {
                $row['dispatch_id'] = $metadata['dispatch_id'];
            }

            \Illuminate\Support\Facades\DB::table('email_log')->insert($row);
        } catch (\Throwable $e) {
            \Illuminate\Support\Facades\Log::debug('Mailer::logEmail failed: ' . $e->getMessage());
        }
    }

    /**
     * @param array<string,mixed>|null $metadata
     * @return array{source:?string,idempotency_key:?string,dispatch_id:?string,sensitive_external:bool,recipient_hash:?string}
     */
    private static function normalizeEmailMetadata(?array $metadata): array
    {
        $source = isset($metadata['source']) ? trim((string) $metadata['source']) : '';
        $idempotencyKey = isset($metadata['idempotency_key']) ? trim((string) $metadata['idempotency_key']) : '';
        $dispatchId = isset($metadata['dispatch_id']) ? trim((string) $metadata['dispatch_id']) : '';
        $sensitiveExternal = (bool) ($metadata['sensitive_external'] ?? false);
        $recipientHash = isset($metadata['recipient_hash'])
            ? strtolower(trim((string) $metadata['recipient_hash']))
            : '';
        if (preg_match('/^[0-9a-f]{64}$/', $recipientHash) !== 1) {
            $recipientHash = '';
        }

        return [
            'source' => $source !== '' ? mb_substr($source, 0, 160) : null,
            'idempotency_key' => $idempotencyKey !== '' ? mb_substr($idempotencyKey, 0, 191) : null,
            'dispatch_id' => $dispatchId !== '' ? mb_substr($dispatchId, 0, 64) : null,
            'sensitive_external' => $sensitiveExternal,
            'recipient_hash' => $recipientHash !== '' ? $recipientHash : null,
        ];
    }

    /** @param array<string,mixed>|null $metadata @return array<string,string> */
    private static function recipientLogContext(string $email, ?array $metadata): array
    {
        $normalized = self::normalizeEmailMetadata($metadata);
        if ($normalized['sensitive_external']) {
            return [
                'recipient_fingerprint' => $normalized['recipient_hash'] ?? 'redacted',
            ];
        }

        return ['to_masked' => self::maskEmail($email)];
    }

    /**
     * Look up the recipient in the current tenant and mint a signed
     * unsubscribe URL via NotificationUnsubscribeController. Returns null
     * if the recipient is not a user on this tenant (e.g. admin emails
     * to external addresses), in which case no List-Unsubscribe header
     * is added — that's the correct behaviour for one-off external sends.
     */
    private function autoDetectUnsubscribeUrl(string $to): ?string
    {
        if ($this->tenantId === null) {
            return null;
        }
        try {
            $userId = \Illuminate\Support\Facades\DB::table('users')
                ->where('email', $to)
                ->where('tenant_id', $this->tenantId)
                ->whereNull('deleted_at')
                ->value('id');
            if (!$userId) {
                return null;
            }
            return \App\Http\Controllers\Api\NotificationUnsubscribeController::buildSignedUrl(
                (int) $userId,
                $this->tenantId,
                'all'
            );
        } catch (\Throwable $e) {
            \Illuminate\Support\Facades\Log::debug('Mailer::autoDetectUnsubscribeUrl failed: ' . $e->getMessage());
            return null;
        }
    }

    /**
     * Mask an email address for safe logging (e.g., "j***@example.com").
     */
    private static function maskEmail(string $email): string
    {
        $parts = explode('@', $email, 2);
        if (count($parts) !== 2) {
            return '***';
        }
        $local = $parts[0];
        $domain = $parts[1];
        $masked = strlen($local) > 1 ? $local[0] . str_repeat('*', min(strlen($local) - 1, 5)) : '*';
        return $masked . '@' . $domain;
    }

    /**
     * Send an email.
     *
     * @param string      $to      Recipient email address
     * @param string      $subject Email subject
     * @param string      $body    HTML body
     * @param string|null $cc      CC recipient (optional)
     * @param string|null $replyTo Reply-To address (optional)
     * @return bool
     */
    public function send($to, $subject, $body, $cc = null, $replyTo = null, ?string $unsubscribeUrl = null, ?string $category = null, ?array $metadata = null, ?string $textBody = null): bool
    {
        // Category-based From address when routing via platform Postmark, on the
        // verified sending domain (project-nexus.net by default).
        if ($this->isPlatformPostmark && $this->driver === 'postmark') {
            $this->fromEmail = $this->resolveFromPrefix($category) . '@' . $this->postmarkFromDomain;
            if ($replyTo === null && $this->platformReplyTo !== null) {
                $replyTo = $this->platformReplyTo;
            }
        }

        // Sanitize header-injectable values — strip CR/LF to prevent email header injection
        $to = self::sanitizeHeaderValue($to);
        $subject = self::sanitizeHeaderValue($subject);
        $cc = $cc !== null ? self::sanitizeHeaderValue($cc) : null;
        $replyTo = $replyTo !== null ? self::sanitizeHeaderValue($replyTo) : null;

        // Auto-attach a one-click unsubscribe URL if the caller didn't pass one
        // AND the recipient is a known tenant member. Gmail / Yahoo (Feb 2024)
        // require List-Unsubscribe on bulk mail; rather than touch every send
        // call site individually we look up the user by email in the current
        // tenant and mint a signed token here. Transactional callers (password
        // reset, 2FA, etc.) typically send to addresses that DO match a user,
        // so they would also receive the header — that's fine; modern clients
        // ignore it on visibly-transactional messages and there's no spec
        // forbidding its presence on transactional mail.
        if ($unsubscribeUrl === null && $this->tenantId !== null) {
            $unsubscribeUrl = $this->autoDetectUnsubscribeUrl($to);
        }

        // Suppression check — refuse to send to an address the provider has
        // already told us bounces / spam-reports / is invalid. Saves quota,
        // protects sender reputation, and avoids confusion when an admin
        // wonders "why didn't this email arrive?". The suppression table is
        // hydrated by the Postmark event webhook.
        if (self::isSuppressed($to)) {
            self::logEmail($to, $subject, 'suppressed', null, 'recipient on local suppression list', $this->tenantId, $category, $this->driver, $metadata);
            \Illuminate\Support\Facades\Log::info(
                'Mailer: refusing to send to suppressed address',
                self::recipientLogContext($to, $metadata),
            );
            return false;
        }

        // Per-recipient rate limit. Catches runaway loops / buggy listeners
        // that would otherwise flood a single member with 50 connection-
        // request emails in 5 minutes. Configurable cap, default 30/hour
        // per recipient address (well above any legitimate per-user volume).
        if (!self::checkRateLimit($to)) {
            if (class_exists(\App\Services\EmailMonitorService::class)) {
                \App\Services\EmailMonitorService::recordRateLimitHitStatic($this->tenantId);
            }
            self::logEmail($to, $subject, 'failed', null, 'per-recipient rate limit exceeded', $this->tenantId, $category, $this->driver, $metadata);
            \Illuminate\Support\Facades\Log::warning(
                'Mailer: rate-limited recipient',
                self::recipientLogContext($to, $metadata),
            );
            return false;
        }

        // Route based on configured driver
        if ($this->driver === 'postmark') {
            $result = $this->sendViaPostmark($to, $subject, $body, $cc, $replyTo, $unsubscribeUrl, $category, $metadata, $textBody);
            if ($result) {
                self::logEmail($to, $subject, 'sent', $this->lastMessageId, null, $this->tenantId, $category, 'postmark', $metadata);
                return true;
            }

            // Fallback: SMTP (if configured).
            if (!empty($this->host) && !empty($this->username)) {
                \Illuminate\Support\Facades\Log::warning(
                    'Mailer: Postmark failed, falling back to SMTP',
                    self::recipientLogContext($to, $metadata),
                );
                $smtpOk = $this->sendViaSmtp($to, $subject, $body, $cc, $replyTo, $unsubscribeUrl, $textBody);
                self::logEmail($to, $subject, $smtpOk ? 'sent' : 'failed', null, $smtpOk ? null : 'Postmark + SMTP both failed', $this->tenantId, $category, 'smtp', $metadata);
                return $smtpOk;
            }

            \Illuminate\Support\Facades\Log::warning(
                'Mailer: Postmark failed and no fallback configured',
                self::recipientLogContext($to, $metadata),
            );
            self::logEmail($to, $subject, 'failed', null, 'Postmark failed, no fallback', $this->tenantId, $category, 'postmark', $metadata);
            return false;
        }

        if ($this->driver === 'gmail_api') {
            $result = $this->sendViaGmailApi($to, $subject, $body, $cc, $replyTo, $unsubscribeUrl, $textBody);
            if ($result) {
                self::logEmail($to, $subject, 'sent', null, null, $this->tenantId, $category, 'gmail_api', $metadata);
                return true;
            }

            if (!empty($this->host) && !empty($this->username)) {
                \Illuminate\Support\Facades\Log::warning(
                    'Mailer: Gmail API failed, falling back to SMTP',
                    self::recipientLogContext($to, $metadata),
                );
                $smtpOk = $this->sendViaSmtp($to, $subject, $body, $cc, $replyTo, $unsubscribeUrl, $textBody);
                if (class_exists(\App\Services\EmailMonitorService::class)) {
                    \App\Services\EmailMonitorService::recordFallbackToSmtpStatic('gmail_api_failed', $this->tenantId);
                    \App\Services\EmailMonitorService::recordEmailSendStatic('smtp', $smtpOk, $this->tenantId);
                }
                self::logEmail($to, $subject, $smtpOk ? 'sent' : 'failed', null, $smtpOk ? null : 'Gmail + SMTP both failed', $this->tenantId, $category, 'smtp', $metadata);
                return $smtpOk;
            }

            \Illuminate\Support\Facades\Log::warning(
                'Mailer: Gmail API failed and no SMTP fallback configured',
                self::recipientLogContext($to, $metadata),
            );
            self::logEmail($to, $subject, 'failed', null, 'Gmail API failed, no SMTP fallback', $this->tenantId, $category, 'gmail_api', $metadata);
            return false;
        }

        $smtpOk = $this->sendViaSmtp($to, $subject, $body, $cc, $replyTo, $unsubscribeUrl, $textBody);
        if ($smtpOk) {
            if (class_exists(\App\Services\EmailMonitorService::class)) {
                \App\Services\EmailMonitorService::recordEmailSendStatic('smtp', true, $this->tenantId);
            }
            self::logEmail($to, $subject, 'sent', null, null, $this->tenantId, $category, 'smtp', $metadata);
            return true;
        }

        if (class_exists(\App\Services\EmailMonitorService::class)) {
            \App\Services\EmailMonitorService::recordEmailSendStatic('smtp', false, $this->tenantId);
        }

        self::logEmail($to, $subject, 'failed', null, 'SMTP failed', $this->tenantId, $category, 'smtp', $metadata);
        return false;
    }

    /**
     * Choose the Postmark message stream for a category. Newsletter/digest
     * (bulk) categories use the broadcast stream; everything else uses the
     * transactional stream. Reuses the same category buckets as the From
     * address resolver so streams and From prefixes stay in lockstep.
     */
    private function resolvePostmarkStream(?string $category): string
    {
        return $this->resolveFromPrefix($category) === self::CATEGORY_NEWSLETTERS
            ? $this->postmarkStreamBroadcast
            : $this->postmarkStreamTransactional;
    }

    /**
     * Send email via the Postmark Email API (raw HTTP, no SDK dependency —
     * mirrors the Gmail API cURL path already used in this class).
     */
    private function sendViaPostmark($to, $subject, $body, $cc = null, $replyTo = null, ?string $unsubscribeUrl = null, ?string $category = null, ?array $metadata = null, ?string $textBody = null): bool
    {
        try {
            // Prefer a caller-supplied text/plain part (proper html→text). Fall
            // back to the naive strip_tags derivation for callers that omit it.
            if ($textBody !== null && trim($textBody) !== '') {
                $plainText = $textBody;
            } else {
                $plainText = strip_tags(str_replace(['<br>', '<br/>', '<br />'], "\n", $body));
                $plainText = html_entity_decode($plainText, ENT_QUOTES, 'UTF-8');
                $plainText = preg_replace('/\n\s+/', "\n", (string) $plainText);
            }

            $stream = $this->resolvePostmarkStream($category);

            $payload = [
                'From'          => $this->fromName !== '' ? sprintf('%s <%s>', $this->fromName, $this->fromEmail) : $this->fromEmail,
                'To'            => $to,
                'Subject'       => $subject,
                'HtmlBody'      => $body,
                'TextBody'      => trim((string) $plainText),
                'MessageStream' => $stream,
                'TrackOpens'    => false,
                'TrackLinks'    => 'None',
            ];

            if ($cc) {
                $payload['Cc'] = $cc;
            }
            if ($replyTo) {
                $payload['ReplyTo'] = $replyTo;
            }

            // Postmark manages one-click unsubscribe natively on broadcast
            // streams; on the transactional stream we still forward the
            // platform's signed List-Unsubscribe URL when one is present.
            if ($unsubscribeUrl && $stream === $this->postmarkStreamTransactional) {
                $payload['Headers'] = [
                    ['Name' => 'List-Unsubscribe', 'Value' => '<' . $unsubscribeUrl . '>'],
                    ['Name' => 'List-Unsubscribe-Post', 'Value' => 'List-Unsubscribe=One-Click'],
                ];
            }

            // Postmark Metadata is a flat map of string values — the per-message
            // metadata attached to each send (tenant, category, dispatch ids).
            $meta = [];
            if ($this->tenantId) {
                $meta['tenant_id'] = (string) $this->tenantId;
            }
            if ($category !== null && $category !== '') {
                $meta['category'] = mb_substr($category, 0, 64);
            }
            foreach (self::normalizeEmailMetadata($metadata) as $k => $v) {
                if ($v !== null) {
                    $meta[$k] = (string) $v;
                }
            }
            if ($meta) {
                $payload['Metadata'] = $meta;
            }

            $ch = curl_init('https://api.postmarkapp.com/email');
            curl_setopt_array($ch, [
                CURLOPT_POST => true,
                CURLOPT_HTTPHEADER => [
                    'Accept: application/json',
                    'Content-Type: application/json',
                    'X-Postmark-Server-Token: ' . $this->postmarkToken,
                ],
                CURLOPT_POSTFIELDS => json_encode($payload),
                CURLOPT_RETURNTRANSFER => true,
                CURLOPT_SSL_VERIFYPEER => true,
                CURLOPT_TIMEOUT => 15,
                CURLOPT_CONNECTTIMEOUT => 5,
            ]);
            $response = curl_exec($ch);
            $httpCode = curl_getinfo($ch, CURLINFO_HTTP_CODE);
            $curlError = curl_error($ch);
            curl_close($ch);

            if ($curlError) {
                throw new \Exception("cURL error: $curlError");
            }

            $data = json_decode((string) $response, true);
            $errorCode = is_array($data) ? ($data['ErrorCode'] ?? -1) : -1;

            if ($httpCode >= 200 && $httpCode < 300 && $errorCode === 0) {
                $this->lastMessageId = is_array($data) ? ($data['MessageID'] ?? null) : null;
                if (class_exists(\App\Services\EmailMonitorService::class)) {
                    \App\Services\EmailMonitorService::recordEmailSendStatic('postmark', true, $this->tenantId);
                }
                return true;
            }

            $msg = is_array($data) ? ($data['Message'] ?? $response) : $response;
            \Illuminate\Support\Facades\Log::warning("Postmark error (HTTP {$httpCode}, code {$errorCode}): " . mb_substr((string) $msg, 0, 300));
            if (class_exists(\App\Services\EmailMonitorService::class)) {
                \App\Services\EmailMonitorService::recordEmailSendStatic('postmark', false, $this->tenantId);
            }
            $this->lastMessageId = null;
            return false;
        } catch (\Exception $e) {
            \Illuminate\Support\Facades\Log::warning("Postmark Error: " . $e->getMessage());
            if (class_exists(\App\Services\EmailMonitorService::class)) {
                \App\Services\EmailMonitorService::recordEmailSendStatic('postmark', false, $this->tenantId);
            }
            $this->lastMessageId = null;
            return false;
        }
    }

    /**
     * Send email via Gmail API using OAuth 2.0.
     */
    private function sendViaGmailApi($to, $subject, $body, $cc = null, $replyTo = null, ?string $unsubscribeUrl = null, ?string $textBody = null)
    {
        try {
            $accessToken = $this->getGmailAccessToken();
            if (!$accessToken) {
                if (class_exists(\App\Services\EmailMonitorService::class)) {
                    \App\Services\EmailMonitorService::recordEmailSendStatic('gmail_api', false, $this->tenantId);
                }
                throw new \Exception("Failed to get Gmail API access token");
            }

            $rawEmail = $this->buildRawEmail($to, $subject, $body, $cc, $replyTo, $unsubscribeUrl, $textBody);
            $encodedEmail = $this->base64urlEncode($rawEmail);

            $url = 'https://gmail.googleapis.com/gmail/v1/users/me/messages/send';

            $ch = curl_init($url);
            curl_setopt_array($ch, [
                CURLOPT_POST => true,
                CURLOPT_HTTPHEADER => [
                    'Authorization: Bearer ' . $accessToken,
                    'Content-Type: application/json'
                ],
                CURLOPT_POSTFIELDS => json_encode(['raw' => $encodedEmail]),
                CURLOPT_RETURNTRANSFER => true,
                CURLOPT_SSL_VERIFYPEER => true,
                CURLOPT_TIMEOUT => 10,
                CURLOPT_CONNECTTIMEOUT => 5,
            ]);

            $response = curl_exec($ch);
            $httpCode = curl_getinfo($ch, CURLINFO_HTTP_CODE);
            $curlError = curl_error($ch);
            curl_close($ch);

            if ($curlError) {
                throw new \Exception("cURL error: $curlError");
            }

            if ($httpCode < 200 || $httpCode >= 300) {
                $errorData = json_decode($response, true);
                $errorMsg = $errorData['error']['message'] ?? $response;
                throw new \Exception("Gmail API error ($httpCode): $errorMsg");
            }

            if (class_exists(\App\Services\EmailMonitorService::class)) {
                \App\Services\EmailMonitorService::recordEmailSendStatic('gmail_api', true, $this->tenantId);
            }

            return true;

        } catch (\Exception $e) {
            \Illuminate\Support\Facades\Log::warning("Gmail API Error: " . $e->getMessage());
            if (class_exists(\App\Services\EmailMonitorService::class)) {
                \App\Services\EmailMonitorService::recordEmailSendStatic('gmail_api', false, $this->tenantId);
            }
            return false;
        }
    }

    /**
     * Get Gmail API access token, refreshing if necessary.
     */
    private function getGmailAccessToken()
    {
        $hasCache = true;
        try {
            // Test if cache is available
            Cache::has($this->cacheKey(self::CACHE_KEY_ACCESS_TOKEN));
        } catch (\Throwable $e) {
            $hasCache = false;
        }

        if ($hasCache) {
            $circuitBreakerExpiry = Cache::get($this->cacheKey(self::CACHE_KEY_CIRCUIT_BREAKER));
            if ($circuitBreakerExpiry && time() < $circuitBreakerExpiry) {
                $remainingSeconds = $circuitBreakerExpiry - time();
                \Illuminate\Support\Facades\Log::warning("Gmail API circuit breaker is open. Blocked for {$remainingSeconds}s more.");
                if (class_exists(\App\Services\EmailMonitorService::class)) {
                    \App\Services\EmailMonitorService::recordCircuitBreakerOpenStatic($this->tenantId);
                }
                return null;
            }

            $cachedToken = Cache::get($this->cacheKey(self::CACHE_KEY_ACCESS_TOKEN));
            $cachedExpiry = Cache::get($this->cacheKey(self::CACHE_KEY_TOKEN_EXPIRY));

            if ($cachedToken && $cachedExpiry && $cachedExpiry > time()) {
                return $cachedToken;
            }

            $refreshAttempts = Cache::increment($this->cacheKey(self::CACHE_KEY_REFRESH_ATTEMPTS));
            if ($refreshAttempts === 1) {
                // First increment — set TTL for the key
                Cache::put($this->cacheKey(self::CACHE_KEY_REFRESH_ATTEMPTS), 1, 3600);
            }

            if ($refreshAttempts > self::MAX_REFRESH_ATTEMPTS_PER_HOUR) {
                \Illuminate\Support\Facades\Log::warning("Gmail API rate limit exceeded: {$refreshAttempts} refresh attempts in the last hour");
                return null;
            }
        }

        if (empty($this->gmailClientId) || empty($this->gmailClientSecret) || empty($this->gmailRefreshToken)) {
            \Illuminate\Support\Facades\Log::warning("Gmail API Error: Missing credentials");
            return null;
        }

        $token = $this->refreshGmailToken();

        if ($token) {
            if ($hasCache) { Cache::forget($this->cacheKey(self::CACHE_KEY_FAILURE_COUNT)); }
            return $token;
        }

        if ($hasCache) {
            $failureCount = Cache::increment($this->cacheKey(self::CACHE_KEY_FAILURE_COUNT));
            if ($failureCount === 1) {
                Cache::put($this->cacheKey(self::CACHE_KEY_FAILURE_COUNT), 1, 3600);
            }

            if ($failureCount >= self::CIRCUIT_BREAKER_THRESHOLD) {
                $breakerExpiry = time() + self::CIRCUIT_BREAKER_TIMEOUT;
                Cache::put($this->cacheKey(self::CACHE_KEY_CIRCUIT_BREAKER), $breakerExpiry, self::CIRCUIT_BREAKER_TIMEOUT);
                \Illuminate\Support\Facades\Log::warning("Gmail API circuit breaker opened after {$failureCount} consecutive failures.");
                if (class_exists(\App\Services\EmailMonitorService::class)) {
                    \App\Services\EmailMonitorService::recordCircuitBreakerOpenStatic($this->tenantId);
                }
            }
        }

        return null;
    }

    /**
     * Refresh Gmail OAuth2 access token.
     */
    private function refreshGmailToken(): ?string
    {
        $url = 'https://oauth2.googleapis.com/token';

        $postData = http_build_query([
            'client_id' => $this->gmailClientId,
            'client_secret' => $this->gmailClientSecret,
            'refresh_token' => $this->gmailRefreshToken,
            'grant_type' => 'refresh_token'
        ]);

        $ch = curl_init($url);
        curl_setopt_array($ch, [
            CURLOPT_POST => true,
            CURLOPT_POSTFIELDS => $postData,
            CURLOPT_RETURNTRANSFER => true,
            CURLOPT_HTTPHEADER => ['Content-Type: application/x-www-form-urlencoded'],
            CURLOPT_SSL_VERIFYPEER => true,
            CURLOPT_TIMEOUT => 10,
            CURLOPT_CONNECTTIMEOUT => 5,
        ]);

        $response = curl_exec($ch);
        $httpCode = curl_getinfo($ch, CURLINFO_HTTP_CODE);
        $curlError = curl_error($ch);
        curl_close($ch);

        if ($curlError) {
            \Illuminate\Support\Facades\Log::warning("Gmail token refresh cURL error: $curlError");
            if (class_exists(\App\Services\EmailMonitorService::class)) {
                \App\Services\EmailMonitorService::recordTokenRefreshStatic(false, $this->tenantId);
            }
            return null;
        }

        $data = json_decode($response, true);

        $logData = [
            'http_code' => $httpCode,
            'has_access_token' => isset($data['access_token']),
            'expires_in' => $data['expires_in'] ?? null,
            'token_type' => $data['token_type'] ?? null,
            'error' => $data['error'] ?? null,
            'error_description' => $data['error_description'] ?? null,
        ];
        \Illuminate\Support\Facades\Log::warning("Gmail token refresh response: " . json_encode($logData));

        if ($httpCode < 200 || $httpCode >= 300) {
            // Log only the structured error fields; the full $response body may
            // contain sensitive material (refresh tokens, secrets) on rare
            // backends.
            \Illuminate\Support\Facades\Log::warning("Gmail token refresh failed (HTTP $httpCode): " . ($data['error_description'] ?? $data['error'] ?? '[error body redacted]'));
            if (class_exists(\App\Services\EmailMonitorService::class)) {
                \App\Services\EmailMonitorService::recordTokenRefreshStatic(false, $this->tenantId);
            }
            return null;
        }

        if (!isset($data['access_token'])) {
            \Illuminate\Support\Facades\Log::warning("Gmail token refresh response missing access_token field");
            if (class_exists(\App\Services\EmailMonitorService::class)) {
                \App\Services\EmailMonitorService::recordTokenRefreshStatic(false, $this->tenantId);
            }
            return null;
        }

        $accessToken = $data['access_token'];
        $expiresIn = $data['expires_in'] ?? 3600;
        $expiryTimestamp = time() + $expiresIn;

        try {
            Cache::put($this->cacheKey(self::CACHE_KEY_ACCESS_TOKEN), $accessToken, self::TOKEN_TTL);
            Cache::put($this->cacheKey(self::CACHE_KEY_TOKEN_EXPIRY), $expiryTimestamp, self::TOKEN_TTL);
        } catch (\Throwable $e) {
            // Cache write failure is non-fatal
        }

        \Illuminate\Support\Facades\Log::warning("Gmail token refreshed successfully. Expires in {$expiresIn}s.");
        if (class_exists(\App\Services\EmailMonitorService::class)) {
            \App\Services\EmailMonitorService::recordTokenRefreshStatic(true, $this->tenantId);
        }

        return $accessToken;
    }

    private function base64urlEncode($data)
    {
        return rtrim(strtr(base64_encode($data), '+/', '-_'), '=');
    }

    private function buildRawEmail($to, $subject, $body, $cc = null, $replyTo = null, ?string $unsubscribeUrl = null, ?string $textBody = null)
    {
        $boundary = 'boundary_' . md5(uniqid(time()));

        if ($textBody !== null && trim($textBody) !== '') {
            $plainText = trim($textBody);
        } else {
            $plainText = strip_tags(str_replace(['<br>', '<br/>', '<br />'], "\n", $body));
            $plainText = html_entity_decode($plainText, ENT_QUOTES, 'UTF-8');
            $plainText = preg_replace('/\n\s+/', "\n", $plainText);
            $plainText = trim($plainText);
        }

        $headers = [];
        $headers[] = 'From: ' . $this->fromName . ' <' . $this->fromEmail . '>';
        $headers[] = 'To: ' . $to;
        if ($cc) {
            $headers[] = 'Cc: ' . $cc;
        }
        if ($replyTo) {
            $headers[] = 'Reply-To: ' . $replyTo;
        }
        $headers[] = 'Subject: =?UTF-8?B?' . base64_encode($subject) . '?=';
        $headers[] = 'MIME-Version: 1.0';
        $headers[] = 'Content-Type: multipart/alternative; boundary="' . $boundary . '"';
        $headers[] = 'Date: ' . date('r');
        $headers[] = 'Message-ID: <' . md5(uniqid(time())) . '@' . parse_url($_ENV['APP_URL'] ?? 'localhost', PHP_URL_HOST) . '>';
        if ($unsubscribeUrl) {
            $headers[] = 'List-Unsubscribe: <' . $unsubscribeUrl . '>';
            $headers[] = 'List-Unsubscribe-Post: List-Unsubscribe=One-Click';
        }

        $message = implode("\r\n", $headers) . "\r\n\r\n";

        $message .= '--' . $boundary . "\r\n";
        $message .= "Content-Type: text/plain; charset=UTF-8\r\n";
        $message .= "Content-Transfer-Encoding: base64\r\n\r\n";
        $message .= chunk_split(base64_encode($plainText)) . "\r\n";

        $message .= '--' . $boundary . "\r\n";
        $message .= "Content-Type: text/html; charset=UTF-8\r\n";
        $message .= "Content-Transfer-Encoding: base64\r\n\r\n";
        $message .= chunk_split(base64_encode($body)) . "\r\n";

        $message .= '--' . $boundary . '--';

        return $message;
    }

    private function sendViaSmtp($to, $subject, $body, $cc = null, $replyTo = null, ?string $unsubscribeUrl = null, ?string $textBody = null)
    {
        try {
            $this->connect();
            $this->auth();
            $this->sendData($to, $subject, $body, $cc, $replyTo, $unsubscribeUrl, $textBody);
            $this->quit();
            return true;
        } catch (\Exception $e) {
            \Illuminate\Support\Facades\Log::warning("SMTP Error: " . $e->getMessage());
            return false;
        }
    }

    private function connect()
    {
        $host = $this->host;

        if ($this->encryption === 'ssl') {
            $host = "ssl://" . $host;
        }

        if (empty($this->host)) {
            throw new \Exception("SMTP host not configured");
        }

        $this->socket = @fsockopen($host, $this->port, $errno, $errstr, $this->timeout);
        if (!$this->socket) {
            throw new \Exception("Could not connect to SMTP host: $errstr ($errno)");
        }

        // Bound the REPLIES too, not just the connect. Without this, fgets()
        // inherits php.ini's default_socket_timeout (60s here) on every read,
        // and a send performs several — so a host that accepts the connection
        // and then goes quiet could hold a member's request open for minutes.
        stream_set_timeout($this->socket, $this->timeout);

        $ehloHost = $_SERVER['HTTP_HOST'] ?? 'api.project-nexus.ie';

        $this->read();
        $this->write("EHLO " . $ehloHost);
        $this->read();

        if ($this->encryption === 'tls') {
            $this->write("STARTTLS");
            $this->read();
            stream_socket_enable_crypto($this->socket, true, STREAM_CRYPTO_METHOD_TLS_CLIENT);
            $this->write("EHLO " . $ehloHost);
            $this->read();
        }
    }

    private function auth()
    {
        $this->write("AUTH LOGIN");
        $this->read();
        $this->write(base64_encode($this->username));
        $this->read();
        $this->write(base64_encode($this->password));
        $this->read();
    }

    private function sendData($to, $subject, $body, $cc = null, $replyTo = null, ?string $unsubscribeUrl = null, ?string $textBody = null)
    {
        $this->write("MAIL FROM: <{$this->fromEmail}>");
        $this->read();
        $this->write("RCPT TO: <$to>");
        $this->read();
        if ($cc) {
            $this->write("RCPT TO: <$cc>");
            $this->read();
        }
        $this->write("DATA");
        $this->read();

        $hasText = $textBody !== null && trim($textBody) !== '';
        $boundary = 'bnd_' . md5(uniqid((string) time(), true));

        $headers = "MIME-Version: 1.0\r\n";
        $headers .= $hasText
            ? "Content-Type: multipart/alternative; boundary=\"$boundary\"\r\n"
            : "Content-Type: text/html; charset=UTF-8\r\n";
        $headers .= "From: {$this->fromName} <{$this->fromEmail}>\r\n";
        $headers .= "To: $to\r\n";
        if ($cc) {
            $headers .= "Cc: $cc\r\n";
        }
        if ($replyTo) {
            $headers .= "Reply-To: $replyTo\r\n";
        }
        // RFC 2047: encode subject so non-ASCII characters survive SMTP transport
        $headers .= "Subject: =?UTF-8?B?" . base64_encode($subject) . "?=\r\n";
        if ($unsubscribeUrl) {
            $headers .= "List-Unsubscribe: <$unsubscribeUrl>\r\n";
            $headers .= "List-Unsubscribe-Post: List-Unsubscribe=One-Click\r\n";
        }

        if ($hasText) {
            // text/plain first, then text/html — clients render the last part
            // they can, so HTML wins where supported.
            $mime = "--$boundary\r\n"
                . "Content-Type: text/plain; charset=UTF-8\r\n"
                . "Content-Transfer-Encoding: base64\r\n\r\n"
                . chunk_split(base64_encode(trim((string) $textBody))) . "\r\n"
                . "--$boundary\r\n"
                . "Content-Type: text/html; charset=UTF-8\r\n"
                . "Content-Transfer-Encoding: base64\r\n\r\n"
                . chunk_split(base64_encode($body)) . "\r\n"
                . "--$boundary--";
            $this->write($headers . "\r\n" . $mime . "\r\n.");
        } else {
            $this->write($headers . "\r\n" . $body . "\r\n.");
        }
        $this->read();
    }

    private function quit()
    {
        $this->write("QUIT");
        fclose($this->socket);
    }

    private function write($cmd)
    {
        fputs($this->socket, $cmd . "\r\n");
    }

    private function read()
    {
        $response = "";
        while ($str = fgets($this->socket, 515)) {
            $response .= $str;
            if (substr($str, 3, 1) == " ") {
                break;
            }
        }

        // A timed-out read must ABORT the send, not be mistaken for a reply.
        // fgets() returns false on timeout, which ends the loop above and would
        // otherwise hand back an empty or half-read response — leaving the rest
        // of the SMTP conversation to carry on against a server that never
        // answered. Throwing also means one stall ends the attempt, so the
        // worst case is roughly connect + one timeout rather than a timeout per
        // read.
        if (stream_get_meta_data($this->socket)['timed_out'] ?? false) {
            throw new \Exception("Timed out waiting for the SMTP host after {$this->timeout}s");
        }

        return $response;
    }

    /**
     * Test Gmail API connection.
     *
     * @return array{success: bool, message: string}
     */
    public static function testGmailConnection(): array
    {
        $mailer = new self();

        if (!$mailer->useGmailApi) {
            return ['success' => false, 'message' => __('admin.mailer.gmail_not_enabled')];
        }

        $token = $mailer->getGmailAccessToken();
        if (!$token) {
            return ['success' => false, 'message' => __('admin.mailer.gmail_token_failed')];
        }

        $ch = curl_init('https://gmail.googleapis.com/gmail/v1/users/me/profile');
        curl_setopt_array($ch, [
            CURLOPT_HTTPHEADER => ['Authorization: Bearer ' . $token],
            CURLOPT_RETURNTRANSFER => true,
            CURLOPT_SSL_VERIFYPEER => true
        ]);

        $response = curl_exec($ch);
        $httpCode = curl_getinfo($ch, CURLINFO_HTTP_CODE);
        curl_close($ch);

        if ($httpCode === 200) {
            $profile = json_decode($response, true);
            return [
                'success' => true,
                'message' => __('admin.mailer.gmail_connected', ['email' => $profile['emailAddress'] ?? 'unknown'])
            ];
        }

        return ['success' => false, 'message' => __('admin.mailer.gmail_verify_failed')];
    }

    /**
     * Get current email provider type ('smtp', 'gmail_api', or 'postmark').
     */
    public function getProviderType(): string
    {
        return $this->driver;
    }

    /**
     * Sanitize a value used in email headers to prevent header injection.
     *
     * Strips carriage returns and line feeds which could be used to inject
     * additional headers (e.g., BCC, additional To, or arbitrary headers).
     */
    private static function sanitizeHeaderValue(string $value): string
    {
        return str_replace(["\r", "\n", "\0"], '', $value);
    }
}
