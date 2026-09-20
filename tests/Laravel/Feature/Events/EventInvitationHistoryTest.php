<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

declare(strict_types=1);
namespace Tests\Laravel\Feature\Events;

use App\Enums\EventStaffRole;
use App\Services\EventInvitationCampaignService;
use App\Services\EventRoleService;
use Illuminate\Foundation\Testing\DatabaseTransactions;
use Illuminate\Support\Facades\DB;
use Laravel\Sanctum\Sanctum;
use Tests\Laravel\Feature\Events\Concerns\BuildsEventRegistrationFormFixtures;
use Tests\Laravel\TestCase;

final class EventInvitationHistoryTest extends TestCase
{
    use DatabaseTransactions;
    use BuildsEventRegistrationFormFixtures;

    public function test_history_paginates_without_mutation_and_filters_recipient_fields_by_authority(): void
    {
        $owner = $this->eventUser();
        $members = [$this->eventUser(), $this->eventUser(), $this->eventUser()];
        [$eventId, $start] = $this->registrationEvent((int) $owner->id);
        $preview = (new EventInvitationCampaignService())->preview($eventId, $owner, 'member',
            ['member_ids' => array_map(fn ($member) => (int) $member->id, $members)], 'history-preview');
        $campaignId = (int) $preview['campaign']->id;
        Sanctum::actingAs($owner, ['*']);
        $this->apiPost("/v2/events/{$eventId}/registration-product/campaigns/{$campaignId}/issue", [
            'expires_at' => $start->toIso8601String(), 'expected_revision' => 1, 'idempotency_key' => 'history-issue',
        ])->assertOk();
        $emailPreview = (new EventInvitationCampaignService())->preview($eventId, $owner, 'email',
            ['emails' => ['invitation-history@example.test']], 'history-email-preview');
        $emailCampaignId = (int) $emailPreview['campaign']->id;
        $this->apiPost("/v2/events/{$eventId}/registration-product/campaigns/{$emailCampaignId}/issue", [
            'expires_at' => $start->toIso8601String(), 'expected_revision' => 1, 'idempotency_key' => 'history-email-issue',
        ])->assertOk();
        $ids = DB::table('event_invitations')->where('event_id', $eventId)->orderByDesc('id')->pluck('id')->map(fn ($id) => (int) $id)->all();
        $counts = fn () => array_map(fn ($table) => DB::table($table)->where('event_id', $eventId)->count(),
            ['event_invitations', 'event_invitation_history', 'event_domain_outbox']);
        $before = $counts();
        $url = "/v2/events/{$eventId}/registration-product/invitations";
        $first = $this->apiGet($url . '?per_page=2')->assertOk()->assertJsonPath('data.event_id', $eventId)
            ->assertJsonPath('data.pagination.total', 4)->assertJsonPath('data.pagination.next_page', 2)
            ->assertJsonPath('data.invitations.0.id', $ids[0])->assertJsonPath('data.permissions.view_recipient_email', true);
        self::assertStringContainsString('no-store', $first->headers->get('Cache-Control'));
        foreach ($first->json('data.invitations') as $invitation) {
            self::assertEqualsCanonicalizing(['id','event_id','campaign_id','target_type','status','invitation_version',
                'token_expires_at','accepted_at','revoked_at','expired_at','member_name','recipient_email'], array_keys($invitation));
            if ($invitation['target_type'] === 'member') {
                self::assertContains($invitation['member_name'], array_map(fn ($member) => $member->name, $members));
                self::assertNull($invitation['recipient_email']);
            } else {
                self::assertNull($invitation['member_name']);
                self::assertSame('invitation-history@example.test', $invitation['recipient_email']);
            }
        }
        $this->apiGet($url . '?page=2&per_page=2')->assertOk()->assertJsonPath('data.invitations.0.id', $ids[2])
            ->assertJsonPath('data.pagination.next_page', null);
        $this->apiGet($url . '?page=999&per_page=2')->assertOk()->assertJsonPath('data.pagination.page', 2);
        $this->apiGet($url . '?per_page=999')->assertOk()->assertJsonPath('data.pagination.per_page', 100);
        foreach (['page=0','page[]=1','per_page=bad'] as $query) $this->apiGet($url . '?' . $query)->assertStatus(422);
        self::assertSame($before, $counts());
        $staff = $this->eventUser();
        (new EventRoleService())->grant($eventId, (int) $staff->id, EventStaffRole::RegistrationManager, $owner, now()->addMonth());
        $before = $counts(); // Granting the role records its own outbox event.
        Sanctum::actingAs($staff, ['*']);
        $staffRead = $this->apiGet($url)->assertOk()->assertJsonPath('data.permissions.view_recipient_email', false);
        foreach ($staffRead->json('data.invitations') as $invitation) self::assertArrayNotHasKey('recipient_email', $invitation);
        Sanctum::actingAs($members[0], ['*']);
        $this->apiGet($url)->assertForbidden();
        Sanctum::actingAs($owner, ['*']);
        [$otherId] = $this->registrationEvent((int) $owner->id);
        $this->apiGet("/v2/events/{$otherId}/registration-product/invitations")->assertOk()->assertJsonPath('data.invitations', []);
        $foreignTenantId = (int) \App\Models\Tenant::factory()->create()->id;
        $foreignOwner = $this->eventUser([], $foreignTenantId);
        [$foreignId] = $this->registrationEvent((int) $foreignOwner->id, tenantId: $foreignTenantId);
        $this->apiGet("/v2/events/{$foreignId}/registration-product/invitations")->assertNotFound();
        self::assertSame($before, $counts());
    }
}
