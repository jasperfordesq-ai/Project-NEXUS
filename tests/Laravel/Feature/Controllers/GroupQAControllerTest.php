<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

declare(strict_types=1);

namespace Tests\Laravel\Feature\Controllers;

use App\Core\TenantContext;
use App\Enums\GroupStatus;
use App\Models\User;
use App\Services\GroupConfigurationService;
use Illuminate\Foundation\Testing\DatabaseTransactions;
use Illuminate\Support\Facades\Cache;
use Illuminate\Support\Facades\DB;
use App\Services\TokenService;
use App\Services\TwoFactorPolicy;
use Tests\Laravel\TestCase;

final class GroupQAControllerTest extends TestCase
{
    use DatabaseTransactions;

    private User $owner;
    private User $nonMember;
    private User $pendingMember;
    private User $member;
    private User $questionAuthor;
    private User $answerAuthor;
    private User $groupAdmin;
    private User $tenantAdmin;
    private User $foreignOwner;
    private int $activeGroupId;
    private int $otherGroupId;
    private int $dormantGroupId;
    private int $archivedGroupId;
    private int $foreignGroupId;

    protected function setUp(): void
    {
        parent::setUp();

        $this->owner = $this->localUser();
        $this->nonMember = $this->localUser();
        $this->pendingMember = $this->localUser();
        $this->member = $this->localUser();
        $this->questionAuthor = $this->localUser();
        $this->answerAuthor = $this->localUser();
        $this->groupAdmin = $this->localUser();
        $this->tenantAdmin = User::factory()->forTenant($this->testTenantId)->admin()->create();
        $this->foreignOwner = User::factory()->forTenant(999)->create();

        $this->activeGroupId = $this->insertGroup(GroupStatus::Active, $this->owner);
        $this->otherGroupId = $this->insertGroup(GroupStatus::Active, $this->owner);
        $this->dormantGroupId = $this->insertGroup(GroupStatus::Dormant, $this->owner);
        $this->archivedGroupId = $this->insertGroup(GroupStatus::Archived, $this->owner);
        $this->foreignGroupId = $this->insertGroup(GroupStatus::Active, $this->foreignOwner, 999);

        foreach ([$this->activeGroupId, $this->otherGroupId, $this->dormantGroupId, $this->archivedGroupId] as $groupId) {
            $this->insertMembership($groupId, $this->pendingMember, 'member', 'pending');
            $this->insertMembership($groupId, $this->member);
            $this->insertMembership($groupId, $this->questionAuthor);
            $this->insertMembership($groupId, $this->answerAuthor);
            $this->insertMembership($groupId, $this->groupAdmin, 'admin');
        }

        $this->enableGroupRoutes(GroupConfigurationService::CONFIG_TAB_QA);
    }

    protected function tearDown(): void
    {
        Cache::forget('group_config:' . $this->testTenantId);
        parent::tearDown();
    }

    public function test_all_qa_routes_require_authentication(): void
    {
        $this->apiGet("/v2/groups/{$this->activeGroupId}/questions")->assertUnauthorized();
        $this->apiPost("/v2/groups/{$this->activeGroupId}/questions", [])->assertUnauthorized();
        $this->apiGet("/v2/groups/{$this->activeGroupId}/questions/1")->assertUnauthorized();
        $this->apiPost("/v2/groups/{$this->activeGroupId}/questions/1/answers", [])->assertUnauthorized();
        $this->apiPost("/v2/groups/{$this->activeGroupId}/answers/1/accept", [])->assertUnauthorized();
        $this->apiPost("/v2/groups/{$this->activeGroupId}/qa/vote", [])->assertUnauthorized();
    }

    public function test_administrator_bearer_without_mfa_cannot_read_questions(): void
    {
        $this->withHeaders(['Authorization' => 'Bearer ' . app(TokenService::class)->generateToken(
            $this->tenantAdmin->id, $this->tenantAdmin->tenant_id,
        )]);
        $this->apiGet("/v2/groups/{$this->activeGroupId}/questions")
            ->assertUnauthorized()
            ->assertJsonPath('code', 'AUTH_MFA_REQUIRED');
    }

