<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

declare(strict_types=1);

namespace Tests\Laravel\Feature\Security\E122;

use App\Core\TenantContext;
use App\Models\User;
use App\Services\NotificationDispatcher;
use App\Services\VolunteerWellbeingService;
use App\Support\Names\NameAudience;
use Illuminate\Foundation\Testing\DatabaseTransactions;
use Illuminate\Support\Facades\Auth;
use Illuminate\Support\Facades\DB;
use Tests\Laravel\TestCase;

/**
 * E-122 stage 4 — alerts whose recipients are staff BY THE QUERY THAT CHOSE
 * THEM keep the member's full name when they are built with nobody signed in
 * (a provider webhook, the nightly scan).
 *
 * With the surname rule on, a name built with no viewer is a first name. For a
 * member-facing message that is the safe default. For an alert that only the
 * community's administrators or safeguarding staff receive it would make the
 * alert useless ("Ada passed identity verification" — which Ada?), so those
 * builders name the reason: `NameReason::STAFF_RECIPIENT`.
 */
class StaffAlertSurnameTest extends TestCase
{
    use DatabaseTransactions;

    private const FIRST = 'Zqxfirstsubject';
    private const LAST = 'Zqxsurnamesubject';

    protected function setUp(): void
    {
        parent::setUp();
        config([NameAudience::CONFIG_KEY => true]);
        TenantContext::setById($this->testTenantId);
        Auth::forgetGuards();
    }

    public function test_the_identity_verification_alert_to_administrators_names_the_member_in_full(): void
    {
        $subject = $this->subject();
        $admin = $this->person(['role' => 'admin', 'is_admin' => 1]);
        $member = $this->person();

        $this->assertNull(Auth::id(), 'Built with nobody signed in, as from the provider webhook.');
        NotificationDispatcher::dispatchVerificationCompletedToAdmins((int) $subject->id, 'passed');

        $bell = (string) DB::table('notifications')
            ->where('tenant_id', $this->testTenantId)
            ->where('user_id', $admin->id)
            ->where('type', 'admin_verification_update')
            ->value('message');
        $this->assertStringContainsString(self::FIRST . ' ' . self::LAST, $bell);

        $this->assertSame(0, DB::table('notifications')
            ->where('tenant_id', $this->testTenantId)
            ->where('user_id', $member->id)
            ->where('type', 'admin_verification_update')
            ->count(), 'Only administrators are told.');
    }

    public function test_the_nightly_wellbeing_bell_to_safeguarding_staff_names_the_volunteer_in_full(): void
    {
        $subject = $this->subject();
        $broker = $this->person(['role' => 'broker']);
        $member = $this->person();

        $method = new \ReflectionMethod(VolunteerWellbeingService::class, 'bellStaffAboutScanAlert');
        $method->setAccessible(true);
        $method->invoke(null, $this->testTenantId, (int) $subject->id, 987654);

        $bell = (string) DB::table('notifications')
            ->where('tenant_id', $this->testTenantId)
            ->where('user_id', $broker->id)
            ->where('type', 'volunteer_wellbeing')
            ->value('message');
        $this->assertStringContainsString(self::FIRST . ' ' . self::LAST, $bell);

        $this->assertSame(0, DB::table('notifications')
            ->where('tenant_id', $this->testTenantId)
            ->where('user_id', $member->id)
            ->where('type', 'volunteer_wellbeing')
            ->count(), 'Only safeguarding staff are told.');
    }

    private function subject(): User
    {
        return $this->person([
            'first_name' => self::FIRST,
            'last_name' => self::LAST,
            'name' => self::FIRST . ' ' . self::LAST,
        ]);
    }

    /** @param array<string, mixed> $overrides */
    private function person(array $overrides = []): User
    {
        $user = User::factory()->forTenant($this->testTenantId)->create(array_merge([
            'status' => 'active',
            'is_approved' => true,
            'role' => 'member',
            'is_admin' => 0,
            'is_super_admin' => 0,
            'is_tenant_super_admin' => 0,
            'is_god' => 0,
        ], $overrides));
        TenantContext::setById($this->testTenantId);

        return $user;
    }
}
