<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

namespace Tests\Laravel\Integration;

use App\Core\Mailer;
use Illuminate\Foundation\Testing\DatabaseTransactions;
use Illuminate\Support\Facades\DB;
use Tests\Laravel\TestCase;

final class RegistrationStaffMailerFallbackTest extends TestCase
{
    use DatabaseTransactions;

    public function test_ambiguous_primary_failure_never_falls_back_for_registration_staff_alert(): void
    {
        foreach (['postmark', 'gmail_api'] as $driver) {
            $mailer = $this->mailerFor($driver);
            $email = 'c1-no-fallback-' . $driver . '-' . uniqid() . '@project-nexus.testmail';

            $this->assertFalse($mailer->send(
                $email, 'Synthetic staff alert', '<p>synthetic</p>',
                null, null, null, 'admin_new_registration',
                ['source' => self::class, 'dispatch_id' => 'synthetic-' . uniqid()],
            ));
            $this->assertSame(1, $mailer->primaryCalls);
            $this->assertSame(0, $mailer->smtpCalls);
            $this->assertSame('failed', DB::table('email_log')
                ->where('recipient_email', $email)->value('status'));
        }
    }

    public function test_unrelated_mail_keeps_its_existing_smtp_fallback(): void
    {
        $mailer = $this->mailerFor('postmark');
        $email = 'other-fallback-' . uniqid() . '@project-nexus.testmail';

        $this->assertTrue($mailer->send($email, 'Synthetic other mail', '<p>synthetic</p>',
            null, null, null, 'audit_test', ['source' => self::class]));
        $this->assertSame(1, $mailer->primaryCalls);
        $this->assertSame(1, $mailer->smtpCalls);
        $this->assertSame('sent', DB::table('email_log')->where('recipient_email', $email)->value('status'));
    }

    private function mailerFor(string $driver): SyntheticPrimaryFailureMailer
    {
        $mailer = new SyntheticPrimaryFailureMailer($this->testTenantId);
        $reflection = new \ReflectionClass(Mailer::class);
        foreach (['driver' => $driver, 'host' => 'synthetic-smtp', 'username' => 'synthetic-user'] as $name => $value) {
            $reflection->getProperty($name)->setValue($mailer, $value);
        }
        return $mailer;
    }
}

final class SyntheticPrimaryFailureMailer extends Mailer
{
    public int $primaryCalls = 0;
    public int $smtpCalls = 0;

    protected function sendViaPostmark($to, $subject, $body, $cc = null, $replyTo = null, ?string $unsubscribeUrl = null, ?string $category = null, ?array $metadata = null, ?string $textBody = null): bool
    {
        $this->primaryCalls++;
        return false; // Transport timed out after a possible provider accept.
    }

    protected function sendViaGmailApi($to, $subject, $body, $cc = null, $replyTo = null, ?string $unsubscribeUrl = null, ?string $textBody = null)
    {
        $this->primaryCalls++;
        return false;
    }

    protected function sendViaSmtp($to, $subject, $body, $cc = null, $replyTo = null, ?string $unsubscribeUrl = null, ?string $textBody = null)
    {
        $this->smtpCalls++;
        return true;
    }
}
