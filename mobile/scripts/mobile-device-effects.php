<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

declare(strict_types=1);

use Illuminate\Contracts\Console\Kernel;
use Illuminate\Support\Facades\DB;

require dirname(__DIR__, 2) . '/vendor/autoload.php';

$app = require dirname(__DIR__, 2) . '/bootstrap/app.php';
$app->make(Kernel::class)->bootstrap();

const PRIMARY_EMAIL = 'e2e.user.a@project-nexus.local';
const SECONDARY_EMAIL = 'e2e.user.b@project-nexus.local';
const SAVED_LISTING_TITLE = 'E2E Fixture Listing — Bicycle Repair';
const CREATED_LISTING_TITLE = 'E2E Device Journey - Computer Help';

$mode = $argv[1] ?? '';
if (!in_array($mode, ['reset', 'assert'], true)) {
    fwrite(STDERR, "Usage: php mobile/scripts/mobile-device-effects.php <reset|assert>\n");
    exit(2);
}

if (app()->environment('production')) {
    fwrite(STDERR, "Refusing to alter or inspect production fixture state.\n");
    exit(2);
}

$tenantId = (int) env('E2E_TENANT_ID', 2);
$primaryId = (int) DB::table('users')->where('tenant_id', $tenantId)->where('email', PRIMARY_EMAIL)->value('id');
$secondaryId = (int) DB::table('users')->where('tenant_id', $tenantId)->where('email', SECONDARY_EMAIL)->value('id');
$savedListingId = (int) DB::table('listings')->where('tenant_id', $tenantId)->where('title', SAVED_LISTING_TITLE)->value('id');

if ($primaryId <= 0 || $secondaryId <= 0 || $savedListingId <= 0) {
    fwrite(STDERR, "Effect fixture is incomplete; run E2ETestDataSeeder first.\n");
    exit(2);
}

if ($mode === 'reset') {
    DB::transaction(function () use ($tenantId, $primaryId, $secondaryId, $savedListingId): void {
        DB::table('connections')
            ->where('tenant_id', $tenantId)
            ->where(function ($query) use ($primaryId, $secondaryId): void {
                $query->where(function ($pair) use ($primaryId, $secondaryId): void {
                    $pair->where('requester_id', $primaryId)->where('receiver_id', $secondaryId);
                })->orWhere(function ($pair) use ($primaryId, $secondaryId): void {
                    $pair->where('requester_id', $secondaryId)->where('receiver_id', $primaryId);
                });
            })
            ->delete();

        DB::table('user_saved_listings')->where([
            'tenant_id' => $tenantId,
            'user_id' => $primaryId,
            'listing_id' => $savedListingId,
        ])->delete();

        $createdIds = DB::table('listings')->where([
            'tenant_id' => $tenantId,
            'user_id' => $primaryId,
            'title' => CREATED_LISTING_TITLE,
        ])->pluck('id');
        if ($createdIds->isNotEmpty()) {
            DB::table('user_saved_listings')->where('tenant_id', $tenantId)->whereIn('listing_id', $createdIds)->delete();
            DB::table('listings')->whereIn('id', $createdIds)->delete();
        }
    });

    fwrite(STDOUT, "mobile-effects: reset deterministic listing, save and connection state\n");
    exit(0);
}

$checks = [
    'listing creation persisted' => DB::table('listings')->where([
        'tenant_id' => $tenantId,
        'user_id' => $primaryId,
        'title' => CREATED_LISTING_TITLE,
        'status' => 'active',
    ])->exists(),
    'other member listing saved' => DB::table('user_saved_listings')->where([
        'tenant_id' => $tenantId,
        'user_id' => $primaryId,
        'listing_id' => $savedListingId,
    ])->exists(),
    'connection request persisted' => DB::table('connections')->where([
        'tenant_id' => $tenantId,
        'requester_id' => $primaryId,
        'receiver_id' => $secondaryId,
        'status' => 'pending',
    ])->exists(),
];

$failed = 0;
foreach ($checks as $label => $passed) {
    fwrite($passed ? STDOUT : STDERR, sprintf("mobile-effects: %s %s\n", $passed ? 'ok  ' : 'FAIL', $label));
    if (!$passed) {
        $failed++;
    }
}

exit($failed === 0 ? 0 : 1);
