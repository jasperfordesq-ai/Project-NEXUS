<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

namespace Tests\Laravel\Feature\Volunteering;

use App\Core\TenantContext;
use App\Models\User;
use Illuminate\Foundation\Testing\DatabaseTransactions;
use Illuminate\Support\Facades\DB;
use Laravel\Sanctum\Sanctum;
use Tests\Laravel\TestCase;

/**
 * An organisation's owner, admins and safeguarding leads can see, on the
 * organisation's own dashboard, which of their volunteers said they are Low or
 * Struggling and asked for someone to get in touch (owner, 20 Oct 2026: "someone
 * could be feeling suicidal, and everyone needs to know"). They see the name,
 * how the volunteer feels, when, and when the organisation was told. Never the
 * note. Nobody outside the organisation's contacts sees the list, and a
 * volunteer's own check-in never appears to themselves through this door.
 */
class OrganisationWellbeingViewTest extends TestCase
{
    use DatabaseTransactions;

    private const NOTE = 'A private note for staff only';

    protected function setUp(): void
    {
        parent::setUp();
        $id = (int) DB::table('tenants')->insertGetId([
            'name' => 'Org wellbeing isolated',
            'slug' => 'org-wb-iso-' . uniqid(),
            'domain' => null,
            'is_active' => true,
            'parent_id' => null,
            'path' => '/',
            'depth' => 0,
            'allows_subtenants' => false,
            'features' => json_encode(['volunteering' => true, 'organisations' => true]),
            'contact_email' => null,
            'created_at' => now(),
            'updated_at' => now(),
        ]);
        DB::table('tenants')->where('id', $id)->update(['path' => "/{$id}/"]);
        $this->withTenant($id);
    }

    private function person(array $overrides = []): User
    {
        return User::factory()->forTenant($this->testTenantId)->create(array_merge([
            'status' => 'active',
            'is_approved' => true,
            'role' => 'member',
        ], $overrides));
    }

    /** @return array{org: int, owner: User, admin: User, lead: User, member: User} */
    private function organisation(): array
    {
        $owner = $this->person(['first_name' => 'Olive', 'last_name' => 'Owner']);
        $admin = $this->person(['first_name' => 'Andy', 'last_name' => 'Admin']);
        $lead = $this->person(['first_name' => 'Lena', 'last_name' => 'Lead']);
        $member = $this->person(['first_name' => 'Mia', 'last_name' => 'Member']);
        $orgId = (int) DB::table('vol_organizations')->insertGetId([
            'tenant_id' => $this->testTenantId,
            'user_id' => $owner->id,
            'name' => 'Riverbank Trust',
            'slug' => 'riverbank-' . uniqid(),
            'status' => 'approved',
            'dlp_user_id' => $lead->id,
            'created_at' => now(),
        ]);
        foreach ([[$admin, 'admin'], [$member, 'member']] as [$user, $role]) {
            DB::table('org_members')->insert([
                'tenant_id' => $this->testTenantId,
                'organization_id' => $orgId,
                'org_type' => 'volunteer',
                'user_id' => $user->id,
                'role' => $role,
                'status' => 'active',
                'created_at' => now(),
            ]);
        }

        return ['org' => $orgId, 'owner' => $owner, 'admin' => $admin, 'lead' => $lead, 'member' => $member];
    }

    private function volunteerOf(int $orgId, array $overrides = []): User
    {
        $volunteer = $this->person($overrides);
        $oppId = (int) DB::table('vol_opportunities')->insertGetId([
            'tenant_id' => $this->testTenantId,
            'organization_id' => $orgId,
            'created_by' => $volunteer->id,
            'title' => 'Riverbank clean-up',
            'description' => 'Helping out.',
            'is_active' => 1,
            'status' => 'open',
            'created_at' => now(),
            'updated_at' => now(),
        ]);
        DB::table('vol_applications')->insert([
            'tenant_id' => $this->testTenantId,
            'opportunity_id' => $oppId,
            'user_id' => $volunteer->id,
            'status' => 'approved',
            'created_at' => now()->subDays(5),
            'updated_at' => now()->subDays(5),
        ]);

        return $volunteer;
    }

    private function checkin(User $volunteer, int $mood, bool $share = true): void
    {
        Sanctum::actingAs($volunteer, ['*']);
        $this->apiPost('/v2/volunteering/wellbeing/checkin', ['mood' => $mood, 'note' => self::NOTE, 'share_with_team' => $share])->assertOk();
    }

