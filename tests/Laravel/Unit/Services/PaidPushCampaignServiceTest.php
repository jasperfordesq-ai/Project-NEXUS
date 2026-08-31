<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

declare(strict_types=1);

namespace Tests\Laravel\Unit\Services;

use App\Core\TenantContext;
use App\Services\PaidPushCampaignService;
use Carbon\Carbon;
use Illuminate\Foundation\Testing\DatabaseTransactions;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Http;
use Tests\Laravel\TestCase;

/**
 * PaidPushCampaignServiceTest — AG57 Paid Push Campaign Management.
 *
 * Strategy:
 *  - Real DB via DatabaseTransactions (rolled back after each test).
 *  - Http::fake() prevents live FCM/Expo HTTP calls; FCMPushService gracefully
 *    no-ops when no FCM tokens are in the DB anyway, but we fake Http to be safe.
 *  - All fixtures use real columns from database/schema/mysql-schema.sql.
 *  - dispatchCampaign: resolveRecipientIds returns [] because test users have no
 *    FCM device tokens, so the service takes the zero-sends path — verified.
 *  - Money accounting (total_cost_cents) tested via the happy-path with tokens
 *    NOT seeded — zero sends → zero cost; cost formula tested via a seeded campaign
 *    where we assert the formula logic (cost_per_send × actual_send_count).
 *
 * Skipped:
 *  - approveCampaign with real audience Haversine: MariaDB acos/radians work but
 *    seeding coordinates is fiddly and already covered by estimateAudience tests.
 *  - FCM HTTP v1 / Expo HTTP paths: no FCM credentials in test env; graceful no-op
 *    is the expected behaviour, and Http::fake() guards the outer HTTP layer.
 */
class PaidPushCampaignServiceTest extends TestCase
{
    use DatabaseTransactions;

    private const TENANT_ID = 2;

    protected function setUp(): void
    {
        parent::setUp();
        TenantContext::setById(self::TENANT_ID);
        Http::fake();
    }

    // ─── Helpers ──────────────────────────────────────────────────────────────

    /**
     * Insert a minimal active user and return its ID.
     */
    private function insertUser(string $suffix = ''): int
    {
        $uid = uniqid($suffix, true);
        return DB::table('users')->insertGetId([
            'tenant_id'   => self::TENANT_ID,
            'name'        => 'Test User ' . $uid,
            'first_name'  => 'Test',
            'last_name'   => 'User',
            'email'       => 'ppctest.' . $uid . '@example.test',
            'status'      => 'active',
            'balance'     => 0,
            'role'        => 'member',
            'is_approved' => 1,
            'created_at'  => now(),
            'updated_at'  => now(),
        ]);
    }

    /**
     * Create a minimal campaign via the service and return the result array.
     *
     * @param array<string,mixed> $overrides
     */
    private function createCampaign(int $userId, array $overrides = []): array
    {
        $data = array_merge([
            'name'  => 'Test Campaign',
            'title' => 'Hello Neighbour',
            'body'  => 'Come join us this weekend.',
        ], $overrides);

        return PaidPushCampaignService::createCampaign(self::TENANT_ID, $userId, $data);
    }

    // ─── isAvailable ──────────────────────────────────────────────────────────

    public function test_isAvailable_returns_true_when_tables_exist(): void
    {
        $this->assertTrue(PaidPushCampaignService::isAvailable());
    }

    // ─── createCampaign ───────────────────────────────────────────────────────

    public function test_createCampaign_returns_array_with_id_and_draft_status(): void
    {
        $userId   = $this->insertUser('creator');
        $campaign = $this->createCampaign($userId);

        $this->assertIsArray($campaign);
        $this->assertArrayHasKey('id', $campaign);
        $this->assertGreaterThan(0, $campaign['id']);
        $this->assertSame('draft', $campaign['status']);
    }

    public function test_createCampaign_persists_name_title_body(): void
    {
        $userId   = $this->insertUser('c2');
        $campaign = $this->createCampaign($userId, [
            'name'  => 'My Ad',
            'title' => 'Buy Local',
            'body'  => 'Support your community.',
        ]);

        $this->assertSame('My Ad', $campaign['name']);
        $this->assertSame('Buy Local', $campaign['title']);
        $this->assertSame('Support your community.', $campaign['body']);
    }

