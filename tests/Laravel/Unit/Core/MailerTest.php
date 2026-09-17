<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

namespace Tests\Laravel\Unit\Core;

use App\Core\Mailer;
use App\Core\TenantContext;
use Tests\Laravel\TestCase;

class MailerTest extends TestCase
{
    // -------------------------------------------------------
    // Constructor / getProviderType()
    // -------------------------------------------------------

    public function test_constructor_defaults_to_smtp_when_no_gmail_or_postmark(): void
    {
        // In test env, USE_GMAIL_API and POSTMARK_SERVER_TOKEN are not set
        $mailer = new Mailer();
        $type = $mailer->getProviderType();
        // Should be smtp (or gmail_api/postmark if env vars are set)
        $this->assertContains($type, ['smtp', 'gmail_api', 'postmark']);
    }

    public function test_constructor_with_tenant_id_does_not_throw(): void
    {
        // Passing a tenant ID should not throw even if tenant has no email config
        $mailer = new Mailer(2);
        $this->assertInstanceOf(Mailer::class, $mailer);
    }

    // -------------------------------------------------------
    // getProviderType()
    // -------------------------------------------------------

    public function test_getProviderType_returns_string(): void
    {
        $mailer = new Mailer();
        $this->assertIsString($mailer->getProviderType());
    }

    // -------------------------------------------------------
    // forCurrentTenant()
    // -------------------------------------------------------

    public function test_forCurrentTenant_returns_mailer_instance(): void
    {
        $mailer = Mailer::forCurrentTenant();
        $this->assertInstanceOf(Mailer::class, $mailer);
    }

    public function test_forCurrentTenant_does_not_resolve_master_when_context_is_missing(): void
    {
        TenantContext::reset();

        $mailer = Mailer::forCurrentTenant();

        $tenantProperty = new \ReflectionProperty(Mailer::class, 'tenantId');
        $tenantProperty->setAccessible(true);

        $this->assertNull($tenantProperty->getValue($mailer));
        $this->assertNull(TenantContext::currentId());
    }

    public function test_event_subcategories_route_to_event_mailer_settings(): void
    {
        $mailer = new Mailer();
        $method = new \ReflectionMethod(Mailer::class, 'resolveFromPrefix');
        $method->setAccessible(true);

        $this->assertSame('events', $method->invoke($mailer, 'event_notification'));
        $this->assertSame('events', $method->invoke($mailer, 'event_update'));
        $this->assertSame('events', $method->invoke($mailer, 'event_cancellation'));
        $this->assertSame('events', $method->invoke($mailer, 'event_rsvp'));
        $this->assertSame('events', $method->invoke($mailer, 'event_created'));
        $this->assertSame('events', $method->invoke($mailer, 'event_reminder'));
    }

    public function test_platform_reply_to_is_not_hard_coded_to_personal_address(): void
    {
        $reflection = new \ReflectionClass(Mailer::class);

        $this->assertFalse(
            $reflection->hasConstant('DEFAULT_REPLY_TO'),
            'Platform Reply-To must be configured, not hard-coded to a personal mailbox.'
        );
    }

    public function test_platform_reply_to_comes_from_configuration(): void
    {
        config([
            'mail.platform_provider' => 'postmark',
            'mail.postmark.server_token' => 'x',
            'mail.postmark.reply_to' => 'reply@project-nexus.net',
        ]);

        $mailer = new Mailer();

        $replyTo = new \ReflectionProperty(Mailer::class, 'platformReplyTo');
        $replyTo->setAccessible(true);

        $this->assertSame('reply@project-nexus.net', $replyTo->getValue($mailer));
    }

    // -------------------------------------------------------
    // Sales enquiry From-address bucket
    // -------------------------------------------------------

    public function test_sales_enquiry_category_routes_to_its_own_from_bucket(): void
    {
        $mailer = new Mailer();
        $method = new \ReflectionMethod(Mailer::class, 'resolveFromPrefix');
        $method->setAccessible(true);

        $this->assertSame(
            Mailer::CATEGORY_ENQUIRIES,
            $method->invoke($mailer, 'sales_enquiry'),
            'A sales enquiry must not share a From address with platform billing mail.'
        );
        $this->assertSame('enquiries', Mailer::CATEGORY_ENQUIRIES);
    }

    public function test_sales_enquiry_bucket_does_not_disturb_the_existing_billing_bucket(): void
    {
        $mailer = new Mailer();
        $method = new \ReflectionMethod(Mailer::class, 'resolveFromPrefix');
        $method->setAccessible(true);

        // The enquiries branch sits directly above the billing branch, so these
        // pin that it was inserted before it without swallowing any of it.
        $this->assertSame(Mailer::CATEGORY_BILLING, $method->invoke($mailer, 'billing'));
        $this->assertSame(Mailer::CATEGORY_BILLING, $method->invoke($mailer, 'donation'));
        $this->assertSame(Mailer::CATEGORY_BILLING, $method->invoke($mailer, 'marketplace_payment'));
        $this->assertSame(Mailer::CATEGORY_BILLING, $method->invoke($mailer, 'identity_payment'));
        $this->assertSame(Mailer::CATEGORY_BILLING, $method->invoke($mailer, 'verein_dues'));
        $this->assertSame(Mailer::CATEGORY_BILLING, $method->invoke($mailer, 'vol_org_wallet'));
    }

    public function test_sales_enquiry_stays_on_the_transactional_stream(): void
    {
        $mailer = new Mailer();
        $method = new \ReflectionMethod(Mailer::class, 'resolvePostmarkStream');
        $method->setAccessible(true);

        // Stream selection keys off the same bucket resolver, so a new bucket
        // could silently move enquiries onto the bulk/broadcast stream.
        $this->assertSame(
            $method->invoke($mailer, 'billing'),
            $method->invoke($mailer, 'sales_enquiry'),
            'Sales enquiries are transactional, like the billing mail they used to be sent as.'
        );
    }

    // -------------------------------------------------------
    // withFromName()
    // -------------------------------------------------------

    public function test_withFromName_overrides_the_default_sender_name(): void
    {
        $mailer = new Mailer();
        $mailer->withFromName('Project NEXUS');

        $fromName = new \ReflectionProperty(Mailer::class, 'fromName');
        $fromName->setAccessible(true);

        $this->assertSame('Project NEXUS', $fromName->getValue($mailer));
    }

    public function test_withFromName_ignores_empty_values_and_strips_header_injection(): void
    {
        $mailer = new Mailer();
        $fromName = new \ReflectionProperty(Mailer::class, 'fromName');
        $fromName->setAccessible(true);

        $mailer->withFromName('Original');
        $mailer->withFromName('');
        $mailer->withFromName('   ');
        $mailer->withFromName(null);

        $this->assertSame('Original', $fromName->getValue($mailer), 'An empty override must not blank the From name.');

        // chr() rather than escape sequences so the CR/LF cannot be lost in
        // transit between editors — the point of the test is those two bytes.
        $cr = chr(13);
        $lf = chr(10);
        $mailer->withFromName('Evil' . $cr . $lf . 'Bcc: attacker@example.com');

        $result = (string) $fromName->getValue($mailer);
        $this->assertStringNotContainsString($cr, $result);
        $this->assertStringNotContainsString($lf, $result);
    }

    // -------------------------------------------------------
    // testGmailConnection()
    // -------------------------------------------------------

    public function test_testGmailConnection_returns_array(): void
    {
        $result = Mailer::testGmailConnection();
        $this->assertIsArray($result);
        $this->assertArrayHasKey('success', $result);
        $this->assertArrayHasKey('message', $result);
    }
}
