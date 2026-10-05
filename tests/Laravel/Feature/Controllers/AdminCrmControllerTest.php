<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

namespace Tests\Laravel\Feature\Controllers;

use App\Models\User;
use Illuminate\Foundation\Testing\DatabaseTransactions;
use Illuminate\Support\Facades\DB;
use Laravel\Sanctum\Sanctum;
use Tests\Laravel\TestCase;

/**
 * Feature tests for AdminCrmController.
 *
 * Covers dashboard, funnel, admins, notes, tasks, tags, timeline, and exports.
 */
class AdminCrmControllerTest extends TestCase
{
    use DatabaseTransactions;

    // ================================================================
    // DASHBOARD — GET /v2/admin/crm/dashboard
    // ================================================================

    public function test_dashboard_returns_200_for_admin(): void
    {
        $admin = User::factory()->forTenant($this->testTenantId)->admin()->create();
        Sanctum::actingAs($admin);

        $response = $this->apiGet('/v2/admin/crm/dashboard');

        $response->assertStatus(200);
        $response->assertJsonStructure(['data']);
    }

    public function test_dashboard_returns_403_for_regular_member(): void
    {
        $member = User::factory()->forTenant($this->testTenantId)->create();
        Sanctum::actingAs($member);

        $response = $this->apiGet('/v2/admin/crm/dashboard');

        $response->assertStatus(403);
    }

    public function test_dashboard_returns_401_for_unauthenticated(): void
    {
        $response = $this->apiGet('/v2/admin/crm/dashboard');

        $response->assertStatus(401);
    }

    // ================================================================
    // FUNNEL — GET /v2/admin/crm/funnel
    // ================================================================

    public function test_funnel_returns_200_for_admin(): void
    {
        $admin = User::factory()->forTenant($this->testTenantId)->admin()->create();
        Sanctum::actingAs($admin);

        $response = $this->apiGet('/v2/admin/crm/funnel');

        $response->assertStatus(200);
        $response->assertJsonStructure(['data' => ['stages' => ['*' => ['code', 'count', 'color']]]]);
        $this->assertSame('registered', $response->json('data.stages.0.code'));
        $this->assertArrayNotHasKey('name', $response->json('data.stages.0'));
    }

    public function test_funnel_returns_403_for_regular_member(): void
    {
        $member = User::factory()->forTenant($this->testTenantId)->create();
        Sanctum::actingAs($member);

        $response = $this->apiGet('/v2/admin/crm/funnel');

        $response->assertStatus(403);
    }

    /**
     * Each stage counts members who reached it OR went further, so the counts
     * can only fall as the journey goes on. They used to be six unrelated
     * totals, which put "500%" and "150%" step rates on the admin page.
     */
    public function test_funnel_places_each_member_at_the_furthest_step_reached(): void
    {
        $admin = User::factory()->forTenant($this->testTenantId)->admin()->create();
        Sanctum::actingAs($admin);
        $before = $this->funnelCounts();

        $plain = ['email_verified_at' => null, 'bio' => null, 'location' => null];
        User::factory()->forTenant($this->testTenantId)->create($plain); // joined, nothing else
        $verified = User::factory()->forTenant($this->testTenantId)->create(['email_verified_at' => now()] + $plain);
        // Posted a listing without confirming email or finishing a profile:
        // still counted at every step up to "first listing".
        $lister = User::factory()->forTenant($this->testTenantId)->create($plain);
        DB::table('listings')->insert([
            'tenant_id' => $this->testTenantId, 'user_id' => $lister->id,
            'title' => 'Funnel fixture listing', 'type' => 'offer',
        ]);
        // Two members who have exchanged with each other twice.
        $regularA = User::factory()->forTenant($this->testTenantId)->create($plain);
        $regularB = User::factory()->forTenant($this->testTenantId)->create($plain);
        $this->completedTransaction($regularA->id, $regularB->id);
        $this->completedTransaction($regularB->id, $regularA->id);
        // Credits with no counterpart are not exchanges. Two of them used to
        // make the empty counterpart itself count as a "repeat user".
        $this->completedTransaction(null, $verified->id, 'starting_balance');
        $this->completedTransaction(null, $verified->id, 'admin_grant');
        // Banned accounts are not part of anyone's onboarding.
        User::factory()->forTenant($this->testTenantId)->create(['status' => 'banned'] + $plain);

        $after = $this->funnelCounts();
        $delta = array_map(fn ($code) => $after[$code] - $before[$code], array_keys($after));

        // registered: joinedOnly, verified, lister, regularA, regularB.
        // verified and beyond: all but joinedOnly. Profile: lister + regulars
        // (they went further). Exchanges: the two regulars only.
        $this->assertSame([5, 4, 3, 3, 2, 2], $delta);

        $previous = PHP_INT_MAX;
        foreach ($after as $count) {
            $this->assertLessThanOrEqual($previous, $count);
            $previous = $count;
        }
    }

