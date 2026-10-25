<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

declare(strict_types=1);

namespace Tests\Laravel\Feature\Safeguarding;

use App\Jobs\SendSafeguardingChoicesSummary;
use App\Models\TenantSafeguardingOption;
use App\Models\User;
use App\Services\SafeguardingTriggerService;
use Illuminate\Foundation\Testing\DatabaseTransactions;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Queue;
use Laravel\Sanctum\Sanctum;
use Tests\Laravel\TestCase;

/**
 * Safeguarding questions overhaul (25 Oct 2026).
 *
 * The onboarding question "I would prefer to only interact with members who
 * have been appropriately vetted" was a hard contact block, worded as a soft
 * preference. In tenant 2 five members had ticked it while the community had
 * recorded no vetting for anyone, so nobody at all could reach them. These
 * tests pin the corrected behaviour:
 *
 *  - every question tells the member, before they tick it, what it actually
 *    does — generated from the option's own rules, so wording cannot drift
 *    from enforcement again;
 *  - the hard "vetted only" block is no longer offered to new members, but
 *    keeps protecting (and stays visible to) the members who chose it;
 *  - a gentler "coordinator introductions" option exists that does not cut
 *    the member off;
 *  - "I consider myself a vulnerable adult" no longer silently blocks every
 *    direct message;
 *  - the under-18 question is gone (the platform is adults only).
 */
final class SafeguardingQuestionsOverhaulTest extends TestCase
{
    use DatabaseTransactions;

    public function test_every_preset_drops_the_under_18_question_and_offers_coordinator_introductions(): void
    {
        foreach (config('safeguarding_presets') as $presetKey => $preset) {
            $keys = array_column($preset['options'] ?? [], 'option_key');
            if ($presetKey === 'custom') {
                continue;
            }

            $this->assertNotContains('works_with_children', $keys, "{$presetKey} must not ask about under-18s");
            $this->assertContains('coordinator_introductions', $keys, "{$presetKey} must offer coordinator introductions");

            $byKey = array_column($preset['options'], null, 'option_key');
            $this->assertFalse(
                $byKey['requires_vetted_partners']['accepts_new_selections'] ?? true,
                "{$presetKey}: the hard vetted-only block must not be offered to new members by default",
            );
            $this->assertArrayNotHasKey(
                'restricts_messaging',
                $byKey['is_vulnerable_adult']['triggers'],
                "{$presetKey}: identifying as a vulnerable adult must not silently block all messages",
            );
            $this->assertFalse(
                (bool) ($byKey['coordinator_introductions']['triggers']['restricts_messaging'] ?? false),
                "{$presetKey}: coordinator introductions must not block messages",
            );
            $this->assertFalse(
                (bool) ($byKey['coordinator_introductions']['triggers']['requires_vetted_interaction'] ?? false),
                "{$presetKey}: coordinator introductions must not require vetting",
            );
        }
    }

    public function test_the_wizard_hides_the_vetted_only_block_from_members_who_do_not_hold_it(): void
    {
        $this->applyIrelandPreset();
        $member = $this->member();

        Sanctum::actingAs($member);
        $keys = array_column($this->apiGet('/v2/onboarding/safeguarding-options')->assertOk()->json('data'), 'option_key');

        $this->assertNotContains('requires_vetted_partners', $keys);
        $this->assertNotContains('works_with_children', $keys);
        $this->assertContains('coordinator_introductions', $keys);
    }

    public function test_a_member_who_holds_the_vetted_only_block_still_sees_it_and_it_still_protects_them(): void
    {
        $this->applyIrelandPreset();
        $holder = $this->member();
        $this->holdOption($holder, 'requires_vetted_partners');

        Sanctum::actingAs($holder);
        $keys = array_column($this->apiGet('/v2/onboarding/safeguarding-options')->assertOk()->json('data'), 'option_key');
        $this->assertContains('requires_vetted_partners', $keys);

        $sender = $this->member();
        Sanctum::actingAs($sender);
        $this->apiPost('/v2/messages', ['recipient_id' => $holder->id, 'body' => 'hello'])
            ->assertStatus(403)
            ->assertJsonPath('errors.0.code', 'VETTING_REQUIRED');
    }

    public function test_a_new_member_cannot_select_the_closed_option_by_calling_the_api(): void
    {
        $this->applyIrelandPreset();
        $member = $this->member();
        $optionId = $this->optionId('requires_vetted_partners');

        Sanctum::actingAs($member);
        $this->apiPost('/v2/onboarding/safeguarding', [
            'preferences' => [['option_id' => $optionId, 'value' => '1']],
        ])->assertStatus(422);

        $this->assertDatabaseMissing('user_safeguarding_preferences', [
            'tenant_id' => $this->testTenantId,
            'user_id' => $member->id,
            'option_id' => $optionId,
        ]);
    }

