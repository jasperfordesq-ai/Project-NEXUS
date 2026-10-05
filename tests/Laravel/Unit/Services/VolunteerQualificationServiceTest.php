<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

declare(strict_types=1);

namespace Tests\Laravel\Unit\Services;

use App\Core\TenantContext;
use App\Exceptions\VolunteerQualificationException;
use App\Models\User;
use App\Services\VolunteerQualificationService;
use Carbon\CarbonImmutable;
use Illuminate\Foundation\Testing\DatabaseTransactions;
use Illuminate\Support\Facades\Cache;
use Illuminate\Support\Facades\DB;
use Tests\Laravel\TestCase;

/**
 * VolunteerQualificationService — the rules behind the register, exercised
 * without HTTP: type lists per jurisdiction, the refused vetting aliases,
 * status transitions, linkage helpers, the reminder setting, and the
 * nightly pass against a fixed "today".
 */
class VolunteerQualificationServiceTest extends TestCase
{
    use DatabaseTransactions;

    private VolunteerQualificationService $service;

    protected function setUp(): void
    {
        parent::setUp();
        TenantContext::setById($this->testTenantId);
        Cache::forget('safeguarding_jurisdiction:' . $this->testTenantId);
        $this->service = app(VolunteerQualificationService::class);
    }

    private function user(array $overrides = []): User
    {
        // `@anonymized.local` is on the email dispatcher's unroutable list, so
        // the nightly pass exercises its email branch without a send attempt.
        return User::factory()->forTenant($this->testTenantId)->create(array_merge([
            'status' => 'active',
            'email' => 'qual-' . uniqid('', true) . '@anonymized.local',
        ], $overrides));
    }

    private function setJurisdiction(string $jurisdiction): void
    {
        DB::table('tenant_safeguarding_settings')->updateOrInsert(
            ['tenant_id' => $this->testTenantId],
            ['jurisdiction' => $jurisdiction, 'created_at' => now(), 'updated_at' => now()]
        );
        Cache::forget('safeguarding_jurisdiction:' . $this->testTenantId);
    }

    // ---- types -----------------------------------------------------------

    public function test_type_list_follows_the_safeguarding_jurisdiction(): void
    {
        $this->setJurisdiction('ireland');
        $ie = $this->service->typeCodesForTenant($this->testTenantId);
        $this->assertContains('children_first', $ie);
        $this->assertContains('first_aid_response', $ie);
        $this->assertNotContains('efaw', $ie);
        $this->assertNotContains('safeguarding_adults', $ie);

        $this->setJurisdiction('scotland');
        $uk = $this->service->typeCodesForTenant($this->testTenantId);
        $this->assertContains('efaw', $uk);
        $this->assertContains('faw', $uk);
        $this->assertContains('safeguarding_adults', $uk);
        $this->assertNotContains('children_first', $uk);

        $this->setJurisdiction('unconfigured');
        $all = $this->service->typeCodesForTenant($this->testTenantId);
        foreach (array_merge(VolunteerQualificationService::COMMON_TYPES, VolunteerQualificationService::IE_TYPES, VolunteerQualificationService::UK_TYPES) as $code) {
            $this->assertContains($code, $all);
        }
        $this->assertSame('other', end($all));

        $defs = $this->service->typesForTenant($this->testTenantId);
        $byCode = array_column($defs, null, 'code');
        $this->assertSame('qualifications.types.first_aid', $byCode['first_aid']['label_key']);
        $this->assertSame(3, $byCode['first_aid']['expiry_hint_years']);
        $this->assertSame(2, $byCode['first_aid_response']['expiry_hint_years']);
        $this->assertSame(1, $byCode['professional_registration']['expiry_hint_years']);
        $this->assertNull($byCode['driving_licence']['expiry_hint_years']);
        $this->assertNull($byCode['other']['expiry_hint_years']);
    }

