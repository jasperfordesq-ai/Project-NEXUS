<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

declare(strict_types=1);

namespace Tests\Laravel\Feature\MemberImport;

use App\Http\Middleware\RequireRecentSecondFactor;
use App\Models\User;
use App\Services\TokenService;
use App\Services\TwoFactorPolicy;
use Illuminate\Foundation\Testing\DatabaseTransactions;
use Illuminate\Support\Facades\Cache;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Queue;
use Illuminate\Testing\TestResponse;
use Tests\Laravel\TestCase;

/**
 * "Send invitation" (selected members) and "Invite everyone who has never
 * signed in" on the admin member list. Both only queue rows in the invitation
 * outbox; the scheduled sender emails them. Admin only — not brokers.
 */
final class AdminMemberInvitationEndpointsTest extends TestCase
{
    use DatabaseTransactions;

    private const SELECTED = '/v2/admin/members/invitations';
    private const COUNT = '/v2/admin/members/invitations/never-signed-in-count';
    private const EVERYONE = '/v2/admin/members/invitations/never-signed-in';

    private User $admin;

    protected function setUp(): void
    {
        parent::setUp();
        Cache::flush();
        Queue::fake();
        // Only this test's members may count as "never signed in": the shared
        // test database already holds members of this community.
        DB::table('users')->where('tenant_id', $this->testTenantId)->whereNull('last_login_at')->update(['last_login_at' => now()]);
        $this->admin = User::factory()->forTenant($this->testTenantId)->admin()->create(['status' => 'active', 'is_approved' => true]);
    }

    // ------------------------------------------------------------ fixtures

    /** @return array<string, string> */
    private function headers(?User $as = null, bool $freshSecondFactor = true): array
    {
        $as ??= $this->admin;
        $claims = $freshSecondFactor
            ? TwoFactorPolicy::claims('totp')
            : ['mfa_method' => 'totp', 'mfa_verified_at' => time() - 3600];

        return ['Authorization' => 'Bearer ' . app(TokenService::class)->generateToken($as->id, $as->tenant_id, $claims)];
    }

    /** @param array<string, mixed> $extra */
    private function member(array $extra = [], ?int $tenantId = null): User
    {
        return User::factory()->forTenant($tenantId ?? $this->testTenantId)->create(array_merge([
            'email' => 'invite-' . bin2hex(random_bytes(6)) . '@outbox-mail.example.org',
            'role' => 'member', 'status' => 'active', 'is_approved' => 1, 'last_login_at' => null,
        ], $extra));
    }

    /** @param list<int|string> $ids */
    private function sendSelected(array $ids, ?User $as = null): TestResponse
    {
        return $this->apiPost(self::SELECTED, ['user_ids' => $ids], $this->headers($as));
    }

    private function inviteEveryone(mixed $confirmCount, ?User $as = null): TestResponse
    {
        return $this->apiPost(self::EVERYONE, ['confirm_count' => $confirmCount], $this->headers($as));
    }

    private function outboxRows(int $userId, ?int $tenantId = null): int
    {
        return DB::table('member_invitation_outbox')
            ->where('tenant_id', $tenantId ?? $this->testTenantId)->where('user_id', $userId)->count();
    }

    // ------------------------------------------------------------ who may

    public function test_a_member_and_a_broker_are_refused_every_endpoint(): void
    {
        $member = $this->member();
        $plain = User::factory()->forTenant($this->testTenantId)->create(['role' => 'member', 'status' => 'active', 'last_login_at' => now()]);
        $broker = User::factory()->forTenant($this->testTenantId)->create(['role' => 'broker', 'status' => 'active', 'last_login_at' => now()]);

        foreach ([$plain, $broker] as $who) {
            $this->sendSelected([$member->id], $who)->assertStatus(403);
            $this->apiGet(self::COUNT, $this->headers($who))->assertStatus(403);
            $this->inviteEveryone(1, $who)->assertStatus(403);
        }
        $this->assertSame(0, $this->outboxRows($member->id));
    }

