<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

namespace Tests\Laravel\Integration;

use App\Core\TenantContext;
use App\Models\SafeguardingAssignment;
use App\Models\Tenant;
use App\Models\User;
use App\Services\EmailDispatchService;
use App\Services\SafeguardingService;
use App\Services\VolunteerReminderService;
use Illuminate\Foundation\Testing\DatabaseTransactions;
use Illuminate\Support\Facades\DB;
use Tests\Laravel\TestCase;

class VolunteerEmailReliabilityTest extends TestCase
{
    use DatabaseTransactions;

    public function test_shift_reminder_uses_explicit_tenant_context_and_restores_previous_context(): void
    {
        $tenantId = 999;
        $volunteer = User::factory()->forTenant($tenantId)->create([
            'first_name' => 'Volunteer',
            'email' => 'vol-reminder-' . uniqid('', true) . '@example.test',
            'preferred_language' => 'en',
        ]);
        [, $opportunityId, $shiftId] = $this->createVolunteerShift($tenantId, (int) $volunteer->id);

        DB::table('vol_reminder_settings')->insert([
            'tenant_id' => $tenantId,
            'reminder_type' => 'pre_shift',
            'enabled' => 1,
            'hours_before' => 24,
            'email_enabled' => 1,
            'push_enabled' => 1,
            'sms_enabled' => 0,
            'created_at' => now(),
            'updated_at' => now(),
        ]);

        $mailer = $this->fakeMailer();
        app()->instance(EmailDispatchService::class, $mailer);
        TenantContext::setById(2);

        $sent = VolunteerReminderService::sendReminders($tenantId, $opportunityId);

        $this->assertSame(1, $sent);
        $this->assertSame(2, TenantContext::currentId());
        $this->assertCount(1, $mailer->calls);
        $this->assertSame($tenantId, $mailer->calls[0]['options']['tenant_id']);
        $this->assertStringContainsString('/test-999/volunteering/opportunities/' . $opportunityId, $mailer->calls[0]['body']);
        $this->assertStringNotContainsString('/hour-timebank/volunteering', $mailer->calls[0]['body']);
        $this->assertDatabaseHas('vol_reminders_sent', [
            'tenant_id' => $tenantId,
            'user_id' => $volunteer->id,
            'reference_id' => $shiftId,
            'channel' => 'email',
        ]);
        $this->assertSame(0, DB::table('vol_reminders_sent')
            ->where('tenant_id', $tenantId)
            ->where('user_id', $volunteer->id)
            ->whereIn('channel', ['push', 'sms'])
            ->count());
    }

    public function test_pre_shift_cron_does_not_stamp_push_sent_without_email_delivery(): void
    {
        $tenantId = 999;
        $volunteer = User::factory()->forTenant($tenantId)->create([
            'email' => 'vol-push-only-' . uniqid('', true) . '@example.test',
            'preferred_language' => 'en',
        ]);
        $this->createVolunteerShift($tenantId, (int) $volunteer->id);

        DB::table('vol_reminder_settings')->insert([
            'tenant_id' => $tenantId,
            'reminder_type' => 'pre_shift',
            'enabled' => 1,
            'hours_before' => 24,
            'email_enabled' => 0,
            'push_enabled' => 1,
            'sms_enabled' => 0,
            'created_at' => now(),
            'updated_at' => now(),
        ]);

        $mailer = $this->fakeMailer();
        app()->instance(EmailDispatchService::class, $mailer);

        VolunteerReminderService::sendPreShiftReminders();

        $this->assertCount(0, array_filter(
            $mailer->calls,
            fn (array $call): bool => $call['to'] === $volunteer->email
        ));
        $this->assertSame(0, DB::table('vol_reminders_sent')
            ->where('tenant_id', $tenantId)
            ->where('user_id', $volunteer->id)
            ->count());
    }

