<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

namespace Tests\Laravel\Unit\Services;

use Tests\Laravel\TestCase;
use App\Core\TenantContext;
use App\Services\EmailDispatchService;
use App\Services\JobAlertEmailService;
use App\Models\JobAlert;
use App\Models\JobVacancy;
use App\Models\User;
use Illuminate\Support\Facades\Log;

/**
 * @runTestsInSeparateProcesses
 * @preserveGlobalState disabled
 */
class JobAlertEmailServiceTest extends TestCase
{
    // ── sendImmediateAlert ──────────────────────────────────────

    public function test_sendImmediateAlert_sends_email_and_returns_true(): void
    {
        $mailer = $this->fakeEmailDispatchService();
        $recipient = $this->makeUser(5, 'jane@example.com', 'Jane', 'Doe');
        $vacancy = $this->makeVacancy(10, 'Senior Developer');
        $alert = $this->makeAlert();

        $result = JobAlertEmailService::sendImmediateAlert($recipient, $vacancy, $alert);
        $this->assertTrue($result);
        $this->assertCount(1, $mailer->sends);
        $this->assertSame('jane@example.com', $mailer->sends[0]['to']);
        $this->assertSame('job_alert', $mailer->sends[0]['options']['category']);
        $this->assertSame($this->testTenantId, $mailer->sends[0]['options']['tenant_id']);
    }

    public function test_sendImmediateAlert_subject_includes_job_title(): void
    {
        $mailer = $this->fakeEmailDispatchService();
        $recipient = $this->makeUser(5, 'jane@example.com', 'Jane');
        $vacancy = $this->makeVacancy(10, 'Backend Engineer');
        $alert = $this->makeAlert();

        $result = JobAlertEmailService::sendImmediateAlert($recipient, $vacancy, $alert);
        $this->assertTrue($result);
        $this->assertStringContainsString('Backend Engineer', $mailer->sends[0]['subject']);
    }

    public function test_sendImmediateAlert_localises_role_commitment_and_date_for_irish_recipient(): void
    {
        $mailer = $this->fakeEmailDispatchService();
        $recipient = $this->makeUser(5, 'sean@example.com', 'Seán');
        $recipient->preferred_language = 'ga';
        $vacancy = $this->makeVacancy(10, 'Forbróir Sinsearach');
        $alert = $this->makeAlert();

        $result = JobAlertEmailService::sendImmediateAlert($recipient, $vacancy, $alert);

        $this->assertTrue($result);
        $this->assertStringContainsString('Post nua ag teacht le do fholáireamh', $mailer->sends[0]['subject']);
        $this->assertStringContainsString('Íoctha', $mailer->sends[0]['body']);
        $this->assertStringContainsString('Lánaimseartha', $mailer->sends[0]['body']);
        $this->assertStringContainsString('1 Méit 2026', $mailer->sends[0]['body']);
        $this->assertStringNotContainsString('Full time', $mailer->sends[0]['body']);
        $this->assertStringNotContainsString('01 Jun 2026', $mailer->sends[0]['body']);
    }

    public function test_sendImmediateAlert_returns_false_on_mail_exception(): void
    {
        Log::shouldReceive('warning')->once();
        $this->fakeEmailDispatchService(throws: true);

        $recipient = $this->makeUser(5, 'jane@example.com', 'Jane');
        $vacancy = $this->makeVacancy(10, 'Dev');
        $alert = $this->makeAlert();

        $result = JobAlertEmailService::sendImmediateAlert($recipient, $vacancy, $alert);
        $this->assertFalse($result);
    }

    // ── buildAlertEmailHtml ─────────────────────────────────────

    public function test_buildAlertEmailHtml_contains_recipient_name(): void
    {
        $recipient = $this->makeUser(5, 'jane@example.com', 'Jane');
        $vacancy = $this->makeVacancy(10, 'Developer');

        $html = JobAlertEmailService::buildAlertEmailHtml($recipient, [$vacancy]);
        $this->assertStringContainsString('Hi Jane', $html);
    }

    public function test_buildAlertEmailHtml_contains_job_title(): void
    {
        $recipient = $this->makeUser(5, 'jane@example.com', 'Jane');
        $vacancy = $this->makeVacancy(10, 'Full Stack Engineer');

        $html = JobAlertEmailService::buildAlertEmailHtml($recipient, [$vacancy]);
        $this->assertStringContainsString('Full Stack Engineer', $html);
    }

