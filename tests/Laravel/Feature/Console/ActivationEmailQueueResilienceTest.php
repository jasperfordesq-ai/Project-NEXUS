<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

namespace Tests\Laravel\Feature\Console;

use App\Core\TenantContext;
use App\Events\UserRegistered;
use App\Listeners\NotifyAdminOfNewRegistration;
use App\Listeners\SendWelcomeNotification;
use App\Models\User;
use App\Services\DisposableEmailService;
use App\Services\EmailDispatchService;
use App\Services\MxRecordValidator;
use App\Services\PwnedPasswordService;
use App\Services\RegistrationService;
use App\Services\RegistrationStaffEmailDeliveryLedger;
use App\Services\TenantSettingsService;
use Illuminate\Contracts\Queue\ShouldQueue;
use Illuminate\Events\CallQueuedListener;
use Illuminate\Foundation\Testing\DatabaseTransactions;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Cache;
use Illuminate\Support\Facades\Queue;
use Tests\Laravel\TestCase;

/**
 * H5 regression lock — activation-email queue resilience.
 *
 * Registration emails must not be queue-only. A dead worker would silently
 * lock out new signups and hide them from admins, so the registration email
 * listeners run inline while the scheduled `emails:resend-stuck-activations`
 * command remains a recovery path for users who still have no activation log.
 */
class ActivationEmailQueueResilienceTest extends TestCase
{
    use DatabaseTransactions;

    public function test_registration_email_listeners_run_inline_not_on_the_queue(): void
    {
        $this->assertFalse(
            in_array(ShouldQueue::class, class_implements(SendWelcomeNotification::class), true),
            'Activation/welcome email must run inline so signup is not dependent on a queue worker.'
        );

        $this->assertFalse(
            in_array(ShouldQueue::class, class_implements(NotifyAdminOfNewRegistration::class), true),
            'Admin new-registration email must run inline so admins are not dependent on a queue worker.'
        );
    }

    public function test_successful_registration_sends_activation_and_admin_emails_without_queue_worker(): void
    {
        Queue::fake();

        $tenantId = (int) DB::table('tenants')->insertGetId([
            'name'       => 'Inline Registration Tenant',
            'slug'       => 'inline-registration-' . uniqid(),
            'is_active'  => 1,
            'created_at' => now(),
            'updated_at' => now(),
        ]);
        TenantContext::setById($tenantId);

        User::factory()->forTenant($tenantId)->create([
            'role'               => 'admin',
            'status'             => 'active',
            'email'              => 'admin-inline-' . uniqid() . '@project-nexus.testmail',
            'preferred_language' => 'en',
        ]);

        $mailer = new RegistrationInlineEmailDispatchService();
        app()->instance(EmailDispatchService::class, $mailer);

        $service = new RegistrationService(
            new User(),
            app(TenantSettingsService::class),
            new RegistrationInlinePwnedPasswordService(),
            new RegistrationInlineDisposableEmailService(),
            new RegistrationInlineMxRecordValidator(),
        );

        $result = $service->register([
            'first_name'            => 'Inline',
            'last_name'             => 'Signup',
            'email'                 => 'inline-signup-' . uniqid() . '@project-nexus.testmail',
            'location'              => 'Toronto, Canada',
            'phone'                 => '+15551234567',
            'password'              => 'A uniquely long registration passphrase 2026',
            'password_confirmation' => 'A uniquely long registration passphrase 2026',
            'terms_accepted'        => true,
        ], $tenantId);

        $this->assertArrayNotHasKey('error', $result);
        $this->assertTrue($result['requires_verification'] ?? false);

        $userId = (int) ($result['user']['id'] ?? 0);
        $this->assertGreaterThan(0, $userId);
        $this->assertSame(1, DB::table('registration_staff_email_deliveries')
            ->where('tenant_id', $tenantId)
            ->where('registrant_user_id', $userId)
            ->where('status', 'accepted')
            ->count());
        $this->assertTrue(DB::table('email_verification_tokens')
            ->where('tenant_id', $tenantId)
            ->where('user_id', $userId)
            ->exists());

        $categories = array_column($mailer->calls, 'category');
        $this->assertContains('activation', $categories);
        $this->assertContains('admin_new_registration', $categories);
        $deliveryDispatchId = DB::table('registration_staff_email_deliveries')
            ->where('tenant_id', $tenantId)->where('registrant_user_id', $userId)
            ->value('dispatch_id');
        $staffCall = collect($mailer->calls)->firstWhere('category', 'admin_new_registration');
        $this->assertNotEmpty($deliveryDispatchId);
        $this->assertSame($deliveryDispatchId, $staffCall['dispatch_id'] ?? null);

        Queue::assertNotPushed(
            CallQueuedListener::class,
            fn ($job) => in_array($job->class, [
                SendWelcomeNotification::class,
                NotifyAdminOfNewRegistration::class,
            ], true)
        );
    }

