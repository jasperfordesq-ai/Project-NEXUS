<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

namespace Tests\Laravel\Feature\Volunteering;

use App\Core\TenantContext;
use App\Models\User;
use App\Services\TenantSettingsService;
use Illuminate\Foundation\Testing\DatabaseTransactions;
use Illuminate\Support\Facades\DB;
use Laravel\Sanctum\Sanctum;
use Tests\Laravel\TestCase;

/**
 * Who is told when a volunteer says they are Low or Struggling and asks for
 * someone to get in touch (owner decisions, 20 Oct 2026).
 *
 * In order: the community's named wellbeing contacts (and its extra address),
 * then its safeguarding staff (the volunteer included, when they are staff),
 * then the organisations the volunteer works with, then the staff of the
 * community directly above it. Only when none of those exists is the
 * community's own contact address emailed. Nobody is told twice, and nothing
 * crosses to a sibling community or to the platform master.
 */
class VolunteerWellbeingRecipientChainTest extends TestCase
{
    use DatabaseTransactions;

    private function enableVolunteering(int $tenantId): void
    {
        DB::table('tenants')->where('id', $tenantId)->update([
            'features' => json_encode(['volunteering' => true, 'organisations' => true]),
        ]);
        TenantContext::setById($tenantId);
    }

    private function person(array $overrides = [], ?int $tenantId = null): User
    {
        return User::factory()->forTenant($tenantId ?? $this->testTenantId)->create(array_merge([
            'status' => 'active',
            'is_approved' => true,
            'role' => 'member',
        ], $overrides));
    }

    private function tenant(string $slug, ?int $parentId, string $path): int
    {
        return (int) DB::table('tenants')->insertGetId([
            'name' => 'Chain ' . $slug,
            'slug' => $slug . '-' . uniqid(),
            'domain' => null,
            'is_active' => true,
            'parent_id' => $parentId,
            'path' => $path,
            'depth' => $parentId === null ? 0 : 1,
            'allows_subtenants' => false,
            'features' => json_encode(['volunteering' => true]),
            'contact_email' => null,
            'created_at' => now(),
            'updated_at' => now(),
        ]);
    }

    private function checkin(User $volunteer, int $tenantId)
    {
        $this->withTenant($tenantId);
        Sanctum::actingAs($volunteer, ['*']);

        return $this->apiPost('/v2/volunteering/wellbeing/checkin', ['mood' => 1, 'share_with_team' => true]);
    }

    private function told(User $volunteer, int $tenantId): \Illuminate\Support\Collection
    {
        return DB::table('vol_wellbeing_alert_notifications')
            ->where('tenant_id', $tenantId)
            ->where('volunteer_user_id', $volunteer->id)
            ->where('channel', 'bell')
            ->get()
            ->keyBy('recipient_user_id');
    }

    private function emailsQueued(User $volunteer, int $tenantId): \Illuminate\Support\Collection
    {
        return DB::table('vol_wellbeing_alert_notifications')
            ->where('tenant_id', $tenantId)
            ->where('volunteer_user_id', $volunteer->id)
            ->where('channel', 'email')
            ->get();
    }

    public function test_named_wellbeing_contacts_are_told_first_and_only_once(): void
    {
        $this->enableVolunteering($this->testTenantId);
        $volunteer = $this->person();
        $contact = $this->person();                       // an ordinary member chosen as a contact
        $contactWhoIsAlsoAdmin = $this->person(['is_admin' => 1]);
        $admin = $this->person(['is_admin' => 1]);
        app(TenantSettingsService::class)->set(
            $this->testTenantId,
            'volunteering.wellbeing_contact_user_ids',
            json_encode([(int) $contact->id, (int) $contactWhoIsAlsoAdmin->id]),
            'json'
        );
        app(TenantSettingsService::class)->set($this->testTenantId, 'volunteering.wellbeing_contact_email', 'Wellbeing@Example.org', 'string');

        $response = $this->checkin($volunteer, $this->testTenantId)->assertOk();

        $told = $this->told($volunteer, $this->testTenantId);
        $this->assertSame('contact', $told[$contact->id]->tier);
        $this->assertSame('contact', $told[$contactWhoIsAlsoAdmin->id]->tier, 'first tier wins; no second row as staff');
        $this->assertSame('staff', $told[$admin->id]->tier);
        $this->assertCount(3, $told);

        $extra = $this->emailsQueued($volunteer, $this->testTenantId)->firstWhere('recipient_email', 'wellbeing@example.org');
        $this->assertNotNull($extra, 'the extra address is emailed, lower-cased');
        $this->assertSame('contact_email', $extra->tier);
        $this->assertNull($extra->recipient_user_id);
        $this->assertSame(4, $response->json('data.told_count'));
    }

