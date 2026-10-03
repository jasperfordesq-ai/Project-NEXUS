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
 * Feature tests for AdminBrokerController.
 *
 * Covers dashboard, exchanges, risk tags, messages, monitoring, and configuration.
 */
class AdminBrokerControllerTest extends TestCase
{
    use DatabaseTransactions;

    // ================================================================
    // DASHBOARD — GET /v2/admin/broker/dashboard
    // ================================================================

    public function test_dashboard_returns_200_for_admin(): void
    {
        $admin = User::factory()->forTenant($this->testTenantId)->admin()->create();
        Sanctum::actingAs($admin);

        $response = $this->apiGet('/v2/admin/broker/dashboard');

        $response->assertStatus(200);
        $response->assertJsonStructure(['data' => ['vetting_review_requests']]);
        $response->assertJsonMissingPath('data.vetting_pending');
        $response->assertJsonMissingPath('data.vetting_expiring');
    }

    /**
     * Every broker-panel page shows a notice while the community has no
     * safeguarding jurisdiction. The panel reads it from this endpoint because
     * every broker-panel role can — coordinators cannot read the vetting policy.
     */
    public function test_dashboard_reports_whether_the_safeguarding_jurisdiction_is_set(): void
    {
        DB::table('tenant_safeguarding_settings')->where('tenant_id', $this->testTenantId)->delete();
        $jurisdictions = app(\App\Services\SafeguardingJurisdictionService::class);
        $jurisdictions->forget($this->testTenantId);

        foreach (['broker', 'coordinator'] as $role) {
            Sanctum::actingAs(User::factory()->forTenant($this->testTenantId)->create(['role' => $role, 'status' => 'active']));
            $this->apiGet('/v2/admin/broker/dashboard')
                ->assertOk()
                ->assertJsonPath('data.safeguarding_jurisdiction_configured', false);
        }

        $admin = User::factory()->forTenant($this->testTenantId)->admin()->create();
        DB::table('tenant_safeguarding_settings')->insert([
            'tenant_id' => $this->testTenantId,
            'jurisdiction' => 'ireland',
            'policy_version' => 'safeguarded-contact-v1:test',
            'configured_by' => $admin->id,
            'configured_at' => now(),
            'created_at' => now(),
            'updated_at' => now(),
        ]);
        $jurisdictions->forget($this->testTenantId);

        Sanctum::actingAs($admin);
        $this->apiGet('/v2/admin/broker/dashboard')
            ->assertOk()
            ->assertJsonPath('data.safeguarding_jurisdiction_configured', true);
    }

    public function test_dashboard_does_not_count_false_safeguarding_checkbox_as_a_flag(): void
    {
        $admin = User::factory()->forTenant($this->testTenantId)->admin()->create();
        $member = User::factory()->forTenant($this->testTenantId)->create(['status' => 'active']);
        Sanctum::actingAs($admin);

        $baseline = $this->apiGet('/v2/admin/broker/dashboard');
        $baseline->assertOk();
        $baselineCount = $baseline->json('data.onboarding_safeguarding_flags');
        $this->assertIsInt($baselineCount);

        $optionId = DB::table('tenant_safeguarding_options')->insertGetId([
            'tenant_id' => $this->testTenantId,
            'option_key' => 'false_dashboard_preference_' . uniqid(),
            'option_type' => 'checkbox',
            'label' => 'False dashboard preference',
            'is_active' => 1,
            'sort_order' => 0,
            'triggers' => json_encode(['requires_vetted_interaction' => true]),
            'created_at' => now(),
            'updated_at' => now(),
        ]);
        DB::table('user_safeguarding_preferences')->insert([
            'tenant_id' => $this->testTenantId,
            'user_id' => $member->id,
            'option_id' => $optionId,
            'selected_value' => '0',
            'consent_given_at' => now(),
            'created_at' => now(),
        ]);

        $this->apiGet('/v2/admin/broker/dashboard')
            ->assertOk()
            ->assertJsonPath('data.onboarding_safeguarding_flags', $baselineCount);
    }

    // ----------------------------------------------------------------
    // Every dashboard tile must count what the page it links to lists.
    // Each test seeds a row the OLD count got wrong, then compares the
    // tile with the linked list read through its own endpoint.
    // ----------------------------------------------------------------

    public function test_safeguarding_flags_tile_matches_members_not_yet_seen_and_drops_when_seen(): void
    {
        $broker = User::factory()->forTenant($this->testTenantId)->create(['role' => 'broker', 'status' => 'active']);
        Sanctum::actingAs($broker);

        // An option whose triggers column is set but switches nothing on. The
        // old count included it (`triggers IS NOT NULL`); the page lists the
        // member, so it now counts as a support need to look at.
        $member = User::factory()->forTenant($this->testTenantId)->create(['status' => 'active']);
        $optionId = DB::table('tenant_safeguarding_options')->insertGetId([
            'tenant_id' => $this->testTenantId,
            'option_key' => 'tile_need_' . uniqid(),
            'option_type' => 'checkbox',
            'label' => 'Tile need',
            'is_active' => 1,
            'sort_order' => 0,
            'triggers' => json_encode(['restricts_messaging' => true]),
            'created_at' => now(),
            'updated_at' => now(),
        ]);
        DB::table('user_safeguarding_preferences')->insert([
            'tenant_id' => $this->testTenantId,
            'user_id' => $member->id,
            'option_id' => $optionId,
            'selected_value' => '1',
            'consent_given_at' => now()->subMinute(),
            'created_at' => now(),
        ]);

        $listUnseen = fn () => count(array_filter(
            $this->apiGet('/v2/admin/safeguarding/member-preferences')->assertOk()->json('data'),
            fn (array $entry) => $entry['needs_review'] === true,
        ));

        $before = $this->apiGet('/v2/admin/broker/dashboard')->assertOk()->json('data.onboarding_safeguarding_flags');
        $this->assertSame($listUnseen(), $before);

        $this->apiPost("/v2/admin/safeguarding/member-preferences/{$member->id}/seen")->assertOk();

        // Until October 2026 nothing could make this number go down.
        $after = $this->apiGet('/v2/admin/broker/dashboard')->assertOk()->json('data.onboarding_safeguarding_flags');
        $this->assertSame($before - 1, $after);
        $this->assertSame($listUnseen(), $after);
    }

    /**
     * "What needs you now" left out new members waiting for approval although
     * approving them is a broker's daily job. The tile opens Members → Pending,
     * so it must equal that list's total, read through the list's own endpoint.
     */
    public function test_pending_members_tile_matches_the_pending_members_list(): void
    {
        $broker = User::factory()->forTenant($this->testTenantId)->create(['role' => 'broker', 'status' => 'active']);
        Sanctum::actingAs($broker);

        User::factory()->forTenant($this->testTenantId)->create(['is_approved' => 0, 'status' => 'pending']);
        User::factory()->forTenant($this->testTenantId)->create(['is_approved' => 0, 'status' => 'pending']);
        // Approved and another community's pending member: neither is listed.
        User::factory()->forTenant($this->testTenantId)->create(['is_approved' => 1, 'status' => 'active']);
        User::factory()->forTenant(999)->create(['is_approved' => 0, 'status' => 'pending']);

        $listed = $this->apiGet('/v2/admin/users?status=pending&limit=1')->assertOk()->json('meta.total');
        $tile = $this->apiGet('/v2/admin/broker/dashboard')->assertOk()->json('data.pending_members');

        $this->assertNotNull($tile, 'The dashboard must report members waiting for approval.');
        $this->assertGreaterThanOrEqual(2, $listed);
        $this->assertSame($listed, $tile);
    }

    /**
     * Open member reports were not on the broker dashboard at all. The tile
     * opens Reports → Pending, whose filter treats legacy 'open' and 'pending'
     * as the same state and withholds reports the broker is a party to, so the
     * count must equal that list's total.
     */
    public function test_open_reports_tile_matches_the_pending_reports_list(): void
    {
        $broker = User::factory()->forTenant($this->testTenantId)->create(['role' => 'broker', 'status' => 'active']);
        $reporter = User::factory()->forTenant($this->testTenantId)->create();
        Sanctum::actingAs($broker);

        $subject = User::factory()->forTenant($this->testTenantId)->create();
        $report = fn (string $status, int $tenantId, int $about) => DB::table('reports')->insert([
            'tenant_id' => $tenantId, 'reporter_id' => $reporter->id,
            'target_type' => 'user', 'target_id' => $about,
            'reason' => 'safety_concern', 'status' => $status,
            'created_at' => now(), 'updated_at' => now(),
        ]);
        $report('open', $this->testTenantId, $subject->id);
        $report('open', $this->testTenantId, $subject->id);
        $report('resolved', $this->testTenantId, $subject->id);
        $report('dismissed', $this->testTenantId, $subject->id);
        $report('open', 999, $subject->id);
        // A complaint about the broker: withheld from their queue (F-454), so
        // it must not reach their count either (F-549).
        $report('open', $this->testTenantId, $broker->id);

        $listed = $this->apiGet('/v2/admin/reports?status=pending&limit=1')->assertOk()->json('meta.total');
        $tile = $this->apiGet('/v2/admin/broker/dashboard')->assertOk()->json('data.open_reports');

        $this->assertNotNull($tile, 'The dashboard must report open member reports.');
        $this->assertGreaterThanOrEqual(2, $listed);
        $this->assertSame($listed, $tile);
    }

    public function test_unreviewed_messages_tile_matches_the_unreviewed_queue(): void
    {
        $broker = User::factory()->forTenant($this->testTenantId)->create(['role' => 'broker', 'status' => 'active']);
        $a = User::factory()->forTenant($this->testTenantId)->create();
        $b = User::factory()->forTenant($this->testTenantId)->create();
        // A conversation the broker is a party to: withheld from their queue
        // (F-436), and until now still counted on their tile.
        $this->insertMessageCopy($broker->id, $a->id);
        $this->insertMessageCopy($a->id, $b->id);
        Sanctum::actingAs($broker);

        $tile = $this->apiGet('/v2/admin/broker/dashboard')->assertOk()->json('data.unreviewed_messages');
        $list = $this->apiGet('/v2/admin/broker/messages?filter=unreviewed&per_page=100')->assertOk();
        $badge = $this->apiGet('/v2/admin/broker/messages/unreviewed-count')->assertOk()->json('data.count');

        $this->assertSame((int) $list->json('meta.total'), $tile);
        $this->assertSame($tile, $badge, 'The Messages page header must agree with its own queue.');
    }

    public function test_high_risk_tile_matches_the_elevated_risk_tag_list(): void
    {
        $admin = User::factory()->forTenant($this->testTenantId)->admin()->create();
        $owner = User::factory()->forTenant($this->testTenantId)->create();
        $levels = ['critical', 'high', 'medium'];
        $ids = [];
        foreach ($levels as $level) {
            $listingId = $this->makeListingId($this->testTenantId, $owner->id);
            $ids[$level] = $listingId;
            DB::table('listing_risk_tags')->insert([
                'tenant_id' => $this->testTenantId,
                'listing_id' => $listingId,
                'risk_level' => $level,
                'risk_category' => 'other',
                'tagged_by' => $admin->id,
                'created_at' => now(),
                'updated_at' => now(),
            ]);
        }
        Sanctum::actingAs($admin);

        $tile = $this->apiGet('/v2/admin/broker/dashboard')->assertOk()->json('data.high_risk_listings');
        $rows = $this->apiGet('/v2/admin/broker/risk-tags?risk_level=elevated')->assertOk()->json('data');
        $listed = array_map('intval', array_column($rows, 'listing_id'));

        // The tile used to link to `level=high`, which hid every critical tag.
        $this->assertContains($ids['critical'], $listed);
        $this->assertContains($ids['high'], $listed);
        $this->assertNotContains($ids['medium'], $listed);
        $this->assertSame(count($rows), $tile);
    }

    public function test_safeguarding_alerts_tile_counts_the_unreviewed_flagged_messages_it_opens(): void
    {
        $admin = User::factory()->forTenant($this->testTenantId)->admin()->create();
        $a = User::factory()->forTenant($this->testTenantId)->create();
        $b = User::factory()->forTenant($this->testTenantId)->create();
        // Two unreviewed flagged messages against one fraud alert, so the old
        // count (fraud alerts) and the new one (flagged messages) differ.
        $this->insertMessageCopy($a->id, $b->id, ['flagged' => true]);
        $this->insertMessageCopy($b->id, $a->id, ['flagged' => true]);
        $this->insertMessageCopy($b->id, $a->id, ['flagged' => true, 'reviewed_at' => now(), 'reviewed_by' => $admin->id]);
        $this->insertMessageCopy($a->id, $b->id, ['flagged' => false]);
        // A transfer-fraud alert: the tile used to count these, but no broker
        // page shows them (they are in the admin panel's Fraud alerts).
        DB::table('abuse_alerts')->insert([
            'tenant_id' => $this->testTenantId,
            'alert_type' => 'large_transfer',
            'severity' => 'critical',
            'status' => 'new',
            'user_id' => $a->id,
            'created_at' => now(),
        ]);
        Sanctum::actingAs($admin);

        $tile = $this->apiGet('/v2/admin/broker/dashboard')->assertOk()->json('data.safeguarding_alerts');
        // Since October 2026 the card opens the Messages queue's "Urgent"
        // view (the separate safeguarding Flagged messages page was merged
        // into Messages).
        $urgent = $this->apiGet('/v2/admin/broker/messages?filter=urgent&per_page=100')->assertOk();

        $this->assertSame((int) $urgent->json('meta.total'), $tile);
        foreach ($urgent->json('data') as $row) {
            $this->assertTrue($row['flagged']);
            $this->assertNull($row['reviewed_at']);
        }
    }

    public function test_messages_queue_searches_message_text_and_names(): void
    {
        $broker = User::factory()->forTenant($this->testTenantId)->create(['role' => 'broker', 'status' => 'active']);
        $sender = User::factory()->forTenant($this->testTenantId)->create(['first_name' => 'Zebedee', 'last_name' => 'Quarrington']);
        $other = User::factory()->forTenant($this->testTenantId)->create();
        $third = User::factory()->forTenant($this->testTenantId)->create();
        $byText = $this->insertMessageCopy($other->id, $third->id, ['message_body' => 'Can you help with the xylophone-lesson?']);
        $byName = $this->insertMessageCopy($sender->id, $other->id);
        $neither = $this->insertMessageCopy($other->id, $third->id, ['message_body' => 'Nothing to see']);
        Sanctum::actingAs($broker);

        $ids = fn (string $q) => array_map('intval', array_column(
            $this->apiGet('/v2/admin/broker/messages?per_page=100&q=' . urlencode($q))->assertOk()->json('data'),
            'id',
        ));

        $this->assertContains($byText, $ids('xylophone'));
        $this->assertNotContains($neither, $ids('xylophone'));
        $this->assertContains($byName, $ids('Quarrington'));
        // A LIKE wildcard typed by the broker is matched literally.
        $this->assertSame([], $ids('%%%zz-no-such-thing'));
    }

