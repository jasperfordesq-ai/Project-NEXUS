<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

namespace App\Services;

use App\Core\TenantContext;
use App\I18n\LocaleContext;
use App\Models\VolApplication;
use App\Models\VolShift;
use App\Services\NotificationDispatcher;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Log;

/**
 * ShiftSwapService — Laravel DI-based service for shift swap operations.
 *
 * All queries are tenant-scoped automatically via the HasTenantScope trait.
 */
class ShiftSwapService
{
    private static array $errors = [];

    public static function getErrors(): array
    {
        return self::$errors;
    }

    /**
     * Alias for getErrors() used by the cancel flow.
     */
    public static function getCancelErrors(): array
    {
        return self::$errors;
    }

    /**
     * Request a shift swap between two volunteers.
     *
     * @param int   $fromUserId User requesting the swap
     * @param array $data       [from_shift_id, to_shift_id, to_user_id, message]
     * @return int|null Swap request ID or null on failure
     */
    public static function requestSwap(int $fromUserId, array $data): ?int
    {
        self::$errors = [];
        $tenantId = TenantContext::getId();

        $fromShiftId = (int) ($data['from_shift_id'] ?? 0);
        $toShiftId   = (int) ($data['to_shift_id'] ?? 0);
        $toUserId    = (int) ($data['to_user_id'] ?? 0);
        $message     = trim($data['message'] ?? '');

        if (! $fromShiftId || ! $toShiftId) {
            self::$errors[] = ['code' => 'VALIDATION_ERROR', 'message' => __('api.shift_swap_fields_required')];
            return null;
        }

        /*
          🔴 `to_user_id` is now OPTIONAL, and this is why nothing could ever create a swap
          request until 2026-08-24.

          The endpoint required the requester to name the volunteer they were swapping with.
          No client could: nothing on the platform tells a volunteer who is on which shift,
          and exposing that is a privacy and safeguarding decision, not a screen. So the
          response half worked, the request half existed only as a curl command, and the
          website's own empty state promised members a page that was never built.

          Resolving the counterpart HERE avoids the decision entirely. The member picks a
          shift, not a person; the server finds who holds it and never tells them. What the
          member can see is unchanged: `signup_count` per shift is already public on
          `GET /v2/volunteering/opportunities/{id}/shifts`, so "someone is on that shift" is
          information they already have. The identity stays server-side.

          Deterministic when several volunteers hold the target shift: the earliest approved
          signup that has no pending swap on that shift already, so two members asking about
          the same shift do not both queue behind one person.
        */
        if (! $toUserId) {
            $toUserId = self::resolveCounterpartForShift($toShiftId, $fromUserId, $tenantId);
            if (! $toUserId) {
                self::$errors[] = ['code' => 'VALIDATION_ERROR', 'message' => __('api.shift_swap_no_one_on_shift')];
                return null;
            }
        }

        if ($fromUserId === $toUserId) {
            self::$errors[] = ['code' => 'VALIDATION_ERROR', 'message' => __('api.shift_swap_cannot_swap_self')];
            return null;
        }

        // Verify requester is signed up for from_shift
        $fromApp = VolApplication::where('shift_id', $fromShiftId)
            ->where('user_id', $fromUserId)
            ->where('status', 'approved')
            ->first();

        if (! $fromApp) {
            self::$errors[] = ['code' => 'FORBIDDEN', 'message' => __('api.shift_swap_not_signed_up_source')];
            return null;
        }

        // Verify target user is signed up for to_shift
        $toApp = VolApplication::where('shift_id', $toShiftId)
            ->where('user_id', $toUserId)
            ->where('status', 'approved')
            ->first();

        if (! $toApp) {
            self::$errors[] = ['code' => 'VALIDATION_ERROR', 'message' => __('api.shift_swap_target_not_signed_up')];
            return null;
        }

        // Check both shifts are in the future
        $fromShift = VolShift::find($fromShiftId);
        $toShift   = VolShift::find($toShiftId);

        if (! $fromShift || ! $toShift) {
            self::$errors[] = ['code' => 'NOT_FOUND', 'message' => __('api.shift_swap_shifts_not_found')];
            return null;
        }

        // Both shifts must belong to the same opportunity. Swapping across
        // opportunities would move a volunteer onto a shift of an opportunity they
        // were never approved for, bypassing per-opportunity application approval.
        if ((int) $fromShift->opportunity_id !== (int) $toShift->opportunity_id) {
            self::$errors[] = ['code' => 'VALIDATION_ERROR', 'message' => __('api.shift_swap_different_opportunity')];
            return null;
        }

        if ($fromShift->start_time->isPast() || $toShift->start_time->isPast()) {
            self::$errors[] = ['code' => 'VALIDATION_ERROR', 'message' => __('api.shift_swap_shift_started')];
            return null;
        }

        app(SafeguardingInteractionPolicy::class)->assertLocalContactAllowed(
            $fromUserId,
            $toUserId,
            $tenantId,
            'volunteer_shift_swap_request',
        );

        // Check for duplicate pending swap request
        $duplicate = DB::table('vol_shift_swap_requests')
            ->where('from_user_id', $fromUserId)
            ->where('to_user_id', $toUserId)
            ->where('from_shift_id', $fromShiftId)
            ->where('to_shift_id', $toShiftId)
            ->whereIn('status', ['pending', 'admin_pending'])
            ->where('tenant_id', $tenantId)
            ->exists();

        if ($duplicate) {
            self::$errors[] = ['code' => 'ALREADY_EXISTS', 'message' => __('api.shift_swap_already_exists')];
            return null;
        }

        // Check if admin approval is required (tenant setting)
        $requiresAdmin = self::requiresAdminApproval($tenantId);

        try {
            $swapId = DB::table('vol_shift_swap_requests')->insertGetId([
                'tenant_id'               => $tenantId,
                'from_user_id'            => $fromUserId,
                'to_user_id'              => $toUserId,
                'from_shift_id'           => $fromShiftId,
                'to_shift_id'             => $toShiftId,
                'status'                  => 'pending',
                'requires_admin_approval' => $requiresAdmin ? 1 : 0,
                'message'                 => $message,
                'created_at'              => now(),
            ]);

            // Notify the target user about the incoming swap request
            self::notifySwap($toUserId, 'vol_swap_requested', 'svc_notifications.shift_swap.requested', '/volunteering?tab=swaps');

            return (int) $swapId;
        } catch (\Exception $e) {
            Log::error('ShiftSwapService::requestSwap error: ' . $e->getMessage());
            self::$errors[] = ['code' => 'SERVER_ERROR', 'message' => __('api.shift_swap_create_failed')];
            return null;
        }
    }

