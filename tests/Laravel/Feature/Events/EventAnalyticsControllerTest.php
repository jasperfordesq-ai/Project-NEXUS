<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

declare(strict_types=1);

namespace Tests\Laravel\Feature\Events;

use App\Core\TenantContext;
use App\Models\Event;
use App\Models\User;
use Illuminate\Foundation\Testing\DatabaseTransactions;
use Illuminate\Support\Facades\DB;
use Laravel\Sanctum\Sanctum;
use Tests\Laravel\TestCase;

final class EventAnalyticsControllerTest extends TestCase
{
    use DatabaseTransactions;

    protected function setUp(): void
    {
        parent::setUp();
        DB::table('tenants')->where('id', $this->testTenantId)->update([
            'features' => json_encode(['events' => true], JSON_THROW_ON_ERROR),
        ]);
        TenantContext::reset();
        TenantContext::setById($this->testTenantId);
    }

    public function test_dashboard_and_recipient_localized_csv_are_private_audited_contracts(): void
    {
        $owner = $this->user(['preferred_language' => 'de']);
        $event = $this->event($owner);
        Sanctum::actingAs($owner, ['*']);

        $dashboard = $this->apiGet("/v2/events/{$event->id}/analytics");
        $dashboard->assertOk()
            ->assertJsonPath('data.contract_version', 1)
            ->assertJsonPath('data.event_id', (int) $event->id)
            ->assertJsonPath('data.event_title', 'Analytics API fixture')
            ->assertJsonPath('data.registration.confirmed', 0)
            ->assertJsonPath('data.tickets.redacted', false)
            ->assertJsonMissingPath('data.tenant_id')
            ->assertJsonMissingPath('data.organizer_id')
            ->assertJsonMissingPath('data.communications.recipients');

        // 🔴 by_channel must be a JSON OBJECT even when empty. PHP has one array
        // type, so an empty map json_encodes to `[]` — and the client declares
        // this field as a record and rejects the ENTIRE response as contract
        // drift, which is exactly how the analytics tab broke in production for
        // every event with no notification deliveries. Asserting a path is not
        // enough here; the JSON TYPE is the contract, so decode the raw body.
        $decoded = json_decode((string) $dashboard->getContent(), true, 512, JSON_THROW_ON_ERROR);
        self::assertIsArray($decoded['data']['communications']['by_channel']);
        self::assertStringContainsString(
            '"by_channel":{}',
            (string) $dashboard->getContent(),
            'An empty by_channel map must serialise as {} — [] fails the client contract.',
        );

        self::assertStringContainsString('no-store', (string) $dashboard->headers->get('Cache-Control'));

        DB::table('events')->where('id', $event->id)->update(['title' => '=1+1']);
        $export = $this->apiGet("/v2/events/{$event->id}/analytics/export.csv");
        $export->assertOk();
        self::assertStringContainsString('text/csv', (string) $export->headers->get('Content-Type'));
        self::assertStringContainsString('no-store', (string) $export->headers->get('Cache-Control'));
        self::assertStringContainsString(
            'event-' . $event->id . '-analytics.csv',
            (string) $export->headers->get('Content-Disposition'),
        );
        $csv = $export->streamedContent();
        self::assertStringStartsWith("\xEF\xBB\xBF", $csv);
        self::assertStringContainsString('Kennzahl,Wert', $csv);
        self::assertStringContainsString("event_title,'=1+1,0", $csv);
        self::assertStringContainsString('registration.confirmed,0,0', $csv);

        self::assertSame(2, DB::table('event_analytics_access_audits')
            ->where('event_id', $event->id)
            ->count());
        self::assertSame(1, DB::table('event_analytics_access_audits')
            ->where('event_id', $event->id)
            ->where('purpose_code', 'csv_export')
            ->count());
    }

    public function test_non_organizer_access_is_hidden_and_does_not_create_audit_evidence(): void
    {
        $owner = $this->user();
        $outsider = $this->user();
        $event = $this->event($owner);
        Sanctum::actingAs($outsider, ['*']);

        $this->apiGet("/v2/events/{$event->id}/analytics")
            ->assertNotFound()
            ->assertJsonPath('errors.0.code', 'EVENT_ANALYTICS_NOT_FOUND');
        $this->apiGet("/v2/events/{$event->id}/analytics/export.csv")
            ->assertNotFound()
            ->assertJsonPath('errors.0.code', 'EVENT_ANALYTICS_NOT_FOUND');
        self::assertSame(0, DB::table('event_analytics_access_audits')
            ->where('event_id', $event->id)
            ->count());
    }

    /** @param array<string,mixed> $overrides */
    private function user(array $overrides = []): User
    {
        return User::factory()->forTenant($this->testTenantId)->create(array_merge([
            'status' => 'active',
            'is_approved' => true,
            'preferred_language' => 'en',
        ], $overrides));
    }

    private function event(User $owner): Event
    {
        return Event::factory()->forTenant($this->testTenantId)->create([
            'user_id' => (int) $owner->id,
            'title' => 'Analytics API fixture',
            'status' => 'active',
            'publication_status' => 'published',
            'operational_status' => 'scheduled',
            'is_recurring_template' => false,
            'max_attendees' => 20,
        ]);
    }
}
