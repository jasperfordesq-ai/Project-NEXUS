<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

declare(strict_types=1);

namespace Tests\Laravel\Feature\Security\E082;

use App\Core\TenantContext;
use App\Models\User;
use Illuminate\Foundation\Testing\DatabaseTransactions;
use Illuminate\Support\Facades\Cache;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Queue;
use Laravel\Sanctum\Sanctum;
use Tests\Laravel\TestCase;

/**
 * F-544 (E-082, found while opening note editing to brokers) — the subject of
 * a concern note could REWRITE it.
 *
 * F-457 stopped `updateNote()` from returning the text of a concern note the
 * caller may not read, and F-462 stopped the subject deleting it. Neither
 * stopped the subject (or anyone they do not strictly outrank) overwriting
 * its content or re-filing it under another category, which removes it from
 * the concern view just as surely as deleting it. The guard is the same
 * `concernSubjectsHiddenFromCaller()`, and the refusal is the same 404.
 */
final class F544ConcernNoteSubjectCannotEditItTest extends TestCase
{
    use DatabaseTransactions;

    private const CONCERN = 'F544-CRM-CONCERN-complaints-about-this-administrators-conduct-under-review';

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

    public function test_the_subject_administrator_cannot_rewrite_the_concern_note_about_them(): void
    {
        $subject = $this->staff('admin');
        $noteId = $this->concernNote((int) $subject->id, (int) $this->platformSuperAdmin()->id);

        $this->actAs($subject);
        $res = $this->apiPut('/v2/admin/crm/notes/' . $noteId, ['content' => 'nothing to see here']);

        self::assertSame(404, $res->getStatusCode(), $res->getContent());
        self::assertSame(self::CONCERN, DB::table('member_notes')->where('id', $noteId)->value('content'));
    }

    public function test_the_subject_cannot_refile_the_concern_note_under_another_category(): void
    {
        $subject = $this->staff('admin');
        $noteId = $this->concernNote((int) $subject->id, (int) $this->platformSuperAdmin()->id);

        $this->actAs($subject);
        $this->apiPut('/v2/admin/crm/notes/' . $noteId, ['category' => 'general'])->assertStatus(404);

        self::assertSame('concern', DB::table('member_notes')->where('id', $noteId)->value('category'));
    }

    public function test_control_a_platform_super_admin_can_edit_the_same_note(): void
    {
        $subject = $this->staff('admin');
        $super = $this->platformSuperAdmin();
        $noteId = $this->concernNote((int) $subject->id, (int) $super->id);

        $this->actAs($super);
        $this->apiPut('/v2/admin/crm/notes/' . $noteId, ['content' => 'updated by the reviewer'])->assertStatus(200);

        self::assertSame('updated by the reviewer', DB::table('member_notes')->where('id', $noteId)->value('content'));
    }

    public function test_control_an_administrator_can_edit_a_concern_note_about_a_member(): void
    {
        $admin = $this->staff('admin');
        $noteId = $this->concernNote((int) $this->member()->id, (int) $admin->id);

        $this->actAs($admin);
        $this->apiPut('/v2/admin/crm/notes/' . $noteId, ['is_pinned' => 1])->assertStatus(200);

        self::assertSame(1, (int) DB::table('member_notes')->where('id', $noteId)->value('is_pinned'));
    }

    // ── fixtures ────────────────────────────────────────────────────────────

    private function actAs(User $user): void
    {
        $this->app['auth']->forgetGuards();
        Sanctum::actingAs(User::withoutGlobalScopes()->find($user->id), ['*']);
    }

    private function staff(string $role): User
    {
        $u = User::factory()->forTenant($this->testTenantId)->create(['status' => 'active', 'is_approved' => true]);
        DB::table('users')->where('id', $u->id)->update([
            'role' => $role,
            'is_admin' => $role === 'admin' ? 1 : 0,
        ]);

        return User::find($u->id);
    }

    private function member(): User
    {
        return $this->staff('member');
    }

    /** rank 3 in AdminTier::securityRank() — strictly above a community admin. */
    private function platformSuperAdmin(): User
    {
        $u = User::factory()->forTenant($this->testTenantId)->create(['status' => 'active', 'is_approved' => true]);
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
