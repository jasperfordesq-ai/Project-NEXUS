<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

declare(strict_types=1);

namespace Tests\Laravel\Feature\Events;

use App\Core\TenantContext;
use App\Models\User;
use App\Services\EventInvitationCampaignService;
use App\Services\EventRegistrationService;
use Carbon\CarbonImmutable;
use Illuminate\Foundation\Testing\DatabaseTransactions;
use Illuminate\Support\Facades\Config;
use Illuminate\Support\Facades\DB;
use Illuminate\Testing\TestResponse;
use Laravel\Sanctum\Sanctum;
use Tests\Laravel\Feature\Events\Concerns\BuildsEventRegistrationFormFixtures;
use Tests\Laravel\Feature\Events\Concerns\BuildsEventTicketingFixtures;
use Tests\Laravel\TestCase;

/**
 * Organisers and members were told only "Validation failed" when the server
 * knew exactly what was wrong: a per-member ticket limit above the number of
 * tickets, a date without the event's offset, a minimum age that is not a
 * number, a registration window ending after the event starts, an invitation
 * to a cancelled event, a cancellation after the organiser's deadline.
 *
 * The `code` (and, apart from the cancelled-event invitation, the status) are
 * unchanged, so nothing that switches on them breaks; the message now says
 * what is wrong, `field` names the input, and `reason` carries the reason code.
 */
final class EventErrorsSayWhatIsWrongTest extends TestCase
{
    use DatabaseTransactions;
    use BuildsEventRegistrationFormFixtures;
    use BuildsEventTicketingFixtures;

    protected function setUp(): void
    {
        parent::setUp();
        DB::table('tenants')->where('id', $this->testTenantId)->update([
            'features' => json_encode(['events' => true], JSON_THROW_ON_ERROR),
        ]);
        TenantContext::reset();
        TenantContext::setById($this->testTenantId);
        Config::set('events.notification_delivery.mode', 'outbox_authoritative');
        Config::set('events.registration.default_capacity_pool_key', 'event');
        Config::set('events.registration.legacy_dual_read', true);
        Config::set('events.registration.legacy_dual_write', true);
    }

    public function test_ticket_type_per_member_limit_above_the_allocation_is_named(): void
    {
        $owner = $this->ticketUser();
        [$eventId, $start] = $this->ticketEvent((int) $owner->id);
        Sanctum::actingAs($owner, ['*']);

        $response = $this->apiPost(
            "/v2/events/{$eventId}/ticket-types",
            $this->ticketTypePayload($start, ['allocation_limit' => 2, 'per_member_limit' => 5]),
            ['Idempotency-Key' => 'specific-error-per-member'],
        );

        $this->assertSpecific(
            $response,
            422,
            'EVENT_TICKET_VALIDATION_FAILED',
            'per_member_limit',
            'event_ticket_per_member_limit_invalid',
            __('api.event_ticket_per_member_limit_invalid'),
        );
    }

    public function test_ticket_sales_date_without_an_offset_is_named(): void
    {
        $owner = $this->ticketUser();
        [$eventId, $start] = $this->ticketEvent((int) $owner->id);
        Sanctum::actingAs($owner, ['*']);

        $response = $this->apiPost(
            "/v2/events/{$eventId}/ticket-types",
            $this->ticketTypePayload($start, [
                'sales_opens_at' => CarbonImmutable::now('UTC')->subDay()->format('Y-m-d\TH:i:s'),
            ]),
            ['Idempotency-Key' => 'specific-error-sales-offset'],
        );

        $this->assertSpecific(
            $response,
            422,
            'EVENT_TICKET_VALIDATION_FAILED',
            'sales_opens_at',
            'event_ticket_sales_open_invalid',
            __('api.event_ticket_date_invalid'),
        );
    }

    /** @return array<string,array{0:string,1:\Closure(CarbonImmutable):CarbonImmutable}> */
    public static function ticketDateFields(): array
    {
        return [
            'sales opening' => ['sales_opens_at', static fn (CarbonImmutable $start): CarbonImmutable => CarbonImmutable::now('UTC')->subDay()],
            'sales closing' => ['sales_closes_at', static fn (CarbonImmutable $start): CarbonImmutable => $start->subDay()],
            'refund cutoff' => ['refund_cutoff_at', static fn (CarbonImmutable $start): CarbonImmutable => $start->subDays(2)],
        ];
    }

