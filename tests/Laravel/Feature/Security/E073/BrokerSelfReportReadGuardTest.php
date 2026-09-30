<?php

// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

declare(strict_types=1);

namespace Tests\Laravel\Feature\Security\E073;

use App\Core\TenantContext;
use App\Models\User;
use Illuminate\Foundation\Testing\DatabaseTransactions;
use Illuminate\Support\Facades\Cache;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Queue;
use Laravel\Sanctum\Sanctum;
use Tests\Laravel\TestCase;

/**
 * F-454 (E-073 H-1) — the read side of F-218.
 *
 * `AdminReportsController::guardBrokerNotParty()` (:77-87) was applied to
 * `resolve()` and `dismiss()` only. `show()` and `index()` both join
 * `users reporter`, and `formatReport()` publishes `reporter_id`,
 * `reporter_name`, `reporter_avatar` and the complainant's free-text `reason`
 * — so a broker who was reported, or whose content was reported, read who
 * complained about them and what they wrote. A broker holds moderation power
 * over the members who report them, so that is a retaliation risk.
 *
 * The platform has already settled this question for itself on the analogous
 * table: `MarketplaceReportService::formatReportForViewer()` (:448-475)
 * publishes no reporter identity at all to a reported seller and nulls the
 * description and evidence. The control below measures that rather than
 * asserting it.
 *
 * 🔴 These assertions state the CORRECT outcome: they fail while the bug
 * exists and pass once the guard is applied. The controls show that
 * legitimate moderation, and the guard's deliberate administrator-tier
 * exemption, are both unchanged.
 */
final class BrokerSelfReportReadGuardTest extends TestCase
{
    use DatabaseTransactions;

    /** The complaint text a reported member must not be handed. */
    private const REASON = 'F454-COMPLAINT-broker-pressured-me-for-a-cash-payment';

    protected function setUp(): void
    {
        parent::setUp();
        Queue::fake();
        $this->withoutMiddleware([
            \Illuminate\Routing\Middleware\ThrottleRequests::class,
            \Illuminate\Routing\Middleware\ThrottleRequestsWithRedis::class,
        ]);
        $this->app['auth']->forgetGuards();
        Cache::flush();
        TenantContext::reset();
        TenantContext::setById($this->testTenantId);
    }

    // ---------------------------------------------------------------- reads
    // that must now be refused

    /** The reported broker must not read the complaint filed about them. */
    public function test_the_report_detail_route_refuses_the_subject_of_the_report(): void
    {
        $broker = $this->staff('broker');
        $reporter = $this->staff('member');

        $reportId = $this->userReport((int) $reporter->id, (int) $broker->id);

        Sanctum::actingAs($broker, ['*']);
        $res = $this->apiGet("/v2/admin/reports/{$reportId}");

        self::assertSame(403, $res->getStatusCode(),
            'the subject of a report must not read it: ' . $res->getContent());
        self::assertStringNotContainsString(self::REASON, (string) $res->getContent(),
            'the complaint text must not reach the person complained about');
        self::assertStringNotContainsString((string) $reporter->name, (string) $res->getContent(),
            'the complainant\'s name must not reach the person complained about');
    }

    /**
     * And the owner of the reported content — the exact case F-218 was raised
     * for on the write side.
     */
    public function test_the_report_detail_route_refuses_the_owner_of_the_reported_content(): void
    {
        $broker = $this->staff('broker');
        $reporter = $this->staff('member');

        $listingId = $this->listing((int) $broker->id);
        $reportId = $this->contentReport((int) $reporter->id, 'listing', $listingId);

        Sanctum::actingAs($broker, ['*']);
        $res = $this->apiGet("/v2/admin/reports/{$reportId}");

        self::assertSame(403, $res->getStatusCode(),
            'the owner of the reported content must not read the report: ' . $res->getContent());
        self::assertStringNotContainsString(self::REASON, (string) $res->getContent());
    }

