<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

namespace Tests\Laravel\Unit\Listeners;

use App\Listeners\NotifyAdminOfNewRegistration;
use Illuminate\Foundation\Testing\DatabaseTransactions;
use Illuminate\Support\Facades\DB;
use Tests\Laravel\TestCase;

/**
 * Regression cover for NotifyAdminOfNewRegistration::recipientsFor().
 *
 * 🔴 Why this file exists separately from NotifyAdminOfNewRegistrationTest.
 * That suite asserts the fan-out (bell + email per recipient) and needs alias
 * mocks on Notification / EmailDispatchService / NotificationDispatcher. Those
 * alias mocks made it order-dependent, so its two fan-out tests are
 * quarantined with markTestSkipped() — which is exactly why the bug below
 * survived: the only tests that touched recipient selection never ran.
 *
 * This file asserts the recipient predicate ALONE against real rows. No alias
 * mocks, no event dispatch, nothing to be order-dependent about. Keep it that
 * way — if you find yourself needing a mock here, it belongs in the other file.
 *
 * The bug: recipients were selected on the `users.role` string only. The API
 * never writes `super_admin` / `god` / `tenant_admin` / `coordinator` to that
 * column — those are boolean flags, with `role` frequently left as 'member'.
 * So a coordinator holding authority via a flag got no email and no bell when
 * a member registered, and could only find pending members by going looking.
 */
class NotifyAdminOfNewRegistrationRecipientsTest extends TestCase
{
    use DatabaseTransactions;

    /**
     * Isolated tenant so pre-existing tenant-2 admin rows cannot pollute counts.
     *
     * The value here is a placeholder that setUp() replaces with a freshly
     * created tenant. It must still be INITIALISED, because the base TestCase
     * reads $this->testTenantId inside its own setUp() (to seed the default
     * tenant) — a typed property with no default throws "must not be accessed
     * before initialization" there, before our setUp() body ever runs.
     */
    protected int $testTenantId = 997;

    /** A different tenant, to prove the query stays tenant-scoped. */
    protected int $otherTenantId = 998;

    /**
     * Create both tenants rather than trusting fixture rows to exist.
     *
     * `users.tenant_id` is a foreign key to `tenants.id`, so seeding a user
     * against an id that is absent from nexus_test fails with a 1452
     * constraint violation. Note the base TestCase does attempt to seed
     * $testTenantId, but it does so with the shared test slug — which is UNIQUE
     * and already held by tenant 2 — so for any id other than 2 that insert
     * collides, and the base class swallows the exception. The tenant then
     * silently does not exist. Creating our own rows here sidesteps that
     * entirely; both inserts land inside the DatabaseTransactions rollback.
     */
    protected function setUp(): void
    {
        parent::setUp();

        $this->testTenantId  = $this->seedTenant();
        $this->otherTenantId = $this->seedTenant();
    }

    private function seedTenant(): int
    {
        return (int) DB::table('tenants')->insertGetId([
            'name'       => 'Registration Alert Test',
            'slug'       => 'reg-alert-' . uniqid('', true),
            'is_active'  => 1,
            'created_at' => now(),
            'updated_at' => now(),
        ]);
    }

    // -------------------------------------------------------------------------
    // The regression: authority held as a flag, not as a role string
    // -------------------------------------------------------------------------

    /**
     * @dataProvider adminFlagProvider
     */
    public function test_admin_identified_only_by_a_boolean_flag_is_notified(string $flag): void
    {
        $flagAdmin = $this->seedUser(['role' => 'member', $flag => 1]);

        $this->assertContains(
            $flagAdmin->id,
            $this->recipientIds(),
            "A user carrying admin authority via {$flag} (with role='member') must be notified of "
            . 'new registrations. Selecting on the role string alone silently drops them, which is '
            . 'the fault reported from a live community on 2026-08-12.'
        );
    }

    /** @return array<string, array{string}> */
    public static function adminFlagProvider(): array
    {
        return [
            'legacy is_admin'      => ['is_admin'],
            'is_super_admin'       => ['is_super_admin'],
            'is_tenant_super_admin' => ['is_tenant_super_admin'],
            'is_god'               => ['is_god'],
        ];
    }