    public function test_an_anonymous_request_is_refused(): void
    {
        $this->apiPost(self::SELECTED, ['user_ids' => [1]])->assertStatus(401);
        $this->apiGet(self::COUNT)->assertStatus(401);
    }

    // ------------------------------------------------------------ selected members

    public function test_selected_members_are_queued_and_the_rest_reported_by_reason(): void
    {
        $a = $this->member();
        $b = $this->member();
        $signedIn = $this->member(['last_login_at' => now()->subDay()]);
        $staff = User::factory()->forTenant($this->testTenantId)->admin()->create(['last_login_at' => null]);
        $broker = $this->member(['role' => 'broker']);
        $suspended = $this->member(['status' => 'suspended']);
        $undeliverable = $this->member(['email' => 'nobody-' . bin2hex(random_bytes(4)) . '@reserved.test']);

        $r = $this->sendSelected([$a->id, $b->id, $signedIn->id, $staff->id, $broker->id, $suspended->id, $undeliverable->id, 999999999])
            ->assertOk();

        $this->assertSame(2, $r->json('data.queued'));
        $this->assertSame(1, $r->json('data.skipped.signed_in'));
        $this->assertSame(2, $r->json('data.skipped.not_member'), 'staff accounts are never bulk-invited');
        $this->assertSame(1, $r->json('data.skipped.not_active'));
        $this->assertSame(1, $r->json('data.skipped.undeliverable'));
        $this->assertSame(1, $r->json('data.skipped.not_found'));
        $this->assertSame(0, $r->json('data.skipped.already_queued'));
        $this->assertGreaterThanOrEqual(1, $r->json('data.eta_minutes'));

        $row = DB::table('member_invitation_outbox')->where('tenant_id', $this->testTenantId)->where('user_id', $a->id)->first();
        $this->assertNotNull($row);
        $this->assertSame('admin_bulk', $row->source);
        $this->assertSame((int) $this->admin->id, (int) $row->requested_by);
        $this->assertSame('pending', $row->status);
        foreach ([$signedIn, $staff, $broker, $suspended, $undeliverable] as $skipped) {
            $this->assertSame(0, $this->outboxRows($skipped->id));
        }
    }

    public function test_a_second_identical_request_queues_nothing_new(): void
    {
        $a = $this->member();
        $b = $this->member();

        $this->assertSame(2, $this->sendSelected([$a->id, $b->id])->assertOk()->json('data.queued'));
        $again = $this->sendSelected([$a->id, $b->id])->assertOk();

        $this->assertSame(0, $again->json('data.queued'));
        $this->assertSame(2, $again->json('data.skipped.already_queued'));
        $this->assertSame(0, $again->json('data.eta_minutes'));
        $this->assertSame(1, $this->outboxRows($a->id));
        $this->assertSame(1, $this->outboxRows($b->id));
    }

    public function test_a_member_of_another_community_is_not_found_and_not_queued(): void
    {
        $elsewhere = $this->member([], 1);

        $r = $this->sendSelected([$elsewhere->id])->assertOk();

        $this->assertSame(0, $r->json('data.queued'));
        $this->assertSame(1, $r->json('data.skipped.not_found'));
        $this->assertSame(0, DB::table('member_invitation_outbox')->where('user_id', $elsewhere->id)->count());
    }

    public function test_the_id_list_follows_the_bulk_action_rules(): void
    {
        $this->sendSelected([])->assertStatus(422);
        $this->apiPost(self::SELECTED, ['user_ids' => 'all'], $this->headers())->assertStatus(422);
        $this->sendSelected([0, -3, 'x'])->assertStatus(422);
        $this->sendSelected(range(1_000_000, 1_000_100))->assertStatus(422)
            ->assertJsonPath('errors.0.field', 'user_ids');

        // Duplicates collapse to one; exactly 100 distinct ids is allowed.
        $a = $this->member();
        $r = $this->sendSelected([$a->id, (string) $a->id, $a->id])->assertOk();
        $this->assertSame(1, $r->json('data.queued'));
        $this->sendSelected(range(2_000_000, 2_000_099))->assertOk();
    }

