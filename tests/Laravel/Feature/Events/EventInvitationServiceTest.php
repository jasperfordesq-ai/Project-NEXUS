<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

declare(strict_types=1);

namespace Tests\Laravel\Feature\Events;

use App\Core\TenantContext;
use App\Exceptions\EventRegistrationFoundationException;
use App\Models\Group;
use App\Services\EventInvitationCampaignService;
use App\Services\EventInvitationService;
use Carbon\CarbonImmutable;
use Illuminate\Foundation\Testing\DatabaseTransactions;
use Illuminate\Support\Facades\Crypt;
use Illuminate\Support\Facades\DB;
use Tests\Laravel\Feature\Events\Concerns\BuildsEventRegistrationFormFixtures;
use Tests\Laravel\TestCase;

final class EventInvitationServiceTest extends TestCase
{
    use DatabaseTransactions;
    use BuildsEventRegistrationFormFixtures;

    protected function tearDown(): void
    {
        CarbonImmutable::setTestNow();
        parent::tearDown();
    }

    public function test_csv_preview_never_persists_raw_data_and_email_tokens_are_one_shot_identity_bound(): void
    {
        CarbonImmutable::setTestNow(CarbonImmutable::parse('2027-01-01T12:00:00Z'));
        $owner = $this->eventUser();
        $invitee = $this->eventUser(['email' => 'invitee@example.test']);
        [$eventId, $start] = $this->registrationEvent(
            (int) $owner->id,
            CarbonImmutable::parse('2027-02-01T12:00:00Z'),
        );
        $rawCsv = "email\ninvitee@example.test\ninvalid-address\ninvitee@example.test\n";
        $campaigns = new EventInvitationCampaignService();
        $preview = $campaigns->preview(
            $eventId,
            $owner,
            'csv',
            ['csv' => $rawCsv],
            'campaign-csv-preview',
        );
        $previewReplay = $campaigns->preview(
            $eventId,
            $owner,
            'csv',
            ['csv' => $rawCsv],
            'campaign-csv-preview',
        );
        self::assertTrue($preview['changed']);
        self::assertFalse($previewReplay['changed']);
        self::assertSame(3, (int) $preview['campaign']->preview_count);
        self::assertSame(1, (int) $preview['campaign']->valid_count);
        self::assertSame(2, (int) $preview['campaign']->error_count);
        $campaignJson = json_encode(
            DB::table('event_invitation_campaigns')->find($preview['campaign']->id),
            JSON_THROW_ON_ERROR,
        );
        self::assertStringNotContainsString($rawCsv, $campaignJson);
        self::assertStringNotContainsString('invitee@example.test', $campaignJson);
        self::assertStringNotContainsString('invalid-address', $campaignJson);
        self::assertSame(
            [
                ['row' => 3, 'code' => 'email_invalid'],
                ['row' => 4, 'code' => 'duplicate_target'],
            ],
            $preview['campaign']->preview_errors,
        );

        $invitations = new EventInvitationService();
        $issued = $invitations->issueCampaign(
            $eventId,
            (int) $preview['campaign']->id,
            $owner,
            ['csv' => $rawCsv],
            1,
            'campaign-csv-issue',
            $start->subDay()->toIso8601String(),
        );
        $issueReplay = $invitations->issueCampaign(
            $eventId,
            (int) $preview['campaign']->id,
            $owner,
            ['csv' => $rawCsv],
            1,
            'campaign-csv-issue',
            $start->subDay()->toIso8601String(),
        );
        self::assertTrue($issued['changed']);
        self::assertFalse($issueReplay['changed']);
        self::assertCount(1, $issued['invitations']);
        self::assertNotNull($issued['invitations'][0]['secret']);
        self::assertNull($issueReplay['invitations'][0]['secret']);
        $secret = (string) $issued['invitations'][0]['secret'];
        $stored = DB::table('event_invitations')->first();
        self::assertNotNull($stored);
        self::assertNotSame($secret, (string) $stored->token_hash);
        self::assertStringNotContainsString($secret, json_encode($stored, JSON_THROW_ON_ERROR));
        self::assertSame('invitee@example.test', Crypt::decryptString((string) $stored->email_ciphertext));
        self::assertStringNotContainsString('invitee@example.test', (string) $stored->email_ciphertext);
        self::assertArrayNotHasKey('email_ciphertext', $issued['invitations'][0]['invitation']->toArray());
        self::assertArrayNotHasKey('token_hash', $issued['invitations'][0]['invitation']->toArray());
        self::assertNotNull($invitations->resolve($eventId, $secret));
        self::assertNull($invitations->resolve($eventId, 'nxi1_' . str_repeat('A', 43)));
        TenantContext::setById(999);
        self::assertNull($invitations->resolve($eventId, $secret));
        TenantContext::setById($this->testTenantId);

        $accepted = $invitations->accept(
            $eventId,
            $secret,
            $invitee,
            'invitation-email-accept',
            'invitee@example.test',
        );
        $acceptReplay = $invitations->accept(
            $eventId,
            $secret,
            $invitee,
            'invitation-email-accept',
            'invitee@example.test',
        );
        self::assertTrue($accepted['changed']);
        self::assertFalse($acceptReplay['changed']);
        self::assertSame('accepted', $accepted['invitation']->status->value);
        self::assertNull($invitations->resolve($eventId, $secret));
        $this->assertReason(
            'event_invitation_invalid',
            fn () => $invitations->accept(
                $eventId,
                $secret,
                $invitee,
                'invitation-token-reuse',
                'invitee@example.test',
            ),
        );
        self::assertSame(1, DB::table('event_registrations')->where('event_id', $eventId)->count());
        self::assertSame(
            'confirmed',
            DB::table('event_registrations')
                ->where('event_id', $eventId)
                ->where('user_id', (int) $invitee->id)
                ->value('registration_state'),
        );
        self::assertSame(2, DB::table('event_invitation_history')->count());
    }