    public function test_read_access_requires_active_membership_and_active_same_tenant_parent(): void
    {
        $this->authenticate($this->nonMember);
        $this->apiGet("/v2/groups/{$this->activeGroupId}/questions")->assertForbidden();

        $this->authenticate($this->pendingMember);
        $this->apiGet("/v2/groups/{$this->activeGroupId}/questions")->assertForbidden();

        $this->authenticate($this->member);
        $this->apiGet("/v2/groups/{$this->activeGroupId}/questions")->assertOk();
        $this->apiGet("/v2/groups/{$this->dormantGroupId}/questions")->assertForbidden();
        $this->apiGet("/v2/groups/{$this->archivedGroupId}/questions")->assertForbidden();
        $this->apiGet("/v2/groups/{$this->foreignGroupId}/questions")->assertNotFound();

        $this->authenticate($this->owner);
        $this->apiGet("/v2/groups/{$this->activeGroupId}/questions")->assertOk();

        $this->authenticate($this->tenantAdmin);
        $this->apiGet("/v2/groups/{$this->activeGroupId}/questions")->assertOk();
        $this->apiGet("/v2/groups/{$this->dormantGroupId}/questions")->assertForbidden();
        $this->apiGet("/v2/groups/{$this->archivedGroupId}/questions")->assertForbidden();
    }

    public function test_question_and_answer_writes_enforce_membership_and_parent_lifecycle(): void
    {
        $payload = ['title' => 'How can we help?', 'body' => 'A sufficiently detailed question body.'];

        $this->authenticate($this->nonMember);
        $this->apiPost("/v2/groups/{$this->activeGroupId}/questions", $payload)->assertForbidden();

        $this->authenticate($this->pendingMember);
        $this->apiPost("/v2/groups/{$this->activeGroupId}/questions", $payload)->assertForbidden();

        $this->authenticate($this->member);
        $created = $this->apiPost("/v2/groups/{$this->activeGroupId}/questions", $payload)
            ->assertCreated();
        $questionId = (int) $created->json('data.id');
        self::assertGreaterThan(0, $questionId);

        $this->apiPost(
            "/v2/groups/{$this->activeGroupId}/questions/{$questionId}/answers",
            ['body' => 'A useful answer.'],
        )->assertCreated();

        $readback = $this->apiGet("/v2/groups/{$this->activeGroupId}/questions/{$questionId}")
            ->assertOk();
        self::assertSame($payload['title'], $readback->json('data.title'));
        self::assertSame($payload['body'], $readback->json('data.body'));
        self::assertSame('A useful answer.', $readback->json('data.answers.0.body'));
        self::assertSame(1, count($readback->json('data.answers')));

        $archivedQuestion = $this->insertQuestion($this->archivedGroupId, $this->questionAuthor);
        $this->apiPost(
            "/v2/groups/{$this->archivedGroupId}/questions/{$archivedQuestion}/answers",
            ['body' => 'Must not be written.'],
        )->assertForbidden();
    }

    public function test_malformed_scalar_fields_resolve_to_validation_errors(): void
    {
        $questionId = $this->insertQuestion($this->activeGroupId, $this->questionAuthor);
        $this->authenticate($this->member);

        $this->apiPost("/v2/groups/{$this->activeGroupId}/questions", [
            'title' => ['not', 'a', 'string'],
            'body' => 'Body',
        ])->assertUnprocessable();
        $this->apiPost("/v2/groups/{$this->activeGroupId}/questions/{$questionId}/answers", [
            'body' => ['not', 'a', 'string'],
        ])->assertUnprocessable();
        $this->apiPost("/v2/groups/{$this->activeGroupId}/qa/vote", [
            'type' => 'question',
            'target_id' => ['invalid'],
            'vote' => 'up',
        ])->assertUnprocessable();
    }

    public function test_malformed_or_sort_mismatched_cursor_is_rejected_explicitly(): void
    {
        $this->authenticate($this->member);

        $this->apiGet("/v2/groups/{$this->activeGroupId}/questions?cursor=tampered")
            ->assertUnprocessable()
            ->assertJsonPath('errors.0.code', 'INVALID_CURSOR')
            ->assertJsonPath('errors.0.message', __('api.invalid_cursor'));

        $mostVotedCursor = base64_encode((string) json_encode([
            'sort' => 'most_voted',
            'score' => 2,
            'id' => 1,
        ], JSON_THROW_ON_ERROR));
        $this->apiGet(
            "/v2/groups/{$this->activeGroupId}/questions?sort=newest&cursor=" . rawurlencode($mostVotedCursor),
        )->assertUnprocessable()->assertJsonPath('errors.0.code', 'INVALID_CURSOR');

        $this->apiGet("/v2/groups/{$this->activeGroupId}/questions?cursor[]=not-a-scalar")
            ->assertUnprocessable()
            ->assertJsonPath('errors.0.code', 'INVALID_CURSOR');
    }

