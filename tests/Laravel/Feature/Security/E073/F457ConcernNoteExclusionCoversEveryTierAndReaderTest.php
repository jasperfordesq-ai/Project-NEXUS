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
 * F-457 (E-073, residual gap in F-252) — the self-exclusion on CRM `concern`
 * notes stopped one tier below the top, and reached one of four readers.
 *
 * `AdminCrmController::concernSubjectsHiddenFromCaller()` opened with
 * `if ($this->callerIsAdminTier()) { return []; }`, short-circuiting before the
 * rank comparison below it, so a community administrator was served the full
 * text of a concern note written about them by a platform super-admin, and the
 * author's name with it. `AdminTier::outranks()` requires a strictly higher
 * rank, so the existing predicate already answers this correctly once it is
 * reached: outranks(admin, admin) is false, outranks(super_admin, admin) is
 * true, outranks(admin, member) is true.
 *
 * Three further routes read the same `member_notes` rows, so a fix confined to
 * `listNotes()` would have closed nothing: `timeline()` publishes the first 80
 * characters plus the author and is filterable by `user_id`; `exportNotes()`
 * streams the full text as CSV; and `updateNote()` re-serialises the note on
 * success. All four now apply the same exclusion.
 *
 * F-252 itself is re-tested here at the tier it was written for.
 *
 * Adapted from `.local-docs-archive/security-log/E-073/repro/h/H3ConcernNoteExclusionStopsAtAdminTierTest.php`,
 * which asserted the harm; the attack assertions are inverted.
 */
final class F457ConcernNoteExclusionCoversEveryTierAndReaderTest extends TestCase
{
    use DatabaseTransactions;

    /** The note a subject must not read about themselves. */
    private const CONCERN = 'F457-CRM-CONCERN-complaints-about-this-administrators-conduct-under-review';

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

    /**
     * HARM — a community administrator must not be served the concern note a
     * platform super-admin wrote about them.
     */
    public function test_the_subject_administrator_does_not_receive_the_concern_note_about_them(): void
    {
        $subjectAdmin = $this->staff('admin');
        $superAdmin = $this->platformSuperAdmin();
        $noteId = $this->concernNote((int) $subjectAdmin->id, (int) $superAdmin->id);

        Sanctum::actingAs($subjectAdmin, ['*']);
        $res = $this->apiGet('/v2/admin/crm/notes?category=concern&limit=100');

        self::assertSame(200, $res->getStatusCode(), (string) $res->getContent());

        $ids = array_map(static fn ($r) => (int) $r['id'], $res->json('data') ?? []);
        self::assertNotContains($noteId, $ids,
            'the concern note about the caller must not be served to the caller');
        self::assertStringNotContainsString(self::CONCERN, (string) $res->getContent(),
            'and its text must not appear anywhere in the body');
    }

    /**
     * HARM 2 — the CRM timeline reads the same rows and had no exclusion at
     * all, so a fix to listNotes() alone would have left it reachable.
     */
    public function test_the_crm_timeline_no_longer_publishes_the_note_to_its_subject(): void
    {
        $subjectAdmin = $this->staff('admin');
        $superAdmin = $this->platformSuperAdmin();
        $this->concernNote((int) $subjectAdmin->id, (int) $superAdmin->id);

        Sanctum::actingAs($subjectAdmin, ['*']);
        $res = $this->apiGet(
            '/v2/admin/crm/timeline?type=note_added&user_id=' . $subjectAdmin->id . '&days=0&limit=100'
        );
        self::assertSame(200, $res->getStatusCode(), (string) $res->getContent());

        // The timeline publishes LEFT(content, 80); assert on that prefix.
        $prefix = substr(self::CONCERN, 0, 80);
        self::assertStringNotContainsString($prefix, (string) $res->getContent(),
            'the timeline must not hand the subject the first 80 characters of the concern');
        self::assertStringNotContainsString((string) $superAdmin->name, (string) $res->getContent(),
            'nor name its author');
    }

    /**
     * HARM 3 — the CSV export streams the FULL note content and had no
     * exclusion at all.
     */
    public function test_the_csv_export_no_longer_hands_the_subject_the_full_note(): void
    {
        $subjectAdmin = $this->staff('admin');
        $superAdmin = $this->platformSuperAdmin();
        $this->concernNote((int) $subjectAdmin->id, (int) $superAdmin->id);

        Sanctum::actingAs($subjectAdmin, ['*']);
        $res = $this->apiGet('/v2/admin/crm/export/notes');
        self::assertSame(200, $res->getStatusCode(), (string) $res->getStatusCode());

        $csv = $res->streamedContent();
        self::assertStringNotContainsString(self::CONCERN, $csv,
            'the export must not hand the subject the full text of the concern about them');
        self::assertStringNotContainsString((string) $superAdmin->name, $csv,
            'nor the name of the operator who wrote it');
    }