    public function test_vetting_tile_matches_the_review_requested_filter(): void
    {
        $admin = User::factory()->forTenant($this->testTenantId)->admin()->create();
        $member = User::factory()->forTenant($this->testTenantId)->create(['status' => 'active']);
        $policy = app(\App\Services\SafeguardingJurisdictionService::class)->getPolicy($this->testTenantId);

        $insert = function (array $codes) use ($member, $admin): void {
            DB::table('safeguarding_vetting_review_requests')->insert(array_merge([
                'tenant_id' => $this->testTenantId,
                'user_id' => $member->id,
                'jurisdiction' => 'IE',
                'purpose_code' => 'safeguarded_member_contact',
                'scope_type' => 'tenant',
                'scope_identifier' => '',
                'status' => 'pending',
                'request_source' => 'policy_rotation',
                'requested_by' => $admin->id,
                'requested_at' => now(),
                'created_at' => now(),
                'updated_at' => now(),
            ], $codes));
        };
        // A request raised under a policy that is no longer the tenant's: the
        // Vetting page never lists it, and the tile used to count it.
        $insert([
            'scheme_code' => 'retired_scheme',
            'attestation_code' => 'retired_attestation',
            'policy_version' => 'retired:' . uniqid(),
        ]);
        if ($policy['scheme_code'] !== null && $policy['attestation_code'] !== null && $policy['policy_version'] !== null) {
            $insert([
                'jurisdiction' => $policy['jurisdiction'],
                'scheme_code' => $policy['scheme_code'],
                'attestation_code' => $policy['attestation_code'],
                'purpose_code' => $policy['purpose_code'],
                'scope_type' => $policy['scope_type'],
                'scope_identifier' => $policy['scope_identifier'],
                'policy_version' => $policy['policy_version'],
            ]);
        }
        Sanctum::actingAs($admin);

        $tile = $this->apiGet('/v2/admin/broker/dashboard')->assertOk()->json('data.vetting_review_requests');
        $list = $this->apiGet('/v2/admin/vetting?status=review_requested&per_page=100')->assertOk();
        $listed = $list->json('meta.pagination.total') ?? $list->json('meta.total');

        $this->assertSame((int) $listed, $tile);
    }

    /**
     * Each queue tile now says how long its oldest item has been waiting. That
     * timestamp must be the one a broker reaches by opening the tile's list and
     * sorting oldest first — same WHERE, same self-exclusions (F-436, F-454,
     * F-549) — so the card can never promise an item the list hides.
     */
    public function test_oldest_waiting_matches_the_oldest_row_of_each_queue(): void
    {
        $broker = User::factory()->forTenant($this->testTenantId)->create(['role' => 'broker', 'status' => 'active']);
        $a = User::factory()->forTenant($this->testTenantId)->create();
        $b = User::factory()->forTenant($this->testTenantId)->create();
        $listingId = $this->makeListingId($this->testTenantId, $b->id);
        $iso = fn ($value) => \Carbon\Carbon::parse($value)->toIso8601String();
        $at = fn (int $daysAgo) => now()->subDays($daysAgo)->format('Y-m-d H:i:s');

        // Exchanges: the disputed one is the oldest in the queue; the completed
        // one, older still, is not in the queue at all.
        foreach ([['pending_broker', 3], ['disputed', 11], ['completed', 50]] as [$status, $daysAgo]) {
            DB::table('exchange_requests')->insert([
                'tenant_id' => $this->testTenantId, 'listing_id' => $listingId,
                'requester_id' => $a->id, 'provider_id' => $b->id, 'proposed_hours' => 1.0,
                'status' => $status, 'created_at' => $at($daysAgo), 'updated_at' => $at($daysAgo),
            ]);
        }
        // Messages: the broker's own conversation is the oldest unreviewed copy
        // but is withheld from their queue (F-436), so it must not be the answer.
        $this->insertMessageCopy($broker->id, $a->id, ['created_at' => $at(30)]);
        $this->insertMessageCopy($a->id, $b->id, ['created_at' => $at(9)]);
        $this->insertMessageCopy($a->id, $b->id, ['created_at' => $at(5), 'flagged' => true]);
        $this->insertMessageCopy($a->id, $b->id, ['created_at' => $at(40), 'reviewed_at' => now(), 'reviewed_by' => $broker->id]);
        // Members waiting for approval.
        User::factory()->forTenant($this->testTenantId)->create(['is_approved' => 0, 'status' => 'pending', 'created_at' => $at(12)]);
        User::factory()->forTenant($this->testTenantId)->create(['is_approved' => 0, 'status' => 'pending', 'created_at' => $at(2)]);
        // Reports: the complaint about the broker is the oldest but is withheld
        // from their queue (F-454), so it must not be the answer (F-549).
        foreach ([[$b->id, 7], [$broker->id, 45]] as [$about, $daysAgo]) {
            DB::table('reports')->insert([
                'tenant_id' => $this->testTenantId, 'reporter_id' => $a->id,
                'target_type' => 'user', 'target_id' => $about, 'reason' => 'safety_concern',
                'status' => 'open', 'created_at' => $at($daysAgo), 'updated_at' => $at($daysAgo),
            ]);
        }
        // Vetting: a request under a retired policy is the oldest, but the
        // Vetting page never lists it.
        $policy = app(\App\Services\SafeguardingJurisdictionService::class)->getPolicy($this->testTenantId);
        $policyIsSet = $policy['scheme_code'] !== null && $policy['attestation_code'] !== null && $policy['policy_version'] !== null;
        $vetting = function (array $codes, int $daysAgo) use ($b, $broker, $at): void {
            DB::table('safeguarding_vetting_review_requests')->insert(array_merge([
                'tenant_id' => $this->testTenantId, 'user_id' => $b->id, 'jurisdiction' => 'IE',
                'purpose_code' => 'safeguarded_member_contact', 'scope_type' => 'tenant', 'scope_identifier' => '',
                'status' => 'pending', 'request_source' => 'policy_rotation', 'requested_by' => $broker->id,
                'requested_at' => $at($daysAgo), 'created_at' => $at($daysAgo), 'updated_at' => $at($daysAgo),
            ], $codes));
        };
        $vetting(['scheme_code' => 'retired_scheme', 'attestation_code' => 'retired_attestation', 'policy_version' => 'retired:' . uniqid()], 60);
        if ($policyIsSet) {
            $vetting([
                'jurisdiction' => $policy['jurisdiction'], 'scheme_code' => $policy['scheme_code'],
                'attestation_code' => $policy['attestation_code'], 'purpose_code' => $policy['purpose_code'],
                'scope_type' => $policy['scope_type'], 'scope_identifier' => $policy['scope_identifier'],
                'policy_version' => $policy['policy_version'],
            ], 15);
        }
        Sanctum::actingAs($broker);

        $oldest = $this->apiGet('/v2/admin/broker/dashboard')->assertOk()->json('data.oldest_waiting');
        $this->assertIsArray($oldest);

        $firstOf = fn (string $uri, string $column) => $iso($this->apiGet($uri)->assertOk()->json("data.0.{$column}"));
        $this->assertSame($firstOf('/v2/admin/broker/exchanges?status=needs_action&sort=oldest&per_page=1', 'created_at'), $oldest['pending_exchanges']);
        $this->assertSame($firstOf('/v2/admin/broker/messages?filter=unreviewed&sort=oldest&per_page=1', 'created_at'), $oldest['unreviewed_messages']);
        $this->assertSame($firstOf('/v2/admin/broker/messages?filter=urgent&sort=oldest&per_page=1', 'created_at'), $oldest['safeguarding_alerts']);
        $this->assertSame($firstOf('/v2/admin/users?status=pending&sort=created_at&order=asc&limit=1', 'created_at'), $oldest['pending_members']);
        $this->assertNotSame($iso($at(30)), $oldest['unreviewed_messages'], 'The broker\'s own conversation must not set the age of their queue.');

        $reports = $this->apiGet('/v2/admin/reports?status=pending&limit=100')->assertOk()->json('data');
        $oldestReport = min(array_map($iso, array_column($reports, 'created_at')));
        $this->assertSame($oldestReport, $oldest['open_reports']);
        $this->assertNotSame($iso($at(45)), $oldest['open_reports'], 'A complaint about the broker must not set the age of their queue.');

        $vettingRows = $this->apiGet('/v2/admin/vetting?status=review_requested&per_page=100')->assertOk()->json('data');
        $requested = array_map($iso, array_filter(array_column(
            array_filter($vettingRows, fn (array $row) => ($row['review_status'] ?? null) === 'pending'),
            'requested_at',
        )));
        $this->assertSame($requested === [] ? null : min($requested), $oldest['vetting_review_requests']);
        $this->assertNotSame($iso($at(60)), $oldest['vetting_review_requests'], 'A request under a retired policy must not set the age of the queue.');
    }

    /**
     * The tiles' sparklines show how many items arrived each day for the last
     * fortnight, and the delta compares that fortnight with the one before. Run
     * in a brand-new community so the counts are exact.
     */
    public function test_trends_count_items_created_per_day_over_the_last_fortnight(): void
    {
        $tenantId = (int) DB::table('tenants')->insertGetId([
            'name' => 'Trend fixture community', 'slug' => 'trend-fixture-' . uniqid(), 'domain' => null,
            'is_active' => true, 'depth' => 0, 'allows_subtenants' => false, 'created_at' => now(), 'updated_at' => now(),
        ]);
        $this->withTenant($tenantId);
        // The factory spreads created_at over the past year; these three sign up today.
        $broker = User::factory()->forTenant($tenantId)->create(['role' => 'broker', 'status' => 'active', 'is_approved' => 1, 'created_at' => now()]);
        $a = User::factory()->forTenant($tenantId)->create(['is_approved' => 1, 'created_at' => now()]);
        $b = User::factory()->forTenant($tenantId)->create(['is_approved' => 1, 'created_at' => now()]);
        $listingId = $this->makeListingId($tenantId, $b->id);
        $at = fn (int $daysAgo) => now()->subDays($daysAgo)->setTime(12, 0)->format('Y-m-d H:i:s');

        // Exchanges: 1 today, 2 yesterday, 1 in the previous fortnight, 1 before both windows.
        foreach ([0, 1, 1, 20, 40] as $daysAgo) {
            DB::table('exchange_requests')->insert([
                'tenant_id' => $tenantId, 'listing_id' => $listingId, 'requester_id' => $a->id, 'provider_id' => $b->id,
                'proposed_hours' => 1.0, 'status' => 'pending_broker', 'created_at' => $at($daysAgo), 'updated_at' => $at($daysAgo),
            ]);
        }
        // Messages: 2 today of which one is the broker's own conversation (F-436: not theirs to see).
        $this->insertMessageCopy($a->id, $b->id, ['tenant_id' => $tenantId, 'created_at' => $at(0)]);
        $this->insertMessageCopy($broker->id, $a->id, ['tenant_id' => $tenantId, 'created_at' => $at(0)]);
        Sanctum::actingAs($broker);

        $trends = $this->apiGet('/v2/admin/broker/dashboard')->assertOk()->json('data.trends');
        $this->assertIsArray($trends);

        $exchanges = $trends['pending_exchanges'];
        $this->assertCount(14, $exchanges['points']);
        $this->assertSame(1, $exchanges['points'][13], 'The last point is today.');
        $this->assertSame(2, $exchanges['points'][12], 'The point before it is yesterday.');
        $this->assertSame(3, array_sum($exchanges['points']));
        $this->assertSame(200, $exchanges['delta'], '3 this fortnight against 1 the fortnight before.');

        $messages = $trends['unreviewed_messages'];
        $this->assertSame(1, $messages['points'][13], 'The broker\'s own conversation is not counted.');
        $this->assertNull($messages['delta'], 'No previous fortnight to compare with.');

        // Three members signed up today (the broker and two members); nobody before.
        $this->assertSame(3, $trends['pending_members']['points'][13]);
        $this->assertNull($trends['pending_members']['delta']);
    }

    /**
     * "My week": what the viewer themselves decided in the last seven days —
     * never another broker's work, never anything older.
     */
    public function test_my_week_counts_only_the_viewers_decisions_from_the_last_seven_days(): void
    {
        $broker = User::factory()->forTenant($this->testTenantId)->create(['role' => 'broker', 'status' => 'active']);
        $other = User::factory()->forTenant($this->testTenantId)->create(['role' => 'broker', 'status' => 'active']);
        $a = User::factory()->forTenant($this->testTenantId)->create();
        $b = User::factory()->forTenant($this->testTenantId)->create();
        $listingId = $this->makeListingId($this->testTenantId, $b->id);
        $at = fn (int $daysAgo) => now()->subDays($daysAgo)->format('Y-m-d H:i:s');

        // Messages: one reviewed by the viewer this week, one too long ago, one by someone else.
        $this->insertMessageCopy($a->id, $b->id, ['reviewed_by' => $broker->id, 'reviewed_at' => $at(1)]);
        $this->insertMessageCopy($a->id, $b->id, ['reviewed_by' => $broker->id, 'reviewed_at' => $at(10)]);
        $this->insertMessageCopy($a->id, $b->id, ['reviewed_by' => $other->id, 'reviewed_at' => $at(1)]);
        // Matches: one decided by the viewer this week.
        DB::table('match_approvals')->insert([
            'tenant_id' => $this->testTenantId, 'user_id' => $a->id, 'listing_id' => $listingId, 'listing_owner_id' => $b->id,
            'match_score' => 70, 'status' => 'approved', 'submitted_at' => $at(3), 'reviewed_by' => $broker->id, 'reviewed_at' => $at(2),
        ]);
        // Vetting: one re-check handled by the viewer this week.
        DB::table('safeguarding_vetting_review_requests')->insert([
            'tenant_id' => $this->testTenantId, 'user_id' => $b->id, 'jurisdiction' => 'IE', 'scheme_code' => 'scheme',
            'attestation_code' => 'attestation', 'purpose_code' => 'safeguarded_member_contact', 'scope_type' => 'tenant',
            'scope_identifier' => '', 'policy_version' => 'v1', 'status' => 'resolved', 'request_source' => 'policy_rotation',
            'requested_by' => $other->id, 'requested_at' => $at(6), 'handled_by' => $broker->id, 'handled_at' => $at(3),
            'created_at' => $at(6), 'updated_at' => $at(3),
        ]);
        // Exchanges: two history rows on one exchange count once; an older decision does not count.
        $exchange = fn () => (int) DB::table('exchange_requests')->insertGetId([
            'tenant_id' => $this->testTenantId, 'listing_id' => $listingId, 'requester_id' => $a->id, 'provider_id' => $b->id,
            'proposed_hours' => 1.0, 'status' => 'accepted', 'created_at' => now(), 'updated_at' => now(),
        ]);
        $recent = $exchange();
        $stale = $exchange();
        $history = fn (int $exchangeId, string $when) => DB::table('exchange_history')->insert([
            'tenant_id' => $this->testTenantId, 'exchange_id' => $exchangeId, 'action' => 'status_changed',
            'actor_id' => $broker->id, 'actor_role' => 'broker', 'old_status' => 'pending_broker', 'new_status' => 'accepted', 'created_at' => $when,
        ]);
        $history($recent, $at(1));
        $history($recent, $at(1));
        $history($stale, $at(9));
        Sanctum::actingAs($broker);

        $week = $this->apiGet('/v2/admin/broker/dashboard')->assertOk()->json('data.my_week');

        $this->assertSame([
            'exchanges_decided' => 1,
            'messages_reviewed' => 1,
            'matches_decided' => 1,
            'vetting_handled' => 1,
            'total' => 4,
        ], $week);
    }

