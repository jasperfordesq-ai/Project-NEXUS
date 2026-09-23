<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

declare(strict_types=1);

namespace Tests\Laravel\Feature\Security;

use App\Core\TenantContext;
use App\Services\CaringCommunity\LeadNurtureService;
use Illuminate\Foundation\Testing\DatabaseTransactions;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\RateLimiter;
use Tests\Laravel\TestCase;

/**
 * F-131 — the public lead-capture endpoint must not let an anonymous caller
 * destroy real leads (eviction or storage overflow), and must not reveal
 * whether an email is already on the list or what CRM stage it is at.
 */
class CaringLeadCaptureTest extends TestCase
{
    use DatabaseTransactions;

    private const URI = '/v2/caring-community/leads/capture';

    protected function setUp(): void
    {
        parent::setUp();

        $tenant = DB::table('tenants')->where('id', $this->testTenantId)->first();
        $features = [];
        if ($tenant && ! empty($tenant->features)) {
            $decoded = is_string($tenant->features) ? json_decode($tenant->features, true) : $tenant->features;
            $features = is_array($decoded) ? $decoded : [];
        }
        $features['caring_community'] = true;
        DB::table('tenants')->where('id', $this->testTenantId)->update(['features' => json_encode($features)]);
        TenantContext::setById($this->testTenantId);

        // Start from an empty lead list for this tenant (rolled back afterwards).
        DB::table('tenant_settings')
            ->where('tenant_id', $this->testTenantId)
            ->where('setting_key', LeadNurtureService::SETTING_KEY)
            ->delete();
    }

    private function payload(string $email, string $segment = 'resident'): array
    {
        return ['email' => $email, 'segment' => $segment, 'consent' => true, 'name' => 'Lead Person'];
    }

    /** @return array<string, mixed> */
    private function envelope(): array
    {
        $raw = DB::table('tenant_settings')
            ->where('tenant_id', $this->testTenantId)
            ->where('setting_key', LeadNurtureService::SETTING_KEY)
            ->value('setting_value');
        $decoded = is_string($raw) ? json_decode($raw, true) : null;
        $this->assertIsArray($decoded, 'lead envelope must remain valid JSON');

        return $decoded;
    }

    /** @param list<array<string, mixed>> $items */
    private function seedEnvelope(array $items): void
    {
        DB::table('tenant_settings')->insert([
            'tenant_id'     => $this->testTenantId,
            'setting_key'   => LeadNurtureService::SETTING_KEY,
            'setting_value' => json_encode(['items' => $items, 'updated_at' => now()->toIso8601String()], JSON_UNESCAPED_SLASHES),
            'setting_type'  => 'json',
            'category'      => 'caring_community',
        ]);
    }

    private function realLead(int $i): array
    {
        return [
            'id'           => sprintf('lead_real%011d', $i),
            'name'         => 'Real Lead ' . $i,
            'email'        => "real{$i}@example.test",
            'phone'        => null,
            'organisation' => 'Municipality of Somewhere ' . str_repeat('x', 40),
            'segment'      => 'municipality',
            'source'       => 'website',
            'locale'       => 'en',
            'interests'    => ['pilot'],
            'stage'        => 'qualified',
            'consent'      => true,
            'consent_at'   => '2026-01-01T10:00:00+00:00',
            'consent_ip'   => '192.0.2.1',
            'follow_up_at' => null,
            'last_contacted_at' => null,
            'notes'        => 'Board meeting next month',
            'created_at'   => '2026-01-01T10:00:00+00:00',
            'updated_at'   => '2026-01-01T10:00:00+00:00',
        ];
    }

    // ── Control ───────────────────────────────────────────────────────────────

    public function test_control_new_consented_lead_is_captured(): void
    {
        $response = $this->apiPost(self::URI, $this->payload('new.lead@example.test'));

        $response->assertStatus(200)->assertJsonPath('data.received', true);

        $items = $this->envelope()['items'];
        $this->assertCount(1, $items);
        $this->assertSame('new.lead@example.test', $items[0]['email']);
        $this->assertSame('captured', $items[0]['stage']);
        $this->assertNotEmpty($items[0]['consent_at']);
    }

