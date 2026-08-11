<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

namespace App\Services;

use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Log;
use Illuminate\Support\Facades\Cache;

/**
 * EmailMonitorService — Tracks email delivery health metrics.
 *
 * Records send success/failure, token refreshes, SMTP fallbacks, circuit breaker
 * events, and rate limit hits. Stores counters in Redis/cache for fast aggregation
 * and provides a health summary for the admin dashboard.
 *
 * Self-contained native Laravel implementation — no legacy delegation.
 */
class EmailMonitorService
{
    /** Cache key prefix for email monitoring counters. */
    private const CACHE_PREFIX = 'email_monitor:';

    /** TTL for rolling counters (24 hours). */
    private const COUNTER_TTL_SECONDS = 86400;

    public function __construct()
    {
    }

    /**
     * Record an email send attempt (success or failure).
     *
     * Increments rolling counters in cache, keyed by provider and tenant.
     */
    public function recordEmailSend(string $provider, bool $success, ?int $tenantId = null): void
    {
        static::recordEmailSendStatic($provider, $success, $tenantId);
    }

    /**
     * Static proxy for recordEmailSend — used by code that cannot inject an instance.
     */
    public static function recordEmailSendStatic(string $provider, bool $success, ?int $tenantId = null): void
    {
        try {
            $scope = $tenantId ? "tenant:{$tenantId}" : 'global';
            $status = $success ? 'success' : 'failure';

            $keys = [
                self::CACHE_PREFIX . "{$scope}:{$provider}:{$status}",
                self::CACHE_PREFIX . "{$scope}:total:{$status}",
                self::CACHE_PREFIX . "{$scope}:{$provider}:total",
            ];

            foreach ($keys as $key) {
                $current = (int) Cache::get($key, 0);
                Cache::put($key, $current + 1, self::COUNTER_TTL_SECONDS);
            }

            // Also track the last send timestamp
            Cache::put(
                self::CACHE_PREFIX . "{$scope}:{$provider}:last_send",
                now()->toIso8601String(),
                self::COUNTER_TTL_SECONDS
            );

            if (!$success) {
                Cache::put(
                    self::CACHE_PREFIX . "{$scope}:{$provider}:last_failure",
                    now()->toIso8601String(),
                    self::COUNTER_TTL_SECONDS
                );
            }
        } catch (\Throwable $e) {
            // Non-fatal — monitoring should never break sending
            Log::debug('EmailMonitorService::recordEmailSend error', ['error' => $e->getMessage()]);
        }
    }

    /**
     * Record an OAuth token refresh attempt (e.g. Gmail API).
     */
    public function recordTokenRefresh(bool $success, ?int $tenantId = null): void
    {
        static::recordTokenRefreshStatic($success, $tenantId);
    }

    public static function recordTokenRefreshStatic(bool $success, ?int $tenantId = null): void
    {
        try {
            $scope = $tenantId ? "tenant:{$tenantId}" : 'global';
            $status = $success ? 'success' : 'failure';

            $key = self::CACHE_PREFIX . "{$scope}:token_refresh:{$status}";
            $current = (int) Cache::get($key, 0);
            Cache::put($key, $current + 1, self::COUNTER_TTL_SECONDS);

            Cache::put(
                self::CACHE_PREFIX . "{$scope}:token_refresh:last_attempt",
                now()->toIso8601String(),
                self::COUNTER_TTL_SECONDS
            );
        } catch (\Throwable $e) {
            Log::debug('EmailMonitorService::recordTokenRefresh error', ['error' => $e->getMessage()]);
        }
    }

    /**
     * Record a fallback from primary provider to SMTP.
     */
    public function recordFallbackToSmtp(string $reason, ?int $tenantId = null): void
    {
        static::recordFallbackToSmtpStatic($reason, $tenantId);
    }

    public static function recordFallbackToSmtpStatic(string $reason, ?int $tenantId = null): void
    {
        try {
            $scope = $tenantId ? "tenant:{$tenantId}" : 'global';

            $key = self::CACHE_PREFIX . "{$scope}:smtp_fallback:count";
            $current = (int) Cache::get($key, 0);
            Cache::put($key, $current + 1, self::COUNTER_TTL_SECONDS);

            Cache::put(
                self::CACHE_PREFIX . "{$scope}:smtp_fallback:last_reason",
                $reason,
                self::COUNTER_TTL_SECONDS
            );

            Cache::put(
                self::CACHE_PREFIX . "{$scope}:smtp_fallback:last_at",
                now()->toIso8601String(),
                self::COUNTER_TTL_SECONDS
            );
        } catch (\Throwable $e) {
            Log::debug('EmailMonitorService::recordFallbackToSmtp error', ['error' => $e->getMessage()]);
        }
    }