    /**
     * The activity feed left out match decisions, dispute settlements and every
     * member / report / moderation action, and could not link a row to the
     * member it was about. It also had a fixed length of 20, so "See all"
     * needs a longer page without a second route.
     */
    public function test_recent_activity_covers_member_and_moderation_actions_and_can_be_paged_on_its_own(): void
    {
        $broker = User::factory()->forTenant($this->testTenantId)->create(['role' => 'broker', 'status' => 'active']);
        $member = User::factory()->forTenant($this->testTenantId)->create();
        DB::table('org_audit_log')->insert([
            'tenant_id' => $this->testTenantId, 'user_id' => $broker->id, 'target_user_id' => $member->id,
            'action' => 'match_approved', 'details' => json_encode(['approval_id' => 7]), 'created_at' => now()->subMinutes(2),
        ]);
        DB::table('activity_log')->insert([
            'tenant_id' => $this->testTenantId, 'user_id' => $broker->id, 'action' => 'admin_approve_user',
            'action_type' => 'admin', 'details' => "Approved user #{$member->id}", 'created_at' => now()->subMinute(),
        ]);
        Sanctum::actingAs($broker);

        $feed = $this->apiGet('/v2/admin/broker/dashboard')->assertOk()->json('data.recent_activity');
        $byAction = array_column($feed, null, 'action_type');

        $this->assertArrayHasKey('match_approved', $byAction);
        $this->assertSame('audit', $byAction['match_approved']['source']);
        $this->assertSame($member->id, (int) $byAction['match_approved']['target_user_id']);
        $this->assertArrayHasKey('admin_approve_user', $byAction);
        $this->assertSame('activity', $byAction['admin_approve_user']['source']);
        $this->assertNull($byAction['admin_approve_user']['target_user_id']);

        $this->assertCount(1, $this->apiGet('/v2/admin/broker/dashboard?activity_limit=1')->assertOk()->json('data.recent_activity'));

        $activityOnly = $this->apiGet('/v2/admin/broker/dashboard?only=activity&activity_limit=100')->assertOk();
        $this->assertGreaterThanOrEqual(2, count($activityOnly->json('data.recent_activity')));
        $activityOnly->assertJsonMissingPath('data.pending_exchanges');
        $activityOnly->assertJsonMissingPath('data.trends');
    }

    public function test_dashboard_returns_403_for_regular_member(): void
    {
        $member = User::factory()->forTenant($this->testTenantId)->create();
        Sanctum::actingAs($member);

        $response = $this->apiGet('/v2/admin/broker/dashboard');

        $response->assertStatus(403);
    }

    public function test_dashboard_returns_401_for_unauthenticated(): void
    {
        $response = $this->apiGet('/v2/admin/broker/dashboard');

        $response->assertStatus(401);
    }

    // ================================================================
    // EXCHANGES — GET /v2/admin/broker/exchanges
    // ================================================================

    public function test_exchanges_returns_200_for_admin(): void
    {
        $admin = User::factory()->forTenant($this->testTenantId)->admin()->create();
        Sanctum::actingAs($admin);

        $response = $this->apiGet('/v2/admin/broker/exchanges');

        $response->assertStatus(200);
        $response->assertJsonStructure(['data']);
    }

    public function test_exchanges_returns_403_for_regular_member(): void
    {
        $member = User::factory()->forTenant($this->testTenantId)->create();
        Sanctum::actingAs($member);

        $response = $this->apiGet('/v2/admin/broker/exchanges');

        $response->assertStatus(403);
    }

    /**
     * The dashboard's "Pending Exchanges" card counts exchanges awaiting broker
     * approval AND disputed exchanges, and links to the list. The list used to be
     * filterable by one status only, so the card linked to `pending_broker` and a
     * tenant whose queue held only disputes saw "4" on the card and an empty list.
     * `needs_action` is the list-side twin of that count; the two must agree.
     */
    public function test_exchanges_needs_action_filter_matches_the_dashboard_count(): void
    {
        $admin = User::factory()->forTenant($this->testTenantId)->admin()->create();
        $requester = User::factory()->forTenant($this->testTenantId)->create();
        $provider = User::factory()->forTenant($this->testTenantId)->create();
        $listingId = $this->makeListingId($this->testTenantId, $provider->id);

        $ids = [];
        foreach (['pending_broker', 'disputed', 'completed', 'accepted'] as $status) {
            $ids[$status] = (int) DB::table('exchange_requests')->insertGetId([
                'tenant_id'      => $this->testTenantId,
                'listing_id'     => $listingId,
                'requester_id'   => $requester->id,
                'provider_id'    => $provider->id,
                'proposed_hours' => 1.0,
                'status'         => $status,
                'created_at'     => now(),
                'updated_at'     => now(),
            ]);
        }

        Sanctum::actingAs($admin);

        $list = $this->apiGet('/v2/admin/broker/exchanges?status=needs_action&per_page=100');
        $list->assertOk();
        $returned = array_map('intval', array_column($list->json('data'), 'id'));

        $this->assertContains($ids['pending_broker'], $returned);
        $this->assertContains($ids['disputed'], $returned);
        $this->assertNotContains($ids['completed'], $returned);
        $this->assertNotContains($ids['accepted'], $returned);

        $dashboard = $this->apiGet('/v2/admin/broker/dashboard');
        $dashboard->assertOk();
        $this->assertSame(
            $dashboard->json('data.pending_exchanges'),
            (int) $list->json('meta.total'),
            'The dashboard card and the list it links to must count the same exchanges.'
        );
    }

    // ================================================================
    /**
     * The dashboard's "oldest waiting" reads the queue oldest-first, so the
     * list must offer that order. The default (newest first) is unchanged.
     */
    public function test_exchanges_and_messages_can_be_listed_oldest_first(): void
    {
        $admin = User::factory()->forTenant($this->testTenantId)->admin()->create();
        $a = User::factory()->forTenant($this->testTenantId)->create();
        $b = User::factory()->forTenant($this->testTenantId)->create();
        $listingId = $this->makeListingId($this->testTenantId, $b->id);
        $exchange = fn (string $when) => (int) DB::table('exchange_requests')->insertGetId([
            'tenant_id' => $this->testTenantId, 'listing_id' => $listingId, 'requester_id' => $a->id, 'provider_id' => $b->id,
            'proposed_hours' => 1.0, 'status' => 'disputed', 'created_at' => $when, 'updated_at' => $when,
        ]);
        $olderExchange = $exchange(now()->subYears(30)->format('Y-m-d H:i:s'));
        $newerExchange = $exchange(now()->addYears(5)->format('Y-m-d H:i:s'));
        $olderMessage = $this->insertMessageCopy($a->id, $b->id, ['created_at' => now()->subYears(30)->format('Y-m-d H:i:s')]);
        $newerMessage = $this->insertMessageCopy($a->id, $b->id, ['created_at' => now()->addYears(5)->format('Y-m-d H:i:s')]);
        Sanctum::actingAs($admin);

        $firstId = fn (string $uri) => (int) $this->apiGet($uri)->assertOk()->json('data.0.id');

        $this->assertSame($olderExchange, $firstId('/v2/admin/broker/exchanges?status=needs_action&sort=oldest&per_page=1'));
        $this->assertSame($newerExchange, $firstId('/v2/admin/broker/exchanges?status=needs_action&per_page=1'));
        $this->assertSame($olderMessage, $firstId('/v2/admin/broker/messages?filter=unreviewed&sort=oldest&per_page=1'));
        $this->assertSame($newerMessage, $firstId('/v2/admin/broker/messages?filter=unreviewed&per_page=1'));
    }

    // RISK TAGS — GET /v2/admin/broker/risk-tags
    // ================================================================

    public function test_risk_tags_returns_200_for_admin(): void
    {
        $admin = User::factory()->forTenant($this->testTenantId)->admin()->create();
        Sanctum::actingAs($admin);

        $response = $this->apiGet('/v2/admin/broker/risk-tags');

        $response->assertStatus(200);
        $response->assertJsonStructure(['data']);
    }

    // ================================================================
    // MESSAGES — GET /v2/admin/broker/messages
    // ================================================================

    public function test_messages_returns_200_for_admin(): void
    {
        $admin = User::factory()->forTenant($this->testTenantId)->admin()->create();
        Sanctum::actingAs($admin);

        $response = $this->apiGet('/v2/admin/broker/messages');

        $response->assertStatus(200);
        $response->assertJsonStructure(['data']);
    }

    public function test_messages_returns_403_for_regular_member(): void
    {
        $member = User::factory()->forTenant($this->testTenantId)->create();
        Sanctum::actingAs($member);

        $response = $this->apiGet('/v2/admin/broker/messages');

        $response->assertStatus(403);
    }

    // ================================================================
    // UNREVIEWED COUNT — GET /v2/admin/broker/messages/unreviewed-count
    // ================================================================

    public function test_unreviewed_count_returns_200_for_admin(): void
    {
        $admin = User::factory()->forTenant($this->testTenantId)->admin()->create();
        Sanctum::actingAs($admin);

        $response = $this->apiGet('/v2/admin/broker/messages/unreviewed-count');

        $response->assertStatus(200);
        $response->assertJsonStructure(['data']);
    }

    public function test_review_message_persists_broker_notes(): void
    {
        $admin = User::factory()->forTenant($this->testTenantId)->admin()->create();
        $sender = User::factory()->forTenant($this->testTenantId)->create();
        $receiver = User::factory()->forTenant($this->testTenantId)->create();
        Sanctum::actingAs($admin);

        $copyId = $this->insertMessageCopy($sender->id, $receiver->id);

        $response = $this->apiPost("/v2/admin/broker/messages/{$copyId}/review", [
            'notes' => 'Reviewed and no action needed.',
        ]);

        $response->assertStatus(200);

        $copy = DB::table('broker_message_copies')->where('id', $copyId)->first();
        $this->assertSame($admin->id, (int) $copy->reviewed_by);
        $this->assertNotNull($copy->reviewed_at);
        $this->assertSame('Reviewed and no action needed.', $copy->review_notes);
    }

    // ================================================================
    // MONITORING — GET /v2/admin/broker/monitoring
    // ================================================================

    public function test_monitoring_returns_200_for_admin(): void
    {
        $admin = User::factory()->forTenant($this->testTenantId)->admin()->create();
        Sanctum::actingAs($admin);

        $response = $this->apiGet('/v2/admin/broker/monitoring');

        $response->assertStatus(200);
        $response->assertJsonStructure(['data']);
    }

    // ================================================================
    // CONFIGURATION — GET /v2/admin/broker/configuration
    // ================================================================

    public function test_get_configuration_returns_200_for_admin(): void
    {
        $admin = User::factory()->forTenant($this->testTenantId)->admin()->create();
        Sanctum::actingAs($admin);

        DB::table('tenant_settings')->updateOrInsert(
            ['tenant_id' => $this->testTenantId, 'setting_key' => 'broker_config'],
            [
                'setting_value' => json_encode([
                    'vetting_enabled' => true,
                    'enforce_vetting_on_exchanges' => true,
                    'vetting_expiry_warning_days' => 30,
                ]),
                'created_at' => now(),
                'updated_at' => now(),
            ],
        );

        $response = $this->apiGet('/v2/admin/broker/configuration');

        $response->assertStatus(200);
        $response->assertJsonStructure(['data']);
        $response->assertJsonMissingPath('data.vetting_enabled');
        $response->assertJsonMissingPath('data.enforce_vetting_on_exchanges');
        $response->assertJsonMissingPath('data.vetting_expiry_warning_days');
    }

    public function test_get_configuration_returns_403_for_regular_member(): void
    {
        $member = User::factory()->forTenant($this->testTenantId)->create();
        Sanctum::actingAs($member);

        $response = $this->apiGet('/v2/admin/broker/configuration');

        $response->assertStatus(403);
    }

    public function test_super_admin_reads_target_tenant_runtime_configuration(): void
    {
        $superAdmin = User::factory()->forTenant($this->testTenantId)->create([
            'role' => 'super_admin',
            'is_super_admin' => true,
        ]);
        Sanctum::actingAs($superAdmin);

        DB::table('tenants')->where('id', $this->testTenantId)->update([
            'configuration' => json_encode([
                'broker_controls' => [
                    'broker_visibility' => ['retention_days' => 30],
                    'exchange_workflow' => ['max_hours_without_approval' => 2],
                ],
            ]),
        ]);
        DB::table('tenants')->where('id', 999)->update([
            'configuration' => json_encode([
                'broker_controls' => [
                    'broker_visibility' => ['retention_days' => 240],
                    'exchange_workflow' => ['max_hours_without_approval' => 8],
                ],
            ]),
        ]);

        $response = $this->apiGet('/v2/admin/broker/configuration?tenant_id=999');

        $response->assertStatus(200);
        $response->assertJsonPath('data.retention_days', 240);
        $this->assertSame(8.0, (float) $response->json('data.max_hours_without_approval'));
    }

    // ================================================================
    // ARCHIVES — GET /v2/admin/broker/archives
    // ================================================================

    public function test_archives_returns_200_for_admin(): void
    {
        $admin = User::factory()->forTenant($this->testTenantId)->admin()->create();
        Sanctum::actingAs($admin);

        $response = $this->apiGet('/v2/admin/broker/archives');

        $response->assertStatus(200);
        $response->assertJsonStructure(['data']);
    }

    public function test_archives_returns_401_for_unauthenticated(): void
    {
        $response = $this->apiGet('/v2/admin/broker/archives');

        $response->assertStatus(401);
    }

    // ================================================================
    // HELPERS
    // ================================================================

    /**
     * Create a listing for the given tenant and return its id.
     *
     * exchange_requests.listing_id carries a NOT NULL FK to listings(id); inserting
     * an exchange without a real listing trips a foreign-key violation, so every
     * exchange fixture must reference a listing that exists.
     */
    private function makeListingId(int $tenantId, int $ownerId): int
    {
        return (int) DB::table('listings')->insertGetId([
            'tenant_id'   => $tenantId,
            'user_id'     => $ownerId,
            'title'       => 'Exchange fixture listing',
            'description' => 'Listing backing an exchange_requests fixture row.',
            'type'        => 'offer',
            'status'      => 'active',
            'created_at'  => now(),
            'updated_at'  => now(),
        ]);
    }

    /**
     * Insert a real messages row (required by broker_message_copies FK) and a
     * broker_message_copies row.  Returns the broker_message_copies.id.
     *
     * @param array<string, mixed> $overrides  Extra columns for broker_message_copies
     */
    private function insertMessageCopy(int $senderId, int $receiverId, array $overrides = []): int
    {
        $msgId = DB::table('messages')->insertGetId([
            'tenant_id'   => $this->testTenantId,
            'sender_id'   => $senderId,
            'receiver_id' => $receiverId,
            'body'        => 'Test message for broker review',
            'is_read'     => false,
            'created_at'  => now()->subHour(),
        ]);

        return DB::table('broker_message_copies')->insertGetId(array_merge([
            'tenant_id'           => $this->testTenantId,
            'original_message_id' => $msgId,
            'sender_id'           => $senderId,
            'receiver_id'         => $receiverId,
            'message_body'        => 'Hello, need help.',
            'sent_at'             => now()->subHour(),
            'copy_reason'         => 'first_contact',
            'flagged'             => false,
            'archive_id'          => null,
            'conversation_key'    => 'key-' . $senderId . '-' . $receiverId . '-' . uniqid(),
            'created_at'          => now(),
        ], $overrides));
    }

