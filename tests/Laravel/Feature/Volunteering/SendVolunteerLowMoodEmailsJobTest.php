<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

namespace Tests\Laravel\Feature\Volunteering;

use App\Core\TenantContext;
use App\Jobs\SendVolunteerLowMoodEmails;
use App\Models\User;
use App\Services\EmailDispatchService;
use Illuminate\Foundation\Testing\DatabaseTransactions;
use Illuminate\Support\Facades\DB;
use Tests\Laravel\TestCase;

/**
 * The queued wellbeing emails record, per person, whether they were sent.
 * A retry after one failure must not email everyone again, and a job that
 * dies must leave an honest "failed" against every address it never reached.
 */
class SendVolunteerLowMoodEmailsJobTest extends TestCase
{
    use DatabaseTransactions;

    private function person(array $overrides = []): User
    {
        return User::factory()->forTenant($this->testTenantId)->create(array_merge([
            'status' => 'active',
            'is_approved' => true,
            'role' => 'member',
        ], $overrides));
    }

    private function logRow(User $volunteer, ?User $recipient, ?string $email, string $tier, ?string $orgName = null): int
    {
        return (int) DB::table('vol_wellbeing_alert_notifications')->insertGetId([
            'tenant_id' => $this->testTenantId,
            'alert_id' => null,
            'checkin_id' => 1,
            'volunteer_user_id' => $volunteer->id,
            'recipient_user_id' => $recipient?->id,
            'recipient_tenant_id' => $recipient ? $this->testTenantId : null,
            'recipient_email' => $email,
            'organization_name' => $orgName,
            'tier' => $tier,
            'channel' => 'email',
            'status' => 'queued',
            'created_at' => now(),
            'updated_at' => now(),
        ]);
    }

    public function test_each_recipient_row_records_sent_or_failed_and_a_rerun_skips_the_sent_ones(): void
    {
        TenantContext::setById($this->testTenantId);
        $volunteer = $this->person();
        $staff = $this->person(['is_admin' => 1]);
        $noEmail = $this->person(['is_admin' => 1, 'email' => '']);
        $staffRow = $this->logRow($volunteer, $staff, null, 'staff');
        $noEmailRow = $this->logRow($volunteer, $noEmail, null, 'staff');
        $addressRow = $this->logRow($volunteer, null, 'team@community.example', 'community_contact_email');

        $sent = [];
        $this->mock(EmailDispatchService::class, function ($mock) use (&$sent) {
            $mock->shouldReceive('send')->andReturnUsing(function (string $to) use (&$sent) {
                $sent[] = $to;
                return true;
            });
        });

        $job = new SendVolunteerLowMoodEmails($this->testTenantId, (int) $volunteer->id, 'Pat Murphy', 1, [$staffRow, $noEmailRow, $addressRow]);
        $job->handle();

        $this->assertSame(['sent', 'failed', 'sent'], [
            DB::table('vol_wellbeing_alert_notifications')->where('id', $staffRow)->value('status'),
            DB::table('vol_wellbeing_alert_notifications')->where('id', $noEmailRow)->value('status'),
            DB::table('vol_wellbeing_alert_notifications')->where('id', $addressRow)->value('status'),
        ]);
        $this->assertSame('no_email', DB::table('vol_wellbeing_alert_notifications')->where('id', $noEmailRow)->value('error_code'));
        $this->assertEqualsCanonicalizing([$staff->email, 'team@community.example'], $sent);

        // A retry of the same job sends nothing a second time.
        $job->handle();
        $this->assertCount(2, $sent);
    }

    public function test_a_job_that_dies_marks_every_unsent_row_failed(): void
    {
        TenantContext::setById($this->testTenantId);
        $volunteer = $this->person();
        $staff = $this->person(['is_admin' => 1]);
        $row = $this->logRow($volunteer, $staff, null, 'staff');

        $job = new SendVolunteerLowMoodEmails($this->testTenantId, (int) $volunteer->id, 'Pat Murphy', 1, [$row]);
        $job->failed(new \RuntimeException('worker died'));

        $this->assertSame('failed', DB::table('vol_wellbeing_alert_notifications')->where('id', $row)->value('status'));
        $this->assertSame('job_failed', DB::table('vol_wellbeing_alert_notifications')->where('id', $row)->value('error_code'));
    }
}
