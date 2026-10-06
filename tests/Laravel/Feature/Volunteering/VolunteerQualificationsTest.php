<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

declare(strict_types=1);

namespace Tests\Laravel\Feature\Volunteering;

use App\Core\TenantContext;
use App\Models\User;
use Illuminate\Foundation\Testing\DatabaseTransactions;
use Illuminate\Support\Facades\DB;
use Laravel\Sanctum\Sanctum;
use Tests\Laravel\TestCase;

/**
 * Volunteer qualifications register — API behaviour (spec §8, backend).
 *
 * Covers member CRUD and ownership, the refused vetting types, the per-type
 * validation rules, who may confirm and withdraw, the organisation and staff
 * lists (linked volunteers only, never another tenant), and the nightly
 * command (expire, remind once, stamp, honour the setting, dry run).
 */
class VolunteerQualificationsTest extends TestCase
{
    use DatabaseTransactions;

    protected function setUp(): void
    {
        parent::setUp();

        DB::table('tenants')
            ->where('id', $this->testTenantId)
            ->update(['features' => json_encode(['volunteering' => true, 'organisations' => true])]);
        TenantContext::setById($this->testTenantId);
    }

    // ------------------------------------------------------------------
    // Fixtures
    // ------------------------------------------------------------------

    private function member(array $overrides = [], int $tenantId = null): User
    {
        return User::factory()->forTenant($tenantId ?? $this->testTenantId)->create(array_merge([
            'status' => 'active',
            'is_approved' => true,
            'role' => 'member',
        ], $overrides));
    }

    /**
     * A recipient the email dispatcher refuses before it reaches a transport
     * (`@anonymized.local` is on its unroutable list), so the nightly command
     * exercises the email branch without a real send attempt from the test run.
     */
    private function unroutableEmail(): string
    {
        return 'qual-' . uniqid('', true) . '@anonymized.local';
    }

    private function actingAsMember(array $overrides = []): User
    {
        $user = $this->member($overrides);
        Sanctum::actingAs($user, ['*']);

        return $user;
    }

    private function createOrganisation(int $ownerId, int $tenantId = null): int
    {
        return (int) DB::table('vol_organizations')->insertGetId([
            'tenant_id' => $tenantId ?? $this->testTenantId,
            'user_id' => $ownerId,
            'name' => 'Riverside Garden Trust ' . uniqid(),
            'slug' => 'riverside-' . uniqid(),
            'description' => 'Community garden partner.',
            'status' => 'active',
            'created_at' => now(),
        ]);
    }

    /** An approved application on one of the org's opportunities = linked. */
    private function linkVolunteer(int $userId, int $orgId, int $tenantId = null): void
    {
        $tenantId ??= $this->testTenantId;
        $opportunityId = (int) DB::table('vol_opportunities')->insertGetId([
            'tenant_id' => $tenantId,
            'organization_id' => $orgId,
            'title' => 'Garden maintenance',
            'description' => 'Weekly garden upkeep.',
            'is_active' => 1,
            'status' => 'open',
            'created_at' => now(),
        ]);
        DB::table('vol_applications')->insert([
            'tenant_id' => $tenantId,
            'opportunity_id' => $opportunityId,
            'user_id' => $userId,
            'status' => 'approved',
            'created_at' => now(),
            'updated_at' => now(),
        ]);
    }

    private function recordQualification(int $userId, array $overrides = [], int $tenantId = null): int
    {
        return (int) DB::table('vol_qualifications')->insertGetId(array_merge([
            'tenant_id' => $tenantId ?? $this->testTenantId,
            'user_id' => $userId,
            'qualification_type' => 'first_aid',
            'title' => null,
            'issuer' => 'Irish Red Cross',
            'reference_number' => 'IRC-123',
            'obtained_at' => now()->subYear()->toDateString(),
            'expires_at' => now()->addYears(2)->toDateString(),
            'status' => 'recorded',
            'created_at' => now(),
            'updated_at' => now(),
        ], $overrides));
    }

    private function setReminderSetting(bool $enabled, bool $emailEnabled, int $days = 30): void
    {
        DB::table('vol_reminder_settings')->updateOrInsert(
            ['tenant_id' => $this->testTenantId, 'reminder_type' => 'credential_expiry'],
            [
                'enabled' => $enabled,
                'email_enabled' => $emailEnabled,
                'days_before_expiry' => $days,
                'push_enabled' => 0,
                'sms_enabled' => 0,
                'created_at' => now(),
                'updated_at' => now(),
            ]
        );
    }

