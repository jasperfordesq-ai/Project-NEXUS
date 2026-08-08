<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

declare(strict_types=1);

namespace Tests\Laravel\Unit\Services\Enterprise;

use App\Models\User;
use App\Services\Enterprise\GdprService;
use Illuminate\Foundation\Testing\DatabaseTransactions;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Queue;
use Tests\Laravel\TestCase;

/**
 * GdprService — data-rights requests and consent, exercised against the real
 * database.
 *
 * 🔴 Until 2026-08-08 this class asserted only that GdprService could be
 * autoloaded and constructed. The companion class
 * {@see \Tests\Laravel\Unit\Services\GdprServiceTest} does cover these methods,
 * but through a mocked PDO: every `fetch()` returns whatever the test told it to,
 * so those tests pass whether or not the SQL is valid, whether or not the columns
 * exist, and whether or not the tenant scope is applied. That is precisely the
 * blind spot that let a whole service write to an imagined schema for four
 * months.
 *
 * These tests use the real connection instead. They are deliberately weighted
 * towards the two things a mock can never check:
 *   - the SQL actually runs against the committed schema, and
 *   - every read and write is confined to one tenant.
 */
class GdprServiceTest extends TestCase
{
    use DatabaseTransactions;

    private int $otherTenantId;

    protected function setUp(): void
    {
        parent::setUp();

        // createRequest() dispatches GdprActionOccurred, whose listener
        // (NotifyAdminOfGdprAction) is ShouldQueue — in production it runs on a
        // worker, not in the request. PHPUnit's sync queue would otherwise run
        // the whole admin fanout inline: the test tenant has 16 active admins and
        // one admin email takes ~4s here, so a single createRequest() cost 63
        // seconds. Faking the queue matches production behaviour, and the fanout
        // itself is covered by
        // {@see \Tests\Laravel\Feature\Gdpr\GdprAdminNotificationTest}.
        Queue::fake();

        $this->otherTenantId = (int) DB::table('tenants')->insertGetId([
            'name'       => 'GDPR Neighbour Community',
            'slug'       => 'gdpr-neighbour-' . substr(md5(uniqid('', true)), 0, 8),
            'parent_id'  => $this->testTenantId,
            'is_active'  => 1,
            'created_at' => now(),
            'updated_at' => now(),
        ]);
    }

    private function service(?int $tenantId = null): GdprService
    {
        return new GdprService($tenantId ?? $this->testTenantId);
    }

    private function member(?int $tenantId = null): User
    {
        return User::factory()
            ->forTenant($tenantId ?? $this->testTenantId)
            ->create(['status' => 'active', 'is_approved' => true]);
    }

    /** A platform-global consent type with a unique slug, so tests don't collide. */
    private function consentType(bool $required = false, string $version = '1.0'): string
    {
        $slug = 'gdprtest-' . substr(md5(uniqid('', true)), 0, 10);

        DB::table('consent_types')->insert([
            'slug'            => $slug,
            'name'            => 'GDPR Test Consent',
            'description'     => 'Created by GdprServiceTest',
            'category'        => 'general',
            'is_required'     => $required ? 1 : 0,
            'current_version' => $version,
            'current_text'    => 'Global consent text v' . $version,
            'is_active'       => 1,
            'created_at'      => now(),
            'updated_at'      => now(),
        ]);

        return $slug;
    }

    // ── Requests: creation ───────────────────────────────────────────────────

    public function test_creating_a_request_writes_a_real_pending_row_for_this_tenant(): void
    {
        $member = $this->member();

        $result = $this->service()->createRequest((int) $member->id, 'access');

        $row = DB::table('gdpr_requests')->where('id', $result['id'])->first();
        $this->assertNotNull($row, 'createRequest must persist a row');
        $this->assertSame($this->testTenantId, (int) $row->tenant_id);
        $this->assertSame((int) $member->id, (int) $row->user_id);
        $this->assertSame('access', $row->request_type);
        $this->assertSame('pending', $row->status);
        $this->assertSame('normal', $row->priority);
        $this->assertNotNull($row->requested_at);
    }

    /**
     * The verification token is what proves the requester controls the account.
     * 32 random bytes, hex-encoded — a short or predictable token would let one
     * member trigger another member's export.
     */
    public function test_the_verification_token_is_sixty_four_hex_characters_and_is_stored(): void
    {
        $member = $this->member();

        $result = $this->service()->createRequest((int) $member->id, 'portability');

        $this->assertMatchesRegularExpression('/^[0-9a-f]{64}$/', $result['verification_token']);
        $this->assertSame(
            $result['verification_token'],
            DB::table('gdpr_requests')->where('id', $result['id'])->value('verification_token'),
            'the token returned to the member must be the one stored'
        );
    }

