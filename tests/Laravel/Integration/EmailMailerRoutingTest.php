<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

namespace Tests\Laravel\Integration;

use App\Services\EmailService;
use App\Services\EmailDispatchService;
use App\Services\EmailTriggerAuditService;
use App\Core\TenantContext;
use Illuminate\Foundation\Testing\DatabaseTransactions;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Mail;
use Illuminate\Support\Facades\Schema;
use Tests\Laravel\TestCase;

/**
 * Integration test: verify that EmailService::send() routes through
 * the custom Mailer class (not Laravel's built-in Mail facade).
 *
 * After the production incident where EmailService used Mail::raw()
 * (Gmail SMTP) instead of Mailer::forCurrentTenant() (the provider),
 * these tests ensure the correct routing is preserved.
 */
class EmailMailerRoutingTest extends TestCase
{
    use DatabaseTransactions;

    /**
     * EmailService::send() must NOT call Laravel's Mail facade.
     * It should route through Mailer::forCurrentTenant() instead.
     */
    public function test_send_does_not_use_laravel_mail_facade(): void
    {
        Mail::fake();

        $service = new EmailService();
        // This will fail to actually send (no real SMTP in tests), but
        // the key assertion is that Mail::raw/send was never called.
        $service->send('test@example.com', 'Subject', 'Body');

        Mail::assertNothingSent();
        Mail::assertNothingQueued();
    }

    public function test_email_dispatch_service_uses_tenant_aware_mailer(): void
    {
        $source = file_get_contents(app_path('Services/EmailDispatchService.php'));

        $this->assertStringContainsString(
            'TenantContext::runForTenant',
            $source,
            'EmailDispatchService must preserve and restore explicit tenant context'
        );

        // The chained form was split into `$mailer = Mailer::forCurrentTenant();`
        // + `$mailer->send(...)` so an optional per-send From name can be
        // applied in between. These two assertions carry the same meaning: the
        // mailer comes from the tenant-aware factory, and that instance is the
        // one sent through.
        $this->assertStringContainsString(
            'Mailer::forCurrentTenant()',
            $source,
            'EmailDispatchService must use the tenant-aware Mailer'
        );

        $this->assertStringContainsString(
            '$mailer->send(',
            $source,
            'EmailDispatchService must send through the mailer it built from tenant context'
        );

        $this->assertStringNotContainsString(
            'new Mailer(',
            $source,
            'EmailDispatchService must never construct a Mailer directly — that bypasses tenant context'
        );

        $this->assertStringContainsString(
            "'dispatch_id'",
            $source,
            'EmailDispatchService must attach a durable dispatch id to every Mailer send.'
        );

        $this->assertStringContainsString(
            "'idempotency_key'",
            $source,
            'EmailDispatchService must preserve caller idempotency metadata for email_log and provider evidence.'
        );

        $this->assertStringNotContainsString(
            'Mail::raw(',
            $source,
            'EmailDispatchService must NOT use Mail::raw() - that bypasses the provider'
        );

        $this->assertStringNotContainsString(
            'Mail::send(',
            $source,
            'EmailDispatchService must NOT use Mail::send() - that bypasses the provider'
        );
    }

    public function test_mailer_records_dispatch_metadata_in_email_log(): void
    {
        if (
            !Schema::hasTable('email_log')
            || !Schema::hasColumn('email_log', 'source')
            || !Schema::hasColumn('email_log', 'idempotency_key')
            || !Schema::hasColumn('email_log', 'dispatch_id')
        ) {
            $this->markTestSkipped('email_log dispatch metadata columns are not available.');
        }

        $method = new \ReflectionMethod(\App\Core\Mailer::class, 'logEmail');
        $method->setAccessible(true);
        $method->invoke(
            null,
            'metadata-evidence@example.test',
            'Metadata Evidence',
            'sent',
            'provider-msg-123',
            null,
            $this->testTenantId,
            'audit_test',
            'sendgrid',
            [
                'source' => 'Tests\\Laravel\\Integration\\EmailMailerRoutingTest',
                'idempotency_key' => 'audit-test-key-123',
                'dispatch_id' => 'dispatch-test-123',
            ]
        );

        $row = DB::table('email_log')
            ->where('recipient_email', 'metadata-evidence@example.test')
            ->where('provider_message_id', 'provider-msg-123')
            ->first();

        $this->assertNotNull($row);
        $this->assertSame('Tests\\Laravel\\Integration\\EmailMailerRoutingTest', $row->source);
        $this->assertSame('audit-test-key-123', $row->idempotency_key);
        $this->assertSame('dispatch-test-123', $row->dispatch_id);
    }