    // ================================================================
    // APPROVE EXCHANGE — POST /v2/admin/broker/exchanges/{id}/approve
    // ================================================================

    public function test_approve_exchange_succeeds(): void
    {
        $admin = User::factory()->forTenant($this->testTenantId)->admin()->create();
        $requester = User::factory()->forTenant($this->testTenantId)->create();
        $provider = User::factory()->forTenant($this->testTenantId)->create();
        $listingId = $this->makeListingId($this->testTenantId, $provider->id);

        $exchangeId = DB::table('exchange_requests')->insertGetId([
            'tenant_id'      => $this->testTenantId,
            'listing_id'     => $listingId,
            'requester_id'   => $requester->id,
            'provider_id'    => $provider->id,
            'proposed_hours' => 2.0,
            'status'         => 'pending_broker',
            'created_at'     => now(),
            'updated_at'     => now(),
        ]);

        Sanctum::actingAs($admin);

        $response = $this->apiPost("/v2/admin/broker/exchanges/{$exchangeId}/approve", [
            'notes' => 'Looks good',
        ]);

        $response->assertStatus(200);
        $response->assertJsonPath('data.id', $exchangeId);
        $response->assertJsonPath('data.status', 'accepted');
    }

    /**
     * A disputed exchange used to be a permanent dead end: the credits were stuck
     * BEFORE they moved, and no member, broker or admin could act, even though the
     * dashboard counted disputed exchanges as needing attention. These tests cover
     * the arbitration path that now exists.
     */
    public function test_resolve_dispute_completes_a_disputed_exchange_and_moves_credits(): void
    {
        $admin = User::factory()->forTenant($this->testTenantId)->admin()->create();
        $requester = User::factory()->forTenant($this->testTenantId)->create(['balance' => 10.0]);
        $provider = User::factory()->forTenant($this->testTenantId)->create(['balance' => 10.0]);
        $listingId = $this->makeListingId($this->testTenantId, $provider->id);

        $exchangeId = DB::table('exchange_requests')->insertGetId([
            'tenant_id'                 => $this->testTenantId,
            'listing_id'                => $listingId,
            'requester_id'              => $requester->id,
            'provider_id'               => $provider->id,
            'proposed_hours'            => 2.0,
            'requester_confirmed_hours' => 1.5,
            'provider_confirmed_hours'  => 2.4,
            'requester_confirmed_at'    => now(),
            'provider_confirmed_at'     => now(),
            'status'                    => 'disputed',
            'created_at'                => now(),
            'updated_at'                => now(),
        ]);

        Sanctum::actingAs($admin);

        $response = $this->apiPost("/v2/admin/broker/exchanges/{$exchangeId}/resolve-dispute", [
            'final_hours' => 2.0,
            'notes'       => 'Spoke to both parties; two hours agreed.',
        ]);

        $response->assertStatus(200);
        $response->assertJsonPath('data.status', 'completed');
        // assertJsonPath compares identically and JSON renders 2.0 as 2.
        $this->assertEquals(2.0, $response->json('data.final_hours'));

        $exchange = DB::table('exchange_requests')->where('id', $exchangeId)->first();
        $this->assertSame('completed', $exchange->status);

        // The arbitration is visible to both members via exchange_history.
        $history = DB::table('exchange_history')
            ->where('exchange_id', $exchangeId)
            ->where('action', 'dispute_resolved')
            ->first();
        $this->assertNotNull($history, 'Resolving a dispute must be recorded in exchange_history.');
        $this->assertSame('broker', $history->actor_role);
        $this->assertEquals($admin->id, (int) $history->actor_id);
        $this->assertStringContainsString('two hours agreed', (string) $history->notes);
    }

    public function test_resolve_dispute_requires_a_note(): void
    {
        $admin = User::factory()->forTenant($this->testTenantId)->admin()->create();
        $requester = User::factory()->forTenant($this->testTenantId)->create();
        $provider = User::factory()->forTenant($this->testTenantId)->create();
        $listingId = $this->makeListingId($this->testTenantId, $provider->id);

        $exchangeId = DB::table('exchange_requests')->insertGetId([
            'tenant_id' => $this->testTenantId, 'listing_id' => $listingId,
            'requester_id' => $requester->id, 'provider_id' => $provider->id,
            'proposed_hours' => 2.0, 'status' => 'disputed',
            'created_at' => now(), 'updated_at' => now(),
        ]);

        Sanctum::actingAs($admin);

        $this->apiPost("/v2/admin/broker/exchanges/{$exchangeId}/resolve-dispute", [
            'final_hours' => 2.0,
            'notes'       => '   ',
        ])->assertStatus(400);

        $this->assertSame(
            'disputed',
            DB::table('exchange_requests')->where('id', $exchangeId)->value('status')
        );
    }

    public function test_resolve_dispute_rejects_a_non_disputed_exchange(): void
    {
        $admin = User::factory()->forTenant($this->testTenantId)->admin()->create();
        $requester = User::factory()->forTenant($this->testTenantId)->create();
        $provider = User::factory()->forTenant($this->testTenantId)->create();
        $listingId = $this->makeListingId($this->testTenantId, $provider->id);

        $exchangeId = DB::table('exchange_requests')->insertGetId([
            'tenant_id' => $this->testTenantId, 'listing_id' => $listingId,
            'requester_id' => $requester->id, 'provider_id' => $provider->id,
            'proposed_hours' => 2.0, 'status' => 'accepted',
            'created_at' => now(), 'updated_at' => now(),
        ]);

        Sanctum::actingAs($admin);

        $this->apiPost("/v2/admin/broker/exchanges/{$exchangeId}/resolve-dispute", [
            'final_hours' => 2.0,
            'notes'       => 'Should not apply',
        ])->assertStatus(400);
    }

    public function test_resolve_dispute_blocks_an_arbitrator_who_is_a_party(): void
    {
        // Conflict of interest matters most here: arbitrating your own dispute
        // decides your own credits.
        $admin = User::factory()->forTenant($this->testTenantId)->admin()->create();
        $provider = User::factory()->forTenant($this->testTenantId)->create();
        $listingId = $this->makeListingId($this->testTenantId, $provider->id);

        $exchangeId = DB::table('exchange_requests')->insertGetId([
            'tenant_id' => $this->testTenantId, 'listing_id' => $listingId,
            'requester_id' => $admin->id, 'provider_id' => $provider->id,
            'proposed_hours' => 2.0, 'status' => 'disputed',
            'created_at' => now(), 'updated_at' => now(),
        ]);

        Sanctum::actingAs($admin);

        $this->apiPost("/v2/admin/broker/exchanges/{$exchangeId}/resolve-dispute", [
            'final_hours' => 2.0,
            'notes'       => 'Resolving my own dispute',
        ])->assertStatus(403);

        $this->assertSame(
            'disputed',
            DB::table('exchange_requests')->where('id', $exchangeId)->value('status')
        );
    }

    public function test_resolve_dispute_clamps_hours_to_the_variance_window(): void
    {
        // An arbitrator must not be able to post a figure the workflow would have
        // refused from a participant. Default window is proposed ±25%.
        $admin = User::factory()->forTenant($this->testTenantId)->admin()->create();
        // 🔴 The balances are EXPLICIT, and this test failed roughly one run in ten
        // without them. UserFactory sets 'balance' => randomFloat(2, 0, 50), so the
        // requester started with a random 0–50 credits. Resolving this dispute moves
        // the clamped 5.0 credits, and completeExchange() throws
        // RuntimeException('INSUFFICIENT_BALANCE') when the payer cannot cover it —
        // which is exactly a 10% chance on a uniform 0–50 draw. That surfaced as an
        // opaque 500 in CI (PHP shard 2, 2026-08-11) and reproduced locally at the
        // same rate: 1 failure in 6, then 1 in 11.
        //
        // Every other exchange test in this file already sets a balance for this
        // reason. This one was the outlier, not a special case.
        $requester = User::factory()->forTenant($this->testTenantId)->create(['balance' => 10.0]);
        $provider = User::factory()->forTenant($this->testTenantId)->create(['balance' => 10.0]);
        $listingId = $this->makeListingId($this->testTenantId, $provider->id);

        $exchangeId = DB::table('exchange_requests')->insertGetId([
            'tenant_id' => $this->testTenantId, 'listing_id' => $listingId,
            'requester_id' => $requester->id, 'provider_id' => $provider->id,
            'proposed_hours' => 4.0, 'status' => 'disputed',
            'created_at' => now(), 'updated_at' => now(),
        ]);

        Sanctum::actingAs($admin);

        $response = $this->apiPost("/v2/admin/broker/exchanges/{$exchangeId}/resolve-dispute", [
            'final_hours' => 99.0,
            'notes'       => 'Deliberately absurd figure',
        ]);

        $response->assertStatus(200);
        // 4.0 + 25% = 5.0 — the absurd 99.0 must be clamped, not accepted.
        $this->assertEquals(5.0, $response->json('data.final_hours'));
    }

    /**
     * The broker panel's "Settle this dispute" form shows the hours a broker may
     * choose. That range must be the one resolve-dispute actually enforces, read
     * from the same place — otherwise the form offers a figure the server then
     * silently changes. Both ends are proved against the endpoint itself.
     */
    public function test_show_exchange_gives_a_disputed_exchange_the_range_resolve_dispute_enforces(): void
    {
        $broker = User::factory()->forTenant($this->testTenantId)->create(['role' => 'broker', 'status' => 'active']);
        $requester = User::factory()->forTenant($this->testTenantId)->create(['balance' => 10.0]);
        $provider = User::factory()->forTenant($this->testTenantId)->create(['balance' => 10.0]);
        $listingId = $this->makeListingId($this->testTenantId, $provider->id);

        $makeDispute = fn () => DB::table('exchange_requests')->insertGetId([
            'tenant_id' => $this->testTenantId, 'listing_id' => $listingId,
            'requester_id' => $requester->id, 'provider_id' => $provider->id,
            'proposed_hours' => 4.0, 'requester_confirmed_hours' => 3.0,
            'provider_confirmed_hours' => 5.0, 'status' => 'disputed',
            'created_at' => now(), 'updated_at' => now(),
        ]);
        $high = $makeDispute();
        $low = $makeDispute();

        Sanctum::actingAs($broker);

        $shown = $this->apiGet("/v2/admin/broker/exchanges/{$high}");
        $shown->assertStatus(200);
        $min = $shown->json('data.dispute_window.min_hours');
        $max = $shown->json('data.dispute_window.max_hours');
        $this->assertNotNull($min, 'A disputed exchange must carry the hours range a broker may settle at.');
        $this->assertNotNull($max);

        $this->assertEquals($max, $this->apiPost("/v2/admin/broker/exchanges/{$high}/resolve-dispute", [
            'final_hours' => 999, 'notes' => 'Above the range',
        ])->assertStatus(200)->json('data.final_hours'));

        $this->assertEquals($min, $this->apiPost("/v2/admin/broker/exchanges/{$low}/resolve-dispute", [
            'final_hours' => 0.01, 'notes' => 'Below the range',
        ])->assertStatus(200)->json('data.final_hours'));
    }

    /**
     * A dispute raised because the other member never turned up must be
     * closable with NO hours paid: resolve-dispute always pays at least the
     * bottom of the variance window. The workflow has always allowed
     * disputed → cancelled for a broker; this is the route that reaches it.
     */
    public function test_cancel_dispute_closes_a_disputed_exchange_without_moving_credits(): void
    {
        $broker = User::factory()->forTenant($this->testTenantId)->create(['role' => 'broker', 'status' => 'active']);
        $requester = User::factory()->forTenant($this->testTenantId)->create(['balance' => 10.0]);
        $provider = User::factory()->forTenant($this->testTenantId)->create(['balance' => 10.0]);
        $listingId = $this->makeListingId($this->testTenantId, $provider->id);

        $exchangeId = DB::table('exchange_requests')->insertGetId([
            'tenant_id' => $this->testTenantId, 'listing_id' => $listingId,
            'requester_id' => $requester->id, 'provider_id' => $provider->id,
            'proposed_hours' => 2.0, 'status' => 'disputed',
            'created_at' => now(), 'updated_at' => now(),
        ]);

        Sanctum::actingAs($broker);

        $this->apiPost("/v2/admin/broker/exchanges/{$exchangeId}/cancel-dispute", [
            'reason' => 'The provider did not turn up; nothing to pay.',
        ])->assertStatus(200)->assertJsonPath('data.status', 'cancelled');

        $this->assertSame('cancelled', DB::table('exchange_requests')->where('id', $exchangeId)->value('status'));
        $this->assertEquals(10.0, (float) DB::table('users')->where('id', $requester->id)->value('balance'));
        $this->assertEquals(10.0, (float) DB::table('users')->where('id', $provider->id)->value('balance'));
        $this->assertTrue(
            DB::table('exchange_history')->where('exchange_id', $exchangeId)
                ->where('actor_id', $broker->id)->where('new_status', 'cancelled')->exists(),
            'The cancellation must be recorded in the history both members can see.'
        );

        // Both members must hear the dispute is closed, not only one of them.
        foreach ([$requester->id, $provider->id] as $memberId) {
            $this->assertTrue(
                DB::table('notifications')->where('user_id', $memberId)->where('type', 'exchange_cancelled')->exists(),
                "Member {$memberId} was not told the disputed exchange was cancelled."
            );
        }
    }

    public function test_cancel_dispute_requires_a_reason_and_a_disputed_exchange(): void
    {
        $broker = User::factory()->forTenant($this->testTenantId)->create(['role' => 'broker', 'status' => 'active']);
        $requester = User::factory()->forTenant($this->testTenantId)->create();
        $provider = User::factory()->forTenant($this->testTenantId)->create();
        $listingId = $this->makeListingId($this->testTenantId, $provider->id);

        $make = fn (string $status) => DB::table('exchange_requests')->insertGetId([
            'tenant_id' => $this->testTenantId, 'listing_id' => $listingId,
            'requester_id' => $requester->id, 'provider_id' => $provider->id,
            'proposed_hours' => 2.0, 'status' => $status,
            'created_at' => now(), 'updated_at' => now(),
        ]);
        $disputed = $make('disputed');
        $accepted = $make('accepted');

        Sanctum::actingAs($broker);

        $this->apiPost("/v2/admin/broker/exchanges/{$disputed}/cancel-dispute", ['reason' => '  '])->assertStatus(400);
        $this->apiPost("/v2/admin/broker/exchanges/{$accepted}/cancel-dispute", ['reason' => 'Not a dispute'])->assertStatus(400);

        $this->assertSame('disputed', DB::table('exchange_requests')->where('id', $disputed)->value('status'));
        $this->assertSame('accepted', DB::table('exchange_requests')->where('id', $accepted)->value('status'));
    }