    public function test_vetting_aliases_are_recognised_and_ordinary_types_are_not(): void
    {
        foreach (['garda_vetting', 'DBS', 'dbs_enhanced', 'pvg', 'pvg_scotland', 'access_ni', 'AccessNI', 'police_check', 'police_clearance', 'criminal_record_check', 'background_check'] as $type) {
            $this->assertTrue(VolunteerQualificationService::isVettingType($type), $type);
        }
        foreach (['first_aid', 'safeguarding_training', 'other', 'food_hygiene', ''] as $type) {
            $this->assertFalse(VolunteerQualificationService::isVettingType($type), $type);
        }
    }

    // ---- reminder setting --------------------------------------------------

    public function test_reminder_setting_defaults_to_thirty_days_and_reads_the_credential_expiry_row(): void
    {
        DB::table('vol_reminder_settings')->where('tenant_id', $this->testTenantId)->where('reminder_type', 'credential_expiry')->delete();
        $this->assertSame(['enabled' => true, 'email_enabled' => true, 'days' => 30], $this->service->reminderSetting($this->testTenantId));

        DB::table('vol_reminder_settings')->insert([
            'tenant_id' => $this->testTenantId,
            'reminder_type' => 'credential_expiry',
            'enabled' => 0,
            'email_enabled' => 0,
            'days_before_expiry' => 14,
            'created_at' => now(),
            'updated_at' => now(),
        ]);
        $this->assertSame(['enabled' => false, 'email_enabled' => false, 'days' => 14], $this->service->reminderSetting($this->testTenantId));
    }

    // ---- create / update rules ---------------------------------------------

    public function test_create_normalises_and_appends_a_recorded_event(): void
    {
        $user = $this->user();

        $q = $this->service->create($this->testTenantId, $user->id, [
            'qualification_type' => '  First_Aid ',
            'title' => '  ',
            'issuer' => ' Irish Red Cross ',
            'obtained_at' => '2026-01-10T00:00:00Z',
            'expires_at' => '2029-01-10',
        ]);

        $this->assertSame('first_aid', $q['qualification_type']);
        $this->assertNull($q['title']);
        $this->assertSame('Irish Red Cross', $q['issuer']);
        $this->assertSame('2026-01-10', $q['obtained_at']);
        $this->assertSame('2029-01-10', $q['expires_at']);
        $this->assertSame('recorded', $q['status']);
        $this->assertFalse($q['is_expiring']);
        $this->assertGreaterThan(30, $q['days_until_expiry']);
        $this->assertSame(['recorded'], DB::table('vol_qualification_events')->where('qualification_id', $q['id'])->pluck('event')->all());
    }

    public function test_create_refuses_bad_input_with_the_spec_codes(): void
    {
        $user = $this->user();
        $cases = [
            [['qualification_type' => 'garda_vetting'], 'VETTING_NOT_A_QUALIFICATION'],
            [['qualification_type' => 'unknown_thing'], 'UNSUPPORTED_QUALIFICATION_TYPE'],
            [['qualification_type' => 'other'], 'TITLE_REQUIRED_FOR_OTHER'],
            [['qualification_type' => 'first_aid', 'obtained_at' => '2026-02-01', 'expires_at' => '2026-01-01'], 'EXPIRY_BEFORE_OBTAINED'],
            [['qualification_type' => 'first_aid', 'expires_at' => '2026-13-45'], 'VALIDATION_ERROR'],
            [['qualification_type' => 'first_aid', 'notes' => str_repeat('x', 501)], 'VALIDATION_ERROR'],
            [[], 'VALIDATION_ERROR'],
        ];

        foreach ($cases as [$input, $code]) {
            try {
                $this->service->create($this->testTenantId, $user->id, $input);
                $this->fail('expected ' . $code);
            } catch (VolunteerQualificationException $e) {
                $this->assertSame($code, $e->errorCode(), json_encode($input));
                $this->assertSame(422, $e->status());
            }
        }
        $this->assertSame(0, DB::table('vol_qualifications')->where('tenant_id', $this->testTenantId)->where('user_id', $user->id)->count());
    }