    public function test_control_invalid_payload_still_gets_validation_errors(): void
    {
        $this->apiPost(self::URI, ['email' => 'not-an-email', 'consent' => true])->assertStatus(422);
        $this->apiPost(self::URI, ['email' => 'ok@example.test'])->assertStatus(422);
    }

    // ── Duplicate oracle ──────────────────────────────────────────────────────

    public function test_duplicate_email_gets_the_same_response_as_a_new_one_and_no_crm_data(): void
    {
        $this->seedEnvelope([$this->realLead(1)]);

        $new = $this->apiPost(self::URI, $this->payload('fresh@example.test'))->assertStatus(200);
        $dup = $this->apiPost(self::URI, $this->payload('REAL1@example.test'))->assertStatus(200);

        $this->assertSame($new->json(), $dup->json());

        $body = (string) $dup->getContent();
        $this->assertStringNotContainsString('qualified', $body);
        $this->assertStringNotContainsString('municipality', $body);
        $this->assertStringNotContainsString('lead_real', $body);
        $this->assertStringNotContainsString('duplicate', $body);

        $this->assertCount(2, $this->envelope()['items']);
    }

    // ── No eviction / no overflow wipe ────────────────────────────────────────

    public function test_capture_is_refused_when_the_list_is_full_and_no_lead_is_evicted(): void
    {
        $service = new class () extends LeadNurtureService {
            protected function maxContacts(): int
            {
                return 3;
            }
        };

        $this->seedEnvelope([$this->realLead(1), $this->realLead(2), $this->realLead(3)]);

        $result = $service->capture($this->testTenantId, $this->payload('flood@example.test'), '203.0.113.9');
        $this->assertArrayNotHasKey('contact', $result);
        $this->assertTrue((bool) ($result['unavailable'] ?? false));

        $emails = array_column($this->envelope()['items'], 'email');
        $this->assertSame(['real1@example.test', 'real2@example.test', 'real3@example.test'], $emails);

        // The public endpoint answers the same way for new and already-listed emails when full.
        $this->app->instance(LeadNurtureService::class, $service);
        $a = $this->apiPost(self::URI, $this->payload('another@example.test'))->assertStatus(503);
        $b = $this->apiPost(self::URI, $this->payload('real2@example.test'))->assertStatus(503);
        $this->assertSame($a->json(), $b->json());
    }

    public function test_flood_near_storage_limit_never_wipes_existing_leads(): void
    {
        // Fill the envelope close to the tenant_settings TEXT column limit.
        $items = [];
        $i = 0;
        do {
            $items[] = $this->realLead(++$i);
            $size = strlen((string) json_encode(['items' => $items, 'updated_at' => now()->toIso8601String()], JSON_UNESCAPED_SLASHES));
        } while ($size < 62000);
        array_pop($items);
        $this->seedEnvelope($items);
        $seeded = count($items);

        $service = new LeadNurtureService();
        for ($n = 0; $n < 25; $n++) {
            $service->capture($this->testTenantId, $this->payload("flood{$n}@example.test"), '203.0.113.9');
        }

        $stored = $this->envelope()['items'];
        $emails = array_column($stored, 'email');
        for ($k = 1; $k <= $seeded; $k++) {
            $this->assertContains("real{$k}@example.test", $emails);
        }
        $first = collect($stored)->firstWhere('email', 'real1@example.test');
        $this->assertSame('2026-01-01T10:00:00+00:00', $first['consent_at']);
    }

    // ── Tenant-wide rate limit ────────────────────────────────────────────────

    public function test_tenant_wide_capture_rate_limit_applies_across_ip_addresses(): void
    {
        $key = 'api:caring_lead_capture:tenant:' . $this->testTenantId;
        for ($n = 0; $n < 200; $n++) {
            RateLimiter::hit($key, 3600);
        }

        $this->withServerVariables(['REMOTE_ADDR' => '198.51.100.77'])
            ->apiPost(self::URI, $this->payload('late@example.test'))
            ->assertStatus(429);

        RateLimiter::clear($key);
        $this->withServerVariables(['REMOTE_ADDR' => '198.51.100.78'])
            ->apiPost(self::URI, $this->payload('ontime@example.test'))
            ->assertStatus(200);
    }
}