    /**
     * Who holds `$toShiftId`, for a swap the requester asked for by shift rather than by
     * person? Returns null when nobody does — the caller turns that into a member-facing
     * message rather than a silent failure.
     *
     * Never returned to the client: only used to address the request. Ordering is
     * deliberate — a volunteer with no pending swap on this shift comes first, so a second
     * requester is not queued behind the same person, and `vol_applications.id` breaks the
     * tie so the result is stable between calls.
     */
    private static function resolveCounterpartForShift(int $toShiftId, int $excludeUserId, int $tenantId): ?int
    {
        $candidates = DB::table('vol_applications')
            ->where('shift_id', $toShiftId)
            ->where('status', 'approved')
            ->where('tenant_id', $tenantId)
            ->where('user_id', '!=', $excludeUserId)
            ->orderBy('id')
            ->pluck('user_id')
            ->all();

        if (empty($candidates)) {
            return null;
        }

        $busy = DB::table('vol_shift_swap_requests')
            ->where('tenant_id', $tenantId)
            ->where('to_shift_id', $toShiftId)
            ->whereIn('status', ['pending', 'admin_pending'])
            ->pluck('to_user_id')
            ->all();

        foreach ($candidates as $candidate) {
            if (! in_array((int) $candidate, array_map('intval', $busy), true)) {
                return (int) $candidate;
            }
        }

        // Everyone on that shift already has a pending swap: fall back to the first, so the
        // duplicate check below decides whether this particular pair is a repeat.
        return (int) $candidates[0];
    }

