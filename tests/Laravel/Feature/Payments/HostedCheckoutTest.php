<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

declare(strict_types=1);

namespace Tests\Laravel\Feature\Payments;

use App\Core\TenantContext;
use App\Models\User;
use App\Services\EmailDispatchService;
use App\Services\Identity\IdentityVerificationPaymentService;
use App\Services\Payments\HostedCheckoutService;
use App\Services\StripeDonationService;
use App\Services\Verein\VereinDuesService;
use App\Support\Payments\CheckoutReturnUrl;
use Illuminate\Foundation\Testing\DatabaseTransactions;
use Illuminate\Support\Facades\DB;
use Laravel\Sanctum\Sanctum;
use Stripe\ApiRequestor;
use Stripe\HttpClient\ClientInterface;
use Tests\Laravel\TestCase;

/**
 * Hosted Stripe payment pages for the identity fee, donations and club dues
 * (accessible site, no JavaScript — owner, 26 Oct 2026).
 *
 * Every Stripe call goes to an in-memory fake at the HTTP layer, so the real
 * Stripe SDK builds the requests. Pinned here:
 *  - a page carries the SAME metadata as the card form, on the session and on
 *    the payment it creates, so the existing payment_intent.succeeded handlers
 *    complete it — including when that event arrives before the session one;
 *  - one record cannot be paid twice: an unpaid card-form intent is cancelled
 *    before a page opens, an open page is reused, and the card form closes an
 *    open page first;
 *  - a declined card on an open page does not close the record; expiry does;
 *  - only the member's own dues; return addresses only on this community's
 *    website or accessible site.
 */
class HostedCheckoutTest extends TestCase
{
    use DatabaseTransactions;

    /** @var array<int, array{method:string,url:string,params:mixed,headers:array<int,string>}> */
    private array $calls = [];
    /** @var array<string, array<string,mixed>> */
    private array $sessions = [];
    /** @var array<string, array<string,mixed>> */
    private array $intents = [];

    protected function setUp(): void
    {
        parent::setUp();
        config(['services.stripe.secret' => 'sk_test_hosted_checkout_fake']);
        $this->fakeStripe();
    }

    protected function tearDown(): void
    {
        ApiRequestor::setHttpClient(null);
        parent::tearDown();
    }

    // ── Return addresses ──────────────────────────────────────────────────

    public function test_return_address_accepts_this_communitys_two_frontends_only(): void
    {
        DB::table('tenants')->where('id', $this->testTenantId)
            ->update(['accessible_domain' => 'accessible-hosted.example.test']);
        TenantContext::setById($this->testTenantId);

        $website = rtrim(TenantContext::getFrontendUrl(), '/') . TenantContext::getSlugPrefix() . '/premium/return';
        $this->assertSame($website, CheckoutReturnUrl::safe($website, '/fallback'));

        $accessible = 'https://accessible-hosted.example.test/volunteering/donations?x=1';
        $this->assertSame($accessible, CheckoutReturnUrl::safe($accessible, '/fallback'));

        $fallback = rtrim(TenantContext::getFrontendUrl(), '/') . TenantContext::getSlugPrefix() . '/fallback';
        foreach ([
            'https://evil.example.test/steal',
            '//accessible-hosted.example.test/x',
            'https://accessible-hosted.example.test.evil.test/x',
            'https://user@accessible-hosted.example.test/x',
            'javascript:alert(1)',
            "https://accessible-hosted.example.test/a\nb",
            'https://accessible-hosted.example.test\\@evil.test/',
        ] as $bad) {
            $this->assertSame($fallback, CheckoutReturnUrl::safe($bad, '/fallback'), $bad);
        }
    }

    public function test_return_address_on_the_shared_accessible_host_is_confined_to_this_community(): void
    {
        config(['app.accessible_frontend_url' => 'https://accessible-platform.example.test']);
        DB::table('tenants')->where('id', $this->testTenantId)->update(['accessible_domain' => null]);
        TenantContext::setById($this->testTenantId);
        $slug = (string) TenantContext::get()['slug'];

        $own = "https://accessible-platform.example.test/{$slug}/accessible/me/verein-dues";
        $this->assertSame($own, CheckoutReturnUrl::safe($own, '/fallback'));

        $other = 'https://accessible-platform.example.test/another-community/accessible/me/verein-dues';
        $this->assertNotSame($other, CheckoutReturnUrl::safe($other, '/fallback'));
    }

