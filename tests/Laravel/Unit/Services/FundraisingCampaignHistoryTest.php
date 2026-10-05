<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

declare(strict_types=1);

namespace Tests\Laravel\Unit\Services;

use App\Core\TenantContext;
use App\Services\VolunteerDonationService as Donations;
use Illuminate\Foundation\Testing\DatabaseTransactions;
use Illuminate\Support\Facades\DB;
use Tests\Laravel\TestCase;

class FundraisingCampaignHistoryTest extends TestCase
{
    use DatabaseTransactions;

    protected function setUp(): void
    {
        parent::setUp();
        TenantContext::setById($this->testTenantId);
    }

    private function org(string $status = 'approved'): int
    {
        return (int) DB::table('vol_organizations')->insertGetId([
            'tenant_id' => $this->testTenantId, 'user_id' => 1, 'name' => 'Org ' . uniqid(),
            'slug' => 'org-' . uniqid(), 'status' => $status, 'created_at' => now(),
        ]);
    }

    private function create(?int $orgId = null): array
    {
        return Donations::createGivingDay([
            'title' => 'Winter appeal', 'start_date' => now()->toDateString(),
            'end_date' => now()->addWeek()->toDateString(), 'goal_amount' => 500,
            'created_by' => 11, 'organization_id' => $orgId,
        ], $this->testTenantId);
    }

    /** @return array<int, string> */
    private function events(int $dayId): array
    {
        return DB::table('vol_fundraising_events')->where('tenant_id', $this->testTenantId)
            ->where('giving_day_id', $dayId)->orderBy('id')->pluck('event')->all();
    }

    public function test_creating_a_campaign_is_recorded_with_its_organisation(): void
    {
        $orgId = $this->org();
        $day = $this->create($orgId);
        $this->assertSame(['campaign_created', 'campaign_organisation_set'], $this->events($day['id']));
        $row = DB::table('vol_fundraising_events')->where('giving_day_id', $day['id'])->first();
        $this->assertSame(11, (int) $row->actor_user_id);
        $this->assertSame('community_admin', $row->actor_kind);
    }

    public function test_an_edit_records_before_and_after_and_who(): void
    {
        $day = $this->create();
        Donations::updateGivingDay($day['id'], ['goal_amount' => 800, 'title' => 'Winter appeal'], $this->testTenantId, 12);

        $row = DB::table('vol_fundraising_events')->where('giving_day_id', $day['id'])
            ->where('event', 'campaign_updated')->first();
        $changes = json_decode($row->details, true)['changes'];
        $this->assertSame(['from' => '500.00', 'to' => '800.00'], $changes['goal_amount']);
        $this->assertArrayNotHasKey('title', $changes, 'unchanged fields are not recorded');
        $this->assertSame(12, (int) DB::table('vol_giving_days')->where('id', $day['id'])->value('updated_by'));
        $this->assertNotNull(DB::table('vol_giving_days')->where('id', $day['id'])->value('updated_at'));
    }

    public function test_pausing_and_resuming_are_recorded_and_paused_is_a_status(): void
    {
        $day = $this->create();
        Donations::updateGivingDay($day['id'], ['is_active' => false], $this->testTenantId, 12);
        $admin = collect(Donations::adminGetGivingDays())->firstWhere('id', $day['id']);
        $this->assertSame('paused', $admin['status']);

        Donations::updateGivingDay($day['id'], ['is_active' => true], $this->testTenantId, 12);
        $this->assertSame(['campaign_created', 'campaign_paused', 'campaign_resumed'], $this->events($day['id']));
    }

    public function test_deactivating_after_the_end_date_is_ended_not_paused(): void
    {
        $day = $this->create();
        DB::table('vol_giving_days')->where('id', $day['id'])->update([
            'start_date' => now()->subWeeks(2)->toDateString(), 'end_date' => now()->subWeek()->toDateString(),
        ]);
        Donations::updateGivingDay($day['id'], ['is_active' => false], $this->testTenantId, 12);
        $this->assertContains('campaign_ended', $this->events($day['id']));
        $this->assertSame('ended', collect(Donations::adminGetGivingDays())->firstWhere('id', $day['id'])['status']);
    }

    public function test_ending_a_campaign_today_records_ended_not_paused(): void
    {
        $day = $this->create();
        Donations::updateGivingDay($day['id'], ['is_active' => false, 'end_date' => now()->toDateString()], $this->testTenantId, 12);

        $this->assertContains('campaign_ended', $this->events($day['id']));
        $this->assertNotContains('campaign_paused', $this->events($day['id']));
        $this->assertSame('ended', collect(Donations::adminGetGivingDays())->firstWhere('id', $day['id'])['status']);
    }

    public function test_an_organisation_cannot_resume_a_campaign_the_community_paused(): void
    {
        $day = $this->create($this->org());
        Donations::updateGivingDay($day['id'], ['is_active' => false], $this->testTenantId, 12);

        try {
            Donations::updateGivingDay($day['id'], ['is_active' => true], $this->testTenantId, 13, 'org_admin');
            $this->fail('the organisation must not override a community pause');
        } catch (\InvalidArgumentException $e) {
            $this->assertSame(__('fundraising.paused_by_community'), $e->getMessage());
        }
        $this->assertSame(0, (int) DB::table('vol_giving_days')->where('id', $day['id'])->value('is_active'));

        // The community itself can resume it, and after an org's own pause the org can resume.
        Donations::updateGivingDay($day['id'], ['is_active' => true], $this->testTenantId, 12);
        Donations::updateGivingDay($day['id'], ['is_active' => false], $this->testTenantId, 13, 'org_admin');
        Donations::updateGivingDay($day['id'], ['is_active' => true], $this->testTenantId, 13, 'org_admin');
        $this->assertSame(1, (int) DB::table('vol_giving_days')->where('id', $day['id'])->value('is_active'));
    }

    public function test_organisation_is_locked_once_a_gift_exists(): void
    {
        $day = $this->create($this->org());
        DB::table('vol_donations')->insert([
            'tenant_id' => $this->testTenantId, 'user_id' => 1, 'giving_day_id' => $day['id'],
            'amount' => 5, 'currency' => 'EUR', 'status' => 'pending', 'created_at' => now(),
        ]);
        $this->assertTrue(collect(Donations::adminGetGivingDays())->firstWhere('id', $day['id'])['has_donations']);

        $this->expectException(\InvalidArgumentException::class);
        $this->expectExceptionMessage(__('fundraising.organisation_locked'));
        Donations::updateGivingDay($day['id'], ['organization_id' => $this->org()], $this->testTenantId, 12);
    }

    public function test_resending_the_same_organisation_is_not_a_change_and_not_refused(): void
    {
        $orgId = $this->org();
        $day = $this->create($orgId);
        DB::table('vol_donations')->insert([
            'tenant_id' => $this->testTenantId, 'user_id' => 1, 'giving_day_id' => $day['id'],
            'amount' => 5, 'currency' => 'EUR', 'status' => 'pending', 'created_at' => now(),
        ]);
        Donations::updateGivingDay($day['id'], ['organization_id' => $orgId, 'goal_amount' => 600], $this->testTenantId, 12);
        $this->assertSame(600.0, (float) DB::table('vol_giving_days')->where('id', $day['id'])->value('goal_amount'));
    }
}