    /**
     * The queue is a work list, so rows the caller is a party to are EXCLUDED
     * rather than the whole route refused.
     */
    public function test_the_report_queue_excludes_reports_the_caller_is_a_party_to(): void
    {
        $broker = $this->staff('broker');
        $reporter = $this->staff('member');

        $aboutMe = $this->userReport((int) $reporter->id, (int) $broker->id);
        $aboutMyListing = $this->contentReport((int) $reporter->id, 'listing', $this->listing((int) $broker->id));

        Sanctum::actingAs($broker, ['*']);
        $res = $this->apiGet('/v2/admin/reports?status=open&limit=100');

        self::assertSame(200, $res->getStatusCode(), (string) $res->getContent());
        $ids = array_map(static fn ($r) => (int) $r['id'], $res->json('data') ?? []);
        self::assertNotContains($aboutMe, $ids,
            'a report about the caller must not be in the queue they are shown');
        self::assertNotContains($aboutMyListing, $ids,
            'a report about the caller\'s own content must not be in that queue either');
        self::assertStringNotContainsString((string) $reporter->name, (string) $res->getContent(),
            'the complainant\'s name must not appear in the list body');
    }

    // ------------------------------------------------------------- controls

    /** CONTROL — the same broker still reads a report about two other members. */
    public function test_control_the_same_broker_may_still_read_a_report_about_others(): void
    {
        $broker = $this->staff('broker');
        $reporter = $this->staff('member');
        $subject = $this->staff('member');

        $reportId = $this->userReport((int) $reporter->id, (int) $subject->id);

        Sanctum::actingAs($broker, ['*']);
        $res = $this->apiGet("/v2/admin/reports/{$reportId}");

        self::assertSame(200, $res->getStatusCode(), (string) $res->getContent());
        self::assertSame((int) $reporter->id, (int) $res->json('data.reporter_id'),
            'CONTROL: a broker moderating other members still sees the reporter');
        self::assertSame(self::REASON, (string) $res->json('data.reason'),
            'CONTROL: and the complaint they have to act on');
    }

    /** CONTROL — and the queue still lists them. */
    public function test_control_the_report_queue_still_lists_reports_about_others(): void
    {
        $broker = $this->staff('broker');
        $reporter = $this->staff('member');
        $subject = $this->staff('member');

        $reportId = $this->userReport((int) $reporter->id, (int) $subject->id);

        Sanctum::actingAs($broker, ['*']);
        $res = $this->apiGet('/v2/admin/reports?type=user&status=open&limit=100');

        self::assertSame(200, $res->getStatusCode(), (string) $res->getContent());
        $ids = array_map(static fn ($r) => (int) $r['id'], $res->json('data') ?? []);
        self::assertContains($reportId, $ids,
            'CONTROL: the moderation queue still shows reports about other members');
    }

    /**
     * CONTROL — the guard's administrator-tier exemption is deliberate and is
     * preserved: an administrator is not locked out of their own record.
     */
    public function test_control_an_administrator_is_still_exempt_as_the_guard_intends(): void
    {
        $admin = $this->staff('admin');
        $reporter = $this->staff('member');

        $reportId = $this->userReport((int) $reporter->id, (int) $admin->id);

        Sanctum::actingAs($admin, ['*']);
        $res = $this->apiGet("/v2/admin/reports/{$reportId}");

        self::assertSame(200, $res->getStatusCode(),
            'CONTROL: the tier exemption written into guardBrokerNotParty() is unchanged: ' . $res->getContent());
    }

