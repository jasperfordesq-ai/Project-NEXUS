<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

declare(strict_types=1);

namespace Tests\Laravel\Feature\Security\E067;

use App\Core\TenantContext;
use App\Enums\GroupStatus;
use App\Events\GroupCreated;
use App\Events\GroupMemberJoined;
use App\Events\GroupUpdated;
use App\Listeners\PushGroupMembershipToFederatedPartners;
use App\Listeners\PushGroupToFederatedPartners;
use App\Models\Group;
use App\Models\User;
use App\Services\FederationAuditService;
use App\Services\FederationExternalApiClient;
use App\Services\FederationFeatureService;
use Illuminate\Foundation\Testing\DatabaseTransactions;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Http;
use Illuminate\Support\Facades\Queue;
use Tests\Laravel\Concerns\FederationIntegrationHarness;
use Tests\Laravel\TestCase;

/**
 * F-386 (E-067) — the F-377 fix (4fb8191d2) made the internal cross-community
 * group listing publish only public groups, but the OUTBOUND pushes to external
 * partners were not touched. PushGroupToFederatedPartners and
 * PushGroupMembershipToFederatedPartners gated only on federated_visibility, so
 * a private or secret group left 'listed' was sent to every external partner
 * with allow_groups — name, description, owner — and every join to it was sent
 * with the member's id.
 *
 * Now a private or secret group is never published, a published group that
 * becomes private or secret is withdrawn (a 'deleted' action carrying no name
 * or description), and joins to it are not pushed. Behind the external
 * federation kill switch, opened here as E-065/E-067 did.
 *
 * Adapted from `.local-docs-archive/security-log/E-067/repro/a/A2PrivateGroupPushedToExternalPartnerTest.php`,
 * which asserted the pushes; the attack assertions are inverted.
 */
final class F386PrivateGroupNotPushedExternallyTest extends TestCase
{
    use DatabaseTransactions;
    use FederationIntegrationHarness;

    protected function setUp(): void
    {
        parent::setUp();
        Queue::fake();
        config(['app.key' => 'base64:HfQEDtbtr90JIXhsaAhSFWnzIo1f31VZ2e5qLqKKnls=']);
        app()->forgetInstance('encrypter');
    }

    public function test_private_and_secret_groups_are_not_published_and_are_withdrawn(): void
    {
        $tenantId = $this->prepareTenant();
        Http::fake(['*' => Http::response(['success' => true], 200)]);

        // Control: a public listed group is published.
        $this->listener()->handle(new GroupCreated($this->group(7001, 'public', $tenantId), $tenantId));
        // A private group is never published.
        $this->listener()->handle(new GroupCreated($this->group(7002, 'private', $tenantId), $tenantId));
        // A published group that becomes secret is withdrawn, without its details.
        $this->listener()->handle(new GroupUpdated($this->group(7003, 'secret', $tenantId), $tenantId));

        $pushed = $this->pushedById();

        $this->assertArrayHasKey(7001, $pushed, 'control: public group pushed');
        $this->assertSame('created', $pushed[7001]['action']);

        $this->assertArrayNotHasKey(7002, $pushed, 'a private group must not be published');

        $this->assertArrayHasKey(7003, $pushed, 'a group made secret is withdrawn from the partner');
        $this->assertSame('deleted', $pushed[7003]['action']);
        $this->assertNull($pushed[7003]['name'] ?? null);
        $this->assertNull($pushed[7003]['description'] ?? null);
        $this->assertStringNotContainsString('F386 private description', json_encode($pushed[7003]));
    }

    public function test_joining_a_secret_group_is_not_pushed_but_a_public_join_is(): void
    {
        $tenantId = $this->prepareTenant();
        Http::fake(['*' => Http::response(['success' => true], 200)]);

        $secretId = $this->storedGroup($tenantId, 'secret');
        $publicId = $this->storedGroup($tenantId, 'public');

        $listener = new PushGroupMembershipToFederatedPartners(new FederationFeatureService(new FederationAuditService()));
        $listener->handle(new GroupMemberJoined($secretId, 424242, $tenantId));
        $listener->handle(new GroupMemberJoined($publicId, 434343, $tenantId));

        $joins = [];
        foreach (Http::recorded() as [$request]) {
            $b = $request->data();
            if (isset($b['group_id'], $b['user_id'])) {
                $joins[] = [(int) $b['group_id'], (int) $b['user_id']];
            }
        }
        $this->assertNotContains([$secretId, 424242], $joins, 'membership of a secret group must not be pushed');
        $this->assertContains([$publicId, 434343], $joins, 'control: a public group join is pushed');
    }

    // ── fixtures ────────────────────────────────────────────────────────────

    /** @return array<int,array<string,mixed>> */
    private function pushedById(): array
    {
        $pushed = [];
        foreach (Http::recorded() as [$request]) {
            $body = $request->data();
            if (isset($body['id'])) {
                $pushed[(int) $body['id']] = $body;
            }
        }

        return $pushed;
    }

    private function prepareTenant(): int
    {
        $tenantId = (int) DB::table('tenants')->insertGetId([
            'name' => 'F386 push ' . bin2hex(random_bytes(3)),
            'slug' => 'f386-push-' . bin2hex(random_bytes(3)),
            'is_active' => 1,
            'depth' => 0,
            'allows_subtenants' => 0,
            'features' => json_encode(['federation' => true]),
            'created_at' => now(),
            'updated_at' => now(),
        ]);
        $this->enableFederationForTenant($tenantId);
        $this->setupPartner('nexus', $tenantId);
        FederationExternalApiClient::clearAdapterCache();
        app(FederationFeatureService::class)->clearCache();
        TenantContext::setById($tenantId);

        return $tenantId;
    }

    private function storedGroup(int $tenantId, string $visibility): int
    {
        $owner = User::factory()->forTenant($tenantId)->create();

        return (int) DB::table('groups')->insertGetId([
            'tenant_id' => $tenantId,
            'owner_id' => (int) $owner->id,
            'name' => 'F386 ' . $visibility . ' group',
            'description' => 'x',
            'visibility' => $visibility,
            'federated_visibility' => 'listed',
            'status' => 'active',
            'created_at' => now(),
            'updated_at' => now(),
        ]);
    }

    private function listener(): PushGroupToFederatedPartners
    {
        return new PushGroupToFederatedPartners(new FederationFeatureService(new FederationAuditService()));
    }

    private function group(int $id, string $visibility, int $tenantId): Group
    {
        $g = new Group();
        $g->id = $id;
        $g->name = 'F386 group ' . $id;
        $g->description = 'F386 private description ' . $id;
        $g->visibility = $visibility;
        $g->federated_visibility = 'listed';
        $g->owner_id = 1;
        $g->tenant_id = $tenantId;
        $g->status = GroupStatus::Active;
        $g->created_at = now();

        return $g;
    }
}
