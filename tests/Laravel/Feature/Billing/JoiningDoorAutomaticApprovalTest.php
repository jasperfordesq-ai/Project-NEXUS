<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

declare(strict_types=1);

namespace Tests\Laravel\Feature\Billing;

use App\Services\Auth\EmailConfirmationService;
use App\Services\Identity\RegistrationOrchestrationService;
use App\Support\Billing\BillingSettings;
use App\Support\Billing\JoiningGate;
use Illuminate\Foundation\Testing\DatabaseTransactions;
use Illuminate\Support\Facades\DB;
use Tests\Laravel\TestCase;

/**
 * A shut joining door lets nobody new in, by the two routes that approve an
 * account with nobody pressing a button.
 *
 * Every other way in already asked the door (sign-up, sign-up through a
 * provider, an admin adding or approving, the import, a move). These two did
 * not: confirming an email address, and a registration released after a
 * passed identity check. A person who signed up before the door shut was
 * therefore let in after it (found 21 November 2026).
 *
 * The door's answer is stood in for (JoiningGate::swapAnswerForTesting), as
 * JoiningGateTest does.
 */
final class JoiningDoorAutomaticApprovalTest extends TestCase
{
    use DatabaseTransactions;

    private int $community;

    protected function setUp(): void
    {
        parent::setUp();

        $this->community = (int) DB::table('tenants')->insertGetId([
            'name' => 'Door community', 'slug' => 'door-' . bin2hex(random_bytes(5)),
            'is_active' => 1, 'parent_id' => 1, 'created_at' => now(), 'updated_at' => now(),
        ]);
        DB::table('tenants')->where('id', $this->community)->update(['path' => "/1/{$this->community}/"]);
        // No admin approval step: confirming the address is what lets a person in.
        DB::table('tenant_settings')->insert([
            ['tenant_id' => $this->community, 'setting_key' => 'general.admin_approval', 'setting_value' => '0'],
            ['tenant_id' => $this->community, 'setting_key' => 'general.require_admin_approval', 'setting_value' => '0'],
        ]);

        // A door only shuts while the platform team's automatic checks are on.
        BillingSettings::flush();
        BillingSettings::set('automation_enabled', true, null);
    }

    protected function tearDown(): void
    {
        try {
            JoiningGate::swapAnswerForTesting(null);
            BillingSettings::flush();
        } finally {
            parent::tearDown();
        }
    }

    private function shutTheDoor(): void
    {
        $community = $this->community;
        JoiningGate::swapAnswerForTesting(
            static fn (int $tenantId): ?array => $tenantId === $community
                ? ['tenant_id' => $community, 'active' => 3, 'max' => 3]
                : null
        );
    }

    /** @param array<string, mixed> $values */
    private function waitingAccount(array $values = []): int
    {
        $uid = bin2hex(random_bytes(6));

        return (int) DB::table('users')->insertGetId($values + [
            'tenant_id' => $this->community, 'name' => 'Waiting ' . $uid, 'first_name' => 'Waiting', 'last_name' => 'Person',
            'email' => $uid . '@example.test', 'status' => 'pending', 'role' => 'member', 'balance' => 0,
            'is_approved' => 0, 'email_verified_at' => null, 'created_at' => now(), 'updated_at' => now(),
        ]);
    }

    private function account(int $id): object
    {
        return DB::table('users')->where('id', $id)->first();
    }

    private function requiresApproval(): bool
    {
        return app(\App\Services\TenantSettingsService::class)->requiresAdminApproval($this->community);
    }

    public function test_confirming_an_email_lets_a_person_in_while_the_door_is_open(): void
    {
        if ($this->requiresApproval()) {
            $this->markTestSkipped('This community could not be set to need no admin approval in the test database.');
        }
        $id = $this->waitingAccount();

        $this->assertTrue(app(EmailConfirmationService::class)->confirm($id, $this->community));

        $this->assertSame('active', $this->account($id)->status);
        $this->assertSame(1, (int) $this->account($id)->is_approved);
    }

    public function test_confirming_an_email_records_it_but_lets_nobody_in_while_the_door_is_shut(): void
    {
        if ($this->requiresApproval()) {
            $this->markTestSkipped('This community could not be set to need no admin approval in the test database.');
        }
        $id = $this->waitingAccount();
        $this->shutTheDoor();

        $this->assertTrue(app(EmailConfirmationService::class)->confirm($id, $this->community), 'the address is confirmed');

        $account = $this->account($id);
        $this->assertNotNull($account->email_verified_at);
        $this->assertSame('pending', $account->status, 'let in through a shut door');
        $this->assertSame(0, (int) $account->is_approved);
    }

    public function test_a_released_registration_waits_while_the_door_is_shut_and_goes_through_when_it_opens(): void
    {
        $id = $this->waitingAccount(['email_verified_at' => now()]);
        $release = new \ReflectionMethod(RegistrationOrchestrationService::class, 'approveAndRelease');
        $release->setAccessible(true);

        $this->shutTheDoor();
        $release->invoke(null, $id, $this->community);
        $this->assertSame('pending', $this->account($id)->status);
        $this->assertSame(0, (int) $this->account($id)->is_approved);

        JoiningGate::swapAnswerForTesting(null);
        $release->invoke(null, $id, $this->community);
        $this->assertSame('active', $this->account($id)->status);
        $this->assertSame(1, (int) $this->account($id)->is_approved);
    }

    public function test_a_person_already_approved_is_not_held_by_a_shut_door(): void
    {
        // Approved by an admin before the door shut: an existing member
        // finishing a check, not a new one.
        $id = $this->waitingAccount(['is_approved' => 1, 'email_verified_at' => now()]);
        $release = new \ReflectionMethod(RegistrationOrchestrationService::class, 'approveAndRelease');
        $release->setAccessible(true);
        $this->shutTheDoor();

        $release->invoke(null, $id, $this->community);

        $this->assertSame('active', $this->account($id)->status);
    }
}
