<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

declare(strict_types=1);

namespace Tests\Laravel\Feature\Security\E035;

use App\Exceptions\EventRegistrationFoundationException;
use App\Models\Event;
use App\Models\Group;
use App\Services\EventInvitationCampaignService;
use App\Support\Events\EventInvitationRecipientAuthorizer;
use Illuminate\Foundation\Testing\DatabaseTransactions;
use Illuminate\Support\Facades\DB;
use Tests\Laravel\Feature\Events\Concerns\BuildsEventRegistrationFormFixtures;
use Tests\Laravel\TestCase;

/**
 * E-035 F-161 — an ordinary member organiser must not be able to send an
 * event invitation campaign to arbitrary external email addresses (Email / CSV
 * campaign types) or to the whole community (an Audience whose criteria are
 * not confined to groups the organiser has authority over, e.g. all_active).
 * Community admins keep those bulk types. Organisers keep the member picker
 * and their own groups.
 */
final class EventInvitationBulkCampaignAdminOnlyTest extends TestCase
{
    use DatabaseTransactions;
    use BuildsEventRegistrationFormFixtures;

    public function test_member_organiser_cannot_preview_email_campaign(): void
    {
        $organiser = $this->eventUser(['role' => 'member']);
        [$eventId] = $this->registrationEvent((int) $organiser->id);

        $this->assertDenied(fn () => (new EventInvitationCampaignService())->preview(
            $eventId,
            $organiser,
            'email',
            ['emails' => ['stranger-one@example.test', 'stranger-two@example.test']],
            'e035-f161-member-email',
        ));
        self::assertSame(0, DB::table('event_invitation_campaigns')->where('event_id', $eventId)->count());
    }

    public function test_member_organiser_cannot_preview_csv_campaign(): void
    {
        $organiser = $this->eventUser(['role' => 'member']);
        [$eventId] = $this->registrationEvent((int) $organiser->id);

        $this->assertDenied(fn () => (new EventInvitationCampaignService())->preview(
            $eventId,
            $organiser,
            'csv',
            ['csv' => "email\nstranger@example.test\n"],
            'e035-f161-member-csv',
        ));
    }

    public function test_member_organiser_cannot_preview_community_wide_audience(): void
    {
        $organiser = $this->eventUser(['role' => 'member']);
        [$eventId] = $this->registrationEvent((int) $organiser->id);

        $this->assertDenied(fn () => (new EventInvitationCampaignService())->preview(
            $eventId,
            $organiser,
            'audience',
            ['criteria' => ['all_active' => true]],
            'e035-f161-member-all-active',
        ));
        // A tenant-wide segment without all_active is the same reach.
        $this->assertDenied(fn () => (new EventInvitationCampaignService())->preview(
            $eventId,
            $organiser,
            'audience',
            ['criteria' => ['approved' => true]],
            'e035-f161-member-approved-segment',
        ));
    }

    public function test_member_organiser_keeps_member_picker_and_own_group_audience(): void
    {
        $organiser = $this->eventUser(['role' => 'member']);
        $friend = $this->eventUser(['role' => 'member']);
        [$eventId] = $this->registrationEvent((int) $organiser->id);

        $picker = (new EventInvitationCampaignService())->preview(
            $eventId,
            $organiser,
            'member',
            ['member_ids' => [(int) $friend->id]],
            'e035-f161-member-picker',
        );
        self::assertSame(1, (int) $picker['campaign']->valid_count);

        $group = Group::factory()->forTenant($this->testTenantId)->create([
            'owner_id' => (int) $organiser->id,
            'visibility' => 'public',
            'status' => 'active',
            'is_active' => true,
        ]);
        foreach ([$organiser, $friend] as $member) {
            DB::table('group_members')->insert([
                'tenant_id' => $this->testTenantId,
                'group_id' => (int) $group->id,
                'user_id' => (int) $member->id,
                'role' => (int) $member->id === (int) $organiser->id ? 'owner' : 'member',
                'status' => 'active',
                'created_at' => now(),
                'updated_at' => now(),
            ]);
        }
        $groupAudience = (new EventInvitationCampaignService())->preview(
            $eventId,
            $organiser,
            'audience',
            ['criteria' => ['group_ids' => [(int) $group->id]]],
            'e035-f161-member-group-audience',
        );
        self::assertGreaterThanOrEqual(1, (int) $groupAudience['campaign']->valid_count);
    }

    public function test_admin_can_preview_email_campaign(): void
    {
        $admin = $this->eventUser(['role' => 'admin']);
        [$eventId] = $this->registrationEvent((int) $admin->id);

        $preview = (new EventInvitationCampaignService())->preview(
            $eventId,
            $admin,
            'email',
            ['emails' => ['guest-of-admin@example.test']],
            'e035-f161-admin-email',
        );
        self::assertSame(1, (int) $preview['campaign']->valid_count);
    }

    public function test_external_email_delivery_refused_for_member_issuer(): void
    {
        // Defence in depth: a campaign previewed before this fix must not
        // deliver to an external address when its issuer is not an admin.
        $organiser = $this->eventUser(['role' => 'member']);
        $admin = $this->eventUser(['role' => 'admin']);
        [$eventId] = $this->registrationEvent((int) $organiser->id);
        $event = Event::withoutGlobalScopes()->findOrFail($eventId);
        $authorizer = new EventInvitationRecipientAuthorizer();
        $target = ['type' => 'email', 'member_id' => null, 'email' => 'outsider@example.test'];

        self::assertSame(
            EventInvitationRecipientAuthorizer::DENIED,
            $authorizer->deliveryDecision($this->testTenantId, $event, $organiser, $target),
        );
        self::assertSame(
            EventInvitationRecipientAuthorizer::ALLOWED,
            $authorizer->deliveryDecision($this->testTenantId, $event, $admin, $target),
        );
    }

    /** @param callable():mixed $operation */
    private function assertDenied(callable $operation): void
    {
        try {
            $operation();
            self::fail('Expected event_registration_authorization_denied.');
        } catch (EventRegistrationFoundationException $exception) {
            self::assertSame('event_registration_authorization_denied', $exception->getMessage());
        }
    }
}
