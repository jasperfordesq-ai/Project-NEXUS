<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

declare(strict_types=1);

namespace Tests\Laravel\Feature\Security;

use App\Core\TenantContext;
use App\Models\User;
use App\Services\AI\AIServiceFactory;
use App\Services\CaringCommunity\CaregiverService;
use App\Services\CaringCommunity\CaringHourGiftService;
use App\Services\CaringCommunity\HourEstateService;
use App\Services\CaringCommunity\KissTreffenService;
use App\Services\CaringCommunity\MunicipalityFeedbackService;
use Illuminate\Foundation\Testing\DatabaseTransactions;
use Illuminate\Http\Testing\File as TestFile;
use Illuminate\Support\Facades\Cache;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Http;
use Laravel\Sanctum\Sanctum;
use RuntimeException;
use Tests\Laravel\TestCase;

/**
 * E-027 Low findings in the Caring Community module (F-134 .. F-140).
 *
 * Every finding has at least one attack assertion and one control assertion
 * showing the rightful member / coordinator path still works.
 */
final class CaringLowFindingsTest extends TestCase
{
    use DatabaseTransactions;

    protected function setUp(): void
    {
        parent::setUp();
        $this->setCaringCommunityFeature(true);
        TenantContext::setById($this->testTenantId);
    }

    protected function tearDown(): void
    {
        AIServiceFactory::clearCache();
        parent::tearDown();
    }

    // ─────────────────────────────────────────────────────────────────────
    // F-134 — KISS Treffen member views
    // ─────────────────────────────────────────────────────────────────────

    public function test_f134_member_list_and_show_hide_draft_events_and_coordinator_notes(): void
    {
        $svc = app(KissTreffenService::class);
        $organizer = $this->member();

        $activeEvent = $this->insertEvent($organizer->id, 'active');
        $draftEvent = $this->insertEvent($organizer->id, 'draft');
        $this->insertTreffen($activeEvent, 'Coordinator-only: chair is unwell');
        $this->insertTreffen($draftEvent, 'Coordinator-only: draft agenda');

        $rows = $svc->list($this->testTenantId, 100);
        $eventIds = array_map(static fn (array $r): int => $r['event_id'], $rows);

        // Attack: the draft meeting is not listed to members.
        $this->assertNotContains($draftEvent, $eventIds);
        // Control: the active meeting still is.
        $this->assertContains($activeEvent, $eventIds);

        foreach ($rows as $row) {
            $this->assertArrayNotHasKey('coordinator_notes', $row);
        }

        // Show endpoint: draft answers not-found; active detail has no notes.
        try {
            $svc->getByEventId($this->testTenantId, $draftEvent);
            $this->fail('A draft KISS Treffen must not be readable by members.');
        } catch (RuntimeException) {
            // expected
        }

        $detail = $svc->getByEventId($this->testTenantId, $activeEvent);
        $this->assertSame($activeEvent, $detail['event_id']);
        $this->assertArrayNotHasKey('coordinator_notes', $detail);
    }

    public function test_f134_member_show_endpoint_hides_draft_and_notes_but_admin_upsert_keeps_notes(): void
    {
        $organizer = $this->member();
        $draftEvent = $this->insertEvent($organizer->id, 'draft');
        $activeEvent = $this->insertEvent($organizer->id, 'active');
        $this->insertTreffen($draftEvent, 'secret draft note');
        $this->insertTreffen($activeEvent, 'secret active note');

        Sanctum::actingAs($this->member(), ['*']);
        $this->apiGet("/v2/caring-community/kiss-treffen/{$draftEvent}")->assertStatus(404);
        $shown = $this->apiGet("/v2/caring-community/kiss-treffen/{$activeEvent}");
        $shown->assertStatus(200);
        $this->assertStringNotContainsString('secret active note', (string) $shown->getContent());

        // Control: coordinators still read and write their notes.
        $admin = $this->admin();
        Sanctum::actingAs($admin, ['*']);
        $upsert = $this->apiPut("/v2/admin/caring-community/kiss-treffen/{$draftEvent}", [
            'treffen_type' => 'monthly_stamm',
            'coordinator_notes' => 'bring the voting cards',
        ]);
        $upsert->assertStatus(200);
        $upsert->assertJsonPath('data.coordinator_notes', 'bring the voting cards');
    }

