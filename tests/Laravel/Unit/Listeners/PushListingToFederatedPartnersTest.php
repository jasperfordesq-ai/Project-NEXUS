<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

declare(strict_types=1);

namespace Tests\Laravel\Unit\Listeners;

use App\Core\TenantContext;
use App\Events\ListingCreated;
use App\Events\ListingUpdated;
use App\Listeners\PushListingToFederatedPartners;
use App\Models\Listing;
use App\Models\User;
use App\Services\FederationExternalApiClient;
use App\Services\FederationFeatureService;
use Illuminate\Contracts\Queue\ShouldQueue;
use Illuminate\Foundation\Testing\DatabaseTransactions;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Http;
use Illuminate\Support\Facades\Queue;
use Mockery;
use Tests\Laravel\TestCase;

/**
 * PushListingToFederatedPartnersTest
 *
 * Unique tenant id 99676 — do not reuse in other test files.
 * Exercises the outbound listing push listener:
 * feature gates, status/moderation guards, federated_visibility guard,
 * allow_listing_search partner flag, create vs update action, and HTTP push.
 */
class PushListingToFederatedPartnersTest extends TestCase
{
    use DatabaseTransactions;

    private const TENANT_ID  = 99676;
    private const PARTNER_ID = 996760;
    private const BASE_URL   = 'https://93.184.216.34';

    protected function setUp(): void
    {
        parent::setUp();
        Queue::fake();
        Http::fake();

        // Ensure our unique test tenant exists.
        DB::table('tenants')->updateOrInsert(
            ['id' => self::TENANT_ID],
            [
                'name'       => 'ListingPush Test Tenant',
                'slug'       => 'listing-push-99676',
                'is_active'  => 1,
                'depth'      => 0,
                'features'   => json_encode(['federation' => true]),
                'created_at' => now(),
                'updated_at' => now(),
            ]
        );

        TenantContext::setById(self::TENANT_ID);

        // Enable federation at system level.
        DB::table('federation_system_control')->updateOrInsert(
            ['id' => 1],
            [
                'federation_enabled'        => 1,
                'whitelist_mode_enabled'    => 0,
                'emergency_lockdown_active' => 0,
            ]
        );

        // Rebind the encrypter with the valid test key so Crypt::decryptString()
        // works inside FederationExternalApiClient::decryptCredential().
        // The Docker container OS env has an invalid APP_KEY that prevents the
        // default EncryptionServiceProvider singleton from initialising.
        $validKey = base64_decode('HfQEDtbtr90JIXhsaAhSFWnzIo1f31VZ2e5qLqKKnls=');
        $this->app->instance('encrypter', new \Illuminate\Encryption\Encrypter($validKey, 'AES-256-CBC'));

        // Clear the static adapter cache so Http::fake() intercepts cleanly.
        FederationExternalApiClient::clearAdapterCache();
    }

    protected function tearDown(): void
    {
        Mockery::close();
        parent::tearDown();
    }

    // ── helpers ───────────────────────────────────────────────────────────────

    /**
     * Encrypt a credential string using the known test APP_KEY from .env.testing.
     *
     * The Docker container's OS env has an invalid APP_KEY which prevents the
     * Crypt facade singleton from initialising, so we bypass it and instantiate
     * the Encrypter directly with the valid 32-byte key.
     */
    private function encryptApiKey(string $value): string
    {
        $rawKey = base64_decode('HfQEDtbtr90JIXhsaAhSFWnzIo1f31VZ2e5qLqKKnls=');
        return (new \Illuminate\Encryption\Encrypter($rawKey, 'AES-256-CBC'))->encryptString($value);
    }

    private function enableFeature(bool $enabled): void
    {
        DB::table('tenants')
            ->where('id', self::TENANT_ID)
            ->update(['features' => json_encode(['federation' => $enabled])]);
        TenantContext::setById(self::TENANT_ID);
    }

