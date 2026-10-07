<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

namespace Tests\Laravel\Feature\Volunteering;

use App\Core\TenantContext;
use App\Models\User;
use Illuminate\Foundation\Testing\DatabaseTransactions;
use Illuminate\Support\Facades\DB;
use Laravel\Sanctum\Sanctum;
use Tests\Laravel\TestCase;

/**
 * Gap D5 (7 Oct 2026): the admin Applications page loaded one unpaged list
 * capped at 150 rows and searched, filtered and counted it in the browser, so a
 * community with more applications lost the oldest from every tab, count, search
 * and export. The list now pages, filters and counts in the database.
 */
class AdminVolunteerApplicationsPagingTest extends TestCase
{
    use DatabaseTransactions;

    private int $gardenId;
    private int $kitchenId;
    private int $otherTenantOpportunityId;

    protected function setUp(): void
    {
        parent::setUp();
        DB::table('tenants')->where('id', $this->testTenantId)->update([
            'features' => json_encode(['volunteering' => true]),
        ]);
        TenantContext::setById($this->testTenantId);

        $this->gardenId = $this->opportunity($this->testTenantId, 'D5 Garden Day');
        $this->kitchenId = $this->opportunity($this->testTenantId, 'D5 Soup Kitchen');

        // 160 decided applications to the garden, older than everything else:
        // under the old 150-row cap the oldest of these were never shown.
        $volunteer = $this->member('Grace', 'Hopper');
        $rows = [];
        for ($i = 0; $i < 160; $i++) {
            $rows[] = [
                'tenant_id' => $this->testTenantId,
                'opportunity_id' => $this->gardenId,
                'user_id' => $volunteer->id,
                'status' => $i % 2 === 0 ? 'approved' : 'declined',
                'created_at' => now()->subDays(400 - $i),
                'updated_at' => now(),
            ];
        }
        DB::table('vol_applications')->insert($rows);

        // One pending application, to the kitchen, by a findable name.
        $pending = $this->member('Ada', 'Lovelace');
        DB::table('vol_applications')->insert([
            'tenant_id' => $this->testTenantId,
            'opportunity_id' => $this->kitchenId,
            'user_id' => $pending->id,
            'status' => 'pending',
            'created_at' => now()->subDays(500),
            'updated_at' => now(),
        ]);

        // Another community's application must never appear or be counted.
        $this->otherTenantOpportunityId = $this->opportunity(999, 'D5 Other Community');
        DB::table('vol_applications')->insert([
            'tenant_id' => 999,
            'opportunity_id' => $this->otherTenantOpportunityId,
            'user_id' => $pending->id,
            'status' => 'pending',
            'created_at' => now(),
            'updated_at' => now(),
        ]);

        Sanctum::actingAs(User::factory()->forTenant($this->testTenantId)->admin()->create());
    }

    private function opportunity(int $tenantId, string $title): int
    {
        return (int) DB::table('vol_opportunities')->insertGetId([
            'tenant_id' => $tenantId,
            'title' => $title,
            'description' => 'Test opportunity',
            'created_at' => now(),
        ]);
    }

    private function member(string $first, string $last): User
    {
        return User::factory()->forTenant($this->testTenantId)->create([
            'first_name' => $first,
            'last_name' => $last,
            'name' => "$first $last",
            'email' => strtolower($first) . '-' . uniqid('', true) . '@example.test',
            'status' => 'active',
        ]);
    }

    private function ours(array $items): array
    {
        return array_values(array_filter(
            $items,
            fn ($item) => in_array($item['opportunity_id'], [$this->gardenId, $this->kitchenId], true)
        ));
    }

    public function test_every_application_is_reachable_page_by_page_with_pending_first(): void
    {
        $first = $this->apiGet('/v2/admin/volunteering/approvals?page=1&per_page=100')->assertOk();
        $this->assertSame('pending', $first->json('data.items.0.status'), 'pending sorts first even when it is the oldest');
        $this->assertSame(100, $first->json('data.per_page'));
        $this->assertGreaterThanOrEqual(161, $first->json('data.total'));
        $this->assertGreaterThanOrEqual(161, $first->json('data.counts.all'));

        $seen = [];
        for ($page = 1; $page <= (int) ceil($first->json('data.total') / 100); $page++) {
            $items = $this->apiGet("/v2/admin/volunteering/approvals?page=$page&per_page=100")->json('data.items');
            foreach ($this->ours($items) as $item) {
                $seen[$item['id']] = true;
            }
            $this->assertNotContains($this->otherTenantOpportunityId, array_column($items, 'opportunity_id'));
        }
        $this->assertCount(161, $seen, 'all 161 of this community\'s applications are reachable, not only 150');
    }

    public function test_status_tab_search_and_opportunity_filter_run_on_the_server(): void
    {
        $declined = $this->apiGet('/v2/admin/volunteering/approvals?status=declined&opportunity_id=' . $this->gardenId . '&per_page=100')
            ->assertOk();
        $this->assertSame(80, $declined->json('data.total'));
        $this->assertCount(80, $declined->json('data.items'));
        $this->assertSame(['declined'], array_values(array_unique(array_column($declined->json('data.items'), 'status'))));
        // Counts follow the opportunity filter but not the status tab.
        $this->assertSame(['pending' => 0, 'approved' => 80, 'declined' => 80, 'all' => 160], $declined->json('data.counts'));

        $search = $this->apiGet('/v2/admin/volunteering/approvals?q=ada%20lovelace')->assertOk();
        $this->assertSame(1, $search->json('data.total'));
        $this->assertSame('Lovelace', $search->json('data.items.0.last_name'));
        $this->assertSame('D5 Soup Kitchen', $search->json('data.items.0.opportunity_title'));

        // A LIKE wildcard in the search box is a literal, not "match everything".
        $this->assertSame(0, $this->apiGet('/v2/admin/volunteering/approvals?q=%25')->json('data.total'));
    }

    public function test_the_opportunity_filter_lists_only_this_community(): void
    {
        $titles = array_column($this->apiGet('/v2/admin/volunteering/approvals')->json('data.opportunities'), 'title');
        $this->assertContains('D5 Garden Day', $titles);
        $this->assertContains('D5 Soup Kitchen', $titles);
        $this->assertNotContains('D5 Other Community', $titles);
    }
}