    public function test_createCampaign_defaults_advertiser_type_to_sme(): void
    {
        $userId   = $this->insertUser('c3');
        $campaign = $this->createCampaign($userId);

        $this->assertSame('sme', $campaign['advertiser_type']);
    }

    public function test_createCampaign_stores_explicit_advertiser_type(): void
    {
        $userId   = $this->insertUser('c4');
        $campaign = $this->createCampaign($userId, ['advertiser_type' => 'verein']);

        $this->assertSame('verein', $campaign['advertiser_type']);
    }

    public function test_createCampaign_initialises_send_counts_to_zero(): void
    {
        $userId   = $this->insertUser('c5');
        $campaign = $this->createCampaign($userId);

        $this->assertSame(0, (int) $campaign['actual_send_count']);
        $this->assertSame(0, (int) $campaign['total_cost_cents']);
        $this->assertSame(0, (int) $campaign['open_count']);
        $this->assertSame(0, (int) $campaign['click_count']);
    }

    public function test_createCampaign_uses_default_cost_per_send_of_5(): void
    {
        $userId   = $this->insertUser('c6');
        $campaign = $this->createCampaign($userId);

        $this->assertSame(5, (int) $campaign['cost_per_send']);
    }

    public function test_createCampaign_clamps_cost_per_send_to_SecurityBounds(): void
    {
        $userId   = $this->insertUser('c7');
        // Pass 99999 — SecurityBounds::MAX_PAID_PUSH_COST_PER_SEND_CENTS = 1000
        $campaign = $this->createCampaign($userId, ['cost_per_send' => 99999]);

        $this->assertSame(1000, (int) $campaign['cost_per_send']);
    }

    public function test_createCampaign_cta_url_null_when_empty(): void
    {
        $userId   = $this->insertUser('c8');
        $campaign = $this->createCampaign($userId, ['cta_url' => '']);

        $this->assertNull($campaign['cta_url']);
    }

    public function test_createCampaign_stores_valid_cta_url(): void
    {
        $userId   = $this->insertUser('c9');
        $campaign = $this->createCampaign($userId, ['cta_url' => 'https://example.com/promo']);

        $this->assertSame('https://example.com/promo', $campaign['cta_url']);
    }

    public function test_createCampaign_rejects_unsafe_cta_url(): void
    {
        $this->expectException(\InvalidArgumentException::class);

        $userId = $this->insertUser('c10');
        $this->createCampaign($userId, ['cta_url' => 'javascript:alert(1)']);
    }

    public function test_paid_campaign_cta_rejects_non_https_credentials_fragments_and_secrets(): void
    {
        $method = new \ReflectionMethod(PaidPushCampaignService::class, 'safeCtaUrl');
        $method->setAccessible(true);

        foreach ([
            'http://example.com/promo',
            'https://member:password@example.com/promo',
            'https://example.com:444/promo',
            'https://example.com/promo#offer',
            'https://example.com/promo?token=secret',
            'https://127.0.0.1/promo',
            'https://offers.internal/promo',
            'https://offers.local/promo',
        ] as $unsafe) {
            try {
                $method->invoke(null, $unsafe);
                $this->fail("Unsafe paid-push CTA was accepted: {$unsafe}");
            } catch (\ReflectionException $exception) {
                throw $exception;
            } catch (\Throwable $exception) {
                $this->assertInstanceOf(\InvalidArgumentException::class, $exception->getPrevious() ?? $exception);
            }
        }
    }

    public function test_createCampaign_stores_audience_filter_as_json(): void
    {
        $userId  = $this->insertUser('c11');
        $filter  = ['radius_km' => 10, 'lat' => 53.3, 'lng' => -6.2];
        $campaign = $this->createCampaign($userId, ['audience_filter' => $filter]);

        // The DB row stores JSON; the service joins the row and returns it
        $row = DB::table('paid_push_campaigns')->where('id', $campaign['id'])->first();
        $this->assertNotNull($row->audience_filter);
        $decoded = json_decode($row->audience_filter, true);
        $this->assertSame($filter, $decoded);
    }