    public function test_query_is_appended_correctly_and_the_session_placeholder_stays_literal(): void
    {
        $this->assertSame(
            'https://a.example.test/p?status=success&checkout=success&session_id={CHECKOUT_SESSION_ID}',
            CheckoutReturnUrl::withQuery('https://a.example.test/p?status=success', [
                'checkout' => 'success', 'session_id' => '{CHECKOUT_SESSION_ID}',
            ])
        );
        $this->assertSame(
            'https://a.example.test/p?cancelled=1#top',
            CheckoutReturnUrl::withQuery('https://a.example.test/p#top', ['cancelled' => '1'])
        );
    }

    // ── Identity-verification fee ─────────────────────────────────────────

    public function test_identity_fee_page_carries_the_card_form_metadata_and_is_reused(): void
    {
        $user = User::factory()->forTenant($this->testTenantId)->create();

        $first = IdentityVerificationPaymentService::createCheckoutSession($user->id, $this->testTenantId, 500, 'https://r.test/ok', 'https://r.test/no');
        $this->assertFalse($first['already_paid']);
        $this->assertStringStartsWith('https://checkout.stripe.test/', (string) $first['checkout_url']);

        $created = $this->sessionCreates();
        $this->assertCount(1, $created);
        $params = $created[0]['params'];
        $this->assertSame('payment', $params['mode']);
        $this->assertSame(['card'], $params['payment_method_types']);
        $this->assertSame(500, (int) $params['line_items'][0]['price_data']['unit_amount']);
        $meta = $params['payment_intent_data']['metadata'];
        $this->assertSame('identity_verification', $meta['nexus_type']);
        $this->assertSame((string) $user->id, $meta['nexus_user_id']);
        $this->assertSame('identity_fee', $meta['nexus_checkout_kind']);
        $rowId = (int) $meta['nexus_identity_session_id'];
        $this->assertSame($params['metadata'], $params['payment_intent_data']['metadata']);

        $row = DB::table('identity_verification_sessions')->where('id', $rowId)->first();
        $this->assertSame('pending', $row->payment_status);
        $this->assertNotEmpty($row->stripe_checkout_session_id);

        // Pressing Pay again returns to the same open page.
        $second = IdentityVerificationPaymentService::createCheckoutSession($user->id, $this->testTenantId, 500, 'https://r.test/ok', 'https://r.test/no');
        $this->assertSame($first['checkout_url'], $second['checkout_url']);
        $this->assertCount(1, $this->sessionCreates());
    }

    public function test_identity_fee_page_cancels_an_unpaid_card_form_intent_first(): void
    {
        $user = User::factory()->forTenant($this->testTenantId)->create();
        $this->intents['pi_card_unpaid'] = ['id' => 'pi_card_unpaid', 'object' => 'payment_intent', 'status' => 'requires_payment_method'];
        $cardRow = $this->insertIdentityRow($user->id, ['stripe_payment_intent_id' => 'pi_card_unpaid']);

        IdentityVerificationPaymentService::createCheckoutSession($user->id, $this->testTenantId, 500, 'https://r.test/ok', 'https://r.test/no');

        $this->assertSame('canceled', $this->intents['pi_card_unpaid']['status']);
        $this->assertSame('failed', DB::table('identity_verification_sessions')->where('id', $cardRow)->value('payment_status'));
        $this->assertCount(1, $this->sessionCreates());
    }