    /**
     * Respond to a swap request (accept/reject by target user).
     */
    public static function respond(int $swapId, int $userId, string $action): bool
    {
        self::$errors = [];
        $tenantId = TenantContext::getId();

        if (! in_array($action, ['accept', 'reject'])) {
            self::$errors[] = ['code' => 'VALIDATION_ERROR', 'message' => __('api.vol_action_accept_reject')];
            return false;
        }

        $swap = DB::table('vol_shift_swap_requests')
            ->where('id', $swapId)
            ->where('status', 'pending')
            ->where('tenant_id', $tenantId)
            ->first();

        if (! $swap) {
            self::$errors[] = ['code' => 'NOT_FOUND', 'message' => __('api.shift_swap_not_found_or_processed')];
            return false;
        }

        if ((int) $swap->to_user_id !== $userId) {
            self::$errors[] = ['code' => 'FORBIDDEN', 'message' => __('api.shift_swap_not_addressed_to_you')];
            return false;
        }

        if ($action === 'accept') {
            $policy = app(SafeguardingInteractionPolicy::class);
            $policy->assertLocalContactAllowed(
                (int) $swap->from_user_id,
                (int) $swap->to_user_id,
                $tenantId,
                'volunteer_shift_swap_accept',
            );
            $policy->assertLocalContactAllowed(
                (int) $swap->to_user_id,
                (int) $swap->from_user_id,
                $tenantId,
                'volunteer_shift_swap_accept',
            );
        }

        try {
            if ($action === 'reject') {
                DB::table('vol_shift_swap_requests')
                    ->where('id', $swapId)
                    ->where('tenant_id', $tenantId)
                    ->update(['status' => 'rejected']);

                // Notify requester their swap was declined
                self::notifySwap((int) $swap->from_user_id, 'vol_swap_declined', 'svc_notifications.shift_swap.declined', '/volunteering?tab=swaps');

                return true;
            }

            // Accept flow
            if ($swap->requires_admin_approval) {
                DB::table('vol_shift_swap_requests')
                    ->where('id', $swapId)
                    ->where('tenant_id', $tenantId)
                    ->update(['status' => 'admin_pending']);
                return true;
            }

            // Execute swap directly
            $result = self::executeSwap($swap, $tenantId);

            if ($result) {
                // Notify requester their swap was approved
                self::notifySwap((int) $swap->from_user_id, 'vol_swap_approved', 'svc_notifications.shift_swap.accepted', '/volunteering?tab=swaps');
            }

            return $result;
        } catch (\Exception $e) {
            Log::error('ShiftSwapService::respond error: ' . $e->getMessage());
            self::$errors[] = ['code' => 'SERVER_ERROR', 'message' => __('api.shift_swap_response_failed')];
            return false;
        }
    }