    public function test_pre_shift_claim_releases_after_email_failure_and_allows_retry(): void
    {
        $tenantId = 999;
        $volunteer = User::factory()->forTenant($tenantId)->create([
            'email' => 'vol-retry-' . uniqid('', true) . '@example.test',
            'preferred_language' => 'en',
        ]);
        [, , $shiftId] = $this->createVolunteerShift($tenantId, (int) $volunteer->id);

        DB::table('vol_reminder_settings')->insert([
            'tenant_id' => $tenantId,
            'reminder_type' => 'pre_shift',
            'enabled' => 1,
            'hours_before' => 24,
            'email_enabled' => 1,
            'push_enabled' => 0,
            'sms_enabled' => 0,
            'created_at' => now(),
            'updated_at' => now(),
        ]);

        app()->instance(EmailDispatchService::class, $this->fakeMailer(false));

        $failed = VolunteerReminderService::sendPreShiftReminders();

        $this->assertSame(0, $failed);
        $this->assertDatabaseMissing('vol_reminders_sent', [
            'tenant_id' => $tenantId,
            'user_id' => $volunteer->id,
            'reference_id' => $shiftId,
            'channel' => 'email',
        ]);
        $this->assertDatabaseMissing('vol_reminder_delivery_claims', [
            'tenant_id' => $tenantId,
            'user_id' => $volunteer->id,
            'reference_id' => $shiftId,
            'channel' => 'email',
        ]);

        $mailer = $this->fakeMailer(true);
        app()->instance(EmailDispatchService::class, $mailer);

        $retried = VolunteerReminderService::sendPreShiftReminders();
        $matchingCalls = array_values(array_filter(
            $mailer->calls,
            static fn (array $call): bool => $call['to'] === $volunteer->email
        ));

        $this->assertGreaterThanOrEqual(1, $retried);
        $this->assertCount(1, $matchingCalls);
        $this->assertDatabaseHas('vol_reminders_sent', [
            'tenant_id' => $tenantId,
            'user_id' => $volunteer->id,
            'reference_id' => $shiftId,
            'channel' => 'email',
        ]);
        $this->assertDatabaseHas('vol_reminder_delivery_claims', [
            'tenant_id' => $tenantId,
            'user_id' => $volunteer->id,
            'reference_id' => $shiftId,
            'channel' => 'email',
            'status' => 'delivered',
        ]);
    }

    public function test_stale_pre_shift_claim_is_reaped_and_later_run_can_send(): void
    {
        $tenantId = 999;
        $volunteer = User::factory()->forTenant($tenantId)->create([
            'email' => 'vol-stale-claim-' . uniqid('', true) . '@example.test',
            'preferred_language' => 'en',
        ]);
        [, , $shiftId] = $this->createVolunteerShift($tenantId, (int) $volunteer->id);

        DB::table('vol_reminder_settings')->insert([
            'tenant_id' => $tenantId,
            'reminder_type' => 'pre_shift',
            'enabled' => 1,
            'hours_before' => 24,
            'email_enabled' => 1,
            'push_enabled' => 0,
            'sms_enabled' => 0,
            'created_at' => now(),
            'updated_at' => now(),
        ]);

        DB::table('vol_reminder_delivery_claims')->insert([
            'tenant_id' => $tenantId,
            'user_id' => $volunteer->id,
            'reminder_type' => 'pre_shift',
            'reference_id' => $shiftId,
            'channel' => 'email',
            'status' => 'claimed',
            'claimed_at' => now()->subHours(2),
            'created_at' => now()->subHours(2),
            'updated_at' => now()->subHours(2),
        ]);

        $mailer = $this->fakeMailer(true);
        app()->instance(EmailDispatchService::class, $mailer);

        $sent = VolunteerReminderService::sendPreShiftReminders();
        $matchingCalls = array_values(array_filter(
            $mailer->calls,
            static fn (array $call): bool => $call['to'] === $volunteer->email
        ));

        $this->assertGreaterThanOrEqual(1, $sent);
        $this->assertCount(1, $matchingCalls);
        $this->assertDatabaseHas('vol_reminders_sent', [
            'tenant_id' => $tenantId,
            'user_id' => $volunteer->id,
            'reference_id' => $shiftId,
            'channel' => 'email',
        ]);
        $this->assertSame(1, DB::table('vol_reminder_delivery_claims')
            ->where('tenant_id', $tenantId)
            ->where('user_id', $volunteer->id)
            ->where('reference_id', $shiftId)
            ->where('channel', 'email')
            ->where('status', 'delivered')
            ->count());
    }