    public function test_identity_fee_already_paid_by_card_opens_no_page(): void
    {
        $user = User::factory()->forTenant($this->testTenantId)->create();
        $this->intents['pi_card_paid'] = ['id' => 'pi_card_paid', 'object' => 'payment_intent', 'status' => 'succeeded'];
        $cardRow = $this->insertIdentityRow($user->id, ['stripe_payment_intent_id' => 'pi_card_paid']);

        $result = IdentityVerificationPaymentService::createCheckoutSession($user->id, $this->testTenantId, 500, 'https://r.test/ok', 'https://r.test/no');

        $this->assertTrue($result['already_paid']);
        $this->assertSame('completed', DB::table('identity_verification_sessions')->where('id', $cardRow)->value('payment_status'));
        $this->assertCount(0, $this->sessionCreates());
    }

    public function test_identity_fee_paid_on_the_page_is_completed_even_before_the_session_event(): void
    {
        $user = User::factory()->forTenant($this->testTenantId)->create();
        IdentityVerificationPaymentService::createCheckoutSession($user->id, $this->testTenantId, 500, 'https://r.test/ok', 'https://r.test/no');
        $meta = $this->sessionCreates()[0]['params']['payment_intent_data']['metadata'];
        $rowId = (int) $meta['nexus_identity_session_id'];

        // payment_intent.succeeded arrives first: the intent id is not stored yet.
        IdentityVerificationPaymentService::handlePaymentSucceeded($this->intentEvent('pi_hosted_paid', $meta));

        $row = DB::table('identity_verification_sessions')->where('id', $rowId)->first();
        $this->assertSame('completed', $row->payment_status);
        $this->assertSame('pi_hosted_paid', $row->stripe_payment_intent_id);
        $this->assertTrue(IdentityVerificationPaymentService::hasCompletedPayment($this->testTenantId, $user->id));
    }

    public function test_identity_metadata_cannot_adopt_another_members_record(): void
    {
        $owner = User::factory()->forTenant($this->testTenantId)->create();
        $other = User::factory()->forTenant($this->testTenantId)->create();
        IdentityVerificationPaymentService::createCheckoutSession($owner->id, $this->testTenantId, 500, 'https://r.test/ok', 'https://r.test/no');
        $meta = $this->sessionCreates()[0]['params']['payment_intent_data']['metadata'];
        $meta['nexus_user_id'] = (string) $other->id;

        IdentityVerificationPaymentService::handlePaymentSucceeded($this->intentEvent('pi_forged', $meta));

        $this->assertSame('pending', DB::table('identity_verification_sessions')
            ->where('id', (int) $meta['nexus_identity_session_id'])->value('payment_status'));
    }

    public function test_a_declined_card_on_the_page_keeps_the_identity_attempt_open_and_expiry_closes_it(): void
    {
        $user = User::factory()->forTenant($this->testTenantId)->create();
        IdentityVerificationPaymentService::createCheckoutSession($user->id, $this->testTenantId, 500, 'https://r.test/ok', 'https://r.test/no');
        $created = $this->sessionCreates()[0];
        $meta = $created['params']['payment_intent_data']['metadata'];
        $rowId = (int) $meta['nexus_identity_session_id'];

        IdentityVerificationPaymentService::handlePaymentFailed($this->intentEvent('pi_declined', $meta, 'requires_payment_method'));
        $this->assertSame('pending', DB::table('identity_verification_sessions')->where('id', $rowId)->value('payment_status'));

        $sessionId = (string) DB::table('identity_verification_sessions')->where('id', $rowId)->value('stripe_checkout_session_id');
        HostedCheckoutService::handleWebhookEvent('checkout.session.expired', $this->sessionEvent($sessionId, 'identity_fee'));
        $this->assertSame('failed', DB::table('identity_verification_sessions')->where('id', $rowId)->value('payment_status'));
    }

    public function test_card_form_closes_an_open_identity_page_first(): void
    {
        $user = User::factory()->forTenant($this->testTenantId)->create();
        IdentityVerificationPaymentService::createCheckoutSession($user->id, $this->testTenantId, 500, 'https://r.test/ok', 'https://r.test/no');
        $sessionId = (string) array_key_first($this->sessions);

        $this->assertTrue(IdentityVerificationPaymentService::closeOpenCheckouts($this->testTenantId, $user->id));
        $this->assertSame('expired', $this->sessions[$sessionId]['status']);
    }