    // ─────────────────────────────────────────────────────────────────────
    // F-135 — cover-care candidate suggestions
    // ─────────────────────────────────────────────────────────────────────

    public function test_f135_cover_candidates_respect_privacy_and_omit_location_and_verification(): void
    {
        $caregiver = $this->member();
        $caredFor = $this->member();

        $visible = $this->member([
            'trust_tier' => 5,
            'verification_status' => 'passed',
            'location' => '12 Private Lane',
            'skills' => 'companionship',
        ]);
        $optedOut = $this->member([
            'trust_tier' => 5,
            'privacy_search' => 0,
            'skills' => 'companionship',
        ]);
        $connectionsOnly = $this->member([
            'trust_tier' => 5,
            'privacy_profile' => 'connections',
            'skills' => 'companionship',
        ]);
        $connectedConnectionsOnly = $this->member([
            'trust_tier' => 5,
            'privacy_profile' => 'connections',
            'skills' => 'companionship',
        ]);
        DB::table('connections')->insert([
            'tenant_id' => $this->testTenantId,
            'requester_id' => $caregiver->id,
            'receiver_id' => $connectedConnectionsOnly->id,
            'status' => 'accepted',
            'created_at' => now(),
        ]);

        $coverId = $this->coverRequest($caregiver->id, $caredFor->id);

        $candidates = app(CaregiverService::class)
            ->suggestCoverCandidates($coverId, $caregiver->id, $this->testTenantId);
        $ids = array_column($candidates, 'id');

        $this->assertNotContains($optedOut->id, $ids, 'privacy_search=0 must not be suggested.');
        $this->assertNotContains($connectionsOnly->id, $ids, 'connections-only profile must not be suggested to a stranger.');

        // Controls: an ordinary member and a connected connections-only member remain.
        $this->assertContains($visible->id, $ids);
        $this->assertContains($connectedConnectionsOnly->id, $ids);

        foreach ($candidates as $candidate) {
            $this->assertArrayNotHasKey('location', $candidate);
            $this->assertArrayNotHasKey('verification_status', $candidate);
            // Kept for the UI chip and the caregiver's chosen threshold.
            $this->assertArrayHasKey('trust_tier', $candidate);
        }
    }

    // ─────────────────────────────────────────────────────────────────────
    // F-136 — hour-estate nomination
    // ─────────────────────────────────────────────────────────────────────

    public function test_f136_member_cannot_renominate_a_reported_or_settled_estate(): void
    {
        $svc = app(HourEstateService::class);
        $member = $this->member();
        $beneficiary = $this->member();
        $attackerBeneficiary = $this->member();

        $svc->nominate($this->testTenantId, $member->id, [
            'policy_action' => 'transfer_to_beneficiary',
            'beneficiary_user_id' => $beneficiary->id,
        ]);

        foreach (['reported', 'settled'] as $status) {
            DB::table('caring_hour_estates')
                ->where('tenant_id', $this->testTenantId)
                ->where('member_user_id', $member->id)
                ->update(['status' => $status]);

            try {
                $svc->nominate($this->testTenantId, $member->id, [
                    'policy_action' => 'transfer_to_beneficiary',
                    'beneficiary_user_id' => $attackerBeneficiary->id,
                ]);
                $this->fail("Nomination must be locked once the estate is {$status}.");
            } catch (RuntimeException) {
                // expected
            }

            $row = DB::table('caring_hour_estates')
                ->where('tenant_id', $this->testTenantId)
                ->where('member_user_id', $member->id)
                ->first();
            $this->assertSame($status, $row->status);
            $this->assertSame($beneficiary->id, (int) $row->beneficiary_user_id);
        }
    }

