<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

declare(strict_types=1);

namespace Tests\Laravel\Feature;

use App\Core\TenantContext;
use App\Events\FederatedCommunityEventReceived;
use App\Events\FederatedConnectionReceived;
use App\Events\FederatedGroupReceived;
use App\Events\FederatedListingReceived;
use App\Events\FederatedMemberUpdated;
use App\Events\FederatedReviewReceived;
use App\Events\FederatedVolunteeringReceived;
use App\Listeners\HandleFederatedReviewReceived;
use App\Models\User;
use App\Services\EmailDispatchService;
use App\Services\SafeguardingInteractionPolicy;
use App\Support\SafeguardingInteractionDecision;
use Illuminate\Foundation\Testing\DatabaseTransactions;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Event;
use Illuminate\Support\Facades\Schema;
use Mockery;
use Tests\Laravel\TestCase;
use Tests\Laravel\Concerns\EnablesExternalFederation;

/**
 * Feature tests for the expanded inbound federation webhook handlers.
 *
 * Exercises all 8 new entity handlers (review, listing, event, group,
 * group membership, connection, volunteering, member sync) via the public
 * POST /api/v2/federation/external/webhooks/receive endpoint — using API-key
 * Bearer auth (signing_secret stored in plaintext for test convenience).
 */
class FederationInboundHandlersTest extends TestCase
{
    use DatabaseTransactions;

    use EnablesExternalFederation;

    private const WEBHOOK_URL = '/api/v2/federation/external/webhooks/receive';

    private int $partnerId;
    private string $partnerToken;

    protected function setUp(): void
    {
        parent::setUp();
        $this->enableExternalFederation();

        // Ensure shadow tables exist for the test run (fallback for envs where
        // migrations aren't run before each test)
        foreach ([
            'federation_events',
            'federation_groups',
            'federation_inbound_connections',
            'federation_volunteering',
            'federation_listings',
            'federation_members',
        ] as $table) {
            if (!Schema::hasTable($table)) {
                $this->markTestSkipped("Shadow table {$table} missing — run migrations.");
            }
        }

        $this->partnerToken = 'test-token-' . bin2hex(random_bytes(8));

        $partnerRow = [
            'tenant_id'          => $this->testTenantId,
            'name'               => 'Test Inbound Partner',
            'base_url'           => 'https://inbound-test.example',
            'api_path'           => '/api/v1/federation',
            'signing_secret'     => $this->partnerToken, // plaintext — decryptSecret falls back
            'status'             => 'active',
            'allow_member_search' => 1,
            'allow_listing_search' => 1,
            'allow_messaging'    => 1,
            'allow_transactions' => 1,
            'allow_events'       => 1,
            'allow_groups'       => 1,
            'created_at'         => now(),
            'updated_at'         => now(),
        ];

        foreach (['allow_connections', 'allow_volunteering', 'allow_member_sync'] as $flag) {
            if (Schema::hasColumn('federation_external_partners', $flag)) {
                $partnerRow[$flag] = 1;
            }
        }

        $this->partnerId = (int) DB::table('federation_external_partners')->insertGetId($partnerRow);

        TenantContext::setById($this->testTenantId);
    }

    /**
     * Post a webhook payload with the partner's Bearer token.
     *
     * @param array<string, mixed> $data
     */
    private function postWebhook(string $event, array $data, ?string $token = null): \Illuminate\Testing\TestResponse
    {
        return $this->withHeaders([
            'Authorization'      => 'Bearer ' . ($token ?? $this->partnerToken),
            'Content-Type'       => 'application/json',
            // Replay protection requires a unique nonce on every webhook
            'X-Federation-Nonce' => 'test-nonce-' . bin2hex(random_bytes(16)),
        ])->postJson(self::WEBHOOK_URL, [
            'event' => $event,
            'data'  => $data,
        ]);
    }

    // ------------------------------------------------------------------
    // Auth gate
    // ------------------------------------------------------------------

    public function test_unauthorized_without_bearer_token(): void
    {
        $response = $this->postJson(self::WEBHOOK_URL, [
            'event' => 'review.created',
            'data'  => ['external_id' => 'r1', 'rating' => 5, 'receiver_id' => 1],
        ]);
        $response->assertStatus(401);
    }

    public function test_unauthorized_with_wrong_bearer_token(): void
    {
        $response = $this->postWebhook('review.created', ['external_id' => 'r1'], 'totally-wrong-token');
        $response->assertStatus(401);
    }

    // ------------------------------------------------------------------
    // 1. Review inbound
    // ------------------------------------------------------------------

    public function test_review_created_persists_and_dispatches_event(): void
    {
        Event::fake([FederatedReviewReceived::class]);

        $receiver = User::factory()->forTenant($this->testTenantId)->create();
        // Federated reviewer must exist as a local user row (schema has FK
        // reviews.reviewer_id → users.id). In production the identity-sync
        // subsystem pre-provisions a stub user for external reviewers.
        $reviewerStub = User::factory()->forTenant(999)->create();

        $response = $this->postWebhook('review.created', [
            'external_id'          => 'ext-review-123',
            'rating'               => 4,
            'receiver_id'          => $receiver->id,
            'reviewer_external_id' => $reviewerStub->id,
            'reviewer_tenant_id'   => 999,
            'comment'              => 'Great federated work',
        ]);

        $response->assertStatus(200);
        $response->assertJsonPath('data.result.status', 'handled');

        $this->assertDatabaseHas('reviews', [
            'tenant_id'   => $this->testTenantId,
            'receiver_id' => $receiver->id,
            'review_type' => 'federated',
            'rating'      => 4,
        ]);

        Event::assertDispatched(FederatedReviewReceived::class);
    }