    public function test_selected_request_is_logged_and_audited_with_counts(): void
    {
        $a = $this->member();
        $signedIn = $this->member(['last_login_at' => now()]);

        $this->sendSelected([$a->id, $signedIn->id])->assertOk();

        $audit = DB::table('org_audit_log')->where('tenant_id', $this->testTenantId)
            ->where('action', 'member_invitations_queued')->where('user_id', $this->admin->id)->latest('id')->first();
        $this->assertNotNull($audit);
        $details = json_decode((string) $audit->details, true);
        $this->assertSame('selected', $details['source']);
        $this->assertSame(1, $details['queued']);
        $this->assertSame(['signed_in' => 1], $details['skipped']);

        $log = DB::table('activity_log')->where('tenant_id', $this->testTenantId)->where('user_id', $this->admin->id)
            ->where('action', 'admin_member_invitations_queued')->latest('id')->first();
        $this->assertNotNull($log);
        $this->assertStringContainsString('1', (string) $log->details);
        $this->assertStringNotContainsString('@', (string) $log->details, 'no addresses in the activity log');
    }

    public function test_selected_members_are_limited_to_ten_requests_a_minute_per_admin(): void
    {
        for ($i = 0; $i < 10; $i++) {
            $this->sendSelected([999999999])->assertOk();
        }
        $this->sendSelected([999999999])->assertStatus(429);

        // Another administrator has their own allowance.
        $other = User::factory()->forTenant($this->testTenantId)->admin()->create(['status' => 'active']);
        $this->sendSelected([999999999], $other)->assertOk();
    }

    // ------------------------------------------------------------ everyone who never signed in

    public function test_the_count_is_who_would_be_queued_now_and_what_is_pending(): void
    {
        $this->member();
        $this->member();
        $queued = $this->member();
        $this->member(['last_login_at' => now()]);
        $this->member(['status' => 'pending', 'is_approved' => 0]);
        User::factory()->forTenant($this->testTenantId)->admin()->create(['last_login_at' => null]);
        $this->member([], 1); // another community

        $this->sendSelected([$queued->id])->assertOk();

        $r = $this->apiGet(self::COUNT, $this->headers())->assertOk();
        $this->assertSame(2, $r->json('data.eligible'));
        $this->assertSame(1, $r->json('data.pending'));
        $this->assertGreaterThanOrEqual(1, $r->json('data.eta_minutes'));
    }

    public function test_invite_everyone_queues_every_eligible_never_signed_in_member_once(): void
    {
        $a = $this->member();
        $b = $this->member();
        $signedIn = $this->member(['last_login_at' => now()]);
        $staff = User::factory()->forTenant($this->testTenantId)->admin()->create(['last_login_at' => null]);
        $elsewhere = $this->member([], 1);

        $eligible = $this->apiGet(self::COUNT, $this->headers())->assertOk()->json('data.eligible');
        $this->assertSame(2, $eligible);

        $r = $this->inviteEveryone($eligible)->assertOk();
        $this->assertSame(2, $r->json('data.queued'));
        $this->assertGreaterThanOrEqual(1, $r->json('data.eta_minutes'));
        $this->assertSame(1, $this->outboxRows($a->id));
        $this->assertSame(1, $this->outboxRows($b->id));
        $this->assertSame(0, $this->outboxRows($signedIn->id));
        $this->assertSame(0, $this->outboxRows($staff->id));
        $this->assertSame(0, DB::table('member_invitation_outbox')->where('user_id', $elsewhere->id)->count());

        // Nobody is left to invite; a repeat with the new count queues nothing.
        $this->assertSame(0, $this->apiGet(self::COUNT, $this->headers())->json('data.eligible'));
        $again = $this->inviteEveryone(0)->assertOk();
        $this->assertSame(0, $again->json('data.queued'));
        $this->assertSame(1, $this->outboxRows($a->id));

        $audit = DB::table('org_audit_log')->where('tenant_id', $this->testTenantId)
            ->where('action', 'member_invitations_queued')->where('user_id', $this->admin->id)->orderBy('id')->first();
        $this->assertNotNull($audit);
        $details = json_decode((string) $audit->details, true);
        $this->assertSame('never_signed_in', $details['source']);
        $this->assertSame(2, $details['queued']);
    }