    public function test_buildAlertEmailHtml_contains_view_job_link(): void
    {
        $recipient = $this->makeUser(5, 'jane@example.com', 'Jane');
        $vacancy = $this->makeVacancy(10, 'Developer');

        $html = JobAlertEmailService::buildAlertEmailHtml($recipient, [$vacancy]);
        $this->assertStringContainsString('/jobs/10', $html);
        $this->assertStringContainsString('View Job', $html);
    }

    public function test_buildAlertEmailHtml_shows_correct_count_singular(): void
    {
        $recipient = $this->makeUser(5, 'jane@example.com', 'Jane');
        $vacancy = $this->makeVacancy(10, 'Developer');

        $html = JobAlertEmailService::buildAlertEmailHtml($recipient, [$vacancy]);
        $this->assertStringContainsString('1 new job matches', $html);
    }

    public function test_buildAlertEmailHtml_shows_correct_count_plural(): void
    {
        $recipient = $this->makeUser(5, 'jane@example.com', 'Jane');
        $v1 = $this->makeVacancy(10, 'Developer');
        $v2 = $this->makeVacancy(11, 'Designer');

        $html = JobAlertEmailService::buildAlertEmailHtml($recipient, [$v1, $v2]);
        $this->assertStringContainsString('2 new jobs match', $html);
    }

    public function test_buildAlertEmailHtml_escapes_html_in_title(): void
    {
        $recipient = $this->makeUser(5, 'jane@example.com', 'Jane');
        $vacancy = $this->makeVacancy(10, 'Dev <script>alert("xss")</script>');

        $html = JobAlertEmailService::buildAlertEmailHtml($recipient, [$vacancy]);
        $this->assertStringNotContainsString('<script>', $html);
    }

    public function test_buildAlertEmailHtml_shows_remote_when_no_location(): void
    {
        $recipient = $this->makeUser(5, 'jane@example.com', 'Jane');
        $vacancy = $this->makeVacancy(10, 'Developer');
        $vacancy->location = null;
        $vacancy->is_remote = true;

        $html = JobAlertEmailService::buildAlertEmailHtml($recipient, [$vacancy]);
        $this->assertStringContainsString('Remote', $html);
    }

    public function test_buildAlertEmailHtml_contains_unsubscribe_link(): void
    {
        $recipient = $this->makeUser(5, 'jane@example.com', 'Jane');
        $vacancy = $this->makeVacancy(10, 'Developer');

        $html = JobAlertEmailService::buildAlertEmailHtml($recipient, [$vacancy]);
        $this->assertStringContainsString('/jobs/alerts', $html);
        $this->assertStringContainsString('manage your alerts', $html);
    }

    // ── Helpers ─────────────────────────────────────────────────

    private function makeUser(int $id, string $email, string $firstName, ?string $lastName = null): User
    {
        $user = new User();
        $user->id = $id;
        $user->email = $email;
        $user->first_name = $firstName;
        $user->last_name = $lastName;
        $user->tenant_id = $this->testTenantId;
        return $user;
    }

    private function makeVacancy(int $id, string $title): JobVacancy
    {
        $v = new JobVacancy();
        $v->id = $id;
        $v->title = $title;
        $v->location = 'Dublin';
        $v->is_remote = false;
        $v->commitment = 'full_time';
        $v->type = 'paid';
        $v->deadline = '2026-06-01';
        return $v;
    }

    private function makeAlert(): JobAlert
    {
        $a = new JobAlert();
        $a->id = 1;
        return $a;
    }

    private function fakeEmailDispatchService(bool $throws = false): EmailDispatchService
    {
        TenantContext::setById($this->testTenantId);

        $mailer = new class($throws) extends EmailDispatchService {
            /** @var list<array{to:string,subject:string,body:string,options:array<string,mixed>}> */
            public array $sends = [];

            public function __construct(private readonly bool $throws)
            {
            }

            public function send(string $to, string $subject, string $body, array $options = []): bool
            {
                if ($this->throws) {
                    throw new \RuntimeException('SMTP error');
                }

                $this->sends[] = [
                    'to' => $to,
                    'subject' => $subject,
                    'body' => $body,
                    'options' => $options,
                ];

                return true;
            }
        };

        app()->instance(EmailDispatchService::class, $mailer);

        return $mailer;
    }
}