    public function test_question_cursor_is_signed_and_bound_to_its_group(): void
    {
        $this->insertQuestion($this->activeGroupId, $this->questionAuthor);
        $this->insertQuestion($this->activeGroupId, $this->questionAuthor);
        $this->insertQuestion($this->otherGroupId, $this->questionAuthor);
        $this->insertQuestion($this->otherGroupId, $this->questionAuthor);
        $this->authenticate($this->member);

        $cursor = $this->apiGet("/v2/groups/{$this->activeGroupId}/questions?per_page=1")
            ->assertOk()
            ->json('data.cursor');
        self::assertIsString($cursor);

        $this->apiGet(
            "/v2/groups/{$this->otherGroupId}/questions?per_page=1&cursor=" . rawurlencode($cursor),
        )->assertUnprocessable()->assertJsonPath('errors.0.code', 'INVALID_CURSOR');

        $tampered = substr($cursor, 0, -1) . (str_ends_with($cursor, 'A') ? 'B' : 'A');
        $this->apiGet(
            "/v2/groups/{$this->activeGroupId}/questions?per_page=1&cursor=" . rawurlencode($tampered),
        )->assertUnprocessable()->assertJsonPath('errors.0.code', 'INVALID_CURSOR');
    }

    public function test_vote_toggle_and_switch_keep_rows_counts_and_viewer_state_exact(): void
    {
        $questionId = $this->insertQuestion($this->activeGroupId, $this->questionAuthor);
        $answerId = $this->insertAnswer($questionId, $this->answerAuthor);
        $this->authenticate($this->member);

        $this->assertVoteSequence('question', $questionId, 'group_questions');
        $this->assertVoteSequence('answer', $answerId, 'group_answers');

        $show = $this->apiGet("/v2/groups/{$this->activeGroupId}/questions/{$questionId}")
            ->assertOk();
        self::assertSame(1, (int) $show->json('data.user_vote'));
        self::assertSame(1, (int) $show->json('data.answers.0.user_vote'));

        $list = $this->apiGet("/v2/groups/{$this->activeGroupId}/questions")
            ->assertOk();
        self::assertSame(1, (int) $list->json('data.items.0.user_vote'));
    }

    public function test_accept_is_author_or_admin_only_atomic_and_conceals_foreign_targets(): void
    {
        $questionId = $this->insertQuestion($this->activeGroupId, $this->questionAuthor);
        $firstAnswerId = $this->insertAnswer($questionId, $this->answerAuthor);
        $secondAnswerId = $this->insertAnswer($questionId, $this->member);

        $this->authenticate($this->answerAuthor);
        $this->apiPost("/v2/groups/{$this->activeGroupId}/answers/{$firstAnswerId}/accept")
            ->assertForbidden();

        $this->authenticate($this->questionAuthor);
        $this->apiPost("/v2/groups/{$this->activeGroupId}/answers/{$firstAnswerId}/accept")
            ->assertOk();
        $this->assertAcceptedState($questionId, $firstAnswerId);

        $this->authenticate($this->groupAdmin);
        $this->apiPost("/v2/groups/{$this->activeGroupId}/answers/{$secondAnswerId}/accept")
            ->assertOk();
        $this->assertAcceptedState($questionId, $secondAnswerId);

        $otherQuestion = $this->insertQuestion($this->otherGroupId, $this->questionAuthor);
        $otherAnswer = $this->insertAnswer($otherQuestion, $this->answerAuthor);
        $this->apiPost("/v2/groups/{$this->activeGroupId}/answers/{$otherAnswer}/accept")
            ->assertNotFound();

        $foreignQuestion = $this->insertQuestion($this->foreignGroupId, $this->foreignOwner, 999);
        $foreignAnswer = $this->insertAnswer($foreignQuestion, $this->foreignOwner, 999);
        $this->apiPost("/v2/groups/{$this->activeGroupId}/answers/{$foreignAnswer}/accept")
            ->assertNotFound();
    }

    private function assertVoteSequence(string $type, int $targetId, string $table): void
    {
        $uri = "/v2/groups/{$this->activeGroupId}/qa/vote";
        $payload = ['type' => $type, 'target_id' => $targetId, 'vote' => 'up'];

        $this->apiPost($uri, $payload)->assertOk();
        self::assertSame(1, (int) DB::table($table)->where('id', $targetId)->value('vote_count'));
        $this->assertVoteRow($type, $targetId, 1);

        $this->apiPost($uri, $payload)->assertOk();
        self::assertSame(0, (int) DB::table($table)->where('id', $targetId)->value('vote_count'));
        self::assertFalse($this->voteRowQuery($type, $targetId)->exists());

        $payload['vote'] = 'down';
        $this->apiPost($uri, $payload)->assertOk();
        self::assertSame(-1, (int) DB::table($table)->where('id', $targetId)->value('vote_count'));
        $this->assertVoteRow($type, $targetId, -1);

        $payload['vote'] = 'up';
        $this->apiPost($uri, $payload)->assertOk();
        self::assertSame(1, (int) DB::table($table)->where('id', $targetId)->value('vote_count'));
        $this->assertVoteRow($type, $targetId, 1);
        self::assertSame(1, $this->voteRowQuery($type, $targetId)->count());
    }

