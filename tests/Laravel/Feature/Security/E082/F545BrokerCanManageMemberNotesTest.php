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
 * F-545 (E-082) — the broker panel's Members page lets a broker edit, pin and
 * delete member notes, but PUT/DELETE /v2/admin/crm/notes/{id} were admin-only,
 * so every one of those buttons was refused. Owner decision, 2 Oct 2026:
 * brokers have the whole broker panel.
 *
 * F-252/F-457/F-462/F-544 must keep holding for the brokers let in: a concern
 * note about the broker, or about anyone they do not strictly outrank, can be
 * neither edited nor deleted.
 *
 */
final class F545BrokerCanManageMemberNotesTest extends TestCase
{
    use DatabaseTransactions;

    private const CONCERN = 'F545-CRM-CONCERN-note-text';

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

    public function test_a_broker_can_edit_and_pin_a_note_about_a_member(): void
    {
        $broker = $this->staff('broker');
        $noteId = $this->note((int) $this->member()->id, (int) $broker->id, 'general');

        $this->actAs($broker);
        $this->apiPut('/v2/admin/crm/notes/' . $noteId, ['content' => 'called back, all fine', 'is_pinned' => 1])
            ->assertStatus(200);

        $row = DB::table('member_notes')->where('id', $noteId)->first();
        self::assertSame('called back, all fine', $row->content);
        self::assertSame(1, (int) $row->is_pinned);
    }

    public function test_a_broker_can_delete_a_note_about_a_member(): void
    {
        $broker = $this->staff('broker');
        $noteId = $this->note((int) $this->member()->id, (int) $broker->id, 'general');

        $this->actAs($broker);
        $this->apiDelete('/v2/admin/crm/notes/' . $noteId)->assertStatus(200);

        self::assertSame(0, (int) DB::table('member_notes')->where('id', $noteId)->count());
    }

    public function test_a_coordinator_can_edit_a_note_about_a_member(): void
    {
        $coordinator = $this->staff('coordinator');
        $noteId = $this->note((int) $this->member()->id, (int) $coordinator->id, 'support');

        $this->actAs($coordinator);
        $this->apiPut('/v2/admin/crm/notes/' . $noteId, ['content' => 'updated'])->assertStatus(200);
    }

    public function test_a_broker_cannot_rewrite_or_delete_a_concern_note_about_themselves(): void
    {
        $broker = $this->staff('broker');
        $noteId = $this->note((int) $broker->id, (int) $this->staff('admin')->id, 'concern');

        $this->actAs($broker);
        $this->apiPut('/v2/admin/crm/notes/' . $noteId, ['content' => 'resolved'])->assertStatus(404);
        $this->apiDelete('/v2/admin/crm/notes/' . $noteId)->assertStatus(404);

        self::assertSame(self::CONCERN, DB::table('member_notes')->where('id', $noteId)->value('content'));
    }

    public function test_a_broker_cannot_rewrite_or_delete_a_concern_note_about_a_fellow_broker(): void
    {
        $peer = $this->staff('broker');
        $noteId = $this->note((int) $peer->id, (int) $this->staff('admin')->id, 'concern');

        $this->actAs($this->staff('broker'));
        $this->apiPut('/v2/admin/crm/notes/' . $noteId, ['category' => 'general'])->assertStatus(404);
        $this->apiDelete('/v2/admin/crm/notes/' . $noteId)->assertStatus(404);

        self::assertSame('concern', DB::table('member_notes')->where('id', $noteId)->value('category'));
    }

    public function test_control_a_plain_member_is_still_refused(): void
    {
        $noteId = $this->note((int) $this->member()->id, (int) $this->staff('admin')->id, 'general');

        $this->actAs($this->member());
        $this->apiPut('/v2/admin/crm/notes/' . $noteId, ['content' => 'x'])->assertStatus(403);
        $this->apiDelete('/v2/admin/crm/notes/' . $noteId)->assertStatus(403);
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