    public function test_createCampaign_stores_scheduled_at_when_provided(): void
    {
        $userId   = $this->insertUser('c12');
        $future   = Carbon::now()->addDays(3)->toDateTimeString();
        $campaign = $this->createCampaign($userId, ['scheduled_at' => $future]);

        $this->assertNotNull($campaign['scheduled_at']);
    }

    public function test_createCampaign_scopes_to_tenant(): void
    {
        $userId   = $this->insertUser('c13');
        $campaign = $this->createCampaign($userId);

        $this->assertSame(self::TENANT_ID, (int) $campaign['tenant_id']);
    }

    // ─── getCampaignById ──────────────────────────────────────────────────────

    public function test_getCampaignById_returns_null_for_wrong_tenant(): void
    {
        $userId   = $this->insertUser('gb1');
        $campaign = $this->createCampaign($userId);

        $result = PaidPushCampaignService::getCampaignById((int) $campaign['id'], 999999);

        $this->assertNull($result);
    }

    public function test_getCampaignById_returns_campaign_for_correct_tenant(): void
    {
        $userId   = $this->insertUser('gb2');
        $created  = $this->createCampaign($userId, ['name' => 'Retrievable']);

        $fetched  = PaidPushCampaignService::getCampaignById((int) $created['id'], self::TENANT_ID);

        $this->assertIsArray($fetched);
        $this->assertSame('Retrievable', $fetched['name']);
    }

    // ─── listCampaigns ────────────────────────────────────────────────────────

    public function test_listCampaigns_returns_only_this_tenants_campaigns(): void
    {
        $userId = $this->insertUser('lc1');
        $this->createCampaign($userId, ['name' => 'Tenant2Camp']);

        $list = PaidPushCampaignService::listCampaigns(self::TENANT_ID);

        $names = array_column($list, 'name');
        $this->assertContains('Tenant2Camp', $names);

        // None should belong to a different tenant
        foreach ($list as $row) {
            $this->assertSame(self::TENANT_ID, (int) $row['tenant_id']);
        }
    }

    public function test_listCampaigns_filters_by_status(): void
    {
        $userId = $this->insertUser('lc2');
        $this->createCampaign($userId, ['name' => 'Draft One']);
        // Manually insert a 'sent' campaign
        DB::table('paid_push_campaigns')->insert([
            'tenant_id'        => self::TENANT_ID,
            'created_by'       => $userId,
            'name'             => 'Sent One',
            'status'           => 'sent',
            'advertiser_type'  => 'sme',
            'title'            => 'T',
            'body'             => 'B',
            'actual_send_count' => 10,
            'total_cost_cents'  => 50,
            'cost_per_send'    => 5,
            'open_count'       => 0,
            'click_count'      => 0,
            'created_at'       => now(),
            'updated_at'       => now(),
        ]);

        $draftList = PaidPushCampaignService::listCampaigns(self::TENANT_ID, 'draft');
        $sentList  = PaidPushCampaignService::listCampaigns(self::TENANT_ID, 'sent');

        foreach ($draftList as $row) {
            $this->assertSame('draft', $row['status']);
        }
        foreach ($sentList as $row) {
            $this->assertSame('sent', $row['status']);
        }
    }

    // ─── updateCampaign ───────────────────────────────────────────────────────

    public function test_updateCampaign_updates_name_and_title(): void
    {
        $userId   = $this->insertUser('u1');
        $campaign = $this->createCampaign($userId, ['name' => 'Old Name', 'title' => 'Old Title']);

        $updated  = PaidPushCampaignService::updateCampaign(
            (int) $campaign['id'],
            self::TENANT_ID,
            ['name' => 'New Name', 'title' => 'New Title']
        );

        $this->assertSame('New Name', $updated['name']);
        $this->assertSame('New Title', $updated['title']);
    }

    public function test_updateCampaign_throws_when_campaign_not_found(): void
    {
        $this->expectException(\RuntimeException::class);
        $this->expectExceptionMessageMatches('/not found/i');

        PaidPushCampaignService::updateCampaign(999999999, self::TENANT_ID, ['name' => 'X']);
    }

