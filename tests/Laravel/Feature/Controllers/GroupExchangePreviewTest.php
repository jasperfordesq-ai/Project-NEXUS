<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

declare(strict_types=1);

namespace Tests\Laravel\Feature\Controllers;

use App\Core\TenantContext;
use App\Models\User;
use Illuminate\Foundation\Testing\DatabaseTransactions;
use Illuminate\Support\Facades\DB;
use Laravel\Sanctum\Sanctum;
use Tests\Laravel\TestCase;

/**
 * POST /v2/group-exchanges/preview — what everyone will earn or pay, worked out
 * by the server (the one place the arithmetic lives) before anything is saved.
 */
final class GroupExchangePreviewTest extends TestCase
{
    use DatabaseTransactions;

    private function member(string $first = 'Mary', string $last = 'Byrne'): User
    {
        return User::factory()->forTenant($this->testTenantId)->create([
            'status' => 'active', 'is_approved' => true, 'first_name' => $first, 'last_name' => $last,
        ]);
    }

    private function workshopPayload(User $giver, array $attendees): array
    {
        return [
            'split_type' => 'workshop',
            'total_hours' => 2,
            'participants' => array_merge(
                [['user_id' => $giver->id, 'role' => 'provider', 'hours' => 2]],
                array_map(fn (User $u) => ['user_id' => $u->id, 'role' => 'receiver', 'hours' => 2], $attendees),
            ),
        ];
    }

    public function test_preview_lists_what_each_person_earns_or_pays_and_the_fund_share(): void
    {
        Sanctum::actingAs($this->member('Org', 'Aniser'), ['*']);
        $mary = $this->member();
        $attendees = [$this->member('Tom', 'A'), $this->member('Ann', 'B'), $this->member('Cara', 'C'), $this->member('Dan', 'D')];

        $response = $this->apiPost('/v2/group-exchanges/preview', $this->workshopPayload($mary, $attendees));

        $response->assertStatus(200)
            ->assertJsonPath('data.problem', null)
            ->assertJsonPath('data.community_fund_hours', 6)
            ->assertJsonPath('data.totals.earned', 2)
            ->assertJsonPath('data.totals.paid', 8)
            ->assertJsonPath('data.totals.to_fund', 6)
            ->assertJsonPath('data.lines.0.user_id', $mary->id)
            ->assertJsonPath('data.lines.0.name', 'Mary Byrne')
            ->assertJsonPath('data.lines.0.verb', 'earns')
            ->assertJsonPath('data.lines.1.verb', 'pays');
        $this->assertCount(5, $response->json('data.lines'));
        $this->assertStringNotContainsString('email', $response->getContent());
        $this->assertSame(0, DB::table('group_exchanges')->where('title', '')->count(), 'preview must not save anything');
    }

    public function test_an_impossible_workshop_is_explained_not_rejected(): void
    {
        Sanctum::actingAs($this->member('Org', 'Aniser'), ['*']);
        $a = $this->member('A', 'One');
        $b = $this->member('B', 'Two');
        $c = $this->member('C', 'Three');

        $response = $this->apiPost('/v2/group-exchanges/preview', [
            'split_type' => 'workshop',
            'total_hours' => 1,
            'participants' => [
                ['user_id' => $a->id, 'role' => 'provider', 'hours' => 1],
                ['user_id' => $b->id, 'role' => 'provider', 'hours' => 1],
                ['user_id' => $c->id, 'role' => 'receiver', 'hours' => 1],
            ],
        ]);

        $response->assertStatus(200)->assertJsonPath('data.problem.code', 'EARNED_EXCEEDS_PAID');
        $this->assertStringContainsString('A team helping someone', (string) $response->json('data.problem.message'));
    }

    public function test_a_person_from_another_community_is_not_named(): void
    {
        $otherTenant = (int) DB::table('tenants')->where('id', '!=', $this->testTenantId)->value('id');
        if ($otherTenant === 0) {
            $this->markTestSkipped('this database has only one community');
        }
        Sanctum::actingAs($this->member('Org', 'Aniser'), ['*']);
        $mary = $this->member();
        $outsider = User::factory()->forTenant($otherTenant)->create(['first_name' => 'Secret', 'last_name' => 'Person']);
        TenantContext::setById($this->testTenantId);

        $response = $this->apiPost('/v2/group-exchanges/preview', $this->workshopPayload($mary, [$outsider]));

        $response->assertStatus(200)->assertJsonPath('data.lines.1.name', null);
        $this->assertStringNotContainsString('Secret', $response->getContent());
    }

    public function test_preview_requires_sign_in_and_the_feature(): void
    {
        $this->apiPost('/v2/group-exchanges/preview', ['split_type' => 'workshop'])->assertStatus(401);

        $tenant = DB::table('tenants')->where('id', $this->testTenantId)->first();
        $features = json_decode((string) ($tenant->features ?? '{}'), true) ?: [];
        DB::table('tenants')->where('id', $this->testTenantId)
            ->update(['features' => json_encode(array_merge($features, ['group_exchanges' => false]))]);
        TenantContext::setById($this->testTenantId);
        Sanctum::actingAs($this->member(), ['*']);

        $this->apiPost('/v2/group-exchanges/preview', ['split_type' => 'workshop'])
            ->assertStatus(403)
            ->assertJsonPath('errors.0.code', 'FEATURE_DISABLED');
    }

    public function test_unknown_kind_is_reported_in_plain_words(): void
    {
        Sanctum::actingAs($this->member(), ['*']);

        $this->apiPost('/v2/group-exchanges/preview', ['split_type' => 'banana', 'participants' => []])
            ->assertStatus(422)
            ->assertJsonPath('errors.0.code', 'SPLIT_TYPE_INVALID');
    }
}
