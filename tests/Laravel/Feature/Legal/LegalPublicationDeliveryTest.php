<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

namespace Tests\Laravel\Feature\Legal;

use App\Core\Mailer;
use App\Core\TenantContext;
use App\Models\User;
use App\Services\EmailDispatchService;
use App\Services\LegalDocumentService;
use App\Services\LegalPublicationDeliveryService;
use Illuminate\Foundation\Testing\DatabaseTransactions;
use Illuminate\Support\Facades\DB;
use Laravel\Sanctum\Sanctum;
use Tests\Laravel\TestCase;

class LegalPublicationDeliveryTest extends TestCase
{
    use DatabaseTransactions;

    private function draft(string $summary = 'Updated privacy contact and retention information.'): int
    {
        $doc = DB::table('legal_documents')->insertGetId([
            'tenant_id' => $this->testTenantId, 'document_type' => 'acceptable_use',
            'title' => 'Policy test', 'slug' => 'acceptable-use', 'is_active' => 1,
            'requires_acceptance' => 0, 'notify_on_update' => 0, 'created_at' => now(), 'updated_at' => now(),
        ]);
        return DB::table('legal_document_versions')->insertGetId([
            'document_id' => $doc, 'version_number' => '2.0', 'content' => '<p>Policy</p>',
            'content_plain' => 'Policy', 'summary_of_changes' => $summary,
            'effective_date' => '2026-09-30', 'is_draft' => 1, 'is_current' => 0, 'created_at' => now(),
        ]);
    }

    protected function setUp(): void
    {
        parent::setUp();
        DB::table('legal_documents')->where('tenant_id', $this->testTenantId)->where('document_type', 'acceptable_use')->delete();
        // Isolate the worker from other fixtures and pending developer work.
        DB::table('legal_publication_deliveries')->delete();
    }

    public function test_publication_records_admins_and_members_independent_of_acceptance_and_opt_in(): void
    {
        $admin = User::factory()->forTenant($this->testTenantId)->admin()->create(['status' => 'active']);
        $member = User::factory()->forTenant($this->testTenantId)->create(['status' => 'active']);
        $deleted = User::factory()->forTenant($this->testTenantId)->create(['status' => 'active', 'deleted_at' => now()]);
        $version = $this->draft();
        $this->assertSame(0, LegalPublicationDeliveryService::record($version));
        $this->assertTrue(LegalDocumentService::publishVersion($version));
        foreach ([$admin, $member] as $user) {
            $this->assertDatabaseHas('legal_publication_deliveries', ['version_id' => $version, 'user_id' => $user->id, 'status' => 'pending']);
        }
        $this->assertDatabaseMissing('legal_publication_deliveries', ['version_id' => $version, 'user_id' => $deleted->id]);
        $this->assertSame(0, LegalPublicationDeliveryService::record($version));
        $this->assertFalse(LegalDocumentService::publishVersion($version));
    }

    public function test_service_refuses_a_blank_summary_without_publishing_or_queueing(): void
    {
        $version = $this->draft('');
        $this->assertFalse(LegalDocumentService::publishVersion($version));
        $this->assertDatabaseHas('legal_document_versions', ['id' => $version, 'is_draft' => 1]);
        $this->assertDatabaseMissing('legal_publication_deliveries', ['version_id' => $version]);
    }

    public function test_worker_renders_summary_link_and_does_not_resend(): void
    {
        $user = User::factory()->forTenant($this->testTenantId)->admin()->create(['status' => 'active', 'email' => 'policy-reader@example.org', 'preferred_language' => 'de']);
        app('translator')->addLines(['emails.policy_publication.subject' => 'DE :document'], 'de');
        DB::table('email_suppression')->insert(['email' => $user->email, 'reason' => 'unsubscribe', 'suppressed_at' => now(), 'created_at' => now(), 'updated_at' => now()]);
        $version = $this->draft('Changed <script>unsafe</script> contact details.');
        LegalDocumentService::publishVersion($version);
        DB::table('legal_publication_deliveries')->where('user_id', '!=', $user->id)->delete();
        $captured = [];
        $this->mock(EmailDispatchService::class, function ($mock) use (&$captured) {
            $mock->shouldReceive('send')->once()->andReturnUsing(function ($to, $subject, $html, $options) use (&$captured) {
                $captured = compact('to', 'subject', 'html', 'options');
                return true;
            });
        });
        $service = app(LegalPublicationDeliveryService::class);
        $service->processBatch();
        $service->processBatch();
        $this->assertSame($user->email, $captured['to']);
        $this->assertSame('DE Policy test', $captured['subject']);
        $this->assertStringContainsString('contact details.', $captured['html']);
        $this->assertStringNotContainsString('<script>', $captured['html']);
        $this->assertStringContainsString('/v2/legal-publication/click/', $captured['html']);
        $this->assertStringContainsString('/v2/legal-publication/open/', $captured['html']);
        $this->assertStringContainsString('/v2/legal-publication/click/', $captured['options']['textBody']);
        $this->assertSame('legal_document', $captured['options']['category']);
        $this->assertDatabaseHas('legal_publication_deliveries', ['version_id' => $version, 'user_id' => $user->id, 'status' => 'sent', 'attempts' => 1]);
    }

