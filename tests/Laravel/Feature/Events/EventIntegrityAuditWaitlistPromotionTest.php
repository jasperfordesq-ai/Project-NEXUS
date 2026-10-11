<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

declare(strict_types=1);

namespace Tests\Laravel\Feature\Events;

use App\Enums\EventCapacityRegistrationState;
use App\Models\User;
use App\Services\EventIntegrityAuditService;
use App\Services\EventRegistrationService;
use App\Services\EventRegistrationSettingsService;
use App\Services\EventWaitlistService;
use Illuminate\Foundation\Testing\DatabaseTransactions;
use Illuminate\Support\Facades\Config;
use Illuminate\Support\Facades\DB;
use Tests\Laravel\Feature\Events\Concerns\BuildsEventRegistrationFormFixtures;
use Tests\Laravel\TestCase;

/**
 * E-102 follow-up — the integrity audit knew only one way for a waitlist
 * entry to become `accepted`: a member redeeming a timed offer token into a
 * `confirmed` place.
 *
 * Two legitimate shapes now exist and were reported as critical tampering:
 *  - automatic promotion (timed offers off): no offer token ever exists, the
 *    history row says `promoted`, and nobody acted (the system did);
 *  - manual approval (F-587 for offers, and promotion too): the accepted
 *    entry points at a `pending` registration awaiting the organiser.
 *
 * The audit must accept both, and still report an accepted row that has
 * neither an offer redemption nor a recorded automatic promotion behind it.
 */
final class EventIntegrityAuditWaitlistPromotionTest extends TestCase
{
    use DatabaseTransactions;
    use BuildsEventRegistrationFormFixtures;

    private const WAITLIST_ACCEPTANCE_CODES = [
        'event_waitlist_accepted_evidence_missing',
        'event_waitlist_accepted_registration_mismatch',
        'event_waitlist_fact_history_missing_or_stale',
        'event_waitlist_history_fact_mismatch',
        'event_waitlist_token_used_outside_acceptance',
    ];

    protected function setUp(): void
    {
        parent::setUp();
        self::assertStringStartsWith('nexus_test', DB::connection()->getDatabaseName());
        Config::set('events.registration.default_capacity_pool_key', 'event');
        Config::set('events.registration.allow_allocation_keys', false);
        Config::set('events.registration.legacy_dual_read', true);
        Config::set('events.registration.legacy_dual_write', true);
        Config::set('events.registration.timed_waitlist_offers_enabled', false);
    }

    public function test_an_automatically_promoted_entry_is_not_reported(): void
    {
        [$eventId, , $holder, $first] = $this->fullEventWithQueue('auto');
        (new EventRegistrationService())->withdraw($eventId, (int) $holder->id, $holder, 'audit-promote-auto');
        $entryId = $this->acceptedEntryId($eventId, $first);
        self::assertSame('confirmed', $this->state($eventId, $first), 'Fixture: the head was moved into the place.');

        self::assertSame(
            [],
            $this->codesNaming($entryId),
            'BAD OUTCOME: a member moved up automatically from the waitlist is reported as a tampered row.',
        );
    }

    public function test_an_automatic_promotion_under_manual_approval_is_not_reported(): void
    {
        [$eventId, , $holder, $first] = $this->fullEventWithQueue('manual');
        (new EventRegistrationService())->withdraw($eventId, (int) $holder->id, $holder, 'audit-promote-manual');
        $entryId = $this->acceptedEntryId($eventId, $first);
        self::assertSame('pending', $this->state($eventId, $first), 'Fixture: the promotion waits for the organiser.');

        self::assertSame([], $this->codesNaming($entryId));
    }