    public function test_invite_redemption_commits_with_registration_email_intent(): void
    {
        $tenantId = $this->inviteOnlyTenant('INVGOOD1');
        TenantContext::setById($tenantId);
        $mailer = new RegistrationInlineEmailDispatchService();
        app()->instance(EmailDispatchService::class, $mailer);
        $email = 'invite-good-' . uniqid() . '@project-nexus.testmail';

        $result = $this->registrationService()->register($this->registrationData($email, 'INVGOOD1'), $tenantId);

        $this->assertArrayNotHasKey('error', $result);
        $registrantId = (int) ($result['user']['id'] ?? 0);
        $this->assertGreaterThan(0, $registrantId);
        $this->assertSame(1, (int) DB::table('tenant_invite_codes')
            ->where('tenant_id', $tenantId)->where('code', 'INVGOOD1')->value('uses_count'));
        $this->assertSame(1, DB::table('registration_staff_email_deliveries')
            ->where('tenant_id', $tenantId)->where('registrant_user_id', $registrantId)->count());
        $this->assertContains('admin_new_registration', array_column($mailer->calls, 'category'));
    }

    public function test_unroutable_staff_address_is_definite_pretransport_failure(): void
    {
        $tenantId = $this->inviteOnlyTenant('UNROUTE');
        TenantContext::setById($tenantId);
        $admin = NotifyAdminOfNewRegistration::recipientsFor($tenantId)->first();
        DB::table('users')->where('id', $admin->id)->where('tenant_id', $tenantId)
            ->update(['email' => 'synthetic-admin@unroute.test']);
        $mailer = new RegistrationInlineEmailDispatchService();
        app()->instance(EmailDispatchService::class, $mailer);

        $result = $this->registrationService()->register(
            $this->registrationData('unroutable-' . uniqid() . '@project-nexus.testmail', 'UNROUTE'),
            $tenantId,
        );
        $this->assertArrayNotHasKey('error', $result);
        $delivery = DB::table('registration_staff_email_deliveries')
            ->where('tenant_id', $tenantId)
            ->where('registrant_user_id', (int) $result['user']['id'])
            ->first();
        $this->assertSame('definite_failure', $delivery->status);
        $this->assertSame('UNROUTABLE_RECIPIENT', $delivery->last_error_code);
        $this->assertSame(0, count(array_filter($mailer->calls,
            static fn (array $call): bool => $call['category'] === 'admin_new_registration')));
    }

    public function test_partial_inline_result_stays_unknown_and_event_replay_does_not_resend_either_recipient(): void
    {
        $tenantId = (int) DB::table('tenants')->insertGetId([
            'name' => 'Synthetic partial registration tenant',
            'slug' => 'partial-registration-' . uniqid(),
            'is_active' => 1, 'created_at' => now(), 'updated_at' => now(),
        ]);
        TenantContext::setById($tenantId);
        $accepted = 'accepted-' . uniqid() . '@project-nexus.testmail';
        $unconfirmed = 'unconfirmed-' . uniqid() . '@project-nexus.testmail';
        foreach ([$accepted, $unconfirmed] as $email) {
            User::factory()->forTenant($tenantId)->create([
                'role' => 'admin', 'status' => 'active', 'email' => $email,
                'preferred_language' => 'en',
            ]);
        }
        $mailer = new RegistrationInlineEmailDispatchService();
        $mailer->failFor = [$unconfirmed];
        app()->instance(EmailDispatchService::class, $mailer);

        $data = $this->registrationData('partial-' . uniqid() . '@project-nexus.testmail', '');
        unset($data['invite_code']);
        $result = $this->registrationService()->register($data, $tenantId);
        $this->assertArrayNotHasKey('error', $result);
        $registrantId = (int) $result['user']['id'];
        $statuses = DB::table('registration_staff_email_deliveries')
            ->where('tenant_id', $tenantId)->where('registrant_user_id', $registrantId)
            ->orderBy('id')->pluck('status')->all();
        $this->assertSame(['accepted', 'unknown'], $statuses);
        $before = count(array_filter($mailer->calls, static fn (array $call): bool => $call['category'] === 'admin_new_registration'));
        $this->assertSame(2, $before);

        $user = new User();
        $user->id = $registrantId;
        Cache::put('notify_admin_new_registration:done:' . $tenantId . ':' . $registrantId, 1, now()->addDay());
        (new NotifyAdminOfNewRegistration())->handle(new UserRegistered($user, $tenantId));
        $after = count(array_filter($mailer->calls, static fn (array $call): bool => $call['category'] === 'admin_new_registration'));
        $this->assertSame($before, $after);
    }

