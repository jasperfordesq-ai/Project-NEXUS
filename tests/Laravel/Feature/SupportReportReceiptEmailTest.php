<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

namespace Tests\Laravel\Feature;

use App\Models\User;
use App\Services\EmailDispatchService;
use Illuminate\Foundation\Testing\DatabaseTransactions;
use Illuminate\Support\Facades\Queue;
use Laravel\Sanctum\Sanctum;
use Tests\Laravel\TestCase;

/**
 * A member who sends a "Help & support" request gets an email receipt with
 * their reference, from the platform itself (no Atlassian involved), in
 * their own language.
 */
class SupportReportReceiptEmailTest extends TestCase
{
    use DatabaseTransactions;

    private SupportReportReceiptRecordingMailer $mailer;

    protected function setUp(): void
    {
        parent::setUp();
        Queue::fake();
        config(['support_jira.enabled' => false]);
        $this->mailer = new SupportReportReceiptRecordingMailer();
        app()->instance(EmailDispatchService::class, $this->mailer);
    }

    public function test_the_member_gets_a_receipt_with_their_reference(): void
    {
        $member = $this->member(['preferred_language' => 'en']);

        $response = $this->apiPost('/v2/support/reports', [
            'request_type' => 'how_to',
            'summary' => 'Joining a group',
            'description' => 'Where do I ask to join a group on my phone?',
        ]);

        $response->assertCreated();
        $reference = (string) $response->json('data.report.reference');
        $receipts = $this->callsTo($member->email);
        $this->assertCount(1, $receipts, 'the member should get exactly one receipt');
        $receipt = $receipts[0];
        $this->assertStringContainsString($reference, $receipt['subject']);
        $this->assertStringContainsString("We've received your request", $receipt['subject']);
        $this->assertStringContainsString($reference, $receipt['body']);
        $this->assertStringContainsString('Joining a group', $receipt['body']);
        $this->assertStringContainsString('How do I', $receipt['body']);
        $this->assertSame('support_report', $receipt['options']['category']);
        $this->assertSame($this->testTenantId, (int) $receipt['options']['tenant_id']);
        $this->assertSame(
            'support-report-receipt:' . (int) $response->json('data.report.id'),
            $receipt['options']['idempotency_key'],
        );
    }

    public function test_the_receipt_is_in_the_members_own_language(): void
    {
        // Tests load only en, ga and de (config app.test_translation_locales).
        $member = $this->member(['preferred_language' => 'de']);

        $this->apiPost('/v2/support/reports', [
            'request_type' => 'suggestion',
            'summary' => 'Eine Idee',
            'description' => 'Eine dunklere Karte für die Nacht wäre schön.',
        ])->assertCreated();

        $receipt = $this->callsTo($member->email)[0] ?? null;
        $this->assertNotNull($receipt);
        $this->assertStringContainsString('Wir haben Ihre Anfrage erhalten', $receipt['subject']);
        $this->assertStringNotContainsString("We've received your request", $receipt['subject']);
    }

    public function test_the_receipt_never_carries_technical_details(): void
    {
        $member = $this->member();

        $this->apiPost('/v2/support/reports', [
            'summary' => 'Wallet will not load',
            'description' => 'The wallet page spins for ever when I open it.',
            'impact' => 'minor',
            'include_diagnostics' => true,
            'diagnostics' => ['console' => [['message' => 'diagnostic-sentinel-7c1']]],
        ])->assertCreated();

        $receipt = $this->callsTo($member->email)[0] ?? null;
        $this->assertNotNull($receipt);
        $this->assertStringNotContainsString('diagnostic-sentinel-7c1', $receipt['body']);
    }

    public function test_a_failed_receipt_never_fails_the_request(): void
    {
        $this->mailer->succeed = false;
        $this->member();

        $this->apiPost('/v2/support/reports', [
            'request_type' => 'account',
            'summary' => 'Cannot sign in',
            'description' => 'My password reset link says it has expired.',
        ])->assertCreated();
    }

    private function member(array $attributes = []): User
    {
        $member = User::factory()->forTenant($this->testTenantId)->create(array_merge([
            'email' => 'receipt-' . uniqid('', true) . '@example.test',
        ], $attributes));
        Sanctum::actingAs($member, ['*']);

        return $member;
    }

    /** @return list<array{to: string, subject: string, body: string, options: array}> */
    private function callsTo(string $email): array
    {
        return array_values(array_filter($this->mailer->calls, fn (array $c) => $c['to'] === $email));
    }
}

class SupportReportReceiptRecordingMailer extends EmailDispatchService
{
    public array $calls = [];
    public bool $succeed = true;

    public function send(string $to, string $subject, string $body, array $options = []): bool
    {
        $this->calls[] = compact('to', 'subject', 'body', 'options');

        return $this->succeed;
    }
}