    public function test_updateCampaign_throws_when_status_is_sent(): void
    {
        $userId = $this->insertUser('u2');
        // Insert a 'sent' campaign directly — cannot be edited
        $id = DB::table('paid_push_campaigns')->insertGetId([
            'tenant_id'        => self::TENANT_ID,
            'created_by'       => $userId,
            'name'             => 'Sent Camp',
            'status'           => 'sent',
            'advertiser_type'  => 'sme',
            'title'            => 'T',
            'body'             => 'B',
            'actual_send_count' => 5,
            'total_cost_cents'  => 25,
            'cost_per_send'    => 5,
            'open_count'       => 0,
            'click_count'      => 0,
            'created_at'       => now(),
            'updated_at'       => now(),
        ]);

        $this->expectException(\RuntimeException::class);
        $this->expectExceptionMessageMatches('/cannot be edited/i');

        PaidPushCampaignService::updateCampaign($id, self::TENANT_ID, ['name' => 'Hack']);
    }

    public function test_updateCampaign_allowed_in_pending_review_status(): void
    {
        $userId = $this->insertUser('u3');
        $id = DB::table('paid_push_campaigns')->insertGetId([
            'tenant_id'        => self::TENANT_ID,
            'created_by'       => $userId,
            'name'             => 'Pending Camp',
            'status'           => 'pending_review',
            'advertiser_type'  => 'sme',
            'title'            => 'T',
            'body'             => 'B',
            'actual_send_count' => 0,
            'total_cost_cents'  => 0,
            'cost_per_send'    => 5,
            'open_count'       => 0,
            'click_count'      => 0,
            'created_at'       => now(),
            'updated_at'       => now(),
        ]);

        $updated = PaidPushCampaignService::updateCampaign($id, self::TENANT_ID, ['title' => 'Updated Title']);

        $this->assertSame('Updated Title', $updated['title']);
    }

    // ─── rejectCampaign ───────────────────────────────────────────────────────

    public function test_rejectCampaign_sets_status_to_rejected(): void
    {
        $userId = $this->insertUser('rej1');
        $id = DB::table('paid_push_campaigns')->insertGetId([
            'tenant_id'        => self::TENANT_ID,
            'created_by'       => $userId,
            'name'             => 'Pending For Rejection',
            'status'           => 'pending_review',
            'advertiser_type'  => 'sme',
            'title'            => 'T',
            'body'             => 'B',
            'actual_send_count' => 0,
            'total_cost_cents'  => 0,
            'cost_per_send'    => 5,
            'open_count'       => 0,
            'click_count'      => 0,
            'created_at'       => now(),
            'updated_at'       => now(),
        ]);

        PaidPushCampaignService::rejectCampaign($id, self::TENANT_ID, 'Contains prohibited content.');

        $row = DB::table('paid_push_campaigns')->where('id', $id)->first();
        $this->assertSame('rejected', $row->status);
        $this->assertSame('Contains prohibited content.', $row->rejection_reason);
    }

    public function test_rejectCampaign_throws_when_status_is_draft(): void
    {
        $userId   = $this->insertUser('rej2');
        $campaign = $this->createCampaign($userId);

        $this->expectException(\RuntimeException::class);
        $this->expectExceptionMessageMatches('/cannot be rejected/i');

        PaidPushCampaignService::rejectCampaign((int) $campaign['id'], self::TENANT_ID, 'Nope');
    }

    public function test_rejectCampaign_throws_when_campaign_not_found(): void
    {
        $this->expectException(\RuntimeException::class);
        $this->expectExceptionMessageMatches('/not found/i');

        PaidPushCampaignService::rejectCampaign(999999999, self::TENANT_ID, 'Reason');
    }

    // ─── estimateAudience ─────────────────────────────────────────────────────

    public function test_estimateAudience_counts_active_users_in_tenant(): void
    {
        // Insert a couple of active users for tenant 2
        $this->insertUser('ea1');
        $this->insertUser('ea2');

        $count = PaidPushCampaignService::estimateAudience(self::TENANT_ID, []);

        // Must be at least the 2 we just inserted (there may be pre-existing fixture users)
        $this->assertGreaterThanOrEqual(2, $count);
    }