    public function test_funnel_names_the_members_waiting_at_each_step(): void
    {
        $admin = User::factory()->forTenant($this->testTenantId)->admin()->create();
        Sanctum::actingAs($admin);

        $stuck = User::factory()->forTenant($this->testTenantId)->create([
            'email_verified_at' => now(), 'bio' => null, 'location' => null,
            'created_at' => now()->addMinute(),
        ]);

        $stages = collect($this->apiGet('/v2/admin/crm/funnel')->assertOk()->json('data.stages'))->keyBy('code');

        $waitingIds = array_column($stages['email_verified']['waiting_members'], 'id');
        $this->assertContains($stuck->id, $waitingIds);
        $this->assertGreaterThanOrEqual(1, $stages['email_verified']['waiting']);
        $this->assertNotContains($stuck->id, array_column($stages['registered']['waiting_members'], 'id'));
        $this->assertSame(0, $stages['repeat_user']['waiting']);
    }

    public function test_funnel_monthly_registrations_include_empty_months(): void
    {
        $admin = User::factory()->forTenant($this->testTenantId)->admin()->create();
        Sanctum::actingAs($admin);

        $months = $this->apiGet('/v2/admin/crm/funnel')->assertOk()->json('data.monthly_registrations');

        $this->assertCount(6, $months);
        $this->assertSame(now()->format('Y-m'), end($months)['month']);
        $this->assertSame(now()->subMonths(5)->format('Y-m'), $months[0]['month']);
    }

    /** @return array<string, int> */
    private function funnelCounts(): array
    {
        $stages = $this->apiGet('/v2/admin/crm/funnel')->assertOk()->json('data.stages');

        return array_column($stages, 'count', 'code');
    }

    private function completedTransaction(?int $senderId, int $receiverId, string $type = 'exchange'): void
    {
        DB::table('transactions')->insert([
            'tenant_id' => $this->testTenantId, 'sender_id' => $senderId, 'receiver_id' => $receiverId,
            'amount' => 1, 'status' => 'completed', 'transaction_type' => $type,
        ]);
    }

    // ================================================================
    // ADMINS LIST — GET /v2/admin/crm/admins
    // ================================================================

    public function test_list_admins_returns_200_for_admin(): void
    {
        $admin = User::factory()->forTenant($this->testTenantId)->admin()->create();
        Sanctum::actingAs($admin);

        $response = $this->apiGet('/v2/admin/crm/admins');

        $response->assertStatus(200);
        $response->assertJsonStructure(['data']);
    }

    // ================================================================
    // NOTES — GET /v2/admin/crm/notes
    // ================================================================

    public function test_list_notes_returns_200_for_admin(): void
    {
        $admin = User::factory()->forTenant($this->testTenantId)->admin()->create();
        Sanctum::actingAs($admin);

        $response = $this->apiGet('/v2/admin/crm/notes');

        $response->assertStatus(200);
        $response->assertJsonStructure(['data']);
    }

    public function test_list_notes_returns_403_for_regular_member(): void
    {
        $member = User::factory()->forTenant($this->testTenantId)->create();
        Sanctum::actingAs($member);

        $response = $this->apiGet('/v2/admin/crm/notes');

        $response->assertStatus(403);
    }

    // ================================================================
    // CREATE NOTE — POST /v2/admin/crm/notes
    // ================================================================

    public function test_create_note_returns_success_for_admin(): void
    {
        $admin = User::factory()->forTenant($this->testTenantId)->admin()->create();
        $target = User::factory()->forTenant($this->testTenantId)->create();
        Sanctum::actingAs($admin);

        $response = $this->apiPost('/v2/admin/crm/notes', [
            'user_id' => $target->id,
            'content' => 'Test CRM note content',
        ]);

        $this->assertContains($response->getStatusCode(), [200, 201]);
        $response->assertJsonStructure(['data']);
    }

    // ================================================================
    // TASKS — GET /v2/admin/crm/tasks
    // ================================================================

    public function test_list_tasks_returns_200_for_admin(): void
    {
        $admin = User::factory()->forTenant($this->testTenantId)->admin()->create();
        Sanctum::actingAs($admin);

        $response = $this->apiGet('/v2/admin/crm/tasks');

        $response->assertStatus(200);
        $response->assertJsonStructure(['data']);
    }

