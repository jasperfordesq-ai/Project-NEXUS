<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

declare(strict_types=1);

namespace Tests\Laravel\Unit\Http\Resources;

use App\Http\Resources\EventAnalyticsResource;
use PHPUnit\Framework\TestCase;

final class EventAnalyticsResourceTest extends TestCase
{
    public function test_projection_is_identity_free_and_preserves_privacy_suppression(): void
    {
        $resource = EventAnalyticsResource::fromSummary([
            'contract_version' => 1,
            'event_id' => 42,
            'event_title' => 'Community summit',
            'generated_at' => '2030-01-01T12:00:00+00:00',
            'privacy_threshold' => 5,
            'registration' => ['confirmed' => 12, 'capacity_limit' => 20],
            'invitation' => ['available' => true, 'issued' => 8, 'accepted' => 4],
            'waitlist' => ['joined' => 4, 'accepted' => 2],
            'attendance' => ['attended' => 7, 'no_show' => 1],
            'tickets' => ['available' => true, 'redacted' => true],
            'credits' => ['completed_claims' => 0, 'completed_amount' => '0.00'],
            'communications' => [
                'delivered' => 9,
                'by_channel' => ['email' => ['delivered' => 5]],
            ],
            'optional_funnel' => [
                'event_views' => ['value' => 4, 'suppressed' => true],
                'registration_starts' => ['value' => 6, 'suppressed' => false],
            ],
            'safeguarding' => [
                'available' => true,
                'guardian_consents' => ['value' => 2, 'suppressed' => true],
            ],
            'recipient_emails' => ['private@example.test'],
            'member_ids' => [1, 2, 3],
            'raw_answers' => ['private'],
        ]);

        self::assertSame(42, $resource['event_id']);
        self::assertSame(12, $resource['registration']['confirmed']);
        self::assertNull($resource['optional_funnel']['event_views']['value']);
        self::assertTrue($resource['optional_funnel']['event_views']['suppressed']);
        self::assertNull($resource['safeguarding']['guardian_consents']['value']);
        self::assertTrue($resource['tickets']['redacted']);
        // by_channel is deliberately cast to an object so an EMPTY map
        // serialises as {} rather than [] — PHP cannot distinguish the two, and
        // the client's schema declares a record, so [] failed the whole
        // response. Read it as an object here for the same reason.
        $byChannel = (array) $resource['communications']['by_channel'];
        self::assertSame(5, $byChannel['email']['delivered']);
        self::assertArrayNotHasKey('recipient_emails', $resource);
        self::assertArrayNotHasKey('member_ids', $resource);
        self::assertArrayNotHasKey('raw_answers', $resource);
    }
}
