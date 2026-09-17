<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

declare(strict_types=1);

namespace App\Services;

use App\Core\Mailer;
use App\Core\TenantContext;
use Illuminate\Support\Str;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Log;

/**
 * Central raw email send path.
 *
 * NotificationDispatcher remains the preferred business-event dispatcher. This
 * service is the narrow escape hatch for legacy/raw HTML emails while those
 * paths are migrated: it preserves tenant context, records missing categories,
 * and treats false returns as audit-worthy failures.
 */
class EmailDispatchService
{
    /**
     * Recipient domain suffixes that can never receive mail, so a send to one
     * is a guaranteed hard bounce rather than a delivery attempt.
     *
     * .test / .invalid / .example / .localhost are reserved by RFC 2606 and
     * .local by mDNS (RFC 6762): none of them resolve in public DNS, ever.
     * anonymized.local is listed explicitly because it is what the GDPR
     * erasure routine writes into users.email (see GdprService), and it is the
     * suffix that actually produced hard bounces in production.
     *
     * Hard bounces are charged against the sending domain's reputation, which
     * is why this is refused up front rather than left to the provider.
     */
    public const UNROUTABLE_RECIPIENT_SUFFIXES = [
        'test',
        'local',
        'invalid',
        'example',
        'localhost',
        'anonymized.local',
    ];

    /**
     * True when the recipient's domain is, or sits under, a reserved suffix
     * that has no public DNS. Case-insensitive; a malformed address (no '@',
     * empty domain) is also treated as unroutable.
     */
    public static function isUnroutableRecipient(string $email): bool
    {
        $parts = explode('@', trim($email));
        if (count($parts) < 2) {
            return true;
        }

        $domain = mb_strtolower(trim(rtrim((string) array_pop($parts), '.')));
        if ($domain === '') {
            return true;
        }

        foreach (self::UNROUTABLE_RECIPIENT_SUFFIXES as $suffix) {
            if ($domain === $suffix || str_ends_with($domain, '.' . $suffix)) {
                return true;
            }
        }

        return false;
    }

    public static function sendRaw(
        string $to,
        string $subject,
        string $body,
        ?string $cc = null,
        ?string $replyTo = null,
        ?string $unsubscribeUrl = null,
        ?string $category = null,
        array $options = []
    ): bool {
        $options['cc'] = $cc;
        $options['replyTo'] = $replyTo;
        $options['unsubscribeUrl'] = $unsubscribeUrl;
        $options['category'] = $category;
        $options['source'] ??= 'EmailDispatchService::sendRaw';

        return app(self::class)->send($to, $subject, $body, $options);
    }

    /**
     * Compatibility helper for legacy app(EmailService::class)->send(...)
     * paths. New business events should use NotificationDispatcher.
     *
     * @param array<string,mixed> $options
     */
    public static function sendWithOptions(string $to, string $subject, string $body, array $options = []): bool
    {
        $options['source'] ??= 'EmailDispatchService::sendWithOptions';

        return app(self::class)->send($to, $subject, $body, $options);
    }

    /**
     * @param array{
     *   cc?:string|null,
     *   replyTo?:string|null,
     *   unsubscribeUrl?:string|null,
     *   category?:string|null,
     *   tenant_id?:int|null,
     *   tenantId?:int|null,
     *   allow_missing_tenant?:bool,
     *   source?:string|null,
     *   idempotency_key?:string|null,
     *   idempotencyKey?:string|null,
     *   dispatch_id?:string|null,
     *   dispatchId?:string|null,
     *   fromName?:string|null,
     *   from_name?:string|null
     * } $options
     */
    public function send(string $to, string $subject, string $body, array $options = []): bool
    {
        $category = trim((string) ($options['category'] ?? ''));
        $source = (string) ($options['source'] ?? 'EmailDispatchService');

        // Refuse structurally undeliverable recipients before anything else —
        // before tenant resolution, before the mailer, before a provider call.
        // Seeded demo members live on @partner-demo.test and erased users on
        // @anonymized.local; both were being mailed for real and every one of
        // those attempts came back as a hard bounce. Logged at info, not
        // warning: this is expected, self-healing behaviour, not an incident.
        if (self::isUnroutableRecipient($to)) {
            Log::info('EmailDispatchService::send refused unroutable recipient domain', [
                'source' => $source,
                'category' => $category !== '' ? $category : null,
                'to' => $this->maskEmail($to),
            ]);

            return false;
        }

        $tenantId = $this->resolveTenantId($options, $to);
        $allowMissingTenant = (bool) ($options['allow_missing_tenant'] ?? false);
        $dispatchId = trim((string) ($options['dispatch_id'] ?? $options['dispatchId'] ?? ''));
        if ($dispatchId === '') {
            $dispatchId = (string) Str::uuid();
        }
        $idempotencyKey = trim((string) ($options['idempotency_key'] ?? $options['idempotencyKey'] ?? ''));
        $metadata = [
            'source' => $source,
            'idempotency_key' => $idempotencyKey !== '' ? $idempotencyKey : null,
            'dispatch_id' => $dispatchId,
        ];

        if ($category === '') {
            Log::warning('EmailDispatchService::send called without category', [
                'tenant_id' => $tenantId,
                'source' => $source,
                'to' => $this->maskEmail($to),
            ]);
        }

        if ($tenantId === null && !$allowMissingTenant) {
            Log::error('EmailDispatchService::send refused missing tenant context', [
                'source' => $source,
                'category' => $category !== '' ? $category : null,
                'to' => $this->maskEmail($to),
            ]);
            return false;
        }

        if ($tenantId === null) {
            Log::warning('EmailDispatchService::send running intentional tenantless send', [
                'source' => $source,
                'category' => $category !== '' ? $category : null,
                'to' => $this->maskEmail($to),
            ]);
        }

        try {
            return (bool) $this->runWithResolvedTenant($tenantId, function () use ($to, $subject, $body, $options, $category, $tenantId, $source, $metadata): bool {
                $textBody = $options['textBody'] ?? null;

                // Optional per-send From display name. Only callers that own
                // their own sender identity set it; with none passed the
                // mailer keeps the tenant / platform default exactly as before.
                $mailer = Mailer::forCurrentTenant();
                $fromName = trim((string) ($options['fromName'] ?? $options['from_name'] ?? ''));
                if ($fromName !== '') {
                    $mailer->withFromName($fromName);
                }

                $sent = $mailer->send(
                    $to,
                    $subject,
                    $body,
                    $options['cc'] ?? null,
                    $options['replyTo'] ?? null,
                    $options['unsubscribeUrl'] ?? null,
                    $category !== '' ? $category : null,
                    $metadata,
                    $textBody !== null ? (string) $textBody : null,
                );

                if (!$sent) {
                    Log::warning('EmailDispatchService::send returned false', [
                        'tenant_id' => $tenantId,
                        'source' => $source,
                        'category' => $category !== '' ? $category : null,
                        'to' => $this->maskEmail($to),
                    ]);
                }

                return $sent;
            });
        } catch (\Throwable $e) {
            Log::error('EmailDispatchService::send failed', [
                'tenant_id' => $tenantId,
                'source' => $source,
                'category' => $category !== '' ? $category : null,
                'to' => $this->maskEmail($to),
                'error' => $e->getMessage(),
            ]);
            return false;
        }
    }