    /**
     * Admin approve/reject a swap.
     */
    public static function adminDecision(int $swapId, int $adminId, string $action): bool
    {
        self::$errors = [];
        $tenantId = TenantContext::getId();

        if (! in_array($action, ['approve', 'reject'])) {
            self::$errors[] = ['code' => 'VALIDATION_ERROR', 'message' => __('api.vol_action_approve_reject')];
            return false;
        }

        $swap = DB::table('vol_shift_swap_requests')
            ->where('id', $swapId)
            ->where('status', 'admin_pending')
            ->where('tenant_id', $tenantId)
            ->first();

        if (! $swap) {
            self::$errors[] = ['code' => 'NOT_FOUND', 'message' => __('api.shift_swap_not_found_or_not_pending')];
            return false;
        }

        if ($action === 'approve') {
            $policy = app(SafeguardingInteractionPolicy::class);
            $policy->assertLocalContactAllowed(
                (int) $swap->from_user_id,
                (int) $swap->to_user_id,
                $tenantId,
                'volunteer_shift_swap_admin_approval',
            );
            $policy->assertLocalContactAllowed(
                (int) $swap->to_user_id,
                (int) $swap->from_user_id,
                $tenantId,
                'volunteer_shift_swap_admin_approval',
            );
        }

        try {
            if ($action === 'reject') {
                DB::table('vol_shift_swap_requests')
                    ->where('id', $swapId)
                    ->where('tenant_id', $tenantId)
                    ->update(['status' => 'admin_rejected', 'admin_id' => $adminId]);

                // Notify both parties
                self::notifySwap((int) $swap->from_user_id, 'vol_swap_declined', 'svc_notifications.shift_swap.declined_by_admin', '/volunteering?tab=swaps');
                self::notifySwap((int) $swap->to_user_id, 'vol_swap_declined', 'svc_notifications.shift_swap.accepted_swap_declined_by_admin', '/volunteering?tab=swaps');

                return true;
            }

            // Execute the swap — use admin_approved status
            $result = self::executeSwap($swap, $tenantId, 'admin_approved');

            if ($result) {
                DB::table('vol_shift_swap_requests')
                    ->where('id', $swapId)
                    ->where('tenant_id', $tenantId)
                    ->update(['admin_id' => $adminId]);

                // Notify both parties
                self::notifySwap((int) $swap->from_user_id, 'vol_swap_approved', 'svc_notifications.shift_swap.approved_by_admin', '/volunteering?tab=swaps');
                self::notifySwap((int) $swap->to_user_id, 'vol_swap_approved', 'svc_notifications.shift_swap.accepted_swap_approved_by_admin', '/volunteering?tab=swaps');
            }

            return $result;
        } catch (\Exception $e) {
            Log::error('ShiftSwapService::adminDecision error: ' . $e->getMessage());
            self::$errors[] = ['code' => 'SERVER_ERROR', 'message' => __('api.shift_swap_admin_decision_failed')];
            return false;
        }
    }

    /**
     * Get swap requests for a user (incoming and outgoing).
     */
    public static function getSwapRequests(int $userId, string $direction = 'all'): array
    {
        $tenantId = TenantContext::getId();

        $query = DB::table('vol_shift_swap_requests as sr')
            ->join('users as fu', 'sr.from_user_id', '=', 'fu.id')
            ->join('users as tu', 'sr.to_user_id', '=', 'tu.id')
            ->join('vol_shifts as fs', 'sr.from_shift_id', '=', 'fs.id')
            ->join('vol_shifts as ts', 'sr.to_shift_id', '=', 'ts.id')
            ->leftJoin('vol_opportunities as fo', 'fs.opportunity_id', '=', 'fo.id')
            ->leftJoin('vol_organizations as forg', 'fo.organization_id', '=', 'forg.id')
            ->leftJoin('vol_opportunities as to_opp', 'ts.opportunity_id', '=', 'to_opp.id')
            ->leftJoin('vol_organizations as torg', 'to_opp.organization_id', '=', 'torg.id')
            ->where('sr.tenant_id', $tenantId)
            ->select(
                'sr.*',
                'fu.name as from_user_name', 'fu.avatar_url as from_user_avatar',
                'tu.name as to_user_name', 'tu.avatar_url as to_user_avatar',
                'fs.start_time as from_shift_start', 'fs.end_time as from_shift_end',
                'ts.start_time as to_shift_start', 'ts.end_time as to_shift_end',
                'fo.title as from_opp_title', 'forg.name as from_org_name',
                'to_opp.title as to_opp_title', 'torg.name as to_org_name'
            );

        if ($direction === 'incoming') {
            $query->where('sr.to_user_id', $userId);
        } elseif ($direction === 'outgoing') {
            $query->where('sr.from_user_id', $userId);
        } else {
            $query->where(function ($q) use ($userId) {
                $q->where('sr.from_user_id', $userId)
                  ->orWhere('sr.to_user_id', $userId);
            });
        }

        $requests = $query->orderByDesc('sr.created_at')->limit(50)->get();

        return $requests->map(function ($r) use ($userId) {
            return [
                'id'                       => (int) $r->id,
                'direction'                => (int) $r->from_user_id === $userId ? 'sent' : 'received',
                'status'                   => $r->status,
                'message'                  => $r->message,
                'requires_admin_approval'  => (bool) $r->requires_admin_approval,
                'requester' => [
                    'id'         => (int) $r->from_user_id,
                    'name'       => $r->from_user_name,
                    'avatar_url' => $r->from_user_avatar,
                ],
                'recipient' => [
                    'id'         => (int) $r->to_user_id,
                    'name'       => $r->to_user_name,
                    'avatar_url' => $r->to_user_avatar,
                ],
                'original_shift' => [
                    'id'                => (int) $r->from_shift_id,
                    'start_time'        => $r->from_shift_start,
                    'end_time'          => $r->from_shift_end,
                    'opportunity_title' => $r->from_opp_title ?? null,
                    'organization_name' => $r->from_org_name ?? null,
                ],
                'proposed_shift' => [
                    'id'                => (int) $r->to_shift_id,
                    'start_time'        => $r->to_shift_start,
                    'end_time'          => $r->to_shift_end,
                    'opportunity_title' => $r->to_opp_title ?? null,
                    'organization_name' => $r->to_org_name ?? null,
                ],
                'created_at' => $r->created_at,
            ];
        })->all();
    }

