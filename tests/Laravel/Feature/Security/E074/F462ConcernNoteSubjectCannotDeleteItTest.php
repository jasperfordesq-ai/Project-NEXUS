<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

declare(strict_types=1);

namespace Tests\Laravel\Feature\Security\E074;

use App\Core\TenantContext;
use App\Models\User;
use Illuminate\Foundation\Testing\DatabaseTransactions;
use Illuminate\Support\Facades\Cache;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Queue;
use Laravel\Sanctum\Sanctum;
use Tests\Laravel\TestCase;

/**
 * F-462 (E-074, found while fixing F-457) — an administrator could DELETE the
 * concern note recorded about themselves.
 *
 * `AdminCrmController::deleteNote()` had no self-check at all, while
 * `listNotes()`, `timeline()`, `exportNotes()` and `updateNote()` all exclude
 * such a note under F-457's fix. The combined effect was worse than the gap
 * F-457 closed: the subject could no longer READ the concern recorded about
 * them, and could still DESTROY it. It discloses nothing — the response is
 * `{"deleted": true}` — which is why the agent fixing F-457 correctly left it
 * alone under the minimal-fix rule.
 *
 * The guard already existed in the same file: F-457's own
 * `concernSubjectsHiddenFromCaller()`, which always includes the caller and
 * everyone the caller does not strictly outrank. The refusal is the same 404
 * the read side already produces for a note the caller cannot see, so nothing
 * new is disclosed by the refusal itself.
 *
 * These tests assert the CORRECT behaviour: the note survives, and the people
 * who are supposed to be able to delete notes still can.
 */
final class F462ConcernNoteSubjectCannotDeleteItTest extends TestCase
{
    use DatabaseTransactions;

    private const CONCERN = 'F462-CRM-CONCERN-complaints-about-this-administrators-conduct-under-review';

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
     * THE HARM — a community administrator must not be able to destroy the
     * concern note a platform super-admin wrote about them. The stored row is
     * the evidence.
     */
    public function test_the_subject_administrator_cannot_delete_the_concern_note_about_them(): void
    {
        $subjectAdmin = $this->staff('admin');
        $superAdmin = $this->platformSuperAdmin();
        $noteId = $this->concernNote((int) $subjectAdmin->id, (int) $superAdmin->id);

        $this->actAs($subjectAdmin);
        $res = $this->apiDelete('/v2/admin/crm/notes/' . $noteId);

        self::assertSame(
            404,
            $res->getStatusCode(),
            'the subject is refused, with the same answer the read side gives. ' . $res->getContent()
        );
        self::assertSame(
            1,
            (int) DB::table('member_notes')->where('id', $noteId)->count(),
            'and the concern note really survives'
        );
    }

    /**
     * THE HARM, SECOND SHAPE — a peer administrator the caller does not
     * strictly outrank is covered by the same guard, exactly as F-457's read
     * exclusion covers them.
     */
    public function test_an_administrator_cannot_delete_a_concern_note_about_a_peer_administrator(): void
    {
        $peerAdmin = $this->staff('admin');
        $callerAdmin = $this->staff('admin');
        $superAdmin = $this->platformSuperAdmin();
        $noteId = $this->concernNote((int) $peerAdmin->id, (int) $superAdmin->id);

        $this->actAs($callerAdmin);
        $res = $this->apiDelete('/v2/admin/crm/notes/' . $noteId);

        self::assertSame(404, $res->getStatusCode(), $res->getContent());
        self::assertSame(
            1,
            (int) DB::table('member_notes')->where('id', $noteId)->count(),
            'the concern note about a peer administrator survives'
        );
    }

    /**
     * LEGITIMATE-ACCESS CONTROL — the person who is allowed to delete the note
     * still can. A platform super-admin strictly outranks a community
     * administrator, so the concern note about one is theirs to remove. This
     * differs from the harm case only in who is calling.
     */
    public function test_control_a_platform_super_admin_can_delete_the_same_concern_note(): void
    {
        $subjectAdmin = $this->staff('admin');
        $superAdmin = $this->platformSuperAdmin();
        $noteId = $this->concernNote((int) $subjectAdmin->id, (int) $superAdmin->id);

        $this->actAs($superAdmin);
        $res = $this->apiDelete('/v2/admin/crm/notes/' . $noteId);

        self::assertSame(200, $res->getStatusCode(), 'control: the rightful operator deletes it. ' . $res->getContent());
        self::assertSame(
            0,
            (int) DB::table('member_notes')->where('id', $noteId)->count(),
            'control: and the note really goes'
        );
    }

    /**
     * LEGITIMATE-ACCESS CONTROL — an ordinary concern note about a MEMBER is
     * still deletable by a community administrator. The fix must not turn the
     * delete route off.
     */
    public function test_control_an_administrator_can_delete_a_concern_note_about_a_member(): void
    {
        $member = $this->member();
        $callerAdmin = $this->staff('admin');
        $noteId = $this->concernNote((int) $member->id, (int) $callerAdmin->id);

        $this->actAs($callerAdmin);
        $res = $this->apiDelete('/v2/admin/crm/notes/' . $noteId);

        self::assertSame(200, $res->getStatusCode(), 'control: an ordinary concern note is deletable. ' . $res->getContent());
        self::assertSame(
            0,
            (int) DB::table('member_notes')->where('id', $noteId)->count(),
            'control: and the note really goes'
        );
    }

    /**
     * LEGITIMATE-ACCESS CONTROL — a note in any other category about the caller
     * themselves is untouched by this guard, which is confined to `concern`.
     */
    public function test_control_a_non_concern_note_about_the_caller_is_still_deletable(): void
    {
        $callerAdmin = $this->staff('admin');
        $superAdmin = $this->platformSuperAdmin();
        $noteId = $this->note((int) $callerAdmin->id, (int) $superAdmin->id, 'general');

        $this->actAs($callerAdmin);
        $res = $this->apiDelete('/v2/admin/crm/notes/' . $noteId);

        self::assertSame(200, $res->getStatusCode(), 'control: a general note is unaffected. ' . $res->getContent());
        self::assertSame(
            0,
            (int) DB::table('member_notes')->where('id', $noteId)->count(),
            'control: and it really goes'
        );
    }

    // ── fixtures ────────────────────────────────────────────────────────────

    private function actAs(User $user): void
    {
        $this->app['auth']->forgetGuards();
        Sanctum::actingAs(User::withoutGlobalScopes()->find($user->id), ['*']);
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

    private function member(): User
    {
        $u = User::factory()->forTenant($this->testTenantId)->create([
            'status' => 'active',
            'is_approved' => true,
        ]);
        DB::table('users')->where('id', $u->id)->update([
            'role' => 'member',
            'is_admin' => 0,
            'is_super_admin' => 0,
            'is_tenant_super_admin' => 0,
            'is_god' => 0,
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
        return $this->note($subjectId, $authorId, 'concern');
    }

    private function note(int $subjectId, int $authorId, string $category): int
    {
        return (int) DB::table('member_notes')->insertGetId([
            'tenant_id' => $this->testTenantId,
            'user_id' => $subjectId,
            'author_id' => $authorId,
            'content' => self::CONCERN,
            'category' => $category,
            'is_pinned' => 0,
            'created_at' => now(),
            'updated_at' => now(),
        ]);
    }
}