    // -------------------------------------------------------------------------
    // Role strings still work — the fix must be additive
    // -------------------------------------------------------------------------

    /**
     * @dataProvider adminRoleProvider
     */
    public function test_admin_identified_by_role_string_is_still_notified(string $role): void
    {
        $roleAdmin = $this->seedUser(['role' => $role]);

        $this->assertContains(
            $roleAdmin->id,
            $this->recipientIds(),
            "Role '{$role}' must remain a notified recipient — the flag fix is additive, not a replacement."
        );
    }

    /** @return array<string, array{string}> */
    public static function adminRoleProvider(): array
    {
        return [
            'admin'        => ['admin'],
            'tenant_admin' => ['tenant_admin'],
            'super_admin'  => ['super_admin'],
            // Broker and coordinator are deliberately included here even though
            // AdminTier::allows() excludes them — they action the approval queue.
            'broker'       => ['broker'],
            'coordinator'  => ['coordinator'],
        ];
    }

    // -------------------------------------------------------------------------
    // Exclusions — widening the predicate must not spam ordinary members
    // -------------------------------------------------------------------------

    public function test_ordinary_member_is_not_notified(): void
    {
        $member = $this->seedUser(['role' => 'member']);

        $this->assertNotContains(
            $member->id,
            $this->recipientIds(),
            'A plain member with no admin role and no admin flag must never receive registration alerts.'
        );
    }

    public function test_inactive_admin_is_not_notified(): void
    {
        $suspended = $this->seedUser(['role' => 'member', 'is_admin' => 1, 'status' => 'suspended']);

        $this->assertNotContains(
            $suspended->id,
            $this->recipientIds(),
            'Only active accounts are notified; a suspended admin must not be emailed.'
        );
    }

    public function test_admin_in_another_tenant_is_not_notified(): void
    {
        $foreignAdmin = $this->seedUser(
            ['role' => 'admin', 'is_tenant_super_admin' => 1],
            $this->otherTenantId
        );

        $this->assertNotContains(
            $foreignAdmin->id,
            $this->recipientIds(),
            'Recipient selection must stay scoped to the registering member\'s tenant.'
        );
    }

    // -------------------------------------------------------------------------
    // Shape — the fan-out depends on these columns being present
    // -------------------------------------------------------------------------

    public function test_selected_columns_include_preferred_language(): void
    {
        $this->seedUser(['role' => 'admin']);

        $recipient = NotifyAdminOfNewRegistration::recipientsFor($this->testTenantId)->first();

        $this->assertNotNull($recipient, 'Expected the seeded admin to be returned.');
        // preferred_language is required by the LocaleContext wrap in handle():
        // without it every admin alert renders in the queue worker's locale
        // rather than the recipient's own.
        foreach (['id', 'email', 'first_name', 'name', 'preferred_language'] as $column) {
            $this->assertObjectHasProperty(
                $column,
                $recipient,
                "recipientsFor() must select '{$column}' — handle() reads it during fan-out."
            );
        }
    }

    // -------------------------------------------------------------------------
    // Helpers
    // -------------------------------------------------------------------------

    /** @return list<int> */
    private function recipientIds(): array
    {
        return NotifyAdminOfNewRegistration::recipientsFor($this->testTenantId)
            ->pluck('id')
            ->map(static fn ($id): int => (int) $id)
            ->all();
    }

    private function seedUser(array $overrides = [], ?int $tenantId = null): object
    {
        $tenantId = $tenantId ?? $this->testTenantId;
        $unique   = uniqid('nanr_', true);

        $data = array_merge([
            'tenant_id'          => $tenantId,
            'name'               => 'Test User ' . $unique,
            'first_name'         => 'Test',
            'last_name'          => 'User',
            'email'              => $unique . '@example.com',
            'role'               => 'member',
            'status'             => 'active',
            'preferred_language' => 'en',
            'is_approved'        => 1,
            'created_at'         => now(),
            'updated_at'         => now(),
        ], $overrides);

        $id = DB::table('users')->insertGetId($data);

        return (object) array_merge($data, ['id' => $id]);
    }
}