    public function test_an_offer_accepted_under_manual_approval_is_not_reported(): void
    {
        Config::set('events.notification_delivery.mode', 'outbox_authoritative');
        Config::set('events.notification_delivery.consumer_enabled', true);
        Config::set('events.registration.timed_waitlist_offers_enabled', true);
        Config::set('events.registration.offer_ttl_minutes', 15);
        DB::table('tenant_settings')
            ->where('tenant_id', $this->testTenantId)
            ->where('setting_key', 'events.notification_delivery_mode')
            ->delete();
        $waitlist = new EventWaitlistService();
        self::assertTrue($waitlist->timedOffersEnabled(), 'Fixture: timed offers are on.');
        [$eventId, , $holder, $first] = $this->fullEventWithQueue('manual');
        $released = (new EventRegistrationService())->withdraw($eventId, (int) $holder->id, $holder, 'audit-offer-release');
        self::assertNotNull($released->offerToken);

        $waitlist->acceptOffer($eventId, (int) $first->id, (string) $released->offerToken, $first, 'audit-offer-accept');
        $entryId = $this->acceptedEntryId($eventId, $first);
        self::assertSame('pending', $this->state($eventId, $first), 'Fixture: F-587 makes the accepted offer pending.');

        self::assertSame(
            [],
            $this->codesNaming($entryId),
            'BAD OUTCOME: an offer accepted under manual approval is reported as a registration mismatch.',
        );
    }

    public function test_control_an_accepted_row_with_no_offer_and_no_promotion_is_still_reported(): void
    {
        [$eventId, , , $first] = $this->fullEventWithQueue('auto');
        $entry = $this->entry($eventId, $first);
        $registrationId = $this->canonicalRegistration($eventId, (int) $first->id, 'confirmed');
        $version = (int) $entry->queue_version + 1;

        // Forged straight into the table: no offer was redeemed, and the
        // history row mimics an offer acceptance rather than a promotion.
        DB::table('event_waitlist_entries')->where('id', $entry->id)->update([
            'queue_state' => 'accepted',
            'queue_version' => $version,
            'state_changed_at' => now(),
            'state_changed_by' => null,
            'accepted_at' => now(),
            'accepted_registration_id' => $registrationId,
        ]);
        $this->forgedHistory($entry, $version, 'accepted', null);

        self::assertContains('event_waitlist_accepted_evidence_missing', $this->codesNaming((int) $entry->id));
    }

    public function test_control_a_promotion_claimed_by_a_member_is_still_reported(): void
    {
        [$eventId, , , $first] = $this->fullEventWithQueue('auto');
        $entry = $this->entry($eventId, $first);
        $registrationId = $this->canonicalRegistration($eventId, (int) $first->id, 'confirmed');
        $version = (int) $entry->queue_version + 1;

        // An automatic promotion has no human actor. A "promotion" a member
        // performed is not one.
        DB::table('event_waitlist_entries')->where('id', $entry->id)->update([
            'queue_state' => 'accepted',
            'queue_version' => $version,
            'state_changed_at' => now(),
            'state_changed_by' => (int) $first->id,
            'accepted_at' => now(),
            'accepted_registration_id' => $registrationId,
        ]);
        $this->forgedHistory($entry, $version, 'promoted', (int) $first->id);

        self::assertContains('event_waitlist_accepted_evidence_missing', $this->codesNaming((int) $entry->id));
    }

    public function test_control_an_accepted_row_pointing_at_an_invitation_is_still_reported(): void
    {
        [$eventId, , $holder, $first] = $this->fullEventWithQueue('auto');
        (new EventRegistrationService())->withdraw($eventId, (int) $holder->id, $holder, 'audit-promote-mismatch');
        $entryId = $this->acceptedEntryId($eventId, $first);
        DB::table('event_registrations')
            ->where('tenant_id', $this->testTenantId)
            ->where('event_id', $eventId)
            ->where('user_id', (int) $first->id)
            ->update(['registration_state' => 'invited']);

        self::assertContains('event_waitlist_accepted_registration_mismatch', $this->codesNaming($entryId));
    }

    // ── fixtures ────────────────────────────────────────────────────────────

    /** @return list<string> the waitlist acceptance issue codes that name this entry */
    private function codesNaming(int $entryId): array
    {
        $result = (new EventIntegrityAuditService())->run($this->testTenantId, 100000);

        return collect($result['issues'])
            ->filter(fn (array $issue): bool => in_array($issue['code'], self::WAITLIST_ACCEPTANCE_CODES, true)
                && in_array($entryId, $issue['sample_ids'], true))
            ->pluck('code')
            ->values()
            ->all();
    }