    public function test_list_tasks_returns_403_for_regular_member(): void
    {
        $member = User::factory()->forTenant($this->testTenantId)->create();
        Sanctum::actingAs($member);

        $response = $this->apiGet('/v2/admin/crm/tasks');

        $response->assertStatus(403);
    }

    /**
     * The Coordinator tasks page defaults to ?status=open and the CRM dashboard
     * links its "Overdue tasks" figure to ?status=overdue. 'open' is pending +
     * in progress; 'overdue' is the open subset whose due date has passed — a
     * completed task past its date is not overdue, and a task due today is not
     * overdue yet.
     */
    public function test_list_tasks_open_and_overdue_views(): void
    {
        $admin = User::factory()->forTenant($this->testTenantId)->admin()->create();
        Sanctum::actingAs($admin);

        $marker = 'CrmTaskViews' . uniqid();
        $base = [
            'tenant_id' => $this->testTenantId,
            'assigned_to' => $admin->id,
            'created_by' => $admin->id,
            'completed_at' => null,
            'created_at' => now(),
            'updated_at' => now(),
        ];
        // Row first, defaults second: a multi-row insert needs every row to carry the same columns.
        DB::table('coordinator_tasks')->insert([
            ['title' => "$marker overdue open", 'status' => 'pending', 'due_date' => now()->subDays(2)->toDateString()] + $base,
            ['title' => "$marker due today", 'status' => 'in_progress', 'due_date' => now()->toDateString()] + $base,
            ['title' => "$marker no date", 'status' => 'pending', 'due_date' => null] + $base,
            ['title' => "$marker done late", 'status' => 'completed', 'due_date' => now()->subDays(2)->toDateString(), 'completed_at' => now()] + $base,
            ['title' => "$marker cancelled", 'status' => 'cancelled', 'due_date' => now()->subDays(2)->toDateString()] + $base,
        ]);

        $titles = function (string $query) use ($marker): array {
            $response = $this->apiGet('/v2/admin/crm/tasks?limit=100' . $query);
            $response->assertStatus(200);

            return collect($response->json('data'))
                ->pluck('title')
                ->filter(fn ($t) => str_starts_with((string) $t, $marker))
                ->map(fn ($t) => substr((string) $t, strlen($marker) + 1))
                ->sort()->values()->all();
        };

        $this->assertSame(['due today', 'no date', 'overdue open'], $titles('&status=open'));
        $this->assertSame(['overdue open'], $titles('&status=overdue'));
        $this->assertSame(['cancelled', 'done late', 'due today', 'no date', 'overdue open'], $titles('&status=all'));
        $this->assertSame(['cancelled', 'done late', 'due today', 'no date', 'overdue open'], $titles(''));
        $this->assertSame(['done late'], $titles('&status=completed'));
    }

    public function test_list_tasks_filters_by_assignee(): void
    {
        $admin = User::factory()->forTenant($this->testTenantId)->admin()->create();
        $colleague = User::factory()->forTenant($this->testTenantId)->admin()->create();
        Sanctum::actingAs($admin);

        $marker = 'CrmTaskAssignee' . uniqid();
        $base = ['tenant_id' => $this->testTenantId, 'created_by' => $admin->id, 'status' => 'pending', 'created_at' => now(), 'updated_at' => now()];
        DB::table('coordinator_tasks')->insert([
            $base + ['title' => "$marker mine", 'assigned_to' => $admin->id],
            $base + ['title' => "$marker theirs", 'assigned_to' => $colleague->id],
        ]);

        $response = $this->apiGet('/v2/admin/crm/tasks?limit=100&assigned_to=' . $colleague->id);
        $response->assertStatus(200);
        $mine = collect($response->json('data'))->pluck('title')->filter(fn ($t) => str_starts_with((string) $t, $marker))->values()->all();

        $this->assertSame(["$marker theirs"], $mine);
    }

    // ================================================================
    // TAGS — GET /v2/admin/crm/tags
    // ================================================================

    public function test_list_tags_returns_200_for_admin(): void
    {
        $admin = User::factory()->forTenant($this->testTenantId)->admin()->create();
        Sanctum::actingAs($admin);

        $response = $this->apiGet('/v2/admin/crm/tags');

        $response->assertStatus(200);
        $response->assertJsonStructure(['data']);
    }