    public function test_captured_intent_survives_a_stale_event_done_key(): void
    {
        $tenantId = $this->inviteOnlyTenant('CRASHGAP');
        TenantContext::setById($tenantId);
        $admin = NotifyAdminOfNewRegistration::recipientsFor($tenantId)->first();
        $registrant = User::factory()->forTenant($tenantId)->create([
            'role' => 'member', 'status' => 'pending',
            'email' => 'captured-' . uniqid() . '@project-nexus.testmail',
        ]);
        $deliveryId = DB::transaction(static fn (): int => RegistrationStaffEmailDeliveryLedger::captureInTransaction(
            $tenantId, (int) $registrant->id, (int) $admin->id,
        ));
        $mailer = new RegistrationInlineEmailDispatchService();
        app()->instance(EmailDispatchService::class, $mailer);
        Cache::put('notify_admin_new_registration:done:' . $tenantId . ':' . $registrant->id, 1, now()->addDay());

        (new NotifyAdminOfNewRegistration())->handle(new UserRegistered($registrant, $tenantId));

        $this->assertSame(1, count(array_filter($mailer->calls, static fn (array $call): bool => $call['category'] === 'admin_new_registration')));
        $this->assertSame('accepted', DB::table('registration_staff_email_deliveries')->where('id', $deliveryId)->value('status'));
    }

    public function test_lost_invite_race_rolls_back_account_and_alert_intent(): void
    {
        $tenantId = $this->inviteOnlyTenant('INVLOST1');
        TenantContext::setById($tenantId);
        $mailer = new RegistrationInlineEmailDispatchService();
        app()->instance(EmailDispatchService::class, $mailer);
        $email = 'invite-lost-' . uniqid() . '@project-nexus.testmail';

        User::creating(function (User $user) use ($email, $tenantId): void {
            if ($user->email === $email) {
                // Simulate a valid precheck followed by an exhausted code at
                // the atomic redemption point, inside the account transaction.
                DB::table('tenant_invite_codes')->where('tenant_id', $tenantId)
                    ->where('code', 'INVLOST1')->update(['uses_count' => 1]);
            }
        });

        $result = $this->registrationService()->register($this->registrationData($email, 'INVLOST1'), $tenantId);

        $this->assertSame('INVITE_INVALID', $result['code'] ?? null);
        $this->assertSame(422, $result['status'] ?? null);
        $this->assertSame(0, DB::table('users')->where('tenant_id', $tenantId)->where('email', $email)->count());
        $this->assertSame(0, DB::table('registration_staff_email_deliveries')->where('tenant_id', $tenantId)->count());
        $this->assertSame(0, (int) DB::table('tenant_invite_codes')
            ->where('tenant_id', $tenantId)->where('code', 'INVLOST1')->value('uses_count'));
        $this->assertNotContains('admin_new_registration', array_column($mailer->calls, 'category'));
    }

    private function registrationService(): RegistrationService
    {
        return new RegistrationService(
            new User(),
            app(TenantSettingsService::class),
            new RegistrationInlinePwnedPasswordService(),
            new RegistrationInlineDisposableEmailService(),
            new RegistrationInlineMxRecordValidator(),
        );
    }

    private function registrationData(string $email, string $inviteCode): array
    {
        return [
            'first_name' => 'Invite', 'last_name' => 'Signup', 'email' => $email,
            'location' => 'Toronto, Canada', 'phone' => '+15551234567',
            'password' => 'A uniquely long registration passphrase 2026',
            'password_confirmation' => 'A uniquely long registration passphrase 2026',
            'terms_accepted' => true, 'invite_code' => $inviteCode,
        ];
    }