    /**
     * A ticket date sent with an offset other than the event's own was
     * refused with no `field`: the offset check did not know which input it
     * was checking, so the organiser was not told which date to correct.
     *
     * @dataProvider ticketDateFields
     * @param \Closure(CarbonImmutable):CarbonImmutable $instant
     */
    public function test_ticket_date_with_the_wrong_offset_names_the_date(string $field, \Closure $instant): void
    {
        $owner = $this->ticketUser();
        [$eventId, $start] = $this->ticketEvent((int) $owner->id);
        Sanctum::actingAs($owner, ['*']);

        // The event is in UTC; the same instant written as +05:00 is refused.
        $response = $this->apiPost(
            "/v2/events/{$eventId}/ticket-types",
            $this->ticketTypePayload($start, [
                $field => $instant($start)->setTimezone('+05:00')->format('Y-m-d\TH:i:sP'),
            ]),
            ['Idempotency-Key' => 'specific-error-offset-' . $field],
        );

        $this->assertSpecific(
            $response,
            422,
            'EVENT_TICKET_VALIDATION_FAILED',
            $field,
            'event_ticket_timezone_offset_mismatch',
            __('api.event_ticket_timezone_offset_mismatch'),
        );
    }

    public function test_safety_minimum_age_that_is_not_a_number_is_named(): void
    {
        $owner = $this->eventUser();
        [$eventId] = $this->registrationEvent((int) $owner->id);
        Sanctum::actingAs($owner, ['*']);

        $response = $this->apiPut("/v2/events/{$eventId}/safety/requirements", [
            'minimum_age' => 'eighteen',
            'guardian_consent_required' => false,
            'minor_age_threshold' => null,
            'code_of_conduct_required' => false,
            'code_of_conduct_text' => null,
            'code_of_conduct_text_version' => null,
        ], ['Idempotency-Key' => 'specific-error-minimum-age']);

        $this->assertSpecific(
            $response,
            422,
            'EVENT_SAFETY_VALIDATION_FAILED',
            'minimum_age',
            'event_safety_age_requirement_invalid',
            __('api.event_safety_minimum_age_invalid'),
        );
    }

    public function test_registration_window_closing_after_the_event_starts_is_named(): void
    {
        $owner = $this->eventUser();
        [$eventId, $start] = $this->registrationEvent((int) $owner->id);
        Sanctum::actingAs($owner, ['*']);

        $response = $this->apiPut("/v2/events/{$eventId}/registration-product/settings", [
            'expected_revision' => 0,
            'idempotency_key' => 'specific-error-window',
            'approval_mode' => 'auto',
            'opens_at' => $start->subDays(5)->format('Y-m-d\TH:i:sP'),
            'closes_at' => $start->addDay()->format('Y-m-d\TH:i:sP'),
        ]);

        $this->assertSpecific(
            $response,
            422,
            'EVENT_REGISTRATION_VALIDATION_FAILED',
            null,
            'event_registration_window_after_event_start',
            __('event_registration.window_after_event_start'),
        );
    }

    public function test_issuing_invitations_to_a_cancelled_event_is_a_named_conflict(): void
    {
        $owner = $this->eventUser();
        $member = $this->eventUser();
        [$eventId, $start] = $this->registrationEvent((int) $owner->id);
        $preview = (new EventInvitationCampaignService())->preview(
            $eventId,
            $owner,
            'member',
            ['member_ids' => [(int) $member->id]],
            'specific-error-cancelled-preview',
        );
        DB::table('events')->where('tenant_id', $this->testTenantId)->where('id', $eventId)->update([
            'operational_status' => 'cancelled',
            'status' => 'cancelled',
            'cancelled_at' => now(),
        ]);
        Sanctum::actingAs($owner, ['*']);

        $response = $this->apiPost(
            "/v2/events/{$eventId}/registration-product/campaigns/{$preview['campaign']->id}/issue",
            [
                'expected_revision' => 1,
                'expires_at' => $start->subDay()->format('Y-m-d\TH:i:sP'),
                'idempotency_key' => 'specific-error-cancelled-issue',
            ],
        );

        $this->assertSpecific(
            $response,
            409,
            'EVENT_REGISTRATION_VALIDATION_FAILED',
            null,
            'event_registration_event_unavailable',
            __('event_registration.invitation_event_unavailable'),
        );
    }

