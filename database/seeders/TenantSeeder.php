<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

namespace Database\Seeders;

use Illuminate\Database\Seeder;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Hash;

class TenantSeeder extends Seeder
{
    public const MASTER_TENANT_ID = 1;
    public const DEFAULT_ADMIN_EMAIL = 'admin@project-nexus.local';

    /**
     * First-run development password for the bootstrap platform administrator.
     *
     * This is a documented placeholder, not a secret: it appears in `README.md`,
     * `docs/TUTORIAL.md`, `docs/DATABASE.md` and both `.env.example` files so a
     * new contributor can sign in after `migrate --seed`. It is overridable with
     * `NEXUS_BOOTSTRAP_ADMIN_PASSWORD`.
     *
     * 🔴 It is only safe because {@see SAFE_BOOTSTRAP_ENVIRONMENTS} refuses to
     * seed it anywhere else. That guard used to be a DENY-list
     * (`if (app()->environment('production'))`), which passed for every
     * environment that was not spelled exactly `production` — including an
     * unset APP_ENV. It now fails CLOSED. Do not weaken it back: this account
     * carries `is_god = 1`, which is full platform access across every
     * community. (Tightened under F-398, 30 September 2026.)
     */
    public const DEFAULT_ADMIN_PASSWORD = 'ChangeMe123!';

    /**
     * The only environments in which the documented default password may be
     * seeded. Anything else — including an empty or unrecognised value — must
     * supply `NEXUS_BOOTSTRAP_ADMIN_PASSWORD` explicitly or gets no admin.
     */
    private const SAFE_BOOTSTRAP_ENVIRONMENTS = ['local', 'development', 'testing'];

    /**
     * Seed the master tenant and first-run platform administrator.
     */
    public function run(): void
    {
        $tenantId = self::MASTER_TENANT_ID;
        $now = now();

        DB::table('tenants')->updateOrInsert(
            ['id' => $tenantId],
            [
                'name'              => 'Master Tenant',
                'slug'              => null,
                'domain'            => null,
                'accessible_domain' => null,
                'tenant_category'   => 'platform',
                'tagline'           => 'Project NEXUS master tenant',
                'parent_id'         => null,
                'path'              => '/' . $tenantId . '/',
                'is_active'         => 1,
                'depth'             => 0,
                'allows_subtenants' => true,
                'max_depth'         => 3,
                'created_at'        => $now,
                'updated_at'        => $now,
            ],
        );

        $categories = [
            'Home and Garden',
            'Technology Support',
            'Education and Tutoring',
            'Health and Wellbeing',
            'Transport',
            'Creative Arts',
            'Professional Services',
            'Community',
        ];

        foreach ($categories as $sort => $name) {
            DB::table('categories')->updateOrInsert(
                ['tenant_id' => $tenantId, 'name' => $name],
                [
                    'slug'       => str($name)->slug()->toString(),
                    'sort_order' => $sort,
                    'is_active'  => 1,
                    'type'       => 'listing',
                    'created_at' => $now,
                    'updated_at' => $now,
                ],
            );
        }

        $settings = [
            'site_name'          => 'Project NEXUS',
            'currency_name'      => 'Time Credits',
            'currency_symbol'    => 'hr',
            'default_balance'    => '5.00',
            'registration_mode'  => 'open',
            'theme'              => 'default',
        ];

        foreach ($settings as $key => $value) {
            DB::table('tenant_settings')->updateOrInsert(
                ['tenant_id' => $tenantId, 'setting_key' => $key],
                [
                    'setting_value' => $value,
                    'setting_type'  => 'string',
                    'created_at'    => $now,
                    'updated_at'    => $now,
                ],
            );
        }

        $email = (string) env('NEXUS_BOOTSTRAP_ADMIN_EMAIL', self::DEFAULT_ADMIN_EMAIL);
        $password = (string) env('NEXUS_BOOTSTRAP_ADMIN_PASSWORD', self::DEFAULT_ADMIN_PASSWORD);

        // 🔴 Fail CLOSED (F-398). The documented default may only be seeded in an
        // explicitly safe environment. Previously this refused only when the
        // environment was spelled exactly `production`, so any other value — a
        // typo, `staging`, or an unset APP_ENV — created a full `is_god`
        // platform administrator with a password published in this repository.
        $environment = trim((string) app()->environment());
        $usingDocumentedDefault = $password === self::DEFAULT_ADMIN_PASSWORD;

        if ($usingDocumentedDefault && ! in_array($environment, self::SAFE_BOOTSTRAP_ENVIRONMENTS, true)) {
            $this->command?->warn(sprintf(
                'Skipping bootstrap admin: environment is "%s". The documented default password is '
                . 'only seeded in %s. Set NEXUS_BOOTSTRAP_ADMIN_EMAIL and NEXUS_BOOTSTRAP_ADMIN_PASSWORD '
                . 'to create a platform administrator here.',
                $environment === '' ? '(empty)' : $environment,
                implode(', ', self::SAFE_BOOTSTRAP_ENVIRONMENTS)
            ));

            return;
        }

        $passwordHash = Hash::make($password);

        DB::table('users')->updateOrInsert(
            ['tenant_id' => $tenantId, 'email' => $email],
            [
                'first_name'              => 'Platform',
                'last_name'               => 'Admin',
                'name'                    => 'Platform Admin',
                'username'                => $email,
                'password_hash'           => $passwordHash,
                'password'                => $passwordHash,
                'role'                    => 'god',
                'status'                  => 'active',
                'is_admin'                => 1,
                'is_super_admin'          => 1,
                'is_tenant_super_admin'   => 1,
                'is_god'                  => 1,
                'is_approved'             => 1,
                'is_verified'             => 1,
                'is_active'               => 1,
                'email_verified_at'       => $now,
                'onboarding_completed'    => 1,
                'profile_type'            => 'individual',
                'preferred_language'      => 'en',
                'timezone'                => 'UTC',
                'totp_setup_required'     => 0,
                'max_permission_level'    => 100,
                'permissions_last_updated' => $now,
                'created_at'              => $now,
                'updated_at'              => $now,
            ],
        );
    }
}
