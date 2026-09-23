<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

declare(strict_types=1);

namespace App\Services\Verein;

use App\Models\User;
use App\Services\CaringCommunity\VereinMemberImportService;

/**
 * Shared authorization boundary for organization-scoped Verein dues data.
 */
class VereinDuesAuthorizationService
{
    public function __construct(
        private readonly VereinMemberImportService $vereinMemberImportService,
    ) {
    }

    public function canManageDues(int $tenantId, int $actorId, int $organizationId): bool
    {
        $actor = User::query()
            ->where('tenant_id', $tenantId)
            ->where('id', $actorId)
            ->first(['role', 'is_admin', 'is_super_admin', 'is_tenant_super_admin', 'is_god']);

        if ($actor && (
            in_array((string) $actor->role, ['admin', 'tenant_admin', 'super_admin', 'god'], true)
            || (int) ($actor->is_admin ?? 0) === 1
            || (int) ($actor->is_super_admin ?? 0) === 1
            || (int) ($actor->is_tenant_super_admin ?? 0) === 1
            || (int) ($actor->is_god ?? 0) === 1
        )) {
            return true;
        }

        foreach (['verein.dues.manage', 'verein.members.manage', 'verein.members.import'] as $permission) {
            if ($this->vereinMemberImportService->userHasPermissionInOrg(
                $tenantId,
                $actorId,
                $organizationId,
                $permission
            )) {
                return true;
            }
        }

        return false;
    }
}
