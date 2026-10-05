<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

declare(strict_types=1);

namespace Tests\Laravel\Unit\Services;

use App\Core\TenantContext;
use App\Exceptions\FundraisingNotFoundException;
use App\I18n\LocaleContext;
use App\Models\User;
use App\Services\FundraisingHandoverService as Handovers;
use Illuminate\Foundation\Testing\DatabaseTransactions;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Log;
use Tests\Laravel\TestCase;

/**
 * Money a community passes on to the organisation a campaign raised it for:
 * a community admin records it, the organisation confirms it arrived. Never
 * more than the campaign still holds; never edited, only cancelled with a
 * reason; and every step is in the fundraising history.
 */
class FundraisingHandoverServiceTest extends TestCase
{
    use DatabaseTransactions;

    private User $admin;
    private User $owner;
    private int $orgId;
    private int $campaignId;

    protected function setUp(): void
    {
        parent::setUp();
        TenantContext::setById($this->testTenantId);
        $this->admin = User::factory()->forTenant($this->testTenantId)->admin()->create();
        $this->owner = User::factory()->forTenant($this->testTenantId)->create(['preferred_language' => 'fr']);
        $this->orgId = $this->organisation($this->owner->id);
        $this->campaignId = $this->campaign($this->orgId, 100);
    }

    private function organisation(int $ownerId, ?int $tenantId = null): int
    {
        return (int) DB::table('vol_organizations')->insertGetId([
            'tenant_id' => $tenantId ?? $this->testTenantId,
            'user_id' => $ownerId,
            'name' => 'Food Bank ' . uniqid(),
            'slug' => 'handover-org-' . uniqid(),
            'status' => 'approved',
            'created_at' => now(),
        ]);
    }

    private function campaign(?int $orgId, float $raised, ?int $tenantId = null): int
    {
        return (int) DB::table('vol_giving_days')->insertGetId([
            'tenant_id' => $tenantId ?? $this->testTenantId,
            'title' => 'Winter appeal',
            'start_date' => now()->subWeek()->toDateString(),
            'end_date' => now()->addWeek()->toDateString(),
            'goal_amount' => 1000,
            'raised_amount' => $raised,
            'is_active' => 1,
            'organization_id' => $orgId,
            'created_by' => 1,
            'created_at' => now(),
        ]);
    }

    /** @return array<string, mixed> */
    private function input(float $amount = 60, array $overrides = []): array
    {
        return array_merge([
            'amount' => $amount,
            'handed_over_on' => now()->toDateString(),
            'method' => 'bank_transfer',
            'reference' => 'TRF-001',
            'note' => 'First instalment',
        ], $overrides);
    }

    /** @return array<int, string> */
    private function events(): array
    {
        return DB::table('vol_fundraising_events')->where('tenant_id', $this->testTenantId)
            ->where('giving_day_id', $this->campaignId)->orderBy('id')->pluck('event')->all();
    }

    public function test_recording_a_handover_reduces_what_is_still_held_and_is_in_the_history(): void
    {
        $handover = Handovers::record($this->testTenantId, $this->campaignId, $this->admin->id, $this->input(60));

        $this->assertSame('recorded', $handover['status']);
        $this->assertSame(60.0, $handover['amount']);
        $this->assertSame($this->orgId, $handover['organization_id']);
        $summary = Handovers::listForCampaign($this->testTenantId, $this->campaignId)['summary'];
        $this->assertSame(100.0, $summary['raised']);
        $this->assertSame(60.0, $summary['handed_over']);
        $this->assertSame(40.0, $summary['still_held']);

        $event = DB::table('vol_fundraising_events')->where('handover_id', $handover['id'])->first();
        $this->assertSame('handover_recorded', $event->event);
        $this->assertSame((int) $this->admin->id, (int) $event->actor_user_id);
        $this->assertSame('community_admin', $event->actor_kind);
        $this->assertSame(60.0, (float) $event->amount);
    }

    public function test_a_handover_cannot_exceed_what_is_still_held(): void
    {
        Handovers::record($this->testTenantId, $this->campaignId, $this->admin->id, $this->input(60));

        $this->expectException(\InvalidArgumentException::class);
        $this->expectExceptionMessage(__('fundraising.handover_exceeds_held', ['held' => '40.00 ' . strtoupper(TenantContext::getCurrency())]));
        Handovers::record($this->testTenantId, $this->campaignId, $this->admin->id, $this->input(50, ['reference' => 'TRF-002']));
    }

    public function test_a_cancelled_handover_no_longer_counts(): void
    {
        $first = Handovers::record($this->testTenantId, $this->campaignId, $this->admin->id, $this->input(60));
        Handovers::cancel($this->testTenantId, $first['id'], $this->admin->id, 'Wrong amount');

        $second = Handovers::record($this->testTenantId, $this->campaignId, $this->admin->id, $this->input(100, ['reference' => 'TRF-002']));

        $this->assertSame('recorded', $second['status']);
        $this->assertSame(0.0, Handovers::listForCampaign($this->testTenantId, $this->campaignId)['summary']['still_held']);
        $this->assertSame(['handover_recorded', 'handover_cancelled', 'handover_recorded'], $this->events());
    }

