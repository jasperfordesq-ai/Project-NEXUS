<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

declare(strict_types=1);

namespace Tests\Laravel\Feature\Security;

use App\Core\TenantContext;
use App\Models\User;
use App\Services\GroupChallengeService;
use App\Services\GroupConfigurationService;
use App\Services\GroupDataExportService;
use Illuminate\Foundation\Testing\DatabaseTransactions;
use Illuminate\Support\Facades\Cache;
use Illuminate\Support\Facades\DB;
use Laravel\Sanctum\Sanctum;
use Tests\Laravel\TestCase;

/**
 * Any member can create a group, so the powers a group owner/admin holds must
 * not reach other members' private data, other groups' files, or the XP economy.
 */
final class GroupOwnerPowersTest extends TestCase
{
    use DatabaseTransactions;

    private User $owner;

    /** @var list<string> */
    private array $createdFiles = [];

    protected function setUp(): void
    {
        parent::setUp();
        TenantContext::setById($this->testTenantId);
        $this->owner = $this->member('Groupowner');
    }

    protected function tearDown(): void
    {
        foreach ($this->createdFiles as $file) {
            if (is_file($file)) {
                @unlink($file);
            }
        }
        Cache::forget('group_config:' . $this->testTenantId);
        parent::tearDown();
    }

    // ------------------------------------------------------------------
    // F-093 — member exports must not hand a group owner everyone's email
    // ------------------------------------------------------------------

    public function test_f093_group_owner_member_exports_omit_email_and_non_active_rows(): void
    {
        $groupId = $this->group((int) $this->owner->id);
        $this->membership($groupId, (int) $this->owner->id, 'owner', 'active');

        $active = $this->member('Activeperson');
        $pending = $this->member('Pendingperson');
        $banned = $this->member('Bannedperson');
        $this->membership($groupId, (int) $active->id, 'member', 'active');
        $this->membership($groupId, (int) $pending->id, 'member', 'pending');
        $this->membership($groupId, (int) $banned->id, 'member', 'banned');

        Sanctum::actingAs($this->owner, ['*']);
        $csv = $this->apiGet("/v2/groups/{$groupId}/analytics/export/members")
            ->assertOk()
            ->streamedContent();

        // Control: the owner still gets the active roster.
        self::assertStringContainsString('Activeperson', $csv);
        $header = strtok($csv, "\n");
        self::assertIsString($header);
        self::assertStringNotContainsString('email', $header);
        foreach ([$active, $pending, $banned, $this->owner] as $user) {
            self::assertStringNotContainsString((string) $user->email, $csv);
        }
        self::assertStringNotContainsString('Pendingperson', $csv);
        self::assertStringNotContainsString('Bannedperson', $csv);

        $export = GroupDataExportService::exportAll($groupId, (int) $this->owner->id);
        self::assertNotNull($export);
        $names = implode('|', array_column($export['members'], 'name'));
        self::assertStringContainsString('Activeperson', $names);
        self::assertStringNotContainsString('Pendingperson', $names);
        self::assertStringNotContainsString('Bannedperson', $names);
        foreach ($export['members'] as $row) {
            self::assertArrayNotHasKey('email', $row);
        }
        $encoded = json_encode($export['members'], JSON_THROW_ON_ERROR);
        foreach ([$active, $pending, $banned] as $user) {
            self::assertStringNotContainsString((string) $user->email, $encoded);
        }

        // Control: a tenant administrator keeps the full export, email included.
        $tenantAdmin = User::factory()->forTenant($this->testTenantId)->admin()->create();
        Sanctum::actingAs($tenantAdmin, ['*']);
        $adminCsv = $this->apiGet("/v2/groups/{$groupId}/analytics/export/members")
            ->assertOk()
            ->streamedContent();
        self::assertStringContainsString((string) $active->email, $adminCsv);
        self::assertStringContainsString('Pendingperson', $adminCsv);

        $adminExport = GroupDataExportService::exportAll($groupId, (int) $tenantAdmin->id);
        self::assertNotNull($adminExport);
        self::assertContains((string) $pending->email, array_column($adminExport['members'], 'email'));
    }

    // ------------------------------------------------------------------
    // F-094 — client-supplied image paths must not be stored or unlinked
    // ------------------------------------------------------------------

