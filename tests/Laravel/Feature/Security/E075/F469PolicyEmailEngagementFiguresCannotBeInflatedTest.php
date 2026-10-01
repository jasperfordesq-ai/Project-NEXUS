<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

namespace Tests\Laravel\Feature\Security\E075;

use App\Models\User;
use App\Services\LegalDocumentService;
use App\Services\LegalPublicationDeliveryService;
use Illuminate\Foundation\Testing\DatabaseTransactions;
use Illuminate\Support\Facades\DB;
use Laravel\Sanctum\Sanctum;
use Tests\Laravel\TestCase;

/**
 * E-075 F-469 — the policy-email open and click figures mean something.
 *
 * `LegalPublicationTrackingController` serves both tracking arms unauthenticated
 * (correctly: a tracking pixel in an email carries no session), and
 * `LegalPublicationDeliveryService::recordEvent()` appended one row per request
 * with no uniqueness test, no ceiling, and no check of the delivery's status.
 *
 * 🔴 The HMAC signature itself holds and this is NOT a signature bypass — an
 * invalid signature writes nothing, which is asserted below as a control. The
 * defect is that a VALIDLY signed link can be replayed without limit, and that
 * the resulting figures were presented to administrators as compliance evidence.
 *
 * Three separate wrongs, all from the same root cause:
 *
 *  1. Replay. Eight requests produced eight rows and the panel reported five
 *     opens and three clicks.
 *  2. Reads of an email that was never sent. `recordEvent()` never looked at the
 *     delivery's status, so the panel reported opens while `submitted` was 0 and
 *     every delivery was still `pending` — nothing had reached a mail transport.
 *  3. 🔴 Wrong with no attacker at all, and this is the half that matters in
 *     practice: mail-security gateways and webmail image proxies fetch the pixel
 *     the moment the message arrives. Those were recorded as human opens, so the
 *     `not_opened` filter — the list an administrator uses to chase members who
 *     have not read a new policy — under-reported who still needed chasing. That
 *     is the dangerous direction to be wrong in.
 *
 * These tests assert the CORRECT behaviour and therefore fail before the fix.
 * Controls in the same file: a real member opening a real email is still counted
 * and still leaves the chase list; a correctly signed click still reaches the
 * stored policy URL; and an invalid signature still writes nothing and still
 * discloses nothing.
 */
class F469PolicyEmailEngagementFiguresCannotBeInflatedTest extends TestCase
{
    use DatabaseTransactions;

    private User $member;

    private int $versionId = 0;

    private int $deliveryId = 0;

    protected function setUp(): void
    {
        parent::setUp();

        DB::table('legal_documents')->where('tenant_id', $this->testTenantId)
            ->where('document_type', 'acceptable_use')->delete();
        DB::table('legal_publication_deliveries')->where('tenant_id', $this->testTenantId)->delete();

        $this->member = User::factory()->forTenant($this->testTenantId)->admin()->create(['status' => 'active']);
        Sanctum::actingAs($this->member);

        $this->versionId = $this->draft();
        $this->assertTrue(LegalDocumentService::publishVersion($this->versionId));

        // Keep one recipient so the totals below are unambiguous.
        DB::table('legal_publication_deliveries')
            ->where('version_id', $this->versionId)
            ->where('user_id', '!=', $this->member->id)
            ->delete();

        $this->deliveryId = (int) DB::table('legal_publication_deliveries')
            ->where('version_id', $this->versionId)->value('id');
        $this->assertGreaterThan(0, $this->deliveryId);
    }

    // ------------------------------------------------------------------
    //  HARM 1 — a validly signed link cannot be replayed into a bigger number
    // ------------------------------------------------------------------