    /**
     * HARM 4 — the write path re-serialises the note on success, so editing an
     * unrelated field (here: pinning it) returned the text and the author.
     */
    public function test_the_update_route_does_not_return_the_hidden_notes_text(): void
    {
        $subjectAdmin = $this->staff('admin');
        $superAdmin = $this->platformSuperAdmin();
        $noteId = $this->concernNote((int) $subjectAdmin->id, (int) $superAdmin->id);

        Sanctum::actingAs($subjectAdmin, ['*']);
        $res = $this->apiPut('/v2/admin/crm/notes/' . $noteId, ['is_pinned' => 1]);

        self::assertSame(200, $res->getStatusCode(), (string) $res->getContent());
        self::assertStringNotContainsString(self::CONCERN, (string) $res->getContent(),
            'the update response must not carry the text of a note the caller may not read');
        self::assertStringNotContainsString((string) $superAdmin->name, (string) $res->getContent(),
            'nor the name of its author');
    }

    /**
     * CONTROL A — F-252 itself still HOLDS at the tier it was written for: a
     * broker is refused the identical note on the identical route.
     */
    public function test_control_f252_still_hides_the_same_note_from_a_broker(): void
    {
        $subjectBroker = $this->staff('broker');
        $superAdmin = $this->platformSuperAdmin();
        $noteId = $this->concernNote((int) $subjectBroker->id, (int) $superAdmin->id);

        Sanctum::actingAs($subjectBroker, ['*']);
        $res = $this->apiGet('/v2/admin/crm/notes?category=concern&limit=100');
        self::assertSame(200, $res->getStatusCode(), (string) $res->getContent());

        $ids = array_map(static fn ($r) => (int) $r['id'], $res->json('data') ?? []);
        self::assertNotContains($noteId, $ids,
            'CONTROL: F-252 HELD — a broker does not receive the concern note about themselves');
        self::assertStringNotContainsString(self::CONCERN, (string) $res->getContent(),
            'CONTROL: F-252 HELD — the text does not reach the broker subject either');
    }

    /**
     * CONTROL B — legitimate CRM work is unaffected on every reader: the same
     * administrator still reads a concern note about an ordinary member in the
     * list, the timeline and the export, so the guarded case differs only in
     * whose note it is.
     */
    public function test_control_the_same_administrator_still_reads_a_note_about_a_member(): void
    {
        $admin = $this->staff('admin');
        $member = $this->staff('member');
        $superAdmin = $this->platformSuperAdmin();
        $noteId = $this->concernNote((int) $member->id, (int) $superAdmin->id);

        Sanctum::actingAs($admin, ['*']);

        $list = $this->apiGet('/v2/admin/crm/notes?category=concern&limit=100');
        self::assertSame(200, $list->getStatusCode(), (string) $list->getContent());
        $ids = array_map(static fn ($r) => (int) $r['id'], $list->json('data') ?? []);
        self::assertContains($noteId, $ids,
            'CONTROL: an administrator reading a concern about a member is unaffected');

        $timeline = $this->apiGet(
            '/v2/admin/crm/timeline?type=note_added&user_id=' . $member->id . '&days=0&limit=100'
        );
        self::assertSame(200, $timeline->getStatusCode(), (string) $timeline->getContent());
        self::assertStringContainsString(substr(self::CONCERN, 0, 80), (string) $timeline->getContent(),
            'CONTROL: the timeline still shows a concern about a member');

        $export = $this->apiGet('/v2/admin/crm/export/notes');
        self::assertSame(200, $export->getStatusCode());
        self::assertStringContainsString(self::CONCERN, $export->streamedContent(),
            'CONTROL: the export still carries a concern about a member');
    }

    /**
     * CONTROL C — the senior tier is unaffected: a platform super-admin still
     * reads the concern note they wrote about a community administrator, on
     * every one of the same readers.
     */
    public function test_control_a_platform_super_admin_still_reads_the_note_about_an_administrator(): void
    {
        $subjectAdmin = $this->staff('admin');
        $superAdmin = $this->platformSuperAdmin();
        $noteId = $this->concernNote((int) $subjectAdmin->id, (int) $superAdmin->id);

        Sanctum::actingAs($superAdmin, ['*']);

        $list = $this->apiGet('/v2/admin/crm/notes?category=concern&limit=100');
        self::assertSame(200, $list->getStatusCode(), (string) $list->getContent());
        $ids = array_map(static fn ($r) => (int) $r['id'], $list->json('data') ?? []);
        self::assertContains($noteId, $ids,
            'CONTROL: a platform super-admin still reads a concern about an administrator');

        $export = $this->apiGet('/v2/admin/crm/export/notes');
        self::assertSame(200, $export->getStatusCode());
        self::assertStringContainsString(self::CONCERN, $export->streamedContent(),
            'CONTROL: and the export is unaffected for them');
    }

    // ----- fixtures -----

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

    /** rank 3 in AdminTier::securityRank() — strictly above a community admin. */
    private function platformSuperAdmin(): User
    {
        $u = User::factory()->forTenant($this->testTenantId)->create([
            'status' => 'active',
            'is_approved' => true,
        ]);
        DB::table('users')->where('id', $u->id)->update([
            'role' => 'super_admin',
            'is_admin' => 1,
            'is_super_admin' => 1,
        ]);

        return User::find($u->id);
    }

    private function concernNote(int $subjectId, int $authorId): int
    {
        return (int) DB::table('member_notes')->insertGetId([
            'tenant_id' => $this->testTenantId,
            'user_id' => $subjectId,
            'author_id' => $authorId,
            'content' => self::CONCERN,
            'category' => 'concern',
            'is_pinned' => 0,
            'created_at' => now(),
            'updated_at' => now(),
        ]);
    }
}
