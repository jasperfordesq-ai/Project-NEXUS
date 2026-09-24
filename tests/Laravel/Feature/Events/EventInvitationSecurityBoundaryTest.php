<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

declare(strict_types=1);

namespace Tests\Laravel\Feature\Events;

use App\Exceptions\EventRegistrationFoundationException;
use App\Models\Event;
use App\Models\Group;
use App\Models\User;
use App\Policies\EventPolicy;
use App\Services\EventInvitationCampaignService;
use App\Services\EventInvitationDeliveryConsumer;
use App\Services\EventInvitationService;
use Illuminate\Foundation\Testing\DatabaseTransactions;
use Illuminate\Support\Facades\DB;
use Tests\Laravel\Feature\Events\Concerns\BuildsEventRegistrationFormFixtures;
use Tests\Laravel\TestCase;

final class EventInvitationSecurityBoundaryTest extends TestCase
{
    use DatabaseTransactions;
    use BuildsEventRegistrationFormFixtures;

    public function test_private_group_outsider_is_filtered_and_invitation_never_grants_view(): void
    {
        // E-035 F-161: email/CSV campaigns are admin-only, so the external
        // preview below needs an admin organiser to reach the private-group rule.
        $owner = $this->eventUser(['role' => 'admin']);
        $outsider = $this->eventUser();
        [$eventId] = $this->registrationEvent((int) $owner->id);
        $group = $this->group($owner, 'private');
        DB::table('events')->where('id', $eventId)->update(['group_id' => (int) $group->id]);
        $event = Event::withoutGlobalScopes()->findOrFail($eventId);

        self::assertFalse((new EventPolicy())->view($outsider, $event));
        $preview = (new EventInvitationCampaignService())->preview(
            $eventId,
            $owner,
            'member',
            ['member_ids' => [(int) $outsider->id]],
            'security-private-outsider-preview',
        );

        self::assertSame(1, (int) $preview['campaign']->preview_count);
        self::assertSame(0, (int) $preview['campaign']->valid_count);
        self::assertSame(1, (int) $preview['campaign']->error_count);
        self::assertSame('member_not_found', $preview['campaign']->preview_errors[0]['code']);
        $externalPreview = (new EventInvitationCampaignService())->preview(
            $eventId,
            $owner,
            'email',
            ['emails' => ['private-event-newcomer@example.test']],
            'security-private-external-preview',
        );
        self::assertSame(0, (int) $externalPreview['campaign']->valid_count);
        self::assertSame('member_not_found', $externalPreview['campaign']->preview_errors[0]['code']);
        self::assertFalse((new EventPolicy())->view(
            $outsider,
            Event::withoutGlobalScopes()->findOrFail($eventId),
        ));
        self::assertSame(0, DB::table('event_invitations')->where('event_id', $eventId)->count());
    }

    public function test_bilateral_block_is_filtered_at_preview_and_rechecked_before_issue(): void
    {
        $owner = $this->eventUser();
        $target = $this->eventUser();
        [$eventId, $start] = $this->registrationEvent((int) $owner->id);
        $campaigns = new EventInvitationCampaignService();
        $preview = $campaigns->preview(
            $eventId,
            $owner,
            'member',
            ['member_ids' => [(int) $target->id]],
            'security-block-before-issue-preview',
        );
        self::assertSame(1, (int) $preview['campaign']->valid_count);

        DB::table('user_blocks')->insert([
            'tenant_id' => $this->testTenantId,
            'user_id' => (int) $target->id,
            'blocked_user_id' => (int) $owner->id,
            'reason' => 'security test',
            'created_at' => now(),
        ]);

        $this->assertReason(
            'event_invitation_campaign_target_ineligible',
            fn () => (new EventInvitationService())->issueCampaign(
                $eventId,
                (int) $preview['campaign']->id,
                $owner,
                [],
                1,
                'security-block-before-issue',
                $start->subDay()->toIso8601String(),
            ),
        );
        self::assertSame(0, DB::table('event_invitations')->where('event_id', $eventId)->count());

        $filtered = $campaigns->preview(
            $eventId,
            $owner,
            'member',
            ['member_ids' => [(int) $target->id]],
            'security-blocked-preview',
        );
        self::assertSame(0, (int) $filtered['campaign']->valid_count);
        self::assertSame('member_not_found', $filtered['campaign']->preview_errors[0]['code']);
    }

