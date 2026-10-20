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
 * A community's wellbeing settings: who is told first when a volunteer asks
 * for someone to get in touch, and the "need support now" box every volunteer
 * sees on the wellbeing page. Community administrators manage them; brokers
 * read the alerts but never the settings.
 */
class VolunteerWellbeingSettingsTest extends TestCase
{
    use DatabaseTransactions;

    /**
     * Each test runs in a community of its own. The shared test community can hold
     * staff accounts left by other suites (CI shard 6, 20 Oct 2026: a second staff
     * member made "told 1 person" read 2), and who is told is exactly what these
     * tests count.
     */
    protected function setUp(): void
    {
        parent::setUp();
        $id = (int) \Illuminate\Support\Facades\DB::table('tenants')->insertGetId([
            'name' => 'Wellbeing isolated',
            'slug' => 'wellbeing-iso-' . uniqid(),
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
        \Illuminate\Support\Facades\DB::table('tenants')->where('id', $id)->update(['path' => "/{$id}/"]);
        $this->withTenant($id);
    }

    private const URL = '/v2/admin/volunteering/wellbeing/settings';

    private function enableVolunteering(): void
    {
        DB::table('tenants')->where('id', $this->testTenantId)->update([
            'features' => json_encode(['volunteering' => true, 'organisations' => true]),
        ]);
        TenantContext::setById($this->testTenantId);
    }

    private function person(array $overrides = [], ?int $tenantId = null): User
    {
        return User::factory()->forTenant($tenantId ?? $this->testTenantId)->create(array_merge([
            'status' => 'active',
            'is_approved' => true,
            'role' => 'member',
        ], $overrides));
    }

    public function test_an_administrator_reads_the_defaults_and_saves_contacts_and_a_support_box(): void
    {
        $this->enableVolunteering();
        $admin = $this->person(['is_admin' => 1]);
        $contact = $this->person(['first_name' => 'Nikita', 'last_name' => 'Serkevich']);

        Sanctum::actingAs($admin, ['*']);
        $defaults = $this->apiGet(self::URL)->assertOk()->json('data');
        $this->assertSame([], $defaults['contact_user_ids']);
        $this->assertSame([], $defaults['contacts']);
        $this->assertNull($defaults['contact_email']);
        $this->assertSame('', $defaults['support_text']);
        $this->assertSame([], $defaults['support_links']);
        $this->assertNotSame('', $defaults['defaults']['support_text']);
        $this->assertSame('/contact', $defaults['defaults']['support_links'][0]['url']);

        Sanctum::actingAs($admin, ['*']);
        $saved = $this->apiPut(self::URL, [
            'contact_user_ids' => [(int) $contact->id],
            'contact_email' => ' Wellbeing@Example.org ',
            'support_text' => "If you need to talk to someone now, call the <b>Samaritans</b>.\nThey are free.",
            'support_links' => [
                ['label' => 'Samaritans', 'url' => 'https://www.samaritans.org/'],
                ['label' => 'Email the team', 'url' => 'mailto:team@example.org'],
                ['label' => 'Call us', 'url' => 'tel:+353123456'],
                ['label' => 'Contact page', 'url' => '/contact'],
            ],
        ])->assertOk()->json('data');

        $this->assertSame([(int) $contact->id], $saved['contact_user_ids']);
        $this->assertSame('Nikita Serkevich', $saved['contacts'][0]['name']);
        $this->assertSame('wellbeing@example.org', $saved['contact_email']);
        $this->assertStringNotContainsString('<b>', $saved['support_text'], 'tags are stripped');
        $this->assertStringContainsString('Samaritans', $saved['support_text']);
        $this->assertCount(4, $saved['support_links']);

        Sanctum::actingAs($admin, ['*']);
        $again = $this->apiGet(self::URL)->assertOk()->json('data');
        $this->assertSame($saved['support_links'], $again['support_links']);
    }

    public function test_brokers_and_members_cannot_read_or_change_the_settings(): void
    {
        $this->enableVolunteering();
        $broker = $this->person(['role' => 'broker']);
        $member = $this->person();

        Sanctum::actingAs($broker, ['*']);
        $this->apiGet(self::URL)->assertStatus(403);
        Sanctum::actingAs($broker, ['*']);
        $this->apiPut(self::URL, ['support_text' => 'x'])->assertStatus(403);
        Sanctum::actingAs($member, ['*']);
        $this->apiGet(self::URL)->assertStatus(403);
    }

    public function test_a_contact_from_another_community_or_an_inactive_member_is_refused(): void
    {
        $this->enableVolunteering();
        $admin = $this->person(['is_admin' => 1]);
        $foreign = $this->person([], 999);
        $inactive = $this->person(['status' => 'suspended']);

        Sanctum::actingAs($admin, ['*']);
        $this->apiPut(self::URL, ['contact_user_ids' => [(int) $foreign->id]])
            ->assertStatus(422)
            ->assertJsonPath('errors.0.field', 'contact_user_ids');

        Sanctum::actingAs($admin, ['*']);
        $this->apiPut(self::URL, ['contact_user_ids' => [(int) $inactive->id]])
            ->assertStatus(422)
            ->assertJsonPath('errors.0.field', 'contact_user_ids');

        $this->assertNull(DB::table('tenant_settings')->where('tenant_id', $this->testTenantId)->where('setting_key', 'volunteering.wellbeing_contact_user_ids')->value('setting_value'));
    }

    public function test_an_unsafe_link_a_bad_email_and_too_many_contacts_are_refused(): void
    {
        $this->enableVolunteering();
        $admin = $this->person(['is_admin' => 1]);

        Sanctum::actingAs($admin, ['*']);
        $this->apiPut(self::URL, ['support_links' => [['label' => 'x', 'url' => 'javascript:alert(1)']]])
            ->assertStatus(422)
            ->assertJsonPath('errors.0.field', 'support_links');

        Sanctum::actingAs($admin, ['*']);
        $this->apiPut(self::URL, ['support_links' => [['label' => 'x', 'url' => 'http://insecure.example']]])
            ->assertStatus(422)
            ->assertJsonPath('errors.0.field', 'support_links');

        Sanctum::actingAs($admin, ['*']);
        $this->apiPut(self::URL, ['contact_email' => 'not-an-address'])
            ->assertStatus(422)
            ->assertJsonPath('errors.0.field', 'contact_email');

        $ids = [];
        for ($i = 0; $i < 11; $i++) {
            $ids[] = (int) $this->person()->id;
        }
        Sanctum::actingAs($admin, ['*']);
        $this->apiPut(self::URL, ['contact_user_ids' => $ids])
            ->assertStatus(422)
            ->assertJsonPath('errors.0.field', 'contact_user_ids');
    }

    public function test_the_volunteer_dashboard_carries_the_support_box_and_when_the_team_was_last_told(): void
    {
        $this->enableVolunteering();
        $admin = $this->person(['is_admin' => 1]);
        $volunteer = $this->person();

        Sanctum::actingAs($volunteer, ['*']);
        $before = $this->apiGet('/v2/volunteering/wellbeing')->assertOk()->json('data');
        $this->assertTrue($before['support']['is_default']);
        $this->assertNotSame('', $before['support']['text']);
        $this->assertSame('/contact', $before['support']['links'][0]['url']);
        $this->assertNull($before['last_team_notified_at']);
        $this->assertSame(0, $before['last_told_count']);

        Sanctum::actingAs($admin, ['*']);
        $this->apiPut(self::URL, [
            'support_text' => 'Ring the office any weekday.',
            'support_links' => [['label' => 'Our office', 'url' => 'tel:+353100']],
        ])->assertOk();

        Sanctum::actingAs($volunteer, ['*']);
        $this->apiPost('/v2/volunteering/wellbeing/checkin', ['mood' => 1, 'share_with_team' => true])->assertOk();

        Sanctum::actingAs($volunteer, ['*']);
        $after = $this->apiGet('/v2/volunteering/wellbeing')->assertOk()->json('data');
        $this->assertFalse($after['support']['is_default']);
        $this->assertSame('Ring the office any weekday.', $after['support']['text']);
        $this->assertSame('tel:+353100', $after['support']['links'][0]['url']);
        $this->assertNotNull($after['last_team_notified_at']);
        $this->assertSame(1, $after['last_told_count']);
    }
}
