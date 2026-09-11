<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

// CLI-only fixture for the synthetic journey environment. Never reset shared accounts.
if (PHP_SAPI !== 'cli') { exit(1); }
require __DIR__ . '/../vendor/autoload.php';
$app = require __DIR__ . '/../bootstrap/app.php';
$app->make(Illuminate\Contracts\Console\Kernel::class)->bootstrap();
if (config('database.connections.mysql.database') !== 'nexus_webuk_e2e') {
    throw new RuntimeException('MFA journeys require the isolated nexus_webuk_e2e database.');
}
$tenant = Illuminate\Support\Facades\DB::table('tenants')->where('slug', 'e2e-community')->first();
if (!$tenant) { throw new RuntimeException('Synthetic community is missing.'); }
$migration = require __DIR__ . '/../database/migrations/2026_09_11_090000_add_last_used_step_to_totp_settings.php';
$migration->up();
$run = bin2hex(random_bytes(6));
$actors = [];
foreach (['react', 'accessible', 'native'] as $client) {
    $email = 'mfa-' . $client . '-' . $run . '@project-nexus.local';
    $user = App\Models\User::factory()->forTenant($tenant->id)->admin()->create([
        'email' => $email, 'first_name' => 'MFA', 'last_name' => ucfirst($client),
        'name' => 'MFA ' . ucfirst($client), 'password_hash' => bcrypt('MfaJourney123!'),
        'email_verified_at' => now(), 'is_verified' => true, 'preferred_language' => 'en',
        'bio' => null, 'phone' => null, 'location' => null,
    ]);
    $actors[$client] = ['id' => $user->id, 'email' => $email, 'password' => 'MfaJourney123!'];
}
echo json_encode(['tenant' => $tenant->id, 'slug' => $tenant->slug, 'actors' => $actors]);