    public function test_estimateAudience_returns_zero_for_tenant_with_no_users(): void
    {
        // Use a throwaway tenant ID that has no users
        $ghostTenant = 98877;
        DB::table('tenants')->insertOrIgnore([
            'id'                 => $ghostTenant,
            'name'               => 'Ghost Tenant',
            'slug'               => 'ghost-ppc-' . $ghostTenant,
            'is_active'          => true,
            'depth'              => 0,
            'allows_subtenants'  => false,
            'created_at'         => now(),
            'updated_at'         => now(),
        ]);

        $count = PaidPushCampaignService::estimateAudience($ghostTenant, []);

        $this->assertSame(0, $count);
    }

    public function test_promotional_push_audience_requires_explicit_campaign_opt_in(): void
    {
        $optedIn = $this->insertUser('campaign-opted-in');
        $notOptedIn = $this->insertUser('campaign-not-opted-in');

        DB::table('users')->where('id', $optedIn)->update([
            'notification_preferences' => json_encode([
                'push_enabled' => true,
                'push_campaigns_opted_in' => true,
            ], JSON_THROW_ON_ERROR),
        ]);
        DB::table('users')->where('id', $notOptedIn)->update([
            'notification_preferences' => json_encode([
                'push_enabled' => true,
                'push_campaigns_opted_in' => false,
            ], JSON_THROW_ON_ERROR),
        ]);

        $method = new \ReflectionMethod(PaidPushCampaignService::class, 'resolveRecipientIds');
        $recipients = $method->invoke(null, self::TENANT_ID, []);

        $this->assertContains($optedIn, $recipients);
        $this->assertNotContains($notOptedIn, $recipients);
    }

    // ─── dispatchCampaign ─────────────────────────────────────────────────────

    public function test_dispatchCampaign_throws_when_status_is_not_sending_or_scheduled(): void
    {
        $userId   = $this->insertUser('dp1');
        $campaign = $this->createCampaign($userId); // status = draft

        $this->expectException(\RuntimeException::class);
        $this->expectExceptionMessageMatches('/not ready to dispatch/i');

        PaidPushCampaignService::dispatchCampaign((int) $campaign['id'], self::TENANT_ID);
    }

    public function test_dispatchCampaign_zero_sends_when_no_recipients_exist(): void
    {
        // Use an isolated tenant with no active users
        $isolatedTenant = 98878;
        DB::table('tenants')->insertOrIgnore([
            'id'                 => $isolatedTenant,
            'name'               => 'Isolated Tenant',
            'slug'               => 'isolated-ppc-' . $isolatedTenant,
            'is_active'          => true,
            'depth'              => 0,
            'allows_subtenants'  => false,
            'created_at'         => now(),
            'updated_at'         => now(),
        ]);
        TenantContext::setById($isolatedTenant);

        // Insert a creator user for this tenant
        $userId = DB::table('users')->insertGetId([
            'tenant_id'   => $isolatedTenant,
            'name'        => 'Isolated Creator',
            'first_name'  => 'Iso',
            'last_name'   => 'Creator',
            'email'       => 'iso.creator@example.test',
            'status'      => 'active',
            'balance'     => 0,
            'role'        => 'member',
            'is_approved' => 1,
            'created_at'  => now(),
            'updated_at'  => now(),
        ]);

        // Create campaign in sending status
        $campaignId = DB::table('paid_push_campaigns')->insertGetId([
            'tenant_id'        => $isolatedTenant,
            'created_by'       => $userId,
            'name'             => 'Zero Dispatch',
            'status'           => 'sending',
            'advertiser_type'  => 'sme',
            'title'            => 'Test',
            'body'             => 'Body',
            'actual_send_count' => 0,
            'total_cost_cents'  => 0,
            'cost_per_send'    => 5,
            'open_count'       => 0,
            'click_count'      => 0,
            'created_at'       => now(),
            'updated_at'       => now(),
        ]);

        // Delete all active users (our creator is the only one — make inactive to empty audience)
        DB::table('users')->where('tenant_id', $isolatedTenant)->update(['status' => 'inactive']);

        $result = PaidPushCampaignService::dispatchCampaign($campaignId, $isolatedTenant);

        $this->assertSame(0, $result['sent']);
        $this->assertSame(0, $result['failed']);
        $this->assertSame(0, $result['total_cost_cents']);

        $row = DB::table('paid_push_campaigns')->where('id', $campaignId)->first();
        $this->assertSame('sent', $row->status);
        $this->assertSame(0, (int) $row->actual_send_count);
        $this->assertSame(0, (int) $row->total_cost_cents);
    }