    private function events(int $qualificationId): array
    {
        return DB::table('vol_qualification_events')
            ->where('tenant_id', $this->testTenantId)
            ->where('qualification_id', $qualificationId)
            ->orderBy('id')
            ->pluck('event')
            ->all();
    }

    // ------------------------------------------------------------------
    // Member CRUD and ownership
    // ------------------------------------------------------------------

    public function test_member_records_lists_and_edits_their_own_qualification(): void
    {
        $member = $this->actingAsMember();

        $created = $this->apiPost('/v2/volunteering/qualifications', [
            'qualification_type' => 'first_aid',
            'issuer' => 'Irish Red Cross',
            'reference_number' => 'IRC-2026-77',
            'obtained_at' => '2026-01-10',
            'expires_at' => now()->addDays(400)->toDateString(),
            'notes' => 'Renewed every three years.',
        ]);
        $created->assertStatus(201)
            ->assertJsonPath('data.qualification_type', 'first_aid')
            ->assertJsonPath('data.type_label_key', 'qualifications.types.first_aid')
            ->assertJsonPath('data.status', 'recorded')
            ->assertJsonPath('data.is_expiring', false)
            ->assertJsonPath('data.user_id', $member->id)
            ->assertJsonPath('data.confirmed_by', null)
            ->assertJsonPath('data.confirmed_for_organization', null);
        $id = (int) $created->json('data.id');
        $this->assertSame(['recorded'], $this->events($id));

        $list = $this->apiGet('/v2/volunteering/qualifications');
        $list->assertOk()
            ->assertJsonPath('data.counts.recorded', 1)
            ->assertJsonPath('data.counts.confirmed', 0)
            ->assertJsonPath('data.counts.expiring', 0)
            ->assertJsonPath('data.counts.expired', 0)
            ->assertJsonPath('data.reminder_window_days', 30)
            ->assertJsonPath('data.items.0.id', $id);
        $types = array_column($list->json('data.types'), 'code');
        $this->assertContains('first_aid', $types);
        $this->assertContains('other', $types);
        // Unconfigured jurisdiction offers the union of the Irish and UK lists.
        $this->assertContains('children_first', $types);
        $this->assertContains('efaw', $types);
        $this->assertNotContains('garda_vetting', $types);

        $this->apiPut("/v2/volunteering/qualifications/{$id}", ['issuer' => 'St John Ambulance'])
            ->assertOk()
            ->assertJsonPath('data.issuer', 'St John Ambulance')
            ->assertJsonPath('data.status', 'recorded');
        $this->assertSame(['recorded', 'updated'], $this->events($id));
    }

    public function test_member_cannot_see_or_edit_another_members_qualification(): void
    {
        $other = $this->member();
        $otherId = $this->recordQualification($other->id);
        $this->actingAsMember();

        $this->apiGet('/v2/volunteering/qualifications')
            ->assertOk()
            ->assertJsonCount(0, 'data.items');

        $this->apiPut("/v2/volunteering/qualifications/{$otherId}", ['issuer' => 'Tampered'])
            ->assertStatus(404);
        $this->assertSame('Irish Red Cross', DB::table('vol_qualifications')->where('id', $otherId)->value('issuer'));
    }

    public function test_feature_gate_blocks_the_register_when_volunteering_is_off(): void
    {
        $this->actingAsMember();
        DB::table('tenants')->where('id', $this->testTenantId)->update(['features' => json_encode(['volunteering' => false])]);
        TenantContext::setById($this->testTenantId);

        $this->apiGet('/v2/volunteering/qualifications')->assertStatus(403);
    }

    // ------------------------------------------------------------------
    // Validation
    // ------------------------------------------------------------------

    public function test_vetting_types_are_refused(): void
    {
        $this->actingAsMember();

        foreach (['garda_vetting', 'dbs_enhanced', 'DBS', 'pvg_scotland', 'access_ni', 'police_check', 'background_check'] as $type) {
            $this->apiPost('/v2/volunteering/qualifications', ['qualification_type' => $type])
                ->assertStatus(422)
                ->assertJsonPath('errors.0.code', 'VETTING_NOT_A_QUALIFICATION');
        }
        $this->assertSame(0, DB::table('vol_qualifications')->where('tenant_id', $this->testTenantId)->count());
    }

