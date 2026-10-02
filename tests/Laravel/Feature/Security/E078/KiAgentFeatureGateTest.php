<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

declare(strict_types=1);

namespace Tests\Laravel\Feature\Security\E078;

use App\Core\TenantContext;
use App\Models\User;
use Illuminate\Foundation\Testing\DatabaseTransactions;
use Illuminate\Support\Facades\DB;
use Laravel\Sanctum\Sanctum;
use Tests\Laravel\TestCase;

/**
 * F-531 (E-078): every KI-Agenten admin action needs BOTH switches —
 * `ai_agents` (the agent switch the admin page and AgentAdminController
 * follow) and `caring_community` (the module these agents work on).
 * Before the fix three actions checked only caring_community and seven,
 * including proposal approval, checked nothing.
 */
class KiAgentFeatureGateTest extends TestCase
{
    use DatabaseTransactions;

    /** @return array<string, array{string, string}> */
    public static function routes(): array
    {
        return [
            'config read'          => ['GET', '/v2/admin/ki-agents/config'],
            'config write'         => ['PUT', '/v2/admin/ki-agents/config'],
            'runs list'            => ['GET', '/v2/admin/ki-agents/runs'],
            'run read'             => ['GET', '/v2/admin/ki-agents/runs/999999999'],
            'trigger'              => ['POST', '/v2/admin/ki-agents/trigger'],
            'proposals list'       => ['GET', '/v2/admin/ki-agents/proposals'],
            'proposal approve'     => ['POST', '/v2/admin/ki-agents/proposals/999999999/approve'],
            'proposal reject'      => ['POST', '/v2/admin/ki-agents/proposals/999999999/reject'],
            'approve all eligible' => ['POST', '/v2/admin/ki-agents/proposals/approve-eligible'],
            'stats'                => ['GET', '/v2/admin/ki-agents/stats'],
        ];
    }

    /** @dataProvider routes */
    public function test_refused_when_ai_agents_is_off(string $method, string $uri): void
    {
        $this->setFeatures(['ai_agents' => false, 'caring_community' => true]);
        Sanctum::actingAs($this->admin());

        $this->send($method, $uri)->assertStatus(403);
    }

    /** @dataProvider routes */
    public function test_refused_when_caring_community_is_off(string $method, string $uri): void
    {
        $this->setFeatures(['ai_agents' => true, 'caring_community' => false]);
        Sanctum::actingAs($this->admin());

        $this->send($method, $uri)->assertStatus(403);
    }

    /** @dataProvider routes */
    public function test_control_not_refused_when_both_switches_are_on(string $method, string $uri): void
    {
        $this->setFeatures(['ai_agents' => true, 'caring_community' => true]);
        Sanctum::actingAs($this->admin());

        $status = $this->send($method, $uri)->getStatusCode();
        $this->assertNotSame(403, $status, "{$method} {$uri} refused with both switches on");
    }

    private function admin(): User
    {
        return User::factory()->forTenant($this->testTenantId)->admin()->create();
    }

    private function send(string $method, string $uri): \Illuminate\Testing\TestResponse
    {
        return match ($method) {
            'GET' => $this->apiGet($uri),
            'POST' => $this->apiPost($uri),
            'PUT' => $this->apiPut($uri),
        };
    }

    /** @param array<string, bool> $values */
    private function setFeatures(array $values): void
    {
        $row = DB::table('tenants')->where('id', $this->testTenantId)->first(['features']);
        $current = json_decode((string) ($row->features ?? '{}'), true) ?: [];
        DB::table('tenants')->where('id', $this->testTenantId)
            ->update(['features' => json_encode(array_merge($current, $values))]);
        TenantContext::setById($this->testTenantId);
    }
}