    public function test_transaction_rollback_does_not_leave_emails_to_send(): void
    {
        $version = $this->draft();
        DB::beginTransaction();
        LegalDocumentService::publishVersion($version);
        DB::rollBack();
        $this->assertDatabaseMissing('legal_publication_deliveries', ['version_id' => $version]);
    }

    public function test_a_later_version_has_its_own_delivery_and_cannot_be_queued_from_another_tenant(): void
    {
        $user = User::factory()->forTenant($this->testTenantId)->create(['status' => 'active']);
        $first = $this->draft();
        LegalDocumentService::publishVersion($first);
        $docId = DB::table('legal_document_versions')->where('id', $first)->value('document_id');
        $this->actingAs($user);
        $next = LegalDocumentService::createVersion($docId, [
            'version_number' => '3.0', 'content' => '<p>Updated</p>',
            'effective_date' => '2026-10-01', 'summary_of_changes' => 'New retention period.',
        ]);
        $this->assertTrue(LegalDocumentService::publishVersion($next));
        $this->assertSame(2, DB::table('legal_publication_deliveries')->where('user_id', $user->id)->count());
        TenantContext::setById(1);
        $this->assertSame(0, LegalPublicationDeliveryService::record($next));
        TenantContext::setById($this->testTenantId);
    }

    public function test_interrupted_submission_is_flagged_for_review_without_resending(): void
    {
        $user = User::factory()->forTenant($this->testTenantId)->create(['status' => 'active']);
        $version = $this->draft();
        LegalDocumentService::publishVersion($version);
        DB::table('legal_publication_deliveries')->where('user_id', '!=', $user->id)->delete();
        DB::table('legal_publication_deliveries')->update(['status' => 'sending', 'claimed_at' => now()->subMinutes(11)]);
        $this->mock(EmailDispatchService::class, fn ($mock) => $mock->shouldNotReceive('send'));
        app(LegalPublicationDeliveryService::class)->processBatch();
        $this->assertDatabaseHas('legal_publication_deliveries', ['version_id' => $version, 'status' => 'unknown']);
    }

    public function test_admin_email_overview_separates_submitted_delivered_and_other_tenants(): void
    {
        $admin = User::factory()->forTenant($this->testTenantId)->admin()->create(['status' => 'active']);
        Sanctum::actingAs($admin);
        $version = $this->draft();
        LegalDocumentService::publishVersion($version);
        DB::table('legal_publication_deliveries')->where('user_id', '!=', $admin->id)->delete();
        $deliveryId = DB::table('legal_publication_deliveries')->where('version_id', $version)->value('id');
        DB::table('legal_publication_deliveries')->where('id', $deliveryId)->update(['status' => 'sent']);
        DB::table('email_log')->insert([
            'tenant_id' => $this->testTenantId, 'recipient_email' => $admin->email,
            'idempotency_key' => 'legal-publication:' . $deliveryId,
            'category' => 'legal_document', 'status' => 'delivered', 'created_at' => now(),
        ]);
        DB::table('legal_documents')->where('id', DB::table('legal_document_versions')
            ->where('id', $version)->value('document_id'))->update(['title' => 'Renamed policy']);
        $response = $this->apiGet('/v2/admin/legal-documents/publication-emails');
        $response->assertStatus(200);
        $row = collect($response->json('data'))->firstWhere('version_id', $version);
        $this->assertNotNull($row);
        $this->assertSame('Policy test', $row['title']);
        $this->assertEquals(1, $row['recipients']);
        $this->assertEquals(1, $row['submitted']);
        $this->assertEquals(1, $row['delivered']);
        $this->assertEquals(0, $row['queued']);
        $stats = $this->apiGet("/v2/admin/legal-documents/versions/{$version}/email-stats");
        $stats->assertJsonPath('data.version.title', 'Policy test');
    }