    public function test_identity_checkout_endpoint_returns_the_page_and_keeps_the_return_on_the_accessible_site(): void
    {
        DB::table('tenants')->where('id', $this->testTenantId)
            ->update(['accessible_domain' => 'accessible-hosted.example.test']);
        $user = User::factory()->forTenant($this->testTenantId)->create();
        Sanctum::actingAs($user);

        $response = $this->apiPost('/v2/identity/checkout', [
            'return_url' => 'https://accessible-hosted.example.test/verify-identity?step=pay',
        ]);

        if ($response->status() === 403) {
            $this->markTestSkipped('identity_verification is switched off for the test community');
        }
        $response->assertOk();
        $this->assertStringStartsWith('https://checkout.stripe.test/', (string) $response->json('data.checkout_url'));
        $params = $this->sessionCreates()[0]['params'];
        $this->assertSame(
            'https://accessible-hosted.example.test/verify-identity?step=pay&checkout=success&session_id={CHECKOUT_SESSION_ID}',
            $params['success_url']
        );
    }

    // ── Donations ─────────────────────────────────────────────────────────

    public function test_donation_page_creates_a_pending_donation_with_the_card_form_metadata(): void
    {
        $user = User::factory()->forTenant($this->testTenantId)->create();
        TenantContext::setById($this->testTenantId);
        $currency = strtolower((string) TenantContext::getCurrency());

        $result = StripeDonationService::createCheckoutSession($user->id, $this->testTenantId, [
            'amount' => 12.5,
            'currency' => $currency,
            'message' => 'For the food bank',
        ], ['success_url' => 'https://r.test/ok', 'cancel_url' => 'https://r.test/no']);

        $donation = DB::table('vol_donations')->where('id', $result['donation_id'])->first();
        $this->assertSame('pending', $donation->status);
        $this->assertSame('stripe', $donation->payment_method);
        $this->assertNull($donation->stripe_payment_intent_id);
        $this->assertNotEmpty($donation->stripe_checkout_session_id);

        $params = $this->sessionCreates()[0]['params'];
        $this->assertSame(1250, (int) $params['line_items'][0]['price_data']['unit_amount']);
        $this->assertSame((string) $donation->id, $params['payment_intent_data']['metadata']['nexus_donation_id']);
        $this->assertSame('donation', $params['payment_intent_data']['metadata']['nexus_checkout_kind']);
        $this->assertCount(0, array_filter($this->calls, fn ($c) => str_ends_with($c['url'], '/v1/payment_intents')));
    }

    public function test_donation_paid_on_the_page_is_completed_and_a_declined_card_does_not_fail_it(): void
    {
        $user = User::factory()->forTenant($this->testTenantId)->create();
        TenantContext::setById($this->testTenantId);
        $result = StripeDonationService::createCheckoutSession($user->id, $this->testTenantId, [
            'amount' => 5, 'currency' => strtolower((string) TenantContext::getCurrency()),
        ], ['success_url' => 'https://r.test/ok', 'cancel_url' => 'https://r.test/no']);
        $meta = $this->sessionCreates()[0]['params']['payment_intent_data']['metadata'];

        // On a hosted page the member retries on the SAME payment intent.
        StripeDonationService::handlePaymentFailed($this->intentEvent('pi_don_paid', $meta, 'requires_payment_method'));
        $this->assertSame('pending', DB::table('vol_donations')->where('id', $result['donation_id'])->value('status'));

        StripeDonationService::handlePaymentSucceeded($this->intentEvent('pi_don_paid', $meta));
        $row = DB::table('vol_donations')->where('id', $result['donation_id'])->first();
        $this->assertSame('completed', $row->status);
        $this->assertSame('pi_don_paid', $row->stripe_payment_intent_id);
    }