    public function test_lapsed_volunteer_nudge_sends_once_for_inactive_volunteer(): void
    {
        $tenant = Tenant::factory()->create(['domain' => null]);
        $tenantId = (int) $tenant->id;
        $volunteer = User::factory()->forTenant($tenantId)->create([
            'first_name' => 'Lapsed',
            'email' => 'vol-lapsed-' . uniqid('', true) . '@example.test',
            'preferred_language' => 'en',
        ]);
        $this->createVolunteerShift($tenantId, (int) $volunteer->id, now()->subDays(45), now()->subDays(45)->addHours(2));

        DB::table('vol_reminder_settings')->insert([
            'tenant_id' => $tenantId,
            'reminder_type' => 'lapsed_volunteer',
            'enabled' => 1,
            'days_inactive' => 30,
            'email_enabled' => 1,
            'push_enabled' => 0,
            'sms_enabled' => 0,
            'created_at' => now(),
            'updated_at' => now(),
        ]);

        $mailer = $this->fakeMailer();
        app()->instance(EmailDispatchService::class, $mailer);

        $sent = VolunteerReminderService::nudgeLapsedVolunteers();
        $sentAgain = VolunteerReminderService::nudgeLapsedVolunteers();
        $matchingCalls = array_values(array_filter(
            $mailer->calls,
            static fn (array $call): bool => $call['to'] === $volunteer->email
        ));

        $this->assertGreaterThanOrEqual(1, $sent);
        $this->assertSame(0, $sentAgain);
        $this->assertCount(1, $matchingCalls);
        $this->assertSame($tenantId, $matchingCalls[0]['options']['tenant_id']);
        $this->assertStringContainsString('/' . $tenant->slug . '/volunteering', $matchingCalls[0]['body']);
        $this->assertDatabaseHas('vol_reminders_sent', [
            'tenant_id' => $tenantId,
            'user_id' => $volunteer->id,
            'reminder_type' => 'lapsed_volunteer',
            'reference_id' => $volunteer->id,
            'channel' => 'email',
        ]);
    }

    public function test_credential_expiry_warning_sends_once_for_verified_expiring_credential(): void
    {
        $tenant = Tenant::factory()->create(['domain' => null]);
        $tenantId = (int) $tenant->id;
        $volunteer = User::factory()->forTenant($tenantId)->create([
            'first_name' => 'Credential',
            'email' => 'vol-credential-' . uniqid('', true) . '@example.test',
            'preferred_language' => 'en',
        ]);

        $credentialId = (int) DB::table('vol_credentials')->insertGetId([
            'tenant_id' => $tenantId,
            'user_id' => $volunteer->id,
            'credential_type' => 'first_aid',
            'status' => 'verified',
            'expires_at' => now()->addDays(7)->toDateString(),
            'created_at' => now(),
            'updated_at' => now(),
        ]);

        DB::table('vol_reminder_settings')->insert([
            'tenant_id' => $tenantId,
            'reminder_type' => 'credential_expiry',
            'enabled' => 1,
            'days_before_expiry' => 14,
            'email_enabled' => 1,
            'push_enabled' => 0,
            'sms_enabled' => 0,
            'created_at' => now(),
            'updated_at' => now(),
        ]);

        $mailer = $this->fakeMailer();
        app()->instance(EmailDispatchService::class, $mailer);

        $sent = VolunteerReminderService::sendCredentialExpiryWarnings();

        $this->assertSame(1, $sent);
        $this->assertCount(1, $mailer->calls);
        $this->assertSame($tenantId, $mailer->calls[0]['options']['tenant_id']);
        $this->assertDatabaseHas('vol_reminders_sent', [
            'tenant_id' => $tenantId,
            'user_id' => $volunteer->id,
            'reminder_type' => 'credential_expiry',
            'reference_id' => $credentialId,
            'channel' => 'email',
        ]);
    }