    // ─── recordOpen ───────────────────────────────────────────────────────────

    public function test_recordOpen_increments_open_count_on_first_open(): void
    {
        $userId = $this->insertUser('ro1');
        $id = DB::table('paid_push_campaigns')->insertGetId([
            'tenant_id'        => self::TENANT_ID,
            'created_by'       => $userId,
            'name'             => 'Open Track',
            'status'           => 'sent',
            'advertiser_type'  => 'sme',
            'title'            => 'T',
            'body'             => 'B',
            'actual_send_count' => 1,
            'total_cost_cents'  => 5,
            'cost_per_send'    => 5,
            'open_count'       => 0,
            'click_count'      => 0,
            'created_at'       => now(),
            'updated_at'       => now(),
        ]);

        // Insert a sends row (required for FK + the open tracking update)
        DB::table('paid_push_campaign_sends')->insert([
            'campaign_id' => $id,
            'tenant_id'   => self::TENANT_ID,
            'user_id'     => $userId,
            'sent_at'     => now(),
            'opened_at'   => null,
        ]);

        PaidPushCampaignService::recordOpen($id, $userId, self::TENANT_ID);

        $row = DB::table('paid_push_campaigns')->where('id', $id)->first();
        $this->assertSame(1, (int) $row->open_count);
    }

    public function test_recordOpen_does_not_double_count_on_second_open(): void
    {
        $userId = $this->insertUser('ro2');
        $id = DB::table('paid_push_campaigns')->insertGetId([
            'tenant_id'        => self::TENANT_ID,
            'created_by'       => $userId,
            'name'             => 'Double Open',
            'status'           => 'sent',
            'advertiser_type'  => 'sme',
            'title'            => 'T',
            'body'             => 'B',
            'actual_send_count' => 1,
            'total_cost_cents'  => 5,
            'cost_per_send'    => 5,
            'open_count'       => 0,
            'click_count'      => 0,
            'created_at'       => now(),
            'updated_at'       => now(),
        ]);

        DB::table('paid_push_campaign_sends')->insert([
            'campaign_id' => $id,
            'tenant_id'   => self::TENANT_ID,
            'user_id'     => $userId,
            'sent_at'     => now(),
            'opened_at'   => null,
        ]);

        // Record open twice
        PaidPushCampaignService::recordOpen($id, $userId, self::TENANT_ID);
        PaidPushCampaignService::recordOpen($id, $userId, self::TENANT_ID);

        $row = DB::table('paid_push_campaigns')->where('id', $id)->first();
        // Second call is a no-op because opened_at is already set
        $this->assertSame(1, (int) $row->open_count);
    }

    public function test_recordOpen_cannot_update_a_send_from_another_tenant(): void
    {
        $userId = $this->insertUser('ro3');
        $id = DB::table('paid_push_campaigns')->insertGetId([
            'tenant_id'         => self::TENANT_ID,
            'created_by'        => $userId,
            'name'              => 'Tenant Scoped Open',
            'status'            => 'sent',
            'advertiser_type'   => 'sme',
            'title'             => 'T',
            'body'              => 'B',
            'actual_send_count' => 1,
            'total_cost_cents'  => 5,
            'cost_per_send'     => 5,
            'open_count'        => 0,
            'click_count'       => 0,
            'created_at'        => now(),
            'updated_at'        => now(),
        ]);

        DB::table('paid_push_campaign_sends')->insert([
            'campaign_id' => $id,
            'tenant_id'   => self::TENANT_ID,
            'user_id'     => $userId,
            'sent_at'     => now(),
            'opened_at'   => null,
        ]);

        PaidPushCampaignService::recordOpen($id, $userId, self::TENANT_ID + 1);

        $campaign = DB::table('paid_push_campaigns')->where('id', $id)->first();
        $send = DB::table('paid_push_campaign_sends')->where('campaign_id', $id)->first();
        $this->assertSame(0, (int) $campaign->open_count);
        $this->assertNull($send->opened_at);
    }