    public function test_invite_everyone_refuses_a_count_that_has_changed(): void
    {
        $a = $this->member();
        $this->assertSame(1, $this->apiGet(self::COUNT, $this->headers())->json('data.eligible'));
        $b = $this->member(); // someone joined after the admin saw the number

        $this->inviteEveryone(1)->assertStatus(409)->assertJsonPath('errors.0.code', 'COUNT_CHANGED');
        $this->assertSame(0, $this->outboxRows($a->id));
        $this->assertSame(0, $this->outboxRows($b->id));

        $this->assertSame(2, $this->inviteEveryone(2)->assertOk()->json('data.queued'));
    }

    public function test_invite_everyone_asks_for_a_recent_second_factor(): void
    {
        $a = $this->member();
        $stale = $this->headers(null, false);

        // Counting and inviting up to 100 selected members do not ask (like bulk approve).
        $this->assertSame(1, $this->apiGet(self::COUNT, $stale)->assertOk()->json('data.eligible'));

        $this->apiPost(self::EVERYONE, ['confirm_count' => 1], $stale)
            ->assertStatus(403)->assertJsonPath('errors.0.code', RequireRecentSecondFactor::ERROR_CODE);
        $this->assertSame(0, $this->outboxRows($a->id));

        $this->assertSame(1, $this->apiPost(self::SELECTED, ['user_ids' => [$a->id]], $stale)->assertOk()->json('data.queued'));
    }

    public function test_the_counted_estimate_matches_the_queued_result(): void
    {
        $this->member();
        $this->member();
        // Invitations of another community already waiting share the sender's pace.
        $elsewhere = $this->member([], 1);
        $rows = [];
        for ($i = 0; $i < 60; $i++) {
            $rows[] = [
                'tenant_id' => 1, 'user_id' => $elsewhere->id, 'request_key' => sprintf('eta-%032d', $i),
                'source' => 'admin_bulk', 'status' => 'pending', 'attempts' => 0,
                'available_at' => now(), 'created_at' => now(), 'updated_at' => now(),
            ];
        }
        DB::table('member_invitation_outbox')->insert($rows);

        $count = $this->apiGet(self::COUNT, $this->headers())->assertOk();
        $this->assertSame(2, $count->json('data.eligible'));
        $queued = $this->inviteEveryone(2)->assertOk();

        $this->assertSame($queued->json('data.eta_minutes'), $count->json('data.eta_minutes'));
        $this->assertGreaterThanOrEqual(2, $count->json('data.eta_minutes'), '62+ waiting at 50 a minute');
    }

    public function test_invite_everyone_needs_a_whole_number_to_confirm(): void
    {
        $this->member();
        $this->apiPost(self::EVERYONE, [], $this->headers())->assertStatus(422);
        $this->inviteEveryone('lots')->assertStatus(422);
        $this->inviteEveryone(-1)->assertStatus(422);
    }

    public function test_invite_everyone_is_limited_to_five_requests_a_minute_per_admin(): void
    {
        for ($i = 0; $i < 5; $i++) {
            $this->inviteEveryone(12345)->assertStatus(409);
        }
        $this->inviteEveryone(12345)->assertStatus(429);
    }
}