    public function test_update_is_owner_scoped_and_clears_a_confirmation(): void
    {
        $owner = $this->user();
        $confirmer = $this->user();
        $q = $this->service->create($this->testTenantId, $owner->id, ['qualification_type' => 'food_hygiene', 'expires_at' => '2028-06-01']);
        $this->service->confirm($this->testTenantId, $confirmer->id, $q['id'], 'online_register', null);
        $this->assertSame('confirmed', $this->service->find($this->testTenantId, $q['id'])->status);

        try {
            $this->service->update($this->testTenantId, $confirmer->id, $q['id'], ['issuer' => 'x']);
            $this->fail('a non-owner must get 404');
        } catch (VolunteerQualificationException $e) {
            $this->assertSame(404, $e->status());
        }

        $updated = $this->service->update($this->testTenantId, $owner->id, $q['id'], ['expires_at' => '2028-07-01']);
        $this->assertSame('recorded', $updated['status']);
        $this->assertNull($updated['confirmed_by']);
        $this->assertSame(['recorded', 'confirmed', 'updated'], DB::table('vol_qualification_events')->where('qualification_id', $q['id'])->orderBy('id')->pluck('event')->all());
    }

    public function test_confirm_rules_self_withdrawn_expired(): void
    {
        $owner = $this->user();
        $staff = $this->user();
        $q = $this->service->create($this->testTenantId, $owner->id, ['qualification_type' => 'manual_handling']);

        try {
            $this->service->confirm($this->testTenantId, $owner->id, $q['id'], 'saw_original', null);
            $this->fail('self-confirmation must be refused');
        } catch (VolunteerQualificationException $e) {
            $this->assertSame('SELF_CONFIRMATION', $e->errorCode());
            $this->assertSame(403, $e->status());
        }

        DB::table('vol_qualifications')->where('id', $q['id'])->update(['status' => 'expired']);
        try {
            $this->service->confirm($this->testTenantId, $staff->id, $q['id'], 'saw_original', null);
            $this->fail('expired must be refused');
        } catch (VolunteerQualificationException $e) {
            $this->assertSame('EXPIRED', $e->errorCode());
            $this->assertSame(409, $e->status());
        }

        $this->service->withdraw($this->testTenantId, $owner->id, $q['id'], 'replaced');
        try {
            $this->service->confirm($this->testTenantId, $staff->id, $q['id'], 'saw_original', null);
            $this->fail('withdrawn must be refused');
        } catch (VolunteerQualificationException $e) {
            $this->assertSame('WITHDRAWN', $e->errorCode());
        }
    }

    // ---- linkage helpers --------------------------------------------------

    public function test_linkage_and_management_helpers_are_tenant_scoped(): void
    {
        $owner = $this->user();
        $admin = $this->user();
        $volunteer = $this->user();
        $orgId = (int) DB::table('vol_organizations')->insertGetId([
            'tenant_id' => $this->testTenantId, 'user_id' => $owner->id, 'name' => 'Org ' . uniqid(), 'slug' => 'org-' . uniqid(),
            'description' => 'd', 'status' => 'active', 'created_at' => now(),
        ]);
        DB::table('org_members')->insert([
            'tenant_id' => $this->testTenantId, 'organization_id' => $orgId, 'org_type' => 'volunteer', 'user_id' => $admin->id,
            'role' => 'admin', 'status' => 'active', 'created_at' => now(), 'updated_at' => now(),
        ]);
        $oppId = (int) DB::table('vol_opportunities')->insertGetId([
            'tenant_id' => $this->testTenantId, 'organization_id' => $orgId, 'title' => 't', 'description' => 'd', 'is_active' => 1, 'status' => 'open', 'created_at' => now(),
        ]);
        DB::table('vol_applications')->insert([
            'tenant_id' => $this->testTenantId, 'opportunity_id' => $oppId, 'user_id' => $volunteer->id, 'status' => 'pending', 'created_at' => now(), 'updated_at' => now(),
        ]);

        $this->assertTrue($this->service->canManageOrganization($this->testTenantId, $owner->id, $orgId));
        $this->assertTrue($this->service->canManageOrganization($this->testTenantId, $admin->id, $orgId));
        $this->assertFalse($this->service->canManageOrganization($this->testTenantId, $volunteer->id, $orgId));
        $this->assertFalse($this->service->canManageOrganization(999, $owner->id, $orgId));
        $this->assertSame([$orgId], $this->service->organizationsManagedBy($this->testTenantId, $admin->id));

        // Pending application: not linked yet.
        $this->assertFalse($this->service->isVolunteerLinkedToOrganization($this->testTenantId, $volunteer->id, $orgId));
        DB::table('vol_applications')->where('opportunity_id', $oppId)->update(['status' => 'approved']);
        $this->assertTrue($this->service->isVolunteerLinkedToOrganization($this->testTenantId, $volunteer->id, $orgId));
        $this->assertSame([$orgId], $this->service->organizationsLinkedToVolunteer($this->testTenantId, $volunteer->id));
        $this->assertSame([], $this->service->organizationsLinkedToVolunteer(999, $volunteer->id));

        $confirmerIds = array_map(static fn (object $u): int => (int) $u->id, $this->service->organizationConfirmers($this->testTenantId, $orgId));
        sort($confirmerIds);
        $expected = [$owner->id, $admin->id];
        sort($expected);
        $this->assertSame($expected, $confirmerIds);
    }

