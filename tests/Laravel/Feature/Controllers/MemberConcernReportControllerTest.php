<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

declare(strict_types=1);

namespace Tests\Laravel\Feature\Controllers;

use App\Core\TenantContext;
use App\Models\User;
use Illuminate\Foundation\Testing\DatabaseTransactions;
use Illuminate\Support\Facades\DB;
use Laravel\Sanctum\Sanctum;
use Tests\Laravel\TestCase;

/**
 * A member can tell their community's coordinators about another member, or
 * about a message they received (safeguarding gap found 26 Oct 2026: members
 * could report listings and posts but not a person or a message).
 *
 * Covers:
 *  - POST /v2/users/{id}/report
 *  - POST /v2/messages/{id}/report
 */
class MemberConcernReportControllerTest extends TestCase
{
    use DatabaseTransactions;

    public function test_reporting_a_member_requires_auth(): void
    {
        $response = $this->apiPost('/v2/users/1/report', ['category' => 'harassment']);

        $this->assertContains($response->getStatusCode(), [401, 403]);
    }

    public function test_member_can_report_another_member(): void
    {
        [$reporter, $target] = $this->members(2);
        Sanctum::actingAs($reporter);

        $response = $this->apiPost("/v2/users/{$target->id}/report", [
            'category' => 'safeguarding_concern',
            'details' => 'I am worried they are asking older members for money.',
        ]);

        $response->assertStatus(201);
        $this->assertDatabaseHas('reports', [
            'tenant_id' => $this->testTenantId,
            'reporter_id' => $reporter->id,
            'target_type' => 'user',
            'target_id' => $target->id,
            'category' => 'safeguarding_concern',
            'reason' => 'I am worried they are asking older members for money.',
            'status' => 'open',
        ]);
    }

    public function test_reason_falls_back_to_the_category_when_no_details_are_given(): void
    {
        [$reporter, $target] = $this->members(2);
        Sanctum::actingAs($reporter);

        $this->apiPost("/v2/users/{$target->id}/report", ['category' => 'harassment'])->assertStatus(201);

        $this->assertDatabaseHas('reports', [
            'reporter_id' => $reporter->id,
            'target_id' => $target->id,
            'category' => 'harassment',
            'reason' => 'harassment',
        ]);
    }

    public function test_member_cannot_report_themselves(): void
    {
        [$reporter] = $this->members(1);
        Sanctum::actingAs($reporter);

        $this->apiPost("/v2/users/{$reporter->id}/report", ['category' => 'harassment'])->assertStatus(422);
    }

    public function test_category_must_be_one_of_the_offered_reasons(): void
    {
        [$reporter, $target] = $this->members(2);
        Sanctum::actingAs($reporter);

        $this->apiPost("/v2/users/{$target->id}/report", ['category' => 'made_up'])->assertStatus(422);
        $this->apiPost("/v2/users/{$target->id}/report", [])->assertStatus(422);
    }

    public function test_other_needs_a_description(): void
    {
        [$reporter, $target] = $this->members(2);
        Sanctum::actingAs($reporter);

        $this->apiPost("/v2/users/{$target->id}/report", ['category' => 'other'])->assertStatus(422);
        $this->apiPost("/v2/users/{$target->id}/report", ['category' => 'other', 'details' => 'Something else'])->assertStatus(201);
    }

    public function test_details_are_limited_to_two_thousand_characters(): void
    {
        [$reporter, $target] = $this->members(2);
        Sanctum::actingAs($reporter);

        $this->apiPost("/v2/users/{$target->id}/report", [
            'category' => 'harassment',
            'details' => str_repeat('a', 2001),
        ])->assertStatus(422);
    }

    public function test_a_second_open_report_on_the_same_member_is_refused_but_allowed_once_closed(): void
    {
        [$reporter, $target] = $this->members(2);
        Sanctum::actingAs($reporter);

        $this->apiPost("/v2/users/{$target->id}/report", ['category' => 'harassment'])->assertStatus(201);
        $this->apiPost("/v2/users/{$target->id}/report", ['category' => 'harassment'])->assertStatus(409);

        DB::table('reports')->where('reporter_id', $reporter->id)->update(['status' => 'dismissed']);

        $this->apiPost("/v2/users/{$target->id}/report", ['category' => 'safeguarding_concern'])->assertStatus(201);
    }

    public function test_member_of_another_community_cannot_be_reported(): void
    {
        [$reporter] = $this->members(1);
        $outsider = User::factory()->forTenant(1)->create();
        TenantContext::setById($this->testTenantId);
        Sanctum::actingAs($reporter);

        $this->apiPost("/v2/users/{$outsider->id}/report", ['category' => 'harassment'])->assertStatus(404);
    }

    public function test_a_blocked_member_can_still_be_reported(): void
    {
        [$reporter, $target] = $this->members(2);
        DB::table('user_blocks')->insert([
            'tenant_id' => $this->testTenantId,
            'user_id' => $reporter->id,
            'blocked_user_id' => $target->id,
            'created_at' => now(),
        ]);
        Sanctum::actingAs($reporter);

        $this->apiPost("/v2/users/{$target->id}/report", ['category' => 'harassment'])->assertStatus(201);
    }