    public function test_replaying_one_tracking_link_cannot_inflate_the_figures(): void
    {
        $this->markAsDelivered(minutesAgo: 60);

        for ($i = 0; $i < 8; $i++) {
            $this->get($this->trackingPath('open'))->assertStatus(200);
        }
        for ($i = 0; $i < 3; $i++) {
            $this->get($this->trackingPath('click'))->assertRedirect();
        }

        $this->assertSame(
            1,
            $this->eventCount('open'),
            'F-469: however many times the pixel is fetched, one recipient has opened once.',
        );
        $this->assertSame(
            1,
            $this->eventCount('click'),
            'F-469: the same holds for the policy link.',
        );

        $totals = $this->totals();
        $this->assertSame(1, (int) $totals['total_opens'], 'F-469: the reported open total must not be forgeable.');
        $this->assertSame(1, (int) $totals['unique_opens']);
        $this->assertSame(1, (int) $totals['total_clicks'], 'F-469: nor the click total.');
        $this->assertSame(1, (int) $totals['unique_clicks']);

        $this->assertLessThanOrEqual(
            4,
            DB::table('legal_publication_events')->where('delivery_id', $this->deliveryId)->count(),
            'F-469: one delivery must contribute a bounded number of rows — nothing prunes this table.',
        );
    }

    // ------------------------------------------------------------------
    //  HARM 2 — an email nobody has sent cannot have been read
    // ------------------------------------------------------------------

    public function test_an_email_that_was_never_sent_records_no_reads(): void
    {
        // The delivery is left exactly as publication created it: pending.
        $this->assertSame(
            'pending',
            DB::table('legal_publication_deliveries')->where('id', $this->deliveryId)->value('status'),
        );

        $this->get($this->trackingPath('open'))->assertStatus(200);
        $this->get($this->trackingPath('click'))->assertRedirect();

        $totals = $this->totals();
        $this->assertSame(0, (int) $totals['submitted'], 'nothing has been handed to a mail transport');
        $this->assertSame(
            0,
            (int) $totals['total_opens'],
            'F-469: an email that has not been sent cannot have been read.',
        );
        $this->assertSame(0, (int) $totals['total_clicks']);

        $this->assertSame(
            1,
            $this->notOpenedCount(),
            'F-469: and the member must still appear on the list of people to chase.',
        );
    }

    // ------------------------------------------------------------------
    //  HARM 3 — a mail-gateway prefetch is not a person reading the policy
    // ------------------------------------------------------------------

    public function test_a_gateway_prefetch_is_not_counted_as_a_member_reading_the_policy(): void
    {
        // A mail-security gateway fetches the pixel as the message is delivered.
        $this->markAsDelivered(minutesAgo: 0);

        $this->get($this->trackingPath('open'))->assertStatus(200);

        $totals = $this->totals();
        $this->assertSame(
            0,
            (int) $totals['total_opens'],
            'F-469: an automated scan of the message is not a member reading it.',
        );
        $this->assertSame(0, (int) $totals['unique_opens']);

        $this->assertSame(
            1,
            $this->notOpenedCount(),
            'F-469: the chase list must still include a member whose mail was only scanned. '
            . 'Under-reporting who still needs chasing is the dangerous direction.',
        );
    }

    // ------------------------------------------------------------------
    //  O-175 — the links in the email reach a route at all
    // ------------------------------------------------------------------

    public function test_the_links_in_the_email_reach_the_tracking_routes(): void
    {
        $this->markAsDelivered(minutesAgo: 60);

        $expected = (string) DB::table('legal_publication_deliveries')
            ->where('id', $this->deliveryId)->value('review_url');

        $open = $this->get($this->trackingPath('open'));
        $this->assertSame(
            200,
            $open->getStatusCode(),
            'O-175: the tracking pixel address written into the email must reach the route.',
        );
        $this->assertSame('image/gif', $open->headers->get('Content-Type'));

        $this->get($this->trackingPath('click'))->assertRedirect($expected);
    }

    // ------------------------------------------------------------------
    //  CONTROLS
    // ------------------------------------------------------------------

    public function test_control_a_real_member_opening_a_real_email_is_still_counted(): void
    {
        $this->markAsDelivered(minutesAgo: 60);

        $this->get($this->trackingPath('open'))->assertStatus(200);

        $totals = $this->totals();
        $this->assertSame(1, (int) $totals['total_opens'], 'CONTROL: a genuine open still counts.');
        $this->assertSame(1, (int) $totals['unique_opens']);
        $this->assertSame(
            0,
            $this->notOpenedCount(),
            'CONTROL: and that member drops off the chase list, which is the point of the feature.',
        );
    }