    /**
     * Cancel a pending swap request.
     */
    public static function cancel(int $swapId, int $userId, int $tenantId): bool
    {
        self::$errors = [];

        $swap = DB::table('vol_shift_swap_requests')
            ->where('id', $swapId)
            ->where('from_user_id', $userId)
            ->whereIn('status', ['pending', 'admin_pending'])
            ->where('tenant_id', $tenantId)
            ->first();

        if (! $swap) {
            self::$errors[] = ['code' => 'NOT_FOUND', 'message' => __('api.shift_swap_not_found_or_not_cancellable')];
            return false;
        }

        try {
            DB::table('vol_shift_swap_requests')
                ->where('id', $swapId)
                ->where('tenant_id', $tenantId)
                ->update(['status' => 'cancelled']);
            return true;
        } catch (\Exception $e) {
            Log::error('ShiftSwapService::cancel error: ' . $e->getMessage());
            self::$errors[] = ['code' => 'SERVER_ERROR', 'message' => __('api.shift_swap_cancel_failed')];
            return false;
        }
    }

    /**
     * Execute the actual swap (move shift assignments) within a transaction.
     *
     * @param object $swap     The swap request row
     * @param int    $tenantId Current tenant
     * @param string $finalStatus Status to set on completion ('accepted' or 'admin_approved')
     */
    private static function executeSwap(object $swap, int $tenantId, string $finalStatus = 'accepted'): bool
    {
        try {
            return DB::transaction(function () use ($swap, $tenantId, $finalStatus) {
                // Lock both assignments
                $fromApp = DB::table('vol_applications')
                    ->where('user_id', $swap->from_user_id)
                    ->where('shift_id', $swap->from_shift_id)
                    ->where('status', 'approved')
                    ->where('tenant_id', $tenantId)
                    ->lockForUpdate()
                    ->first();

                $toApp = DB::table('vol_applications')
                    ->where('user_id', $swap->to_user_id)
                    ->where('shift_id', $swap->to_shift_id)
                    ->where('status', 'approved')
                    ->where('tenant_id', $tenantId)
                    ->lockForUpdate()
                    ->first();

                if (! $fromApp || ! $toApp) {
                    self::$errors[] = ['code' => 'VALIDATION_ERROR', 'message' => __('api.shift_swap_volunteers_unassigned')];
                    return false;
                }

                // A swap can be accepted/admin-approved long after it was
                // requested — refuse to execute once either shift has started.
                $startedShift = DB::table('vol_shifts')
                    ->whereIn('id', [(int) $swap->from_shift_id, (int) $swap->to_shift_id])
                    ->where('tenant_id', $tenantId)
                    ->where('start_time', '<', now())
                    ->exists();

                if ($startedShift) {
                    self::$errors[] = ['code' => 'VALIDATION_ERROR', 'message' => __('api.shift_swap_shift_started')];
                    return false;
                }

                // Double-booking check: ensure neither user already has an overlapping
                // approved shift assignment for the shift they are moving INTO.
                if (self::hasOverlappingShift((int) $swap->from_user_id, (int) $swap->to_shift_id, (int) $swap->from_shift_id, $tenantId)) {
                    self::$errors[] = ['code' => 'VALIDATION_ERROR', 'message' => __('api.shift_swap_double_book_requester')];
                    return false;
                }
                if (self::hasOverlappingShift((int) $swap->to_user_id, (int) $swap->from_shift_id, (int) $swap->to_shift_id, $tenantId)) {
                    self::$errors[] = ['code' => 'VALIDATION_ERROR', 'message' => __('api.shift_swap_double_book_recipient')];
                    return false;
                }

                // User A: from_shift -> to_shift
                $updatedFrom = DB::table('vol_applications')
                    ->where('id', $fromApp->id)
                    ->where('tenant_id', $tenantId)
                    ->update(['shift_id' => $swap->to_shift_id]);

                // User B: to_shift -> from_shift
                $updatedTo = DB::table('vol_applications')
                    ->where('id', $toApp->id)
                    ->where('tenant_id', $tenantId)
                    ->update(['shift_id' => $swap->from_shift_id]);

                if ($updatedFrom !== 1 || $updatedTo !== 1) {
                    self::$errors[] = ['code' => 'SERVER_ERROR', 'message' => __('api.shift_swap_apply_failed')];
                    throw new \RuntimeException('Swap update mismatch');
                }

                // Update swap status
                DB::table('vol_shift_swap_requests')
                    ->where('id', $swap->id)
                    ->where('tenant_id', $tenantId)
                    ->update(['status' => $finalStatus]);

                return true;
            });
        } catch (\RuntimeException $e) {
            Log::warning('[ShiftSwap] executeSwap validation failed: ' . $e->getMessage());
            return false;
        } catch (\Exception $e) {
            Log::error('ShiftSwapService::executeSwap error: ' . $e->getMessage());
            self::$errors[] = ['code' => 'SERVER_ERROR', 'message' => __('api.shift_swap_execute_failed')];
            return false;
        }
    }