    public function test_unauthorized_group_sources_are_concealed_as_not_found(): void
    {
        $owner = $this->eventUser();
        $otherOwner = $this->eventUser();
        $member = $this->eventUser();
        [$eventId] = $this->registrationEvent((int) $owner->id);
        $sourceGroup = $this->group($otherOwner, 'private');
        $this->addGroupMember($sourceGroup, $member);

        $campaigns = new EventInvitationCampaignService();
        $this->assertReason(
            'event_invitation_group_not_found',
            fn () => $campaigns->preview(
                $eventId,
                $owner,
                'group',
                ['group_id' => (int) $sourceGroup->id],
                'security-unauthorized-group-preview',
            ),
        );
        $this->assertReason(
            'event_invitation_audience_group_not_found',
            fn () => $campaigns->preview(
                $eventId,
                $owner,
                'audience',
                ['criteria' => [
                    'group_ids' => [(int) $sourceGroup->id],
                    'group_match' => 'any',
                ]],
                'security-unauthorized-audience-preview',
            ),
        );
    }

    public function test_group_source_authority_is_rechecked_before_issue(): void
    {
        $owner = $this->eventUser();
        $newOwner = $this->eventUser();
        $member = $this->eventUser();
        [$eventId, $start] = $this->registrationEvent((int) $owner->id);
        $sourceGroup = $this->group($owner, 'private');
        $this->addGroupMember($sourceGroup, $member);
        $preview = (new EventInvitationCampaignService())->preview(
            $eventId,
            $owner,
            'group',
            ['group_id' => (int) $sourceGroup->id],
            'security-group-authority-preview',
        );
        self::assertSame(1, (int) $preview['campaign']->valid_count);

        DB::table('groups')->where('id', (int) $sourceGroup->id)->update([
            'owner_id' => (int) $newOwner->id,
            'updated_at' => now(),
        ]);

        $this->assertReason(
            'event_invitation_group_not_found',
            fn () => (new EventInvitationService())->issueCampaign(
                $eventId,
                (int) $preview['campaign']->id,
                $owner,
                [],
                1,
                'security-group-authority-issue',
                $start->subDay()->toIso8601String(),
            ),
        );
        self::assertSame(0, DB::table('event_invitations')->where('event_id', $eventId)->count());
    }

    public function test_delivery_rechecks_block_state_and_suppresses_every_pending_channel(): void
    {
        $owner = $this->eventUser();
        $target = $this->eventUser();
        [$eventId, $start] = $this->registrationEvent((int) $owner->id);
        $preview = (new EventInvitationCampaignService())->preview(
            $eventId,
            $owner,
            'member',
            ['member_ids' => [(int) $target->id]],
            'security-delivery-recheck-preview',
        );
        (new EventInvitationService())->issueCampaign(
            $eventId,
            (int) $preview['campaign']->id,
            $owner,
            [],
            1,
            'security-delivery-recheck-issue',
            $start->subDay()->toIso8601String(),
        );
        $outbox = DB::table('event_domain_outbox')
            ->where('tenant_id', $this->testTenantId)
            ->where('event_id', $eventId)
            ->where('action', 'event.invitation.issued')
            ->first();
        self::assertNotNull($outbox);
        self::assertGreaterThan(0, DB::table('event_notification_deliveries')
            ->where('tenant_id', $this->testTenantId)
            ->where('outbox_id', (int) $outbox->id)
            ->whereNotIn('status', ['delivered', 'suppressed', 'failed_terminal'])
            ->count());

        DB::table('user_blocks')->insert([
            'tenant_id' => $this->testTenantId,
            'user_id' => (int) $owner->id,
            'blocked_user_id' => (int) $target->id,
            'reason' => 'delivery security test',
            'created_at' => now(),
        ]);
        $result = (new EventInvitationDeliveryConsumer())->handle((array) $outbox);

        self::assertGreaterThan(0, $result->suppressed);
        self::assertSame(0, DB::table('event_notification_deliveries')
            ->where('tenant_id', $this->testTenantId)
            ->where('outbox_id', (int) $outbox->id)
            ->whereNotIn('status', ['delivered', 'suppressed', 'failed_terminal'])
            ->count());
        self::assertGreaterThan(0, DB::table('event_notification_deliveries')
            ->where('tenant_id', $this->testTenantId)
            ->where('outbox_id', (int) $outbox->id)
            ->where('suppression_reason', 'invitation_target_ineligible')
            ->count());
        self::assertSame(0, DB::table('notifications')
            ->where('tenant_id', $this->testTenantId)
            ->where('user_id', (int) $target->id)
            ->where('type', 'event_invitation')
            ->count());
    }

    private function group(User $owner, string $visibility): Group
    {
        return Group::factory()->forTenant($this->testTenantId)->create([
            'owner_id' => (int) $owner->id,
            'visibility' => $visibility,
            'status' => 'active',
            'is_active' => true,
        ]);
    }

    private function addGroupMember(Group $group, User $member): void
    {
        DB::table('group_members')->insert([
            'tenant_id' => $this->testTenantId,
            'group_id' => (int) $group->id,
            'user_id' => (int) $member->id,
            'role' => 'member',
            'status' => 'active',
            'created_at' => now(),
            'updated_at' => now(),
        ]);
    }

    /** @param callable():mixed $operation */
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
