<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

namespace Tests\Laravel\Feature;

use App\Services\EmailService;
use Mockery;
use Tests\Laravel\TestCase;

class SalesOrderApiTest extends TestCase
{
    public function test_public_sales_order_sends_full_quote_to_configured_recipient(): void
    {
        $emailService = Mockery::mock(EmailService::class);
        $emailService->shouldReceive('send')
            ->once()
            ->withArgs(function (string $to, string $subject, string $body, array $options): bool {
                $this->assertSame('jasper.ford.esq@gmail.com', $to);
                $this->assertStringContainsString('Project NEXUS order enquiry', $subject);
                $this->assertStringContainsString('Civic Network', $subject);
                $this->assertStringContainsString('Ava Murphy', $body);
                $this->assertStringContainsString('Full Platform Hosting', $body);
                $this->assertStringContainsString('Network', $body);
                $this->assertStringContainsString('Managed support', $body);
                $this->assertStringContainsString('We need procurement help.', $body);
                $this->assertSame('Ava Murphy <ava@example.org>', $options['replyTo']);
                $this->assertSame('sales_enquiry', $options['category']);
                $this->assertTrue($options['allow_missing_tenant']);
                $this->assertArrayHasKey('idempotency_key', $options);

                return true;
            })
            ->andReturn(true);

        $this->app->instance(EmailService::class, $emailService);

        $response = $this->apiPost('/v2/sales/orders', $this->payload());

        $response->assertCreated();
        $response->assertJsonPath('data.status', 'received');
        $this->assertStringStartsWith('NXSO-', (string) $response->json('data.reference'));
    }

    public function test_public_sales_order_accepts_a_general_enquiry_with_no_quote(): void
    {
        // The sales site's public pages have no quote builder on them. Before this, a plain
        // "tell us about your community" enquiry could not use this endpoint at all, because the
        // whole quote block was required.
        $emailService = Mockery::mock(EmailService::class);
        $emailService->shouldReceive('send')
            ->once()
            ->withArgs(function (string $to, string $subject, string $body, array $options): bool {
                $this->assertSame('jasper.ford.esq@gmail.com', $to);
                // A different subject, so an enquiry with no price attached is obvious in the inbox.
                $this->assertStringContainsString('Project NEXUS enquiry', $subject);
                $this->assertStringNotContainsString('order enquiry', $subject);
                $this->assertStringContainsString('Civic Network', $subject);

                $this->assertStringContainsString('Ava Murphy', $body);
                $this->assertStringContainsString('ava@example.org', $body);
                $this->assertStringContainsString('We run a timebank in Cork.', $body);
                $this->assertStringContainsString('No quote attached', $body);

                // Replying must still land on the enquirer, not on the site.
                $this->assertSame('Ava Murphy <ava@example.org>', $options['replyTo']);
                $this->assertTrue($options['allow_missing_tenant']);

                return true;
            })
            ->andReturn(true);

        $this->app->instance(EmailService::class, $emailService);

        $response = $this->apiPost('/v2/sales/orders', [
            'contact_name' => 'Ava Murphy',
            'organisation' => 'Civic Network',
            'email' => 'ava@example.org',
            'region' => 'Ireland',
            'note' => 'We run a timebank in Cork.',
            'page_url' => 'https://project-nexus.ie/',
        ]);

        $response->assertCreated();
        $response->assertJsonPath('data.status', 'received');
        $this->assertStringStartsWith('NXSO-', (string) $response->json('data.reference'));
    }

    public function test_public_sales_order_still_rejects_a_half_filled_quote(): void
    {
        // Optional means "all of it or none of it". A partial quote is a bug in the caller, and
        // accepting it would put a half-priced estimate in the enquiry email.
        $emailService = Mockery::mock(EmailService::class);
        $emailService->shouldNotReceive('send');
        $this->app->instance(EmailService::class, $emailService);

        $payload = $this->payload();
        unset($payload['quote']['plan_name'], $payload['quote']['first_year_label']);

        $response = $this->apiPost('/v2/sales/orders', $payload);

        $response->assertStatus(422);
        $this->assertContains(
            'quote.plan_name',
            array_column((array) $response->json('errors'), 'field')
        );
    }

    public function test_public_sales_order_still_requires_a_contact_name_without_a_quote(): void
    {
        $emailService = Mockery::mock(EmailService::class);
        $emailService->shouldNotReceive('send');
        $this->app->instance(EmailService::class, $emailService);

        $response = $this->apiPost('/v2/sales/orders', [
            'organisation' => 'Civic Network',
            'email' => 'ava@example.org',
        ]);

        $response->assertStatus(422);
        $response->assertJsonPath('errors.0.field', 'contact_name');
    }

