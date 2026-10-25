<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

declare(strict_types=1);

namespace App\Services;

use App\Support\Authorization\SafeguardingStaff;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Log;

/**
 * Who counts as a coordinator for safeguarded contact.
 *
 * Owner decision, 25 Oct 2026: a member who says they are a vulnerable adult
 * (or who holds another contact-limiting choice) can always be contacted by
 * the coordinators of their own community — any safeguarding staff role
 * (SafeguardingStaff) — and can always contact them.
 *
 * A failed lookup answers "not a coordinator": SafeguardingInteractionPolicy
 * then refuses contact, which is the safe direction to fail.
 */
class SafeguardingCoordinatorDirectory
{
    public function isStaff(int $tenantId, int $userId): bool
    {
        if ($userId <= 0) {
            return false;
        }

        try {
            return SafeguardingStaff::scope(
                DB::table('users')
                    ->where('id', $userId)
                    ->where('tenant_id', $tenantId)
                    ->where('status', 'active')
            )->exists();
        } catch (\Throwable $e) {
            Log::error('SafeguardingCoordinatorDirectory: staff lookup failed', [
                'tenant_id' => $tenantId,
                'exception_class' => $e::class,
            ]);

            return false;
        }
    }
}