    /**
     * Check if a user has any approved shift assignment that overlaps with
     * the target shift's time window, excluding a specific shift being vacated.
     */
    private static function hasOverlappingShift(int $userId, int $targetShiftId, int $excludeShiftId, int $tenantId): bool
    {
        $targetShift = DB::table('vol_shifts')
            ->where('id', $targetShiftId)
            ->where('tenant_id', $tenantId)
            ->first();

        if (! $targetShift) {
            return false;
        }

        return DB::table('vol_applications as va')
            ->join('vol_shifts as vs', 'va.shift_id', '=', 'vs.id')
            ->where('va.user_id', $userId)
            ->where('va.status', 'approved')
            ->where('va.tenant_id', $tenantId)
            ->where('va.shift_id', '!=', $excludeShiftId) // exclude shift being vacated
            ->where('va.shift_id', '!=', $targetShiftId)  // exclude target itself
            ->where('vs.start_time', '<', $targetShift->end_time)
            ->where('vs.end_time', '>', $targetShift->start_time)
            ->exists();
    }

    /**
     * Get swap requests pending admin approval (for admin panel).
     */
    public static function getAdminPendingSwaps(): array
    {
        $tenantId = TenantContext::getId();

        $requests = DB::table('vol_shift_swap_requests as sr')
            ->join('users as fu', 'sr.from_user_id', '=', 'fu.id')
            ->join('users as tu', 'sr.to_user_id', '=', 'tu.id')
            ->join('vol_shifts as fs', 'sr.from_shift_id', '=', 'fs.id')
            ->join('vol_shifts as ts', 'sr.to_shift_id', '=', 'ts.id')
            ->leftJoin('vol_opportunities as fo', 'fs.opportunity_id', '=', 'fo.id')
            ->leftJoin('vol_opportunities as to_opp', 'ts.opportunity_id', '=', 'to_opp.id')
            ->where('sr.tenant_id', $tenantId)
            ->where('sr.status', 'admin_pending')
            ->select(
                'sr.*',
                'fu.name as from_user_name',
                'tu.name as to_user_name',
                'fs.start_time as from_shift_start', 'fs.end_time as from_shift_end',
                'ts.start_time as to_shift_start', 'ts.end_time as to_shift_end',
                'fo.title as from_opp_title',
                'to_opp.title as to_opp_title'
            )
            ->orderByDesc('sr.created_at')
            ->limit(100)
            ->get();

        return $requests->map(fn ($r) => [
            'id' => (int) $r->id,
            'status' => $r->status,
            'message' => $r->message,
            'requester' => ['id' => (int) $r->from_user_id, 'name' => $r->from_user_name],
            'recipient' => ['id' => (int) $r->to_user_id, 'name' => $r->to_user_name],
            'original_shift' => [
                'id' => (int) $r->from_shift_id,
                'start_time' => $r->from_shift_start,
                'end_time' => $r->from_shift_end,
                'opportunity_title' => $r->from_opp_title ?? null,
            ],
            'proposed_shift' => [
                'id' => (int) $r->to_shift_id,
                'start_time' => $r->to_shift_start,
                'end_time' => $r->to_shift_end,
                'opportunity_title' => $r->to_opp_title ?? null,
            ],
            'created_at' => $r->created_at,
        ])->all();
    }

