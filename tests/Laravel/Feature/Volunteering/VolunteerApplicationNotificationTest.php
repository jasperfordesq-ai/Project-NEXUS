<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

namespace Tests\Laravel\Feature\Volunteering;

use App\Core\TenantContext;
use App\Models\User;
use App\Services\VolunteeringConfigurationService;
use Illuminate\Foundation\Testing\DatabaseTransactions;
use Illuminate\Support\Facades\DB;
use Laravel\Sanctum\Sanctum;
use Tests\Laravel\TestCase;

/**
 * A new volunteer application must reach, by email, everyone who manages the
 * organisation (its own user, active owners/admins in org_members, and whoever
 * posted the opportunity), and the applicant must get a confirmation.
 *
 * Until 2026-10-08 the "application received" notice went only to the
 * opportunity's creator, and as a non-critical type it was never emailed to a
 * member on the default ('off') digest setting; the applicant was told nothing.
 */
class VolunteerApplicationNotificationTest extends TestCase
{
    use DatabaseTransactions;

    private function member(): User
    {
        return User::factory()->forTenant($this->testTenantId)->create([
            'status' => 'active',
            'is_approved' => true,
        ]);
    }

    private function orgMember(int $orgId, int $userId, string $role, string $status = 'active'): void
    {
        DB::table('org_members')->insert([
            'tenant_id' => $this->testTenantId,
            'organization_id' => $orgId,
            'org_type' => 'volunteer',
            'user_id' => $userId,
            'role' => $role,
            'status' => $status,
            'created_at' => now(),
            'updated_at' => now(),
        ]);
    }

    /** @return array{0: User, 1: User, 2: User, 3: User, 4: User, 5: int} */
    private function scenario(): array
    {
        DB::table('tenants')->where('id', $this->testTenantId)
            ->update(['features' => json_encode(['volunteering' => true, 'organisations' => true])]);
        TenantContext::setById($this->testTenantId);

        $owner = $this->member();
        $orgAdmin = $this->member();
        $poster = $this->member();
        $plainMember = $this->member();
        $applicant = $this->member();

        $orgId = (int) DB::table('vol_organizations')->insertGetId([
            'tenant_id' => $this->testTenantId,
            'user_id' => $owner->id,
            'name' => 'Application Alerts Org',
            'slug' => 'application-alerts-' . uniqid(),
            'description' => 'Test',
            'status' => 'active',
            'created_at' => now(),
        ]);
        $this->orgMember($orgId, $orgAdmin->id, 'admin');
        $this->orgMember($orgId, $plainMember->id, 'member');
        // The poster is also an owner in org_members: they must still get ONE email.
        $this->orgMember($orgId, $poster->id, 'owner');

        $oppId = (int) DB::table('vol_opportunities')->insertGetId([
            'tenant_id' => $this->testTenantId,
            'organization_id' => $orgId,
            'created_by' => $poster->id,
            'title' => 'Garden Helper',
            'description' => 'Test',
            'status' => 'active',
            'is_active' => 1,
            'created_at' => now(),
        ]);

        return [$owner, $orgAdmin, $poster, $plainMember, $applicant, $oppId];
    }

    /** @return array<int, string> user_id => activity_type, instant email queue rows only */
    private function instantEmails(): array
    {
        return DB::table('notification_queue')
            ->where('tenant_id', $this->testTenantId)
            ->where('frequency', 'instant')
            ->whereIn('activity_type', ['vol_application_received', 'vol_application_submitted', 'vol_application_approved'])
            ->get(['user_id', 'activity_type'])
            ->map(fn ($r) => [(int) $r->user_id, (string) $r->activity_type])
            ->all();
    }

    public function test_every_organisation_manager_is_emailed_and_the_applicant_gets_a_confirmation(): void
    {
        [$owner, $orgAdmin, $poster, $plainMember, $applicant, $oppId] = $this->scenario();

        Sanctum::actingAs($applicant, ['*']);
        $this->apiPost("/v2/volunteering/opportunities/{$oppId}/apply", ['message' => 'Happy to help'])
            ->assertStatus(201);

        $emails = $this->instantEmails();
        $received = array_values(array_map(fn ($e) => $e[0], array_filter($emails, fn ($e) => $e[1] === 'vol_application_received')));
        sort($received);
        $expected = [(int) $owner->id, (int) $orgAdmin->id, (int) $poster->id];
        sort($expected);

        $this->assertSame($expected, $received, 'each manager gets exactly one "new application" email');
        $this->assertNotContains((int) $plainMember->id, $received);
        $this->assertNotContains((int) $applicant->id, $received);

        $this->assertContains([(int) $applicant->id, 'vol_application_submitted'], $emails, 'applicant gets a confirmation');

        $body = (string) DB::table('notification_queue')
            ->where('user_id', $applicant->id)->where('activity_type', 'vol_application_submitted')->value('email_body');
        $this->assertStringContainsString('Garden Helper', $body);
        $this->assertStringContainsString('Application Sent', $body);
        $this->assertStringNotContainsString('emails_notifications.', $body, 'every string is translated');
    }

    public function test_auto_approved_application_tells_the_applicant_they_were_accepted(): void
    {
        [, , , , $applicant, $oppId] = $this->scenario();
        VolunteeringConfigurationService::set(VolunteeringConfigurationService::CONFIG_AUTO_APPROVE_APPLICATIONS, true);

        Sanctum::actingAs($applicant, ['*']);
        $this->apiPost("/v2/volunteering/opportunities/{$oppId}/apply")->assertStatus(201);
        $this->assertSame('approved', DB::table('vol_applications')
            ->where('opportunity_id', $oppId)->where('user_id', $applicant->id)->value('status'));

        $this->assertContains([(int) $applicant->id, 'vol_application_approved'], $this->instantEmails());
        $this->assertNotContains([(int) $applicant->id, 'vol_application_submitted'], $this->instantEmails());
    }
}