    public function test_withdrawing_after_the_cancellation_cutoff_says_so(): void
    {
        [$member, $eventId] = $this->confirmedMemberPastCutoff();
        Sanctum::actingAs($member, ['*']);

        $response = $this->apiPost(
            "/v2/events/{$eventId}/registration/withdraw",
            [],
            ['Idempotency-Key' => 'specific-error-cutoff'],
        );

        $this->assertSpecific(
            $response,
            409,
            'EVENT_REGISTRATION_TRANSITION_INVALID',
            null,
            'event_registration_cancellation_cutoff_passed',
            __('event_registration.cancellation_cutoff_passed'),
        );
    }

    public function test_legacy_rsvp_removal_after_the_cancellation_cutoff_says_so(): void
    {
        [$member, $eventId] = $this->confirmedMemberPastCutoff();
        Sanctum::actingAs($member, ['*']);

        $response = $this->apiDelete("/v2/events/{$eventId}/rsvp");

        $this->assertSpecific(
            $response,
            422,
            'RSVP_FAILED',
            null,
            'event_registration_cancellation_cutoff_passed',
            __('event_registration.cancellation_cutoff_passed'),
        );
    }

    public function test_control_an_unexplained_refusal_keeps_the_generic_shape(): void
    {
        $owner = $this->ticketUser();
        [$eventId, $start] = $this->ticketEvent((int) $owner->id);
        Sanctum::actingAs($owner, ['*']);

        $response = $this->apiPost(
            "/v2/events/{$eventId}/ticket-types",
            $this->ticketTypePayload($start, ['kind' => 'free', 'unit_price_credits' => '3.00']),
            ['Idempotency-Key' => 'generic-error-price'],
        );

        $response->assertStatus(422)->assertJsonPath('errors.0.code', 'EVENT_TICKET_VALIDATION_FAILED');
        self::assertSame(__('api.validation_failed'), $response->json('errors.0.message'));
        self::assertArrayNotHasKey('reason', $response->json('errors.0'));
    }

    // ── fixtures ────────────────────────────────────────────────────────────

    /** @return array{0:User,1:int} */
    private function confirmedMemberPastCutoff(): array
    {
        $owner = $this->eventUser();
        $member = $this->eventUser();
        [$eventId] = $this->registrationEvent((int) $owner->id);
        $event = DB::table('events')->where('id', $eventId)->first(['occurrence_key', 'start_time']);
        DB::table('event_registration_settings')->insert([
            'tenant_id' => $this->testTenantId,
            'event_id' => $eventId,
            'occurrence_key' => $event->occurrence_key,
            'revision' => 1,
            'status' => 'published',
            'approval_mode' => 'auto',
            'event_starts_at_utc_snapshot' => $event->start_time,
            'event_timezone_snapshot' => 'UTC',
            'created_by' => $owner->id,
            'updated_by' => $owner->id,
            'published_by' => $owner->id,
            'published_at' => now(),
            'created_at' => now(),
            'updated_at' => now(),
        ]);
        (new EventRegistrationService())->confirm($eventId, (int) $member->id, $member, 'specific-error-cutoff-confirm');
        DB::table('event_registration_settings')
            ->where('tenant_id', $this->testTenantId)
            ->where('event_id', $eventId)
            ->update(['cancellation_cutoff_at_utc' => now()->subHour()]);

        return [$member, $eventId];
    }

    private function assertSpecific(
        TestResponse $response,
        int $status,
        string $code,
        ?string $field,
        string $reason,
        string $message,
    ): void {
        $response->assertStatus($status)->assertJsonPath('errors.0.code', $code);
        $error = (array) $response->json('errors.0');
        self::assertSame($reason, $error['reason'] ?? null, 'the reason code is reported');
        self::assertSame($message, $error['message'] ?? null, 'BAD OUTCOME: the error does not say what is wrong.');
        self::assertNotSame(__('api.validation_failed'), $message);
        self::assertDoesNotMatchRegularExpression('/^[a-z_]+\.[a-z_]+$/', $message, 'message must be translated, not a key');
        if ($field === null) {
            self::assertArrayNotHasKey('field', $error);
        } else {
            self::assertSame($field, $error['field'] ?? null);
        }
    }
}
