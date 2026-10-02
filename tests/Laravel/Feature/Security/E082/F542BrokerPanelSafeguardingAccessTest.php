<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

declare(strict_types=1);

namespace Tests\Laravel\Feature\Security\E082;

use App\Models\User;
use Illuminate\Foundation\Testing\DatabaseTransactions;
use Illuminate\Support\Facades\DB;
use Laravel\Sanctum\Sanctum;
use Tests\Laravel\TestCase;

/**
 * F-542 (E-082) — the broker panel's Safeguarding page refused the brokers it
 * was built for.
 *
 * `07860e414` (8 Aug 2026) removed `broker` from
 * `AdminSafeguardingController::requireSafeguardingStaff()` and required an
 * individual `safeguarding.view`/`manage` grant instead. No screen can issue
 * that grant (F-363), so every broker and coordinator got 403 on all twelve
 * endpoints the page calls, and the page rendered the refusal as "No member
 * preferences". Owner decision, 2 Oct 2026: brokers have the full broker panel.
 *
 * The self-interest guards added since (F-404 own message copy, F-455 own
 * queue record, F-456 own trail) must keep applying to the brokers now let in.
 */
final class F542BrokerPanelSafeguardingAccessTest extends TestCase
{
    use DatabaseTransactions;

    private const READ_ROUTES = [
        '/v2/admin/safeguarding/dashboard',
        '/v2/admin/safeguarding/flagged-messages',
        '/v2/admin/safeguarding/assignments',
        '/v2/admin/safeguarding/member-preferences',
        '/v2/admin/safeguarding/support-actions',
        '/v2/admin/safeguarding/authority-attestations',
    ];

    public function test_a_broker_can_read_every_safeguarding_view_in_the_broker_panel(): void
    {
        Sanctum::actingAs($this->staff('broker'));

        foreach (self::READ_ROUTES as $route) {
            $this->assertSame(200, $this->apiGet($route)->getStatusCode(), "broker refused on {$route}");
        }
    }

    public function test_a_coordinator_can_read_every_safeguarding_view_in_the_broker_panel(): void
    {
        Sanctum::actingAs($this->staff('coordinator'));

        foreach (self::READ_ROUTES as $route) {
            $this->assertSame(200, $this->apiGet($route)->getStatusCode(), "coordinator refused on {$route}");
        }
    }

    public function test_a_broker_sees_the_members_who_answered_the_wizard_safeguarding_step(): void
    {
        $member = $this->member();
        $optionId = (int) DB::table('tenant_safeguarding_options')->insertGetId([
            'tenant_id' => $this->testTenantId,
            'option_key' => 'f542_vetted_only',
            'option_type' => 'checkbox',
            'label' => 'Only vetted people may contact me',
            'is_active' => 1,
            'sort_order' => 1,
            'triggers' => json_encode(['vetted_contact_only' => true]),
            'created_at' => now(),
        ]);
        DB::table('user_safeguarding_preferences')->insert([
            'tenant_id' => $this->testTenantId,
            'user_id' => $member->id,
            'option_id' => $optionId,
            'selected_value' => '1',
            'consent_given_at' => now(),
            'created_at' => now(),
        ]);

        Sanctum::actingAs($this->staff('broker'));
        $rows = $this->apiGet('/v2/admin/safeguarding/member-preferences')->assertStatus(200)->json('data');

        $this->assertContains((int) $member->id, array_map(fn ($r) => (int) $r['user_id'], $rows));
    }

    public function test_a_broker_can_review_someone_elses_flagged_message(): void
    {
        $copyId = $this->messageCopy((int) $this->member()->id, (int) $this->member()->id);

        Sanctum::actingAs($this->staff('broker'));
        $this->apiPost("/v2/admin/safeguarding/flagged-messages/{$copyId}/review", ['notes' => 'no concern'])
            ->assertStatus(200);
    }

    public function test_a_broker_still_cannot_review_the_copy_of_their_own_message(): void
    {
        $broker = $this->staff('broker');
        $copyId = $this->messageCopy((int) $broker->id, (int) $this->member()->id);

        Sanctum::actingAs($broker);
        $this->apiPost("/v2/admin/safeguarding/flagged-messages/{$copyId}/review", ['notes' => 'fine'])
            ->assertStatus(403);

        $this->assertNull(DB::table('broker_message_copies')->where('id', $copyId)->value('reviewed_at'));
    }

    public function test_control_a_plain_member_is_still_refused(): void
    {
        Sanctum::actingAs($this->member());

        foreach (self::READ_ROUTES as $route) {
            $this->assertSame(403, $this->apiGet($route)->getStatusCode(), "member admitted on {$route}");
        }
    }

    // ── fixtures ────────────────────────────────────────────────────────────

    private function member(): User
    {
        return User::factory()->forTenant($this->testTenantId)->create(['status' => 'active', 'is_approved' => 1]);
    }

    private function staff(string $role): User
    {
        $u = $this->member();
        DB::table('users')->where('id', $u->id)->update(['role' => $role, 'is_admin' => 0]);

        return User::find($u->id);
    }

    private function messageCopy(int $senderId, int $receiverId): int
    {
        $messageId = (int) DB::table('messages')->insertGetId([
            'tenant_id' => $this->testTenantId,
            'sender_id' => $senderId,
            'receiver_id' => $receiverId,
            'subject' => 'F542 fixture',
            'body' => 'F542 fixture body',
            'created_at' => now(),
        ]);

        $ids = [$senderId, $receiverId];
        sort($ids);

        return (int) DB::table('broker_message_copies')->insertGetId([
            'tenant_id' => $this->testTenantId,
            'original_message_id' => $messageId,
            'conversation_key' => md5(implode('-', $ids)),
            'sender_id' => $senderId,
            'receiver_id' => $receiverId,
            'message_body' => 'F542 fixture body',
            'sent_at' => now(),
            'copy_reason' => 'flagged_user',
            'flagged' => 0,
            'created_at' => now(),
        ]);
    }
}