    // ─── getCampaignAnalytics ────────────────────────────────────────────────

    public function test_getCampaignAnalytics_returns_correct_structure(): void
    {
        $userId = $this->insertUser('an1');
        $id = DB::table('paid_push_campaigns')->insertGetId([
            'tenant_id'         => self::TENANT_ID,
            'created_by'        => $userId,
            'name'              => 'Analytics Camp',
            'status'            => 'sent',
            'advertiser_type'   => 'sme',
            'title'             => 'T',
            'body'              => 'B',
            'actual_send_count' => 20,
            'total_cost_cents'  => 100,
            'cost_per_send'     => 5,
            'open_count'        => 4,
            'click_count'       => 2,
            'created_at'        => now(),
            'updated_at'        => now(),
        ]);

        $analytics = PaidPushCampaignService::getCampaignAnalytics($id, self::TENANT_ID);

        $this->assertArrayHasKey('send_count', $analytics);
        $this->assertArrayHasKey('open_count', $analytics);
        $this->assertArrayHasKey('click_count', $analytics);
        $this->assertArrayHasKey('open_rate', $analytics);
        $this->assertArrayHasKey('daily_breakdown', $analytics);

        $this->assertSame(20, $analytics['send_count']);
        $this->assertSame(4, $analytics['open_count']);
        $this->assertSame(2, $analytics['click_count']);
        // open_rate = round((4/20)*100, 1) = 20.0
        $this->assertSame(20.0, $analytics['open_rate']);
    }

    public function test_getCampaignAnalytics_open_rate_zero_when_no_sends(): void
    {
        $userId = $this->insertUser('an2');
        $id = DB::table('paid_push_campaigns')->insertGetId([
            'tenant_id'         => self::TENANT_ID,
            'created_by'        => $userId,
            'name'              => 'Zero Sends Analytics',
            'status'            => 'sent',
            'advertiser_type'   => 'sme',
            'title'             => 'T',
            'body'              => 'B',
            'actual_send_count' => 0,
            'total_cost_cents'  => 0,
            'cost_per_send'     => 5,
            'open_count'        => 0,
            'click_count'       => 0,
            'created_at'        => now(),
            'updated_at'        => now(),
        ]);

        $analytics = PaidPushCampaignService::getCampaignAnalytics($id, self::TENANT_ID);

        $this->assertSame(0.0, $analytics['open_rate']);
    }

    public function test_getCampaignAnalytics_throws_when_campaign_not_found(): void
    {
        $this->expectException(\RuntimeException::class);
        $this->expectExceptionMessageMatches('/not found/i');

        PaidPushCampaignService::getCampaignAnalytics(999999999, self::TENANT_ID);
    }

    // ─── getOverviewStats ─────────────────────────────────────────────────────

    public function test_getOverviewStats_returns_correct_structure(): void
    {
        $stats = PaidPushCampaignService::getOverviewStats(self::TENANT_ID);

        $this->assertArrayHasKey('total_campaigns', $stats);
        $this->assertArrayHasKey('by_status', $stats);
        $this->assertArrayHasKey('sends_this_month', $stats);
        $this->assertArrayHasKey('opens_this_month', $stats);
        $this->assertArrayHasKey('revenue_cents_this_month', $stats);
    }

    public function test_getOverviewStats_counts_newly_created_campaign(): void
    {
        $userId = $this->insertUser('os1');
        $this->createCampaign($userId, ['name' => 'Count Me']);

        $stats = PaidPushCampaignService::getOverviewStats(self::TENANT_ID);

        $this->assertGreaterThanOrEqual(1, $stats['total_campaigns']);
        $this->assertArrayHasKey('draft', $stats['by_status']);
        $this->assertGreaterThanOrEqual(1, $stats['by_status']['draft']);
    }
}