    // ---- nightly pass with a fixed "today" ----------------------------------

    public function test_run_expiry_uses_the_given_day_and_is_idempotent(): void
    {
        DB::table('vol_reminder_settings')->updateOrInsert(
            ['tenant_id' => $this->testTenantId, 'reminder_type' => 'credential_expiry'],
            ['enabled' => 1, 'email_enabled' => 0, 'days_before_expiry' => 30, 'created_at' => now(), 'updated_at' => now()]
        );
        $volunteer = $this->user();
        $today = CarbonImmutable::parse('2026-10-05');

        $past = $this->service->create($this->testTenantId, $volunteer->id, ['qualification_type' => 'first_aid', 'expires_at' => '2026-10-04']);
        $edge = $this->service->create($this->testTenantId, $volunteer->id, ['qualification_type' => 'food_hygiene', 'expires_at' => '2026-11-04']);
        $outside = $this->service->create($this->testTenantId, $volunteer->id, ['qualification_type' => 'manual_handling', 'expires_at' => '2026-11-05']);
        $noExpiry = $this->service->create($this->testTenantId, $volunteer->id, ['qualification_type' => 'driving_licence']);

        $first = $this->service->runExpiry($this->testTenantId, false, $today);
        $this->assertSame(['expired' => 1, 'expired_notices' => 1, 'reminders' => 1, 'org_digests' => 0, 'notifications_enabled' => true], $first);

        $this->assertSame('expired', $this->service->find($this->testTenantId, $past['id'])->status);
        $this->assertNotNull($this->service->find($this->testTenantId, $edge['id'])->expiry_reminder_sent_at);
        $this->assertNull($this->service->find($this->testTenantId, $outside['id'])->expiry_reminder_sent_at);
        $this->assertSame('recorded', $this->service->find($this->testTenantId, $noExpiry['id'])->status);

        $second = $this->service->runExpiry($this->testTenantId, false, $today);
        $this->assertSame(['expired' => 0, 'expired_notices' => 0, 'reminders' => 0, 'org_digests' => 0, 'notifications_enabled' => true], $second);

        // The day after the window edge moves, the next record becomes due exactly once.
        $third = $this->service->runExpiry($this->testTenantId, false, $today->addDay());
        $this->assertSame(1, $third['reminders']);
        $this->assertNotNull($this->service->find($this->testTenantId, $outside['id'])->expiry_reminder_sent_at);
    }

    public function test_run_expiry_dry_run_counts_without_writing(): void
    {
        $volunteer = $this->user();
        $today = CarbonImmutable::parse('2026-10-05');
        $past = $this->service->create($this->testTenantId, $volunteer->id, ['qualification_type' => 'first_aid', 'expires_at' => '2026-09-01']);

        $result = $this->service->runExpiry($this->testTenantId, true, $today);
        $this->assertSame(1, $result['expired']);
        $this->assertSame(1, $result['expired_notices']);
        $this->assertSame('recorded', $this->service->find($this->testTenantId, $past['id'])->status);
        $this->assertSame(['recorded'], DB::table('vol_qualification_events')->where('qualification_id', $past['id'])->pluck('event')->all());
    }
}