    /**
     * Record a circuit breaker open event (provider considered unreliable).
     */
    public function recordCircuitBreakerOpen(?int $tenantId = null): void
    {
        static::recordCircuitBreakerOpenStatic($tenantId);
    }

    public static function recordCircuitBreakerOpenStatic(?int $tenantId = null): void
    {
        try {
            $scope = $tenantId ? "tenant:{$tenantId}" : 'global';

            $key = self::CACHE_PREFIX . "{$scope}:circuit_breaker:opens";
            $current = (int) Cache::get($key, 0);
            Cache::put($key, $current + 1, self::COUNTER_TTL_SECONDS);

            Cache::put(
                self::CACHE_PREFIX . "{$scope}:circuit_breaker:last_opened",
                now()->toIso8601String(),
                self::COUNTER_TTL_SECONDS
            );
        } catch (\Throwable $e) {
            Log::debug('EmailMonitorService::recordCircuitBreakerOpen error', ['error' => $e->getMessage()]);
        }
    }

    /**
     * Record a rate limit hit event.
     */
    public function recordRateLimitHit(?int $tenantId = null): void
    {
        static::recordRateLimitHitStatic($tenantId);
    }

    public static function recordRateLimitHitStatic(?int $tenantId = null): void
    {
        try {
            $scope = $tenantId ? "tenant:{$tenantId}" : 'global';

            $key = self::CACHE_PREFIX . "{$scope}:rate_limit:hits";
            $current = (int) Cache::get($key, 0);
            Cache::put($key, $current + 1, self::COUNTER_TTL_SECONDS);

            Cache::put(
                self::CACHE_PREFIX . "{$scope}:rate_limit:last_hit",
                now()->toIso8601String(),
                self::COUNTER_TTL_SECONDS
            );
        } catch (\Throwable $e) {
            Log::debug('EmailMonitorService::recordRateLimitHit error', ['error' => $e->getMessage()]);
        }
    }