    public function test_f094_owner_cannot_adopt_or_delete_another_groups_image(): void
    {
        $victimOwner = $this->member('Victimowner');
        $victimPath = $this->groupImageFile('victim');
        $victimGroupId = $this->group((int) $victimOwner->id, ['image_url' => $victimPath]);

        Sanctum::actingAs($this->owner, ['*']);

        // 1. Create: image_url / cover_image_url from the request are ignored.
        $created = $this->apiPost('/v2/groups', [
            'name' => 'F094 attacker group ' . uniqid('', true),
            'description' => 'A group trying to point at another group image.',
            'visibility' => 'public',
            'image_url' => $victimPath,
            'cover_image_url' => $victimPath,
        ]);
        self::assertContains($created->getStatusCode(), [200, 201], (string) $created->getContent());
        $createdId = (int) $created->json('data.id');
        self::assertGreaterThan(0, $createdId);
        $createdRow = DB::table('groups')->where('id', $createdId)->first(['image_url', 'cover_image_url']);
        self::assertNotNull($createdRow);
        self::assertNull($createdRow->image_url);
        self::assertNull($createdRow->cover_image_url);

        // 2. Settings form with avatar_action=keep must not pass image_url through.
        $ownGroupId = $this->group((int) $this->owner->id);
        $this->membership($ownGroupId, (int) $this->owner->id, 'owner', 'active');
        $this->post('/api/v2/groups/' . $ownGroupId . '/settings', [
            'name' => 'F094 renamed group',
            'avatar_action' => 'keep',
            'cover_action' => 'keep',
            'image_url' => $victimPath,
            'cover_image_url' => $victimPath,
        ], $this->withTenantHeader([]))->assertOk();
        $ownRow = DB::table('groups')->where('id', $ownGroupId)->first(['name', 'image_url', 'cover_image_url']);
        self::assertNotNull($ownRow);
        self::assertSame('F094 renamed group', $ownRow->name); // control: the edit itself applied
        self::assertNull($ownRow->image_url);
        self::assertNull($ownRow->cover_image_url);

        // 3. A row that already shares the path (legacy data) must not unlink
        //    the file another group still uses.
        DB::table('groups')->where('id', $ownGroupId)->update(['image_url' => $victimPath]);
        $this->apiDelete("/v2/groups/{$ownGroupId}/image")->assertOk();
        self::assertNull(DB::table('groups')->where('id', $ownGroupId)->value('image_url'));
        self::assertSame($victimPath, DB::table('groups')->where('id', $victimGroupId)->value('image_url'));
        self::assertFileExists($this->absoluteUploadPath($victimPath));

        // Control: an image only this group uses is still removed from disk.
        $ownPath = $this->groupImageFile('own');
        DB::table('groups')->where('id', $ownGroupId)->update(['image_url' => $ownPath]);
        $this->apiDelete("/v2/groups/{$ownGroupId}/image")->assertOk();
        self::assertFileDoesNotExist($this->absoluteUploadPath($ownPath));
    }

    // ------------------------------------------------------------------
    // F-095 — group challenges must not be an unbounded XP mint
    // ------------------------------------------------------------------

    public function test_f095_active_challenges_are_capped_and_daily_challenge_xp_is_bounded(): void
    {
        GroupConfigurationService::set(GroupConfigurationService::CONFIG_TAB_CHALLENGES, true);
        $groupId = $this->group((int) $this->owner->id);
        $this->membership($groupId, (int) $this->owner->id, 'owner', 'active');

        Sanctum::actingAs($this->owner, ['*']);
        $payload = [
            'title' => 'Post once',
            'description' => 'Write a single post in the group feed.',
            'metric' => 'posts',
            'target_value' => 1,
            'reward_xp' => 100,
            'ends_at' => now()->addWeek()->toIso8601String(),
        ];

        // Control: the owner can create up to the cap.
        for ($i = 0; $i < GroupChallengeService::MAX_ACTIVE_CHALLENGES; $i++) {
            $this->apiPost("/v2/groups/{$groupId}/challenges", $payload)->assertStatus(201);
        }
        $this->apiPost("/v2/groups/{$groupId}/challenges", $payload)
            ->assertStatus(422)
            ->assertJsonPath('errors.0.code', 'CHALLENGE_LIMIT_REACHED');
        self::assertSame(
            GroupChallengeService::MAX_ACTIVE_CHALLENGES,
            DB::table('group_challenges')->where('group_id', $groupId)->where('status', 'active')->count(),
        );

        // One qualifying post completes every target-1 challenge at once; the
        // payout per member per day must stay within the daily cap.
        GroupChallengeService::incrementProgress($groupId, 'posts', 1);

        $awarded = (int) DB::table('user_xp_log')
            ->where('tenant_id', $this->testTenantId)
            ->where('user_id', (int) $this->owner->id)
            ->where('action', 'group_challenge')
            ->sum('xp_amount');
        // Control: rewards are still paid, up to the cap.
        self::assertSame(GroupChallengeService::DAILY_REWARD_XP_CAP_PER_MEMBER, $awarded);

        // Completed challenges free their slots.
        $this->apiPost("/v2/groups/{$groupId}/challenges", $payload)->assertStatus(201);
    }

    // ------------------------------------------------------------------
    // Fixtures
    // ------------------------------------------------------------------

    private function member(string $firstName): User
    {
        return User::factory()->forTenant($this->testTenantId)->create([
            'first_name' => $firstName,
            'last_name' => 'F' . substr(md5(uniqid('', true)), 0, 8),
            'status' => 'active',
            'is_approved' => true,
        ]);
    }

    /** @param array<string, mixed> $extra */
    private function group(int $ownerId, array $extra = []): int
    {
        return (int) DB::table('groups')->insertGetId(array_merge([
            'tenant_id' => $this->testTenantId,
            'owner_id' => $ownerId,
            'name' => 'Group owner powers ' . uniqid('', true),
            'description' => 'Group owner powers fixture description.',
            'visibility' => 'public',
            'status' => 'active',
            'is_active' => true,
            'created_at' => now(),
            'updated_at' => now(),
        ], $extra));
    }

    private function membership(int $groupId, int $userId, string $role, string $status): void
    {
        DB::table('group_members')->insert([
            'tenant_id' => $this->testTenantId,
            'group_id' => $groupId,
            'user_id' => $userId,
            'role' => $role,
            'status' => $status,
            'created_at' => now(),
            'updated_at' => now(),
        ]);
    }

    private function groupImageFile(string $label): string
    {
        $tenant = TenantContext::get();
        $slug = $tenant['slug'] ?? 'default';
        $publicPath = '/uploads/tenants/' . $slug . '/groups/f094-' . $label . '-' . bin2hex(random_bytes(6)) . '.png';
        $absolute = $this->absoluteUploadPath($publicPath);
        if (! is_dir(dirname($absolute))) {
            mkdir(dirname($absolute), 0775, true);
        }
        file_put_contents($absolute, 'f094');
        $this->createdFiles[] = $absolute;

        return $publicPath;
    }

    private function absoluteUploadPath(string $publicPath): string
    {
        return base_path('httpdocs' . $publicPath);
    }
}