    public function test_review_created_replay_is_idempotent_without_transaction_match(): void
    {
        Event::fake([FederatedReviewReceived::class]);

        $receiver = User::factory()->forTenant($this->testTenantId)->create();
        $reviewerStub = User::factory()->forTenant(999)->create();

        $payload = [
            'external_id' => 'ext-review-retry-' . uniqid(),
            'external_transaction_id' => 'unknown-federated-tx-' . uniqid(),
            'rating' => 5,
            'receiver_id' => $receiver->id,
            'reviewer_external_id' => $reviewerStub->id,
            'reviewer_tenant_id' => 999,
            'comment' => 'Great federated work',
        ];

        $this->postWebhook('review.created', $payload)
            ->assertStatus(200)
            ->assertJsonPath('data.result.status', 'handled');

        $this->postWebhook('review.created', $payload)
            ->assertStatus(200)
            ->assertJsonPath('data.result.status', 'duplicate');

        $this->assertSame(1, DB::table('reviews')
            ->where('tenant_id', $this->testTenantId)
            ->where('external_partner_id', $this->partnerId)
            ->where('external_id', $payload['external_id'])
            ->count());
        Event::assertDispatchedTimes(FederatedReviewReceived::class, 1);
    }

    public function test_review_created_safeguarding_denial_returns_403_without_write_or_event(): void
    {
        Event::fake([FederatedReviewReceived::class]);
        $receiver = User::factory()->forTenant($this->testTenantId)->create();
        TenantContext::setById($this->testTenantId);

        $policy = Mockery::mock(SafeguardingInteractionPolicy::class);
        $policy->shouldReceive('evaluateExternalContact')
            ->once()
            ->with(
                (int) $receiver->id,
                $this->testTenantId,
                "partner:{$this->partnerId}:sender:501",
                'external_federated_review',
            )
            ->andReturn($this->safeguardingDenied());
        $this->app->instance(SafeguardingInteractionPolicy::class, $policy);

        $externalId = 'ext-review-safeguarding-denied-' . uniqid();
        $response = $this->postWebhook('review.created', [
            'external_id' => $externalId,
            'rating' => 5,
            'receiver_id' => $receiver->id,
            'reviewer_external_id' => 501,
            'reviewer_tenant_id' => 999,
            'comment' => 'Must not persist',
        ]);

        $response->assertStatus(403);
        $response->assertJsonPath('errors.0.code', 'VETTING_REQUIRED');
        $this->assertDatabaseMissing('reviews', [
            'tenant_id' => $this->testTenantId,
            'external_partner_id' => $this->partnerId,
            'external_id' => $externalId,
        ]);
        Event::assertNotDispatched(FederatedReviewReceived::class);
    }

    public function test_review_created_policy_unavailable_returns_retryable_503_without_write(): void
    {
        Event::fake([FederatedReviewReceived::class]);
        $receiver = User::factory()->forTenant($this->testTenantId)->create();
        TenantContext::setById($this->testTenantId);

        $policy = Mockery::mock(SafeguardingInteractionPolicy::class);
        $policy->shouldReceive('evaluateExternalContact')
            ->once()
            ->with(
                (int) $receiver->id,
                $this->testTenantId,
                "partner:{$this->partnerId}:sender:502",
                'external_federated_review',
            )
            ->andReturn($this->safeguardingUnavailable());
        $this->app->instance(SafeguardingInteractionPolicy::class, $policy);

        $externalId = 'ext-review-policy-unavailable-' . uniqid();
        $response = $this->postWebhook('review.created', [
            'external_id' => $externalId,
            'rating' => 4,
            'receiver_id' => $receiver->id,
            'reviewer_external_id' => 502,
            'reviewer_tenant_id' => 999,
        ]);

        $response->assertStatus(503);
        $response->assertJsonPath('errors.0.code', 'SAFEGUARDING_POLICY_UNAVAILABLE');
        $this->assertDatabaseMissing('reviews', [
            'tenant_id' => $this->testTenantId,
            'external_partner_id' => $this->partnerId,
            'external_id' => $externalId,
        ]);
        Event::assertNotDispatched(FederatedReviewReceived::class);
    }

