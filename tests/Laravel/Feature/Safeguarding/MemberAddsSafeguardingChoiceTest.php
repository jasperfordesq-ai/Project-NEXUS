<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

declare(strict_types=1);

namespace Tests\Laravel\Feature\Safeguarding;

use App\Events\SafeguardingFlaggedEvent;
use App\Jobs\SendSafeguardingChoicesSummary;
use App\Models\TenantSafeguardingOption;
use App\Models\User;
use App\Services\SafeguardingTriggerService;
use Illuminate\Foundation\Testing\DatabaseTransactions;
use Illuminate\Support\Facades\Cache;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Event;
use Illuminate\Support\Facades\Queue;
use Laravel\Sanctum\Sanctum;
use Tests\Laravel\TestCase;

/**
 * After joining, a member could review or remove a safeguarding choice but
 * never ADD one: the only way to pick a choice was the onboarding wizard.
 * These tests pin the member-side "add extra support" path:
 *
 *  - only options still offered to new members can be newly chosen;
 *  - a closed option can be re-confirmed only by a member who already holds it;
 *  - adding a choice has every effect onboarding has: consent time and IP,
 *    the coordinator alert, the summary email, and the protections themselves;
 *  - another community's option is refused.
 */
final class MemberAddsSafeguardingChoiceTest extends TestCase
{
    use DatabaseTransactions;

    public function test_available_options_lists_open_choices_not_already_held_with_their_effects(): void
    {
        $this->applyEnglandWalesPreset();
        $member = $this->member();

        Sanctum::actingAs($member);
        $options = $this->apiGet('/v2/safeguarding/available-options')->assertOk()->json('data.options');

        $keys = array_column($options, 'option_key');
        // "None of these apply" is not extra support, and closed options are
        // never offered to a member who does not hold them.
        $this->assertSame(['is_vulnerable_adult'], $keys);
        $this->assertNotEmpty($options[0]['effects']);
        $this->assertNotEmpty($options[0]['label']);

        $this->holdOption($member, 'is_vulnerable_adult');
        $this->assertSame([], $this->apiGet('/v2/safeguarding/available-options')->assertOk()->json('data.options'));
    }

    public function test_a_member_can_add_an_open_option_and_it_takes_effect_like_onboarding(): void
    {
        $this->applyEnglandWalesPreset();
        Queue::fake();
        Event::fake([SafeguardingFlaggedEvent::class]);

        $member = $this->member();
        // They answered "none of these apply" when they joined.
        $this->holdOption($member, 'none_apply');
        Cache::forget('safeguarding_triggers:flagged:' . $this->testTenantId . ':' . $member->id);

        Sanctum::actingAs($member);
        $this->apiPost('/v2/safeguarding/add-choice', ['option_id' => $this->optionId('is_vulnerable_adult')])
            ->assertOk()
            ->assertJsonPath('data.added', true);

        $row = DB::table('user_safeguarding_preferences')
            ->where('tenant_id', $this->testTenantId)
            ->where('user_id', $member->id)
            ->where('option_id', $this->optionId('is_vulnerable_adult'))
            ->first();
        $this->assertNotNull($row);
        $this->assertNull($row->revoked_at);
        $this->assertSame('1', (string) $row->selected_value);
        $this->assertNotNull($row->consent_given_at);
        $this->assertNotEmpty($row->consent_ip);

        // A real choice replaces "none of these apply".
        $this->assertNotNull(DB::table('user_safeguarding_preferences')
            ->where('tenant_id', $this->testTenantId)
            ->where('user_id', $member->id)
            ->where('option_id', $this->optionId('none_apply'))
            ->value('revoked_at'));

        // Coordinators are alerted and the member gets the summary email.
        Event::assertDispatched(SafeguardingFlaggedEvent::class, fn ($e) => $e->userId === $member->id);
        Queue::assertPushed(SendSafeguardingChoicesSummary::class, fn ($job) => $job->userId === $member->id);

        // The protection is live.
        SafeguardingTriggerService::invalidateCache($member->id, $this->testTenantId);
        $this->assertTrue(SafeguardingTriggerService::requiresBrokerApproval($member->id, $this->testTenantId));

        $keys = array_column($this->apiGet('/v2/safeguarding/my-preferences')->assertOk()->json('data.preferences'), 'option_key');
        $this->assertContains('is_vulnerable_adult', $keys);
        $this->assertNotContains('none_apply', $keys);
    }