    public function test_an_expired_donation_page_closes_the_pending_donation(): void
    {
        $user = User::factory()->forTenant($this->testTenantId)->create();
        TenantContext::setById($this->testTenantId);
        $result = StripeDonationService::createCheckoutSession($user->id, $this->testTenantId, [
            'amount' => 5, 'currency' => strtolower((string) TenantContext::getCurrency()),
        ], ['success_url' => 'https://r.test/ok', 'cancel_url' => 'https://r.test/no']);
        $sessionId = (string) DB::table('vol_donations')->where('id', $result['donation_id'])->value('stripe_checkout_session_id');

        HostedCheckoutService::handleWebhookEvent('checkout.session.expired', $this->sessionEvent($sessionId, 'donation'));

        $this->assertSame('failed', DB::table('vol_donations')->where('id', $result['donation_id'])->value('status'));
    }

    public function test_session_completed_links_the_payment_to_the_donation(): void
    {
        $user = User::factory()->forTenant($this->testTenantId)->create();
        TenantContext::setById($this->testTenantId);
        $result = StripeDonationService::createCheckoutSession($user->id, $this->testTenantId, [
            'amount' => 5, 'currency' => strtolower((string) TenantContext::getCurrency()),
        ], ['success_url' => 'https://r.test/ok', 'cancel_url' => 'https://r.test/no']);
        $sessionId = (string) DB::table('vol_donations')->where('id', $result['donation_id'])->value('stripe_checkout_session_id');

        HostedCheckoutService::handleWebhookEvent('checkout.session.completed', $this->sessionEvent($sessionId, 'donation', 'pi_linked'));

        $this->assertSame('pi_linked', DB::table('vol_donations')->where('id', $result['donation_id'])->value('stripe_payment_intent_id'));
    }

    // ── Club dues ─────────────────────────────────────────────────────────

    public function test_dues_page_is_only_for_the_members_own_dues(): void
    {
        $member = User::factory()->forTenant($this->testTenantId)->create();
        $someoneElse = User::factory()->forTenant($this->testTenantId)->create();
        $duesId = $this->insertDues($member->id);

        $this->expectException(\RuntimeException::class);
        (new VereinDuesService())->createCheckoutSession($duesId, $someoneElse->id, 'https://r.test/ok', 'https://r.test/no');
    }

    public function test_dues_paid_on_the_page_are_marked_paid_by_the_existing_handler(): void
    {
        $member = User::factory()->forTenant($this->testTenantId)->create();
        $duesId = $this->insertDues($member->id);

        $result = (new VereinDuesService())->createCheckoutSession($duesId, $member->id, 'https://r.test/ok', 'https://r.test/no');
        $this->assertFalse($result['already_paid']);
        $params = $this->sessionCreates()[0]['params'];
        $this->assertSame(4500, (int) $params['line_items'][0]['price_data']['unit_amount']);
        $this->assertSame('chf', $params['line_items'][0]['price_data']['currency']);
        $meta = $params['payment_intent_data']['metadata'];
        $this->assertSame((string) $duesId, $meta['nexus_dues_id']);
        $this->assertSame('verein_dues', $meta['nexus_type']);

        app()->instance(EmailDispatchService::class, new class extends EmailDispatchService {
            public function send(string $to, string $subject, string $body, array $options = []): bool
            {
                return true;
            }
        });
        VereinDuesService::handleWebhookEvent('payment_intent.succeeded', $this->intentEvent('pi_dues_paid', $meta));

        $this->assertSame('paid', DB::table('verein_member_dues')->where('id', $duesId)->value('status'));
    }

    public function test_dues_page_cancels_an_unpaid_card_form_intent_and_the_card_form_closes_an_open_page(): void
    {
        $member = User::factory()->forTenant($this->testTenantId)->create();
        $duesId = $this->insertDues($member->id, ['stripe_payment_intent_id' => 'pi_dues_card']);
        $this->intents['pi_dues_card'] = ['id' => 'pi_dues_card', 'object' => 'payment_intent', 'status' => 'requires_payment_method'];

        (new VereinDuesService())->createCheckoutSession($duesId, $member->id, 'https://r.test/ok', 'https://r.test/no');
        $this->assertSame('canceled', $this->intents['pi_dues_card']['status']);
        $this->assertNull(DB::table('verein_member_dues')->where('id', $duesId)->value('stripe_payment_intent_id'));
        $sessionId = (string) DB::table('verein_member_dues')->where('id', $duesId)->value('stripe_checkout_session_id');

        // Now the website's card form: the open page is expired first, and the
        // cancelled intent behind the stable key is not handed back.
        $this->intents['pi_dues_card']['status'] = 'canceled';
        TenantContext::setById($this->testTenantId);
        $card = (new VereinDuesService())->createPaymentIntent($duesId, $member->id);
        $this->assertSame('expired', $this->sessions[$sessionId]['status']);
        $this->assertNotSame('pi_dues_card', $card['payment_intent_id']);
        $this->assertNull(DB::table('verein_member_dues')->where('id', $duesId)->value('stripe_checkout_session_id'));
    }