    public function test_unknown_type_title_for_other_and_date_order_are_validated(): void
    {
        $this->actingAsMember();

        $this->apiPost('/v2/volunteering/qualifications', ['qualification_type' => 'scuba_diving'])
            ->assertStatus(422)
            ->assertJsonPath('errors.0.code', 'UNSUPPORTED_QUALIFICATION_TYPE');

        $this->apiPost('/v2/volunteering/qualifications', ['qualification_type' => 'other'])
            ->assertStatus(422)
            ->assertJsonPath('errors.0.code', 'TITLE_REQUIRED_FOR_OTHER');

        $this->apiPost('/v2/volunteering/qualifications', [
            'qualification_type' => 'food_hygiene',
            'obtained_at' => '2026-05-01',
            'expires_at' => '2026-04-01',
        ])->assertStatus(422)->assertJsonPath('errors.0.code', 'EXPIRY_BEFORE_OBTAINED');

        $this->apiPost('/v2/volunteering/qualifications', [
            'qualification_type' => 'food_hygiene',
            'expires_at' => 'next spring',
        ])->assertStatus(422)
            ->assertJsonPath('errors.0.code', 'VALIDATION_ERROR')
            ->assertJsonPath('errors.0.field', 'expires_at');

        $this->apiPost('/v2/volunteering/qualifications', [])
            ->assertStatus(422)
            ->assertJsonPath('errors.0.code', 'VALIDATION_ERROR')
            ->assertJsonPath('errors.0.field', 'qualification_type');

        $this->apiPost('/v2/volunteering/qualifications', ['qualification_type' => 'other', 'title' => 'Beekeeping certificate'])
            ->assertStatus(201)
            ->assertJsonPath('data.title', 'Beekeeping certificate');
    }

    public function test_jurisdiction_limits_the_type_list(): void
    {
        $this->actingAsMember();
        DB::table('tenant_safeguarding_settings')->updateOrInsert(
            ['tenant_id' => $this->testTenantId],
            ['jurisdiction' => 'ireland', 'created_at' => now(), 'updated_at' => now()]
        );
        \Illuminate\Support\Facades\Cache::forget('safeguarding_jurisdiction:' . $this->testTenantId);

        $types = array_column($this->apiGet('/v2/volunteering/qualifications')->json('data.types'), 'code');
        $this->assertContains('children_first', $types);
        $this->assertNotContains('efaw', $types);

        $this->apiPost('/v2/volunteering/qualifications', ['qualification_type' => 'efaw'])
            ->assertStatus(422)
            ->assertJsonPath('errors.0.code', 'UNSUPPORTED_QUALIFICATION_TYPE');
    }

    // ------------------------------------------------------------------
    // Confirmation
    // ------------------------------------------------------------------

    public function test_org_confirmer_can_confirm_a_linked_volunteer_but_not_an_unlinked_one(): void
    {
        $owner = $this->actingAsMember();
        $orgId = $this->createOrganisation($owner->id);
        $linked = $this->member();
        $unlinked = $this->member();
        $this->linkVolunteer($linked->id, $orgId);
        $linkedQual = $this->recordQualification($linked->id);
        $unlinkedQual = $this->recordQualification($unlinked->id);

        $this->apiPost("/v2/volunteering/qualifications/{$linkedQual}/confirm", ['method' => 'saw_original'])
            ->assertStatus(422)
            ->assertJsonPath('errors.0.field', 'organization_id');

        $this->apiPost("/v2/volunteering/qualifications/{$linkedQual}/confirm", ['method' => 'saw_original', 'organization_id' => $orgId])
            ->assertOk()
            ->assertJsonPath('data.status', 'confirmed')
            ->assertJsonPath('data.confirmation_method', 'saw_original')
            ->assertJsonPath('data.confirmed_by.id', $owner->id)
            ->assertJsonPath('data.confirmed_for_organization.id', $orgId);
        $this->assertSame(['confirmed'], $this->events($linkedQual));

        $this->apiPost("/v2/volunteering/qualifications/{$unlinkedQual}/confirm", ['method' => 'saw_original', 'organization_id' => $orgId])
            ->assertStatus(403);
        $this->assertSame('recorded', DB::table('vol_qualifications')->where('id', $unlinkedQual)->value('status'));

        // An organisation the caller does not manage is refused even when the volunteer is linked to it.
        $otherOrg = $this->createOrganisation($this->member()->id);
        $this->linkVolunteer($linked->id, $otherOrg);
        $this->apiPost("/v2/volunteering/qualifications/{$linkedQual}/confirm", ['method' => 'online_register', 'organization_id' => $otherOrg])
            ->assertStatus(403);
    }

