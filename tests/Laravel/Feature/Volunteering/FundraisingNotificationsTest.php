<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

declare(strict_types=1);

namespace Tests\Laravel\Feature\Volunteering;

use App\Core\TenantContext;
use App\I18n\LocaleContext;
use App\Models\User;
use App\Services\EmailDispatchService;
use App\Services\FundraisingHandoverService;
use App\Services\FundraisingHistoryService as History;
use App\Services\StripeDonationService;
use App\Services\VolunteerDonationService;
use Illuminate\Foundation\Testing\DatabaseTransactions;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Log;
use Laravel\Sanctum\Sanctum;
use Tests\Laravel\TestCase;

/**
 * The four fundraising alerts (owner, 6 Oct 2026):
 *  1. an organisation starts a campaign → community admins, with a pause link;
 *  2. the community pauses or ends it → the organisation's owner/admins;
 *  3. the organisation confirms a hand-over → community admins;
 *  4. a gift to an organisation's campaign is received → the organisation's
 *     owner/admins, donor by name or "anonymous", never an email address.
 * Each recipient gets a bell and an email in their own language.
 */
class FundraisingNotificationsTest extends TestCase
{
    use DatabaseTransactions;

    private User $communityAdmin;
    private User $owner;
    private User $orgAdmin;
    private User $donor;
    private int $orgId;

    /** @var array<int, array{to: string, subject: string, body: string, options: array<string, mixed>}> */
    private array $emails = [];

    protected function setUp(): void
    {
        parent::setUp();
        DB::table('tenants')->where('id', $this->testTenantId)
            ->update(['features' => json_encode(['volunteering' => true, 'organisations' => true])]);
        TenantContext::setById($this->testTenantId);

        $this->communityAdmin = User::factory()->forTenant($this->testTenantId)->admin()->create(['preferred_language' => 'de']);
        $this->owner = User::factory()->forTenant($this->testTenantId)->create(['preferred_language' => 'fr']);
        $this->orgAdmin = User::factory()->forTenant($this->testTenantId)->create();
        $this->donor = User::factory()->forTenant($this->testTenantId)->create(['first_name' => 'Dana', 'last_name' => 'Donor']);
        $this->orgId = (int) DB::table('vol_organizations')->insertGetId([
            'tenant_id' => $this->testTenantId, 'user_id' => $this->owner->id, 'name' => 'Food Bank',
            'slug' => 'notify-org-' . uniqid(), 'status' => 'approved', 'created_at' => now(),
        ]);
        DB::table('org_members')->insert([
            'tenant_id' => $this->testTenantId, 'organization_id' => $this->orgId, 'org_type' => 'volunteer',
            'user_id' => $this->orgAdmin->id, 'role' => 'admin', 'status' => 'active',
            'created_at' => now(), 'updated_at' => now(),
        ]);

        // Record every email instead of sending it.
        $emails = &$this->emails;
        $fake = \Mockery::mock(EmailDispatchService::class);
        $fake->shouldReceive('send')->andReturnUsing(function ($to, $subject, $body, $options = []) use (&$emails) {
            $emails[] = ['to' => (string) $to, 'subject' => (string) $subject, 'body' => (string) $body, 'options' => (array) $options];
            return true;
        });
        $this->app->instance(EmailDispatchService::class, $fake);
    }

    private function campaign(?int $orgId = null, array $overrides = []): int
    {
        return (int) DB::table('vol_giving_days')->insertGetId(array_merge([
            'tenant_id' => $this->testTenantId, 'title' => 'Winter appeal',
            'start_date' => now()->subDay()->toDateString(), 'end_date' => now()->addWeek()->toDateString(),
            'goal_amount' => 500, 'raised_amount' => 100, 'is_active' => 1,
            'organization_id' => $orgId ?? $this->orgId, 'created_by' => 1, 'created_at' => now(),
        ], $overrides));
    }

    /** @return array<int, array{to: string, subject: string, body: string, options: array<string, mixed>}> */
    private function emailsTo(User $user): array
    {
        return array_values(array_filter($this->emails, fn ($e) => $e['to'] === $user->email));
    }

