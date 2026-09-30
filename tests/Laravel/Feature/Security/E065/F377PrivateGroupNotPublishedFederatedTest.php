<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

declare(strict_types=1);

namespace Tests\Laravel\Feature\Security\E065;

use App\Models\User;
use Illuminate\Foundation\Testing\DatabaseTransactions;
use Illuminate\Support\Facades\Cache;
use Illuminate\Support\Facades\DB;
use Laravel\Sanctum\Sanctum;
use Tests\Laravel\Concerns\FederationIntegrationHarness;
use Tests\Laravel\Feature\Security\E065\Concerns\SeedsInternalFederation;
use Tests\Laravel\TestCase;

/**
 * F-377 (E-065 slice M, M-3) — a group its owner marked PRIVATE must not be
 * published to partner communities.
 *
 * `FederationV2Controller::groups()` excluded only `visibility <> 'secret'`,
 * so a private group's name, description, cover image and member count were
 * handed to every federation-opted-in member of every partnered community.
 * The F-190 fix had already made the sibling EVENTS query exclude anything
 * belonging to a group whose visibility is 'private' OR 'secret'; the group
 * listing itself was the residual gap. `GroupService::update()` lets
 * `visibility` and `federated_visibility` change independently, so a group
 * published while public and later made private stayed published.
 *
 * 🔴 Owner decision, 30 September 2026: **stop publishing private groups** —
 * groups follow the events rule, only public groups reach partner communities.
 *
 * Adapted from the E-065 reproduction
 * `.local-docs-archive/security-log/E-065/repro/m/FederatedTransferConcurrencyTest.php`
 * (`test_private_group_is_published_cross_community`), which FAILS while the
 * bug exists — "BAD OUTCOME:". That polarity is KEPT. Its three controls, which
 * isolate `visibility = 'private'` as the property under test, are kept too.
 *
 * 🔴 `groups.allow_federated_members` is deliberately left alone: E-065's O-098
 * established it has no writer anywhere in the product, so that arm of the OR
 * is dead today. The fix is a separate AND conjunct, so it would still hold if
 * a writer were ever added — `test_a_private_group_stays_unpublished_even_with_allow_federated_members`
 * pins that.
 */
final class F377PrivateGroupNotPublishedFederatedTest extends TestCase
{
    use DatabaseTransactions;
    use FederationIntegrationHarness;
    use SeedsInternalFederation;

    protected function setUp(): void
    {
        parent::setUp();
        $this->app['auth']->forgetGuards();
        Cache::flush();
    }

    private function makeGroup(
        int $tenantId,
        User $owner,
        string $name,
        string $visibility,
        string $federatedVisibility,
        int $allowFederatedMembers = 0
    ): int {
        return (int) DB::table('groups')->insertGetId([
            'tenant_id' => $tenantId,
            'owner_id' => (int) $owner->id,
            'name' => $name,
            'description' => 'E-066 F-377 fixture',
            'status' => 'active',
            'visibility' => $visibility,
            'federated_visibility' => $federatedVisibility,
            'allow_federated_members' => $allowFederatedMembers,
            'cached_member_count' => 7,
            'created_at' => now(),
            'updated_at' => now(),
        ]);
    }

    /** @return list<string> group names returned by GET /v2/federation/groups */
    private function listFederatedGroups(User $caller): array
    {
        Sanctum::actingAs($caller, ['*']);
        $rows = $this->apiGet('/v2/federation/groups?per_page=100')->assertOk()->json('data') ?? [];

        return array_map(static fn ($row): string => (string) ($row['name'] ?? ''), $rows);
    }

    public function test_a_private_group_is_not_published_to_a_partner_community(): void
    {
        $partner = $this->seedPartnerTenant('F377 Partner');
        $this->seedPartnership($partner);

        $caller = $this->seedFederatedUser($this->testTenantId);
        $owner = $this->seedFederatedUser($partner);

        $privateId = $this->makeGroup($partner, $owner, 'F377 Private Support Circle', 'private', 'listed');
        $secretId = $this->makeGroup($partner, $owner, 'F377 Secret Circle', 'secret', 'listed');
        $localOnlyId = $this->makeGroup($partner, $owner, 'F377 Local Only Circle', 'public', 'none');
        $publicId = $this->makeGroup($partner, $owner, 'F377 Public Circle', 'public', 'listed');

        $names = $this->listFederatedGroups($caller);

        // CONTROL — the two documented exclusions really do work, and a public
        // listed group really is published, so `visibility = 'private'` alone
        // is the property under test.
        $this->assertNotContains('F377 Secret Circle', $names, 'CONTROL: a secret group must not be published');
        $this->assertNotContains('F377 Local Only Circle', $names, "CONTROL: federated_visibility='none' must not be published");
        $this->assertContains('F377 Public Circle', $names, 'CONTROL: a public listed group IS published');

        $this->assertNotContains(
            'F377 Private Support Circle',
            $names,
            "group #{$privateId} has visibility='private' and must not be published to a partner community with its "
            . 'name, description and member count. Returned: ' . json_encode($names)
            . " (secret #{$secretId}, local-only #{$localOnlyId}, public #{$publicId} for comparison)",
        );
    }

    public function test_a_public_group_made_private_later_stops_being_published(): void
    {
        $partner = $this->seedPartnerTenant('F377b Partner');
        $this->seedPartnership($partner);

        $caller = $this->seedFederatedUser($this->testTenantId);
        $owner = $this->seedFederatedUser($partner);

        $groupId = $this->makeGroup($partner, $owner, 'F377 Switching Circle', 'public', 'listed');

        $this->assertContains(
            'F377 Switching Circle',
            $this->listFederatedGroups($caller),
            'CONTROL: it is published while public',
        );

        // GroupService::update() lets visibility change without touching
        // federated_visibility, which is how a published group becomes private.
        DB::table('groups')->where('id', $groupId)->update(['visibility' => 'private', 'updated_at' => now()]);

        $this->assertNotContains(
            'F377 Switching Circle',
            $this->listFederatedGroups($caller),
            'a group switched to private must stop being published cross-community',
        );
    }

    public function test_a_private_group_stays_unpublished_even_with_allow_federated_members(): void
    {
        $partner = $this->seedPartnerTenant('F377c Partner');
        $this->seedPartnership($partner);

        $caller = $this->seedFederatedUser($this->testTenantId);
        $owner = $this->seedFederatedUser($partner);

        // `allow_federated_members` has no writer in the product today (O-098);
        // this pins that the visibility rule would still hold if one arrived.
        $this->makeGroup($partner, $owner, 'F377 Private Joinable Circle', 'private', 'none', 1);
        $this->makeGroup($partner, $owner, 'F377 Public Joinable Circle', 'public', 'none', 1);

        $names = $this->listFederatedGroups($caller);

        $this->assertContains(
            'F377 Public Joinable Circle',
            $names,
            'CONTROL: allow_federated_members still publishes a PUBLIC group, so the arm is live in this fixture',
        );
        $this->assertNotContains(
            'F377 Private Joinable Circle',
            $names,
            'allow_federated_members must not bypass the private-group exclusion',
        );
    }
}