    public function test_cancel_dispute_blocks_a_broker_who_is_a_party(): void
    {
        $broker = User::factory()->forTenant($this->testTenantId)->create(['role' => 'broker', 'status' => 'active']);
        $provider = User::factory()->forTenant($this->testTenantId)->create();
        $listingId = $this->makeListingId($this->testTenantId, $provider->id);

        $exchangeId = DB::table('exchange_requests')->insertGetId([
            'tenant_id' => $this->testTenantId, 'listing_id' => $listingId,
            'requester_id' => $broker->id, 'provider_id' => $provider->id,
            'proposed_hours' => 2.0, 'status' => 'disputed',
            'created_at' => now(), 'updated_at' => now(),
        ]);

        Sanctum::actingAs($broker);

        $this->apiPost("/v2/admin/broker/exchanges/{$exchangeId}/cancel-dispute", [
            'reason' => 'Closing my own dispute',
        ])->assertStatus(403);

        $this->assertSame('disputed', DB::table('exchange_requests')->where('id', $exchangeId)->value('status'));
    }

    public function test_show_exchange_gives_no_dispute_range_when_not_disputed(): void
    {
        $broker = User::factory()->forTenant($this->testTenantId)->create(['role' => 'broker', 'status' => 'active']);
        $requester = User::factory()->forTenant($this->testTenantId)->create();
        $provider = User::factory()->forTenant($this->testTenantId)->create();
        $listingId = $this->makeListingId($this->testTenantId, $provider->id);

        $exchangeId = DB::table('exchange_requests')->insertGetId([
            'tenant_id' => $this->testTenantId, 'listing_id' => $listingId,
            'requester_id' => $requester->id, 'provider_id' => $provider->id,
            'proposed_hours' => 4.0, 'status' => 'accepted',
            'created_at' => now(), 'updated_at' => now(),
        ]);

        Sanctum::actingAs($broker);

        $this->apiGet("/v2/admin/broker/exchanges/{$exchangeId}")
            ->assertStatus(200)
            ->assertJsonPath('data.dispute_window', null);
    }

    // ------------------------------------------------------------------
    //  Reversing a completed exchange
    //
    //  Before this existed a mis-recorded exchange could not be corrected at all:
    //  `completed` is a terminal status, and the only tool was the single-member
    //  balance adjustment applied twice by hand, with no link to the exchange.
    // ------------------------------------------------------------------

    /**
     * Build a completed exchange with a real ledger row, returning
     * [exchangeId, transactionId, payerId, payeeId].
     *
     * @return array{0:int,1:int,2:int,3:int}
     */
    private function makeCompletedExchange(int $payerId, int $payeeId, float $hours = 2.0): array
    {
        $listingId = $this->makeListingId($this->testTenantId, $payeeId);

        $transactionId = (int) DB::table('transactions')->insertGetId([
            'tenant_id' => $this->testTenantId,
            'sender_id' => $payerId,
            'receiver_id' => $payeeId,
            'amount' => $hours,
            'description' => 'Exchange fixture',
            'transaction_type' => 'exchange',
            'status' => 'completed',
            'created_at' => now(),
            'updated_at' => now(),
        ]);

        $exchangeId = (int) DB::table('exchange_requests')->insertGetId([
            'tenant_id' => $this->testTenantId,
            'listing_id' => $listingId,
            'requester_id' => $payerId,
            'provider_id' => $payeeId,
            'proposed_hours' => $hours,
            'final_hours' => $hours,
            'transaction_id' => $transactionId,
            'status' => 'completed',
            'completed_at' => now(),
            'created_at' => now(),
            'updated_at' => now(),
        ]);

        return [$exchangeId, $transactionId, $payerId, $payeeId];
    }

    public function test_reverse_completed_exchange_restores_both_balances(): void
    {
        $admin = User::factory()->forTenant($this->testTenantId)->admin()->create();
        // The payer paid 2h (so is 2h down), the payee earned 2h.
        $payer = User::factory()->forTenant($this->testTenantId)->create(['balance' => 8.0]);
        $payee = User::factory()->forTenant($this->testTenantId)->create(['balance' => 12.0]);

        [$exchangeId, $originalTxnId] = $this->makeCompletedExchange($payer->id, $payee->id, 2.0);

        Sanctum::actingAs($admin);

        $response = $this->apiPost("/v2/admin/broker/exchanges/{$exchangeId}/reverse", [
            'reason' => 'Recorded against the wrong member',
        ]);

        $response->assertStatus(200);
        $this->assertEquals(2.0, $response->json('data.amount'));

        // Credits are put back on both sides.
        $this->assertEquals(10.0, (float) DB::table('users')->where('id', $payer->id)->value('balance'));
        $this->assertEquals(10.0, (float) DB::table('users')->where('id', $payee->id)->value('balance'));

        // The ORIGINAL entry is untouched — a reversal is a compensating record,
        // never a mutation or deletion of history.
        $original = DB::table('transactions')->where('id', $originalTxnId)->first();
        $this->assertSame('completed', $original->status);
        $this->assertEquals($payer->id, (int) $original->sender_id);
        $this->assertEquals(2.0, (float) $original->amount);

        // The compensating entry mirrors it and is typed and attributed.
        $reversalId = (int) $response->json('data.reversal_transaction_id');
        $reversal = DB::table('transactions')->where('id', $reversalId)->first();
        $this->assertSame('exchange_reversal', $reversal->transaction_type);
        $this->assertEquals($payee->id, (int) $reversal->sender_id, 'Reversal must mirror the original.');
        $this->assertEquals($payer->id, (int) $reversal->receiver_id);
        $this->assertEquals($admin->id, (int) $reversal->acting_user_id);

        // Linked back on the exchange, and recorded for both members to see.
        $exchange = DB::table('exchange_requests')->where('id', $exchangeId)->first();
        $this->assertEquals($reversalId, (int) $exchange->reversal_transaction_id);
        $this->assertEquals($admin->id, (int) $exchange->reversed_by);
        $this->assertNotNull($exchange->reversed_at);
        $this->assertSame('Recorded against the wrong member', $exchange->reversal_reason);

        $history = DB::table('exchange_history')
            ->where('exchange_id', $exchangeId)->where('action', 'reversed')->first();
        $this->assertNotNull($history, 'A reversal must appear in the exchange history.');

        $audit = DB::table('org_audit_log')
            ->where('action', 'exchange_reversed')->orderByDesc('id')->first();
        $this->assertNotNull($audit, 'A reversal must leave a durable audit row.');
    }

    public function test_reversing_twice_is_a_no_op_and_does_not_double_refund(): void
    {
        $admin = User::factory()->forTenant($this->testTenantId)->admin()->create();
        $payer = User::factory()->forTenant($this->testTenantId)->create(['balance' => 8.0]);
        $payee = User::factory()->forTenant($this->testTenantId)->create(['balance' => 12.0]);
        [$exchangeId] = $this->makeCompletedExchange($payer->id, $payee->id, 2.0);

        Sanctum::actingAs($admin);

        $first = $this->apiPost("/v2/admin/broker/exchanges/{$exchangeId}/reverse", ['reason' => 'First']);
        $first->assertStatus(200);
        $firstReversalId = (int) $first->json('data.reversal_transaction_id');

        $second = $this->apiPost("/v2/admin/broker/exchanges/{$exchangeId}/reverse", ['reason' => 'Second attempt']);
        $second->assertStatus(200);
        $second->assertJsonPath('data.already_reversed', true);
        $this->assertSame($firstReversalId, (int) $second->json('data.reversal_transaction_id'));

        // Balances reflect exactly ONE reversal.
        $this->assertEquals(10.0, (float) DB::table('users')->where('id', $payer->id)->value('balance'));
        $this->assertEquals(10.0, (float) DB::table('users')->where('id', $payee->id)->value('balance'));

        // And exactly one compensating row exists.
        $this->assertSame(1, DB::table('transactions')
            ->where('tenant_id', $this->testTenantId)
            ->where('transaction_type', 'exchange_reversal')
            ->where('description', 'like', '%#' . $exchangeId . ':%')
            ->count());
    }

    public function test_reverse_allows_the_payee_balance_to_go_negative(): void
    {
        // If the payee already spent the credits the correction must still complete;
        // the negative balance is an explicit debt in the ledger. Same decision the
        // marketplace refund makes.
        $admin = User::factory()->forTenant($this->testTenantId)->admin()->create();
        $payer = User::factory()->forTenant($this->testTenantId)->create(['balance' => 0.0]);
        $payee = User::factory()->forTenant($this->testTenantId)->create(['balance' => 0.5]);
        [$exchangeId] = $this->makeCompletedExchange($payer->id, $payee->id, 2.0);

        Sanctum::actingAs($admin);

        $this->apiPost("/v2/admin/broker/exchanges/{$exchangeId}/reverse", [
            'reason' => 'Payee already spent the credits',
        ])->assertStatus(200);

        $this->assertEquals(2.0, (float) DB::table('users')->where('id', $payer->id)->value('balance'));
        $this->assertEquals(-1.5, (float) DB::table('users')->where('id', $payee->id)->value('balance'));
    }

    public function test_reverse_requires_a_reason(): void
    {
        $admin = User::factory()->forTenant($this->testTenantId)->admin()->create();
        $payer = User::factory()->forTenant($this->testTenantId)->create(['balance' => 8.0]);
        $payee = User::factory()->forTenant($this->testTenantId)->create(['balance' => 12.0]);
        [$exchangeId] = $this->makeCompletedExchange($payer->id, $payee->id, 2.0);

        Sanctum::actingAs($admin);

        $this->apiPost("/v2/admin/broker/exchanges/{$exchangeId}/reverse", ['reason' => '  '])
            ->assertStatus(400);

        $this->assertNull(DB::table('exchange_requests')->where('id', $exchangeId)->value('reversal_transaction_id'));
    }

    public function test_reverse_rejects_a_non_completed_exchange(): void
    {
        $admin = User::factory()->forTenant($this->testTenantId)->admin()->create();
        $requester = User::factory()->forTenant($this->testTenantId)->create();
        $provider = User::factory()->forTenant($this->testTenantId)->create();
        $listingId = $this->makeListingId($this->testTenantId, $provider->id);

        $exchangeId = DB::table('exchange_requests')->insertGetId([
            'tenant_id' => $this->testTenantId, 'listing_id' => $listingId,
            'requester_id' => $requester->id, 'provider_id' => $provider->id,
            'proposed_hours' => 2.0, 'status' => 'accepted',
            'created_at' => now(), 'updated_at' => now(),
        ]);

        Sanctum::actingAs($admin);

        $this->apiPost("/v2/admin/broker/exchanges/{$exchangeId}/reverse", ['reason' => 'Not completed'])
            ->assertStatus(400);
    }

    public function test_reverse_blocks_an_admin_who_is_a_party(): void
    {
        $admin = User::factory()->forTenant($this->testTenantId)->admin()->create(['balance' => 8.0]);
        $payee = User::factory()->forTenant($this->testTenantId)->create(['balance' => 12.0]);
        [$exchangeId] = $this->makeCompletedExchange($admin->id, $payee->id, 2.0);

        Sanctum::actingAs($admin);

        $this->apiPost("/v2/admin/broker/exchanges/{$exchangeId}/reverse", ['reason' => 'Reversing my own'])
            ->assertStatus(403);

        $this->assertNull(DB::table('exchange_requests')->where('id', $exchangeId)->value('reversal_transaction_id'));
    }

    public function test_reverse_uses_the_original_amount_not_the_current_final_hours(): void
    {
        // The amount is re-read from the original ledger row under lock. If someone
        // edits final_hours afterwards, the reversal must still move what was
        // actually moved.
        $admin = User::factory()->forTenant($this->testTenantId)->admin()->create();
        $payer = User::factory()->forTenant($this->testTenantId)->create(['balance' => 8.0]);
        $payee = User::factory()->forTenant($this->testTenantId)->create(['balance' => 12.0]);
        [$exchangeId] = $this->makeCompletedExchange($payer->id, $payee->id, 2.0);

        DB::table('exchange_requests')->where('id', $exchangeId)->update(['final_hours' => 9.0]);

        Sanctum::actingAs($admin);

        $response = $this->apiPost("/v2/admin/broker/exchanges/{$exchangeId}/reverse", [
            'reason' => 'final_hours was tampered with',
        ]);

        $response->assertStatus(200);
        $this->assertEquals(2.0, $response->json('data.amount'), 'Reversal must use the ledger amount, not final_hours.');
        $this->assertEquals(10.0, (float) DB::table('users')->where('id', $payer->id)->value('balance'));
    }

    public function test_approve_exchange_returns_404_for_wrong_tenant(): void
    {
        $adminB = User::factory()->forTenant(999)->admin()->create();
        $requester = User::factory()->forTenant($this->testTenantId)->create();
        $provider = User::factory()->forTenant($this->testTenantId)->create();
        $listingId = $this->makeListingId($this->testTenantId, $provider->id);

        $exchangeId = DB::table('exchange_requests')->insertGetId([
            'tenant_id'      => $this->testTenantId,
            'listing_id'     => $listingId,
            'requester_id'   => $requester->id,
            'provider_id'    => $provider->id,
            'proposed_hours' => 2.0,
            'status'         => 'pending_broker',
            'created_at'     => now(),
            'updated_at'     => now(),
        ]);

        // Act as admin of tenant 999 but exchange belongs to tenant 2
        \App\Core\TenantContext::setById(999);
        Sanctum::actingAs($adminB);

        $response = $this->withHeaders(['X-Tenant-ID' => '999'])
            ->postJson("/api/v2/admin/broker/exchanges/{$exchangeId}/approve", ['notes' => '']);

        $response->assertStatus(404);
        // Reset context
        \App\Core\TenantContext::setById($this->testTenantId);
    }

    public function test_approve_exchange_returns_403_for_non_broker(): void
    {
        $member = User::factory()->forTenant($this->testTenantId)->create();
        $requester = User::factory()->forTenant($this->testTenantId)->create();
        $provider = User::factory()->forTenant($this->testTenantId)->create();
        $listingId = $this->makeListingId($this->testTenantId, $provider->id);

        $exchangeId = DB::table('exchange_requests')->insertGetId([
            'tenant_id'      => $this->testTenantId,
            'listing_id'     => $listingId,
            'requester_id'   => $requester->id,
            'provider_id'    => $provider->id,
            'proposed_hours' => 2.0,
            'status'         => 'pending_broker',
            'created_at'     => now(),
            'updated_at'     => now(),
        ]);

        Sanctum::actingAs($member);

        $response = $this->apiPost("/v2/admin/broker/exchanges/{$exchangeId}/approve");

        $response->assertStatus(403);
    }

    public function test_approve_exchange_returns_401_unauthenticated(): void
    {
        $response = $this->apiPost('/v2/admin/broker/exchanges/1/approve');

        $response->assertStatus(401);
    }

