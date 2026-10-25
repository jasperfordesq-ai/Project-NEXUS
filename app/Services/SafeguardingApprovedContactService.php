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
 * Coordinator-approved contacts for a member whose safeguarding choice routes
 * all contact through a coordinator (trigger `restricts_messaging`, e.g. "I
 * consider myself a vulnerable adult").
 *
 * Owner decision, 25 Oct 2026: such a member can be contacted by coordinators
 * and by members a coordinator has approved for them, and nobody else; they
 * ask a coordinator to put them in touch with someone. An approval is one
 * protected member + one other member of the same community, recorded with who
 * approved it and when, and revocable. It opens contact in both directions
 * for that pair only.
 *
 * Read failures answer "not approved": SafeguardingInteractionPolicy then
 * refuses contact, which is the safe direction to fail.
 */
class SafeguardingApprovedContactService
{
    public function isApproved(int $tenantId, int $protectedUserId, int $contactUserId): bool
    {
        if ($protectedUserId <= 0 || $contactUserId <= 0 || $protectedUserId === $contactUserId) {
            return false;
        }

        try {
            return DB::table('safeguarding_approved_contacts')
                ->where('tenant_id', $tenantId)
                ->where('protected_user_id', $protectedUserId)
                ->where('contact_user_id', $contactUserId)
                ->whereNull('revoked_at')
                ->exists();
        } catch (\Throwable $e) {
            Log::error('SafeguardingApprovedContactService: approval lookup failed', [
                'tenant_id' => $tenantId,
                'exception_class' => $e::class,
            ]);

            return false;
        }
    }

    /**
     * Whether a user is safeguarding staff (coordinator, broker or admin) in
     * the given community. Coordinators can always contact a protected member.
     */
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
            Log::error('SafeguardingApprovedContactService: staff lookup failed', [
                'tenant_id' => $tenantId,
                'exception_class' => $e::class,
            ]);

            return false;
        }
    }

    /** @return list<array{id: int, contact_user_id: int, contact_name: string, approved_by: int|null, approved_at: string|null}> */
    public function listActive(int $tenantId, int $protectedUserId): array
    {
        return DB::table('safeguarding_approved_contacts as a')
            ->join('users as u', function ($join): void {
                $join->on('u.id', '=', 'a.contact_user_id')->on('u.tenant_id', '=', 'a.tenant_id');
            })
            ->where('a.tenant_id', $tenantId)
            ->where('a.protected_user_id', $protectedUserId)
            ->whereNull('a.revoked_at')
            ->orderBy('a.approved_at')
            ->get(['a.id', 'a.contact_user_id', 'a.approved_by', 'a.approved_at', 'u.first_name', 'u.last_name', 'u.name'])
            ->map(static fn (object $row): array => [
                'id' => (int) $row->id,
                'contact_user_id' => (int) $row->contact_user_id,
                'contact_name' => trim(((string) ($row->first_name ?? '')) . ' ' . ((string) ($row->last_name ?? ''))) ?: (string) ($row->name ?? ''),
                'approved_by' => $row->approved_by !== null ? (int) $row->approved_by : null,
                'approved_at' => $row->approved_at !== null ? (string) $row->approved_at : null,
            ])
            ->all();
    }

    /**
     * @return array{id: int, created: bool}
     */
    public function approve(int $tenantId, int $protectedUserId, int $contactUserId, int $actorUserId): array
    {
        $existing = DB::table('safeguarding_approved_contacts')
            ->where('tenant_id', $tenantId)
            ->where('protected_user_id', $protectedUserId)
            ->where('contact_user_id', $contactUserId)
            ->whereNull('revoked_at')
            ->value('id');
        if ($existing !== null) {
            return ['id' => (int) $existing, 'created' => false];
        }

        $id = (int) DB::table('safeguarding_approved_contacts')->insertGetId([
            'tenant_id' => $tenantId,
            'protected_user_id' => $protectedUserId,
            'contact_user_id' => $contactUserId,
            'approved_by' => $actorUserId,
            'approved_at' => now(),
        ]);
        $this->audit($tenantId, $actorUserId, 'safeguarding_contact_approved', $protectedUserId, $id, $contactUserId);
        $this->forgetTriggers($tenantId, $protectedUserId, $contactUserId);

        return ['id' => $id, 'created' => true];
    }

    public function revoke(int $tenantId, int $protectedUserId, int $approvalId, int $actorUserId): bool
    {
        $row = DB::table('safeguarding_approved_contacts')
            ->where('id', $approvalId)
            ->where('tenant_id', $tenantId)
            ->where('protected_user_id', $protectedUserId)
            ->whereNull('revoked_at')
            ->first(['id', 'contact_user_id']);
        if ($row === null) {
            return false;
        }

        DB::table('safeguarding_approved_contacts')
            ->where('id', $approvalId)
            ->update(['revoked_at' => now(), 'revoked_by' => $actorUserId]);
        $this->audit($tenantId, $actorUserId, 'safeguarding_contact_revoked', $protectedUserId, $approvalId, (int) $row->contact_user_id);
        $this->forgetTriggers($tenantId, $protectedUserId, (int) $row->contact_user_id);

        return true;
    }

    private function forgetTriggers(int $tenantId, int ...$userIds): void
    {
        foreach ($userIds as $userId) {
            SafeguardingTriggerService::invalidateCache($userId, $tenantId);
        }
    }

    private function audit(int $tenantId, int $actorUserId, string $action, int $protectedUserId, int $approvalId, int $contactUserId): void
    {
        try {
            DB::table('activity_log')->insert([
                'tenant_id' => $tenantId,
                'user_id' => $actorUserId,
                'action' => $action,
                'action_type' => 'safeguarding',
                'entity_type' => 'user',
                'entity_id' => $protectedUserId,
                'details' => json_encode(['approval_id' => $approvalId, 'contact_user_id' => $contactUserId]),
                'ip_address' => request()?->ip(),
                'user_agent' => request()?->userAgent(),
                'created_at' => now(),
            ]);
        } catch (\Throwable $e) {
            Log::error('SafeguardingApprovedContactService: audit failed', [
                'action' => $action,
                'exception_class' => $e::class,
            ]);
        }
    }
}