    public function test_member_binding_expiry_and_audience_expansion_fail_closed_without_capacity_mutation(): void
    {
        CarbonImmutable::setTestNow(CarbonImmutable::parse('2027-03-01T12:00:00Z'));
        $owner = $this->eventUser();
        $invitee = $this->eventUser();
        $other = $this->eventUser();
        [$eventId, $start] = $this->registrationEvent(
            (int) $owner->id,
            CarbonImmutable::parse('2027-04-01T12:00:00Z'),
        );
        $preview = (new EventInvitationCampaignService())->preview(
            $eventId,
            $owner,
            'audience',
            ['member_ids' => [(int) $invitee->id, (int) $other->id, (int) $invitee->id]],
            'campaign-audience-preview',
        );
        self::assertSame(3, (int) $preview['campaign']->preview_count);
        self::assertSame(2, (int) $preview['campaign']->valid_count);
        self::assertSame(1, (int) $preview['campaign']->error_count);
        $service = new EventInvitationService();
        $issued = $service->issueCampaign(
            $eventId,
            (int) $preview['campaign']->id,
            $owner,
            ['member_ids' => [(int) $invitee->id, (int) $other->id, (int) $invitee->id]],
            1,
            'campaign-audience-issue',
            $start->subDay()->toIso8601String(),
        );
        $inviteeIssue = collect($issued['invitations'])->first(
            static fn (array $item): bool => (int) $item['invitation']->member_user_id === (int) $invitee->id,
        );
        self::assertNotNull($inviteeIssue);
        $this->assertReason(
            'event_invitation_invalid',
            fn () => $service->accept(
                $eventId,
                (string) $inviteeIssue['secret'],
                $owner,
                'member-binding-wrong-user',
            ),
        );
        self::assertTrue($service->accept(
            $eventId,
            (string) $inviteeIssue['secret'],
            $invitee,
            'member-binding-right-user',
        )['changed']);

        $otherIssue = collect($issued['invitations'])->first(
            static fn (array $item): bool => (int) $item['invitation']->member_user_id === (int) $other->id,
        );
        self::assertNotNull($otherIssue);
        CarbonImmutable::setTestNow($start);
        self::assertNull($service->resolve($eventId, (string) $otherIssue['secret']));
        $this->assertReason(
            'event_invitation_invalid',
            fn () => $service->accept(
                $eventId,
                (string) $otherIssue['secret'],
                $other,
                'expired-member-token',
            ),
        );
        self::assertSame(1, DB::table('event_registrations')->where('event_id', $eventId)->count());
        self::assertSame(
            'confirmed',
            DB::table('event_registrations')
                ->where('event_id', $eventId)
                ->where('user_id', (int) $invitee->id)
                ->value('registration_state'),
        );
    }