    public function test_org_admin_member_counts_as_a_confirmer(): void
    {
        $owner = $this->member();
        $orgId = $this->createOrganisation($owner->id);
        $admin = $this->actingAsMember();
        DB::table('org_members')->insert([
            'tenant_id' => $this->testTenantId,
            'organization_id' => $orgId,
            'org_type' => 'volunteer',
            'user_id' => $admin->id,
            'role' => 'admin',
            'status' => 'active',
            'created_at' => now(),
            'updated_at' => now(),
        ]);
        $volunteer = $this->member();
        $this->linkVolunteer($volunteer->id, $orgId);
        $qual = $this->recordQualification($volunteer->id);

        $this->apiPost("/v2/volunteering/qualifications/{$qual}/confirm", ['method' => 'issuer_confirmed', 'organization_id' => $orgId])
            ->assertOk()
            ->assertJsonPath('data.confirmed_by.id', $admin->id);
    }

    public function test_staff_can_confirm_anyone_without_an_organisation(): void
    {
        $volunteer = $this->member();
        $qual = $this->recordQualification($volunteer->id);

        foreach (['broker', 'coordinator', 'admin'] as $role) {
            $staff = $this->member(['role' => $role]);
            Sanctum::actingAs($staff, ['*']);

            $this->apiPost("/v2/volunteering/qualifications/{$qual}/confirm", ['method' => 'online_register'])
                ->assertOk()
                ->assertJsonPath('data.status', 'confirmed')
                ->assertJsonPath('data.confirmed_by.id', $staff->id)
                ->assertJsonPath('data.confirmed_for_organization', null);
        }
        // Re-checks append; nothing is overwritten in the history.
        $this->assertSame(['confirmed', 'confirmed', 'confirmed'], $this->events($qual));
    }

    public function test_nobody_confirms_their_own_record_including_staff(): void
    {
        $broker = $this->actingAsMember(['role' => 'broker']);
        $qual = $this->recordQualification($broker->id);

        $this->apiPost("/v2/volunteering/qualifications/{$qual}/confirm", ['method' => 'saw_original'])
            ->assertStatus(403)
            ->assertJsonPath('errors.0.code', 'SELF_CONFIRMATION');
        $this->assertSame('recorded', DB::table('vol_qualifications')->where('id', $qual)->value('status'));
    }

    public function test_confirming_an_expired_or_withdrawn_record_is_refused(): void
    {
        $this->actingAsMember(['role' => 'admin']);
        $volunteer = $this->member();
        $expired = $this->recordQualification($volunteer->id, ['status' => 'expired', 'expires_at' => now()->subDay()->toDateString()]);
        $withdrawn = $this->recordQualification($volunteer->id, ['status' => 'withdrawn', 'withdrawn_at' => now(), 'withdrawal_reason' => 'replaced']);

        $this->apiPost("/v2/volunteering/qualifications/{$expired}/confirm", ['method' => 'saw_original'])
            ->assertStatus(409)
            ->assertJsonPath('errors.0.code', 'EXPIRED');
        $this->apiPost("/v2/volunteering/qualifications/{$withdrawn}/confirm", ['method' => 'saw_original'])
            ->assertStatus(409)
            ->assertJsonPath('errors.0.code', 'WITHDRAWN');
        $this->apiPost("/v2/volunteering/qualifications/{$expired}/confirm", ['method' => 'guessed'])
            ->assertStatus(422)
            ->assertJsonPath('errors.0.field', 'method');
    }

    public function test_a_plain_member_cannot_confirm(): void
    {
        $volunteer = $this->member();
        $qual = $this->recordQualification($volunteer->id);
        $this->actingAsMember();

        $this->apiPost("/v2/volunteering/qualifications/{$qual}/confirm", ['method' => 'saw_original', 'organization_id' => 999999])
            ->assertStatus(403);
    }

    // ------------------------------------------------------------------
    // Editing a confirmed record; expiry edits
    // ------------------------------------------------------------------