    /** All six Article-15-to-21 request types must be accepted and stored. */
    public function test_every_valid_request_type_is_accepted(): void
    {
        foreach (['access', 'erasure', 'rectification', 'restriction', 'portability', 'objection'] as $type) {
            $member = $this->member();
            $result = $this->service()->createRequest((int) $member->id, $type);

            $this->assertSame(
                $type,
                DB::table('gdpr_requests')->where('id', $result['id'])->value('request_type'),
                "the {$type} request type must round-trip through the enum column"
            );
        }
    }

    public function test_an_unknown_request_type_is_rejected_before_any_write(): void
    {
        $member = $this->member();
        $before = DB::table('gdpr_requests')->count();

        try {
            $this->service()->createRequest((int) $member->id, 'delete_everything');
            $this->fail('an unknown request type must throw');
        } catch (\InvalidArgumentException $e) {
            $this->assertStringContainsString('delete_everything', $e->getMessage());
        }

        $this->assertSame($before, DB::table('gdpr_requests')->count(), 'nothing may be written');
    }

    // ── Requests: the duplicate guard ────────────────────────────────────────

    public function test_a_second_pending_request_of_the_same_type_is_refused(): void
    {
        $member = $this->member();
        $this->service()->createRequest((int) $member->id, 'erasure');

        $this->expectException(\RuntimeException::class);
        $this->expectExceptionMessage('already have a pending erasure request');

        $this->service()->createRequest((int) $member->id, 'erasure');
    }

    /** A pending erasure must not block an access request — different rights. */
    public function test_a_pending_request_does_not_block_a_different_type(): void
    {
        $member = $this->member();
        $this->service()->createRequest((int) $member->id, 'erasure');

        $second = $this->service()->createRequest((int) $member->id, 'access');

        $this->assertGreaterThan(0, $second['id']);
    }

    /**
     * The guard looks at pending/processing only. Once a request is completed the
     * member may exercise the same right again — GDPR gives no one-shot limit.
     */
    public function test_a_completed_request_does_not_block_a_new_one(): void
    {
        $member = $this->member();
        $first  = $this->service()->createRequest((int) $member->id, 'access');
        DB::table('gdpr_requests')->where('id', $first['id'])->update(['status' => 'completed']);

        $second = $this->service()->createRequest((int) $member->id, 'access');

        $this->assertNotSame($first['id'], $second['id']);
    }

    /**
     * 🔴 The duplicate guard is tenant-scoped. A member who belongs to two
     * communities has separate data in each, so a pending request in one must not
     * block the same right in the other.
     */
    public function test_the_duplicate_guard_does_not_leak_across_tenants(): void
    {
        $member = $this->member();
        $this->service()->createRequest((int) $member->id, 'access');

        $other = $this->service($this->otherTenantId)->createRequest((int) $member->id, 'access');

        $this->assertSame(
            $this->otherTenantId,
            (int) DB::table('gdpr_requests')->where('id', $other['id'])->value('tenant_id')
        );
    }

    // ── Requests: reads are tenant-confined ──────────────────────────────────

    /**
     * 🔴 A data-rights request names the member and carries their notes and
     * verification token. Reading one across a tenant boundary is a PII leak
     * between communities.
     */
    public function test_a_request_belonging_to_another_tenant_cannot_be_read(): void
    {
        $member  = $this->member();
        $created = $this->service($this->otherTenantId)->createRequest((int) $member->id, 'access');

        $this->assertNull(
            $this->service()->getRequest((int) $created['id']),
            "one tenant must not be able to read another tenant's request"
        );
        $this->assertNotNull(
            $this->service($this->otherTenantId)->getRequest((int) $created['id']),
            'the owning tenant must still be able to read it'
        );
    }

    public function test_a_members_request_list_contains_only_this_tenants_requests(): void
    {
        $member = $this->member();
        $mine   = $this->service()->createRequest((int) $member->id, 'access');
        $theirs = $this->service($this->otherTenantId)->createRequest((int) $member->id, 'access');

        $ids = array_map('intval', array_column($this->service()->getUserRequests((int) $member->id), 'id'));

        $this->assertContains((int) $mine['id'], $ids);
        $this->assertNotContains((int) $theirs['id'], $ids);
    }