    /**
     * CONTROL — the platform's own member-facing route on the analogous table
     * withholds precisely these fields from the reported party. This makes the
     * fix consistent with a decision the platform had already taken, rather
     * than a new opinion.
     */
    public function test_control_the_member_facing_report_route_withholds_the_reporter(): void
    {
        // No Schema::hasTable() guard and no skip: `marketplace_reports` is in
        // the committed schema dump, so a missing table is a broken clone, not
        // a condition to tolerate. The pre-commit schema-skip budget refuses
        // such guards, and it is right to.
        $this->enableFeatures(['marketplace' => true]);

        $seller = $this->staff('member');
        $reporter = $this->staff('member');

        $listingId = (int) DB::table('marketplace_listings')->insertGetId([
            'tenant_id' => $this->testTenantId,
            'user_id' => $seller->id,
            'title' => 'F454 marketplace fixture',
            'description' => 'synthetic fixture',
            'price' => 10.00,
            'price_currency' => 'EUR',
            'status' => 'active',
            'created_at' => now(),
            'updated_at' => now(),
        ]);

        $mrId = (int) DB::table('marketplace_reports')->insertGetId([
            'tenant_id' => $this->testTenantId,
            'marketplace_listing_id' => $listingId,
            'reporter_id' => $reporter->id,
            'reason' => 'prohibited',
            'description' => self::REASON,
            'status' => 'pending',
            'created_at' => now(),
            'updated_at' => now(),
        ]);

        Sanctum::actingAs($seller, ['*']);
        $res = $this->apiGet("/v2/marketplace/reports/{$mrId}");

        // Asserted, not skipped. If this route stops answering 200 the control
        // has broken, and a skip here would quietly turn that into a pass —
        // which would leave the comparison this whole test exists to make
        // unmade.
        self::assertSame(200, $res->getStatusCode(),
            'CONTROL PRECONDITION: the member-facing marketplace report route must answer 200; '
            . 'got ' . $res->getStatusCode() . ' ' . $res->getContent());

        $body = $res->json('data');
        self::assertArrayNotHasKey('reporter_id', $body,
            'CONTROL: the member-facing route publishes no reporter id');
        self::assertArrayNotHasKey('reporter_name', $body,
            'CONTROL: the member-facing route publishes no reporter name');
        self::assertNull($body['description'] ?? null,
            'CONTROL: the reported seller is given a null description, not the complaint');
        self::assertStringNotContainsString(self::REASON, (string) $res->getContent(),
            'CONTROL: the complaint text never reaches the reported party here');
    }

    /**
     * RE-TEST of F-218 — the write guard this fix extends still refuses the
     * same row, so this is a residual gap closed, not a rediscovery.
     */
    public function test_retest_f218_the_write_guard_still_refuses_the_same_row(): void
    {
        $broker = $this->staff('broker');
        $reporter = $this->staff('member');
        $reportId = $this->userReport((int) $reporter->id, (int) $broker->id);

        Sanctum::actingAs($broker, ['*']);

        foreach (['resolve', 'dismiss'] as $write) {
            $res = $this->apiPost("/v2/admin/reports/{$reportId}/{$write}", ['notes' => 'x']);
            self::assertSame(403, $res->getStatusCode(),
                "F-218 write guard HELD check failed for {$write}: " . $res->getContent());
        }
    }

    // ----- fixtures -----

    /** Turn tenant feature flags on for this test only (rolled back with the transaction). */
    private function enableFeatures(array $flags): void
    {
        $current = DB::table('tenants')->where('id', $this->testTenantId)->value('features');
        $decoded = is_string($current) ? (json_decode($current, true) ?: []) : (is_array($current) ? $current : []);
        DB::table('tenants')->where('id', $this->testTenantId)
            ->update(['features' => json_encode(array_merge($decoded, $flags))]);
        TenantContext::reset();
        TenantContext::setById($this->testTenantId);
    }

    private function staff(string $role): User
    {
        $u = User::factory()->forTenant($this->testTenantId)->create([
            'status' => 'active',
            'is_approved' => true,
        ]);
        DB::table('users')->where('id', $u->id)->update([
            'role' => $role,
            'is_admin' => $role === 'admin' ? 1 : 0,
        ]);

        return User::find($u->id);
    }

    private function listing(int $ownerId): int
    {
        return (int) DB::table('listings')->insertGetId([
            'tenant_id' => $this->testTenantId,
            'user_id' => $ownerId,
            'title' => 'F454 fixture listing',
            'description' => 'synthetic fixture',
            'type' => 'offer',
            'status' => 'active',
            'created_at' => now(),
            'updated_at' => now(),
        ]);
    }

    private function userReport(int $reporterId, int $subjectId): int
    {
        return $this->contentReport($reporterId, 'user', $subjectId);
    }

    private function contentReport(int $reporterId, string $targetType, int $targetId): int
    {
        return (int) DB::table('reports')->insertGetId([
            'tenant_id' => $this->testTenantId,
            'reporter_id' => $reporterId,
            'target_type' => $targetType,
            'target_id' => $targetId,
            'reason' => self::REASON,
            'status' => 'open',
            'created_at' => now(),
            'updated_at' => now(),
        ]);
    }
}