    public function test_a_member_cannot_add_a_closed_option_they_do_not_hold(): void
    {
        $this->applyEnglandWalesPreset();
        $member = $this->member();
        $optionId = $this->optionId('coordinator_introductions');

        Sanctum::actingAs($member);
        $this->apiPost('/v2/safeguarding/add-choice', ['option_id' => $optionId])->assertStatus(422);

        $this->assertDatabaseMissing('user_safeguarding_preferences', [
            'tenant_id' => $this->testTenantId,
            'user_id' => $member->id,
            'option_id' => $optionId,
        ]);
    }

    public function test_a_member_who_holds_a_closed_option_may_reconfirm_it(): void
    {
        $this->applyEnglandWalesPreset();
        $member = $this->member();
        $this->holdOption($member, 'coordinator_introductions');

        Sanctum::actingAs($member);
        $this->apiPost('/v2/safeguarding/add-choice', ['option_id' => $this->optionId('coordinator_introductions')])
            ->assertOk();
    }

    public function test_none_apply_cannot_be_added_as_extra_support(): void
    {
        $this->applyEnglandWalesPreset();
        Sanctum::actingAs($this->member());

        $this->apiPost('/v2/safeguarding/add-choice', ['option_id' => $this->optionId('none_apply')])->assertStatus(422);
    }

    public function test_another_communitys_option_is_refused(): void
    {
        $this->applyEnglandWalesPreset();
        $otherTenantOptionId = (int) DB::table('tenant_safeguarding_options')->insertGetId([
            'tenant_id' => $this->testTenantId === 1 ? 2 : 1,
            'option_key' => 'is_vulnerable_adult',
            'option_type' => 'checkbox',
            'label' => 'Other community option',
            'is_active' => 1,
            'sort_order' => 1,
            'triggers' => json_encode(['notify_admin_on_selection' => true]),
            'created_at' => now(),
            'updated_at' => now(),
        ]);

        $member = $this->member();
        Sanctum::actingAs($member);
        $this->apiPost('/v2/safeguarding/add-choice', ['option_id' => $otherTenantOptionId])->assertStatus(422);

        $this->assertDatabaseMissing('user_safeguarding_preferences', [
            'user_id' => $member->id,
            'option_id' => $otherTenantOptionId,
        ]);
    }

    public function test_adding_requires_a_signed_in_member(): void
    {
        $this->applyEnglandWalesPreset();
        $optionId = $this->optionId('is_vulnerable_adult');
        $this->app['auth']->forgetGuards();

        $this->apiPost('/v2/safeguarding/add-choice', ['option_id' => $optionId])->assertStatus(401);
    }

    private function applyEnglandWalesPreset(): void
    {
        Sanctum::actingAs(User::factory()->forTenant($this->testTenantId)->admin()->create());
        $this->apiPut('/v2/admin/vetting/policy', ['jurisdiction' => 'england_wales'])->assertStatus(200);
    }

    private function member(): User
    {
        return User::factory()->forTenant($this->testTenantId)->create(['status' => 'active']);
    }

    private function optionId(string $key): int
    {
        return (int) TenantSafeguardingOption::withoutGlobalScopes()
            ->where('tenant_id', $this->testTenantId)
            ->where('option_key', $key)
            ->where('is_active', true)
            ->valueOrFail('id');
    }

    private function holdOption(User $member, string $key): void
    {
        DB::table('user_safeguarding_preferences')->insert([
            'tenant_id' => $this->testTenantId,
            'user_id' => $member->id,
            'option_id' => $this->optionId($key),
            'selected_value' => '1',
            'consent_given_at' => now()->subYear(),
            'consent_ip' => '127.0.0.1',
            'created_at' => now(),
            'updated_at' => now(),
        ]);
        SafeguardingTriggerService::invalidateCache($member->id, $this->testTenantId);
    }
}