    public function test_f136_member_can_update_nominated_estate_and_never_sees_coordinator_notes(): void
    {
        $svc = app(HourEstateService::class);
        $member = $this->member();
        $first = $this->member();
        $second = $this->member();

        $svc->nominate($this->testTenantId, $member->id, [
            'policy_action' => 'transfer_to_beneficiary',
            'beneficiary_user_id' => $first->id,
        ]);
        DB::table('caring_hour_estates')
            ->where('tenant_id', $this->testTenantId)
            ->where('member_user_id', $member->id)
            ->update(['coordinator_notes' => 'coordinator-only remark']);

        // Control: while still nominated the member may change the beneficiary.
        $updated = $svc->nominate($this->testTenantId, $member->id, [
            'policy_action' => 'transfer_to_beneficiary',
            'beneficiary_user_id' => $second->id,
        ]);
        $this->assertSame($second->id, $updated['beneficiary_user_id']);
        $this->assertSame('nominated', $updated['status']);

        $mine = $svc->myEstate($this->testTenantId, $member->id);
        $this->assertArrayNotHasKey('coordinator_notes', $mine);
        $this->assertArrayNotHasKey('coordinator_notes', $updated);

        // Control: coordinators still see their notes.
        $adminRows = array_values(array_filter(
            $svc->listEstates($this->testTenantId),
            static fn (array $r): bool => $r['member_user_id'] === $member->id,
        ));
        $this->assertSame('coordinator-only remark', $adminRows[0]['coordinator_notes']);
    }

    // ─────────────────────────────────────────────────────────────────────
    // F-137 — caring "Markt" moderation
    // ─────────────────────────────────────────────────────────────────────

    public function test_f137_markt_hides_listings_awaiting_moderation(): void
    {
        $owner = $this->member();
        $pending = $this->insertListing($owner->id, 'F137 pending listing', 'pending_review');
        $rejected = $this->insertListing($owner->id, 'F137 rejected listing', 'rejected');
        $approved = $this->insertListing($owner->id, 'F137 approved listing', 'approved');
        $legacy = $this->insertListing($owner->id, 'F137 legacy listing', null);

        Sanctum::actingAs($this->member(), ['*']);
        $response = $this->apiGet('/v2/caring-community/markt?type=listings&per_page=50');
        $response->assertStatus(200);
        $ids = collect($response->json('data'))->where('source', 'listing')->pluck('id')->all();

        $this->assertNotContains($pending, $ids);
        $this->assertNotContains($rejected, $ids);
        $this->assertContains($approved, $ids);
        $this->assertContains($legacy, $ids);
    }

    // ─────────────────────────────────────────────────────────────────────
    // F-138 — voice help requests and the AI switches / budget
    // ─────────────────────────────────────────────────────────────────────

    public function test_f138_voice_help_does_not_call_providers_when_ai_is_disabled(): void
    {
        $this->fakeOpenAi();
        $this->setAiEnabled(false);
        $member = $this->member();
        Sanctum::actingAs($member, ['*']);

        $response = $this->postVoice();

        $response->assertStatus(403);
        Http::assertNothingSent();
    }

    public function test_f138_voice_help_does_not_call_providers_when_member_budget_is_spent(): void
    {
        $this->fakeOpenAi();
        $this->setAiEnabled(true);
        $member = $this->member();
        DB::table('ai_user_limits')->insert([
            'tenant_id' => $this->testTenantId,
            'user_id' => $member->id,
            'daily_limit' => 3,
            'monthly_limit' => 100,
            'daily_used' => 3,
            'monthly_used' => 3,
            'last_reset_daily' => now()->toDateString(),
            'last_reset_monthly' => now()->toDateString(),
            'created_at' => now(),
            'updated_at' => now(),
        ]);
        Sanctum::actingAs($member, ['*']);

        $response = $this->postVoice();

        $response->assertStatus(429);
        Http::assertNothingSent();
    }

    public function test_f138_voice_help_still_works_and_is_charged_when_ai_is_enabled(): void
    {
        $this->fakeOpenAi();
        $this->setAiEnabled(true);
        $member = $this->member();
        Sanctum::actingAs($member, ['*']);

        $response = $this->postVoice();

        $response->assertStatus(200);
        $response->assertJsonPath('data.suggested_category', 'transport');
        Http::assertSentCount(2);

        $used = (int) DB::table('ai_user_limits')
            ->where('tenant_id', $this->testTenantId)
            ->where('user_id', $member->id)
            ->value('daily_used');
        $this->assertSame(2, $used, 'Both the Whisper and the extraction call are charged.');
    }