    /**
     * Get email health summary for the admin dashboard.
     *
     * Aggregates rolling counters from cache for the given tenant (or globally).
     *
     * @return array{
     *     total_sent: int,
     *     total_failed: int,
     *     success_rate: float,
     *     providers: array<string, array{sent: int, failed: int, total: int, last_send: ?string, last_failure: ?string}>,
     *     token_refreshes: array{success: int, failure: int, last_attempt: ?string},
     *     smtp_fallbacks: array{count: int, last_reason: ?string, last_at: ?string},
     *     circuit_breaker: array{opens: int, last_opened: ?string},
     *     rate_limits: array{hits: int, last_hit: ?string},
     *     period: string,
     * }
     */
    public function getHealthSummary(?int $tenantId = null): array
    {
        try {
            $scope = $tenantId ? "tenant:{$tenantId}" : 'global';
            $providers = ['gmail_api', 'postmark', 'smtp'];

            $totalSuccess = (int) Cache::get(self::CACHE_PREFIX . "{$scope}:total:success", 0);
            $totalFailure = (int) Cache::get(self::CACHE_PREFIX . "{$scope}:total:failure", 0);
            $totalSent = $totalSuccess + $totalFailure;

            $providerStats = [];
            foreach ($providers as $provider) {
                $pSuccess = (int) Cache::get(self::CACHE_PREFIX . "{$scope}:{$provider}:success", 0);
                $pFailure = (int) Cache::get(self::CACHE_PREFIX . "{$scope}:{$provider}:failure", 0);
                $pTotal = (int) Cache::get(self::CACHE_PREFIX . "{$scope}:{$provider}:total", 0);

                // Only include providers that have activity
                if ($pTotal > 0 || $pSuccess > 0 || $pFailure > 0) {
                    $providerStats[$provider] = [
                        'sent' => $pSuccess,
                        'failed' => $pFailure,
                        'total' => $pTotal ?: ($pSuccess + $pFailure),
                        'last_send' => Cache::get(self::CACHE_PREFIX . "{$scope}:{$provider}:last_send"),
                        'last_failure' => Cache::get(self::CACHE_PREFIX . "{$scope}:{$provider}:last_failure"),
                    ];
                }
            }

            return [
                'total_sent' => $totalSuccess,
                'total_failed' => $totalFailure,
                'success_rate' => $totalSent > 0 ? round(($totalSuccess / $totalSent) * 100, 1) : 100.0,
                'providers' => $providerStats,
                'token_refreshes' => [
                    'success' => (int) Cache::get(self::CACHE_PREFIX . "{$scope}:token_refresh:success", 0),
                    'failure' => (int) Cache::get(self::CACHE_PREFIX . "{$scope}:token_refresh:failure", 0),
                    'last_attempt' => Cache::get(self::CACHE_PREFIX . "{$scope}:token_refresh:last_attempt"),
                ],
                'smtp_fallbacks' => [
                    'count' => (int) Cache::get(self::CACHE_PREFIX . "{$scope}:smtp_fallback:count", 0),
                    'last_reason' => Cache::get(self::CACHE_PREFIX . "{$scope}:smtp_fallback:last_reason"),
                    'last_at' => Cache::get(self::CACHE_PREFIX . "{$scope}:smtp_fallback:last_at"),
                ],
                'circuit_breaker' => [
                    'opens' => (int) Cache::get(self::CACHE_PREFIX . "{$scope}:circuit_breaker:opens", 0),
                    'last_opened' => Cache::get(self::CACHE_PREFIX . "{$scope}:circuit_breaker:last_opened"),
                ],
                'rate_limits' => [
                    'hits' => (int) Cache::get(self::CACHE_PREFIX . "{$scope}:rate_limit:hits", 0),
                    'last_hit' => Cache::get(self::CACHE_PREFIX . "{$scope}:rate_limit:last_hit"),
                ],
                'warnings' => $this->getWarnings($tenantId),
                'period' => 'rolling_24h',
            ];
        } catch (\Throwable $e) {
            Log::warning('EmailMonitorService::getHealthSummary error', ['error' => $e->getMessage()]);
            return [
                'total_sent' => 0,
                'total_failed' => 0,
                'success_rate' => 100.0,
                'providers' => [],
                'token_refreshes' => ['success' => 0, 'failure' => 0, 'last_attempt' => null],
                'smtp_fallbacks' => ['count' => 0, 'last_reason' => null, 'last_at' => null],
                'circuit_breaker' => ['opens' => 0, 'last_opened' => null],
                'rate_limits' => ['hits' => 0, 'last_hit' => null],
                'warnings' => [[
                    'code' => 'email_health_unavailable',
                    'severity' => 'warning',
                    'message_key' => 'email_health.warnings.unavailable',
                    'params' => ['error' => $e->getMessage()],
                ]],
                'period' => 'rolling_24h',
                'error' => 'Cache unavailable',
            ];
        }
    }