    /**
     * Check if admin approval is required for swaps (tenant setting).
     */
    private static function requiresAdminApproval(int $tenantId): bool
    {
        try {
            $result = DB::table('tenant_settings')
                ->where('tenant_id', $tenantId)
                ->where('setting_key', 'volunteering.swap_requires_admin')
                ->value('setting_value');

            return filter_var($result, FILTER_VALIDATE_BOOLEAN);
        } catch (\Throwable $e) {
            Log::debug('[ShiftSwap] requiresAdminApproval check failed: ' . $e->getMessage());
            return false;
        }
    }

    /**
     * Dispatch an in-app notification for a shift swap event.
     *
     * $contentKey is the translation key (e.g. 'svc_notifications.shift_swap.requested')
     * — rendered here, inside LocaleContext keyed on the recipient's
     * preferred_language, so the persisted bell text lands in the recipient's
     * locale rather than the admin caller's or cron worker's.
     */
    private static function notifySwap(int $userId, string $activityType, string $contentKey, string $link, array $contentParams = []): void
    {
        try {
            $recipientLocale = DB::table('users')->where('id', $userId)->value('preferred_language');
            $localeInput = is_string($recipientLocale) && $recipientLocale !== '' ? $recipientLocale : null;

            LocaleContext::withLocale($localeInput, function () use ($userId, $activityType, $contentKey, $contentParams, $link) {
                $content = __($contentKey, $contentParams);
                NotificationDispatcher::dispatch(
                    $userId,
                    'global',
                    null,
                    $activityType,
                    $content,
                    $link,
                    null,
                    false
                );
            });
        } catch (\Throwable $e) {
            // Notification failure should never block the swap operation
            Log::warning('ShiftSwapService: notification dispatch failed: ' . $e->getMessage());
        }
    }
}