    // ─────────────────────────────────────────────────────────────────────
    // F-139 — anonymous municipality feedback in admin views
    // ─────────────────────────────────────────────────────────────────────

    public function test_f139_admin_list_and_show_redact_submitter_of_anonymous_feedback(): void
    {
        $svc = app(MunicipalityFeedbackService::class);
        $submitter = $this->member();

        $anon = $svc->submit($this->testTenantId, $submitter->id, [
            'category' => 'issue_report',
            'subject' => 'F139 anonymous',
            'body' => 'Please keep me anonymous.',
            'is_anonymous' => true,
        ])['feedback'];
        $named = $svc->submit($this->testTenantId, $submitter->id, [
            'category' => 'idea',
            'subject' => 'F139 named',
            'body' => 'Happy to be named.',
            'is_anonymous' => false,
        ])['feedback'];

        $list = collect($svc->listForAdmin($this->testTenantId, null, null, null, 1, 200)['items'])->keyBy('id');
        $this->assertNull($list[$anon['id']]['submitter_user_id']);
        $this->assertNull($svc->show($this->testTenantId, $anon['id'], true)['submitter_user_id']);
        $triaged = $svc->triage($this->testTenantId, $anon['id'], ['status' => 'triaging'])['feedback'];
        $this->assertNull($triaged['submitter_user_id']);

        // Controls: named feedback still identifies its author to admins, and
        // the member still sees their own id on their own anonymous row.
        $this->assertSame($submitter->id, $list[$named['id']]['submitter_user_id']);
        $this->assertSame($submitter->id, $svc->show($this->testTenantId, $named['id'], true)['submitter_user_id']);
        $mine = collect($svc->listForMember($this->testTenantId, $submitter->id))->keyBy('id');
        $this->assertSame($submitter->id, $mine[$anon['id']]['submitter_user_id']);
    }

    // ─────────────────────────────────────────────────────────────────────
    // F-140 — ledger rows for hour gifts and estate settlement
    // ─────────────────────────────────────────────────────────────────────

    public function test_f140_hour_gift_lifecycle_writes_transactions_rows(): void
    {
        $svc = app(CaringHourGiftService::class);
        $sender = $this->member(['balance' => 20]);
        $recipient = $this->member(['balance' => 0]);

        // send → pending ledger row, accept → completed.
        $accepted = $svc->send($sender->id, $recipient->id, 3.0, 'for grandma');
        $row = $this->giftLedgerRow($accepted['gift_id']);
        $this->assertNotNull($row, 'Sending a gift must write a ledger row.');
        $this->assertSame('pending', $row->status);
        $this->assertSame($sender->id, (int) $row->sender_id);
        $this->assertSame($recipient->id, (int) $row->receiver_id);
        $this->assertEqualsWithDelta(3.0, (float) $row->amount, 0.001);

        $svc->accept($accepted['gift_id'], $recipient->id);
        $this->assertSame('completed', $this->giftLedgerRow($accepted['gift_id'])->status);

        // decline → cancelled
        $declined = $svc->send($sender->id, $recipient->id, 2.0, null);
        $svc->decline($declined['gift_id'], $recipient->id, 'no thanks');
        $this->assertSame('cancelled', $this->giftLedgerRow($declined['gift_id'])->status);

        // revert → cancelled
        $reverted = $svc->send($sender->id, $recipient->id, 1.0, null);
        $svc->revert($reverted['gift_id'], $sender->id);
        $this->assertSame('cancelled', $this->giftLedgerRow($reverted['gift_id'])->status);

        // Control: balances are exactly as before the fix — only the accepted gift moved.
        $this->assertEqualsWithDelta(17.0, (float) DB::table('users')->where('id', $sender->id)->value('balance'), 0.001);
        $this->assertEqualsWithDelta(3.0, (float) DB::table('users')->where('id', $recipient->id)->value('balance'), 0.001);

        // Control: the completed ledger now explains both balances' movement.
        $completedOut = (float) DB::table('transactions')
            ->where('tenant_id', $this->testTenantId)
            ->where('sender_id', $sender->id)
            ->where('status', 'completed')
            ->sum('amount');
        $this->assertEqualsWithDelta(3.0, $completedOut, 0.001);
    }

