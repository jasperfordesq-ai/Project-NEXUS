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

final class EventInvitationRevocationTest extends TestCase
{
    use DatabaseTransactions;
    use BuildsEventRegistrationFormFixtures;

    public function test_revoke_receipt_supports_exact_retry_without_duplicate_history(): void
    {
        $owner = $this->eventUser();
        $member = $this->eventUser();
        [$eventId, $start] = $this->registrationEvent((int) $owner->id);
        $preview = (new EventInvitationCampaignService())->preview(
            $eventId, $owner, 'member', ['member_ids' => [(int) $member->id]], 'revoke-preview',
        );
        $campaignId = (int) $preview['campaign']->id;
        Sanctum::actingAs($owner, ['*']);
        $this->apiPost("/v2/events/{$eventId}/registration-product/campaigns/{$campaignId}/issue", [
            'expires_at' => $start->toIso8601String(), 'expected_revision' => 1, 'idempotency_key' => 'revoke-issue',
        ])->assertOk();
        $invitationId = (int) DB::table('event_invitations')->where('event_id', $eventId)->value('id');
        $url = "/v2/events/{$eventId}/registration-product/invitations/{$invitationId}/revoke";
        $payload = ['reason' => 'Duplicate synthetic invitation', 'idempotency_key' => 'stable-revoke'];
        $first = $this->apiPost($url, $payload)->assertOk()
            ->assertJsonPath('data.invitation.id', $invitationId)->assertJsonPath('data.invitation.event_id', $eventId)
            ->assertJsonPath('data.invitation.campaign_id', $campaignId)->assertJsonPath('data.invitation.status', 'revoked')
            ->assertJsonPath('data.invitation.invitation_version', 2)->assertJsonPath('data.changed', true)
            ->assertJsonPath('data.idempotent_replay', false);
        self::assertNotNull($first->json('data.invitation.revoked_at'));
        $counts = fn () => [DB::table('event_invitation_history')->where('event_id', $eventId)->count(),
            DB::table('event_domain_outbox')->where('event_id', $eventId)->count()];
        $before = $counts();
        $replay = $this->apiPost($url, $payload)->assertOk()->assertJsonPath('data.idempotent_replay', true)
            ->assertJsonPath('data.changed', false);
        self::assertSame($first->json('data.invitation'), $replay->json('data.invitation'));
        $conflict = $this->apiPost($url, array_replace($payload, ['reason' => 'Changed reason']))->assertStatus(409);
        self::assertArrayNotHasKey('field', $conflict->json('errors.0'));
        $this->apiPost($url, array_replace($payload, ['idempotency_key' => 'new-revoke-key']))->assertStatus(422)
            ->assertJsonPath('errors.0.code', 'EVENT_REGISTRATION_VALIDATION_FAILED')->assertJsonPath('errors.0.field', 'invitation_state');
        self::assertSame($before, $counts());
        self::assertSame(1, DB::table('event_invitation_history')->where('event_id', $eventId)->where('action', 'revoked')->count());
    }
}