    /** Insert an active partner with allow_listing_search = 1 and return its id. */
    private function insertListingPartner(int $id = self::PARTNER_ID): int
    {
        DB::table('federation_external_partners')->updateOrInsert(
            ['id' => $id],
            [
                'tenant_id'          => self::TENANT_ID,
                'name'               => 'Listing Partner',
                'base_url'           => self::BASE_URL,
                'api_path'           => '/api/v1/federation',
                'auth_method'        => 'api_key',
                'protocol_type'      => 'nexus',
                'api_key'            => $this->encryptApiKey('test-api-key'),
                'status'             => 'active',
                'allow_listing_search' => 1,
                'created_at'         => now(),
                'updated_at'         => now(),
            ]
        );
        return $id;
    }

    /** Build a publishable Listing stub. */
    private function makeListing(array $attrs = []): Listing
    {
        $listing                    = new Listing();
        $listing->id                = $attrs['id'] ?? 7001;
        $listing->title             = $attrs['title'] ?? 'Test Listing';
        $listing->description       = $attrs['description'] ?? 'A test listing description';
        $listing->type              = $attrs['type'] ?? 'offer';
        $listing->category_id       = $attrs['category_id'] ?? null;
        $listing->status            = $attrs['status'] ?? 'active';
        $listing->moderation_status = $attrs['moderation_status'] ?? 'approved';
        $listing->federated_visibility = $attrs['federated_visibility'] ?? 'listed';
        $listing->created_at        = now();
        $listing->updated_at        = now();
        return $listing;
    }

    /** Build a user stub for use as event->user. */
    private function makeUser(int $id = 1): User
    {
        // F-413: the push now requires the listing OWNER's account-level
        // federation consent, which every PULL path already required. Record
        // that consent for the stub owner so these cases keep exercising the
        // gate they were written for (status, moderation, visibility, partner
        // flag) rather than stopping at the new consent check.
        DB::table('federation_user_settings')->updateOrInsert(
            ['user_id' => $id],
            [
                'federation_optin'           => 1,
                'profile_visible_federated'  => 1,
                'appear_in_federated_search' => 1,
                'updated_at'                 => now(),
            ]
        );

        $user = new User();
        $user->id = $id;
        return $user;
    }

    private function makeListener(): PushListingToFederatedPartners
    {
        $featureSvc = Mockery::mock(FederationFeatureService::class);
        $featureSvc->shouldReceive('isTenantFederationEnabled')->andReturn(true);
        return new PushListingToFederatedPartners($featureSvc);
    }

    // ── tests ─────────────────────────────────────────────────────────────────

    public function test_implements_should_queue(): void
    {
        $this->assertContains(
            ShouldQueue::class,
            class_implements(PushListingToFederatedPartners::class) ?: []
        );
    }

    public function test_listener_routes_to_federation_queue(): void
    {
        $ref      = new \ReflectionClass(PushListingToFederatedPartners::class);
        $instance = $ref->newInstanceWithoutConstructor();
        $this->assertSame('federation', $ref->getProperty('queue')->getValue($instance));
    }

    public function test_skips_when_tenant_federation_feature_disabled(): void
    {
        $this->enableFeature(false);

        $featureSvc = Mockery::mock(FederationFeatureService::class);
        $featureSvc->shouldNotReceive('isTenantFederationEnabled');

        $listener = new PushListingToFederatedPartners($featureSvc);
        $listener->handle(new ListingCreated(
            $this->makeListing(),
            $this->makeUser(),
            self::TENANT_ID
        ));

        Http::assertNothingSent();
    }

    public function test_skips_when_system_federation_disabled(): void
    {
        $this->enableFeature(true);

        $featureSvc = Mockery::mock(FederationFeatureService::class);
        $featureSvc->shouldReceive('isTenantFederationEnabled')->once()->andReturn(false);

        $listener = new PushListingToFederatedPartners($featureSvc);
        $listener->handle(new ListingCreated(
            $this->makeListing(),
            $this->makeUser(),
            self::TENANT_ID
        ));

        Http::assertNothingSent();
    }

    public function test_skips_when_listing_status_is_not_active(): void
    {
        $listing = $this->makeListing(['status' => 'expired']);

        $listener = $this->makeListener();
        $listener->handle(new ListingCreated($listing, $this->makeUser(), self::TENANT_ID));

        Http::assertNothingSent();
    }

    public function test_skips_when_moderation_status_is_pending(): void
    {
        $listing = $this->makeListing(['moderation_status' => 'pending_review']);

        $listener = $this->makeListener();
        $listener->handle(new ListingCreated($listing, $this->makeUser(), self::TENANT_ID));

        Http::assertNothingSent();
    }