    private function bell(User $user): ?object
    {
        return DB::table('notifications')->where('user_id', $user->id)->where('type', 'vol_fundraising')->orderByDesc('id')->first();
    }

    private function community(): string
    {
        return (string) DB::table('tenants')->where('id', $this->testTenantId)->value('name');
    }

    // 1 ───────────────────────────────────────────────────────────────────

    public function test_community_admins_are_emailed_with_a_pause_link_when_an_organisation_starts_a_campaign(): void
    {
        Sanctum::actingAs($this->owner);
        $response = $this->apiPost('/v2/volunteering/organisations/' . $this->orgId . '/campaigns', [
            'title' => 'Spring appeal', 'description' => 'New roof',
            'start_date' => now()->toDateString(), 'end_date' => now()->addMonth()->toDateString(),
            'goal_amount' => 2500,
        ]);
        $response->assertStatus(201);
        $campaignId = (int) $response->json('data.id');

        $mail = $this->emailsTo($this->communityAdmin);
        $this->assertCount(1, $mail, 'the community admin is emailed once');
        $this->assertSame('volunteer_fundraising', $mail[0]['options']['category'] ?? null);
        $this->assertStringContainsString('/admin/volunteering/giving-days?pause=' . $campaignId, $mail[0]['body']);
        $this->assertSame(
            LocaleContext::withLocale('de', fn () => __('fundraising.email.campaign_created_subject', ['organisation' => 'Food Bank', 'campaign' => 'Spring appeal'])),
            $mail[0]['subject'],
            'in the admin\'s own language',
        );

        $bell = $this->bell($this->communityAdmin);
        $this->assertNotNull($bell);
        $this->assertSame('/admin/volunteering/giving-days?pause=' . $campaignId, $bell->link);

        $this->assertSame([], $this->emailsTo($this->owner), 'the organisation owner who started it is not emailed about it');
    }

    public function test_a_campaign_created_by_a_community_admin_does_not_alert_the_admins(): void
    {
        VolunteerDonationService::createGivingDay([
            'title' => 'Community appeal', 'start_date' => now()->toDateString(),
            'end_date' => now()->addMonth()->toDateString(), 'goal_amount' => 100,
            'created_by' => $this->communityAdmin->id, 'organization_id' => $this->orgId,
        ], $this->testTenantId);

        $this->assertSame([], $this->emails);
    }

    // 2 ───────────────────────────────────────────────────────────────────

    public function test_the_organisation_is_told_when_the_community_pauses_its_campaign(): void
    {
        $campaignId = $this->campaign();

        VolunteerDonationService::updateGivingDay($campaignId, ['is_active' => false], $this->testTenantId, $this->communityAdmin->id);

        $this->assertCount(1, $this->emailsTo($this->owner));
        $this->assertCount(1, $this->emailsTo($this->orgAdmin));
        $this->assertSame(
            LocaleContext::withLocale('fr', fn () => __('fundraising.email.campaign_paused_subject', ['community' => $this->community(), 'campaign' => 'Winter appeal'])),
            $this->emailsTo($this->owner)[0]['subject'],
        );
        $this->assertSame('/volunteering/org/' . $this->orgId . '/dashboard?tab=fundraising', $this->bell($this->orgAdmin)?->link);
        $this->assertSame([], $this->emailsTo($this->communityAdmin), 'the admin who paused it is not emailed');
    }

    public function test_the_organisation_is_told_when_the_community_ends_its_campaign(): void
    {
        $campaignId = $this->campaign(null, ['end_date' => now()->toDateString()]);

        VolunteerDonationService::updateGivingDay($campaignId, ['is_active' => false], $this->testTenantId, $this->communityAdmin->id);

        $this->assertSame(
            LocaleContext::withLocale('fr', fn () => __('fundraising.email.campaign_ended_subject', ['community' => $this->community(), 'campaign' => 'Winter appeal'])),
            $this->emailsTo($this->owner)[0]['subject'] ?? null,
        );
    }