    public function test_dues_already_paid_open_no_page(): void
    {
        $member = User::factory()->forTenant($this->testTenantId)->create();
        $duesId = $this->insertDues($member->id, ['status' => 'paid']);

        $result = (new VereinDuesService())->createCheckoutSession($duesId, $member->id, 'https://r.test/ok', 'https://r.test/no');

        $this->assertTrue($result['already_paid']);
        $this->assertCount(0, $this->sessionCreates());
    }

    public function test_an_expired_dues_page_is_forgotten(): void
    {
        $member = User::factory()->forTenant($this->testTenantId)->create();
        $duesId = $this->insertDues($member->id);
        (new VereinDuesService())->createCheckoutSession($duesId, $member->id, 'https://r.test/ok', 'https://r.test/no');
        $sessionId = (string) DB::table('verein_member_dues')->where('id', $duesId)->value('stripe_checkout_session_id');

        HostedCheckoutService::handleWebhookEvent('checkout.session.expired', $this->sessionEvent($sessionId, 'verein_dues'));

        $row = DB::table('verein_member_dues')->where('id', $duesId)->first();
        $this->assertNull($row->stripe_checkout_session_id);
        $this->assertSame('pending', $row->status);
    }

    // ── Webhook routing ───────────────────────────────────────────────────

    public function test_only_sessions_these_flows_created_are_claimed(): void
    {
        $this->assertTrue(HostedCheckoutService::owns($this->sessionEvent('cs_x', 'donation')));
        $this->assertFalse(HostedCheckoutService::owns((object) ['id' => 'cs_y', 'metadata' => (object) ['nexus_plan_id' => '3']]));
        $this->assertFalse(HostedCheckoutService::owns((object) ['id' => 'cs_z', 'metadata' => (object) ['nexus_checkout_kind' => 'marketplace']]));
    }

    // ── Helpers ───────────────────────────────────────────────────────────

    /** @return array<int, array{method:string,url:string,params:mixed,headers:array<int,string>}> */
    private function sessionCreates(): array
    {
        return array_values(array_filter(
            $this->calls,
            fn ($c) => $c['method'] === 'post' && str_ends_with($c['url'], '/v1/checkout/sessions')
        ));
    }

    private function insertIdentityRow(int $userId, array $extra = []): int
    {
        return (int) DB::table('identity_verification_sessions')->insertGetId(array_merge([
            'tenant_id' => $this->testTenantId,
            'user_id' => $userId,
            'provider_slug' => 'stripe_identity',
            'verification_level' => 'document_selfie',
            'status' => 'cancelled',
            'verification_fee_amount' => 500,
            'payment_status' => 'pending',
            'created_at' => now(),
        ], $extra));
    }

    private function insertDues(int $userId, array $extra = []): int
    {
        $orgId = (int) DB::table('vol_organizations')->insertGetId([
            'tenant_id' => $this->testTenantId,
            'name' => 'Hosted checkout club ' . uniqid('', true),
            'org_type' => 'club',
            'created_at' => now(),
            'updated_at' => now(),
        ]);

        return (int) DB::table('verein_member_dues')->insertGetId(array_merge([
            'organization_id' => $orgId,
            'tenant_id' => $this->testTenantId,
            'user_id' => $userId,
            'membership_year' => (int) date('Y'),
            'amount_cents' => 4500,
            'currency' => 'CHF',
            'status' => 'pending',
            'due_date' => date('Y') . '-12-31',
            'created_at' => now(),
            'updated_at' => now(),
        ], $extra));
    }