    private function inviteOnlyTenant(string $code): int
    {
        $tenantId = (int) DB::table('tenants')->insertGetId([
            'name' => 'Synthetic Invite Intent Tenant',
            'slug' => 'invite-intent-' . uniqid('', true),
            'is_active' => 1, 'created_at' => now(), 'updated_at' => now(),
        ]);
        $admin = User::factory()->forTenant($tenantId)->create([
            'role' => 'admin', 'status' => 'active',
            'email' => 'admin-invite-' . uniqid() . '@project-nexus.testmail',
            'preferred_language' => 'en',
        ]);
        DB::table('tenant_invite_codes')->insert([
            'tenant_id' => $tenantId, 'code' => $code,
            'created_by' => $admin->id, 'max_uses' => 1,
            'uses_count' => 0, 'is_active' => 1, 'created_at' => now(),
        ]);
        DB::table('tenant_settings')->updateOrInsert(
            ['tenant_id' => $tenantId, 'setting_key' => 'general.registration_mode'],
            ['setting_value' => 'invite_only', 'setting_type' => 'string', 'updated_at' => now()],
        );
        app(TenantSettingsService::class)->clearCacheForTenant($tenantId);
        return $tenantId;
    }

    public function test_resend_stuck_activations_command_is_scheduled(): void
    {
        // schedule:list reflects the real registered schedule from bootstrap/app.php.
        $this->artisan('schedule:list')
            ->expectsOutputToContain('emails:resend-stuck-activations')
            ->assertExitCode(0);
    }

    public function test_resend_targets_users_with_no_activation_email_and_skips_those_who_got_one(): void
    {
        $tenantId = (int) DB::table('tenants')->insertGetId([
            'name'       => 'Activation Drill Tenant',
            'slug'       => 'activation-drill-' . uniqid(),
            'is_active'  => 1,
            'created_at' => now(),
            'updated_at' => now(),
        ]);
        TenantContext::setById($tenantId);

        // A: already received the welcome/activation email — must be SKIPPED.
        $aEmail = 'got.activation.' . uniqid() . '@example.com';
        DB::table('users')->insert([
            'tenant_id' => $tenantId, 'name' => 'A', 'first_name' => 'A', 'last_name' => 'Got',
            'email' => $aEmail, 'username' => 'a_' . substr(md5(uniqid()), 0, 10),
            'status' => 'pending', 'email_verified_at' => null,
            'created_at' => now(), 'updated_at' => now(),
        ]);
        DB::table('email_log')->insert([
            'tenant_id' => $tenantId, 'recipient_email' => $aEmail,
            'category' => 'activation', 'status' => 'sent', 'created_at' => now(),
        ]);

        // B: never received any activation email (dead worker) — must be TARGETED.
        $bEmail = 'no.email.' . uniqid() . '@example.com';
        DB::table('users')->insert([
            'tenant_id' => $tenantId, 'name' => 'B', 'first_name' => 'B', 'last_name' => 'Stuck',
            'email' => $bEmail, 'username' => 'b_' . substr(md5(uniqid()), 0, 10),
            'status' => 'pending', 'email_verified_at' => null,
            'created_at' => now(), 'updated_at' => now(),
        ]);

        $this->artisan('emails:resend-stuck-activations', ['--dry-run' => true, '--tenant' => $tenantId])
            ->expectsOutputToContain($bEmail)
            ->doesntExpectOutputToContain($aEmail)
            ->assertExitCode(0);
    }
}

class RegistrationInlineEmailDispatchService extends EmailDispatchService
{
    /** @var list<array{to:string, subject:string, category:string|null, tenant_id:int|null, dispatch_id:string|null}> */
    public array $calls = [];

    /** @var list<string> */
    public array $failFor = [];

    public function send(string $to, string $subject, string $body, array $options = []): bool
    {
        $this->calls[] = [
            'to'        => $to,
            'subject'   => $subject,
            'category'  => $options['category'] ?? null,
            'tenant_id' => isset($options['tenant_id']) ? (int) $options['tenant_id'] : null,
            'dispatch_id' => $options['dispatch_id'] ?? null,
        ];

        return !in_array($to, $this->failFor, true);
    }
}

class RegistrationInlinePwnedPasswordService extends PwnedPasswordService
{
    public function isPwned(string $password): bool
    {
        return false;
    }
}

class RegistrationInlineDisposableEmailService extends DisposableEmailService
{
    public function isDisposable(string $email): bool
    {
        return false;
    }
}

class RegistrationInlineMxRecordValidator extends MxRecordValidator
{
    public function isResolvable(string $email): bool
    {
        return true;
    }
}