    public function test_no_alert_when_the_organisation_pauses_its_own_campaign_or_on_other_edits(): void
    {
        $campaignId = $this->campaign();

        VolunteerDonationService::updateGivingDay($campaignId, ['title' => 'Renamed'], $this->testTenantId, $this->communityAdmin->id);
        VolunteerDonationService::updateGivingDay($campaignId, ['is_active' => false], $this->testTenantId, $this->owner->id, History::ACTOR_ORG_ADMIN);

        $this->assertSame([], $this->emails);
    }

    public function test_pausing_a_whole_community_campaign_alerts_nobody(): void
    {
        $campaignId = (int) DB::table('vol_giving_days')->insertGetId([
            'tenant_id' => $this->testTenantId, 'title' => 'Community appeal',
            'start_date' => now()->subDay()->toDateString(), 'end_date' => now()->addWeek()->toDateString(),
            'goal_amount' => 500, 'raised_amount' => 0, 'is_active' => 1,
            'organization_id' => null, 'created_by' => 1, 'created_at' => now(),
        ]);

        VolunteerDonationService::updateGivingDay($campaignId, ['is_active' => false], $this->testTenantId, $this->communityAdmin->id);

        $this->assertSame([], $this->emails);
    }

    // 3 ───────────────────────────────────────────────────────────────────

    public function test_community_admins_are_told_when_the_organisation_confirms_a_handover(): void
    {
        $campaignId = $this->campaign();
        $handover = FundraisingHandoverService::record($this->testTenantId, $campaignId, $this->communityAdmin->id, [
            'amount' => 60, 'handed_over_on' => now()->toDateString(), 'method' => 'bank_transfer', 'reference' => 'TRF-9',
        ]);
        $this->emails = [];

        FundraisingHandoverService::confirm($this->testTenantId, $this->orgId, (int) $handover['id'], $this->owner->id);

        $mail = $this->emailsTo($this->communityAdmin);
        $this->assertCount(1, $mail);
        $this->assertSame(
            LocaleContext::withLocale('de', fn () => __('fundraising.email.handover_confirmed_subject', ['organisation' => 'Food Bank', 'amount' => '60.00 ' . $handover['currency']])),
            $mail[0]['subject'],
        );
        $this->assertSame([], $this->emailsTo($this->owner), 'the person who confirmed is not emailed');
    }

    // 4 ───────────────────────────────────────────────────────────────────

    public function test_the_organisation_is_told_when_a_pledge_is_marked_paid_with_the_donors_name(): void
    {
        $campaignId = $this->campaign();
        $donation = VolunteerDonationService::createDonation($this->donor->id, [
            'amount' => 25, 'payment_method' => 'bank_transfer', 'giving_day_id' => $campaignId,
        ]);
        $this->assertSame([], $this->emails, 'a pledge is not a gift until it is paid');

        VolunteerDonationService::markCompleted($donation['id'], $this->testTenantId, $this->communityAdmin->id);

        $mail = $this->emailsTo($this->orgAdmin);
        $this->assertCount(1, $mail);
        $this->assertStringContainsString('Dana Donor', $mail[0]['body']);
        $this->assertStringNotContainsString((string) $this->donor->email, $mail[0]['body'], 'never the donor\'s email');
        $this->assertCount(1, $this->emailsTo($this->owner));

        VolunteerDonationService::markCompleted($donation['id'], $this->testTenantId, $this->communityAdmin->id);
        $this->assertCount(1, $this->emailsTo($this->orgAdmin), 'marking it paid again sends nothing more');
    }

    public function test_an_anonymous_gift_is_reported_without_a_name(): void
    {
        $campaignId = $this->campaign();
        $donation = VolunteerDonationService::createDonation($this->donor->id, [
            'amount' => 25, 'payment_method' => 'cash', 'giving_day_id' => $campaignId, 'is_anonymous' => true,
        ]);

        VolunteerDonationService::markCompleted($donation['id'], $this->testTenantId, $this->communityAdmin->id);

        $body = $this->emailsTo($this->orgAdmin)[0]['body'] ?? '';
        $this->assertStringNotContainsString('Dana', $body);
        $this->assertStringContainsString(htmlspecialchars(__('fundraising.email.gift_anonymous'), ENT_QUOTES, 'UTF-8'), $body);
    }