    public function test_the_admin_pending_queue_contains_only_this_tenants_requests(): void
    {
        $member = $this->member();
        $mine   = $this->service()->createRequest((int) $member->id, 'access');
        $theirs = $this->service($this->otherTenantId)->createRequest((int) $member->id, 'access');

        $ids = array_map('intval', array_column($this->service()->getPendingRequests(200), 'id'));

        $this->assertContains((int) $mine['id'], $ids);
        $this->assertNotContains((int) $theirs['id'], $ids);
    }

    // ── Requests: processing ─────────────────────────────────────────────────

    public function test_processing_a_request_marks_it_processing_and_stamps_acknowledgement(): void
    {
        $member = $this->member();
        $admin  = User::factory()->forTenant($this->testTenantId)->admin()->create(['status' => 'active']);
        $created = $this->service()->createRequest((int) $member->id, 'access');

        $this->assertTrue($this->service()->processRequest((int) $created['id'], (int) $admin->id));

        $row = DB::table('gdpr_requests')->where('id', $created['id'])->first();
        $this->assertSame('processing', $row->status);
        $this->assertNotNull($row->acknowledged_at, 'the 30-day clock needs an acknowledgement timestamp');
    }

    /** Silently returning false is the documented contract for a missing row. */
    public function test_processing_an_unknown_request_returns_false(): void
    {
        $this->assertFalse($this->service()->processRequest(2147483600, 1));
    }

    /**
     * 🔴 An admin of one community must not be able to advance another
     * community's request — processRequest() reads through the tenant-scoped
     * getRequest(), and this pins that it stays that way.
     */
    public function test_an_admin_cannot_process_another_tenants_request(): void
    {
        $member  = $this->member();
        $created = $this->service($this->otherTenantId)->createRequest((int) $member->id, 'access');

        $this->assertFalse($this->service()->processRequest((int) $created['id'], 1));
        $this->assertSame(
            'pending',
            DB::table('gdpr_requests')->where('id', $created['id'])->value('status'),
            "the other tenant's request must be untouched"
        );
    }

    // ── Consent ──────────────────────────────────────────────────────────────

    public function test_recording_consent_stores_the_agreement_and_hashes_the_text_shown(): void
    {
        $member = $this->member();
        $slug   = $this->consentType();
        $text   = 'I agree to the terms shown on 8 August 2026.';

        $this->service()->recordConsent((int) $member->id, $slug, true, $text, '2.0');

        $row = DB::table('user_consents')
            ->where('user_id', $member->id)
            ->where('consent_type', $slug)
            ->first();

        $this->assertNotNull($row);
        $this->assertSame($this->testTenantId, (int) $row->tenant_id);
        $this->assertSame(1, (int) $row->consent_given);
        $this->assertSame('2.0', $row->consent_version);
        $this->assertNotNull($row->given_at);
        $this->assertNull($row->withdrawn_at);

        // The hash is the evidence of WHICH wording the member agreed to. Without
        // it, a later edit to the terms would be indistinguishable from the text
        // they actually saw.
        $this->assertSame(hash('sha256', $text), $row->consent_hash);
    }

    /**
     * A refusal is recorded as a row, not as an absence — the platform needs to
     * know the member was asked and said no, so it does not keep asking.
     *
     * Note the deliberate distinction from a withdrawal: `given_at` and
     * `withdrawn_at` both stay NULL here, because a consent that was never given
     * was never taken back. `withdrawn_at` is only stamped when an existing YES
     * is reversed ({@see test_withdrawing_consent_flips_the_answer_and_stamps_the_withdrawal}).
     */
    public function test_consent_can_be_recorded_as_refused(): void
    {
        $member = $this->member();
        $slug   = $this->consentType();

        $this->service()->recordConsent((int) $member->id, $slug, false, 'Optional analytics', '1.0');

        $this->assertFalse($this->service()->hasConsent((int) $member->id, $slug));

        $row = DB::table('user_consents')
            ->where('user_id', $member->id)
            ->where('consent_type', $slug)
            ->first();
        $this->assertNotNull($row, 'a refusal must still be recorded');
        $this->assertSame(0, (int) $row->consent_given);
        $this->assertNull($row->given_at, 'a refusal has no given_at');
        $this->assertNull($row->withdrawn_at, 'a first-time refusal is not a withdrawal');
    }