    public function test_training_expiry_warning_sends_once_for_verified_expiring_training(): void
    {
        $tenant = Tenant::factory()->create(['domain' => null]);
        $tenantId = (int) $tenant->id;
        $volunteer = User::factory()->forTenant($tenantId)->create([
            'first_name' => 'Training',
            'email' => 'vol-training-' . uniqid('', true) . '@example.test',
            'preferred_language' => 'en',
        ]);

        $trainingId = (int) DB::table('vol_safeguarding_training')->insertGetId([
            'tenant_id' => $tenantId,
            'user_id' => $volunteer->id,
            'training_type' => 'first_aid',
            'training_name' => 'First Aid Refresher',
            'completed_at' => now()->subMonths(11)->toDateString(),
            'expires_at' => now()->addDays(7)->toDateString(),
            'status' => 'verified',
            'created_at' => now(),
            'updated_at' => now(),
        ]);

        DB::table('vol_reminder_settings')->insert([
            'tenant_id' => $tenantId,
            'reminder_type' => 'training_expiry',
            'enabled' => 1,
            'days_before_expiry' => 14,
            'email_enabled' => 1,
            'push_enabled' => 0,
            'sms_enabled' => 0,
            'created_at' => now(),
            'updated_at' => now(),
        ]);

        $mailer = $this->fakeMailer();
        app()->instance(EmailDispatchService::class, $mailer);

        $sent = VolunteerReminderService::sendTrainingExpiryWarnings();

        $this->assertSame(1, $sent);
        $this->assertCount(1, $mailer->calls);
        $this->assertSame($tenantId, $mailer->calls[0]['options']['tenant_id']);
        // Gap C11: "training" is not a website tab, so the link landed on Opportunities.
        $this->assertStringContainsString('/volunteering?tab=safeguarding', $mailer->calls[0]['body']);
        $this->assertStringNotContainsString('tab=training', $mailer->calls[0]['body']);
        $this->assertDatabaseHas('vol_reminders_sent', [
            'tenant_id' => $tenantId,
            'user_id' => $volunteer->id,
            'reminder_type' => 'training_expiry',
            'reference_id' => $trainingId,
            'channel' => 'email',
        ]);
    }

    // Gap C11 (7 Oct 2026): the decision email linked to /volunteering/community-projects/{id},
    // a page the website does not have.
    public function test_community_project_decision_email_links_to_a_page_that_exists(): void
    {
        $tenantId = 2;
        TenantContext::setById($tenantId);
        $proposer = User::factory()->forTenant($tenantId)->create([
            'first_name' => 'Proposer',
            'email' => 'proposer-' . uniqid('', true) . '@example.test',
            'preferred_language' => 'en',
        ]);
        $projectId = (int) DB::table('vol_community_projects')->insertGetId([
            'tenant_id' => $tenantId,
            'proposed_by' => $proposer->id,
            'title' => 'Community orchard',
            'description' => 'Plant fruit trees in the park.',
            'status' => 'proposed',
            'created_at' => now(),
            'updated_at' => now(),
        ]);

        $mailer = $this->fakeMailer();
        app()->instance(EmailDispatchService::class, $mailer);

        $this->assertTrue(app(\App\Services\CommunityProjectService::class)->review($projectId, 'approved', null, 1, $tenantId));

        $this->assertCount(1, $mailer->calls);
        $this->assertStringContainsString('/volunteering?tab=community-projects', $mailer->calls[0]['body']);
        $this->assertStringNotContainsString('/volunteering/community-projects/', $mailer->calls[0]['body']);
    }

    public function test_admin_hours_verification_notifies_through_dispatcher_not_raw_email(): void
    {
        $source = file_get_contents(app_path('Http/Controllers/Api/AdminVolunteerController.php'));
        $start = strpos($source, 'public function verifyHours');
        $end = strpos($source, '/** GET /api/v2/admin/volunteering */', $start);
        $method = substr($source, $start, $end - $start);
        // Strip line comments before the call-guards below: the approval path
        // documents *why* it does not use the wallet payout by cross-referencing
        // VolOrgWalletService::payVolunteer() in a comment, and that reference
        // must not be mistaken for an actual call.
        $executable = preg_replace('~//[^\n]*~', '', $method);

        // Approval mints inline (no VolOrgWalletService::payVolunteer call), so all
        // volunteer notifications go through NotificationDispatcher — never a raw
        // EmailDispatchService::sendRaw and never the balance-gated wallet payout.
        $this->assertStringNotContainsString('EmailDispatchService::sendRaw', $executable);
        $this->assertStringNotContainsString('VolOrgWalletService::payVolunteer', $executable);
        $this->assertStringContainsString("\$paymentOutcome === 'paid'", $method);
        $this->assertStringContainsString('NotificationDispatcher::dispatch', $method);
        $this->assertStringContainsString('buildVolHoursApprovedPaidEmail', $method);
    }