    public function test_approve_exchange_returns_422_for_invalid_status(): void
    {
        $admin = User::factory()->forTenant($this->testTenantId)->admin()->create();
        $requester = User::factory()->forTenant($this->testTenantId)->create();
        $provider = User::factory()->forTenant($this->testTenantId)->create();

        $listingId = $this->makeListingId($this->testTenantId, $provider->id);

        // Status is 'pending' (not 'pending_broker') — not approvable
        $exchangeId = DB::table('exchange_requests')->insertGetId([
            'tenant_id'      => $this->testTenantId,
            'listing_id'     => $listingId,
            'requester_id'   => $requester->id,
            'provider_id'    => $provider->id,
            'proposed_hours' => 2.0,
            'status'         => 'pending',
            'created_at'     => now(),
            'updated_at'     => now(),
        ]);

        Sanctum::actingAs($admin);

        $response = $this->apiPost("/v2/admin/broker/exchanges/{$exchangeId}/approve");

        // respondWithError() defaults to HTTP 400; a non-approvable status yields
        // a 400 with the INVALID_STATUS error code.
        $response->assertStatus(400);
        $response->assertJsonPath('errors.0.code', 'INVALID_STATUS');
    }

    // ================================================================
    // REJECT EXCHANGE — POST /v2/admin/broker/exchanges/{id}/reject
    // ================================================================

    public function test_reject_exchange_succeeds(): void
    {
        $admin = User::factory()->forTenant($this->testTenantId)->admin()->create();
        $requester = User::factory()->forTenant($this->testTenantId)->create();
        $provider = User::factory()->forTenant($this->testTenantId)->create();
        $listingId = $this->makeListingId($this->testTenantId, $provider->id);

        $exchangeId = DB::table('exchange_requests')->insertGetId([
            'tenant_id'      => $this->testTenantId,
            'listing_id'     => $listingId,
            'requester_id'   => $requester->id,
            'provider_id'    => $provider->id,
            'proposed_hours' => 2.0,
            'status'         => 'pending_broker',
            'created_at'     => now(),
            'updated_at'     => now(),
        ]);

        Sanctum::actingAs($admin);

        $response = $this->apiPost("/v2/admin/broker/exchanges/{$exchangeId}/reject", [
            'reason' => 'Does not meet criteria',
        ]);

        $response->assertStatus(200);
        $response->assertJsonPath('data.status', 'cancelled');
    }

    public function test_reject_exchange_returns_422_without_reason(): void
    {
        $admin = User::factory()->forTenant($this->testTenantId)->admin()->create();
        $requester = User::factory()->forTenant($this->testTenantId)->create();
        $provider = User::factory()->forTenant($this->testTenantId)->create();
        $listingId = $this->makeListingId($this->testTenantId, $provider->id);

        $exchangeId = DB::table('exchange_requests')->insertGetId([
            'tenant_id'      => $this->testTenantId,
            'listing_id'     => $listingId,
            'requester_id'   => $requester->id,
            'provider_id'    => $provider->id,
            'proposed_hours' => 2.0,
            'status'         => 'pending_broker',
            'created_at'     => now(),
            'updated_at'     => now(),
        ]);

        Sanctum::actingAs($admin);

        $response = $this->apiPost("/v2/admin/broker/exchanges/{$exchangeId}/reject", [
            'reason' => '',
        ]);

        // reason is required — controller returns error response
        $response->assertJsonPath('errors.0.code', 'VALIDATION_ERROR');
    }

    public function test_reject_exchange_returns_404_for_wrong_tenant(): void
    {
        $adminB = User::factory()->forTenant(999)->admin()->create();
        $requester = User::factory()->forTenant($this->testTenantId)->create();
        $provider = User::factory()->forTenant($this->testTenantId)->create();
        $listingId = $this->makeListingId($this->testTenantId, $provider->id);

        $exchangeId = DB::table('exchange_requests')->insertGetId([
            'tenant_id'      => $this->testTenantId,
            'listing_id'     => $listingId,
            'requester_id'   => $requester->id,
            'provider_id'    => $provider->id,
            'proposed_hours' => 2.0,
            'status'         => 'pending_broker',
            'created_at'     => now(),
            'updated_at'     => now(),
        ]);

        \App\Core\TenantContext::setById(999);
        Sanctum::actingAs($adminB);

        $response = $this->withHeaders(['X-Tenant-ID' => '999'])
            ->postJson("/api/v2/admin/broker/exchanges/{$exchangeId}/reject", ['reason' => 'Cross-tenant attempt']);

        $response->assertStatus(404);
        \App\Core\TenantContext::setById($this->testTenantId);
    }

    public function test_reject_exchange_returns_403_for_non_broker(): void
    {
        $member = User::factory()->forTenant($this->testTenantId)->create();
        $requester = User::factory()->forTenant($this->testTenantId)->create();
        $provider = User::factory()->forTenant($this->testTenantId)->create();
        $listingId = $this->makeListingId($this->testTenantId, $provider->id);
        $exchangeId = DB::table('exchange_requests')->insertGetId([
            'tenant_id'      => $this->testTenantId,
            'listing_id'     => $listingId,
            'requester_id'   => $requester->id,
            'provider_id'    => $provider->id,
            'proposed_hours' => 2.0,
            'status'         => 'pending_broker',
            'created_at'     => now(),
            'updated_at'     => now(),
        ]);

        Sanctum::actingAs($member);

        $response = $this->apiPost("/v2/admin/broker/exchanges/{$exchangeId}/reject", ['reason' => 'Test']);

        $response->assertStatus(403);
    }

    // ================================================================
    // SHOW EXCHANGE — GET /v2/admin/broker/exchanges/{id}
    // ================================================================

    public function test_show_exchange_returns_details(): void
    {
        $admin = User::factory()->forTenant($this->testTenantId)->admin()->create();
        $requester = User::factory()->forTenant($this->testTenantId)->create();
        $provider = User::factory()->forTenant($this->testTenantId)->create();

        $listingId = DB::table('listings')->insertGetId([
            'tenant_id'      => $this->testTenantId,
            'user_id'        => $provider->id,
            'title'          => 'Test listing',
            'description'    => 'Test listing for exchange details',
            'type'           => 'offer',
            'status'         => 'active',
            'created_at'     => now(),
            'updated_at'     => now(),
        ]);

        $exchangeId = DB::table('exchange_requests')->insertGetId([
            'tenant_id'      => $this->testTenantId,
            'listing_id'     => $listingId,
            'requester_id'   => $requester->id,
            'provider_id'    => $provider->id,
            'proposed_hours' => 3.0,
            'status'         => 'pending_broker',
            'created_at'     => now(),
            'updated_at'     => now(),
        ]);

        Sanctum::actingAs($admin);

        $response = $this->apiGet("/v2/admin/broker/exchanges/{$exchangeId}");

        $response->assertStatus(200);
        $response->assertJsonStructure(['data' => ['exchange', 'history', 'risk_tag']]);
        $response->assertJsonPath('data.exchange.id', $exchangeId);
    }

    public function test_show_exchange_returns_linked_listing_details(): void
    {
        $admin = User::factory()->forTenant($this->testTenantId)->admin()->create();
        $requester = User::factory()->forTenant($this->testTenantId)->create([
            'avatar_url' => '/uploads/avatars/requester.jpg',
        ]);
        $provider = User::factory()->forTenant($this->testTenantId)->create([
            'avatar_url' => '/uploads/avatars/provider.jpg',
        ]);

        $listingId = DB::table('listings')->insertGetId([
            'tenant_id'      => $this->testTenantId,
            'user_id'        => $provider->id,
            'title'          => 'Piano lessons',
            'description'    => 'Introductory piano lesson',
            'type'           => 'offer',
            'status'         => 'active',
            'hours_estimate' => 4.5,
            'created_at'     => now(),
            'updated_at'     => now(),
        ]);

        $exchangeId = DB::table('exchange_requests')->insertGetId([
            'tenant_id'      => $this->testTenantId,
            'listing_id'     => $listingId,
            'requester_id'   => $requester->id,
            'provider_id'    => $provider->id,
            'proposed_hours' => 3.0,
            'status'         => 'pending_broker',
            'created_at'     => now(),
            'updated_at'     => now(),
        ]);

        Sanctum::actingAs($admin);

        $response = $this->apiGet("/v2/admin/broker/exchanges/{$exchangeId}");

        $response->assertStatus(200);
        $response->assertJsonPath('data.exchange.listing_title', 'Piano lessons');
        $response->assertJsonPath('data.exchange.listing_type', 'offer');
        $response->assertJsonPath('data.exchange.requester_avatar', '/uploads/avatars/requester.jpg');
        $response->assertJsonPath('data.exchange.provider_avatar', '/uploads/avatars/provider.jpg');
        $this->assertSame(4.5, (float) $response->json('data.exchange.hours_offered'));
    }

    public function test_show_exchange_returns_404_for_wrong_tenant(): void
    {
        $adminB = User::factory()->forTenant(999)->admin()->create();
        $requester = User::factory()->forTenant($this->testTenantId)->create();
        $provider = User::factory()->forTenant($this->testTenantId)->create();
        $listingId = DB::table('listings')->insertGetId([
            'tenant_id'      => $this->testTenantId,
            'user_id'        => $provider->id,
            'title'          => 'Other tenant listing',
            'description'    => 'Test listing for tenant isolation',
            'type'           => 'offer',
            'status'         => 'active',
            'created_at'     => now(),
            'updated_at'     => now(),
        ]);

        $exchangeId = DB::table('exchange_requests')->insertGetId([
            'tenant_id'      => $this->testTenantId,
            'listing_id'     => $listingId,
            'requester_id'   => $requester->id,
            'provider_id'    => $provider->id,
            'proposed_hours' => 2.0,
            'status'         => 'pending_broker',
            'created_at'     => now(),
            'updated_at'     => now(),
        ]);

        \App\Core\TenantContext::setById(999);
        Sanctum::actingAs($adminB);

        $response = $this->withHeaders(['X-Tenant-ID' => '999'])
            ->getJson("/api/v2/admin/broker/exchanges/{$exchangeId}");

        $response->assertStatus(404);
        \App\Core\TenantContext::setById($this->testTenantId);
    }

    // ================================================================
    // SAVE RISK TAG — POST /v2/admin/broker/risk-tags/{listingId}
    // ================================================================

    public function test_save_risk_tag_succeeds_creates_new(): void
    {
        $admin = User::factory()->forTenant($this->testTenantId)->admin()->create();
        $listing = \App\Models\Listing::factory()->forTenant($this->testTenantId)->create();

        Sanctum::actingAs($admin);

        $response = $this->apiPost("/v2/admin/broker/risk-tags/{$listing->id}", [
            'risk_level'    => 'medium',
            'risk_category' => 'safeguarding',
            'risk_notes'    => 'Initial assessment',
        ]);

        $response->assertStatus(200);
        $response->assertJsonPath('data.listing_id', $listing->id);
        $response->assertJsonPath('data.risk_level', 'medium');

        $this->assertDatabaseHas('listing_risk_tags', [
            'listing_id' => $listing->id,
            'tenant_id'  => $this->testTenantId,
            'risk_level' => 'medium',
        ]);
    }

    public function test_save_risk_tag_updates_existing(): void
    {
        $admin = User::factory()->forTenant($this->testTenantId)->admin()->create();
        $listing = \App\Models\Listing::factory()->forTenant($this->testTenantId)->create();

        // Pre-insert a tag
        DB::table('listing_risk_tags')->insert([
            'listing_id'    => $listing->id,
            'tenant_id'     => $this->testTenantId,
            'risk_level'    => 'low',
            'risk_category' => 'other',
            'tagged_by'     => $admin->id,
            'created_at'    => now(),
            'updated_at'    => now(),
        ]);

        Sanctum::actingAs($admin);

        $response = $this->apiPost("/v2/admin/broker/risk-tags/{$listing->id}", [
            'risk_level'    => 'high',
            'risk_category' => 'safeguarding',
            'risk_notes'    => 'Upgraded',
        ]);

        $response->assertStatus(200);
        $response->assertJsonPath('data.risk_level', 'high');

        $this->assertDatabaseHas('listing_risk_tags', [
            'listing_id' => $listing->id,
            'risk_level' => 'high',
        ]);
    }

    public function test_save_risk_tag_returns_422_for_invalid_category(): void
    {
        $admin = User::factory()->forTenant($this->testTenantId)->admin()->create();
        $listing = \App\Models\Listing::factory()->forTenant($this->testTenantId)->create();

        Sanctum::actingAs($admin);

        $response = $this->apiPost("/v2/admin/broker/risk-tags/{$listing->id}", [
            'risk_level'    => 'medium',
            'risk_category' => 'not_a_real_category',
        ]);

        $response->assertJsonPath('errors.0.code', 'VALIDATION_ERROR');
    }

    public function test_save_risk_tag_returns_422_for_missing_risk_category(): void
    {
        $admin = User::factory()->forTenant($this->testTenantId)->admin()->create();
        $listing = \App\Models\Listing::factory()->forTenant($this->testTenantId)->create();

        Sanctum::actingAs($admin);

        $response = $this->apiPost("/v2/admin/broker/risk-tags/{$listing->id}", [
            'risk_level' => 'low',
            // risk_category intentionally omitted
        ]);

        $response->assertJsonPath('errors.0.code', 'VALIDATION_ERROR');
    }

    public function test_save_risk_tag_returns_404_for_wrong_tenant(): void
    {
        $adminB = User::factory()->forTenant(999)->admin()->create();
        $listing = \App\Models\Listing::factory()->forTenant($this->testTenantId)->create();

        \App\Core\TenantContext::setById(999);
        Sanctum::actingAs($adminB);

        $response = $this->withHeaders(['X-Tenant-ID' => '999'])
            ->postJson("/api/v2/admin/broker/risk-tags/{$listing->id}", [
                'risk_level'    => 'medium',
                'risk_category' => 'safeguarding',
            ]);

        $response->assertStatus(404);
        \App\Core\TenantContext::setById($this->testTenantId);
    }

    // ================================================================
    // REMOVE RISK TAG — DELETE /v2/admin/broker/risk-tags/{listingId}
    // ================================================================

    public function test_remove_risk_tag_succeeds(): void
    {
        $admin = User::factory()->forTenant($this->testTenantId)->admin()->create();
        $listing = \App\Models\Listing::factory()->forTenant($this->testTenantId)->create();

        DB::table('listing_risk_tags')->insert([
            'listing_id'    => $listing->id,
            'tenant_id'     => $this->testTenantId,
            'risk_level'    => 'medium',
            'risk_category' => 'other',
            'tagged_by'     => $admin->id,
            'created_at'    => now(),
            'updated_at'    => now(),
        ]);

        Sanctum::actingAs($admin);

        $response = $this->apiDelete("/v2/admin/broker/risk-tags/{$listing->id}");

        $response->assertStatus(200);
        $response->assertJsonPath('data.removed', true);

        $this->assertDatabaseMissing('listing_risk_tags', [
            'listing_id' => $listing->id,
            'tenant_id'  => $this->testTenantId,
        ]);
    }