    public function test_a_contact_id_from_another_community_or_an_inactive_member_is_ignored(): void
    {
        $this->enableVolunteering($this->testTenantId);
        $volunteer = $this->person();
        $foreign = $this->person(['is_admin' => 1], 999);
        $inactive = $this->person(['status' => 'suspended']);
        app(TenantSettingsService::class)->set(
            $this->testTenantId,
            'volunteering.wellbeing_contact_user_ids',
            json_encode([(int) $foreign->id, (int) $inactive->id]),
            'json'
        );
        DB::table('tenants')->where('id', $this->testTenantId)->update(['contact_email' => null]);

        $response = $this->checkin($volunteer, $this->testTenantId)->assertOk();

        $this->assertSame('nobody_available', $response->json('data.outcome'));
        $this->assertCount(0, $this->told($volunteer, $this->testTenantId));
        $this->assertSame(0, DB::table('notifications')->where('user_id', $foreign->id)->where('type', 'volunteer_wellbeing')->count());
    }

    public function test_the_parent_communitys_staff_are_told_but_a_siblings_and_the_platform_masters_are_not(): void
    {
        $hub = $this->tenant('hub', null, '/');
        DB::table('tenants')->where('id', $hub)->update(['path' => "/{$hub}/"]);
        $child = $this->tenant('child', $hub, "/{$hub}/");
        DB::table('tenants')->where('id', $child)->update(['path' => "/{$hub}/{$child}/"]);
        $sibling = $this->tenant('sibling', $hub, "/{$hub}/");
        $this->enableVolunteering($child);

        $volunteer = $this->person([], $child);
        $hubAdmin = $this->person(['is_admin' => 1], $hub);
        $hubMember = $this->person([], $hub);
        $siblingAdmin = $this->person(['is_admin' => 1], $sibling);

        $response = $this->checkin($volunteer, $child)->assertOk();

        $told = $this->told($volunteer, $child);
        $this->assertSame('parent_staff', $told[$hubAdmin->id]->tier);
        $this->assertSame($hub, (int) $told[$hubAdmin->id]->recipient_tenant_id);
        $this->assertArrayNotHasKey($hubMember->id, $told->all());
        $this->assertArrayNotHasKey($siblingAdmin->id, $told->all());
        $this->assertSame(1, $response->json('data.told_count'));

        // The bell lands in the hub administrator's own community.
        $bell = DB::table('notifications')->where('user_id', $hubAdmin->id)->where('type', 'volunteer_wellbeing')->first();
        $this->assertNotNull($bell);
        $this->assertSame($hub, (int) $bell->tenant_id);
    }

    public function test_the_platform_master_is_never_treated_as_a_parent(): void
    {
        $child = $this->tenant('under-master', 1, '/1/');
        $this->enableVolunteering($child);
        $volunteer = $this->person([], $child);
        $masterAdmin = $this->person(['is_admin' => 1], 1);
        DB::table('tenants')->where('id', $child)->update(['contact_email' => null]);

        $response = $this->checkin($volunteer, $child)->assertOk();

        $this->assertSame('nobody_available', $response->json('data.outcome'));
        $this->assertSame(0, DB::table('notifications')->where('user_id', $masterAdmin->id)->where('type', 'volunteer_wellbeing')->count());
    }

    public function test_the_community_contact_address_is_used_only_when_nobody_else_can_be_told(): void
    {
        $this->enableVolunteering($this->testTenantId);
        DB::table('tenants')->where('id', $this->testTenantId)->update(['contact_email' => 'team@community.example']);
        $volunteer = $this->person();

        $response = $this->checkin($volunteer, $this->testTenantId)->assertOk();

        $this->assertSame('told', $response->json('data.outcome'));
        $this->assertSame(1, $response->json('data.told_count'));
        $row = $this->emailsQueued($volunteer, $this->testTenantId)->first();
        $this->assertSame('community_contact_email', $row->tier);
        $this->assertSame('team@community.example', $row->recipient_email);
        $this->assertCount(0, $this->told($volunteer, $this->testTenantId), 'an address gets no bell');

        // Once a staff member exists, the community address is no longer used.
        $admin = $this->person(['is_admin' => 1]);
        $later = $this->person();
        $this->checkin($later, $this->testTenantId)->assertOk();
        $this->assertNull($this->emailsQueued($later, $this->testTenantId)->firstWhere('tier', 'community_contact_email'));
        $this->assertSame('staff', $this->told($later, $this->testTenantId)[$admin->id]->tier);
    }

    public function test_an_extra_address_that_belongs_to_a_staff_member_is_not_emailed_twice(): void
    {
        $this->enableVolunteering($this->testTenantId);
        $volunteer = $this->person();
        $admin = $this->person(['is_admin' => 1, 'email' => 'lead@community.example']);
        app(TenantSettingsService::class)->set($this->testTenantId, 'volunteering.wellbeing_contact_email', 'LEAD@community.example', 'string');

        $this->checkin($volunteer, $this->testTenantId)->assertOk();

        $emails = $this->emailsQueued($volunteer, $this->testTenantId);
        $this->assertCount(1, $emails);
        $this->assertSame($admin->id, (int) $emails->first()->recipient_user_id);
    }
}