    public function test_federated_review_listener_is_idempotent_for_bell_and_email_skip(): void
    {
        $receiver = User::factory()->forTenant($this->testTenantId)->create([
            'email' => 'federated-review-recipient@example.test',
        ]);
        DB::table('users')
            ->where('id', $receiver->id)
            ->where('tenant_id', $this->testTenantId)
            ->update(['notification_preferences' => json_encode(['email_reviews' => 0])]);
        $reviewerStub = User::factory()->forTenant(999)->create();

        $reviewId = DB::table('reviews')->insertGetId([
            'tenant_id' => $this->testTenantId,
            'external_partner_id' => $this->partnerId,
            'external_id' => 'ext-review-listener-' . uniqid(),
            'reviewer_id' => $reviewerStub->id,
            'reviewer_tenant_id' => 999,
            'receiver_id' => $receiver->id,
            'receiver_tenant_id' => $this->testTenantId,
            'rating' => 4,
            'comment' => 'Kind federated feedback',
            'status' => 'approved',
            'review_type' => 'federated',
            'show_cross_tenant' => 1,
            'created_at' => now(),
        ]);

        $event = new FederatedReviewReceived($this->testTenantId, $this->partnerId, (int) $reviewId, [
            'receiver_id' => $receiver->id,
            'rating' => 4,
            'comment' => 'Kind federated feedback',
        ]);

        $listener = new HandleFederatedReviewReceived();
        $listener->handle($event);
        $listener->handle($event);

        $this->assertSame(1, DB::table('notifications')
            ->where('tenant_id', $this->testTenantId)
            ->where('user_id', $receiver->id)
            ->where('type', 'federation_review')
            ->count());

        $review = DB::table('reviews')->where('id', $reviewId)->first();
        $this->assertNotNull($review->notification_sent_at);
        $this->assertNull($review->email_sent_at);
        $this->assertNotNull($review->email_skipped_at);
        $this->assertNull($review->email_failed_at);
    }

    public function test_review_missing_fields_returns_400(): void
    {
        $response = $this->postWebhook('review.created', [
            // missing external_id, rating, receiver_id
        ]);
        $response->assertStatus(400);
    }

    public function test_review_cannot_target_foreign_tenant_user(): void
    {
        // Foreign user on tenant 999
        $foreignUser = User::factory()->forTenant(999)->create();

        $response = $this->postWebhook('review.created', [
            'external_id'          => 'ext-review-xtenant',
            'rating'               => 5,
            'receiver_id'          => $foreignUser->id,
            'reviewer_external_id' => 1,
        ]);
        $response->assertStatus(400);
    }

    // ------------------------------------------------------------------
    // 2. Listing inbound
    // ------------------------------------------------------------------

    public function test_listing_created_persists_and_dispatches_event(): void
    {
        Event::fake([FederatedListingReceived::class]);

        $response = $this->postWebhook('listing.created', [
            'external_id' => 'ext-list-1',
            'title'       => 'Help me move a sofa',
            'description' => 'Need 2 hours',
            'type'        => 'inquiry',
            'category'    => 'help',
        ]);

        $response->assertStatus(200);
        $response->assertJsonPath('data.result.status', 'handled');

        $this->assertDatabaseHas('federation_listings', [
            'tenant_id'           => $this->testTenantId,
            'external_partner_id' => $this->partnerId,
            'external_id'         => 'ext-list-1',
            'title'               => 'Help me move a sofa',
        ]);

        Event::assertDispatched(FederatedListingReceived::class);
    }

    public function test_listing_updated_is_upsert(): void
    {
        $this->postWebhook('listing.created', [
            'external_id' => 'ext-list-upsert',
            'title'       => 'Original',
        ])->assertStatus(200);

        $this->postWebhook('listing.updated', [
            'external_id' => 'ext-list-upsert',
            'title'       => 'Updated Title',
        ])->assertStatus(200);

        $count = DB::table('federation_listings')
            ->where('external_partner_id', $this->partnerId)
            ->where('external_id', 'ext-list-upsert')
            ->count();
        $this->assertSame(1, $count);

        $this->assertDatabaseHas('federation_listings', [
            'external_id' => 'ext-list-upsert',
            'title'       => 'Updated Title',
        ]);
    }

    public function test_listing_missing_title_returns_400(): void
    {
        $response = $this->postWebhook('listing.created', ['external_id' => 'only-id']);
        $response->assertStatus(400);
    }

    // ------------------------------------------------------------------
    // 3. Community event inbound
    // ------------------------------------------------------------------

    public function test_event_created_persists_and_dispatches_event(): void
    {
        Event::fake([FederatedCommunityEventReceived::class]);

        $response = $this->postWebhook('event.created', [
            'external_id' => 'ext-evt-1',
            'title'       => 'Timebank Picnic',
            'starts_at'   => '2026-05-01 12:00:00',
            'ends_at'     => '2026-05-01 16:00:00',
            'location'    => 'Phoenix Park',
        ]);

        $response->assertStatus(200);
        $this->assertDatabaseHas('federation_events', [
            'external_partner_id' => $this->partnerId,
            'external_id'         => 'ext-evt-1',
            'tenant_id'           => $this->testTenantId,
        ]);

        Event::assertDispatched(FederatedCommunityEventReceived::class);
    }

    public function test_event_missing_fields_returns_400(): void
    {
        $this->postWebhook('event.created', ['title' => 'No external id'])
            ->assertStatus(400);
    }

    // ------------------------------------------------------------------
    // 4. Group inbound
    // ------------------------------------------------------------------