    public function test_editing_a_confirmed_record_clears_the_confirmation_and_appends_an_event(): void
    {
        $owner = $this->member();
        $orgId = $this->createOrganisation($owner->id);
        $member = $this->actingAsMember();
        $qual = $this->recordQualification($member->id, [
            'status' => 'confirmed',
            'confirmed_by' => $owner->id,
            'confirmed_at' => now(),
            'confirmation_method' => 'saw_original',
            'confirmed_for_organization_id' => $orgId,
        ]);

        $this->apiPut("/v2/volunteering/qualifications/{$qual}", ['reference_number' => 'IRC-999'])
            ->assertOk()
            ->assertJsonPath('data.status', 'recorded')
            ->assertJsonPath('data.confirmed_by', null)
            ->assertJsonPath('data.confirmed_at', null)
            ->assertJsonPath('data.confirmation_method', null)
            ->assertJsonPath('data.confirmed_for_organization', null)
            ->assertJsonPath('data.reference_number', 'IRC-999');

        $event = DB::table('vol_qualification_events')->where('qualification_id', $qual)->orderByDesc('id')->first();
        $this->assertSame('updated', $event->event);
        $details = json_decode((string) $event->details, true);
        $this->assertTrue($details['confirmation_cleared']);
        $this->assertSame('IRC-123', $details['changed']['reference_number']['from']);
        $this->assertSame('IRC-999', $details['changed']['reference_number']['to']);

        // No change → no event.
        $this->apiPut("/v2/volunteering/qualifications/{$qual}", ['reference_number' => 'IRC-999'])->assertOk();
        $this->assertSame(['updated'], $this->events($qual));
    }

    public function test_moving_the_expiry_of_an_expired_record_into_the_future_reinstates_it_and_clears_the_stamps(): void
    {
        $member = $this->actingAsMember();
        $qual = $this->recordQualification($member->id, [
            'status' => 'expired',
            'expires_at' => now()->subDays(3)->toDateString(),
            'expiry_reminder_sent_at' => now()->subDays(20),
            'expired_notice_sent_at' => now()->subDays(2),
        ]);

        $this->apiPut("/v2/volunteering/qualifications/{$qual}", ['expires_at' => now()->addYear()->toDateString()])
            ->assertOk()
            ->assertJsonPath('data.status', 'recorded');

        $row = DB::table('vol_qualifications')->where('id', $qual)->first();
        $this->assertNull($row->expiry_reminder_sent_at);
        $this->assertNull($row->expired_notice_sent_at);
    }

    // ------------------------------------------------------------------
    // Withdraw
    // ------------------------------------------------------------------

    public function test_owner_confirmer_and_staff_can_withdraw_but_a_stranger_cannot(): void
    {
        $owner = $this->member();
        $orgId = $this->createOrganisation($owner->id);
        $volunteer = $this->member();
        $this->linkVolunteer($volunteer->id, $orgId);

        // Owner
        Sanctum::actingAs($volunteer, ['*']);
        $own = $this->recordQualification($volunteer->id);
        $this->apiPost("/v2/volunteering/qualifications/{$own}/withdraw", ['reason' => 'no_longer_held'])
            ->assertOk()
            ->assertJsonPath('data.status', 'withdrawn')
            ->assertJsonPath('data.withdrawal_reason', 'no_longer_held');
        $this->apiPost("/v2/volunteering/qualifications/{$own}/withdraw", ['reason' => 'replaced'])
            ->assertStatus(409)
            ->assertJsonPath('errors.0.code', 'WITHDRAWN');
        $this->apiPut("/v2/volunteering/qualifications/{$own}", ['issuer' => 'x'])
            ->assertStatus(409);

        // Org confirmer for a linked volunteer
        Sanctum::actingAs($owner, ['*']);
        $second = $this->recordQualification($volunteer->id);
        $this->apiPost("/v2/volunteering/qualifications/{$second}/withdraw", ['reason' => 'entered_in_error'])
            ->assertOk()
            ->assertJsonPath('data.status', 'withdrawn');
        $event = DB::table('vol_qualification_events')->where('qualification_id', $second)->where('event', 'withdrawn')->first();
        $this->assertSame($orgId, (int) $event->organization_id);

        // Stranger
        $third = $this->recordQualification($volunteer->id);
        $this->actingAsMember();
        $this->apiPost("/v2/volunteering/qualifications/{$third}/withdraw", ['reason' => 'entered_in_error'])
            ->assertStatus(403);
        $this->apiPost("/v2/volunteering/qualifications/{$third}/withdraw", ['reason' => 'because'])
            ->assertStatus(403);

        // Staff
        Sanctum::actingAs($this->member(['role' => 'coordinator']), ['*']);
        $this->apiPost("/v2/volunteering/qualifications/{$third}/withdraw", ['reason' => 'because'])
            ->assertStatus(422)
            ->assertJsonPath('errors.0.field', 'reason');
        $this->apiPost("/v2/volunteering/qualifications/{$third}/withdraw", ['reason' => 'volunteer_request'])
            ->assertOk();

        // Withdrawn records stay in the owner's history but out of the counts.
        Sanctum::actingAs($volunteer, ['*']);
        $list = $this->apiGet('/v2/volunteering/qualifications')->assertOk();
        $this->assertCount(3, $list->json('data.items'));
        $this->assertSame(0, $list->json('data.counts.recorded'));
    }

