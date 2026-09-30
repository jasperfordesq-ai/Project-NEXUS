<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

declare(strict_types=1);

namespace Tests\Laravel\Feature\Security\E073;

use App\Models\TenantSafeguardingOption;
use App\Models\User;
use App\Services\SafeguardingTriggerService;
use Illuminate\Foundation\Testing\DatabaseTransactions;
use Illuminate\Support\Facades\DB;
use Laravel\Sanctum\Sanctum;
use Tests\Laravel\TestCase;

/**
 * F-433 (E-073 B-1) — retyping a safeguarding option must not silently strip a
 * live member protection.
 *
 * `SafeguardingPreferenceService::mutationWeakensProtection()` refuses a staff
 * mutation that would weaken a protection a member is actually relying on. It
 * inspected only the submitted `is_active` and `triggers`. `option_type` is in
 * the same writable list, and `UserSafeguardingPreference::isEffectivelySelected()`
 * switches on `option_type` with `default => false` — so retyping a `checkbox`
 * option as `info` made every stored selection stop counting. The consent row,
 * the active flag and the protective triggers were all untouched, yet
 * `SafeguardingTriggerService` stopped merging the trigger and an unvetted
 * sender's message was delivered. The member was never told.
 *
 * This test asserts the CORRECT behaviour: the same guard that already refuses
 * deactivation and trigger removal must also refuse a type change that would
 * drop a live selection — for an administrator and for a broker, since the
 * route group is broker-or-admin.
 *
 * Controls (a guard, not a removal of the feature):
 *  - a type change on an option with no live protected selection still succeeds;
 *  - a type change that keeps every live selection counting (checkbox -> select,
 *    where the stored '1' is still an affirmative answer) still succeeds, and
 *    contact stays blocked afterwards.
 *
 * The enforcement read is cached for 5 minutes, so every assertion clears the
 * member's trigger cache explicitly rather than depending on its timing.
 */
final class F433OptionTypeCannotStripLiveProtectionTest extends TestCase
{
    use DatabaseTransactions;

    public function test_an_admin_cannot_retype_a_live_protected_option_as_info(): void
    {
        [$admin, $sender, $recipient, $option, $preferenceId] = $this->seedLivePresetProtection();

        Sanctum::actingAs($admin);
        $this->apiPut("/v2/admin/safeguarding/options/{$option->id}", [
            'option_type' => 'info',
        ])->assertStatus(503)
            ->assertJsonPath('errors.0.code', 'SAFEGUARDING_POLICY_UNAVAILABLE');

        $option->refresh();
        $this->assertSame('checkbox', $option->option_type, 'The option type must be unchanged');
        $this->assertTrue($option->is_active);
        $this->assertTrue($option->getTrigger('requires_vetted_interaction'));
        $this->assertNull(DB::table('user_safeguarding_preferences')
            ->where('id', $preferenceId)
            ->value('revoked_at'));

        $this->assertTriggerStillProtects($recipient);
        $this->assertContactRemainsBlocked($sender, $recipient, 'Retyping as info must not open contact');
    }

    public function test_a_broker_cannot_retype_a_live_protected_option_as_info(): void
    {
        [, $sender, $recipient, $option, $preferenceId] = $this->seedLivePresetProtection();

        $broker = User::factory()->forTenant($this->testTenantId)->create([
            'status' => 'active',
            'role' => 'broker',
        ]);

        Sanctum::actingAs($broker);
        $this->apiPut("/v2/admin/safeguarding/options/{$option->id}", [
            'option_type' => 'info',
        ])->assertStatus(503)
            ->assertJsonPath('errors.0.code', 'SAFEGUARDING_POLICY_UNAVAILABLE');

        $option->refresh();
        $this->assertSame('checkbox', $option->option_type, 'The option type must be unchanged');
        $this->assertNull(DB::table('user_safeguarding_preferences')
            ->where('id', $preferenceId)
            ->value('revoked_at'));

        $this->assertTriggerStillProtects($recipient);
        $this->assertContactRemainsBlocked($sender, $recipient, 'A broker must not open contact either');
    }

