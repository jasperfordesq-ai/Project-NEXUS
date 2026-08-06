<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

declare(strict_types=1);

namespace Tests\Laravel\Feature\Safeguarding;

use App\Models\User;
use App\Support\Safeguarding\SupportTiers;
use Illuminate\Foundation\Testing\DatabaseTransactions;
use Illuminate\Support\Facades\DB;
use Laravel\Sanctum\Sanctum;
use Tests\Laravel\TestCase;

/**
 * Co-decide support actions on the ACCESSIBLE (GOV.UK) frontend.
 *
 * The approval queue shipped in the React app first; this page is its parity.
 * The reasoning is the same as the guardian-arrangement page: the population
 * most likely to have a supporter preparing things for them is precisely the
 * population most likely to be using this frontend. Every answer is a plain
 * form POST — approving, declining (reason optional, NEVER required) and
 * withdrawing all work with no JavaScript.
 */
class AccessibleSupportActionTest extends TestCase
{
    use DatabaseTransactions;

    private string $path;

    protected function setUp(): void
    {
        parent::setUp();
        $this->path = "/{$this->testTenantSlug}/accessible/settings/support-actions";
    }

    /** @return array{0:User,1:User,2:int} [supporter, supported, actionId] */
    private function seedPendingTransfer(float $supportedBalance = 10.0): array
    {
        $tenantId = $this->testTenantId;

        $supporter = User::factory()->forTenant($tenantId)->create([
            'first_name' => 'Sam', 'last_name' => 'Supporter', 'status' => 'active', 'is_approved' => true,
        ]);
        $supported = User::factory()->forTenant($tenantId)->create([
            'first_name' => 'Molly', 'last_name' => 'Member', 'status' => 'active', 'is_approved' => true,
            'balance' => $supportedBalance,
        ]);
        $recipient = User::factory()->forTenant($tenantId)->create([
            'status' => 'active', 'is_approved' => true, 'balance' => 0.0,
        ]);

        $relationshipId = (int) DB::table('account_relationships')->insertGetId([
            'tenant_id' => $tenantId,
            'parent_user_id' => $supporter->id,
            'child_user_id' => $supported->id,
            'relationship_type' => 'carer',
            'permissions' => json_encode(['tiers' => ['credits' => SupportTiers::CO_DECIDE]]),
            'status' => 'active',
            'approved_at' => now(),
            'created_at' => now(),
            'updated_at' => now(),
        ]);

        $actionId = (int) DB::table('support_pending_actions')->insertGetId([
            'tenant_id' => $tenantId,
            'relationship_id' => $relationshipId,
            'supported_user_id' => $supported->id,
            'supporter_user_id' => $supporter->id,
            'action_type' => 'credit_transfer',
            'payload' => json_encode(['recipient' => $recipient->id, 'amount' => 3.0, 'description' => 'Weekly shop']),
            'status' => 'pending',
            'token_hash' => hash('sha256', 'accessible-test-' . uniqid()),
            'expires_at' => now()->addDays(14),
            'created_at' => now(),
            'updated_at' => now(),
        ]);

        return [$supporter, $supported, $actionId];
    }

    public function test_the_page_requires_a_signed_in_member(): void
    {
        $this->get($this->path)->assertRedirect();
    }

    public function test_the_supported_member_sees_the_queue_with_plain_forms(): void
    {
        [, $supported, ] = $this->seedPendingTransfer();
        Sanctum::actingAs($supported);

        $response = $this->get($this->path);

        $response->assertOk();
        $response->assertSee('Sam Supporter');
        $response->assertSee(__('govuk_alpha_settings.support_actions.type_credit_transfer'));
        // Nothing happens unless the member approves — the page says so.
        $response->assertSee(__('govuk_alpha_settings.support_actions.nothing_without_you'));
        // Plain POST forms with submit buttons — no JavaScript required.
        $response->assertSee(
            route('govuk-alpha.settings.support-actions.respond', ['tenantSlug' => $this->testTenantSlug]),
            false
        );
        $response->assertSee('name="action_id"', false);
        $response->assertSee('value="approve"', false);
        $response->assertSee('value="decline"', false);
        // The reason field is offered and plainly optional.
        $response->assertSee('name="reason"', false);
        $response->assertSee(__('govuk_alpha_settings.support_actions.reason_hint'));
    }

    public function test_approving_through_the_form_executes_the_transfer_with_attribution(): void
    {
        [$supporter, $supported, $actionId] = $this->seedPendingTransfer();
        Sanctum::actingAs($supported);

        $response = $this->post(
            "/{$this->testTenantSlug}/accessible/settings/support-actions/respond",
            ['action_id' => $actionId, 'answer' => 'approve'],
        );

        $response->assertRedirect();
        $this->assertStringContainsString('status=support-approved', (string) $response->headers->get('Location'));

        // Executed through the member's own wallet path, attributed to the supporter.
        $this->assertEquals(7.0, (float) DB::table('users')->where('id', $supported->id)->value('balance'));
        $txn = DB::table('transactions')->where('sender_id', $supported->id)->first();
        $this->assertNotNull($txn);
        $this->assertEquals($supporter->id, (int) $txn->acting_user_id);
        $this->assertSame('confirmed', DB::table('support_pending_actions')->where('id', $actionId)->value('status'));
    }

    public function test_declining_without_a_reason_works_and_executes_nothing(): void
    {
        [, $supported, $actionId] = $this->seedPendingTransfer();
        Sanctum::actingAs($supported);

        $response = $this->post(
            "/{$this->testTenantSlug}/accessible/settings/support-actions/respond",
            ['action_id' => $actionId, 'answer' => 'decline'],
        );

        $response->assertRedirect();
        $this->assertStringContainsString('status=support-declined', (string) $response->headers->get('Location'));

        $row = DB::table('support_pending_actions')->where('id', $actionId)->first();
        $this->assertSame('declined', $row->status);
        $this->assertNull($row->decline_reason);
        $this->assertEquals(10.0, (float) DB::table('users')->where('id', $supported->id)->value('balance'));
    }

    public function test_someone_elses_action_cannot_be_answered(): void
    {
        [, , $actionId] = $this->seedPendingTransfer();
        $stranger = User::factory()->forTenant($this->testTenantId)->create([
            'status' => 'active', 'is_approved' => true,
        ]);
        Sanctum::actingAs($stranger);

        $response = $this->post(
            "/{$this->testTenantSlug}/accessible/settings/support-actions/respond",
            ['action_id' => $actionId, 'answer' => 'approve'],
        );

        $response->assertRedirect();
        $this->assertStringContainsString('status=support-failed', (string) $response->headers->get('Location'));
        $this->assertSame('pending', DB::table('support_pending_actions')->where('id', $actionId)->value('status'));
    }

    public function test_the_supporter_can_withdraw_their_own_pending_action(): void
    {
        [$supporter, , $actionId] = $this->seedPendingTransfer();
        Sanctum::actingAs($supporter);

        $response = $this->post(
            "/{$this->testTenantSlug}/accessible/settings/support-actions/respond",
            ['action_id' => $actionId, 'answer' => 'withdraw'],
        );

        $response->assertRedirect();
        $this->assertStringContainsString('status=support-withdrawn', (string) $response->headers->get('Location'));
        $this->assertSame('cancelled', DB::table('support_pending_actions')->where('id', $actionId)->value('status'));
    }
}