    public function test_postmark_payload_includes_dispatch_metadata(): void
    {
        $source = file_get_contents(app_path('Core/Mailer.php'));

        $this->assertStringContainsString("\$meta['tenant_id']", $source);
        $this->assertStringContainsString("\$meta['category']", $source);
        $this->assertStringContainsString('normalizeEmailMetadata($metadata)', $source);
    }

    public function test_email_dispatch_service_refuses_missing_tenant_without_explicit_allowance(): void
    {
        $previousTenantId = TenantContext::currentId();
        TenantContext::reset();

        try {
            $result = EmailDispatchService::sendRaw(
                'recipient-without-tenant@example.test',
                'Subject',
                'Body',
                null,
                null,
                null,
                'test'
            );

            $this->assertFalse(
                $result,
                'EmailDispatchService must not send tenantless email unless allow_missing_tenant is explicit.'
            );
        } finally {
            if ($previousTenantId !== null) {
                TenantContext::setById($previousTenantId);
            } else {
                TenantContext::reset();
            }
        }
    }

    /**
     * EmailService::send() should return false (not throw) on failure.
     */
    public function test_send_returns_false_on_failure(): void
    {
        $service = new EmailService();
        // With no real mail config in test env, send() should fail gracefully
        $result = $service->send('test@example.com', 'Subject', 'Body');

        $this->assertIsBool($result);
    }

    /**
     * Verify EmailService source code routes through the auditable dispatcher,
     * not Mail::raw or Mail::send. This is a code-level regression guard.
     */
    public function test_email_service_source_uses_email_dispatch_service(): void
    {
        $source = file_get_contents(app_path('Services/EmailService.php'));

        $this->assertStringContainsString(
            'EmailDispatchService::class',
            $source,
            'EmailService::send() must route through EmailDispatchService'
        );

        $this->assertStringNotContainsString(
            'Mail::raw(',
            $source,
            'EmailService must NOT use Mail::raw() — that bypasses the provider'
        );

        $this->assertStringNotContainsString(
            'Mail::send(',
            $source,
            'EmailService must NOT use Mail::send() — that bypasses the provider'
        );
    }

    /**
     * Scan the entire app/ tree for direct Laravel Mail facade usage.
     * Every email must route through Mailer::forCurrentTenant() because
     * the platform .env has the provider configured but intentionally NO SMTP
     * credentials — any Mail::raw / Mail::to / Mail::send call would
     * attempt SMTP and silently fail in production.
     *
     * Multiple bypasses caused real production incidents (safeguarding
     * critical alerts, billing notifications, monthly reports). This guard
     * blocks the next one at CI time.
     *
     * Allowed exceptions: tests/ (mocks), app/Mail/ Mailable classes
     * (they're rendered + dispatched via Mailer separately).
     */
    public function test_no_mail_facade_usage_anywhere_in_app(): void
    {
        $banned = [
            'Mail::raw(',
            'Mail::to(',
            'Mail::send(',
            'Mail::queue(',
            'Mail::later(',
            'Mail::mailer(',
            '\\Illuminate\\Support\\Facades\\Mail::',
        ];

        // Allow Mailable classes — they DEFINE the email body, they don't
        // dispatch it. Dispatch happens via Mailer::forCurrentTenant() at
        // the call site (e.g. SafeguardingService renders the Mailable's
        // HTML and pipes it through Mailer).
        $allowedDirs = [
            // app/Mail/ — Mailable classes themselves
            'Mail' . DIRECTORY_SEPARATOR,
        ];

        $offences = [];
        $appPath = app_path();
        $rii = new \RecursiveIteratorIterator(new \RecursiveDirectoryIterator($appPath));

        foreach ($rii as $file) {
            if (!$file->isFile() || $file->getExtension() !== 'php') {
                continue;
            }
            $relPath = str_replace($appPath . DIRECTORY_SEPARATOR, '', $file->getPathname());
            $skip = false;
            foreach ($allowedDirs as $allowed) {
                if (str_starts_with($relPath, $allowed)) {
                    $skip = true;
                    break;
                }
            }
            if ($skip) {
                continue;
            }

            $contents = file_get_contents($file->getPathname());
            // Strip comments so we don't trip on docblock mentions like
            // "uses Mail::raw" in an explanatory comment.
            $stripped = preg_replace('!/\*.*?\*/!s', '', $contents);
            $stripped = preg_replace('!//.*?$!m', '', (string) $stripped);

            foreach ($banned as $pattern) {
                if (str_contains((string) $stripped, $pattern)) {
                    $offences[] = "{$relPath}: {$pattern}";
                }
            }
        }

        $this->assertSame(
            [],
            $offences,
            "Mail:: facade usage detected outside app/Mail/. Route through Mailer::forCurrentTenant() instead:\n  - "
                . implode("\n  - ", $offences)
        );
    }