    /** Seeds two members with one tag and a third with another; returns [admin, marker, member ids]. */
    private function seedTags(): array
    {
        $admin = User::factory()->forTenant($this->testTenantId)->admin()->create();
        Sanctum::actingAs($admin);
        $marker = 'tagtest-' . substr(md5((string) microtime(true)), 0, 8);
        $members = [];
        for ($i = 0; $i < 3; $i++) {
            $members[] = User::factory()->forTenant($this->testTenantId)->create();
        }
        $base = ['tenant_id' => $this->testTenantId, 'created_by' => $admin->id];
        DB::table('member_tags')->insert([
            ['user_id' => $members[0]->id, 'tag' => "$marker garden", 'created_at' => now()->subDays(5)] + $base,
            ['user_id' => $members[1]->id, 'tag' => "$marker garden", 'created_at' => now()->subDay()] + $base,
            ['user_id' => $members[2]->id, 'tag' => "$marker lift", 'created_at' => now()->subDays(3)] + $base,
        ]);

        return [$admin, $marker, $members];
    }

    public function test_list_tags_summary_counts_members_and_says_when_each_tag_was_last_added(): void
    {
        [, $marker] = $this->seedTags();

        $response = $this->apiGet('/v2/admin/crm/tags');
        $response->assertStatus(200);

        $mine = collect($response->json('data'))
            ->filter(fn ($row) => str_starts_with((string) ($row['tag'] ?? ''), $marker))
            ->values();

        $this->assertCount(2, $mine);
        // Most members first.
        $this->assertSame("$marker garden", $mine[0]['tag']);
        $this->assertSame(2, (int) $mine[0]['member_count']);
        $this->assertSame("$marker lift", $mine[1]['tag']);
        $this->assertSame(1, (int) $mine[1]['member_count']);
        // last_added_at is the newest of the tag's rows (one day ago, not five).
        $this->assertNotEmpty($mine[0]['last_added_at']);
        $this->assertGreaterThan(now()->subDays(2)->timestamp, strtotime($mine[0]['last_added_at']));
    }

    public function test_list_tags_by_tag_returns_each_member_with_who_added_the_tag(): void
    {
        [$admin, $marker, $members] = $this->seedTags();

        $response = $this->apiGet('/v2/admin/crm/tags?tag=' . rawurlencode("$marker garden"));
        $response->assertStatus(200);

        $rows = $response->json('data');
        $this->assertCount(2, $rows);
        // Newest first.
        $this->assertSame($members[1]->id, (int) $rows[0]['user_id']);
        $this->assertSame($members[0]->id, (int) $rows[1]['user_id']);
        foreach ($rows as $row) {
            $this->assertSame("$marker garden", $row['tag']);
            $this->assertSame($admin->name, $row['created_by_name']);
            $this->assertArrayHasKey('user_name', $row);
            $this->assertArrayHasKey('user_avatar', $row);
        }
    }

    // ================================================================
    // EXPORT TAGS — GET /v2/admin/crm/export/tags
    // ================================================================

    public function test_export_tags_streams_a_csv_grouped_by_tag_for_admin(): void
    {
        [$admin, $marker, $members] = $this->seedTags();

        $response = $this->apiGet('/v2/admin/crm/export/tags');
        $response->assertStatus(200);
        $this->assertStringStartsWith('text/csv', (string) $response->headers->get('Content-Type'));

        $body = $response->streamedContent();
        $lines = array_values(array_filter(explode("\n", str_replace("\r", '', $body))));
        $this->assertSame('ID,Tag,"User ID","User Name",Email,"Added By",Added', $lines[0]);

        $mine = array_values(array_filter($lines, fn ($l) => str_contains($l, $marker)));
        $this->assertCount(3, $mine);
        // Grouped by tag (garden rows before lift), newest first inside a tag.
        $this->assertStringContainsString("$marker garden", $mine[0]);
        $this->assertStringContainsString("$marker garden", $mine[1]);
        $this->assertStringContainsString("$marker lift", $mine[2]);
        $this->assertStringContainsString($members[1]->email, $mine[0]);
        $this->assertStringContainsString($admin->name, $mine[0]);
    }

    public function test_export_tags_returns_403_for_regular_member(): void
    {
        $member = User::factory()->forTenant($this->testTenantId)->create();
        Sanctum::actingAs($member);

        $response = $this->apiGet('/v2/admin/crm/export/tags');

        $response->assertStatus(403);
    }

    // ================================================================
    // TIMELINE — GET /v2/admin/crm/timeline
    // ================================================================

