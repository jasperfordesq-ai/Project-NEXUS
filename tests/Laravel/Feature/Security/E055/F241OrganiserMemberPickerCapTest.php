<?php

// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

declare(strict_types=1);

namespace Tests\Laravel\Feature\Security\E055;

use App\Exceptions\EventRegistrationFoundationException;
use App\Services\EventInvitationCampaignService;
use App\Services\EventInvitationService;
use App\Support\Events\EventInvitationRecipientExpander;
use Carbon\CarbonImmutable;
use Illuminate\Foundation\Testing\DatabaseTransactions;
use Illuminate\Support\Facades\DB;
use Tests\Laravel\Feature\Events\Concerns\BuildsEventRegistrationFormFixtures;
use Tests\Laravel\TestCase;

/**
 * F-241 (E-055 B-3, residual of E-035 F-161): an ordinary organiser kept the
 * member picker, which accepted up to 10,000 raw member ids, so a sweep over
 * sequential ids reached the whole community (email + push + bell) exactly
 * like the admin-only community-wide audience. A caller below community admin
 * may now name at most EventInvitationRecipientExpander::ORGANISER_MAX_MEMBER_IDS
 * members per campaign; above that the campaign is refused like the other
 * admin-only bulk types. Admins keep the full limit.
 */
final class F241OrganiserMemberPickerCapTest extends TestCase
{
    use DatabaseTransactions;
    use BuildsEventRegistrationFormFixtures;

    /** @return list<int> */
    private function members(int $count): array
    {
        $ids = [];
        for ($i = 0; $i < $count; $i++) {
            $ids[] = (int) $this->eventUser(['role' => 'member'])->id;
        }

        return $ids;
    }

    private function assertDenied(callable $call): void
    {
        try {
            $call();
            self::fail('Expected the campaign to be refused');
        } catch (EventRegistrationFoundationException $e) {
            self::assertSame('event_registration_authorization_denied', $e->getMessage());
        }
    }

    private function assertNothingCreatedOrDelivered(int $eventId): void
    {
        self::assertSame(0, DB::table('event_invitation_campaigns')->where('event_id', $eventId)->count());
        self::assertSame(0, DB::table('event_invitations')->where('event_id', $eventId)->count());
    }

    /** @return array<string, array{0: string, 1: string}> */
    public static function pickerShapes(): array
    {
        return [
            'member type' => ['member', 'member_ids'],
            'audience with only member_ids' => ['audience', 'member_ids'],
        ];
    }

    /**
     * @dataProvider pickerShapes
     */
    public function test_organiser_naming_more_than_the_cap_is_refused(string $type): void
    {
        $organiser = $this->eventUser(['role' => 'member']);
        [$eventId] = $this->registrationEvent((int) $organiser->id);
        $ids = $this->members(EventInvitationRecipientExpander::ORGANISER_MAX_MEMBER_IDS + 1);

        $this->assertDenied(fn () => (new EventInvitationCampaignService())->preview(
            $eventId,
            $organiser,
            $type,
            ['member_ids' => $ids],
            'f241-over-cap-' . $type,
        ));
        $this->assertNothingCreatedOrDelivered($eventId);
    }

    public function test_organiser_sweep_of_unknown_ids_is_refused_too(): void
    {
        // The cap counts named ids, not valid ones, so a sweep over mostly
        // non-existent ids cannot be used to enumerate members either.
        $organiser = $this->eventUser(['role' => 'member']);
        [$eventId] = $this->registrationEvent((int) $organiser->id);
        $start = (int) DB::table('users')->max('id') + 1000;

        $this->assertDenied(fn () => (new EventInvitationCampaignService())->preview(
            $eventId,
            $organiser,
            'member',
            ['member_ids' => range($start, $start + 9_999)],
            'f241-sweep',
        ));
        $this->assertNothingCreatedOrDelivered($eventId);
    }

    public function test_control_organiser_with_a_handful_of_ids_can_preview_and_issue(): void
    {
        $organiser = $this->eventUser(['role' => 'member']);
        [$eventId, $start] = $this->registrationEvent(
            (int) $organiser->id,
            CarbonImmutable::now('UTC')->addMonth()->startOfHour(),
        );
        $ids = $this->members(3);

        $preview = (new EventInvitationCampaignService())->preview(
            $eventId,
            $organiser,
            'member',
            ['member_ids' => $ids],
            'f241-handful',
        );
        self::assertSame(3, (int) $preview['campaign']->valid_count);

        $issued = (new EventInvitationService())->issueCampaign(
            $eventId,
            (int) $preview['campaign']->id,
            $organiser,
            ['member_ids' => $ids],
            1,
            'f241-handful-issue',
            $start->subDay()->toIso8601String(),
        );
        self::assertCount(3, $issued['invitations']);
    }

    public function test_control_organiser_at_exactly_the_cap_is_allowed(): void
    {
        $organiser = $this->eventUser(['role' => 'member']);
        [$eventId] = $this->registrationEvent((int) $organiser->id);
        $ids = $this->members(EventInvitationRecipientExpander::ORGANISER_MAX_MEMBER_IDS);

        $preview = (new EventInvitationCampaignService())->preview(
            $eventId,
            $organiser,
            'audience',
            ['member_ids' => $ids],
            'f241-at-cap',
        );
        self::assertSame(
            EventInvitationRecipientExpander::ORGANISER_MAX_MEMBER_IDS,
            (int) $preview['campaign']->valid_count,
        );
    }

    public function test_control_admin_can_name_more_than_the_cap(): void
    {
        $admin = $this->eventUser(['role' => 'admin']);
        [$eventId] = $this->registrationEvent((int) $admin->id);
        $count = EventInvitationRecipientExpander::ORGANISER_MAX_MEMBER_IDS + 10;
        $ids = $this->members($count);

        $preview = (new EventInvitationCampaignService())->preview(
            $eventId,
            $admin,
            'member',
            ['member_ids' => $ids],
            'f241-admin-over-cap',
        );
        self::assertSame($count, (int) $preview['campaign']->valid_count);
    }
}