    public function test_cancel_needs_a_reason_and_happens_once(): void
    {
        $handover = Handovers::record($this->testTenantId, $this->campaignId, $this->admin->id, $this->input(60));

        try {
            Handovers::cancel($this->testTenantId, $handover['id'], $this->admin->id, '   ');
            $this->fail('a blank reason must be refused');
        } catch (\InvalidArgumentException $e) {
            $this->assertSame(__('fundraising.cancel_reason_required'), $e->getMessage());
        }

        $cancelled = Handovers::cancel($this->testTenantId, $handover['id'], $this->admin->id, 'Entered twice');
        $this->assertSame('cancelled', $cancelled['status']);
        $this->assertSame('Entered twice', $cancelled['cancel_reason']);

        $this->expectException(\InvalidArgumentException::class);
        $this->expectExceptionMessage(__('fundraising.handover_already_closed'));
        Handovers::cancel($this->testTenantId, $handover['id'], $this->admin->id, 'Again');
    }

    public function test_only_the_organisations_admin_can_confirm_and_only_once(): void
    {
        $handover = Handovers::record($this->testTenantId, $this->campaignId, $this->admin->id, $this->input(60));

        $stranger = User::factory()->forTenant($this->testTenantId)->create();
        $otherOrg = $this->organisation($stranger->id);
        try {
            Handovers::confirm($this->testTenantId, $otherOrg, $handover['id'], $stranger->id);
            $this->fail('another organisation must not confirm');
        } catch (FundraisingNotFoundException) {
        }
        try {
            Handovers::confirm($this->testTenantId, $this->orgId, $handover['id'], $stranger->id);
            $this->fail('a non-member must not confirm for this organisation');
        } catch (FundraisingNotFoundException) {
        }

        $confirmed = Handovers::confirm($this->testTenantId, $this->orgId, $handover['id'], $this->owner->id);
        $this->assertSame('confirmed', $confirmed['status']);
        $this->assertNotNull($confirmed['confirmed_by_name']);
        $event = DB::table('vol_fundraising_events')->where('handover_id', $handover['id'])
            ->where('event', 'handover_confirmed')->first();
        $this->assertSame('org_admin', $event->actor_kind);
        $this->assertSame((int) $this->owner->id, (int) $event->actor_user_id);

        $this->expectException(\InvalidArgumentException::class);
        Handovers::confirm($this->testTenantId, $this->orgId, $handover['id'], $this->owner->id);
    }

    public function test_a_cancelled_handover_cannot_be_confirmed(): void
    {
        $handover = Handovers::record($this->testTenantId, $this->campaignId, $this->admin->id, $this->input(60));
        Handovers::cancel($this->testTenantId, $handover['id'], $this->admin->id, 'Mistake');

        $this->expectException(\InvalidArgumentException::class);
        $this->expectExceptionMessage(__('fundraising.handover_already_closed'));
        Handovers::confirm($this->testTenantId, $this->orgId, $handover['id'], $this->owner->id);
    }

    public function test_community_wide_campaign_has_no_handovers(): void
    {
        $communityWide = $this->campaign(null, 100);

        $this->expectException(\InvalidArgumentException::class);
        $this->expectExceptionMessage(__('fundraising.handover_campaign_has_no_organisation'));
        Handovers::record($this->testTenantId, $communityWide, $this->admin->id, $this->input(10));
    }

    public function test_validation(): void
    {
        $cases = [
            'handover_amount_positive' => $this->input(0),
            'handover_method_invalid' => $this->input(10, ['method' => 'crypto']),
            'handover_reference_required' => $this->input(10, ['reference' => '  ']),
            'handover_date_invalid' => $this->input(10, ['handed_over_on' => now()->addDay()->toDateString()]),
        ];
        foreach ($cases as $key => $input) {
            try {
                Handovers::record($this->testTenantId, $this->campaignId, $this->admin->id, $input);
                $this->fail("expected {$key}");
            } catch (\InvalidArgumentException $e) {
                $this->assertSame(__("fundraising.{$key}"), $e->getMessage(), $key);
            }
        }
        try {
            Handovers::record($this->testTenantId, $this->campaignId, $this->admin->id, $this->input(10, ['handed_over_on' => '2026-02-30']));
            $this->fail('an impossible date must be refused');
        } catch (\InvalidArgumentException $e) {
            $this->assertSame(__('fundraising.handover_date_invalid'), $e->getMessage());
        }
        $this->assertSame([], $this->events(), 'a refused hand-over leaves no trace');
    }

    public function test_another_communitys_campaign_is_not_found(): void
    {
        $foreign = $this->campaign($this->orgId, 100, 999);

        $this->expectException(FundraisingNotFoundException::class);
        Handovers::record($this->testTenantId, $foreign, $this->admin->id, $this->input(10));
    }

    public function test_the_notification_runs_without_hitting_its_error_guard(): void
    {
        // The notification is wrapped so a mail outage cannot undo a saved
        // hand-over — which also means a coding error inside it would be
        // swallowed. Prove the whole bell + email path runs cleanly.
        Log::spy();

        Handovers::record($this->testTenantId, $this->campaignId, $this->admin->id, $this->input(60));

        Log::shouldNotHaveReceived('warning', [\Mockery::pattern('/hand-over notification error/')]);
    }

    public function test_organisation_admins_are_told_in_their_language(): void
    {
        $handover = Handovers::record($this->testTenantId, $this->campaignId, $this->admin->id, $this->input(60));

        $notification = DB::table('notifications')
            ->where('user_id', $this->owner->id)
            ->where('link', '/volunteering/org/' . $this->orgId . '/dashboard?tab=fundraising')
            ->orderByDesc('id')
            ->first();
        $this->assertNotNull($notification, 'the organisation owner gets a bell notification');

        $expected = LocaleContext::withLocale('fr', fn () => __('fundraising.email.handover_bell', [
            'community' => (string) DB::table('tenants')->where('id', $this->testTenantId)->value('name'),
            'amount' => '60.00 ' . $handover['currency'],
            'campaign' => 'Winter appeal',
        ]));
        $this->assertSame($expected, $notification->message);
    }
}