    public function test_timeline_returns_200_for_admin(): void
    {
        $admin = User::factory()->forTenant($this->testTenantId)->admin()->create();
        Sanctum::actingAs($admin);

        // Disable the date window so this response-contract assertion does not
        // depend on a Carbon test clock leaked by an earlier test in the shard.
        $response = $this->apiGet('/v2/admin/crm/timeline?days=0');

        $response->assertStatus(200);
        $response->assertJsonStructure(['data' => ['*' => [
            'activity_type', 'description_code', 'description_params', 'created_at',
        ]]]);

        $signup = collect($response->json('data'))->firstWhere('activity_type', 'signup');
        $this->assertNotNull($signup);
        $this->assertSame('signup', $signup['description_code']);
        $this->assertSame([], $signup['description_params']);
        $this->assertArrayNotHasKey('description', $signup);
    }

    // ================================================================
    // EXPORT TIMELINE — GET /v2/admin/crm/export/timeline
    // ================================================================

    public function test_export_timeline_streams_the_same_activity_as_the_page_for_admin(): void
    {
        $admin = User::factory()->forTenant($this->testTenantId)->admin()->create();
        Sanctum::actingAs($admin);
        $marker = 'tltest-' . substr(md5((string) microtime(true)), 0, 8);
        // The factory derives `name` itself, so the member is recognised by id and by the name it got.
        $member = User::factory()->forTenant($this->testTenantId)->create();
        DB::table('listings')->insert([
            'tenant_id' => $this->testTenantId, 'user_id' => $member->id,
            'title' => "$marker listing", 'description' => 'x', 'type' => 'offer',
            'created_at' => now(), 'updated_at' => now(),
        ]);

        // days=0 (all time) so a Carbon test clock leaked by another test cannot hide the rows.
        $response = $this->apiGet('/v2/admin/crm/export/timeline?days=0&type=listing_created');
        $response->assertStatus(200);
        $this->assertStringStartsWith('text/csv', (string) $response->headers->get('Content-Type'));
        $this->assertStringContainsString('crm-activity-', (string) $response->headers->get('Content-Disposition'));

        $lines = array_values(array_filter(explode("\n", str_replace("\r", '', $response->streamedContent()))));
        $this->assertSame('Date,Activity,"User ID","User Name",Details', $lines[0]);

        $mine = array_values(array_filter($lines, fn ($l) => str_contains($l, "$marker listing")));
        $this->assertCount(1, $mine);
        $this->assertStringContainsString('listing_created', $mine[0]);
        $this->assertStringContainsString(',' . $member->id . ',', $mine[0]);
        $this->assertStringContainsString($member->fresh()->name, $mine[0]);
        // The type filter applies to the export too: no sign-up rows in a listing export.
        $this->assertSame([], array_values(array_filter($lines, fn ($l) => str_contains($l, ',signup,'))));
    }

    public function test_export_timeline_honours_the_member_filter(): void
    {
        $admin = User::factory()->forTenant($this->testTenantId)->admin()->create();
        Sanctum::actingAs($admin);
        $wanted = User::factory()->forTenant($this->testTenantId)->create();
        $other = User::factory()->forTenant($this->testTenantId)->create();

        $response = $this->apiGet('/v2/admin/crm/export/timeline?days=0&type=signup&user_id=' . $wanted->id);
        $response->assertStatus(200);

        $body = $response->streamedContent();
        $this->assertStringContainsString(',' . $wanted->id . ',', $body);
        $this->assertStringContainsString($wanted->fresh()->name, $body);
        $this->assertStringNotContainsString(',' . $other->id . ',', $body);
    }

    public function test_export_timeline_rejects_an_unknown_activity_type(): void
    {
        $admin = User::factory()->forTenant($this->testTenantId)->admin()->create();
        Sanctum::actingAs($admin);

        $this->apiGet('/v2/admin/crm/export/timeline?type=bogus')->assertStatus(400);
    }

    public function test_export_timeline_returns_403_for_regular_member(): void
    {
        $member = User::factory()->forTenant($this->testTenantId)->create();
        Sanctum::actingAs($member);

        $this->apiGet('/v2/admin/crm/export/timeline')->assertStatus(403);
    }

    // ================================================================
    // EXPORT NOTES — GET /v2/admin/crm/export/notes
    // ================================================================

    public function test_export_notes_returns_200_for_admin(): void
    {
        $admin = User::factory()->forTenant($this->testTenantId)->admin()->create();
        Sanctum::actingAs($admin);

        $response = $this->apiGet('/v2/admin/crm/export/notes');

        $response->assertStatus(200);
    }

    public function test_export_notes_returns_403_for_regular_member(): void
    {
        $member = User::factory()->forTenant($this->testTenantId)->create();
        Sanctum::actingAs($member);

        $response = $this->apiGet('/v2/admin/crm/export/notes');

        $response->assertStatus(403);
    }
}