    public function test_group_preview_expands_only_active_same_tenant_members(): void
    {
        $owner = $this->eventUser();
        $active = $this->eventUser();
        $pending = $this->eventUser();
        [$eventId] = $this->registrationEvent((int) $owner->id);
        $group = Group::factory()->forTenant($this->testTenantId)->create([
            'owner_id' => (int) $owner->id,
        ]);
        DB::table('group_members')->insert([
            [
                'tenant_id' => $this->testTenantId,
                'group_id' => (int) $group->id,
                'user_id' => (int) $owner->id,
                'role' => 'owner',
                'status' => 'active',
                'created_at' => now(),
                'updated_at' => now(),
            ],
            [
                'tenant_id' => $this->testTenantId,
                'group_id' => (int) $group->id,
                'user_id' => (int) $active->id,
                'role' => 'member',
                'status' => 'active',
                'created_at' => now(),
                'updated_at' => now(),
            ],
            [
                'tenant_id' => $this->testTenantId,
                'group_id' => (int) $group->id,
                'user_id' => (int) $pending->id,
                'role' => 'member',
                'status' => 'pending',
                'created_at' => now(),
                'updated_at' => now(),
            ],
        ]);

        $preview = (new EventInvitationCampaignService())->preview(
            $eventId,
            $owner,
            'group',
            ['group_id' => (int) $group->id],
            'campaign-group-preview',
        );
        self::assertSame(2, (int) $preview['campaign']->preview_count);
        self::assertSame(2, (int) $preview['campaign']->valid_count);
        self::assertSame(0, (int) $preview['campaign']->error_count);
        self::assertSame('group:' . $group->id, $preview['campaign']->source_reference);
    }

    /** @param callable():mixed $operation */
    public function test_issued_campaign_replay_survives_expiry_without_reissuing(): void
    {
        $now = CarbonImmutable::parse('2027-05-01T12:00:00Z');
        CarbonImmutable::setTestNow($now);
        $owner = $this->eventUser();
        $member = $this->eventUser();
        [$eventId] = $this->registrationEvent((int) $owner->id, $now->addDay());
        $campaigns = new EventInvitationCampaignService();
        $source = ['member_ids' => [(int) $member->id]];
        $preview = $campaigns->preview($eventId, $owner, 'member', $source, 'late-replay-preview');
        $campaignId = (int) $preview['campaign']->id;
        $service = new EventInvitationService();
        $expiry = $now->addHour()->toIso8601String();
        $issued = $service->issueCampaign($eventId, $campaignId, $owner, [], 1, 'late-replay-issue', $expiry);
        $tables = ['event_invitations', 'event_invitation_history', 'event_invitation_campaign_history', 'event_domain_outbox'];
        $counts = array_map(static fn (string $table): int => DB::table($table)->count(), $tables);
        CarbonImmutable::setTestNow($now->addHours(2));
        $replay = $service->issueCampaign($eventId, $campaignId, $owner, [], 1, 'late-replay-issue', $expiry);
        self::assertFalse($replay['changed']);
        self::assertSame((int) $issued['invitations'][0]['invitation']->id, (int) $replay['invitations'][0]['invitation']->id);
        self::assertNull($replay['invitations'][0]['secret']);
        self::assertSame($counts, array_map(static fn (string $table): int => DB::table($table)->count(), $tables));
        $this->assertReason('event_invitation_issue_idempotency_conflict', fn () =>
            $service->issueCampaign($eventId, $campaignId, $owner, [], 1, 'late-replay-issue', $now->addMinutes(30)->toIso8601String()));
        $fresh = $campaigns->preview($eventId, $owner, 'member', $source, 'late-fresh-preview');
        $this->assertReason('event_invitation_expiry_invalid', fn () =>
            $service->issueCampaign($eventId, (int) $fresh['campaign']->id, $owner, [], 1, 'late-fresh-issue', $expiry));
        self::assertSame($counts[0], DB::table('event_invitations')->count());
    }

    private function assertReason(string $reason, callable $operation): void
    {
        try {
            $operation();
            self::fail("Expected {$reason}.");
        } catch (EventRegistrationFoundationException $exception) {
            self::assertSame($reason, $exception->getMessage());
        }
    }
}