    // ------------------------------------------------------------------
    // Organisation and staff lists
    // ------------------------------------------------------------------

    public function test_org_list_returns_only_linked_volunteers_and_never_another_tenants_rows(): void
    {
        $owner = $this->actingAsMember();
        $orgId = $this->createOrganisation($owner->id);
        $linked = $this->member();
        $this->linkVolunteer($linked->id, $orgId);
        $unlinked = $this->member();

        $expiring = $this->recordQualification($linked->id, ['expires_at' => now()->addDays(10)->toDateString()]);
        $confirmed = $this->recordQualification($linked->id, ['status' => 'confirmed', 'qualification_type' => 'food_hygiene', 'expires_at' => now()->addYears(2)->toDateString()]);
        $this->recordQualification($unlinked->id);

        // Same user id, other tenant: a foreign row must never leak through the join.
        $foreignOrg = $this->createOrganisation($linked->id, 999);
        $this->linkVolunteer($linked->id, $foreignOrg, 999);
        $this->recordQualification($linked->id, [], 999);

        $response = $this->apiGet("/v2/volunteering/organizations/{$orgId}/qualifications");
        $response->assertOk()
            ->assertJsonPath('data.counts.expiring', 1)
            ->assertJsonPath('data.counts.recorded', 1)
            ->assertJsonPath('data.counts.confirmed', 1)
            ->assertJsonPath('data.counts.expired', 0)
            ->assertJsonPath('data.next_cursor', null);
        $ids = array_column($response->json('data.items'), 'id');
        $this->assertSame([$expiring, $confirmed], $ids, 'expiring soonest first, then the rest by expiry');
        $this->assertSame($linked->id, $response->json('data.items.0.volunteer.id'));
        $this->assertArrayHasKey('name', $response->json('data.items.0.volunteer'));
        $this->assertTrue($response->json('data.items.0.is_expiring'));

        $this->apiGet("/v2/volunteering/organizations/{$orgId}/qualifications?status=attention")
            ->assertOk()->assertJsonCount(1, 'data.items');
        $this->apiGet("/v2/volunteering/organizations/{$orgId}/qualifications?status=confirmed")
            ->assertOk()->assertJsonPath('data.items.0.id', $confirmed);
        $this->apiGet("/v2/volunteering/organizations/{$orgId}/qualifications?expiring=1")
            ->assertOk()->assertJsonCount(1, 'data.items');
        $this->apiGet("/v2/volunteering/organizations/{$orgId}/qualifications?q=zzz-no-such-volunteer")
            ->assertOk()->assertJsonCount(0, 'data.items');

        // Cursor paging
        $page1 = $this->apiGet("/v2/volunteering/organizations/{$orgId}/qualifications?per_page=1")->assertOk();
        $this->assertSame('1', $page1->json('data.next_cursor'));
        $page2 = $this->apiGet("/v2/volunteering/organizations/{$orgId}/qualifications?per_page=1&cursor=1")->assertOk();
        $this->assertSame($confirmed, $page2->json('data.items.0.id'));
        $this->assertNull($page2->json('data.next_cursor'));

        // Someone who does not manage the org is refused; staff may open any org.
        $this->actingAsMember();
        $this->apiGet("/v2/volunteering/organizations/{$orgId}/qualifications")->assertStatus(403);
        Sanctum::actingAs($this->member(['role' => 'admin']), ['*']);
        $this->apiGet("/v2/volunteering/organizations/{$orgId}/qualifications")->assertOk();
        $this->apiGet('/v2/volunteering/organizations/999999/qualifications')->assertStatus(403);
    }