    public function test_remove_risk_tag_returns_404_for_wrong_tenant(): void
    {
        $adminB = User::factory()->forTenant(999)->admin()->create();
        $tagger = User::factory()->forTenant($this->testTenantId)->admin()->create();
        $listing = \App\Models\Listing::factory()->forTenant($this->testTenantId)->create();

        // Tag exists on tenant 2
        DB::table('listing_risk_tags')->insert([
            'listing_id'    => $listing->id,
            'tenant_id'     => $this->testTenantId,
            'risk_level'    => 'low',
            'risk_category' => 'other',
            'tagged_by'     => $tagger->id,
            'created_at'    => now(),
            'updated_at'    => now(),
        ]);

        \App\Core\TenantContext::setById(999);
        Sanctum::actingAs($adminB);

        $response = $this->withHeaders(['X-Tenant-ID' => '999'])
            ->deleteJson("/api/v2/admin/broker/risk-tags/{$listing->id}");

        $response->assertStatus(404);
        \App\Core\TenantContext::setById($this->testTenantId);
    }

    // ================================================================
    // SET MONITORING — POST /v2/admin/broker/monitoring/{userId}
    // ================================================================

    public function test_set_monitoring_adds_user(): void
    {
        $admin = User::factory()->forTenant($this->testTenantId)->admin()->create();
        $target = User::factory()->forTenant($this->testTenantId)->create();

        Sanctum::actingAs($admin);

        $response = $this->apiPost("/v2/admin/broker/monitoring/{$target->id}", [
            'under_monitoring' => true,
            'reason'           => 'Suspicious activity',
        ]);

        $response->assertStatus(200);
        $response->assertJsonPath('data.under_monitoring', true);

        $this->assertDatabaseHas('user_messaging_restrictions', [
            'user_id'         => $target->id,
            'tenant_id'       => $this->testTenantId,
            'under_monitoring' => 1,
        ]);
    }

    public function test_set_monitoring_removes_user(): void
    {
        $admin = User::factory()->forTenant($this->testTenantId)->admin()->create();
        $target = User::factory()->forTenant($this->testTenantId)->create();

        // Pre-insert monitoring record
        DB::table('user_messaging_restrictions')->insert([
            'user_id'                => $target->id,
            'tenant_id'              => $this->testTenantId,
            'under_monitoring'       => 1,
            'monitoring_reason'      => 'Test reason',
            'restriction_reason'     => 'Test reason',
            'messaging_disabled'     => 0,
            'monitoring_started_at'  => now(),
            'monitoring_expires_at'  => null,
            'restricted_by'          => $admin->id,
        ]);

        Sanctum::actingAs($admin);

        $response = $this->apiPost("/v2/admin/broker/monitoring/{$target->id}", [
            'under_monitoring' => false,
        ]);

        $response->assertStatus(200);
        $response->assertJsonPath('data.under_monitoring', false);

        $this->assertDatabaseHas('user_messaging_restrictions', [
            'user_id'         => $target->id,
            'under_monitoring' => 0,
        ]);
    }

    public function test_set_monitoring_returns_404_for_wrong_tenant(): void
    {
        $adminB = User::factory()->forTenant(999)->admin()->create();
        $target = User::factory()->forTenant($this->testTenantId)->create();

        \App\Core\TenantContext::setById(999);
        Sanctum::actingAs($adminB);

        $response = $this->withHeaders(['X-Tenant-ID' => '999'])
            ->postJson("/api/v2/admin/broker/monitoring/{$target->id}", [
                'under_monitoring' => true,
                'reason'           => 'Cross-tenant attempt',
            ]);

        $response->assertStatus(404);
        \App\Core\TenantContext::setById($this->testTenantId);
    }

    public function test_set_monitoring_returns_403_for_non_broker(): void
    {
        $member = User::factory()->forTenant($this->testTenantId)->create();
        $target = User::factory()->forTenant($this->testTenantId)->create();

        Sanctum::actingAs($member);

        $response = $this->apiPost("/v2/admin/broker/monitoring/{$target->id}", [
            'under_monitoring' => true,
            'reason'           => 'Test',
        ]);

        $response->assertStatus(403);
    }

    // ================================================================
    // APPROVE MESSAGE — POST /v2/admin/broker/messages/{id}/approve
    // ================================================================

    public function test_approve_message_creates_archive(): void
    {
        $admin = User::factory()->forTenant($this->testTenantId)->admin()->create();
        $sender = User::factory()->forTenant($this->testTenantId)->create();
        $receiver = User::factory()->forTenant($this->testTenantId)->create();

        $copyId = $this->insertMessageCopy($sender->id, $receiver->id);

        Sanctum::actingAs($admin);

        $response = $this->apiPost("/v2/admin/broker/messages/{$copyId}/approve", [
            'notes' => 'No issues found',
        ]);

        $response->assertStatus(200);
        $response->assertJsonPath('data.id', $copyId);
        $this->assertNotNull($response->json('data.archive_id'));

        // Archive record should exist
        $archiveId = $response->json('data.archive_id');
        $this->assertDatabaseHas('broker_review_archives', [
            'id'             => $archiveId,
            'tenant_id'      => $this->testTenantId,
            'broker_copy_id' => $copyId,
        ]);
    }

    public function test_approve_message_returns_409_when_already_archived(): void
    {
        $admin = User::factory()->forTenant($this->testTenantId)->admin()->create();
        $sender = User::factory()->forTenant($this->testTenantId)->create();
        $receiver = User::factory()->forTenant($this->testTenantId)->create();

        // Create a copy first, then create an archive for it
        $copyId = $this->insertMessageCopy($sender->id, $receiver->id);

        $archiveId = DB::table('broker_review_archives')->insertGetId([
            'tenant_id'              => $this->testTenantId,
            'broker_copy_id'         => $copyId,
            'sender_id'              => $sender->id,
            'sender_name'            => $sender->first_name . ' ' . $sender->last_name,
            'receiver_id'            => $receiver->id,
            'receiver_name'          => $receiver->first_name . ' ' . $receiver->last_name,
            'related_listing_id'     => null,
            'listing_title'          => null,
            'copy_reason'            => 'first_contact',
            'target_message_body'    => 'Hello',
            'target_message_sent_at' => now()->subHour(),
            'conversation_snapshot'  => '[]',
            'decision'               => 'approved',
            'decided_by'             => $admin->id,
            'decided_by_name'        => 'Admin User',
            'decided_at'             => now(),
            'created_at'             => now(),
        ]);

        // Mark the copy as already archived
        DB::table('broker_message_copies')
            ->where('id', $copyId)
            ->update(['archive_id' => $archiveId, 'archived_at' => now()]);

        Sanctum::actingAs($admin);

        $response = $this->apiPost("/v2/admin/broker/messages/{$copyId}/approve");

        $response->assertStatus(409);
    }

    public function test_approve_message_returns_404_for_wrong_tenant(): void
    {
        $adminB = User::factory()->forTenant(999)->admin()->create();
        $sender = User::factory()->forTenant($this->testTenantId)->create();
        $receiver = User::factory()->forTenant($this->testTenantId)->create();

        $copyId = $this->insertMessageCopy($sender->id, $receiver->id);

        \App\Core\TenantContext::setById(999);
        Sanctum::actingAs($adminB);

        $response = $this->withHeaders(['X-Tenant-ID' => '999'])
            ->postJson("/api/v2/admin/broker/messages/{$copyId}/approve");

        $response->assertStatus(404);
        \App\Core\TenantContext::setById($this->testTenantId);
    }

    // ================================================================
    // FLAG MESSAGE — POST /v2/admin/broker/messages/{id}/flag
    // ================================================================

    public function test_flag_message_succeeds(): void
    {
        $admin = User::factory()->forTenant($this->testTenantId)->admin()->create();
        $sender = User::factory()->forTenant($this->testTenantId)->create();
        $receiver = User::factory()->forTenant($this->testTenantId)->create();

        $copyId = $this->insertMessageCopy($sender->id, $receiver->id, ['message_body' => 'Potentially harmful content']);

        Sanctum::actingAs($admin);

        $response = $this->apiPost("/v2/admin/broker/messages/{$copyId}/flag", [
            'reason'   => 'Inappropriate content',
            'severity' => 'warning',
        ]);

        $response->assertStatus(200);
        $response->assertJsonPath('data.flagged', true);
        $response->assertJsonPath('data.flag_severity', 'warning');

        $this->assertDatabaseHas('broker_message_copies', [
            'id'            => $copyId,
            'flagged'       => 1,
            'flag_reason'   => 'Inappropriate content',
            'flag_severity' => 'warning',
        ]);
    }

    public function test_flag_message_returns_422_for_invalid_severity(): void
    {
        $admin = User::factory()->forTenant($this->testTenantId)->admin()->create();
        $sender = User::factory()->forTenant($this->testTenantId)->create();
        $receiver = User::factory()->forTenant($this->testTenantId)->create();

        $copyId = $this->insertMessageCopy($sender->id, $receiver->id);

        Sanctum::actingAs($admin);

        $response = $this->apiPost("/v2/admin/broker/messages/{$copyId}/flag", [
            'reason'   => 'Some reason',
            'severity' => 'not_valid_severity',
        ]);

        $response->assertJsonPath('errors.0.code', 'VALIDATION_ERROR');
    }

    public function test_flag_message_returns_422_without_reason(): void
    {
        $admin = User::factory()->forTenant($this->testTenantId)->admin()->create();
        $sender = User::factory()->forTenant($this->testTenantId)->create();
        $receiver = User::factory()->forTenant($this->testTenantId)->create();

        $copyId = $this->insertMessageCopy($sender->id, $receiver->id);

        Sanctum::actingAs($admin);

        $response = $this->apiPost("/v2/admin/broker/messages/{$copyId}/flag", [
            'reason'   => '',
            'severity' => 'warning',
        ]);

        $response->assertJsonPath('errors.0.code', 'VALIDATION_ERROR');
    }

    public function test_flag_message_returns_404_for_wrong_tenant(): void
    {
        $adminB = User::factory()->forTenant(999)->admin()->create();
        $sender = User::factory()->forTenant($this->testTenantId)->create();
        $receiver = User::factory()->forTenant($this->testTenantId)->create();

        $copyId = $this->insertMessageCopy($sender->id, $receiver->id);

        \App\Core\TenantContext::setById(999);
        Sanctum::actingAs($adminB);

        $response = $this->withHeaders(['X-Tenant-ID' => '999'])
            ->postJson("/api/v2/admin/broker/messages/{$copyId}/flag", [
                'reason'   => 'Cross-tenant',
                'severity' => 'warning',
            ]);

        $response->assertStatus(404);
        \App\Core\TenantContext::setById($this->testTenantId);
    }

    // ================================================================
    // REVIEW MESSAGE — POST /v2/admin/broker/messages/{id}/review
    // ================================================================

    public function test_review_message_marks_as_reviewed(): void
    {
        $admin = User::factory()->forTenant($this->testTenantId)->admin()->create();
        $sender = User::factory()->forTenant($this->testTenantId)->create();
        $receiver = User::factory()->forTenant($this->testTenantId)->create();

        $copyId = $this->insertMessageCopy($sender->id, $receiver->id);

        Sanctum::actingAs($admin);

        $response = $this->apiPost("/v2/admin/broker/messages/{$copyId}/review");

        $response->assertStatus(200);
        $response->assertJsonPath('data.reviewed', true);

        $this->assertDatabaseHas('broker_message_copies', [
            'id'          => $copyId,
            'reviewed_by' => $admin->id,
        ]);
    }

    // ================================================================
    // BULK REVIEW — POST /v2/admin/broker/messages/review-bulk
    // ================================================================

    /**
     * "Mark these reviewed" for several routine copies at once. Each copy
     * keeps the single-review guards: another community's copy is not found,
     * the broker's own conversation is refused (F-403/F-436). Flagged copies
     * are never bulk-reviewed — a concern is read one at a time — and each
     * reviewed copy is audited as a bulk review.
     */
    public function test_bulk_review_marks_routine_copies_and_skips_what_needs_individual_attention(): void
    {
        $broker = User::factory()->forTenant($this->testTenantId)->create(['role' => 'broker', 'status' => 'active']);
        $a = User::factory()->forTenant($this->testTenantId)->create();
        $b = User::factory()->forTenant($this->testTenantId)->create();

        $routine1 = $this->insertMessageCopy($a->id, $b->id);
        $routine2 = $this->insertMessageCopy($b->id, $a->id);
        $flagged = $this->insertMessageCopy($a->id, $b->id, ['flagged' => true, 'flag_reason' => 'Asked for cash']);
        $own = $this->insertMessageCopy($broker->id, $a->id);
        $alreadyAt = now()->subDay();
        $already = $this->insertMessageCopy($a->id, $b->id, ['reviewed_at' => $alreadyAt, 'reviewed_by' => $a->id]);
        $otherMessage = DB::table('messages')->insertGetId([
            'tenant_id' => 999, 'sender_id' => $a->id, 'receiver_id' => $b->id,
            'body' => 'Another community', 'is_read' => false, 'created_at' => now(),
        ]);
        $otherTenant = DB::table('broker_message_copies')->insertGetId([
            'tenant_id' => 999, 'original_message_id' => $otherMessage, 'sender_id' => $a->id, 'receiver_id' => $b->id,
            'message_body' => 'x', 'sent_at' => now(), 'copy_reason' => 'first_contact', 'flagged' => false,
            'conversation_key' => 'k-' . uniqid(), 'created_at' => now(),
        ]);

        Sanctum::actingAs($broker);

        $res = $this->apiPost('/v2/admin/broker/messages/review-bulk', [
            'ids' => [$routine1, $routine2, $flagged, $own, $already, $otherTenant],
        ])->assertStatus(200);

        $this->assertEqualsCanonicalizing([$routine1, $routine2], $res->json('data.reviewed'));
        $skipped = collect($res->json('data.skipped'))->pluck('reason', 'id')->all();
        $this->assertSame('flagged', $skipped[$flagged] ?? null);
        $this->assertSame('own_conversation', $skipped[$own] ?? null);
        $this->assertSame('already_reviewed', $skipped[$already] ?? null);
        $this->assertSame('not_found', $skipped[$otherTenant] ?? null);

        foreach ([$routine1, $routine2] as $id) {
            $this->assertDatabaseHas('broker_message_copies', ['id' => $id, 'reviewed_by' => $broker->id]);
            $this->assertTrue(DB::table('org_audit_log')
                ->where('action', 'broker_message_reviewed')
                ->where('user_id', $broker->id)
                ->where('details', 'like', '%"message_id":' . $id . ',%')
                ->where('details', 'like', '%"bulk":true%')
                ->exists(), "Copy {$id} must be audited as a bulk review.");
        }
        foreach ([$flagged, $own] as $id) {
            $this->assertNull(DB::table('broker_message_copies')->where('id', $id)->value('reviewed_at'));
        }
        // An earlier review is left exactly as it was.
        $this->assertEquals($a->id, (int) DB::table('broker_message_copies')->where('id', $already)->value('reviewed_by'));
    }

    public function test_bulk_review_rejects_an_empty_or_oversized_request(): void
    {
        $broker = User::factory()->forTenant($this->testTenantId)->create(['role' => 'broker', 'status' => 'active']);
        Sanctum::actingAs($broker);

        $this->apiPost('/v2/admin/broker/messages/review-bulk', ['ids' => []])->assertStatus(400);
        $this->apiPost('/v2/admin/broker/messages/review-bulk', ['ids' => range(1, 51)])->assertStatus(400);
        $this->apiPost('/v2/admin/broker/messages/review-bulk', ['ids' => ['1; DROP']])->assertStatus(400);
    }