    public function test_withdrawing_consent_flips_the_answer_and_stamps_the_withdrawal(): void
    {
        $member = $this->member();
        $slug   = $this->consentType();
        $this->service()->recordConsent((int) $member->id, $slug, true, 'Marketing emails', '1.0');
        $this->assertTrue($this->service()->hasConsent((int) $member->id, $slug));

        $this->assertTrue($this->service()->withdrawConsent((int) $member->id, $slug));

        $this->assertFalse($this->service()->hasConsent((int) $member->id, $slug));
        $this->assertNotNull(
            DB::table('user_consents')->where('user_id', $member->id)->where('consent_type', $slug)->value('withdrawn_at')
        );
    }

    /** Nothing to withdraw is reported as false, not as a successful no-op. */
    public function test_withdrawing_a_consent_that_was_never_given_returns_false(): void
    {
        $member = $this->member();

        $this->assertFalse($this->service()->withdrawConsent((int) $member->id, $this->consentType()));
    }

    /**
     * 🔴 Consent is per community. Agreeing in one tenant must not be readable —
     * or withdrawable — as consent in another.
     */
    public function test_consent_given_in_one_tenant_is_not_visible_in_another(): void
    {
        $member = $this->member();
        $slug   = $this->consentType();

        $this->service()->recordConsent((int) $member->id, $slug, true, 'Marketing emails', '1.0');

        $this->assertTrue($this->service()->hasConsent((int) $member->id, $slug));
        $this->assertFalse(
            $this->service($this->otherTenantId)->hasConsent((int) $member->id, $slug),
            'consent must not carry across a tenant boundary'
        );
        $this->assertFalse(
            $this->service($this->otherTenantId)->withdrawConsent((int) $member->id, $slug),
            'another tenant has nothing to withdraw'
        );
        $this->assertTrue(
            $this->service()->hasConsent((int) $member->id, $slug),
            'and the original consent survives the attempt'
        );
    }

    public function test_the_consent_list_joins_the_type_metadata(): void
    {
        $member = $this->member();
        $slug   = $this->consentType(required: true);
        $this->service()->recordConsent((int) $member->id, $slug, true, 'Terms text', '1.0');

        $consents = $this->service()->getUserConsents((int) $member->id);
        $row = collect($consents)->firstWhere('consent_type_slug', $slug);

        $this->assertNotNull($row, 'the recorded consent must appear in the list');
        $this->assertSame('GDPR Test Consent', $row['name'], 'the consent_types join must resolve');
        $this->assertSame(1, (int) $row['is_required']);
    }

    // ── Consent versions: global type, per-tenant override ───────────────────

    /**
     * consent_types is PLATFORM-GLOBAL; a community customises it through
     * tenant_consent_overrides rather than by editing the shared row. With no
     * override, the global version is what applies.
     */
    public function test_without_an_override_the_global_consent_version_applies(): void
    {
        $slug = $this->consentType(version: '3.0');

        $effective = $this->service()->getEffectiveConsentVersion($slug);

        $this->assertNotNull($effective);
        $this->assertSame('3.0', $effective['current_version']);
        $this->assertSame('Global consent text v3.0', $effective['current_text']);
        $this->assertNull($effective['tenant_override_id'], 'no override should be joined');
    }

    /**
     * 🔴 An override belongs to exactly one community. If it bled across tenants,
     * one community's terms would be presented as another's.
     */
    public function test_a_tenant_override_applies_only_to_that_tenant(): void
    {
        $slug = $this->consentType(version: '1.0');

        $this->service()->setTenantConsentVersion($slug, '4.0', 'Our own local terms');

        $mine = $this->service()->getEffectiveConsentVersion($slug);
        $this->assertSame('4.0', $mine['current_version']);
        $this->assertSame('Our own local terms', $mine['current_text']);
        $this->assertNotNull($mine['tenant_override_id']);

        $theirs = $this->service($this->otherTenantId)->getEffectiveConsentVersion($slug);
        $this->assertSame('1.0', $theirs['current_version'], 'the neighbour still sees the global version');
        $this->assertSame('Global consent text v1.0', $theirs['current_text']);
    }

    /** Removing an override reverts the community to the global wording. */
    public function test_removing_an_override_reverts_to_the_global_version(): void
    {
        $slug = $this->consentType(version: '1.0');
        $this->service()->setTenantConsentVersion($slug, '4.0', 'Our own local terms');

        $this->assertTrue($this->service()->removeTenantConsentOverride($slug));

        $effective = $this->service()->getEffectiveConsentVersion($slug);
        $this->assertSame('1.0', $effective['current_version']);
        $this->assertNull($effective['tenant_override_id']);
        $this->assertSame([], $this->service()->getTenantConsentOverrides());
    }