    public function test_safeguarding_status_email_restores_previous_tenant_context(): void
    {
        $tenantId = 999;
        $reporter = User::factory()->forTenant($tenantId)->create([
            'email' => 'safeguarding-status-' . uniqid('', true) . '@example.test',
            'preferred_language' => 'en',
        ]);
        $incidentId = (int) DB::table('vol_safeguarding_incidents')->insertGetId([
            'tenant_id' => $tenantId,
            'reported_by' => $reporter->id,
            'incident_type' => 'concern',
            'severity' => 'low',
            'description' => 'Status context regression test.',
            'status' => 'open',
            'created_at' => now(),
            'updated_at' => now(),
        ]);

        $mailer = $this->fakeMailer();
        app()->instance(EmailDispatchService::class, $mailer);
        TenantContext::setById(2);

        $service = new SafeguardingService(new SafeguardingAssignment());
        $method = new \ReflectionMethod($service, 'notifyIncidentStatusChange');
        $method->setAccessible(true);
        $method->invoke($service, $tenantId, $incidentId, (int) $reporter->id, null, 'resolved');

        $this->assertSame(2, TenantContext::currentId());
        $this->assertCount(1, $mailer->calls);
        $this->assertSame($tenantId, $mailer->calls[0]['options']['tenant_id']);
        $this->assertSame('safeguarding', $mailer->calls[0]['options']['category']);
    }

    public function test_emergency_alert_recipients_are_recorded_only_after_dispatch_success(): void
    {
        $source = file_get_contents(app_path('Services/VolunteerEmergencyAlertService.php'));
        $methodStart = strpos($source, 'private static function notifyQualifiedVolunteers');
        $method = substr($source, $methodStart);

        $bellCreatePos = strpos($method, 'Notification::createNotification');
        $failureGuardPos = strpos($method, 'if (!$bellCreated)');
        $recipientCreatePos = strpos($method, 'VolEmergencyAlertRecipient::create');

        $this->assertNotFalse($bellCreatePos);
        $this->assertNotFalse($failureGuardPos);
        $this->assertNotFalse($recipientCreatePos);
        $this->assertLessThan($recipientCreatePos, $bellCreatePos);
        $this->assertLessThan($recipientCreatePos, $failureGuardPos);
    }

    public function test_safeguarding_notifications_use_explicit_tenant_scoped_recipients(): void
    {
        $source = file_get_contents(app_path('Services/SafeguardingService.php'));

        $this->assertStringNotContainsString('User::find(', $source);
        $this->assertStringContainsString("User::where('tenant_id', \$tenantId)", $source);
        $this->assertStringContainsString('TenantContext::runForTenant($tenantId', $source);
        $this->assertStringContainsString("'tenant_id' => \$tenantId", $source);
    }

    /**
     * @return array{0:int,1:int,2:int}
     */
    private function createVolunteerShift(int $tenantId, int $volunteerId, mixed $startTime = null, mixed $endTime = null): array
    {
        $owner = User::factory()->forTenant($tenantId)->create([
            'email' => 'vol-org-owner-' . uniqid('', true) . '@example.test',
        ]);

        $orgId = (int) DB::table('vol_organizations')->insertGetId([
            'tenant_id' => $tenantId,
            'user_id' => $owner->id,
            'name' => 'Reminder Org',
            'status' => 'approved',
            'balance' => 10,
            'created_at' => now(),
            'updated_at' => now(),
        ]);

        $opportunityId = (int) DB::table('vol_opportunities')->insertGetId([
            'tenant_id' => $tenantId,
            'organization_id' => $orgId,
            'title' => 'Reminder Opportunity',
            'description' => 'Help with reminders.',
            'location' => 'Community Hall',
            'is_active' => 1,
            'status' => 'open',
            'created_by' => $owner->id,
            'created_at' => now(),
            'updated_at' => now(),
        ]);

        $shiftId = (int) DB::table('vol_shifts')->insertGetId([
            'tenant_id' => $tenantId,
            'opportunity_id' => $opportunityId,
            'start_time' => $startTime ?? now()->addHours(3),
            'end_time' => $endTime ?? now()->addHours(5),
            'capacity' => 5,
            'created_at' => now(),
        ]);

        DB::table('vol_applications')->insert([
            'tenant_id' => $tenantId,
            'opportunity_id' => $opportunityId,
            'shift_id' => $shiftId,
            'user_id' => $volunteerId,
            'status' => 'approved',
            'created_at' => now(),
            'updated_at' => now(),
        ]);

        return [$orgId, $opportunityId, $shiftId];
    }

    private function fakeMailer(bool $result = true): EmailDispatchService
    {
        return new class($result) extends EmailDispatchService {
            public array $calls = [];

            public function __construct(private bool $result)
            {
            }

            public function send(string $to, string $subject, string $body, array $options = []): bool
            {
                $this->calls[] = compact('to', 'subject', 'body', 'options');

                return $this->result;
            }
        };
    }
}
