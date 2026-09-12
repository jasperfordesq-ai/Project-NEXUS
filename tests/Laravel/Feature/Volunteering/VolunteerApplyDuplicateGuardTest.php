<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

declare(strict_types=1);

namespace Tests\Laravel\Feature\Volunteering;

use App\Core\TenantContext;
use App\Services\VolunteerService;
use App\Services\VolunteeringConfigurationService;
use Illuminate\Foundation\Testing\DatabaseTransactions;
use Illuminate\Support\Facades\Cache;
use Illuminate\Support\Facades\DB;
use Tests\Laravel\TestCase;

/**
 * VolunteerService::apply() was an unguarded check-then-insert —
 * vol_applications has no unique key on (opportunity_id, user_id) because
 * declined rows may legitimately repeat, so two concurrent identical
 * submissions both passed the exists() check and double-inserted. The fix
 * serialises the window under the same Cache::lock pattern logHours uses.
 */
class VolunteerApplyDuplicateGuardTest extends TestCase
{
    use DatabaseTransactions;

    private const TENANT_ID = 2;

    protected function setUp(): void
    {
        parent::setUp();
        TenantContext::setById(self::TENANT_ID);
    }

    private function makeUser(): int
    {
        return (int) DB::table('users')->insertGetId([
            'tenant_id' => self::TENANT_ID,
            'first_name' => 'Apply',
            'last_name' => 'Tester',
            'email' => 'apl.' . uniqid('', true) . '@example.com',
            'username' => 'apl_' . substr(md5(uniqid('', true)), 0, 8),
            'password' => password_hash('password', PASSWORD_BCRYPT),
            'status' => 'active',
            'created_at' => now(),
            'updated_at' => now(),
        ]);
    }

    private function makeOpportunity(int $creatorId): int
    {
        $orgId = (int) DB::table('vol_organizations')->insertGetId([
            'tenant_id' => self::TENANT_ID,
            'user_id' => $creatorId,
            'name' => 'Apply race test org',
            'status' => 'approved',
            'created_at' => now(),
            'updated_at' => now(),
        ]);

        return (int) DB::table('vol_opportunities')->insertGetId([
            'tenant_id' => self::TENANT_ID,
            'organization_id' => $orgId,
            'title' => 'Apply race test opportunity',
            'description' => 'x',
            'status' => 'active',
            'is_active' => 1,
            'created_by' => $creatorId,
            'created_at' => now(),
            'updated_at' => now(),
        ]);
    }

    public function test_concurrent_identical_apply_is_rejected_while_lock_is_held(): void
    {
        $creator = $this->makeUser();
        $user = $this->makeUser();
        $oppId = $this->makeOpportunity($creator);

        // Simulate the concurrent first request still inside the window by
        // pre-acquiring the dedup lock the fix introduces.
        $lock = Cache::lock(sprintf('vol_apply_dedupe:%d:%d:%d', self::TENANT_ID, $oppId, $user), 10);
        $this->assertTrue($lock->get());

        try {
            VolunteerService::apply($oppId, $user);
            $this->fail('Expected the concurrent duplicate apply to be rejected (409).');
        } catch (\RuntimeException $e) {
            $this->assertSame(409, $e->getCode());
        } finally {
            $lock->release();
        }

        $this->assertSame(
            0,
            (int) DB::table('vol_applications')->where('opportunity_id', $oppId)->where('user_id', $user)->count(),
            'No application row may be created while a concurrent identical submission holds the lock.'
        );
    }

    public function test_apply_succeeds_and_releases_the_lock(): void
    {
        $creator = $this->makeUser();
        $user = $this->makeUser();
        $oppId = $this->makeOpportunity($creator);

        $application = VolunteerService::apply($oppId, $user);
        $this->assertSame('pending', $application->status);

        // The lock must be free again after a successful apply.
        $lock = Cache::lock(sprintf('vol_apply_dedupe:%d:%d:%d', self::TENANT_ID, $oppId, $user), 10);
        $this->assertTrue($lock->get(), 'The dedup lock must be released after apply() returns.');
        $lock->release();

        // And the sequential duplicate is still rejected by the exists() check.
        try {
            VolunteerService::apply($oppId, $user);
            $this->fail('Expected the sequential duplicate apply to be rejected (409).');
        } catch (\RuntimeException $e) {
            $this->assertSame(409, $e->getCode());
        }

        $this->assertSame(
            1,
            (int) DB::table('vol_applications')->where('opportunity_id', $oppId)->where('user_id', $user)->count()
        );
    }

    public function test_declined_application_allows_reapplication_and_detail_reads_back_the_new_note(): void
    {
        $creator = $this->makeUser();
        $user = $this->makeUser();
        $oppId = $this->makeOpportunity($creator);
        $previous = VolunteerService::apply($oppId, $user, ['message' => 'Original availability']);
        DB::table('vol_applications')->where('id', $previous->id)->update(['status' => 'declined']);

        $before = VolunteerService::getOpportunityById($oppId, $user);
        $this->assertFalse($before['has_applied']);
        $this->assertSame('declined', $before['application']['status']);

        $next = VolunteerService::apply($oppId, $user, ['message' => 'New Saturday availability']);
        $this->assertNotSame($previous->id, $next->id);
        $after = VolunteerService::getOpportunityById($oppId, $user);
        $this->assertTrue($after['has_applied']);
        $this->assertSame((int) $next->id, $after['application']['id']);
        $this->assertSame('New Saturday availability', $after['application']['message']);
        $this->assertSame('Original availability', DB::table('vol_applications')->where('id', $previous->id)->value('message'));
    }

    public function test_required_decline_note_rejects_blank_then_persists_the_explanation(): void
    {
        $creator = $this->makeUser();
        $user = $this->makeUser();
        $oppId = $this->makeOpportunity($creator);
        $application = VolunteerService::apply($oppId, $user);
        $key = VolunteeringConfigurationService::CONFIG_REQUIRE_ORG_NOTE_ON_DECLINE;
        $previous = VolunteeringConfigurationService::get($key, false);
        VolunteeringConfigurationService::set($key, true);
        try {
            $this->assertFalse(VolunteerService::handleApplication($application->id, $creator, 'decline', '   '));
            $this->assertSame('pending', DB::table('vol_applications')->where('id', $application->id)->value('status'));
            $this->assertTrue(VolunteerService::handleApplication($application->id, $creator, 'decline', 'Please apply for the next session.'));
            $saved = DB::table('vol_applications')->where('id', $application->id)->first();
            $this->assertSame('declined', $saved->status);
            $this->assertSame('Please apply for the next session.', $saved->org_note);
        } finally {
            VolunteeringConfigurationService::set($key, $previous);
        }
    }
}