    public function test_staff_are_told_but_a_reported_staff_member_is_not(): void
    {
        [$reporter] = $this->members(1);
        $reportedBroker = User::factory()->forTenant($this->testTenantId)->create(['role' => 'broker']);
        $otherBroker = User::factory()->forTenant($this->testTenantId)->create(['role' => 'broker']);
        TenantContext::setById($this->testTenantId);
        Sanctum::actingAs($reporter);

        $this->apiPost("/v2/users/{$reportedBroker->id}/report", ['category' => 'safeguarding_concern'])->assertStatus(201);

        $this->assertSame(1, DB::table('notifications')
            ->where('user_id', $otherBroker->id)
            ->where('type', 'member_concern_reported')
            ->count());
        $this->assertSame(0, DB::table('notifications')
            ->where('user_id', $reportedBroker->id)
            ->where('type', 'member_concern_reported')
            ->count(), 'the reported member must never be told');
    }

    public function test_receiver_can_report_a_message_and_its_words_are_kept(): void
    {
        [$sender, $receiver] = $this->members(2);
        $messageId = $this->message($sender->id, $receiver->id, 'Send me your bank details or else.');
        Sanctum::actingAs($receiver);

        $this->apiPost("/v2/messages/{$messageId}/report", ['category' => 'scam_or_fraud'])->assertStatus(201);

        $this->assertDatabaseHas('reports', [
            'reporter_id' => $receiver->id,
            'target_type' => 'message',
            'target_id' => $messageId,
            'category' => 'scam_or_fraud',
            'target_snapshot' => 'Send me your bank details or else.',
        ]);
    }

    public function test_only_the_receiver_can_report_a_message(): void
    {
        [$sender, $receiver, $stranger] = $this->members(3);
        $messageId = $this->message($sender->id, $receiver->id, 'Hello');

        Sanctum::actingAs($sender);
        $this->apiPost("/v2/messages/{$messageId}/report", ['category' => 'harassment'])->assertStatus(404);

        Sanctum::actingAs($stranger);
        $this->apiPost("/v2/messages/{$messageId}/report", ['category' => 'harassment'])->assertStatus(404);
    }

    public function test_a_message_from_a_partner_community_cannot_be_reported_here(): void
    {
        [$sender, $receiver] = $this->members(2);
        $messageId = $this->message($sender->id, $receiver->id, 'Hello', federated: true);
        Sanctum::actingAs($receiver);

        $this->apiPost("/v2/messages/{$messageId}/report", ['category' => 'harassment'])->assertStatus(404);
    }

    public function test_staff_see_the_words_as_reported_even_after_the_sender_edits_them(): void
    {
        [$sender, $receiver] = $this->members(2);
        $admin = User::factory()->forTenant($this->testTenantId)->admin()->create();
        TenantContext::setById($this->testTenantId);
        $messageId = $this->message($sender->id, $receiver->id, 'Original threatening words');
        Sanctum::actingAs($receiver);
        $this->apiPost("/v2/messages/{$messageId}/report", ['category' => 'harassment'])->assertStatus(201);
        $reportId = (int) DB::table('reports')->where('target_type', 'message')->where('target_id', $messageId)->value('id');

        DB::table('messages')->where('id', $messageId)->update(['body' => 'Nothing to see', 'is_edited' => 1]);

        Sanctum::actingAs($admin);
        $response = $this->apiGet("/v2/admin/reports/{$reportId}");

        $response->assertStatus(200);
        $response->assertJsonPath('data.content_type', 'message');
        $response->assertJsonPath('data.category', 'harassment');
        $response->assertJsonPath('data.target_preview', 'Original threatening words');
        $response->assertJsonPath('data.target_author_id', $sender->id);
    }

    public function test_a_broker_who_sent_the_reported_message_does_not_see_the_report(): void
    {
        $senderBroker = User::factory()->forTenant($this->testTenantId)->create(['role' => 'broker']);
        [$receiver] = $this->members(1);
        $messageId = $this->message($senderBroker->id, $receiver->id, 'Rude words');
        Sanctum::actingAs($receiver);
        $this->apiPost("/v2/messages/{$messageId}/report", ['category' => 'harassment'])->assertStatus(201);

        Sanctum::actingAs($senderBroker);
        $response = $this->apiGet('/v2/admin/reports');

        $response->assertStatus(200);
        $this->assertSame([], array_values(array_filter(
            $response->json('data') ?? [],
            static fn (array $row): bool => ($row['content_type'] ?? null) === 'message' && (int) ($row['target_id'] ?? 0) === $messageId,
        )));
    }

    /** @return list<User> */
    private function members(int $count): array
    {
        $members = [];
        for ($i = 0; $i < $count; $i++) {
            $members[] = User::factory()->forTenant($this->testTenantId)->create();
        }
        // Factory observers can run queued jobs that reset the tenant.
        TenantContext::setById($this->testTenantId);

        return $members;
    }

    private function message(int $senderId, int $receiverId, string $body, bool $federated = false): int
    {
        return (int) DB::table('messages')->insertGetId([
            'tenant_id' => $this->testTenantId,
            'sender_id' => $senderId,
            'receiver_id' => $receiverId,
            'body' => $body,
            'is_federated' => $federated ? 1 : 0,
            'created_at' => now(),
        ]);
    }
}
