<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

declare(strict_types=1);

namespace Tests\Laravel\Unit\Services;

use App\Models\User;
use App\Services\FundraisingHistoryService as History;
use Illuminate\Foundation\Testing\DatabaseTransactions;
use Illuminate\Support\Facades\DB;
use Tests\Laravel\TestCase;

class FundraisingHistoryServiceTest extends TestCase
{
    use DatabaseTransactions;

    public function test_record_stores_record_numbers_and_details(): void
    {
        $id = History::record($this->testTenantId, 'campaign_updated', History::ACTOR_COMMUNITY_ADMIN, 7,
            ['giving_day_id' => 3, 'organization_id' => 4], null, null,
            ['changes' => ['goal_amount' => ['from' => '500.00', 'to' => '800.00']]]);

        $row = DB::table('vol_fundraising_events')->find($id);
        $this->assertSame('campaign_updated', $row->event);
        $this->assertSame(3, (int) $row->giving_day_id);
        $this->assertSame(4, (int) $row->organization_id);
        $this->assertSame('800.00', json_decode($row->details, true)['changes']['goal_amount']['to']);
    }

    public function test_unknown_event_or_actor_is_a_programming_error(): void
    {
        $this->expectException(\InvalidArgumentException::class);
        History::record($this->testTenantId, 'made_up_event', History::ACTOR_SYSTEM, null);
    }

    public function test_unknown_actor_is_refused(): void
    {
        $this->expectException(\InvalidArgumentException::class);
        History::record($this->testTenantId, 'campaign_created', 'robot', null);
    }

    public function test_campaign_history_is_tenant_scoped_and_newest_first(): void
    {
        History::record($this->testTenantId, 'campaign_created', History::ACTOR_SYSTEM, null, ['giving_day_id' => 900001]);
        History::record($this->testTenantId, 'campaign_ended', History::ACTOR_SYSTEM, null, ['giving_day_id' => 900001]);
        History::record(999, 'campaign_created', History::ACTOR_SYSTEM, null, ['giving_day_id' => 900001]);

        $rows = History::forCampaign($this->testTenantId, 900001, false);
        $this->assertCount(2, $rows);
        $this->assertSame('campaign_ended', $rows[0]['event']);
    }

    public function test_an_organisation_change_reads_as_names_not_numbers(): void
    {
        $orgId = (int) DB::table('vol_organizations')->insertGetId([
            'tenant_id' => $this->testTenantId, 'user_id' => 1, 'name' => 'Named Food Bank',
            'slug' => 'named-fb-' . uniqid(), 'status' => 'approved', 'created_at' => now(),
        ]);
        History::record($this->testTenantId, 'campaign_organisation_set', History::ACTOR_SYSTEM, null,
            ['giving_day_id' => 900003, 'organization_id' => $orgId], null, null,
            ['changes' => ['organization_id' => ['from' => null, 'to' => $orgId]]]);

        $change = History::forCampaign($this->testTenantId, 900003, true)[0]['details']['changes']['organization_id'];

        $this->assertSame($orgId, $change['to'], 'the record number itself is unchanged');
        $this->assertSame('Named Food Bank', $change['to_label']);
        $this->assertNull($change['from_label']);
    }

    public function test_organisation_view_hides_donor_identity_and_stripe_ids(): void
    {
        $donor = User::factory()->forTenant($this->testTenantId)->create(['first_name' => 'Dana', 'last_name' => 'Donor']);
        $admin = User::factory()->forTenant($this->testTenantId)->admin()->create(['first_name' => 'Ada', 'last_name' => 'Admin']);
        History::record($this->testTenantId, 'donation_started', History::ACTOR_MEMBER, $donor->id, ['giving_day_id' => 900002], 10.0, 'EUR', null, 'pi_123');
        History::record($this->testTenantId, 'campaign_paused', History::ACTOR_COMMUNITY_ADMIN, $admin->id, ['giving_day_id' => 900002]);

        $org = History::forCampaign($this->testTenantId, 900002, true);
        $this->assertNull($org[1]['actor_name']);          // the donor
        $this->assertNull($org[1]['stripe_object_id']);
        $this->assertStringContainsString('Ada', (string) $org[0]['actor_name']);

        $admin = History::forCampaign($this->testTenantId, 900002, false);
        $this->assertStringContainsString('Dana', (string) $admin[1]['actor_name']);
        $this->assertSame('pi_123', $admin[1]['stripe_object_id']);
    }
}
