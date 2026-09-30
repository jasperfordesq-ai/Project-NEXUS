<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

declare(strict_types=1);

namespace Tests\Laravel\Feature\Gdpr;

use App\Models\User;
use App\Services\Enterprise\GdprService;
use Illuminate\Foundation\Testing\DatabaseTransactions;
use Illuminate\Support\Facades\DB;
use Tests\Laravel\TestCase;

class VettingAttestationGdprTest extends TestCase
{
    use DatabaseTransactions;

    public function test_export_returns_only_permitted_attestation_event_and_review_metadata(): void
    {
        $admin = User::factory()->forTenant($this->testTenantId)->admin()->create(['status' => 'active']);
        $member = User::factory()->forTenant($this->testTenantId)->create(['status' => 'active']);
        $now = now()->startOfSecond();

        $attestationId = DB::table('member_vetting_attestations')->insertGetId([
            'tenant_id' => $this->testTenantId,
            'user_id' => $member->id,
            'scheme_code' => 'dbs_england_wales',
            'attestation_code' => 'dbs_enhanced',
            'purpose_code' => 'safeguarded_member_contact',
            'scope_type' => 'tenant',
            'scope_identifier' => '',
            'decision' => 'confirmed',
            'confirmed_by' => $admin->id,
            'confirmed_at' => $now,
            'policy_version' => 'test-policy-v1',
            'created_at' => $now,
            'updated_at' => $now,
        ]);
        DB::table('member_vetting_attestation_events')->insert([
            'attestation_id' => $attestationId,
            'tenant_id' => $this->testTenantId,
            'user_id' => $member->id,
            'scheme_code' => 'dbs_england_wales',
            'attestation_code' => 'dbs_enhanced',
            'purpose_code' => 'safeguarded_member_contact',
            'scope_type' => 'tenant',
            'scope_identifier' => '',
            'event_type' => 'confirmed',
            'decision_before' => null,
            'decision_after' => 'confirmed',
            'reason_code' => null,
            'actor_user_id' => $admin->id,
            'policy_version' => 'test-policy-v1',
            'created_at' => $now,
        ]);
        DB::table('safeguarding_vetting_review_requests')->insert([
            'tenant_id' => $this->testTenantId,
            'user_id' => $member->id,
            'jurisdiction' => 'england_wales',
            'scheme_code' => 'dbs_england_wales',
            'attestation_code' => 'dbs_enhanced',
            'purpose_code' => 'safeguarded_member_contact',
            'scope_type' => 'tenant',
            'scope_identifier' => '',
            'policy_version' => 'test-policy-v1',
            'status' => 'completed',
            'request_source' => 'member_request',
            'requested_by' => $member->id,
            'requested_at' => $now,
            'handled_by' => $admin->id,
            'handled_at' => $now,
            'resolution_code' => 'confirmed',
            'created_at' => $now,
            'updated_at' => $now,
        ]);

        // A retired record may still exist during transition. It must not be
        // read into an Article 15 export.
        DB::table('vetting_records')->insert([
            'tenant_id' => $this->testTenantId,
            'user_id' => $member->id,
            'vetting_type' => 'dbs_enhanced',
            'status' => 'verified',
            'reference_number' => 'PROHIBITED-REFERENCE',
            'issue_date' => now()->subYear()->toDateString(),
            'expiry_date' => now()->addYear()->toDateString(),
            'verified_by' => $admin->id,
            'verified_at' => $now,
            'document_url' => '/uploads/tenants/hour-timebank/vetting/documents/prohibited.pdf',
            'notes' => 'PROHIBITED-NOTE',
            'works_with_children' => 1,
            'works_with_vulnerable_adults' => 1,
            'requires_enhanced_check' => 1,
            'created_at' => $now,
            'updated_at' => $now,
        ]);

        $service = new GdprService($this->testTenantId);
        $method = new \ReflectionMethod($service, 'getVettingAttestationData');
        $method->setAccessible(true);
        $data = $method->invoke($service, (int) $member->id);

        $this->assertSame(['attestations', 'events', 'review_requests'], array_keys($data));
        $this->assertCount(1, $data['attestations']);
        $this->assertCount(1, $data['events']);
        $this->assertCount(1, $data['review_requests']);
        $this->assertSame('dbs_enhanced', $data['attestations'][0]['attestation_code']);
        $this->assertSame('member_request', $data['review_requests'][0]['request_source']);

        $allKeys = $this->recursiveKeys($data);
        foreach ([
            'vetting_type', 'reference_number', 'issue_date', 'expiry_date',
            'document_url', 'notes', 'result', 'rejection_reason',
        ] as $prohibited) {
            $this->assertNotContains($prohibited, $allKeys);
        }
        $encoded = json_encode($data, JSON_THROW_ON_ERROR);
        $this->assertStringNotContainsString('PROHIBITED-REFERENCE', $encoded);
        $this->assertStringNotContainsString('PROHIBITED-NOTE', $encoded);
    }

    public function test_erasure_source_never_selects_legacy_evidence_fields(): void
    {
        $source = file_get_contents(app_path('Services/Enterprise/GdprService.php'));
        $this->assertIsString($source);
        $start = strpos($source, 'function executeAccountDeletion');
        $end = strpos($source, 'private function anonymizeMessages', $start ?: 0);
        $this->assertNotFalse($start);
        $deletion = substr($source, $start, $end !== false ? $end - $start : null);

        // F-339 (owner decision, 30 September 2026): the vetting decision, its
        // event trail and an open review are now held exactly as safeguarding
        // reports are — the erasure routine issues no DELETE against them.
        // These three assertions were the reverse until that decision.
        $this->assertStringNotContainsString('DELETE FROM safeguarding_vetting_review_requests', $deletion);
        $this->assertStringNotContainsString('DELETE FROM member_vetting_attestation_events', $deletion);
        $this->assertStringNotContainsString('DELETE FROM member_vetting_attestations', $deletion);

        // Certificate-bearing legacy rows are still minimised, and the routine
        // still must not read the evidence pointer it is about to drop.
        $this->assertStringContainsString('DELETE FROM vetting_records', $deletion);
        $this->assertStringNotContainsString('SELECT document_url FROM vetting_records', $deletion);
    }

    /** @return list<string> */
    private function recursiveKeys(array $value): array
    {
        $keys = [];
        foreach ($value as $key => $item) {
            if (is_string($key)) {
                $keys[] = $key;
            }
            if (is_array($item)) {
                array_push($keys, ...$this->recursiveKeys($item));
            }
        }

        return $keys;
    }
}