    public function test_group_created_persists_and_dispatches_event(): void
    {
        Event::fake([FederatedGroupReceived::class]);

        $response = $this->postWebhook('group.created', [
            'external_id'  => 'ext-grp-1',
            'name'         => 'Local Gardeners',
            'privacy'      => 'public',
            'member_count' => 12,
        ]);

        $response->assertStatus(200);
        $this->assertDatabaseHas('federation_groups', [
            'external_partner_id' => $this->partnerId,
            'external_id'         => 'ext-grp-1',
            'name'                => 'Local Gardeners',
            'tenant_id'           => $this->testTenantId,
        ]);

        Event::assertDispatched(FederatedGroupReceived::class);
    }

    public function test_group_missing_name_returns_400(): void
    {
        $this->postWebhook('group.created', ['external_id' => 'g'])
            ->assertStatus(400);
    }

    // ------------------------------------------------------------------
    // 5. Group member joined
    // ------------------------------------------------------------------

    public function test_group_member_joined_increments_count(): void
    {
        $this->postWebhook('group.created', [
            'external_id'  => 'ext-grp-memjoin',
            'name'         => 'Chess Club',
            'member_count' => 5,
        ])->assertStatus(200);

        Event::fake([FederatedGroupReceived::class]);

        $response = $this->postWebhook('group.member_joined', [
            'external_id'      => 'ext-grp-memjoin',
            'external_user_id' => 'user-42',
        ]);
        $response->assertStatus(200);

        $group = DB::table('federation_groups')
            ->where('external_partner_id', $this->partnerId)
            ->where('external_id', 'ext-grp-memjoin')
            ->first();
        $this->assertSame(6, (int) $group->member_count);

        Event::assertDispatched(FederatedGroupReceived::class);
    }

    public function test_group_member_joined_unknown_group_returns_400(): void
    {
        $this->postWebhook('group.member_joined', [
            'external_id'      => 'does-not-exist',
            'external_user_id' => 'user-1',
        ])->assertStatus(400);
    }

    // ------------------------------------------------------------------
    // 6. Connection inbound
    // ------------------------------------------------------------------

    public function test_connection_requested_persists_and_dispatches_event(): void
    {
        Event::fake([FederatedConnectionReceived::class]);

        $localUser = User::factory()->forTenant($this->testTenantId)->create();

        $response = $this->postWebhook('connection.requested', [
            'local_user_id'    => $localUser->id,
            'external_user_id' => 'ext-usr-7',
            'message'          => 'Hi, let\'s connect!',
        ]);

        $response->assertStatus(200);
        $this->assertDatabaseHas('federation_inbound_connections', [
            'external_partner_id' => $this->partnerId,
            'local_user_id'       => $localUser->id,
            'external_user_id'    => 'ext-usr-7',
            'status'              => 'pending',
            'tenant_id'           => $this->testTenantId,
        ]);

        Event::assertDispatched(FederatedConnectionReceived::class);
    }

    public function test_connection_accepted_sets_accepted_status(): void
    {
        $localUser = User::factory()->forTenant($this->testTenantId)->create();
        $this->fakeEmailDispatchService();

        $this->postWebhook('connection.accepted', [
            'local_user_id'    => $localUser->id,
            'external_user_id' => 'ext-usr-8',
        ])->assertStatus(200);

        $this->assertDatabaseHas('federation_inbound_connections', [
            'local_user_id'    => $localUser->id,
            'external_user_id' => 'ext-usr-8',
            'status'           => 'accepted',
        ]);
    }

    public function test_external_webhook_delivery_paths_keep_explicit_tenant_predicates(): void
    {
        $source = file_get_contents(app_path('Http/Controllers/Api/FederationExternalWebhookController.php'));
        // Normalise line endings — the controller is checked out with CRLF on
        // Windows, but the needles below are written with LF, so the multi-line
        // substring checks would never match without this.
        $source = str_replace("\r\n", "\n", $source);

        $this->assertStringContainsString("->where('tenant_id', \$tenantId)\n            ->where('external_partner_id', \$partner->id)", $source);
        $this->assertStringContainsString("->where('id', \$existing->id)\n                ->where('tenant_id', \$tenantId)", $source);
        $this->assertStringContainsString("->where('external_idempotency_key', \$idempotencyKey)\n                ->where('receiver_tenant_id', (int) \$partner->tenant_id)", $source);
        $this->assertStringContainsString("->where('external_partner_id', \$partner->id)\n            ->where('receiver_tenant_id', (int) \$partner->tenant_id)", $source);
        $this->assertStringContainsString("->where('external_transaction_id', \$externalTxId)\n                ->where('external_partner_id', \$partner->id)\n                ->where('receiver_tenant_id', \$tenantId)", $source);
        $this->assertStringContainsString("->where('id', \$tx->id)\n                            ->where('receiver_tenant_id', (int) \$tx->receiver_tenant_id)", $source);
        $this->assertStringContainsString("->where('id', \$transactionId)\n                    ->where('receiver_tenant_id', \$receiverTenantId)", $source);
    }