    public function test_skips_when_moderation_status_is_rejected(): void
    {
        $listing = $this->makeListing(['moderation_status' => 'rejected']);

        $listener = $this->makeListener();
        $listener->handle(new ListingCreated($listing, $this->makeUser(), self::TENANT_ID));

        Http::assertNothingSent();
    }

    public function test_skips_when_federated_visibility_is_none(): void
    {
        $listing = $this->makeListing(['federated_visibility' => 'none']);

        $listener = $this->makeListener();
        $listener->handle(new ListingCreated($listing, $this->makeUser(), self::TENANT_ID));

        Http::assertNothingSent();
    }

    public function test_skips_when_federated_visibility_is_local(): void
    {
        $listing = $this->makeListing(['federated_visibility' => 'local']);

        $listener = $this->makeListener();
        $listener->handle(new ListingCreated($listing, $this->makeUser(), self::TENANT_ID));

        Http::assertNothingSent();
    }

    public function test_skips_when_no_partners_with_allow_listing_search(): void
    {
        // No partner row inserted for this tenant.
        $listener = $this->makeListener();
        $listener->handle(new ListingCreated(
            $this->makeListing(),
            $this->makeUser(),
            self::TENANT_ID
        ));

        Http::assertNothingSent();
    }

    public function test_pushes_with_action_created_on_created_event(): void
    {
        Http::fake(['*' => Http::response(['success' => true], 200)]);

        $this->insertListingPartner();
        $listing = $this->makeListing(['id' => 7002, 'title' => 'Gardening help']);

        $listener = $this->makeListener();
        $listener->handle(new ListingCreated($listing, $this->makeUser(10), self::TENANT_ID));

        Http::assertSent(function ($request) {
            $body = $request->data();
            return ($body['action'] ?? null) === 'created'
                && ($body['id'] ?? null) === 7002
                && ($body['title'] ?? null) === 'Gardening help';
        });
    }

    public function test_pushes_with_action_updated_on_updated_event(): void
    {
        Http::fake(['*' => Http::response(['success' => true], 200)]);

        $this->insertListingPartner();
        $listing = $this->makeListing(['id' => 7003, 'title' => 'Updated offer']);

        $listener = $this->makeListener();
        $listener->handle(new ListingUpdated($listing, $this->makeUser(10), self::TENANT_ID));

        Http::assertSent(function ($request) {
            $body = $request->data();
            return ($body['action'] ?? null) === 'updated';
        });
    }

    public function test_payload_contains_tenant_id(): void
    {
        Http::fake(['*' => Http::response(['success' => true], 200)]);

        $this->insertListingPartner();
        $listing = $this->makeListing(['id' => 7004]);

        $listener = $this->makeListener();
        $listener->handle(new ListingCreated($listing, $this->makeUser(10), self::TENANT_ID));

        Http::assertSent(function ($request) {
            $body = $request->data();
            return ((int) ($body['tenant_id'] ?? 0)) === self::TENANT_ID;
        });
    }

    public function test_payload_contains_visibility_field(): void
    {
        Http::fake(['*' => Http::response(['success' => true], 200)]);

        $this->insertListingPartner();
        $listing = $this->makeListing(['id' => 7005, 'federated_visibility' => 'bookable']);

        $listener = $this->makeListener();
        $listener->handle(new ListingCreated($listing, $this->makeUser(10), self::TENANT_ID));

        Http::assertSent(function ($request) {
            $body = $request->data();
            return ($body['visibility'] ?? null) === 'bookable';
        });
    }

    public function test_restores_tenant_context_after_handle(): void
    {
        $featureSvc = Mockery::mock(FederationFeatureService::class);
        $featureSvc->shouldReceive('isTenantFederationEnabled')->andReturn(false);

        $listener = new PushListingToFederatedPartners($featureSvc);
        $listener->handle(new ListingCreated(
            $this->makeListing(),
            $this->makeUser(),
            self::TENANT_ID
        ));

        // Console/queue mode: restoreAfterScopedListener calls reset().
        $this->assertNull(TenantContext::currentId());
        Http::assertNothingSent();
    }
}