    public function test_f140_estate_settlement_writes_transactions_row(): void
    {
        $svc = app(HourEstateService::class);
        $member = $this->member(['balance' => 7.5]);
        $beneficiary = $this->member(['balance' => 1]);
        $admin = $this->admin();

        $svc->nominate($this->testTenantId, $member->id, [
            'policy_action' => 'transfer_to_beneficiary',
            'beneficiary_user_id' => $beneficiary->id,
        ]);
        $estateId = (int) DB::table('caring_hour_estates')
            ->where('tenant_id', $this->testTenantId)
            ->where('member_user_id', $member->id)
            ->value('id');

        $svc->reportDeceased($this->testTenantId, $estateId, $admin->id, null);
        $settled = $svc->settle($this->testTenantId, $estateId, $admin->id, null);
        $this->assertSame('settled', $settled['status']);

        $row = DB::table('transactions')
            ->where('tenant_id', $this->testTenantId)
            ->where('sender_id', $member->id)
            ->where('transaction_type', 'caring_hour_estate')
            ->first();
        $this->assertNotNull($row, 'Estate settlement must write a ledger row.');
        $this->assertSame($beneficiary->id, (int) $row->receiver_id);
        $this->assertSame('completed', $row->status);
        $this->assertSame($admin->id, (int) $row->acting_user_id);
        $this->assertEqualsWithDelta(7.5, (float) $row->amount, 0.001);

        // Control: balances moved exactly as before.
        $this->assertEqualsWithDelta(0.0, (float) DB::table('users')->where('id', $member->id)->value('balance'), 0.001);
        $this->assertEqualsWithDelta(8.5, (float) DB::table('users')->where('id', $beneficiary->id)->value('balance'), 0.001);
    }

    public function test_f140_donated_estate_settlement_writes_community_ledger_row(): void
    {
        $svc = app(HourEstateService::class);
        $member = $this->member(['balance' => 4]);
        $admin = $this->admin();

        $svc->nominate($this->testTenantId, $member->id, ['policy_action' => 'donate_to_solidarity']);
        $estateId = (int) DB::table('caring_hour_estates')
            ->where('tenant_id', $this->testTenantId)
            ->where('member_user_id', $member->id)
            ->value('id');
        $svc->reportDeceased($this->testTenantId, $estateId, $admin->id, null);
        $svc->settle($this->testTenantId, $estateId, $admin->id, null);

        $row = DB::table('transactions')
            ->where('tenant_id', $this->testTenantId)
            ->where('sender_id', $member->id)
            ->where('transaction_type', 'caring_hour_estate')
            ->first();
        $this->assertNotNull($row);
        $this->assertNull($row->receiver_id);
        $this->assertEqualsWithDelta(4.0, (float) $row->amount, 0.001);
    }

    // ─────────────────────────────────────────────────────────────────────
    // helpers
    // ─────────────────────────────────────────────────────────────────────

    private function setCaringCommunityFeature(bool $enabled): void
    {
        $tenant = DB::table('tenants')->where('id', $this->testTenantId)->first();
        $features = [];
        if ($tenant && ! empty($tenant->features)) {
            $decoded = is_string($tenant->features) ? json_decode($tenant->features, true) : $tenant->features;
            $features = is_array($decoded) ? $decoded : [];
        }
        $features['caring_community'] = $enabled;
        DB::table('tenants')->where('id', $this->testTenantId)->update(['features' => json_encode($features)]);
    }

    /** @param array<string, mixed> $overrides */
    private function member(array $overrides = []): User
    {
        return User::factory()->forTenant($this->testTenantId)->create(array_merge([
            'status' => 'active',
            'is_approved' => true,
            'onboarding_completed' => true,
            'avatar_url' => '/avatars/f13x.png',
            'bio' => 'Caring community member.',
            'privacy_search' => 1,
            'privacy_profile' => 'members',
            'trust_tier' => 0,
        ], $overrides));
    }

    private function admin(): User
    {
        return User::factory()->forTenant($this->testTenantId)->admin()->create([
            'status' => 'active',
            'is_approved' => true,
        ]);
    }