    public function test_staff_list_covers_the_tenant_and_is_closed_to_members(): void
    {
        $owner = $this->member();
        $orgId = $this->createOrganisation($owner->id);
        $a = $this->member();
        $b = $this->member();
        $confirmed = $this->recordQualification($a->id, [
            'status' => 'confirmed',
            'confirmed_by' => $owner->id,
            'confirmed_at' => now(),
            'confirmation_method' => 'saw_original',
            'confirmed_for_organization_id' => $orgId,
        ]);
        $this->recordQualification($b->id, ['qualification_type' => 'manual_handling']);
        $this->recordQualification($b->id, [], 999);

        $this->actingAsMember();
        $this->apiGet('/v2/admin/volunteering/qualifications')->assertStatus(403);

        Sanctum::actingAs($this->member(['role' => 'broker']), ['*']);
        $response = $this->apiGet('/v2/admin/volunteering/qualifications');
        $response->assertOk()
            ->assertJsonPath('data.total', 2)
            ->assertJsonPath('data.counts.confirmed', 1)
            ->assertJsonPath('data.counts.recorded', 1);
        $this->assertCount(2, $response->json('data.items'));
        $confirmedItem = collect($response->json('data.items'))->firstWhere('id', $confirmed);
        $this->assertSame($orgId, $confirmedItem['confirmed_for_organization']['id']);
        $this->assertArrayHasKey('volunteer', $confirmedItem);

        $this->apiGet('/v2/admin/volunteering/qualifications?type=manual_handling')
            ->assertOk()->assertJsonPath('data.total', 1);
        $this->apiGet('/v2/admin/volunteering/qualifications?status=confirmed')
            ->assertOk()->assertJsonPath('data.total', 1)->assertJsonPath('data.items.0.id', $confirmed);
        $this->apiGet('/v2/admin/volunteering/qualifications?per_page=1&page=2')
            ->assertOk()->assertJsonPath('data.total', 2)->assertJsonCount(1, 'data.items');
    }

    // ------------------------------------------------------------------
    // Nightly command
    // ------------------------------------------------------------------

    public function test_nightly_command_expires_reminds_once_stamps_and_tells_the_organisation(): void
    {
        $this->setReminderSetting(true, true, 30);
        $owner = $this->member(['email' => $this->unroutableEmail()]);
        $orgId = $this->createOrganisation($owner->id);
        $volunteer = $this->member(['email' => $this->unroutableEmail()]);
        $this->linkVolunteer($volunteer->id, $orgId);

        $past = $this->recordQualification($volunteer->id, ['status' => 'confirmed', 'expires_at' => now()->subDay()->toDateString()]);
        $soon = $this->recordQualification($volunteer->id, ['qualification_type' => 'food_hygiene', 'expires_at' => now()->addDays(5)->toDateString()]);
        $far = $this->recordQualification($volunteer->id, ['qualification_type' => 'manual_handling', 'expires_at' => now()->addDays(90)->toDateString()]);
        $withdrawn = $this->recordQualification($volunteer->id, ['status' => 'withdrawn', 'expires_at' => now()->subDay()->toDateString(), 'withdrawn_at' => now(), 'withdrawal_reason' => 'replaced']);

        $this->artisan('volunteering:qualification-expiry', ['--tenant' => $this->testTenantId])
            ->expectsOutputToContain('Done: 1 expired, 1 expired notices, 1 reminders, 1 organisation digests across 1 tenant.')
            ->assertSuccessful();

        $pastRow = DB::table('vol_qualifications')->where('id', $past)->first();
        $this->assertSame('expired', $pastRow->status);
        $this->assertNotNull($pastRow->expired_notice_sent_at);
        $this->assertSame(['expired', 'expired_notice_sent'], $this->events($past));

        $soonRow = DB::table('vol_qualifications')->where('id', $soon)->first();
        $this->assertSame('recorded', $soonRow->status);
        $this->assertNotNull($soonRow->expiry_reminder_sent_at);
        $this->assertSame(['reminder_sent'], $this->events($soon));

        $this->assertNull(DB::table('vol_qualifications')->where('id', $far)->value('expiry_reminder_sent_at'));
        $this->assertSame('withdrawn', DB::table('vol_qualifications')->where('id', $withdrawn)->value('status'));
        $this->assertSame([], $this->events($withdrawn));

        $volunteerBells = DB::table('notifications')->where('tenant_id', $this->testTenantId)->where('user_id', $volunteer->id)->where('type', 'qualification_expiry')->get();
        $this->assertCount(2, $volunteerBells);
        $this->assertSame('/volunteering?tab=credentials', $volunteerBells[0]->link);

        $ownerBells = DB::table('notifications')->where('tenant_id', $this->testTenantId)->where('user_id', $owner->id)->where('type', 'qualification_expiry')->get();
        $this->assertCount(1, $ownerBells, 'one digest per confirmer, not one per record');
        $this->assertSame("/volunteering/org/{$orgId}/dashboard?tab=qualifications", $ownerBells[0]->link);
        // Worded so the number never needs a plural: "...needing attention at <org>: 2".
        $this->assertStringEndsWith(': 2', $ownerBells[0]->message);
        $this->assertStringContainsString('needing attention at', $ownerBells[0]->message);

        // Second run: nothing is sent twice.
        $this->artisan('volunteering:qualification-expiry', ['--tenant' => $this->testTenantId])
            ->expectsOutputToContain('0 expired, 0 expired notices, 0 reminders, 0 organisation digests')
            ->assertSuccessful();
        $this->assertSame(2, DB::table('notifications')->where('tenant_id', $this->testTenantId)->where('user_id', $volunteer->id)->where('type', 'qualification_expiry')->count());
    }