    /**
     * Build tenant-scoped email health warnings from durable tables.
     *
     * Returns translation keys + params so the admin UI can render localized
     * copy without hardcoded API strings.
     *
     * @return list<array{code:string,severity:string,message_key:string,params:array<string,mixed>}>
     */
    public function getWarnings(?int $tenantId = null): array
    {
        $warnings = [];

        try {
            if (!\Illuminate\Support\Facades\Schema::hasTable('email_log')) {
                return [[
                    'code' => 'email_log_missing',
                    'severity' => 'critical',
                    'message_key' => 'email_health.warnings.email_log_missing',
                    'params' => [],
                ]];
            }

            $logQuery = DB::table('email_log');
            if ($tenantId !== null) {
                $logQuery->where('tenant_id', $tenantId);
            }

            $last24h = (clone $logQuery)
                ->where('created_at', '>=', now()->subDay())
                ->select('status', DB::raw('COUNT(*) as count'))
                ->groupBy('status')
                ->pluck('count', 'status');

            $sent = (int) ($last24h['sent'] ?? 0);
            $delivered = (int) ($last24h['delivered'] ?? 0);
            $failed = (int) ($last24h['failed'] ?? 0);
            $bounced = (int) ($last24h['bounced'] ?? 0);
            $suppressed = (int) ($last24h['suppressed'] ?? 0);

            // 🔴 `suppressed` is NOT a delivery failure. It means the suppression
            // list did its job and we deliberately did not send. Counting it as a
            // failure raised a CRITICAL alarm every hour, for ever, on any tenant
            // with a suppressed address on a recurring digest — and because the
            // rate is a share of a small denominator, three demo addresses on a
            // quiet day read as "100% failure". Real failures only.
            $attempted = $sent + $delivered + $failed + $bounced;
            $bad = $failed + $bounced;

            if ($bad > 0) {
                $rate = $attempted > 0 ? round(($bad / $attempted) * 100, 1) : 100.0;
                $warnings[] = [
                    'code' => 'recent_email_failures',
                    'severity' => ($bad >= 5 || $rate >= 25.0) ? 'critical' : 'warning',
                    'message_key' => 'email_health.warnings.recent_email_failures',
                    'params' => ['count' => $bad, 'rate' => $rate, 'window_hours' => 24],
                ];
            }

            if ($suppressed > 0) {
                // Reported separately so it still shows in the admin health view.
                // `info` is filtered out before alerting (EmailHealthAlert), so a
                // handful of suppressed demo addresses stays quiet — but a
                // domain-wide block, which shows up as a high count AND a high
                // share of all mail, still escalates to a real warning.
                $suppressionShare = ($attempted + $suppressed) > 0
                    ? round(($suppressed / ($attempted + $suppressed)) * 100, 1)
                    : 100.0;

                $warnings[] = [
                    'code' => 'recent_email_suppressions',
                    'severity' => ($suppressed >= 10 && $suppressionShare >= 25.0) ? 'warning' : 'info',
                    'message_key' => 'email_health.warnings.recent_email_suppressions',
                    'params' => [
                        'count' => $suppressed,
                        'rate' => $suppressionShare,
                        'window_hours' => 24,
                    ],
                ];
            }

            $criticalCategories = [
                'activation',
                'admin_new_registration',
                'admin_welcome',
                'approval',
                'email_verification',
                'identity_verification',
                'password_reset',
                'security_alert',
                'welcome',
            ];

            $criticalFailures = (clone $logQuery)
                ->where('created_at', '>=', now()->subDay())
                ->whereIn('category', $criticalCategories)
                ->whereIn('status', ['failed', 'suppressed', 'bounced'])
                ->count();

            if ($criticalFailures > 0) {
                $warnings[] = [
                    'code' => 'critical_email_failures',
                    'severity' => 'critical',
                    'message_key' => 'email_health.warnings.critical_email_failures',
                    'params' => ['count' => $criticalFailures, 'window_hours' => 24],
                ];
            }

            if (\Illuminate\Support\Facades\Schema::hasTable('notification_queue')) {
                $queue = DB::table('notification_queue');
                if ($tenantId !== null) {
                    $queue->where('tenant_id', $tenantId);
                }

                $failedQueue = (clone $queue)
                    ->where('status', 'failed')
                    ->where('created_at', '>=', now()->subDay())
                    ->count();
                if ($failedQueue > 0) {
                    $warnings[] = [
                        'code' => 'notification_queue_failures',
                        'severity' => 'warning',
                        'message_key' => 'email_health.warnings.notification_queue_failures',
                        'params' => ['count' => $failedQueue, 'window_hours' => 24],
                    ];
                }

                $suppressedQueue = (clone $queue)
                    ->where('status', 'suppressed')
                    ->where('created_at', '>=', now()->subDay())
                    ->count();
                if ($suppressedQueue > 0) {
                    $warnings[] = [
                        'code' => 'notification_queue_suppressed',
                        'severity' => 'warning',
                        'message_key' => 'email_health.warnings.notification_queue_suppressed',
                        'params' => ['count' => $suppressedQueue, 'window_hours' => 24],
                    ];
                }

                $staleProcessing = (clone $queue)
                    ->where('status', 'processing')
                    ->where('created_at', '<', now()->subMinutes(15))
                    ->count();
                if ($staleProcessing > 0) {
                    $warnings[] = [
                        'code' => 'notification_queue_stale_processing',
                        'severity' => 'critical',
                        'message_key' => 'email_health.warnings.notification_queue_stale_processing',
                        'params' => ['count' => $staleProcessing, 'minutes' => 15],
                    ];
                }
            }

            if (\Illuminate\Support\Facades\Schema::hasTable('newsletter_queue')) {
                $newsletterQueue = DB::table('newsletter_queue');
                if ($tenantId !== null && \Illuminate\Support\Facades\Schema::hasColumn('newsletter_queue', 'tenant_id')) {
                    $newsletterQueue->where('tenant_id', $tenantId);
                }

                $failedNewsletterQueue = (clone $newsletterQueue)
                    ->where('status', 'failed')
                    ->where('created_at', '>=', now()->subDay())
                    ->count();
                if ($failedNewsletterQueue > 0) {
                    $warnings[] = [
                        'code' => 'newsletter_queue_failures',
                        'severity' => 'warning',
                        'message_key' => 'email_health.warnings.newsletter_queue_failures',
                        'params' => ['count' => $failedNewsletterQueue, 'window_hours' => 24],
                    ];
                }

                $staleNewsletterProcessing = (clone $newsletterQueue)
                    ->where('status', 'processing')
                    ->where(function ($query) {
                        if (\Illuminate\Support\Facades\Schema::hasColumn('newsletter_queue', 'last_attempted_at')) {
                            $query->where('last_attempted_at', '<', now()->subMinutes(15))
                                ->orWhere(function ($nested) {
                                    $nested->whereNull('last_attempted_at')
                                        ->where('created_at', '<', now()->subMinutes(15));
                                });
                            return;
                        }

                        $query->where('created_at', '<', now()->subMinutes(15));
                    })
                    ->count();
                if ($staleNewsletterProcessing > 0) {
                    $warnings[] = [
                        'code' => 'newsletter_queue_stale_processing',
                        'severity' => 'critical',
                        'message_key' => 'email_health.warnings.newsletter_queue_stale_processing',
                        'params' => ['count' => $staleNewsletterProcessing, 'minutes' => 15],
                    ];
                }
            }

            if ($tenantId !== null && \Illuminate\Support\Facades\Schema::hasTable('users')) {
                $activeUsers = DB::table('users')
                    ->where('tenant_id', $tenantId)
                    ->whereNull('deleted_at')
                    ->whereIn('status', ['active', 'pending'])
                    ->count();

                $lastSendAt = (clone $logQuery)->max('created_at');
                if ($activeUsers > 0 && ($lastSendAt === null || strtotime((string) $lastSendAt) < now()->subDays(7)->getTimestamp())) {
                    $warnings[] = [
                        'code' => 'no_recent_email_activity',
                        'severity' => 'info',
                        'message_key' => 'email_health.warnings.no_recent_email_activity',
                        'params' => ['days' => 7],
                    ];
                }

                $newUsersMissingActivationLog = DB::table('users')
                    ->where('users.tenant_id', $tenantId)
                    ->whereNull('users.deleted_at')
                    ->where('users.created_at', '>=', now()->subDay())
                    ->whereNotExists(function ($q) use ($tenantId) {
                        $q->select(DB::raw(1))
                            ->from('email_log')
                            ->whereColumn('email_log.user_id', 'users.id')
                            ->where('email_log.tenant_id', $tenantId)
                            ->whereIn('email_log.category', ['activation', 'admin_welcome', 'approval', 'email_verification', 'identity_verification', 'welcome'])
                            ->whereColumn('email_log.created_at', '>=', 'users.created_at');
                    })
                    ->count();

                if ($newUsersMissingActivationLog > 0) {
                    $warnings[] = [
                        'code' => 'new_users_without_activation_email_log',
                        'severity' => 'critical',
                        'message_key' => 'email_health.warnings.new_users_without_activation_email_log',
                        'params' => ['count' => $newUsersMissingActivationLog, 'window_hours' => 24],
                    ];
                }
            }

            if (class_exists(EmailTriggerAuditService::class)) {
                $triggerAudit = app(EmailTriggerAuditService::class)->run($tenantId, 24);
                foreach (($triggerAudit['issues'] ?? []) as $issue) {
                    if (($issue['severity'] ?? 'info') === 'info') {
                        continue;
                    }
                    $warnings[] = [
                        'code' => (string) ($issue['code'] ?? 'email_trigger_issue'),
                        'severity' => (string) ($issue['severity'] ?? 'warning'),
                        'message_key' => (string) ($issue['message_key'] ?? 'email_health.warnings.email_trigger_issue'),
                        'params' => (array) ($issue['params'] ?? []),
                        'tenant_id' => $issue['tenant_id'] ?? $tenantId,
                        'module' => $issue['module'] ?? null,
                        'event' => $issue['event'] ?? null,
                    ];
                }
            }
        } catch (\Throwable $e) {
            Log::warning('EmailMonitorService::getWarnings error', ['error' => $e->getMessage()]);
            $warnings[] = [
                'code' => 'email_warning_check_failed',
                'severity' => 'warning',
                'message_key' => 'email_health.warnings.check_failed',
                'params' => ['error' => $e->getMessage()],
            ];
        }

        return $warnings;
    }
}