    public function test_every_option_tells_the_member_what_it_does_before_they_choose_it(): void
    {
        $this->applyIrelandPreset();
        $holder = $this->member();
        $this->holdOption($holder, 'requires_vetted_partners');

        Sanctum::actingAs($holder);
        $options = $this->apiGet('/v2/onboarding/safeguarding-options')->assertOk()->json('data');

        foreach ($options as $option) {
            $this->assertNotEmpty($option['effects'] ?? [], "{$option['option_key']} must explain what it does");
        }

        $vetted = collect($options)->firstWhere('option_key', 'requires_vetted_partners');
        $text = implode(' ', $vetted['effects']);
        $this->assertStringContainsString('message you', $text);
        $this->assertStringContainsString('time credits', $text);
        $this->assertStringContainsString('No members', $text, 'With no vetting recorded the member must be told nobody can reach them');
    }

    public function test_coordinator_introductions_adds_oversight_without_cutting_the_member_off(): void
    {
        $this->applyIrelandPreset();
        $member = $this->member();

        Sanctum::actingAs($member);
        $this->apiPost('/v2/onboarding/safeguarding', [
            'preferences' => [['option_id' => $this->optionId('coordinator_introductions'), 'value' => '1']],
        ])->assertOk();

        SafeguardingTriggerService::invalidateCache($member->id, $this->testTenantId);
        $this->assertTrue(SafeguardingTriggerService::requiresBrokerApproval($member->id, $this->testTenantId));
        $this->assertTrue(SafeguardingTriggerService::isMatchingRestricted($member->id, $this->testTenantId));
        $this->assertFalse(SafeguardingTriggerService::isMessagingRestricted($member->id, $this->testTenantId));
        $this->assertFalse(SafeguardingTriggerService::requiresVettedInteraction($member->id, $this->testTenantId));

        Sanctum::actingAs($this->member());
        $this->apiPost('/v2/messages', ['recipient_id' => $member->id, 'body' => 'hi there'])->assertSuccessful();
    }

    public function test_a_holder_can_switch_from_vetted_only_to_coordinator_introductions_in_one_step(): void
    {
        $this->applyIrelandPreset();
        $holder = $this->member();
        $this->holdOption($holder, 'requires_vetted_partners');

        Sanctum::actingAs($holder);
        $prefs = $this->apiGet('/v2/safeguarding/my-preferences')->assertOk();
        $this->assertTrue((bool) $prefs->json('data.can_switch_to_coordinator_introductions'));
        $this->assertNotEmpty($prefs->json('data.preferences.0.effects'));

        $this->apiPost('/v2/safeguarding/switch-to-coordinator-introductions')->assertOk();

        $this->assertNotNull(DB::table('user_safeguarding_preferences')
            ->where('tenant_id', $this->testTenantId)
            ->where('user_id', $holder->id)
            ->where('option_id', $this->optionId('requires_vetted_partners'))
            ->value('revoked_at'));
        $this->assertDatabaseHas('user_safeguarding_preferences', [
            'tenant_id' => $this->testTenantId,
            'user_id' => $holder->id,
            'option_id' => $this->optionId('coordinator_introductions'),
            'revoked_at' => null,
        ]);

        SafeguardingTriggerService::invalidateCache($holder->id, $this->testTenantId);
        Sanctum::actingAs($this->member());
        $this->apiPost('/v2/messages', ['recipient_id' => $holder->id, 'body' => 'now reachable'])->assertSuccessful();
    }

    public function test_switching_is_refused_for_a_member_who_does_not_hold_the_vetted_option(): void
    {
        $this->applyIrelandPreset();
        Sanctum::actingAs($this->member());

        $this->apiPost('/v2/safeguarding/switch-to-coordinator-introductions')->assertStatus(409);
    }

    public function test_saving_choices_queues_one_summary_email_and_declining_queues_none(): void
    {
        $this->applyIrelandPreset();
        Queue::fake();

        $member = $this->member();
        Sanctum::actingAs($member);
        $this->apiPost('/v2/onboarding/safeguarding', [
            'preferences' => [['option_id' => $this->optionId('no_home_visits'), 'value' => '1']],
        ])->assertOk();
        Queue::assertPushed(SendSafeguardingChoicesSummary::class, fn ($job) => $job->userId === $member->id);

        Queue::fake();
        $decliner = $this->member();
        Sanctum::actingAs($decliner);
        $this->apiPost('/v2/onboarding/safeguarding', [
            'preferences' => [['option_id' => $this->optionId('none_apply'), 'value' => '1']],
        ])->assertOk();
        Queue::assertNotPushed(SendSafeguardingChoicesSummary::class);
    }

    private function applyIrelandPreset(): void
    {
        Sanctum::actingAs(User::factory()->forTenant($this->testTenantId)->admin()->create());
        $this->apiPut('/v2/admin/vetting/policy', ['jurisdiction' => 'ireland'])->assertStatus(200);
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

    /** Seed a selection the way an existing member made it, before the option was closed. */
    private function holdOption(User $member, string $key): void
    {
        DB::table('user_safeguarding_preferences')->insert([
            'tenant_id' => $this->testTenantId,
            'user_id' => $member->id,
            'option_id' => $this->optionId($key),
            'selected_value' => '1',
            'consent_given_at' => now(),
            'consent_ip' => '127.0.0.1',
            'created_at' => now(),
            'updated_at' => now(),
        ]);
        SafeguardingTriggerService::invalidateCache($member->id, $this->testTenantId);
    }
}