    public function test_connection_requested_sends_one_email_and_bell_on_partner_retry(): void
    {
        $localUser = User::factory()->forTenant($this->testTenantId)->create([
            'email' => 'federation-connection-recipient@example.test',
        ]);
        $mailer = $this->fakeEmailDispatchService();

        $payload = [
            'local_user_id' => $localUser->id,
            'external_user_id' => 'ext-usr-retry',
            'external_user_name' => 'Remote Member',
            'message' => 'Hi, let\'s connect!',
        ];

        $this->postWebhook('connection.requested', $payload)->assertStatus(200);
        $this->postWebhook('connection.requested', $payload)->assertStatus(200);

        $this->assertCount(1, $mailer->sends);
        $this->assertSame('federation-connection-recipient@example.test', $mailer->sends[0]['to']);
        $this->assertSame('federation_connection', $mailer->sends[0]['options']['category']);
        $this->assertSame($this->testTenantId, $mailer->sends[0]['options']['tenant_id']);

        $this->assertSame(1, DB::table('notifications')
            ->where('tenant_id', $this->testTenantId)
            ->where('user_id', $localUser->id)
            ->where('type', 'federation_connection')
            ->where('link', '/network')
            ->count());
        $connection = DB::table('federation_inbound_connections')
            ->where('external_partner_id', $this->partnerId)
            ->where('local_user_id', $localUser->id)
            ->where('external_user_id', 'ext-usr-retry')
            ->first();
        $this->assertNotNull($connection);
        $this->assertNotNull($connection->notification_sent_at);
        $this->assertNotNull($connection->email_sent_at);
        $this->assertNull($connection->email_failed_at);
    }

    public function test_connection_requested_replay_repairs_failed_email_without_duplicate_bell(): void
    {
        $localUser = User::factory()->forTenant($this->testTenantId)->create([
            'email' => 'federation-connection-repair@example.test',
        ]);

        $payload = [
            'local_user_id' => $localUser->id,
            'external_user_id' => 'ext-usr-repair',
            'external_user_name' => 'Remote Member',
            'message' => 'Hi, let\'s connect!',
        ];

        $failingMailer = $this->fakeEmailDispatchService(false);
        // The connection listener now fails the email gracefully (persists
        // email_failed_at / email_last_error, does NOT throw) so the inbound
        // webhook still ACKs 200 — throwing would retry the queued listener and
        // re-fire the bell/push side-effects. The failure is recorded for a
        // later replay/sweep to repair, which the assertions below verify.
        $this->postWebhook('connection.requested', $payload)->assertStatus(200);

        $connection = DB::table('federation_inbound_connections')
            ->where('external_partner_id', $this->partnerId)
            ->where('local_user_id', $localUser->id)
            ->where('external_user_id', 'ext-usr-repair')
            ->first();
        $this->assertNotNull($connection);
        $this->assertNotNull($connection->notification_sent_at);
        $this->assertNull($connection->email_sent_at);
        $this->assertNotNull($connection->email_failed_at);
        $this->assertSame('Email dispatch returned false', $connection->email_last_error);
        $this->assertCount(1, $failingMailer->sends);

        $repairMailer = $this->fakeEmailDispatchService(true);
        $this->postWebhook('connection.requested', $payload)->assertStatus(200);

        $this->assertSame(1, DB::table('federation_inbound_connections')
            ->where('external_partner_id', $this->partnerId)
            ->where('local_user_id', $localUser->id)
            ->where('external_user_id', 'ext-usr-repair')
            ->count());
        $repaired = DB::table('federation_inbound_connections')
            ->where('external_partner_id', $this->partnerId)
            ->where('local_user_id', $localUser->id)
            ->where('external_user_id', 'ext-usr-repair')
            ->first();
        $this->assertNotNull($repaired->email_sent_at);
        $this->assertNull($repaired->email_failed_at);
        $this->assertNull($repaired->email_last_error);
        $this->assertCount(1, $repairMailer->sends);
        $this->assertSame(1, DB::table('notifications')
            ->where('tenant_id', $this->testTenantId)
            ->where('user_id', $localUser->id)
            ->where('type', 'federation_connection')
            ->where('link', '/network')
            ->count());
    }

    public function test_connection_cannot_target_foreign_tenant_user(): void
    {
        $foreignUser = User::factory()->forTenant(999)->create();

        $response = $this->postWebhook('connection.requested', [
            'local_user_id'    => $foreignUser->id,
            'external_user_id' => 'x',
        ]);
        $response->assertStatus(400);
    }

    public function test_connection_missing_fields_returns_400(): void
    {
        $this->postWebhook('connection.requested', [])
            ->assertStatus(400);
    }

    public function test_external_message_sends_tenant_scoped_federation_email(): void
    {
        $recipient = User::factory()->forTenant($this->testTenantId)->create([
            'email' => 'federation-message-recipient@example.test',
        ]);
        DB::table('federation_user_settings')->insert([
            'user_id' => $recipient->id,
            'federation_optin' => 1,
            'messaging_enabled_federated' => 1,
            'email_notifications' => 1,
            'created_at' => now(),
            'updated_at' => now(),
        ]);
        $mailer = $this->fakeEmailDispatchService();

        $response = $this->postWebhook('message.sent', [
            'external_message_id' => 'ext-msg-email-1',
            'recipient_id' => $recipient->id,
            'sender_id' => 'remote-123',
            'sender_name' => 'Remote Sender',
            'subject' => 'Hello across the bridge',
            'body' => 'This is a federated message body.',
        ]);

        $response->assertStatus(200);
        $this->assertCount(1, $mailer->sends);
        $this->assertSame('federation-message-recipient@example.test', $mailer->sends[0]['to']);
        $this->assertSame('federation_message', $mailer->sends[0]['options']['category']);
        $this->assertSame($this->testTenantId, $mailer->sends[0]['options']['tenant_id']);
        $message = DB::table('federation_messages')
            ->where('external_partner_id', $this->partnerId)
            ->where('external_message_id', 'ext-msg-email-1')
            ->first();
        $this->assertNotNull($message);
        $this->assertNotNull($message->notification_sent_at);
        $this->assertNotNull($message->email_sent_at);
        $this->assertNull($message->email_failed_at);
    }