    private function forgedHistory(object $entry, int $version, string $action, ?int $actorId): void
    {
        DB::table('event_waitlist_entry_history')->insert([
            'tenant_id' => $this->testTenantId,
            'event_id' => (int) $entry->event_id,
            'waitlist_entry_id' => (int) $entry->id,
            'user_id' => (int) $entry->user_id,
            'actor_user_id' => $actorId,
            'capacity_pool_key' => (string) $entry->capacity_pool_key,
            'allocation_key' => null,
            'queue_version' => $version,
            'queue_sequence' => (int) $entry->queue_sequence,
            'action' => $action,
            'from_state' => 'waiting',
            'to_state' => 'accepted',
            'idempotency_key' => 'audit-forged-' . bin2hex(random_bytes(8)),
            'reason' => null,
            'metadata' => json_encode(['schema_version' => 1], JSON_THROW_ON_ERROR),
            'created_at' => now(),
        ]);
    }

    /**
     * Capacity 1: the holder is confirmed and two members wait in order.
     *
     * @return array{0:int,1:User,2:User,3:User,4:User}
     */
    private function fullEventWithQueue(string $approvalMode): array
    {
        $owner = $this->eventUser();
        $holder = $this->eventUser();
        $first = $this->eventUser();
        $second = $this->eventUser();
        [$eventId, $start] = $this->registrationEvent((int) $owner->id);
        DB::table('events')->where('id', $eventId)->update(['max_attendees' => 1]);
        $settings = new EventRegistrationSettingsService();
        $saved = $settings->save(
            $eventId,
            $owner,
            [
                'approval_mode' => $approvalMode,
                'opens_at' => $start->subDays(60)->format('Y-m-d\TH:i:sP'),
                'closes_at' => $start->format('Y-m-d\TH:i:sP'),
                'cancellation_cutoff_at' => $start->format('Y-m-d\TH:i:sP'),
                'per_member_limit' => 1,
                'guests_enabled' => false,
                'max_guests_per_registration' => 0,
                'guest_retention_days' => 30,
            ],
            null,
            'audit-settings-create-' . bin2hex(random_bytes(8)),
        );
        $settings->publish(
            $eventId,
            $owner,
            (int) $saved['settings']->revision,
            'audit-settings-publish-' . bin2hex(random_bytes(8)),
        );

        $registrations = new EventRegistrationService();
        $registrations->confirm($eventId, (int) $holder->id, $holder, 'audit-holder-request');
        if ($approvalMode === 'manual') {
            $registrations->transition(
                $eventId,
                (int) $holder->id,
                EventCapacityRegistrationState::Confirmed,
                $owner,
                'audit-holder-approve',
            );
        }
        self::assertSame('confirmed', $this->state($eventId, $holder));

        $waitlist = new EventWaitlistService();
        $waitlist->join($eventId, (int) $first->id, $first, 'audit-join-first');
        $waitlist->join($eventId, (int) $second->id, $second, 'audit-join-second');

        return [$eventId, $owner, $holder, $first, $second];
    }

    private function acceptedEntryId(int $eventId, User $member): int
    {
        $entry = $this->entry($eventId, $member);
        self::assertSame('accepted', (string) $entry->queue_state, 'Fixture: the entry is accepted.');

        return (int) $entry->id;
    }

    private function entry(int $eventId, User $member): object
    {
        $entry = DB::table('event_waitlist_entries')
            ->where('tenant_id', $this->testTenantId)
            ->where('event_id', $eventId)
            ->where('user_id', (int) $member->id)
            ->first();
        self::assertNotNull($entry);

        return $entry;
    }

    private function state(int $eventId, User $member): ?string
    {
        $state = DB::table('event_registrations')
            ->where('tenant_id', $this->testTenantId)
            ->where('event_id', $eventId)
            ->where('user_id', (int) $member->id)
            ->value('registration_state');

        return $state === null ? null : (string) $state;
    }
}