    private function assertVoteRow(string $type, int $targetId, int $vote): void
    {
        self::assertSame($vote, (int) $this->voteRowQuery($type, $targetId)->value('vote'));
    }

    private function voteRowQuery(string $type, int $targetId): \Illuminate\Database\Query\Builder
    {
        return DB::table('group_qa_votes')
            ->where('tenant_id', $this->testTenantId)
            ->where('user_id', $this->member->id)
            ->where('votable_type', $type)
            ->where('votable_id', $targetId);
    }

    private function assertAcceptedState(int $questionId, int $acceptedAnswerId): void
    {
        self::assertSame(
            $acceptedAnswerId,
            (int) DB::table('group_questions')->where('id', $questionId)->value('accepted_answer_id'),
        );
        self::assertSame(
            1,
            DB::table('group_answers')->where('question_id', $questionId)->where('is_accepted', true)->count(),
        );
        self::assertTrue((bool) DB::table('group_answers')->where('id', $acceptedAnswerId)->value('is_accepted'));
    }

    private function authenticate(User $user): void
    {
        // Exercise the same signed bearer boundary as the native client. These
        // authorization fixtures represent completed MFA where policy requires it.
        $claims = app(TwoFactorPolicy::class)->required($user) ? TwoFactorPolicy::claims('totp') : [];
        $this->withHeaders(['Authorization' => 'Bearer ' . app(TokenService::class)->generateToken(
            $user->id, $user->tenant_id, $claims,
        )]);
    }

    private function enableGroupRoutes(string $tabConfigKey): void
    {
        $raw = DB::table('tenants')->where('id', $this->testTenantId)->value('features');
        $features = is_string($raw) ? (json_decode($raw, true) ?: []) : [];
        $features['groups'] = true;
        DB::table('tenants')->where('id', $this->testTenantId)->update([
            'features' => json_encode($features, JSON_THROW_ON_ERROR),
        ]);
        TenantContext::reset();
        TenantContext::setById($this->testTenantId);
        GroupConfigurationService::set($tabConfigKey, true);
    }

    private function localUser(): User
    {
        return User::factory()->forTenant($this->testTenantId)->create();
    }

    private function insertGroup(GroupStatus $status, User $owner, ?int $tenantId = null): int
    {
        return (int) DB::table('groups')->insertGetId([
            'tenant_id' => $tenantId ?? $this->testTenantId,
            'owner_id' => $owner->id,
            'name' => 'Q&A test ' . uniqid('', true),
            'description' => 'Q&A access fixture.',
            'visibility' => 'private',
            'status' => $status->value,
            'is_active' => $status->legacyIsActive(),
            'cached_member_count' => 0,
            'created_at' => now(),
            'updated_at' => now(),
        ]);
    }

    private function insertMembership(
        int $groupId,
        User $user,
        string $role = 'member',
        string $status = 'active',
    ): void {
        DB::table('group_members')->insert([
            'tenant_id' => $this->testTenantId,
            'group_id' => $groupId,
            'user_id' => $user->id,
            'role' => $role,
            'status' => $status,
            'created_at' => now(),
            'updated_at' => now(),
        ]);
    }

    private function insertQuestion(int $groupId, User $author, ?int $tenantId = null): int
    {
        return (int) DB::table('group_questions')->insertGetId([
            'tenant_id' => $tenantId ?? $this->testTenantId,
            'group_id' => $groupId,
            'user_id' => $author->id,
            'title' => 'Question ' . uniqid('', true),
            'body' => 'Question body',
            'accepted_answer_id' => null,
            'is_closed' => false,
            'view_count' => 0,
            'vote_count' => 0,
            'answer_count' => 0,
            'created_at' => now(),
            'updated_at' => now(),
        ]);
    }

    private function insertAnswer(int $questionId, User $author, ?int $tenantId = null): int
    {
        $tenantId ??= $this->testTenantId;
        $answerId = (int) DB::table('group_answers')->insertGetId([
            'tenant_id' => $tenantId,
            'question_id' => $questionId,
            'user_id' => $author->id,
            'body' => 'Answer ' . uniqid('', true),
            'is_accepted' => false,
            'vote_count' => 0,
            'created_at' => now(),
            'updated_at' => now(),
        ]);
        DB::table('group_questions')
            ->where('id', $questionId)
            ->where('tenant_id', $tenantId)
            ->increment('answer_count');

        return $answerId;
    }
}