    public function test_external_message_replay_repairs_failed_email_without_duplicate_message(): void
    {
        $recipient = User::factory()->forTenant($this->testTenantId)->create([
            'email' => 'federation-message-repair@example.test',
        ]);
        DB::table('federation_user_settings')->insert([
            'user_id' => $recipient->id,
            'federation_optin' => 1,
            'messaging_enabled_federated' => 1,
            'email_notifications' => 1,
            'created_at' => now(),
            'updated_at' => now(),
        ]);

        $failingMailer = $this->fakeEmailDispatchService(false);
        $payload = [
            'external_message_id' => 'ext-msg-repair-1',
            'recipient_id' => $recipient->id,
            'sender_id' => 'remote-123',
            'sender_name' => 'Remote Sender',
            'subject' => 'Hello across the bridge',
            'body' => 'This is a federated message body.',
        ];

        $this->postWebhook('message.sent', $payload)->assertStatus(500);

        $this->assertDatabaseHas('federation_external_partner_logs', [
            'partner_id' => $this->partnerId,
            'response_code' => 500,
            'success' => 0,
        ]);

        $message = DB::table('federation_messages')
            ->where('external_partner_id', $this->partnerId)
            ->where('external_message_id', 'ext-msg-repair-1')
            ->first();
        $this->assertNotNull($message);
        $this->assertNotNull($message->notification_sent_at);
        $this->assertNull($message->email_sent_at);
        $this->assertNotNull($message->email_failed_at);
        $this->assertSame('Email dispatch returned false', $message->email_last_error);
        $this->assertCount(1, $failingMailer->sends);

        $repairMailer = $this->fakeEmailDispatchService(true);
        $this->postWebhook('message.sent', $payload)
            ->assertStatus(200)
            ->assertJsonPath('data.result.duplicate', true);

        $this->assertSame(1, DB::table('federation_messages')
            ->where('external_partner_id', $this->partnerId)
            ->where('external_message_id', 'ext-msg-repair-1')
            ->count());
        $repaired = DB::table('federation_messages')
            ->where('external_partner_id', $this->partnerId)
            ->where('external_message_id', 'ext-msg-repair-1')
            ->first();
        $this->assertNotNull($repaired->email_sent_at);
        $this->assertNull($repaired->email_failed_at);
        $this->assertNull($repaired->email_last_error);
        $this->assertCount(1, $repairMailer->sends);
        $this->assertSame(1, DB::table('notifications')
            ->where('tenant_id', $this->testTenantId)
            ->where('user_id', $recipient->id)
            ->where('type', 'federation_message')
            ->where('link', '/federation/messages')
            ->count());
    }

    public function test_transaction_completed_is_idempotent_and_sends_one_email(): void
    {
        $recipient = User::factory()->forTenant($this->testTenantId)->create([
            'email' => 'federation-credit-recipient@example.test',
            'balance' => 0,
        ]);
        DB::table('federation_user_settings')->insert([
            'user_id' => $recipient->id,
            'federation_optin' => 1,
            'messaging_enabled_federated' => 1,
            'email_notifications' => 1,
            'created_at' => now(),
            'updated_at' => now(),
        ]);
        $mailer = $this->fakeEmailDispatchService();

        $payload = [
            'external_transaction_id' => 'ext-tx-email-1',
            'recipient_id' => $recipient->id,
            'sender_id' => 'remote-42',
            'sender_name' => 'Remote Sender',
            'amount' => 2.0,
            'description' => 'Federated help',
        ];

        $this->postWebhook('transaction.completed', $payload)
            ->assertStatus(200)
            ->assertJsonPath('data.result.status', 'acknowledged');

        $this->postWebhook('transaction.completed', $payload)
            ->assertStatus(200)
            ->assertJsonPath('data.result.status', 'duplicate');

        $this->assertSame(1, DB::table('federation_transactions')
            ->where('external_partner_id', $this->partnerId)
            ->where('external_transaction_id', 'ext-tx-email-1')
            ->count());
        $this->assertEquals(2.0, (float) DB::table('users')->where('id', $recipient->id)->value('balance'));
        $this->assertCount(1, $mailer->sends);
        $this->assertSame('federation_transaction', $mailer->sends[0]['options']['category']);
        $this->assertSame($this->testTenantId, $mailer->sends[0]['options']['tenant_id']);
        $transaction = DB::table('federation_transactions')
            ->where('external_partner_id', $this->partnerId)
            ->where('external_transaction_id', 'ext-tx-email-1')
            ->first();
        $this->assertNotNull($transaction);
        $this->assertNotNull($transaction->notification_sent_at);
        $this->assertNotNull($transaction->email_sent_at);
        $this->assertNull($transaction->email_failed_at);
    }

