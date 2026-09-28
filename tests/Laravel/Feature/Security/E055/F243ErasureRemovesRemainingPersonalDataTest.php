<?php

// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

namespace Tests\Laravel\Feature\Security\E055;

use App\Models\Transaction;
use App\Models\User;
use App\Services\Enterprise\GdprService;
use Illuminate\Foundation\Testing\DatabaseTransactions;
use Illuminate\Support\Facades\DB;
use Laravel\Sanctum\Sanctum;
use Tests\Laravel\TestCase;

/**
 * F-243 (E-055 D-1): Article 17 erasure must remove the stored display name,
 * username, date of birth, organisation name and CV fields, and the member's
 * rows in the canonical `comments` table — not only first/last name and
 * `feed_comments`.
 *
 * Every assertion reads the column values back, so a schema mistake in the
 * anonymising UPDATE cannot pass as a swallowed no-op.
 */
class F243ErasureRemovesRemainingPersonalDataTest extends TestCase
{
    use DatabaseTransactions;

    private ?string $originalStoragePath = null;

    protected function setUp(): void
    {
        parent::setUp();
        $this->originalStoragePath = getenv('STORAGE_PATH') ?: null;
        putenv('STORAGE_PATH=' . rtrim(sys_get_temp_dir(), '/\\') . '/f243-erasure-' . getmypid());
    }

    protected function tearDown(): void
    {
        if ($this->originalStoragePath === null) {
            putenv('STORAGE_PATH');
        } else {
            putenv('STORAGE_PATH=' . $this->originalStoragePath);
        }
        parent::tearDown();
    }

    private function member(array $overrides = []): User
    {
        return User::factory()->forTenant($this->testTenantId)->create(array_merge([
            'status' => 'active',
            'is_approved' => true,
            'balance' => 10.00,
        ], $overrides));
    }

    private function makePost(int $userId): int
    {
        return DB::table('feed_posts')->insertGetId([
            'tenant_id' => $this->testTenantId,
            'user_id' => $userId,
            'content' => 'F243 target post ' . uniqid(),
            'type' => 'post',
            'visibility' => 'public',
            'publish_status' => 'published',
            'created_at' => now(),
            'updated_at' => now(),
        ]);
    }

    private function comment(int $postId, int $userId, string $content): int
    {
        return DB::table('comments')->insertGetId([
            'tenant_id' => $this->testTenantId,
            'target_type' => 'post',
            'target_id' => $postId,
            'user_id' => $userId,
            'content' => $content,
            'created_at' => now(),
            'updated_at' => now(),
        ]);
    }

    public function test_erasure_clears_stored_name_username_birth_date_and_cv_fields(): void
    {
        $erased = $this->member([
            'first_name' => 'Ursula',
            'last_name' => 'Uniquesurname',
            'name' => 'Ursula Uniquesurname',
            'username' => 'ursula_f243',
            'date_of_birth' => '1961-04-03',
            'organization_name' => 'Uniquesurname Care Ltd',
            'resume_headline' => 'Retired nurse, Ballyfake Road',
            'resume_summary' => 'Private CV text for F-243',
            'availability' => 'Weekday mornings near Ballyfake Road',
        ]);
        // A second erasure in the same community proves the username value
        // chosen cannot collide on the (tenant_id, username) unique key.
        $second = $this->member(['username' => 'second_f243']);

        $service = new GdprService($this->testTenantId);
        $service->executeAccountDeletion((int) $erased->id);
        $service->executeAccountDeletion((int) $second->id);

        $row = DB::table('users')->where('id', $erased->id)->first();
        $this->assertNotNull($row->anonymized_at, 'the anonymising update ran');
        $this->assertSame('Deleted', $row->first_name);
        $this->assertSame('User', $row->last_name);

        $this->assertSame('Deleted User', $row->name, 'stored display name matches the deleted-user form');
        $this->assertNull($row->username);
        $this->assertNull($row->date_of_birth);
        $this->assertNull($row->organization_name);
        $this->assertNull($row->resume_headline);
        $this->assertNull($row->resume_summary);
        $this->assertNull($row->availability);

        $this->assertNull(DB::table('users')->where('id', $second->id)->value('username'));

        // The model accessor used by most display paths now shows the deleted form.
        $this->assertSame('Deleted User', User::query()->find($erased->id)?->name);
    }

