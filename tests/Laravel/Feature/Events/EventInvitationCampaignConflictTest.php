<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

declare(strict_types=1);

namespace Tests\Laravel\Feature\Events;

use App\Services\EventInvitationCampaignService;
use Illuminate\Foundation\Testing\DatabaseTransactions;
use Illuminate\Support\Facades\DB;
use Laravel\Sanctum\Sanctum;
use Tests\Laravel\Feature\Events\Concerns\BuildsEventRegistrationFormFixtures;
use Tests\Laravel\TestCase;

final class EventInvitationCampaignConflictTest extends TestCase
{
    use DatabaseTransactions;
    use BuildsEventRegistrationFormFixtures;

    public function test_issued_campaign_replay_and_key_collision_never_look_like_a_definitive_revision_refusal(): void
    {
        $owner = $this->eventUser();
        $member = $this->eventUser();
        [$eventId, $start] = $this->registrationEvent((int) $owner->id);
        $preview = (new EventInvitationCampaignService())->preview(
            $eventId, $owner, 'member', ['member_ids' => [(int) $member->id]], 'issued-conflict-preview',
        );
        $campaignId = (int) $preview['campaign']->id;
        Sanctum::actingAs($owner, ['*']);
        $url = "/v2/events/{$eventId}/registration-product/campaigns/{$campaignId}/issue";
        $payload = ['expires_at' => $start->toIso8601String(), 'expected_revision' => 1,
            'idempotency_key' => 'successful-issue'];
        $this->apiPost($url, $payload)->assertOk()->assertJsonPath('data.campaign.status', 'issued');
        $tables = ['event_invitation_campaign_history', 'event_invitations', 'event_domain_outbox'];
        $counts = fn () => array_map(fn ($table) => DB::table($table)->where('event_id', $eventId)->count(), $tables);
        $issued = $counts();
        $this->apiPost($url, $payload)->assertOk()->assertJsonPath('data.idempotent_replay', true);
        foreach ([['expected_revision' => 3], ['idempotency_key' => 'different-issue-key']] as $change) {
            $collision = $this->apiPost($url, array_replace($payload, $change));
            $collision->assertStatus(409)->assertJsonPath('errors.0.code', 'EVENT_REGISTRATION_CONFLICT');
            self::assertArrayNotHasKey('field', $collision->json('errors.0'));
        }
        self::assertSame($issued, $counts());
        self::assertSame(1, DB::table('event_invitations')->where('event_id', $eventId)->count());
    }

    public function test_revision_refusals_are_distinct_from_replay_collisions_and_make_no_changes(): void
    {
        $owner = $this->eventUser();
        $member = $this->eventUser();
        [$eventId, $start] = $this->registrationEvent((int) $owner->id);
        $preview = (new EventInvitationCampaignService())->preview(
            $eventId, $owner, 'member', ['member_ids' => [(int) $member->id]], 'conflict-preview',
        );
        $campaignId = (int) $preview['campaign']->id;
        Sanctum::actingAs($owner, ['*']);
        $url = "/v2/events/{$eventId}/registration-product/campaigns/{$campaignId}";
        $tables = ['event_invitation_campaign_history', 'event_invitations', 'event_domain_outbox'];
        $counts = fn () => array_map(fn ($table) => DB::table($table)->where('event_id', $eventId)->count(), $tables);
        $before = $counts();
        foreach ([
            'schedule' => ['scheduled_for' => $start->subHour()->toIso8601String()],
            'issue' => ['expires_at' => $start->toIso8601String()],
            'cancel' => ['reason' => 'Synthetic stale request'],
        ] as $action => $payload) {
            $this->apiPost($url . '/' . $action, $payload + [
                'expected_revision' => 2, 'idempotency_key' => 'stale-' . $action,
            ])->assertStatus(409)->assertJsonPath('errors.0.code', 'EVENT_REGISTRATION_CONFLICT')
                ->assertJsonPath('errors.0.field', 'expected_campaign_revision');
            self::assertSame($before, $counts());
            self::assertSame(1, (int) DB::table('event_invitation_campaigns')->where('id', $campaignId)->value('revision'));
        }
        $schedule = ['scheduled_for' => $start->subHour()->toIso8601String(),
            'expected_revision' => 1, 'idempotency_key' => 'successful-schedule'];
        $this->apiPost($url . '/schedule', $schedule)->assertOk();
        $scheduled = $counts();
        $this->apiPost($url . '/schedule', $schedule)->assertOk()->assertJsonPath('data.idempotent_replay', true);
        $collision = $this->apiPost($url . '/schedule', array_replace($schedule, ['expected_revision' => 2]));
        $collision->assertStatus(409)->assertJsonPath('errors.0.code', 'EVENT_REGISTRATION_CONFLICT');
        self::assertArrayNotHasKey('field', $collision->json('errors.0'));
        self::assertSame($scheduled, $counts());
        $cancel = ['reason' => 'Synthetic cancellation', 'expected_revision' => 2, 'idempotency_key' => 'successful-cancel'];
        $this->apiPost($url . '/cancel', $cancel)->assertOk();
        $cancelled = $counts();
        $this->apiPost($url . '/cancel', $cancel)->assertOk()->assertJsonPath('data.idempotent_replay', true);
        $this->apiPost($url . '/schedule', $schedule)->assertOk()->assertJsonPath('data.campaign.status', 'cancelled');
        $collision = $this->apiPost($url . '/cancel', array_replace($cancel, ['reason' => 'Different reason']));
        $collision->assertStatus(409);
        self::assertArrayNotHasKey('field', $collision->json('errors.0'));
        self::assertSame($cancelled, $counts());
        self::assertSame(0, DB::table('event_invitations')->where('event_id', $eventId)->count());
        self::assertSame(0, DB::table('event_domain_outbox')->where('event_id', $eventId)->count());
    }
}