    /** @param array<string,string> $metadata */
    private function intentEvent(string $id, array $metadata, string $status = 'succeeded'): object
    {
        return json_decode(json_encode([
            'id' => $id,
            'object' => 'payment_intent',
            'status' => $status,
            'metadata' => $metadata,
            'payment_method_types' => ['card'],
            'latest_charge' => null,
        ]));
    }

    private function sessionEvent(string $sessionId, string $kind, ?string $paymentIntent = null): object
    {
        return json_decode(json_encode([
            'id' => $sessionId,
            'object' => 'checkout.session',
            'payment_intent' => $paymentIntent,
            'payment_status' => $paymentIntent ? 'paid' : 'unpaid',
            'metadata' => ['nexus_checkout_kind' => $kind],
        ]));
    }

    /** Route every Stripe API call to an in-memory fake that keeps state. */
    private function fakeStripe(): void
    {
        $calls = &$this->calls;
        $sessions = &$this->sessions;
        $intents = &$this->intents;

        ApiRequestor::setHttpClient(new class ($calls, $sessions, $intents) implements ClientInterface {
            public function __construct(private array &$calls, private array &$sessions, private array &$intents)
            {
            }

            public function request($method, $absUrl, $headers, $params, $hasFile, $apiMode = 'v1')
            {
                $method = strtolower($method);
                $this->calls[] = ['method' => $method, 'url' => $absUrl, 'params' => $params, 'headers' => $headers];
                $path = (string) parse_url($absUrl, PHP_URL_PATH);

                if ($path === '/v1/customers' && $method === 'post') {
                    return $this->ok(['id' => 'cus_hosted_fake', 'object' => 'customer']);
                }
                if ($path === '/v1/checkout/sessions' && $method === 'post') {
                    $id = 'cs_test_' . bin2hex(random_bytes(6));
                    $this->sessions[$id] = [
                        'id' => $id,
                        'object' => 'checkout.session',
                        'status' => 'open',
                        'payment_status' => 'unpaid',
                        'url' => 'https://checkout.stripe.test/c/pay/' . $id,
                        'amount_total' => (int) $params['line_items'][0]['price_data']['unit_amount'],
                        'currency' => (string) $params['line_items'][0]['price_data']['currency'],
                        'expires_at' => (int) $params['expires_at'],
                        'metadata' => $params['metadata'] ?? [],
                        'payment_intent' => null,
                    ];
                    return $this->ok($this->sessions[$id]);
                }
                if (preg_match('#^/v1/checkout/sessions/([^/]+)(/expire)?$#', $path, $m)) {
                    if (!isset($this->sessions[$m[1]])) {
                        return $this->notFound();
                    }
                    if (!empty($m[2]) && $method === 'post') {
                        $this->sessions[$m[1]]['status'] = 'expired';
                    }
                    return $this->ok($this->sessions[$m[1]]);
                }
                if ($path === '/v1/payment_intents' && $method === 'post') {
                    $id = 'pi_card_new_' . bin2hex(random_bytes(4));
                    $this->intents[$id] = ['id' => $id, 'object' => 'payment_intent', 'status' => 'requires_payment_method', 'client_secret' => $id . '_secret'];
                    return $this->ok($this->intents[$id]);
                }
                if (preg_match('#^/v1/payment_intents/([^/]+)(/cancel)?$#', $path, $m)) {
                    if (!isset($this->intents[$m[1]])) {
                        return $this->notFound();
                    }
                    if (!empty($m[2]) && $method === 'post') {
                        $this->intents[$m[1]]['status'] = 'canceled';
                    }
                    return $this->ok($this->intents[$m[1]]);
                }

                return $this->notFound();
            }

            private function ok(array $body): array
            {
                return [json_encode($body), 200, []];
            }

            private function notFound(): array
            {
                return [json_encode(['error' => ['message' => 'No such object', 'type' => 'invalid_request_error']]), 404, []];
            }
        });
    }
}
