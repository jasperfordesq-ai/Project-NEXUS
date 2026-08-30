<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

namespace Database\Seeders;

use Illuminate\Database\Seeder;
use Illuminate\Support\Facades\DB;

/**
 * Deterministic E2E test fixture.
 *
 * The Playwright suite cannot exercise any real user journey (login, wallet
 * transfer, messaging, exchange) without stable, known data to act on — there
 * was previously no two-user fixture anywhere, so every action test silently
 * no-opped on an empty DB. This seeder creates that keystone:
 *
 *   - User A (member, balance 100) — the primary actor / listing owner
 *   - User B (member, balance 25)  — the second actor (messaging/exchange)
 *   - Admin    (admin role)        — admin-area journeys
 *   - One active listing per member — each actor can exercise the other's listing
 *
 * Idempotent (updateOrInsert on tenant_id + email / tenant_id + user_id + title),
 * so re-running is safe. Credentials default to the values e2e/global.setup.ts
 * already expects and are overridable via the same env vars.
 *
 * Run ONLY against a local/dev/test database, never the DatabaseSeeder default:
 *   php artisan db:seed --class=Database\\Seeders\\E2ETestDataSeeder
 *
 * 🔴 Refuses to run in production — it creates known-password accounts.
 */
class E2ETestDataSeeder extends Seeder
{
    public function run(): void
    {
        if (app()->environment('production')) {
            $this->command?->warn('E2ETestDataSeeder refuses to run in production (creates known-credential accounts). Aborting.');
            return;
        }

        $tenantId = (int) env('E2E_TENANT_ID', TenantSeeder::MASTER_TENANT_ID);
        if ($tenantId === TenantSeeder::MASTER_TENANT_ID) {
            $this->call(TenantSeeder::class);
        }

        $now = now();

        // Device creation flows need one category whose label does not vary with a
        // developer's existing fixture catalogue. The CI workflow used to insert
        // "General" separately, which made the same flow fail on richer local data.
        DB::table('categories')->updateOrInsert(
            ['tenant_id' => $tenantId, 'slug' => 'e2e-general', 'type' => 'listing'],
            [
                'name' => 'E2E General',
                'is_active' => 1,
                'sort_order' => 999,
                'created_at' => $now,
                'updated_at' => $now,
            ]
        );

        $users = [
            [
                'label' => 'A (primary)',
                'email' => env('E2E_USER_EMAIL', 'e2e.user.a@project-nexus.local'),
                'password' => env('E2E_USER_PASSWORD', 'TestPassword123!'),
                'first' => 'E2E',
                'last' => 'UserA',
                'role' => 'member',
                'balance' => 100,
            ],
            [
                'label' => 'B (secondary)',
                'email' => env('E2E_SECOND_USER_EMAIL', 'e2e.user.b@project-nexus.local'),
                'password' => env('E2E_SECOND_USER_PASSWORD', 'TestPassword123!'),
                'first' => 'E2E',
                'last' => 'UserB',
                'role' => 'member',
                'balance' => 25,
            ],
            [
                'label' => 'Admin',
                'email' => env('E2E_ADMIN_EMAIL', 'e2e.admin@project-nexus.local'),
                'password' => env('E2E_ADMIN_PASSWORD', 'AdminPassword123!'),
                'first' => 'E2E',
                'last' => 'Admin',
                'role' => 'admin',
                'balance' => 50,
            ],
        ];

        $ids = [];
        foreach ($users as $u) {
            DB::table('users')->updateOrInsert(
                ['tenant_id' => $tenantId, 'email' => $u['email']],
                [
                    'first_name'           => $u['first'],
                    'last_name'            => $u['last'],
                    'name'                 => $u['first'] . ' ' . $u['last'],
                    'password_hash'        => bcrypt($u['password']),
                    'role'                 => $u['role'],
                    'status'               => 'active',
                    'is_verified'          => 1,
                    // Must be set too: the login gate (CheckLoginGates) keys email
                    // verification on `email_verified_at`, NOT `is_verified`. Without
                    // this, a freshly-seeded member is rejected at login with
                    // AUTH_EMAIL_NOT_VERIFIED on any tenant that requires email
                    // verification (the fail-closed default) — silently breaking
                    // every E2E/journey/deploy-gate flow that logs in as User B.
                    'email_verified_at'    => $now,
                    'is_approved'          => 1,
                    'balance'              => $u['balance'],
                    'profile_type'         => 'individual',
                    'onboarding_completed' => 1,
                    'created_at'           => $now,
                    'updated_at'           => $now,
                ]
            );
            $ids[$u['label']] = (int) DB::table('users')
                ->where('tenant_id', $tenantId)->where('email', $u['email'])->value('id');
            $this->command?->info("  E2E user {$u['label']}: {$u['email']} (id {$ids[$u['label']]}, balance {$u['balance']})");
        }

        // Deterministic active listing owned by User A, discoverable by User B
        // in browse/search — the anchor for exchange/listing/search journeys.
        $listingTitle = 'E2E Fixture Listing — Gardening Help';
        DB::table('listings')->updateOrInsert(
            ['tenant_id' => $tenantId, 'user_id' => $ids['A (primary)'], 'title' => $listingTitle],
            [
                'type'         => 'offer',
                'status'       => 'active',
                'description'  => 'Deterministic E2E fixture listing owned by E2E User A. Used by exchange, listing and search journeys.',
                'service_type' => 'physical_only',
                'created_at'   => $now,
                'updated_at'   => $now,
            ]
        );
        $this->command?->info("  E2E fixture listing ensured for User A: \"{$listingTitle}\"");

        // A second deterministic listing lets the primary device actor exercise a
        // genuine save/bookmark journey against someone else's content. Saving the
        // actor's own listing would make the UI move but would not represent the
        // member-to-member behaviour the journey is intended to prove.
        $secondaryListingTitle = 'E2E Fixture Listing — Bicycle Repair';
        DB::table('listings')->updateOrInsert(
            ['tenant_id' => $tenantId, 'user_id' => $ids['B (secondary)'], 'title' => $secondaryListingTitle],
            [
                'type'         => 'offer',
                'status'       => 'active',
                'description'  => 'Deterministic E2E fixture listing owned by E2E User B. Used by effect-verifying save journeys.',
                'service_type' => 'physical_only',
                'created_at'   => $now,
                'updated_at'   => $now,
            ]
        );
        $this->command?->info("  E2E fixture listing ensured for User B: \"{$secondaryListingTitle}\"");

        $this->command?->info('E2E test fixture seeded (tenant ' . $tenantId . '): 3 users + 2 listings + 1 device category.');
    }
}
