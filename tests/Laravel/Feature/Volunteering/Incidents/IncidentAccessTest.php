<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

declare(strict_types=1);

namespace Tests\Laravel\Feature\Volunteering\Incidents;

use App\Services\Volunteering\IncidentAccess;
use Illuminate\Foundation\Testing\DatabaseTransactions;
use Tests\Laravel\TestCase;

/** Spec §3: one relation per viewer; being the subject always loses staff and organisation access. */
final class IncidentAccessTest extends TestCase
{
    use DatabaseTransactions;
    use IncidentFixtures;

    protected function setUp(): void
    {
        parent::setUp();
        $this->enableVolunteering();
    }

    public function test_relations_for_every_kind_of_person(): void
    {
        $owner = $this->user();
        $admin = $this->user();
        $lead = $this->user();
        $deputy = $this->user();
        $plain = $this->user();
        $reporter = $this->user();
        $broker = $this->user('broker');
        $orgId = $this->organisation($owner, 'INCACC Org', ['dlp_user_id' => $lead->id, 'deputy_dlp_user_id' => $deputy->id]);
        $this->orgMember($orgId, $admin, 'admin');
        $this->orgMember($orgId, $plain, 'member');
        $i = $this->incident($reporter, ['organization_id' => $orgId]);
        $t = $this->testTenantId;

        $this->assertTrue(IncidentAccess::staffCanSee($i, $t, (int) $broker->id));
        $this->assertFalse(IncidentAccess::staffCanSee($i, $t, (int) $owner->id));
        $this->assertTrue(IncidentAccess::reporterCanSee($i, (int) $reporter->id));
        $this->assertFalse(IncidentAccess::reporterCanSee($i, (int) $owner->id));
        $this->assertSame(IncidentAccess::ORG_CONTACT, IncidentAccess::orgRelation($i, $t, (int) $owner->id, $orgId));
        $this->assertSame(IncidentAccess::ORG_CONTACT, IncidentAccess::orgRelation($i, $t, (int) $admin->id, $orgId));
        $this->assertSame(IncidentAccess::ORG_LEAD, IncidentAccess::orgRelation($i, $t, (int) $lead->id, $orgId));
        $this->assertSame(IncidentAccess::ORG_LEAD, IncidentAccess::orgRelation($i, $t, (int) $deputy->id, $orgId));
        $this->assertSame(IncidentAccess::NONE, IncidentAccess::orgRelation($i, $t, (int) $plain->id, $orgId));
        $this->assertSame(IncidentAccess::NONE, IncidentAccess::orgRelation($i, $t, (int) $broker->id, $orgId));
    }

    public function test_about_them_loses_staff_and_organisation_access(): void
    {
        $owner = $this->user();
        $orgId = $this->organisation($owner, 'INCACC Org2');
        $brokerSubject = $this->user('broker');
        $i = $this->incident($this->user(), ['organization_id' => $orgId, 'subject_user_id' => $brokerSubject->id]);
        $this->assertFalse(IncidentAccess::staffCanSee($i, $this->testTenantId, (int) $brokerSubject->id));

        $j = $this->incident($this->user(), ['organization_id' => $orgId, 'involved_user_id' => $owner->id]);
        $this->assertSame(IncidentAccess::NONE, IncidentAccess::orgRelation($j, $this->testTenantId, (int) $owner->id, $orgId));
    }

    public function test_a_self_disclosing_reporter_keeps_the_reporter_view_only(): void
    {
        $broker = $this->user('broker');
        $i = $this->incident($broker, ['subject_user_id' => $broker->id]);
        $this->assertTrue(IncidentAccess::reporterCanSee($i, (int) $broker->id));
        $this->assertFalse(IncidentAccess::staffCanSee($i, $this->testTenantId, (int) $broker->id));
    }

    public function test_a_reporter_who_is_also_an_org_admin_sees_each_view_separately(): void
    {
        $owner = $this->user();
        $reporterAdmin = $this->user();
        $orgId = $this->organisation($owner, 'INCACC Org3');
        $this->orgMember($orgId, $reporterAdmin, 'admin');
        $i = $this->incident($reporterAdmin, ['organization_id' => $orgId]);
        $this->assertTrue(IncidentAccess::reporterCanSee($i, (int) $reporterAdmin->id));
        $this->assertSame(IncidentAccess::ORG_CONTACT, IncidentAccess::orgRelation($i, $this->testTenantId, (int) $reporterAdmin->id, $orgId));
    }

    public function test_an_incident_of_another_organisation_or_community_is_none(): void
    {
        $owner = $this->user();
        $orgA = $this->organisation($owner, 'INCACC A');
        $orgB = $this->organisation($this->user(), 'INCACC B');
        $i = $this->incident($this->user(), ['organization_id' => $orgB]);
        $this->assertSame(IncidentAccess::NONE, IncidentAccess::orgRelation($i, $this->testTenantId, (int) $owner->id, $orgA));
        $this->assertSame(IncidentAccess::NONE, IncidentAccess::orgRelation($i, $this->testTenantId, (int) $owner->id, $orgB));

        $otherTenantAdmin = $this->user('admin', 999);
        $this->assertFalse(IncidentAccess::staffCanSee($i, $this->testTenantId, (int) $otherTenantAdmin->id));
    }

    public function test_a_removed_or_pending_member_or_inactive_owner_is_not_a_contact(): void
    {
        $owner = $this->user();
        $orgId = $this->organisation($owner, 'INCACC Org4');
        $removed = $this->user();
        $pending = $this->user();
        $this->orgMember($orgId, $removed, 'admin', 'removed');
        $this->orgMember($orgId, $pending, 'admin', 'pending');
        $i = $this->incident($this->user(), ['organization_id' => $orgId]);
        $this->assertSame(IncidentAccess::NONE, IncidentAccess::orgRelation($i, $this->testTenantId, (int) $removed->id, $orgId));
        $this->assertSame(IncidentAccess::NONE, IncidentAccess::orgRelation($i, $this->testTenantId, (int) $pending->id, $orgId));

        \Illuminate\Support\Facades\DB::table('users')->where('id', $owner->id)->update(['status' => 'suspended']);
        $this->assertSame(IncidentAccess::NONE, IncidentAccess::orgRelation($i, $this->testTenantId, (int) $owner->id, $orgId));
    }

    public function test_contact_ids_cover_owner_admins_and_leads_once_each(): void
    {
        $owner = $this->user();
        $admin = $this->user();
        $lead = $this->user();
        $orgId = $this->organisation($owner, 'INCACC Org5', ['dlp_user_id' => $lead->id, 'deputy_dlp_user_id' => $owner->id]);
        $this->orgMember($orgId, $admin, 'admin');
        $this->orgMember($orgId, $owner, 'owner');

        $ids = IncidentAccess::organisationContactIds($this->testTenantId, $orgId);
        sort($ids);
        $expected = [(int) $owner->id, (int) $admin->id, (int) $lead->id];
        sort($expected);
        $this->assertSame($expected, $ids);
        $this->assertEqualsCanonicalizing([(int) $lead->id, (int) $owner->id], IncidentAccess::organisationLeadIds($this->testTenantId, $orgId));
    }
}