    /**
     * @param array<string,mixed> $options
     */
    private function resolveTenantId(array $options, string $to): ?int
    {
        $tenantId = $options['tenant_id'] ?? $options['tenantId'] ?? null;
        $allowMissingTenant = (bool) ($options['allow_missing_tenant'] ?? false);

        if ($tenantId !== null && $tenantId !== '') {
            return (int) $tenantId;
        }

        if (array_key_exists('tenant_id', $options) || array_key_exists('tenantId', $options)) {
            if ($allowMissingTenant) {
                return null;
            }

            return null;
        }

        $contextTenantId = TenantContext::currentId();
        $recipientTenantIds = $this->resolveTenantIdsFromRecipientEmail($to);

        if (count($recipientTenantIds) === 1) {
            $recipientTenantId = (int) $recipientTenantIds[0];
            if ($contextTenantId !== null && (int) $contextTenantId !== $recipientTenantId) {
                Log::warning('EmailDispatchService::send tenant context differed from unique recipient tenant', [
                    'context_tenant_id' => (int) $contextTenantId,
                    'recipient_tenant_id' => $recipientTenantId,
                    'to' => $this->maskEmail($to),
                ]);
            }

            return $recipientTenantId;
        }

        if (count($recipientTenantIds) > 1) {
            if ($contextTenantId !== null && in_array((int) $contextTenantId, $recipientTenantIds, true)) {
                return (int) $contextTenantId;
            }

            Log::warning('EmailDispatchService::send could not infer tenant because recipient email exists in multiple tenants', [
                'to' => $this->maskEmail($to),
                'tenant_ids' => $recipientTenantIds,
            ]);
        }

        if ($allowMissingTenant) {
            return null;
        }

        return $contextTenantId !== null ? (int) $contextTenantId : null;
    }

    /**
     * Run the actual send under the resolved tenant. A null tenant means an
     * intentional platform/pre-tenant send; clear any leaked worker/request
     * tenant while the message is rendered and logged, then restore it.
     *
     * @template T
     * @param callable():T $callback
     * @return T
     */
    private function runWithResolvedTenant(?int $tenantId, callable $callback)
    {
        if ($tenantId !== null) {
            return TenantContext::runForTenant($tenantId, $callback);
        }

        return TenantContext::runForTenant(null, function () use ($callback) {
            TenantContext::reset();

            return $callback();
        });
    }

    /**
     * @return list<int>
     */
    private function resolveTenantIdsFromRecipientEmail(string $email): array
    {
        try {
            $tenantIds = DB::table('users')
                ->whereRaw('LOWER(email) = ?', [mb_strtolower($email)])
                ->whereNull('deleted_at')
                ->distinct()
                ->pluck('tenant_id')
                ->filter(fn ($tenantId): bool => $tenantId !== null)
                ->map(fn ($tenantId): int => (int) $tenantId)
                ->values();

            return $tenantIds->all();
        } catch (\Throwable $e) {
            Log::warning('EmailDispatchService::send tenant inference failed', [
                'to' => $this->maskEmail($email),
                'error' => $e->getMessage(),
            ]);
        }

        return [];
    }

    private function maskEmail(string $email): string
    {
        $parts = explode('@', $email, 2);
        if (count($parts) !== 2) {
            return '***';
        }

        $local = $parts[0];
        $masked = strlen($local) > 1 ? $local[0] . str_repeat('*', min(strlen($local) - 1, 5)) : '*';

        return $masked . '@' . $parts[1];
    }
}