    public function test_bulk_review_is_refused_to_a_member(): void
    {
        $member = User::factory()->forTenant($this->testTenantId)->create(['status' => 'active']);
        $a = User::factory()->forTenant($this->testTenantId)->create();
        $copy = $this->insertMessageCopy($a->id, $member->id);
        Sanctum::actingAs($member);

        $this->apiPost('/v2/admin/broker/messages/review-bulk', ['ids' => [$copy]])->assertStatus(403);
        $this->assertNull(DB::table('broker_message_copies')->where('id', $copy)->value('reviewed_at'));
    }

    public function test_review_message_returns_404_for_wrong_tenant(): void
    {
        $adminB = User::factory()->forTenant(999)->admin()->create();
        $sender = User::factory()->forTenant($this->testTenantId)->create();
        $receiver = User::factory()->forTenant($this->testTenantId)->create();

        $copyId = $this->insertMessageCopy($sender->id, $receiver->id);

        \App\Core\TenantContext::setById(999);
        Sanctum::actingAs($adminB);

        $response = $this->withHeaders(['X-Tenant-ID' => '999'])
            ->postJson("/api/v2/admin/broker/messages/{$copyId}/review");

        $response->assertStatus(404);
        \App\Core\TenantContext::setById($this->testTenantId);
    }

    // ================================================================
    // SHOW MESSAGE — GET /v2/admin/broker/messages/{id}
    // ================================================================

    public function test_show_message_returns_details(): void
    {
        $admin = User::factory()->forTenant($this->testTenantId)->admin()->create();
        $sender = User::factory()->forTenant($this->testTenantId)->create();
        $receiver = User::factory()->forTenant($this->testTenantId)->create();

        $copyId = $this->insertMessageCopy($sender->id, $receiver->id, ['message_body' => 'Hello there']);

        Sanctum::actingAs($admin);

        $response = $this->apiGet("/v2/admin/broker/messages/{$copyId}");

        $response->assertStatus(200);
        $response->assertJsonStructure(['data' => ['copy', 'thread', 'archive']]);
        $response->assertJsonPath('data.copy.id', $copyId);
    }

    /**
     * A voice message has an empty text body. The broker's copy of the
     * conversation must still say it is a voice message (and carry its
     * transcript when there is one); without these fields the broker saw an
     * empty bubble and could not tell that anything had been said.
     */
    public function test_show_message_thread_marks_voice_messages(): void
    {
        $admin = User::factory()->forTenant($this->testTenantId)->admin()->create();
        $sender = User::factory()->forTenant($this->testTenantId)->create();
        $receiver = User::factory()->forTenant($this->testTenantId)->create();

        $voiceId = DB::table('messages')->insertGetId([
            'tenant_id' => $this->testTenantId, 'sender_id' => $sender->id, 'receiver_id' => $receiver->id,
            'body' => '', 'is_voice' => 1, 'audio_url' => 'message-media/test/voice_x',
            'audio_duration' => 12, 'transcript' => 'Can you come on Saturday?',
            'is_read' => false, 'created_at' => now()->subHours(2),
        ]);
        $copyId = $this->insertMessageCopy($sender->id, $receiver->id);

        Sanctum::actingAs($admin);

        $thread = collect($this->apiGet("/v2/admin/broker/messages/{$copyId}")
            ->assertStatus(200)->json('data.thread'));
        $voice = $thread->firstWhere('id', $voiceId);

        $this->assertNotNull($voice, 'The earlier voice message must be in the conversation context.');
        $this->assertEquals(1, $voice['is_voice']);
        $this->assertEquals(12, $voice['audio_duration']);
        $this->assertSame('Can you come on Saturday?', $voice['transcript']);
        // The recording itself stays private to the two members.
        $this->assertArrayNotHasKey('audio_url', $voice);
    }

    public function test_show_message_returns_404_for_wrong_tenant(): void
    {
        $adminB = User::factory()->forTenant(999)->admin()->create();
        $sender = User::factory()->forTenant($this->testTenantId)->create();
        $receiver = User::factory()->forTenant($this->testTenantId)->create();

        $copyId = $this->insertMessageCopy($sender->id, $receiver->id);

        \App\Core\TenantContext::setById(999);
        Sanctum::actingAs($adminB);

        $response = $this->withHeaders(['X-Tenant-ID' => '999'])
            ->getJson("/api/v2/admin/broker/messages/{$copyId}");

        $response->assertStatus(404);
        \App\Core\TenantContext::setById($this->testTenantId);
    }

    // ================================================================
    // SHOW ARCHIVE — GET /v2/admin/broker/archives/{id}
    // ================================================================

    public function test_show_archive_returns_details(): void
    {
        $admin = User::factory()->forTenant($this->testTenantId)->admin()->create();
        $sender = User::factory()->forTenant($this->testTenantId)->create();
        $receiver = User::factory()->forTenant($this->testTenantId)->create();

        $copyId = $this->insertMessageCopy($sender->id, $receiver->id);

        $archiveId = DB::table('broker_review_archives')->insertGetId([
            'tenant_id'              => $this->testTenantId,
            'broker_copy_id'         => $copyId,
            'sender_id'              => $sender->id,
            'sender_name'            => 'Test Sender',
            'receiver_id'            => $receiver->id,
            'receiver_name'          => 'Test Receiver',
            'related_listing_id'     => null,
            'listing_title'          => null,
            'copy_reason'            => 'first_contact',
            'target_message_body'    => 'Archived message',
            'target_message_sent_at' => now()->subDay(),
            'conversation_snapshot'  => json_encode([]),
            'decision'               => 'approved',
            'decided_by'             => $admin->id,
            'decided_by_name'        => 'Admin',
            'decided_at'             => now(),
            'created_at'             => now(),
        ]);

        Sanctum::actingAs($admin);

        $response = $this->apiGet("/v2/admin/broker/archives/{$archiveId}");

        $response->assertStatus(200);
        $response->assertJsonPath('data.id', $archiveId);
        $response->assertJsonPath('data.decision', 'approved');
    }

    public function test_show_archive_returns_404_for_wrong_tenant(): void
    {
        $adminB = User::factory()->forTenant(999)->admin()->create();
        $sender = User::factory()->forTenant($this->testTenantId)->create();
        $receiver = User::factory()->forTenant($this->testTenantId)->create();

        $copyId = $this->insertMessageCopy($sender->id, $receiver->id);

        $archiveId = DB::table('broker_review_archives')->insertGetId([
            'tenant_id'              => $this->testTenantId,
            'broker_copy_id'         => $copyId,
            'sender_id'              => $sender->id,
            'sender_name'            => 'Sender',
            'receiver_id'            => $receiver->id,
            'receiver_name'          => 'Receiver',
            'related_listing_id'     => null,
            'listing_title'          => null,
            'copy_reason'            => 'first_contact',
            'target_message_body'    => 'Message',
            'target_message_sent_at' => now()->subDay(),
            'conversation_snapshot'  => '[]',
            'decision'               => 'approved',
            'decided_by'             => $adminB->id,
            'decided_by_name'        => 'Admin',
            'decided_at'             => now(),
            'created_at'             => now(),
        ]);

        \App\Core\TenantContext::setById(999);
        Sanctum::actingAs($adminB);

        $response = $this->withHeaders(['X-Tenant-ID' => '999'])
            ->getJson("/api/v2/admin/broker/archives/{$archiveId}");

        $response->assertStatus(404);
        \App\Core\TenantContext::setById($this->testTenantId);
    }

    // ================================================================
    // SAVE CONFIGURATION — POST /v2/admin/broker/configuration
    // ================================================================

    public function test_save_configuration_succeeds_as_admin(): void
    {
        $admin = User::factory()->forTenant($this->testTenantId)->admin()->create();
        Sanctum::actingAs($admin);

        $response = $this->apiPost('/v2/admin/broker/configuration', [
            'retention_days'          => 120,
            'new_member_monitoring_days' => 45,
        ]);

        $response->assertStatus(200);
        $response->assertJsonPath('data.retention_days', 120);

        $this->assertDatabaseHas('tenant_settings', [
            'tenant_id'   => $this->testTenantId,
            'setting_key' => 'broker_config',
        ]);
    }

    public function test_save_configuration_returns_403_when_broker_submits_admin_only_keys(): void
    {
        // Create a user with broker role
        $broker = User::factory()->forTenant($this->testTenantId)->create(['role' => 'broker', 'status' => 'active']);
        Sanctum::actingAs($broker);

        // Platform-wide message and high-risk approval policy keys are admin-only.
        $response = $this->apiPost('/v2/admin/broker/configuration', [
            'broker_messaging_enabled' => false,
            'require_approval_high_risk' => false,
        ]);

        $response->assertStatus(403);
    }

    /**
     * Admin-only settings follow AdminTier, the platform's one definition of
     * an admin: a broker stays a broker even with a stray admin flag. The
     * broker Configuration page marks the same settings Admin only for them,
     * so screen and server agree (E-083).
     */
    public function test_broker_with_a_stray_admin_flag_cannot_save_admin_only_keys(): void
    {
        $broker = User::factory()->forTenant($this->testTenantId)->create(['role' => 'broker', 'status' => 'active']);
        DB::table('users')->where('id', $broker->id)->update(['is_admin' => 1]);
        Sanctum::actingAs(User::find($broker->id));

        $this->apiPost('/v2/admin/broker/configuration', ['broker_messaging_enabled' => false])
            ->assertStatus(403);
    }

    public function test_broker_can_save_operational_configuration_without_clobbering_admin_policy(): void
    {
        $broker = User::factory()->forTenant($this->testTenantId)->create(['role' => 'broker', 'status' => 'active']);
        Sanctum::actingAs($broker);

        DB::table('tenant_settings')->updateOrInsert(
            ['tenant_id' => $this->testTenantId, 'setting_key' => 'broker_config'],
            [
                'setting_value' => json_encode([
                    'broker_messaging_enabled' => true,
                    'broker_approval_required' => true,
                    'retention_days' => 90,
                    'vetting_enabled' => true,
                ]),
                'created_at' => now(),
                'updated_at' => now(),
            ]
        );

        $response = $this->apiPost('/v2/admin/broker/configuration', [
            'retention_days' => 120,
            'copy_first_contact' => false,
        ]);

        $response->assertStatus(200);
        $response->assertJsonPath('data.retention_days', 120);
        $response->assertJsonPath('data.broker_messaging_enabled', true);
        $response->assertJsonPath('data.broker_approval_required', true);

        $saved = DB::table('tenant_settings')
            ->where('tenant_id', $this->testTenantId)
            ->where('setting_key', 'broker_config')
            ->value('setting_value');
        $config = json_decode((string) $saved, true);

        $this->assertSame(120, $config['retention_days']);
        $this->assertFalse($config['copy_first_contact']);
        $this->assertTrue($config['broker_messaging_enabled']);
        $this->assertTrue($config['broker_approval_required']);
        $this->assertArrayNotHasKey('vetting_enabled', $config);
    }

    public function test_save_configuration_syncs_flat_panel_keys_to_runtime_broker_controls(): void
    {
        $admin = User::factory()->forTenant($this->testTenantId)->admin()->create();
        Sanctum::actingAs($admin);

        $response = $this->apiPost('/v2/admin/broker/configuration', [
            'broker_approval_required' => true,
            'auto_approve_low_risk' => true,
            'max_hours_without_approval' => 6,
            'copy_high_risk_listing_messages' => false,
        ]);

        $response->assertStatus(200);

        $tenantConfig = DB::table('tenants')->where('id', $this->testTenantId)->value('configuration');
        $brokerControls = (json_decode((string) $tenantConfig, true) ?: [])['broker_controls'] ?? [];

        $this->assertTrue($brokerControls['exchange_workflow']['enabled']);
        $this->assertTrue($brokerControls['exchange_workflow']['require_broker_approval']);
        $this->assertTrue($brokerControls['exchange_workflow']['auto_approve_low_risk']);
        $this->assertSame(6.0, (float) $brokerControls['exchange_workflow']['max_hours_without_approval']);
        $this->assertFalse($brokerControls['broker_visibility']['copy_high_risk_listing_messages']);
    }

    public function test_save_configuration_returns_403_for_regular_member(): void
    {
        $member = User::factory()->forTenant($this->testTenantId)->create();
        Sanctum::actingAs($member);

        $response = $this->apiPost('/v2/admin/broker/configuration', [
            'retention_days' => 60,
        ]);

        $response->assertStatus(403);
    }

    // ================================================================
    // CROSS-TENANT / SUPER-ADMIN
    // ================================================================

    public function test_super_admin_can_read_exchanges_for_specific_tenant(): void
    {
        // Create a platform super-admin (role = super_admin)
        $superAdmin = User::factory()->forTenant($this->testTenantId)->create([
            'role'           => 'super_admin',
            'is_super_admin' => true,
        ]);
        Sanctum::actingAs($superAdmin);

        // Create an exchange on the test tenant
        $requester = User::factory()->forTenant($this->testTenantId)->create();
        $provider = User::factory()->forTenant($this->testTenantId)->create();
        $listingId = $this->makeListingId($this->testTenantId, $provider->id);
        DB::table('exchange_requests')->insert([
            'tenant_id'      => $this->testTenantId,
            'listing_id'     => $listingId,
            'requester_id'   => $requester->id,
            'provider_id'    => $provider->id,
            'proposed_hours' => 1.0,
            'status'         => 'pending',
            'created_at'     => now(),
            'updated_at'     => now(),
        ]);

        // Super admin requests tenant 2's data explicitly
        $response = $this->withHeaders(['X-Tenant-ID' => (string) $this->testTenantId])
            ->getJson("/api/v2/admin/broker/exchanges?tenant_id={$this->testTenantId}");

        $response->assertStatus(200);
        $response->assertJsonStructure(['data']);
    }

    public function test_non_super_admin_cannot_override_tenant_via_query_param(): void
    {
        // Regular admin of tenant 2
        $admin = User::factory()->forTenant($this->testTenantId)->admin()->create();

        // Create an exchange on tenant 999
        $requesterB = User::factory()->forTenant(999)->create();
        $providerB = User::factory()->forTenant(999)->create();
        $listingIdB = $this->makeListingId(999, $providerB->id);
        $exchangeIdB = DB::table('exchange_requests')->insertGetId([
            'tenant_id'      => 999,
            'listing_id'     => $listingIdB,
            'requester_id'   => $requesterB->id,
            'provider_id'    => $providerB->id,
            'proposed_hours' => 1.0,
            'status'         => 'pending',
            'created_at'     => now(),
            'updated_at'     => now(),
        ]);

        Sanctum::actingAs($admin);

        // Try to read tenant 999's exchange — non-super-admin gets own tenant data only
        $response = $this->apiGet("/v2/admin/broker/exchanges?tenant_id=999");

        $response->assertStatus(200);
        // The response should not contain the exchange from tenant 999
        $data = $response->json('data');
        $ids = collect($data)->pluck('id')->toArray();
        $this->assertNotContains($exchangeIdB, $ids);
    }
}