    public function test_transaction_completed_replay_repairs_failed_email_without_double_credit(): void
    {
        $recipient = User::factory()->forTenant($this->testTenantId)->create([
            'email' => 'federation-credit-repair@example.test',
            'balance' => 0,
        ]);
        DB::table('federation_user_settings')->insert([
            'user_id' => $recipient->id,
            'federation_optin' => 1,
            'messaging_enabled_federated' => 1,
            'email_notifications' => 1,
            'created_at' => now(),
            'updated_at' => now(),
        ]);

        $payload = [
            'external_transaction_id' => 'ext-tx-repair-1',
            'recipient_id' => $recipient->id,
            'sender_id' => 'remote-42',
            'sender_name' => 'Remote Sender',
            'amount' => 2.0,
            'description' => 'Federated help',
        ];

        $failingMailer = $this->fakeEmailDispatchService(false);
        $this->postWebhook('transaction.completed', $payload)->assertStatus(500);

        $this->assertDatabaseHas('federation_external_partner_logs', [
            'partner_id' => $this->partnerId,
            'response_code' => 500,
            'success' => 0,
        ]);

        $transaction = DB::table('federation_transactions')
            ->where('external_partner_id', $this->partnerId)
            ->where('external_transaction_id', 'ext-tx-repair-1')
            ->first();
        $this->assertNotNull($transaction);
        $this->assertNotNull($transaction->notification_sent_at);
        $this->assertNull($transaction->email_sent_at);
        $this->assertNotNull($transaction->email_failed_at);
        $this->assertSame('Email dispatch returned false', $transaction->email_last_error);
        $this->assertEquals(2.0, (float) DB::table('users')->where('id', $recipient->id)->value('balance'));
        $this->assertCount(1, $failingMailer->sends);

        $repairMailer = $this->fakeEmailDispatchService(true);
        $this->postWebhook('transaction.completed', $payload)
            ->assertStatus(200)
            ->assertJsonPath('data.result.status', 'duplicate');

        $this->assertSame(1, DB::table('federation_transactions')
            ->where('external_partner_id', $this->partnerId)
            ->where('external_transaction_id', 'ext-tx-repair-1')
            ->count());
        $this->assertEquals(2.0, (float) DB::table('users')->where('id', $recipient->id)->value('balance'));
        $repaired = DB::table('federation_transactions')
            ->where('external_partner_id', $this->partnerId)
            ->where('external_transaction_id', 'ext-tx-repair-1')
            ->first();
        $this->assertNotNull($repaired->email_sent_at);
        $this->assertNull($repaired->email_failed_at);
        $this->assertNull($repaired->email_last_error);
        $this->assertCount(1, $repairMailer->sends);
        $this->assertSame(1, DB::table('notifications')
            ->where('tenant_id', $this->testTenantId)
            ->where('user_id', $recipient->id)
            ->where('type', 'federation_transaction')
            ->where('link', '/wallet')
            ->count());
    }

    public function test_transaction_completed_without_external_transaction_id_is_rejected_before_credit(): void
    {
        $recipient = User::factory()->forTenant($this->testTenantId)->create([
            'balance' => 0,
        ]);

        $this->postWebhook('transaction.completed', [
            'recipient_id' => $recipient->id,
            'sender_id' => 'remote-42',
            'amount' => 2.5,
            'description' => 'Federated help',
        ])->assertStatus(200)
            ->assertJsonPath('data.result.status', 'rejected');

        $this->assertEquals(0.0, (float) DB::table('users')->where('id', $recipient->id)->value('balance'));
        $this->assertSame(0, DB::table('federation_transactions')->where('receiver_user_id', $recipient->id)->count());
    }

    public function test_transaction_cancelled_does_not_touch_foreign_receiver_tenant_row(): void
    {
        $foreignTenantId = 999;
        $foreignRecipient = User::factory()->forTenant($foreignTenantId)->create([
            'balance' => 3,
        ]);

        $transactionId = DB::table('federation_transactions')->insertGetId([
            'sender_tenant_id' => 0,
            'sender_user_id' => 42,
            'receiver_tenant_id' => $foreignTenantId,
            'receiver_user_id' => $foreignRecipient->id,
            'amount' => 1,
            'description' => 'Foreign tenant row',
            'status' => 'completed',
            'external_partner_id' => $this->partnerId,
            'external_receiver_name' => 'Remote Sender',
            'external_transaction_id' => 'ext-tx-foreign-cancel',
            'created_at' => now(),
        ]);

        $this->postWebhook('transaction.cancelled', [
            'external_transaction_id' => 'ext-tx-foreign-cancel',
            'reason' => 'Remote cancellation',
        ])->assertStatus(200)
            ->assertJsonPath('data.result.status', 'acknowledged');

        $transaction = DB::table('federation_transactions')->where('id', $transactionId)->first();
        $this->assertSame('completed', $transaction->status);
        $this->assertNull($transaction->cancelled_at);
        $this->assertEquals(3.0, (float) DB::table('users')
            ->where('id', $foreignRecipient->id)
            ->where('tenant_id', $foreignTenantId)
            ->value('balance'));
    }

    // ------------------------------------------------------------------
    // 7. Volunteering inbound
    // ------------------------------------------------------------------