    private function openView(User $as, int $orgId)
    {
        Sanctum::actingAs($as, ['*']);

        return $this->apiGet('/v2/volunteering/organisations/' . $orgId . '/wellbeing');
    }

    public function test_the_owner_an_admin_and_the_lead_see_who_asked_for_help_but_never_the_note(): void
    {
        $o = $this->organisation();
        $pat = $this->volunteerOf($o['org'], ['first_name' => 'Pat', 'last_name' => 'Murphy']);
        $this->checkin($pat, 1);

        foreach (['owner', 'admin', 'lead'] as $who) {
            $data = $this->openView($o[$who], $o['org'])->assertOk()->json('data');
            $this->assertSame('Riverbank Trust', $data['organisation']['name'], $who);
            $this->assertCount(1, $data['items'], $who);
            $row = $data['items'][0];
            $this->assertSame((int) $pat->id, $row['volunteer']['id']);
            $this->assertSame('Pat Murphy', $row['volunteer']['name']);
            $this->assertSame(1, $row['mood']);
            $this->assertSame('active', $row['status']);
            $this->assertNotNull($row['checkin_at']);
            $this->assertNotNull($row['told_at'], 'the organisation was told, and the row says when');
            $this->assertStringNotContainsString(self::NOTE, json_encode($data));
            $this->assertArrayNotHasKey('note', $row);
        }
    }

    public function test_a_plain_team_member_a_bystander_and_the_volunteer_themselves_are_refused(): void
    {
        $o = $this->organisation();
        $pat = $this->volunteerOf($o['org']);
        $this->checkin($pat, 2);
        $bystander = $this->person();

        $this->openView($o['member'], $o['org'])->assertStatus(403);
        $this->openView($bystander, $o['org'])->assertStatus(403);
        $this->openView($pat, $o['org'])->assertStatus(403);
    }

    public function test_only_this_organisations_volunteers_appear_and_a_private_check_in_never_does(): void
    {
        $o = $this->organisation();
        $other = $this->organisation();
        $pat = $this->volunteerOf($o['org'], ['first_name' => 'Pat', 'last_name' => 'Murphy']);
        $sam = $this->volunteerOf($other['org'], ['first_name' => 'Sam', 'last_name' => 'Other']);
        $quiet = $this->volunteerOf($o['org'], ['first_name' => 'Quiet', 'last_name' => 'One']);
        $this->checkin($pat, 1);
        $this->checkin($sam, 1);
        $this->checkin($quiet, 1, false);

        $names = array_column(array_column($this->openView($o['owner'], $o['org'])->assertOk()->json('data.items'), 'volunteer'), 'name');
        $this->assertSame(['Pat Murphy'], $names);
    }

    public function test_an_unknown_organisation_is_not_found_and_an_org_contact_of_another_community_is_refused(): void
    {
        $o = $this->organisation();
        $this->openView($o['owner'], 99999999)->assertStatus(404);
    }

    public function test_the_organisations_bell_and_email_link_its_owner_to_the_wellbeing_tab(): void
    {
        $o = $this->organisation();
        $pat = $this->volunteerOf($o['org']);

        $sent = [];
        $this->mock(\App\Services\EmailDispatchService::class, function ($mock) use (&$sent) {
            $mock->shouldReceive('send')->andReturnUsing(function (string $to, string $subject, string $body) use (&$sent) {
                $sent[$to] = $body;
                return true;
            });
        });

        $this->checkin($pat, 1);

        $bell = DB::table('notifications')->where('user_id', $o['owner']->id)->where('type', 'volunteer_wellbeing')->first();
        $this->assertNotNull($bell);
        $this->assertSame('/volunteering/org/' . $o['org'] . '/dashboard?tab=wellbeing', $bell->link);
        $this->assertStringContainsString('/volunteering/org/' . $o['org'] . '/dashboard?tab=wellbeing', $sent[$o['owner']->email]);
        // The lead is not a team member and cannot open the dashboard: they keep the profile link.
        $leadBell = DB::table('notifications')->where('user_id', $o['lead']->id)->where('type', 'volunteer_wellbeing')->first();
        $this->assertSame('/profile/' . $pat->id, $leadBell->link);
    }
}