    public function test_public_sales_order_honeypot_silently_accepts_without_sending(): void
    {
        $emailService = Mockery::mock(EmailService::class);
        $emailService->shouldNotReceive('send');
        $this->app->instance(EmailService::class, $emailService);

        $response = $this->apiPost('/v2/sales/orders', $this->payload(['website' => 'http://spam.example.com']));

        $response->assertCreated();
        $response->assertJsonPath('data.status', 'received');
    }

    public function test_public_sales_order_validates_contact_email(): void
    {
        $emailService = Mockery::mock(EmailService::class);
        $emailService->shouldNotReceive('send');
        $this->app->instance(EmailService::class, $emailService);

        $payload = $this->payload(['email' => 'not-an-email']);
        $response = $this->apiPost('/v2/sales/orders', $payload);

        $response->assertStatus(422);
        $response->assertJsonPath('errors.0.field', 'email');
    }

    public function test_public_sales_order_accepts_sales_preview_cors_preflight(): void
    {
        $response = $this
            ->withHeader('Origin', 'http://127.0.0.1:4176')
            ->withHeader('Access-Control-Request-Method', 'POST')
            ->withHeader('Access-Control-Request-Headers', 'content-type')
            ->options('/api/v2/sales/orders');

        $response->assertNoContent();
        $response->assertHeader('Access-Control-Allow-Origin', 'http://127.0.0.1:4176');
    }

    /**
     * @param array<string,mixed> $overrides
     * @return array<string,mixed>
     */
    private function payload(array $overrides = []): array
    {
        return array_merge([
            'contact_name' => 'Ava Murphy',
            'organisation' => 'Civic Network',
            'email' => 'ava@example.org',
            'region' => 'Ireland and UK',
            'note' => 'We need procurement help.',
            'page_url' => 'https://project-nexus.ie/hosting#quote-builder',
            'quote' => [
                'product_line_label' => 'Full Platform Hosting',
                'plan_name' => 'Network',
                'active_member_label' => '30,001 to 100,000 active members',
                'billing_cycle' => 'annual',
                'pricing_mode' => 'published',
                'monthly_recurring_label' => '€4,499',
                'annual_recurring_label' => '€44,990',
                'annual_savings_label' => '€8,998',
                'one_off_label' => '€2,000',
                'first_year_label' => '€46,990',
                'line_items' => [
                    [
                        'label' => 'Network hosting',
                        'amount_label' => '€4,499/mo',
                        'quantity' => 1,
                        'cadence' => 'monthly',
                    ],
                    [
                        'label' => 'Managed support',
                        'amount_label' => '€899/mo',
                        'quantity' => 1,
                        'cadence' => 'monthly',
                    ],
                ],
            ],
        ], $overrides);
    }

    public function test_public_sales_order_sends_as_a_sales_enquiry_not_tenant_billing_mail(): void
    {
        // An enquiry used to go out as "hOUR TimeBank" <billing@project-nexus.net> — the billing
        // From bucket plus the platform-wide default From name — which made a real enquiry from a
        // prospective customer read as ordinary platform notification mail, and it was missed.
        $emailService = Mockery::mock(EmailService::class);
        $emailService->shouldReceive('send')
            ->once()
            ->withArgs(function (string $to, string $subject, string $body, array $options): bool {
                // Routes the From address to enquiries@, not billing@.
                $this->assertSame('sales_enquiry', $options['category']);

                // Names the platform as the sender, so no community's name is
                // stamped on an enquiry that has nothing to do with it.
                $this->assertSame('Project NEXUS', $options['fromName']);

                // No tenant may be inferred from the hardcoded recipient.
                $this->assertArrayHasKey('tenant_id', $options);
                $this->assertNull($options['tenant_id']);
                $this->assertTrue($options['allow_missing_tenant']);

                // Unchanged and important: replies go to the enquirer.
                $this->assertSame('Ava Murphy <ava@example.org>', $options['replyTo']);

                return true;
            })
            ->andReturn(true);

        $this->app->instance(EmailService::class, $emailService);

        $this->apiPost('/v2/sales/orders', $this->payload())->assertCreated();
    }

    public function test_sales_enquiry_category_resolves_to_the_enquiries_from_address(): void
    {
        // The controller and the Mailer bucket have to agree; this is the seam
        // between them, and a rename on either side breaks delivery identity
        // silently rather than loudly.
        $mailer = new \App\Core\Mailer();
        $method = new \ReflectionMethod(\App\Core\Mailer::class, 'resolveFromPrefix');
        $method->setAccessible(true);

        $this->assertSame('enquiries', $method->invoke($mailer, 'sales_enquiry'));
    }
}