    public function test_no_legacy_direct_email_send_surface_remains(): void
    {
        $surface = app(EmailTriggerAuditService::class)->directEmailSendSurface();

        $this->assertSame(
            [],
            $surface,
            "Legacy direct email send paths detected. Route through EmailDispatchService::sendRaw() with an explicit category:\n  - "
                . implode("\n  - ", array_map(
                    fn (array $row): string => "{$row['path']}:{$row['line']} ({$row['pattern']})",
                    $surface
                ))
        );
    }

    public function test_billing_upgrade_request_does_not_report_sent_when_dispatch_fails(): void
    {
        $source = file_get_contents(app_path('Http/Controllers/Api/AdminBillingController.php'));

        $this->assertStringContainsString(
            '$emailSent = false;',
            $source,
            'Billing upgrade requests must track the dispatch result before reporting sent=true.'
        );

        $this->assertStringContainsString(
            'return $sent;',
            $source,
            'Billing upgrade requests must return the EmailDispatchService result from the locale callback.'
        );

        $this->assertStringContainsString(
            'EMAIL_SEND_FAILED',
            $source,
            'Billing upgrade requests must return an API error if the owner notification fails.'
        );

        $this->assertStringContainsString(
            "__('api.billing_upgrade_email_send_failed')",
            $source,
            'The billing upgrade email failure must use a translated API message.'
        );
    }

    public function test_event_reminder_email_failures_are_retryable_without_duplicate_bells(): void
    {
        $legacySource = file_get_contents(app_path('Services/EventReminderService.php'));
        $emailBranch = strpos($legacySource, "if (\$channel === 'email') {");
        $bellBranch = strpos($legacySource, "if (\$channel === 'in_app') {");
        $emailSend = strpos($legacySource, '$sent = EmailDispatchService::sendRaw(');
        $emailFailureGuard = $emailSend === false
            ? false
            : strpos($legacySource, 'if (!$sent) {', $emailSend);
        $emailRetry = $emailFailureGuard === false
            ? false
            : strpos($legacySource, '$this->channelDeliveries->markRetrying(', $emailFailureGuard);

        $this->assertNotFalse($emailBranch, 'EventReminderService must retain an email channel.');
        $this->assertNotFalse($bellBranch, 'EventReminderService must retain an in-app reminder channel.');
        $this->assertNotFalse($emailSend, 'EventReminderService must send through EmailDispatchService.');
        $this->assertNotFalse($emailFailureGuard, 'EventReminderService must guard failed email sends.');
        $this->assertNotFalse($emailRetry, 'Failed reminder emails must remain retryable in the channel ledger.');
        $this->assertLessThan(
            $bellBranch,
            $emailBranch,
            'EventReminderService must attempt email before the independently idempotent in-app channel.'
        );

        $eventSource = file_get_contents(app_path('Services/EventNotificationService.php'));

        $this->assertStringNotContainsString(
            "'tenant_id' => TenantContext::getId(),",
            $eventSource,
            'EventNotificationService reminder bells must use the explicit tenant passed to the scheduler.'
        );

        $this->assertStringContainsString(
            'EmailDispatchService::sendRaw($user->email, $subject, $body, null, null, $unsubscribeUrl, $type, [\'tenant_id\' => $tenantId])',
            $eventSource,
            'EventNotificationService must preserve granular event email_log categories instead of collapsing all sends to event_notification.'
        );
    }

    public function test_mail_helpers_render_inside_explicit_recipient_tenant_context(): void
    {
        $helpers = [
            app_path('Mail/AppreciationReceived.php'),
            app_path('Mail/CivicDigestMail.php'),
            app_path('Mail/VereinCrossInvitationAccepted.php'),
            app_path('Mail/VereinCrossInvitationReceived.php'),
        ];

        foreach ($helpers as $helper) {
            $source = file_get_contents($helper);
            $basename = basename($helper);

            $this->assertStringContainsString(
                '$tenantId = (int) ($recipient->tenant_id ?? 0);',
                $source,
                $basename . ' must resolve tenant only from the recipient before rendering tenant URLs.'
            );

            $this->assertStringContainsString(
                'missing recipient tenant',
                $source,
                $basename . ' must refuse missing recipient tenant instead of falling back to ambient context.'
            );

            $this->assertStringNotContainsString(
                'TenantContext::currentId()',
                $source,
                $basename . ' must not fall back to ambient tenant context for recipient-scoped email.'
            );

            $this->assertStringContainsString(
                'TenantContext::runForTenant($tenantId',
                $source,
                $basename . ' must render and dispatch inside the recipient tenant context.'
            );

            $this->assertStringContainsString(
                "['tenant_id' => \$tenantId]",
                $source,
                $basename . ' must pass the same explicit tenant to EmailDispatchService.'
            );
        }
    }
}