    private function insertEvent(int $organizerId, string $status): int
    {
        return (int) DB::table('events')->insertGetId([
            'tenant_id' => $this->testTenantId,
            'user_id' => $organizerId,
            'title' => 'F134 Treffen ' . uniqid(),
            'description' => 'Monthly Stamm',
            'start_time' => now()->addDays(3)->format('Y-m-d H:i:s'),
            'end_time' => now()->addDays(3)->addHours(2)->format('Y-m-d H:i:s'),
            'status' => $status,
            'created_at' => now()->format('Y-m-d H:i:s'),
        ]);
    }

    private function insertTreffen(int $eventId, string $notes): void
    {
        DB::table('caring_kiss_treffen')->insert([
            'tenant_id' => $this->testTenantId,
            'event_id' => $eventId,
            'treffen_type' => 'monthly_stamm',
            'members_only' => 1,
            'coordinator_notes' => $notes,
            'created_at' => now(),
            'updated_at' => now(),
        ]);
    }

    private function coverRequest(int $caregiverId, int $caredForId): int
    {
        DB::table('caring_caregiver_links')->insert([
            'tenant_id' => $this->testTenantId,
            'caregiver_id' => $caregiverId,
            'cared_for_id' => $caredForId,
            'relationship_type' => 'family',
            'is_primary' => true,
            'start_date' => now()->toDateString(),
            'status' => 'active',
            'created_at' => now(),
            'updated_at' => now(),
        ]);

        $created = app(CaregiverService::class)->createCoverRequest($caregiverId, $this->testTenantId, [
            'cared_for_id' => $caredForId,
            'title' => 'F135 holiday cover',
            'required_skills' => 'companionship',
            'starts_at' => now()->addYears(5)->format('Y-m-d 09:00:00'),
            'ends_at' => now()->addYears(5)->addDay()->format('Y-m-d 17:00:00'),
            'minimum_trust_tier' => 5,
        ]);

        return (int) $created['id'];
    }

    private function insertListing(int $ownerId, string $title, ?string $moderationStatus): int
    {
        return (int) DB::table('listings')->insertGetId([
            'tenant_id' => $this->testTenantId,
            'user_id' => $ownerId,
            'title' => $title,
            'description' => 'F137 listing',
            'type' => 'offer',
            'status' => 'active',
            'moderation_status' => $moderationStatus,
            // Future-dated so stale rows in the shared test database cannot
            // push these off the first page of the newest-first feed.
            'created_at' => now()->addDays(30),
            'updated_at' => now(),
        ]);
    }

    private function setAiEnabled(bool $enabled): void
    {
        DB::table('ai_settings')->updateOrInsert(
            ['tenant_id' => $this->testTenantId, 'setting_key' => 'ai_enabled'],
            ['setting_value' => $enabled ? '1' : '0', 'updated_at' => now()]
        );
        AIServiceFactory::clearCache();
    }

    private function fakeOpenAi(): void
    {
        config(['services.openai.api_key' => 'test-openai-key']);
        Cache::flush();
        Http::preventStrayRequests();
        Http::fake([
            'api.openai.com/v1/audio/transcriptions' => Http::response([
                'text' => 'I need a lift to the doctor ' . uniqid(),
                'language' => 'en',
            ]),
            'api.openai.com/v1/chat/completions' => Http::response([
                'choices' => [[
                    'message' => [
                        'tool_calls' => [[
                            'function' => [
                                'arguments' => json_encode([
                                    'category' => 'transport',
                                    'when' => null,
                                    'contact_preference' => 'phone',
                                ]),
                            ],
                        ]],
                    ],
                ]],
            ]),
        ]);
    }

    private function postVoice(): \Illuminate\Testing\TestResponse
    {
        return $this->call(
            'POST',
            '/api/v2/caring-community/request-help/voice',
            ['locale' => 'en'],
            [],
            ['audio' => TestFile::create('voice.webm', 1)->mimeType('audio/webm')],
            ['HTTP_ACCEPT' => 'application/json', 'HTTP_X_TENANT_ID' => (string) $this->testTenantId]
        );
    }

    private function giftLedgerRow(int $giftId): ?object
    {
        return DB::table('transactions')
            ->where('tenant_id', $this->testTenantId)
            ->where('transaction_type', 'caring_hour_gift')
            ->where('description', 'like', '[caring_hour_gift:' . $giftId . ']%')
            ->first();
    }
}