    public function test_nightly_command_honours_the_window_and_the_enabled_and_email_switches(): void
    {
        $volunteer = $this->member(['email' => $this->unroutableEmail()]);

        // Window 7: a record 10 days out is not "soon".
        $this->setReminderSetting(true, true, 7);
        $tenDays = $this->recordQualification($volunteer->id, ['expires_at' => now()->addDays(10)->toDateString()]);
        $this->artisan('volunteering:qualification-expiry', ['--tenant' => $this->testTenantId])->assertSuccessful();
        $this->assertNull(DB::table('vol_qualifications')->where('id', $tenDays)->value('expiry_reminder_sent_at'));

        // Switched off: records still expire, but nobody is told and nothing is stamped.
        $this->setReminderSetting(false, true, 30);
        $past = $this->recordQualification($volunteer->id, ['expires_at' => now()->subDays(2)->toDateString()]);
        $this->artisan('volunteering:qualification-expiry', ['--tenant' => $this->testTenantId])
            ->expectsOutputToContain('reminders switched off')
            ->assertSuccessful();
        $this->assertSame('expired', DB::table('vol_qualifications')->where('id', $past)->value('status'));
        $this->assertNull(DB::table('vol_qualifications')->where('id', $past)->value('expired_notice_sent_at'));
        $this->assertNull(DB::table('vol_qualifications')->where('id', $tenDays)->value('expiry_reminder_sent_at'));
        $this->assertSame(0, DB::table('notifications')->where('tenant_id', $this->testTenantId)->where('user_id', $volunteer->id)->where('type', 'qualification_expiry')->count());

        // Email off: the bell still goes, the email channel is recorded as disabled.
        $this->setReminderSetting(true, false, 30);
        $this->artisan('volunteering:qualification-expiry', ['--tenant' => $this->testTenantId])->assertSuccessful();
        $this->assertNotNull(DB::table('vol_qualifications')->where('id', $tenDays)->value('expiry_reminder_sent_at'));
        $this->assertNotNull(DB::table('vol_qualifications')->where('id', $past)->value('expired_notice_sent_at'));
        $this->assertSame(2, DB::table('notifications')->where('tenant_id', $this->testTenantId)->where('user_id', $volunteer->id)->where('type', 'qualification_expiry')->count());
        $reminder = DB::table('vol_qualification_events')->where('qualification_id', $tenDays)->where('event', 'reminder_sent')->first();
        $this->assertSame('disabled', json_decode((string) $reminder->details, true)['email']);
    }

    public function test_nightly_command_dry_run_writes_nothing(): void
    {
        $this->setReminderSetting(true, true, 30);
        $volunteer = $this->member(['email' => $this->unroutableEmail()]);
        $past = $this->recordQualification($volunteer->id, ['expires_at' => now()->subDay()->toDateString()]);
        $soon = $this->recordQualification($volunteer->id, ['expires_at' => now()->addDays(3)->toDateString()]);

        $this->artisan('volunteering:qualification-expiry', ['--tenant' => $this->testTenantId, '--dry-run' => true])
            ->expectsOutputToContain('DRY RUN: 1 expired, 1 expired notices, 1 reminders, 0 organisation digests')
            ->assertSuccessful();

        $this->assertSame('recorded', DB::table('vol_qualifications')->where('id', $past)->value('status'));
        $this->assertNull(DB::table('vol_qualifications')->where('id', $soon)->value('expiry_reminder_sent_at'));
        $this->assertSame([], $this->events($past));
        $this->assertSame([], $this->events($soon));
        $this->assertSame(0, DB::table('notifications')->where('tenant_id', $this->testTenantId)->where('user_id', $volunteer->id)->count());
    }
}