    public function test_the_organisation_is_told_when_a_card_gift_succeeds(): void
    {
        $campaignId = $this->campaign();
        $donationId = (int) DB::table('vol_donations')->insertGetId([
            'tenant_id' => $this->testTenantId, 'user_id' => $this->donor->id, 'giving_day_id' => $campaignId,
            'organization_id' => $this->orgId, 'amount' => 40, 'currency' => 'EUR', 'payment_method' => 'stripe',
            'payment_reference' => '', 'donor_name' => 'Dana Donor', 'donor_email' => $this->donor->email,
            'status' => 'pending', 'stripe_payment_intent_id' => 'pi_notify_' . uniqid(), 'created_at' => now(),
        ]);
        $pi = DB::table('vol_donations')->where('id', $donationId)->value('stripe_payment_intent_id');

        StripeDonationService::handlePaymentSucceeded((object) [
            'id' => $pi,
            'metadata' => (object) ['nexus_tenant_id' => (string) $this->testTenantId, 'nexus_donation_id' => (string) $donationId],
        ]);

        $this->assertSame('completed', DB::table('vol_donations')->where('id', $donationId)->value('status'));
        $this->assertCount(1, $this->emailsTo($this->orgAdmin));
        $this->assertNotNull($this->bell($this->owner));
    }

    public function test_a_gift_to_a_whole_community_campaign_does_not_alert_any_organisation(): void
    {
        $campaignId = (int) DB::table('vol_giving_days')->insertGetId([
            'tenant_id' => $this->testTenantId, 'title' => 'Community appeal',
            'start_date' => now()->subDay()->toDateString(), 'end_date' => now()->addWeek()->toDateString(),
            'goal_amount' => 500, 'raised_amount' => 0, 'is_active' => 1,
            'organization_id' => null, 'created_by' => 1, 'created_at' => now(),
        ]);
        $donation = VolunteerDonationService::createDonation($this->donor->id, [
            'amount' => 10, 'payment_method' => 'cash', 'giving_day_id' => $campaignId,
        ]);

        VolunteerDonationService::markCompleted($donation['id'], $this->testTenantId, $this->communityAdmin->id);

        $this->assertSame([], $this->emailsTo($this->owner));
        $this->assertSame([], $this->emailsTo($this->orgAdmin));
    }

    // ─────────────────────────────────────────────────────────────────────

    public function test_none_of_the_alerts_hits_its_error_guard(): void
    {
        // Every alert swallows failures so it can never undo a saved change or
        // fail a Stripe webhook — which would also hide a coding error.
        Log::spy();
        $campaignId = $this->campaign();
        FundraisingHandoverService::record($this->testTenantId, $campaignId, $this->communityAdmin->id, [
            'amount' => 10, 'handed_over_on' => now()->toDateString(), 'method' => 'cash', 'reference' => 'R1',
        ]);
        $handoverId = (int) DB::table('vol_fundraising_handovers')->where('giving_day_id', $campaignId)->value('id');
        FundraisingHandoverService::confirm($this->testTenantId, $this->orgId, $handoverId, $this->owner->id);
        $donation = VolunteerDonationService::createDonation($this->donor->id, [
            'amount' => 5, 'payment_method' => 'cash', 'giving_day_id' => $campaignId,
        ]);
        VolunteerDonationService::markCompleted($donation['id'], $this->testTenantId, $this->communityAdmin->id);
        VolunteerDonationService::updateGivingDay($campaignId, ['is_active' => false], $this->testTenantId, $this->communityAdmin->id);
        \App\Services\FundraisingNotificationService::campaignCreatedByOrganisation($this->testTenantId, $campaignId, $this->owner->id);

        Log::shouldNotHaveReceived('warning', [\Mockery::pattern('/FundraisingNotificationService/')]);
        $this->assertNotEmpty($this->emails);
    }
}
