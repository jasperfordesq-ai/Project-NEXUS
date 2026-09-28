<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

declare(strict_types=1);

namespace Tests\Laravel\Feature\Security\E055;

use App\Models\User;
use App\Services\LegalEnforcementService;
use Illuminate\Foundation\Testing\DatabaseTransactions;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Route;
use Laravel\Sanctum\Sanctum;
use Tests\Laravel\TestCase;

/**
 * E-055 F-259 — the cross-community credit transfer route and group-exchange
 * creation must carry the same member gates as the ordinary wallet transfer
 * (F-105): the wallet module, completed onboarding and current legal acceptance.
 */
final class F259CreditRouteGatesTest extends TestCase
{
    use DatabaseTransactions;

    private int $documentId;
    private int $versionId;

    protected function setUp(): void
    {
        parent::setUp();

        config(['legal.enforcement_mode' => 'write']);

        $this->documentId = (int) DB::table('legal_documents')->insertGetId([
            'tenant_id' => $this->testTenantId,
            'document_type' => 'terms',
            'title' => 'F259 Terms',
            'slug' => 'f259-terms',
            'requires_acceptance' => 1,
            'acceptance_required_for' => 'login',
            'notify_on_update' => 1,
            'is_active' => 1,
        ]);
        $this->versionId = (int) DB::table('legal_document_versions')->insertGetId([
            'document_id' => $this->documentId,
            'version_number' => '9.0',
            'content' => '<p>F259</p>',
            'content_plain' => 'F259',
            'effective_date' => '2026-01-01',
            'is_draft' => 0,
            'is_current' => 1,
            'published_at' => now(),
        ]);
        DB::table('legal_documents')->where('id', $this->documentId)
            ->update(['current_version_id' => $this->versionId]);
        LegalEnforcementService::bumpRevision($this->testTenantId);

        DB::table('tenant_settings')->updateOrInsert(
            ['tenant_id' => $this->testTenantId, 'setting_key' => 'onboarding.mandatory'],
            ['setting_value' => '1']
        );
        \Illuminate\Support\Facades\Cache::flush();
    }

    private function member(bool $onboarded, bool $accepted): User
    {
        $user = User::factory()->forTenant($this->testTenantId)->create([
            'status' => 'active',
            'is_approved' => true,
            'onboarding_completed' => $onboarded ? 1 : 0,
            'balance' => 5,
        ]);
        if ($accepted) {
            DB::table('user_legal_acceptances')->insert([
                'user_id' => $user->id,
                'document_id' => $this->documentId,
                'version_id' => $this->versionId,
                'version_number' => '9.0',
                'acceptance_method' => 'login_prompt',
                'accepted_at' => now(),
            ]);
        }
        LegalEnforcementService::forgetVerdict((int) $user->id, $this->testTenantId);
        Sanctum::actingAs($user, ['*']);

        return $user;
    }

    private function errorCode($response): ?string
    {
        return $response->json('errors.0.code');
    }

    public function test_federation_transfer_requires_onboarding(): void
    {
        $this->member(onboarded: false, accepted: true);
        $response = $this->apiPost('/v2/federation/transactions', []);

        $response->assertStatus(403);
        $this->assertSame('ONBOARDING_REQUIRED', $this->errorCode($response));
    }

    public function test_federation_transfer_requires_current_legal_acceptance(): void
    {
        $this->member(onboarded: true, accepted: false);
        $response = $this->apiPost('/v2/federation/transactions', []);

        $response->assertStatus(403);
        $this->assertSame('LEGAL_ACCEPTANCE_REQUIRED', $this->errorCode($response));
    }

    public function test_group_exchange_creation_requires_current_legal_acceptance(): void
    {
        $this->member(onboarded: true, accepted: false);
        $response = $this->apiPost('/v2/group-exchanges', []);

        $response->assertStatus(403);
        $this->assertSame('LEGAL_ACCEPTANCE_REQUIRED', $this->errorCode($response));
    }

    public function test_control_settled_member_passes_the_gates(): void
    {
        $this->member(onboarded: true, accepted: true);

        foreach (['/v2/federation/transactions', '/v2/group-exchanges'] as $uri) {
            $code = $this->errorCode($this->apiPost($uri, []));
            $this->assertNotContains(
                $code,
                ['ONBOARDING_REQUIRED', 'LEGAL_ACCEPTANCE_REQUIRED', 'MODULE_DISABLED'],
                "A settled member must reach the {$uri} handler."
            );
        }
    }

    public function test_federation_transfer_route_carries_the_wallet_module_gate(): void
    {
        $route = collect(Route::getRoutes()->getRoutes())->first(
            fn ($r) => $r->uri() === 'api/v2/federation/transactions' && in_array('POST', $r->methods(), true)
        );

        $this->assertNotNull($route, 'Route fixture: POST /api/v2/federation/transactions must exist.');
        $middleware = $route->gatherMiddleware();
        foreach (['module:wallet', 'onboarding-required', 'legal-acceptance'] as $gate) {
            $this->assertContains($gate, $middleware, "POST /v2/federation/transactions must carry {$gate}.");
        }
    }
}
