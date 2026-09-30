<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

declare(strict_types=1);

namespace Tests\Laravel\Feature\Security\E065;

use Illuminate\Foundation\Testing\DatabaseTransactions;
use Tests\Laravel\Feature\Security\E065\Concerns\DrivesFederationPartnerApi;
use Tests\Laravel\TestCase;

/**
 * F-330 (E-065) — read-through-write on the Komunitin account resource.
 *
 * `PATCH /v2/federation/komunitin/{code}/accounts/{id}` looked the member up
 * with `id` + `tenant_id` + `status = active` and returned the full account
 * resource — balance in minor units, derived credit limit, account code — for
 * ANY active member. It skipped `discoverableFederatedAccountQuery()`, the
 * opt-in filter that the `GET` on the identical object applies, so a member's
 * federation opt-in, profile visibility and "appear in federated search"
 * choices were all bypassed by using the write verb as a read.
 *
 * Adapted from the E-065 slice-A reproduction
 * `.local-docs-archive/security-log/E-065/repro/slice-a/KomunitinNestedOwnershipTest.php`
 * (`test_patch_account_discloses_the_balance_of_a_member_who_never_opted_in`),
 * which PASSED while the bug existed. The attack assertion is inverted; the
 * opted-in control from the same reproduction is kept and extended to PATCH.
 */
class F330KomunitinAccountPatchOptInTest extends TestCase
{
    use DatabaseTransactions;
    use DrivesFederationPartnerApi;

    protected function setUp(): void
    {
        parent::setUp();
        $this->bootFederationPartner(['*'], 'f330');
    }

    protected function tearDown(): void
    {
        $this->tearDownFederationPartner();
        parent::tearDown();
    }

    public function test_patch_account_refuses_a_member_who_never_opted_in(): void
    {
        $code = $this->ownCurrencyCode();
        $optedOut = $this->makeMember(7.25);

        // The GET on the very same object already refuses — that is the
        // boundary the PATCH must now match.
        $this->json(
            'GET',
            "/api/v2/federation/komunitin/{$code}/accounts/{$optedOut->id}",
            [],
            $this->komunitinHeaders()
        )->assertStatus(404);

        $patch = $this->json(
            'PATCH',
            "/api/v2/federation/komunitin/{$code}/accounts/{$optedOut->id}",
            ['data' => ['type' => 'accounts', 'attributes' => []]],
            $this->komunitinHeaders()
        );

        $patch->assertStatus(404);
        $this->assertStringNotContainsString(
            '"balance"',
            (string) $patch->getContent(),
            'A non-federated member\'s time-credit balance must not reach a partner on any verb.'
        );
    }

    public function test_patch_account_still_works_for_a_member_who_opted_in(): void
    {
        $code = $this->ownCurrencyCode();
        $optedIn = $this->makeMember(1.00);
        $this->optIn((int) $optedIn->id);

        $this->json(
            'GET',
            "/api/v2/federation/komunitin/{$code}/accounts/{$optedIn->id}",
            [],
            $this->komunitinHeaders()
        )->assertStatus(200);

        $patch = $this->json(
            'PATCH',
            "/api/v2/federation/komunitin/{$code}/accounts/{$optedIn->id}",
            ['data' => ['type' => 'accounts', 'attributes' => []]],
            $this->komunitinHeaders()
        );

        $patch->assertStatus(200);
        $this->assertSame((string) $optedIn->id, $patch->json('data.id'));
        $this->assertSame(100, $patch->json('data.attributes.balance'));
    }

    public function test_patch_account_still_refuses_a_direct_balance_change(): void
    {
        $code = $this->ownCurrencyCode();
        $optedIn = $this->makeMember(1.00);
        $this->optIn((int) $optedIn->id);

        // A pre-existing control that must survive the fix: balance is
        // read-only on this endpoint and is managed by transfers.
        $this->json(
            'PATCH',
            "/api/v2/federation/komunitin/{$code}/accounts/{$optedIn->id}",
            ['data' => ['type' => 'accounts', 'attributes' => ['balance' => 99999]]],
            $this->komunitinHeaders()
        )->assertStatus(400);

        $this->assertSame(1.0, $this->balanceOf((int) $optedIn->id));
    }
}