    public function test_overriding_an_unknown_consent_type_is_refused(): void
    {
        $this->expectException(\InvalidArgumentException::class);
        $this->expectExceptionMessage('Invalid consent type: no-such-consent');

        $this->service()->setTenantConsentVersion('no-such-consent', '1.0');
    }

    /**
     * Re-consent is driven by the version the member accepted versus the version
     * that currently applies — including a tenant override. Bumping the
     * community's terms must put its members back in the re-consent state.
     */
    public function test_bumping_the_tenant_version_puts_a_member_back_into_re_consent(): void
    {
        $member = $this->member();
        $slug   = $this->consentType(required: true, version: '1.0');
        $this->service()->recordConsent((int) $member->id, $slug, true, 'Terms v1', '1.0');

        $this->assertTrue($this->service()->hasCurrentVersionConsent((int) $member->id, $slug));

        $this->service()->setTenantConsentVersion($slug, '2.0', 'Terms v2');

        $this->assertFalse(
            $this->service()->hasCurrentVersionConsent((int) $member->id, $slug),
            'an old acceptance must not satisfy the new tenant version'
        );
    }

    // ── Consent updates through the member-facing path ───────────────────────

    /**
     * A required consent is the legal basis for holding the account at all, so it
     * cannot be switched off in the settings screen — deleting the account is the
     * route out.
     */
    public function test_a_required_consent_cannot_be_withdrawn(): void
    {
        $member = $this->member();
        $slug   = $this->consentType(required: true);

        $this->expectException(\RuntimeException::class);
        $this->expectExceptionMessage('Cannot withdraw required consent');

        $this->service()->updateUserConsent((int) $member->id, $slug, false);
    }

    public function test_an_optional_consent_can_be_toggled_off_and_on(): void
    {
        $member = $this->member();
        $slug   = $this->consentType();

        $this->service()->updateUserConsent((int) $member->id, $slug, true);
        $this->assertTrue($this->service()->hasConsent((int) $member->id, $slug));

        $this->service()->updateUserConsent((int) $member->id, $slug, false);
        $this->assertFalse($this->service()->hasConsent((int) $member->id, $slug));

        $this->service()->updateUserConsent((int) $member->id, $slug, true);
        $this->assertTrue($this->service()->hasConsent((int) $member->id, $slug));
    }

    public function test_updating_an_unknown_consent_type_is_refused(): void
    {
        $member = $this->member();

        $this->expectException(\InvalidArgumentException::class);
        $this->expectExceptionMessage('Invalid consent type: no-such-consent');

        $this->service()->updateUserConsent((int) $member->id, 'no-such-consent', true);
    }

    // ── Audit + statistics ───────────────────────────────────────────────────

    /** Every request must be traceable — the audit row is written by the service. */
    public function test_creating_a_request_writes_an_audit_entry(): void
    {
        $member = $this->member();

        $created = $this->service()->createRequest((int) $member->id, 'erasure');

        $this->assertSame(
            1,
            DB::table('gdpr_audit_log')
                ->where('tenant_id', $this->testTenantId)
                ->where('user_id', $member->id)
                ->where('action', 'erasure_requested')
                ->where('entity_type', 'gdpr_request')
                ->where('entity_id', $created['id'])
                ->count()
        );
    }

    /**
     * The admin dashboard reads these counters. They must count this tenant only
     * — a cross-tenant count would show a community other people's workload and
     * an overdue figure it cannot act on.
     */
    public function test_statistics_count_this_tenant_only(): void
    {
        $member = $this->member();

        $before = $this->service()->getStatistics();
        $this->service($this->otherTenantId)->createRequest((int) $member->id, 'access');
        $afterNeighbour = $this->service()->getStatistics();

        $this->assertSame(
            (int) $before['pending_count'],
            (int) $afterNeighbour['pending_count'],
            "a neighbour's request must not appear in this tenant's pending count"
        );

        $this->service()->createRequest((int) $member->id, 'access');
        $afterOwn = $this->service()->getStatistics();

        $this->assertSame(
            (int) $before['pending_count'] + 1,
            (int) $afterOwn['pending_count'],
            "this tenant's own request must be counted"
        );

        foreach (['requests', 'pending_count', 'avg_processing_time', 'consents', 'active_breaches', 'overdue_count'] as $key) {
            $this->assertArrayHasKey($key, $afterOwn);
        }
    }
}
