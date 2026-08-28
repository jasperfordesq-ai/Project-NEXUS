<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

namespace Tests\Laravel\Feature\Services;

use App\Services\Identity\IdentityVerificationEventService;
use Illuminate\Foundation\Testing\DatabaseTransactions;
use Illuminate\Support\Facades\DB;
use Tests\Laravel\TestCase;

/**
 * Regression tests for the READ path of IdentityVerificationEventService.
 *
 * Sentry NEXUS-PHP-54: GET /api/v2/admin/identity/audit-log returned a 500 with
 * "Call to a member function fetchColumn() on bool". All three read methods
 * called DB::statement(...)->fetchAll() / ->fetchColumn(), but DB::statement()
 * returns a bool, not a PDOStatement — so every read fatalled.
 *
 * The pre-existing unit test for this service only covered log() (the write
 * path, which was correct) and mocked DB::statement() to return true, so it
 * could never have caught this. These tests run against a real database on
 * purpose: the defect only exists once a real result set has to come back.
 */
class IdentityVerificationEventReadPathTest extends TestCase
{
    use DatabaseTransactions;

    /** Tenant id chosen to not collide with seeded fixture data. */
    private const TENANT_ID = 424242;
    private const USER_ID = 987654;

    protected function setUp(): void
    {
        parent::setUp();

        // Two 'registration_started' and one 'verification_passed' for this tenant.
        foreach (
            [
                IdentityVerificationEventService::EVENT_REGISTRATION_STARTED,
                IdentityVerificationEventService::EVENT_REGISTRATION_STARTED,
                IdentityVerificationEventService::EVENT_VERIFICATION_PASSED,
            ] as $eventType
        ) {
            DB::insert(
                "INSERT INTO identity_verification_events
                    (tenant_id, user_id, session_id, event_type, actor_id, actor_type)
                 VALUES (?, ?, NULL, ?, NULL, 'system')",
                [self::TENANT_ID, self::USER_ID, $eventType]
            );
        }
    }

    public function test_get_for_tenant_returns_rows_and_a_total(): void
    {
        $result = IdentityVerificationEventService::getForTenant(self::TENANT_ID);

        $this->assertSame(3, $result['total']);
        $this->assertCount(3, $result['events']);
    }

    public function test_get_for_tenant_paginates_without_changing_the_total(): void
    {
        $result = IdentityVerificationEventService::getForTenant(self::TENANT_ID, 2, 0);

        // The COUNT(*) is a separate query and must report the whole set, not the page.
        $this->assertSame(3, $result['total']);
        $this->assertCount(2, $result['events']);

        $page2 = IdentityVerificationEventService::getForTenant(self::TENANT_ID, 2, 2);
        $this->assertSame(3, $page2['total']);
        $this->assertCount(1, $page2['events']);
    }

    public function test_get_for_tenant_applies_the_event_type_filter(): void
    {
        $result = IdentityVerificationEventService::getForTenant(
            self::TENANT_ID,
            50,
            0,
            IdentityVerificationEventService::EVENT_REGISTRATION_STARTED
        );

        $this->assertSame(2, $result['total']);
        $this->assertCount(2, $result['events']);
    }

    public function test_get_for_tenant_is_scoped_to_the_tenant(): void
    {
        $other = IdentityVerificationEventService::getForTenant(self::TENANT_ID + 1);

        $this->assertSame(0, $other['total']);
        $this->assertSame([], $other['events']);
    }

    public function test_get_for_user_returns_rows(): void
    {
        $events = IdentityVerificationEventService::getForUser(self::TENANT_ID, self::USER_ID);

        $this->assertCount(3, $events);
    }

    public function test_get_for_session_returns_an_empty_array_rather_than_throwing(): void
    {
        // No rows carry a session id here; the point is that the query executes
        // and returns a real (empty) result set instead of fatalling on a bool.
        $this->assertSame([], IdentityVerificationEventService::getForSession(-1));
    }
}
