<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

declare(strict_types=1);

namespace Tests\Laravel\Feature\Security\E069;

use App\Models\User;
use Illuminate\Foundation\Testing\DatabaseTransactions;
use Illuminate\Support\Facades\DB;
use Tests\Laravel\TestCase;

/**
 * F-424 — safeguarding reminder/escalation and vetting-renewal alerts must not
 * go to a member's FORMER community after the member has been moved.
 *
 * `SafeguardingReviewFlagsCommand` and `VettingRenewalRemindersCommand` joined
 * `users` on id alone, then fanned out to staff of the record's tenant.
 * `User::moveTenant()` updates `users.tenant_id` only, so the former
 * community's safeguarding staff kept receiving named alerts about someone who
 * had left.
 *
 * These tests assert the CORRECT behaviour and fail before the fix. The control
 * in each test is a member who never moved, in the same community, whose alert
 * must still be raised.
 */
final class F424SafeguardingAlertsFollowTheMembersCommunityTest extends TestCase
{
    use DatabaseTransactions;

    private int $formerTenant = 0;

    private int $newTenant = 0;

    protected function setUp(): void
    {
        parent::setUp();
        $this->formerTenant = $this->tenant('e077-f424-former');
        $this->newTenant = $this->tenant('e077-f424-new');
    }

    public function test_safeguarding_escalation_does_not_reach_the_former_community(): void
    {
        $broker = $this->broker($this->formerTenant);
        $moved = User::factory()->forTenant($this->formerTenant)->create(['status' => 'active']);
        $stayed = User::factory()->forTenant($this->formerTenant)->create(['status' => 'active']);
        $optionId = $this->option($this->formerTenant);
        $movedPref = $this->escalationDuePreference($this->formerTenant, (int) $moved->id, $optionId);
        $stayedPref = $this->escalationDuePreference($this->formerTenant, (int) $stayed->id, $optionId);

        // What User::moveTenant() does: users.tenant_id only.
        DB::table('users')->where('id', $moved->id)->update(['tenant_id' => $this->newTenant]);

        $this->artisan('safeguarding:review-flags')->assertSuccessful();

        $this->assertNotNull(
            DB::table('user_safeguarding_preferences')->where('id', $stayedPref)->value('review_escalated_at'),
            'CONTROL: the member who stayed is still escalated to their community\'s staff.'
        );
        $this->assertNull(
            DB::table('user_safeguarding_preferences')->where('id', $movedPref)->value('review_escalated_at'),
            'F-424: a member who has left must not be escalated to the former community.'
        );
        $this->assertSame(
            1,
            DB::table('notifications')->where('user_id', $broker->id)
                ->where('type', 'safeguarding_review_escalation')->count(),
            'F-424: the former community\'s broker is told about the member who stayed, and only them.'
        );
    }

    public function test_vetting_renewal_does_not_reach_the_former_community(): void
    {
        $broker = $this->broker($this->formerTenant);
        $moved = User::factory()->forTenant($this->formerTenant)->create(['status' => 'active']);
        $stayed = User::factory()->forTenant($this->formerTenant)->create(['status' => 'active']);
        $movedAttestation = $this->dueAttestation($this->formerTenant, (int) $moved->id, (int) $broker->id);
        $stayedAttestation = $this->dueAttestation($this->formerTenant, (int) $stayed->id, (int) $broker->id);

        DB::table('users')->where('id', $moved->id)->update(['tenant_id' => $this->newTenant]);

        $this->artisan('safeguarding:vetting-renewals')->assertSuccessful();

        $this->assertNotNull(
            DB::table('member_vetting_attestations')->where('id', $stayedAttestation)->value('renewal_reminder_7_sent_at'),
            'CONTROL: the member who stayed still raises a renewal alert.'
        );
        $this->assertNull(
            DB::table('member_vetting_attestations')->where('id', $movedAttestation)->value('renewal_reminder_7_sent_at'),
            'F-424: a member who has left must not raise a renewal alert in the former community.'
        );
        $this->assertSame(
            1,
            DB::table('notifications')->where('user_id', $broker->id)->where('type', 'vetting_renewal')->count(),
            'F-424: one alert, for the member who stayed.'
        );
    }

    // ── fixtures ────────────────────────────────────────────────────────────

    private function tenant(string $prefix): int
    {
        $slug = $prefix . '-' . bin2hex(random_bytes(4));

        return (int) DB::table('tenants')->insertGetId([
            'name' => 'E077 ' . $slug, 'slug' => $slug, 'is_active' => 1,
            'created_at' => now(), 'updated_at' => now(),
        ]);
    }

    private function broker(int $tenantId): User
    {
        // No email address: the alert is recorded as a bell, no transport needed.
        return User::factory()->forTenant($tenantId)->create(['role' => 'broker', 'status' => 'active', 'email' => '']);
    }

    private function option(int $tenantId): int
    {
        return (int) DB::table('tenant_safeguarding_options')->insertGetId([
            'tenant_id' => $tenantId, 'option_key' => 'works_with_children',
            'label' => 'Works with children', 'option_type' => 'checkbox', 'is_active' => 1,
        ]);
    }

    private function escalationDuePreference(int $tenantId, int $userId, int $optionId): int
    {
        return (int) DB::table('user_safeguarding_preferences')->insertGetId([
            'tenant_id' => $tenantId, 'user_id' => $userId, 'option_id' => $optionId,
            'selected_value' => '1',
            'consent_given_at' => now()->subDays(400),
            'review_reminder_sent_at' => now()->subDays(40),
        ]);
    }

    private function dueAttestation(int $tenantId, int $userId, int $confirmedBy): int
    {
        return (int) DB::table('member_vetting_attestations')->insertGetId([
            'tenant_id' => $tenantId, 'user_id' => $userId,
            'scheme_code' => 'uk_national_safeguarding', 'attestation_code' => 'uk_safeguarding_clearance',
            'certification_codes' => json_encode(['dbs_enhanced'], JSON_THROW_ON_ERROR),
            'purpose_code' => 'safeguarded_member_contact', 'scope_type' => 'tenant',
            'scope_identifier' => (string) $tenantId,
            'review_due_at' => now()->addDays(7)->toDateString(),
            'decision' => 'confirmed', 'confirmed_by' => $confirmedBy, 'confirmed_at' => now(),
            'policy_version' => 'safeguarded-contact-v1',
            'created_at' => now(), 'updated_at' => now(),
        ]);
    }
}