    public function test_control_a_correctly_signed_click_still_reaches_the_stored_policy_url(): void
    {
        $this->markAsDelivered(minutesAgo: 60);

        $expected = (string) DB::table('legal_publication_deliveries')
            ->where('id', $this->deliveryId)->value('review_url');

        $this->get($this->trackingPath('click'))->assertRedirect($expected);

        $this->assertSame(1, (int) $this->totals()['total_clicks'], 'CONTROL: and it is recorded.');
    }

    public function test_control_an_invalid_signature_still_writes_nothing_and_discloses_nothing(): void
    {
        $this->markAsDelivered(minutesAgo: 60);

        $stored = (string) DB::table('legal_publication_deliveries')
            ->where('id', $this->deliveryId)->value('review_url');

        $this->get($this->trackingPath('open') . 'bad')->assertStatus(200);
        $click = $this->get($this->trackingPath('click') . 'bad');
        $click->assertRedirect();
        $this->assertNotSame(
            $stored,
            $click->headers->get('Location'),
            'CONTROL: a forged signature must not disclose the stored policy URL.',
        );

        $this->assertSame(
            0,
            DB::table('legal_publication_events')->where('delivery_id', $this->deliveryId)->count(),
            'CONTROL: the HMAC holds — a forged signature writes nothing. This finding is not a signature bypass.',
        );
    }

    // ------------------------------------------------------------------

    private function draft(): int
    {
        $doc = DB::table('legal_documents')->insertGetId([
            'tenant_id' => $this->testTenantId, 'document_type' => 'acceptable_use',
            'title' => 'Policy test', 'slug' => 'acceptable-use', 'is_active' => 1,
            'requires_acceptance' => 0, 'notify_on_update' => 0,
            'created_at' => now(), 'updated_at' => now(),
        ]);

        return DB::table('legal_document_versions')->insertGetId([
            'document_id' => $doc, 'version_number' => '2.0', 'content' => '<p>Policy</p>',
            'content_plain' => 'Policy', 'summary_of_changes' => 'Updated retention information.',
            'effective_date' => '2026-09-30', 'is_draft' => 1, 'is_current' => 0, 'created_at' => now(),
        ]);
    }

    private function markAsDelivered(int $minutesAgo): void
    {
        DB::table('legal_publication_deliveries')->where('id', $this->deliveryId)->update([
            'status' => 'sent',
            'sent_at' => now()->subMinutes($minutesAgo),
            'updated_at' => now(),
        ]);
    }

    /**
     * The path EXACTLY as the email carries it — no prefix added here.
     *
     * This helper used to prepend `/api`, with a note that `trackingUrl()` built
     * `config('app.url') . '/v2/legal-publication/…'` while routes/api.php sits
     * under a global `/api` prefix, so every address in the email was one segment
     * short of the live route: the "read the policy" button and the pixel both
     * 404'd. E-077 fixed `trackingUrl()` (O-175) and removed the prefix from this
     * helper, so these tests now follow the link a member would actually click.
     */
    private function trackingPath(string $event): string
    {
        return (string) parse_url(
            LegalPublicationDeliveryService::trackingUrl($this->deliveryId, $event),
            PHP_URL_PATH,
        );
    }

    private function eventCount(string $eventType): int
    {
        return DB::table('legal_publication_events')
            ->where('delivery_id', $this->deliveryId)
            ->where('event_type', $eventType)
            ->count();
    }

    /** @return array<string,mixed> */
    private function totals(): array
    {
        $engagement = LegalPublicationDeliveryService::engagement(
            $this->testTenantId,
            $this->versionId,
            1,
            '',
        );
        $this->assertNotNull($engagement);

        return (array) $engagement['totals'];
    }

    private function notOpenedCount(): int
    {
        $engagement = LegalPublicationDeliveryService::engagement(
            $this->testTenantId,
            $this->versionId,
            1,
            'not_opened',
        );
        $this->assertNotNull($engagement);

        return (int) $engagement['meta']['total'];
    }
}
