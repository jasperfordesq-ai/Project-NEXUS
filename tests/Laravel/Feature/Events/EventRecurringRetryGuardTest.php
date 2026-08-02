<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

declare(strict_types=1);

namespace Tests\Laravel\Feature\Events;

use App\Core\TenantContext;
use App\Models\User;
use App\Services\EventService;
use Carbon\CarbonImmutable;
use Illuminate\Foundation\Testing\DatabaseTransactions;
use Illuminate\Support\Facades\DB;
use Tests\Laravel\TestCase;

/**
 * A retried "create recurring series" request must not create a second series.
 *
 * The legacy engine (the DEFAULT — events.recurrence.engine_v2_enabled is
 * false) derives each occurrence_key from the new row's own auto-increment id,
 * so the schema's unique key on (tenant_id, occurrence_key) can never fire for
 * a repeat submission. A double-click or a client retry therefore produced a
 * complete duplicate set of occurrences that nothing downstream could tell
 * apart.
 */
final class EventRecurringRetryGuardTest extends TestCase
{
    use DatabaseTransactions;

    protected function setUp(): void
    {
        parent::setUp();
        config(['events.recurrence.engine_v2_enabled' => false]);
        TenantContext::reset();
        TenantContext::setById($this->testTenantId);
    }

    private function organiser(): User
    {
        return User::factory()->forTenant($this->testTenantId)->create([
            'status' => 'active',
            'is_approved' => true,
        ]);
    }

    /** @return array<string, mixed> */
    private function payload(string $title): array
    {
        $start = CarbonImmutable::now('UTC')->addWeek()->startOfHour();

        return [
            'title' => $title,
            'description' => 'Weekly community session.',
            'location' => 'Union Street Hall',
            'start_time' => $start->format('Y-m-d H:i:s'),
            'end_time' => $start->addHours(2)->format('Y-m-d H:i:s'),
            'recurrence_frequency' => 'weekly',
            'recurrence_interval' => 1,
            'recurrence_ends_type' => 'after_count',
            'recurrence_ends_after_count' => 4,
        ];
    }

    public function test_a_retried_create_returns_the_first_series_instead_of_duplicating_it(): void
    {
        $organiser = $this->organiser();
        $payload = $this->payload('Retry Guard Weekly Catan');

        $first = EventService::createRecurring((int) $organiser->id, $payload);
        self::assertNotNull($first, 'The first create must succeed.');
        $templateId = (int) $first['template_id'];
        $firstOccurrences = (int) $first['occurrences'];
        self::assertGreaterThan(0, $firstOccurrences);

        // The client retries the identical request (double click, flaky
        // network, queue redelivery).
        $second = EventService::createRecurring((int) $organiser->id, $payload);
        self::assertNotNull($second);

        self::assertSame(
            $templateId,
            (int) $second['template_id'],
            'A retry must hand back the series that already exists.',
        );
        self::assertTrue($second['idempotent_replay'] ?? false);
        self::assertSame(
            $firstOccurrences,
            (int) $second['occurrences'],
            'The replay reports the same occurrence count, not zero.',
        );

        self::assertSame(
            1,
            (int) DB::table('events')
                ->where('tenant_id', $this->testTenantId)
                ->where('user_id', (int) $organiser->id)
                ->where('is_recurring_template', 1)
                ->where('title', 'Retry Guard Weekly Catan')
                ->count(),
            'Exactly one template — the retry must not create a second one.',
        );
        self::assertSame(
            $firstOccurrences,
            (int) DB::table('events')
                ->where('tenant_id', $this->testTenantId)
                ->where('parent_event_id', $templateId)
                ->count(),
            'And exactly one set of occurrences.',
        );
    }

    public function test_a_genuinely_different_series_is_still_created(): void
    {
        $organiser = $this->organiser();

        $first = EventService::createRecurring((int) $organiser->id, $this->payload('Guard Monday Club'));
        $second = EventService::createRecurring((int) $organiser->id, $this->payload('Guard Thursday Club'));

        self::assertNotNull($first);
        self::assertNotNull($second);
        self::assertNotSame(
            (int) $first['template_id'],
            (int) $second['template_id'],
            'The guard must only catch retries, never block a different series.',
        );
    }

    public function test_the_guard_can_be_switched_off(): void
    {
        config(['events.recurrence.duplicate_window_seconds' => 0]);

        $organiser = $this->organiser();
        $payload = $this->payload('Guard Disabled Series');

        $first = EventService::createRecurring((int) $organiser->id, $payload);
        $second = EventService::createRecurring((int) $organiser->id, $payload);

        self::assertNotNull($first);
        self::assertNotNull($second);
        self::assertNotSame((int) $first['template_id'], (int) $second['template_id']);
    }
}