    public function test_volunteering_created_persists_and_dispatches_event(): void
    {
        Event::fake([FederatedVolunteeringReceived::class]);

        $response = $this->postWebhook('volunteering.created', [
            'external_id'     => 'ext-vol-1',
            'title'           => 'Dog walking for seniors',
            'hours_requested' => 2.5,
            'location'        => 'Cork',
            'starts_at'       => '2026-05-10 10:00:00',
        ]);

        $response->assertStatus(200);
        $this->assertDatabaseHas('federation_volunteering', [
            'external_partner_id' => $this->partnerId,
            'external_id'         => 'ext-vol-1',
            'title'               => 'Dog walking for seniors',
            'tenant_id'           => $this->testTenantId,
        ]);

        Event::assertDispatched(FederatedVolunteeringReceived::class);
    }

    public function test_volunteering_missing_fields_returns_400(): void
    {
        $this->postWebhook('volunteering.created', ['title' => 'no id'])
            ->assertStatus(400);
    }

    // ------------------------------------------------------------------
    // 8. Member sync inbound
    // ------------------------------------------------------------------

    public function test_member_profile_updated_persists_and_dispatches_event(): void
    {
        Event::fake([FederatedMemberUpdated::class]);

        $response = $this->postWebhook('member.profile_updated', [
            'external_id'  => 'ext-mem-1',
            'username'     => 'alice_remote',
            'display_name' => 'Alice R.',
            'bio'          => 'Federated neighbour',
        ]);

        $response->assertStatus(200);
        $this->assertDatabaseHas('federation_members', [
            'external_partner_id' => $this->partnerId,
            'external_id'         => 'ext-mem-1',
            'username'            => 'alice_remote',
            'tenant_id'           => $this->testTenantId,
        ]);

        Event::assertDispatched(FederatedMemberUpdated::class);
    }

    public function test_member_missing_external_id_returns_400(): void
    {
        $this->postWebhook('member.profile_updated', ['username' => 'x'])
            ->assertStatus(400);
    }

    // ------------------------------------------------------------------
    // Cross-tenant isolation
    // ------------------------------------------------------------------

    public function test_partner_for_tenant_A_cannot_inject_into_tenant_B(): void
    {
        // Create a user in foreign tenant 999
        $foreignUser = User::factory()->forTenant(999)->create();

        // Partner is bound to testTenantId — listing should be persisted under
        // testTenantId regardless of anything in the payload
        $this->postWebhook('listing.created', [
            'external_id'     => 'ext-xt-1',
            'title'           => 'Cross-tenant attempt',
            'tenant_id'       => 999, // attempt to poison via payload
            'external_user_id' => (string) $foreignUser->id,
        ])->assertStatus(200);

        // Should be scoped to the partner's real tenant
        $this->assertDatabaseHas('federation_listings', [
            'external_id' => 'ext-xt-1',
            'tenant_id'   => $this->testTenantId,
        ]);
        $this->assertDatabaseMissing('federation_listings', [
            'external_id' => 'ext-xt-1',
            'tenant_id'   => 999,
        ]);
    }

    public function test_webhook_logs_are_recorded_on_success(): void
    {
        $this->postWebhook('listing.created', [
            'external_id' => 'ext-log-1',
            'title'       => 'Logged listing',
        ])->assertStatus(200);

        $this->assertDatabaseHas('federation_external_partner_logs', [
            'partner_id'    => $this->partnerId,
            'response_code' => 200,
            'success'       => 1,
        ]);
    }

    private function fakeEmailDispatchService(bool $sendResult = true): EmailDispatchService
    {
        $mailer = new class($sendResult) extends EmailDispatchService {
            /** @var list<array{to:string,subject:string,body:string,options:array<string,mixed>}> */
            public array $sends = [];

            public function __construct(private bool $sendResult)
            {
            }

            public function send(string $to, string $subject, string $body, array $options = []): bool
            {
                $this->sends[] = [
                    'to' => $to,
                    'subject' => $subject,
                    'body' => $body,
                    'options' => $options,
                ];

                return $this->sendResult;
            }
        };

        app()->instance(EmailDispatchService::class, $mailer);

        return $mailer;
    }

    private function safeguardingDenied(): SafeguardingInteractionDecision
    {
        return new SafeguardingInteractionDecision(
            status: SafeguardingInteractionDecision::DENY,
            code: 'VETTING_REQUIRED',
            recipientTenantId: $this->testTenantId,
            purposeCode: 'safeguarded_member_contact',
            scopeType: 'tenant',
            scopeIdentifier: '',
            policyVersion: 'test-v1',
            requiredAttestationCodes: ['dbs_enhanced'],
            requiredAttestationLabels: ['Enhanced DBS'],
            canRequestCoordinator: true,
        );
    }

    private function safeguardingUnavailable(): SafeguardingInteractionDecision
    {
        return new SafeguardingInteractionDecision(
            status: SafeguardingInteractionDecision::UNAVAILABLE,
            code: 'SAFEGUARDING_POLICY_UNAVAILABLE',
            recipientTenantId: $this->testTenantId,
            purposeCode: 'safeguarded_member_contact',
            scopeType: 'tenant',
            scopeIdentifier: '',
            canRequestCoordinator: true,
        );
    }
}