    /**
     * Control 1 — legitimate access. With no live protected selection there is
     * nothing to strip, so retyping the option is ordinary configuration work
     * and must still succeed.
     */
    public function test_retyping_is_allowed_when_no_live_selection_would_stop_counting(): void
    {
        [$admin, , , $option, $preferenceId] = $this->seedLivePresetProtection();

        DB::table('user_safeguarding_preferences')
            ->where('id', $preferenceId)
            ->update(['revoked_at' => now()]);

        Sanctum::actingAs($admin);
        $this->apiPut("/v2/admin/safeguarding/options/{$option->id}", [
            'option_type' => 'info',
        ])->assertStatus(200);

        $option->refresh();
        $this->assertSame('info', $option->option_type);
    }

    /**
     * Control 2 — legitimate access, differing from the harm case only in the
     * property under test. The member's stored '1' is still an affirmative
     * answer under `select`, so nothing stops counting and the change is
     * allowed. Contact must remain blocked afterwards, proving the change was
     * genuinely harmless rather than merely permitted.
     */
    public function test_retyping_is_allowed_when_every_live_selection_still_counts(): void
    {
        [$admin, $sender, $recipient, $option, $preferenceId] = $this->seedLivePresetProtection();

        Sanctum::actingAs($admin);
        $this->apiPut("/v2/admin/safeguarding/options/{$option->id}", [
            'option_type' => 'select',
            'select_options' => [
                ['value' => '1', 'label' => 'Yes'],
                ['value' => '2', 'label' => 'No'],
            ],
        ])->assertStatus(200);

        $option->refresh();
        $this->assertSame('select', $option->option_type);
        $this->assertNull(DB::table('user_safeguarding_preferences')
            ->where('id', $preferenceId)
            ->value('revoked_at'));

        $this->assertTriggerStillProtects($recipient);
        $this->assertContactRemainsBlocked($sender, $recipient, 'A harmless retype must keep contact closed');
    }

    /** @return array{User, User, User, TenantSafeguardingOption, int} */
    private function seedLivePresetProtection(): array
    {
        $admin = User::factory()->forTenant($this->testTenantId)->admin()->create();
        $sender = User::factory()->forTenant($this->testTenantId)->create(['status' => 'active']);
        $recipient = User::factory()->forTenant($this->testTenantId)->create(['status' => 'active']);

        Sanctum::actingAs($admin);
        $this->apiPut('/v2/admin/vetting/policy', [
            'jurisdiction' => 'england_wales',
        ])->assertStatus(200);

        $option = TenantSafeguardingOption::withoutGlobalScopes()
            ->where('tenant_id', $this->testTenantId)
            ->where('option_key', 'requires_vetted_partners')
            ->where('preset_source', 'england_wales')
            ->where('is_active', true)
            ->firstOrFail();
        $this->assertSame('checkbox', $option->option_type);

        $preferenceId = (int) DB::table('user_safeguarding_preferences')->insertGetId([
            'tenant_id' => $this->testTenantId,
            'user_id' => $recipient->id,
            'option_id' => $option->id,
            'selected_value' => '1',
            'consent_given_at' => now(),
            'consent_ip' => '127.0.0.1',
            'created_at' => now(),
            'updated_at' => now(),
        ]);
        SafeguardingTriggerService::invalidateCache($recipient->id, $this->testTenantId);

        return [$admin, $sender, $recipient, $option, $preferenceId];
    }

    private function assertTriggerStillProtects(User $recipient): void
    {
        SafeguardingTriggerService::invalidateCache($recipient->id, $this->testTenantId);
        $triggers = SafeguardingTriggerService::getActiveTriggersUncached(
            $recipient->id,
            $this->testTenantId,
        );

        $this->assertTrue(
            (bool) ($triggers['requires_vetted_interaction'] ?? false),
            'The member must still be counted as requiring vetted interaction',
        );
    }

    private function assertContactRemainsBlocked(User $sender, User $recipient, string $body): void
    {
        SafeguardingTriggerService::invalidateCache($recipient->id, $this->testTenantId);
        Sanctum::actingAs($sender);
        $this->apiPost('/v2/messages', [
            'recipient_id' => $recipient->id,
            'body' => $body,
        ])->assertStatus(403)->assertJsonPath('errors.0.code', 'VETTING_REQUIRED');
        $this->assertDatabaseMissing('messages', [
            'tenant_id' => $this->testTenantId,
            'sender_id' => $sender->id,
            'receiver_id' => $recipient->id,
            'body' => $body,
        ]);
    }
}