    public function test_signed_open_and_click_record_recipient_activity_and_reject_tampering(): void
    {
        $admin = User::factory()->forTenant($this->testTenantId)->admin()->create(['status' => 'active']);
        Sanctum::actingAs($admin);
        $version = $this->draft();
        LegalDocumentService::publishVersion($version);
        DB::table('legal_publication_deliveries')->where('user_id', '!=', $admin->id)->delete();
        $deliveryId = DB::table('legal_publication_deliveries')->where('version_id', $version)->value('id');
        // F-469: only a sent email can be read, and not in the arrival window.
        DB::table('legal_publication_deliveries')->where('id', $deliveryId)
            ->update(['status' => 'sent', 'sent_at' => now()->subHour(), 'updated_at' => now()]);
        // O-175: the paths are used exactly as the email carries them.
        $openPath = parse_url(LegalPublicationDeliveryService::trackingUrl($deliveryId, 'open'), PHP_URL_PATH);
        $clickPath = parse_url(LegalPublicationDeliveryService::trackingUrl($deliveryId, 'click'), PHP_URL_PATH);
        $this->get($openPath)->assertStatus(200);
        $this->get($openPath)->assertStatus(200);
        $this->get($clickPath)->assertRedirect();
        $this->assertDatabaseHas('legal_publication_events', ['delivery_id' => $deliveryId, 'event_type' => 'open']);
        $this->assertDatabaseHas('legal_publication_events', ['delivery_id' => $deliveryId, 'event_type' => 'click']);
        $this->get($openPath . 'bad')->assertStatus(200);
        // F-469: a repeated open is the same reader, not a second one.
        $this->assertSame(2, DB::table('legal_publication_events')->where('delivery_id', $deliveryId)->count());

        $response = $this->apiGet("/v2/admin/legal-documents/versions/{$version}/email-stats?filter=opened");
        $response->assertStatus(200);
        $this->assertEquals(1, $response->json('data.totals.unique_opens'));
        $this->assertEquals(1, $response->json('data.totals.total_opens'));
        $this->assertEquals(1, $response->json('data.totals.unique_clicks'));
        $this->assertSame($admin->email, $response->json('data.recipients.0.email'));
        $overview = collect($this->apiGet('/v2/admin/legal-documents/publication-emails')->json('data'))
            ->firstWhere('version_id', $version);
        $this->assertEquals(1, $overview['unique_opens']);
        $this->assertEquals(1, $overview['unique_clicks']);
        $this->apiGet("/v2/admin/legal-documents/versions/{$version}/email-stats?filter=not_opened")
            ->assertJsonPath('data.meta.total', 0);
    }

    public function test_signed_tracking_works_without_a_login_but_admin_stats_do_not(): void
    {
        $recipient = User::factory()->forTenant($this->testTenantId)->create(['status' => 'active']);
        $version = $this->draft();
        LegalDocumentService::publishVersion($version);
        $deliveryId = DB::table('legal_publication_deliveries')->where('version_id', $version)
            ->where('user_id', $recipient->id)->value('id');
        $openPath = parse_url(LegalPublicationDeliveryService::trackingUrl($deliveryId, 'open'), PHP_URL_PATH);
        $clickPath = parse_url(LegalPublicationDeliveryService::trackingUrl($deliveryId, 'click'), PHP_URL_PATH);
        $this->get($openPath)->assertStatus(200);
        $this->get($clickPath)->assertRedirect();
        $this->apiGet("/v2/admin/legal-documents/versions/{$version}/email-stats")->assertStatus(401);
    }

    public function test_marketing_unsubscribe_does_not_override_service_mail_but_bounces_do(): void
    {
        $email = 'unsubscribed-policy@example.org';
        $row = ['email' => $email, 'reason' => 'unsubscribe', 'suppressed_at' => now(), 'created_at' => now(), 'updated_at' => now()];
        DB::table('email_suppression')->insert($row);
        $this->assertTrue(Mailer::isSuppressed($email));
        $this->assertFalse(Mailer::isSuppressed($email, 'legal_document'));
        DB::table('email_suppression')->insert(array_replace($row, ['reason' => 'bounce']));
        $this->assertTrue(Mailer::isSuppressed($email, 'legal_document'));
    }

    public function test_rejected_send_is_retried_and_not_reported_as_sent(): void
    {
        $user = User::factory()->forTenant($this->testTenantId)->create(['status' => 'active', 'email' => 'retry-policy@example.org']);
        $version = $this->draft();
        LegalDocumentService::publishVersion($version);
        DB::table('legal_publication_deliveries')->where('user_id', '!=', $user->id)->delete();
        $this->mock(EmailDispatchService::class, fn ($mock) => $mock->shouldReceive('send')->once()->andReturn(false));
        app(LegalPublicationDeliveryService::class)->processBatch();
        $this->assertDatabaseHas('legal_publication_deliveries', ['version_id' => $version, 'status' => 'retry', 'sent_at' => null]);
    }
}