    public function test_other_members_no_longer_see_the_erased_members_comments_or_name(): void
    {
        $postOwner = $this->member();
        $erased = $this->member([
            'first_name' => 'Ursula',
            'last_name' => 'Uniquesurname',
            'name' => 'Ursula Uniquesurname',
        ]);
        $control = $this->member(['first_name' => 'Cora', 'last_name' => 'Control', 'name' => 'Cora Control']);
        $viewer = $this->member();

        $postId = $this->makePost((int) $postOwner->id);
        $this->comment($postId, (int) $erased->id, 'ERASED-AUTHOR private words 0871234567');
        $this->comment($postId, (int) $control->id, 'CONTROL-AUTHOR words');

        (new GdprService($this->testTenantId))->executeAccountDeletion((int) $erased->id);

        $this->assertSame(0, DB::table('comments')->where('user_id', $erased->id)->count());
        // Control: the other member's comment row is untouched.
        $this->assertSame(1, DB::table('comments')->where('user_id', $control->id)->count());

        Sanctum::actingAs($viewer, ['*']);

        $v2 = $this->apiGet('/v2/comments?target_type=post&target_id=' . $postId);
        $v2->assertStatus(200);
        $v2Body = $v2->getContent();
        $this->assertStringNotContainsString('ERASED-AUTHOR', $v2Body);
        $this->assertStringNotContainsString('Uniquesurname', $v2Body);
        $this->assertStringContainsString('CONTROL-AUTHOR words', $v2Body);
        $this->assertStringContainsString('Cora Control', $v2Body);

        $legacy = $this->apiPost('/social/comments', [
            'action' => 'fetch',
            'target_type' => 'post',
            'target_id' => $postId,
        ]);
        $legacy->assertStatus(200);
        $legacyBody = $legacy->getContent();
        $this->assertStringNotContainsString('ERASED-AUTHOR', $legacyBody);
        $this->assertStringNotContainsString('Uniquesurname', $legacyBody);
        $this->assertStringContainsString('CONTROL-AUTHOR words', $legacyBody);
        $this->assertStringContainsString('Cora Control', $legacyBody);
    }

    public function test_erasure_leaves_other_tenants_comments_alone(): void
    {
        $erased = $this->member();
        $postId = $this->makePost((int) $erased->id);
        // A row with the same user_id under a different tenant must survive:
        // the delete is tenant-scoped.
        $otherTenantId = (int) DB::table('tenants')->where('id', '!=', $this->testTenantId)->value('id');
        $this->assertGreaterThan(0, $otherTenantId);
        DB::table('comments')->insert([
            'tenant_id' => $otherTenantId,
            'target_type' => 'post',
            'target_id' => $postId,
            'user_id' => $erased->id,
            'content' => 'OTHER-TENANT row',
            'created_at' => now(),
            'updated_at' => now(),
        ]);
        $this->comment($postId, (int) $erased->id, 'OWN-TENANT row');

        (new GdprService($this->testTenantId))->executeAccountDeletion((int) $erased->id);

        $this->assertSame(0, DB::table('comments')->where('tenant_id', $this->testTenantId)->where('user_id', $erased->id)->count());
        $this->assertSame(1, DB::table('comments')->where('tenant_id', $otherTenantId)->where('user_id', $erased->id)->count());
    }

    /** Held control: wallet history already shows the deleted-user form. */
    public function test_wallet_history_still_shows_deleted_user(): void
    {
        $erased = $this->member([
            'first_name' => 'Ursula',
            'last_name' => 'Uniquesurname',
            'name' => 'Ursula Uniquesurname',
        ]);
        $viewer = $this->member();

        Transaction::factory()->forTenant($this->testTenantId)->create([
            'sender_id' => $erased->id,
            'receiver_id' => $viewer->id,
            'amount' => 1,
            'status' => 'completed',
        ]);

        (new GdprService($this->testTenantId))->executeAccountDeletion((int) $erased->id);

        Sanctum::actingAs($viewer, ['*']);
        $response = $this->apiGet('/v2/wallet/transactions');
        $response->assertStatus(200);

        $body = $response->getContent();
        $this->assertStringNotContainsString('Uniquesurname', $body);
        $this->assertStringContainsString('Deleted User', $body);
    }
}
